/**
 * The client kernel — one shared module for every tier-2 surface.
 *
 * Reference, not copy (the dotlit lesson, applied to ourselves): auth (PKCE,
 * ONE parc.session.* namespace for the whole origin — sign in once, every
 * surface and embed is authed), the /mcp read/act client, boot narration,
 * and fact presentation (titleOf/hrefOf, driven by the gateway-served `$types`
 * Present facet with convention fallbacks).
 *
 * Served as an ESM module at /@c15r/kernel/app.js; cells import the URL.
 * Git truth: cells/kernel/client/main.ts in the platform repo.
 */
import { resolve as resolveIntent, titleOf as presentTitleOf } from '@parc/ui';

/* ── session (shared across the origin) ─────────────────────────── */

const NS = 'parc.session';
const K = {
  tokens: `${NS}.tokens`,
  client: `${NS}.client_id`,
  pkce: `${NS}.pkce_verifier`,
  state: `${NS}.oauth_state`,
  attempts: `${NS}.login_attempts`,
  ret: `${NS}.return_to`,
};
const DEFAULT_SCOPE = 'workspace:read workspace:write';

interface Tokens {
  access_token: string;
  refresh_token?: string;
  scope?: string;
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const rand = (n: number): string => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b64url(b);
};
const sha256 = async (s: string): Promise<string> =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(K.tokens);
    if (raw) return JSON.parse(raw) as Tokens;
    // One-time adoption of a pre-kernel per-cell session.
    for (const legacy of ['parc.canvas.tokens', 'parc.lit.tokens', 'parc.input.tokens']) {
      const t = localStorage.getItem(legacy);
      if (t) {
        localStorage.setItem(K.tokens, t);
        return JSON.parse(t) as Tokens;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}
function setTokens(t: Tokens | null): void {
  try {
    if (t) localStorage.setItem(K.tokens, JSON.stringify(t));
    else localStorage.removeItem(K.tokens);
  } catch {
    /* storage unavailable */
  }
  // On a cell host, mirror the access token to a host-only `parc_session` cookie
  // so the cell's SERVER can SSR the authed view (dispatch reads parc_session →
  // x-cell-caller, the cell renders the owner's content) — no anonymous-SSR →
  // authed-client flash. Same exposure as the localStorage token (origin-
  // isolated, and it's the capped cell token). Cleared on sign-out (t === null).
  if (typeof location !== 'undefined' && location.host.endsWith('.' + CELL_DOMAIN)) {
    try {
      document.cookie = t?.access_token
        ? `parc_session=${t.access_token}; Secure; SameSite=Lax; Path=/; Max-Age=3600`
        : 'parc_session=; Secure; SameSite=Lax; Path=/; Max-Age=0';
    } catch {
      /* */
    }
  }
}

export const isAuthed = (): boolean => !!getTokens()?.access_token;
export const accessToken = (): string | null => getTokens()?.access_token ?? null;
export const grantedScopes = (): string[] => (getTokens()?.scope ?? '').split(/\s+/).filter(Boolean);

/* ── origin topology (cell isolation, docs/cell-origin-isolation.md) ── */
// Cells may be served from their own origin `<owner>-<name>.on.parc.land`; the
// shell APIs (`/mcp`, `/oauth/*`) live on the apex. On a cell host, `/mcp` calls
// target the apex cross-origin (bearer in header — needs CORS on /mcp); on the
// apex they stay relative. The viewed cell's owner/name come from the host there,
// otherwise from the `/@owner/cell` path.
const CELL_DOMAIN = 'on.parc.land';
const APEX = 'https://parc.land';
const onCellHost = (): boolean => location.host.endsWith('.' + CELL_DOMAIN);
const apiBase = (): string => (onCellHost() ? APEX : '');

/** The cell being viewed: `{owner, name}` from the host (`<owner>-<name>.on.parc.land`
 *  — owner is hyphen-free, so split on the first hyphen) or the `/@owner/cell` path. */
export function cellAddress(): { owner: string; name: string } | null {
  if (onCellHost()) {
    const label = location.host.slice(0, -(CELL_DOMAIN.length + 1));
    const i = label.indexOf('-');
    if (i > 0) return { owner: label.slice(0, i), name: label.slice(i + 1) };
  }
  const m = location.pathname.match(/^\/@([^/]+)\/([^/]+)/);
  return m ? { owner: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) } : null;
}

/** A link to another cell's surface, origin-aware: on a cell host, the sibling
 *  subdomain (keeps each cell its own origin — the `/@owner/name` path would be
 *  re-prefixed by the edge and 404); on the apex, the `/@owner/name` path. */
export function cellUrl(owner: string, name: string, rest = ''): string {
  if (onCellHost()) return `${location.protocol}//${owner}-${name}.${CELL_DOMAIN}${rest}`;
  return `/@${owner}/${name}${rest}`;
}

/** One OAuth client for the whole origin; redirect lands wherever you were. */
async function ensureClientId(): Promise<string> {
  const cached = localStorage.getItem(K.client);
  if (cached) return cached;
  const res = await fetch(apiBase() + '/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      // The session is origin-wide; register every surface path as a valid landing.
      redirect_uris: [location.origin, `${location.origin}${location.pathname.replace(/\/+$/, '')}`],
      client_name: 'parc.land',
      token_endpoint_auth_method: 'none',
    }),
  });
  const j = (await res.json()) as { client_id?: string; error?: string };
  if (!j.client_id) throw new Error(j.error ?? 'client registration failed');
  localStorage.setItem(K.client, j.client_id);
  return j.client_id;
}

export async function login(scope: string = DEFAULT_SCOPE): Promise<never> {
  const clientId = await ensureClientId();
  const verifier = rand(32);
  const state = rand(16);
  sessionStorage.setItem(K.pkce, verifier);
  sessionStorage.setItem(K.state, state);
  sessionStorage.setItem(K.ret, location.href);
  const u = new URL('/oauth/authorize', apiBase() || location.origin);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', `${location.origin}${location.pathname.replace(/\/+$/, '')}`);
  u.searchParams.set('code_challenge', await sha256(verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('scope', scope);
  u.searchParams.set('state', state);
  location.assign(u.toString());
  return new Promise<never>(() => undefined); // navigation is taking over
}

/** Incremental consent: re-authorize with the union of current + needed. */
export async function requestScopes(scopes: string[]): Promise<void> {
  const want = new Set([...grantedScopes(), ...scopes]);
  for (const s of DEFAULT_SCOPE.split(' ')) want.add(s);
  await login([...want].join(' '));
}

export function signOut(): void {
  setTokens(null);
  for (const legacy of ['parc.canvas.tokens', 'parc.lit.tokens', 'parc.input.tokens']) {
    try {
      localStorage.removeItem(legacy);
    } catch {
      /* */
    }
  }
  location.reload();
}

async function completeLoginIfReturning(): Promise<boolean> {
  const search = new URLSearchParams(location.search);
  const code = search.get('code');
  if (!code) return false;
  const returnedState = search.get('state');
  const back = sessionStorage.getItem(K.ret);
  sessionStorage.removeItem(K.ret);
  const expected = sessionStorage.getItem(K.state);
  const verifier = sessionStorage.getItem(K.pkce);
  sessionStorage.removeItem(K.state);
  sessionStorage.removeItem(K.pkce);
  if (!expected || returnedState !== expected) throw new Error('OAuth state mismatch');
  if (!verifier) throw new Error('missing PKCE verifier');
  const res = await fetch(apiBase() + '/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${location.origin}${location.pathname.replace(/\/+$/, '')}`,
      code_verifier: verifier,
      client_id: localStorage.getItem(K.client),
    }),
  });
  const j = (await res.json()) as Tokens & { error?: string; error_description?: string; expires_in?: number };
  if (!j.access_token) throw new Error(j.error_description ?? j.error ?? 'token exchange failed');
  setTokens({ access_token: j.access_token, refresh_token: j.refresh_token, scope: j.scope });
  scheduleRefresh(j.expires_in); // arm proactive refresh for this fresh session
  // Restore the pre-login URL (minus the code) — query params and all.
  history.replaceState({}, '', back && back.startsWith(location.origin) ? back : location.pathname);
  return true;
}

/**
 * Proactive refresh: re-mint the access token shortly BEFORE it expires (not just
 * reactively on a 401), so an open tab never lapses and each refresh also re-primes
 * the httpOnly navigation cookies server-side — the client half of edge
 * silent-refresh. Self-perpetuating while the tab is open; complements the
 * server-side cookie refresh that covers returning after the tab was closed.
 */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh(expiresInSec?: number): void {
  if (typeof window === 'undefined') return;
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  if (!getTokens()?.refresh_token) return;
  const horizon = Number.isFinite(expiresInSec) && (expiresInSec as number) > 0 ? (expiresInSec as number) : 3600;
  const delayMs = Math.max(60, horizon - 300) * 1000; // ~5m before expiry, ≥60s out
  refreshTimer = setTimeout(() => { void refresh(); }, delayMs);
}

/**
 * Single-flight guard. The dashboard boots MANY parallel reads; when the access
 * token has lapsed they all 401 at once and each would fire its own refresh with
 * the SAME single-use refresh token. The server rotates on first use, so every
 * loser then presents a just-deleted token, gets `invalid_grant`, and wipes a
 * session that is actually fine — the daily-sign-out bug. Memoizing the in-flight
 * refresh makes N concurrent callers share ONE round-trip.
 */
let refreshInflight: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = doRefresh().finally(() => { refreshInflight = null; });
  return refreshInflight;
}

async function doRefresh(): Promise<boolean> {
  const t = getTokens();
  if (!t?.refresh_token) return false;
  const usedRefresh = t.refresh_token;
  let res: Response;
  try {
    res = await fetch(apiBase() + '/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: usedRefresh }),
    });
  } catch {
    // Network error (mobile wifi↔cellular hand-off, tab resumed mid-flight) —
    // leave tokens intact so a later call can retry, don't sign the user out.
    return !!getTokens()?.access_token;
  }
  const j = (await res.json().catch(() => ({}))) as Tokens & { expires_in?: number };
  if (!j.access_token) {
    // Refresh rejected. Only wipe if OUR refresh token is still the stored one:
    // if a concurrent refresh (another tab) already rotated it and stored a fresh
    // session, this is harmless rotation-reuse — must NOT clear the good session.
    if (getTokens()?.refresh_token === usedRefresh) setTokens(null);
    return !!getTokens()?.access_token;
  }
  setTokens({ access_token: j.access_token, refresh_token: j.refresh_token ?? usedRefresh, scope: j.scope ?? t.scope });
  scheduleRefresh(j.expires_in); // re-arm the next proactive refresh
  return true;
}

/** fetch() with the session bearer, refreshing once on 401. */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const run = async (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const t = getTokens();
    if (t?.access_token) headers.set('authorization', `Bearer ${t.access_token}`);
    // On a cell host the shell APIs live on the apex (cross-origin); on the apex
    // `apiBase()` is empty so the path stays relative (unchanged behaviour).
    return fetch(apiBase() + path, { ...init, headers });
  };
  let res = await run();
  if (res.status === 401 && getTokens()?.refresh_token) {
    if (await refresh()) res = await run();
  }
  return res;
}

/**
 * Boot gate: finish a returning OAuth redirect, else sign in. A repeated
 * failed return fails LOUD instead of looping invisibly.
 */
export async function ensureAuth(scope: string = DEFAULT_SCOPE): Promise<void> {
  try {
    await completeLoginIfReturning();
  } catch (err) {
    console.warn('[kernel] OAuth return failed', err);
    bootStatus(`sign-in return failed (${(err as Error).message}) — retrying…`);
  }
  if (!isAuthed()) {
    const n = Number(sessionStorage.getItem(K.attempts) ?? '0');
    if (n >= 2) throw new Error('sign-in loop detected — the OAuth return keeps failing; try ?debug=1');
    sessionStorage.setItem(K.attempts, String(n + 1));
    await login(scope);
  }
  sessionStorage.removeItem(K.attempts);
}

/* ── substrate client (/mcp read + act) ─────────────────────────── */

export interface McpOutcome {
  ok: boolean;
  value: unknown;
}

export async function mcp(verb: 'read' | 'act', target: string, input?: unknown): Promise<McpOutcome> {
  const res = await authFetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: verb, arguments: input === undefined ? { target } : { target, input } },
    }),
  });
  if (!res.ok) return { ok: false, value: `HTTP ${res.status}` };
  const rpc = (await res.json()) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
    error?: { message?: string };
  };
  if (rpc.error) return { ok: false, value: rpc.error.message ?? 'error' };
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* raw text */
  }
  return { ok: !rpc.result?.isError, value };
}

export async function read<T = unknown>(target: string, input?: unknown): Promise<T> {
  const r = await mcp('read', target, input);
  if (!r.ok) throw new Error(typeof r.value === 'string' ? r.value : JSON.stringify(r.value));
  return r.value as T;
}

export async function act<T = unknown>(target: string, input?: unknown): Promise<T> {
  const r = await mcp('act', target, input);
  if (!r.ok) throw new Error(typeof r.value === 'string' ? r.value : JSON.stringify(r.value));
  return r.value as T;
}

/* ── boot narration (pairs with the standard shell's watchdog) ──── */

export function bootStatus(msg: string): void {
  const b = document.querySelector('#app .boot');
  if (b) b.textContent = msg;
}

export function bootFail(err: Error): void {
  const banner = document.getElementById('err-banner');
  if (banner) {
    banner.style.display = 'block';
    banner.textContent = `boot failed: ${err.message}`;
  }
  bootStatus(`failed — ${err.message}`);
}

/** Mark the module as executed (the shell watchdog distinguishes "never ran"). */
export function moduleAlive(): void {
  (window as unknown as Record<string, unknown>).__lit_module = true;
}

/* ── fact presentation: gateway $types Present facet, convention fallbacks ─ */

export interface FactEntry {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[]; updatedAt?: string };
}

interface TypeDecl {
  /** Dot-path into the value for the display title (e.g. "title"). Legacy flat key. */
  titlePath?: string;
  /** Href template: ${key}, ${id} (key after first prefix), ${value.*}. */
  href?: string;
  icon?: string;
  /** The gateway-resolved Present facet (ADR-0012): `{icon,label,render}` — the
   *  legacy `{icon,titlePath}` normalised once, server-side. `label` is a path. */
  present?: { icon?: string; label?: string; render?: unknown };
  /** ADR-0049 capability handlers as served by `$types` — `open` carries the
   *  type's canonical route (e.g. machine: path "/m/${id}"). */
  handlers?: { open?: Array<{ path?: string; href?: string }> };
  /** The managing cell ("@owner/name") — open `path`s are routed on it. */
  manager?: string;
}

let typeDecls: Record<string, TypeDecl> | null = null;

/** Load the type vocabulary once per page; safe to call repeatedly. Consumes the
 *  gateway-served `$types` (ADR-0014 row 3): canonical cell-registry types merged
 *  under the caller's `_types/` overrides, each carrying the resolved `present`
 *  facet — strictly richer than the old raw `_types/` scan, which saw overrides only. */
export async function loadTypes(): Promise<Record<string, TypeDecl>> {
  if (typeDecls) return typeDecls;
  try {
    const res = await read<{ types: Record<string, TypeDecl> }>('$types');
    typeDecls = res.types ?? {};
  } catch {
    typeDecls = {};
  }
  return typeDecls;
}

function pathInto(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function titleOf(e: FactEntry): string {
  // The ONE shared Present resolver (@parc/ui): declared label path (envelope-
  // rooted for `value.*`/`key`/`meta.*`, value-rooted for legacy bare tokens,
  // mirroring the runtime's `resolveLabel`) → value heuristic → key. Kernel's
  // former local body was the reference implementation the shared one keeps.
  return presentTitleOf(e, typeDecls?.[e._meta?.type ?? '']);
}

export function hrefOf(e: FactEntry): string | null {
  const decl = typeDecls?.[e._meta?.type ?? ''];
  const id = e.key.includes(':') ? e.key.slice(e.key.indexOf(':') + 1) : e.key.includes('/') ? e.key.slice(e.key.indexOf('/') + 1) : e.key;
  const fill = (tpl: string): string => tpl
    .replace(/\$\{key\}/g, encodeURIComponent(e.key))
    .replace(/\$\{id\}/g, encodeURIComponent(id))
    .replace(/\$\{value\.([A-Za-z0-9_.]+)\}/g, (_, p: string) => String(pathInto(e.value, p) ?? ''));
  if (decl?.href) return fill(decl.href); // legacy flat template — a slice override may still carry one
  // ADR-0044 Inc 4 (closing ADR-0042's routing fork): the ONE shared resolver
  // (platform/ui/vocab `resolve`) replaces both the local handlers.open scan
  // and the hardcoded lit/input/canvas convention fallbacks that used to sit
  // here. Type SIGNALS cover the declared type, the key's prefix, and every
  // tag's prefix — so a `canvas:X` tag routes through canvas's own declared
  // open (`?canvas=${match}`), a `doc:` key or tag through lit's
  // (`/r/doc:${match}`), and a capture through input's declared alternatives
  // (`/r/log:${value.captured}`, else the input surface) — all data in each
  // cell's types.json, no per-cell code in the kernel.
  const h = resolveIntent(
    { key: e.key, value: e.value, _meta: { type: e._meta?.type ?? null, tags: e._meta?.tags } },
    'open',
    (typeDecls ?? {}) as Parameters<typeof resolveIntent>[2],
  );
  if (h?.cellRef) return cellUrl(h.cellRef.owner || (cellAddress()?.owner ?? 'c15r'), h.cellRef.name, h.path ?? '');
  if (h?.surface) return h.surface;
  // The one convention with no declaration to live in yet: a `cell` fact's
  // address IS its surface, and the cells service (tier-1, no types.json)
  // owns that type. Folds away when the service federates a declaration.
  const v = (e.value ?? {}) as Record<string, unknown>;
  if ((e._meta?.type ?? null) === 'cell' && typeof v.address === 'string') return v.address;
  return null;
}

/* ── ADR-0053: the sync seam, Inc 1 — the Outbox ─────────────────────────
 * Every tier-2 surface that writes facts needs the same machinery: canonical
 * change detection, a debounced batch flush, retry with backoff, an echo
 * window for change-feed self-suppression, and a priming buffer for writes
 * issued mid-load. The canvas hand-rolled all of it in module-level maps and
 * every seam was a data bug (cross-board supersede, the boot write storm,
 * two-tab revision ping-pong, lost membership tags — see the ADR). These
 * semantics are that battle-tested behavior, lifted verbatim. */

/** Canonical JSON (recursively key-sorted). Insertion-ordered JSON serializes
 *  the same logical value differently across sessions — two open tabs each saw
 *  the other's facts as "changed" and rewrote them forever. */
export function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val);
}

export interface OutboxExtra { type?: string; tags?: string[] }
export interface Outbox {
  /** Queue a write. Deduped against the seed in canonical form — EXCEPT when
   *  it carries tags: a tag-only change over an unchanged value is exactly
   *  what "add an existing fact to a board" produces and must not be eaten. */
  stage(key: string, value: unknown, extra?: OutboxExtra): void;
  /** Record "this exact value is already persisted" (canonical form). Seed
   *  with what a save WOULD write — seeding raw stored values makes every
   *  legacy fact look changed on every load (the boot write storm). */
  seed(key: string, value: unknown): void;
  seededJson(key: string): string | undefined;
  /** Was this key flushed by THIS outbox within the echo window? (Change-feed
   *  events for it are our own echo — skip the refetch.) */
  wroteRecently(key: string, windowMs?: number): boolean;
  forget(key: string): void;
  keys(): IterableIterator<string>;
  /** Buffer writes during a load window, then REPLAY them through the dedupe
   *  once seeds exist — render echoes no-op, user writes land. (Dropping them
   *  instead silently lost additions made in the first seconds after open.) */
  beginPriming(): void;
  endPriming(): void;
  priming(): boolean;
  /** Scope switch (e.g. drill navigation): clear seeds/echoes — stale seeds
   *  make the next diff supersede the PREVIOUS scope's facts. Pending writes
   *  are kept: in-flight edits still belong to their keys. */
  reset(): void;
  flushNow(): Promise<void>;
}

export function createOutbox(
  actFn: (target: string, input: Record<string, unknown>) => Promise<unknown>,
  opts: {
    via?: string;
    flushDelayMs?: number;
    echoWindowMs?: number;
    onState?: (s: 'saving' | 'saved' | 'failed') => void;
  } = {},
): Outbox {
  const via = opts.via ?? 'kernel-outbox';
  const FLUSH_MS = opts.flushDelayMs ?? 400;
  const ECHO_MS = opts.echoWindowMs ?? 45_000;
  const seeded = new Map<string, string>();
  const pending = new Map<string, { value: unknown } & OutboxExtra>();
  const flushedAt = new Map<string, number>();
  const primingBuffer = new Map<string, { value: unknown } & OutboxExtra>();
  let priming = false;
  let flushing = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (ms: number): void => {
    if (timer) return;
    timer = setTimeout(() => { timer = undefined; void flushNow(); }, ms);
  };

  function stage(key: string, value: unknown, extra?: OutboxExtra): void {
    if (priming) { primingBuffer.set(key, { value, ...extra }); return; }
    if (seeded.get(key) === stableStringify(value) && !extra?.tags) return;
    pending.set(key, { value, ...extra });
    schedule(FLUSH_MS);
  }

  async function flushNow(): Promise<void> {
    if (flushing) { schedule(FLUSH_MS); return; }
    if (!pending.size) return;
    flushing = true;
    opts.onState?.('saving');
    let failed = false;
    try {
      // Concurrent — a serial loop holds the queue for the SUM of round-trips.
      const batch = [...pending];
      pending.clear();
      const results = await Promise.allSettled(batch.map(async ([key, p]) => {
        await actFn('workspace.remember', {
          key,
          value: p.value,
          via,
          ...(p.type ? { type: p.type } : {}),
          ...(p.tags ? { tags: p.tags } : {}),
        });
        seeded.set(key, stableStringify(p.value));
        flushedAt.set(key, Date.now());
      }));
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          failed = true;
          console.warn('[outbox] write failed', batch[i][0], r.reason);
          // Re-queue unless a NEWER value is already pending — a throttled
          // write (DynamoDB scaling) must retry, not vanish.
          if (!pending.has(batch[i][0])) pending.set(batch[i][0], batch[i][1]);
        }
      });
      // Prune stale echo records so the map doesn't grow with session length.
      const cut = Date.now() - 2 * ECHO_MS;
      for (const [k, t] of flushedAt) if (t < cut) flushedAt.delete(k);
    } finally {
      flushing = false;
      opts.onState?.(failed ? 'failed' : 'saved');
      if (failed) {
        failures++;
        schedule(Math.min(30_000, 2000 * 2 ** Math.min(failures - 1, 4)));
      } else {
        failures = 0;
      }
    }
  }

  return {
    stage,
    flushNow,
    seed: (key, value) => { seeded.set(key, stableStringify(value)); },
    seededJson: (key) => seeded.get(key),
    wroteRecently: (key, windowMs = ECHO_MS) => Date.now() - (flushedAt.get(key) ?? 0) < windowMs,
    forget: (key) => { seeded.delete(key); },
    keys: () => seeded.keys(),
    beginPriming: () => { priming = true; },
    endPriming: () => {
      priming = false;
      const buffered = [...primingBuffer];
      primingBuffer.clear();
      for (const [key, p] of buffered) stage(key, p.value, p);
    },
    priming: () => priming,
    reset: () => {
      seeded.clear();
      flushedAt.clear();
      primingBuffer.clear();
      priming = false;
    },
  };
}

/* ── ADR-0053: the sync seam, Inc 2 — the Projection ─────────────────────
 * The read half of the same failure class: every surface that shows live
 * facts hand-rolls a change-feed cursor loop, and each seam (echo refetch,
 * stale-revision apply, board-switch leakage) was one of the canvas's data
 * bugs. The kernel owns the loop mechanics — the cursor, the ADR-0055
 * scope, echo suppression against the bound outbox, the tick cadence.
 * WHAT a change means stays with the caller: the apply callback keeps the
 * shape (element vs placement vs edge) out of the kernel. */

/** One change-feed event, as `workspace.changes` ships it (ADR-0055-scoped). */
export interface ChangeEvent { op: string; key: string | null; rel?: string; to?: string }

export interface Projection {
  /** Record the initial load on the bound outbox: each entry is "already
   *  persisted", so the feed's own echoes and the first save-sweep diff both
   *  no-op against it. Seed with what a save WOULD write (the outbox rule) —
   *  seeding raw stored values caused the boot write storm. */
  seedInitial(entries: Iterable<{ key: string; value: unknown }>): void;
  /** Called after any pump whose apply reported a change (and after a seed) —
   *  render scheduling lives here, not inside the merge callbacks. */
  subscribe(cb: () => void): () => void;
  /** One cursor advance: read the scoped slice since the last seq, drop our
   *  own echoes, hand the survivors to the apply callback. The first call
   *  pins the cursor to head — history before the page opened is the
   *  initial load's business, not the feed's. */
  pump(): Promise<void>;
  /** The tick loop. `intervalMs` is re-read every tick (adaptive cadence);
   *  a hidden tab keeps ticking but reads nothing. */
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createProjection(
  readFn: (target: string, input?: unknown) => Promise<unknown>,
  outbox: Pick<Outbox, 'seed' | 'wroteRecently'>,
  opts: {
    /** The ADR-0055 slice `{prefixes, ops}`, re-read every pump — the scope
     *  can move under a long-lived loop (drill navigation swaps boards).
     *  Returning null skips the tick entirely. */
    scope: () => { prefixes: string[]; ops: string[] } | null;
    /** Merge surviving events into local state; return whether anything
     *  changed. Prefix dispatch, the live-revision refetch, and the in-place
     *  merge live HERE — the projection stays shape-agnostic. */
    apply: (events: ChangeEvent[]) => boolean | Promise<boolean>;
    intervalMs?: () => number;
  },
): Projection {
  const subscribers = new Set<() => void>();
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pumping = false;
  const notify = (): void => {
    for (const cb of subscribers) {
      try { cb(); } catch { /* one bad subscriber must not starve the rest */ }
    }
  };

  async function pump(): Promise<void> {
    if (pumping) return; // one in-flight advance — overlap would re-apply a seq window
    const scope = opts.scope();
    if (!scope) return;
    pumping = true;
    try {
      if (cursor === 0) {
        cursor = ((await readFn('workspace.changes', { sinceSeq: 'head' })) as { seq: number }).seq;
        return;
      }
      const res = (await readFn('workspace.changes', { sinceSeq: cursor, scope })) as {
        events?: ChangeEvent[];
        seq: number;
      };
      cursor = res.seq;
      const events = (res.events ?? []).filter((ev) => {
        // Graph events carry no fact write — pass through, the caller decides.
        if (ev.op === 'link' || ev.op === 'unlink') return true;
        // Belt-and-braces vs an older gateway: reads are not state changes.
        if (ev.op !== 'write' && ev.op !== 'supersede') return false;
        if (!ev.key) return false;
        // Our own flushes echo straight back through the feed — skip them;
        // the outbox seeds already hold exactly what we wrote.
        return !outbox.wroteRecently(ev.key);
      });
      if (events.length && (await opts.apply(events))) notify();
    } finally {
      pumping = false;
    }
  }

  const stop = (): void => {
    running = false;
    if (timer) { clearTimeout(timer); timer = undefined; }
  };
  const loop = (): void => {
    timer = setTimeout(() => {
      void (async () => {
        try {
          // A hidden tab does no substrate reads; the loop keeps its cadence.
          if (typeof document === 'undefined' || !document.hidden) await pump();
        } catch { /* offline — retry next tick */ }
        if (running) loop();
      })();
    }, opts.intervalMs?.() ?? 6000);
  };

  return {
    seedInitial: (entries) => {
      for (const e of entries) outbox.seed(e.key, e.value);
      notify();
    },
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    pump,
    start: () => {
      if (running) return;
      running = true;
      loop();
    },
    stop,
    dispose: () => {
      stop();
      subscribers.clear();
    },
  };
}

/* ── theme tokens (one palette for userland) ────────────────────── */

export function injectTheme(): void {
  if (document.getElementById('kernel-theme')) return;
  const s = document.createElement('style');
  s.id = 'kernel-theme';
  s.textContent = `:root {
  --ink: #1c1c1a; --faint: #8a8a82; --paper: #fbfbf8;
  --line: #e4e4dc; --accent: #2f6f4f; --warn: #9a6b1f; --danger: #7a1f1f;
}`;
  document.head.appendChild(s);
}

moduleAlive();
