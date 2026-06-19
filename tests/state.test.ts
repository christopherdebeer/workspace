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
  parseSalienceConfig,
  SALIENCE_CONFIG_KEY,
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
    expect(sup?._meta.superseded).toBe(true);
    expect(sup?._meta.supersededBy).toBe('new');

    const def = await state.read('r', { elision: 'none' });
    expect(Object.keys(def.entries).sort()).toEqual(['new']);

    const incl = await state.read('r', { elision: 'none', includeSuperseded: true });
    expect(Object.keys(incl.entries).sort()).toEqual(['new', 'old']);
    // still retrievable directly — accretion, not erasure
    expect((await state.get('r', 'old'))?.value).toBe(1);
  });

  it('retires with no successor (forget) and a fresh write revives', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: 'k', value: 1 }, alice);
    const retired = await state.supersede('r', 'k', null, alice);
    expect(retired?._meta.superseded).toBe(true);
    expect(retired?._meta.supersededBy).toBeNull();
    // hidden from the default view even without a successor
    expect((await state.read('r', { elision: 'none' })).entries.k).toBeUndefined();

    const revived = await state.put({ scope: 'r', key: 'k', value: 2 }, alice);
    expect(revived._meta.superseded).toBe(false);
    expect(revived._meta.revision).toBe(2);
    expect((await state.read('r', { elision: 'none' })).entries.k?.value).toBe(2);
  });
});

describe('observed state: salience scoring', () => {
  it('decays with age and rises with velocity/attention/standing/centrality', () => {
    const s = {
      halfLifeMs: 3600000,
      windowMs: 3600000,
      velocitySaturation: 5,
      attentionSaturation: 5,
      standingSaturation: 50,
      centralitySaturation: 8,
      recencyWeight: 0.45,
      velocityWeight: 0.15,
      attentionWeight: 0.1,
      standingWeight: 0.2,
      centralityWeight: 0.1,
      focusThreshold: 0.5,
      elideThreshold: 0.1,
    };
    const now = 1_000_000_000_000;
    // Every term maxed → score approaches 1 (weights sum to 1).
    const fresh = computeScore(
      { updatedAtMs: now, windowWrites: 5, windowReads: 5, lifetimeReads: 50, lifetimeWrites: 50, degree: 8, nowMs: now },
      s,
    );
    const cold = computeScore(
      { updatedAtMs: now - 24 * 3600000, windowWrites: 0, windowReads: 0, nowMs: now },
      s,
    );
    expect(fresh).toBeGreaterThan(0.9);
    expect(cold).toBeLessThan(0.05);
    // recency-only fresh write sits between cold and fully-saturated
    const recentOnly = computeScore({ updatedAtMs: now, nowMs: now }, s);
    expect(recentOnly).toBeGreaterThan(cold);
    expect(recentOnly).toBeLessThan(fresh);
  });

  it('import preserves timestamps and seeds standing from cumulative counts', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const oldIso = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString(); // 60d ago
    // A migrated fact: old, but with deep earned history.
    await state.put(
      { scope: 'r', key: 'kb/x', value: 'ported', import: { createdAt: oldIso, updatedAt: oldIso, seedReads: 40, seedWrites: 10 } },
      alice,
    );
    // A cold ported fact: old, no history.
    await state.put({ scope: 'r', key: 'kb/y', value: 'cold', import: { createdAt: oldIso, updatedAt: oldIso } }, alice);
    const got = await state.get('r', 'kb/x');
    expect(got!._meta.updatedAt).toBe(oldIso); // real age preserved (recency reflects it)
    expect(got!._meta.standing).toBeGreaterThan(0.5); // 50 lifetime → near-saturated standing
    const res = await state.read('r', { elision: 'none' });
    // Earned fact stays above the default elide threshold despite age; cold one is lower.
    expect(res.entries['kb/x']._meta.score).toBeGreaterThan(0.1);
    expect(res.entries['kb/y']._meta.score).toBeLessThan(res.entries['kb/x']._meta.score);
  });

  it('per-call lens/override recompute the score (ranking + tiers) and echo the lens', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: 'hub', value: 1 }, alice);
    await state.put({ scope: 'r', key: 'leaf', value: 2 }, alice);
    await state.put({ scope: 'r', key: 'iso', value: 3 }, alice);
    await state.link('r', 'hub', 'rel', 'leaf', null, alice);
    await state.link('r', 'hub', 'rel', 'iso', null, alice); // hub degree 2, leaf+iso degree 1
    await state.link('r', 'leaf', 'rel', 'iso', null, alice); // leaf degree 2, iso degree 2... rebalance below
    // Pure-centrality override: only graph degree contributes to the score.
    const central = await state.read('r', {
      elision: 'none',
      salience: { recencyWeight: 0, velocityWeight: 0, attentionWeight: 0, standingWeight: 0, centralityWeight: 1 },
    });
    // hub (out:2) and iso (in:2) both have degree 2; leaf has degree 2 as well here,
    // so assert the override took effect: scores are pure-centrality, not recency.
    expect(central.entries.hub._meta.score).toBeCloseTo(2 / 5, 5); // degree 2 / centralitySaturation 5
    expect(central.entries.hub._meta.centrality).toBeCloseTo(2 / 5, 5);
    // The default read (recency-led) scores the same fresh facts much higher.
    const def = await state.read('r', { elision: 'none' });
    expect(def.entries.hub._meta.score).toBeGreaterThan(central.entries.hub._meta.score);
    // A named lens echoes into _shaping.
    const con = await state.read('r', { lens: 'connected' });
    expect(con._shaping.lens).toBe('connected');
  });

  it('standing keeps an idle, earned fact above elision; centrality lifts a hub', () => {
    const s = {
      halfLifeMs: 3600000,
      windowMs: 3600000,
      velocitySaturation: 5,
      attentionSaturation: 5,
      standingSaturation: 50,
      centralitySaturation: 8,
      recencyWeight: 0.45,
      velocityWeight: 0.15,
      attentionWeight: 0.1,
      standingWeight: 0.2,
      centralityWeight: 0.1,
      focusThreshold: 0.5,
      elideThreshold: 0.1,
    };
    const now = 1_000_000_000_000;
    const oldMs = now - 30 * 24 * 3600000; // a month idle → recency ≈ 0
    // No recency/velocity/attention, but a deep cumulative history → not elided.
    const earned = computeScore({ updatedAtMs: oldMs, lifetimeReads: 40, lifetimeWrites: 10, nowMs: now }, s);
    expect(earned).toBeGreaterThan(s.elideThreshold);
    // A well-connected hub gets an additional structural lift.
    const hub = computeScore({ updatedAtMs: oldMs, lifetimeReads: 40, lifetimeWrites: 10, degree: 8, nowMs: now }, s);
    expect(hub).toBeGreaterThan(earned);
    // Genuinely cold junk (one touch, no edges, old) stays elided.
    const junk = computeScore({ updatedAtMs: oldMs, lifetimeWrites: 1, nowMs: now }, s);
    expect(junk).toBeLessThan(s.elideThreshold);
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
    // Below the threshold the entry collapses to a stub — no _meta envelope.
    expect(res.entries.cold).toBeUndefined();
    expect(res.elided).toEqual([{ key: 'cold', type: null, score: expect.any(Number) }]);
    expect(res._shaping.counts.total).toBe(2);
    expect(res._shaping.counts.elided).toBe(1);
    expect(res._shaping.elision).toBe('auto');

    // elision:none returns every value (and no stub list)
    const full = await state.read('r', { elision: 'none' });
    expect(full.entries.cold.value).toBe('secret');
    expect(full.entries.cold._meta.elided).toBe(false);
    expect(full.elided).toBeUndefined();

    // expand forces a key to Focus (full entry returns even under auto elision)
    const expanded = await state.read('r', { expand: ['cold'] });
    expect(expanded.entries.cold.value).toBe('secret');
    expect(expanded.elided).toBeUndefined();
  });

  it('orders elided stubs by score and keeps salience figures rounded', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store, {
      halfLifeMs: 20,
      windowMs: 60 * 60 * 1000,
      velocitySaturation: 1000,
      attentionSaturation: 1000,
      // thresholds above any reachable score → everything elides
      focusThreshold: 2,
      elideThreshold: 1.5,
    });
    await state.put({ scope: 'r', key: 'older', value: 1, type: 'note' }, alice);
    await new Promise((r) => setTimeout(r, 60));
    await state.put({ scope: 'r', key: 'newer', value: 2 }, alice);

    const res = await state.read('r');
    expect(Object.keys(res.entries)).toHaveLength(0);
    expect(res.elided?.map((s) => s.key)).toEqual(['newer', 'older']);
    expect(res.elided?.find((s) => s.key === 'older')?.type).toBe('note');
    for (const stub of res.elided ?? []) {
      // a 4-decimal signal, not a 17-digit measurement
      expect(stub.score).toBe(Math.round(stub.score * 1e4) / 1e4);
    }
  });
});

describe('salience config: parseSalienceConfig', () => {
  it('keeps known numeric fields, drops junk, clamps thresholds to [0,1]', () => {
    expect(
      parseSalienceConfig({
        focusThreshold: 0.62,
        elideThreshold: 0.62,
        recencyWeight: 0.3,
        bogus: 'nope',
        velocityWeight: -1, // negative dropped
        windowMs: Infinity, // non-finite dropped
        standingWeight: 5, // weights aren't unit-clamped (caller owns the budget)
      }),
    ).toEqual({ focusThreshold: 0.62, elideThreshold: 0.62, recencyWeight: 0.3, standingWeight: 5 });
    // thresholds above 1 clamp to 1
    expect(parseSalienceConfig({ focusThreshold: 3 })).toEqual({ focusThreshold: 1 });
  });

  it('unwraps a { salience: {...} } envelope and rejects empty/non-object', () => {
    expect(parseSalienceConfig({ salience: { focusThreshold: 0.5 } })).toEqual({ focusThreshold: 0.5 });
    expect(parseSalienceConfig({})).toBeNull();
    expect(parseSalienceConfig({ nothing: 1 })).toBeNull();
    expect(parseSalienceConfig(null)).toBeNull();
    expect(parseSalienceConfig('x')).toBeNull();
  });
});

describe('salience config: per-scope policy fact', () => {
  // Isolate recency so scores are deterministic: a fresh fact scores ~recencyWeight
  // (0.35 default) → peripheral under defaults (focus 0.5 / elide 0.1), but a
  // config fact can push the thresholds around it.
  const freshScore = async (): Promise<number> => {
    const probe = createObservedState(createMemoryStateStore());
    await probe.put({ scope: 'r', key: 'k', value: 1 }, alice);
    const r = await probe.read('r', { elision: 'none' });
    return r.entries.k._meta.score;
  };

  it('a _config/salience fact re-tiers the owner\'s read without a redeploy', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: 'note', value: 'hi' }, alice);

    // Default thresholds: a fresh fact (~0.35) is peripheral → present in full.
    const before = await state.read('r');
    expect(before.entries.note?.value).toBe('hi');

    // Writing the policy fact lifts the elide threshold above the fact's score,
    // so the same read now collapses it to a stub — the data-dump knob, per user.
    await state.put({ scope: 'r', key: SALIENCE_CONFIG_KEY, value: { focusThreshold: 0.9, elideThreshold: 0.9 } }, alice);
    const after = await state.read('r');
    expect(after.entries.note).toBeUndefined();
    expect(after.elided?.some((s) => s.key === 'note')).toBe(true);
    expect(after._shaping.focusThreshold).toBe(0.9);
    expect(after._shaping.elideThreshold).toBe(0.9);
  });

  it('config is the base; a per-call salience override still wins over it', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: 'note', value: 'hi' }, alice);
    await state.put({ scope: 'r', key: SALIENCE_CONFIG_KEY, value: { elideThreshold: 0.9 } }, alice);

    // Config would elide it…
    expect((await state.read('r')).entries.note).toBeUndefined();
    // …but an explicit per-call override sits above the config and brings it back.
    const overridden = await state.read('r', { salience: { elideThreshold: 0.01 } });
    expect(overridden.entries.note?.value).toBe('hi');
  });

  it('query honors the scope config too, and salienceConfig() reads it back', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const score = await freshScore();
    await state.put({ scope: 'r', key: 'note', value: 'hi' }, alice);
    await state.put({ scope: 'r', key: SALIENCE_CONFIG_KEY, value: { focusThreshold: score + 0.1, elideThreshold: score + 0.1 } }, alice);

    expect(await state.salienceConfig('r')).toEqual({ focusThreshold: score + 0.1, elideThreshold: score + 0.1 });
    // query ranks but does not elide; the config still resolves cleanly (no throw)
    const q = await state.query('r', { limit: 10 });
    expect(q.entries.find((e) => e.key === 'note')).toBeDefined();
  });
});
