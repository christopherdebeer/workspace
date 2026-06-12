/**
 * Authentication.
 *
 * For HTTP requests the runtime derives identity from a validated
 * `Authorization: Bearer` token: `define-service` invokes the `auth` cell's
 * `validateToken` command and populates `ctx.identity` (see
 * `resolveHttpIdentity`). Client-supplied `x-auth-*` headers are NOT trusted —
 * CloudFront forwards all viewer headers, so trusting them would let any caller
 * spoof identity. For direct service-to-service invokes the caller's identity is
 * carried on the command envelope.
 *
 * `identityFromHeaders` remains for a future trusted-edge authorizer (one that
 * validates the bearer and injects these headers before the cell), but it is not
 * on the HTTP path today.
 */

export interface Identity {
  /** Authenticated principal, e.g. a username. Undefined for anonymous calls. */
  user?: string;
  /** Free-form scopes/roles forwarded by the edge auth layer. */
  scopes: string[];
}

const ANONYMOUS: Identity = { user: undefined, scopes: [] };

function headerValue(
  headers: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  // HTTP headers are case-insensitive; Function URL lowercases them, but be safe.
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct !== undefined) return direct;
  const match = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return match ? headers[match] : undefined;
}

/** Build an Identity from the trusted, edge-normalised request headers. */
export function identityFromHeaders(
  headers: Record<string, string | undefined> | undefined,
): Identity {
  const user = headerValue(headers, 'x-auth-user');
  if (!user) return ANONYMOUS;
  const scopesRaw = headerValue(headers, 'x-auth-scopes');
  const scopes = scopesRaw ? scopesRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { user, scopes };
}

export function requireUser(identity: Identity): string {
  if (!identity.user) {
    throw new ServiceAuthError('Authentication required');
  }
  return identity.user;
}

// ─── the scope grammar (docs/scope-grants.md) ────────────────────
//
// A scope is a `:`-separated pattern over one resource grammar:
//   workspace:<owner>:<keyPrefix|*>:<read|write>   facts
//   cell:<owner>/<name>:<tool|*>                    tools
//   platform:<verb>                                 kernel verbs
// `*` as the final segment matches one-or-more remaining segments (so `a:b:*`
// covers `a:b:c` and `a:b:c:d`, but not `a:b` itself — today's behaviour);
// `*` mid-pattern matches exactly one segment (`workspace:*:read`).

/** Whether `pattern` covers the concrete (or narrower) `scope`. */
export function matchesScope(pattern: string, scope: string): boolean {
  if (pattern === scope) return true;
  const p = pattern.split(':');
  const s = scope.split(':');
  for (let i = 0; i < p.length; i++) {
    const last = i === p.length - 1;
    if (p[i] === '*' && last) return s.length > i; // rest wildcard: ≥1 more segment
    if (i >= s.length) return false;
    if (p[i] !== '*' && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

/**
 * Intersect two scope patterns — the `effective = grants ∩ token` rule's unit.
 * Returns the narrower pattern both cover, or null when they are disjoint.
 * E.g. `workspace:*:read` ∩ `workspace:c15r:inbox/*:*` = `workspace:c15r:read`
 * is NOT a thing — segments align positionally: `a:*:c` ∩ `a:b:*` = `a:b:c`.
 */
export function intersectScopePatterns(a: string, b: string): string | null {
  const segsA = a.split(':');
  const segsB = b.split(':');
  const restA = segsA[segsA.length - 1] === '*' && segsA.length > 0 ? !!segsA.pop() : false;
  const restB = segsB[segsB.length - 1] === '*' && segsB.length > 0 ? !!segsB.pop() : false;
  const out: string[] = [];
  const len = Math.max(segsA.length, segsB.length);
  for (let i = 0; i < len; i++) {
    const inA = i < segsA.length;
    const inB = i < segsB.length;
    if (inA && inB) {
      const sa = segsA[i];
      const sb = segsB[i];
      if (sa === '*') out.push(sb);
      else if (sb === '*' || sa === sb) out.push(sa);
      else return null;
    } else if (inA) {
      if (!restB) return null; // B is exhausted and does not cover deeper
      out.push(segsA[i]);
    } else {
      if (!restA) return null;
      out.push(segsB[i]);
    }
  }
  if (restA && restB) return [...out, '*'].join(':');
  // One side demands ≥1 more segment the other cannot provide → disjoint.
  if (restA !== restB && segsA.length === segsB.length) return null;
  return out.join(':');
}

/**
 * Effective access: the pairwise intersection of two scope sets. A token's
 * scopes are a ceiling over the principal's standing — intersection can only
 * narrow, never widen (docs/scope-grants.md §3).
 */
export function intersectScopes(a: string[], b: string[]): string[] {
  const out = new Set<string>();
  for (const sa of a) {
    for (const sb of b) {
      const meet = intersectScopePatterns(sa, sb);
      if (meet !== null) out.add(meet);
    }
  }
  return [...out];
}

/**
 * Whether the identity holds `scope` (or a broader wildcard parent). A held
 * scope `a:b:*` satisfies a required `a:b:c`; an exact match always satisfies.
 * Pure predicate — use for filtering (e.g. which tools to advertise); use
 * `requireScope` to enforce.
 */
export function hasScope(identity: Identity, scope: string): boolean {
  return identity.scopes.some((held) => matchesScope(held, scope));
}

/**
 * Enforce that the identity carries `scope` (or a broader wildcard parent).
 * Returns the authenticated user.
 */
export function requireScope(identity: Identity, scope: string): string {
  const user = requireUser(identity);
  if (!hasScope(identity, scope)) {
    throw new ServiceAuthError(`Missing required scope: ${scope}`);
  }
  return user;
}

export class ServiceAuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'ServiceAuthError';
  }
}
