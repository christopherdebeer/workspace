/**
 * Resource server cell — a minimal OAuth-protected resource that exercises the
 * platform's auth end-to-end. It owns `/mcp/*` (the protected resource the auth
 * cell advertises in its `/.well-known/oauth-protected-resource` document).
 *
 * Identity arrives already validated: the runtime turns a verified
 * `Authorization: Bearer` token into `ctx.identity` by invoking the auth cell's
 * `validateToken` command (this cell lists `auth` in `allow[]`). Forged
 * `x-auth-*` headers are ignored. When no valid token is present we answer with
 * `401 + WWW-Authenticate: Bearer resource_metadata=...` so RFC 9728 / MCP
 * clients can discover the authorization server and start the OAuth flow.
 */
import {
  defineService,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from '../../platform/runtime';

const NO_STORE = { 'cache-control': 'no-store' };

function baseUrl(req: ServiceHttpRequest): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/** RFC 9728 challenge pointing clients at the protected-resource metadata. */
function unauthorized(req: ServiceHttpRequest, error: string): ServiceHttpResponse {
  const metadata = `${baseUrl(req)}/.well-known/oauth-protected-resource`;
  return {
    statusCode: 401,
    headers: {
      ...NO_STORE,
      'www-authenticate': `Bearer resource_metadata="${metadata}", error="${error}"`,
    },
    body: { error },
  };
}

/** GET /mcp/whoami — returns the authenticated principal + granted scopes. */
function whoami(req: ServiceHttpRequest, ctx: ServiceContext): ServiceHttpResponse {
  if (!ctx.identity.user) return unauthorized(req, 'invalid_token');
  return {
    statusCode: 200,
    headers: NO_STORE,
    body: { user: ctx.identity.user, scopes: ctx.identity.scopes },
  };
}

/**
 * GET /mcp/admin — demonstrates scope enforcement. Requires `workspace:admin`
 * (or a wildcard parent); 401 when unauthenticated, 403 when authenticated but
 * lacking the scope.
 */
function admin(req: ServiceHttpRequest, ctx: ServiceContext): ServiceHttpResponse {
  if (!ctx.identity.user) return unauthorized(req, 'invalid_token');
  const ok = ctx.identity.scopes.some(
    (held) => held === 'workspace:admin' || (held.endsWith(':*') && 'workspace:admin'.startsWith(held.slice(0, -1))),
  );
  if (!ok) {
    return {
      statusCode: 403,
      headers: NO_STORE,
      body: { error: 'insufficient_scope', required: 'workspace:admin' },
    };
  }
  return { statusCode: 200, headers: NO_STORE, body: { user: ctx.identity.user, admin: true } };
}

/** GET /mcp — unauthenticated discovery hint describing this resource. */
function info(req: ServiceHttpRequest): ServiceHttpResponse {
  const origin = baseUrl(req);
  return {
    statusCode: 200,
    headers: NO_STORE,
    body: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      endpoints: { whoami: `${origin}/mcp/whoami`, admin: `${origin}/mcp/admin` },
    },
  };
}

export const handler = defineService({
  name: 'resource',
  commands: {},
  http: [
    { method: 'GET', path: '/mcp/whoami', handler: whoami },
    { method: 'GET', path: '/mcp/admin', handler: admin },
    { method: 'GET', path: '/mcp', handler: info },
  ],
});

export default handler;
