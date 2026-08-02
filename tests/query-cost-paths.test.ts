/**
 * The two read-cost contracts from the 2026-08-02 cost review (the ~$0.37/doc
 * decomposition finding): a PREFIX query pushes the prefix down to the store
 * instead of listing the whole partition and filtering in memory, and
 * `neighbors` with derived:false (the authored-only fast path) never lists the
 * partition at all. Both are pinned via a spying store wrapper — behaviour
 * stays correct AND the expensive call shape is structurally gone.
 */
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import type { Identity, StateStore } from '../platform/runtime';

const ID: Identity = { user: 'o', scopes: [] };

function spyStore(): { store: StateStore; listCalls: Array<string | undefined> } {
  const inner = createMemoryStateStore();
  const listCalls: Array<string | undefined> = [];
  const store: StateStore = {
    ...inner,
    list: async (scope: string, keyPrefix?: string) => {
      listCalls.push(keyPrefix);
      return inner.list(scope, keyPrefix);
    },
  };
  return { store, listCalls };
}

async function seed(store: StateStore) {
  const state = createObservedState(store);
  await state.put({ scope: 'o', key: 'doc-order:x/a', value: { seq: 0 }, type: 'doc-order' }, ID);
  await state.put({ scope: 'o', key: 'doc-order:x/b', value: { seq: 1 }, type: 'doc-order' }, ID);
  await state.put({ scope: 'o', key: 'kb/other', value: { title: 'other' }, type: 'knowledge' }, ID);
  await state.link('o', 'doc-order:x/a', 'related', 'kb/other', null, ID);
  return state;
}

describe('read-cost contracts (2026-08-02)', () => {
  it('a prefix query pushes the prefix down to the store — no whole-partition list', async () => {
    const { store, listCalls } = spyStore();
    const state = await seed(store);
    listCalls.length = 0;
    const res = await state.query('o', { prefix: 'doc-order:x/', limit: 50 }, ID);
    expect(res.entries.map((e) => e.key).sort()).toEqual(['doc-order:x/a', 'doc-order:x/b']);
    // Every list issued for this query carried the prefix; none read the world.
    expect(listCalls.length).toBeGreaterThan(0);
    expect(listCalls.every((p) => p === 'doc-order:x/')).toBe(true);
  });

  it('neighbors derived:false is the authored-only fast path — no partition list at all', async () => {
    const { store, listCalls } = spyStore();
    const state = await seed(store);
    listCalls.length = 0;
    const r = await state.neighbors('o', 'doc-order:x/a', { derived: false });
    expect(r.outbound.map((e) => `${e.rel}→${e.to}`)).toEqual(['related→kb/other']);
    expect(Object.keys(r.entries)).toContain('kb/other'); // hydrated by point-get
    expect(listCalls).toEqual([]);
  });

  it('neighbors WITH the backbone still lists (the honest default is unchanged)', async () => {
    const { store, listCalls } = spyStore();
    const state = await seed(store);
    listCalls.length = 0;
    await state.neighbors('o', 'doc-order:x/a', {});
    expect(listCalls.length).toBeGreaterThan(0);
  });
});

describe('denormalized weighted degree (degW, 2026-08-02)', () => {
  it('putEdge/deleteEdge maintain both endpoints; re-puts adjust by strength delta, not +1', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'o', key: 'a', value: 1 }, ID);
    await state.put({ scope: 'o', key: 'b', value: 1 }, ID);
    await store.putEdge({ scope: 'o', from: 'a', rel: 'related', to: 'b', strength: null, createdAt: 'now', writer: 'w', score: null });
    expect((await store.get('o', 'a'))?.degW).toBe(1); // null strength = 1 (ADR-0009)
    expect((await store.get('o', 'b'))?.degW).toBe(1);
    // Score-rewrite at a new strength: delta only.
    await store.putEdge({ scope: 'o', from: 'a', rel: 'related', to: 'b', strength: 0.4, createdAt: 'now', writer: 'w', score: 0.9 });
    expect((await store.get('o', 'a'))?.degW).toBeCloseTo(0.4);
    // Same-strength re-put: no change.
    await store.putEdge({ scope: 'o', from: 'a', rel: 'related', to: 'b', strength: 0.4, createdAt: 'now', writer: 'w', score: 0.91 });
    expect((await store.get('o', 'a'))?.degW).toBeCloseTo(0.4);
    await store.deleteEdge('o', 'a', 'related', 'b');
    expect((await store.get('o', 'a'))?.degW).toBeCloseTo(0);
  });

  it('a fact rewrite preserves the counter, and ranked queries read degree without listing edges', async () => {
    const inner = createMemoryStateStore();
    let edgeLists = 0;
    const store = { ...inner, listEdges: async (scope: string) => { edgeLists++; return inner.listEdges(scope); } };
    const state = createObservedState(store);
    await state.put({ scope: 'o', key: 'hub', value: { title: 'hub' }, type: 'knowledge' }, ID);
    await state.put({ scope: 'o', key: 'leaf', value: { title: 'leaf' }, type: 'knowledge' }, ID);
    await state.link('o', 'hub', 'related', 'leaf', null, ID);
    await state.put({ scope: 'o', key: 'hub', value: { title: 'hub v2' } }, ID); // rewrite
    expect((await store.get('o', 'hub'))?.degW).toBe(1); // survived the rewrite
    edgeLists = 0;
    const res = await state.query('o', { type: 'knowledge', limit: 10 }, ID);
    expect(res.entries.length).toBe(2);
    expect(edgeLists).toBe(0); // centrality came from degW, not an edge scan
  });

  it('reconcileDegrees backfills and repairs drift', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'o', key: 'a', value: 1 }, ID);
    await state.put({ scope: 'o', key: 'b', value: 1 }, ID);
    await state.link('o', 'a', 'related', 'b', null, ID);
    await store.setDegree('o', 'a', 99); // inject drift
    const { reconcileDegrees } = jest.requireActual<typeof import('../platform/runtime')>('../platform/runtime');
    const r = await reconcileDegrees(store, 'o');
    expect(r.patched).toBeGreaterThan(0);
    expect((await store.get('o', 'a'))?.degW).toBe(1);
    expect((await store.get('o', 'b'))?.degW).toBe(1);
  });
});
