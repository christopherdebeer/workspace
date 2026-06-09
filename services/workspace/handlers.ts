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
  type CommandHandler,
  type RegisteredCommand,
} from '../../platform/runtime';
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
  changes: CommandHandler<ChangesInput | undefined, ChangesResult>;
  attention: CommandHandler<AttentionInput | undefined, AttentionResult>;
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
        ifAbsent: { type: 'boolean', description: 'Only write if the key does not exist' },
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
