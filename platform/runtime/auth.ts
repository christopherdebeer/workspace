/**
 * Authentication normalisation.
 *
 * CloudFront (and the inline auth Lambda in front of it) is responsible for
 * verifying credentials and normalising them into trusted headers before a
 * request reaches a service cell. The runtime simply reads those headers; it
 * never re-implements credential verification. For direct service-to-service
 * invokes the caller's identity is carried on the command envelope.
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

export class ServiceAuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'ServiceAuthError';
  }
}
