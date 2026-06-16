/** Session = the kernel's (sign in once, origin-wide; apex-aware /mcp + /oauth).
 *  Reference, not copy — canvas previously kept its own copy, which drifted
 *  (per-cell tokens, relative shell paths that broke on the cell origin). */
export {
  ensureAuth,
  isAuthed,
  accessToken,
  authFetch,
  login,
  signOut,
  requestScopes,
} from 'https://parc.land/@c15r/kernel/app.js';
