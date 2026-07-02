# ADR-0051 — Relevance as the sixth signal: the intent lens, one read surface

- **Status:** Proposed — amends ADR-0031 (and the L4 reading of it in ADR-0044) on
  the strength of the 2026-07-02 audit; folds `search` into `query`.
- **Depends on:** ADR-0050 (materialized signals — bounds the cost), ADR-0030 (the
  index is a candidate generator, never an authority), ADR-0006 (parameters as one
  Resolution), ADR-0048 (shape), ADR-0033 (progressive disclosure).

## Context (the accepted option is numerically mute)

ADR-0031 rejected "a query-time `α·cosine + β·salience` knob" as bolted-on, and
routed meaning into salience as inferred `similarTo` edges feeding centrality.
Audited against the live corpus, that route contributes ~nothing: centrality
carries 0.10 weight, saturates at weighted degree 5 (already pinned by board
membership and type plumbing), and the `similarTo` edges are pruned wherever an
authored edge exists. Meaning cannot move a fact between bands.

Meanwhile the read surface splits into two half-blind epistemologies: `recall` /
`query` rank by salience and are meaning-blind (`contains` is a stringify
substring scan); `search` ranks by raw cosine and is salience-blind (`_meta.score`
rides along but never affects rank). Nothing answers the actual question — *"what
is important about this?"* — and an agent must choose its epistemology before it
knows what it needs.

The vision already names the resolution: salience is **observer-relative**, and
lenses re-weight the blend per read. A free-text intent is the most expressive
lens there is — the observer stating what they are observing *for*.

## Decision

**Relevance is the sixth signal** — not a second score averaged after the fact.

1. `recall` and `query` accept optional `text`. When present: embed once, query
   the scope's vector index top-K (~200; the per-grant index fold `search` already
   does), yielding a per-key `relevance` (cosine); keys outside top-K get 0. When
   absent: no embedding call, `relevanceWeight` 0 — today's paths pay nothing.
2. `relevanceWeight` joins `SalienceOptions`, resolved like every other parameter
   (defaults ← `_config/salience` ← lens ← override). A present `text` applies an
   intent-lens preset that shifts weight hard toward relevance (~.40, others
   rescaled).
3. **Tiering runs on the blended score** — elision becomes intent-conditioned.
   Recently-churned plumbing that is irrelevant to the goal drops out of focus for
   this read; an idle-but-relevant fact (or capability, ADR-0052) rises. This is
   the first mechanism where meaning can *demote* noise rather than only suggest
   links. A low type prior (ADR-0050) plus high relevance surfaces; high churn
   plus zero relevance elides. One blend, both directions.
4. `recall({text})` is **orientation relative to a goal**: the overview's focus
   band, counts, and drill hints computed over goal-conditioned scores — replacing
   the recall→search→query dance with one call.
5. **`search` folds into `query`.** `query({text})` with no filters is today's
   search, salience-aware; `query({type, text})` is the hybrid neither tool could
   do. `search` remains a thin deprecated alias, then leaves the `$catalog` menu.
   The read surface settles at four verbs: `recall` (orient), `query` (fetch),
   `peek` (one), `neighbors` (graph). `reindex`/`suggestions`/`ratify`/
   `pruneSimilar` are curation acts and stay as they are.
6. `explain` gains a relevance row; the intent lens is tunable like any other.

Why this does not repeat what ADR-0031 rejected: the objection was to a *second
score* blended outside the model ("two scores to average"). Relevance here is a
*signal inside the one blend*, under the one Resolution, inspectable by the one
`explain` — structurally identical to recency or standing, differing only in
taking a per-read argument, exactly as lenses already do. L4's point (no ad-hoc
knobs outside the model) is preserved; its letter is amended.

## Consequences

- One ranking system with two dials (structure, meaning) instead of two disjoint
  ones; fewer epistemologies, not merely fewer tools (ADR-0029/0033 ergonomics).
- Relevance is the only signal that cannot be materialized (query-dependent), but
  it arrives pre-bounded: the vector top-K *is* the candidate set, so a text-read
  scores ~K records, never the scope.
- Index coverage is honest: missing/unembeddable facts get relevance 0 — still
  reachable by structural filters; the index stays a candidate generator, never an
  authority (ADR-0030 Decision 1 unchanged).
- Cost: one embedder call per text-read (~50–150ms) — worth a small LRU on query
  embeddings, since agents repeat goals verbatim. `search`'s serial per-hit
  re-read loop is replaced by the batched authoritative read the unified path
  already does.
- `contains` demotes to a last-resort scan and points callers at `text`.
