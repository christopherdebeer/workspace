# Runtime — Semantic Search & Similarity

## What this subsystem is

This subsystem gives the parc.land substrate **meaning-based recall and semantic structure**. It is built on two small, pure interfaces — `Embedder` (text → vector) and `VectorStore` (k-NN index) — plus addressing/extraction helpers that are shared by four consumers: the live DynamoDB-stream indexer, the async `reindex` backfill, `workspace.search`, and the intent-lens relevance signal on `recall`/`query`.

Its defining constitutional stance (ADR-0030 Decision 1) is that **the vector index is "an index, not an authority."** The index only ever generates candidate KEYS; the caller re-reads each candidate authoritatively against the substrate (scope + grant + timer + supersession) before returning it. Nothing in this subsystem makes an access decision. Isolation is structural: one index per slice (`indexForScope`) mirrors the `STATE#<scope>` DynamoDB partition 1:1, and grant fan-out reuses recall's own-∪-grants-∪-public fold (ADR-0030 Decision 2).

### The honest reduction (the key coherence finding)

The vector index is the **one artifact in the whole subsystem that does NOT reduce to `fact` / `projection` / `cell` / `edge-http`.** It is a genuinely distinct candidate-generator primitive — an external S3 Vectors k-NN store, keyed per fact, eventually consistent, holding embeddings that live *outside* the substrate table.

The subsystem's coherence comes from deliberately **confining** that new primitive: every OUTPUT it produces is re-grounded in a core primitive.

- `workspace.search` re-reads each candidate as a **Fact** and shapes the result through the **Projection** pipeline's R1 envelope.
- Relevance becomes a term *inside* the 5-term salience **Projection** score (ADR-0051), not a second score.
- Inferred `similarTo` kinship is written back as ordinary authored-style edge **Facts** (writer `platform/vectors`) so it feeds `centrality` and surfaces through the Reference projection with zero scorer change (ADR-0031).

So: a new index primitive at the edge, everything it produces reduced back to fact + projection.

### Live snapshot

`workspace.edges` (ADR-0069) returns real `similarTo` edges stamped `writer:"platform/vectors"`, `strength:0.3`, and a `score` carrying the raw cosine (e.g. `_caps/@c15r/canvas.scene --similarTo--> doc:canvas-substrate-design` @ 0.513) — confirming both that `_caps/` capability facts ARE embedded (the `embeddableText` exception for ADR-0052) and that Titan cosines run compressed (scores cluster 0.33–0.75). The live `$catalog` still lists `workspace.search` alongside `recall`/`query` — a coherence gap vs ADR-0051's stated intent to retire it (see the search section).

### Anchor files

- `platform/runtime/vectors.ts` — the seam, extraction, addressing, math, reference impls, similar-edge config
- `platform/runtime/s3-vectors-store.ts` — production `S3VectorsStore`, `BedrockEmbedder`, `vectorsFromEnv`
- `platform/runtime/similar-edges.ts` — inferred-edge write seam + suggestion candidate collapsing
- `platform/runtime/projection.ts` — PCA / layout artifact helpers
- `services/workspace/commands-search.ts` — `search`, `reindex`, `project`, `pruneSimilar`, `suggestions`, `ratify`, `contested`
- `services/workspace/commands-read.ts` — relevance signal (`relevanceFor`, `intentSalience`)
- `services/vector-indexer/handler.ts` — the live stream consumer + `patchProjection`

---

## 1. Embedder + VectorStore seam (reversible semantic-search substrate)

**What it does.** Defines the two pure interfaces the whole subsystem rests on, plus the vector value types and cosine math. The contract is small enough that a deterministic reference pair (`HashingEmbedder` + `MemoryVectorStore`) satisfies it for tests and a no-prereq deploy, so swapping to the production S3 Vectors + Bedrock backend is a wiring change, never a rewrite (ADR-0030 §2a reversibility).

**Public API** (`platform/runtime/vectors.ts:44`):

```ts
export interface Embedder {
  readonly dimension: number;                 // the index is created with it
  embed(texts: string[]): Promise<Vector[]>;  // batch; one vector per text, same order
}

export interface VectorStore {
  ensureIndex(index: string, opts: { dimension: number; metric?: 'cosine' | 'euclidean' }): Promise<void>;
  put(index: string, records: VectorRecord[]): Promise<void>;
  query(index: string, vector: Vector, opts?: { topK?: number; filter?: VectorFilter }): Promise<VectorMatch[]>;
  remove(index: string, keys: string[]): Promise<void>;
  list(index: string): Promise<VectorRecord[]>; // whole-index bulk read; [] for never-created
}

export type Vector = number[];
export type VectorMetadata = Record<string, string | number | boolean>; // primitives only
export type VectorFilter = Record<string, string | number | boolean>;   // equality doc
export interface VectorRecord { key: string; vector: Vector; metadata?: VectorMetadata }
export interface VectorMatch  { key: string; score: number /* cosine [-1,1] */; distance: number /* 1-score */; metadata?: VectorMetadata }

export function cosineSimilarity(a: Vector, b: Vector): number; // vectors.ts:205
export function normalize(v: Vector): Vector;                   // vectors.ts:196
```

**Data model.** In-index record: `{ key, vector: float32[], metadata: { superseded: boolean, type?, tag? } }`. `query` returns `VectorMatch` with cosine `score` and reported `distance` (`1 - score` for cosine).

**Invariants & edge cases.**
- The index is a candidate generator, never an authority — it yields keys, never access decisions (ADR-0030 Decision 1).
- Embedder and store agree on dimension; the index is created with the embedder's dimension.
- `VectorMetadata` is primitives-only so it maps onto S3 Vectors' filterable-metadata budget.
- `query` returns matches score-descending (`S3VectorsStore` relies on the service sort; `MemoryVectorStore` sorts explicitly at `vectors.ts:294`).
- `cosineSimilarity` computes both norms itself (assumes nothing about normalization) and returns 0 when either norm is 0.

**Reduces to.** `fact` + `projection`, but this is the boundary at which the **one NEW primitive is introduced**. A `VectorStore` is not the substrate table, its records are not Facts, and `query` is not a `Projection.select`. Coherence comes from the seam being deliberately minimal and advisory: `VectorMatch.key` is only ever a candidate re-read as a Fact, and `VectorMatch.score` only ever feeds the salience Projection.

**Connections.** Consumed by the indexer, `reindex`, `search`, the relevance signal, and the 2D layout. The edge-write seam (`similar-edges.ts`) imports `VectorMatch` from here.

**Motivating ADRs.** ADR-0030 (semantic search substrate), ADR-0031 (inferred similarity edges).

---

## 2. Fact text extraction and vector metadata (what gets embedded)

**What it does.** `embeddableText(key, value)` derives the string to embed for a fact, or `null` when nothing is worth embedding. `metadataForFact(...)` builds the in-index filter doc. `isTextLikeContentType`/`BLOB_INLINE_MAX_BYTES` gate blob-text extraction.

**Public API** (`platform/runtime/vectors.ts:93`):

```ts
export function embeddableText(key: string, value: unknown): string | null;      // vectors.ts:93
export function metadataForFact(meta: { type?: string | null; tags?: string[]; superseded?: boolean }): VectorMetadata; // vectors.ts:185
export function isTextLikeContentType(contentType?: string): boolean;            // vectors.ts:115
const TEXT_FIELDS = ['title','name','text','content','summary','description','body','value','path']; // vectors.ts:85
const MAX_EMBED_CHARS = 8000;         // vectors.ts:86
export const BLOB_INLINE_MAX_BYTES = 64 * 1024; // vectors.ts:136
```

`embeddableText` skips `_`-prefixed plumbing facts EXCEPT `_caps/` capability facts (`vectors.ts:94`); prefers the well-known text fields (joined by `\n`), falls back to bounded JSON, truncates at 8000 chars.

**Data model.** Filterable metadata per vector: `{ superseded: boolean, type?: string, tag?: string }` — only the **first** tag is collapsed in server-side (`vectors.ts:190`); remaining tags are deferred to the authoritative re-read.

**Invariants & edge cases.**
- `_`-prefixed facts are not embedded EXCEPT `_caps/` (ADR-0052 — capability facts exist to be found by meaning / goal-conditioned recall).
- Only the first tag is indexed server-side; other tags rely on the authoritative re-read.
- Text truncated to 8000 chars before embedding (both here and in `BedrockEmbedder`'s body at `s3-vectors-store.ts:215`).

**Reduces to.** `fact`. These are pure functions over a Fact's `(key, value, _meta)`. The `_`-prefix skip mirrors the substrate's plumbing convention; the `_caps/` exception is exactly the ADR-0052 rule. No new primitive — reads Fact shape, emits a string.

> ⚠ **Coherence — key-vocabulary drift (embed-orchestration · PARTIAL · low · conflicts).** `VectorMetadata`/`VectorFilter` are open string-keyed maps with no shared key union (`vectors.ts:21`, `:31`). `metadataForFact` writes literal keys `type`/`tag` (`vectors.ts:185-191`), but `search`'s filter builder re-types those keys literally (`commands-search.ts:353-355`) and does NOT import them from the writer. A rename on one side isn't type-checked across writer and reader. Because S3 Vectors filters are equality, a renamed key would make type/tag-scoped searches return **empty** (the filter matches zero docs) — and the authoritative re-read can't recover results the server filter already excluded. Latent today (keys agree). **Recommendation:** export the filterable-key names as constants from `vectors.ts` and reference them from both `metadataForFact` and the search filter builder.

**Connections.** Used by the stream indexer (`handler.ts:110,114,115`), `reindexChunk` (`commands-search.ts:765,773`). `isTextLikeContentType`/`BLOB_INLINE_MAX_BYTES` support blob-text extraction (ADR-0027).

**Motivating ADRs.** ADR-0030, ADR-0027 (blob content inline), ADR-0052 (capability facts are meaning-addressable), ADR-0023 (granular type read-scope).

---

## 3. Per-slice index addressing (isolation by construction)

**What it does.** `indexForScope(scope, dim?)` maps a scope to its vector index name — `slice-<scope>` or `slice-<scope>-d<dim>` when a dimension is passed — mirroring the `STATE#<scope>` DynamoDB partition 1:1. Appending `dim` means an embedding-model change lands in a FRESH index namespace rather than colliding: a model swap is a `reindex` into a new namespace.

**Public API** (`platform/runtime/vectors.ts:79`):

```ts
export function indexForScope(scope: string, dim?: number): string; // `slice-${scope}` | `slice-${scope}-d${dim}`
export const PUBLIC_INDEX = 'slice-public';                          // vectors.ts:67
```

**Data model.** Index names: `slice-<scope>-d<dim>` (live: `slice-c15r-d1024` for Titan). Old-dimension indexes are orphaned harmlessly on a model swap (storage is cheap).

**Invariants & edge cases.**
- One index per slice mirrors `STATE#<scope>`.
- Dimension is namespaced into the index name so vectors from different embedding spaces never collide (S3 Vectors fixes dimension at creation).
- All callers derive `dim` from the same env-built embedder (`vectors.embedder.dimension`) so they stay consistent.
- `PUBLIC_INDEX` is the shared public-corpus index; in single-owner deployments it coincides with the owner slice.

**Reduces to.** `fact`. The index namespace is deliberately isomorphic to the Fact scope partition (scope = IAM principal = LeadingKeys boundary). Isolation is not re-invented — it is the SAME scope boundary the Fact primitive already enforces, re-expressed as index names. A query names exactly one slice's index, so you cannot reach another slice's vectors without naming it.

> ⚠ **Coherence — the dimension source of truth (embed-orchestration · PARTIAL · medium · conflicts).** The stream indexer computes `const DIM = Number(process.env.VECTOR_DIM ?? (process.env.VECTOR_EMBEDDER === 'bedrock' ? 1024 : 256))` at `handler.ts:60` — **case-sensitive**, and inside the pure `planStreamWork` which has no access to the `vectors` object. `vectorsFromEnv` lowercases before comparing (`s3-vectors-store.ts:236`). So `VECTOR_EMBEDDER=Bedrock` (capital B) resolves DIM to 256 while the embedder is `BedrockEmbedder(1024)` — an index-name skew AND a dimension mismatch on the first `put`. Every query site instead reads `vectors.embedder.dimension` (`commands-search.ts:363,437,759`, `commands-read.ts:52`). Currently latent because `lib/platform-stack.ts:136` pins `VECTOR_DIM='1024'` on both Lambdas. **Recommendation:** drop the module-level DIM formula; thread `vectors.embedder.dimension` into `planStreamWork(event, dim)` as the single source.

**Connections.** Called by every consumer in the subsystem.

**Motivating ADRs.** ADR-0030 (Decision 2, structural isolation).

---

## 4. S3VectorsStore — production VectorStore over Amazon S3 Vectors

**What it does.** The production `VectorStore`: bucket + per-slice indexes created at RUNTIME, create-if-absent (`ConflictException` is the success path of a concurrent create), exactly like the cells provisioner — "CDK, but deployed at runtime" (ADR-0030 §3a). The only deploy-time infra is IAM (`s3vectors:*` on the fixed bucket ARN) + env. The AWS SDK is dynamically imported inside methods (platform convention: never load the SDK at import time).

**Public API** (`platform/runtime/s3-vectors-store.ts:31`):

```ts
export class S3VectorsStore implements VectorStore {
  constructor(opts: { bucket: string; region?: string });
  // ensureIndex — CreateVectorBucketCommand (once) + CreateIndexCommand (float32, cosine), idempotent on Conflict  (:48)
  // put         — PutVectorsCommand in chunks of PUT_CHUNK=200                                                     (:76)
  // query       — QueryVectorsCommand (returnMetadata, returnDistance); score = 1 - distance; isNotFound → []     (:92)
  // remove      — DeleteVectorsCommand; isNotFound swallowed                                                       (:124)
  // list        — ListVectorsCommand paged by nextToken (returnData), maxResults 500                              (:138)
}
```

Private `ensured: Set<string>` + `bucketEnsured` skip redundant create-if-absent calls per process (`s3-vectors-store.ts:34-35,49`). `const PUT_CHUNK = 200` (`:24`).

**Data model.** S3 Vectors: vector bucket (fixed name) → per-slice indexes (float32, cosine). `PutVectors` vectors: `[{ key, data: { float32 }, metadata }]`. Query reports cosine **distance**; the store inverts to `score = 1 - distance` (`:113`).

**Invariants & edge cases.**
- `ConflictException`/`AlreadyExists` on create is success — concurrent create (`isConflict`, `:172`).
- `NotFound`/`NoSuch` on query/remove/list is treated as empty, never fatal (`isNotFound`, `:175`) — a never-created slice index is "no hits."
- SDK imported lazily inside methods (no import-time SDK load).
- Index dimension/metric fixed at creation.
- `list` follows `nextToken` because S3 Vectors caps a page at ~1 MB regardless of `maxResults`.

**Reduces to.** `fact` + `cell`. It carries the new index primitive, but its control-plane/data-plane split is the SAME pattern the Cell axis uses (create-if-absent at runtime, IAM against a known ARN, no CDK per entity). Its outputs are candidate keys re-grounded as Facts. It is the concrete home of the subsystem's one external primitive.

**Connections.** Wired by `vectorsFromEnv`. Only place `list` is used at scale is `project` (the 2D layout).

**Motivating ADRs.** ADR-0030, ADR-0008 (cell axis / runtime provisioning pattern).

---

## 5. Embedder backends + vectorsFromEnv factory (HashingEmbedder / BedrockEmbedder)

**What it does.** `HashingEmbedder` is a dependency-free deterministic reference embedder (signed FNV-1a feature-hashing of sublinear token frequencies into an L2-normalized vector) — captures lexical overlap, not true semantics; its role is to exercise the whole pipeline before Titan access is wired (ADR-0030 Increment 0). `BedrockEmbedder` is the drop-in real backend (Titan Text Embeddings v2, default `amazon.titan-embed-text-v2:0`, 1024-dim, normalized). `vectorsFromEnv(env)` wires the backend from Lambda env.

**Public API:**

```ts
export class HashingEmbedder implements Embedder { constructor(dimension = 256) }   // vectors.ts:243
export class BedrockEmbedder implements Embedder {                                   // s3-vectors-store.ts:184
  constructor(opts?: { modelId?: string; dimension?: number /* =1024 */; region?: string });
  // embed → InvokeModelCommand, body { inputText: text.slice(0,8000), dimensions, normalize:true }  (:205)
}
export function vectorsFromEnv(env = process.env): { store: VectorStore; embedder: Embedder } | undefined; // s3-vectors-store.ts:232
// env: VECTOR_BUCKET, VECTOR_REGION/AWS_REGION, VECTOR_EMBEDDER (hashing|bedrock),
//      VECTOR_DIM (default 1024 bedrock / 256 hashing), VECTOR_MODEL
```

**Data model.** Titan invoke body: `{ inputText, dimensions, normalize: true }` → `{ embedding: number[] }`. Hashing: dim-bucketed signed feature vector, L2-normalized (`vectors.ts:250-260`).

**Invariants & edge cases.**
- No `VECTOR_BUCKET` → `vectorsFromEnv` returns `undefined` → search returns a degraded hint, never an error (`s3-vectors-store.ts:234`).
- `useBedrock = (env.VECTOR_EMBEDDER ?? 'hashing').toLowerCase() === 'bedrock'` (case-insensitive here — contrast the indexer's case-sensitive check; see §3 callout).
- Dimension pinned in env must match the index dimension.
- An embedding-model swap is a config flip (`VECTOR_EMBEDDER`/`VECTOR_DIM`) + `reindex`, no code change.

**Reduces to.** `cell` + `fact`. Env-driven construction of the seam implementations; the "dark until configured" pattern (`undefined` → degrade) is the standard Cell environment-wiring seam. Embedders produce vectors from Fact text; nothing new beyond the index primitive already accounted for.

**Connections.** `vectorsFromEnv` is the single entry point the indexer (`handler.ts:121`) and workspace deps builder use to obtain `{ store, embedder }`.

**Motivating ADRs.** ADR-0030 (Increments 0/1/4).

---

## 6. workspace.search — semantic candidate generation + grant fan-out + authoritative re-read

**What it does.** The semantic read verb: embed the query once, over-fetch `topK = limit*4` from the viewer's own slice index PLUS each applicable grant owner's index (grant-covered keys only, mirroring recall's fold), collapse each key to its best score, rank, then AUTHORITATIVELY RE-READ each candidate via `state.get(owner, key, identity)` — dropping superseded/unauthorized facts — before returning at most `limit`, wrapped in the ADR-0029 R1 `{entries, types}` envelope.

**Public API** (`services/workspace/commands-search.ts:330`):

```ts
search(input: SearchInput, ctx): Promise<SearchResult>;
interface SearchInput  { text: string; type?: string; tag?: string; limit?: number /* 1-50, def 10 */; shape?: ReadShape }
interface SearchResult { entries: SearchHit[]; count: number; total: number; types?: Record<string,TypeAffordance>; hint?: string }
interface SearchHit    { key: string; value: unknown; _meta: EntryMeta; score: number /* cosine, 4dp */ }
```

Type/tag map to in-index metadata filters (`commands-search.ts:353-355`), honouring the `read:type:<T>` granular scope via `enforceTypeRead` (`:344`). `superseded` is NOT filtered in-index — the re-read is the authority.

**Data model.** Per-candidate: `{ owner, key, outKey, score }` where `outKey = <owner>/<key>` for granted facts (`:371`). Cross-path keys collapsed to best score (`:376-380`). Granted facts surface under `<owner>/<key>`.

**Invariants & edge cases.**
- Every candidate is re-read on the LIVE substrate with the viewer's identity (`:389`) — a stale/superseded/leaked vector can only DROP a candidate, never leak one.
- `superseded` is not an in-index filter (re-read is authority); type/tag are optimizations.
- Fan-out set = own ∪ applicable grants (`grantCovers` per key, `:370`), identical to recall's assembly.
- No vectors backend → `{ entries: [], count: 0, total: 0, hint }` degraded response (`:334-341`).
- Each per-owner `query` is wrapped in `.catch(() => [])` (`:364,368`) so one slice's index error can't fail the whole search.

**Reduces to.** `projection` + `fact`. A `Projection.select` whose candidate SOURCE is the vector index instead of the store scan, followed by the standard authoritative Fact re-read and the same shape/present stage every read shares. The index accelerates select; fact + grant enforcement is unchanged.

> ⚠ **Coherence — search vs `query({text})` catalog gap (from the capability audit).** ADR-0051 folds search into `query({text})` and marks `search` a deprecated alias slated to leave the catalog, but `commands-search.ts:330` still fully implements it and the live `$catalog` menu still lists `workspace.search`. The two coexist rather than search being retired. **Recommendation:** if ADR-0051's intent stands, remove `search` from the catalog and route callers to `query({text})`; otherwise update ADR-0051 to record that `search` remains a first-class verb.

> ⚠ **Coherence — live delete-timer leases leak into search (embed-orchestration · PARTIAL · high · conflicts).** The stream indexer drops every `timerEffect === 'delete'` fact (`handler.ts:106`). The reindex worker's embeddable filter checks only `!!e.text` (`commands-search.ts:764-766`) with no `timerEffect` gate, and `state.query`'s `isTimerLive` returns true for a still-live delete-timer fact (`state.ts:188`). So a full `reindex` re-embeds and wires `similarTo` over LIVE (unexpired) delete-timer leases/presence rows the stream path never admits. Search's authoritative re-read (`commands-search.ts:389`, via `state.get`) only nulls on `!isTimerLive`/superseded — it does NOT re-check `timerEffect === 'delete'` — so re-admitted live leases leak specifically into search (and `recall`'s `relevanceFor`), while `contested` (`:646-649`) and `suggestions` (`:518-522`) DO re-check and are protected. **Recommendation:** lift the delete-timer exclusion into a shared `shouldIndex(fact)` predicate (or extend `embeddableText` to take `timerEffect`) that both `vector-indexer/handler.ts` and `reindexChunk` call.

**Connections.** Uses the seam, `indexForScope`, fact-text metadata filters, grants (`applicableGrants`/`grantCovers`), and the shape/affordance projection stage.

**Motivating ADRs.** ADR-0030, ADR-0029 (R1 envelope), ADR-0023 (granular read-scope), ADR-0007 (grant fold), ADR-0051 (query merge / deprecation).

---

## 7. Live incremental vector indexer (DynamoDB-stream consumer)

**What it does.** The live half of indexing: a consumer on the SubstrateTable stream (NEW_AND_OLD_IMAGES). `planStreamWork` is the pure, testable core — filters to facts, drops the vector on REMOVE/supersession, DROPS delete-effect-timer facts, and sha-skips a metadata-only rewrite. The handler embeds puts, upserts, removes, then best-effort reconciles `similarTo` edges and patches the 2D layout — each wrapped so an edge/layout failure never poisons the already-committed vector batch.

**Public API** (`services/vector-indexer/handler.ts`):

```ts
export function planStreamWork(event: StreamEvent): Map<string, IndexPlan>; // :74 — pure, unit-testable
export async function handler(event: StreamEvent): Promise<void>;           // :120
interface IndexPlan { scope: string; puts: Array<{ key; text; meta }>; removes: Set<string> }
const DIM = Number(process.env.VECTOR_DIM ?? (process.env.VECTOR_EMBEDDER === 'bedrock' ? 1024 : 256)); // :60
```

**Data model.** Reads unmarshalled DDB stream `FactItem { sk, scope, key, value, type, tags, superseded, timerEffect }`. Writes `VectorRecord`s + `similarTo` `EdgeRecord`s + graph-layout-shard facts.

**Invariants & edge cases.**
- Facts only (`sk` starts `KEY#`, `:87`); edges (`EDGE#`), trajectory (`TRAJ#`), and seq (`SEQ#`) partitions skipped.
- `REMOVE`, `superseded`, OR `timerEffect === 'delete'` → drop the vector (`:94,106`). Ephemeral coordination facts never indexed — embedding them minted `similarTo` kinship between leases/presence rows that led the contested/suggestions views at 0.99 cosine.
- sha-skip: unchanged embeddable text does not re-embed (`:114`).
- Edge + projection passes are best-effort — a failure logs a warning but never fails the committed vector write (`:145-156,167-173`).
- No backend configured → no-op (safe) (`:121-122`).

**Reduces to.** `fact` + `cell`. Reacts to the Fact change-stream (the same monotonic supersede-not-delete log the Fact primitive stamps) and mirrors Fact state into the index primitive — a Cell-shaped stream consumer with its own IAM. Its inputs are Fact images; its edge/layout side-writes are Facts. The one non-core piece is the index it maintains.

> ⚠ **Coherence — two parallel "a fact changed" fan-outs (write-fanout · PARTIAL · medium · conflicts).** Exactly two `DynamoEventSource` consumers attach to `substrate.table` — the vector indexer (`lib/platform-stack.ts:206-214`) and the archiver (`:240-248`), both `StartingPosition.LATEST`, both configured purely in CDK. But reactions/reindex/capability-touch ride a *different* substrate: `FactReactionRoute` (`platform-stack.ts:269`) is an EventBridge rule on the logical `workspace.fact.written` event emitted via `putEvents` (`platform/runtime/events.ts:42-48`). No shared helper unifies the two origins. **Recommendation:** adopt the stream as the canonical fan-out for reactions too, collapsing `workspace.fact.written` into a stream-derived signal — one origin for all paths.

**Connections.** Depends on `vectorsFromEnv`, the extraction helpers, `selectNeighbors`/`refreshSimilarEdges`/`dropSimilarEdges`, and `patchProjection`.

**Motivating ADRs.** ADR-0030 (Increment 2), ADR-0031 (inferred edges), ADR-0082 (sharded atlas patch).

---

## 8. Async chunked reindex (backfill replay)

**What it does.** The admin (`workspace:admin` / `platform:*`) backfill. Because a full-slice re-embed is hundreds of Titan calls (far over the ~30s edge cap and 60s Lambda), `reindex` only DISPATCHES — writes a `_reindex/<scope>` status fact (type `reindex-status`), emits `workspace.reindex.requested`, returns `{ status: 'started', poll }`. `createReindexHandler` processes ONE bounded page (`REINDEX_CHUNK=50`) per invocation in two phases: `embed` fills the index page-by-page, then flips to `edges` (re-embeds each fact only to get its query vector against the now-full index and wires `similarTo`), chaining continuation events until done.

**Public API** (`services/workspace/commands-search.ts`):

```ts
reindex(input: ReindexInput, ctx);                                    // :399 — dispatch only, admin-gated
export function createReindexHandler(build: DepsBuilder): EventBridgeHandler; // :803 — one chunk per invocation
async function reindexChunk(deps, scope, p: ReindexParams): Promise<{ done; next }>; // :756 — phases embed→edges
interface ReindexInput { type?: string; prefix?: string; max?: number /* 1-5000, def 2000 */ }
const REINDEX_IDENTITY = { user: 'platform/reindex', scopes: [] }; // :737
const REINDEX_CHUNK = Number(process.env.VECTOR_REINDEX_CHUNK ?? 50); // :738
```

**Data model.** Status fact `_reindex/<scope>` `{ status: running|done, phase: embed|edges, indexed, skipped, edges, cursor?, index }`. Continuation event carries `{ scope, type, prefix, max, phase, cursor, indexed, skipped, edges }`.

**Invariants & edge cases.**
- No invocation does more than one bounded page — the 30s/60s ceilings become irrelevant.
- Phase order: embed the whole slice THEN edges (`similarTo` needs the full index present, `:778-779`).
- Admin-only (`:408`); the handler refuses events not sourced from `'workspace'` (`:805`).
- Idempotent under EventBridge retry (re-embed/re-put + `refreshSimilarEdges` reconcile); a chunk failure throws → EventBridge retries (`:834-837`).

**Reduces to.** `fact` + `projection`. The status is a Fact (`_reindex/<scope>`) polled like any Fact; continuation is the platform event bus (Cell-tier). The paging cursor is `Projection.select` over the scope (`state.query`, `:763`). Composes only core primitives — which is precisely why ADR-0083 could lift the pattern wholesale to lit's `decomposeMarkdown`.

> ⚠ **Coherence — reindex edges phase re-embeds (embed-orchestration · PARTIAL · low · conflicts).** The `edges` phase re-embeds each fact only to get its query vector (`commands-search.ts:787`, honestly commented) because it runs as a separate bounded Lambda invocation that no longer holds the vectors in memory, and `VectorStore` offers no keyed `get`. The stream indexer, by contrast, reuses `putVecs` (`handler.ts:136,149`). Bounded to rare backfills, not the hot path. **Recommendation:** add `get(index, keys[]) → VectorRecord[]` to `VectorStore` and have the edges phase read stored vectors instead of re-embedding — or accept the cost with the existing comment.

**Connections.** Uses the seam, extraction helpers, and the inferred-edge seam.

**Motivating ADRs.** ADR-0030, ADR-0031, ADR-0083 (pattern generalized to `decomposeMarkdown`).

---

## 9. Inferred similarTo edges — semantic similarity as emergent salience

**What it does.** The edge-write seam (ADR-0031 Option A): platform code reconciles a fact's `similarTo` edges directly through raw StateStore edge CRUD (`EdgeIO`) — no trajectory event, no endpoint-resolve (those belong to authored `workspace.link`). Edges stamp `writer = platform/vectors` and a fixed `strength = 0.3` plus the raw cosine as `score`. Because centrality counts all edges, semantically-central facts gain salience with NO scorer change.

**Public API** (`platform/runtime/similar-edges.ts`):

```ts
export function selectNeighbors(matches: VectorMatch[], selfKey: string, opts: { k; minScore }): VectorMatch[]; // :150
export async function refreshSimilarEdges(io, scope, key, neighbors, strength, existing, nowIso): Promise<void>; // :54
export async function dropSimilarEdges(io, scope, key, existing): Promise<void>;    // :79
export function authoredPairs(existing: EdgeRecord[]): Set<string>;                  // :37
export function pairKey(a: string, b: string): string;   // order-independent        // :27
export function suggestionCandidates(edges: EdgeRecord[]): SuggestionCandidate[];    // :119 (score-desc)
export async function dropSimilarPair(io, scope, a, b, existing): Promise<number>;   // :136
export type EdgeIO = Pick<StateStore, 'listEdges' | 'putEdge' | 'deleteEdge'>;       // :22
// in vectors.ts:
export const SIMILAR_REL = 'similarTo'; export const SIMILAR_WRITER = 'platform/vectors'; // :144-145
export function similarConfig(env = process.env): { enabled; k=5; minScore=0.35; strength=0.3 }; // :166
```

**Data model.** `EdgeRecord { scope, from, rel: 'similarTo', to, strength: 0.3 (fixed), createdAt, writer: 'platform/vectors', score: <raw cosine> }`. Live-confirmed shape in `workspace.edges`.

**Invariants & edge cases.**
- `strength` stays fixed at 0.3 (above structural 0.2, below membership 0.4) so centrality weighting is unchanged; `score` carries the raw cosine for ranking candidates (`similar-edges.ts:71-73`).
- No `similarTo` edge is created where an authored edge (either direction) already connects the pair — dedup-on-create via `authoredPairs` (`:63-66`).
- Edges are advisory structure, never authority — a dangling `to` is harmless, pruned next pass.
- Edges written only within the fact's own scope partition (no cross-slice).
- Env default τ = 0.35, but ADR-0032 lowered the live floor to 0.25 via `VECTOR_SIMILAR_MIN_SCORE` (config, not the code default).

**Reduces to.** `fact` + `projection` — the cleanest reduction in the subsystem. Similarity is not a new scoring term; it is written back as ordinary edge Facts (authored-style, provenance-stamped) so the existing centrality signal in the salience Projection picks them up for free (ADR-0031 finding 2). Relevance "becomes structure."

> ⚠ **Coherence — similarTo invariants are fully convergent (embed-orchestration · PARTIAL · info · compounds).** Every writer/consumer funnels through the same primitives: `SIMILAR_REL`/`SIMILAR_WRITER` + `selectNeighbors` (`vectors.ts`) and `refreshSimilarEdges`/`dropSimilarEdges`/`authoredPairs`/`pairKey`/`suggestionCandidates`/`dropSimilarPair` (`similar-edges.ts`). Stream indexer (`handler.ts:149-153`) and reindex (`commands-search.ts:789-791`) both call `selectNeighbors` + `refreshSimilarEdges` with identical `topK` (`sim.k+1`) and knobs from the shared `similarConfig()`. Live `workspace.edges` corroborates. **No change — this is the model of how the seam should behave.**

> ⚠ **Coherence — edge value-shapes reduce to one store primitive (edge-shapes · PARTIAL · info · compounds).** Every persisted edge is an `EdgeRecord` written through `StateStore.putEdge`/`listEdges` (`state.ts:333`). `AnnotatedEdge` is `EdgeRecord` + a derived flag (`state.ts:988`); `ThinEdge` (`services/workspace/shape.ts:129`) and the gateway-client `Edge` (`services/gateway/client/main.ts:71`) are structural trims. There is no second edge store. **No change — convergent.**

**Audit note (ADR-0051).** This route was later found to contribute ~nothing to ranking — centrality is 0.10 weight, saturates at degree 5 already pinned by membership/type, and these edges are pruned where authored edges exist — which is why ADR-0051 added relevance as a direct signal instead (see §11).

**Connections.** Consumed by the indexer, reindex, `pruneSimilar`, `suggestions`, `ratify`, `contested`.

**Motivating ADRs.** ADR-0031, ADR-0032 (ratifiable suggestions), ADR-0006 (salience/centrality), ADR-0009 (edges), ADR-0051.

---

## 10a. similarTo as ratifiable typed suggestion (suggestions / ratify / pruneSimilar)

**What it does.** The model reframe (ADR-0032 B2+C): an inferred `similarTo` edge IS a ratification candidate — no separate `_suggestions/*` facts. `workspace.suggestions` collapses edges to unique unordered pairs (ranked by cosine desc), enriches each with endpoint type/label, flags byte-identical (`identical`) and mechanically-degenerate (`same-source`/`contains`) pairs, drops ephemeral-machinery endpoints, and annotates in-flight leases so parallel judges don't double-adjudicate. `ratify{from,to,rel}` writes a typed authored edge via the normal `link` path then drops the redundant inferred pair. `pruneSimilar` is the vector-free backfill deleting inferred edges an authored edge already connects.

**Public API** (`services/workspace/commands-search.ts`):

```ts
suggestions(input: SuggestionsInput, ctx): Promise<SuggestionsResult>; // :481
ratify(input: RatifyInput, ctx): Promise<RatifyResult>;                // :718  → { edge, dropped, ratified: true }
pruneSimilar(input: PruneSimilarInput, ctx);                           // :453  → { scanned, pruned, remaining }
const RATIFY_LINK_TYPES = ['refines','grounds','duplicates','contradicts','elaborates','relatesTo']; // similar-edges.ts:92
export const SUGGESTIONS_CONFIG_KEY = '_config/suggestions';           // :75
```

`SuggestionsInput { limit?; offset?; includeRuntime?; genuineOnly? }`. Noise-type floor `SUGGESTION_RUNTIME_TYPES` (`:51`) is slice-extensible via `_config/suggestions` and `_types/<t>` `{operational|embed:false}` (`noiseTypesFor`, `:79`).

**Data model.** `SuggestionEntry extends SuggestionCandidate { pairHash (contentHash of pairKey), fromLabel/fromType, toLabel/toType, identical?, degenerate?: 'same-source'|'contains', leasedBy?, leasedUntil? }`. Ratified edge = full-weight authored `EdgeRecord`.

**Invariants & edge cases.**
- Reciprocal A→B/B→A collapse to one pair, higher cosine kept (`suggestionCandidates`, `similar-edges.ts:119-129`).
- Authored-connected pairs excluded (`:505-506`) — self-heals if `ratify`'s drop is skipped/raced.
- Runtime/machine format-clustered types filtered by default; `includeRuntime` re-admits.
- Ephemeral (delete-timer / non-live-timer / missing) endpoints excluded, re-checked at read time (`:518-522`).
- Leases honoured under BOTH `lease/suggestion/<pairHash>` and `lease/pair/<hash>` (`:536`).
- Flagged pairs (identical/degenerate/leased) sunk below genuine ones; `genuineOnly` drops them entirely (`:573,580-581`).
- `ratify` writes `writer=you` full weight then drops the redundant inferred pair (`:727-729`).

**Reduces to.** `projection` + `fact`. A Projection preset over the inferred-edge index: select `similarTo` edges → dedup to pairs → score by cosine → shape with endpoint type/label + degeneracy/lease flags. Ratification is a plain authored-edge Fact write (`state.link`). No standalone suggestion primitive.

**Connections.** Reads the inferred-edge seam + slice records; `ratify` uses `state.link` (authored edges).

**Motivating ADRs.** ADR-0032 (the edge IS the suggestion), ADR-0031, ADR-0086 (work leases), ADR-0009.

---

## 10b. contested — semantic contradiction-candidate read (ADR-0072 Stage A)

**What it does.** A derived read surfacing semantically-near, structurally-unconnected pairs sharing a type or tag — worth checking for divergent claims. Reuses `suggestionCandidates` over the `similarTo` edges, then filters: both endpoints live, cosine ≥ `minScore` (default 0.5), not authored-connected, not mechanically degenerate, not byte-identical, shares common ground. Idempotence via `checked/<hash>` markers whose stored version VALUES are compared order-independently to current versions. Stage B (any agent) adjudicates.

**Public API** (`services/workspace/commands-search.ts:606`):

```ts
contested(input: ContestedInput, ctx): Promise<ContestedResult>;
interface ContestedInput  { limit? /* 1-50, def 10 */; minScore? /* def 0.5 */; includeRuntime? }
interface ContestedCandidate { a; b; score; aLabel; bLabel; aType; bType; sharedTags; hash; versions:{a;b} }
interface ContestedResult { candidates; total; checked; degenerate; ephemeral; hint }
```

**Data model.** `checked/<hash>` marker fact `{a,b,verdict,versions}`; `contested/<hash>` `{a,b,why,verdict}`. `hash = contentHash(pairKey(a,b))`; `versions` echoed positionally `{a,b}`.

**Invariants & edge cases.**
- Precondition: no authored edge between the pair (asserted at `:658` even though guaranteed at write time).
- Byte-identical (equal content-hash version) counted as degenerate — identical text cannot contradict (`:676-679`).
- Ephemeral/timer-deleted endpoints excluded and counted; timer-liveness re-checked, not trusted to the store (`:646-652`).
- The `checked` marker suppresses only while stored version VALUES still match both facts — version drift re-opens (`:695-701`). This fixed the earlier by-fact-key indexing bug that made `checked` always 0.

**Reduces to.** `projection` + `fact`. Another Projection preset over the inferred-edge index, tightened for contradiction (higher τ, requires shared type/tag, excludes identical/degenerate/ephemeral). Verdicts write back as ordinary Facts (`contested/<hash>`, `checked/<hash>`) and authored edges — no new write surface.

**Connections.** Same inferred-edge seam as suggestions; shares `noiseTypesFor`, `degeneracyOf`, `labelForRecord`.

**Motivating ADRs.** ADR-0072 (contradiction detector), ADR-0031, ADR-0032, ADR-0086.

---

## 11. Relevance as the sixth salience signal (intent lens on recall/query)

**What it does.** ADR-0051: rather than the ADR-0031 route (which the audit found moves ~nothing), meaning enters ranking directly as a signal INSIDE the one salience blend. `recall`/`query` accept optional `text`: `relevanceFor` embeds it once and takes the scope's vector index top-K (`INTENT_TOP_K=200`) as `{key: cosine}`; keys outside the pool score relevance 0. `intentSalience` applies the `INTENT_PRESET` under any explicit override, and TIERING runs on the blended score — so a goal-irrelevant but recently-churned plumbing fact drops out of focus while an idle-but-relevant fact rises (the first mechanism where meaning can DEMOTE noise).

**Public API** (`services/workspace/commands-read.ts`):

```ts
async function relevanceFor(vectors, scope, text): Promise<Record<string,number> | undefined>; // :44
function intentSalience(override?: Partial<SalienceOptions>): Partial<SalienceOptions>;         // :61
const INTENT_TOP_K = 200; // :36
// state.ts:662 — INTENT_PRESET { recency 0.2, velocity 0.05, attention 0.1, standing 0.15, centrality 0.1, relevance 0.4 }
// query rankBy?: 'salience' | 'recency' | 'relevance'; recall/query accept text?
```

**Data model.** Per-key relevance map `{key: cosine}` for the top-200; keys outside → 0. `relevanceWeight` joins `SalienceOptions` (`state.ts:461-464`, default 0 at `:510`); `_meta.relevance` + an `explain` row surface it (`state.ts:93,109-111`).

**Invariants & edge cases.**
- No `text` → no embedding call, `relevanceWeight` 0 (existing paths pay nothing) — `commands-read.ts:492,527,631,665` all gate on `text`.
- The vector top-K IS the bounded relevance pool — a text-read scores ~K records, never the whole scope.
- Missing/unembeddable facts get relevance 0, still reachable structurally — index stays a candidate generator.
- One embedder call per text-read (~50-150ms); the `query` is `.catch(() => [])` guarded (`commands-read.ts:53`).
- Grant fan-out re-embeds per grant owner's index (`relevanceFor(vectors, g.owner, text)`, `:542`).

**Reduces to.** `projection` + `fact` — the purest reduction to Projection. Relevance is a term in the 5-term (now 6-term) Salience score stage, resolved like every other parameter (defaults ← `_config/salience` ← lens ← per-call), inspectable via the one `explain`. It is NOT a second score averaged after the fact — it is the projection's score stage taking a per-read argument, exactly as lenses already do. The vector index only bounds the candidate pool; the authoritative facts and their scoring are unchanged.

**Connections.** Depends on the seam, `indexForScope`, and the salience Projection (`INTENT_PRESET` from `state.ts`). Same delete-timer leak caveat as search applies to `relevanceFor` (see §6 high-severity callout).

**Motivating ADRs.** ADR-0051 (relevance as a salience signal), ADR-0030, ADR-0006 (salience), ADR-0050 (recall digest), ADR-0031 (the route it supersedes for ranking).

---

## 12. Semantic 2D/3D layout — the sharded atlas (workspace.project + incremental patch)

**What it does.** `workspace.project` (owner/admin, synchronous) reads the whole slice's vector index (`store.list`) and PCA-projects it to a plane the home graph places nodes on. ADR-0082 sharded atlas: a coord-free MANIFEST at `_home/embed2d` plus `LAYOUT_SHARDS=16` hash-bucketed coord shard facts; the manifest is written LAST so a reader never sees a manifest whose shards aren't there. The stream indexer's `patchProjection` keeps it fresh incrementally — placing one more vector on the persisted basis is a few dot products, grouped per shard and CAS+retried per shard (`PATCH_ATTEMPTS=4`).

**Public API:**

```ts
// services/workspace/commands-search.ts:424
project(_input, ctx): { status; count; method; key }; // admin-gated, synchronous
// services/vector-indexer/handler.ts:191
export async function patchProjection(store, scope, puts, removes): Promise<void>; // CAS+retry, shard-aware
// platform/runtime/projection.ts
export function projectionArtifacts(vectors, keys, dim, generatedAt): { manifest; shards }; // :287
export function projectVector(vector: number[], basis: PcaBasis, norm: NormParams): [number,number,number]; // :229
export function pca(...); pca2d(...); pcaWithBasis(...);  // :83, :117, :94
export const LAYOUT_KEY = '_home/embed2d';               // :21
export const LAYOUT_SHARDS = 16;                          // :256
export const layoutShardKey = (i: number) => `${LAYOUT_KEY}/s${i}`; // :257
export function layoutShardOf(key: string, shards = LAYOUT_SHARDS): number; // :261 (djb2)
const PATCH_ATTEMPTS = 4; // handler.ts:190
```

**Data model.** Manifest `_home/embed2d` `{ method, dim, count, generatedAt, basis, norm, shards: 16 }` (~40KB stable). Shard `_home/embed2d/s<i>` `{ coords: { key: [x,y,z] } }`. Legacy monolith: `{ basis, norm, coords, count }`.

**Invariants & edge cases.**
- Manifest written LAST, after all shards (`commands-search.ts:446-448`) — readers never see a sharded manifest without shards.
- Each shard CAS'd (`ifVersion`) or created `ifAbsent`, retried on lost race with jitter (`handler.ts:284-296`); the final lost race propagates (visible, not silent).
- Incremental patch needs a persisted basis+norm — pre-basis or no-map facts are skipped until a full `project()` runs (`handler.ts:199-201`).
- `project` reads the whole index — needs ≥3 vectors, synchronous (PCA over ~1k vectors is a few hundred ms; no per-fact Titan calls). `<3` indexed vectors → `{ status: 'empty' }` (`commands-search.ts:439`).
- The shard CAS+retry replaced the original silent-no-op-on-conflict design after the ADR-0081 bulk backfill lost ~800 patches (the "cylinder halo" incident, `handler.ts:180-189`).

**Reduces to.** `fact` + `projection`. The layout is stored entirely as Facts (a manifest + 16 shard facts, typed `graph-layout` / `graph-layout-shard`), CAS'd via the Fact primitive's `ifVersion`/`ifAbsent`. The projection is a whole-index read (the one place `vectors.store.list` is used at scale) reduced to placement Facts — deliberately NOT vector-index metadata (ADR-0082 Option C rejected) to keep state substrate-native. It is the layout INPUT to the home graph Projection, not itself an access decision.

**Connections.** `project` (search commands) computes it; the stream indexer patches it; the home graph (gateway/client) renders it.

**Motivating ADRs.** ADR-0082 (sharded atlas), ADR-0047 (semantic layout stages), ADR-0030, ADR-0081 (bulk backfill that exposed the race).

---

## Gotchas / non-obvious behavior

1. **The index never decides access.** Every path (search, relevance, suggestions, contested) re-reads or re-checks against the live substrate. A stale/superseded/leaked vector can only DROP a result, never leak one — with the delete-timer exception below.
2. **Live delete-timer leases leak into search & recall after a full `reindex`.** The stream indexer drops `timerEffect === 'delete'` facts; `reindexChunk` does not, and `search`/`relevanceFor`'s re-read doesn't re-check the delete-timer. `contested`/`suggestions` DO re-check and are protected. (`handler.ts:106` vs `commands-search.ts:764-766`, `:389`.)
3. **Two dimension formulas, only one canonical.** `handler.ts:60`'s `DIM` is case-sensitive (`=== 'bedrock'`) and module-level; `vectorsFromEnv` lowercases. `VECTOR_EMBEDDER=Bedrock` would skew index names and cause a dimension mismatch. Production pins `VECTOR_DIM=1024` so it's latent.
4. **Dimension is baked into index names.** A model/dimension swap creates a fresh `slice-<scope>-d<dim>` namespace; the old index is orphaned (harmless). You must `reindex` into the new namespace after any dimension change.
5. **`_caps/` is the one embedded `_`-prefixed family.** All other plumbing keys are skipped by `embeddableText` (`vectors.ts:94`). Capability facts are meaning-addressable by design (ADR-0052).
6. **Only the first tag is a server-side filter.** `metadataForFact` collapses `tags[0]` (`vectors.ts:190`); multi-tag matching relies entirely on the authoritative re-read.
7. **`superseded` is intentionally NOT an in-index filter** in `search` — the re-read is the authority, and a boolean-filter edge case must never break the whole query (`commands-search.ts:349-352`).
8. **similarTo `strength` is fixed at 0.3; `score` carries the cosine.** Do not vary `strength` per pair — centrality weighting depends on it being constant. The cosine lives in `score` for ratification/contested ranking.
9. **Inferred edges self-heal.** `refreshSimilarEdges` reconciles to exactly the wanted set each pass; a redundant edge left after a skipped `ratify` drop is pruned next reconcile or by `pruneSimilar`.
10. **Reindex is two-phase and the phases are ordered.** Edges cannot be wired until the whole slice is embedded, so `embed` must complete before `edges` begins — and the edges phase re-embeds (no keyed vector fetch exists on `VectorStore`).
11. **The relevance route (ADR-0051) supersedes the centrality route (ADR-0031) for ranking.** Inferred `similarTo` edges still exist and feed the graph/suggestions/contested surfaces, but the audit found they move ~nothing in salience; relevance-as-a-signal is what actually reorders reads.
12. **Layout manifest is written last, on purpose.** Never reorder the `project` writes — shards first, manifest last — or readers can see a sharded manifest pointing at absent shards.
13. **The layout patch is best-effort but visible.** A lost CAS race after `PATCH_ATTEMPTS` now propagates (logged), unlike the original silent-no-op that caused the cylinder-halo incident.
14. **Two fan-out substrates for "a fact changed."** The indexer/archiver ride the DynamoDB stream; reactions/reindex ride EventBridge `workspace.fact.written`. They are not unified — know which one your change hooks into (`lib/platform-stack.ts:206-214,269`).