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
  ServiceAuthError,
  McpToolDefinition,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from '../../platform/runtime';

const NO_STORE = { 'cache-control': 'no-store' };

/** Tier-1 (kernel) cells whose commands are dispatchable. Few, reviewed, IAM-granted. */
// auth contributes only its small token-management vocabulary (tokens/mint/
// revoke) — the OAuth plumbing stays on its own HTTP routes.
const PROVIDERS = ['workspace', 'cells', 'auth'] as const;

/** Sentinel target for the capability menu. */
const CATALOG = '$catalog';

/** A tier-1 tool as returned by a provider's `describeTools`. */
interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The declared result envelope, when the provider documents it. */
  resultSchema?: Record<string, unknown>;
  scope: string | null;
  kind: 'read' | 'act';
}

/** A tier-2 dynamic-cell tool as returned by `forge.describeCellTools`. */
interface CellTool {
  name: string;
  address: string; // `@<owner>/<slug>`
  description: string;
  inputSchema: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
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
  /** The declared result envelope — self-documentation's read direction. */
  resultSchema?: Record<string, unknown>;
  scope: string | null;
}

/** One capability in the summary catalog: enough to decide, not to call. */
interface CatalogSummaryEntry {
  target: string;
  kind: 'read' | 'act';
  /** First sentence of the description. */
  summary: string;
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
        caps.push({
          target: `${cell}.${t.name}`,
          kind: t.kind,
          description: t.description,
          inputSchema: t.inputSchema,
          ...(t.resultSchema ? { resultSchema: t.resultSchema } : {}),
          scope: t.scope ?? null,
        });
      }
    } catch (err) {
      ctx.logger.warn('provider describeTools failed', { cell, error: (err as Error).message });
    }
  }

  try {
    const res = await ctx.serviceClient('cells').command<{ tools: CellTool[] }>('describeCellTools', {});
    for (const t of res?.tools ?? []) {
      caps.push({
        target: `${t.address}.${t.tool}`,
        kind: t.kind,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.resultSchema ? { resultSchema: t.resultSchema } : {}),
        scope: t.scope ?? null,
      });
    }
  } catch (err) {
    ctx.logger.warn('dynamic cell tools aggregation failed', { error: (err as Error).message });
  }

  // Advertise only what the caller is entitled to use.
  return caps.filter((c) => !c.scope || hasScope(ctx.identity, c.scope));
}

/** The cell-name half of a target (`workspace.recall` → `workspace`; `@a/b.t` → `@a/b`). */
function cellOf(target: string): string {
  const dot = target.startsWith('@') ? target.lastIndexOf('.') : target.indexOf('.');
  return dot > 0 ? target.slice(0, dot) : target;
}

/** First sentence of a description — enough to decide whether to drill in. */
function firstSentence(text: string): string {
  const m = text.match(/^[^.!?]*[.!?]/);
  return (m ? m[0] : text).trim();
}

/**
 * The summary catalog: capabilities grouped by cell, one line each, no schemas
 * — a fraction of the full catalog's weight. Progressive disclosure for the
 * menu itself: skim here, then `read("$catalog")` or a single target resolve
 * for the full contract.
 */
function summarizeCatalog(caps: CatalogEntry[]): {
  cells: Array<{ cell: string; count: number; capabilities: CatalogSummaryEntry[] }>;
  hint: string;
} {
  const byCell = new Map<string, CatalogSummaryEntry[]>();
  for (const c of caps) {
    const cell = cellOf(c.target);
    const list = byCell.get(cell) ?? [];
    list.push({ target: c.target, kind: c.kind, summary: firstSentence(c.description) });
    byCell.set(cell, list);
  }
  return {
    cells: [...byCell.entries()].map(([cell, capabilities]) => ({ cell, count: capabilities.length, capabilities })),
    hint: 'Summary view. read("$catalog") without detail returns full input/result schemas.',
  };
}

// ─── the two tools ────────────────────────────────────────────────

interface DispatchInput {
  target?: string;
  input?: unknown;
}

/**
 * Enforce a capability's scope, and make the denial a teaching affordance
 * (docs/scope-grants.md §5): the token is the ceiling here, so the fix is a
 * wider credential — re-consent or a grant from an admin — not a grant
 * request to a resource owner (that case is `grant_denied`, raised by the
 * resource cells themselves).
 */
function enforceScope(ctx: ServiceContext, target: string, scope: string): void {
  try {
    requireScope(ctx.identity, scope);
  } catch {
    throw new ServiceAuthError(
      `scope_denied: "${target}" requires scope "${scope}" and your token carries [${
        ctx.identity.scopes.join(' ') || 'none'
      }]. A token is a ceiling — sign in again requesting the scope at /oauth/authorize (humans), or ask your human to re-consent / mint you a wider token via auth.mintToken (agents).`,
    );
  }
}

async function read(input: DispatchInput, ctx: ServiceContext): Promise<unknown> {
  const target = (input?.target ?? '').trim();
  if (!target || target === CATALOG) {
    const caps = await buildCatalog(ctx);
    const detail = (input?.input as { detail?: string } | undefined)?.detail;
    if (detail === 'summary') return summarizeCatalog(caps);
    return { capabilities: caps };
  }
  const cap = await resolveTarget(ctx, target);
  if (!cap) throw new Error(`Unknown capability: ${target}. Use read("${CATALOG}") to list what's available.`);
  if (cap.kind !== 'read') throw new Error(`"${target}" may mutate — invoke it with act, not read.`);
  if (cap.scope) enforceScope(ctx, target, cap.scope);
  return cap.forward(input?.input, ctx);
}

async function act(input: DispatchInput, ctx: ServiceContext): Promise<unknown> {
  const target = (input?.target ?? '').trim();
  if (!target) throw new Error(`act requires a \`target\`. Use read("${CATALOG}") to list capabilities.`);
  const cap = await resolveTarget(ctx, target);
  if (!cap) throw new Error(`Unknown capability: ${target}. Use read("${CATALOG}") to list what's available.`);
  if (cap.kind !== 'act') throw new Error(`"${target}" is read-only — invoke it with read, not act.`);
  if (cap.scope) enforceScope(ctx, target, cap.scope);
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
    input: {
      ...INPUT_PROP,
      description: `${INPUT_PROP.description} For "${CATALOG}": { detail: "summary" } returns capabilities grouped by cell, one line each, no schemas.`,
    },
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
    title: 'Who am I',
    description: 'Return the authenticated principal and granted scopes on the parc.land substrate.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    handler: whoamiTool,
  },
  read: {
    title: 'Observe the substrate',
    description:
      'Observe a parc.land substrate capability (side-effect-free), or discover them. Pass target="$catalog" (or omit target) to list every capability you can read/act on, as data — always current, no reconnect; input {detail:"summary"} returns the grouped one-line menu.',
    inputSchema: READ_SCHEMA,
    annotations: { readOnlyHint: true },
    handler: read as McpToolDefinition['handler'],
  },
  act: {
    title: 'Act on the substrate',
    description:
      'Invoke a parc.land substrate capability that may mutate (e.g. workspace.remember, cells.create, @owner/cell.tool). Discover targets with read("$catalog").',
    inputSchema: ACT_SCHEMA,
    // No destructiveHint:false — cells.delete is genuinely destructive; the
    // substrate side supersedes-not-deletes, but act spans both.
    annotations: { readOnlyHint: false },
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
      name: 'parc.land substrate',
      tools: ['whoami', 'read', 'act'],
      note: 'Stable surface: whoami/read/act. Capability lives in arguments — call read("$catalog") with a bearer to list what you can do ({detail:"summary"} for the grouped one-line menu).',
    },
  };
}

export const handler = defineMcpService({
  name: 'gateway',
  mcpPath: '/mcp',
  serverInfo: { name: 'parc-substrate', title: 'parc.land substrate', version: '1.0.0' },
  // The spec's `instructions` field: the server's self-introduction, surfaced
  // into the model's context at connect — discovery must not depend on a
  // client knowing what "read/act" means here.
  instructions:
    'The parc.land substrate: a personal productivity workspace of facts `{value, _meta}` with provenance, salience, links, declared actions/views, and deployable cells. ' +
    'Three verbs: whoami (identity), read (observe), act (mutate). All capability lives in the `target` argument — start with read("$catalog", {detail:"summary"}) for the grouped menu, ' +
    'read("$catalog") for full schemas. Targets look like workspace.query or @owner/cell.tool. ' +
    'Prefer workspace.query (filtered, paged) over workspace.recall (the whole shaped view) for targeted reads.',
  tools,
  http: [
    { method: 'GET', path: '/mcp', handler: info },
    { method: 'GET', path: '/mcp/whoami', handler: whoamiHttp },
  ],
});

export default handler;
