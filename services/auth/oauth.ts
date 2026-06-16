/**
 * OAuth 2.1 handlers — RFC 9728 (PRM), RFC 8414 (ASM), RFC 7591 (DCR),
 * consent, token (authorization_code + refresh + PKCE S256), and the device
 * authorization grant. Ported from c15r/mcp-auth/oauth.ts onto the platform's
 * `ServiceHttpRequest` and a storage-agnostic `AuthStore`.
 */
import type { ServiceHttpRequest, ServiceHttpResponse } from '../../platform/runtime';
import { intersectScopes } from '../../platform/runtime';
import { AuthStore, generateToken, sha256, DEVICE_TTL_MS, REFRESH_TTL_MS } from './store';

/**
 * A cell-host redirect (`https://<owner>-<name>.<cellDomain>/…`) means the token
 * is for a host-isolated cell acting AS the user (model A,
 * docs/cell-origin-isolation.md §4.5). Cap it to `workspace:read/write` + the
 * cell's own tools — never `platform:*` / cell-creation / other cells. Returns
 * the ceiling, or null when the redirect is not a cell host. (Per-key-prefix
 * bounding is a v2 once the substrate enforces write scopes — today per-slice
 * writes are ownership-gated.)
 */
function cellCeiling(redirectUri: string | undefined): string[] | null {
  const suffix = process.env.CELL_DOMAIN_SUFFIX; // e.g. ".on.parc.land"
  if (!suffix || !redirectUri) return null;
  let host: string;
  try {
    host = new URL(redirectUri).host;
  } catch {
    return null;
  }
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  const i = label.indexOf('-');
  if (i <= 0) return null;
  return ['workspace:read', 'workspace:write', `cell:${label.slice(0, i)}/${label.slice(i + 1)}:*`];
}

export interface OAuthConfig {
  serverName: string;
  serverDescription?: string;
  docsUrl?: string;
  scopesSupported: string[];
  /** positive = lifetime seconds; 0/negative = non-expiring (no refresh). */
  tokenExpirySecs?: number;
  /**
   * Refresh-token lifetime (seconds). Independent of (and longer than) the
   * access token's — short access + long refresh is how MCP clients stay
   * connected. Defaults to `REFRESH_TTL_MS`.
   */
  refreshExpirySecs?: number;
  /** Usernames allowed to be granted admin-scoped permissions. */
  adminUsernames?: string[];
  /** Scope prefixes (e.g. "platform:") grantable only to `adminUsernames`. */
  adminScopePrefixes?: string[];
}

function isAdminScope(scope: string, prefixes: string[]): boolean {
  return prefixes.some((p) => scope === p || scope.startsWith(p));
}

/** Scopes a given user is permitted to grant (admin scopes gated to admins). */
export function grantableScopes(config: OAuthConfig, username: string): string[] {
  const isAdmin = (config.adminUsernames ?? []).includes(username);
  const prefixes = config.adminScopePrefixes ?? [];
  return config.scopesSupported.filter((s) => isAdmin || !isAdminScope(s, prefixes));
}

/**
 * Scope catalog — capability metadata for the consent screen (docs/capability-consent.md).
 * Grouping by `verb` makes the consent screen legible and surfaces the Σ-calculus
 * read/write distinction: reads are disclosure (monotone, low-risk), writes/admin
 * are consequential. Unknown/granular scopes (Phase 2) infer their verb from the
 * scope shape, so new capabilities group sensibly without a catalog entry.
 */
export interface ScopeMeta {
  verb: 'read' | 'write' | 'admin';
  title: string;
  description: string;
}
const SCOPE_CATALOG: Record<string, ScopeMeta> = {
  'workspace:read': { verb: 'read', title: 'Read your workspace', description: 'See your facts, links, views, and activity.' },
  'workspace:write': { verb: 'write', title: 'Write to your workspace', description: 'Create, edit, link, and retire facts in your slice.' },
  'workspace:admin': { verb: 'admin', title: 'Administer the workspace', description: 'Manage sharing and grant requests.' },
  'platform:cells:create': { verb: 'write', title: 'Create cells', description: 'Provision and deploy dynamic cells on your behalf.' },
  'platform:*': { verb: 'admin', title: 'Full platform control', description: 'Unrestricted admin across the platform.' },
  // Granular vocabulary (docs/capability-consent.md).
  'read:workspace': { verb: 'read', title: 'Read your workspace', description: 'See your facts, links, views, and activity.' },
  'write:workspace': { verb: 'write', title: 'Write to your workspace', description: 'Create, edit, link, and retire facts in your slice.' },
  'cells:create': { verb: 'write', title: 'Create cells', description: 'Provision and deploy dynamic cells on your behalf.' },
};
export function scopeMeta(scope: string): ScopeMeta {
  const known = SCOPE_CATALOG[scope];
  if (known) return known;
  const verb: ScopeMeta['verb'] =
    /(:admin$|^platform:\*$|^auth:)/.test(scope) ? 'admin'
    : /(^write:|:write$|^act:|:create$|^cells:)/.test(scope) ? 'write'
    : 'read';
  return { verb, title: scope, description: '' };
}

const DEFAULT_EXPIRY = 3600;
const DEFAULT_REFRESH_EXPIRY = REFRESH_TTL_MS / 1000;
const NO_STORE = { 'cache-control': 'no-store' };

/**
 * The browser-navigation session cookie. Carries the same opaque access token
 * the client also holds in localStorage, but as an httpOnly cookie so SSR/
 * navigation requests (which never send the Authorization header) can be
 * identified at the `dispatch` tier. `SameSite=Lax` means it rides top-level GET
 * navigations (what SSR needs) but NOT cross-site POSTs, and the runtime only
 * honours it on safe methods — so it can never authorize a mutation (no CSRF).
 */
const SESSION_COOKIE = 'parc_session';
function sessionCookie(token: string, maxAgeSecs: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSecs))}`;
}
function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
function okWithCookies(body: unknown, cookies: string[], status = 200): ServiceHttpResponse {
  return { statusCode: status, headers: NO_STORE, body, cookies };
}

function originOf(req: ServiceHttpRequest): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function ok(body: unknown, status = 200): ServiceHttpResponse {
  return { statusCode: status, headers: NO_STORE, body };
}

// ─── Discovery ───────────────────────────────────────────────────

export function handlePRM(req: ServiceHttpRequest, config: OAuthConfig): ServiceHttpResponse {
  const origin = originOf(req);
  return ok({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    resource_documentation: config.docsUrl ?? origin,
  });
}

export function handleASMetadata(req: ServiceHttpRequest, config: OAuthConfig): ServiceHttpResponse {
  const origin = originOf(req);
  return ok({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: config.scopesSupported,
    device_authorization_endpoint: `${origin}/auth/device`,
    revocation_endpoint: `${origin}/oauth/revoke`,
  });
}

// ─── Dynamic Client Registration ─────────────────────────────────

export async function handleDCR(req: ServiceHttpRequest, store: AuthStore): Promise<ServiceHttpResponse> {
  const body = req.json<{ redirect_uris?: string[]; client_name?: string; token_endpoint_auth_method?: string }>();
  const redirectUris = body.redirect_uris;
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return ok({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' }, 400);
  }
  const clientId = generateToken('client');
  const clientSecret = body.token_endpoint_auth_method === 'none' ? undefined : generateToken('secret');
  await store.saveOAuthClient({ clientId, clientSecret, redirectUris, clientName: body.client_name ?? null });
  return ok(
    {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      client_name: body.client_name ?? null,
      token_endpoint_auth_method: clientSecret ? 'client_secret_post' : 'none',
    },
    201,
  );
}

// ─── Consent ─────────────────────────────────────────────────────

interface ConsentBody {
  sessionId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  scope?: string;
  state?: string;
  resource?: string;
}

export async function handleConsent(
  req: ServiceHttpRequest,
  store: AuthStore,
  config: OAuthConfig,
): Promise<ServiceHttpResponse> {
  const b = req.json<ConsentBody>();
  const session = await store.validateSession(b.sessionId);
  if (!session) return ok({ error: 'Invalid or expired session' }, 401);
  if (session.scope !== 'consent') return ok({ error: 'Session not authorized for consent' }, 403);

  // Authoritative scope gating: keep only scopes this user may actually grant
  // (admin scopes require an admin username), regardless of what the page sent.
  const user = await store.getUserById(session.userId);
  const allowed = new Set(grantableScopes(config, user?.username ?? ''));
  const requested = (b.scope ?? '').split(/\s+/).filter(Boolean);
  const granted = requested.filter((s) => allowed.has(s)).join(' ');

  const code = generateToken('authz');
  await store.saveAuthCode({
    code,
    clientId: b.clientId,
    userId: session.userId,
    redirectUri: b.redirectUri,
    codeChallenge: b.codeChallenge,
    codeChallengeMethod: b.codeChallengeMethod ?? 'S256',
    scope: granted || undefined,
    resource: b.resource,
  });
  await store.deleteSession(b.sessionId);

  const redirect = new URL(b.redirectUri);
  redirect.searchParams.set('code', code);
  if (b.state) redirect.searchParams.set('state', b.state);
  return ok({ redirect: redirect.toString() });
}

/** After sign-in, the consent UI asks which scopes this user may grant. */
export async function handleGrantableScopes(
  req: ServiceHttpRequest,
  store: AuthStore,
  config: OAuthConfig,
): Promise<ServiceHttpResponse> {
  const { sessionId, clientId } = req.json<{ sessionId: string; clientId?: string }>();
  const session = await store.validateSession(sessionId);
  if (!session) return ok({ error: 'Invalid or expired session' }, 401);
  const user = await store.getUserById(session.userId);
  const scopes = grantableScopes(config, user?.username ?? '');
  // Capability metadata so the consent screen can group + label scopes.
  const catalog = Object.fromEntries(scopes.map((s) => [s, scopeMeta(s)]));
  // The client's human name (from DCR) so consent shows "parc.land", not a UUID.
  const client = clientId ? await store.getOAuthClient(clientId) : null;
  return ok({ username: user?.username ?? null, scopes, catalog, clientName: client?.clientName ?? null });
}

// ─── Token endpoint ──────────────────────────────────────────────

function parseTokenBody(req: ServiceHttpRequest): Record<string, string> {
  const ct = req.headers['content-type'] ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(req.text()));
  }
  return req.json<Record<string, string>>();
}

export async function handleToken(req: ServiceHttpRequest, store: AuthStore, config: OAuthConfig): Promise<ServiceHttpResponse> {
  const body = parseTokenBody(req);
  console.log('[oauth] token: request', { grant_type: body.grant_type, hasVerifier: !!body.code_verifier, hasSecret: !!body.client_secret });
  const configuredExpiry = config.tokenExpirySecs ?? DEFAULT_EXPIRY;
  const refreshExpiry = config.refreshExpirySecs ?? DEFAULT_REFRESH_EXPIRY;
  const neverExpires = configuredExpiry <= 0;
  const mintExpiry = neverExpires ? undefined : configuredExpiry;

  if (body.grant_type === 'authorization_code') {
    const { code, redirect_uri, code_verifier, client_id } = body;
    if (!code || !redirect_uri || !code_verifier) {
      return ok({ error: 'invalid_request', error_description: 'code, redirect_uri, code_verifier required' }, 400);
    }
    const authCode = await store.consumeAuthCode(code);
    if (!authCode) {
      console.warn('[oauth] token: invalid/expired/used code');
      return ok({ error: 'invalid_grant', error_description: 'Invalid, expired, or already-used code' }, 400);
    }
    if (authCode.redirectUri !== redirect_uri) {
      console.warn('[oauth] token: redirect_uri mismatch', { codeRedirect: authCode.redirectUri, given: redirect_uri });
      return ok({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
    }
    if (client_id && authCode.clientId !== client_id) {
      console.warn('[oauth] token: client_id mismatch', { codeClient: authCode.clientId, given: client_id });
      return ok({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
    }
    if (sha256(code_verifier) !== authCode.codeChallenge) {
      console.warn('[oauth] token: PKCE verification failed');
      return ok({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }

    const scope = authCode.scope ?? config.scopesSupported[0] ?? 'read';
    // Cap to the cell ceiling when this token is for a host-isolated cell (model A).
    const ceiling = cellCeiling(authCode.redirectUri);
    const effectiveScope = ceiling ? intersectScopes(scope.split(/\s+/).filter(Boolean), ceiling).join(' ') : scope;
    const result = await store.mintToken({
      userId: authCode.userId,
      scope: effectiveScope,
      label: `OAuth: ${authCode.clientId}`,
      clientId: authCode.clientId,
      expiresInSec: mintExpiry,
      withRefresh: !neverExpires,
      refreshExpiresInSec: refreshExpiry,
    });
    console.log('[oauth] token: issued', { clientId: authCode.clientId, scope: effectiveScope, capped: !!ceiling, resource: authCode.resource });
    const response: Record<string, unknown> = { access_token: result.token, token_type: 'Bearer', scope: effectiveScope };
    if (!neverExpires) {
      response.expires_in = configuredExpiry;
      response.refresh_token = result.refreshToken;
    }
    // Also set the httpOnly navigation cookie so SSR/page loads are identified.
    const cookieMaxAge = neverExpires ? 30 * 24 * 3600 : configuredExpiry;
    return okWithCookies(response, [sessionCookie(result.token, cookieMaxAge)]);
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) return ok({ error: 'invalid_request' }, 400);
    if (neverExpires) return ok({ error: 'unsupported_grant_type', error_description: 'Tokens are non-expiring' }, 400);
    const result = await store.refreshUnifiedToken(sha256(body.refresh_token), configuredExpiry, refreshExpiry);
    if (!result) return ok({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' }, 400);
    // Refresh keeps the navigation cookie current (the access token rotated).
    return okWithCookies(
      { access_token: result.token, token_type: 'Bearer', expires_in: configuredExpiry, refresh_token: result.refreshToken },
      [sessionCookie(result.token, configuredExpiry)],
    );
  }

  if (body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
    if (!body.device_code) return ok({ error: 'invalid_request' }, 400);
    const dc = await store.getDeviceCode(body.device_code);
    if (!dc) return ok({ error: 'invalid_grant' }, 400);
    if (dc.status === 'pending') return ok({ error: 'authorization_pending' }, 400);
    if (dc.status === 'denied') return ok({ error: 'access_denied' }, 400);
    const consumed = await store.consumeDeviceCode(body.device_code);
    if (!consumed) return ok({ error: 'expired_token' }, 400);
    const result = await store.mintToken({
      userId: consumed.approvedBy,
      scope: consumed.scope,
      label: 'device',
      expiresInSec: mintExpiry,
      withRefresh: !neverExpires,
      refreshExpiresInSec: refreshExpiry,
    });
    const response: Record<string, unknown> = { access_token: result.token, token_type: 'Bearer', scope: consumed.scope };
    if (!neverExpires) {
      response.expires_in = configuredExpiry;
      response.refresh_token = result.refreshToken;
    }
    return ok(response);
  }

  return ok({ error: 'unsupported_grant_type' }, 400);
}

// ─── Revocation (RFC 7009) ───────────────────────────────────────

/**
 * RFC 7009 token revocation. The presented token is itself the credential, so
 * this needs no separate auth; per spec it returns 200 regardless of whether
 * the token existed (so callers can't probe validity). Accepts either an access
 * or a refresh token; revoking one invalidates its pair.
 */
export async function handleRevoke(req: ServiceHttpRequest, store: AuthStore): Promise<ServiceHttpResponse> {
  const body = parseTokenBody(req);
  if (body.token) await store.revokeByTokenValue(body.token);
  // Drop the navigation cookie too, so sign-out clears the SSR session.
  return okWithCookies({}, [clearSessionCookie()]);
}

// ─── Device authorization grant ──────────────────────────────────

export async function handleDeviceInit(req: ServiceHttpRequest, store: AuthStore): Promise<ServiceHttpResponse> {
  const body = req.json<{ scope?: string; client_id?: string }>();
  const scope = body.scope ?? 'read';
  const { deviceCode, userCode } = await store.createDeviceCode(scope, body.client_id);
  const origin = originOf(req);
  return ok({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${origin}/auth/device`,
    verification_uri_complete: `${origin}/auth/device?user_code=${encodeURIComponent(userCode)}`,
    expires_in: Math.floor(DEVICE_TTL_MS / 1000),
    interval: 5,
  });
}

export async function handleDeviceApprove(req: ServiceHttpRequest, store: AuthStore): Promise<ServiceHttpResponse> {
  const b = req.json<{ sessionId: string; user_code: string }>();
  const session = await store.validateSession(b.sessionId);
  if (!session) return ok({ error: 'Invalid or expired session' }, 401);
  const dc = await store.getDeviceCodeByUserCode(b.user_code);
  if (!dc) return ok({ error: 'Unknown or expired user code' }, 400);
  const approved = await store.approveDeviceCode(dc.deviceCode, session.userId);
  await store.deleteSession(b.sessionId);
  return approved ? ok({ approved: true }) : ok({ error: 'Could not approve (already handled?)' }, 409);
}

// ─── Token validation (used by the edge / peer services) ─────────

export interface ValidatedToken {
  userId: string;
  scope: string;
  clientId: string | null;
}

export async function validateBearer(token: string, store: AuthStore): Promise<ValidatedToken | null> {
  const tok = await store.validateTokenByHash(sha256(token));
  if (!tok) return null;
  // The principal exposed to cells is the human **username**, so scopes, cell
  // ownership, dispatch addresses (`@<username>/<cell>`) and S3 prefixes are all
  // readable. The stable account id (`mintedBy`/UUID) stays the durable anchor for
  // credentials + token management; resolve it to the handle here. Falls back to
  // `mintedBy` when the account can't be resolved (e.g. a token minted by handle).
  const account = await store.getUserById(tok.mintedBy);
  return { userId: account?.username ?? tok.mintedBy, scope: tok.scope, clientId: tok.clientId };
}
