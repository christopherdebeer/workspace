/**
 * `defineMcpService` — expose a cell's capabilities as MCP tools over the
 * Streamable HTTP transport, on top of `defineService`.
 *
 * It adds a JSON-RPC 2.0 endpoint (default `POST /mcp`) that speaks the MCP
 * methods `initialize`, `tools/list`, and `tools/call`, auto-generating the tool
 * list from the declared tools and their JSON schemas. Each tool is also
 * registered as a normal command, so peers can invoke it directly.
 *
 * Auth is enforced at the HTTP layer (per the MCP authorization spec): when
 * `requireAuth` is set and the request carries no valid bearer, the endpoint
 * answers `401 + WWW-Authenticate` pointing at the protected-resource metadata,
 * which is exactly how an MCP client discovers the authorization server. Bearer
 * validation itself is handled upstream by the runtime (`ctx.identity`).
 */
import { defineService } from './define-service';
import { requireScope, hasScope } from './auth';
import type {
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
  HttpRoute,
  RegisteredCommand,
} from './types';

/** Latest MCP protocol revision this server defaults to. */
const PROTOCOL_VERSION = '2025-06-18';

/**
 * A single MCP tool: metadata for `tools/list` plus the handler for `tools/call`.
 * `Input` defaults to `never` so authors can register handlers with their own
 * concrete argument types (contravariantly assignable); the runtime narrows the
 * parsed arguments back at the single dispatch site.
 */
export interface McpToolDefinition<Input = never, Output = unknown> {
  /** Human-readable description shown to the model/client. */
  description: string;
  /** JSON Schema for the tool's arguments (defaults to an open object). */
  inputSchema?: Record<string, unknown>;
  /** Optional scope required to call the tool (enforced via `requireScope`). */
  scope?: string;
  handler: (input: Input, ctx: ServiceContext) => Promise<Output> | Output;
}

export interface McpServiceDefinition {
  /** Stable service name; must match the infra cell name. */
  name: string;
  version?: string;
  /** Path of the JSON-RPC endpoint. Defaults to `/mcp`. */
  mcpPath?: string;
  /** Advertised in `initialize`. Defaults to `{ name, version }`. */
  serverInfo?: { name: string; version: string };
  /**
   * Require a validated bearer on the MCP endpoint. When true (default), an
   * unauthenticated request gets 401 + WWW-Authenticate so the client can
   * discover the auth server and run the OAuth flow.
   */
  requireAuth?: boolean;
  tools: Record<string, McpToolDefinition>;
  /**
   * Per-request dynamic tools, merged over the static `tools` for each call.
   * Lets a cell act as an MCP **gateway**, aggregating tools from other cells
   * (resolved with the caller's identity, e.g. only the cells they own). The
   * returned tools are subject to the same scope filtering/enforcement as static
   * ones. Called once per `tools/list` and once per `tools/call`.
   */
  resolveTools?: (ctx: ServiceContext) => Promise<Record<string, McpToolDefinition>>;
  /** Extra raw HTTP routes (e.g. a human-readable GET on the same path). */
  http?: HttpRoute[];
  /** Extra non-tool commands. */
  commands?: Record<string, RegisteredCommand>;
  events?: { emits?: string[] };
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

const JSONRPC = '2.0';
const NO_STORE = { 'cache-control': 'no-store' };

function rpcResult(id: string | number | null, result: unknown): ServiceHttpResponse {
  return { statusCode: 200, headers: NO_STORE, body: { jsonrpc: JSONRPC, id, result } };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): ServiceHttpResponse {
  return { statusCode: 200, headers: NO_STORE, body: { jsonrpc: JSONRPC, id, error: { code, message } } };
}

/** 401 challenge so MCP/RFC 9728 clients can find the authorization server. */
function unauthorized(req: ServiceHttpRequest, resourcePath: string): ServiceHttpResponse {
  const u = new URL(req.url);
  // RFC 9728: the PRM URL inserts the well-known path before the resource path,
  // e.g. resource `…/mcp` → `…/.well-known/oauth-protected-resource/mcp`.
  const metadata = `${u.protocol}//${u.host}/.well-known/oauth-protected-resource${resourcePath}`;
  return {
    statusCode: 401,
    headers: { ...NO_STORE, 'www-authenticate': `Bearer resource_metadata="${metadata}"` },
    body: { error: 'invalid_token' },
  };
}

/** Wrap a tool's return value in MCP `content`. */
function toContent(value: unknown): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function defineMcpService(def: McpServiceDefinition) {
  const mcpPath = def.mcpPath ?? '/mcp';
  const requireAuth = def.requireAuth ?? true;
  const serverInfo = def.serverInfo ?? { name: def.name, version: def.version ?? '1.0.0' };

  /** Static tools plus any per-request dynamic (gateway) tools. */
  async function allTools(ctx: ServiceContext): Promise<Record<string, McpToolDefinition>> {
    if (!def.resolveTools) return def.tools;
    return { ...def.tools, ...(await def.resolveTools(ctx)) };
  }

  /** A tool is advertised only if the caller can actually use it. */
  function entitled(tool: McpToolDefinition, ctx: ServiceContext): boolean {
    return !tool.scope || hasScope(ctx.identity, tool.scope);
  }

  async function dispatch(rpc: JsonRpcRequest, ctx: ServiceContext): Promise<ServiceHttpResponse | undefined> {
    const id = (rpc.id ?? null) as string | number | null;
    const method = typeof rpc.method === 'string' ? rpc.method : '';
    const params = (rpc.params ?? {}) as Record<string, unknown>;

    // Notifications (no id) get no response body.
    if (rpc.id === undefined) {
      return undefined;
    }

    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion:
            typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo,
        });
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list': {
        const tools = await allTools(ctx);
        return rpcResult(id, {
          tools: Object.keys(tools)
            .filter((name) => entitled(tools[name], ctx))
            .map((name) => ({
              name,
              description: tools[name].description,
              inputSchema: tools[name].inputSchema ?? { type: 'object' },
            })),
        });
      }
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : '';
        const tool = (await allTools(ctx))[name];
        if (!tool) return rpcError(id, -32602, `Unknown tool: ${name}`);
        try {
          if (tool.scope) requireScope(ctx.identity, tool.scope);
          const run = tool.handler as (i: unknown, c: ServiceContext) => Promise<unknown> | unknown;
          const out = await run(params.arguments ?? {}, ctx);
          return rpcResult(id, toContent(out));
        } catch (err) {
          // Surface tool/authorization failures as an MCP tool error, not a
          // transport error, so the client can show it to the model.
          return rpcResult(id, { ...toContent((err as Error).message), isError: true });
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  async function endpoint(req: ServiceHttpRequest, ctx: ServiceContext): Promise<ServiceHttpResponse> {
    if (requireAuth && !ctx.identity.user) {
      const authz = req.headers['authorization'] ?? req.headers['Authorization'] ?? '';
      const fwd = req.headers['x-forwarded-authorization'] ?? '';
      console.warn('[mcp] 401 unauthorized', {
        path: req.path,
        hadBearer: /^Bearer\s/i.test(authz),
        hadFwdBearer: /^Bearer\s/i.test(fwd),
      });
      return unauthorized(req, mcpPath);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody ?? '');
    } catch {
      return rpcError(null, -32700, 'Parse error');
    }

    // Minimal batch support: process each request, drop notification responses.
    if (Array.isArray(payload)) {
      const out: unknown[] = [];
      for (const item of payload) {
        const res = await dispatch(item as JsonRpcRequest, ctx);
        if (res) out.push((res.body as { jsonrpc: string }) ?? res.body);
      }
      return { statusCode: 200, headers: NO_STORE, body: out };
    }

    const res = await dispatch(payload as JsonRpcRequest, ctx);
    // A notification yields no body; ack with 202.
    return res ?? { statusCode: 202, headers: NO_STORE, body: '' };
  }

  // Static tools double as directly-invocable commands (dynamic gateway tools
  // are resolved per request and forwarded, not registered here).
  const commands: Record<string, RegisteredCommand> = { ...def.commands };
  for (const name of Object.keys(def.tools)) {
    commands[name] = def.tools[name].handler as RegisteredCommand;
  }

  return defineService({
    name: def.name,
    version: def.version,
    commands,
    events: def.events,
    http: [{ method: 'POST', path: mcpPath, handler: endpoint }, ...(def.http ?? [])],
  });
}
