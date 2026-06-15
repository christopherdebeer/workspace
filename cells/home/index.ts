/* ---------------------------------------------------------------------------
 * home — the platform face as a tier-2 cell (server half).
 *
 * AUTH-AWARE SSR: the kernel mirrors the session to a host-only `parc_session`
 * cookie on this cell's subdomain (cells/kernel setTokens); on a top-level
 * navigation dispatch validates it and passes the signed-in user as
 * `x-cell-caller` (dispatch-validated, unforgeable). The server reads that,
 * resolves the session view model, and `renderToString`s the SAME `App` the
 * client hydrates — so a signed-in visitor gets their dashboard chrome painted
 * server-side (no anonymous-shell flash), and an anonymous visitor gets the
 * landing, fully rendered. The client then hydrates and goes interactive.
 *
 * Painted assets are public cell-data blobs (served by forge at /@c15r/home/_data/…),
 * not data-URIs. Becomes the platform root via DISPATCH_DEFAULT_CELL (deferred).
 * ------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { App, typeDeclsFrom, type Session, type Boot, type DashboardData, type LayoutSection, type ChangeEvent } from './client/app';
import { installBridge } from './client/bridge';

/** Keep in lockstep with the client's loadDashboard bucketing so seeded and any
 *  later client-computed activity match. */
const ACTIVITY_BUCKETS = 16;

/**
 * Build the dashboard view model from forge's SSR reads (run as the caller — see
 * runSsrReads). Mirrors the client's loadDashboard so the seeded snapshot is what
 * the client would have fetched — but server-side, so it paints with no flash.
 */
function buildDash(d: Record<string, unknown>): DashboardData | undefined {
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  // Counts derive from the section reads (no redundant count queries): facts from
  // the windowed query's total, cells from cells.list, views/edges from their lists.
  const facts = num((d.window as { total?: number } | undefined)?.total);
  const cells = (d.cellsList as { cells?: unknown[] } | undefined)?.cells?.length;
  const views = (d.views as { views?: unknown[] } | undefined)?.views?.length;
  const edges = (d.links as { edges?: unknown[] } | undefined)?.edges?.length;
  const events = ((d.changes as { events?: ChangeEvent[] } | undefined)?.events ?? []) as ChangeEvent[];
  if (facts === undefined && !events.length) return undefined; // nothing useful read

  const writes = events.filter((e) => e.op !== 'read');
  const times = writes
    .map((e) => Date.parse(e.at))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  let activity: number[] = [];
  let activitySpanMs = 0;
  if (times.length >= 2) {
    const lo = times[0];
    const hi = times[times.length - 1];
    activitySpanMs = hi - lo;
    const span = Math.max(1, hi - lo);
    const buckets = new Array(ACTIVITY_BUCKETS).fill(0);
    for (const t of times) buckets[Math.min(ACTIVITY_BUCKETS - 1, Math.floor(((t - lo) / span) * ACTIVITY_BUCKETS))]++;
    activity = buckets;
  }
  return {
    facts: facts ?? 0,
    cells: cells ?? 0,
    views: views ?? 0,
    edges: edges ?? 0,
    activity,
    activitySpanMs,
    recent: writes.slice(-8).reverse(),
  };
}

/** Assemble the first-paint seed: session + (for an authed nav) the layout and
 *  dashboard data forge read on the caller's behalf. */
function buildBoot(session: Session, ssrData: Record<string, unknown> | undefined): Boot {
  const boot: Boot = { session };
  if (!session.user || !ssrData) return boot;
  const d = ssrData;

  const layoutEntry = d.layout as { value?: { sections?: LayoutSection[] } } | null | undefined;
  const sections = layoutEntry?.value?.sections;
  if (Array.isArray(sections) && sections.length) boot.layout = sections;

  // The canonical type vocabulary (describeTypes), assembled the same way the
  // client's loadTypeDecls does — so the viewer (render hints) paints server-side.
  const typesRaw = (d.types as { types?: Record<string, unknown> } | undefined)?.types;
  if (typesRaw) boot.types = typeDeclsFrom(typesRaw);

  const dash = buildDash(d);
  if (dash) boot.dash = dash;

  // The workspace window: salience-ranked facts (the windowed query), attention,
  // and edges — exactly what the client would have fetched.
  const win = d.window as { entries?: unknown[]; total?: number } | undefined;
  if (win) {
    boot.workspace = {
      attention: d.attention ?? null,
      facts: win.entries ?? [],
      total: win.total ?? 0,
      edges: (d.links as { edges?: unknown[] } | undefined)?.edges ?? [],
    } as Boot['workspace'];
  }
  const cellsList = (d.cellsList as { cells?: unknown[] } | undefined)?.cells;
  if (cellsList) boot.cells = cellsList as Boot['cells'];
  const viewsList = (d.views as { views?: unknown[] } | undefined)?.views;
  if (viewsList) boot.views = viewsList as Boot['views'];
  return boot;
}

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

const CELL_DOMAIN = 'on.parc.land';

/** Install a host-aware `cellUrl` so SSR'd cross-cell links match what the client
 *  renders after hydration (the kernel's `cellUrl` keys off the live host) —
 *  otherwise the href attributes mismatch and React warns/repaints.
 *
 *  A cell is served from its own subdomain (`<owner>-<name>.on.parc.land`) — that
 *  is the canonical, and only, way a user cell is reached (no user cells on the
 *  apex), so the client is always `onCellHost` and we default to the subdomain
 *  form. forge doesn't forward the browser Host to the cell today; if it ever sets
 *  `x-forwarded-host`, we honour it (an apex host → path form) for free. */
function installServerBridge(fwdHost: string | undefined): void {
  const onCellHost = fwdHost ? fwdHost.endsWith('.' + CELL_DOMAIN) : true;
  installBridge({
    cellUrl: (owner: string, name: string, rest = ''): string =>
      onCellHost ? `https://${owner}-${name}.${CELL_DOMAIN}${rest}` : `/@${owner}/${name}${rest}`,
  });
}

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  /** Shaped substrate reads forge ran as the caller (see forge runSsrReads). */
  ssrData?: Record<string, unknown>;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET' && method !== 'HEAD') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'), { 'access-control-allow-origin': '*' });
    if (path === '/' || path === '') {
      // `x-cell-caller` is the dispatch-validated session identity (from the
      // `parc_session` cookie on a top-level navigation), or 'anonymous'.
      const caller = event.headers?.['x-cell-caller'];
      const authed = !!caller && caller !== 'anonymous';
      const vm: Session = {
        ready: true,
        user: authed ? (caller as string) : null,
        scopes: [],
        error: null,
      };
      const boot = buildBoot(vm, event.ssrData);
      installServerBridge(event.headers?.['x-forwarded-host']);
      const inner = renderToString(createElement(App, { initial: boot }));
      const state = JSON.stringify(boot).replace(/</g, '\\u003c');
      const html = read('static/index.html')
        .replace('<div id="root"></div>', `<div id="root" data-ssr="1">${inner}</div>`)
        .replace('<script type="module"', `<script id="home-state" type="application/json">${state}</script>\n  <script type="module"`);
      return respond(200, 'text/html; charset=utf-8', html);
    }
  } catch (err) {
    // SSR is best-effort: a render failure falls back to the cold-mount shell
    // (the client still boots the full app) rather than a hard 500.
    try {
      if (path === '/' || path === '') return respond(200, 'text/html; charset=utf-8', read('static/index.html'));
    } catch {
      /* shell unreadable — fall through to 404 */
    }
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
