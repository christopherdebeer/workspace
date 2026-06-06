/**
 * The platform MCP **gateway** — owns `/mcp`, the single authenticated MCP
 * surface and the resource the auth cell advertises in its protected-resource
 * metadata.
 *
 * It is a `defineMcpService` whose tool list is aggregated, per request, from
 * the platform's tool-provider cells (currently `forge`): it calls each
 * provider's `describeTools`, advertises only the tools the caller is entitled
 * to (scope filtering), enforces the tool's scope, and forwards `tools/call` to
 * the owning cell — which authorises by ownership. So `/mcp` exposes all cells'
 * tools governed by auth + ownership + scopes, and a newly-created dynamic cell's
 * tools can appear here with no gateway change.
 *
 * Identity arrives already validated (this cell lists `auth` in `allow[]`);
 * unauthenticated calls get `401 + WWW-Authenticate` so clients can discover the
 * auth server.
 */
import {
  defineMcpService,
  McpToolDefinition,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from '../../platform/runtime';

const NO_STORE = { 'cache-control': 'no-store' };

/** Cells that contribute tools to the gateway (each exposes `describeTools`). */
const PROVIDERS = ['forge'] as const;

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
}

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

// ─── built-in tool ───────────────────────────────────────────────

function whoamiTool(_input: unknown, ctx: ServiceContext): { user: string; scopes: string[] } {
  return { user: ctx.identity.user ?? 'anonymous', scopes: ctx.identity.scopes };
}

// ─── aggregation ─────────────────────────────────────────────────

/**
 * Ask each provider for its tools and turn them into gateway tools whose handler
 * forwards `tools/call` to that provider (carrying the caller's identity). The
 * gateway enforces each tool's scope; the provider authorises by ownership.
 */
async function resolveTools(ctx: ServiceContext): Promise<Record<string, McpToolDefinition>> {
  const tools: Record<string, McpToolDefinition> = {};
  for (const provider of PROVIDERS) {
    let descriptors: ToolDescriptor[];
    try {
      const res = await ctx.serviceClient(provider).command<{ tools: ToolDescriptor[] }>('describeTools', {});
      descriptors = res?.tools ?? [];
    } catch (err) {
      ctx.logger.warn('provider describeTools failed', { provider, error: (err as Error).message });
      continue;
    }
    for (const d of descriptors) {
      // On collision, first provider wins (forge is the only one for now).
      if (tools[d.name]) continue;
      tools[d.name] = {
        description: d.description,
        inputSchema: d.inputSchema,
        scope: d.scope ?? undefined,
        handler: (args: unknown, c: ServiceContext) => c.serviceClient(provider).command(d.name, args ?? {}),
      };
    }
  }
  return tools;
}

// ─── human/browser discovery ─────────────────────────────────────

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
      note: 'Tool list is aggregated from platform cells and filtered by your scopes; call tools/list with a bearer.',
    },
  };
}

export const handler = defineMcpService({
  name: 'resource',
  mcpPath: '/mcp',
  serverInfo: { name: 'workspace', version: '1.0.0' },
  tools: {
    whoami: {
      description: 'Return the authenticated principal and granted scopes.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: whoamiTool,
    },
  },
  resolveTools,
  http: [
    { method: 'GET', path: '/mcp', handler: info },
    { method: 'GET', path: '/mcp/whoami', handler: whoamiHttp },
  ],
});

export default handler;
