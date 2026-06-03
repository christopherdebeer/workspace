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
import { defineService, ServiceContext, requireUser, getOptional } from '../../platform/runtime';
import { AuthStore } from './store';
import { createMemoryStore } from './memory-store';
import { createDynamoStore } from './dynamo-store';
import {
  OAuthConfig,
  handlePRM,
  handleASMetadata,
  handleDCR,
  handleConsent,
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
import { renderAuthPage } from './ui';

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
  scopesSupported: (getOptional('AUTH_SCOPES') ?? 'workspace:read workspace:write workspace:admin').split(/\s+/),
  // 0 / negative => non-expiring tokens (no refresh). Default 1h.
  tokenExpirySecs: getOptional('AUTH_TOKEN_EXPIRY_SECS')
    ? Number(getOptional('AUTH_TOKEN_EXPIRY_SECS'))
    : 3600,
};

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
    { method: 'GET', path: '/.well-known/oauth-authorization-server', handler: (req) => handleASMetadata(req, OAUTH_CONFIG) },

    { method: 'POST', path: '/oauth/register', handler: (req) => handleDCR(req, store) },
    { method: 'GET', path: '/oauth/authorize', handler: (req) => renderAuthPage(req, SERVER_NAME) },
    { method: 'POST', path: '/oauth/consent', handler: (req) => handleConsent(req, store) },
    { method: 'POST', path: '/oauth/token', handler: (req) => handleToken(req, store, OAUTH_CONFIG) },

    { method: 'POST', path: '/webauthn/register/options', handler: (req) => handleRegisterOptions(req, store, WEBAUTHN_CONFIG) },
    { method: 'POST', path: '/webauthn/register/verify', handler: (req, ctx) => handleRegisterVerify(req, ctx, store, WEBAUTHN_CONFIG) },
    { method: 'POST', path: '/webauthn/authenticate/options', handler: (req) => handleAuthOptions(req, store, WEBAUTHN_CONFIG) },
    { method: 'POST', path: '/webauthn/authenticate/verify', handler: (req) => handleAuthVerify(req, store, WEBAUTHN_CONFIG) },

    { method: 'POST', path: '/auth/device', handler: (req) => handleDeviceInit(req, store) },
    { method: 'GET', path: '/auth/device', handler: (req) => renderAuthPage(req, SERVER_NAME) },
    { method: 'POST', path: '/auth/device/approve', handler: (req) => handleDeviceApprove(req, store) },
  ],
});

export default handler;
