/**
 * Inbound reconciliation of inferred `similarTo` edges.
 *
 * The defect, measured live on the c15r slice (2026-07-29):
 *
 *   doc-block:docs/dynamic-cells/9        "## Architecture"
 *     --similarTo (score 0.99997, created 2026-07-11)-->
 *   doc-block:docs/ancestor/sync/frontend-unify/4   a TypeScript snippet
 *
 * Both endpoints were headings on 2026-07-11. On 2026-07-22 the second document was
 * re-decomposed and ordinal 4 became code. Block 4's OUTBOUND edges were re-reconciled
 * that day — every one of them lands at ~0.51–0.55 against code siblings. The inbound
 * heading claim was never revisited, because `refreshSimilarEdges` only ever reconciles
 * the edges a fact writes outbound. A frozen 0.99997 then led `suggestions` (the
 * `genuineOnly` head was 12/12 artefacts of this) and fed `centrality` as if it were real.
 *
 * `similarTo` is a symmetric claim maintained from one side only. That is the bug.
 */
import { reconcileInbound, refreshSimilarEdges, INBOUND_HORIZON } from '../platform/runtime/similar-edges';
import type { EdgeRecord } from '../platform/runtime/state';
import type { VectorMatch } from '../platform/runtime/vectors';

const SIMILAR = { rel: 'similarTo', writer: 'platform/vectors' } as const;

const inferred = (from: string, to: string, score: number | null): EdgeRecord =>
  ({ scope: 's', from, to, rel: SIMILAR.rel, writer: SIMILAR.writer, strength: 0.3, score, createdAt: '2026-07-11T00:00:00.000Z' }) as unknown as EdgeRecord;

const match = (key: string, score: number): VectorMatch => ({ key, score, distance: 1 - score }) as VectorMatch;

/** A recording EdgeIO — the seam is three methods wide. */
function io(existing: EdgeRecord[] = []) {
  const puts: EdgeRecord[] = [];
  const deletes: Array<[string, string, string]> = [];
  return {
    puts,
    deletes,
    listEdges: async () => existing,
    putEdge: async (e: EdgeRecord) => void puts.push(e),
    deleteEdge: async (_scope: string, from: string, rel: string, to: string) => void deletes.push([from, rel, to]),
  };
}

describe('reconcileInbound — correct what we can measure, delete only what we can disprove', () => {
  it('deletes an inbound claim whose stored score is impossible given fresh evidence', async () => {
    // The live case: `key`'s text changed, and its real neighbourhood now tops out at 0.55.
    const existing = [inferred('doc-block:docs/dynamic-cells/9', 'block/4', 0.99997)];
    const target = io(existing);
    const fresh = [match('block/6', 0.5556), match('block/8', 0.5556), match('block/12', 0.5392), match('block/10', 0.5148)];

    const res = await reconcileInbound(target, 's', 'block/4', fresh, 0.3, existing);

    // 0.99997 would have ranked first in what we just looked at. It didn't — so it is
    // measuring text that no longer exists.
    expect(res).toEqual({ corrected: 0, dropped: 1 });
    expect(target.deletes).toEqual([['doc-block:docs/dynamic-cells/9', 'similarTo', 'block/4']]);
    expect(target.puts).toEqual([]);
  });

  it('corrects — never deletes — an inbound claim from a peer still in the neighbourhood', async () => {
    const existing = [inferred('block/6', 'block/4', 0.98)];
    const target = io(existing);
    const fresh = [match('block/6', 0.5556), match('block/8', 0.5)];

    const res = await reconcileInbound(target, 's', 'block/4', fresh, 0.3, existing);

    expect(res).toEqual({ corrected: 1, dropped: 0 });
    expect(target.deletes).toEqual([]);
    // The claim is the same claim, re-measured: score refreshed, `createdAt` preserved
    // so the kinship doesn't keep resetting its own age on every reindex.
    expect(target.puts[0]).toMatchObject({ from: 'block/6', to: 'block/4', score: 0.5556, createdAt: '2026-07-11T00:00:00.000Z' });
  });

  it('leaves an unfalsifiable claim alone: k-NN is not symmetric', async () => {
    // A peer may legitimately hold `key` in its top-k while `key` does not hold the peer
    // in its own. Pruning those would collapse the graph to mutual-kNN — and take
    // `centrality` with it. Below the horizon's floor we have no evidence, so we act on none.
    const existing = [inferred('far/peer', 'block/4', 0.36)];
    const target = io(existing);
    const fresh = [match('block/6', 0.9), match('block/8', 0.4)]; // floor 0.4 > 0.36

    expect(await reconcileInbound(target, 's', 'block/4', fresh, 0.3, existing)).toEqual({ corrected: 0, dropped: 0 });
    expect(target.deletes).toEqual([]);
    expect(target.puts).toEqual([]);
  });

  it('with no fresh neighbourhood to compare against, disproves nothing', async () => {
    const existing = [inferred('a', 'block/4', 0.99), inferred('b', 'block/4', null)];
    const target = io(existing);
    expect(await reconcileInbound(target, 's', 'block/4', [], 0.3, existing)).toEqual({ corrected: 0, dropped: 0 });
    expect(target.deletes).toEqual([]);
  });

  it('touches only inferred edges pointing AT the key', async () => {
    const authored = { scope: 's', from: 'x', to: 'block/4', rel: 'refines', writer: 'c15r', strength: 1, score: null, createdAt: '' } as unknown as EdgeRecord;
    const existing = [
      authored, // authored — never the reconciler's business
      inferred('block/4', 'other', 0.99), // OUTBOUND — refreshSimilarEdges owns this
      inferred('stale', 'block/4', 0.99), // inbound, disprovable
      inferred('n', 'unrelated', 0.99), // a different fact entirely
    ];
    const target = io(existing);

    await reconcileInbound(target, 's', 'block/4', [match('n1', 0.5)], 0.3, existing);

    expect(target.deletes).toEqual([['stale', 'similarTo', 'block/4']]);
  });

  it('a score-less legacy edge is corrected when measurable and kept when not', async () => {
    // Edges written before the cosine was persisted carry score null: measurable ones
    // gain a real score, unmeasurable ones must not be deleted on an absent number.
    const existing = [inferred('near', 'block/4', null), inferred('far', 'block/4', null)];
    const target = io(existing);

    const res = await reconcileInbound(target, 's', 'block/4', [match('near', 0.62)], 0.3, existing);

    expect(res).toEqual({ corrected: 1, dropped: 0 });
    expect(target.puts[0]).toMatchObject({ from: 'near', score: 0.62 });
    expect(target.deletes).toEqual([]);
  });

  it('composes with the outbound pass without either undoing the other', async () => {
    // Both run over the same `existing` snapshot in the indexer; they must partition it.
    const existing = [inferred('block/4', 'gone', 0.9), inferred('stale', 'block/4', 0.99)];
    const target = io(existing);
    const fresh = [match('block/6', 0.55)];

    await refreshSimilarEdges(target, 's', 'block/4', fresh, 0.3, existing, '2026-07-29T00:00:00.000Z');
    await reconcileInbound(target, 's', 'block/4', fresh, 0.3, existing);

    // Outbound: 'gone' dropped, 'block/6' added. Inbound: 'stale' dropped. No overlap.
    expect(target.deletes).toEqual([
      ['block/4', 'similarTo', 'gone'],
      ['stale', 'similarTo', 'block/4'],
    ]);
    expect(target.puts.map((e) => `${e.from}->${e.to}`)).toEqual(['block/4->block/6']);
  });

  it('the horizon is wider than a default outbound k, so the floor is a real bound', () => {
    // If the inbound floor were just the k-th outbound neighbour, almost every inbound
    // edge would sit "above the floor" and be deleted. The width is what keeps this
    // conservative — see the module docstring.
    expect(INBOUND_HORIZON).toBeGreaterThan(5);
  });
});
