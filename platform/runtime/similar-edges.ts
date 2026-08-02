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
 * has its redundant kinship pruned on the next pass. `existing` is the edge set TOUCHING
 * `key` (both directions — per-key queries since the 2026-08-01 cost review; a full scope
 * list also works, it's a superset); `nowIso` stamps new edges (callers pass a timestamp —
 * keeps this pure of the clock).
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
    // `strength` stays fixed (centrality weighting unchanged); `score` carries the raw
    // cosine so ratification candidates can be ranked by actual relevance (ADR-0032).
    await io.putEdge({ scope, from: key, rel: SIMILAR_REL, to: n.key, strength, createdAt: nowIso, writer: SIMILAR_WRITER, score: n.score });
  }
}

/**
 * The observation horizon for {@link reconcileInbound} — how deep a fresh k-NN we ask
 * for when re-verifying INBOUND claims. Wider than `sim.k` on purpose: the bottom of
 * this list is the evidentiary floor, and a lower floor makes the reconciler *more*
 * conservative (fewer edges are provably impossible) while letting more inbound peers
 * land in the "known fresh score" branch and be corrected rather than guessed at.
 * Outbound selection still slices to `sim.k` — this only widens what we can *see*.
 */
export const INBOUND_HORIZON = 25;

/** A stored score within this of the fresh one isn't worth a write. */
const SCORE_EPSILON = 0.01;

/**
 * Re-verify the inferred `similarTo` edges pointing AT `key` against `key`'s freshly
 * computed neighbourhood.
 *
 * **The bug this closes.** `similarTo` asserts something symmetric — "these two facts
 * are alike" — but {@link refreshSimilarEdges} only ever reconciles the edges a fact
 * writes *outbound*. So when a fact's text changes, every inbound claim about it
 * survives untouched, still carrying the cosine computed against text that no longer
 * exists. Nothing ever revisits it: the peer only re-evaluates when the peer itself is
 * re-indexed, which for a settled fact may be never.
 *
 * Measured live (2026-07-29, c15r slice): `doc-block:docs/dynamic-cells/9` ("## Architecture")
 * pointed at `doc-block:docs/ancestor/sync/frontend-unify/4` with score 0.99997. True on
 * 2026-07-11, when block 4 of that document also held a heading; on 2026-07-22 the doc was
 * re-decomposed and ordinal 4 became a TypeScript snippet. Block 4's own outbound edges
 * were correctly re-reconciled that day (all ~0.51–0.55, all to code siblings) — the
 * inbound heading claim was not, and a frozen 0.99997 then outranked every honest edge in
 * the slice. The `genuineOnly` head of `suggestions` was 12/12 artefacts of this. Because
 * these edges also feed `centrality`, facts were drawing salience from kinship that had
 * ceased to exist.
 *
 * **The rule: correct what we can measure, delete only what we can disprove.** k-NN is
 * not symmetric, so a peer legitimately having `key` in its top-k while `key` does not
 * have the peer in its own is NOT evidence of staleness — pruning those would quietly
 * collapse the graph to mutual-kNN and take centrality with it. So, per inbound edge:
 *
 *  - peer IS in the fresh matches → we know the current cosine. Rewrite the score.
 *  - peer is absent and the stored score is ABOVE the horizon's floor → impossible: were
 *    that score true the peer would have ranked inside what we just looked at. Delete;
 *    the peer re-asserts on its own next pass if the kinship is still real.
 *  - peer is absent and the stored score is at or below the floor → unfalsifiable from
 *    here. Leave it alone.
 *
 * `matches` is `key`'s fresh k-NN (score-desc, `key` itself allowed); `existing` is the
 * scope's edge list read once per batch. No clock: a corrected edge keeps its original
 * `createdAt`. Best-effort like the rest of this seam.
 */
export async function reconcileInbound(
  io: EdgeIO,
  scope: string,
  key: string,
  matches: VectorMatch[],
  strength: number,
  existing: EdgeRecord[],
): Promise<{ corrected: number; dropped: number }> {
  const fresh = new Map(matches.filter((m) => m.key !== key).map((m) => [m.key, m.score]));
  // The floor of what we just looked at. With nothing to compare against we can
  // disprove nothing, so an empty neighbourhood must leave every edge standing.
  const floor = fresh.size ? Math.min(...fresh.values()) : Infinity;
  let corrected = 0;
  let dropped = 0;
  for (const e of existing) {
    if (e.to !== key || e.rel !== SIMILAR_REL || e.writer !== SIMILAR_WRITER) continue;
    const current = fresh.get(e.from);
    if (current !== undefined) {
      if (e.score === null || e.score === undefined || Math.abs(e.score - current) > SCORE_EPSILON) {
        // Preserve `createdAt`: the kinship is the same claim, re-measured — not a new one.
        await io.putEdge({ scope, from: e.from, rel: SIMILAR_REL, to: key, strength, createdAt: e.createdAt, writer: SIMILAR_WRITER, score: current });
        corrected++;
      }
      continue;
    }
    if (typeof e.score === 'number' && e.score > floor) {
      await io.deleteEdge(scope, e.from, e.rel, e.to);
      dropped++;
    }
  }
  return { corrected, dropped };
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
  /** Raw cosine similarity (ADR-0032) — ranks candidates; may be absent on edges
   *  written before the score was persisted. */
  score: number | null;
  createdAt: string;
}

/** Rank key for a candidate — prefer the persisted cosine, fall back to strength. */
function rankOf(c: { score?: number | null; strength: number | null }): number {
  return c.score ?? c.strength ?? 0;
}

/**
 * Collapse a scope's inferred `similarTo` edges to unique unordered pairs — the
 * ratification candidates (ADR-0032), **sorted by cosine score descending** so the most
 * relevant kinship surfaces first. Authored-connected pairs are already excluded at
 * write time (dedup-on-create), so what remains is genuinely "a link a person might
 * want". Keeps the higher-scoring of a reciprocal pair.
 */
export function suggestionCandidates(edges: EdgeRecord[]): SuggestionCandidate[] {
  const best = new Map<string, SuggestionCandidate>();
  for (const e of edges) {
    if (e.rel !== SIMILAR_REL || e.writer !== SIMILAR_WRITER) continue;
    const pk = pairKey(e.from, e.to);
    const prior = best.get(pk);
    const cand: SuggestionCandidate = { from: e.from, to: e.to, strength: e.strength, score: e.score ?? null, createdAt: e.createdAt };
    if (!prior || rankOf(cand) > rankOf(prior)) best.set(pk, cand);
  }
  return [...best.values()].sort((a, b) => rankOf(b) - rankOf(a));
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
