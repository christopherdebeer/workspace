# Coherence Audit — Compound vs Conflict

The reduction's promise is the **breathe invariant**: every primitive is USED, none is RE-IMPLEMENTED — one representation and one resolver per concept ("3NF for architecture"). This audit is the check of whether that holds at each seam where related capabilities meet. The question each seam answers: **do the capabilities that share a core compound on it, or fork it?**

- **CONVERGENT** — all participants funnel through the one shared helper; no fork.
- **PARTIAL** — the core is genuinely shared on one half of the seam and forked on the other.
- **DIVERGENT** — the intended shared primitive is dead or bypassed; participants carry independent implementations.

## Scoreboard

| Seam | Expected core | Verdict | Worst severity |
|---|---|---|---|
| present-affordance | projection | DIVERGENT | high |
| render-hosts | projection | PARTIAL | high |
| edge-shapes | fact | PARTIAL | high |
| authority | projection | PARTIAL | high |
| write-fanout | projection | PARTIAL | high |
| embed-orchestration | projection | PARTIAL | high |
| type-render-duality | projection | PARTIAL | medium |
| shaping-layers | projection | PARTIAL | medium |
| state-store-backends | fact | PARTIAL | medium |
| selector-predicate | projection | CONVERGENT (with one PARTIAL edge) | medium |

The recurring shape: the **server side of the Projection converges** (one `resolveType`/`buildTypeVocabulary`, one `matchesSelector`, one `EdgeRecord`, one grant/scope math), while **client-side per-fact resolution and the two `home`/`home-next` forks diverge**. The single most-cited root defect is the dead `resolvePresent` and its byte-identical `factTitle` fork across cells.

---

## present-affordance — fact+type → label/icon/affordances
**Expected core:** projection · **Verdict:** DIVERGENT · **Worst:** high

The named present primitive (`resolvePresent`/`resolveLabel`, `present.ts`) is dead — zero non-reexport, non-test callers. The real shared core on the server is the present FACET of `resolveType(decl).present` (`type-schema.ts:175`), resolved via `buildTypeVocabulary`. No shared client-side per-fact label resolver exists.

- **[high · conflict]** `cells/home/client/facts.tsx:86-88` and the byte-identical `home-next` fork call `pathInto(e.value, label)` where every declared label is a `value.*` path, so it descends `e.value.value.*` → always `undefined`, defeating the declared-label branch. Kernel `titleOf` (`main.ts:436-445`) and `resolveLabel` correctly root `value|key|meta`-headed paths at the envelope; canvas consumes kernel `titleOf`, so the **same fact gets its declared title on canvas and a degraded title in home**. A `title/name/content` heuristic silently rescues some types; the rest fall to the bare key. Every labeled type in committed `types.json` uses `value.*`, so the branch fails 100% of the time. **Fix:** root `factTitle`'s label path at the envelope exactly as `titleOf`/`resolveLabel` do — ideally import a shared `@parc/ui labelOf` so there is ONE client label resolver; land in both home and home-next until collapsed.
- **[medium · conflict]** Documentation drift: `platform-core.md:190,291` cite `resolvePresent` at `service.ts:335-339` as the invocation site in three places — but that path is `buildTypes → buildTypeVocabulary → resolveType`, and `335-339` is the unrelated `CORE_FACT_VERBS` set. **Fix:** either wire `resolvePresent` in as the real per-fact present stage, or delete it and rewrite the docs to name `resolveType`'s present facet + `buildTypeVocabulary` as the actual core; correct the ADR-0012 "consumers migrate to resolvePresent" plan.
- **[medium · conflict]** Three independent label resolvers plus a fourth verbatim heuristic copy in `home-next`. `resolveLabel` is consumed by neither client. A served `present.label` of `value.title` resolves in kernel but mis-resolves in home (masked by fallback); numeric paths like `value.seq` fall through to the key. **Fix:** extract one client-side label/title resolver into `@parc/ui`; the heuristic fallback should live there too.
- **[medium · conflict]** `home-next` is a byte-identical fork of the projection core (`normalizeDecl`/`typeDeclsFrom`/`typeIcon`/`factTitle` lines 35-105) plus security/versioning additions; every present fix must be applied twice and will drift. **Fix:** collapse the shared present-derivation into one module both cells import, or promote to `@parc/ui`.
- **[low · conflict]** No shared `iconOf` helper: `storage.ts` has three verbatim `td?.present?.icon ?? td?.icon ?? '•'` copies; `facts.tsx` uses a 2-step form with no `'•'` default; they diverge on the fallback glyph. **Fix:** add `iconOf(decl)` to `@parc/ui` encoding the `present.icon ?? icon ?? floor` ladder once.
- **[info · compounds]** The SERVER present path genuinely converges: gateway `$types`, workspace read/search/graph envelopes, and cell SSR all resolve the present facet through the single `resolveType`/`buildTypeVocabulary`. **Keep** it as the acknowledged present core; the divergence is confined to the client leaf and the orphaned name.

## render-hosts — the federated/sandboxed renderer contract and its embed hosts
**Expected core:** projection · **Verdict:** PARTIAL · **Worst:** high

Shared helper: `platform/ui/federated-renderer.ts` (`attachSandboxedRenderer`/`mountSandboxedRenderer`/`SANDBOX_HOST_HTML`), delivered as the `@parc/ui` virtual module.

- **[high · conflict]** `home` imports the sandbox host from `@parc/ui` (`federated.tsx:6`); `home-next` imports from its own 159-line `./federated-host.ts` with a stricter, network-denied CSP, importing nothing from the canonical 336-line host. No shared helper unifies them — a genuine fork of the untrusted-renderer isolation boundary, so a security fix to one may not reach the other (commit 696d805 corroborates home-next as the "security-hardened" successor). **Fix:** upstream home-next's hardening into `platform/ui/federated-renderer.ts`, delete `home-next/client/federated-host.ts`, and re-point `home-next/client/federated.tsx` back to `@parc/ui`.
- **[medium · conflict]** `cells/home-next/shared/federated-renderer.ts` is a stale orphaned GENERATED copy — its generator (`scripts/sync-platform-ui.mjs`) was deleted, it has drifted (missing `attachSandboxedRenderer`), nothing imports it. The whole `home-next/shared/` directory is dead. **Fix:** delete it and the sibling stale synced files.
- **[info · compounds]** The wire contract stayed convergent: home-next's fork preserves the exact `parc-host`/`parc-sandbox` postMessage protocol and API shapes, so a renderer authored once runs identically in both hosts. This makes collapsing the fork low-risk — only the import path and the hardening location move.

## edge-shapes — edge value-shapes and read verbs
**Expected core:** fact · **Verdict:** PARTIAL · **Worst:** high

Shared helper: `EdgeRecord` (the one persisted edge row) + `deriveBackboneEdges`; `ThinEdge`/client `Edge` are wire-trims, `AnnotatedEdge = EdgeRecord ∪ derived flag`.

- **[high · conflict / shared footgun]** `graph`, `$graph`, `edges()` default, and `links` all funnel through `state.graph`/`state.edges` + `scopeEdges`, which returns ALL edges when `limit===undefined` (`shape.ts:162`). ADR-0081 (`commands-graph.ts:279-283`) already records a silent CloudFront 30s / 6MB failure from this unbounded projection. `$graph` is a gateway-reachable self-model surface with NO size guard (contrast `$catalog`'s `overBudget` guard), and the ADR-0069 replacement inherits the identical bug. **Fix:** give the whole-projection framing a default limit (cap `graph`/`$graph`/bare `edges()` at a page size with `nextCursor`). The deprecation of `graph` is cosmetic; the operational break is the missing default bound.
- **[medium · conflict]** `neighbors`/`graph`/`members`/`signalsFor` derive backbone edges over the UNFILTERED record list, so the derived edge touching a dormant (timer-not-yet-reaped) fact appears in emitted edge arrays, and centrality counts dormant-fact backbone in all read paths. Real but narrow (the window between a fact going dormant and a reaping pass). **Fix:** collapse the four call sites onto one `edgeSet(scope,{typeRules})` helper that applies a single liveness policy (superseded + `isTimerLive`) before `deriveBackboneEdges` — the "separable follow-on" the ADR-0069 comment already names.
- **[low · conflict]** `KeyEdge` (type-schema) and `KeyEdgeRule` (state.ts) are two independent `{from,rel,to}` declarations of one concept, bridged by duck typing. **Fix:** delete `KeyEdgeRule` and import/re-export `KeyEdge`.
- **[info · compounds]** The four edge value-shapes genuinely reduce to ONE store primitive: every persisted edge is an `EdgeRecord`; `AnnotatedEdge`/`ThinEdge`/client `Edge` are a read-superset and two wire-trims. `similarTo` inferred edges match the live deployment byte-for-byte (strength 0.3, cosine score, writer `platform/vectors`). **No change.**

## authority — deciding what a principal may see/do
**Expected core:** projection · **Verdict:** PARTIAL · **Worst:** high

Shared helpers: `grantCovers` + `applicableGrants` (direct + public + group) in `grants.ts`; scope math (`matchesScope`/`hasScope`/`requireScope`/`intersectScopePatterns`) in `auth.ts`.

- **[high · conflict, fail-CLOSED]** The write-through guard does NOT route through the shared `applicableGrants` resolver, so a **group member is wrongly DENIED a granted write** — a whole first-class grant class (group write) is non-functional while `grants()` advertises write as a working gate. Safe-by-default (no escalation), but a constructible, documented, read-visible feature silently authorizes nothing. Propagates to cross-slice caller-writes (`cells/starter → dispatch applyCallerWrites → workspace.remember → requireWriteThrough`). **Fix:** route `requireWriteThrough` through `applicableGrants(grants, caller)` then filter `mode==='write' && grantCovers(g.key, key)`, exactly as `peek` does for reads.
- **[low · conflict]** Three literal copies of the same admin disjunction in `commands-search.ts` (`reindex`/`project`/`pruneSimilar`) with no shared helper; `athena` uses a strictly narrower `requireScope('platform:*')`. The stricter athena bar is intentional (whole-lake cross-scope read) — the real defect is the duplicated inline disjunction, a DRY/drift risk. **Fix:** extract one `requireAdmin(identity)` helper; decide deliberately whether athena keeps its stricter `platform:*` bar (and comment it).
- **[info · compounds]** The two authority grammars are cleanly separated with exactly one home each — scope-pattern math only in `auth.ts`, grant covering only in `grants.ts`; gateway `enforceScope`, type-scope guards, athena, and search all import the shared predicates. The cell tier does identity/ownership checks only and funnels cross-slice writes back through the one write-through guard (ADR-0008). The live `$grants` self-model and starter's deployed `callerWrites` manifest match source. **No change** — but note the finding-1 group-write gap is reachable in production for any group-scoped `shared/` grant.

## write-fanout — propagating "a fact changed"
**Expected core:** projection · **Verdict:** PARTIAL · **Worst:** high

There are TWO propagation substrates: (1) the **DynamoDB stream** on `SubstrateTable` — automatic, single physical origin, drives vector-indexer + archiver; (2) **EventBridge `workspace.fact.written`** — hand-emitted at ~10 sites, drives the reaction reactor. The MATCH half already compounds on the shared `matchesSelector`.

- **[high · conflict]** There is NO chokepoint for the logical change event: `state.put()` does not emit `workspace.fact.written`; every write path re-emits by hand (~10 independent sites, no shared `putAndEmit`). A new write path that forgets the emit silently breaks reactions/subscriptions/machines while trajectory, seq-feed, analytics, and vector-index keep working (they ride the stream). **Fix:** make `state.put`/`supersede` own the announcement, OR move the reaction reactor onto the DynamoDB stream (a third consumer) so "a fact changed" has exactly one physical origin that cannot be forgotten.
- **[medium · conflict]** Exactly two `DynamoEventSource` consumers attach to the table (`vectorIndexer`, `archiver`, both `LATEST`, both pure CDK, no caller involvement); the reaction path is a different substrate (`FactReactionRoute` EventBridge rule on the hand-emitted event). Two parallel mechanisms selected inconsistently. **Fix:** adopt the stream as the canonical fan-out for reactions too — collapse `workspace.fact.written` into a stream-derived signal.
- **[low · conflict]** `appendTrajectory` couples across `put`/`link`/`unlink`/`supersede`; the `changes()` feed is consumed internally by `attention()` (pull, not push). Three mechanisms carry change with no reconciling helper. **Fix:** document them as one logical "change propagation" seam with a single origin.
- **[info · conflict]** ADR-0053's client shadow-state seam (`createOutbox`/`createProjection` in kernel) POLLS the server change feed — it consumes fan-out, it does not consolidate it. Don't conflate it with server fan-out. **Fix:** the server side needs its own single-origin decision (finding 1).
- **[info · conflict]** No long-poll/wait parameter exists on `changes()`; no external delivery shape. **Fix:** ship ADR-0088 Inc 1 (long-poll `changes`) riding the same seq cursor so it doesn't become a fourth substrate.
- **[info · compounds]** The subscription MATCH half compounds on the shared Selector (ADR-0011) — the same predicate View membership and `query` use, with CEL on top. **Preserve; it is the model.**

## embed-orchestration — embedding orchestration around the shared vectors contract
**Expected core:** projection · **Verdict:** PARTIAL · **Worst:** high

The pure vectors contract IS the shared core and compounds cleanly (`embeddableText`, `indexForScope`, `metadataForFact`, `selectNeighbors`, `refreshSimilarEdges`, `SIMILAR_REL`/`SIMILAR_WRITER` — single-sourced, every participant imports them). What is NOT centralized: the **index-membership predicate** and the **dimension source**.

- **[high · conflict]** The stream indexer drops every `timerEffect==='delete'` fact unconditionally (`handler.ts:106`); the reindex worker's embeddable filter checks only `!!e.text` with no timer gate. A full reindex re-embeds and wires `similarTo` over LIVE (unexpired) delete-timer leases/presence rows the stream never admits — leaking into search's authoritative re-read and recall's `relevanceFor` (contested/suggestions re-check and are protected). Admin-only trigger, bounded to live leases. **Fix:** lift the delete-timer exclusion into the shared contract — extend `embeddableText` to take `timerEffect`, or add a shared `shouldIndex(fact)` both writers call.
- **[medium · conflict]** The vector dimension is decided twice: module-level `DIM` in the pure `planStreamWork` uses strict `process.env.VECTOR_EMBEDDER === 'bedrock'`; `vectorsFromEnv` lowercases first. `VECTOR_EMBEDDER=Bedrock` yields `DIM=256` while the embedder is Bedrock(1024) — index-name skew AND an in-indexer dimension mismatch. Latent today (infra pins `VECTOR_DIM='1024'`). **Fix:** drop the module-level `DIM`; thread `vectors.embedder.dimension` into `planStreamWork(event, dim)` as the single source.
- **[low · conflict]** The reindex edges phase re-embeds vectors the embed phase already computed (infrequent backfill only; the hot stream path correctly reuses `putVecs`). **Fix:** add a keyed `get(index, keys[])` to `VectorStore` so reindex reads stored vectors, matching the stream path — or accept the cost with a comment.
- **[low · conflict]** The S3 Vectors filter key names are not shared between `metadataForFact` (write) and search's filter builder (read); a rename would make scoped searches return empty (the re-read cannot recover excluded candidates). **Fix:** export `VECTOR_FILTER_KEYS` from `vectors.ts` and reference on both sides.
- **[info · compounds]** The `similarTo` edge invariants are fully convergent and match live deployment: stream indexer and reindex both call `selectNeighbors` + `refreshSimilarEdges` with identical topK/knobs from `similarConfig()`; all consumers identify inferred edges by the same rel+writer pair. **The model of how the seam should behave** — bring embed-membership and dimension up to this discipline.

## type-render-duality — type resolution across runtime and UI
**Expected core:** projection · **Verdict:** PARTIAL · **Worst:** medium

- **[medium · conflict]** Same rooting contradiction as present-affordance: `resolveLabel` roots `value.text` at the envelope, home's `factTitle` does `pathInto(e.value, label)` → `undefined`; `buildTypeVocabulary` passes `present.label` through unstripped so home silently ignores the label facet for every `value.*` path (~14 declared `value.*` labels; `value.title`/`value.name` rescued by heuristic; `text`/`path`/`id`/`seq`/`status`/`mode`/`node` title as raw keys). Cosmetic title-display bug, roughly half the value.* types. **Fix:** export `resolvePresent`/`resolveLabel` through `@parc/ui` and route `factTitle`+`typeIcon` through it; the kernel's third hand-rolled copy should converge too.
- **[medium · conflict]** SSR first-paint vocab (`buildBoot`, raw `cells.describeTypes`) and client hydration vocab (`loadTypeDecls`, `buildTypeVocabulary` output) are assembled by two different pipelines, contradicting the code comment claiming parity — the SSR seed omits the caller's `_types/` overrides and the additively-resolved present/fields facets. **Fix:** point the SSR read at gateway `$types` (or run `buildTypeVocabulary` in `buildBoot`) so first paint and hydration resolve identical facets.
- **[low · conflict]** `home-next/shared/vocab.ts` is an orphaned sync-copied resolver (older `deriveId` with no null guard, zero importers — all home-next files use `@parc/ui`). Inert dead code. **Fix:** delete `home-next/shared/` and collapse home-next into home.
- **[low · compounds]** The affordance HANDLER contract is defined twice (runtime `Type.handlers` opaque `Record`; UI `vocab.ts` owns interpretation) — the intended present-vs-routing split, works off shared `$types`. **Acceptable**; optionally type `Type.handlers` from a shared `TypeHandler` spec.
- **[info · compounds]** Client fallback tables do NOT shadow `$types`: both cells declare only `cell` (the one platform-pointer type no cell manages) and layer `DEFAULT_TYPE_DECLS` UNDER the `$types`-derived decls. Only nit: a stale fallback `cell` icon. **Leave as the minimal floor.**

## shaping-layers — reducing a fact for display
**Expected core:** projection · **Verdict:** PARTIAL · **Worst:** medium

The present stage is split three ways — dead `resolvePresent`, live `render-hints.ts` (bodies), live `affordancesForTypes` (ships label as an unresolved path) — and each cell re-implements `factTitle`/`bodyText`.

- **[medium · conflict]** `refsMeta` (`shape.ts:57-68`) enumerates a fixed `_meta` field set with `relevance` conditionally spread and `reward` absent, so the refs tier and orient/recall focus band silently drop `reward` (survives only in the whole-`_meta` card tier). A hand-maintained allowlist: any new `_meta` ranking signal vanishes from refs-tier reads unless threaded by hand. (Under default `rewardWeight=0`, dropping it does not distort ranking today.) **Fix:** derive the refs `_meta` slice from `EntryMeta` with a documented drop-list (provenance-only) rather than an allow-list.
- **[medium · conflict]** Four independent reimplementations of "resolve the label path against the fact value": home `factTitle`, home-next (identical), kernel `titleOf` (whose comment says it "mirrors resolveLabel"), and lit (`main.tsx:145`, which genuinely diverges — hardcoded `title||name`, ignoring the declared label path). The type side is already convergent (`resolveType`, `normalizeDecl`); only this one step forks. **Fix:** wire the present stage through one primitive (delegate to `resolveLabel`/`resolvePresent`) or delete `present.ts` as an abandoned abstraction.
- **[low · conflict]** `render-hints.ts BODY_FIELDS` includes `statement`; home/home-next carry LOCAL `bodyText` copies without it; lit imports the shared `bodyText`. (Mechanism nuance: `claim` has no type decl, so the divergence surfaces as lit-shows-prose vs home-shows-raw-JSON, not "shows nothing".) **Fix:** make home/home-next `HintBody` consume the shared `render-hints bodyText`.
- **[low · conflict]** `home` and `home-next` `facts.tsx` (~900 lines) are near-identical forks; the real divergence is intentional security hardening (home-next `SafeMarkdown` vs home's raw `marked.parse(...) dangerouslySetInnerHTML`). **Fix:** factor shared `factTitle`/`bodyText`/`HintBody` into `@parc/ui` or collapse home-next into home.
- **[info · compounds]** The pipeline ORDER is clean and non-overlapping — salience elision → card/refs truncation → present, confirmed composing on one live read. **Keep the three-stage ordering;** the conflicts are WITHIN the present stage and the `_meta` reduction.

## state-store-backends — two StateStore backends against one codec
**Expected core:** fact · **Verdict:** PARTIAL · **Worst:** medium

The `StateRecord`/`EdgeRecord`/`TouchCounters` types + `StateStore` interface are the one shared representation; there is NO single shared round-trip helper — v3 funnels through the codec's field allowlist (`itemToRecord`/`itemToEdge`), the memory store through a structural object spread.

- **[medium · conflict]** The memory store round-trips every field automatically; the v3 codec is a hand-maintained allowlist. A new `StateRecord` field wired through `put()` but not added to the codec is preserved by the memory (test) backend and dropped by the v3 (prod) backend — tests stay green, prod loses the field. **Fix:** add a codec-parity unit test that constructs a fully-populated `StateRecord`/`EdgeRecord`, round-trips through BOTH backends, and asserts deep-equality; cover `EdgeRecord.score` and the drift-prone `reward`/`version`/`as` fields.
- **[medium · conflict]** Touch-counter INCREMENT semantics are implemented twice — memory uses `bumpTouches`/`bumpWindow`; v3 open-codes DynamoDB `ADD` with its own bucket-rollover. Shape shared, rollover logic forked and only coincidentally agreeing. **Fix:** pin the equivalence with a shared test driving the same (actor,op,bucket) sequence including a rollover through both `recordTouch` implementations; reference `bumpWindow` as the canonical spec in a v3 comment.
- **[low · conflict]** Codec header is stale (references a nonexistent `dynamo-state-store.ts` and a "v2 store" that does not exist). **Fix:** update the header to state one Dynamo consumer today (v3) and that the codec exists to keep marshalling unit-testable and to be the parity target the memory store must match.
- **[low · compounds]** `cell-template.ts` re-states the key prefixes (`STATE#`/`TRAJ#`/`SEQ#`/`IN#`/`TYPE#`) as string literals in the LeadingKeys condition rather than importing the codec `key` helpers — coupling by-convention, not by-reference. **Optional:** derive the prefix list from a shared `PARTITION_PREFIXES`.
- **[info · compounds]** `EdgeRecord.score` (cosine, ADR-0032) flows through the codec's conditional mapping and is preserved by the memory spread — both backends agree on the edge shape that ships. **No change.**

## selector-predicate — the one structural match predicate
**Expected core:** projection · **Verdict:** CONVERGENT (with one PARTIAL edge) · **Worst:** medium

- **[info · compounds]** All three primary membership/query/subscription-match sites funnel through the single `matchesSelector` (`selector.ts:36`) — the seam's core is real and shared. Subscription's `keyPrefix→prefix` rename is a thin documented adapter, not a fork.
- **[medium · conflict]** The view-edge derivation path feeds `matchesSelector` a truncated view object and drops a tags-only view at an earlier gate — so a `query:{tags:[...]}` view derives ZERO `inView` backbone edges while `members()` returns its intensional members. **Fix:** extract a shared `selectorFromQuery(q): Selector` carrying all four fields and use it in BOTH the view-edge derivation and the `query()` candidate filter, making View-as-edge ≡ View-as-query by construction.

---

## Cross-seam recommendations (ranked)

1. **Collapse the client present leaf onto one resolver.** One `@parc/ui labelOf`/`iconOf`/`bodyText` that home, home-next, kernel, canvas, and lit all call — fixes present-affordance (high), type-render-duality (medium), and shaping-layers (medium) at once. Either wire `resolvePresent` in as that resolver or delete it and re-point the docs at `resolveType`/`buildTypeVocabulary`.
2. **Collapse the `home`/`home-next` fork.** It is the physical carrier of the present, render-host, and shaping duplication and has already diverged on XSS safety. Upstream home-next's hardening (CSP, SafeMarkdown, safe-URL) into `@parc/ui`, then delete `home-next/shared/`.
3. **Give the whole-graph projection a default bound.** `$graph`/`edges()`/`graph` at corpus scale (edge-shapes high) — cap with a page size + `nextCursor`.
4. **Route write-through through `applicableGrants`.** Makes group + crossSlice write grants actually authorize (authority high, fail-closed).
5. **Single physical origin for change fan-out.** Move the reaction reactor onto the DynamoDB stream (or make `state.put` own the emit) so "a fact changed" can't be forgotten (write-fanout high).
6. **One `shouldIndex(fact)` + one dimension source** for both vector writers (embed-orchestration high).
7. **Codec-parity + touch-rollover tests** so the two StateStore backends can't silently drift (state-store-backends medium).