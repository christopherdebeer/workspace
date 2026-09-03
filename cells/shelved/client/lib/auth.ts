/** parc.land owns the session: one sign-in, shared across cells.
 *
 *  Shelved signs in for IDENTITY ONLY (`cell:c15r/shelved:*`), not the kernel's
 *  default `workspace:read workspace:write`. Every book, request and address it
 *  holds lives in its own table keyed by the caller the platform stamps on each
 *  call (`x-cell-caller`); it never reads or writes the workspace slice, so
 *  asking for it granted a reader full read+write over everything in their
 *  workspace to look at a shelf. See docs/auth-in-page.md. */
import { ensureAuth, isAuthed, login as kernelLogin, signOut } from 'https://parc.land/@c15r/kernel/app.js';

export { isAuthed, signOut };

export const login = (): Promise<never> => kernelLogin({ identity: true });

export async function logout(): Promise<void> {
  await Promise.resolve(signOut());
  location.replace(location.origin + location.pathname);
}

/** Complete OAuth only when returning with a code; anonymous visitors stay on discovery. */
export async function completeLoginIfReturning(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('code')) await ensureAuth({ identity: true });
  return isAuthed();
}
