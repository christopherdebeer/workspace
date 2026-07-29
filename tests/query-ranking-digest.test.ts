/**
 * The ranking digest — `query`'s bare-salience hot path.
 *
 * A paginated surface (the home graph) issues the same bare salience query over
 * and over with only the cursor changing, and the cold path costs two
 * full-partition reads plus a full re-rank PER PAGE. The digest caches the
 * ranking (ordered keys + per-key degree — the only `wrap` input that comes
 * from the full-partition reads) seq-validated against the scope's write head,
 * so warm pages are point-gets over just the page's records.
 *
 * The contract under test: a warm page is INDISTINGUISHABLE from the cold page
 * it replaces, invalidation is exact (any write), and every filtered or exotic
 * query bypasses the digest — a top-N cache must never answer a
 * differently-shaped question (the grant fold's `total` starvation was exactly
 * a cache-shaped candidate set answering the wrong question).
 */
import { createObservedState, createMemoryStateStore, RANKING_KEY } from '../platform/runtime';
import type { Identity, StateStore } from '../platform/runtime';

const ID: Identity = { user: 'o', scopes: [] };

async function seed(): Promise<{ store: StateStore; state: ReturnType<typeof createObservedState> }> {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  for (let i = 0; i < 25; i++) {
    await state.put({ scope: 'o', key: `kb/f${String(i).padStart(2, '0')}`, value: { title: `fact ${i}` }, type: 'knowledge' }, ID);
  }
  // Authored edges so degree (centrality) genuinely differs between keys —
  // a cached-degree bug would show as score drift between warm and cold.
  await state.link('o', 'kb/f01', 'refines', 'kb/f02', null, ID);
  await state.link('o', 'kb/f03', 'grounds', 'kb/f01', null, ID);
  await state.link('o', 'kb/f04', 'relatesTo', 'kb/f01', null, ID);
  return { store, state };
}

describe('the ranking digest', () => {
  it('a warm page equals the cold page it replaces — keys, order, and meta', async () => {
    const { store, state } = await seed();
    // Page 1 cold: computes the ranking and persists the digest.
    const p1 = await state.query('o', { limit: 10 }, ID);
    expect((await store.get('o', RANKING_KEY))?.value).toMatchObject({ total: p1.total });
    // Page 2 warm (digest present, seq unchanged).
    const warm = await state.query('o', { limit: 10, cursor: p1.nextCursor }, ID);
    // Recompute page 2 cold for comparison by deleting the digest first.
    await store.put({ ...(await store.get('o', RANKING_KEY))!, value: { corrupt: true } });
    const cold = await state.query('o', { limit: 10, cursor: p1.nextCursor }, ID);
    expect(warm.entries.map((e) => e.key)).toEqual(cold.entries.map((e) => e.key));
    expect(warm.total).toBe(cold.total);
    expect(warm.nextCursor).toBe(cold.nextCursor);
    for (let i = 0; i < warm.entries.length; i++) {
      const w = warm.entries[i]._meta;
      const c = cold.entries[i]._meta;
      // Scores recompute from live recency either way; degree rides the digest.
      expect(Math.abs(w.score - c.score)).toBeLessThan(0.001);
      expect(w.centrality).toBeCloseTo(c.centrality, 3);
      expect(w.type).toBe(c.type);
      expect(w.revision).toBe(c.revision);
    }
  });

  it('any write invalidates: a new fact appears on the next page-1 read', async () => {
    const { state } = await seed();
    await state.query('o', { limit: 5 }, ID); // digest written
    await state.put({ scope: 'o', key: 'kb/fresh', value: { title: 'fresh' }, type: 'knowledge' }, ID);
    const after = await state.query('o', { limit: 100 }, ID);
    expect(after.entries.map((e) => e.key)).toContain('kb/fresh');
    expect(after.total).toBe(26);
  });

  it('pages the whole set coherently through the digest — no repeats, no holes', async () => {
    const { state } = await seed();
    const keys: string[] = [];
    let cursor: string | undefined;
    let total = 0;
    for (;;) {
      const p = await state.query('o', { limit: 7, cursor }, ID);
      keys.push(...p.entries.map((e) => e.key));
      total = p.total;
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(total).toBe(25);
    expect(keys).toHaveLength(25);
    expect(new Set(keys).size).toBe(25);
  });

  it('an offset at or past total returns an empty page without a partition read', async () => {
    const { state } = await seed();
    await state.query('o', { limit: 5 }, ID);
    const past = await state.query('o', { limit: 5, cursor: '999' }, ID);
    expect(past.entries).toEqual([]);
    expect(past.total).toBe(25);
    expect(past.nextCursor).toBeUndefined();
  });

  it('filtered and exotic queries bypass the digest entirely', async () => {
    const { store, state } = await seed();
    await state.query('o', { limit: 5 }, ID); // digest present
    // Poison the digest: if any of these read it, they would return garbage.
    const rec = (await store.get('o', RANKING_KEY))!;
    await store.put({ ...rec, value: { ...(rec.value as object), keys: ['kb/f00'], degrees: [0], total: 1 } });
    expect((await state.query('o', { limit: 50, prefix: 'kb/f1' }, ID)).total).toBe(10);
    expect((await state.query('o', { limit: 50, keyFilter: (k) => k.endsWith('5') }, ID)).total).toBe(2);
    expect((await state.query('o', { limit: 50, type: 'knowledge' }, ID)).total).toBe(25);
    expect((await state.query('o', { limit: 50, rankBy: 'recency' }, ID)).total).toBe(25); // rankBy≠salience → cold, and the digest itself is excluded as cache-not-content
  });

  it('a malformed digest is ignored, never fatal', async () => {
    const { store, state } = await seed();
    await state.query('o', { limit: 5 }, ID);
    const rec = (await store.get('o', RANKING_KEY))!;
    await store.put({ ...rec, value: 'not a digest at all' });
    const p = await state.query('o', { limit: 5 }, ID);
    expect(p.count).toBe(5);
    expect(p.total).toBe(25);
  });
});
