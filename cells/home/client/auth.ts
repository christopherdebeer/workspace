/* Session = the kernel's (sign in once, origin-wide; apex-aware). Reference, not
 * copy — provides the interface the ported home client imports from './auth',
 * backed by the kernel. `completeLoginIfReturning` is a complete-without-force
 * wrapper (the kernel only exposes ensureAuth, which forces); gating on `?code`
 * gives the landing for anon instead of redirecting. */
import { login, signOut, ensureAuth, isAuthed, authFetch, cellUrl, accessToken } from 'https://parc.land/@c15r/kernel/app.js';

export { login, authFetch, isAuthed, cellUrl };

/**
 * Re-mirror the access token to the host-only `parc_session` cookie. The kernel
 * mirrors on setTokens (login/refresh), but a token restored from localStorage
 * OUTLIVES the cookie's 1h Max-Age — and a lapsed cookie makes the NEXT
 * top-level navigation SSR the landing page for a signed-in visitor (dispatch
 * sees no credential). Calling this on every boot keeps the server's view of
 * the session as fresh as the client's, so the authed/anonymous fork stays a
 * server-side decision (owner direction 2026-07-10).
 */
export function refreshSessionCookie(): void {
  const t = accessToken();
  if (!t || !location.host.endsWith('.on.parc.land')) return;
  document.cookie = `parc_session=${t}; Secure; SameSite=Lax; Path=/; Max-Age=3600`;
}

export async function logout(): Promise<void> {
  signOut();
}

/** Clear the DISPROVEN session locally — the kernel's signOut is already
 *  navigation-free and server-free (drops the localStorage tokens AND the
 *  `parc_session` cookie mirror). Called when /mcp definitively 401/403s the
 *  stored token: `isAuthed()` then reports false, data reads fall through to
 *  the public @guest path, and the NEXT top-level navigation SSRs the honest
 *  anonymous boot instead of a half-authed one. */
export function localSignOut(): void {
  signOut();
}

export async function completeLoginIfReturning(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('code')) await ensureAuth();
  return isAuthed();
}
