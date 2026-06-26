# ADR-0031 — Semantic similarity as emergent salience (inferred `similarTo` edges)

- **Status:** Proposed (investigation + recommendation; not built). Answers the question raised against
  ADR-0030's "salience fusion" follow-on: should semantic relevance influence ranking as an explicit
  query-time knob, or should it **emerge** through the substrate's existing machinery (inferred edges /
  the salience score)? Finding: the substrate-native form is the latter — similarity as **derived
  `similarTo` edges** that feed `centrality`, an existing salience signal.
- **Date:** 2026-06-26
- **Depends on:** ADR-0030 (the vector index that makes similarity computable), ADR-0006 (salience —
  `centrality` is a scored signal), ADR-0003/0016 (the Reference projection — derived/first-class edges),
  ADR-0009 (graded edge strengths).

---

## The question

ADR-0030 left "salience fusion" as an optional follow-on, sketched as a query-time blend
`rank = α·cosine + β·_meta.score`. The sharper framing: that knob is **bolted-on** — it touches only
search ranking, is invisible to the rest of the system, and treats salience and similarity as two scores
to average. Is there a form where semantic relevance **emerges** as structure the substrate already
reasons about?

## Findings (grounded)

1. **`centrality` is already a salience signal fed by the graph.** `computeScore` blends five signals
   (`platform/runtime/state.ts:490–505`); `centrality = min(degree / saturation, 1)` at weight `0.1`.
   `degree` is the **strength-weighted** sum of a key's edges (`buildSignals`, `state.ts:542–546`).
2. **Centrality counts derived edges, not just authored ones.** `signalsFor` builds degree over
   `[...authored, ...deriveBackboneEdges(...)]` (`state.ts:1075–1077`) — so **any new derived edge kind
   automatically contributes to salience** with no scorer change. Derived edges are graded (0.2 structural
   → 0.6 embedded-ref; ADR-0009).
3. **Derived edges are computed at read time from fact *structure*** (`deriveBackboneEdges`, `state.ts:708–815`):
   type anchors, view membership, embedded `ref` fields, key-encoded edges. There is **no** similarity
   input today, and similarity isn't derivable from structure — it needs the vector index.
4. **There is no seam for platform code to *write* edges.** `state.link` is reached only via the
   user-facing `workspace.link`; the indexer (`services/vector-indexer/handler.ts`) and reactors have no
   edge-write path. This is the key missing enabler.

So the user's intuition is correct and precise: similarity should **contribute to scoring via inferred
edges**, not as a separate rank term. The blocker is (4).

## Options

### A — Persisted `similarTo` edges from the indexer *(the emergent path — recommended direction)*
After embedding a fact, the indexer queries its top-k nearest neighbours **within the same slice index**
and writes `similarTo` edges (low strength, e.g. `0.3`, **below** authored 1.0 and embedded-ref 0.6 so
inferred kinship never outweighs authored structure). Because centrality already counts all edges
(finding 2), these **automatically raise the salience of semantically-central facts** — a fact that is
"about what many other facts are about" scores higher — *and* they surface in `neighbors`/`$graph`
("things like this") for free. Relevance becomes structure; fusion emerges through the existing score.

- **Needs:** the edge-write seam (finding 4) — a platform `state.linkDerived`/organ-path that lets the
  indexer write `similarTo` as the writer `platform/vectors`, in a reserved/inferred namespace so it's
  distinguishable from authored edges and can be regenerated.
- **Costs / hazards (real):** k extra `QueryVectors` per indexed fact; **edge churn** — a fact's
  neighbours change as the corpus grows, so edges go stale and need regeneration/supersession (not just
  append); **growth** — naively O(n·k) edges, needs a cap + symmetric-dedupe + a similarity threshold τ
  (only edge above τ); **graph noise** — `similarTo` could crowd `neighbors`/`$graph` UX, so it likely
  wants a `rel` filter / opt-in lens. None are blockers, but they make this a *considered* feature, not a
  quick add.

### B — Similarity edges derived at read time
Fold similarity into `deriveBackboneEdges`. Rejected: it would require a vector query **per fact per
read**, defeating the read path's cost model. Derivation is for cheap structural rules, not kNN.

### C — Query-time soft fusion *(the cheap, shallow knob)*
A `workspace.search { rankBy: 'fused' }` that re-ranks the candidate hits by `cosine` blended with each
hit's existing `_meta.score` (already on every hit — no extra reads). Cheap and isolated, but it is
**not** emergent: it changes only search ordering, leaves global salience and the graph untouched, and is
exactly the bolted-on knob the question pushed against. Useful as a stopgap or a per-call preference,
not as the answer.

## Recommendation

The substrate-native answer is **A**: semantic similarity as inferred `similarTo` edges feeding
`centrality`. It realizes the intuition (relevance *contributes to scoring*, via *inferred edges*),
composes with the Reference projection and salience instead of sitting beside them, and needs **no scorer
change** — only the missing **edge-write seam** plus an edge-maintenance strategy (top-k, threshold τ,
regenerate-on-rechange, pruning). Build the seam first (it's independently useful — reactors writing
derived structure is a general capability), then the indexer's similarity pass on top.

**C** is worth shipping *only* if an immediate ranking lever is wanted before A lands; keep it an opt-in
`rankBy` so the default stays pure-similarity and A can later supersede it without a contract change.

## Open questions

- **Symmetric vs directed:** `similarTo` is symmetric; persist one edge and count both endpoints (as
  `buildSignals` already does) or two directed edges? One undirected, dedup by sorted endpoints.
- **Threshold τ + k:** only edge above a cosine floor, cap at k neighbours — tune so the graph doesn't
  saturate (centrality saturates at degree 5 by default, so even a few strong `similarTo` edges move the
  needle; that argues for a *high* τ / small k).
- **Strength vs the 0.2–0.6 band:** where does inferred similarity sit? Proposed `0.3` (above structural
  0.2, below membership 0.4) — it's weak evidence of relatedness, stronger than mere co-typing.
- **Edge GC / churn:** edges must be regenerated when a fact's text changes (the indexer already sees the
  rewrite via the stream) and pruned as neighbours shift — an authored-edge `supersede` analogue, or full
  per-fact regeneration each index pass.
- **Isolation:** similarity is computed only within a slice's own index, so `similarTo` edges never cross
  slices — consistent with ADR-0030 Decision 2 (no cross-slice leak).
- **UX:** should `similarTo` be hidden from `neighbors`/`$graph` by default (a lens/`rel` filter) so it
  enriches *salience* without cluttering the *authored* graph?
