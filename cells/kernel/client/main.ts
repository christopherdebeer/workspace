/**
 * The client kernel — one shared module for every tier-2 surface.
 *
 * Reference, not copy (the dotlit lesson, applied to ourselves): auth (PKCE,
 * ONE parc.session.* namespace for the whole origin — sign in once, every
 * surface and embed is authed), the /mcp read/act client, boot narration,
 * and fact presentation (titleOf/hrefOf, driven by `_types/<type>` facts
 * with convention fallbacks).
 *
 * Served as an ESM module at /@c15r/kernel/app.js; cells import the URL.
 * Git truth: cells/kernel/client/main.ts in the platform repo.
 */

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

/** One OAuth client for the whole origin; redirect lands wherever you were. */
async function ensureClientId(): Promise<string> {
  const cached = localStorage.getItem(K.client);
  if (cached) return cached;
  const res = await fetch('/oauth/register', {
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
  const u = new URL('/oauth/authorize', location.origin);
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
  const res = await fetch('/oauth/token', {
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
  const j = (await res.json()) as Tokens & { error?: string; error_description?: string };
  if (!j.access_token) throw new Error(j.error_description ?? j.error ?? 'token exchange failed');
  setTokens({ access_token: j.access_token, refresh_token: j.refresh_token, scope: j.scope });
  // Restore the pre-login URL (minus the code) — query params and all.
  history.replaceState({}, '', back && back.startsWith(location.origin) ? back : location.pathname);
  return true;
}

async function refresh(): Promise<boolean> {
  const t = getTokens();
  if (!t?.refresh_token) return false;
  const res = await fetch('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  const j = (await res.json()) as Tokens;
  if (!j.access_token) {
    setTokens(null);
    return false;
  }
  setTokens({ access_token: j.access_token, refresh_token: j.refresh_token ?? t.refresh_token, scope: j.scope ?? t.scope });
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

/* ── fact presentation: _types/<type> facts, convention fallbacks ─ */

export interface FactEntry {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[]; updatedAt?: string };
}

interface TypeDecl {
  /** Dot-path into the value for the display title (e.g. "title"). */
  titlePath?: string;
  /** Href template: ${key}, ${id} (key after first prefix), ${value.*}. */
  href?: string;
  icon?: string;
}

let typeDecls: Record<string, TypeDecl> | null = null;

/** Load `_types/` declarations once per page; safe to call repeatedly. */
export async function loadTypes(): Promise<Record<string, TypeDecl>> {
  if (typeDecls) return typeDecls;
  try {
    const res = await read<{ entries: Array<{ key: string; value: TypeDecl }> }>('workspace.query', {
      prefix: '_types/',
      limit: 100,
    });
    typeDecls = {};
    for (const e of res.entries ?? []) typeDecls[e.key.slice('_types/'.length)] = e.value ?? {};
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
  const decl = typeDecls?.[e._meta?.type ?? ''];
  if (decl?.titlePath) {
    const v = pathInto(e.value, decl.titlePath);
    if (typeof v === 'string' && v) return v.slice(0, 80);
  }
  const v = e.value;
  if (typeof v === 'string') return v.slice(0, 80) || e.key;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.title === 'string' && o.title) return o.title.slice(0, 80);
    if (typeof o.name === 'string' && o.name) return o.name.slice(0, 80);
    if (typeof o.content === 'string' && o.content) {
      const line = o.content.match(/^#+\s*(.+)$/m)?.[1] ?? o.content.split('\n').find((l) => l.trim()) ?? '';
      const clean = line.replace(/^[-*]\s*\[[ x]\]\s*/, '').replace(/[#*_`>\\[\]()]/g, '').trim();
      if (clean) return clean.slice(0, 80);
    }
  }
  return e.key;
}

export function hrefOf(e: FactEntry): string | null {
  const decl = typeDecls?.[e._meta?.type ?? ''];
  if (decl?.href) {
    const id = e.key.includes(':') ? e.key.slice(e.key.indexOf(':') + 1) : e.key.includes('/') ? e.key.slice(e.key.indexOf('/') + 1) : e.key;
    return decl.href
      .replace(/\$\{key\}/g, encodeURIComponent(e.key))
      .replace(/\$\{id\}/g, encodeURIComponent(id))
      .replace(/\$\{value\.([A-Za-z0-9_.]+)\}/g, (_, p: string) => String(pathInto(e.value, p) ?? ''));
  }
  // Convention fallbacks (the pre-_types routing).
  const t = e._meta?.type ?? null;
  const v = (e.value ?? {}) as Record<string, unknown>;
  const tags = e._meta?.tags ?? [];
  if (e.key.startsWith('doc:')) return `/@c15r/lit?doc=${encodeURIComponent(e.key.slice(4))}`;
  if (t === 'capture' || e.key.startsWith('inbox/')) {
    return typeof v.captured === 'string' ? `/@c15r/lit?doc=${encodeURIComponent(`log:${v.captured}`)}` : '/@c15r/input';
  }
  if (t === 'cell' && typeof v.address === 'string') return v.address;
  const docTag = tags.find((x) => x.startsWith('doc:'));
  if (docTag) return `/@c15r/lit?doc=${encodeURIComponent(docTag.slice(4))}`;
  const boardTag = tags.find((x) => x.startsWith('canvas:'));
  if (boardTag) return `/@c15r/canvas?canvas=${encodeURIComponent(boardTag.slice(7))}`;
  return null;
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
