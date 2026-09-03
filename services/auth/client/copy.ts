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
 *
 * BOTH ARE ANCHORED TO `apexOrigin`, and that is the whole point. The
 * redirect_uri is chosen by whoever built the authorize URL, so an unanchored
 * read of it is a headline an attacker writes: `https://evil.example/@c15r/shelved`
 * and `https://c15r-shelved.on.evil.example` both said "Shelved" while the code
 * went somewhere else entirely. Naming nothing is the safe answer — the screen
 * falls back to a plain "Sign in", which claims nothing it cannot support.
 */
export function requesterName(redirectUri?: string, apexOrigin?: string): string | null {
  if (!redirectUri || !apexOrigin) return null;
  let u: URL;
  let apex: URL;
  try {
    u = new URL(redirectUri);
    apex = new URL(apexOrigin);
  } catch {
    return null;
  }
  let name: string | undefined;
  if (u.host === apex.host) {
    // Our own host: the `/@owner/name` route we serve.
    name = u.pathname.match(/^\/@([^/]+)\/([^/]+)/)?.[2];
  } else if (u.host.endsWith(`.on.${apex.host}`)) {
    // A cell host under our cell domain. One label before `.on.`, and the
    // owner is hyphen-free, so split on the first hyphen.
    const label = u.host.slice(0, -`.on.${apex.host}`.length);
    if (!label.includes('.')) {
      const i = label.indexOf('-');
      if (i > 0) name = label.slice(i + 1);
    }
  }
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

/** Who is asking, split by what the server can actually vouch for. */
export type Requester =
  /** A cell on our own origin or cell domain. The name is ours; we serve it. */
  | { kind: 'cell'; name: string }
  /** Our own apex, not a cell surface — the platform itself. */
  | { kind: 'platform'; origin: string }
  /**
   * Anywhere else. The ORIGIN is verified: `/oauth/consent` refuses a
   * redirect_uri the client never registered, so the code can only land there.
   * `claimed` is not verified by anything — registration is open and
   * `client_name` is whatever the registrant typed, so a client calling itself
   * "parc.land" says nothing about whether it is.
   */
  | { kind: 'external'; origin: string; claimed?: string };

/**
 * Decide what the consent screen may present as identity.
 *
 * The rule is that the screen never leads with a string the platform cannot
 * stand behind. A cell we serve gets named. Anything else is introduced by its
 * ORIGIN — the one property the redirect_uri check actually pins — with any
 * self-declared name kept subordinate and marked as such.
 */
export function requesterIdentity(
  redirectUri?: string,
  apexOrigin?: string,
  clientName?: string | null,
): Requester | null {
  const name = requesterName(redirectUri, apexOrigin);
  if (name) return { kind: 'cell', name };
  if (!redirectUri) return null;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return null;
  }
  let apexHost: string | null = null;
  try {
    apexHost = apexOrigin ? new URL(apexOrigin).host : null;
  } catch {
    apexHost = null;
  }
  if (apexHost && (u.host === apexHost || u.host.endsWith(`.on.${apexHost}`))) {
    return { kind: 'platform', origin: u.host };
  }
  return { kind: 'external', origin: u.host, ...(clientName ? { claimed: clientName } : {}) };
}
