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
  if (!ctx.config.tableName) throw new Error('workspace requires a DynamoDB table (TABLE_NAME)');
  return ctx.config.tableName;
}

/** Production deps: observed state + grants over the cell's own DynamoDB table. */
export const dynamoDeps: DepsBuilder = (ctx) => {
  const table = tableName(ctx);
  return { state: createObservedState(createDynamoStateStore(table)), grants: createDynamoGrantStore(table) };
};

export interface RememberInput {
  key: string;
  value: unknown;
  /** Optional label for how the write happened (e.g. an action name). */
  via?: string;
}
export interface RecallInput {
  elision?: 'auto' | 'none';
  expand?: string[];
  includeSuperseded?: boolean;
}
export interface PeekInput {
  key: string;
}
export interface SupersedeInput {
  key: string;
  /** Successor key, or omitted to simply retire the fact. */
  by?: string;
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
    description: 'Write a fact to your workspace at `key`. Re-writing a key bumps its revision; nothing is lost.',
    scope: null,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key within your slice' },
        value: { description: 'Any JSON value to remember' },
        via: { type: 'string', description: 'Optional label for how this was written (e.g. an action name)' },
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
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Fact key to read' } },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'supersede',
    description: 'Retire a fact (it stops surfacing in recall but is not deleted). Optionally point it at a successor key.',
    scope: null,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key to retire' },
        by: { type: 'string', description: 'Optional successor key' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'share',
    description: 'Expose a fact (or your whole slice, if `key` is omitted) to another user, so it appears in their recall.',
    scope: null,
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
      const entry = await state.put({ scope, key: input.key, value: input.value, via: input.via }, ctx.identity);
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

    async supersede(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      return state.supersede(scope, input.key, input.by ?? null, ctx.identity);
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
