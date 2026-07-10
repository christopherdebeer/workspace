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
import { App, typeDeclsFrom, type Session, type Boot } from './client/app';
import { installBridge } from './client/bridge';

/** Assemble the first-paint seed: session + the canonical type vocabulary
 *  (describeTypes), assembled the same way the client's loadTypeDecls does — so
 *  icons/titles/routing paint server-side. The graph and the field computer load
 *  their own data live; home no longer seeds a dashboard snapshot (the section
 *  dashboard is gone — home is the graph + the field computer, owner direction
 *  2026-07-10), so SSR reads collapse from eleven to one (ssr.json).
 */
function buildBoot(session: Session, ssrData: Record<string, unknown> | undefined): Boot {
  const boot: Boot = { session };
  if (!session.user || !ssrData) return boot;
  const typesRaw = (ssrData.types as { types?: Record<string, unknown> } | undefined)?.types;
  if (typesRaw) boot.types = typeDeclsFrom(typesRaw);
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
