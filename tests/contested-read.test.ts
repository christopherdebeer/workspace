/**
 * ADR-0072 (C7) — the contested read, Stage A gate.
 *
 * Candidates are semantically-near pairs (inferred `similarTo`) that no authored
 * edge connects, sharing a type or tag, not yet adjudicated. The gate proves the
 * preconditions (common ground, cosine floor, authored exclusion, noise filter)
 * and the idempotence contract: a `checked/<hash>` marker with matching versions
 * hides the pair; version drift re-opens it.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createObservedState, createMemoryStateStore, contentHash, SIMILAR_REL, SIMILAR_WRITER } from '../platform/runtime';
import { pairKey } from '../platform/runtime/similar-edges';
import { createMemoryGrantStore } from '../services/workspace/grants';
import type { ServiceContext } from '../platform/runtime';

function ctxFor(user: string): ServiceContext {
  return {
    identity: { user, scopes: ['workspace:write', 'workspace:read'] },
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

describe('ADR-0072 — the contested read (Stage A)', () => {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore(), store }));
  const ctx = ctxFor('alice');
  const scope = 'alice';

  const similar = (from: string, to: string, score: number) =>
    store.putEdge({ scope, from, rel: SIMILAR_REL, to, strength: 0.3, createdAt: '2026-07-09T00:00:00Z', writer: SIMILAR_WRITER, score });

  beforeAll(async () => {
    // A close same-type pair with divergent claims — the canonical candidate.
    await cmds.remember({ key: 'k/a', value: { claim: 'X is true' }, type: 'knowledge' }, ctx);
    await cmds.remember({ key: 'k/b', value: { claim: 'X is false' }, type: 'knowledge' }, ctx);
    await similar('k/a', 'k/b', 0.9);
    // Near pair with NO common ground (different types, no shared tags) — excluded.
    await cmds.remember({ key: 'k/c', value: { n: 1 }, type: 'note' }, ctx);
    await cmds.remember({ key: 'k/d', value: { n: 2 }, type: 'decision' }, ctx);
    await similar('k/c', 'k/d', 0.9);
    // Shared-tag pair across types — included (tags are common ground).
    await cmds.remember({ key: 'k/e', value: { n: 3 }, type: 'note', tags: ['topicX'] }, ctx);
    await cmds.remember({ key: 'k/f', value: { n: 4 }, type: 'decision', tags: ['topicX'] }, ctx);
    await similar('k/e', 'k/f', 0.8);
    // Same type but below the cosine floor — excluded at default minScore.
    await cmds.remember({ key: 'k/g', value: { n: 5 }, type: 'knowledge' }, ctx);
    await similar('k/a', 'k/g', 0.3);
    // Same type, near — but an AUTHORED edge already connects them: excluded.
    await cmds.remember({ key: 'k/h', value: { n: 6 }, type: 'knowledge' }, ctx);
    await cmds.remember({ key: 'k/i', value: { n: 7 }, type: 'knowledge' }, ctx);
    await similar('k/h', 'k/i', 0.9);
    await cmds.link({ from: 'k/h', rel: 'refines', to: 'k/i' }, ctx);
    // Noise: `_` plumbing — excluded by default.
    await cmds.remember({ key: '_sys/x', value: { n: 8 }, type: 'knowledge' }, ctx);
    await similar('_sys/x', 'k/a', 0.9);
  });

  const pairs = (r: { candidates: Array<{ a: string; b: string }> }) => r.candidates.map((c) => pairKey(c.a, c.b)).sort();

  it('surfaces near pairs with common ground; excludes no-common-ground, low-cosine, authored, and noise', async () => {
    const res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).toEqual([pairKey('k/a', 'k/b'), pairKey('k/e', 'k/f')]);
    const ab = res.candidates.find((c) => pairKey(c.a, c.b) === pairKey('k/a', 'k/b'))!;
    expect(ab.sharedTags).toEqual([]);
    expect(ab.aType).toBe('knowledge');
    expect(ab.hash).toBe(contentHash(pairKey('k/a', 'k/b')));
    expect(ab.versions.a).toBeTruthy();
    const ef = res.candidates.find((c) => pairKey(c.a, c.b) === pairKey('k/e', 'k/f'))!;
    expect(ef.sharedTags).toEqual(['topicX']);
  });

  it('minScore raises the floor', async () => {
    const res = await cmds.contested({ minScore: 0.85 }, ctx);
    expect(pairs(res)).toEqual([pairKey('k/a', 'k/b')]); // 0.8 pair drops out
  });

  it('a checked/<hash> marker with matching versions hides the pair (idempotence)…', async () => {
    const before = await cmds.contested(undefined, ctx);
    const ab = before.candidates.find((c) => pairKey(c.a, c.b) === pairKey('k/a', 'k/b'))!;
    await cmds.remember(
      {
        key: `checked/${ab.hash}`,
        value: { a: ab.a, b: ab.b, verdict: 'independent', versions: { [ab.a]: ab.versions.a, [ab.b]: ab.versions.b } },
        type: 'adjudication',
        via: 'contested-test',
      },
      ctx,
    );
    const after = await cmds.contested(undefined, ctx);
    expect(pairs(after)).toEqual([pairKey('k/e', 'k/f')]);
    expect(after.checked).toBe(1);
  });

  it('…and version drift re-opens it', async () => {
    await cmds.remember({ key: 'k/a', value: { claim: 'X is true, revised' }, type: 'knowledge' }, ctx);
    const res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).toContain(pairKey('k/a', 'k/b'));
    expect(res.checked).toBe(0);
  });

  it('the limit caps output but total counts everything', async () => {
    const res = await cmds.contested({ limit: 1 }, ctx);
    expect(res.candidates).toHaveLength(1);
    expect(res.total).toBe(2);
  });

  it('mechanically degenerate pairs (same-source / containment) are skipped, counted (W4c)', async () => {
    // Sibling doc-blocks of one doc + a block vs its own parent file: same type
    // by construction, ~1.0 cosine by construction — they cannot contradict, so
    // contested must not surface them (the wave-4 consolidate driver had to
    // lease + inspect exactly such a pair to learn what the keys already said).
    await cmds.remember({ key: 'doc-block:docs/g/1', value: { content: 'part one' }, type: 'doc-block' }, ctx);
    await cmds.remember({ key: 'doc-block:docs/g/2', value: { content: 'part two' }, type: 'doc-block' }, ctx);
    await cmds.remember({ key: 'file/docs/g.md', value: { content: 'the whole doc' }, type: 'doc-block' }, ctx);
    await similar('doc-block:docs/g/1', 'doc-block:docs/g/2', 0.99); // same-source
    await similar('doc-block:docs/g/1', 'file/docs/g.md', 0.98); // containment
    const res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).not.toContain(pairKey('doc-block:docs/g/1', 'doc-block:docs/g/2'));
    expect(pairs(res)).not.toContain(pairKey('doc-block:docs/g/1', 'file/docs/g.md'));
    expect(res.degenerate).toBeGreaterThanOrEqual(2);
  });

  it('byte-identical CONTENT across unrelated keys is skipped too (W4l) — cannot contradict', async () => {
    // Cross-document boilerplate: the same "### Shape" heading in two unrelated
    // docs. Same type, ~1.0 cosine, but IDENTICAL text — it cannot contradict
    // itself. `degeneracyOf` (key-structural) misses these; the content-hash
    // version equality catches them (the wave-4 consolidate driver adjudicated
    // 8 such pairs, every one `independent`).
    await cmds.remember({ key: 'adrX/6', value: { content: '### Shape' }, type: 'doc-block' }, ctx);
    await cmds.remember({ key: 'adrY/6', value: { content: '### Shape' }, type: 'doc-block' }, ctx);
    await similar('adrX/6', 'adrY/6', 0.99);
    const res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).not.toContain(pairKey('adrX/6', 'adrY/6'));
    expect(res.degenerate).toBeGreaterThanOrEqual(1);
  });

  it('noise types are slice-declared (_config/suggestions), not only hardcoded', async () => {
    // Declare a slice-local noise type: the built-in set is only the floor.
    await cmds.remember({ key: '_config/suggestions', value: { noiseTypes: ['decision'] } }, ctx);
    let res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).not.toContain(pairKey('k/e', 'k/f')); // k/f is a decision → now noise
    // …and admitTypes re-admits a floor entry the same open-ended way.
    await cmds.remember({ key: '_config/suggestions', value: { noiseTypes: ['decision'], admitTypes: ['decision'] } }, ctx);
    res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).toContain(pairKey('k/e', 'k/f'));
    await cmds.supersede({ key: '_config/suggestions' }, ctx);
  });

  it('ephemeral machinery is skipped, counted: a delete-timer fact (a lease) is never a candidate (wave-5)', async () => {
    // Two live work leases — coordination artefacts that cluster at ~1.0 cosine
    // by format. Whatever their type is named, the delete-effect timer IS the
    // declaration that they are machinery, not knowledge. Typed 'knowledge'
    // here so nothing but the timer gate can be doing the excluding.
    await cmds.remember({ key: 'lease/suggestion/aaa', value: { holder: 'judge/alpha' }, type: 'knowledge', timer: { ms: 15 * 60_000, effect: 'delete' } }, ctx);
    await cmds.remember({ key: 'lease/suggestion/bbb', value: { holder: 'judge/beta' }, type: 'knowledge', timer: { ms: 15 * 60_000, effect: 'delete' } }, ctx);
    await similar('lease/suggestion/aaa', 'lease/suggestion/bbb', 0.99);
    const res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).not.toContain(pairKey('lease/suggestion/aaa', 'lease/suggestion/bbb'));
    expect(res.ephemeral).toBeGreaterThanOrEqual(1);
  });

  it('…and a LAPSED delete-timer row (awaiting DDB TTL, up to 24h) stays out the same way', async () => {
    // The wave-5 live finding: timer-deleted `lease/suggestion/*` rows led the
    // real contested read at 0.99 cosine — peek said null, but the raw row (and
    // its similarTo edges) lingered until DDB TTL (expiry + 24h). Timer-liveness
    // is a READ-time contract; contested re-checks it, never trusting the list.
    const past = new Date(Date.now() - 60_000).toISOString();
    await cmds.remember({ key: 'lease/pair/ccc', value: { holder: 'judge/alpha' }, type: 'knowledge', timer: { at: past, effect: 'delete' } }, ctx);
    await cmds.remember({ key: 'k/j', value: { claim: 'held item' }, type: 'knowledge' }, ctx);
    await similar('lease/pair/ccc', 'k/j', 0.95);
    const res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).not.toContain(pairKey('lease/pair/ccc', 'k/j'));
  });

  it('a type declared operational in $types is machinery, not a candidate (wave-5, slice vocabulary)', async () => {
    // The $types home: `_types/<name>` {operational: true} marks a slice's own
    // coordination vocabulary as never-a-candidate. Durable markers here (no
    // timer), so this exercises the DECLARED layer, not the timer gate — and
    // the pair is visible BEFORE the declaration, proving the flag did it.
    await cmds.remember({ key: 'marker/one', value: { note: 'adjudicated pair one' }, type: 'adjudication-marker' }, ctx);
    await cmds.remember({ key: 'marker/two', value: { note: 'adjudicated pair two' }, type: 'adjudication-marker' }, ctx);
    await similar('marker/one', 'marker/two', 0.97);
    let res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).toContain(pairKey('marker/one', 'marker/two'));
    await cmds.remember({ key: '_types/adjudication-marker', value: { icon: '✓', operational: true } }, ctx);
    res = await cmds.contested(undefined, ctx);
    expect(pairs(res)).not.toContain(pairKey('marker/one', 'marker/two'));
    await cmds.supersede({ key: '_types/adjudication-marker' }, ctx);
  });
});
