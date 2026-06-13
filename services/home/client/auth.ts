/**
 * First-party browser sign-in for the home SPA.
 *
 * Makes `home` a public OAuth 2.1 client (PKCE, no secret) against the platform's
 * own `auth` cell — the *human projection* of the substrate: a person drives the
 * same identity an agent gets over MCP, through a passkey sign-in rather than a
 * pasted token. The whole interactive flow (passkey + scope consent) is handled
 * by the auth cell's `/oauth/authorize` page; this module just initiates it,
 * completes the code exchange on return, and attaches the bearer to fetches —
 * refreshing transparently (the refresh token now outlives the access token).
 *
 * Session storage is the kernel's shared `parc.session.*` namespace — the SAME
 * keys `@c15r/kernel` (and so lit/canvas/input) use — so signing in on any
 * surface signs you in on home, and vice versa ("sign in once, origin-wide").
 * The token shape is a superset of the kernel's, so either can read the other's.
 *
 * No backend change: it uses the existing DCR, authorize, token, and revoke
 * endpoints. Tokens live in localStorage (a public-client trade-off); revoke on
 * sign-out so a discarded token is dead server-side too.
 */

// The session itself lives under the kernel's origin-wide namespace
// (`parc.session.tokens`, cells/kernel/client/main.ts) so every surface — home
// and the kernel cells — shares ONE sign-in. The OAuth *client* registration and
// the transient per-flow state stay home-local: home registers its own client
// (its redirect_uri is the origin root `/`, distinct from the cells' path
// redirects), so sharing those keys would cross-wire the authorize flow.
const TOKENS_KEY = 'parc.session.tokens';
const CLIENT_KEY = 'parc.client_id';
const PKCE_KEY = 'parc.pkce_verifier';
const STATE_KEY = 'parc.oauth_state';

// One-time adoption of home's pre-kernel token key, so an existing home-only
// sign-in surfaces into the shared session instead of being orphaned. The
// client registration key is unchanged, so nothing re-registers. Runs at import.
function migrateLegacyTokens(): void {
  try {
    if (!localStorage.getItem(TOKENS_KEY)) {
      const legacy = localStorage.getItem('parc.tokens');
      if (legacy) localStorage.setItem(TOKENS_KEY, legacy);
    }
    localStorage.removeItem('parc.tokens');
  } catch {
    /* storage unavailable */
  }
}

/** Scopes the web app asks for; the consent picker shows only what the user may grant. */
export const DEFAULT_SCOPE = 'workspace:read workspace:write platform:cells:create';

interface Tokens {
  access_token: string;
  refresh_token?: string;
  /** epoch ms when the access token expires, if it does */
  expires_at?: number;
  /** granted scopes — kept so the kernel's grantedScopes() reads our token too */
  scope?: string;
}

// ── small crypto/encoding helpers (Web Crypto) ─────────────────────

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomB64url(nBytes: number): string {
  const bytes = new Uint8Array(nBytes);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

async function sha256b64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return b64url(new Uint8Array(digest));
}

migrateLegacyTokens();

// ── token storage ──────────────────────────────────────────────────

export function getTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

function setTokens(t: Tokens | null): void {
  try {
    if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    /* storage unavailable — sign-in just won't persist */
  }
}

export function isAuthed(): boolean {
  return !!getTokens()?.access_token;
}

function redirectUri(): string {
  return `${window.location.origin}/`;
}

// ── OAuth flow ──────────────────────────────────────────────────────

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Dynamic Client Registration, cached — a public client bound to this origin. */
async function ensureClientId(): Promise<string> {
  const cached = localStorage.getItem(CLIENT_KEY);
  if (cached) return cached;
  const res = await fetch('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri()],
      client_name: 'workspace web',
      token_endpoint_auth_method: 'none',
    }),
  });
  const j = (await res.json()) as { client_id?: string; error?: string };
  if (!j.client_id) throw new Error(j.error ?? 'Client registration failed');
  localStorage.setItem(CLIENT_KEY, j.client_id);
  return j.client_id;
}

/** Begin sign-in: PKCE + redirect to the auth cell's authorize page. */
export async function login(scope: string = DEFAULT_SCOPE): Promise<void> {
  const clientId = await ensureClientId();
  const verifier = randomB64url(32);
  const challenge = await sha256b64url(verifier);
  const state = randomB64url(16);
  sessionStorage.setItem(PKCE_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const u = new URL('/oauth/authorize', window.location.origin);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('scope', scope);
  u.searchParams.set('state', state);
  window.location.assign(u.toString());
}

/**
 * If the page was loaded as the OAuth redirect (`?code=…`), exchange the code for
 * tokens. Returns true if a sign-in was completed. Always strips the query.
 */
export async function completeLoginIfReturning(): Promise<boolean> {
  const search = new URLSearchParams(window.location.search);
  const code = search.get('code');
  if (!code) return false;
  const returnedState = search.get('state');
  // Clean the URL regardless of outcome, so a refresh can't replay the code.
  window.history.replaceState({}, '', window.location.pathname);

  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  if (!expectedState || returnedState !== expectedState) throw new Error('OAuth state mismatch');
  if (!verifier) throw new Error('Missing PKCE verifier');
  const clientId = localStorage.getItem(CLIENT_KEY);
  if (!clientId) throw new Error('Missing client registration');

  const res = await fetch('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
      client_id: clientId,
    }),
  });
  const j = (await res.json()) as TokenResponse;
  if (!j.access_token) throw new Error(j.error_description ?? j.error ?? 'Token exchange failed');
  setTokens({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    scope: j.scope,
  });
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
  const j = (await res.json()) as TokenResponse;
  if (!j.access_token) {
    setTokens(null);
    return false;
  }
  setTokens({
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? t.refresh_token,
    expires_at: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined,
    scope: j.scope ?? t.scope,
  });
  return true;
}

/** fetch() with the session bearer attached, refreshing once on a 401. */
export async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const run = async (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const t = getTokens();
    if (t?.access_token) headers.set('authorization', `Bearer ${t.access_token}`);
    return fetch(path, { ...init, headers });
  };
  let res = await run();
  if (res.status === 401 && getTokens()?.refresh_token) {
    if (await refresh()) res = await run();
  }
  return res;
}

/** Revoke the access token (RFC 7009) and clear local session. */
export async function logout(): Promise<void> {
  const t = getTokens();
  if (t?.access_token) {
    try {
      await fetch('/oauth/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: t.access_token }),
      });
    } catch {
      /* best-effort */
    }
  }
  setTokens(null);
}
