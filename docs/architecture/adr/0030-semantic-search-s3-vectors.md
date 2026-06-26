# ADR-0030 — Semantic search over the substrate with Amazon S3 Vectors

- **Status:** Proposed (design exploration; recommended path + increments, not built). How to add
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
- Couples to Bedrock (region/model availability) and to S3 Vectors' CDK maturity (likely L1/custom resource
  at this feature's age — note in the infra increment).

## Increments

1. **Infra + index-per-slice + docs corpus.** S3 Vectors bucket; lazily-created `slice-<scope>` indexes +
   `slice-public`; embed the existing `file/docs/*` corpus into `slice-public` (`vectors-sync.mjs`).
   `workspace.search` over `slice-public` only — semantic docs search, no per-user write path yet.
2. **Stream consumer (live indexing).** Attach the Lambda to the dormant stream; embed text fact
   create/update, delete on supersede; `sha`-skip unchanged. Per-slice search goes live.
3. **Grant fan-out + granular filters.** Fold granted owners' indexes + `slice-public` into `search`;
   `type`/`tag` metadata filters; prefix-grant post-filter. Honour `read:type:<T>`.
4. **Salience fusion + blob text.** Re-rank candidates by k-NN × salience; optional text-extraction lane so
   blob `file` facts (`s3Key` only) become searchable.

## Open questions / risks

- **S3 Vectors CDK support** at this date — L2 vs L1/custom resource for bucket+index creation.
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
