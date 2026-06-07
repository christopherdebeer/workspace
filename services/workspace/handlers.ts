/**
 * Workspace cell — the first flagship *room* over the observed-state substrate.
 *
 * A user's workspace is their **slice** of the one Substrate: `scope` is the
 * caller's identity, and the commands are a small **vocabulary** over the
 * observed-state primitive (`platform/runtime/state.ts`):
 *
 *   remember  — write a fact            (put)
 *   recall    — the salience-shaped view (read)
 *   peek      — one fact by key          (get)
 *   supersede — retire a fact            (supersede, not delete)
 *
 * Sharing — exposing *subsets* of one user's slice into another user's view — is
 * the next, additive layer: it changes which scopes `recall` assembles, not the
 * primitive or these handlers. For now each user sees their own slice.
 *
 * The handlers are built over an injectable `StateBuilder` so the unit tests can
 * drive them with the in-memory store, exactly as the auth cell swaps its store.
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

export type StateBuilder = (ctx: ServiceContext) => ObservedState;

function tableName(ctx: ServiceContext): string {
  if (!ctx.config.tableName) throw new Error('workspace requires a DynamoDB table (TABLE_NAME)');
  return ctx.config.tableName;
}

/** Production builder: observed state over the cell's own DynamoDB table. */
export const dynamoStateBuilder: StateBuilder = (ctx) =>
  createObservedState(createDynamoStateStore(tableName(ctx)));

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

// Index signature so it satisfies defineService's `Record<string, RegisteredCommand>`,
// while keeping precise per-command types for the unit tests.
export interface WorkspaceCommands extends Record<string, RegisteredCommand> {
  remember: CommandHandler<RememberInput, Entry>;
  recall: CommandHandler<RecallInput | undefined, ReadResult>;
  peek: CommandHandler<PeekInput, Entry | null>;
  supersede: CommandHandler<SupersedeInput, Entry | null>;
}

/** Build the workspace vocabulary over a given way of constructing observed state. */
export function createWorkspaceCommands(build: StateBuilder): WorkspaceCommands {
  return {
    async remember(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const state = build(ctx);
      const entry = await state.put({ scope, key: input.key, value: input.value, via: input.via }, ctx.identity);
      await ctx.events.emit('workspace.fact.written', {
        scope,
        key: input.key,
        revision: entry._meta.revision,
      });
      ctx.logger.info('workspace fact written', { scope, key: input.key, revision: entry._meta.revision });
      return entry;
    },

    async recall(input, ctx) {
      const scope = requireUser(ctx.identity);
      const state = build(ctx);
      return state.read(
        scope,
        {
          elision: input?.elision,
          expand: input?.expand,
          includeSuperseded: input?.includeSuperseded,
        },
        ctx.identity,
      );
    },

    async peek(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const state = build(ctx);
      return state.get(scope, input.key, ctx.identity);
    },

    async supersede(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const state = build(ctx);
      return state.supersede(scope, input.key, input.by ?? null, ctx.identity);
    },
  };
}
