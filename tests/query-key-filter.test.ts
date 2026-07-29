/**
 * `QueryOptions.keyFilter` — the visibility fold, applied where `prefix`/`tag`
 * already are: upstream of ranking, the page cap, and `total`.
 *
 * Three shapes of the grant fold, two of them wrong:
 *
 *  1. Filter AFTER the query. The cap was spent on the owner's whole slice by
 *     salience, then coverage dropped most of it, and the survivors became
 *     `total`. Measured 2026-07-29: an unauthenticated home graph reported
 *     `20/20` against ~135 genuinely public facts, because 115 were
 *     `doc-block:*` at salience 0.12–0.14 and the owner's top 1200 of 8,600
 *     facts never reached them. Selecting a node pulled in more, because
 *     per-key reads never went through the fold.
 *
 *  2. One query PER GRANT PATTERN, to make the cap bound the covered set. Worse:
 *     `state.query` reads the whole `KEY#` partition AND every edge for signals
 *     regardless of `prefix` (prefix is an in-memory filter, not a pushed-down
 *     key condition), so 19 patterns meant 19 full-partition reads on the one
 *     table partition that holds the entire slice. Under load it failed and
 *     guests got an EMPTY graph — strictly worse than a wrong total.
 *
 *  3. This: one query, coverage inside the candidate filter. Same cost as (1),
 *     correct counts, and ranked within what the viewer can see.
 */
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import type { Identity } from '../platform/runtime';

const ID: Identity = { user: 'owner', scopes: [] };

/** A slice shaped like the real one: a few high-salience identity facts and many
 *  low-salience blocks, which is what made the starvation invisible. */
async function seed() {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  // 3 "public" identity facts.
  for (let i = 0; i < 3; i++) {
    await state.put({ scope: 'owner', key: `doc:public/${i}`, value: { title: `public doc ${i}` }, type: 'doc' }, ID);
  }
  // 12 "public" blocks — many, and individually unremarkable.
  for (let i = 0; i < 12; i++) {
    await state.put({ scope: 'owner', key: `doc-block:public/${i}`, value: { content: `block ${i}` }, type: 'doc-block' }, ID);
  }
  // 30 private facts the viewer may not see.
  for (let i = 0; i < 30; i++) {
    await state.put({ scope: 'owner', key: `kb/private-${i}`, value: { title: `private ${i}` }, type: 'knowledge' }, ID);
  }
  return { store, state };
}

const isPublic = (key: string): boolean => key.startsWith('doc:public/') || key.startsWith('doc-block:public/');

describe('QueryOptions.keyFilter', () => {
  it('makes `total` the covered count, not the survivors of a truncation', async () => {
    const { state } = await seed();
    const res = await state.query('owner', { keyFilter: isPublic, limit: 5 }, ID);
    // 3 docs + 12 blocks = 15 covered. The page is 5; `total` must still be 15.
    expect(res.total).toBe(15);
    expect(res.count).toBe(5);
    expect(res.nextCursor).toBe('5');
    for (const e of res.entries) expect(isPublic(e.key)).toBe(true);
  });

  it('spends the page cap on covered facts — the starvation this fixes', async () => {
    const { state } = await seed();
    // A cap SMALLER than the private population. Filtering after the query would
    // have spent it on `kb/private-*` and returned few or none of the covered set.
    const res = await state.query('owner', { keyFilter: isPublic, limit: 15 }, ID);
    expect(res.count).toBe(15);
    expect(res.entries.every((e) => isPublic(e.key))).toBe(true);
    // Blocks are reachable, not just the high-salience identity facts.
    expect(res.entries.filter((e) => e.key.startsWith('doc-block:')).length).toBeGreaterThan(0);
  });

  it('pages the covered set coherently', async () => {
    const { state } = await seed();
    const p1 = await state.query('owner', { keyFilter: isPublic, limit: 10 }, ID);
    const p2 = await state.query('owner', { keyFilter: isPublic, limit: 10, cursor: p1.nextCursor }, ID);
    expect(p1.total).toBe(15);
    expect(p2.total).toBe(15);
    expect(p2.count).toBe(5);
    expect(p2.nextCursor).toBeUndefined();
    // Every returned key across both pages is covered, and none repeats.
    const keys = [...p1.entries, ...p2.entries].map((e) => e.key);
    expect(new Set(keys).size).toBe(15);
    expect(keys.every(isPublic)).toBe(true);
  });

  it('is a filter only — it can never widen the result', async () => {
    const { state } = await seed();
    const all = await state.query('owner', {}, ID);
    const filtered = await state.query('owner', { keyFilter: isPublic }, ID);
    expect(filtered.total).toBeLessThan(all.total);
    expect(filtered.entries.every((e) => isPublic(e.key))).toBe(true);
    // A predicate that admits nothing yields nothing, not everything.
    const none = await state.query('owner', { keyFilter: () => false }, ID);
    expect(none.total).toBe(0);
    expect(none.entries).toEqual([]);
  });

  it('composes with prefix and type rather than replacing them', async () => {
    const { state } = await seed();
    // Both constraints hold: covered AND under the prefix.
    const res = await state.query('owner', { keyFilter: isPublic, prefix: 'doc-block:' }, ID);
    expect(res.total).toBe(12);
    expect(res.entries.every((e) => e.key.startsWith('doc-block:public/'))).toBe(true);
    // A prefix outside the covered set yields nothing — the filter still applies.
    const outside = await state.query('owner', { keyFilter: isPublic, prefix: 'kb/' }, ID);
    expect(outside.total).toBe(0);
  });

  it('absent keyFilter changes nothing', async () => {
    const { state } = await seed();
    const a = await state.query('owner', { limit: 4 }, ID);
    const b = await state.query('owner', { limit: 4, keyFilter: undefined }, ID);
    expect(b.total).toBe(a.total);
    expect(b.entries.map((e) => e.key)).toEqual(a.entries.map((e) => e.key));
  });
});
