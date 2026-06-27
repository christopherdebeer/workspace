# ADR-0030 — Semantic search over the substrate with Amazon S3 Vectors

- **Status:** Accepted — **shipped + live (all increments).** The vector seam + `workspace.search`;
  `S3VectorsStore` + runtime bucket/index + admin `reindex`; the DDB-stream live indexer; grant fan-out +
  granular filters; and **Bedrock Titan v2 embeddings (1024-dim) — now live**. Validated end-to-end on prod:
  a query sharing almost no literal words with its targets (*"how do I let an AI assistant act on my behalf
  without giving it my full powers"*) returned the delegation/authority/token-principal docs ranked top —
  true semantic match beyond lexical overlap. (Salience-fusion ranking remains an optional follow-on.)
  Originally: how to add
  *semantic* search to the substrate — over fact values and `file` content (ADR-0027) — using **Amazon S3
  Vectors**, fed by the (currently dormant) DynamoDB Stream, while preserving the substrate's
  **scope / grant / slice isolation** by construction.
- **Date:** 2026-06-26
- **Context:** Search today is `workspace.query({ contains })` — a case-insensitive substring scan
  (`recordContains`, `platform/runtime/state.ts:913`) over key + stringified value. ADR-0027 §4 explicitly
  flagged "true content search beyond `contains` would need a search index — out of scope." ADR-0027 also
  gave us the *thing to embed*: `file` facts carry inline `content` for docs (`scripts/docs-sync.mjs`) and
  text fact values are already first-class. Three substrate facts make S3 Vectors a natural fit:
  - The `SubstrateTable` has **Streams on (`NEW_AND_OLD_IMAGES`)** (`platform/infra/substrate-table.ts:51`)
    but **no consumer** — free, ordered, replayable change-capture capacity.
  - Scope is the **partition prefix** `STATE#<scope>` (`dynamo-state-store.ts:55`), already "the authority
    boundary" via IAM `dynamodb:LeadingKeys` (`substrate-table.ts:21`).
  - `recall` already **folds granted slices at read time** (own ∪ grants ∪ public), with three grant
    shapes — whole-slice `*`, prefix `…*`, exact key (`grants.ts:65`).
- **Depends on:** ADR-0027 (files-as-facts — the corpus to embed), ADR-0007 (Grant axis — `public`/group
  folds), ADR-0023 (`read:type:<T>` — semantic search must honour granular read scope), ADR-0006 (salience
  — candidate re-ranking), ADR-0029 (R1 inline affordances — `search` returns the same `{entries, types}`).

---

## What S3 Vectors is (and what it is not)

A native S3 capability: **vector buckets** hold **vector indexes**; each index is created with a fixed
dimension + distance metric (cosine/euclidean). `PutVectors` stores `{key, vector, metadata}`;
`QueryVectors` does top-k k-NN with an optional **metadata filter** predicate; `DeleteVectors`/`GetVectors`/
`ListVectors` round it out. It is **storage-tier** vector search — *sub-second* (not single-digit-ms),
~10× cheaper than a hot vector DB / OpenSearch, scales to tens of millions of vectors per index, many
indexes per bucket. It is **not** a low-latency hot path, a transactional store, or an authorization
boundary. That profile fits a personal-productivity workspace: interactive, modest corpus, cost-sensitive,
not QPS-bound.

## Decisions

### 1. The vector index is an **index, not an authority** — it generates *candidates*, never grants access

The single most important decision. Semantic search returns candidate **keys** (per slice); the
`workspace.search` handler then **re-reads each candidate authoritatively** via `state.get(scope, key,
viewerIdentity)` and the existing grant check — exactly the path `peek`/`recall` already use. So:

- **Freshness** is re-checked: supersession, delete-effect timers (lazy-at-read, no scheduler), and
  the live value all come from DDB, not the (eventually-consistent) index. A stale or lagging vector can
  only ever cause a *candidate* to be dropped on re-read — never a wrong or leaked result.
- **Authorization** is re-enforced: scope/grant/`read:type:<T>` are applied on the authoritative read with
  the viewer's identity. **Even if the index's isolation metadata were wrong, nothing leaks** — the index
  is never trusted for access control. This is defense-in-depth and it makes the "soft filter" worry moot.

The index is a *recall accelerator* layered over the authoritative substrate, never a parallel source of
truth.

### 2. Isolation by construction: **index-per-slice**, mirroring `STATE#<scope>` + the `public` fold

Two candidate isolation models:

- **(A) One shared index + metadata filter** — every vector tagged `scope`, queries inject
  `scope = viewer OR audience ∈ grants`. Rejected as the *primary* boundary: grants are dynamic
  prefix/whole-slice **patterns**, which don't map to metadata equality, and a single filter bug spans
  every user. (We still use metadata *within* a slice — see below.)
- **(B) One index per slice** (`index = slice-<scope>`) — **chosen.** It mirrors the DDB scope partition
  1:1, so the isolation boundary is *structural*: a `QueryVectors` call names exactly one slice's index;
  you cannot reach another slice's vectors without naming its index, and IAM can scope the query role per
  index-prefix just as `LeadingKeys` scopes the table. Grant-folding then **reuses `recall`'s assembly**:
  fan out `QueryVectors` across the indexes the viewer may read — own + the **shared `slice-public`
  index** (the ADR-0027 docs corpus / `public` shares, folded into every viewer exactly as today) +
  each granted owner's index — and merge by score. The three grant shapes map cleanly:
  - **whole-slice (`*`)** → query the owner's whole index;
  - **prefix (`…*`)** → query the owner's index, **post-filter candidates by `key.startsWith(prefix)`**
    before the authoritative re-read (S3 Vectors metadata filtering is equality/range, not arbitrary
    prefix — and post-filtering top-k in the Lambda is cheap and exact);
  - **exact key** → skip the vector query, the grant is one known key.

  Within each slice's index, vectors still carry **metadata** — `type`, `tags[]`, `superseded` — so a
  `read:type:<T>` granular token's search injects a `type = T` metadata filter (honouring ADR-0023), and
  the common in-slice filters run server-side before k-NN scoring.

The net: isolation is enforced at **three** layers — index partition (structural), in-index metadata
filter (granular scope), and the authoritative DDB re-read (final word). No single failure leaks a slice.

#### 2a. Revisited — should we weaken the structural boundary, since we fan out and grant-filter anyway?

A fair challenge: if the authoritative re-read (Decision 1) is the real authorization boundary, and we
fan out across indexes + post-filter by grant regardless, is the per-slice *structural* boundary earning
its keep — or should we collapse to **one shared index + a `scope ∈ {…}` metadata filter** (model A) for
operational simplicity? Verdict: **keep the structural boundary — but recognise it costs ~nothing today,
so the trade-off is not actually live yet.**

The load-bearing insight: **fan-out is driven by the GRANT model, not the isolation model.** A viewer
reads from a *set* of owners (own ∪ public ∪ granted) — that set exists whether each owner is a separate
index or a partition inside one index. So "we fan out anyway" is **not** an argument to collapse: a single
shared index still has to express "these N owners with these key-patterns," which is fan-out in predicate
form — and grants (whole-slice / prefix / exact / group / public, *per viewer*) do **not** reduce to a
static metadata predicate, so you'd post-filter anyway. Collapsing doesn't remove the complexity; it moves
it from an auditable per-index boundary into a filter expression you must get right on **every** future
code path. What collapsing *does* give up is real:

- **IAM blast radius** — a single shared index means every query principal can read *all* vectors; the
  only separation is the app filter. That's a regression from the substrate's existing `LeadingKeys`
  partition posture (`substrate-table.ts:21`). Per-index lets IAM scope the role per index-prefix.
- **Candidate-key/metadata leakage pre-re-read** — Decision 1 denies the *value*, but a shared index
  returns foreign candidate **keys + metadata** (a key like `medical/…` or `_secret/…`, plus its type/tags)
  into the handler's working set *before* the re-read denies it. Per-index never surfaces them. Defense in
  depth means the backstop is not the *only* stop.
- **Audit surface** — "you can't query an index you don't name" is a one-line invariant; "the OR-of-grants
  filter predicate is correct on all paths" is a standing proof obligation.

And the cost the challenge worries about — N indexes, lifecycle, fan-out latency — **does not exist in the
current single-owner reality.** "Index-per-slice" degenerates today to exactly **two** indexes: the one
owner's private index + the shared `slice-public`. Fan-out N ≈ 1. So the structural boundary is essentially
free *now* and scales correctly into multiplayer later.

**When weakening would become worth it:** if real multiplayer makes fan-out N large (a viewer reading
hundreds of slices → N `QueryVectors` calls per search becomes a latency/cost problem) **and** cross-slice
global ranking quality matters (one k-NN over the union ranks by true cosine; fan-out+merge needs score
comparability — an open question below). At that point, revisit. To keep the decision **reversible**, the
indexing layer routes vectors through a single `indexFor(scope)` seam (today → `{ private-owner,
slice-public }`; later → per-user; or → a few trust-tier indexes): collapsing or re-splitting is then one
function + a re-embed, not a rearchitecture. **Recommendation: keep structural isolation; don't pay for
per-user indexes prematurely (today it's 2 indexes total); gate any collapse on a *measured* multiplayer
fan-out problem, not on the symmetry observation alone.**

### 3. Ingestion: the dormant DDB **Stream** → embed → `PutVectors` (not the EventBridge bus)

A dedicated Stream consumer Lambda on the existing `NEW_AND_OLD_IMAGES` stream:

- **create/update** (NEW_IMAGE) → embed the fact's text, `PutVectors(slice-<scope>, {key, vector,
  metadata:{type,tags,superseded:false,sha}})`. Skip if the content `sha` is unchanged (the docs-sync
  idempotence trick) so a metadata-only rewrite doesn't re-embed.
- **supersede/delete** (OLD_IMAGE present, NEW absent or `superseded:true`) → `DeleteVectors` (or flip the
  `superseded` metadata). Authoritative removal still happens at re-read time (Decision 1); this just keeps
  the index lean.

**Why the Stream, not `workspace.fact.written`:** the stream is the *authoritative, ordered, per-key*
change log with **old+new images** (needed to detect supersede and to diff content) and is **replayable**
for backfill; the EventBridge bus is best-effort, unordered, and carries only `{scope,key,revision}`. The
reactor stays on the bus (it drives declared actions); indexing is a separate, idempotent ETL lane that
does not contend with or perturb the reactive substrate. The stream is on and unused today — this is its
first consumer.

#### 3a. Control plane vs data plane — indexes are created at **runtime**, not in CDK

Indexes are **per-slice** (`slice-<scope>`), so they cannot be CDK-templated: a slice's index can't exist
at deploy time for a user/scope that doesn't exist yet. This is the same control-plane/data-plane split
the **cells** subsystem already uses — `services/cells/provisioner.ts` calls itself *"the runtime half of
'CDK, but deployed at runtime'."* S3 Vectors maps onto it exactly:

- **Control plane (CDK, deploy-time, templated once):** the stream-consumer Lambda + its DynamoDB-stream
  event-source mapping + IAM (`s3vectors:*` on the fixed vector-bucket ARN, `bedrock:InvokeModel` on the
  Titan model ARN). All standard constructs — **no `aws-cdk-lib` upgrade needed** (Lambda + event-source
  mapping are long-stable; the `aws-s3vectors` L1 constructs in 2.260 are therefore *not* required).
- **Data plane (runtime API calls, per-entity, NOT in CDK):** the indexer **creates the vector bucket
  (fixed name) and the `slice-<scope>` / `slice-public` index `CreateIndex`-if-absent on first use**, just
  as `cells.create` provisions a cell on demand. IAM grants against the *known* bucket ARN, so the bucket
  needn't exist at deploy. The v3 `s3vectors` client is a runtime requirement regardless
  (`CreateIndex`/`PutVectors`/`QueryVectors`), making it a purely additive dependency.

This is why the only deploy-time change is a Lambda + stream mapping + IAM — the existing 5 stacks are
otherwise untouched.

### 4. What gets embedded

Text-bearing fact values + `file` inline `content` (docs). **Skip**: `_`-prefixed plumbing facts
(`_types/`, `_subscriptions/`, `_config/`, `_reaction-errors/`, …), and `file` facts that are *blob
pointers* (`s3Key`/`url`, no inline `content`) — until/unless a text-extraction step is added (a separate
increment; e.g. Textract/parse on `PutObject`). Embedding model: **Bedrock Titan Text Embeddings v2**
(1024-dim, cosine, normalized) as the default — index dimension/metric are fixed at creation, so this is a
one-time choice; Cohere Embed is a drop-in alternative. Embed cost is per-token and only on text facts, so
it tracks the (modest) corpus.

### 5. Query surface: `workspace.search` — a third read verb beside `query` and `contains`

`act`/`read` target `workspace.search`, `kind:'read'`:

```
input:  { text, type?, tag?, owners?, limit? }
flow:   embed(text) → for each readable index (own, slice-public, granted owners):
          QueryVectors(index, vector, k=limit, filter:{ type?, tag?, superseded:false })
        → merge candidates by score → post-filter prefix-grants by key
        → authoritative re-read each (state.get + grant check, viewer identity)   ← Decision 1
        → optional salience re-rank (fuse k-NN score × _meta.score, ADR-0006)
result: { entries:[…], types:{…} }    ← same shape as query (ADR-0029 R1)
```

`contains` stays as the **exact-substring floor** (find "the fact that literally says X"); `search` is the
**fuzzy/semantic** layer ("facts *about* X"). Returning the same `{entries, types}` envelope means an agent
acts on a semantic hit with zero new ergonomics (R1). Salience fusion is the interesting follow-on:
"relevant **and** important," not relevance alone.

## Isolation analysis (the explicit requirement)

| Concern | Mechanism |
| --- | --- |
| **Slice isolation** | Index-per-slice — a query names one slice's index; IAM scopes the query role per index prefix (analogue of `LeadingKeys`). |
| **Grant scope** | Fan-out across exactly the viewer's readable indexes (own ∪ public ∪ granted owners), reusing `applicableGrants`; prefix grants post-filtered by key. |
| **Granular read scope (ADR-0023)** | `read:type:<T>` → `type = T` metadata filter on `QueryVectors`. |
| **Freshness (supersede/timer)** | Authoritative DDB re-read per candidate — the index never serves a stale or retired fact. |
| **Final authority** | All access decided on the authoritative read with the viewer's identity; the index is advisory. A wrong vector drops a candidate, it cannot leak one. |
| **`public` corpus** | The ADR-0027 docs live in `slice-public`, folded into every viewer's fan-out exactly as the `public` share folds into `recall`. |

## Consequences

- Semantic recall over the whole substrate and the public docs corpus, scoped correctly, for ~storage cost.
- A new background lane (Stream consumer + Bedrock + S3 Vectors) — new infra/IAM, but isolated from the
  hot path and the reactor.
- The index can drift (eventual); harmless by Decision 1. Backfill = replay the table (scan per slice →
  embed → `PutVectors`) or replay the stream; a `vectors-sync.mjs` mirrors `docs-sync.mjs`.
- Couples to Bedrock (account model-access + region availability) — the one true external prerequisite;
  handled behind an `Embedder` seam so infra + pipeline deploy/validate before Titan access is confirmed.
  S3 Vectors itself needs **no** CDK-lib bump: bucket + indexes are runtime `Create…`-if-absent calls (§3a).

## Increments

> **Status (2026-06-26):** ALL increments shipped + **live-validated** on prod (deploys #251–#254). 0–2
> validated as below; 3 implemented + unit-tested (live cross-user needs a 2nd principal — single-owner
> today); **4 live** — Titan v2 embeddings (1024-dim) validated with a low-lexical-overlap query that still
> surfaced the right conceptual cluster. The flip re-namespaced indexes to `slice-<scope>-d1024`; the old
> 256-dim hashing index is orphaned and harmless. Optional remaining: salience-fusion ranking.
>
> Live validation evidence: `reindex {prefix:"file/docs/"}` embedded 70 docs into `slice-c15r`; a semantic
> `search "tokens as principals delegation and attenuation"` returned ADR-0024/0022/plan/0025 ranked; a
> fresh fact written with **no `reindex`** was the #1 hit within seconds (dormant stream → `VectorIndexer`
> → `PutVectors` live); superseding it dropped it from results immediately (authoritative re-read).

0. **Seams + reference backend (deploy/validate with no external prereqs). ✅** `Embedder` + `VectorStore`
   interfaces and an `indexForScope` seam; a `MemoryVectorStore` (unit tests) and a deterministic
   `HashingEmbedder` fallback so the *whole* pipeline — index create-if-absent, `PutVectors`, fan-out,
   prefix post-filter, authoritative re-read, `workspace.search` R1 envelope — is exercisable before
   Bedrock/S3 Vectors are wired. (This is the engineering enabler the rest build on.)
> **`reindex` is async + chunked (added 2026-06-26).** A full-slice backfill (the substrate has ~1.3k
> facts; ~200s of Titan calls) far exceeds the ~30s CloudFront→Function-URL edge cap *and* the 60s Lambda.
> So `reindex` no longer runs inline: the command records a `_reindex/<scope>` status fact, emits a
> `workspace.reindex.requested` event, and returns `{status:'started', poll}`. `createReindexHandler`
> then processes one bounded page per invocation off the bus, chaining continuation events — two phases
> (`embed` the whole slice, then `edges`, since `similarTo` needs the full index present), each chunk well
> under 60s, resumable, idempotent on EventBridge retry. Poll the status fact for `{status, phase,
> indexed, edges}`. (Mirrors the `models`/`run` async-job pattern; the ~30s edge is why they're async too.)

1. **Infra + S3 Vectors backend + corpus. ✅** `S3VectorsStore` (runtime bucket + index create-if-absent);
   IAM + env on the workspace Lambda. The corpus backfill landed as the admin **`reindex`** command (scan
   → embed → `PutVectors`) rather than a separate `vectors-sync.mjs` — it runs in-Lambda where the
   IAM/env/client already live, doubles as manual re-sync, and validated live by indexing the 70-doc
   corpus. Indexing is **per-slice from the start** (`slice-<scope>`), not `slice-public`-only.
2. **Stream consumer (live per-slice indexing). ✅** `VectorIndexer` Lambda on the dormant stream;
   `planStreamWork` embeds create/update, drops on supersede/REMOVE, `sha`-skips unchanged, creates
   `slice-<scope>` on first use. Validated live (fresh fact searchable with no `reindex`).
3. **Grant fan-out + granular filters. ✅ implemented + unit-tested** (live cross-user pending a 2nd
   principal). `search` fans out across own slice + applicable grants' owners (mirrors `recall`), prefix
   grants post-filtered by key, `type`/`tag` metadata filters, `read:type:<T>` honoured. The shared
   `slice-public` optimization is deferred (single-owner → own slice already holds the public corpus).
4. **Bedrock + salience fusion + blob text.** ✅ **Bedrock live** — `VECTOR_EMBEDDER=bedrock` +
   `VECTOR_DIM=1024` on both Lambdas (config flip, no code change; model access auto-enabled on first
   invoke). `reindex` re-embedded the 70-doc corpus into `slice-c15r-d1024` via Titan; semantic ranking
   validated. ⏳ Optional follow-ons: re-rank candidates by k-NN × salience (`_meta.score` is already on
   each hit); text-extraction lane so blob `file` facts (`s3Key` only) become searchable.

## Open questions / risks

- ~~S3 Vectors CDK support~~ — **resolved:** indexes are per-slice → created at **runtime** (§3a), not
  CDK; the bucket is a fixed-name runtime create-if-absent. No `aws-cdk-lib` bump. (`aws-cdk-lib@2.260`
  *does* ship `CfnVectorBucket`/`CfnIndex` if a deploy-time bucket is ever preferred, but it isn't needed.)
- **Bedrock model access** — the one true external prerequisite (Titan v2 enablement on the account +
  region). Gated behind the `Embedder` seam: Increments 0–3 deploy/validate without it; Increment 4 flips
  to `BedrockEmbedder`.
- **Per-vector metadata limits** — confirm `tags[]` cardinality fits the filterable-metadata budget; if
  not, index only `type` + `superseded` and post-filter tags.
- **Index lifecycle for ephemeral slices** — when does a `slice-<scope>` index get created/torn down? Lazy
  on first write; GC on slice deletion (rare today, single-owner).
- **Embedding drift** — if we change models/dimension later, indexes must be rebuilt (full re-embed). Pin
  the model + dimension in a `_config/vectors` fact for provenance.
- **Cross-slice ranking** — merging k-NN scores across independently-built indexes is sound for cosine on a
  shared model; verify score comparability before fusing with salience.
- **PII / shared corpus** — only `public`-shared facts ever enter `slice-public`; never auto-promote a
  private fact to the shared index.
