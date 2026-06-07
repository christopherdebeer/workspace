/**
 * Observed-state primitive — the substrate's monotonic floor.
 *
 * Exercises the model from `docs/substrate.md`: wrapped `{ value, _meta }` entries
 * with server-stamped provenance, accumulating revisions/writers, supersede (not
 * delete), salience computed from the trajectory, and salience-shaped reads
 * (Focus / Peripheral / Elided) with a `_shaping` summary. Backed by the
 * in-memory store so it runs without AWS.
 */
import {
  createObservedState,
  createMemoryStateStore,
  computeScore,
} from '../platform/runtime/state';
import type { Identity } from '../platform/runtime';

const alice: Identity = { user: 'alice', scopes: [] };
const bob: Identity = { user: 'bob', scopes: [] };

describe('observed state: provenance', () => {
  it('wraps a value with server-stamped provenance, not client-supplied', async () => {
    const state = createObservedState(createMemoryStateStore());
    const e = await state.put({ scope: 'room1', key: 'phase', value: 'planning' }, alice);
    expect(e.value).toBe('planning');
    expect(e._meta.revision).toBe(1);
    expect(e._meta.writer).toBe('alice');
    expect(e._meta.writers).toEqual(['alice']);
    expect(e._meta.supersededBy).toBeNull();
    expect(e._meta.seq).toBeGreaterThan(0);
  });

  it('accumulates revisions and distinct writers across writes', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: 'phase', value: 'a' }, alice);
    await state.put({ scope: 'r', key: 'phase', value: 'b' }, bob);
    const e = await state.put({ scope: 'r', key: 'phase', value: 'c' }, alice);
    expect(e.value).toBe('c');
    expect(e._meta.revision).toBe(3);
    expect(e._meta.writer).toBe('alice');
    expect(e._meta.writers.sort()).toEqual(['alice', 'bob']);
    expect(e._meta.createdAt <= e._meta.updatedAt).toBe(true);
  });

  it('stamps writer null when there is no identity', async () => {
    const state = createObservedState(createMemoryStateStore());
    const e = await state.put({ scope: 'r', key: 'k', value: 1 });
    expect(e._meta.writer).toBeNull();
    expect(e._meta.writers).toEqual([]);
  });
});

describe('observed state: supersede, not delete', () => {
  it('retires a key by pointing it at a successor and hides it from default reads', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: 'old', value: 1 }, alice);
    await state.put({ scope: 'r', key: 'new', value: 2 }, alice);
    const sup = await state.supersede('r', 'old', 'new', alice);
    expect(sup?._meta.supersededBy).toBe('new');

    const def = await state.read('r', { elision: 'none' });
    expect(Object.keys(def.entries).sort()).toEqual(['new']);

    const incl = await state.read('r', { elision: 'none', includeSuperseded: true });
    expect(Object.keys(incl.entries).sort()).toEqual(['new', 'old']);
    // still retrievable directly — accretion, not erasure
    expect((await state.get('r', 'old'))?.value).toBe(1);
  });

  it('a fresh write revives a superseded key', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: 'k', value: 1 }, alice);
    await state.supersede('r', 'k', null, alice);
    const revived = await state.put({ scope: 'r', key: 'k', value: 2 }, alice);
    expect(revived._meta.supersededBy).toBeNull();
    expect(revived._meta.revision).toBe(2);
  });
});

describe('observed state: salience scoring', () => {
  it('decays with age and rises with velocity/attention', () => {
    const s = {
      halfLifeMs: 3600000,
      windowMs: 3600000,
      velocitySaturation: 5,
      attentionSaturation: 5,
      focusThreshold: 0.5,
      elideThreshold: 0.1,
    };
    const now = 1_000_000_000_000;
    const fresh = computeScore({ updatedAtMs: now, writesInWindow: 5, readsInWindow: 5, nowMs: now }, s);
    const stale = computeScore(
      { updatedAtMs: now - 24 * 3600000, writesInWindow: 0, readsInWindow: 0, nowMs: now },
      s,
    );
    expect(fresh).toBeGreaterThan(0.9);
    expect(stale).toBeLessThan(0.05);
    // recency-only fresh write sits between
    const recentOnly = computeScore({ updatedAtMs: now, writesInWindow: 0, readsInWindow: 0, nowMs: now }, s);
    expect(recentOnly).toBeGreaterThan(stale);
    expect(recentOnly).toBeLessThan(fresh);
  });
});

describe('observed state: salience-shaped reads', () => {
  it('elides low-salience entries (value withheld) and reports _shaping', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store, {
      // tiny half-life so an "old" entry decays past the elide threshold fast;
      // isolate recency (saturate velocity/attention) so the test is deterministic.
      halfLifeMs: 20,
      windowMs: 60 * 60 * 1000,
      velocitySaturation: 1000,
      attentionSaturation: 1000,
      focusThreshold: 0.4,
      elideThreshold: 0.1,
    });
    await state.put({ scope: 'r', key: 'cold', value: 'secret' }, alice);
    // let the cold entry decay well past the elide threshold (~6 half-lives)
    await new Promise((r) => setTimeout(r, 120));
    await state.put({ scope: 'r', key: 'hot', value: 'live' }, alice);

    const res = await state.read('r');
    expect(res.entries.hot.value).toBe('live');
    expect(res.entries.hot._meta.elided).toBe(false);
    expect(res.entries.cold.value).toBeNull();
    expect(res.entries.cold._meta.elided).toBe(true);
    expect(res._shaping.counts.total).toBe(2);
    expect(res._shaping.elision).toBe('auto');

    // elision:none returns every value
    const full = await state.read('r', { elision: 'none' });
    expect(full.entries.cold.value).toBe('secret');
    expect(full.entries.cold._meta.elided).toBe(false);

    // expand forces a key to Focus (value present even under auto elision)
    const expanded = await state.read('r', { expand: ['cold'] });
    expect(expanded.entries.cold.value).toBe('secret');
  });
});
