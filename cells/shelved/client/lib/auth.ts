/** parc.land owns the session: one sign-in, shared across cells.
 *
 *  Shelved signs in for IDENTITY ONLY (`cell:c15r/shelved:*`), not the kernel's
 *  default `workspace:read workspace:write`. Every book, request and address it
 *  holds lives in its own table keyed by the caller the platform stamps on each
 *  call (`x-cell-caller`); it never reads or writes the workspace slice, so
 *  asking for it granted a reader full read+write over everything in their
 *  workspace to look at a shelf.
 *
 *  And because the ask is one line, it fits in a sheet: `loginSheet` runs the
 *  same consent screen as parc.land's own document in an iframe over this page,
 *  so a reader signs in without the shelf unmounting and rebuilding around
 *  them. See docs/auth-in-page.md. */
import { ensureAuth, isAuthed, loginSheet, signOut } from 'https://parc.land/@c15r/kernel/app.js';

export { isAuthed, signOut };

/** Resolves true when the reader signed in, false when they dismissed it. */
export const login = (): Promise<boolean> => loginSheet({ identity: true });

export async function logout(): Promise<void> {
  await Promise.resolve(signOut());
  location.replace(location.origin + location.pathname);
}

/** Complete OAuth only when returning with a code; anonymous visitors stay on
 *  discovery. Still needed: the sheet is the normal route, but a fallback to
 *  the full-page redirect still comes back through a navigation. */
export async function completeLoginIfReturning(): Promise<boolean> {
  if (new URLSearchParams(location.search).has('code')) await ensureAuth({ identity: true });
  return isAuthed();
}
