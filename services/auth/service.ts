/**
 * Auth primitive service — WebAuthn passkeys + OAuth 2.1 + scoped tokens.
 *
 * Ported from c15r/mcp-auth. Exposes:
 *   - Commands (direct invoke / `/auth/<command>`): validateToken, mintToken,
 *     listTokens, revokeToken — `validateToken` is the bridge the edge/peers use
 *     to turn a bearer token into the `x-auth-user` / `x-auth-scopes` identity
 *     the platform runtime already understands.
 *   - Raw HTTP routes: `/.well-known/*`, `/oauth/*`, `/webauthn/*`, `/auth/device*`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  defineService,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
  requireUser,
  getOptional,
  intersectScopes,
  grantScopesOf,
  hasGrantScope,
} from '../../platform/runtime';
import { AuthStore } from './store';
import { createMemoryStore } from './memory-store';
import { createDynamoStore } from './dynamo-store';
import {
  OAuthConfig,
  handlePRM,
  handleASMetadata,
  handleDCR,
  handleConsent,
  handleGrantableScopes,
  handleToken,
  handleRevoke,
  handleDeviceInit,
  handleDeviceApprove,
  validateBearer,
} from './oauth';
import {
  WebAuthnConfig,
  handleRegisterOptions,
  handleRegisterVerify,
  handleAuthOptions,
  handleAuthVerify,
} from './webauthn';

// In production a DynamoDB table is provisioned; locally/in tests fall back to
// an in-memory store so the cell runs without AWS.
const store: AuthStore = getOptional('TABLE_NAME')
  ? createDynamoStore(getOptional('TABLE_NAME')!)
  : createMemoryStore();

const SERVER_NAME = getOptional('AUTH_SERVER_NAME') ?? 'workspace';

const OAUTH_CONFIG: OAuthConfig = {
  serverName: SERVER_NAME,
  serverDescription: 'Platform auth primitive',
  docsUrl: getOptional('AUTH_DOCS_URL'),
  scopesSupported: (
    getOptional('AUTH_SCOPES') ?? 'workspace:read workspace:write workspace:admin'
  ).split(/\s+/).filter(Boolean),
  // 0 / negative => non-expiring tokens (no refresh). Default 1h.
  tokenExpirySecs: getOptional('AUTH_TOKEN_EXPIRY_SECS')
    ? Number(getOptional('AUTH_TOKEN_EXPIRY_SECS'))
    : 3600,
  // Refresh tokens outlive access tokens (short access + long refresh keeps MCP
  // clients connected without re-consent). Default 30d.
  refreshExpirySecs: getOptional('AUTH_REFRESH_EXPIRY_SECS')
    ? Number(getOptional('AUTH_REFRESH_EXPIRY_SECS'))
    : undefined,
  // Admin-gated scopes (default `platform:`) may only be granted to these users.
  adminUsernames: (getOptional('AUTH_ADMIN_USERNAMES') ?? '').split(/[\s,]+/).filter(Boolean),
  adminScopePrefixes: (getOptional('AUTH_ADMIN_SCOPE_PREFIXES') ?? 'platform:').split(/[\s,]+/).filter(Boolean),
};

// ─── React authorize/consent SPA (built from client/main.tsx by esbuild) ─────
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' };
const JS_HEADERS = { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' };
const SHELL = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light"><title>authorize · ${SERVER_NAME}</title>
<style>html,body{margin:0;background:#f3edde}</style></head>
<body><div id="root"></div><script src="/auth/app.js"></script></body></html>`;

let appJsCache: string | undefined;
function appJs(): string {
  if (appJsCache === undefined) {
    try {
      appJsCache = readFileSync(join(__dirname, 'app.js'), 'utf8');
    } catch {
      appJsCache = 'console.error("auth client bundle (app.js) not found");';
    }
  }
  return appJsCache;
}
const shell = (): ServiceHttpResponse => ({ statusCode: 200, headers: HTML_HEADERS, body: SHELL });

const WEBAUTHN_CONFIG: WebAuthnConfig = {
  rpName: SERVER_NAME,
  rpId: getOptional('WEBAUTHN_RP_ID'),
};

// ─── Commands ────────────────────────────────────────────────────

interface ValidateTokenInput {
  token: string;
}
async function validateToken(input: ValidateTokenInput) {
  if (!input?.token) return null;
  return validateBearer(input.token, store);
}

/**
 * The caller's stable account id (UUID). The exposed principal
 * (`ctx.identity.user`) is the human username (so addresses/scopes are readable),
 * but token storage stays keyed by the durable account id — so resolve back here.
 * Falls back to the principal if it can't be resolved to an account.
 */
async function callerAccountId(ctx: ServiceContext): Promise<string> {
  const principal = requireUser(ctx.identity);
  const account = await store.getUserByUsername(principal);
  return account?.id ?? principal;
}

interface MintTokenInput {
  scope: string;
  label?: string;
  expiresInSec?: number;
  withRefresh?: boolean;
}
async function mintToken(input: MintTokenInput, ctx: ServiceContext) {
  const userId = await callerAccountId(ctx);
  if (!input?.scope?.trim()) throw new Error('A `scope` for the token is required');
  // The minter's own token is the ceiling: a minted token carries the
  // intersection of what was asked and what the minter's credential holds —
  // narrow, never widen (docs/scope-grants.md §3). Callers whose identity
  // arrives without scopes (no PEP on the path) cannot mint at all.
  const requested = input.scope.split(/[\s,]+/).filter(Boolean);
  // The ceiling is the minter's GRANT, not its (possibly narrowed) session focus —
  // a minted credential may carry anything the human consented to, regardless of
  // how the current session has temporarily reduced its effective scope.
  const ceiling = grantScopesOf(ctx.identity);
  const effective = intersectScopes(requested, ceiling);
  if (!effective.length) {
    throw new Error(
      `scope_denied: none of the requested scopes (${requested.join(' ')}) are within your token's ceiling (${
        ceiling.join(' ') || 'none'
      }). A token can only narrow, never widen.`,
    );
  }
  const scope = effective.join(' ');
  const result = await store.mintToken({
    userId,
    scope,
    label: input.label,
    expiresInSec: input.expiresInSec,
    withRefresh: input.withRefresh,
  });
  await ctx.events.emit('auth.token.minted', { userId, id: result.id, scope });
  // Echo the effective scope so the minter sees what the narrowing produced.
  return { ...result, scope };
}

async function listTokens(_input: unknown, ctx: ServiceContext) {
  return store.listUserTokens(await callerAccountId(ctx));
}

/** The gateway-facing read: active credentials, newest first. */
async function tokens(_input: unknown, ctx: ServiceContext) {
  const all = await store.listUserTokens(await callerAccountId(ctx));
  return { tokens: all };
}

interface RevokeTokenInput {
  tokenId: string;
}
async function revokeToken(input: RevokeTokenInput, ctx: ServiceContext) {
  const userId = await callerAccountId(ctx);
  const ok = await store.revokeToken(input.tokenId, userId);
  if (ok) await ctx.events.emit('auth.token.revoked', { userId, id: input.tokenId });
  return { revoked: ok };
}

// ─── Incremental authorization: a session's mutable effective scope ──────────
// The token's grant is the ceiling (set at consent); the session's *effective*
// scope is a mutable subset of it, so a session can start minimal and widen on
// demand without re-consent (docs/capability-consent.md). `scope` reports both;
// `focusScope` narrows ("reduced"); `requestScope` widens back up to the ceiling.

/** The session's effective scope + its grant ceiling. */
function scopeView(_input: unknown, ctx: ServiceContext): { effective: string[]; grant: string[] } {
  requireUser(ctx.identity);
  return { effective: ctx.identity.scopes, grant: grantScopesOf(ctx.identity) };
}

interface ScopeInput {
  scopes: string[];
}

/** Narrow the session to a minimal effective set (within the grant) — "start minimal". */
async function focusScope(input: ScopeInput, ctx: ServiceContext): Promise<{ effective: string[]; grant: string[] }> {
  requireUser(ctx.identity);
  const tokenId = ctx.identity.tokenId;
  if (!tokenId) throw new Error('focusScope needs a bearer-authenticated session (no token id on this identity)');
  const requested = (input?.scopes ?? []).filter(Boolean);
  if (!requested.length) throw new Error('`scopes` (a non-empty array) is required');
  const grant = grantScopesOf(ctx.identity);
  const effective = intersectScopes(requested, grant); // can only narrow within the ceiling
  await store.setEffectiveScope(tokenId, await callerAccountId(ctx), effective.join(' '));
  await ctx.events.emit('auth.scope.focused', { tokenId, effective });
  return { effective, grant };
}

/**
 * Widen the session's effective scope toward `scopes`, clamped to the grant
 * ceiling — the self-serve half of incremental authorization (the `scope_offer`
 * the gateway raises points here). Scopes outside the ceiling come back in
 * `denied`: those need human re-consent (the `scope_denied` elevation path), not
 * a self-serve widen.
 */
async function requestScope(
  input: ScopeInput,
  ctx: ServiceContext,
): Promise<{ effective: string[]; grant: string[]; granted: boolean; denied: string[] }> {
  requireUser(ctx.identity);
  const tokenId = ctx.identity.tokenId;
  if (!tokenId) throw new Error('requestScope needs a bearer-authenticated session (no token id on this identity)');
  const requested = (input?.scopes ?? []).filter(Boolean);
  if (!requested.length) throw new Error('`scopes` (a non-empty array) is required');
  const grant = grantScopesOf(ctx.identity);
  const denied = requested.filter((s) => !hasGrantScope(ctx.identity, s));
  // Union the current focus with the requested-within-ceiling, then re-clamp to grant.
  const widened = intersectScopes([...ctx.identity.scopes, ...requested.filter((s) => hasGrantScope(ctx.identity, s))], grant);
  await store.setEffectiveScope(tokenId, await callerAccountId(ctx), widened.join(' '));
  await ctx.events.emit('auth.scope.requested', { tokenId, effective: widened, denied });
  return { effective: widened, grant, granted: denied.length === 0, denied };
}

/**
 * The gateway provider contract: the small token-management vocabulary
 * (`auth.tokens` / `auth.mintToken` / `auth.revokeToken`). auth stays an
 * infrastructure cell, but credentials are user-facing state — the standing
 * management plane home and agents share (docs/scope-grants.md §4/§6).
 */
function describeTools() {
  return {
    tools: [
      {
        name: 'tokens',
        description:
          'List your credentials: id, scope, label, client, expiry, revoked. The standing view behind the identity shell — revoke anything you do not recognise.',
        scope: null,
        kind: 'read' as const,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        resultSchema: {
          type: 'object',
          properties: {
            tokens: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  scope: { type: 'string' },
                  label: { type: ['string', 'null'] },
                  clientId: { type: ['string', 'null'] },
                  revoked: { type: 'boolean' },
                  expiresAt: { type: ['string', 'null'] },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
      {
        name: 'mintToken',
        description:
          'Mint a bearer token narrowed to ≤ your own standing (effective scope = requested ∩ yours — a token can only narrow, never widen). Use for long-lived, narrow-scope credentials: webhooks, collectors, one cell. Label it so the list stays legible.',
        scope: null,
        kind: 'act' as const,
        inputSchema: {
          type: 'object',
          properties: {
            scope: { type: 'string', description: 'Space-separated scopes to request (intersected with yours)' },
            label: { type: 'string', description: 'What this credential is for' },
            expiresInSec: { type: 'number', description: 'Lifetime in seconds (omit for the default; ≤0 = non-expiring)' },
            withRefresh: { type: 'boolean', description: 'Also mint a refresh token' },
          },
          required: ['scope'],
          additionalProperties: false,
        },
        resultSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            token: { type: 'string', description: 'The bearer value — shown once, store it now' },
            scope: { type: 'string', description: 'The effective (narrowed) scope' },
            expiresAt: { type: ['string', 'null'] },
          },
        },
      },
      {
        name: 'revokeToken',
        description: 'Revoke one of your tokens by id (from auth.tokens). Idempotent.',
        scope: null,
        kind: 'act' as const,
        inputSchema: {
          type: 'object',
          properties: { tokenId: { type: 'string' } },
          required: ['tokenId'],
          additionalProperties: false,
        },
        resultSchema: { type: 'object', properties: { revoked: { type: 'boolean' } } },
      },
      {
        name: 'scope',
        description:
          "Your session's effective scope (what's enforced right now) and its grant ceiling (what you consented to). Incremental authorization: the effective set can be narrowed and widened within the ceiling without re-consent.",
        scope: null,
        kind: 'read' as const,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        resultSchema: {
          type: 'object',
          properties: {
            effective: { type: 'array', items: { type: 'string' }, description: 'Scopes enforced now' },
            grant: { type: 'array', items: { type: 'string' }, description: 'The token ceiling (consented)' },
          },
        },
      },
      {
        name: 'focusScope',
        description:
          'Narrow your session to a minimal effective scope (a subset of your grant) — start minimal, widen on demand. Shrinks blast radius without minting a new token. Reversible via requestScope.',
        scope: null,
        kind: 'act' as const,
        inputSchema: {
          type: 'object',
          properties: { scopes: { type: 'array', items: { type: 'string' }, description: 'The scopes to keep active (intersected with your grant)' } },
          required: ['scopes'],
          additionalProperties: false,
        },
        resultSchema: {
          type: 'object',
          properties: { effective: { type: 'array', items: { type: 'string' } }, grant: { type: 'array', items: { type: 'string' } } },
        },
      },
      {
        name: 'requestScope',
        description:
          "Widen your session's effective scope toward the requested scopes, up to your grant ceiling — the self-serve answer to a `scope_offer`. No re-consent. Scopes outside your grant come back in `denied` (those need your human to re-consent / mint a wider token).",
        scope: null,
        kind: 'act' as const,
        inputSchema: {
          type: 'object',
          properties: { scopes: { type: 'array', items: { type: 'string' }, description: 'The scopes to activate (clamped to your grant)' } },
          required: ['scopes'],
          additionalProperties: false,
        },
        resultSchema: {
          type: 'object',
          properties: {
            effective: { type: 'array', items: { type: 'string' } },
            grant: { type: 'array', items: { type: 'string' } },
            granted: { type: 'boolean', description: 'True when every requested scope is now effective' },
            denied: { type: 'array', items: { type: 'string' }, description: 'Requested scopes outside your grant — need re-consent' },
          },
        },
      },
    ],
  };
}

// ─── Service ─────────────────────────────────────────────────────

// CORS for host-isolated cells: a cell origin (`*.<cellDomain>`) fetches the apex
// /oauth/register + /oauth/token cross-origin during its sign-in. Reflect only
// https origins under CELL_DOMAIN_SUFFIX (our domain); credentialless (no cookie).
function authCors(req: ServiceHttpRequest): Record<string, string> {
  const suffix = process.env.CELL_DOMAIN_SUFFIX;
  if (!suffix) return {};
  const origin = req.headers['origin'] ?? req.headers['Origin'];
  if (!origin || !origin.startsWith('https://') || !origin.endsWith(suffix)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}
const cors = (req: ServiceHttpRequest, res: ServiceHttpResponse): ServiceHttpResponse => ({
  ...res,
  headers: { ...(res.headers ?? {}), ...authCors(req) },
});
const corsPreflight = (req: ServiceHttpRequest): ServiceHttpResponse => ({ statusCode: 204, headers: authCors(req), body: '' });

export const handler = defineService({
  name: 'auth',
  commands: {
    validateToken,
    mintToken,
    listTokens,
    tokens,
    revokeToken,
    scope: scopeView,
    focusScope,
    requestScope,
    describeTools: () => describeTools(),
  },
  events: { emits: ['auth.user.registered', 'auth.token.minted', 'auth.token.revoked', 'auth.scope.focused', 'auth.scope.requested'] },
  http: [
    { method: 'GET', path: '/.well-known/oauth-protected-resource', handler: (req) => handlePRM(req, OAUTH_CONFIG) },
    // RFC 9728 / MCP 2025-06-18: clients construct the PRM URL by inserting the
    // well-known path before the resource path (resource `…/mcp` →
    // `…/.well-known/oauth-protected-resource/mcp`). Serve those too, not just
    // the bare path, or strict clients (Claude.ai) 404 on discovery.
    { method: 'GET', path: '/.well-known/oauth-protected-resource/*', handler: (req) => handlePRM(req, OAUTH_CONFIG) },
    { method: 'GET', path: '/.well-known/oauth-authorization-server', handler: (req) => handleASMetadata(req, OAUTH_CONFIG) },

    // React authorize/consent SPA shell + its bundle (served under /auth/* which
    // this cell owns, so it doesn't collide with the home cell's /app.js).
    { method: 'GET', path: '/oauth/authorize', handler: shell },
    { method: 'GET', path: '/auth/device', handler: shell },
    { method: 'GET', path: '/auth/app.js', handler: () => ({ statusCode: 200, headers: JS_HEADERS, body: appJs() }) },

    // /oauth/register + /oauth/token are fetched cross-origin by host-isolated
    // cells, so they carry CORS + answer the preflight (the cell-host redirect
    // makes handleToken cap the scope — see oauth.ts cellCeiling).
    { method: 'POST', path: '/oauth/register', handler: async (req) => cors(req, await handleDCR(req, store)) },
    { method: 'OPTIONS', path: '/oauth/register', handler: corsPreflight },
    { method: 'POST', path: '/oauth/consent', handler: (req) => handleConsent(req, store, OAUTH_CONFIG) },
    { method: 'POST', path: '/oauth/token', handler: async (req) => cors(req, await handleToken(req, store, OAUTH_CONFIG)) },
    { method: 'OPTIONS', path: '/oauth/token', handler: corsPreflight },
    { method: 'POST', path: '/oauth/revoke', handler: (req) => handleRevoke(req, store) },
    { method: 'POST', path: '/auth/grantable', handler: (req) => handleGrantableScopes(req, store, OAUTH_CONFIG) },

    { method: 'POST', path: '/webauthn/register/options', handler: (req) => handleRegisterOptions(req, store, WEBAUTHN_CONFIG) },
    { method: 'POST', path: '/webauthn/register/verify', handler: (req, ctx) => handleRegisterVerify(req, ctx, store, WEBAUTHN_CONFIG) },
    { method: 'POST', path: '/webauthn/authenticate/options', handler: (req) => handleAuthOptions(req, store, WEBAUTHN_CONFIG) },
    { method: 'POST', path: '/webauthn/authenticate/verify', handler: (req) => handleAuthVerify(req, store, WEBAUTHN_CONFIG) },

    { method: 'POST', path: '/auth/device', handler: (req) => handleDeviceInit(req, store) },
    { method: 'POST', path: '/auth/device/approve', handler: (req) => handleDeviceApprove(req, store) },
  ],
});

export default handler;
