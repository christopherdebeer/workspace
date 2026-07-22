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
function buildBoot(session: Session, ssrData: Record<string, unknown> | undefined, featured: FeaturedDoc[]): Boot {
  const boot: Boot = { session };
  if (featured.length) boot.featured = featured;
  if (!session.user || !ssrData) return boot;
  const typesRaw = (ssrData.types as { types?: Record<string, unknown> } | undefined)?.types;
  if (typesRaw) boot.types = typeDeclsFrom(typesRaw);
  return boot;
}

// ── the UNAUTHED public slice (tokenless) ───────────────────────────────────
// A signed-out visitor can't call /mcp (no token), and forge's SSR reads run
// AS the caller — so a workspace read as anonymous is walled. Instead we read
// the owner's slice DIRECTLY over DynamoDB, exactly the way lit/canvas do: the
// cell's IAM role is LeadingKeys-scoped to STATE#<owner> (no token, the database
// IS the boundary), and we emit ONLY keys the owner has shared to `public`
// (`_public/<pattern>` reflections). So the apex shows real curated content to
// anonymous visitors, and can never leak a private fact. AWS SDK loads lazily so
// a missing module degrades SSR to the pitch rather than crashing import.
const CELL_OWNER = process.env.CELL_OWNER || 'c15r';
const SUBSTRATE_TABLE = process.env.SUBSTRATE_TABLE || '';
interface FeaturedDoc { key: string; title: string; summary?: string }
interface Ddb { send(cmd: unknown): Promise<{ Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: unknown }> }
let ddbDoc: Ddb | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let QueryCmd: any;
function ddb(): Ddb | null {
  if (!SUBSTRATE_TABLE) return null;
  if (!ddbDoc) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const lib = require('@aws-sdk/lib-dynamodb');
      QueryCmd = lib.QueryCommand;
      ddbDoc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({})) as Ddb;
    } catch { return null; }
  }
  return ddbDoc;
}
interface SlFact { key: string; value?: unknown; superseded?: boolean; _meta?: { type?: string | null; score?: number } }
async function queryPrefix(prefix: string): Promise<SlFact[]> {
  const client = ddb();
  if (!client) return [];
  const out: SlFact[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await client.send(new QueryCmd({
      TableName: SUBSTRATE_TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
      ExpressionAttributeValues: { ':pk': `STATE#${CELL_OWNER}`, ':p': `KEY#${prefix}` },
      ExclusiveStartKey,
    }));
    for (const it of (r.Items ?? []) as SlFact[]) if (!it.superseded) out.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}
/** `_public/<pattern>` = a key/prefix the owner shared to `public`. `*` = whole
 *  slice, trailing `*` = prefix, else exact. The ONLY keys anonymous may see. */
function covers(pattern: string, key: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1));
  return pattern === key;
}
/** The owner's editorial pick for the signed-out ground: `home/featured` holds
 *  `{ keys: string[] }`, an ordered showcase. Raw storage carries no salience
 *  `score` (that lives in the shaped projection the tokenless read can't reach),
 *  so ranking-by-score would collapse to path order — an editorial fact is the
 *  honest way to choose. Empty/absent → fall back to the first public docs. */
async function curatedKeys(): Promise<string[]> {
  const facts = await queryPrefix('home/featured');
  const f = facts.find((x) => x.key === 'home/featured');
  const keys = (f?.value as { keys?: unknown } | undefined)?.keys;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
}
async function loadFeaturedPublic(): Promise<FeaturedDoc[]> {
  try {
    const patternFacts = await queryPrefix('_public/');
    const patterns = patternFacts.map((f) => (f.value as { pattern?: string } | undefined)?.pattern ?? f.key.slice('_public/'.length));
    if (!patterns.length) return [];
    // Public DOCS (title+summary metadata). The `doc:` prefix already isolates
    // doc headers (doc-block: is a distinct prefix), so — like lit's loadDocs —
    // we gate on the public patterns alone rather than a nested `_meta.type` the
    // raw table item may not carry. EVERY emitted key is re-checked against the
    // public patterns, curated or not, so a stale `home/featured` entry can never
    // leak a private fact.
    const allDocs = (await queryPrefix('doc:')).filter((f) => patterns.some((p) => covers(p, f.key)));
    const byKey = new Map(allDocs.map((f) => [f.key, f]));
    const curated = await curatedKeys();
    const picked = curated.length
      ? curated.map((k) => byKey.get(k)).filter((f): f is SlFact => !!f)
      : allDocs;
    return picked.slice(0, 8).map((f) => {
      const v = (f.value ?? {}) as { title?: string; summary?: string };
      return { key: f.key, title: v.title || f.key.slice('doc:'.length), summary: v.summary };
    });
  } catch (err) {
    console.error('[home public]', err);
    return [];
  }
}

/** The long-lived READ-ONLY `@guest` token the owner minted (stored at
 *  `_config/guest-token`). We read it over the SAME IAM slice-read used above
 *  (never emitted as public content — it's a credential, injected deliberately)
 *  and hand it to the anonymous client so its live data reads run as `@guest`.
 *  `@guest` holds only public grants, so the token can only ever surface the
 *  owner's public slice — public-safe by construction, no private-leak path. */
async function loadGuestToken(): Promise<string | undefined> {
  try {
    const facts = await queryPrefix('_config/guest-token');
    const f = facts.find((x) => x.key === '_config/guest-token');
    const token = (f?.value as { token?: unknown } | undefined)?.token;
    return typeof token === 'string' && token ? token : undefined;
  } catch (err) {
    console.error('[home guest-token]', err);
    return undefined;
  }
}

/** The default ground fact — a landing doc the home page renders in place of the
 *  pitch. Configurable via `_config/home-landing` `{key}`; defaults to the
 *  substrate foundations doc. Read over the same IAM slice-read; the key itself
 *  is harmless to emit (the CLIENT reads the doc, gated by its own token/grants). */
const DEFAULT_LANDING_KEY = 'doc:docs/substrate';
async function loadLandingKey(): Promise<string> {
  try {
    const facts = await queryPrefix('_config/home-landing');
    const f = facts.find((x) => x.key === '_config/home-landing');
    const key = (f?.value as { key?: unknown } | undefined)?.key;
    return typeof key === 'string' && key ? key : DEFAULT_LANDING_KEY;
  } catch {
    return DEFAULT_LANDING_KEY;
  }
}

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');

const BASE_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
};
function htmlHeaders(debug: boolean): Record<string, string> {
  const debugScripts = debug ? " https://cdn.jsdelivr.net 'unsafe-eval'" : '';
  return {
    ...BASE_SECURITY_HEADERS,
    'cache-control': 'private, no-store',
    'content-security-policy': [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' blob: https://esm.sh https://parc.land${debugScripts}`,
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' blob: https://parc.land https://*.on.parc.land https://cdn.jsdelivr.net https://esm.sh",
      "img-src 'self' data: blob: https://parc.land https://*.on.parc.land",
      "font-src 'self' data: https://cdn.jsdelivr.net",
      "frame-src 'self' https://*.on.parc.land",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self' https://parc.land",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  };
}
const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...BASE_SECURITY_HEADERS, ...extra },
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
  rawQueryString?: string;
  /** Shaped substrate reads forge ran as the caller (see forge runSsrReads). */
  ssrData?: Record<string, unknown>;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const debug = new URLSearchParams(event.rawQueryString ?? '').get('debug') === '1';
  if (method !== 'GET' && method !== 'HEAD') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'), { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=0, must-revalidate' });
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
      // Anonymous visitors get the curated PUBLIC slice (tokenless owner-slice
      // read, `_public/`-filtered) AND the public @guest read token, so the
      // signed-out client can go live (graph/search/doc reads) as `@guest`.
      // Signed-in visitors load their own live data with their own session.
      let featured: FeaturedDoc[] = [];
      let guestToken: string | undefined;
      // The landing doc key is for EVERYONE (authed reads it via their session,
      // anon via the guest token); featured cards + guest token are anon-only.
      const landingKey = await loadLandingKey();
      if (!authed) [featured, guestToken] = await Promise.all([loadFeaturedPublic(), loadGuestToken()]);
      const boot = buildBoot(vm, event.ssrData, featured);
      if (guestToken) boot.guestToken = guestToken;
      if (landingKey) boot.landingKey = landingKey;
      installServerBridge(event.headers?.['x-forwarded-host']);
      const inner = renderToString(createElement(App, { initial: boot }));
      const state = JSON.stringify(boot).replace(/</g, '\\u003c');
      const html = read('static/index.html')
        .replace('<div id="root"></div>', `<div id="root" data-ssr="1">${inner}</div>`)
        .replace('<script type="module"', `<script id="home-state" type="application/json">${state}</script>\n  <script type="module"`);
      return respond(200, 'text/html; charset=utf-8', html, htmlHeaders(debug));
    }
  } catch (err) {
    console.error('[home ssr]', err);
    // SSR is best-effort: a render failure falls back to the cold-mount shell
    // (the client still boots the full app) rather than a hard 500.
    try {
      if (path === '/' || path === '') return respond(200, 'text/html; charset=utf-8', read('static/index.html'), htmlHeaders(debug));
    } catch {
      /* shell unreadable — fall through to 404 */
    }
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
