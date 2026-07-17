# Services — Workspace Substrate Commands

> Reference for engineers who USE and MODIFY the workspace cell. Every claim below is anchored to source (`path:line`) or an ADR. Where a verified coherence audit touches these files, a **⚠ Coherence** callout states whether the related code *compounds* on a core primitive or *conflicts* with it.

---

## 1. What this subsystem is

`services/workspace/*` is the **primary substrate API** — the "first flagship room over the observed-state substrate." It is a single `defineService({name:'workspace'})` (`service.ts`) exposing ~50 MCP tools. The tool catalog lives in `descriptors.ts` (1410 lines); the handlers are composed from six per-group modules re-exported through `handlers.ts` (ADR-0044 Inc 5): **write, read, graph, search/vectors, declared vocabulary, sharing/grants**, plus an admin **Athena** SQL surface.

### The two cores everything reduces to

Every workspace command is one of two things:

1. **It records or retires a Fact** in a scope (`scope = IAM principal = OAuth target`) via `state.put` / `state.supersede` / `state.link`. — the **Fact** core (`platform/runtime/state.ts`; ADR-0013, ADR-0007).
2. **It runs the Projection pipeline** (`select → score → shape → present`) via `state.read`/`query`/`graph`/`neighbors`, then 5-term Salience score, then Affordance shape — over the caller's scope plus whatever subsets grants merge in. — the **projection** core (`platform/runtime/state.ts`, `present.ts`, `selector.ts`; ADR-0004/0006/0010/0011/0012).

The genuinely *additive* machinery is thin and honest:

- **The grant store** (`grants.ts`) — a SEPARATE DynamoDB index (`GRANT#`/`GRANTBY#`/`MEMBER#` partitions), explicitly "not a fact," the one piece that reintroduces its own primitive.
- **The declared no-code tiers** (`_actions/`/`_views/`/`_subscriptions/`) — Facts interpreted by small fixed evaluators.
- **The write fan-out** (`event-handlers.ts`) — turns platform events back into Facts in the owner's slice.

The `read`/`edges`/`declare` composed verbs (ADR-0071/0069/0068) are pure dispatchers over presets — behaviour-preserving contractions, not new primitives.

> ⚠ **Coherence — one live rot to know about.** The deployed `workspace.graph` verb errors `"Unhandled"` while the unified `workspace.edges` (ADR-0069) works. The deprecated alias rotted while its replacement stayed healthy. See §5.

---

## 2. Fact write-through (`remember` / `ingest` / `supersede`)

**What it does.** `remember` writes one keyed fact to the caller's slice (or another owner's slice under a write grant). `ingest` bulk-writes ≤100 facts plus optional edges (best-effort). `supersede` retires a fact (never deletes), optionally pointing at a successor and migrating its edges. All three call `state.put`/`supersede`/`link` directly and emit `workspace.fact.written` per write so the reactor fires. `remember` returns advisory schema `hints` for typed non-system facts (never blocks).

**Public API** (`services/workspace/commands-write.ts`, `descriptors.ts`)
```ts
createWriteCommands(build): Pick<WorkspaceCommands,'remember'|'ingest'|'supersede'|'lease'|'release'>
requireWriteThrough(grants, caller, owner, key)
  // refuses reserved namespaces (_actions/_views/_renderers/_grants/_groups/_public)
  // + requires a write grant covering key
RememberInput { key, value, owner?, via?, type?, tags?,
                ifRevision?, ifVersion?, ifAbsent?, timer?, import?, reward? }
IngestInput   { facts[], via?, edges[] }
```

**Data model.** Fact at `(scope,key) = {value,_meta:EntryMeta}`. `ingest` capped 100/call; edges may dangle. `remember` resolves the type decl (`cells.describeTypes ⊕ slice _types/<t>`) to compute `schemaHints`.

**Invariants & edge cases.**
- REPLACE semantics — `value` overwrites wholesale, no field merge (revision history preserved).
- Write-through may never touch reserved vocabulary/sharing namespaces.
- `ingest` may not write `_actions/` or `_views/`.
- `enforceTypeWrite` gates granular `write:type:<T>` tokens to their declared types.
- `ifVersion` is the ADR-0066 proof-of-read CAS; `timer` is the read-time-evaluated TTL/reveal.

**Reduces to:** **fact** (directly — `state.put` with the full `EntryMeta` envelope). Write-through is a grant-gated re-scope of the SAME put (`scope = input.owner`), so it *compounds* fact + the grant index (§9).

**Connections.** `platform/runtime` `state.put`/`supersede`; `grants.ts` (write-through); `shared.ts` `enforceTypeWrite`/`typeDeclsFor`. Cross-slice cell caller-writes terminate here (`services/dispatch/service.ts:300-308`).

**ADRs.** ADR-0013 (the Fact), ADR-0044 (module composition), ADR-0066 (proof-of-read CAS), ADR-0070 (reward), ADR-0007 (scope=IAM=OAuth).

> ⚠ **Coherence — write authority is fail-CLOSED (conflict, high).** `requireWriteThrough` resolves grants with `grants.listForGrantee(caller)` alone (`commands-write.ts:125-126`) — the *direct-grantee* query only. The read seams (`recall` `commands-read.ts:508`, `peek` `:604`, search `commands-search.ts:366`) all use `applicableGrants(grants, viewer)` (`grants.ts:98-104`), which folds in `public` + group memberships. So a **group-scoped write grant is silently never authorized** — a whole first-class grant class is non-functional, even though `grants()` advertises `write` as a working gate. No privilege escalation (safe-by-default); the harm is a denied-but-documented feature. This bug also propagates to cross-slice cell writes (`services/dispatch/service.ts:300-308`).
> **Fix:** route `requireWriteThrough` through `applicableGrants(grants, caller)`, then filter `mode==='write' && grantCovers(g.key,key)` — exactly as `peek` does. (Public write can't exist — `share` blocks it — so folding `PUBLIC` in is inert.)

> ⚠ **Coherence — no fan-out chokepoint (conflict, high).** `state.put()` does NOT emit `workspace.fact.written`; every write path re-emits it by hand (`commands-write.ts:162` and ~12 more sites). See §14 for the full evidence and fix.

---

## 3. Work leases (`lease` / `release`)

**What it does.** Time-bounded cooperative exclusivity over a contended item (ADR-0086 Inc 3). `lease` writes `lease/<domain>/<item>` with `ifAbsent` + a delete-at-expiry timer — the atomic, crash-safe hand-off. A lapsed timer reads as absent = self-released. Contention returns `held:false` + the live holder; re-leasing your own item **extends** it (`renewed:true`). `release` expires the fact now. Holder = `ctx.identity.participant ?? scope`.

**Public API** (`services/workspace/commands-write.ts`)
```ts
lease(LeaseInput{ domain, item, minutes?/seconds?/ttlSeconds?, note? }):
  LeaseResult{ held, key, holder, expiresAt, grantedMinutes?, renewed? }
release(ReleaseInput{ domain, item })
```

**Data model.** `lease/<domain>/<item>` fact, `type 'lease'`, `tags ['lease']`, `value {holder,domain,item,note?}`, `timer {ms: minutes*60000, effect:'delete'}`. Minutes clamped 1–120.

**Invariants & edge cases.**
- Acquisition is atomic via `ifAbsent` (a `StatePreconditionError` → the contention path).
- Self-renewal extends rather than reporting contention against yourself.
- Releasing another participant's lease is permitted but noted — the participant key carries no authority.
- A lease "asserts nothing" — it is distinguished from an epistemic claim; it is just a fact with a delete timer.

**Reduces to:** **fact** — the `ifAbsent + timer:{effect:'delete'}` put IS the lease. No scheduler, no new store; timer-expiry (read-time) turns absence into release. It is the TTL-bounded shadow of the Fact core used as a mutex.

**Connections.** `platform/runtime` `state.put`/`get`; ADR-0086 participant identity. Leases annotate in-flight suggestion adjudication (§8).

**ADRs.** ADR-0086 (participant identity), ADR-0084.

---

## 4. The projection read presets (`recall` / `peek` / `query` / `changes` / `attention` / `tend`)

**What it does.** `createReadCommands` exposes the presets of the projection pipeline:
- **`recall`** = the assembled slice view (own slice ∪ granted, scored once under the *viewer's* salience/lens config, then shaped). A bare call returns a progressive-disclosure **OVERVIEW** (counts by type/prefix, salience bands, top-12 focus, drill hints) served from a seq-validated **digest cache**; any shaping arg or `view:'full'` opts into the full elided view.
- **`peek`** = one fact + inline affordance.
- **`query`** = structural filter (`type`/`tag`/`tags`/`prefix`/`contains`) ranked by salience/recency/relevance, paged (`cursor`/`offset`).
- **`changes`** = the trajectory feed (bare = newest 200, ADR-0048; `scope` filter ADR-0055; `include:'entries'` inlines card entries touch-free).
- **`attention`** = the derived tending read (stale/unlinked/dangling samples + `*Total` counts).
- **`tend`** = writes the audit fact (see §15).

**Public API** (`services/workspace/commands-read.ts`, `shape.ts`, `event-handlers.ts`)
```ts
createReadCommands(build): Pick<...,'recall'|'peek'|'query'|'changes'|'attention'|'tend'|'read'>
buildOverview(merged, bands, granted, decls, focusShape): RecallOverview
readDigest / writeDigest      // DIGEST_KEY='_index/overview', DIGEST_MAX_AGE_MS=1h
relevanceFor(vectors, scope, text): Record<key,cosine>
intentSalience(override) = { ...INTENT_PRESET, ...override }
```

**Data model.**
```ts
RecallOverview { overview:{ total, granted, bands, byType[], byPrefix[] },
                 focus:Record<key,Entry>, hints[], types? }
DigestValue    { seq, at, result }
```
Live: focus 442 / peripheral 4789 / elided 1278 over 6509 facts; top types `doc-block`(2185)/`doc-order`(2165)/`capture`(179).

**Invariants & edge cases.**
- A bare `recall` with no foreign grant is served from the seq-exact fresh digest; the digest is a write-behind cache keyed on the live seq head, written through the raw store (no seq advance, no trajectory, no touch) "because a cache is not a fact," invalidated exactly when any write advances seq.
- Granted slices are scored under the **viewer's** policy, not each owner's.
- `query` intent (`text`) defaults to a top-20 orientation-shaped shortlist (F7); filter-only queries default `limit 50` (W4f) to avoid blowing the token ceiling.
- Digest is disqualified by any of `text`/`lens`/`explain`/`salience`/`shape`/foreign-grant.
- `relevanceFor` embeds text and takes the scope's vector top-K (`INTENT_TOP_K=200`) as the candidate pool (ADR-0051 goal-conditioning).

**Reduces to:** **projection** + **fact**. This IS the pipeline (`select→score→shape→present`); every other read verb is a preset of it. `attention`/`tend` DERIVE debt — no new state.

**Connections.** `platform/runtime` `state.read`/`query`/`changes`/`attention`/`shape`/`salienceConfig`/`lensesConfig`; `grants.ts` `applicableGrants`/`grantCovers`; `shared.ts` type helpers; the vectors backend (optional).

**ADRs.** ADR-0033, ADR-0048 (trajectory feed), ADR-0050, ADR-0051 (goal-conditioning), ADR-0055 (scope filter), ADR-0074, ADR-0078.

> ⚠ **Coherence — `changes` has no long-poll wait (conflict, info).** `changes()` (`commands-read.ts` ~703) accepts only `sinceSeq`/`limit`/`last`/`scope`/`include` — a single pull read, no blocking/hold parameter; there is no external delivery shape. `waitSeconds`/`longPoll` appear nowhere in code (only in design prose). ADR-0088 (`Wake-on-change`, *Proposed 2026-07-17*) is the planned fix: ship long-poll `changes` riding the same seq cursor so it does not become a fourth propagation substrate.

---

## 5. The one composed read by candidate source (`read`, ADR-0071)

**What it does.** `read(ComposedReadInput)` is a single verb parameterized by `source ∈ slice|store|vector|key|changes` (inferred from args when omitted) that dispatches to the `recall`/`query`/`search`/`peek`/`changes` presets — plus two enrichments:
1. `context:'refs'` folds each result's one-hop refs-tier neighbourhood into `_context` (a shared `peripheryFor` pass);
2. the PRINCIPAL layer (ADR-0074/0086) applies an adopted posture (goal/lens/salience) — a participant `_posture/<key>` fact overriding the token posture — between defaults and the call, **ranking-only**.

**Public API** (`services/workspace/commands-read.ts`)
```ts
read(input, ctx): ComposedReadResult
inferSource(input): ReadSource
principalPosture(identity)
participantPosture(store, user, participant)
goalTextOf(value)
peripheryFor(ctx, keys, cap): Record<key, ContextRef[]>
ContextRef { key, rel, dir, type?, derived? }
```

**Data model.** `ComposedReadInput` extends `RecallInput + QueryInput + PeekInput + ChangesInput` with `source?`/`context?`/`contextLimit?` (default 8, max 24). `_posture/<participant>` fact = `{goal?,lens?,salience?}`, optionally timer-expiring.

**Invariants & edge cases.**
- Source is inferred BEFORE the posture merge — a standing goal never flips read shape.
- Posture biases ranking only, never membership or authority.
- `changes` source skips the periphery (trajectory is events, not facts).
- Overview result skips periphery (no entries map).

**Reduces to:** **projection** — a behaviour-preserving dispatcher (the C2 contraction: one read subsuming four). The periphery is the same Reference projection (`state.graph`) indexed by endpoint.

**Connections.** the read presets (§4); `state.graph` for periphery; `store.get` for goal-fact resolution.

**ADRs.** ADR-0071 (the composed read), ADR-0074, ADR-0086, ADR-0051.

---

## 6. The Reference projection & the one edge query (`link`/`unlink`/`edges` + deprecated `neighbors`/`graph`/`members`/`links`, ADR-0069)

**What it does.** `link`/`unlink` write/remove authored edges (`state.link`/`unlink`). `edges({around})` is the unified edge verb:
- `around` → neighbors
- `around` + `membership` → members
- `around` + `depth≥2` → the directional walk (§7)
- no `around` → the full graph projection (authored + derived)
- `derived:false` → authored-only links

The four legacy verbs (`neighbors`/`graph`/`members`/`links`) remain as aliases in the deprecation window and dispatch to the same `state` methods. All hydrate neighbour/member entries at the card tier by default and attach inline type affordances.

**Public API** (`services/workspace/commands-graph.ts`, `shape.ts`)
```ts
createGraphCommands(build): Pick<...,'link'|'unlink'|'neighbors'|'links'|'graph'|'members'|'edges'>
edges(EdgesInput{ around?/key?, dir?, rel?, membership?, derived?, prefix?,
                  depth?, direction?, shape?, keys?, rels?, limit?, cursor?, edgeShape? })
scopeEdges(edges, input): { edges, total, nextCursor? }
logEdgeRead   // ADR-0081 observability
```

**Data model.**
```ts
EdgeRecord { scope, from, rel, to, strength, createdAt, writer, score?, derived? }
ThinEdge   { from, rel, to, derived? }
```
Derived backbone edges (`instanceOf`/`managedBy`/`rendersWith`/`inView`) carry `derived:true`. Live: ~29018 edges, dominated by `similarTo` strength 0.3 writer `platform/vectors`.

**Invariants & edge cases.**
- Dangling edges allowed (link result carries `fromExists`/`toExists`).
- `edges` dispatches to existing `state` methods — behaviour-preserving by construction.
- The walk follows AUTHORED edges only; the derived backbone is type plumbing.
- `scopeEdges` (`shape.ts`) does `keys`/`rels`/`limit`/`cursor` filtering + a thin edge shape AFTER the whole projection is materialized (bounds SIZE, not compute).

**Reduces to:** **projection** + **fact** — edges are Facts (`References {from,rel,to,strength}`); the read framings are Projection presets over the one edge set. ADR-0069 C3 collapses four filters into one parameterized query.

**Connections.** `platform/runtime` `state.link`/`unlink`/`edges`/`graph`/`neighbors`/`members`; the walk uses `store.edgesFrom`/`edgesTo` directly; `shared.ts` affordances.

**ADRs.** ADR-0069 (the one edge query), ADR-0016, ADR-0075 (walk), ADR-0046, ADR-0054, ADR-0057, ADR-0048.

> ⚠ **Coherence — one edge store, four shapes: convergent (compounds, info).** Every persisted edge is an `EdgeRecord` written through `StateStore.putEdge`/`listEdges` (`state.ts:333`); `AnnotatedEdge` (`state.ts:988`) is `EdgeRecord + derived?`, and `ThinEdge` (`shape.ts:129`) + the gateway-client `Edge` (`gateway/client/main.ts:71`) are structural trims. There is no second edge store. No change needed — this is the model.

> ⚠ **Coherence — the whole-projection default is unbounded (conflict, high).** `graph`, `$graph`, bare `edges()`, and `links` all funnel through `state.graph`/`state.edges` + `scopeEdges`, and `scopeEdges` returns ALL edges when `limit===undefined` (`shape.ts:162`; `edgeScope` forwards `limit` through at `commands-graph.ts:307`). The in-code ADR-0081 comment (`commands-graph.ts:279-283`) records that this unbounded projection already caused a silent CloudFront-30s / Lambda-6MB failure. The gateway `$graph` branch (`gateway/service.ts:617`) has **no** `overBudget` guard, unlike `$catalog` (`gateway/service.ts:587-611`). The ADR-0069 replacement `edges()` inherits the identical bug on its default path. (The "29018 live edges" figure is a runtime observation, not repo-verifiable; the argument does not depend on it.)
> **Fix:** give the whole-projection framing a default `limit` with `nextCursor` so `$graph` and bare `edges()` are safe at corpus scale. The deprecation of `graph` is cosmetic; the operational break is the missing default bound.

> ⚠ **Coherence — neighbors skips the timer filter (conflict, medium).** `graph` and `members` pre-filter records with `!r.superseded && isTimerLive(r, nowMs)` (`state.ts:1955-1956`, `:1980-1981`) but `neighbors` (`state.ts:1928-1931`) filters neither, so `deriveBackboneEdges` sees dormant (delete-timer-expired / not-yet-enabled) facts in the emitted edge arrays. `signalsFor` (`state.ts:1471`) feeds the unfiltered list too. The window is between a timer fact going dormant and a reaping supersession.
> **Fix:** collapse the four call sites onto one `edgeSet(scope,{typeRules})` helper applying a single liveness policy before `deriveBackboneEdges` — the "separable follow-on" the ADR-0069 comment names (`commands-graph.ts:41-43`).

---

## 7. The directional causal walk (`edges` depth≥2, ADR-0075)

**What it does.** With `around` + `depth 2–6`, `edges` runs `walkFrom`: all maximal simple paths from the root over AUTHORED edges, following `store.edgesFrom` (`direction 'out'`/downstream) or `edgesTo` (`'in'`/upstream), optionally rel-restricted. Compound confidence = Π step strength (null=1), cycle-guarded (never revisit a node on the path), capped at 200 paths / 500 expansions with a `truncated` flag. The simulation read for causal rels (`causes`·`enables`·`predicts`·`prevents`·`contradicts` — a documented floor, open vocabulary).

**Public API** (`services/workspace/commands-graph.ts`)
```ts
walkFrom(store, scope, root, { rel, direction, depth }): WalkResult
WalkResult { root, direction, depth, rel?, paths: WalkPath[], total, truncated? }
WalkPath   { nodes[], steps: WalkStep[], confidence }
// WALK_MAX_DEPTH=6, WALK_MAX_PATHS=200, WALK_MAX_EXPANSIONS=500
```

**Data model.** Traversal over the authored edge index (`store.edgesFrom`/`edgesTo`). Paths sorted confidence-desc then lexical.

**Invariants & edge cases.**
- Simple paths only (cycle guard).
- Depth clamped 2–6.
- Needs the raw store (throws if unavailable).
- Authored edges only.

**Reduces to:** **fact** + **projection** — causal rels are ordinary authored edges (`rel` is a free string; confidence rides the existing authored `strength` 0..1). The one addition is the transitive traversal — a graph read over the Fact-stored edge index. Confidence is a *product* of edge strengths, not a stored quantity.

**Connections.** `store.edgesFrom`/`edgesTo`; the `edges()` dispatch (§6).

**ADRs.** ADR-0075 (causal walk), ADR-0069.

---

## 8. Semantic search & the vector index seam (`search` / `query{text}` / `reindex` / `project`)

**What it does.** `search` embeds the query text and ranks candidates across the viewer's slice + every applicable grant's owner index (over-fetch `topK=limit*4`), then **RE-READS each hit authoritatively** on the live substrate with the viewer's identity (the index is a candidate generator, never an authority — ADR-0030 Decision 1). `query{text}` is the salience-aware successor (relevance joins the blend). `reindex` is the admin-only ASYNC CHUNKED backfill (dispatches + chains `workspace.reindex.requested` continuation events, one page per invocation: embed phase then edges phase). `project` computes the 2D PCA semantic layout synchronously (sharded atlas, ADR-0082). No backend → graceful degradation with a hint.

**Public API** (`services/workspace/commands-search.ts`, `shared.ts`)
```ts
createSearchCommands(build): Pick<...,'search'|'reindex'|'project'|'pruneSimilar'|'suggestions'|'ratify'|'contested'>
createReindexHandler(build): EventBridgeHandler
reindexChunk(deps, scope, params): { done, next }
indexForScope / embeddableText / metadataForFact / selectNeighbors / refreshSimilarEdges  // platform/runtime
// REINDEX_CHUNK = env VECTOR_REINDEX_CHUNK || 50
```

**Data model.** Vector index per scope (S3 Vectors). `SearchHit{key,value,_meta,score(cosine)}`. `_reindex/<scope> = {status:running|done, phase:embed|edges, indexed, skipped, edges, cursor}`. `LAYOUT_KEY=_home/embed2d` manifest + `graph-layout-shard` facts.

**Invariants & edge cases.**
- Decision 1: the index is never an authority — every hit is re-read authoritatively and dropped if superseded/absent.
- `reindex`/`project`/`pruneSimilar` are admin-gated (`workspace:admin` or `platform:*`).
- `reindex` chains itself under `REINDEX_IDENTITY platform/reindex`; a chunk failure throws → EventBridge idempotent retry.

**Reduces to:** **fact** + **projection** — the vector store is an EXTERNAL index (S3 Vectors), NOT a fact, but strictly advisory: candidates are re-read as Facts with the viewer's identity, so scope/grant/timer/supersession are re-enforced. `reindex`/`project` WRITE outputs back as Facts (`_reindex/<scope>`, `similarTo` edges, `_home/embed2d` + shards).

**Connections.** platform vectors (`VectorStore`+`Embedder`, optional); `grants.ts` for grant fan-out; the raw store for `similarTo` edges.

**ADRs.** ADR-0030 (index-not-authority), ADR-0031, ADR-0032, ADR-0047, ADR-0082 (atlas), ADR-0051.

> ⚠ **Coherence — reindex re-admits live delete-timer facts that the stream drops (conflict, high).** The stream indexer drops EVERY fact with `timerEffect==='delete'` (`vector-indexer/handler.ts:106`). The reindex worker sources rows via `state.query` and filters only `!!e.text` (`commands-search.ts:764-766`); `state.query`'s `isTimerLive` check (`state.ts:1830`) returns *true* for a still-live delete-timer fact (`state.ts:188`). So a full reindex re-embeds and wires `similarTo` edges over LIVE (unexpired) delete-timer leases/presence rows the stream path never admits. `search`'s authoritative re-read (`:389-390`) and `recall` `relevanceFor` (`commands-read.ts:44-57`) do NOT re-check the delete-timer, so these leak specifically into search and recall (`contested` `:520` and `suggestions` `:647-649` DO re-check and are protected). Bounded: live-only leases, admin-triggered.
> **Fix:** lift the delete-timer exclusion into a shared `shouldIndex(fact)` predicate (or extend `embeddableText` `vectors.ts:93` to take `timerEffect`) that BOTH `vector-indexer/handler.ts` and `reindexChunk` call.

> ⚠ **Coherence — the embedding dimension has two formulas (conflict, medium).** `vector-indexer/handler.ts:60` computes `DIM` with strict `process.env.VECTOR_EMBEDDER === 'bedrock'`; `s3-vectors-store.ts:236` lowercases first. So `VECTOR_EMBEDDER=Bedrock` (capital B) → `DIM` resolves to 256 while the embedder is `BedrockEmbedder(1024)`, producing both an index-name skew (`slice-<scope>-d<dim>`) and a dimension-mismatch on the first put. The module-level `DIM` exists because it is used inside the pure `planStreamWork(event)` (`handler.ts:91`) which has no `vectors` object. Latent in production only because infra pins `VECTOR_DIM='1024'` (`lib/platform-stack.ts:136`).
> **Fix:** drop the module-level formula; thread `vectors.embedder.dimension` (the single source every query site uses) into `planStreamWork(event, dim)`.

> ⚠ **Coherence — reindex re-embeds instead of reusing stored vectors (conflict, low).** The edge phase re-embeds (`commands-search.ts:787`, honest comment) because it runs as a separate bounded Lambda invocation that no longer holds the vectors, and `VectorStore` offers no keyed `get`. The stream path correctly reuses `putVecs`. Cost/latency doubling is confined to the infrequent reindex backfill.
> **Fix:** add `get(index, keys[])` to `VectorStore` and read stored vectors in the edge phase, or keep the documented Titan-call tradeoff.

> ⚠ **Coherence — vector filter keys are stringly-coupled (conflict, low).** `metadataForFact` (`vectors.ts:185-191`) writes `{superseded,type,tag}`; `search` builds the filter with literal keys (`commands-search.ts:353-355`); nothing type-couples writer and reader. A key rename would make type/tag-scoped searches return EMPTY (S3 Vectors filters are equality; the authoritative re-read cannot recover excluded results). Latent.
> **Fix:** export `VECTOR_FILTER_KEYS = {type,tag}` from `vectors.ts` and reference from both sites.

---

## 9. Ratification & contradiction detection (`suggestions` / `ratify` / `contested`, ADR-0032/0072)

**What it does.** `suggestions` lists inferred `similarTo` pairs no authored edge yet connects, deduped to unordered pairs, ranked by cosine, enriched with type/label/pairHash, flagged `identical` (same content hash) / `degenerate` (same-source or containment) / `leasedBy` (a live `lease/suggestion/<hash>`); `genuineOnly` drops the noise classes; flagged pairs sink below genuine ones. `ratify` writes the authored edge and drops the now-redundant `similarTo` (dedup). `contested` (Stage A of the contested view) surfaces semantically-near, structurally-unconnected pairs sharing a type/tag, skipping already-checked (version-matched `checked/<hash>` markers), degenerate, and ephemeral (delete-timer) endpoints; the adjudicator writes verdicts back with existing verbs.

**Public API** (`services/workspace/commands-search.ts`)
```ts
suggestions(SuggestionsInput{ limit?, offset?, includeRuntime?, genuineOnly? }): SuggestionsResult
ratify(RatifyInput{ from, to, rel, strength? }): RatifyResult{ edge, dropped, ratified }
contested(ContestedInput{ limit?, minScore?, includeRuntime? }):
  ContestedResult{ candidates, total, checked, degenerate, ephemeral, hint }
noiseTypesFor, degeneracyOf, keyBase/coreOf, suggestionCandidates/authoredPairs/pairKey/dropSimilarPair
```

**Data model.**
```ts
SuggestionEntry  extends SuggestionCandidate + { pairHash, fromType/Label, toType/Label,
                                                 identical?, degenerate?, leasedBy?, leasedUntil? }
ContestedCandidate { a, b, score, aLabel, bLabel, aType, bType, sharedTags, hash, versions:{a,b} }
checked/<hash> = { a, b, verdict, versions }
// SUGGESTION_RUNTIME_TYPES floor + SUGGESTIONS_CONFIG_KEY='_config/suggestions'
```

**Invariants & edge cases.**
- A pair an authored edge already connects is never a candidate (self-heals a raced `ratify`).
- The `checked` marker suppresses a pair only while stored version VALUES match both facts order-independently (W5-1 fix: prior code indexed by fact-key, always `undefined`).
- Ephemeral (delete-timer) endpoints are re-checked at read time, not trusted to the store (TTL grace-window lag).
- Byte-identical (equal content hash) pairs cannot contradict.
- The noise floor is slice-declared vocabulary (`_config/suggestions {noiseTypes,admitTypes}` and `_types/<t> {operational:true}`), not hardcoded.

**Reduces to:** **fact** + **projection** — a derived read over Fact-stored edges + facts. The candidate pool is the `similarTo` edge set (written by `platform/vectors`); the enrichment is projection; verdicts are ordinary Facts (`contested/<hash>`, `checked/<hash>`) + authored edges.

**Connections.** `store.listEdges`/`list`; vectors (to have written the `similarTo` edges); leases (§3, in-flight annotation).

**ADRs.** ADR-0032 (ratification), ADR-0072 (contested), ADR-0086, ADR-0066.

> ⚠ **Coherence — the `similarTo` edge invariants ARE fully convergent (compounds, info).** Every writer/consumer funnels through `SIMILAR_REL`/`SIMILAR_WRITER` + `selectNeighbors` (`vectors.ts:144-152`) and `refreshSimilarEdges`/`authoredPairs`/`pairKey` (`similar-edges.ts:37-85`). Stream indexer (`handler.ts:150-153`) and reindex (`commands-search.ts:790-791`) use identical `topK sim.k+1`; `pruneSimilar`/`suggestions`/`contested`/`ratify` all match on `rel===SIMILAR_REL && writer===SIMILAR_WRITER`. No change — this is the model of the seam. Bring the embed-membership and dimension decisions (§8) up to this discipline.

---

## 10. The grant / sharing / authority layer (`share`/`unshare`/`shared`/`grants`/`group`/`groups`)

**What it does.** `share` exposes a subset of an owner's slice (a key, a prefix, or `*` whole-slice) to a grantee (a user, `public`, or `group:<name>`) in `read`/`write` mode; the grant lands in a SEPARATE DynamoDB index. `applicableGrants` resolves the grants applying to a viewer (direct + public + group memberships, all indexed — no slice scan). `grantCovers` matches a grant pattern to a concrete key. `grants()` is the authority self-model (`$grants`, ADR-0007): `scope` (active+ceiling) / `slice` / `grant` (shared/receiving/groups) resolving the three enforcement layers into one inspectable projection. `group` defines a named audience as a `_groups/<name>` fact + a reconciled `MEMBER#` index.

**Public API** (`services/workspace/grants.ts`, `commands-sharing.ts`)
```ts
createDynamoGrantStore(tableName): GrantStore{ put/remove/listForGrantee/listByOwner/addMember/removeMember/listMemberships }
applicableGrants(store, viewer): Grant[]
grantCovers(grantKey, key): boolean
createSharingCommands(build): Pick<...,'share'|'unshare'|'shared'|'grants'|'group'|'groups'|
                                       'requestGrant'|'grantRequests'|'approveGrant'|'denyGrant'>
// WHOLE_SLICE='*', PUBLIC='public', GROUPS_NS='_groups/', PUBLIC_NS='_public/'
```

**Data model.**
```ts
Grant { owner, grantee, key, mode?, createdAt }
// GRANT#<grantee>  sk <owner>#<key>   (recall reads)
// GRANTBY#<owner>  sk <grantee>#<key> (manage)
// MEMBER#<principal> sk <owner>#<group>
GrantsSelfModel { principal, scope:{active,ceiling}, slice, grant:{shared,receiving,groups}, hint }
```
Live `$grants` (c15r): active/ceiling `[workspace:read]`, 2 public shares (`doc:docs/*`, `file/docs/*`), no receiving/groups.

**Invariants & edge cases.**
- Public shares are read-only (open-write public = unbounded ingress) — `share` rejects `write` only when `to === PUBLIC` (`commands-sharing.ts:177-181`).
- `grantCovers`: `'*'`=all, trailing `'*'`=prefix, else exact.
- The grant index is the enforcement truth; `_public/*` is a convenience projection for IAM-blind cells.
- `grants()` changes no enforcement — pure projection.

**Reduces to:** **fact** + **projection** — the one capability that PARTLY reintroduces its own primitive. The grant store (`createDynamoGrantStore`) is a distinct DynamoDB index explicitly "not a fact" and the enforcement truth for cross-slice reads. Everything else reduces: group membership is mirrored as a `_groups/<name>` Fact; public shares reflect as `_public/<pattern>` Facts; `grants()` is a pure projection over identity scopes + the grant store.

**Connections.** DynamoDB (the shared substrate table); identity scopes (`grantScopesOf`); `state.query` for `_groups/` read.

**ADRs.** ADR-0007 (authority self-model), ADR-0053.

> ⚠ **Coherence — the two authority grammars are cleanly separated (compounds, info).** Scope-pattern math lives only in `auth.ts` (`matchesScope`/`intersectScopePatterns`/`hasScope`/`hasGrantScope`/`requireScope`, `:166`–`:314`); grant covering lives only in `grants.ts:65` (`grantCovers`). Gateway `enforceScope` (`gateway/service.ts:455`), `shared.ts` type-scope guards, athena, and search all import the shared predicates. No participant reimplements either. Keep it this way — do not let either grammar leak a second implementation.

> ⚠ **Coherence — group WRITE grants are constructible but never authorize (see §2).** `share` persists a `group:` grantee with `mode:'write'` (`commands-sharing.ts:190`) and `approveGrant` stores `mode: parsed.mode` verbatim (`:344-356`), but the write guard (`commands-write.ts:125-126`) queries `listForGrantee(caller)` only. Fix is in §2.

---

## 11. Grant-request escalation inbox (`requestGrant`/`grantRequests`/`approveGrant`/`denyGrant`)

**What it does.** A denied caller writes a grant-request Fact into the **OWNER's** slice (the one cross-slice write the platform performs itself, server-stamped with the requester as writer — provenance is the anti-spoofing). The owner sees it in `grantRequests` (and home's inbox), resolves with `approveGrant` (applies the grant via `share` for workspace-family or `cells.grant` for cell-family) / `denyGrant`, and the outcome is written back into the REQUESTER's slice under `_grants/answers/`. Resources use the scope grammar `workspace:<owner>:<keyPattern>:<mode>` | `cell:<owner>/<name>:<tool>`.

**Public API** (`services/workspace/grant-requests.ts`, `commands-sharing.ts`)
```ts
parseResource(resource): ParsedResource{ family, owner, keyPattern?, mode?, cellName?, tool?, raw }
requestKey(requester, resource) / answerKey(owner, resource)
GrantRequestValue { requester, resource, note?, status, requestedAt, resolvedAt?, reason? }
GrantAnswerValue  { resource, status, by, at, reason? }
// REQUESTS_PREFIX='_grants/requests/', ANSWERS_PREFIX='_grants/answers/', NOTE_MAX=500
```

**Data model.** `_grants/requests/<requester>/<resource>` in the owner slice (`type grant-request`); `_grants/answers/<owner>/<resource>` in the requester slice (`type grant-answer`). One open request per `(requester,resource)` — deterministic key.

**Invariants & edge cases.**
- Only the resource owner can resolve a request (`parseResource(req.resource).owner === owner`).
- Cell-family grants delegated to `cells.grant`; workspace-family applied via `grants.put`.
- `_grants/` is a reserved namespace never writable through grants.

**Reduces to:** **fact** + **projection** — request/answer are typed facts; `grantRequests` is a query over the prefixes; the resolve path supersedes the pending request and writes the answer fact. Observability rides the Fact trajectory. It compounds on the grant layer (§10) for the actual grant application.

**Connections.** `state.get`/`put`/`supersede`/`query`; `grants.ts`; the cells service (cell-family approvals).

**ADRs.** ADR-0007, ADR-0044.

---

## 12. Declared actions — the no-code write vocabulary (`registerAction`/`invoke`, ADR-0001/0014)

**What it does.** An action is DATA not code: `{id,if?,enabled?,writes[],params?}` stored as a `_actions/<id>` Fact and applied by a small fixed interpreter. Conditions are decidable (structured `{key,op,path,value}` or a CEL expression over `{params,self,now,key,exists,value}`); writes are declared (bounded, auditable, contested-target detectable via a registry scan). Templates `${params.x}`/`${self}`/`${now}` are single-pass; per-write `ifAbsent+timer` expresses an atomic lease-bound claim. `invoke` checks `enabled` then `if` (typed `ActionInvokeError`), then applies writes in order with substitution.

**Public API** (`services/workspace/actions.ts`, `commands-declared.ts`)
```ts
createDeclarativeActions(state): { register, list, remove, invoke }
ActionDefinition  { id, description?, if?, enabled?, writes: DeclaredWrite[], params? }
DeclaredWrite     { key, value?, ifAbsent?, ifVersion?, timer?, type?, tags? }
DeclaredCondition { key?, path?, op?, value?, cel? }
// ActionInvokeError codes: precondition_failed | action_disabled | invalid_param | not_found
```

**Data model.** `_actions/<id>` fact (`type 'action'`) via `createDeclarationRegistry` `actionKind{ns:ACTIONS_PREFIX,factType:'action'}`. `InvokeResult{invoked,action,params,writes[]}`.

**Invariants & edge cases.**
- An action may not write the `_actions/` vocabulary.
- CEL parse errors surface at registration (never registered broken).
- `null` param treated as absent (unresolved template) not wrong-type — fixes no-text machine triggers.
- Writes are not atomic as a batch; per-write `ifAbsent` is the atomic claim.

**Reduces to:** **fact** + **projection** — the definition is a Fact (ADR-0014 closed the ADR-0001 storage exception); the interpreter's writes are ordinary `state.put` Facts; contested detection is a projection. The only non-core element is the small fixed evaluator (CEL + structured DSL) — computation over facts, deliberately total.

**Connections.** platform `createDeclarationRegistry`; `@marcbachmann/cel-js`; `state.get`/`put`.

**ADRs.** ADR-0001 (declarative actions), ADR-0014 (declaration registry), ADR-0066, ADR-0086.

---

## 13. Registered views — the no-code read vocabulary (`registerView`/`view`, ADR-0001)

**What it does.** A view is DATA not code: `{id,query,reduce?,path?,filter?,render?}` stored as a `_views/<id>` Fact — a named stored projection (the query primitive as data) with an optional reduction (`list|count|latest|sum`), an optional per-entry CEL filter over `{key,value,meta}`, and a render hint that makes the same declaration a dashboard surface for humans AND an affordance for agents. `evaluate` runs the query, applies the CEL filter (total — an erroring entry is excluded), reduces, and returns `{value,count,render}`.

**Public API** (`services/workspace/views.ts`, `commands-declared.ts`)
```ts
createRegisteredViews(state): { register, list, remove, evaluate }
ViewDefinition { id, description?, query: QueryOptions, reduce?, path?, filter?, render?: RenderHint }
ViewResult     { id, description?, render, value, count }
RenderHint     { type: metric|table|feed|list|markdown, label? }
```

**Data model.** `_views/<id>` fact (`type 'view'`) via `createDeclarationRegistry` `viewKind`. `evaluate` excludes `_actions_`/`_views_` keys unless the view has an explicit prefix.

**Invariants & edge cases.**
- A view is a read and stays total — a filter parse error fails registration; a filter eval error excludes the entry.
- Views don't observe the vocabulary itself unless they ask (explicit prefix).

**Reduces to:** **projection** + **fact** — a view IS a stored Projection preset (its query = `QueryOptions` as a Fact) + a small total reduction. `state.query` does the select/score; the reducer folds; the render hint is presentation metadata. ADR-0057 (Members) makes "a view's facts" and "a doc's members" one read.

**Connections.** platform `createDeclarationRegistry`; `state.query`; `@marcbachmann/cel-js`.

**ADRs.** ADR-0001, ADR-0057 (members), ADR-0054.

---

## 14. Subscriptions — the generic reaction primitive (`registerSubscription`, ADR-0083)

**What it does.** A subscription is DATA not code: `{id,match:{type?,keyPrefix?,cel?},invoke|deliver,params?,maxDepth?}` stored as a `_subscriptions/<id>` Fact. When a fact write matches, the reactor invokes a declared action (in-process) or delivers to a cell tool `@owner/name.tool` (called AS the slice owner), with params templated from the event (`${key}`/`${keySuffix}`/`${scope}`/`${value.<path>}`). `matches()` reuses the shared Selector predicate (`matchesSelector` — the SAME one View membership and `query` use, ADR-0011) for the structural clause, CEL on top. This is what lets a tier-2 cell (e.g. `@c15r/machine`, `@c15r/lit`) become reactive purely by registering vocabulary.

**Public API** (`services/workspace/subscriptions.ts`, `event-handlers.ts`)
```ts
createSubscriptions(state): { register, list, remove }
matches(def, fact): boolean          // uses matchesSelector
resolveParams(sub, key, scope, value): Record<string,unknown>
substituteValue / parseCellTarget
SubscriptionDefinition { id, match, invoke?, deliver?, params?, maxDepth?, label? }
```

**Data model.** `_subscriptions/<id>` fact (`type 'subscription'`) via `createDeclarationRegistry` `subscriptionKind` (listLimit 200). Live: `_subscriptions/lit-decompose-markdown` & `lit-decompose-chunk` (deliver `@c15r/lit.*`, tags `cell-required`).

**Invariants & edge cases.**
- Exactly one of `invoke`/`deliver`.
- `match` must constrain at least one of `type`/`keyPrefix`/`cel`.
- CEL validated at registration.
- `maxDepth` (default 50) caps the reaction fixpoint via the triggering fact's revision.
- Param substitution is total (unresolved exact placeholder → undefined/omit, not null).

**Reduces to:** **projection** + **fact** — the subscription is a Fact; its match is the SAME `Projection.select` predicate (`matchesSelector`, ADR-0011) that `query`/views use. "Reactivity = the same select over the change-stream" is literally realized here.

**Connections.** platform `createDeclarationRegistry` + `matchesSelector`; `@marcbachmann/cel-js`; the fact-reaction handler.

**ADRs.** ADR-0083 (subscriptions), ADR-0011 (selector), ADR-0088 (wake-on-change).

> ⚠ **Coherence — the match half is convergent-by-construction (compounds, info).** `matches()` delegates the structural predicate to the shared `matchesSelector` (`subscriptions.ts:180`) — the same Selector View membership (`state.ts:1080`) and `query` (`state.ts:1832`) use (`selector.ts:36`). Preserve this. The remaining work is unifying the *trigger* and *deliver* halves, not the match.

---

## 15. The write fan-out — platform events reflected as facts (`event-handlers.ts`)

**What it does.** The service wires EventBridge handlers that turn platform events into Facts in the owner's slice:
- `createSubstrateWriteHandler` — organ-to-reef: a dynamic cell's `substrate.write.requested` (IAM-source-attested `cell-<id>`, owner resolved from the cells registry — never the event body), applied as a fact or seeded cell-required vocabulary.
- `createFactReactionHandler` — the reactor: loads the changed fact, matches `_subscriptions/*`, invokes/delivers, mints per-run scoped tokens for models/run/lit agents, dead-letters failures to `_reaction-errors/<id>`.
- `createCellLifecycleHandler` — `cells/<id>` pointer + source-manifest file fact + `_caps/*` capability projection.
- `createDataFileMirrorHandler` — cell data blob → `file/cells/<id>/data/<key>` fact (type inferred).
- `createCapabilityTouchHandler` — `capability.invoked` → a salience touch on `_caps/<target>` + presence refresh.
- `createTendHandler` + `createMachineTickHandler` — crons.

**Public API** (`services/workspace/event-handlers.ts`, `service.ts`)
```ts
createSubstrateWriteHandler / createFactReactionHandler / createCellLifecycleHandler /
createDataFileMirrorHandler / createCapabilityTouchHandler / createTendHandler /
createMachineTickHandler(build): EventBridgeHandler
runTend(state, scope, ctx, via, writer, store): TendReport
reconcileTierOneCapabilities(ctx, state, scope)
projectCapabilityFacts(ctx, state, cell)
```

**Data model.** Emits `workspace.fact.written`/`shared`/`action.invoked`/`tended`/`ingested`/`grant.requested`/`grant.resolved`/`reindex.requested`. Projects `cells/<id>` (type cell), `cells/<id>/source-manifest` (file), `_caps/<addr>.<tool>` (capability, embeddable), `file/cells/<id>/data/<key>` (inferred type), `_presence/<participant>` (15min delete-lease), `tending/latest` (audit). Live: 104 capability facts, 66 machine-run facts.

**Invariants & edge cases.**
- `substrate.write.requested` source must start `cell-` (IAM-attested); owner from registry not event body; organ may not write sharing (`_groups`/`_public`) namespaces; organ may seed/retire only `_actions`/`_views`/`_subscriptions` vocabulary.
- The reactor never reacts to `_`-prefixed writes; failures dead-letter to `_reaction-errors/` WITHOUT emitting `fact.written` (no loop) — `event-handlers.ts:550` documents a deliberate `state.put` without emit for loop-prevention.
- Machine tick resumes waiting runs past `waitUntil` and reaps runs stale >12h (`STALE_RUN_MS`).
- Capability touch/presence are best-effort and must never fail the event.

**Reduces to:** **fact** + **cell** — every handler's output is a Fact (the platform reflecting itself INTO the substrate). It compounds on the Cell axis for its inputs (event-source attestation, `x-cell-caller`, `describeTypes`/`describeCellTools` publish seam, the async write-shape). The reactor is where the subscription projection meets the Fact change-stream.

**Connections.** platform EventBridge routing; the cells service (`resolveCell`/`describeCellTools`/`describeTypes`/`callCellTool`); `auth.mintTokenFor`; the declaration registries; `state.touch`/`put`/`supersede`.

**ADRs.** ADR-0008 (cells), ADR-0052, ADR-0085, ADR-0027, ADR-0086, ADR-0030, ADR-0065, ADR-0083.

> ⚠ **Coherence — NO fan-out chokepoint (conflict, high).** `state.put()` does not emit `workspace.fact.written` — it only appends the trajectory (`state.ts:1743,1746`), and the store layer has no `ctx.events` access. Every write path re-emits by hand: ~13 sites (`commands-write.ts:162`; `commands-declared.ts:100,235`; `event-handlers.ts:109,344,360,438,487,635,740,762,851,922`). No `putAndEmit`/`announceWrite` helper exists (grep confirms). A new write path that forgets the emit silently breaks reactions/subscriptions/machines while trajectory, seq-feed, analytics-mirror and vector-index paths keep working (they ride the DynamoDB stream + `appendTrajectory`, not the event). The batch path emits a *different* event (`workspace.ingested`, `commands-write.ts:226`), so it is not a shared point.
> **Fix:** make `state.put`/`state.supersede` own the announcement (emit inside the write, or return a to-announce descriptor a single caller emits), OR move the reactor onto the DynamoDB stream (a 3rd consumer beside vector-indexer + archiver) so "a fact changed" has exactly one physical origin.

> ⚠ **Coherence — three change-propagation mechanisms, no shared origin (conflict, low).** `appendTrajectory` is coupled inside `put`/`link`/`unlink`/`supersede` (`state.ts:1746,1898,1916,2177`); `fact.written` is emitted independently in the command/handler layer; the DynamoDB stream drives the vector indexer + archiver (`lib/platform-stack.ts:206,240`); reactions ride EventBridge (`:269`). `changes()` is pure pull (also consumed internally by `attention()` via `recentTrajectory`, `state.ts:2069`) — no reactor rides it. Document these as one logical "change propagation" seam.

---

## 16. Tending & the consolidation audit (`tend` / `attention` → `tending/latest`)

**What it does.** `runTend` reads `attention()` (stale/unlinked/dangling + settled counts) and `suggestionCandidates`, and writes a `tending/latest` audit Fact with UNCAPPED totals + samples + a delta vs the prior audit (a zero delta over a non-zero backlog = chronic debt). It also reconciles the tier-1 capability facts (`_caps/workspace.*`/`auth.*`/`cells.*`) diff-only, retiring DEPRECATED aliases (ADR-0085 Inc 1). Runs on the daily cron (`createTendHandler`) or manually (`tend`, admin-gated). `tend` emits `workspace.fact.written` so a tending machine's trigger can react.

**Public API** (`services/workspace/event-handlers.ts`, `commands-read.ts`)
```ts
runTend(...): TendReport{ at, scope, stale, unlinked, dangling, settled, suggestions,
                          *Sample, previousAt?, delta? }
reconcileTierOneCapabilities(ctx, state, scope)
firstSentence   // abbreviation-aware summary extraction
```

**Data model.** `tending/latest` (`type audit`, tags `[tending]`). `_caps/<cell>.<verb>` (`type capability`). Live `consolidation/latest` backlog: `{dangling:79, stale:332, contested:1973, degenerate:2979, unlinked:522}`.

**Invariants & edge cases.**
- Totals uncapped (real trend); samples capped.
- Tier-1 reconcile is best-effort — a failure must not fail the audit.
- DEPRECATED verbs skipped AND retired if previously projected.
- A provider whose `describeTools` fails contributes nothing and is excluded from retirement.

**Reduces to:** **projection** + **fact** — a derived read (`attention()` projects over the fact/edge state: stale = old+unearned, unlinked = no authored/ref/placement edge, dangling = broken endpoints) distilled into an audit Fact. Capability reconciliation writes `_caps/*` Facts so the fact floor covers the whole tier-1 surface.

**Connections.** `state.attention`/`put`; `store.listEdges`/`get`; `cells`/`auth` `describeTools`.

**ADRs.** ADR-0032, ADR-0052, ADR-0085, ADR-0073.

---

## 17. The one declaration surface (`declare`/`declarations`/`undeclare`/`evaluate`, ADR-0068)

**What it does.** The three declaration kinds (`action`|`view`|`subscription`) share one storage lifecycle; the composed verbs expose it once: `declare(kind,def)` registers, `declarations(kind?)` lists (union across all three when unfiltered, each tagged with `kind`), `undeclare(kind,id)` retires, `evaluate(kind,id,params)` is the per-kind essence (`invoke` for action, `evaluate` for view; subscriptions match in the reactor, no `evaluate`). The eleven legacy `register*`/…/`delete*`/`invoke`/`view` verbs remain as aliases.

**Public API** (`services/workspace/commands-declared.ts`)
```ts
createDeclaredCommands(build)
declare(DeclareInput{ kind, def })
declarations(DeclarationsInput{ kind? })
undeclare(UndeclareInput{ kind, id })
evaluate(EvaluateInput{ kind, id, params? })
```

**Data model.** Unified over `_actions/` `_views/` `_subscriptions/` facts. `evaluate` for `action` mirrors `invoke` exactly (emits `workspace.action.invoked` + `workspace.fact.written` per write).

**Invariants & edge cases.**
- `evaluate` on a subscription throws (only `action`|`view`).
- `action` `evaluate` surfaces its writes as events so subscriptions react to a manual step as a reactive one.

**Reduces to:** **fact** — pure contraction (C1). The storage lifecycle is identical for every declaration kind (all `_<kind>s/<id>` Facts via `createDeclarationRegistry`), so `declare`/`undeclare` are one lifecycle over three kinds; `evaluate` dispatches to the same per-kind evaluators.

**Connections.** the actions/views/subscriptions registries (§12–14).

**ADRs.** ADR-0068 (one declaration surface), ADR-0001.

---

## 18. The write fan-out inputs recap — see §15. *(no separate section)*

---

## 19. Inline type affordances & granular type-scope guards (`shared.ts`)

**What it does.** `affordancesForTypes` builds the inline `types` map a read carries for the types present in its result (ADR-0029 R1) — collapsing `query→$types→correlate→act` into `query→act` by attaching `types[T].{icon,label,render,handlers,manager}` from the cached canonical vocabulary (`cells.describeTypes`, 60s process cache). `typeRulesFor` resolves per-type Reference rules (`managedBy`/ref fields/key-encoded edges) for the graph backbone. `enforceTypeRead`/`enforceTypeWrite` are the granular §B token guards: a `read:type:<T>`/`write:type:<T>` token may only touch that type (inert for coarse `read:`/`write:workspace` and internal Mode-1 callers).

**Public API** (`services/workspace/shared.ts`)
```ts
affordancesForTypes(typeNames, decls): Record<string, TypeAffordance>
typeDeclsFor(ctx)   // 60s cache, __resetTypeDeclsCache
typeRulesFor(ctx): Record<string, TypeRules>
typesOf(container, ...extra)
enforceTypeRead / enforceTypeWrite(identity, type, key)
dynamoDeps: DepsBuilder   // createObservedState + createDynamoGrantStore + vectorsFromEnv
```

**Data model.** `TypeAffordance{icon?,label?,render?,handlers?,manager?}`. `WorkspaceDeps{state,grants,vectors?,store?}`. Reads the substrate table (`SUBSTRATE_TABLE`) for state + grants.

**Invariants & edge cases.**
- One `resolveType` per distinct type (no per-fact bloat).
- `_`-prefixed plumbing types omitted from affordances.
- Granular guards inert unless a granular-only external token is present.
- Type vocabulary fetch failure degrades to `{}` (backbone still links, hints go quiet).

**Reduces to:** **projection** + **fact** — affordances are a projection over the type-vocabulary Facts (`_types/<t> ⊕ the cell describeTypes publish seam`). The scope guards are enforcement over the Fact `type` field. This is the present/shape stage (Affordance shape) plus the token gate.

**Connections.** `cells.describeTypes`; platform `resolveType`/`extractTypeRules`/`hasScope`; the substrate table.

**ADRs.** ADR-0029 (inline affordances), ADR-0003.

> ⚠ **Coherence — the SERVER present path converges (compounds, info).** Gateway `$types`, workspace read/search/graph envelopes, and cell SSR all resolve the present facet through the single `resolveType`/`buildTypeVocabulary` primitive (`type-schema.ts:175-189`, `type-vocabulary.ts:42-49`) and ship `present.{icon,label,render}` as data. `affordancesForTypes` (`shared.ts:123-129`) calls it from `commands-read.ts:140/210/587/677`, `commands-search.ts:394`, `commands-graph.ts:183/220/237/255`. Keep `resolveType`/`buildTypeVocabulary` as the acknowledged present core; ADR-0012 should name IT (not the dead `resolvePresent`).

> ⚠ **Coherence — the CLIENT label/icon resolution diverges (conflict, medium/low).** The server ships the label *path* (`aff.label = rt.present.label`, `shared.ts:118-133`); clients resolve it, and three-plus client sites hand-roll it: kernel `titleOf` (`cells/kernel/client/main.ts:429`, comment says it "mirrors resolveLabel"), home/home-next `factTitle` (`facts.tsx:86`), each rooting only at `e.value` (string-only) — so a served `present.label` of `value.title` resolves in the kernel but mis-resolves in home, and numeric paths (`value.seq`) fall through to the key. `platform/runtime/present.ts` `resolveLabel`/`resolvePresent` is exported but consumed by NO client site (grep) — a phantom shared core. Icons likewise inline (`storage.ts:114,161,530` = 3-step `?? '•'`; `facts.tsx:41` = 2-step no `'•'`).
> **Fix:** extract ONE client-side label/title + icon resolver into `@parc/ui` and have kernel/home/home-next delegate; or delete `present.ts`'s dead exports.

---

## 20. Read-response shaping — the refs/card/full tiers (`shape.ts`, ADR-0048)

**What it does.** Every collection read accepts one `shape` arg with three tiers: **refs** (key + salience `_meta` essentials, no value), **card** (value with long strings truncated to 240 chars and structure summarised to depth 2, titles/first-lines survive), **full** (everything as stored). `orientEntry` is the leaner overview-focus shape (card value + refs `_meta`). `shapeEntry`/`List`/`Map` apply it; `scopeEdges` applies `keys`/`rels`/`limit`/`cursor` + a thin edge shape. Shaping narrows what is SENT, never what the caller may read — `peek`/`shape:'full'` always restore the whole fact; shaped entries carry `_meta.shaped`.

**Public API** (`services/workspace/shape.ts`)
```ts
cardValue(v, depth): unknown   // CARD_STR=240, CARD_DEPTH=2, CARD_LIST=12, CARD_FIELDS=24
shapeEntry / shapeEntryList / shapeEntryMap(e, shape)
orientEntry(e)
scopeEdges(edges, input): { edges, total, nextCursor? }
ReadShape = 'refs'|'card'|'full'
EdgeScopeInput { keys?, rels?, limit?, cursor?, edgeShape? }
ThinEdge { from, rel, to, derived? }
```

**Data model.** `refsMeta` keeps `{type,tags,score,updatedAt,superseded,relevance?,shaped}`. `scopeEdges` pages over the already-materialized projection (bounds size not compute).

**Invariants & edge cases.**
- Shaping is presentation, never authority.
- `_meta.shaped` distinguishes a truncated body from a short one.
- `relevance` rides along on shaped entries (a ranked shortlist must not hide its ranking signal, F7).
- `{limit:0}` = count-only; `total` always counts pre-page.

**Reduces to:** **projection** — the present/shape stage of the pipeline made uniform (one vocabulary instead of per-command knobs). Purely presentation over already-selected/scored facts; the response-altitude control that keeps reads under the CloudFront 30s / Lambda 6MB ceilings (ADR-0081).

**Connections.** platform `Entry`/`EntryMeta`.

**ADRs.** ADR-0048 (shaping tiers), ADR-0081 (response ceilings).

> ⚠ **Coherence — the pipeline ORDER is clean (compounds, info).** Salience elision (which entries survive) → card/refs truncation (how much of each value ships) → present (how to draw it) are three distinct concerns applied in sequence (`state.ts:1615` `shapeEntries`; `commands-read.ts:592-596`; `shared.ts:115`). Keep the three-stage ordering.

> ⚠ **Coherence — `refsMeta` is a hand-maintained allow-list that drops `reward` (conflict, medium).** `refsMeta` (`shape.ts:57-68`) enumerates a fixed field set with `relevance` conditionally spread but NO `reward`, so `wrap()`'s `reward` (`state.ts:1565`) is silently dropped by both the refs tier and the orient tier (recall's focus band); it survives only in the card tier (which spreads `_meta` whole). Any new `_meta` ranking signal must be threaded in by hand or it vanishes from refs-tier reads. (Under default `rewardWeight 0` the drop does not distort ranking — `state.ts:94-96` — so low is arguable.)
> **Fix:** derive the refs `_meta` slice from `EntryMeta` with a documented DROP-list (provenance-only: `writer`/`via`/`seq`/`version`/`revision`) rather than an ALLOW-list, so newly-added signals ride along like `relevance`.

---

## 21. Athena analytics SQL surface (`athena`, admin-gated)

**What it does.** An admin-only (`platform:*`) read-only SQL surface over the substrate analytics lake (`substrate_<env>.facts` — the whole change history as columns + `value_json`). `assertReadOnlySql` enforces `WITH`/`SELECT`/`SHOW`/`DESCRIBE`/`EXPLAIN`, single statement. Runs in the `substrate-<env>` workgroup with a 50s deadline (under the 60s Lambda). `sanitizeAthenaError` scrubs IAM ARNs/account ids before an error crosses the membrane (wave-5 W5-3). `requireScope` re-checks `platform:*` in-handler (a direct service invoke bypasses the gateway).

**Public API** (`services/workspace/commands-athena.ts`)
```ts
createAthenaCommand(): { athena }
assertReadOnlySql(sql)
sanitizeAthenaError(err)
AthenaRunner   // test seam __setAthenaRunner
AthenaResult { columns, rows, rowCount, scannedBytes?, queryExecutionId }
```

**Data model.** `substrate_<env>.facts`: `scope`/`key`/`type`/`tags`/`revision`/`writer`/… + `value_json`. `ATHENA_WORKGROUP`/`ATHENA_DATABASE` env config.

**Invariants & edge cases.**
- Read-only verbs, single statement.
- Double-enforced `platform:*` (descriptor gate + `requireScope`, `commands-athena.ts:149`) — direct invoke can't bypass.
- Backend errors scrubbed of ARNs/account ids.
- Reads the whole lake — the coarse admin gate is deliberate until per-slice partitioning.

**Reduces to:** **fact** — a read-only analytical projection over the SAME Fact trajectory exported to an Athena/S3 lake (every scope's facts as rows). Not a new store; it can observe the substrate, never mutate it.

**Connections.** `@aws-sdk/client-athena` (lazy); platform `requireScope`.

**ADRs.** ADR-0007.

> ⚠ **Coherence — three duplicated admin disjunctions; athena's bar is intentionally stricter (conflict, low).** `reindex`/`project`/`pruneSimilar` each inline `if (!hasScope(...,'workspace:admin') && !hasScope(...,'platform:*'))` (`commands-search.ts:408,432,462`) with no shared helper. `athena` uses a strictly narrower `requireScope(ctx.identity,'platform:*')` (`commands-athena.ts:149`) — narrower because `impliesScope` returns false for a coarse required scope (`auth.ts:252-268`), so `workspace:admin` does NOT satisfy `platform:*`. Athena's stricter bar is BY DESIGN (it reads across EVERY scope; the others stay within the caller's own scope). The real defect is only the 3 duplicated inline disjunctions (DRY/drift risk).
> **Fix:** extract `requireAdmin(identity)` (into `shared.ts` or `auth.ts`), reuse it in reindex/project/pruneSimilar, and comment deliberately why athena keeps the stricter `platform:*` bar.

---

## 22. MCP tool discovery & verb-scope derivation (`describeTools`/`descriptors`)

**What it does.** `TOOL_DESCRIPTORS` (`descriptors.ts`) is the static catalog the `/mcp` gateway reads to advertise this cell's ~50 tools — each `{name,description,inputSchema,resultSchema?,scope,scopeFamily?,kind}`. `describeTools()` derives the enforced verb scope from `kind` (`read→read:workspace`, `act→write:workspace`) when `scope` is null, so a token's read/write consent is enforced; an explicit scope (`workspace:admin`, `platform:*`) overrides; `scopeFamily` (`write:type:*`) lets a granular token reach the handler where the concrete type is checked. Deprecated verbs (`search`/`neighbors`/`graph`/`links`/`members`/`registerAction`/…) are marked DEPRECATED in-description.

**Public API** (`services/workspace/descriptors.ts`, `handlers.ts`)
```ts
TOOL_DESCRIPTORS: ToolDescriptor[]
ToolDescriptor { name, description, inputSchema, resultSchema?, scope, scopeFamily?, kind }
describeTools(): { tools }
```

**Data model.** Shared schema fragments (`META_SCHEMA`, `LENS_SCHEMA`, `SHAPE_SCHEMA`, `ENTRY_SCHEMA`, `EDGE_SCHEMA`, `TYPES_AFFORDANCE_SCHEMA`). Live: 50 types / 17 cells; `catalog_menu` reports 102 caps / 13 cells.

**Invariants & edge cases.**
- Catalog weight is an ergonomic budget — result schemas kept shallow.
- Verb-scope: reads need `read:workspace`, acts `write:workspace`, unless an explicit scope overrides.
- Legacy coarse tokens satisfy verb scopes via `impliesScope` (`workspace:read ⊇ read:*`).

**Reduces to:** **cell** + **projection** — the publish/discovery seam of the Cell axis (the workspace cell describing its own tools to the gateway, mirroring `cells.describeCellTools`/`describeTypes`). The verb-scope derivation is enforcement metadata over the scope=IAM=OAuth boundary. The catalog is projected into `_caps/workspace.*` facts by the tend reconciler (§16), so discovery also compounds on fact.

**Connections.** the `/mcp` gateway; `handlers.ts` composition.

**ADRs.** ADR-0044, ADR-0029, ADR-0048.

---

## Gotchas / non-obvious behavior

1. **`workspace.graph` is dead in the deployed snapshot** — it errors `"Unhandled"` while the unified `workspace.edges` works. Prefer `edges`; treat the legacy aliases as cosmetic (§1, §6).
2. **Group write-grants silently never authorize** (§2/§10). `share` and `approveGrant` will happily persist a `group:` write grant, but `requireWriteThrough` uses `listForGrantee(caller)` and never folds group memberships. Fail-closed, not an exposure — but the feature is inert, and cross-slice cell writes inherit it.
3. **No single origin for "a fact changed"** (§15). `state.put` does not emit `workspace.fact.written`; ~13 hand-rolled emit sites do. Add a new write path without the emit and reactions/subscriptions/machines break silently while everything else (trajectory, analytics, vectors) keeps working.
4. **The whole-graph projection is unbounded by default** (§6). `graph`, `$graph`, bare `edges()`, `links` return ALL edges when `limit` is undefined — the ADR-0081 comment records this already caused a silent CloudFront/Lambda failure, and the ADR-0069 replacement inherits it. Always pass `limit` on edge reads at corpus scale.
5. **The vector index is never authoritative** (§8). Every search hit is re-read as a Fact with the viewer's identity; a stale/superseded vector cannot leak. But two writers (stream vs reindex) disagree on whether live delete-timer facts get embedded, so reindex can re-admit leases/presence rows into search/recall.
6. **The recall digest is a cache, not a fact** — written through the raw store with no seq advance / trajectory / touch, invalidated exactly when any write advances seq. A bare recall with a foreign grant, any shaping arg, `text`, `lens`, `explain`, `salience` disqualifies the digest.
7. **`remember` is REPLACE, not merge.** The whole `value` is overwritten; revision history is preserved but there is no field-level merge.
8. **Leases assert nothing.** `lease/<domain>/<item>` is a fact with a delete timer used as a mutex; releasing another participant's lease is permitted-but-noted — the participant key carries no authority.
9. **`refsMeta` is an allow-list.** New `_meta` ranking signals (like `reward`) are dropped from refs/orient tiers unless you add them by hand (§20).
10. **Client label/icon resolution is un-converged** (§19). The server ships the label *path*; kernel/home/home-next each re-resolve it with subtly different rooting (string-only, `e.value`-rooted), so `present.label` values like `value.seq` or envelope-rooted paths mis-resolve in the clients. `platform/runtime/present.ts` exports a resolver no client uses.
11. **Athena's `platform:*` bar is stricter than the search-admin bar and that is deliberate** — athena reads across every scope; reindex/project/pruneSimilar stay within the caller's own scope. Don't "unify" them without preserving athena's cross-scope gate.
12. **The reactor never reacts to `_`-prefixed writes**, and dead-letters failures to `_reaction-errors/` WITHOUT emitting `fact.written` — a deliberate loop-break (`event-handlers.ts:550`). `maxDepth` (default 50) caps the reaction fixpoint via the triggering fact's revision.
13. **`changes()` is pure pull** — no long-poll/wait parameter exists; external non-cell delivery is unavailable pending ADR-0088.