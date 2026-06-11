/**
 * Browser sign-in for the canvas — a public OAuth 2.1 client (PKCE, no
 * secret) against the platform's auth cell, adapted from home's client. The
 * canvas drives the same identity an agent gets over MCP.
 */

const TOKENS_KEY = 'parc.canvas.tokens';
const CLIENT_KEY = 'parc.canvas.client_id';
const PKCE_KEY = 'parc.canvas.pkce_verifier';
const STATE_KEY = 'parc.canvas.oauth_state';
const CANVAS_KEY = 'parc.canvas.return_canvas';

export const DEFAULT_SCOPE = 'workspace:read workspace:write';

interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

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
  } catch { /* storage unavailable */ }
}

export function isAuthed(): boolean {
  return !!getTokens()?.access_token;
}

export function accessToken(): string | null {
  return getTokens()?.access_token ?? null;
}

function redirectUri(): string {
  return `${window.location.origin}${window.location.pathname.replace(/\/+$/, '')}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function ensureClientId(): Promise<string> {
  const cached = localStorage.getItem(CLIENT_KEY);
  if (cached) return cached;
  const res = await fetch('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri()],
      client_name: 'canvas',
      token_endpoint_auth_method: 'none',
    }),
  });
  const j = (await res.json()) as { client_id?: string; error?: string };
  if (!j.client_id) throw new Error(j.error ?? 'Client registration failed');
  localStorage.setItem(CLIENT_KEY, j.client_id);
  return j.client_id;
}

export async function login(scope: string = DEFAULT_SCOPE): Promise<void> {
  const clientId = await ensureClientId();
  const verifier = randomB64url(32);
  const challenge = await sha256b64url(verifier);
  const state = randomB64url(16);
  sessionStorage.setItem(PKCE_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  // Preserve which canvas we were on across the OAuth redirect.
  const canvas = new URLSearchParams(window.location.search).get('canvas');
  if (canvas) sessionStorage.setItem(CANVAS_KEY, canvas);
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

export async function completeLoginIfReturning(): Promise<boolean> {
  const search = new URLSearchParams(window.location.search);
  const code = search.get('code');
  if (!code) return false;
  const returnedState = search.get('state');
  const canvas = sessionStorage.getItem(CANVAS_KEY);
  sessionStorage.removeItem(CANVAS_KEY);
  window.history.replaceState({}, '', window.location.pathname + (canvas ? `?canvas=${encodeURIComponent(canvas)}` : ''));

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

/**
 * Boot gate: finish a returning OAuth redirect, else start sign-in when
 * signed out (never resolves in that case — the page is navigating away).
 */
export async function ensureAuth(): Promise<void> {
  try {
    await completeLoginIfReturning();
  } catch (err) {
    console.warn('[auth] OAuth return failed', err);
  }
  if (!isAuthed()) {
    await login();
    await new Promise<never>(() => undefined); // navigation is taking over
  }
}
