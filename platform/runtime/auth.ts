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

/**
 * Enforce that the identity carries `scope` (or a broader wildcard parent).
 * A held scope `a:b:*` satisfies a required `a:b:c`; an exact match always
 * satisfies. Returns the authenticated user.
 */
export function requireScope(identity: Identity, scope: string): string {
  const user = requireUser(identity);
  const ok = identity.scopes.some((held) => {
    if (held === scope) return true;
    if (held.endsWith(':*')) return scope.startsWith(held.slice(0, -1));
    return false;
  });
  if (!ok) {
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
