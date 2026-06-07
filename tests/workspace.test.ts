/**
 * Workspace cell — the vocabulary over observed state, scoped per user.
 *
 * Drives the command factory with the in-memory store (the same seam the auth
 * cell uses to stay off DynamoDB in tests). Verifies: writes are scoped to the
 * caller's slice, recall is salience-shaped, supersede retires without deleting,
 * one user cannot see another's slice, and `remember` announces a fact event.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import type { ServiceContext } from '../platform/runtime';

/** A minimal ServiceContext for a given caller; captures emitted events. */
function ctxFor(user: string | null): { ctx: ServiceContext; emitted: Array<{ type: string; payload: unknown }> } {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const ctx = {
    identity: user ? { user, scopes: ['workspace:write', 'workspace:read'] } : null,
    config: { tableName: 'unused-in-memory' },
    events: { emit: async (type: string, payload: unknown) => void emitted.push({ type, payload }) },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
  return { ctx, emitted };
}

describe('workspace cell', () => {
  // One shared store across callers — the "one Substrate"; slices are by scope.
  const store = createMemoryStateStore();
  const cmds = createWorkspaceCommands(() => createObservedState(store));

  it('remembers a fact in the caller slice and announces it', async () => {
    const { ctx, emitted } = ctxFor('alice');
    const e = await cmds.remember({ key: 'phase', value: 'planning', via: 'remember' }, ctx);
    expect(e.value).toBe('planning');
    expect(e._meta.writer).toBe('alice');
    expect(e._meta.via).toBe('remember');
    expect(emitted).toEqual([
      { type: 'workspace.fact.written', payload: { scope: 'alice', key: 'phase', revision: 1 } },
    ]);
  });

  it('recall returns the caller view, salience-shaped with a _shaping summary', async () => {
    const { ctx } = ctxFor('alice');
    const res = await cmds.recall(undefined, ctx);
    expect(res.entries.phase.value).toBe('planning');
    expect(res._shaping.elision).toBe('auto');
    expect(res._shaping.counts.total).toBeGreaterThanOrEqual(1);
  });

  it('isolates slices — bob cannot see alice', async () => {
    const { ctx: bob } = ctxFor('bob');
    await cmds.remember({ key: 'phase', value: 'bob-only' }, bob);
    const bobView = await cmds.recall({ elision: 'none' }, bob);
    expect(Object.keys(bobView.entries)).toEqual(['phase']);
    expect(bobView.entries.phase.value).toBe('bob-only');

    const { ctx: alice } = ctxFor('alice');
    const aliceView = await cmds.recall({ elision: 'none' }, alice);
    expect(aliceView.entries.phase.value).toBe('planning');
  });

  it('peek fetches one fact; supersede retires it without deleting', async () => {
    const { ctx } = ctxFor('alice');
    expect((await cmds.peek({ key: 'phase' }, ctx))?.value).toBe('planning');

    const sup = await cmds.supersede({ key: 'phase' }, ctx);
    expect(sup?._meta.supersededBy).toBeNull(); // retired (no successor)

    const def = await cmds.recall(undefined, ctx);
    expect(def.entries.phase).toBeUndefined(); // hidden from the default view
    expect((await cmds.peek({ key: 'phase' }, ctx))?.value).toBe('planning'); // still there
  });

  it('rejects unauthenticated callers', async () => {
    const { ctx } = ctxFor(null);
    await expect(cmds.remember({ key: 'x', value: 1 }, ctx)).rejects.toThrow();
  });
});
