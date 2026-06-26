/**
 * Inferred similarity edges (ADR-0031 Option A) — the edge-write seam.
 *
 * Lets platform code (the vector indexer, `reindex`) reconcile a fact's `similarTo`
 * edges directly through the raw `StateStore` edge CRUD — no trajectory event, no
 * endpoint-resolve (those belong to *authored* `workspace.link`). Inferred edges are
 * stamped `writer = platform/vectors` so they're regenerable and distinguishable from
 * authored ones. Because they're persisted authored-style edges, `centrality`
 * (`signalsFor` counts `store.listEdges` + derived) picks them up automatically — so
 * semantically-central facts gain salience with NO scorer change (ADR-0006), and they
 * surface in `neighbors`/`$graph` as "things like this".
 *
 * The index is a candidate generator (ADR-0030 Decision 1); likewise these edges are
 * advisory salience/structure input, never an authority — a dangling `to` (a neighbour
 * later removed) is harmless and pruned on the next pass.
 */
import type { EdgeRecord, StateStore } from './state';
import type { VectorMatch } from './vectors';
import { SIMILAR_REL, SIMILAR_WRITER } from './vectors';

/** The minimal edge surface this seam needs — a subset of `StateStore`. */
export type EdgeIO = Pick<StateStore, 'listEdges' | 'putEdge' | 'deleteEdge'>;

/**
 * Reconcile `key`'s outbound `similarTo` edges to exactly `neighbors` (delete stale,
 * add new) — idempotent, so re-indexing a fact whose neighbours shifted self-heals.
 * `existing` is the scope's full edge list (read once per batch); `nowIso` stamps new
 * edges (callers pass a timestamp — keeps this pure of the clock).
 */
export async function refreshSimilarEdges(
  io: EdgeIO,
  scope: string,
  key: string,
  neighbors: VectorMatch[],
  strength: number,
  existing: EdgeRecord[],
  nowIso: string,
): Promise<void> {
  const mine = existing.filter((e) => e.from === key && e.rel === SIMILAR_REL && e.writer === SIMILAR_WRITER);
  const want = new Set(neighbors.map((n) => n.key));
  const have = new Set(mine.map((e) => e.to));
  for (const e of mine) if (!want.has(e.to)) await io.deleteEdge(scope, e.from, e.rel, e.to);
  for (const n of neighbors) {
    if (n.key === key || have.has(n.key)) continue;
    await io.putEdge({ scope, from: key, rel: SIMILAR_REL, to: n.key, strength, createdAt: nowIso, writer: SIMILAR_WRITER });
  }
}

/** Drop every inferred `similarTo` edge touching `key` (outbound + inbound) — on a
 *  fact's supersession/removal, so a dead fact stops contributing kinship. */
export async function dropSimilarEdges(io: EdgeIO, scope: string, key: string, existing: EdgeRecord[]): Promise<void> {
  for (const e of existing) {
    if (e.rel === SIMILAR_REL && e.writer === SIMILAR_WRITER && (e.from === key || e.to === key)) {
      await io.deleteEdge(scope, e.from, e.rel, e.to);
    }
  }
}
