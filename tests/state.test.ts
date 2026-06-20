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
  deriveBackboneEdges,
  SALIENCE_CONFIG_KEY,
} from '../platform/runtime/state';
import type { StateRecord } from '../platform/runtime/state';
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

describe('derived structural backbone', () => {
  // A minimal StateRecord factory — only the fields the backbone reads.
  const rec = (key: string, type: string | null, value: unknown, tags: string[] = []): StateRecord => ({
    scope: 'r', key, value, revision: 1, seq: 1, firstSeq: 1, writer: 'alice', via: null,
    createdAt: '', updatedAt: '', writers: ['alice'], superseded: false, supersededBy: null,
    type, tags, timerExpiresAt: null, timerEffect: null,
  });

  it('links a fact to its type anchor, the type to its cell + renderer, and a fact to matching views', () => {
    const records = [
      rec('kb/1', 'note', { text: 'hi' }, ['journal']),
      rec('_types/note', 'type-decl', { manager: '@c15r/lit' }),
      rec('_renderers/note', 'renderer', { mount: '…' }),
      rec('cells/lit-abc', 'cell', { address: '/@c15r/lit', name: 'lit' }),
      rec('_views/journal', 'view', { query: { tag: 'journal' } }),
    ];
    const edges = deriveBackboneEdges(records);
    const has = (from: string, rel: string, to: string) =>
      edges.some((e) => e.from === from && e.rel === rel && e.to === to && e.derived === true);

    expect(has('kb/1', 'instanceOf', '_types/note')).toBe(true);
    expect(has('_types/note', 'managedBy', 'cells/lit-abc')).toBe(true); // address normalised across the leading slash
    expect(has('_types/note', 'rendersWith', '_renderers/note')).toBe(true);
    expect(has('kb/1', 'inView', '_views/journal')).toBe(true); // tag query selects the fact
    // a type-decl is not an instance of itself
    expect(edges.some((e) => e.from === '_types/note' && e.rel === 'instanceOf')).toBe(false);
  });

  it('resolves managedBy from the canonical type→manager map when the anchor omits manager', () => {
    const records = [
      rec('kb/1', 'doc', { title: 'x' }),
      rec('_types/doc', 'type-decl', { icon: '📄' }), // no manager in-slice
      rec('cells/lit-abc', 'cell', { address: '/@c15r/lit', name: 'lit' }),
    ];
    // Without the canonical map, the type cannot reach its cell…
    expect(deriveBackboneEdges(records).some((e) => e.rel === 'managedBy')).toBe(false);
    // …with it (as a cell stamps on deploy), the link resolves.
    const edges = deriveBackboneEdges(records, { doc: { manager: '@c15r/lit' } });
    expect(edges.some((e) => e.from === '_types/doc' && e.rel === 'managedBy' && e.to === 'cells/lit-abc')).toBe(true);
  });

  it('an in-slice manager on the anchor overrides the canonical map', () => {
    const records = [
      rec('_types/doc', 'type-decl', { manager: '@c15r/lit' }),
      rec('cells/lit-abc', 'cell', { address: '/@c15r/lit', name: 'lit' }),
      rec('cells/other-xyz', 'cell', { address: '/@c15r/other', name: 'other' }),
    ];
    const edges = deriveBackboneEdges(records, { doc: { manager: '@c15r/other' } });
    expect(edges.some((e) => e.rel === 'managedBy' && e.to === 'cells/lit-abc')).toBe(true);
    expect(edges.some((e) => e.to === 'cells/other-xyz')).toBe(false);
  });

  it('anchors instanceOf to a virtual type node, but drops cell/renderer/view edges with no target', () => {
    const edges = deriveBackboneEdges([rec('kb/1', 'note', { text: 'hi' })]); // no _types/note, cell, renderer, or view
    // instanceOf is emitted even with no materialised anchor — the floor every typed fact gets.
    expect(edges).toEqual([
      expect.objectContaining({ from: 'kb/1', rel: 'instanceOf', to: '_types/note', derived: true }),
    ]);
    // …but managedBy/rendersWith need a real cell/renderer target, so neither appears.
    expect(edges.some((e) => e.rel === 'managedBy' || e.rel === 'rendersWith')).toBe(false);
  });

  it('still reaches a canonical-only content type — instanceOf needs no slice anchor', () => {
    // `doc` is cell-managed and has no `_types/doc` fact in this slice.
    const records = [rec('kb/1', 'doc', { title: 'x' }), rec('cells/lit-abc', 'cell', { address: '/@c15r/lit' })];
    const edges = deriveBackboneEdges(records, { doc: { manager: '@c15r/lit' } });
    expect(edges.some((e) => e.from === 'kb/1' && e.rel === 'instanceOf' && e.to === '_types/doc')).toBe(true);
    // and the virtual anchor still bridges to its cell
    expect(edges.some((e) => e.from === '_types/doc' && e.rel === 'managedBy' && e.to === 'cells/lit-abc')).toBe(true);
  });

  it('ignores unfiltered views (a query with no type/tag/prefix would select everything)', () => {
    const edges = deriveBackboneEdges([
      rec('kb/1', 'note', {}),
      rec('_types/note', 'type-decl', {}),
      rec('_views/all', 'view', { query: {} }),
    ]);
    expect(edges.some((e) => e.rel === 'inView')).toBe(false);
  });

  it('gives a typed-but-unauthored-linked fact a centrality floor in read', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: '_types/note', value: { icon: '📝' }, type: 'type-decl' }, alice);
    await state.put({ scope: 'r', key: 'kb/1', value: { text: 'hi' }, type: 'note' }, alice);

    const res = await state.read('r', { elision: 'none' });
    // weighted degree: one structural `instanceOf` edge (strength 0.2) / centralitySaturation 5
    // = 0.04 — a floor above zero, but discounted vs an authored link (ADR-0009).
    expect(res.entries['kb/1']._meta.centrality).toBeCloseTo(0.2 / 5, 5);
    // the type anchor is a hub: its instance points at it, so it too clears zero.
    expect(res.entries['_types/note']._meta.centrality).toBeGreaterThan(0);
  });

  it('neighbors surfaces backbone edges (derived:true) alongside authored ones', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: '_types/note', value: { icon: '📝' }, type: 'type-decl' }, alice);
    await state.put({ scope: 'r', key: 'kb/1', value: { text: 'hi' }, type: 'note' }, alice);

    const n = await state.neighbors('r', 'kb/1', { dir: 'out' });
    const e = n.outbound.find((x) => x.to === '_types/note');
    expect(e).toMatchObject({ rel: 'instanceOf', derived: true });
    expect(n.entries['_types/note']).toBeDefined(); // the anchor entry is wrapped

    // …and the reverse: the type lists its instances.
    const back = await state.neighbors('r', '_types/note', { dir: 'in' });
    expect(back.inbound.some((x) => x.from === 'kb/1' && x.derived)).toBe(true);
  });

  it('attention.unlinked stays authored-only — the backbone does not mask the weave signal', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: '_types/note', value: {}, type: 'type-decl' }, alice);
    await state.put({ scope: 'r', key: 'kb/1', value: { text: 'hi' }, type: 'note' }, alice);

    // kb/1 has a derived edge to its type but no *authored* edge → still flagged.
    const att = await state.attention('r', { includeSystem: false });
    expect(att.unlinked).toContain('kb/1');
  });

  // ── ADR-0003: declared Reference rules ──────────────────────────
  const has = (edges: ReturnType<typeof deriveBackboneEdges>, from: string, rel: string, to: string): boolean =>
    edges.some((e) => e.from === from && e.rel === rel && e.to === to && e.derived === true);

  it('embedded ref rule: a ref[] field becomes edges to each present key', () => {
    const records = [
      rec('claim/1', 'claim', { statement: 'x', support: ['kb/a', 'kb/b', 'kb/gone'] }),
      rec('kb/a', 'knowledge', {}),
      rec('kb/b', 'knowledge', {}),
    ];
    const rules = { claim: { refs: [{ name: 'support', rel: 'supports', list: true }] } };
    const edges = deriveBackboneEdges(records, rules);
    expect(has(edges, 'claim/1', 'supports', 'kb/a')).toBe(true);
    expect(has(edges, 'claim/1', 'supports', 'kb/b')).toBe(true);
    expect(edges.some((e) => e.to === 'kb/gone')).toBe(false); // no-dangle: absent target dropped
  });

  it('embedded ref rule: a single (non-list) ref uses the field name when no rel', () => {
    const records = [rec('t/1', 'task', { owner: 'kb/p' }), rec('kb/p', 'knowledge', {})];
    const edges = deriveBackboneEdges(records, { task: { refs: [{ name: 'owner' }] } });
    expect(has(edges, 't/1', 'owner', 'kb/p')).toBe(true);
  });

  it('stamps per-rule strength: embedded evidence > membership > structural plumbing (ADR-0009)', () => {
    const records = [
      rec('claim/1', 'claim', { statement: 'x', support: ['kb/a'] }),
      rec('kb/a', 'knowledge', {}),
      rec('_types/claim', 'type-decl', {}),
      rec('_views/all-claims', 'view', { query: { type: 'claim' } }),
      rec('blk:1', 'doc-block', {}),
      rec('_doc/d/blk:1', 'doc-order', { seq: 1 }),
      rec('doc:d', 'doc', {}),
    ];
    const rules = {
      claim: { refs: [{ name: 'support', rel: 'supports', list: true }] },
      'doc-order': { keyPattern: '_doc/{doc}/{block}', keyEdges: [{ from: '{block}', rel: 'inDoc', to: 'doc:{doc}' }] },
    };
    const edges = deriveBackboneEdges(records, rules);
    const strengthOf = (rel: string) => edges.find((e) => e.rel === rel)?.strength;
    expect(strengthOf('supports')).toBe(0.6); // embedded evidence (a ref field)
    expect(strengthOf('inView')).toBe(0.4); // collection membership
    expect(strengthOf('inDoc')).toBe(0.4); // key-encoded membership
    expect(strengthOf('instanceOf')).toBe(0.2); // structural plumbing
  });

  it('key-encoded rule: a keyPattern + keyEdges emits membership from the key', () => {
    const records = [
      rec('_doc/doc:demo/cell:x', 'doc-order', { seq: 1 }),
      rec('doc:demo', 'doc', { title: 'Demo' }),
      rec('cell:x', 'doc-block', { content: 'hi' }),
    ];
    const rules = {
      'doc-order': { keyPattern: '_doc/{doc}/{block}', keyEdges: [{ from: '{block}', rel: 'inDoc', to: '{doc}' }] },
    };
    const edges = deriveBackboneEdges(records, rules);
    expect(has(edges, 'cell:x', 'inDoc', 'doc:demo')).toBe(true);
  });

  it('slice-declared refs apply too: a _types/<type> fact with a ref field drives the rule', () => {
    // claim is slice-declared (not canonical); its ref must still be picked up.
    const records = [
      rec('_types/claim', 'type-decl', { fields: [{ name: 'support', type: 'ref', list: true, rel: 'supports' }] }),
      rec('claim/1', 'claim', { statement: 'x', support: ['kb/a'] }),
      rec('kb/a', 'knowledge', {}),
    ];
    const edges = deriveBackboneEdges(records); // no canonical typeRules passed
    expect(has(edges, 'claim/1', 'supports', 'kb/a')).toBe(true);
  });

  it('rules are additive — with none declared, the structural backbone is unchanged', () => {
    const records = [rec('kb/1', 'note', { text: 'hi' }), rec('_types/note', 'type-decl', {})];
    expect(deriveBackboneEdges(records)).toEqual(deriveBackboneEdges(records, {}));
  });
});

describe('collections: members (ADR-0005)', () => {
  it('intensional — a view fact evaluates its query', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: '_views/todos', value: { id: 'todos', query: { type: 'todo' } }, type: 'view' }, alice);
    await state.put({ scope: 'r', key: 't1', value: { text: 'a' }, type: 'todo' }, alice);
    await state.put({ scope: 'r', key: 't2', value: { text: 'b' }, type: 'todo' }, alice);
    await state.put({ scope: 'r', key: 'n1', value: { text: 'x' }, type: 'note' }, alice);

    const res = await state.members('r', '_views/todos');
    expect(res.membership).toBe('intensional');
    expect(res.members.map((m) => m.key).sort()).toEqual(['t1', 't2']);
  });

  it('extensional — a doc fact gathers its inbound inDoc members', async () => {
    const state = createObservedState(createMemoryStateStore());
    // doc-order type declares the key-encoded inDoc rule (slice-declared here)
    await state.put(
      { scope: 'r', key: '_types/doc-order', value: { keyPattern: '_doc/{doc}/{block}', keyEdges: [{ from: '{block}', rel: 'inDoc', to: 'doc:{doc}' }] }, type: 'type-decl' },
      alice,
    );
    await state.put({ scope: 'r', key: 'doc:guide', value: { title: 'Guide' }, type: 'doc' }, alice);
    await state.put({ scope: 'r', key: 'blk:1', value: { content: 'one' }, type: 'doc-block' }, alice);
    await state.put({ scope: 'r', key: 'blk:2', value: { content: 'two' }, type: 'doc-block' }, alice);
    await state.put({ scope: 'r', key: '_doc/guide/blk:1', value: { seq: 1 }, type: 'doc-order' }, alice);
    await state.put({ scope: 'r', key: '_doc/guide/blk:2', value: { seq: 2 }, type: 'doc-order' }, alice);

    const res = await state.members('r', 'doc:guide');
    expect(res.membership).toBe('extensional');
    expect(res.members.map((m) => m.key).sort()).toEqual(['blk:1', 'blk:2']);
  });

  it('extensional — members are ordered by the decoration seq, not salience', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put(
      { scope: 'r', key: '_types/doc-order', value: { keyPattern: '_doc/{doc}/{block}', keyEdges: [{ from: '{block}', rel: 'inDoc', to: 'doc:{doc}' }] }, type: 'type-decl' },
      alice,
    );
    await state.put({ scope: 'r', key: 'doc:guide', value: { title: 'Guide' }, type: 'doc' }, alice);
    // blk:a is written first (lower salience by recency) but placed LAST by seq;
    // blk:b is written last (higher salience) but placed FIRST by seq — so a pure
    // salience sort would invert the narrative order.
    await state.put({ scope: 'r', key: 'blk:a', value: { content: 'first written' }, type: 'doc-block' }, alice);
    await state.put({ scope: 'r', key: 'blk:b', value: { content: 'last written' }, type: 'doc-block' }, alice);
    await state.put({ scope: 'r', key: '_doc/guide/blk:a', value: { seq: 2 }, type: 'doc-order' }, alice);
    await state.put({ scope: 'r', key: '_doc/guide/blk:b', value: { seq: 1 }, type: 'doc-order' }, alice);

    const res = await state.members('r', 'doc:guide');
    expect(res.order).toBe('seq');
    expect(res.members.map((m) => m.key)).toEqual(['blk:b', 'blk:a']);
  });

  it('extensional — falls back to salience order when no decoration carries a seq', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: '_views/board', value: { id: 'board' }, type: 'collection' }, alice);
    await state.put({ scope: 'r', key: 'x1', value: { text: 'a' }, type: 'note' }, alice);
    // an authored membership edge, no ordering decoration behind it
    await state.link('r', 'x1', 'inView', '_views/board', 1, alice);

    const res = await state.members('r', '_views/board');
    expect(res.membership).toBe('extensional');
    expect(res.order).toBe('salience');
    expect(res.members.map((m) => m.key)).toEqual(['x1']);
  });
});

describe('salience: explain breakdown (ADR-0006)', () => {
  it('omits the breakdown by default and attaches it under explain', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: 'k', value: 1, type: 'note' }, alice);

    const plain = await state.read('r', { elision: 'none' });
    expect(plain.entries['k']._meta.explain).toBeUndefined();

    const res = await state.read('r', { elision: 'none', explain: true });
    const ex = res.entries['k']._meta.explain;
    expect(ex).toBeDefined();
    expect(Object.keys(ex!.signals).sort()).toEqual(['attention', 'centrality', 'recency', 'standing', 'velocity']);
    // contribution = signal × weight, term by term
    for (const term of ['recency', 'velocity', 'attention', 'standing', 'centrality'] as const) {
      expect(ex!.contribution[term]).toBeCloseTo(ex!.signals[term] * ex!.weights[term], 4);
    }
    // and the contributions sum (pre-clamp) to the published score
    const sum = Object.values(ex!.contribution).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(res.entries['k']._meta.score, 3);
  });

  it('the explained weights honor the per-call lens (connected ⇒ centrality-heavy)', async () => {
    const state = createObservedState(createMemoryStateStore());
    await state.put({ scope: 'r', key: 'k', value: 1, type: 'note' }, alice);
    const res = await state.read('r', { elision: 'none', explain: true, lens: 'connected' });
    const w = res.entries['k']._meta.explain!.weights;
    // 'connected' biases the blend toward centrality (see LENS presets)
    expect(w.centrality).toBeGreaterThan(w.recency);
  });

  it('centrality feed includes the whole Reference projection — an embedded ref raises degree', async () => {
    const state = createObservedState(createMemoryStateStore());
    // claim.support is an embedded ref rule: claim --support--> each key.
    const typeRules = { claim: { refs: [{ name: 'support', rel: 'supports', list: true }] } };
    await state.put({ scope: 'r', key: 'kb/a', value: { text: 'cited' }, type: 'note' }, alice);
    await state.put({ scope: 'r', key: 'claims/c', value: { statement: 's', support: ['kb/a'] }, type: 'claim' }, alice);

    const withRules = await state.read('r', { elision: 'none', explain: true, typeRules });
    const without = await state.read('r', { elision: 'none', explain: true });
    // the cited note's centrality degree must count the derived `supports` edge
    expect(withRules.entries['kb/a']._meta.explain!.degree).toBeGreaterThan(
      without.entries['kb/a']._meta.explain!.degree,
    );
  });
});
