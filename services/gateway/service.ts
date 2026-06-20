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
  hasGrantScope,
  ServiceAuthError,
  McpToolDefinition,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
  mergeTypeDecl,
  resolveType,
} from '../../platform/runtime';

const NO_STORE = { 'cache-control': 'no-store' };

/** Tier-1 (kernel) cells whose commands are dispatchable. Few, reviewed, IAM-granted. */
// auth contributes only its small token-management vocabulary (tokens/mint/
// revoke) — the OAuth plumbing stays on its own HTTP routes.
const PROVIDERS = ['workspace', 'cells', 'auth'] as const;

/** Sentinel target for the capability menu. */
const CATALOG = '$catalog';
/** Sentinel target for the type vocabulary (docs/type-vocabulary.md). */
const TYPES = '$types';
const GRAPH = '$graph';

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
  /** Third-party-author disclosure (set by cells for non-owner callers). */
  disclosure?: { author: string; reads: string[]; note: string };
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
  /** Third-party-author disclosure for cell tools (docs/capability-consent.md). */
  disclosure?: { author: string; reads: string[]; note: string };
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
        ...(t.disclosure ? { disclosure: t.disclosure } : {}),
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
 * Enforce a capability's scope as a *teaching* denial, distinguishing three cases
 * (docs/capability-consent.md, docs/scope-grants.md §5):
 *
 *  1. effective scope covers it           → allow.
 *  2. within the token's GRANT ceiling but not the session's current focus
 *     → `scope_offer`: a self-serve widen (`auth.requestScope`), no re-consent —
 *       this is incremental authorization (a session starts minimal, widens on
 *       demand).
 *  3. outside the grant ceiling entirely   → `scope_denied`: the token is the
 *       ceiling, so the fix is a wider credential (human re-consent at
 *       /oauth/authorize, or `auth.mintToken`).
 */
function enforceScope(ctx: ServiceContext, target: string, scope: string): void {
  if (hasScope(ctx.identity, scope)) return;
  if (hasGrantScope(ctx.identity, scope)) {
    throw new ServiceAuthError(
      `scope_offer: "${target}" needs "${scope}", which is within your grant but not your session's active scope [${
        ctx.identity.scopes.join(' ') || 'none'
      }]. Widen it (no re-consent): act("auth.requestScope", { scopes: ["${scope}"] }), then retry.`,
    );
  }
  throw new ServiceAuthError(
    `scope_denied: "${target}" requires scope "${scope}" and your grant is [${
      (ctx.identity.grantScopes ?? ctx.identity.scopes).join(' ') || 'none'
    }]. A token is a ceiling — sign in again requesting the scope at /oauth/authorize (humans), or ask your human to re-consent / mint you a wider token via auth.mintToken (agents).`,
  );
}

/**
 * The type vocabulary as data — `$catalog` for *facts* rather than
 * capabilities. Returns the caller's `_types/<type>` declarations (icon /
 * label / manager / handlers), so an agent handed a fact can resolve "how do I
 * open / edit / render this type, and in which cell" uniformly. The keys are
 * the bare type names. (docs/type-vocabulary.md)
 */
async function buildTypes(ctx: ServiceContext): Promise<{ types: Record<string, unknown>; hint: string }> {
  // Canonical (global, from the cell registry) merged under the caller's
  // per-user `_types/` overrides (docs/type-vocabulary.md). The canonical half
  // is unauthenticated-friendly; the slice read fails closed for anonymous
  // callers, who simply get the global vocabulary.
  const [global, slice] = await Promise.all([
    ctx.serviceClient('cells').command<{ types?: Record<string, unknown> }>('describeTypes', {}).catch(() => ({ types: {} })),
    ctx.identity.user
      ? ctx
          .serviceClient('workspace')
          .command<{ entries?: Array<{ key: string; value: unknown }> }>('query', { prefix: '_types/', limit: 200 })
          .catch(() => ({ entries: [] }))
      : Promise.resolve({ entries: [] }),
  ]);
  // Per-facet resolve (mergeTypeDecl): a slice `_types/<type>` override wins facet
  // by facet, so overriding only `icon` no longer drops the canonical handlers/schema.
  const types: Record<string, unknown> = { ...(global?.types ?? {}) };
  for (const e of slice?.entries ?? []) {
    const t = e.key.slice('_types/'.length);
    types[t] = mergeTypeDecl(types[t], e.value);
  }
  // Additively attach the resolved `shape.fields` (ADR-0002) so clients (the home
  // form editor) get a type's fields without re-parsing prose schemas. Flat keys
  // are retained — existing consumers are unaffected.
  for (const [t, decl] of Object.entries(types)) {
    const fields = resolveType(decl, t).shape.fields;
    if (fields) types[t] = { ...(decl as Record<string, unknown>), fields };
  }
  return {
    types,
    hint: 'A fact of type T resolves through types[T].handlers[intent] (open/edit/render/create) — a surface (a cell URL), an act target, or a renderer; templated with ${id}/${match}/${value.path}.',
  };
}

async function read(input: DispatchInput, ctx: ServiceContext): Promise<unknown> {
  const target = (input?.target ?? '').trim();
  if (!target || target === CATALOG) {
    const caps = await buildCatalog(ctx);
    const detail = (input?.input as { detail?: string } | undefined)?.detail;
    if (detail === 'summary') return summarizeCatalog(caps);
    return { capabilities: caps };
  }
  if (target === TYPES) return buildTypes(ctx);
  // $graph — the Reference projection (authored + derived), the self-model's third surface.
  if (target === GRAPH) return ctx.serviceClient('workspace').command('graph', {});
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

function whoamiTool(_input: unknown, ctx: ServiceContext): { user: string; scopes: string[]; grant: string[] } {
  // `scopes` is the session's effective focus (what's enforced now); `grant` is the
  // token ceiling. They differ once a session narrows/widens (incremental auth).
  return {
    user: ctx.identity.user ?? 'anonymous',
    scopes: ctx.identity.scopes,
    grant: ctx.identity.grantScopes ?? ctx.identity.scopes,
  };
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
      'Observe a parc.land substrate capability (side-effect-free), or discover them. Pass target="$catalog" (or omit target) to list every capability you can read/act on, as data — always current, no reconnect; input {detail:"summary"} returns the grouped one-line menu. Pass target="$types" for the type vocabulary: how to open/edit/render a fact of each type, and which cell manages it.',
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
    'Prefer workspace.query (filtered, paged) over workspace.recall (the whole shaped view) for targeted reads. ' +
    'read("$types") returns the type vocabulary — how to open/edit/render a fact of a given type, and which cell manages it.',
  tools,
  http: [
    { method: 'GET', path: '/mcp', handler: info },
    { method: 'GET', path: '/mcp/whoami', handler: whoamiHttp },
  ],
});

export default handler;
