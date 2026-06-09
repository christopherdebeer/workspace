/**
 * The platform MCP **gateway** — owns `/mcp`, the single authenticated MCP
 * surface (and the OAuth-protected resource the auth cell advertises).
 *
 * It exposes a deliberately tiny, **stable** tool surface: `whoami`, `read`, and
 * `act`. All platform capability lives in their *arguments*, not the tool list —
 * so a new cell, command, or dynamic-cell tool becomes callable the instant it
 * exists, with no `tools/list` change and no client reconnect. This is the "true
 * dynamism" the named-tool aggregation could not give (named tools are cached by
 * clients at connect). It mirrors the substrate's own read/put duality, lifted to
 * the whole platform: `read` observes, `act` effects.
 *
 *   read({ target?, input? })   — observe; side-effect-free. target "$catalog"
 *                                 (or omitted) returns the capability menu *as
 *                                 data*, always current.
 *   act ({ target, input? })    — invoke a mutating capability.
 *
 * A `target` is a dotted address:
 *   - `<cell>.<command>`        for tier-1 kernel cells (`workspace.recall`, …)
 *   - `@<owner>/<cell>.<tool>`  for tier-2 dynamic cells (`@alice/notes.add`)
 *
 * One capability registry, resolved per request from the same providers the cells
 * already describe (`describeTools` for tier-1, `describeCellTools` for tier-2);
 * `read`/`act` are two projections of it. The gateway is the policy enforcement
 * point: each capability's scope is checked against the caller before forwarding,
 * and `read`/`act` refuse to cross the read/act boundary.
 *
 * Identity arrives already validated (this cell lists `auth` in `allow[]`);
 * unauthenticated calls get `401 + WWW-Authenticate` so clients can discover the
 * auth server.
 */
import {
  defineMcpService,
  hasScope,
  requireScope,
  McpToolDefinition,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from '../../platform/runtime';

const NO_STORE = { 'cache-control': 'no-store' };

/** Tier-1 (kernel) cells whose commands are dispatchable. Few, reviewed, IAM-granted. */
const PROVIDERS = ['workspace', 'cells'] as const;

/** Sentinel target for the capability menu. */
const CATALOG = '$catalog';

/** A tier-1 tool as returned by a provider's `describeTools`. */
interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
  kind: 'read' | 'act';
}

/** A tier-2 dynamic-cell tool as returned by `forge.describeCellTools`. */
interface CellTool {
  name: string;
  address: string; // `@<owner>/<slug>`
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
  kind: 'read' | 'act';
  cellId: string;
  tool: string;
}

/** A resolved, dispatchable capability. */
interface Capability {
  target: string;
  kind: 'read' | 'act';
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
  forward: (input: unknown, ctx: ServiceContext) => Promise<unknown>;
}

/** One entry in the `read("$catalog")` menu. */
interface CatalogEntry {
  target: string;
  kind: 'read' | 'act';
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
}

function baseUrl(req: ServiceHttpRequest): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function unauthorized(req: ServiceHttpRequest, error: string): ServiceHttpResponse {
  const metadata = `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
  return {
    statusCode: 401,
    headers: { ...NO_STORE, 'www-authenticate': `Bearer resource_metadata="${metadata}", error="${error}"` },
    body: { error },
  };
}

// ─── resolution ───────────────────────────────────────────────────

/**
 * Resolve a concrete `target` to a dispatchable capability, fetching only what
 * that target needs (its provider's describe, not the whole registry). Returns
 * `null` for an unknown/unaddressable target.
 */
async function resolveTarget(ctx: ServiceContext, target: string): Promise<Capability | null> {
  if (target.startsWith('@')) {
    // @<owner>/<slug>.<tool>
    const slash = target.indexOf('/');
    const dot = target.lastIndexOf('.');
    if (slash < 0 || dot < slash + 1) return null;
    const owner = target.slice(1, slash);
    const name = target.slice(slash + 1, dot);
    const tool = target.slice(dot + 1);
    if (!owner || !name || !tool) return null;
    const res = await ctx
      .serviceClient('cells')
      .command<{ tools: CellTool[] }>('describeCellTools', { owner, name });
    const d = res?.tools?.find((t) => t.tool === tool);
    if (!d) return null;
    return {
      target,
      kind: d.kind,
      description: d.description,
      inputSchema: d.inputSchema,
      scope: d.scope,
      forward: (input, c) => c.serviceClient('cells').command('callCellTool', { owner, name, tool, args: input ?? {} }),
    };
  }

  // <cell>.<command>
  const dot = target.indexOf('.');
  if (dot < 1) return null;
  const cell = target.slice(0, dot);
  const command = target.slice(dot + 1);
  if (!(PROVIDERS as readonly string[]).includes(cell) || !command) return null;
  const res = await ctx.serviceClient(cell).command<{ tools: ProviderTool[] }>('describeTools', {});
  const d = res?.tools?.find((t) => t.name === command);
  if (!d) return null;
  return {
    target,
    kind: d.kind,
    description: d.description,
    inputSchema: d.inputSchema,
    scope: d.scope,
    forward: (input, c) => c.serviceClient(cell).command(command, input ?? {}),
  };
}

/** The capability menu, aggregated from all providers and filtered to the caller's scopes. */
async function buildCatalog(ctx: ServiceContext): Promise<CatalogEntry[]> {
  const caps: CatalogEntry[] = [];

  for (const cell of PROVIDERS) {
    try {
      const res = await ctx.serviceClient(cell).command<{ tools: ProviderTool[] }>('describeTools', {});
      for (const t of res?.tools ?? []) {
        caps.push({ target: `${cell}.${t.name}`, kind: t.kind, description: t.description, inputSchema: t.inputSchema, scope: t.scope ?? null });
      }
    } catch (err) {
      ctx.logger.warn('provider describeTools failed', { cell, error: (err as Error).message });
    }
  }

  try {
    const res = await ctx.serviceClient('cells').command<{ tools: CellTool[] }>('describeCellTools', {});
    for (const t of res?.tools ?? []) {
      caps.push({ target: `${t.address}.${t.tool}`, kind: t.kind, description: t.description, inputSchema: t.inputSchema, scope: t.scope ?? null });
    }
  } catch (err) {
    ctx.logger.warn('dynamic cell tools aggregation failed', { error: (err as Error).message });
  }

  // Advertise only what the caller is entitled to use.
  return caps.filter((c) => !c.scope || hasScope(ctx.identity, c.scope));
}

// ─── the two tools ────────────────────────────────────────────────

interface DispatchInput {
  target?: string;
  input?: unknown;
}

async function read(input: DispatchInput, ctx: ServiceContext): Promise<unknown> {
  const target = (input?.target ?? '').trim();
  if (!target || target === CATALOG) {
    return { capabilities: await buildCatalog(ctx) };
  }
  const cap = await resolveTarget(ctx, target);
  if (!cap) throw new Error(`Unknown capability: ${target}. Use read("${CATALOG}") to list what's available.`);
  if (cap.kind !== 'read') throw new Error(`"${target}" may mutate — invoke it with act, not read.`);
  if (cap.scope) requireScope(ctx.identity, cap.scope);
  return cap.forward(input?.input, ctx);
}

async function act(input: DispatchInput, ctx: ServiceContext): Promise<unknown> {
  const target = (input?.target ?? '').trim();
  if (!target) throw new Error(`act requires a \`target\`. Use read("${CATALOG}") to list capabilities.`);
  const cap = await resolveTarget(ctx, target);
  if (!cap) throw new Error(`Unknown capability: ${target}. Use read("${CATALOG}") to list what's available.`);
  if (cap.kind !== 'act') throw new Error(`"${target}" is read-only — invoke it with read, not act.`);
  if (cap.scope) requireScope(ctx.identity, cap.scope);
  return cap.forward(input?.input, ctx);
}

function whoamiTool(_input: unknown, ctx: ServiceContext): { user: string; scopes: string[] } {
  return { user: ctx.identity.user ?? 'anonymous', scopes: ctx.identity.scopes };
}

const TARGET_PROP = {
  type: 'string',
  description:
    'Dotted capability address: "<cell>.<command>" (e.g. workspace.recall) or "@<owner>/<cell>.<tool>" (e.g. @alice/notes.add).',
};
const INPUT_PROP = { type: 'object', description: 'Arguments for the capability.', additionalProperties: true };

const READ_SCHEMA = {
  type: 'object',
  properties: {
    target: { ...TARGET_PROP, description: `${TARGET_PROP.description} Omit or pass "${CATALOG}" to list everything you can read/act on.` },
    input: INPUT_PROP,
  },
  additionalProperties: false,
};
const ACT_SCHEMA = {
  type: 'object',
  properties: { target: TARGET_PROP, input: INPUT_PROP },
  required: ['target'],
  additionalProperties: false,
};

const tools: Record<string, McpToolDefinition> = {
  whoami: {
    description: 'Return the authenticated principal and granted scopes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: whoamiTool,
  },
  read: {
    description:
      'Observe a platform capability (side-effect-free), or discover them. Pass target="$catalog" (or omit target) to list every capability you can read/act on, as data — always current, no reconnect.',
    inputSchema: READ_SCHEMA,
    handler: read as McpToolDefinition['handler'],
  },
  act: {
    description:
      'Invoke a platform capability that may mutate (e.g. workspace.remember, forge.createCell, @owner/cell.tool). Discover targets with read("$catalog").',
    inputSchema: ACT_SCHEMA,
    handler: act as McpToolDefinition['handler'],
  },
};

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
      tools: ['whoami', 'read', 'act'],
      note: 'Stable surface: whoami/read/act. Capability lives in arguments — call read("$catalog") with a bearer to list what you can do.',
    },
  };
}

export const handler = defineMcpService({
  name: 'resource',
  mcpPath: '/mcp',
  serverInfo: { name: 'workspace', version: '1.0.0' },
  tools,
  http: [
    { method: 'GET', path: '/mcp', handler: info },
    { method: 'GET', path: '/mcp/whoami', handler: whoamiHttp },
  ],
});

export default handler;
