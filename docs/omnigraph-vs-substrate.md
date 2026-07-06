# Omnigraph vs. the Substrate — a comparison

> A detailed contrast between **[Omnigraph](https://github.com/modernrelay/omnigraph)**
> (modernrelay, MIT, v0.8.0, Rust, ~730★) and the **parc.land substrate** (this
> repo). The two are convergent answers to the same 2026 problem — durable memory
> and coordination for AI agents — that make *opposite bets* on the hardest part.
>
> **Sources & honesty.** The substrate side is grounded in this repo
> (`docs/substrate*.md`, the ADRs, the live `$catalog`). The Omnigraph side is from
> its README + the agent `SKILL.md` playbook + docs, read over the public web — a
> full source clone was blocked by this session's repo-scope egress policy, so
> claims about Omnigraph *internals* (merge-conflict resolution, Lance revision
> mapping) are taken from its own prose and flagged where that prose is silent.

---

## 0. TL;DR — the one-sentence bet each is making

- **Omnigraph bets that multi-agent coordination is a version-control problem.**
  Give every agent an isolated **branch**, let hundreds write in parallel, and
  **merge safely into `main`, Git-style, at graph scale.** State of record lives in
  an open **lakehouse** (Lance columnar on S3); governance is **declared as code**
  (Cedar + `cluster.yaml`). It is a portable, self-hostable *product*.

- **The substrate bets that coordination is a shared-state + attention problem.**
  There are no branches: every writer lands directly on a **blackboard** (one
  scope-partitioned store), a **monotonic supersede-not-delete trajectory** keeps
  history, **salience** surfaces what matters, and **reactivity** (subscriptions,
  declared actions, machines) drives coordination. Data and compute **co-locate**
  (organs write to the reef). It is a personal, AWS-native, serverless *organism*.

Everything below is downstream of that one divergence: **branch-and-merge vs.
blackboard-and-salience.**

---

## 1. What each one actually is

**Omnigraph** — *"Lakehouse graph database for context assembly & multi-agent
coordination."* Its own thesis: *"Omnigraph is the operational state and
coordination layer for fleets of agents. Run it as a server, declared as code;
hundreds of agents operate and enrich the graph on parallel isolated branches, and
every change is reviewed and merged safely."* A Rust engine (7 crates: compiler,
engine, policy, server, CLI, cluster, api-types) behind Axum + DataFusion, storing
[Lance](https://github.com/lance-format/lance) columnar data on any S3-compatible
store. Interfaces: HTTP/OpenAPI, CLI, TypeScript SDK (Python "coming soon"), MCP
bridge. Distributed via crates.io + Homebrew + prebuilt binaries.

**The substrate** — a personal productivity workspace built as *"the substrate
thesis"*: a blackboard of facts `{value, _meta}` with provenance, salience, links,
declared actions/views, and deployable cells. Backed by a single scope-partitioned
DynamoDB table + S3 Vectors (Bedrock Titan embeddings), fronted by serverless
Lambda "cells", spoken to over MCP (`read`/`act`/`whoami`). AWS-native (CDK IAC),
single-owner, not distributed.

---

## 2. Two theses, side by side

| | Omnigraph | Substrate |
|---|---|---|
| **Slogan** | "Git-like workflows at graph scale." | "A place that keeps" — observed, not merely stored. |
| **Unit of work** | A branch you merge. | A fact you write (and supersede). |
| **Scarce resource it optimizes** | Safe parallel write throughput at fleet scale. | Attention (what deserves to be surfaced). |
| **Primary author** | Hundreds of agents, in parallel. | One owner (+ their agents), mostly serial. |
| **Shape** | A product others deploy. | A bespoke living system. |

---

## 3. Reference table

| Dimension | Omnigraph | Substrate |
|---|---|---|
| **Multi-agent writes** | Git-style **branch** isolation + sequential merge to `main` | **Shared blackboard** (scope = partition); writes land directly |
| **History / versioning** | Commits + branches + **time-travel** | **Monotonic trajectory**, supersede-not-delete (linear, no branches) |
| **Data model** | **Schema-first**, enforced: `.pg` files, `@key`/`@card`/`@unique`/`@embed` | **Schema-light** facts `{value,_meta}`; types are cell-declared *render/handler hints*, not constraints |
| **Query** | `.gq` parameterized stored queries; one language | `read`/`query` verbs + projections; primitives composed in-Lambda |
| **Storage of record** | **Lakehouse** — Lance columnar on S3, content-addressed catalog, blob-as-data | **Operational** DynamoDB single-table + a **separate** Athena/S3 analytics lane (a projection) |
| **Retrieval** | traversal + `bm25`/`fuzzy` + vector `nearest` + **`rrf()` fusion**, one runtime | bounded-scope reads + salience rank + S3-Vectors semantic + one-hop `neighbors` (separate primitives) |
| **Salience / attention** | none (RRF ranks per-query relevance only) | **Signature**: persistent `score`/`standing`/`velocity`/`centrality` + `tending`/`attention` (importance field with decay) |
| **Reactivity** | request/response + branch merge; **no pub/sub** | **Reactive core**: change stream, subscriptions, declared actions, machines riding rails |
| **In-system compute** | none (engine + external SDK/MCP) | **Cells / organs** — deployable Lambda that extends the vocabulary and writes to the reef |
| **Authority / policy** | **Cedar** policy, server-side on every mutation, uniform across HTTP/CLI/SDK | **scope grammar + IAM `LeadingKeys`** (infrastructural) + grants/groups |
| **Provenance** | `Actor`/`Source`/`Claim{asserted_by, asserted_at, evidence_source}`; append-only keyless types; commits | `writer`/`via`/`writers[]`/trajectory; IAM-attested cell sources; supersede-not-delete |
| **Interface** | HTTP + CLI + TS SDK + MCP | MCP-native (`read`/`act`) + cells' HTTP surfaces |
| **Deployment** | Self-hostable binary, any S3 (on-prem RustFS/MinIO → S3/R2/GCS) | AWS-native serverless (Lambda + DynamoDB + S3), single account |
| **Maturity** | OSS product: MIT, v0.8, 17 releases, docs, distribution, community | Personal system, private repo, bespoke |

---

## 4. Deep dives

### 4.1 Data model & schema — *enforced types vs. emergent structure*

Omnigraph is **schema-first**. A `.pg` file declares entity types and edges with
`@key` (upsert identity), `@card` (cardinality), `@unique`, and `@embed` (which
fields to vectorize). Schema changes are **migrations**: `schema plan` (free,
non-destructive) → `schema apply` (irreversible); adding a non-nullable field
forces a make-optional → backfill → tighten dance. This buys validation, linting
(`omnigraph lint`, offline), and a stable typed graph — at the cost of ceremony.

The substrate is **schema-light**. A fact is `{value, _meta}` with arbitrary JSON
`value`; a `type` string is *indexable* but not a constraint, and a cell's
`types.json` declares only how to *render/open/edit* a type, not what shape it must
have. (The `reading/omnigraph` capture even returned the hint: *"type has no schema
— declaring its fields would let remember validate."*) Structure is **emergent**:
authored links, machine-inferred `similarTo` edges, key-encoded edges (e.g. the
`task —partOf→ goal` rule), tags, and tending. The wager: agent-authored ontologies
move too fast for lock-step migrations, so let structure accrete and be tended.

> **Bet contrast.** Omnigraph: *correctness comes from an enforced schema.* Substrate:
> *correctness comes from provenance + salience + tending over a permissive store.*

### 4.2 Storage — *lakehouse-native vs. operational-first-with-a-lane*

Omnigraph is **lakehouse-native from the ground**: one open, columnar, versioned
format (Lance) on commodity object storage, holding operational state, analytical
scans, *and* blobs (docs/images/video "as data") in the same place. No separate OLTP
store. This is a strong, coherent bet: one substrate for hot reads, big scans, and
multimodal content, with no ETL seam.

The substrate is **operational-first**: DynamoDB single-table (scope = partition)
for single-digit-ms bounded reads, guarded writes (CAS via `ifRevision`), a
TTL-bounded trajectory, and GSIs for typed/inbound-edge reads. Ad-hoc/analytical
SQL is a **separate lane** — the Firehose → S3 → Glue → Athena projection (see
`docs/substrate-analytics.md`) — a *derived read model*, not the source of truth.

> This is the single place where the two are **converging**: the substrate's new
> analytics lane is a first step toward the unified operational+analytical posture
> Omnigraph has by default. The difference that remains: Omnigraph *unifies* them in
> one format; the substrate *splits* fast-KV truth from a columnar mirror — trading
> Omnigraph's coherence for DynamoDB's hot-path latency + IAM-partition isolation.

### 4.3 History & versioning — *parallel branches vs. linear trajectory*

Omnigraph gives **commits, branches, and time-travel** — parallel histories you can
fork, inspect, and reconcile (`commit list --branch main` to verify a write landed).
History is a DAG.

The substrate gives a **monotonic trajectory**: supersede-not-delete, every
revision retained, but **linear** — there is no parallel branch to explore an
alternative and merge it back. (The Athena lane makes that trajectory *permanent*
past the DynamoDB TTL, but it's still one timeline.) You can see how a fact evolved;
you cannot fork the world, try two things, and merge the winner.

> **Bet contrast.** Omnigraph treats *exploration* as first-class (branch, try,
> merge/discard). The substrate treats *accretion* as first-class (write, supersede,
> let salience sort it out). The former suits speculative parallel work; the latter
> suits a single evolving record of truth.

### 4.4 Multi-agent coordination — **the deep axis**

This is where they most diverge, and it's the crux.

**Omnigraph — isolation + merge.** Each agent (or task) gets a branch:
`branch create agent/ingest-42 --from main` → write/load on the branch → `branch
merge agent/ingest-42 --into main`. Hundreds write in parallel without stepping on
each other because they're isolated; reconciliation happens at merge. Crucially, the
coordination is **structural, not algorithmic**: the playbook tells agents to
*narrow their domain* (one owns `Claims`, another `Signals`), reconcile by
**provenance** rather than a diff algorithm, and use **append-only keyless types**
(retraction + re-insert) so immutable facts never collide. Merges are sequential
into `main`.

- **What's underspecified (and it matters):** neither the README nor the SKILL
  documents *what a merge does when two branches touch the same keyed node* —
  conflict detection, resolution policy, or failure mode. "Merged safely, Git-style"
  is asserted; the hard part of git-for-data — semantic merge of graph state — is
  the least-documented part. At v0.8, treat "safe merge" as a design intent whose
  mechanics you'd want to verify against source before betting a fleet on it.

**Substrate — shared blackboard + reactivity.** There are no branches. Every write
lands directly in a scope partition; authority is *scope = partition*, enforced
infrastructurally by IAM `LeadingKeys` (Σ-calculus Theorem 3 as an infra guarantee).
Coordination is **reactive**: a change stream feeds subscriptions and declared
actions; machines (DyGram rails) advance off fact writes; the reactor re-delivers
every change so `_subscriptions/*` can fire. Contention on the *same key* is handled
optimistically (`ifRevision`/`ifAbsent` CAS), not by isolation.

- **What's unsolved (and it matters):** the substrate is effectively
  **single-writer-per-slice**. "Rooms" (shared multi-writer scopes) are an explicit
  *deferred* product decision (`docs/substrate-storage.md`). Two agents writing the
  same key race to last-writer-wins unless they hand-roll CAS. There is no branch to
  isolate parallel exploration.

> **This is the sharpest mutual lesson.** Omnigraph's **branch model is a concrete,
> shipped answer to the substrate's deferred "rooms" question.** Conversely, the
> substrate's **reactivity + salience** are things Omnigraph flatly lacks (it has no
> pub/sub; coordination is pull + merge). Each has built the thing the other deferred.

### 4.5 Retrieval & context assembly — *one fused runtime vs. composed primitives*

Omnigraph fuses **graph traversal + vector ANN + full-text (`bm25`/`fuzzy`) +
Reciprocal Rank Fusion (`rrf()`)** in **one** query language over DataFusion. For
"assemble the best context for this prompt," that's a genuinely strong primitive: a
single query ranks across modalities with principled fusion.

The substrate has the same *ingredients* — S3-Vectors semantic search (Titan
embeddings), salience-ranked `query`, one-hop `neighbors`, tag/type/prefix filters —
but they are **separate primitives composed in-Lambda**, not one fused query. Its
distinctive addition is **salience-aware ranking**: results are weighted by a
persistent importance field, not just query-time relevance.

> **Bet contrast.** Omnigraph bets on *fusion at query time* (RRF across modalities).
> The substrate bets on *a standing importance field* (salience) plus semantic
> recall. Omnigraph is the stronger pure-retrieval engine today; the substrate knows
> which facts *matter in general*, not just which match *this* query.

### 4.6 Salience & attention — *the substrate's signature, absent in Omnigraph*

The substrate models **attention as a first-class, decaying field**: `score`,
`standing` (earned importance), `velocity` (recent burst), `centrality` (graph
position), plus `tending`/`attention` passes that flag stale/unlinked/dangling facts
and a daily hygiene routine. It's an *attention economy* over the graph.

Omnigraph has **no analog**. RRF ranks relevance *within a query*; nothing persists a
notion of "this fact deserves attention in general," decays it, or self-maintains.
For a fleet's operational state that may be the right minimalism (let the app decide
importance); for a *memory* meant to surface the right thing unprompted, it's a gap.

### 4.7 Extensibility & in-system compute — *organs vs. external SDK*

The substrate blurs **data and compute**: "cells" are deployable Lambdas that live
beside facts, publish tools into the same catalog, and **write to the reef** through
an IAM-attested organ path (the `@c15r/tasks` cell built in this repo is an example —
it *is* the task manager, co-located with the tasks it manages). Logic that extends
the vocabulary lives *inside* the system.

Omnigraph keeps **engine and application separate**: the engine stores/queries; logic
lives in external clients (CLI, SDK, MCP host). Cleaner separation, more portable
engine — but no in-system organs; behavior isn't co-located with data.

### 4.8 Authority & policy — *declarative policy language vs. infrastructural partition*

Omnigraph uses **Cedar**, enforced **server-side on every mutation**, per-graph and
cluster-wide, *uniform across HTTP/CLI/SDK* ("every write path goes through the same
Cedar gate"). A real, expressive, auditable policy language — the right tool when
many principals with varied rights share one deployment.

The substrate uses a **scope grammar + IAM `LeadingKeys`**: authority is the
partition prefix, so cross-scope access is *infrastructurally impossible*, not
policy-checked. Plus a gateway scope gate (e.g. `workspace.athena` requires
`platform:*`) and grants/groups. Less expressive than Cedar, but isolation is a
property of the substrate, not a rule that can be misconfigured.

> **Bet contrast.** Omnigraph: *rich policy, enforced everywhere.* Substrate:
> *coarse isolation, guaranteed by infrastructure* — with per-capability scope gates
> layered on top.

### 4.9 Provenance & trust — *the one place they strongly agree*

Both treat provenance as first-class and prefer **append-only / retract-don't-mutate**
over destructive edits. Omnigraph: `Claim{asserted_by:Actor, asserted_at,
evidence_source:Source}`, immutable keyless types, commit audit. Substrate:
`writer`/`via`/`writers[]`, supersede-not-delete trajectory, IAM-attested cell
sources so an organ can't forge attribution. Convergent evolution — both learned that
agent-written data is only trustworthy if you can always answer *who asserted this,
when, and on what basis.*

### 4.10 Deployment, operations, distribution

- **Omnigraph** is a **portable product**: one Rust binary, any S3-compatible store,
  on-prem to cloud, installed via crates.io/Homebrew, `cluster.yaml` declared-as-code
  with idempotent `cluster apply` (Terraform-style). Runs anywhere; you operate it.
- **The substrate** is **AWS-native serverless**: Lambda + DynamoDB + S3 Vectors +
  EventBridge, CDK-deployed, scales to zero, no idle cost — but **AWS-locked** and
  single-account. Not something you hand to someone else to run.

### 4.11 Maturity & ecosystem

Omnigraph is a real, externalized OSS project (MIT, v0.8.0, 17 releases, 662 commits,
comprehensive docs, published binaries, an agent skill) — though young: **no
published benchmarks**, merge internals underspecified, Python SDK pending. The
substrate is a **bespoke personal system** in a private repo — richer in ideas per
line (salience, tending, machines, organs) but not distributable, benchmarked, or
battle-tested by a community.

---

## 5. The bets, extrapolated

**What Omnigraph is wagering will matter:**
1. **Fleets, not soloists.** The future is *hundreds* of agents on shared state; the
   binding constraint is *safe parallel writes*, and **git-style branching is the
   proven pattern** for that.
2. **Open lakehouse wins.** One versioned columnar format on commodity object storage
   for operational + analytical + multimodal beats a stack of specialized stores.
3. **Governance-as-code is non-negotiable** once many principals share state (Cedar +
   `cluster.yaml`).
4. **Fused retrieval** (RRF across traversal/vector/FTS) is the right context-assembly
   primitive.
5. **Portability matters** — teams will self-host their agent memory, not rent it.

**What the substrate is wagering will matter:**
1. **Attention is the scarce resource.** With unbounded agent-written data, the
   problem isn't storing or querying — it's *surfacing the right thing unprompted*, so
   **salience/tending must be first-class.**
2. **Coordination is shared state + reactivity**, not merge: a blackboard everyone
   observes, with reactions and machines, beats isolate-and-reconcile — *at the scale
   of one person and their agents.*
3. **A small, closed primitive set** (fact / reference / declaration) with emergent
   structure outlasts schema-first rigidity.
4. **Data and compute should co-locate** (organs), so behavior lives with the truth it
   maintains.
5. **Personal, serverless, AWS-native** — a living system for one, not a product for
   many.

The bets are *not* contradictory so much as **scale-dependent**: Omnigraph optimizes
the many-writer/fleet regime; the substrate optimizes the one-owner/attention regime.

---

## 6. Strengths & weaknesses

### Omnigraph
**Strengths** — portable & self-hostable; open lakehouse (no lock-in; operational +
analytical + multimodal unified); strong typed schema + migrations + linting; unified
RRF retrieval; branch isolation scales cleanly to many parallel writers; Cedar
governance uniform across every interface; a real product with distribution, docs, and
a community; Rust performance headroom.
**Weaknesses** — **merge-conflict semantics are undocumented** (the hardest part of
git-for-data is the least-shown); **no attention/salience** (relevance ≠ persistent
importance); **no reactivity** (no pub/sub/triggers); **no in-system compute**; young
(v0.8, no benchmarks, Python SDK pending); **sequential merge to `main`** is a
potential throughput bottleneck at true fleet scale; schema-first ceremony can lag
fast-moving agent ontologies; a columnar/S3 lakehouse is typically *worse* than a KV
store for hot single-fact latency (architecturally likely; unverified).

### Substrate
**Strengths** — **salience/attention/tending** (surfaces + self-maintains, unique);
**reactive core** (event-driven coordination, machines); **in-system organs** (cells
extend the vocabulary and write truth); **infrastructural isolation** (scope =
partition, impossible to violate); fast operational KV (single-digit-ms bounded
reads); deeply MCP/agent-native; serverless (scales to zero, no idle cost); emergent
structure over rigid schema; conceptual economy (closed primitive set).
**Weaknesses** — **single-writer-per-slice**; no branch isolation → parallel writers
race to last-writer-wins (only optimistic CAS, and "rooms" are deferred); **no unified
retrieval language** (primitives composed in-Lambda); **operational/analytical split**
(needs the separate Athena lane; not lakehouse-native); **schema-light** → weaker
validation; **linear history** (no fork/try/merge); deep/recursive graph traversal is a
known ✗; **AWS-locked**, personal/bespoke, not a product; unproven beyond one owner.

---

## 7. Failure modes — where each breaks

- **Omnigraph:** two agents mutate the same keyed node on different branches → a merge
  that must resolve a conflict whose policy isn't documented (last-writer-wins? manual?
  reject?) — the "safe" claim rides on this. Sequential merge into `main` serializes
  the fleet's write-commit path → a throughput ceiling. Lock-step `schema apply`
  centralizes schema evolution → a coordination bottleneck. Hot single-fact reads over
  a columnar lakehouse may disappoint latency-sensitive paths.
- **Substrate:** two writers (or one agent across sessions) hit the same key → lost
  updates unless every writer remembers CAS. Mis-tuned salience → important facts
  elided or noise surfaced (mitigated by tending, but it's a tuning surface).
  Runaway reactions (subscriptions/machines firing each other). Fleet scale is simply
  unproven — the model is built for one owner.

---

## 8. Cross-pollination — what each could steal

**Substrate ← Omnigraph**
- **Branch isolation** for parallel agent writes — the shipped answer to the deferred
  *rooms* problem. Even a lightweight "scratch branch → review → merge to slice" would
  unlock safe multi-agent authorship.
- **A unified retrieval query** with RRF fusion over S3-Vectors + `gsi-type` + edges,
  instead of composing primitives in-Lambda.
- **Lakehouse-native storage** as the long arc — the Athena lane is step 1; folding
  operational + analytical toward one columnar store is the Omnigraph-shaped endgame.
- An **optional schema-first mode** for load-bearing types (validate the facts that
  must be well-formed; leave the rest emergent).

**Omnigraph ← Substrate**
- **Salience / attention** as a *persistent, decaying* importance field — beyond
  per-query RRF — so a memory can surface the right thing unprompted.
- **Reactivity** (subscriptions / triggers / a change feed) — it has none; a fleet
  coordinating purely by pull + merge is missing the event half.
- **In-system compute organs** — logic co-located with data, extending the vocabulary.
- **Tending** — a self-maintaining hygiene pass that keeps the map honest.

---

## 9. When to choose which

Choose **Omnigraph** if: you're building for **many agents / teams**; you need
**portability + self-host + open storage**; you want **governance-as-code** and a
**typed, migratable schema**; you value **fused multimodal retrieval**; and you're
comfortable coordinating via **git-style branches** and can verify merge semantics
against your workload.

Choose the **substrate** (or its ideas) if: you want a **personal / small-team living
memory** where **attention, reactivity, and co-located compute** matter more than
parallel-writer throughput; you're the **primary author**; you value **conceptual
economy** and **emergent structure**; and **AWS-native serverless** (scale-to-zero, no
ops) fits.

---

## 10. Synthesis

Omnigraph and the substrate are the **same species** — agent-native, versioned,
graph-shaped, semantically searchable, provenance-first, policy-gated, MCP-spoken —
that **diverge on the coordination primitive**. Omnigraph **externalizes** coordination
into *version control*: isolate on a branch, merge into `main`. The substrate
**internalizes** it into *shared state + salience + reactivity*: land on the blackboard,
let attention and reactions sort it out.

Each has already built what the other deferred: Omnigraph has **branch isolation** (the
substrate's open "rooms" question); the substrate has **salience, reactivity, and
organs** (Omnigraph's missing attention/event/compute layer). Omnigraph is a
**database product** optimized for *safe parallel throughput at fleet scale*; the
substrate is a **personal organism** optimized for *attention and conceptual economy at
one-owner scale*. Neither dominates — they optimize different scarce resources, and the
most interesting future is the one that borrows across the seam.
