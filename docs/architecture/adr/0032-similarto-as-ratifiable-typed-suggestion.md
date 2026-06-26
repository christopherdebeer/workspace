# ADR-0032 — `similarTo` as a ratifiable, typed connection suggestion

- **Status:** Proposed. Captures the design evolution of ADR-0031's inferred edges. **Mechanics
  shipped now (no model change):** (1) **dedup-on-create** — `refreshSimilarEdges` skips any neighbour
  an *authored* edge already connects (in either direction), so redundant kinship is never created and
  is pruned the next time the fact is reindexed; (2) a vector-free admin **`pruneSimilar`** command that
  backfills the cleanup over edges written before (1). **The reframe below — `similarTo` as a *suggestion
  to connect* that a person/grant *ratifies* into a typed edge — is NOT yet built; it needs the user's
  steer before implementation.**
- **Date:** 2026-06-26
- **Depends on:** ADR-0031 (inferred `similarTo` edges → centrality — the thing being refined), ADR-0030
  (the vector index), ADR-0009 (graded edge strengths), ADR-0003/0016 (the Reference projection — edge
  semantics), ADR-0006 (salience — what an edge contributes to).

---

## The question

ADR-0031 shipped `similarTo` as **auto-materialized** structure: the indexer writes a low-strength edge
to each fact's top-k neighbours, and because `centrality` counts every edge, semantic kinship raises
salience with no scorer change. Live backfill produced **3,856** `similarTo` edges across the substrate
and confirmed the emergence (e.g. `kb/concept_sigma`'s centrality rose from 0.04 → 0.46+ as its
neighbourhood lit up). Two things surfaced once the edges were real:

1. **Redundancy.** A duplicate hunt found **482** `similarTo` edges whose endpoints were *already
   connected by an authored edge* (a `grounds`/`refines`/membership/ref link a person or grant asserted).
   The machine's kinship hint there adds nothing — the same relationship is counted twice in `centrality`,
   and it shows up twice in `neighbors`/`$graph`. (Also found: ~1,046 reciprocal `similarTo` pairs — A→B
   and B→A — and ~48 `el:<X>`/`<X>` double-import duplicate *nodes*, both tracked separately.)

2. **Semantic poverty.** `similarTo` is a single, generic, machine-flavoured relation. The user's
   intuition: a similarity edge is better understood as **"a person or grant could/should connect these"**
   — a *suggestion*, with a *meaningful label* the connection deserves once ratified (this **refines**
   that; this **grounds** that; these are **duplicates**; this **contradicts** that), rather than a
   permanent, unlabelled "looks alike".

So: should `similarTo` remain auto-materialized salience structure, or become a **ratifiable, typed
suggestion** — surfaced to tending, promoted to a real (typed) edge only when a person/grant accepts it?

## What shipped now (agreed mechanics — no model change)

These are pure hygiene on the existing ADR-0031 model and are safe to ship before the bigger question is
settled:

- **Dedup-on-create.** `refreshSimilarEdges` (`platform/runtime/similar-edges.ts`) now computes the set of
  fact-pairs an **authored** (non-inferred) edge already connects — `authoredPairs(existing)`, keyed by
  `pairKey(a,b)` (order-independent) — and excludes those neighbours from the reconcile target. So a
  redundant `similarTo` is **never created**, and an existing one is **pruned on the next pass** once a real
  edge appears between the pair. The live indexer and `reindex` both inherit this for free (both call
  `refreshSimilarEdges`).
- **`pruneSimilar` (admin, vector-free).** A synchronous command that scans the scope's edges, finds every
  `platform/vectors`-written `similarTo` whose pair an authored edge already connects, and deletes them —
  the one-time backfill for the ~482 written before dedup-on-create. Returns `{ scanned, pruned, remaining }`
  and accepts an optional `max` cap. No embeddings, no vector queries — just edge CRUD.

These deliver "prune, and don't recreate going forward" exactly. The model question is independent.

## Options for the model (NOT yet built)

### A — Keep auto-materialized `similarTo` as salience structure (status quo, minus redundancy)
What ADR-0031 shipped, now with dedup-on-create. `similarTo` stays a low-strength edge feeding centrality
and `neighbors`. Cheapest; the emergence already works. But it leaves `similarTo` semantically flat and
keeps machine-inferred edges co-mingled with authored structure in the graph (the ADR-0031 "UX" open
question — should they be hidden behind a lens?).

### B — `similarTo` as a ratifiable suggestion (the reframe — recommended direction)
Treat an inferred `similarTo` as a **proposed connection**, not a committed one:

- The indexer still computes top-k kinship, but records it as a **suggestion** — either a distinct
  low-weight `rel` (e.g. `suggestsLink`, explicitly "a connection a human might want") or a
  `_suggestions/*` fact / a flag on the edge — surfaced by **tending** (`attention()` already has the
  just-in-time-cron seam; add a "suggested connections" bucket) and in a `neighbors` lens.
- A person or grant **ratifies** a suggestion via `workspace.link`, which writes a **typed, authored**
  edge — and the suggestion is consumed. Decline → suppressed so it doesn't keep re-surfacing.
- **Salience question (the crux):** does an *unratified* suggestion still feed `centrality`? Two sub-choices:
  - **B1 (suggestions are weightless):** only authored/derived edges score; suggestions are pure tending
    surface. Cleaner separation, but loses the ADR-0031 emergence (the `concept_sigma` centrality lift
    came *from* the auto-materialized edges).
  - **B2 (suggestions score at a low weight):** a suggestion contributes a fraction to centrality until
    ratified (then it counts fully as an authored edge). Keeps emergence *and* gains ratifiability — the
    edge "graduates" from inferred-weak to authored-full. This is the most substrate-native: salience
    still emerges, but the graph records *provenance* (suggested vs asserted) and *type*.

### C — Typed edges on ratification (composable with B)
When a suggestion is ratified, classify the relationship rather than stamping generic `similarTo`:
`refines` / `grounds` / `duplicates` / `contradicts` / `elaborates` / `relatesTo`. Classification could be
(a) user-chosen at ratification (a small picker in the tending UX), or (b) proposed by the `models` cell
(an LLM reads both facts and suggests the label + direction), user-confirmed. This is where `similarTo`
stops being a machine artefact and becomes the seed of a **typed knowledge graph** the user curates. The
`duplicates` label also feeds the *node*-dedup problem (the 48 `el:<X>`/`<X>` pairs) — a `duplicates` edge
is the ratifiable form of "these two nodes are the same".

## Recommendation

Ship the **mechanics** (done): dedup-on-create + `pruneSimilar`. Then pursue **B2 + C** as the model: keep
similarity feeding salience (don't regress the emergence), but make every inferred edge a **provenance-
stamped suggestion** that *graduates* to a **typed, authored** edge on human/grant ratification — surfaced
through tending, classified at the point of ratification (optionally with `models`-cell help). This turns
the vector index from "a thing that quietly inflates centrality" into "a thing that proposes structure the
user curates", while preserving everything ADR-0031 demonstrated.

**Decision needed from the user before building B/C:**
1. **Do unratified suggestions feed salience?** (B1 weightless vs B2 low-weight-then-graduate — this is the
   one real fork; B2 preserves the ADR-0031 emergence, B1 is cleaner but regresses it.)
2. **Surface:** a new `rel` (`suggestsLink`) vs `_suggestions/*` facts vs a flag on the existing edge — how
   tending and `neighbors` should present suggestions.
3. **Typing:** user-picked at ratification, `models`-cell-proposed, or both; and the initial label vocabulary.
4. **τ:** the deferred threshold drop (0.35 → 0.25) is now entangled here — a *suggestion* model can afford
   a lower τ (more candidates, low cost, human filters) than auto-materialized salience structure could. Set
   τ in whichever model we pick, not before.

## Open questions / deferred

- **Reciprocal `similarTo` (≈1,046 pairs):** ADR-0031 left symmetric-vs-directed open. Under B, a suggestion
  is naturally one undirected proposal; dedup reciprocals by `pairKey` when we touch the producer for B.
- **Node dedup (≈48 `el:<X>`/`<X>`):** double-imported facts — flagged for the user, **not** auto-superseded
  (additive/reversible tending). A `duplicates` typed edge (Option C) is the ratifiable mechanism for merging.
- **Migration:** if B lands, the existing auto-materialized `similarTo` edges either stay as-is under a
  compatibility reading or are reclassified to the new suggestion form on the next reindex (regenerable —
  they're `writer = platform/vectors`).
