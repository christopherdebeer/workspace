/* Session = the kernel's (sign in once, origin-wide; apex-aware). Reference, not
 * copy — provides the interface the ported home client imports from './auth',
 * backed by the kernel. `completeLoginIfReturning` is a complete-without-force
 * wrapper (the kernel only exposes ensureAuth, which forces); gating on `?code`
 * gives the landing for anon instead of redirecting. */
import { login, signOut, ensureAuth, isAuthed, authFetch, cellUrl } from 'https://parc.land/@c15r/kernel/app.js';

export { login, authFetch, isAuthed, cellUrl };

export async function logout(): Promise<void> {
  signOut();
}

export async function completeLoginIfReturning(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('code')) await ensureAuth();
  return isAuthed();
}
