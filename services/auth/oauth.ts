/**
 * OAuth 2.1 handlers — RFC 9728 (PRM), RFC 8414 (ASM), RFC 7591 (DCR),
 * consent, token (authorization_code + refresh + PKCE S256), the device
 * authorization grant, and RFC 8693 token exchange (ADR-0024 delegation).
 * Ported from c15r/mcp-auth/oauth.ts onto the platform's
 * `ServiceHttpRequest` and a storage-agnostic `AuthStore`.
 */
import type { ServiceHttpRequest, ServiceHttpResponse } from '../../platform/runtime';
import { intersectScopes } from '../../platform/runtime';
import {
  AuthStore,
  TokenPosture,
  generateToken,
  sha256,
  DEVICE_TTL_MS,
  REFRESH_TTL_MS,
  MAX_DELEGATION_DEPTH,
  chainDepth,
  chainActors,
  type ActClaim,
  type OAuthClient,
} from './store';

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

/**
 * The cell a sign-in originates at, derived from the redirect_uri — so consent can
 * name the *cell* ("Authorize @c15r/machine") rather than only the shared client.
 * Handles both forms: a host-isolated cell host (`<name>-<owner>.on.parc.land`) and
 * an apex path (`/@<owner>/<name>/…`). Returns null for a plain platform redirect.
 */
function cellFromRedirect(redirectUri: string | undefined): { owner: string; name: string; address: string } | null {
  if (!redirectUri) return null;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return null;
  }
  const suffix = process.env.CELL_DOMAIN_SUFFIX; // e.g. ".on.parc.land"
  if (suffix && u.host.endsWith(suffix)) {
    const label = u.host.slice(0, -suffix.length);
    const i = label.indexOf('-');
    if (i > 0) {
      const owner = label.slice(0, i);
      const name = label.slice(i + 1);
      return { owner, name, address: `@${owner}/${name}` };
    }
  }
  const m = u.pathname.match(/^\/@([^/]+)\/([^/]+)/);
  if (m) return { owner: m[1], name: m[2], address: `@${m[1]}/${m[2]}` };
  return null;
}

/** A stable, readable actor handle from a registered client name ("Claude" → "claude"). */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The delegation actor a code-flow token should carry (ADR-0024), decided by
 * where its redirect goes:
 *   - same origin as the AS → the platform's own SPA — the human driving a
 *     first-party surface. No actor: the token IS the user, writes stamp them.
 *   - a cell host (model A, host-isolated) → software acting as the user —
 *     actor `cell:<owner>/<name>`.
 *   - any foreign origin (claude.ai, chatgpt.com, a CLI callback, …) → a
 *     connected client acting on the user's behalf — actor `client:<name>`.
 * The chain is PROVENANCE only: the subject stays the consenting human, every
 * scope check is unchanged — but facts written through Claude vs ChatGPT now
 * stamp differently instead of re-flattening to the user.
 */
export function delegationActorForRedirect(
  redirectUri: string | undefined,
  asOrigin: string,
  clientName: string | null,
  clientId: string,
): string | null {
  if (!redirectUri) return null;
  let u: URL;
  try {
    u = new URL(redirectUri);
  } catch {
    return null;
  }
  if (`${u.protocol}//${u.host}` === asOrigin) return null; // first-party SPA — the human themselves
  const cell = cellFromRedirect(redirectUri);
  if (cell) return `cell:${cell.owner}/${cell.name}`;
  return `client:${clientName ? slugify(clientName) : clientId}`;
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
  // Granular per-type scopes (ADR-0023): render legibly so the consent screen
  // shows "Write \"note\" facts", not the raw `write:type:note`.
  const typed = /^(read|write):type:([^:]+)$/.exec(scope);
  if (typed) {
    const verb = typed[1] as 'read' | 'write';
    const t = typed[2];
    return verb === 'read'
      ? { verb, title: `Read "${t}" facts`, description: `See only facts of type "${t}" in your slice.` }
      : { verb, title: `Write "${t}" facts`, description: `Create, edit, and retire only facts of type "${t}" in your slice.` };
  }
  // A cell sign-in (docs/cell-origin-isolation.md §4.5). Named plainly, because
  // what it actually does is unusually small and the consent screen saying
  // `cell:c15r/drive:*` tells a player nothing about that.
  const cell = /^cell:([^/:]+)\/([^/:]+):([^:]+)$/.exec(scope);
  if (cell) {
    const addr = `@${cell[1]}/${cell[2]}`;
    return {
      verb: 'read',
      title: `Sign in to ${addr}`,
      description: `Let ${addr} know who you are. It learns your username — nothing in your workspace.`,
    };
  }
  const verb: ScopeMeta['verb'] =
    /(:admin$|^platform:\*$|^auth:)/.test(scope) ? 'admin'
    : /(^write:|:write$|^act:|:create$|^cells:)/.test(scope) ? 'write'
    : 'read';
  return { verb, title: scope, description: '' };
}

/**
 * A granular per-type scope the workspace OWNER may always grant over their own
 * slice — `read:type:<T>` / `write:type:<T>` (ADR-0023). These are *requested* by a
 * client (open-ended in `<T>`), so they can't live in the static `scopesSupported`;
 * instead the consent flow admits a requested one into the offer because the
 * authenticated owner is inherently entitled to grant it (and the workspace handler
 * still enforces the concrete type per `enforceTypeWrite`/`enforceTypeRead`). Bounded
 * to read/write families only — never admin/platform/cell scopes.
 */
export function isSelfGrantableGranular(scope: string): boolean {
  return /^(read|write):type:[^:]+$/.test(scope);
}

/**
 * The cell scope a sign-in may grant BECAUSE OF WHERE IT CAME FROM.
 *
 * `cell:<owner>/<name>:<tool>` is open-ended in owner and name, so like the
 * per-type scopes above it can never sit in the static `scopesSupported` — and
 * unlike them it had no admission rule at all, so a client that asked for a
 * cell scope ALONE was offered nothing and the consent screen disabled its own
 * Authorize button. `cellCeiling` already caps such a token at the token step;
 * this is the missing half, which makes the scope offerable at the authorize
 * step so a code can carry it in the first place.
 *
 * Bounded to the cell the sign-in ORIGINATES AT, derived from the
 * `redirect_uri` — so a request can only ever name the cell whose page the
 * player is standing on, never a third party's.
 *
 * Derived via `cellFromRedirect`, not `cellCeiling`, because the ceiling only
 * recognises a HOST-ISOLATED redirect (`<owner>-<name>.on.parc.land`). An
 * apex-served cell at `/@owner/name` got an empty list, so the scope was
 * filtered out of `granted` and the consent screen offered nothing — the same
 * disabled-Authorize case described above, still live for every apex cell.
 * `cellFromRedirect` already parses both forms. This widens nothing: the two
 * agree on the host-isolated case, and the apex case stays bounded to the cell
 * in the path.
 *
 * This grants no authority by itself, and that is the point. A cell call is
 * authorised by the registry (`authorizeAccess`: owner, grants, tool grants),
 * not by the caller's scopes, and a dynamic cell receives `x-cell-caller` and
 * never the token. So a token holding ONLY this is an identity token — which
 * is exactly what a cell that wants to know who you are should be able to ask
 * for, instead of the `workspace:read workspace:write` the kernel's default
 * scope asks for (docs/cell-origin-isolation.md §4.5 — the least-privilege
 * handoff this makes reachable).
 */
export function cellScopesFor(redirectUri: string | undefined): string[] {
  const cell = cellFromRedirect(redirectUri);
  return cell ? [`cell:${cell.owner}/${cell.name}:*`] : [];
}

const DEFAULT_EXPIRY = 3600;
const DEFAULT_REFRESH_EXPIRY = REFRESH_TTL_MS / 1000;
const NO_STORE = { 'cache-control': 'no-store' };

/** Below this a chosen grant lifetime is impractical (a token that dies on arrival). */
const MIN_GRANT_SECS = 300;

/**
 * The server's grant-lifetime ceiling (seconds) — the most a user may pick at
 * consent. The picker can only *narrow* the grant, never exceed policy; we use the
 * configured refresh TTL as the horizon (it's what bounds re-consent in the usual
 * short-access/long-refresh mode, and a sane cap on non-expiring deployments).
 */
function grantCeilingSecs(config: OAuthConfig): number {
  return config.refreshExpirySecs ?? DEFAULT_REFRESH_EXPIRY;
}

/** Clamp a user-requested grant lifetime to [MIN_GRANT_SECS, ceiling]; null = use default. */
function clampGrant(requested: number | undefined, config: OAuthConfig): number | null {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return null;
  return Math.min(Math.max(Math.floor(requested), MIN_GRANT_SECS), grantCeilingSecs(config));
}

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
/**
 * The long-lived navigation REFRESH cookie. Carries the opaque refresh token at
 * the grant horizon (e.g. 30d), so a top-level navigation can silently re-mint a
 * short access token at the edge (dispatch) without a passkey round-trip — the fix
 * for "I picked 30 days but get signed out within the hour". Same hardening as the
 * session cookie (HttpOnly/Secure/SameSite=Lax), and the edge only consumes it on
 * a safe top-level navigation, so it can never authorize a mutation.
 */
const REFRESH_COOKIE = 'parc_refresh';
function refreshCookie(token: string, maxAgeSecs: number): string {
  return `${REFRESH_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSecs))}`;
}
function clearRefreshCookie(): string {
  return `${REFRESH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
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
    grant_types_supported: [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:device_code',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ],
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

/**
 * Is this `redirect_uri` one the client registered?
 *
 * It was never checked. `handleDCR` stored `redirect_uris` and nothing read
 * them back, so an authorize URL could name any destination at all: craft one
 * with your own `code_challenge`, let the victim approve a real consent screen
 * on the real origin, and the code arrives at your site to be exchanged with
 * the verifier you chose. PKCE does not help, because whoever crafted the URL
 * holds the verifier.
 *
 * The bound is the ORIGIN, not the exact string RFC 6749 §3.1.2.3 asks for.
 * The kernel caches one client per origin and reuses it across every surface
 * path there (`ensureClientId`), so the client a reader registered at `/` is
 * the one that signs them in at `/@c15r/shelved`; exact matching would reject
 * every path but the one they first landed on. Origin matching still closes
 * the hole — a code cannot land anywhere the client did not name — and
 * tightening it further is a kernel change (register the path, or re-register
 * when it moves), not a server one.
 */
export function redirectAllowed(client: OAuthClient | null, redirectUri: string | undefined): boolean {
  if (!client || !redirectUri) return false;
  const originOf = (u: string): string | null => {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  };
  const want = originOf(redirectUri);
  return !!want && client.redirectUris.some((u) => originOf(u) === want);
}

interface ConsentBody {
  sessionId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod?: string;
  scope?: string;
  state?: string;
  resource?: string;
  /** User-chosen grant lifetime (seconds); clamped server-side to the ceiling. */
  expiresInSec?: number;
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

  // The code is about to be minted against this redirect. It must be one the
  // client registered, or the authorize URL chooses where the code lands.
  const client = await store.getOAuthClient(b.clientId);
  if (!redirectAllowed(client, b.redirectUri)) {
    console.warn('[oauth] consent: unregistered redirect_uri', { clientId: b.clientId, redirectUri: b.redirectUri });
    return ok({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client' }, 400);
  }

  // Authoritative scope gating: keep only scopes this user may actually grant
  // (admin scopes require an admin username), regardless of what the page sent.
  const user = await store.getUserById(session.userId);
  const allowed = new Set(grantableScopes(config, user?.username ?? ''));
  const requested = (b.scope ?? '').split(/\s+/).filter(Boolean);
  // Admit the static grantable set, plus any requested per-type scope the owner is
  // inherently entitled to grant over their own slice (ADR-0023) — these are
  // open-ended in <T> so they can't sit in scopesSupported.
  const fromCell = new Set(cellScopesFor(b.redirectUri));
  const granted = requested
    .filter((s) => allowed.has(s) || isSelfGrantableGranular(s) || fromCell.has(s))
    .join(' ');

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
    grantSecs: clampGrant(b.expiresInSec, config),
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
  const { sessionId, clientId, redirectUri, scope: requestedScope } = req.json<{ sessionId: string; clientId?: string; redirectUri?: string; scope?: string }>();
  const session = await store.validateSession(sessionId);
  if (!session) return ok({ error: 'Invalid or expired session' }, 401);
  const user = await store.getUserById(session.userId);
  const base = grantableScopes(config, user?.username ?? '');
  // The client may also request open-ended per-type scopes (read:type:<T> /
  // write:type:<T>, ADR-0023); surface the requested ones the owner may self-grant
  // so they appear as per-type checkboxes (and so a granular elevation URL — ADR-0022
  // — actually offers the scope it asks for). Bounded to read/write type families.
  // …and the cell scope this sign-in came from, for the same reason: open-ended,
  // so it cannot be listed statically, and un-offerable until now.
  const fromCell = new Set(cellScopesFor(redirectUri));
  const extra = (requestedScope ?? '')
    .split(/\s+/)
    .filter((s) => s && (isSelfGrantableGranular(s) || fromCell.has(s)) && !base.includes(s));
  const scopes = [...base, ...extra];
  // Capability metadata so the consent screen can group + label scopes.
  const catalog = Object.fromEntries(scopes.map((s) => [s, scopeMeta(s)]));
  // The client's human name (from DCR) so consent shows "parc.land", not a UUID.
  const client = clientId ? await store.getOAuthClient(clientId) : null;
  // The cell the sign-in originates at (from the redirect_uri), so consent can name
  // the *cell* as the subject acting in your workspace (docs/auth-consent-plan.md §A).
  const cell = cellFromRedirect(redirectUri);
  // The grant-lifetime ceiling lets the consent screen offer a "this access lasts…"
  // picker bounded by policy (docs/capability-consent.md).
  return ok({
    username: user?.username ?? null,
    scopes,
    catalog,
    clientName: client?.clientName ?? null,
    ...(cell ? { resource: { kind: 'cell', address: cell.address } } : {}),
    maxGrantSecs: grantCeilingSecs(config),
  });
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

    // Apply the user's chosen grant lifetime (already clamped at consent). It only
    // ever narrows: in the usual expiring mode the refresh token carries the grant
    // horizon and the access token stays short; on a non-expiring deployment a
    // finite choice makes the access token itself finite. (docs/capability-consent.md)
    const grant = authCode.grantSecs ?? null;
    let accessExpiry: number | undefined;
    let refreshLifetime = refreshExpiry;
    let withRefresh: boolean;
    if (neverExpires) {
      accessExpiry = grant ?? undefined; // finite only if the user chose a lifetime
      withRefresh = false;
    } else {
      accessExpiry = grant ? Math.min(grant, configuredExpiry) : configuredExpiry;
      refreshLifetime = grant ? Math.min(grant, refreshExpiry) : refreshExpiry;
      withRefresh = refreshLifetime > accessExpiry; // a sub-access grant is one short token
    }

    // ADR-0024: a connected client is an ACTOR acting for the user, and the
    // token says so from mint — a foreign-origin redirect (Claude, ChatGPT, a
    // cell host) yields a depth-1 chain, while the platform's own SPA stays a
    // root credential (the human driving first-party surfaces IS the user).
    const clientRec = await store.getOAuthClient(authCode.clientId);
    const actor = delegationActorForRedirect(authCode.redirectUri, originOf(req), clientRec?.clientName ?? null, authCode.clientId);
    const result = await store.mintToken({
      userId: authCode.userId,
      scope: effectiveScope,
      label: `OAuth: ${clientRec?.clientName ?? authCode.clientId}`,
      clientId: authCode.clientId,
      expiresInSec: accessExpiry,
      withRefresh,
      refreshExpiresInSec: refreshLifetime,
      ...(actor ? { act: { sub: actor } } : {}),
    });
    console.log('[oauth] token: issued', { clientId: authCode.clientId, scope: effectiveScope, capped: !!ceiling, grantSecs: grant, resource: authCode.resource });
    const response: Record<string, unknown> = { access_token: result.token, token_type: 'Bearer', scope: effectiveScope };
    if (accessExpiry !== undefined) response.expires_in = accessExpiry;
    if (withRefresh) response.refresh_token = result.refreshToken;
    // Set the httpOnly navigation cookies: the short-lived access cookie identifies
    // SSR/page loads, and the long-lived refresh cookie lets the edge silently
    // re-mint the access token on a later navigation (so the chosen grant horizon
    // actually keeps the browser signed in — not just the access TTL).
    const cookieMaxAge = accessExpiry ?? 30 * 24 * 3600;
    const cookies = [sessionCookie(result.token, cookieMaxAge)];
    if (withRefresh && result.refreshToken) cookies.push(refreshCookie(result.refreshToken, refreshLifetime));
    return okWithCookies(response, cookies);
  }

  if (body.grant_type === 'refresh_token') {
    if (!body.refresh_token) return ok({ error: 'invalid_request' }, 400);
    if (neverExpires) return ok({ error: 'unsupported_grant_type', error_description: 'Tokens are non-expiring' }, 400);
    const result = await store.refreshUnifiedToken(sha256(body.refresh_token), configuredExpiry, refreshExpiry);
    if (!result) return ok({ error: 'invalid_grant', error_description: 'Invalid or expired refresh token' }, 400);
    // Refresh keeps BOTH navigation cookies current (access + refresh), so the
    // edge silent-refresh path can keep re-priming the session up to the grant.
    // The refresh credential is STABLE (ADR-0080) — re-issue the value the caller
    // presented, so the cookie chain and the localStorage chain stay in step.
    const stableRefresh = result.refreshToken ?? body.refresh_token;
    const cookies = [sessionCookie(result.token, configuredExpiry), refreshCookie(stableRefresh, refreshExpiry)];
    return okWithCookies(
      { access_token: result.token, token_type: 'Bearer', expires_in: configuredExpiry, refresh_token: stableRefresh },
      cookies,
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

  if (body.grant_type === 'urn:ietf:params:oauth:grant-type:token-exchange') {
    // RFC 8693 delegation (ADR-0024): the presented subject_token IS the
    // credential — same self-authorizing shape as the `auth.exchangeToken`
    // command, now reachable through the standard AS surface so any OAuth
    // client holding a parent token can mint an attenuated, chain-carrying
    // child without speaking the gateway's `act` vocabulary.
    const { subject_token, subject_token_type, scope, actor, label } = body;
    if (!subject_token) {
      return ok({ error: 'invalid_request', error_description: 'subject_token required' }, 400);
    }
    if (subject_token_type && subject_token_type !== 'urn:ietf:params:oauth:token-type:access_token') {
      return ok({ error: 'invalid_request', error_description: `unsupported subject_token_type: ${subject_token_type}` }, 400);
    }
    if (!scope) {
      // Delegation must state what it wants — an implicit full-width child
      // defeats the attenuation discipline, so scope is required here.
      return ok({ error: 'invalid_request', error_description: 'scope required (delegation must name the attenuated scope)' }, 400);
    }
    try {
      const result = await performTokenExchange(store, {
        from: subject_token,
        scope,
        actor,
        label,
        expiresInSec: mintExpiry,
      });
      console.log('[oauth] token: exchanged (delegation)', { child: result.id, actor: result.actor, depth: chainDepth(result.act) });
      return ok({
        access_token: result.token,
        issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        token_type: 'Bearer',
        scope: result.scope,
        ...(neverExpires ? {} : { expires_in: configuredExpiry }),
        act: result.act,
      });
    } catch (err) {
      const message = (err as Error).message;
      console.warn('[oauth] token: exchange refused', { error: message });
      if (message.startsWith('invalid_grant')) return ok({ error: 'invalid_grant', error_description: message }, 400);
      if (message.startsWith('scope_denied')) return ok({ error: 'invalid_scope', error_description: message }, 400);
      // delegation_too_deep / delegation_loop / missing fields
      return ok({ error: 'invalid_request', error_description: message }, 400);
    }
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
  // Drop both navigation cookies too, so sign-out clears the SSR session and the
  // edge can't silently re-mint from a lingering refresh cookie.
  return okWithCookies({}, [clearSessionCookie(), clearRefreshCookie()]);
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

/**
 * Disclose what a device code is asking for, so the approver sees the scopes
 * BEFORE approving (informed consent — kb/device-flow-consent-disclosure). The
 * device grant is all-or-nothing (RFC 8628 has no scope picker on approval), so
 * this is read-only disclosure; the catalog labels/groups each scope the same
 * way the OAuth consent screen does. Session-gated so a bare `user_code` can't
 * probe scopes.
 */
export async function handleDeviceInfo(req: ServiceHttpRequest, store: AuthStore): Promise<ServiceHttpResponse> {
  const b = req.json<{ sessionId: string; user_code: string }>();
  const session = await store.validateSession(b.sessionId);
  if (!session) return ok({ error: 'Invalid or expired session' }, 401);
  const dc = await store.getDeviceCodeByUserCode(b.user_code);
  if (!dc) return ok({ error: 'Unknown or expired user code' }, 400);
  const scopes = (dc.scope ?? '').split(/\s+/).filter(Boolean);
  const catalog = Object.fromEntries(scopes.map((s) => [s, scopeMeta(s)]));
  return ok({ scopes, catalog });
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
  /** The token's granted scope (the ceiling). */
  scope: string;
  /** The session's effective scope (≤ grant); null ⇒ the full grant is effective. */
  effectiveScope: string | null;
  /** The token id — the handle a session uses to mutate its own effective scope. */
  tokenId: string;
  clientId: string | null;
  /** The adopted posture (ADR-0074), threaded into the identity so reads can
   *  resolve through the principal; null ⇒ no posture. */
  posture: TokenPosture | null;
  /** The delegation chain (ADR-0024) — outermost = leaf actor; null ⇒ a root
   *  token (the subject acts as themselves). Provenance, never authorization. */
  act: ActClaim | null;
}

/**
 * Edge silent-refresh (consumed by the dispatch SSR path via the `refreshSession`
 * command): given the value of the `parc_refresh` cookie, rotate a fresh
 * access+refresh pair and return the resolved identity + the `Set-Cookie` strings
 * that re-prime the browser. Returns null when the refresh token is invalid/expired
 * or the deployment is non-expiring. This is what makes a 30-day grant actually keep
 * a browser signed in for 30 days: a navigation re-mints a short access token with
 * no passkey round-trip, while access tokens stay short for API clients.
 */
export interface RefreshedSession {
  userId: string;
  scope: string;
  effectiveScope: string | null;
  tokenId: string | null;
  setCookies: string[];
}
export async function handleRefreshSession(refreshToken: string, store: AuthStore, config: OAuthConfig): Promise<RefreshedSession | null> {
  if (!refreshToken) return null;
  const configuredExpiry = config.tokenExpirySecs ?? DEFAULT_EXPIRY;
  const refreshExpiry = config.refreshExpirySecs ?? DEFAULT_REFRESH_EXPIRY;
  if (configuredExpiry <= 0) return null; // non-expiring deployments don't refresh
  const result = await store.refreshUnifiedToken(sha256(refreshToken), configuredExpiry, refreshExpiry);
  if (!result) return null;
  const validated = await validateBearer(result.token, store);
  if (!validated) return null;
  return {
    userId: validated.userId,
    scope: validated.scope,
    effectiveScope: validated.effectiveScope,
    tokenId: validated.tokenId,
    // Stable refresh credential (ADR-0080): when the store didn't re-mint it,
    // re-prime the cookie with the value the navigation presented.
    setCookies: [sessionCookie(result.token, configuredExpiry), refreshCookie(result.refreshToken ?? refreshToken, refreshExpiry)],
  };
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
  return {
    userId: account?.username ?? tok.mintedBy,
    scope: tok.scope,
    effectiveScope: tok.effectiveScope ?? null,
    tokenId: tok.id,
    clientId: tok.clientId,
    posture: tok.posture ?? null,
    act: tok.act ?? null,
  };
}

// ─── Token exchange core (RFC 8693 / ADR-0024) ───────────────────

export interface TokenExchangeInput {
  /** The parent token VALUE (the credential being delegated from). */
  from: string;
  scope: string;
  /** The child actor's name — what writer stamps will read (e.g. "agent:researcher"). */
  actor?: string;
  label?: string;
  expiresInSec?: number;
}

export interface TokenExchangeResult {
  id: string;
  token: string;
  scope: string;
  act: ActClaim;
  actor: string;
  parentTokenId: string;
  expiresAt: string | null;
}

/**
 * The one exchange implementation (ADR-0024), shared by the `auth.exchangeToken`
 * command and the `/oauth/token` RFC 8693 grant: validate the presented parent,
 * clamp the child to min(requested, parent grant) — delegation only attenuates —
 * and mint a child carrying the appended `act` chain, depth-bounded and
 * loop-guarded. Throws with the `invalid_grant:` / `scope_denied:` /
 * `delegation_too_deep:` / `delegation_loop:` prefixes both callers map onto
 * their own error surfaces.
 */
export async function performTokenExchange(store: AuthStore, input: TokenExchangeInput): Promise<TokenExchangeResult> {
  if (!input?.from?.trim()) throw new Error('`from` (the parent token) is required');
  if (!input?.scope?.trim()) throw new Error('A `scope` for the child token is required');
  const parent = await validateBearer(input.from, store);
  if (!parent) throw new Error('invalid_grant: the presented parent token is not valid');

  const requested = input.scope.split(/[\s,]+/).filter(Boolean);
  // The ceiling is the PARENT TOKEN's grant — not the caller's session — so a
  // chain can only narrow hop over hop, whoever performs the exchange.
  const ceiling = parent.scope.split(/[\s,]+/).filter(Boolean);
  const effective = intersectScopes(requested, ceiling);
  if (!effective.length) {
    throw new Error(
      `scope_denied: none of the requested scopes (${requested.join(' ')}) are within the parent token's ceiling (${ceiling.join(' ') || 'none'}). Delegation can only attenuate.`,
    );
  }

  // The chain: the child's actor name, nested over the parent's own chain.
  // A root parent contributes no act — the child is then depth 1 ("actor,
  // acting for <sub>"). Names must be fresh per hop (loop guard) and the
  // chain bounded (runaway guard).
  const actor = input.actor?.trim() || input.label?.trim() || `delegate:${parent.tokenId.slice(0, 8)}`;
  const parentChain = parent.act ?? undefined;
  if (chainDepth(parentChain) + 1 > MAX_DELEGATION_DEPTH) {
    throw new Error(`delegation_too_deep: the chain already carries ${chainDepth(parentChain)} hops (max ${MAX_DELEGATION_DEPTH})`);
  }
  if (chainActors(parentChain).includes(actor) || actor === parent.userId) {
    throw new Error(`delegation_loop: "${actor}" already appears in this chain`);
  }
  const act: ActClaim = { sub: actor, ...(parentChain ? { act: parentChain } : {}) };

  // The child's SUBJECT stays the parent's subject — authorization anchors to
  // the original consenting principal; the chain carries the provenance.
  const account = await store.getUserByUsername(parent.userId);
  const result = await store.mintToken({
    userId: account?.id ?? parent.userId,
    scope: effective.join(' '),
    label: input.label ?? actor,
    expiresInSec: input.expiresInSec ?? 3600,
    act,
  });
  return {
    id: result.id,
    token: result.token,
    scope: effective.join(' '),
    act,
    actor,
    parentTokenId: parent.tokenId,
    expiresAt: result.expiresAt,
  };
}
