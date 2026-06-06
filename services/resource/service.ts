/**
 * Resource server cell — owns `/mcp/*`, the resource the auth cell advertises in
 * its protected-resource metadata. It is an MCP server: `POST /mcp` speaks the
 * MCP JSON-RPC transport (initialize / tools/list / tools/call) via
 * `defineMcpService`, exposing the cell's capabilities as tools.
 *
 * Identity arrives already validated — the runtime turns a verified
 * `Authorization: Bearer` token into `ctx.identity` (this cell lists `auth` in
 * `allow[]`); forged `x-auth-*` headers are ignored. Unauthenticated MCP calls
 * get `401 + WWW-Authenticate` so clients can discover the auth server.
 *
 * A few plain `GET` routes remain for human/browser discovery (and the home
 * SPA's whoami probe).
 */
import {
  defineMcpService,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from '../../platform/runtime';

const NO_STORE = { 'cache-control': 'no-store' };

function baseUrl(req: ServiceHttpRequest): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function unauthorized(req: ServiceHttpRequest, error: string): ServiceHttpResponse {
  const metadata = `${baseUrl(req)}/.well-known/oauth-protected-resource`;
  return {
    statusCode: 401,
    headers: { ...NO_STORE, 'www-authenticate': `Bearer resource_metadata="${metadata}", error="${error}"` },
    body: { error },
  };
}

// ─── MCP tools ───────────────────────────────────────────────────

/** whoami — the authenticated principal and granted scopes. */
function whoamiTool(_input: unknown, ctx: ServiceContext): { user: string; scopes: string[] } {
  return { user: ctx.identity.user ?? 'anonymous', scopes: ctx.identity.scopes };
}

/** echo — round-trips its `text` argument (a trivial connectivity check). */
function echoTool(input: { text?: string }): { text: string } {
  return { text: input?.text ?? '' };
}

// ─── Human/browser discovery routes ──────────────────────────────

function whoamiHttp(req: ServiceHttpRequest, ctx: ServiceContext): ServiceHttpResponse {
  if (!ctx.identity.user) return unauthorized(req, 'invalid_token');
  return { statusCode: 200, headers: NO_STORE, body: { user: ctx.identity.user, scopes: ctx.identity.scopes } };
}

function info(req: ServiceHttpRequest): ServiceHttpResponse {
  const origin = baseUrl(req);
  return {
    statusCode: 200,
    headers: NO_STORE,
    body: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      transport: 'streamable-http',
      mcp_endpoint: `${origin}/mcp`,
      tools: ['whoami', 'echo'],
    },
  };
}

export const handler = defineMcpService({
  name: 'resource',
  mcpPath: '/mcp',
  serverInfo: { name: 'workspace-resource', version: '1.0.0' },
  tools: {
    whoami: {
      description: 'Return the authenticated principal and granted scopes.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: whoamiTool,
    },
    echo: {
      description: 'Echo back the provided text.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to echo' } },
        required: ['text'],
        additionalProperties: false,
      },
      handler: echoTool,
    },
  },
  http: [
    { method: 'GET', path: '/mcp', handler: info },
    { method: 'GET', path: '/mcp/whoami', handler: whoamiHttp },
  ],
});

export default handler;
