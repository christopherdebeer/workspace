/**
 * Workspace cell — the vocabulary over observed state, scoped per user.
 *
 * Drives the command factory with the in-memory store (the same seam the auth
 * cell uses to stay off DynamoDB in tests). Verifies: writes are scoped to the
 * caller's slice, recall is salience-shaped, supersede retires without deleting,
 * one user cannot see another's slice, and `remember` announces a fact event.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createMemoryGrantStore } from '../services/workspace/grants';
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
  // One shared substrate + one grant store across callers — the "one Substrate";
  // slices are by scope, views are assembled per caller.
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

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

describe('workspace sharing / view layer', () => {
  // One Substrate; recall assembles each caller's view (own slice ∪ granted).
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  beforeAll(async () => {
    await cmds.remember({ key: 'roadmap', value: 'Q3 plan' }, ctxFor('alice').ctx);
    await cmds.remember({ key: 'secret', value: 'private' }, ctxFor('alice').ctx);
    await cmds.remember({ key: 'mine', value: 'bob stuff' }, ctxFor('bob').ctx);
  });

  it('shares a single key into the grantee view, namespaced by owner, and announces it', async () => {
    const { ctx: alice, emitted } = ctxFor('alice');
    const g = await cmds.share({ to: 'bob', key: 'roadmap' }, alice);
    expect(g).toMatchObject({ owner: 'alice', grantee: 'bob', key: 'roadmap' });
    expect(emitted).toContainEqual({
      type: 'workspace.shared',
      payload: { owner: 'alice', grantee: 'bob', key: 'roadmap' },
    });

    const bobView = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bobView.entries['mine'].value).toBe('bob stuff'); // own slice
    expect(bobView.entries['alice/roadmap'].value).toBe('Q3 plan'); // granted subset
    expect(bobView.entries['alice/secret']).toBeUndefined(); // not granted
  });

  it('leaves the owner view unchanged (alice never sees bob)', async () => {
    const aliceView = await cmds.recall({ elision: 'none' }, ctxFor('alice').ctx);
    expect(Object.keys(aliceView.entries).sort()).toEqual(['roadmap', 'secret']);
  });

  it('unshare revokes visibility', async () => {
    await cmds.unshare({ to: 'bob', key: 'roadmap' }, ctxFor('alice').ctx);
    const bobView = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bobView.entries['alice/roadmap']).toBeUndefined();
    expect(bobView.entries['mine'].value).toBe('bob stuff');
  });

  it('whole-slice share exposes every non-superseded fact of the owner', async () => {
    await cmds.share({ to: 'bob' }, ctxFor('alice').ctx); // no key → whole slice
    const bobView = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bobView.entries['alice/roadmap'].value).toBe('Q3 plan');
    expect(bobView.entries['alice/secret'].value).toBe('private');
  });

  it('shared() reports outgoing and incoming grants', async () => {
    const aliceShared = await cmds.shared(undefined, ctxFor('alice').ctx);
    expect(aliceShared.shared.some((g) => g.grantee === 'bob' && g.key === '*')).toBe(true);
    expect(aliceShared.receiving).toEqual([]);

    const bobShared = await cmds.shared(undefined, ctxFor('bob').ctx);
    expect(bobShared.receiving.some((g) => g.owner === 'alice' && g.key === '*')).toBe(true);
    expect(bobShared.shared).toEqual([]);
  });

  it('describeTools advertises the whole vocabulary for the /mcp gateway', async () => {
    const { tools } = await cmds.describeTools(undefined, ctxFor('alice').ctx);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'peek', 'recall', 'remember', 'shared', 'share', 'supersede', 'unshare',
        'query', 'link', 'unlink', 'neighbors', 'changes', 'attention',
      ].sort(),
    );
    // Per-slice ops gate on ownership, not scopes — so the gateway advertises them
    // to any authenticated principal.
    expect(tools.every((t) => t.scope === null)).toBe(true);
    // Every tool ships a JSON Schema the gateway can surface to clients.
    expect(tools.every((t) => (t.inputSchema as { type?: string }).type === 'object')).toBe(true);
    const remember = tools.find((t) => t.name === 'remember')!;
    expect(remember.inputSchema).toMatchObject({ required: ['key', 'value'] });
    // Each tool declares read/act so the gateway can route read vs act dispatch.
    expect(remember.kind).toBe('act');
    expect(tools.find((t) => t.name === 'recall')!.kind).toBe('read');
    expect(new Set(tools.map((t) => t.kind))).toEqual(new Set(['read', 'act']));
  });
});

describe('workspace substrate primitives (query / CAS / links / changes / attention)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const alice = (): ServiceContext => ctxFor('alice').ctx;

  beforeAll(async () => {
    await cmds.remember({ key: 'd1', value: 'choose dynamo', type: 'decision', tags: ['storage', 'substrate'] }, alice());
    await cmds.remember({ key: 'd2', value: 'one table', type: 'decision', tags: ['storage'] }, alice());
    await cmds.remember({ key: 't1', value: 'wire links', type: 'todo', tags: ['substrate'] }, alice());
    await cmds.remember({ key: 'note', value: 'untyped' }, alice());
  });

  it('query filters by type, tag, and prefix, with a limit', async () => {
    const decisions = await cmds.query({ type: 'decision' }, alice());
    expect(decisions.entries.map((e) => e.key).sort()).toEqual(['d1', 'd2']);

    const tagged = await cmds.query({ tag: 'substrate' }, alice());
    expect(tagged.entries.map((e) => e.key).sort()).toEqual(['d1', 't1']);

    const both = await cmds.query({ type: 'decision', tag: 'substrate' }, alice());
    expect(both.entries.map((e) => e.key)).toEqual(['d1']);

    const prefixed = await cmds.query({ prefix: 'd' }, alice());
    expect(prefixed.entries.map((e) => e.key).sort()).toEqual(['d1', 'd2']);

    const limited = await cmds.query({ rankBy: 'recency', limit: 1 }, alice());
    expect(limited.count).toBe(1); // ranking ties same-ms writes arbitrarily; limit is the contract
  });

  it('query rankBy recency puts a fresh write first', async () => {
    // A distinct, later timestamp: stub Date.now via a real later write.
    await new Promise((r) => setTimeout(r, 5));
    await cmds.remember({ key: 'freshest', value: 'now' }, alice());
    const ranked = await cmds.query({ rankBy: 'recency' }, alice());
    expect(ranked.entries[0].key).toBe('freshest');
  });

  it('type and tags surface in _meta and are preserved on an untyped rewrite', async () => {
    const e = await cmds.remember({ key: 'd1', value: 'choose dynamo (v2)' }, alice());
    expect(e._meta.type).toBe('decision');
    expect(e._meta.tags).toEqual(['storage', 'substrate']);
    expect(e._meta.revision).toBe(2);
  });

  it('conditional writes: ifAbsent and ifRevision enforce CAS', async () => {
    await expect(cmds.remember({ key: 'd1', value: 'x', ifAbsent: true }, alice())).rejects.toThrow(/precondition_failed/);
    await expect(cmds.remember({ key: 'd1', value: 'x', ifRevision: 1 }, alice())).rejects.toThrow(/precondition_failed/);
    // The happy paths: correct revision, and 0 for "must not exist".
    const ok = await cmds.remember({ key: 'd1', value: 'claimed', ifRevision: 2 }, alice());
    expect(ok._meta.revision).toBe(3);
    const fresh = await cmds.remember({ key: 'claim-slot', value: 'me', ifRevision: 0 }, alice());
    expect(fresh._meta.revision).toBe(1);
  });

  it('link/neighbors traverse typed edges in both directions', async () => {
    await cmds.link({ from: 't1', rel: 'grounds', to: 'd1' }, alice());
    await cmds.link({ from: 'd2', rel: 'refines', to: 'd1' }, alice());

    const around = await cmds.neighbors({ key: 'd1' }, alice());
    expect(around.inbound.map((e) => `${e.from}-${e.rel}`).sort()).toEqual(['d2-refines', 't1-grounds']);
    expect(around.outbound).toEqual([]);
    expect(Object.keys(around.entries).sort()).toEqual(['d2', 't1']); // neighbor entries included

    const onlyGrounds = await cmds.neighbors({ key: 'd1', dir: 'in', rel: 'grounds' }, alice());
    expect(onlyGrounds.inbound.map((e) => e.from)).toEqual(['t1']);

    await cmds.unlink({ from: 'd2', rel: 'refines', to: 'd1' }, alice());
    expect((await cmds.neighbors({ key: 'd1' }, alice())).inbound.map((e) => e.from)).toEqual(['t1']);
  });

  it('supersede migrateLinks carries edges to the successor', async () => {
    await cmds.remember({ key: 'd1v2', value: 'successor decision', type: 'decision' }, alice());
    await cmds.supersede({ key: 'd1', by: 'd1v2', migrateLinks: true }, alice());

    const successor = await cmds.neighbors({ key: 'd1v2' }, alice());
    expect(successor.inbound.map((e) => `${e.from}-${e.rel}`)).toEqual(['t1-grounds']);
    expect((await cmds.neighbors({ key: 'd1' }, alice())).inbound).toEqual([]); // old edges gone
  });

  it('changes tails the trajectory from a seq and reports the head', async () => {
    const all = await cmds.changes(undefined, alice());
    expect(all.seq).toBeGreaterThan(0);
    expect(all.events.length).toBeGreaterThan(0);
    expect(all.events.some((e) => e.op === 'link')).toBe(true);

    const tail = await cmds.changes({ sinceSeq: all.seq }, alice());
    expect(tail.events).toEqual([]); // nothing after the head

    await cmds.remember({ key: 'after-head', value: 1 }, alice());
    const next = await cmds.changes({ sinceSeq: all.seq }, alice());
    expect(next.events.map((e) => `${e.op}:${e.key}`)).toEqual(['write:after-head']);
  });

  it('attention surfaces stale, unlinked, and dangling as a derived read', async () => {
    // Everything was written moments ago, so nothing is stale at the default
    // threshold; with staleMs 0 everything live qualifies.
    const att = await cmds.attention({ staleMs: 0 }, alice());
    expect(att.stale.length).toBeGreaterThan(0);
    expect(att.unlinked).toContain('note'); // never linked
    expect(att.unlinked).not.toContain('t1'); // linked
    // d1 was retired *toward* d1v2, so its remaining edges (none) are clean,
    // and no edge should dangle on a retired-without-successor endpoint.
    expect(att.dangling).toEqual([]);

    // Retire the successor with no onward pointer — its inbound edge dangles.
    await cmds.supersede({ key: 'd1v2' }, alice());
    const att2 = await cmds.attention({ staleMs: 0 }, alice());
    expect(att2.dangling.some((d) => d.to === 'd1v2' && d.reason.includes('retired'))).toBe(true);
  });
});
