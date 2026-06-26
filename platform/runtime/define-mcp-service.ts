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
  /** Spec display name (clients show this instead of the programmatic name). */
  title?: string;
  /** JSON Schema for the tool's arguments (defaults to an open object). */
  inputSchema?: Record<string, unknown>;
  /** JSON Schema for the tool's result (spec `outputSchema`) — declares the read direction. */
  outputSchema?: Record<string, unknown>;
  /**
   * Spec tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
   * `openWorldHint`) — how clients learn a tool's blast radius without calling it.
   */
  annotations?: Record<string, unknown>;
  /** Optional scope required to call the tool (enforced via `requireScope`). */
  scope?: string;
  handler: (input: Input, ctx: ServiceContext) => Promise<Output> | Output;
  /**
   * MCP-Apps widget binding (ADR-0034 / io.modelcontextprotocol/ui spec 2026-01-26):
   * a STATIC `ui://` resource the host preloads and renders for this tool, surfaced
   * in `tools/list` as the tool's `_meta.ui.resourceUri`. The widget receives the
   * call's `structuredContent` via the host's `ui/notifications/tool-result` channel.
   */
  ui?: { resourceUri: string; visibility?: string[] };
}

/** One MCP resource's contents (the `resources/read` reply, ADR-0034). */
export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  /** Text payload (HTML for an MCP-Apps `ui://` widget). */
  text?: string;
  /** Base64 payload for binary resources. */
  blob?: string;
}

/** A resource descriptor for `resources/list`. */
export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  title?: string;
  mimeType?: string;
  description?: string;
}

/**
 * A rich tool result (ADR-0034): splits the model-facing `text` summary from the
 * `data` channel (which becomes `structuredContent` for clients/widgets). Return one
 * via `mcpResult(...)` when the succinct text should differ from the full data
 * (ADR-0033); a plain value still works (text + structuredContent for objects). The
 * MCP-Apps widget binding lives on the tool *definition* (`McpToolDefinition.ui`),
 * not here.
 */
export interface McpToolResult {
  readonly __mcp: 'tool-result';
  /** Structured data — becomes `structuredContent` and (unless `text` is set) the text block. */
  data: unknown;
  /** Model-facing text override (ADR-0033 succinct summary); defaults to JSON of `data`. */
  text?: string;
}

/** Build a rich tool result splitting the model-facing text from the structured data. */
export function mcpResult(data: unknown, opts?: { text?: string }): McpToolResult {
  return { __mcp: 'tool-result', data, text: opts?.text };
}

function isRichResult(v: unknown): v is McpToolResult {
  return !!v && typeof v === 'object' && (v as { __mcp?: unknown }).__mcp === 'tool-result';
}

export interface McpServiceDefinition {
  /** Stable service name; must match the infra cell name. */
  name: string;
  version?: string;
  /** Path of the JSON-RPC endpoint. Defaults to `/mcp`. */
  mcpPath?: string;
  /**
   * Extra handshake `capabilities` keys merged over the defaults (ADR-0034) — e.g.
   * the MCP-Apps `io.modelcontextprotocol/ui` extension. `resources` is added
   * automatically when `resources.read` is provided.
   */
  capabilities?: Record<string, unknown>;
  /**
   * Resource serving (ADR-0034): `read` resolves a URI (e.g. a `ui://` MCP-Apps
   * widget) to its contents; `list` enumerates them. Providing `read` makes the
   * server declare the `resources` capability and answer `resources/read`.
   */
  resources?: {
    read: (uri: string, ctx: ServiceContext) => Promise<McpResourceContents | null> | McpResourceContents | null;
    list?: (ctx: ServiceContext) => Promise<McpResourceDescriptor[]> | McpResourceDescriptor[];
  };
  /** Advertised in `initialize`. Defaults to `{ name, version }`. `title` is the spec's display name. */
  serverInfo?: { name: string; version: string; title?: string };
  /**
   * Advertised in `initialize` as the spec's `instructions` field — the
   * server's self-introduction, surfaced into the client's context. This is
   * the one channel a server controls to teach a model what it is *before*
   * the first tool call; leaving it empty means discovery starts from tool
   * names alone.
   */
  instructions?: string;
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

/**
 * Wrap a tool's return value in MCP `content`. Per spec 2025-06-18 (and ADR-0034),
 * an object result is ALSO returned as `structuredContent` — the data channel a
 * client (or an MCP-Apps widget) consumes directly, alongside the `text` block the
 * model reasons over (the same text-vs-data split ADR-0033 made for `recall`).
 * structuredContent must be a JSON object, so arrays/scalars stay text-only.
 */
function toContent(value: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
} {
  // A rich result (ADR-0034) splits the channels explicitly: `text` for the model,
  // `data` for structuredContent/widget, `ui` → the result's `_meta.ui.resourceUri`.
  if (isRichResult(value)) {
    const data = value.data;
    const text = value.text ?? (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    const out: ReturnType<typeof toContent> = { content: [{ type: 'text', text }] };
    if (data && typeof data === 'object' && !Array.isArray(data)) out.structuredContent = data as Record<string, unknown>;
    return out;
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const base = { content: [{ type: 'text' as const, text }] };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...base, structuredContent: value as Record<string, unknown> };
  }
  return base;
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
          capabilities: {
            tools: {},
            // `resources` is declared only when we actually answer resources/read,
            // and never advertises `subscribe` (no SSE under CloudFront — ADR-0034).
            ...(def.resources ? { resources: { listChanged: false } } : {}),
            ...(def.capabilities ?? {}),
          },
          serverInfo,
          ...(def.instructions ? { instructions: def.instructions } : {}),
        });
      case 'ping':
        return rpcResult(id, {});
      case 'resources/list': {
        if (!def.resources?.list) return rpcResult(id, { resources: [] });
        const resources = await def.resources.list(ctx);
        return rpcResult(id, { resources });
      }
      case 'resources/read': {
        if (!def.resources?.read) return rpcError(id, -32601, `Method not found: ${method}`);
        const uri = typeof params.uri === 'string' ? params.uri : '';
        if (!uri) return rpcError(id, -32602, 'resources/read requires a uri');
        const found = await def.resources.read(uri, ctx);
        if (!found) return rpcError(id, -32602, `Resource not found: ${uri}`);
        const entry: Record<string, unknown> = { uri: found.uri, ...(found.mimeType ? { mimeType: found.mimeType } : {}) };
        if (found.text !== undefined) entry.text = found.text;
        if (found.blob !== undefined) entry.blob = found.blob;
        return rpcResult(id, { contents: [entry] });
      }
      case 'tools/list': {
        const tools = await allTools(ctx);
        return rpcResult(id, {
          tools: Object.keys(tools)
            .filter((name) => entitled(tools[name], ctx))
            .map((name) => {
              const t = tools[name];
              return {
                name,
                ...(t.title ? { title: t.title } : {}),
                description: t.description,
                inputSchema: t.inputSchema ?? { type: 'object' },
                ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
                ...(t.annotations ? { annotations: t.annotations } : {}),
                // MCP-Apps tool→UI binding (spec 2026-01-26): the host preloads this
                // `ui://` resource and renders it with the call's structuredContent.
                ...(t.ui ? { _meta: { ui: { resourceUri: t.ui.resourceUri, visibility: t.ui.visibility ?? ['model', 'app'] } } } : {}),
              };
            }),
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
          // The widget binding is static on the tool def (surfaced in tools/list); the
          // call result just carries content + structuredContent, which the host
          // forwards to the bound widget via `ui/notifications/tool-result`.
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

  // Cross-origin access for host-isolated cells (docs/cell-origin-isolation.md):
  // a cell on `<owner>-<name>.on.parc.land` calls the apex `/mcp` with its scoped
  // bearer in the Authorization header. Reflect only origins under the configured
  // suffix (`MCP_CORS_ORIGIN_SUFFIX`, e.g. ".on.parc.land"); unset ⇒ no CORS.
  // Credentialless (bearer header, never the cookie), so no CSRF surface.
  function corsHeaders(req: ServiceHttpRequest): Record<string, string> {
    const suffix = process.env.MCP_CORS_ORIGIN_SUFFIX;
    if (!suffix) return {};
    const origin = req.headers['origin'] ?? req.headers['Origin'];
    if (!origin || !origin.startsWith('https://') || !origin.endsWith(suffix)) return {};
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    };
  }

  function preflight(req: ServiceHttpRequest): ServiceHttpResponse {
    return { statusCode: 204, headers: { ...NO_STORE, ...corsHeaders(req) }, body: '' };
  }

  async function endpoint(req: ServiceHttpRequest, ctx: ServiceContext): Promise<ServiceHttpResponse> {
    const cors = corsHeaders(req);
    const withCors = (r: ServiceHttpResponse): ServiceHttpResponse => ({ ...r, headers: { ...(r.headers ?? {}), ...cors } });
    if (requireAuth && !ctx.identity.user) {
      const authz = req.headers['authorization'] ?? req.headers['Authorization'] ?? '';
      const fwd = req.headers['x-forwarded-authorization'] ?? '';
      console.warn('[mcp] 401 unauthorized', {
        path: req.path,
        hadBearer: /^Bearer\s/i.test(authz),
        hadFwdBearer: /^Bearer\s/i.test(fwd),
      });
      return withCors(unauthorized(req, mcpPath));
    }

    let payload: unknown;
    try {
      payload = JSON.parse(req.rawBody ?? '');
    } catch {
      return withCors(rpcError(null, -32700, 'Parse error'));
    }

    // Minimal batch support: process each request, drop notification responses.
    if (Array.isArray(payload)) {
      const out: unknown[] = [];
      for (const item of payload) {
        const res = await dispatch(item as JsonRpcRequest, ctx);
        if (res) out.push((res.body as { jsonrpc: string }) ?? res.body);
      }
      return withCors({ statusCode: 200, headers: NO_STORE, body: out });
    }

    const res = await dispatch(payload as JsonRpcRequest, ctx);
    // A notification yields no body; ack with 202.
    return withCors(res ?? { statusCode: 202, headers: NO_STORE, body: '' });
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
    http: [
      { method: 'POST', path: mcpPath, handler: endpoint },
      { method: 'OPTIONS', path: mcpPath, handler: preflight },
      ...(def.http ?? []),
    ],
  });
}
