/** parc.land owns the session: one sign-in, shared across cells. */
import { ensureAuth, isAuthed, login, signOut } from 'https://parc.land/@c15r/kernel/app.js';

export { isAuthed, login, signOut };

export async function logout(): Promise<void> {
  await Promise.resolve(signOut());
  location.replace(location.origin + location.pathname);
}

/** Complete OAuth only when returning with a code; anonymous visitors stay on discovery. */
export async function completeLoginIfReturning(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('code')) await ensureAuth();
  return isAuthed();
}
