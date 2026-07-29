# Linking without unlinking

*2026-07-29 — the content-lifecycle audit, and what opening the queue found that counting it missed.*

## The question

> "we are accruing content but not organising and maintaining content just adding and
> linking"

The audit that followed produced a set of numbers that all pointed the same way:

| | |
|---|---|
| facts in the slice | 7,652 |
| elided (below the salience floor) | 6,053 · 79% |
| from `docs-sync` → `lit` decompose | 5,588 · 73% |
| authored semantic edges | 376 |
| inferred semantic edges | 33,105 · **1:88** |
| suggestions pending | 15,482 |
| ratifications per consolidation cycle | 5 |
| new suggestions per day | +169 · **34:1** |
| contested pairs / ever adjudicated | 2,662 / 65 |
| backlog, 20 days | 1,014 → 5,382 |

Read together these say: *inflow overwhelms throughput at every organ.* The obvious
remedies follow from that reading — gate the decompose fan-out at the ingest seam, give
elided facts a decay path, raise the ratification cap. The first was flagged as a product
call, because it means deciding that some documentation should not become facts at all.

That reading was wrong, and every remedy that followed from it would have been wasted work.

## What opening the queue found

`suggestions({genuineOnly:true})` — the filtered view, the one that has already dropped
byte-identical pairs, same-source pairs, runtime plumbing, leases and presence rows —
returned 9,901 candidates. **The top twelve by cosine contained zero genuine connections.**

Two led at 0.99997:

```
doc-block:docs/dynamic-cells/9      "## Architecture"
doc-block:docs/workspace-ec2/1      "## Architecture"
  --similarTo 0.9999-->  doc-block:docs/ancestor/sync/frontend-unify/4
```

Block 4 of `frontend-unify` is a TypeScript snippet — a `renderToString` /
`ServerStyleSheet` example. A markdown heading and a code block do not have a cosine of
0.99997 under any working embedder.

Three reads settled what was happening:

1. **The index is healthy.** `query("## Architecture")` ranks the two heading blocks at
   relevance 1.0 and does not return block 4 at all. The vectors are right.
2. **Block 4's own outbound edges are healthy.** All five, written 2026-07-22, score
   0.51–0.55, all to code siblings in the same document. Correct and current.
3. **Only the inbound edges are wrong**, and they were written 2026-07-11 and 07-12.

## The mechanism

`refreshSimilarEdges` reconciles `mine = existing.filter(e => e.from === key)`. Outbound
only.

`doc-block` keys encode **ordinal position** — `doc-block:<path>/<i>`. Re-decomposing a
document silently changes what a stable key contains. On 2026-07-11, ordinal 4 of
`frontend-unify` held a heading, and a `similarTo` edge to it from another heading was
true. On 2026-07-22 the document was re-synced and ordinal 4 became code. Block 4's
outbound edges were reconciled that day. The inbound claims were not — and nothing will
ever revisit them, because a peer re-evaluates its edges only when the *peer* is
re-indexed, which for a settled fact may be never.

**A `similarTo` edge asserts something symmetric and is maintained from one side.** That
is the entire defect.

It compounds in three ways:

1. The frozen score is a **maximum** — the pair was near-identical when the edge was
   written — so stale edges systematically outrank honest ones and own the queue head.
   The curation surface shows its worst data first, by construction.
2. These edges feed `centrality`, a salience signal. Facts have been drawing standing
   from kinship that no longer exists.
3. `contested` reads the same candidate set.

This is the user's sentence in mechanical form. The system links, and never un-links.

## The fix

`reconcileInbound` (`platform/runtime/similar-edges.ts`), on one rule: **correct what we
can measure, delete only what we can disprove.**

When a fact is re-indexed we hold its fresh k-NN. For each inferred edge pointing *at* it:

- **peer is in the fresh matches** → we know the current cosine. Rewrite the score,
  preserving `createdAt` — this is the same claim re-measured, not a new one.
- **peer is absent and the stored score is above the horizon's floor** → impossible. Were
  that score true, the peer would have ranked inside the window we just looked at. Delete;
  the peer re-asserts on its own next pass if the kinship is still real.
- **peer is absent and the score is at or below the floor** → unfalsifiable from here.
  Leave it alone.

The third case is load-bearing. k-NN is not symmetric: a peer legitimately holds this fact
in its top-k while this fact does not hold the peer in its own. Treating that asymmetry as
staleness would quietly collapse the graph to mutual-kNN and take `centrality` with it.
The reconciler only ever acts on a contradiction it can actually demonstrate.

One widened k-NN (`INBOUND_HORIZON = 25`) serves both directions; outbound selection still
slices to `sim.k`, so the neighbour set is unchanged. A wider horizon makes the reconciler
*more* conservative — a lower floor means fewer edges are provably impossible — while
letting more peers land in the measurable branch and be corrected rather than guessed at.

Wired into both writers: the live stream indexer, where a fact reaches `puts` only when its
embeddable text changed — exactly the moment its inbound claims became unverified — and the
batch `reindex` replay, which walks every fact and so pays off the accumulated debt in one
pass.

## What it measured

A scoped `reindex` over the 46 facts of one document proved it on the known case before
anything ran wide. Block 4's inbound edges went 9 → 5: both 0.99997 claims deleted, along
with four other cross-document strays — none of whose peers were in the reindexed prefix,
so nothing but the inbound pass could have removed them. Its two genuine code siblings were
kept, with their original `createdAt`. One outbound score was corrected 0.5556 → 0.5154 by
the same pass running on the peer.

Then the full slice: 4,803 facts re-embedded, 3,027 skipped, 23,969 edges wired.

**The count barely moved. The contents changed completely.**

| | before | after |
|---|---|---|
| `genuineOnly` candidates | 9,916 | 8,920 |
| genuine connections in the top 12 | **0** | all of them |

A 10% drop is the least interesting number here. What matters is that the head of the
queue stopped being a lie. Before, every one of the top twelve was a mechanical artefact.
After, the head is: five pairs of **duplicate `inbox/*` captures** — the same web page
saved twice on different days, which is real supersede work — one pair of documents sharing
a near-identical section, and two `decompose-run` ↔ `kb` pairs.

Clearing the staleness also exposed a second, smaller defect it had been masking. With the
noise gone, four of the top eight were `el:blk:*` and `el:doc:*` — a fact beside its own
projection. `keyBase` stripped exactly one leading `namespace:`, and colon namespaces stack,
so `el:blk:X` reduced to `blk:X` while `blk:X` reduced to `X`. Fixed; those pairs are now
correctly classed `same-source`.

**Still open, and named rather than fixed:** `decompose-run/<path>/0` sits beside the
`kb/<hash>` fact it produced at ~0.97, and no edge connects them — so `authoredPairs`
cannot exclude the pair and no key heuristic can see it, because one key is a path and the
other a content hash. The ingest organ records what it ran and what it made, and links
neither to the other. That is a provenance gap, not a similarity gap, and it wants a
`produced` edge at the decompose seam.

## Pulling the thread: three more defects, each under the last

The `decompose-run ↔ kb` pair I had named as "a provenance gap, wants a `produced` edge"
was nothing of the kind. Opening one baton instead of theorising about it went four levels
down, and every level was a live defect.

**1. The baton is a copy of the document.** `decompose-run/<slug>/<cursor>` carries the
whole source in `value.content`, because each continuation step re-plans deterministically
from the same text the dispatch saw. Correct for the chain; downstream it means a verbatim
copy of the document is sitting in the substrate being embedded like knowledge. 97 of them
were live, ~11KB each. One measured **centrality 0.6256, salience 0.5096** — a coordination
artefact out-scoring real facts and inside the focus band.

**2. Organs could not say a fact was exhaust.** The substrate already has a
vocabulary-free way to mark coordination exhaust: a delete-effect timer. `indexableText`
refuses it, the indexer drops any vector under the key, `dropSimilarEdges` prunes its
kinship, `suggestions`/`contested` skip it. The whole chain existed end-to-end — and a
tier-2 cell could not reach any of it, because the organ write path honoured
`type`/`tags`/`via` off the event and silently dropped `timer`. One field. Fixed both
halves; a fresh baton now carries `{expiresAt, effect:"delete"}` and reads **centrality
0.0464** against the old 0.6256.

**3. And underneath: markdown ingestion had been failing for weeks.** All 97 batons sat at
cursor 0. `_decompose/*` said `status: running, done: 0`. The dead-letter facts said why:

```
_reaction-errors/lit-decompose-chunk     revision 507   gateway HTTP 504
_reaction-errors/lit-decompose-markdown  revision 267   gateway HTTP 504
```

Five hundred and seven failures, still firing. Every document too large for one ingest
chunk had been stalling since the async path landed.

The cause was one line that was never written. `FunctionUrlOrigin.withOriginAccessControl`
sets no `readTimeout`, so every origin used **CloudFront's 30s default**. Behind it, the
Lambdas had been raised deliberately and repeatedly — workspace 15s → 60s → 120s, gateway
→ 150s — each bump commented, each explaining that the gateway must outlast the workspace.
None of it mattered. The edge hung up at 30 seconds and returned `504`, which reads like
the origin died rather than like CloudFront stopped waiting for it. ADR-0083's chunking
could never have helped: a chunk is still one synchronous call through a 30s edge.

`INGEST_CHUNK` is the tell. It was set to 20 in July against a measured ~0.85s/fact,
explicitly sized for headroom "under the ~30s origin timeout". The budget was right; the
per-fact figure was not durable, because **every put recomputes salience, so per-fact cost
rises with slice size.** The slice grew past 7,600 facts and 20 quietly stopped fitting.
Sizing a batch against a measured latency is what failed, so the edge now waits 60s (the
ceiling without a quota increase, and still under the gateway's 150s — the edge should give
up *last*) and the batch came down to 10.

**Result, measured:** the 504s are gone. The chain advances for the first time — the
failing cursor moved from 0 to 40, and `_decompose/.../tending` went `done: 0` → `done: 10`.

**Still open, and honestly so:** the failure moved rather than vanished. With ~97 stalled
decompositions all draining at once the error is now DynamoDB throughput throttling, and
the live baton count has gone 97 → 141 as more documents get into flight. That is what a
backlog draining looks like on an on-demand table, and it should settle as the queue
clears — but it is a prediction, not a measurement, and it wants watching. If throttling
persists after the backlog drains, the capacity story is a real one and not transient.

## Checking the prediction, and the floor underneath it

I predicted the throttling was a backlog draining and would settle. Half right, and the
other half was mine.

**The throttling did settle** — the markdown dead-letter froze at 14:09 and stopped. But
the chunk error moved to a new failure at 14:38:

```
decompose-run/docs/technical-spec/460
read("workspace.query") is too large to return whole (203KB over the 60KB read budget)
```

That is the read budget guard from `c7c15c6`, mine, now blocking lit's own finish phase.
`finishDecompose` queried 500 whole facts and used nothing but `e.key` — 203KB shipped and
discarded on the next line. The guard was right, this was always waste, and its message
named the remedy: `shape:"refs"`. Fixed. Note the cursor: **460**, at `INGEST_CHUNK` 10 —
46 completed steps. `_decompose/docs/technical-spec` reached **`done: 453, total: 453`**,
from `done: 0` that morning. The pipeline genuinely works now.

**Then I made it worse.** Documents that reached the finish phase during the broken window
stayed stranded, because docs-sync skips unchanged shas and nothing re-writes the `markdown`
fact the reaction watches. So I added a `force_docs_sync` lever and pulled it — triggering a
full re-ingest of the whole corpus onto a table that had *just* been throttling. Predictably,
it saturated again. The lever is right and worth having; firing it immediately, at full
corpus width, without capacity headroom, was not.

**And underneath all of it is one line of schema.** The substrate table is
`PAY_PER_REQUEST`, and every fact and every edge for one owner is written under
`pk = K.statePk(scope)` — **a single partition key per slice**. DynamoDB's per-partition
ceiling is 1,000 WCU / 3,000 RCU and on-demand scales the *table*, not a partition. The
error text says so outright: *"check if you have a hot key."*

That is the floor beneath every symptom in this document. It is why per-put cost rises with
slice size, why `INGEST_CHUNK` kept losing its calibration, why ingest was slow enough for a
30s edge to cut it off, and why the backlog cannot simply be pushed through faster. Raising
the edge timeout and shrinking the batch make the pipeline correct; they do not raise the
ceiling. One owner's whole substrate is one partition, and the c15r slice is past 7,600
facts and 24,000 edges.

This is not a fix to make in passing — sharding the partition key touches the storage
contract, every GSI convention (`IN#<scope>#…`, `TYPE#<scope>#…`), and the LeadingKeys IAM
conditions that depend on scope being the partition. It is the next real piece of work, and
it should be decided deliberately rather than hotfixed. Recorded here so the next session
starts from the ceiling rather than rediscovering it through another symptom.

## Two more defects, and the wall

Following the stranded decompositions found two further real bugs.

**No retry anywhere in the chain.** A chunk step that hits a transient fault returns an
error, the reactor dead-letters it, the continuation baton lapses, and nothing above
retries — the document is stranded permanently, recoverable only by editing its source.
`gwCall` now retries with jittered backoff on faults that mean *the substrate was busy*
(5xx/429, DynamoDB's throttle text arriving as a 200 with `isError`) and never on a 4xx,
a validation error, or a read-budget error. Fixed at the shared kernel seam, so lit,
consolidate, models and run all inherit it.

**The depth cap measures edit count, not chain depth.** `event-handlers.ts` skips a
reaction when the triggering fact's revision exceeds `maxDepth` (default 50). For a machine
run that is right — revision *is* the transition count. For a source file it is *how many
times the file has ever been written*, and docs-sync rewrites `file/docs/*.md` on every
deploy. Past ~50 deploys the reaction dies silently: a CloudWatch warn, no dead-letter fact,
no symptom but a document that quietly stops re-decomposing.

The chunk subscription carried an explicit claim of immunity — "fresh run facts are written
per step at distinct keys, each starting at revision 1". True of every cursor except the one
that matters: `decompose-run/<slug>/0` is the *same key* on every re-sync, so it accrues a
revision per sync and eventually crosses the cap, after which the chain can never start.

Both caps lifted (neither reaction can self-trigger, so revision is simply the wrong
metric). The proof: `_decompose/docs/architecture` had been frozen at 20/207 since 15:01
*through two forced re-syncs*; with the cap lifted it restarted at 17:14. **The general
defect is not fixed** — any subscription on a fact that gets rewritten in the ordinary
course of business inherits the same silent death, and the only signal is a log line.

### And then the wall, which I kept walking into

After all four fixes, `docs/architecture` stalled again at 0/207, with a fresh throttle at
17:21. The retry rides out a *momentary* blip. This is not momentary: it is ~60 documents
re-decomposing at once against a table whose entire slice is **one partition**, capped at
1,000 WCU. Client-side retry cannot buy capacity that does not exist.

I triggered that stampede three times, each time with `force_docs_sync`, each time expecting
the newest fix to absorb it. The fixes were all real and all necessary; none of them
addressed the constraint that was actually binding, and re-running the full corpus into a hot
partition made the live state worse each time while the code got better.

**The recovery is paced, not forced.** A full-corpus re-ingest is a stampede by construction.
Stranded documents should be restarted a handful at a time, letting each drain before the
next — the lever needs a batch size and a delay, not just an on switch.

**The fix is the partition key.** `pk = K.statePk(scope)` puts every fact and every edge of
one owner in one partition. That is the floor under the 504s, under the throttling, under
"per-put cost rises with slice size", and under every calibration constant in this document
that kept going stale. It touches the storage contract, both GSI conventions, and the
LeadingKeys IAM conditions — it is the next real piece of work and it should be designed,
not hotfixed.

## The recovery, paced — and what it retired

With a token minted, recovery could be done properly instead of through the CI on-switch.
`docs-sync` gained the pacing it lacked (`--only`, `--max`, `--delay`) and the whole thing
was verified end to end on the largest stranded document:

```
node scripts/docs-sync.mjs --commit --force --only "docs/architecture.md" --no-share
```

`_decompose/docs/architecture`, frozen at 20/207 since 15:01 and untouched by two
full-corpus forces, ran **0 → 207 → done** with **zero throttling errors**. Then three at
once, same result. One document at a time is not slow — it is the only thing that works,
and it works cleanly.

Its finish report carried the number this whole document has been circling:

```
status: done · done: 207/207 · blocksRetired: 830
```

**830 stale doc-blocks retired for one document.** The finish phase is the organ that
retires superseded content, and it is the last step of a chain that had not been able to
complete. So the residue of every partial run since the pipeline broke had simply
accumulated — invisibly, because a half-decomposed document looks exactly like a
decomposed one until you count its blocks. "We accrue content but never maintain it" was
not a philosophy problem. The maintenance step was unreachable.

One more read-budget round happened on the way: `shape:"refs"` was right and still not
enough, because refs keeps a `_meta` per entry and 500 of them is ~211KB. The scan now
pages at 100. The budget was never the problem — asking for 500 facts to read 500 strings
was, and the guard kept saying so until the call got honest.

**Continuing the recovery** (~193 documents remain, each a few minutes):

```
node scripts/docs-sync.mjs --commit --force --max 3 --delay 5000 --no-share   # repeat
```

Verified safe at 3 concurrent chains. Do not raise it far without watching
`_reaction-errors/lit-decompose-chunk` — the partition ceiling has not moved.

## The architecture round: stop paying O(slice) per page

The home-graph investigation ended in three layered findings, each one level under the
last, and the deepest one reframed the whole day.

**The graph broke because its reads were sized for a dead constraint.** Its first read —
`query{shape:'card', limit:800}` — was 931KB against the 60KB budget. The 800 was chosen
when the binding constraint was a request *timeout*; when the constraint became response
*size*, the number quietly inverted from optimization to failure. Pages are 40 now, and the
loader already streamed pages concurrently, so the design wanted small pages all along.

**The guest's `20/20` was `total` lying, not pagination.** The grant fold capped the
owner's slice by salience *before* filtering by coverage, so `total` counted the survivors
of a truncation. ~135 public facts, 115 of them blocks at salience 0.12–0.14, invisible
behind the owner's top 1200. Coverage now rides *inside* the query
(`QueryOptions.keyFilter`, beside `prefix`/`tag`, upstream of the cap and `total`) — after
a wrong intermediate fix fanned out one query per grant pattern and blanked the guest graph
entirely under load. Which forced the real question:

**Why is one query so expensive that nineteen of them is an outage?** Because they are
already DDB Queries, never Scans — and it doesn't matter. `state.query` reads the whole
`KEY#` partition and the whole `EDGE#` partition (centrality) on every call; `prefix` is an
in-memory filter, not a pushed-down key condition. And the paginated cursor is an offset
into a *fresh* ranking, so every page pays both partitions again. The home graph's twenty
pages re-read and re-scored the slice twenty times. `edges({keys})` had the same disease —
whole edge partition per call — which my response-size chunking then *multiplied*.

Two structural fixes, both riding patterns the codebase had already established:

- **The ranking digest.** The recall digest's seq-validated-cache pattern, applied to the
  bare salience ranking. The insight that makes it small: `wrap` needs exactly one input
  from the full-partition reads — graph degree. So the digest is ordered keys + degrees
  (capped 1200, ~65KB), and a warm page is point-gets over just the page's records with
  meta recomputed exactly (recency live, degree cached, staleness impossible because any
  write — `link` included — advances seq). Strict eligibility: only the bare query touches
  it; every filtered question goes cold, because a top-N cache answering a
  differently-shaped question is precisely the `total` bug. And a rule the test design
  itself surfaced: **a cache is not content** — `_index/*` is now excluded from query
  results unless explicitly prefixed into, or the digest would surface as a 65KB
  pseudo-fact in the very queries it accelerates.

- **Per-key edge queries.** The store always knew how to answer narrowly — `edgesFrom` is
  a `begins_with` on the main partition, `edgesTo` is the inbound GSI. `edges({keys})` now
  issues 2 narrow queries per key (folded keys against the granting owner's partition,
  under the same both-endpoint coverage rule) instead of reading 24k rows per chunk.

Warm page: ~44 point reads instead of two full partitions — about 50× fewer RCU, no
re-rank. The partition ceiling still stands and still wants the sharding design; but the
hot path no longer spends the whole partition to serve forty facts.

## The method note

The audit numbers were all real, and the story they told was false. "15,482 pending against
5 per cycle" is a throughput problem, and it invited throughput remedies: rate-limit
ingest, decay the tail, raise the cap. None of them would have touched this. Gating the
decompose fan-out — the change flagged as needing a product decision — would have reduced
the *volume* of a queue whose *contents* were the actual defect.

Counting a queue describes its size. Opening it finds out what is in it. Two `peek` calls
were worth more than the entire census.

The open lifecycle questions — elided facts with no decay path (ADR-0079, still unbuilt),
the wiki compile loop starved by triggers on the two smallest types, a capture organ with
five genuine uses — remain open, and should be re-measured after a full reindex rather than
argued from the pre-fix numbers.
