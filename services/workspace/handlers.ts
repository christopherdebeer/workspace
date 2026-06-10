/**
 * Workspace cell — the first flagship *room* over the observed-state substrate,
 * now with the sharing/view layer.
 *
 * There is one Substrate. A user's workspace is a *view* over it: their own
 * **slice** (`scope` = caller identity) plus the **subsets others have granted**
 * to them. The vocabulary:
 *
 *   remember  — write a fact to your slice        (put)
 *   recall    — your salience-shaped *view*        (own slice ∪ granted, shaped once)
 *   peek      — one fact by key, from your slice   (get)
 *   supersede — retire a fact                      (supersede, not delete)
 *   share     — expose a key (or your whole slice) to another user
 *   unshare   — revoke a share
 *   shared    — what you've shared, and what's shared with you
 *
 * Sharing is additive: it changes which facts `recall` assembles, not the
 * observed-state primitive. Granted facts surface under `<owner>/<key>` keys so
 * provenance is obvious and keys never collide across slices.
 *
 * Handlers are built over an injectable dependency builder so the unit tests can
 * drive them with in-memory stores, exactly as the auth cell swaps its store.
 */
import {
  ServiceContext,
  requireUser,
  createObservedState,
  type ObservedState,
  type Entry,
  type ReadResult,
  type QueryResult,
  type NeighborsResult,
  type ChangesResult,
  type AttentionResult,
  type EdgeRecord,
  type FactTimer,
  type CommandHandler,
  type RegisteredCommand,
} from '../../platform/runtime';
import {
  createDeclarativeActions,
  ACTIONS_PREFIX,
  type ActionDefinition,
  type RegisterResult,
  type InvokeResult,
} from './actions';
import {
  createRegisteredViews,
  VIEWS_PREFIX,
  type ViewDefinition,
  type ViewResult,
} from './views';
import type { EventBridgeHandler } from '../../platform/runtime';
import { createDynamoStateStore } from '../../platform/runtime/dynamo-state-store';
import {
  createDynamoGrantStore,
  type GrantStore,
  type Grant,
  WHOLE_SLICE,
} from './grants';

export interface WorkspaceDeps {
  state: ObservedState;
  grants: GrantStore;
}
export type DepsBuilder = (ctx: ServiceContext) => WorkspaceDeps;

function tableName(ctx: ServiceContext): string {
  // The shared substrate table is the home of facts + grants; the cell's own
  // table remains only as a fallback (tests/local). See docs/substrate-storage.md.
  const table = ctx.config.substrateTableName ?? ctx.config.tableName;
  if (!table) throw new Error('workspace requires the substrate table (SUBSTRATE_TABLE)');
  return table;
}

/** Production deps: observed state + grants over the shared substrate table. */
export const dynamoDeps: DepsBuilder = (ctx) => {
  const table = tableName(ctx);
  return { state: createObservedState(createDynamoStateStore(table)), grants: createDynamoGrantStore(table) };
};

export interface RememberInput {
  key: string;
  value: unknown;
  /** Optional label for how the write happened (e.g. an action name). */
  via?: string;
  /** Optional indexable fact type (e.g. "decision", "todo"). */
  type?: string;
  /** Optional tags. */
  tags?: string[];
  /** CAS: require the stored revision to equal this (0 = must not exist). */
  ifRevision?: number;
  /** CAS: require the key not to exist. */
  ifAbsent?: boolean;
  /** Lease/reveal timer, evaluated at read (no scheduler). */
  timer?: FactTimer;
}
export interface RecallInput {
  elision?: 'auto' | 'none';
  expand?: string[];
  includeSuperseded?: boolean;
}
export interface PeekInput {
  key: string;
}
export interface QueryInput {
  type?: string;
  tag?: string;
  prefix?: string;
  rankBy?: 'salience' | 'recency';
  limit?: number;
  includeSuperseded?: boolean;
}
export interface LinkInput {
  from: string;
  rel: string;
  to: string;
  strength?: number;
}
export type UnlinkInput = Omit<LinkInput, 'strength'>;
export interface NeighborsInput {
  key: string;
  dir?: 'in' | 'out' | 'both';
  rel?: string;
}
export interface ChangesInput {
  sinceSeq?: number;
  limit?: number;
}
export interface LinksInput {
  /** Only edges whose `from` or `to` starts with this prefix. */
  prefix?: string;
}
export interface AttentionInput {
  /** Age (ms) beyond which a live fact counts as stale. Default 14 days. */
  staleMs?: number;
  limit?: number;
}
export interface SupersedeInput {
  key: string;
  /** Successor key, or omitted to simply retire the fact. */
  by?: string;
  /** Re-point the fact's edges at the successor (requires `by`). */
  migrateLinks?: boolean;
}
export interface RegisterActionInput {
  action: ActionDefinition;
}
export interface DeleteActionInput {
  id: string;
}
export interface InvokeInput {
  action: string;
  params?: Record<string, unknown>;
}
export interface RegisterViewInput {
  view: ViewDefinition;
}
export interface ViewInput {
  id: string;
}
export type DeleteViewInput = ViewInput;
export interface ShareInput {
  /** The user to share with. */
  to: string;
  /** A specific fact key, or omitted to share your whole slice. */
  key?: string;
}
export type UnshareInput = ShareInput;
export interface SharedResult {
  /** Grants you have made to others. */
  shared: Grant[];
  /** Grants others have made to you. */
  receiving: Grant[];
}

// Index signature so it satisfies defineService's `Record<string, RegisteredCommand>`,
// while keeping precise per-command types for the unit tests.
export interface WorkspaceCommands extends Record<string, RegisteredCommand> {
  remember: CommandHandler<RememberInput, Entry>;
  recall: CommandHandler<RecallInput | undefined, ReadResult>;
  peek: CommandHandler<PeekInput, Entry | null>;
  query: CommandHandler<QueryInput | undefined, QueryResult>;
  link: CommandHandler<LinkInput, EdgeRecord>;
  unlink: CommandHandler<UnlinkInput, { ok: true }>;
  neighbors: CommandHandler<NeighborsInput, NeighborsResult>;
  links: CommandHandler<LinksInput | undefined, { edges: EdgeRecord[] }>;
  changes: CommandHandler<ChangesInput | undefined, ChangesResult>;
  attention: CommandHandler<AttentionInput | undefined, AttentionResult>;
  registerAction: CommandHandler<RegisterActionInput, RegisterResult>;
  actions: CommandHandler<undefined, { actions: ActionDefinition[] }>;
  deleteAction: CommandHandler<DeleteActionInput, { ok: true }>;
  invoke: CommandHandler<InvokeInput, InvokeResult>;
  registerView: CommandHandler<RegisterViewInput, ViewDefinition>;
  views: CommandHandler<undefined, { views: ViewDefinition[] }>;
  deleteView: CommandHandler<DeleteViewInput, { ok: true }>;
  view: CommandHandler<ViewInput, ViewResult>;
  supersede: CommandHandler<SupersedeInput, Entry | null>;
  share: CommandHandler<ShareInput, Grant>;
  unshare: CommandHandler<UnshareInput, { ok: true }>;
  shared: CommandHandler<undefined, SharedResult>;
  describeTools: CommandHandler<undefined, { tools: ToolDescriptor[] }>;
}

/** How the `/mcp` gateway discovers and advertises a cell's tools. */
interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Scope the gateway enforces before forwarding (null = any authenticated user). */
  scope: string | null;
  /** `read` = side-effect-free (observe); `act` = may mutate. Routes read/act dispatch. */
  kind: 'read' | 'act';
}

/**
 * The workspace vocabulary as MCP tool descriptors. Every command operates on the
 * caller's own slice (or subsets explicitly granted to them), so ownership — not a
 * scope — is the gate: `scope: null` means any authenticated principal, isolated to
 * their own data, exactly as forge treats its per-owner commands.
 */
const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: 'remember',
    description:
      'Write a fact to your workspace at `key`. Re-writing a key bumps its revision; nothing is lost. Optional `type`/`tags` make it queryable; `ifRevision`/`ifAbsent` make the write conditional (CAS — fails if the precondition does not hold).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key within your slice' },
        value: { description: 'Any JSON value to remember' },
        via: { type: 'string', description: 'Optional label for how this was written (e.g. an action name)' },
        type: { type: 'string', description: 'Optional indexable fact type (e.g. "decision", "todo")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (filterable in query)' },
        ifRevision: { type: 'number', description: 'Only write if the stored revision equals this (0 = key must not exist)' },
        ifAbsent: { type: 'boolean', description: 'Only write if the key does not exist (treats an expired lease as absent)' },
        timer: {
          type: 'object',
          description:
            'Lease/reveal timer, evaluated at read: effect "delete" = live now, vanishes at expiry (a lease); "enable" = dormant until expiry.',
          properties: {
            ms: { type: 'number', description: 'Relative expiry in ms' },
            at: { type: 'string', description: 'Absolute ISO expiry (exactly one of ms/at)' },
            effect: { type: 'string', enum: ['delete', 'enable'] },
          },
          required: ['effect'],
          additionalProperties: false,
        },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'recall',
    description:
      'Your workspace view: your own slice plus everything shared with you, salience-shaped into focus/peripheral/elided. Granted facts appear under `<owner>/<key>`.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        elision: { type: 'string', enum: ['auto', 'none'], description: "'auto' hides elided values; 'none' returns everything" },
        expand: { type: 'array', items: { type: 'string' }, description: 'Keys to force into focus' },
        includeSuperseded: { type: 'boolean', description: 'Include retired facts' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'peek',
    description: 'Read one fact by key from your slice (no salience shaping).',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Fact key to read' } },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'query',
    description:
      'Projection over your slice: filter facts by type, tag, and/or key prefix; rank by salience (default) or recency; limit. Use this instead of recall when you want a targeted subset.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Only facts of this type' },
        tag: { type: 'string', description: 'Only facts carrying this tag' },
        prefix: { type: 'string', description: 'Only keys with this prefix' },
        rankBy: { type: 'string', enum: ['salience', 'recency'], description: 'Ranking (default salience)' },
        limit: { type: 'number', description: 'Max entries to return' },
        includeSuperseded: { type: 'boolean', description: 'Include retired facts' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'link',
    description: 'Add a typed, directed edge `from --rel--> to` between two fact keys in your slice (e.g. rel: "grounds", "refines", "relates").',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source fact key' },
        rel: { type: 'string', description: 'Edge type (a verb, e.g. "grounds")' },
        to: { type: 'string', description: 'Target fact key' },
        strength: { type: 'number', description: 'Optional edge strength' },
      },
      required: ['from', 'rel', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'unlink',
    description: 'Remove an edge previously added with `link`.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        rel: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['from', 'rel', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'neighbors',
    description: 'The edges around a fact (outbound and/or inbound, optionally one rel) plus the neighbor entries — graph traversal, one hop.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The fact key to look around' },
        dir: { type: 'string', enum: ['in', 'out', 'both'], description: 'Direction (default both)' },
        rel: { type: 'string', description: 'Only edges of this type' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'links',
    description: 'Every edge in your slice (optionally filtered by a from/to key prefix) — boards and graph surfaces project their edges from this.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Only edges whose from or to starts with this prefix' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'changes',
    description: 'Tail your slice’s trajectory: events (write/read/supersede/link) after `sinceSeq`, plus the current head seq to resume from. The change feed.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: { type: 'number', description: 'Return events with seq greater than this (default 0)' },
        limit: { type: 'number', description: 'Max events' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'attention',
    description:
      'What needs tending, as a derived read: stale facts, unlinked facts, and dangling edges. The just-in-time cron — read it at session start and act on what surfaces.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        staleMs: { type: 'number', description: 'Staleness threshold in ms (default 14 days)' },
        limit: { type: 'number', description: 'Max items per category (default 25)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'registerAction',
    description:
      'Declare a no-code action: `{ id, if?, enabled?, writes[], params? }` stored as a fact at `_actions/<id>` and applied by the substrate when invoked. Writes are declared (bounded, auditable); competing write targets are surfaced, not blocked. Templates support ${params.x}/${self}/${now}; per-write ifAbsent + timer expresses an atomic, lease-bound claim.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          description: 'The action definition',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            if: { type: 'array', description: 'Preconditions (AND): [{ key, path?, op: exists|absent|eq|ne|gt|lt, value? }]', items: { type: 'object' } },
            enabled: { type: 'array', description: 'Availability conditions (same shape as if)', items: { type: 'object' } },
            writes: {
              type: 'array',
              description: 'Declared writes: [{ key, value?, ifAbsent?, timer?, type?, tags? }]',
              items: { type: 'object' },
            },
            params: { type: 'object', description: 'Param schema: { <name>: { type?, description?, enum?, required? } }' },
          },
          required: ['id', 'writes'],
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'actions',
    description: 'List the declared actions in your slice (the registered no-code vocabulary).',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'deleteAction',
    description: 'Retire a declared action (supersedes its `_actions/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'invoke',
    description:
      'Invoke a declared action by id with params. Checks enabled + if conditions (a failed precondition is a 409-style error), then applies the declared writes with substitution. The substrate interprets; no code runs.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action id' },
        params: { type: 'object', description: 'Arguments for the action' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'registerView',
    description:
      'Register a named view: `{ id, query, reduce?, path?, render? }` stored as a fact at `_views/<id>`. A view is a stored projection (the query primitive as data) with an optional reduction (list|count|latest|sum) and a render hint — the same declaration is a dashboard surface for humans and an affordance for agents.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'object',
          description: 'The view definition',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            query: { type: 'object', description: 'Query options: { type?, tag?, prefix?, rankBy?, limit?, includeSuperseded? }' },
            reduce: { type: 'string', enum: ['list', 'count', 'latest', 'sum'] },
            path: { type: 'string', description: 'Dot-path into each value, for sum' },
            render: { type: 'object', description: 'Render hint: { type: metric|table|feed|list|markdown, label?, ... }' },
          },
          required: ['id', 'query'],
        },
      },
      required: ['view'],
      additionalProperties: false,
    },
  },
  {
    name: 'views',
    description: 'List the registered views in your slice.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'view',
    description: 'Evaluate a registered view against the current slice — returns its value, count, and render hint.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The view id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'deleteView',
    description: 'Retire a registered view (supersedes its `_views/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'supersede',
    description:
      'Retire a fact (it stops surfacing in recall but is not deleted). Optionally point it at a successor key; `migrateLinks` carries its edges to the successor so the graph does not rot.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key to retire' },
        by: { type: 'string', description: 'Optional successor key' },
        migrateLinks: { type: 'boolean', description: 'Re-point edges at the successor (requires `by`)' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'share',
    description: 'Expose a fact (or your whole slice, if `key` is omitted) to another user, so it appears in their recall.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The user to share with' },
        key: { type: 'string', description: 'A specific fact key, or omit to share your whole slice' },
      },
      required: ['to'],
      additionalProperties: false,
    },
  },
  {
    name: 'unshare',
    description: 'Revoke a share previously made with `share`.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The user to revoke' },
        key: { type: 'string', description: 'The fact key, or omit for the whole-slice share' },
      },
      required: ['to'],
      additionalProperties: false,
    },
  },
  {
    name: 'shared',
    description: 'List what you have shared with others and what others have shared with you.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

/** Build the workspace vocabulary over a given way of constructing its deps. */
export function createWorkspaceCommands(build: DepsBuilder): WorkspaceCommands {
  return {
    async remember(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      const entry = await state.put(
        {
          scope,
          key: input.key,
          value: input.value,
          via: input.via,
          type: input.type,
          tags: input.tags,
          ifRevision: input.ifRevision,
          ifAbsent: input.ifAbsent,
          timer: input.timer,
        },
        ctx.identity,
      );
      await ctx.events.emit('workspace.fact.written', { scope, key: input.key, revision: entry._meta.revision });
      ctx.logger.info('workspace fact written', { scope, key: input.key, revision: entry._meta.revision });
      return entry;
    },

    async recall(input, ctx) {
      const viewer = requireUser(ctx.identity);
      const { state, grants } = build(ctx);
      const includeSuperseded = input?.includeSuperseded;

      // Own slice, scored but not yet shaped (elision:'none' keeps values present).
      const own = await state.read(viewer, { elision: 'none', includeSuperseded }, ctx.identity);
      const merged: Record<string, Entry> = { ...own.entries };

      // Fold in the subsets granted to this viewer, namespaced by owner.
      for (const g of await grants.listForGrantee(viewer)) {
        if (g.owner === viewer) continue;
        if (g.key === WHOLE_SLICE) {
          const slice = await state.read(g.owner, { elision: 'none', includeSuperseded }, ctx.identity);
          for (const [k, e] of Object.entries(slice.entries)) merged[`${g.owner}/${k}`] = e;
        } else {
          const e = await state.get(g.owner, g.key, ctx.identity);
          if (e && (!e._meta.superseded || includeSuperseded)) merged[`${g.owner}/${g.key}`] = e;
        }
      }

      // Shape the whole assembled view once.
      return state.shape(merged, { elision: input?.elision, expand: input?.expand });
    },

    async peek(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      return state.get(scope, input.key, ctx.identity);
    },

    async query(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return state.query(
        scope,
        {
          type: input?.type,
          tag: input?.tag,
          prefix: input?.prefix,
          rankBy: input?.rankBy,
          limit: input?.limit,
          includeSuperseded: input?.includeSuperseded,
        },
        ctx.identity,
      );
    },

    async link(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.from || !input?.rel || !input?.to) throw new Error('from, rel, and to are required');
      const { state } = build(ctx);
      const edge = await state.link(scope, input.from, input.rel, input.to, input.strength ?? null, ctx.identity);
      ctx.logger.info('workspace edge linked', { scope, from: edge.from, rel: edge.rel, to: edge.to });
      return edge;
    },

    async unlink(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.from || !input?.rel || !input?.to) throw new Error('from, rel, and to are required');
      const { state } = build(ctx);
      return state.unlink(scope, input.from, input.rel, input.to, ctx.identity);
    },

    async neighbors(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      return state.neighbors(scope, input.key, { dir: input.dir, rel: input.rel }, ctx.identity);
    },

    async links(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      const all = await state.edges(scope);
      const prefix = input?.prefix;
      return {
        edges: prefix ? all.filter((e) => e.from.startsWith(prefix) || e.to.startsWith(prefix)) : all,
      };
    },

    async changes(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return state.changes(scope, input?.sinceSeq ?? 0, input?.limit);
    },

    async attention(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return state.attention(scope, { staleMs: input?.staleMs, limit: input?.limit });
    },

    async registerAction(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.action) throw new Error('action is required');
      const { state } = build(ctx);
      const result = await createDeclarativeActions(state).register(scope, input.action, ctx.identity);
      ctx.logger.info('workspace action registered', {
        scope,
        action: result.action.id,
        contested: result.contested.length,
      });
      return result;
    },

    async actions(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { actions: await createDeclarativeActions(state).list(scope) };
    },

    async deleteAction(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createDeclarativeActions(state).remove(scope, input.id, ctx.identity);
    },

    async invoke(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.action) throw new Error('action is required');
      const { state } = build(ctx);
      const result = await createDeclarativeActions(state).invoke(scope, input.action, input.params ?? {}, ctx.identity);
      await ctx.events.emit('workspace.action.invoked', { scope, action: input.action });
      ctx.logger.info('workspace action invoked', { scope, action: input.action, writes: result.writes.length });
      return result;
    },

    async registerView(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.view) throw new Error('view is required');
      const { state } = build(ctx);
      const view = await createRegisteredViews(state).register(scope, input.view, ctx.identity);
      ctx.logger.info('workspace view registered', { scope, view: view.id });
      return view;
    },

    async views(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { views: await createRegisteredViews(state).list(scope) };
    },

    async deleteView(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createRegisteredViews(state).remove(scope, input.id, ctx.identity);
    },

    async view(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createRegisteredViews(state).evaluate(scope, input.id, ctx.identity);
    },

    async supersede(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      return state.supersede(scope, input.key, input.by ?? null, ctx.identity, { migrateLinks: input.migrateLinks });
    },

    async share(input, ctx) {
      const owner = requireUser(ctx.identity);
      if (!input?.to) throw new Error('to is required');
      if (input.to === owner) throw new Error('cannot share with yourself');
      const { grants } = build(ctx);
      const grant: Grant = {
        owner,
        grantee: input.to,
        key: input.key ?? WHOLE_SLICE,
        createdAt: new Date().toISOString(),
      };
      await grants.put(grant);
      await ctx.events.emit('workspace.shared', { owner, grantee: grant.grantee, key: grant.key });
      ctx.logger.info('workspace shared', { owner, grantee: grant.grantee, key: grant.key });
      return grant;
    },

    async unshare(input, ctx) {
      const owner = requireUser(ctx.identity);
      if (!input?.to) throw new Error('to is required');
      const { grants } = build(ctx);
      await grants.remove(owner, input.to, input.key ?? WHOLE_SLICE);
      return { ok: true };
    },

    async shared(_input, ctx) {
      const me = requireUser(ctx.identity);
      const { grants } = build(ctx);
      const [shared, receiving] = await Promise.all([grants.listByOwner(me), grants.listForGrantee(me)]);
      return { shared, receiving };
    },

    // How the `/mcp` gateway discovers this cell's tools (mirrors forge.describeTools).
    async describeTools() {
      return { tools: TOOL_DESCRIPTORS };
    },
  };
}

/**
 * The organ-to-reef write path: a dynamic cell emits a
 * `substrate.write.requested` event, and the workspace applies it as a fact
 * in the cell **owner's** slice with the cell as the attested writer.
 *
 * Trust model: the event's `source` is IAM-attested — each cell's role policy
 * pins `events:PutEvents` to `events:source = cell-<cellId>`, so a cell
 * cannot speak as anyone but itself. The owner is resolved through the cells
 * registry (never trusted from the event body), and the write flows through
 * the same observed-state primitive as every other write (provenance,
 * revision, trajectory). Organs may not write the declared vocabulary.
 */
export function createSubstrateWriteHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx, meta) => {
    if (!meta.source.startsWith('cell-')) {
      ctx.logger.warn('substrate write from non-cell source refused', { source: meta.source });
      return;
    }
    const cellId = meta.source.slice('cell-'.length);
    const key = detail.key;
    if (typeof key !== 'string' || !key) {
      ctx.logger.warn('substrate write without a key refused', { source: meta.source });
      return;
    }
    if (key.startsWith(ACTIONS_PREFIX) || key.startsWith(VIEWS_PREFIX)) {
      ctx.logger.warn('substrate write to reserved vocabulary refused', { source: meta.source, key });
      return;
    }
    const resolved = (await ctx.serviceClient('cells').command('resolveCell', { cellId })) as {
      owner?: string;
      name?: string;
    } | null;
    if (!resolved?.owner) {
      ctx.logger.warn('substrate write from unknown cell refused', { cellId });
      return;
    }
    const writerAddress = `@${resolved.owner}/${resolved.name ?? cellId}`;
    const { state } = build(ctx);
    const entry = await state.put(
      {
        scope: resolved.owner,
        key,
        value: detail.value,
        via: typeof detail.via === 'string' ? detail.via : writerAddress,
        type: typeof detail.type === 'string' ? detail.type : undefined,
        tags: Array.isArray(detail.tags) ? (detail.tags as string[]) : undefined,
      },
      { user: writerAddress, scopes: [] },
    );
    await ctx.events.emit('workspace.fact.written', {
      scope: resolved.owner,
      key,
      revision: entry._meta.revision,
    });
    ctx.logger.info('substrate write applied for organ', {
      cell: writerAddress,
      scope: resolved.owner,
      key,
      revision: entry._meta.revision,
    });
  };
}
