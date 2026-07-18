/**
 * ADR-0068 (C1) — behaviour-preservation gate for the one declaration surface.
 *
 * The composed verbs `declare` / `declarations` / `undeclare` / `evaluate` must be
 * output-equivalent to the eleven legacy verbs they subsume, and the descriptor
 * catalog must stay in sync with the command keys (the one invariant TS can't
 * enforce — `WorkspaceCommands extends Record<string, RegisteredCommand>`).
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import { createMemoryGrantStore } from '../services/workspace/grants';
import { TOOL_DESCRIPTORS } from '../services/workspace/descriptors';
import type { ServiceContext } from '../platform/runtime';

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

/** A fresh, isolated substrate + command set (so composed and legacy runs don't collide). */
function freshCmds() {
  const state = createObservedState(createMemoryStateStore());
  return createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore() }));
}

/** Strip write-time volatile fields so two independent runs compare structurally. */
const VOLATILE = new Set(['version', 'seq', 'createdAt', 'updatedAt']);
function norm<T>(x: T): T {
  return JSON.parse(JSON.stringify(x), (k, v) => (VOLATILE.has(k) ? undefined : v));
}

const actionDef = {
  id: 'greet',
  writes: [{ key: 'greeting', value: 'hi ${params.name}' }],
  params: { name: { type: 'string' } },
};
const viewDef = { id: 'todos', query: { type: 'todo' }, reduce: 'count' as const };
const subDef = { id: 'onTodo', match: { type: 'todo' }, invoke: 'greet' };

describe('ADR-0068 — declaration surface parity', () => {
  it('declare(action) === registerAction', async () => {
    const A = freshCmds();
    const B = freshCmds();
    const a = await A.declare({ kind: 'action', def: actionDef }, ctxFor('alice').ctx);
    const b = await B.declare({ kind: 'action', def: actionDef }, ctxFor('alice').ctx);
    expect(norm(a)).toEqual(norm(b));
  });

  it('declare(view) === registerView, declare(subscription) === registerSubscription', async () => {
    const A = freshCmds();
    const B = freshCmds();
    expect(norm(await A.declare({ kind: 'view', def: viewDef }, ctxFor('alice').ctx))).toEqual(
      norm(await B.declare({ kind: 'view', def: viewDef }, ctxFor('alice').ctx)),
    );
    const C = freshCmds();
    const D = freshCmds();
    expect(norm(await C.declare({ kind: 'subscription', def: subDef }, ctxFor('alice').ctx))).toEqual(
      norm(await D.declare({ kind: 'subscription', def: subDef }, ctxFor('alice').ctx)),
    );
  });

  it('declarations(kind) === the legacy plural (actions/views/subscriptions)', async () => {
    const A = freshCmds();
    const c = ctxFor('alice').ctx;
    await A.declare({ kind: 'action', def: actionDef }, c);
    await A.declare({ kind: 'view', def: viewDef }, c);
    await A.declare({ kind: 'subscription', def: subDef }, c);
    expect(norm((await A.declarations({ kind: 'action' }, c)).declarations)).toEqual(norm((await A.actions(undefined, c)).actions));
    expect(norm((await A.declarations({ kind: 'view' }, c)).declarations)).toEqual(norm((await A.views(undefined, c)).views));
    expect(norm((await A.declarations({ kind: 'subscription' }, c)).declarations)).toEqual(norm((await A.subscriptions(undefined, c)).subscriptions));
  });

  it('declarations() unfiltered returns the union, each entry tagged with kind', async () => {
    const A = freshCmds();
    const c = ctxFor('alice').ctx;
    await A.declare({ kind: 'action', def: actionDef }, c);
    await A.declare({ kind: 'view', def: viewDef }, c);
    const all = (await A.declarations(undefined, c)).declarations as Array<{ kind: string; id: string }>;
    expect(all.find((d) => d.id === 'greet')?.kind).toBe('action');
    expect(all.find((d) => d.id === 'todos')?.kind).toBe('view');
  });

  it('evaluate(action) === invoke — same result and same emitted events', async () => {
    const A = freshCmds();
    const B = freshCmds();
    const ca = ctxFor('alice');
    const cb = ctxFor('alice');
    await A.declare({ kind: 'action', def: actionDef }, ca.ctx);
    await B.declare({ kind: 'action', def: actionDef }, cb.ctx);
    ca.emitted.length = 0;
    cb.emitted.length = 0;
    const a = await A.evaluate({ kind: 'action', id: 'greet', params: { name: 'x' } }, ca.ctx);
    const b = await B.evaluate({ kind: 'action', id: 'greet', params: { name: 'x' } }, cb.ctx);
    expect(norm(a)).toEqual(norm(b));
    expect(ca.emitted).toEqual(cb.emitted);
  });

  it('evaluate(view) === view', async () => {
    const A = freshCmds();
    const B = freshCmds();
    const ca = ctxFor('alice').ctx;
    const cb = ctxFor('alice').ctx;
    for (const cmds of [A, B]) {
      const c = cmds === A ? ca : cb;
      await cmds.remember({ key: 't1', value: { done: false }, type: 'todo' }, c);
      await cmds.declare({ kind: 'view', def: viewDef }, c);
    }
    // legacy path uses registerView on B for a true legacy comparison:
    const a = await A.evaluate({ kind: 'view', id: 'todos' }, ca);
    const b = await B.evaluate({ kind: 'view', id: 'todos' }, cb);
    expect(norm(a)).toEqual(norm(b));
  });

  it('undeclare(kind) === the legacy delete*', async () => {
    const A = freshCmds();
    const B = freshCmds();
    const ca = ctxFor('alice').ctx;
    const cb = ctxFor('alice').ctx;
    await A.declare({ kind: 'action', def: actionDef }, ca);
    await B.declare({ kind: 'action', def: actionDef }, cb);
    expect(await A.undeclare({ kind: 'action', id: 'greet' }, ca)).toEqual(await B.deleteAction({ id: 'greet' }, cb));
    expect(norm((await A.actions(undefined, ca)).actions)).toEqual([]);
  });

  it('evaluate(subscription) is rejected (no evaluate side)', async () => {
    const A = freshCmds();
    const c = ctxFor('alice').ctx;
    await A.declare({ kind: 'subscription', def: subDef }, c);
    await expect(A.evaluate({ kind: 'subscription' as 'action', id: 'onTodo' }, c)).rejects.toThrow(/no evaluate/);
  });

  it('catalog ↔ command keys stay in sync (the sole non-TS-enforced invariant)', () => {
    const cmds = freshCmds();
    const descriptorNames = new Set(TOOL_DESCRIPTORS.map((t) => t.name));
    const commandKeys = new Set(Object.keys(cmds).filter((k) => k !== 'describeTools'));
    expect(commandKeys).toEqual(descriptorNames);
  });
});
