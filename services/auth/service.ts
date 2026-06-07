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
import { defineService, ServiceContext, ServiceHttpResponse, requireUser, getOptional } from '../../platform/runtime';
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
  // Admin-gated scopes (default `platform:`) may only be granted to these users.
  adminUsernames: (getOptional('AUTH_ADMIN_USERNAMES') ?? '').split(/[\s,]+/).filter(Boolean),
  adminScopePrefixes: (getOptional('AUTH_ADMIN_SCOPE_PREFIXES') ?? 'platform:').split(/[\s,]+/).filter(Boolean),
};

// ─── React authorize/consent SPA (built from client/main.tsx by esbuild) ─────
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' };
const JS_HEADERS = { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' };
const SHELL = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark"><title>authorize · ${SERVER_NAME}</title>
<style>html,body{margin:0;background:#0a0a0a}</style></head>
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

interface MintTokenInput {
  scope: string;
  label?: string;
  expiresInSec?: number;
  withRefresh?: boolean;
}
async function mintToken(input: MintTokenInput, ctx: ServiceContext) {
  const userId = requireUser(ctx.identity);
  const result = await store.mintToken({
    userId,
    scope: input.scope,
    label: input.label,
    expiresInSec: input.expiresInSec,
    withRefresh: input.withRefresh,
  });
  await ctx.events.emit('auth.token.minted', { userId, id: result.id, scope: input.scope });
  return result;
}

async function listTokens(_input: unknown, ctx: ServiceContext) {
  return store.listUserTokens(requireUser(ctx.identity));
}

interface RevokeTokenInput {
  tokenId: string;
}
async function revokeToken(input: RevokeTokenInput, ctx: ServiceContext) {
  const userId = requireUser(ctx.identity);
  const ok = await store.revokeToken(input.tokenId, userId);
  if (ok) await ctx.events.emit('auth.token.revoked', { userId, id: input.tokenId });
  return { revoked: ok };
}

// ─── Service ─────────────────────────────────────────────────────

export const handler = defineService({
  name: 'auth',
  commands: { validateToken, mintToken, listTokens, revokeToken },
  events: { emits: ['auth.user.registered', 'auth.token.minted', 'auth.token.revoked'] },
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

    { method: 'POST', path: '/oauth/register', handler: (req) => handleDCR(req, store) },
    { method: 'POST', path: '/oauth/consent', handler: (req) => handleConsent(req, store, OAUTH_CONFIG) },
    { method: 'POST', path: '/oauth/token', handler: (req) => handleToken(req, store, OAUTH_CONFIG) },
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
