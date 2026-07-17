## Runtime — Fact Store, State & Trajectory

This subsystem is the platform's **Fact floor**: the monotonic, observed shared state every cell and command reads and writes. It is implemented almost entirely in `platform/runtime/state.ts` (2268 lines), which defines the storage-agnostic `StateStore` port, the `createObservedState()` semantic layer, the salience/shaping/scoring machinery, and the derived graph backbone; plus four thin collaborators: `state-store-codec.ts` (pure item⇄record mapping + DynamoDB key grammar), `dynamo-state-store-v3.ts` (the AWS SDK v3 backend a forge-deployed cell uses), `content-hash.ts` (proof-of-read versioning), `config.ts` (environment plumbing), and `events.ts` (EventBridge Mode-2 emission). The infra anchor is `platform/infra/substrate-table.ts` (one scope-partitioned DynamoDB table, GSIs for inbound edges + typed reads, Streams + PITR).

### Role relative to the cores

Two of the platform's core primitives are *born* here:

- **`fact`** — the keyed `{value, _meta}` row at `(scope, key)` — literally IS `EntryMeta`/`StateRecord`; `put`/`get`/`list`/`supersede` ARE its monotonic, supersede-not-delete, server-stamped semantics. Nearly every other capability here is a compound over that row: CAS guards it, timers bound its lifetime, touch counters decorate it, edges are sibling rows in the same partition, and the trajectory is a TTL-bounded write-shadow of it.
- **`projection` (select → score → shape → present)** — this subsystem is where the pipeline BEGINS. The `score` stage (5-term Salience, `scoreParts`) and the `present` stage (Focus/Peripheral/Elided shaping, `shapeEntries`) live in this file; `select` and `reactivity` are consumed by the workspace handler layer above it. `query`, `members`, `attention`, and the derived backbone are all projection presets over fact rows.

The `cell` axis touches this subsystem through its runtime seams: `config.ts` surfaces the granted substrate-table binding (`SUBSTRATE_TABLE`, distinct from a cell's private `TABLE_NAME`), and `dynamo-state-store-v3.ts` is the on-cell realisation of the store (Node 20 ships AWS SDK v3 ambiently, not v2). `edge-http` does not appear in this subsystem.

> A note on a live gap the deep read surfaced: `workspace.graph` errors "Unhandled" at the deployed edge-query seam while `workspace.edges` (ADR-0069 unified) works. The `graph()`/`edges()` methods here (`state.ts:1948`, `state.ts:1952`) are sound — the fault is in the surface routing above this floor, not in this subsystem.

---

## 1. Located keyed fact (the `{value, _meta}` row)

**What it does.** Every datum is a fact at `(scope, key)`: a stored value wrapped with server-stamped provenance and read-time dynamics. `put(input, identity)` allocates a monotonic per-scope `seq` (`store.nextSeq`), increments a per-`(scope,key)` `revision`, stamps `writer` (`leafActOf(identity) ?? identity.user` — ADR-0024 leaf-act delegation), accretes distinct `writers[]`, preserves `createdAt`/`firstSeq` across rewrites, and optionally records `via` (how) and `as` (which embodied participant, ADR-0086 — provenance, not authority). Omitting `type`/`tags` on a rewrite preserves what is stored (`state.ts:1719-1720`). `get` returns `null` for absent-or-expired keys. The value is never mutated in place — a read wraps the stored record into an `Entry` with a freshly computed score (`wrap`, `state.ts:1510`).

**Public API.**
```ts
interface EntryMeta {
  revision; version; seq; writer; via; as?; createdAt; updatedAt; writers[];
  superseded; supersededBy; type; tags; timer; score; velocity; standing;
  centrality; relevance?; reward?; elided; explain?;
}
interface Entry<V = unknown> { value: V | null; _meta: EntryMeta }
ObservedState.put(input: WriteInput, identity?): Promise<Entry>      // state.ts:1645
ObservedState.get(scope, key, identity?): Promise<Entry | null>       // state.ts:1750
createObservedState(store: StateStore, salience?: SalienceOptions): ObservedState  // state.ts:1450
```

**Data model.** DynamoDB item `pk=STATE#<scope>` `sk=KEY#<key>` (`state-store-codec.ts:17-19`); attributes mirror `StateRecord` (`state.ts:209`): `value, revision, version, seq, firstSeq, writer, via, as, createdAt, updatedAt, writers, superseded, supersededBy, type, tags, timerExpiresAt, timerEffect, seed*/reward`, plus flat `t_*`/`w_*`/`w_b` touch attrs.

**Invariants & edge cases.**
- `revision` is monotonic per `(scope,key)` *even across a lapsed lease* — "physical continuity always" (`state.ts:1702`).
- `seq` is monotonic per scope via `nextSeq` (the trajectory ordinal).
- `writer`/`writers`/`createdAt` are server-stamped, never client-supplied.
- `scope` = the authority boundary = IAM principal. The partition prefix `STATE#<scope>` IS that boundary.
- A write to a superseded key REVIVES it (`superseded: false`, `state.ts:1716`).

**Reduces to.** This IS the `fact` primitive — its constitution, not a compound. `EntryMeta` (`state.ts:51`) and `StateRecord` (`state.ts:209`) are the two faces of the same row; `put()` is where monotonicity, server-stamping and supersede-revival are enforced.

**Connections.** Consumed by every command in `services/workspace/*`; provenance types come from `./auth` (`Identity`, `leafActOf`, `actorOf`); `version` from `content-hash`.

**Motivating ADRs.** ADR-0013 (observed state / supersede-not-delete), ADR-0024 (leaf-act delegation), ADR-0086 (participant `as` provenance), ADR-0007 (substrate table).

---

## 2. Supersede-not-delete retirement

**What it does.** Knowledge accretes; a fact is retired by pointing it at a successor, never erased. `supersede(scope, key, by, identity, {migrateLinks})` (`state.ts:2160`) rewrites the record with `superseded=true` and `supersededBy=by`, folds a write touch, and appends a `supersede` trajectory event. A fresh `put` to a superseded key revives it. With `migrateLinks` + `by` it re-points every inbound and outbound edge onto the successor (delete + re-put, skipping self-edges, `state.ts:2180-2190`), so retiring a fact doesn't orphan its graph. Superseded entries are hidden from default reads but returned by `getMany` (the `_meta.superseded` marker is the tombstone) and by `includeSuperseded` reads.

**Public API.**
```ts
ObservedState.supersede(scope, key, by, identity?, opts?: { migrateLinks? }): Promise<Entry | null>
interface SupersedeOptions { migrateLinks? }
ObservedState.getMany(scope, keys[]): Promise<Record<string, Entry | null>>   // state.ts:1771
```

**Data model.** Same fact item, `superseded=true` + `supersededBy` set. A dangling successor (missing or retired-without-successor) is surfaced by `attention().dangling`, not blocked.

**Invariants & edge cases.**
- Nothing is lost except an explicit expired-`delete` timer.
- A fresh write revives a superseded key.
- `migrateLinks` requires a successor `by` (no-op otherwise); self-edges (`e.to === by` / `e.from === by`) are dropped rather than re-created.

**Reduces to.** `fact` — retirement is a normal monotonic write that flips two fields; edge migration reuses `putEdge`/`deleteEdge` over sibling rows.

**Connections.** `attention` reports dangling successors; `getMany` is the ADR-0055 batched read used by the change feed.

**Motivating ADRs.** ADR-0013.

---

## 3. Conditional writes / CAS (`ifRevision`, `ifAbsent`, `ifVersion`) with atomic store guard

**What it does.** Multi-writer coordination is safe via optimistic preconditions checked against the LIVE view — an expired-`delete` lease counts as absent (the crash-safe claim, `state.ts:1657`). `put()` fails fast on `ifAbsent` (key must not exist), `ifRevision` (stored revision must equal), and `ifVersion` (stored content-hash must equal; `""` = create-only). A failed precondition throws `StatePreconditionError` (→ HTTP 409). The remaining race window is closed atomically at the store: when any CAS is present, `put` passes a `PutGuard{expectRevision}` that the DynamoDB backend renders as a `ConditionExpression` (`attribute_not_exists(pk)` for null, else `revision = :rev`, `dynamo-state-store-v3.ts:124-131`); a `ConditionalCheckFailedException` is mapped back to `StatePreconditionError`.

**Public API.**
```ts
WriteInput { ifRevision?; ifVersion?; ifAbsent? }
class StatePreconditionError { code = 'precondition_failed' }   // state.ts:156
interface PutGuard { expectRevision: number | null }             // state.ts:382
StateStore.put(record, guard?: PutGuard): Promise<void>
```

**Data model.** No new attributes; the guard is a DynamoDB `ConditionExpression` at write time. The memory store replicates the revision check for parity (`state.ts:2220-2226`).

**Invariants & edge cases.**
- CAS is evaluated against the timer-live view (expired-`delete` = absent).
- The two-phase check (primitive read-then-guard) closes the TOCTOU window atomically.
- `ifVersion=""` asserts absence.
- The guard is only attached when `hasCas` is set (`state.ts:1743`), so ordinary writes pay no conditional-expression cost.

**Reduces to.** `fact` — a guard over the fact write: semantic CAS in the primitive plus a physical revision guard at the store.

**Connections.** Consumes content-hash versioning (capability 4); the DynamoDB backend (`dynamo-state-store-v3.ts`) is where the physical guard lands.

**Motivating ADRs.** ADR-0066 (proof-of-read `ifVersion`).

---

## 4. Content-hash proof-of-read versioning (`ifVersion` token)

**What it does.** `version` is a 16-hex-char (8-byte SHA-256) content hash of a fact's value — an UNFORGEABLE proof-of-read token (unlike a guessable revision counter). It is persisted on every native write (`state.ts:1700`) so a read can hand it out and a later `ifVersion` write can demand it back, making a read a precondition of a write. Facts written before ADR-0066 lack a stored version; reads compute it on the fly via `contentHash(value)` (`state.ts:1546`) and the next write persists it. CAS hashes the live stored value with the same function so the token agrees with the read that produced it (`state.ts:1676`).

**Public API.**
```ts
contentHash(value: unknown): string   // content-hash.ts:16 — 16 hex chars of SHA-256
EntryMeta.version
StateRecord.version?
WriteInput.ifVersion?
```

**Data model.** Persisted item attribute `version`; `itemToRecord` carries it only when present (`state-store-codec.ts:84`).

**Invariants & edge cases.**
- Same stored value always hashes the same (canonical serialization not required for correctness — the hash is compared persisted-to-supplied).
- String values hash raw; others via `JSON.stringify(value ?? null)` (`content-hash.ts:17`).
- An absent version on a legacy fact is recomputed, never fatal.

**Reduces to.** `fact` — a derived, persisted attribute of the fact value; the CAS capability consumes it.

**Connections.** Feeds CAS (capability 3); `EntryMeta.version` is surfaced on every read.

**Motivating ADRs.** ADR-0066.

---

## 5. Per-fact timers — lease / reveal with read-time liveness and TTL GC

**What it does.** A fact may carry a timer evaluated LAZILY at read (no scheduler — sync's model). `effect:'delete'` = live now and vanishes at expiry (a lease / visibility-timeout: a claim that auto-disappears so work reappears — the only deliberate exception to "nothing is lost"). `effect:'enable'` = dormant until expiry then live (scheduled reveal / cooldown). `isTimerLive(rec, nowMs)` (`state.ts:185`) computes liveness; `get`/`read`/`query`/`neighbors`/`members` all filter on it, and CAS treats an expired-`delete` fact as absent. `resolveTimer` (`state.ts:191`) accepts exactly one of `ms`|`at`. For a `delete` timer the DynamoDB backend also sets a native `ttl` attribute (expiry + 24h grace, `dynamo-state-store-v3.ts:120-122`) so DynamoDB eventually GCs the row.

**Public API.**
```ts
interface FactTimer { ms?; at?; effect: 'delete' | 'enable' }   // state.ts:176
isTimerLive(rec, nowMs): boolean                                 // state.ts:185
WriteInput.timer?
EntryMeta.timer
```

**Data model.** Item attrs `timerExpiresAt` (ISO) + `timerEffect`; for `delete` timers, native `ttl = floor(expiry/1000) + 24*60*60`. Table `timeToLiveAttribute='ttl'` (`substrate-table.ts:50`).

**Invariants & edge cases.**
- A timer requires exactly one of `ms`|`at` (`state.ts:194` throws otherwise); `ms` must be positive.
- No scheduler — liveness is a read-time computation.
- Expired-`delete` = absent for both reads and CAS.
- DynamoDB TTL GC is best-effort cleanup, not the semantic authority (the 24h grace guarantees reads already treat the row as gone well before the physical delete).

> ⚠ **Coherence (edge-shapes · PARTIAL · medium · conflicts).** The timer-liveness filter is applied inconsistently across the four edge/graph derivation paths. `graph()` (`state.ts:1955`) and `members()` (`state.ts:1980`) pre-filter records with `!r.superseded && isTimerLive(r, nowMs)` before `deriveBackboneEdges`; but `neighbors()` (`state.ts:1928-1931`) calls `deriveBackboneEdges(records, …)` over the *unfiltered* list, and `deriveBackboneEdges` itself only filters on `superseded` (`state.ts:1018`), never `isTimerLive`. `signalsFor` (`state.ts:1471`) likewise feeds the unfiltered list, so structural/centrality signals count dormant-fact backbone in ALL read paths. Real divergence, but bounded to the window between a timer fact going dormant and a reaping pass superseding it. **Recommendation:** collapse the four call sites onto one `edgeSet(scope, {typeRules})` helper that applies a single liveness policy (`superseded` + `isTimerLive`) before `deriveBackboneEdges` — the "separable follow-on" the ADR-0069 comment at `commands-graph.ts:41-43` already names.

**Reduces to.** `fact` — a lifetime bound on the row: two persisted fields plus a pure liveness predicate, not a separate scheduling primitive.

**Connections.** CAS crash-safe claim (capability 3); DynamoDB native TTL (`substrate-table.ts`).

**Motivating ADRs.** ADR-0013.

---

## 6. StateStore port + interchangeable backends (DynamoDB v3, in-memory) + shared codec

**What it does.** The storage contract is an injected `StateStore` interface (`state.ts:386`): `nextSeq`/`currentSeq`/`get`/`put`/`list`/`listByType`/`putEdge`/`deleteEdge`/`edgesFrom`/`edgesTo`/`listEdges`/`appendTrajectory`/`recentTrajectory`/`recordTouch`. Semantics live in `createObservedState`; storage is swappable. `createDynamoStateStoreV3(tableName)` (`dynamo-state-store-v3.ts:65`) is the AWS SDK v3 backend a forge-deployed cell uses — the SDK is lazy-`require`d inside the factory (never a top-level import) so importing the module costs nothing. `createMemoryStateStore()` (`state.ts:2199`) ships for tests/local. Both marshal through `state-store-codec.ts`, the PURE item⇄record mapping + key grammar, extracted so the mapping is unit-testable without a DynamoDB client. `stripUndefined` (`state-store-codec.ts:131`) guards against the v2 marshaller's silent-failure trap.

**Public API.**
```ts
interface StateStore { nextSeq; currentSeq; get; put; list(scope, keyPrefix?);
  listByType; putEdge; deleteEdge; edgesFrom; edgesTo; listEdges;
  appendTrajectory; recentTrajectory; recordTouch }
createDynamoStateStoreV3(tableName): StateStore
createMemoryStateStore(): StateStore
key = { statePk, factSk, edgeSk, trajPk, seqPk, inPk, inSk, typePk, trajSk }   // codec:17
itemToRecord(item): StateRecord      // codec:77
itemToEdge(item): EdgeRecord         // codec:110
itemToTouches(item) / touchesToItem(rec)
stripUndefined<T>(v): T
```

**Data model.** One `SubstrateTable`: `pk`/`sk`, `PAY_PER_REQUEST`, TTL on `ttl`, Streams `NEW_AND_OLD_IMAGES`, PITR (`substrate-table.ts:45-56`). Facts `pk=STATE#<scope>` `sk=KEY#<key>`; edges `sk=EDGE#<from>|<rel>|<to>`; trajectory `pk=TRAJ#<scope>` `sk=<iso>#<seq(12)>`; seq `pk=SEQ#<scope>` `sk=A`; grants `pk=GRANT#`/`GRANTBY#`. GSIs: `gsi-in` (`gsi1pk=IN#<scope>#<to>`, `gsi1sk=<rel>|<from>`), `gsi-type` (`gsi2pk=TYPE#<scope>#<type>`, `gsi2sk=<updatedAt>`). `pk` repeats scope so IAM `dynamodb:LeadingKeys` covers base + index reads.

**Invariants & edge cases.**
- Semantics never live in a backend; a backend only marshals + queries.
- The runtime must not force the AWS SDK at import time (lazy `require`, `dynamo-state-store-v3.ts:69-70`).
- `queryAll` paginates `LastEvaluatedKey` to completion (`dynamo-state-store-v3.ts:76-85`).
- The v3 write does `const { touches, window, ...fields } = record` (spreads ANY new field) but the read goes through `itemToRecord` (an explicit allowlist) — a write/read asymmetry (see coherence below).

> ⚠ **Coherence (state-store-backends · PARTIAL · medium · conflicts).** The memory store round-trips EVERY `StateRecord` field by structural spread (`state.ts:2216`, `2227`), while the v3 store's codec `itemToRecord` (`state-store-codec.ts:77`) is a hand-maintained 23-field allowlist. A new `StateRecord`/`EdgeRecord` field wired through `put()` but not added to the codec is preserved by the memory (test) backend and dropped by the v3 (prod) backend — tests stay green while prod loses the field. **Recommendation:** add a codec-parity unit test that constructs a fully-populated `StateRecord`/`EdgeRecord`, round-trips it through both `createMemoryStateStore` and `itemToRecord(touchesToItem(...))`, and asserts deep-equality, so any unlisted field fails CI. Cover `EdgeRecord.score` explicitly — it is a conditional-mapping field like the drift-prone `reward`/`version`/`as`.

> ⚠ **Coherence (state-store-backends · PARTIAL · low · conflicts).** The codec header (`state-store-codec.ts:5-9`) is stale: it references "the item shapes documented in `dynamo-state-store.ts`" (no such file — only `dynamo-state-store-v3.ts` exists) and "the v2 store keeps its inline copy for now" (no v2 store exists). **Recommendation:** update the header to state the codec has one Dynamo consumer today (v3) and exists to keep the marshalling unit-testable and be the parity target the memory store must match.

**Reduces to.** `fact` — the persistence seam for the fact primitive (mirrors how `auth` separates `AuthStore` from backends). The v3 backend is the on-`cell` realisation that lets cell-axis code run this read pipeline.

**Connections.** `cell` axis (v3 backend, `SubstrateTable.grantReadWrite`); `substrate-table.ts` infra.

**Motivating ADRs.** ADR-0042 (platform-SDK-for-cells), ADR-0007.

---

## 7. Read-time salience scoring (5 computed signals + relevance + reward, type priors)

**What it does.** Reads are scored, not measured. `computeScore`/`scoreParts` (`state.ts:765`, `773`) blend five ambient signals: **recency** (exp decay, 7d half-life), **velocity** (recent writes in the burst window), **attention** (recent reads), **standing** (saturating log of lifetime reads+writes, so an idle-but-loved fact keeps a floor), and **centrality** (saturating log of weighted graph degree). Two per-read signals layer on: **relevance** (cosine to a caller `text`, ADR-0051) and **reward** (persisted earned salience, ADR-0070, default weight 0). A per-type PRIOR (ADR-0050) multiplies only the AMBIENT terms (`state.ts:800`) so plumbing types (canvas-placement, log, machine-run) stop competing with knowledge in a goal-less read, while relevance/reward ride un-prioered so a stated intent lifts a demoted type at full strength (ADR-0052). `round4` keeps figures as signals; `explain` attaches the full signal/weight/contribution breakdown (`explainScore`, `state.ts:1574`).

**Public API.**
```ts
computeScore(args, s): number                                   // state.ts:765
scoreParts(args, s): ScoreParts                                 // state.ts:773
interface SalienceOptions { halfLifeMs?; windowMs?; *Saturation?; *Weight?;
  typePriors?; focusThreshold?; elideThreshold? }               // state.ts:428
interface ScoreExplain { signals; weights; contribution; degree; prior }  // state.ts:108
buildSignals(events, edges, nowMs, windowMs): Map<string, KeySignals>     // state.ts:813
touchSignals(rec, nowMs, s)                                     // state.ts:716
```

**Data model.** No stored score — computed per read from `updatedAt` + touch/window counters + edge degree. Default weights (`state.ts:505-509`): recency .35, velocity .1, attention .15, standing .3, centrality .1. Default saturations: standing 20, centrality 50; half-life 7d, window 1h.

**Invariants & edge cases.**
- Default ambient weights sum to ≤1 so score stays in `[0,1]` and tiers keep meaning.
- The type prior scales only ambient terms; relevance + reward ride unprioered (`state.ts:806-807`).
- Prior capped at `TYPE_PRIOR_MAX = 2` (a bias, not a bypass, `state.ts:564`).
- Score is never persisted per fact.
- `standing`/`centrality` are log-compressed (`log1p`) so a hub can't run away to a pinned 1.

**Reduces to.** `projection` + `fact` — this is the SCORE stage of the projection pipeline, computed over fact rows. Inputs are the fact's own persisted counters + graph degree (so scoring *compounds on* fact), but the capability itself is a projection stage.

**Connections.** Reads its inputs from actor-classed touch counters (capability 10) and the derived backbone (capability 12); feeds shaping (capability 8) and query ranking (capability 13).

**Motivating ADRs.** ADR-0050 (touch counters + type priors), ADR-0051 (relevance), ADR-0052 (intent lifts demoted types), ADR-0070 (reward), ADR-0009 (weighted centrality).

---

## 8. Salience shaping into Focus / Peripheral / Elided tiers with attention-proportional elision

**What it does.** A shaped read tiers scored entries (`tierFor`, `state.ts:853`; `shapeEntries`, `state.ts:1615`): score ≥ `focusThreshold` (0.5) → focus, ≥ `elideThreshold` (0.1) → peripheral, else elided. Below the elide threshold the ENTRY (not just its value) is withheld and collapses to an `ElidedStub {key, type, score}` so a bounded observer pays attention proportional to what surfaces; `expand`/`peek` pull the full entry back, `elision:'none'` disables it. `shape()` (`state.ts:1787`) re-tiers an already-scored set (own slice + granted subsets merged) once, so recall can assemble a cross-scope view and shape it under the VIEWER's policy. Every shaped read returns a `_shaping` summary with thresholds, lens, and focus/peripheral/elided/total counts.

**Public API.**
```ts
ObservedState.read(scope, opts?, identity?): Promise<ReadResult>   // state.ts:1794
ObservedState.shape(entries, opts?): ReadResult                     // state.ts:1787
interface ReadResult { entries; elided?; _shaping }                 // state.ts:148
interface ShapingSummary { focusThreshold; elideThreshold; elision; lens?; counts }
interface ElidedStub { key; type; score }                           // state.ts:142
ReadOptions { elision?; expand?; includeSuperseded?; focusThreshold?;
  elideThreshold?; lens?; salience?; explain?; salienceConfig?;
  lensesConfig?; typeRules?; relevance? }                           // state.ts:1181
```

**Data model.** Read-time only.

**Invariants & edge cases.**
- Elided entries collapse to a stub (value AND meta withheld) unless expanded (`state.ts:1628-1632`).
- `shape()` is pure — never mutates its input.
- `read()` itself records no touch (a scope-wide read is not per-fact attention, ADR-0050, `state.ts:1805`).
- Stubs are sorted score-descending (`state.ts:1636`).

> ⚠ **Coherence (shaping-layers · PARTIAL · info · compounds).** The three shaping stages compose cleanly and non-overlapping in sequence: salience elision (which entries survive, `state.ts:1615`) → card/refs truncation (how much of each value ships, `services/workspace/commands-read.ts:592`) → present (how to draw it, `services/workspace/shared.ts:115`). Keep the three-stage ordering; it is the one correct composition.

**Reduces to.** `projection` — the PRESENT stage (Affordance/attention shaping) over scored fact rows: the tiering + elision half of `read()`/`recall`.

**Connections.** Consumes scoring (capability 7); recall (in the workspace handler layer) is the primary consumer of `shape()`.

**Motivating ADRs.** ADR-0004 (projection), ADR-0006 (reactive shaping), ADR-0050 (reads-are-free).

---

## 9. Salience configuration & lenses (per-scope re-tuning without redeploy)

**What it does.** The resolution order for a read's salience params is: instance defaults ← scope `_config/salience` fact ← named lens ← per-call override (`callSalience`, `state.ts:677`). A fact at reserved key `_config/salience` whose value is a `Partial<SalienceOptions>` re-tunes that owner's own recall/query shaping live; `parseSalienceConfig` (`state.ts:574`) is defensive (only known numeric fields survive, non-finite/negative dropped, thresholds clamped to `[0,1]`, priors capped) so a config fact can never break a read. Five compiled lens presets (`salience`/`recent`/`connected`/`durable`/`active`, `state.ts:636`) are the un-shadowable FLOOR; `_config/lenses` declares additional named presets (`parseLensesConfig`, `state.ts:608`, ADR-0078). `INTENT_PRESET` (`state.ts:662`) is the weight shift applied when a read states `text` (relevance leads). A lens recomputes the score so it shifts both ranking AND tiers, unlike `rankBy` which only reorders.

**Public API.**
```ts
const SALIENCE_CONFIG_KEY = '_config/salience'   // state.ts:528
const LENSES_CONFIG_KEY = '_config/lenses'        // state.ts:539
parseSalienceConfig(value): Partial<SalienceOptions> | null
parseLensesConfig(value): Record<string, Partial<SalienceOptions>> | null
type SalienceLens = 'salience' | 'recent' | 'connected' | 'durable' | 'active'
INTENT_PRESET
ObservedState.salienceConfig(scope)    // state.ts:1872
ObservedState.lensesConfig(scope)      // state.ts:1876
```

**Data model.** Two reserved fact keys in the `_config/*` namespace (system plumbing, excluded from tending). Loaded best-effort at read (`loadSalienceConfig`/`loadLensesConfig`, `state.ts:1479-1499`): missing/retired/malformed ⇒ `null` → instance defaults.

**Invariants & edge cases.**
- A config fact must never break a read (defensive parse, null-safe fallback).
- The compiled lens floor is never shadowable by a declared lens (`state.ts:618`, `683`).
- An unknown lens name is ignored, never fatal.
- A raw per-call override is NOT auto-normalized (the caller owns the weights, `state.ts:684-685`).

**Reduces to.** `fact` + `projection` — configuration is itself stored as facts (`_config/salience`, `_config/lenses`), the substrate-native config seam (so config reduces to fact); its EFFECT is on the projection score/present stages.

**Connections.** Consumes scoring (capability 7) and the fact row (capability 1); recall passes the viewer's config into `shape()`.

**Motivating ADRs.** ADR-0078 (declared lenses), ADR-0050, ADR-0051, ADR-0070.

---

## 10. Actor-classed touch counters (attention as a counter increment, not a write)

**What it does.** Attention is recorded as ONE conditional counter increment, not a seq allocation + trajectory event — so a read no longer serializes on the write path or manufactures trajectory the scorer must scan (ADR-0050). `recordTouch(scope, key, actor, op, bucket)` does a single DynamoDB `ADD` bumping the lifetime counter (`t_*`) and the current burst-window bucket (`w_*` + `w_b`) together (`dynamo-state-store-v3.ts:248-283`); a rolled-over bucket resets the window; an absent fact is a silent no-op (attention on nothing). Actors are classed platform/agent/human (auth-stamped `identity.actor`, ADR-0022 mediation-aware, else by principal name — `actorClassOf`, `state.ts:286`) and weighted (human 1, agent 0.25, platform 0) so machinery churn stops manufacturing salience. `touch()` (`state.ts:1763`) exposes the bare bump (no read) — the capability-salience wire rides this: invoking a verb touches its `_caps/<target>` fact so used capabilities rise through recall.

**Public API.**
```ts
StateStore.recordTouch(scope, key, actor, op, bucket): Promise<void>
ObservedState.touch(scope, key, identity?, op?): Promise<void>   // state.ts:1763
actorClassOf(principal)   // state.ts:286
actorOf(identity)         // state.ts:294
bumpTouches / bumpWindow / touchKey    // state.ts:321,327,316
interface TouchCounters { hr?; hw?; ar?; aw?; pr?; pw? }          // state.ts:301
interface TouchWindow extends TouchCounters { b }
touchAttr / windowAttr / WINDOW_BUCKET_ATTR   // codec:40-43
```

**Data model.** Flat top-level item attrs `t_hr`/`t_hw`/…/`t_pw` (lifetime), `w_hr`/…/`w_pw` (current bucket), `w_b` (bucket ordinal). Flat because DynamoDB `ADD` only bumps top-level attrs. A write folds its own touch into the rewritten record (`state.ts:1740-1741`); a read is a standalone `ADD`.

**Invariants & edge cases.**
- A read is one `ADD`, no seq / no trajectory event (reads are free).
- An absent fact ⇒ silent no-op (conditional `attribute_exists(pk)`, `dynamo-state-store-v3.ts:260`, `280`).
- The burst window bucket = `floor(now / windowMs)` on the INSTANCE `windowMs` (`bucketOf`, `state.ts:1612`) so writer and reader agree on boundaries regardless of per-call lenses.
- Platform touches weight 0 by default.

> ⚠ **Coherence (state-store-backends · PARTIAL · medium · conflicts).** Touch-counter INCREMENT semantics are implemented twice. The memory store uses the pure shared helpers `bumpTouches`/`bumpWindow` (`state.ts:2263-2264`); the v3 store open-codes the equivalent as DynamoDB `ADD` UpdateExpressions with its own bucket-rollover reset (`dynamo-state-store-v3.ts:259-277`). The shape is shared (`TOUCH_KEYS`/`touchAttr`/`windowAttr`) but the rollover/increment LOGIC is forked and only coincidentally agrees. **Recommendation:** the atomic server-side `ADD` cannot literally call the JS helper, so pin the equivalence with a shared test that drives the same `(actor, op, bucket)` sequence — including a bucket rollover — through both `recordTouch` implementations and asserts identical resulting `touches`/`window`; reference `bumpWindow` as the canonical spec in a comment.

**Reduces to.** `fact` — durable decoration on the fact row (flat `t_*`/`w_*`/`w_b` attrs), bumped atomically. Replaces the old trajectory-scan for lifetime/window terms; feeds scoring but is stored as fact state.

**Connections.** Feeds scoring (capability 7); consumed by the capability-salience wire and the workspace `touch` verb.

**Motivating ADRs.** ADR-0050, ADR-0022 (mediation-aware actor class), ADR-0085 (usage signal).

---

## 11. Trajectory write-shadow & change feed

**What it does.** A trajectory event is appended on write/supersede/link/unlink (`appendTrajectory`) — a WRITE ledger, kept only so `changes` can tail it; salience no longer scans it (counters superseded that). `recentTrajectory` reads events at/after an epoch. `changes(scope, sinceSeq|'head', limit?, last?, filter?)` (`state.ts:2052`) tails from a seq: `'head'` returns just the current seq (start tailing in one call); `limit` pages forward, `last` keeps the newest n (recent-activity window, ADR-0048); a `ChangesScope` filter (prefixes/ops) drops out-of-scope events server-side BEFORE windowing so `last:n` means the newest n RELEVANT events, and link/unlink events carry `rel`+`to` so edges INTO a slice are in scope (ADR-0055). The returned head seq stays global so an empty filtered page + advanced seq is progress, not silence.

**Public API.**
```ts
StateStore.appendTrajectory(event): Promise<void>
StateStore.recentTrajectory(scope, sinceMs): Promise<TrajectoryEvent[]>
ObservedState.changes(scope, sinceSeq, limit?, last?, filter?): Promise<ChangesResult>
interface TrajectoryEvent { op; scope; key; at; seq; rel?; to? }   // state.ts:350
interface ChangesScope { prefixes?; ops? }                          // state.ts:370
const TRAJECTORY_TTL_SEC = 24 * 60 * 60   // codec:32
```

**Data model.** `pk=TRAJ#<scope>` `sk=<iso>#<seq padded 12>` (`codec:26`); item `op`/`scope`/`key`/`rel`/`to`/`at`/`seq` + `ttl = floor(at/1000) + TRAJECTORY_TTL_SEC` (`dynamo-state-store-v3.ts:225`). TTL bounds only how far back `changes` reaches (24h).

**Invariants & edge cases.**
- Trajectory is a write ledger; reads are NOT appended (ADR-0050).
- `seq` rises with time so time-order = seq-order (`state.ts:2071`).
- Filter is applied before windowing; head seq stays global.
- 24h TTL keeps the partition small.

> ⚠ **Coherence (write-fanout · PARTIAL · high · conflicts).** There is NO fan-out chokepoint for the logical change event. `state.put()` appends the trajectory (`state.ts:1746`) but does NOT emit `workspace.fact.written` — `state.ts` is the pure store layer with no `ctx.events` access. Every write path re-emits the event by hand (~13 sites across `commands-write.ts`, `commands-declared.ts`, `event-handlers.ts`); no shared `putAndEmit`/`announceWrite` helper exists. A new write path that forgets the emit silently breaks reactions/subscriptions/machines while the trajectory, seq-feed, analytics-mirror and vector-index paths keep working (they ride the DynamoDB stream + in-`put` `appendTrajectory`, not the event). **Recommendation:** make `state.put`/`state.supersede` own the announcement (emit inside the write, or return a to-announce descriptor a single caller emits), OR move the reaction reactor onto the DynamoDB stream so "a fact changed" has exactly one physical origin.

> ⚠ **Coherence (write-fanout · PARTIAL · medium · conflicts).** Two parallel "a fact changed" propagation mechanisms are selected inconsistently: the physical DynamoDB stream (two `DynamoEventSource` consumers — vectorIndexer `lib/platform-stack.ts:206`, archiver `:240`, both `StartingPosition.LATEST`) fans out automatically to indexer/archiver, while the reaction path (`FactReactionRoute`, `platform-stack.ts:269`) is an EventBridge rule on the logical `workspace.fact.written` event emitted via `events.ts` `putEvents`. No shared helper unifies them. **Recommendation:** adopt the stream as the canonical fan-out for reactions too, collapsing `workspace.fact.written` into a stream-derived signal — one origin for all consumers.

> ⚠ **Coherence (write-fanout · PARTIAL · low · conflicts).** `appendTrajectory` is coupled across `put` (`state.ts:1746`) AND `link`/`unlink`/`supersede` (`state.ts:1898`/`1916`/`2177`) — the single-origin write lane is broader than just `put`, still confined to store methods. The `changes()` feed is pull-only (no reactor rides it; internally consumed only by `attention()` via `recentTrajectory` at `state.ts:2118`). **Recommendation:** document trajectory / `fact.written` / the DynamoDB stream as one logical "change propagation" seam with a single origin, since a reader must currently know which of three mechanisms carries which behaviour.

**Reduces to.** `fact` + `projection` — a TTL-bounded shadow of fact writes ("the log is implementation"); `changes()` is a select over the change-stream (the reactivity face of the projection pipeline), which is why the primitive lists trajectory as part of `fact`.

**Connections.** `attention` reads it internally; the workspace `changes` command and subscriptions consume it.

**Motivating ADRs.** ADR-0055 (server-side scoped feed), ADR-0048 (recent-activity `last:n`), ADR-0050.

---

## 12. Typed edges, inbound index & derived structural backbone

**What it does.** Facts link via typed directed edges (`from --rel--> to`) within a scope, with graded strength and an inbound index. `link()` (`state.ts:1880`) stamps the edge, appends a `link` event, and touches the source; edge parts must be non-empty and free of the `|` sort-key delimiter (`assertEdgePart`, `state.ts:1445`). `edgesTo` uses `gsi-in` for the inbound direction. Because authored edges are sparse, `deriveBackboneEdges` (`state.ts:1014`) synthesizes VIRTUAL, non-persisted edges at read time from fields facts already carry: `instanceOf` (fact → `_types/<type>`, emitted even when the anchor isn't materialised — the floor for every typed fact), `managedBy` (type → its cell), `rendersWith` (type → `_renderers/<type>`), `inView` (fact → any `_views/<id>` whose query selects it), plus declared Reference rules (ADR-0003): embedded `ref` fields (0.6) and key-encoded edges parsed from the fact's `keyPattern` (with a value-field fallback after the 2026-07-12 lit nested-slug incident, `state.ts:1105-1120`). Strengths grade authored 1.0 > embedded 0.6 > membership 0.4 > structural 0.2, and centrality is weighted degree.

**Public API.**
```ts
ObservedState.link(scope, from, rel, to, strength, identity?): Promise<LinkResult>   // state.ts:1880
ObservedState.unlink(...)                                    // state.ts:1910
ObservedState.neighbors(scope, key, opts?): Promise<NeighborsResult>   // state.ts:1920
ObservedState.graph(scope, opts?): Promise<{ edges: AnnotatedEdge[] }> // state.ts:1952
ObservedState.members(scope, key, opts?): Promise<MembersResult>
ObservedState.edges(scope): Promise<EdgeRecord[]>            // state.ts:1948
deriveBackboneEdges(records, typeRules?): AnnotatedEdge[]     // state.ts:1014
extractTypeRules(t): TypeRules                                // state.ts:936
const BACKBONE_RELS / MEMBERSHIP_RELS / EDGE_DELIM
interface EdgeRecord { scope; from; rel; to; strength; createdAt; writer; score? }  // state.ts:333
```

**Data model.** Edge item `pk=STATE#<scope>` `sk=EDGE#<from>|<rel>|<to>`, `gsi1pk=IN#<scope>#<to>` `gsi1sk=<rel>|<from>`. `strength` fixed; `score` = raw cosine for inferred `similarTo` (ADR-0032). Derived edges are timeless (`createdAt: ''`, `writer: null`) and flagged `derived: true`.

**Invariants & edge cases.**
- Edge parts non-empty and must not contain `|`.
- Derived edges are timeless, `derived: true`, never persisted.
- `instanceOf` emits without a materialised anchor (`push(..., false)`, `state.ts:1076`); other backbone edges require the target to exist (`present.has(to)`), so they never dangle.
- Centrality uses weighted degree so authored evidence outweighs plumbing (`buildSignals`, `state.ts:845-849`).

> ⚠ **Coherence (edge-shapes · PARTIAL · info · compounds).** The four edge value-shapes reduce to ONE store primitive: every persisted edge is an `EdgeRecord` written through `StateStore.putEdge`/`listEdges`; `AnnotatedEdge` (`state.ts:988`) is `EdgeRecord` + a read-only `derived` flag; `ThinEdge` (`services/workspace/shape.ts:129`) and the gateway-client `Edge` (`services/gateway/client/main.ts:71`) are structural trims of that same shape. There is no second edge store — no change needed.

> ⚠ **Coherence (edge-shapes · PARTIAL · info · compounds).** `similarTo` inferred edges match the live deployment byte-for-byte: fixed `strength: 0.3` (`platform/runtime/vectors.ts:171`), `score` = raw cosine, `writer = platform/vectors`. Source and ground-truth agree — no change needed.

> ⚠ **Coherence (edge-shapes · PARTIAL · low · conflicts).** `KeyEdgeRule` (`state.ts:915`) and `KeyEdge` (`platform/runtime/type-schema.ts:158`) are byte-identical interfaces (`{from; rel; to}`) bridged by duck typing at `state.ts:943` (`r.keyEdges = t.shape.keyEdges`), with no shared import. Pure duplication, no runtime defect. **Recommendation:** delete `KeyEdgeRule` and import `KeyEdge` from `type-schema` (or re-export it) so the rule shape has one definition.

**Reduces to.** `fact` + `projection` — authored edges are sibling fact rows in the same partition (`EDGE#` sort key), so the graph reduces to `fact`; the DERIVED backbone reduces to `projection` (a pure read-time synthesis over `_types`/`_views`/`cell`/type-rule facts, never materialised).

**Connections.** Feeds centrality in scoring (capability 7); `members` and `attention` consume the derived backbone; `./selector` (`matchesSelector`), `./resolution` (`layer`), `./type-schema` (`resolveType`) are collaborators.

**Motivating ADRs.** ADR-0003 (References), ADR-0009 (graded strength / weighted centrality), ADR-0005 (collection membership), ADR-0057 (generic `memberOf`), ADR-0032 (inferred `similarTo`), ADR-0069 (unified edge surface).

---

## 13. Query projection (indexable type/tag/prefix/contains, rankBy, paging)

**What it does.** `query()` (`state.ts:1817`) is a projection over the slice: `type` is index-served (`listByType` via `gsi-type`), `tag`/`tags`/`prefix` filter the candidate set through the shared `matchesSelector` predicate, and `contains` does a case-insensitive substring scan over key + value JSON (`recordContains`, `state.ts:1267`) to find a fact by what's inside it. Results rank by salience (default), recency (last-write), or relevance (ADR-0085 Inc 3 — cosine first, salience tiebreak, dropping the no-relevance tail; the default when a relevance map is present). Paging is a plain offset cursor into a fresh ranking (best-effort resume, honest about reordering). `listByType` is GSI-backed in production; query reuses the full-partition read for signals when there is no type filter to avoid a duplicate scan (`state.ts:1823-1827`).

**Public API.**
```ts
ObservedState.query(scope, opts?, identity?): Promise<QueryResult>   // state.ts:1817
interface QueryOptions { type?; tag?; tags?; prefix?; rankBy?; lens?; salience?;
  explain?; limit?; cursor?; includeSuperseded?; contains?; typeRules?; relevance? }  // state.ts:1223
interface QueryResult { entries; count; total; nextCursor? }         // state.ts:1276
recordContains(rec, needle): boolean
StateStore.listByType(scope, type) / list(scope, keyPrefix?)
```

**Data model.** `type` served by `gsi-type` (`gsi2pk=TYPE#<scope>#<type>`); `tag`/`prefix`/`contains` filter in memory (`state.ts:1828-1836`).

**Invariants & edge cases.**
- `type` is index-served; `tag`/`prefix`/`contains` filter after.
- Cursor is an offset into a fresh ranking (no snapshot to leak, `state.ts:1858-1868`).
- `rankBy:'relevance'` drops rows the intent never reached (opt-in, `state.ts:1848-1850`).
- A bare relevance map only adds the 6th signal, never authority (ADR-0051).

> ⚠ **Coherence (selector-predicate · PARTIAL · info · compounds).** All three primary membership/query/subscription-match sites funnel through the single `matchesSelector` predicate (`selector.ts:36`): `query()` candidate filter (`state.ts:1832`), `deriveBackboneEdges` `inView` (`state.ts:1080`), and subscriptions (`services/workspace/subscriptions.ts:180`). The seam's core is genuinely shared, not forked — no change needed.

> ⚠ **Coherence (selector-predicate · PARTIAL · medium · conflicts).** The `inView` backbone-edge derivation drops a `tags`-only view. `deriveBackboneEdges` types views as `{key; type?; tag?; prefix?}` (no `tags`, `state.ts:1025`), destructures only `type`/`tag`/`prefix` (`state.ts:1044`), and gates on those three at `state.ts:1046` — so a `query:{tags:[...]}` view derives zero `inView` edges, while `members()` (which spreads the whole query into `QueryOptions`, `state.ts:1966`) honours `tags`. Net: View-as-edge ≠ View-as-query for tags-only views. **Recommendation:** extract a shared `selectorFromQuery(q): Selector` helper carrying all four fields (`type`/`tag`/`tags`/`prefix`) and use it in both the view-edge derivation and the `query()` candidate filter.

**Reduces to.** `projection` + `fact` — the select→score→present pipeline specialised to a filtered, ranked, paged view (query returns full values — a projection, not a shaping). Selection runs over fact rows / the `gsi-type` index.

**Connections.** Consumes scoring (capability 7), the derived backbone (capability 12), and `./selector`; `members` intensional path delegates here.

**Motivating ADRs.** ADR-0011 (indexable query), ADR-0085 (relevance ranking), ADR-0051 (relevance signal).

---

## 14. Collection membership resolution (intensional vs extensional, ordered)

**What it does.** `members()` (`state.ts:1960`) resolves a collection fact two ways: INTENSIONAL when the fact carries a `query` (a view) — evaluated via `query()`; else EXTENSIONAL — the facts with an inbound membership edge (`inView`/`inDoc`/`onBoard`/`memberOf`) in the projection, unioned with any directly-declared `value.members[]` (ADR-0057 groups/frames, `state.ts:1999-2009`). Extensional members are ordered by narrative `seq` when a placing decoration (a key-encoded membership edge carries `source` = the decoration fact, e.g. `_doc/<doc>/<key>` = `{seq, fold}`) or a declared array position speaks, else by salience; decoration seq wins over array position. It surfaces each member's placement so a consumer (lit) gets membership + order + presentation in ONE partition read (no N+1 gets, `state.ts:1973-1977`).

**Public API.**
```ts
ObservedState.members(scope, key, opts?): Promise<MembersResult>
interface MembersResult { key; membership: 'intensional' | 'extensional';
  order: 'seq' | 'salience' | 'query'; members: MemberEntry[] }     // state.ts:1309
type MemberEntry = { key; placement?: { seq?; fold? } } & Entry     // state.ts:1307
const MEMBERSHIP_RELS = { inView, inDoc, onBoard, memberOf }         // state.ts:891
```

**Data model.** Reads over fact rows + authored/derived edges in one partition read; placement recovered from the decoration fact's value.

**Invariants & edge cases.**
- Intensional inherits the query's own ordering (`order: 'query'`).
- Decoration seq wins over declared array position (`state.ts:2031`).
- One partition read serves edges + members + decorations + signals (no N+1).

**Reduces to.** `projection` + `fact` — a specialised projection: intensional = a `query()` preset; extensional = a select over derived membership edges (themselves derived from fact keys/values). Ordering recovers decoration facts' seq. No new primitive.

**Connections.** Delegates to `query` (capability 13) and the derived backbone (capability 12); lit is the primary consumer.

**Motivating ADRs.** ADR-0005 (collections), ADR-0057 (generic `memberOf` / declared members), ADR-0069.

---

## 15. Attention — the just-in-time cron as a derived read

**What it does.** `attention()` (`state.ts:2079`) is a derived maintenance view (no scheduler): it surfaces **stale** facts (older than `staleMs`, default 14d, that have NOT earned idleness — no authored structure and standing below `settledStanding` 0.25), **unlinked** facts (no asserted/placed connectivity — authored edges count unless machine-inferred `similarTo`; embedded-ref 0.6 and membership 0.4 derived edges count, but the pure type backbone and query-derived `inView` never mask a genuinely unwoven fact), and **dangling** edges (endpoints missing or retired-without-successor). It reports capped samples plus uncapped totals (so an observer sees trend, not a saturated constant) and a `settled` count (old facts deliberately not flagged — age alone is not rot). `_`-prefixed system namespaces are excluded from reporting by default but included in derivation (`state.ts:2090-2094`).

**Public API.**
```ts
ObservedState.attention(scope, opts?): Promise<AttentionResult>
interface AttentionOptions { staleMs?; limit?; includeSystem?; typeRules?; settledStanding? }   // state.ts:1340
interface AttentionResult { stale[]; unlinked[]; dangling[];
  staleTotal; unlinkedTotal; danglingTotal; settled }               // state.ts:1357
```

**Data model.** Read-time only.

**Invariants & edge cases.**
- Age alone is not rot — earned standing or authored structure marks a fact settled (`isSettled`, `state.ts:2119`).
- `similarTo` (machine-inferred) never counts as connectivity (`state.ts:2104`).
- Pure type backbone (`instanceOf`/`managedBy`/`rendersWith`) + `inView` never mask the weave signal (`state.ts:2110`).
- Capped arrays are samples; totals are the real counts.

**Reduces to.** `projection` + `fact` — a composed projection over fact rows + authored/derived edges ("the just-in-time cron, as a read"). It reuses `signalsFor` + `deriveBackboneEdges` and asserts no new state.

**Connections.** Reuses scoring signals (capability 7) and the derived backbone (capability 12); the consolidation organ consumes this shape.

**Motivating ADRs.** ADR-0050, ADR-0009.

---

## 16. Import / migration priors & earned salience (reward)

**What it does.** A fact can arrive warm rather than cold. `WriteInput.import` preserves a migrated fact's original timestamps (so recency reflects true age; `import.createdAt` applies only on creation, `state.ts:1712`) and carries cumulative legacy read/write counts as `seedReads`/`seedWrites`, folded into the STANDING (cumulative) term only — never the recent window (`state.ts:1532-1533`) — so a ported corpus shows earned importance without faking current activity. `reward` (ADR-0070) is a persisted per-fact earned-salience number in `[0,1]` (clamped, `state.ts:1734-1735`), canonically written by the consolidation pass whose backlog delta is the substrate's first opinion about trajectory quality; it is the 7th score signal, weighted by `rewardWeight` (default 0, inert until configured). Both seeds and reward are preserved across rewrites unless explicitly supplied.

**Public API.**
```ts
WriteInput { import?: { createdAt?; updatedAt?; seedReads?; seedWrites? }; reward? }
StateRecord { seedReads?; seedWrites?; reward? }
EntryMeta.reward?
```

**Data model.** Item attrs `seedReads`/`seedWrites`/`reward`, carried only when present (`itemToRecord`, `codec:100-103`).

**Invariants & edge cases.**
- Seeds fold into cumulative/standing only, never the recent window.
- `import.createdAt` applies only on first write.
- `reward` clamped to `[0,1]`.
- Omitting `reward`/seeds on a rewrite preserves stored values (`state.ts:1725-1735`).

**Reduces to.** `fact` — persisted priors/earned-signal fields on the fact row, preserved across rewrites like any attribute; they feed scoring but are stored fact state.

**Connections.** Feeds scoring (capability 7); the consolidation organ writes `reward`; migration tooling writes `import`.

**Motivating ADRs.** ADR-0070 (reward), ADR-0050 (standing).

---

## 17. Platform configuration & Mode-2 event emission

**What it does.** Two thin runtime collaborators the fact floor depends on. `config.ts` centralises environment access: `loadConfig()` reads `SERVICE_NAME`/`EVENT_BUS_NAME`/`TABLE_NAME`/`SUBSTRATE_TABLE`/`SERVICE_REGISTRY`/`TURSO_*` and fails fast on a missing required value (`getString`, `config.ts:26-32`); `substrateTableName` (`SUBSTRATE_TABLE`) is the shared observed-state store, distinct from a cell's private `tableName` (organ scratch), injected by `SubstrateTable.grantReadWrite` (`substrate-table.ts:79-82`). `events.ts` is EventBridge fire-and-forget (communication Mode 2): `createEvents({source, busName, correlationId}).emit(detailType, detail)` — a no-op when no bus is configured (local invoke, `events.ts:43`); the AWS client is lazy-instantiated and stub-injectable (`__setEventBridge`) so importing never forces the SDK.

**Public API.**
```ts
loadConfig(): PlatformConfig                       // config.ts:39
getString(key, fallback?) / getOptional(key)       // config.ts:26,34
interface PlatformConfig { serviceName; eventBusName?; tableName?;
  substrateTableName?; registry; turso? }           // config.ts:10
createEvents(options: EventEmitterOptions): Events  // events.ts:40
Events.emit(detailType, detail): Promise<void>
__setEventBridge(stub)                              // events.ts:27
```

**Data model.** No fact rows. Env vars only; EventBridge `PutEvents` entries `{EventBusName, Source, DetailType, Detail: JSON({...detail, correlationId})}`.

**Invariants & edge cases.**
- A missing required env var fails fast (not undefined deep in logic).
- `substrateTableName` (shared truth) is distinct from `tableName` (private scratch).
- `emit` with no `busName` is a silent no-op.
- The SDK is lazy-`require`d, never top-level (platform convention).

**Reduces to.** `cell` — these are the cell-runtime seams around the fact floor, not fact/projection primitives: `config` surfaces the substrate-table binding a cell was granted, and `events` is the EventBridge emission side (subscriptions/reactivity are wired in infra above). Grouped here because they ship in `platform/runtime` alongside the store and are the ambient plumbing the fact store needs.

**Connections.** `SubstrateTable.grantReadWrite` injects `SUBSTRATE_TABLE`; the write-fanout coherence findings (capability 11) turn on `events.ts` being the emission origin that is not chokepointed with `state.put`.

**Motivating ADRs.** ADR-0007.

---

## Gotchas / non-obvious behavior

- **`revision` survives a lapsed lease; the lease only affects visibility.** An expired-`delete` fact is invisible to reads and counts as absent for CAS, but a fresh `put` still increments `revision` from the physical predecessor (`state.ts:1702`). Physical continuity is unconditional.
- **A scope-wide `read()` records no touch, but `get()` does.** `read` explicitly skips attention (a scope read is not per-fact attention, `state.ts:1805`); a single-key `get` records one read touch (`state.ts:1759`). If you drive salience by "which facts were looked at," use `get`/`touch`, not `read`.
- **The bump shows on the *next* read.** `get` wraps the pre-touch record and bumps after, so the counter increment does not appear in the response that caused it (`state.ts:1757`).
- **`ifVersion=""` means "must not exist"** — a create-only guard distinct from `ifAbsent` (which is a boolean) but semantically overlapping (`state.ts:1156`, `1675-1676`).
- **Omitting `type`/`tags`/`reward`/`import` seeds on a rewrite preserves the stored values; passing them replaces.** `type: undefined` preserves, `type: null` clears (`state.ts:1719`).
- **Derived backbone edges are never persisted and are timeless** (`createdAt: ''`, `writer: null`, `derived: true`). Do not expect them from `edges()` / `store.listEdges` — only `graph()`/`neighbors()`/`members()` synthesize them.
- **`instanceOf` is the one backbone edge emitted without a materialised target** (`state.ts:1076`), giving every typed fact a centrality floor even when its `_types/<type>` anchor is canonical-only. All other backbone edges require the target to exist.
- **Timer-liveness filtering is inconsistent across edge paths** (see the capability-5 coherence callout): `neighbors` and `signalsFor` derive over unfiltered records while `graph`/`members` pre-filter. Dormant-timer facts can appear in `neighbors` outbound/inbound edge arrays.
- **A `tags`-only view derives zero `inView` backbone edges** but `members()` on the same view returns its intensional members — a live divergence between View-as-edge and View-as-query (capability-13 coherence callout).
- **`state.put` does NOT emit `workspace.fact.written`.** The logical change event is hand-rolled at ~13 call sites in the handler layer; the store layer only appends the trajectory and rides the DynamoDB stream. A new write path must emit the event itself or reactions silently break (capability-11 coherence callout).
- **The memory store and the v3 codec can silently diverge on new fields.** The memory store spreads all fields; `itemToRecord` is a hand-maintained allowlist. A new `StateRecord` field passes tests (memory) but is dropped in prod (v3) until added to the codec (capability-6 coherence callout).
- **Raw per-call `salience` overrides are not normalized** — if your weights sum to >1 the score can exceed the tier semantics; only lens presets are guaranteed to sum to 1 (`state.ts:684-685`).
- **`query` cursor is a plain offset into a freshly-recomputed ranking**, so between pages a salience shift can reorder or duplicate/skip entries — it is a best-effort resume, not a snapshot (`state.ts:1858`).
- **`reward` and `relevance` ride the score un-prioered and default to weight 0** — writing a reward or passing a relevance map changes nothing until `rewardWeight`/`relevanceWeight` is configured (or `text` triggers `INTENT_PRESET`).
- **The v3 store lazy-`require`s `@aws-sdk/*`** — it works only on a runtime that ships v3 ambiently (Node 20 Lambda / forge-bundled cells). Importing the module is free; constructing the store touches the SDK.
