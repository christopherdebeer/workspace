/**
 * `narrowKeyEdges` — the `edges({keys})` framing served by per-key index
 * queries instead of the whole-projection read.
 *
 * The contract: the result SET is identical to the old shape (full
 * `state.edges` filtered to edges touching a requested key) — same edges, same
 * both-endpoint coverage rule for folded keys, deduped — while the read cost is
 * 2 narrow queries per key instead of a full edge-partition read per request
 * (which the client's response-size chunking used to MULTIPLY).
 */
import { narrowKeyEdges } from '../services/workspace/commands-graph';
import { createMemoryStateStore } from '../platform/runtime';
import type { StateStore } from '../platform/runtime';

async function seed(): Promise<StateStore> {
  const store = createMemoryStateStore();
  const put = (scope: string, from: string, rel: string, to: string): Promise<void> =>
    store.putEdge({ scope, from, rel, to, strength: null, createdAt: '2026-07-29T00:00:00.000Z', writer: scope });
  // Viewer's own slice.
  await put('me', 'kb/a', 'refines', 'kb/b');
  await put('me', 'kb/c', 'grounds', 'kb/a');
  await put('me', 'kb/x', 'relatesTo', 'kb/y'); // touches no requested key
  // A granting owner's slice: one fully-public edge, one edge into a private fact.
  await put('owner', 'doc:pub/1', 'references', 'doc:pub/2');
  await put('owner', 'doc:pub/1', 'refines', 'kb/private');
  return store;
}

describe('narrowKeyEdges', () => {
  it('returns exactly the edges touching a requested own key, deduped', async () => {
    const store = await seed();
    const out = await narrowKeyEdges(store, 'me', ['kb/a'], new Map());
    // Both directions of kb/a — outbound refines, inbound grounds — nothing else.
    expect(out.map((e) => `${e.from} ${e.rel} ${e.to}`).sort()).toEqual(['kb/a refines kb/b', 'kb/c grounds kb/a']);
    // An edge whose BOTH endpoints are requested arrives once, not twice.
    const both = await narrowKeyEdges(store, 'me', ['kb/a', 'kb/b'], new Map());
    expect(both.filter((e) => e.from === 'kb/a' && e.to === 'kb/b')).toHaveLength(1);
  });

  it('folded keys query the granting owner narrowly under the both-endpoint rule', async () => {
    const store = await seed();
    const foreign = new Map([['owner', ['doc:pub/*']]]);
    const out = await narrowKeyEdges(store, 'me', ['owner/doc:pub/1'], foreign);
    // The public↔public edge folds in, re-prefixed; the edge into the private
    // fact never leaks its far endpoint.
    expect(out.map((e) => `${e.from} ${e.rel} ${e.to}`)).toEqual(['owner/doc:pub/1 references owner/doc:pub/2']);
  });

  it('mixes own and folded keys in one call', async () => {
    const store = await seed();
    const foreign = new Map([['owner', ['doc:pub/*']]]);
    const out = await narrowKeyEdges(store, 'me', ['kb/a', 'owner/doc:pub/1'], foreign);
    expect(out.map((e) => `${e.from} ${e.rel} ${e.to}`).sort()).toEqual([
      'kb/a refines kb/b',
      'kb/c grounds kb/a',
      'owner/doc:pub/1 references owner/doc:pub/2',
    ]);
  });

  it('an own key containing a slash is not mistaken for a folded key', async () => {
    const store = await seed();
    // No grant owner named `kb`, so `kb/a` must resolve in the viewer's slice.
    const out = await narrowKeyEdges(store, 'me', ['kb/a'], new Map([['other', ['*']]]));
    expect(out).toHaveLength(2);
  });
});
