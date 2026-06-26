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

/** Unordered pair key — `similarTo` is symmetric in intent, and an authored edge in
 *  *either* direction already connects the two facts, so kinship would be redundant.
 *  The ` ` separator can't occur in a fact key, so the join is unambiguous. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/**
 * The set of fact-pairs an *authored* (non-inferred) edge already connects, in either
 * direction. A `similarTo` hint between an already-connected pair adds no structure and
 * no salience signal a human/grant didn't already assert — so we neither create nor keep
 * one (ADR-0032: similarTo is a suggestion to connect, redundant once a real edge exists).
 */
export function authoredPairs(existing: EdgeRecord[]): Set<string> {
  const pairs = new Set<string>();
  for (const e of existing) {
    if (e.rel === SIMILAR_REL && e.writer === SIMILAR_WRITER) continue;
    pairs.add(pairKey(e.from, e.to));
  }
  return pairs;
}

/**
 * Reconcile `key`'s outbound `similarTo` edges to exactly the neighbours *not already
 * connected by an authored edge* (delete stale, add new) — idempotent, so re-indexing a
 * fact whose neighbours shifted self-heals, and a neighbour that later gains a real edge
 * has its redundant kinship pruned on the next pass. `existing` is the scope's full edge
 * list (read once per batch); `nowIso` stamps new edges (callers pass a timestamp — keeps
 * this pure of the clock).
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
  const authored = authoredPairs(existing);
  const mine = existing.filter((e) => e.from === key && e.rel === SIMILAR_REL && e.writer === SIMILAR_WRITER);
  // Only neighbours not already connected by an authored edge are worth a kinship hint.
  const want = new Set(neighbors.filter((n) => n.key !== key && !authored.has(pairKey(key, n.key))).map((n) => n.key));
  const have = new Set(mine.map((e) => e.to));
  for (const e of mine) if (!want.has(e.to)) await io.deleteEdge(scope, e.from, e.rel, e.to);
  for (const n of neighbors) {
    if (!want.has(n.key) || have.has(n.key)) continue;
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

/**
 * The vocabulary a suggested kinship can be *ratified* into (ADR-0032 Option C) — a
 * richer, directional relation than the generic `similarTo` hint. Advisory: `ratify`
 * accepts any `rel`, but these are the recommended labels surfaced to the user.
 */
export const RATIFY_LINK_TYPES = ['refines', 'grounds', 'duplicates', 'contradicts', 'elaborates', 'relatesTo'] as const;
export type RatifyLinkType = (typeof RATIFY_LINK_TYPES)[number];

/** One ratification candidate — an inferred `similarTo` between two facts, as an
 *  unordered pair (reciprocal A→B / B→A collapse to one). */
export interface SuggestionCandidate {
  from: string;
  to: string;
  strength: number | null;
  createdAt: string;
}

/**
 * Collapse a scope's inferred `similarTo` edges to unique unordered pairs — the
 * ratification candidates (ADR-0032). Authored-connected pairs are already excluded at
 * write time (dedup-on-create), so what remains is genuinely "a link a person might
 * want". Keeps the strongest of a reciprocal pair.
 */
export function suggestionCandidates(edges: EdgeRecord[]): SuggestionCandidate[] {
  const best = new Map<string, SuggestionCandidate>();
  for (const e of edges) {
    if (e.rel !== SIMILAR_REL || e.writer !== SIMILAR_WRITER) continue;
    const pk = pairKey(e.from, e.to);
    const prior = best.get(pk);
    if (!prior || (e.strength ?? 0) > (prior.strength ?? 0)) {
      best.set(pk, { from: e.from, to: e.to, strength: e.strength, createdAt: e.createdAt });
    }
  }
  return [...best.values()];
}

/**
 * Drop both directed inferred `similarTo` edges between a pair — called on `ratify`,
 * since the authored typed edge makes the machine's hint redundant. Returns the count
 * removed (`existing` is the scope's edge list, read once).
 */
export async function dropSimilarPair(io: EdgeIO, scope: string, a: string, b: string, existing: EdgeRecord[]): Promise<number> {
  let removed = 0;
  for (const e of existing) {
    if (
      e.rel === SIMILAR_REL &&
      e.writer === SIMILAR_WRITER &&
      ((e.from === a && e.to === b) || (e.from === b && e.to === a))
    ) {
      await io.deleteEdge(scope, e.from, e.rel, e.to);
      removed++;
    }
  }
  return removed;
}
