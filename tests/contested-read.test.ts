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
});
