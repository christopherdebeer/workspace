/**
 * The words the authorize screen says, separated from the React tree that says
 * them — `main.tsx` mounts at module scope, so nothing there can be imported
 * and asserted on. These decide the headline of every sign-in and the sentence
 * shown when one fails, which is worth pinning.
 */

/**
 * What the person thinks they are signing in to, from the redirect_uri.
 *
 * The server sends `resource.address` too, but only from `/auth/grantable` —
 * i.e. AFTER the passkey. The first screen is the one that has to say what
 * this is for, so it parses the same two shapes `cellFromRedirect` does:
 * a cell host (`<owner>-<name>.on.parc.land`) and an apex path (`/@owner/name`).
 */
export function requesterName(redirectUri?: string): string | null {
  if (!redirectUri) return null;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return null;
  }
  const host = u.host.match(/^([^.-]+)-([^.]+)\.on\./);
  const path = u.pathname.match(/^\/@([^/]+)\/([^/]+)/);
  const name = host?.[2] ?? path?.[2];
  if (!name) return null;
  const pretty = decodeURIComponent(name).replace(/[-_]+/g, ' ');
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

/**
 * A sentence for the person, for the handful of failures they can actually do
 * something about. Everything else keeps its own words.
 *
 * The raw strings are deliberately diagnostic — the WebAuthn handlers append
 * `expectedRPID=…, allowedOrigins=…, requestOrigin=…` precisely so a broken
 * deployment is debuggable — which is right for the log and wrong as the only
 * thing a reader is shown. So it is a translation, not a replacement: the
 * original stays one disclosure away.
 */
export function friendlyError(raw: string): { message: string; detail?: string } {
  const r = raw.toLowerCase();
  if (r.includes('notallowederror') || r.includes('timed out or was not allowed') || r.includes('aborterror')) {
    return { message: 'That was cancelled, or the passkey prompt timed out. You can try again.', detail: raw };
  }
  if (r.includes('unknown credential') || r.includes('no server record')) {
    return { message: 'That passkey is not registered here yet. Create an account instead.', detail: raw };
  }
  if (r.includes('already') && r.includes('regist')) {
    return { message: 'That username is taken. Try signing in, or pick another.', detail: raw };
  }
  if (r.includes('username required')) return { message: 'Pick a username first.' };
  if (r.includes('failed to fetch') || r.includes('networkerror')) {
    return { message: 'Could not reach parc.land. Check your connection and try again.', detail: raw };
  }
  if (r.includes('not supported') || r.includes('notsupportederror')) {
    return { message: 'This browser will not run the passkey prompt here. Try opening the page directly.', detail: raw };
  }
  return { message: raw };
}
