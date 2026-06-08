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

/**
 * Tier-1 (kernel) cells that contribute tools to the gateway. These are few,
 * reviewed, and reached by name over an allow-listed invoke — so they stay an
 * explicit list. Tier-2 *dynamic* cells' tools are discovered at runtime from
 * the registry (see `resolveTools` → `forge.describeCellTools`), so adding those
 * never touches this gateway.
 */
const PROVIDERS = ['forge', 'workspace'] as const;

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
}

/** A dynamic-cell tool descriptor carries the routing forge needs to forward it. */
interface CellToolDescriptor extends ToolDescriptor {
  cellId: string;
  tool: string;
}

function baseUrl(req: ServiceHttpRequest): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function unauthorized(req: ServiceHttpRequest, error: string): ServiceHttpResponse {
  // RFC 9728 path-suffixed PRM location for the `/mcp` resource.
  const metadata = `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
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
      // On collision, first (kernel) provider wins.
      if (tools[d.name]) continue;
      tools[d.name] = {
        description: d.description,
        inputSchema: d.inputSchema,
        scope: d.scope ?? undefined,
        handler: (args: unknown, c: ServiceContext) => c.serviceClient(provider).command(d.name, args ?? {}),
      };
    }
  }

  // Registry-driven: fold in the tools the caller's dynamic cells advertise.
  // forge enumerates the caller's accessible cells and probes each, so a cell
  // created at runtime appears here with no gateway change. Calls are forwarded
  // through `forge.callCellTool`, which authorises by ownership.
  try {
    const res = await ctx.serviceClient('forge').command<{ tools: CellToolDescriptor[] }>('describeCellTools', {});
    for (const d of res?.tools ?? []) {
      if (tools[d.name]) continue; // kernel tools win on collision
      tools[d.name] = {
        description: d.description,
        inputSchema: d.inputSchema,
        scope: d.scope ?? undefined,
        handler: (args: unknown, c: ServiceContext) =>
          c.serviceClient('forge').command('callCellTool', { cellId: d.cellId, tool: d.tool, args: args ?? {} }),
      };
    }
  } catch (err) {
    ctx.logger.warn('dynamic cell tools aggregation failed', { error: (err as Error).message });
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
