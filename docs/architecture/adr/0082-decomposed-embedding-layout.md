# ADR-0082 — RFC: decomposed semantic layout (each fact owns its own coord, not one monolith fact)

- **Status:** Proposed 2026-07-11 (buffer — problem framed and grounded, options sketched below,
  **no direction chosen yet**. This is a request for comments, not a design ready to build.)
- **Depends on:** ADR-0047 (home is the graph; "stage 2" introduced the PCA 2D/3D layout — never
  itself written back into ADR-0047's text, only in code comments), ADR-0030/0031 (the vector index
  + inferred edges this shares infrastructure with — **and** the reactive embed-on-write mechanism this
  RFC's layout piggybacks on, see Finding 6), ADR-0081 (typed file ingestion — the corpus-growth
  driver that surfaced this), ADR-0040/0045 (the wiki-compile loop — a precedent for *not* feeding
  everything into expensive derived structure, see Finding 7), ADR-0073 (the consolidation organ — an
  active counter-force on corpus size, see Finding 8).
- **Owner direction (verbatim intent):** log an RFC for decomposed embedding such that each fact can
  own its own [layout data], instead of a monolith fact of all embeddings. The general area, not yet a
  committed ask — explore options and trade-offs.
- **Owner feedback (2026-07-12, incorporated below):** pull in the context of the platform's existing
  embed-on-creation mechanism, the existing doc-ingest path, and the nascent LLM-wiki "compile" and
  "consolidate" organs — not a direction statement, but the problem space needs to be understood against
  what already exists before a solution is chosen. Findings 6–8 below are the result; the Options and
  Open questions are otherwise unchanged.

## The question

`workspace.project` computes a 2D/3D semantic layout (PCA over the scope's whole vector index) and
writes it as **one fact**, `_home/embed2d`, whose `coords` map holds every indexed key's `[x,y,z]`.
Should each fact instead own its own layout data — decomposed, one small record per fact — rather than
a single fact aggregating the whole corpus?

## Findings (grounded — this session)

1. **The monolith has a real, nearby ceiling.** `_home/embed2d` is currently 2,836 keys / ~186KB
   (coords only) — confirmed live via `workspace.peek`. Coords cost ~65 bytes/key. DynamoDB's item size
   limit is a **hard 400KB**, not configurable. At the current rate that's a wall around **~6,000 keys**.
   The ADR-0081 migration alone is still adding facts (`doc`/`doc-block` decomposition turns each
   markdown file into several facts), and general corpus growth continues after that. This is not
   hypothetical — it is the next capacity wall after the one this session already hit twice
   (`workspace.query`/`workspace.graph`'s own unbounded-response 502s, fixed by pagination).
2. **The compute cost is separately unbounded.** `pca()` is `O(n · dim · iterations)` — 3 components ×
   60 power-iteration passes over the *entire* corpus. Measured live: **7.0–7.7s at n=2,836**
   (CloudWatch REPORT lines, `PlatformStack-WorkspaceServiceFunction`). This is independent of the
   storage question — even a perfectly sharded/decomposed storage layout doesn't make a whole-corpus
   PCA cheaper; only the *write* of the result is what decomposition would change.
3. **A partial mitigation already shipped this session ("stage 3"), but it doesn't change the storage
   shape.** The live vector-indexer now patches `_home/embed2d`'s `coords` incrementally per fact
   (`services/vector-indexer/handler.ts`'s `patchProjection`, using a basis persisted by
   `projectionFact` — `platform/runtime/projection.ts`), so a full recompute isn't needed on every
   write. This reduces *write frequency of the expensive op*, not the monolith's *storage* or *read*
   shape — the fact is still one growing item, and reading "the layout" is still one read of everything.
   It buys time, not headroom.
4. **The read path today wants "give me everything in bounded pages," which the substrate already
   does well for facts, not for a single fact's internal map.** This session also added cursor paging
   to `workspace.query`/`workspace.graph` (`scopeEdges`, `EdgeScopeInput.cursor`) precisely because
   "one big response" doesn't survive CloudFront's ~30s origin timeout or Lambda's 6MB payload cap.
   `_home/embed2d` is exposed to the same two ceilings the moment it's read wholesale by the home
   graph — pagination fixed the *edges* and *entries* paths; the *layout* path was untouched and still
   returns one growing blob.
5. **The vector index already stores one record per fact.** `vectors.store` (S3 Vectors backend) is
   keyed per fact today (`VectorRecord { key, vector, metadata }`) — the substrate fact store is not the
   only place per-key data already lives. Any "decompose per fact" design has a natural home to
   consider: extend the *existing* per-key vector record's `metadata`, rather than inventing a new
   per-key substrate fact.
6. **Embedding is already fully decomposed and reactive — this RFC is about placement, not embedding.**
   ADR-0030's DynamoDB-stream-driven `vector-indexer` (`services/vector-indexer/handler.ts`) embeds
   *every* live fact individually the moment it's written or changed — no batch step, no monolith, one
   `VectorRecord` per key. That per-fact raw material (the 1024-dim vector) already exists for free by
   the time `workspace.project` runs. What this RFC is actually asking is narrower than "decompose the
   embedding": it's "decompose the *derived 2D/3D placement*" — a PCA projection *of* those
   already-per-fact vectors, computed against the whole corpus's covariance structure (Finding 2, why it
   can't itself be per-fact) and currently written back as one aggregate fact. Worth stating precisely so
   the options aren't solving a problem ("embedding isn't decomposed") that doesn't exist.
7. **The substrate has a live precedent for deliberately NOT feeding everything into expensive derived
   structure — the "wiki compile" loop.** ADR-0040 wires a `_subscriptions/wiki.compile[.source]`
   reaction that spawns an LLM agent (`@c15r/models.agent`) to synthesize + cross-link newly-captured
   `source`/`reading` facts into the `kb/*` wiki. ADR-0045 made a deliberate, explicit exclusion: **the
   `file`/docs corpus never triggers compile** — "the docs corpus is reference material, not captured
   sources — auto-compiling ~90 docs would flood `kb/` with synthesis spam" (ADR-0045 §2). That is the
   same *shape* of question Option D raises for `workspace.project` (should everything really get the
   expensive treatment, or does the corpus already draw a line between "core content" and "reference
   material" that a projection should respect too?) — already answered once, for a different expensive
   reactive pipeline, in the same direction. It doesn't decide D, but it means D isn't a novel departure
   from platform norms; it has a working precedent to model the cutoff policy on (by fact origin/type,
   not just salience/recency).
8. **The corpus isn't monotonically growing — the consolidation organ is an active counter-force.**
   ADR-0073's `@c15r/consolidate` cell supersedes duplicate/low-standing facts each cycle
   (`delta = backlogₜ₋₁ − backlogₜ`; live prod: backlog 1025 → 1014, delta +11 on its first two cycles).
   A superseded fact drops out of the live vector index (the same stream indexer removes it, symmetric
   with Finding 6's embed-on-write) and out of any subsequent `workspace.project` scan. So the growth
   trajectory Finding 1's "~6,000-key wall" timeline assumes isn't pure ingest — it's ingest (ADR-0081,
   adding) net consolidation (ADR-0073, removing, currently small relative to the ~1,251-decoration
   ADR-0081 corpus but structurally aimed at exactly this kind of debt). Any future timeline estimate for
   when the wall is actually hit should model both rates, not extrapolate ingest alone.

## Options (unranked — this RFC does not recommend one)

### A — Shard the monolith fact by key-prefix or hash bucket
Split `_home/embed2d` into N facts (`_home/embed2d/0`..`_home/embed2d/N-1`), bucketed by a stable hash
of the key. Keeps "layout" as ordinary substrate facts (typed, queryable, supersedable) and needs the
least new plumbing — `workspace.project` writes N facts instead of one; a reader fetches N (bounded,
parallelizable) instead of 1 (unbounded).
- **Needs:** a bucket-count policy (fixed N, or grown as corpus grows — resharding is a migration);
  the incremental patch (stage 3) must know which shard a key lands in.
- **Costs:** still O(n) total storage and O(n) total read volume, just chunked — defers the wall,
  doesn't remove it. Simplest change from today; smallest conceptual shift.

### B — Each fact owns a small sibling `_layout/<key>` fact
The most literal reading of "each fact can own its own": a tiny fact per indexed key
(`_layout/doc:foo` → `{x, y, z, generatedAt}`), written by the same reactive path that already embeds
each fact (the vector-indexer stream handler). Composes directly with this session's pagination work —
the home graph would `workspace.query({type: 'layout-point', shape: 'refs', limit, cursor})` in bounded
pages, the same shape it already uses for entries and edges.
- **Needs:** the type vocabulary gains `layout-point` (cheap — `_config/typography`-style, no renderer
  change needed since it's plumbing, not user-facing content); the read path changes from "one peek"
  to "a paged query," which is a bigger client-side change to `cells/home/client/graph.tsx` than A.
- **Costs:** multiplies fact count by 1 per indexed key (2,836 today → 2,836 more facts) — DynamoDB
  cost/throughput is per-item, so this trades "one big item" for "many small items," which the store
  handles far more gracefully (no per-item ceiling risk) but changes the corpus's own shape and touches
  `workspace.query`'s type-filtered volume. Needs a decision on whether `_layout/*`-style facts should
  even count in salience/recall the way real content does, or be filtered the way `_home/*`/`_config/*`
  plumbing already is.

### C — Store coords as vector-index metadata, not a substrate fact at all
Since `vectors.store` already holds one record per fact (`VectorRecord.metadata`), add `coords: [x,y,z]`
to that metadata instead of writing anything to the substrate table. The graph would read layout via
`vectors.store.list`/`query` (already the retrieval path `workspace.project` itself uses), never
touching DynamoDB's fact partition at all.
- **Needs:** a new read seam from the workspace command layer into the vector store's list/query
  (today only `commands-search.ts` touches `vectors.store` directly); reopens the ADR-0030 Decision 1
  boundary ("the vector index is a candidate generator, never authoritative") — coords are cosmetic
  positioning, not fact content, so this is probably fine, but it's a real precedent to weigh
  deliberately, not by default.
- **Costs:** couples the graph's rendering path to the vector backend's own read characteristics/limits
  (S3 Vectors' own per-call and per-item limits, not yet characterized here); the least substrate-native
  of the three (moves state out of the "one substrate" story ADR-0027/0081 lean into).

### D — Bound what gets projected, not how it's stored
Sidestep the storage question: `workspace.project` only projects the top-N most salient/central facts
(or a windowed recent slice), not the whole scope. The monolith fact shrinks by definition — no sharding,
no per-fact records, no vector-metadata seam.
- **Needs:** a salience/recency cutoff policy; changes semantics — some facts simply don't appear on
  the map.
- **Costs:** in real tension with the graph's stated design intent elsewhere in the codebase ("the
  graph IS the workspace... loads the entire slice" — `cells/home/client/graph.tsx`'s original comment
  on the equivalent `workspace.query` unboundedness, which THIS session already moved away from via
  pagination rather than truncation for the entries/edges paths). Cheapest to ship; likely the option
  to reach for only if a real deadline forces a stopgap before A/B/C land.

## Open questions (for the owner, not yet resolved)

- Which axis matters more right now: read-path shape (how the home graph fetches layout) or
  write/storage shape (how many items, how big)? A and D touch only storage; B is a read-path
  redesign that happens to also fix storage; C changes which subsystem owns the data entirely.
- If B: should `_layout/<key>` facts be visible to `workspace.query`/`recall` at all, or hidden
  plumbing like `_home/*` today? This affects whether "decompose the layout" also means "the layout
  becomes queryable/attention-worthy data," which may not be intended.
- Does the compute-cost finding (2) change the urgency calculus? Even the best storage decomposition
  doesn't shrink `pca()`'s own O(n·dim·iters) cost — is a cheaper/streaming projection algorithm
  (true incremental PCA, not just incremental *application* of a fixed basis, which is what "stage 3"
  already does) a prerequisite, a parallel track, or out of scope for this RFC?
- Is there a corpus-size number (not the ~6,000-key DynamoDB wall, which is a symptom) at which ANY
  single-fact-per-scope layout design stops making sense, regardless of sharding — i.e., should the
  answer instead be "the graph doesn't show everything past size X," reframing D from "stopgap" to
  "the actual long-term answer," with A/B/C solving a problem that reframing dissolves?
- Finding 7's wiki-compile precedent excludes by *origin* (docs corpus vs. captured sources), not
  salience/recency — does Option D's cutoff want the same axis (e.g. exclude `_`-prefixed plumbing and
  maybe bulk-ingested `doc-block`s from the map by default, distinct from "top-N by score")? Worth
  deciding whether D's policy should mirror ADR-0045's origin-based line or invent a new one.
- If B ships (per-fact `_layout/<key>` sibling facts): who retires a layout point when its parent fact
  is superseded — e.g. by ADR-0073's consolidation organ (Finding 8)? The vector-indexer already handles
  this symmetrically for the embedding itself (REMOVE on supersede); a decomposed layout would need the
  same discipline, or stale points accumulate as consolidate does its job.
