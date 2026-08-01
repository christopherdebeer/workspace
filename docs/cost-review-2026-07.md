# July 2026 AWS bill: root cause and fix plan

$256.10 for July (pre-tax $213.40 + VAT), up ~9× month over month. For a
personal workspace this should be $20–50. This doc decomposes the bill,
traces each line to code, and orders the fixes.

## The bill, decomposed

| Line | Amount | What it actually is |
|---|---|---|
| DynamoDB reads | **$161.17** | 1.29 **billion** read request units, us-east-1 |
| Lambda compute | $33.29 | 2.0M GB-seconds (≈23 days of continuous 1GB) |
| EBS (eu-west-2) | $12.99 | 130GB gp3 + 8GB gp2 provisioned; the instance ran 0.14 hours |
| DynamoDB writes | $2.88 | 4.6M write units |
| Route 53 | $2.01 | 4 hosted zones |
| Everything else | ~$1 | S3 (incl. S3 Vectors), CloudFront, EventBridge, Bedrock, Firehose, SES |

The table stores **0.051 GB**. 1.29B RRUs against 51MB means the substrate
was read end-to-end roughly **100,000× in a month — 2–3 full-table reads
per minute, sustained**. That is the entire problem. Nothing here is
mispriced; the architecture re-reads the whole world constantly.

## Where the reads come from

Verified by code inspection (the store is Query-only, no Scans — the cost
is legitimate reads issued too broadly / too often) plus the substrate's
own lake (`workspace.athena`) and trajectory:

1. **Cold `query` paths read the whole slice, twice.** Any query that
   isn't a bare salience page (semantic `{text}`, type/tag filters,
   `context:'refs'`, attention, contested, ratify) does
   `store.list(scope)` + `store.listEdges(scope)` — ~50MB ≈ 6k RRU per
   call. Every palette search, organ pass, probe wave, and agent orient
   pays it. There is no caching on this path.
2. **The ranking digest invalidates on *any* write.** The warm path for
   the home graph's ~215-page stream works — but its seq check treats
   every write as invalidating. The tuner writes `_config/home.graph.tune`
   on every slider settle (the trajectory shows **dozens per minute**
   while dialling; 1,323 in July), cell-sync writes ~40 `cells/*` file
   facts per push, the indexer patches `_home/embed2d` shards — each one
   sends the next page query cold (6k RRU + a fresh digest write; 4,502
   digest rewrites in July = 4,502 cold full re-ranks).
3. **Anonymous SSR reads the world per page hit.** Every signed-out hit
   on parc.land (bots included — CloudFront logged ~270k requests) reads
   `home/featured` + all `_public/` patterns + **every `doc:` fact** over
   the IAM slice read. No Lambda-level cache, no CloudFront caching on
   the HTML.
4. **The vector indexer reads all edges per stream batch.**
   `listEdges(scope)` (~30k edges, ~10MB) on every batch containing one
   embeddable put, to reconcile `similarTo` — plus a read-patch-write of
   the ~655KB projection atlas (16 shards + manifest + public twin), with
   CAS retries under contention.
5. **The dev harness and July's backfills.** 330k writes in July, mostly
   spikes (Jul 29: 136k — vendor mirror; Jul 10/12/16/22: lit
   decomposition backfills, 147k writes; `project` reseat experiments:
   11.9k). Every write fans out to three stream consumers, and the
   harness's dozens of full chart loads/day each stream the whole graph.

Lambda's 2M GB-seconds is the same story from the compute side: cold
queries, SSR renders, and 3× stream consumers × every write. Writes
($2.88) are dominated by the indexer's shard rewrites and
`tend:capabilities` re-writing ~2.5k capability facts per day whether or
not they changed (79,557 writes in July — the single largest via).

What it is **not**: no scans, no runaway infinite loop, no leaked
resource (except the EBS volume). The trend (+816%) is real: June's
DynamoDB was ~$18. July added the whole-graph home experience, the
projection shards, the digest, heavy tuning sessions, and a month of
fix-forward harness driving.

## Fixes, in priority order

Measurement first — the two numbers I could not get from here (no AWS
credentials in this environment reach account 018159942401):

- **P0a — look at CloudWatch once** (10 minutes, console):
  `ConsumedReadCapacityUnits` (Sum, 1h) on the substrate table for 14
  days — flat curve = bots/cron dominate; spiky = interactive/harness
  dominates. Lambda invocations + duration by function name. This
  arbitrates between causes 1–4 precisely.
- **P0b — permanent read telemetry** (small PR): thread
  `ReturnConsumedCapacity: 'TOTAL'` through the store behind an env
  flag; log one line per command (verb, RRU, ms). The gateway already
  logs per-dispatch; adding RRU makes every future bill self-explaining.

Then, ranked by expected $ × certainty:

1. **Cache the anonymous SSR boot** (cause 3). Module-level cache with a
   short TTL for the featured/public/docs payload, plus
   `Cache-Control`/CloudFront caching on signed-out HTML (even 60s
   collapses bot amplification). Also stop reading full doc values for
   title+summary — maintain a small `_public/index` digest fact,
   rebuilt on share change (the indexer already rebuilds the public
   projection on exactly that trigger).
2. **Make the ranking digest survive irrelevant writes** (cause 2).
   Either a ranking-relevant seq (exclude `_`-prefixed and `cells/*`
   keys from advancing it) or a bounded staleness window (serve a digest
   younger than N seconds regardless of seq — a star map does not need
   write-level freshness). Kills the cold re-rank per tuner drag.
3. **Scope the indexer's edge reconcile** (cause 4). Replace
   `listEdges(scope)` with `edgesFrom`/`edgesTo` for the batch's keys —
   dozens of rows instead of 30k per batch.
4. **Bound the cold query path** (cause 1). Semantic queries should
   hydrate only their top-K hits by point-get and take degrees from the
   digest, not re-read the full slice per query; `attention`/`contested`
   can share one cached graph snapshot with short TTL.
5. **Stop the identical-rewrite churn.** `tend:capabilities` should
   compare-and-skip unchanged capability facts (79k/mo → ~nothing);
   cell-sync push should diff and push only changed files (~40 writes →
   ~2 per deploy); the tuner client should trail-debounce fact persists
   (a settle, not a stream).
6. **EBS in eu-west-2** (−$12/mo, owner decision): 130GB gp3 provisioned
   for an instance that ran 8 minutes in July. Snapshot and delete, or
   shrink; the workspace-ec2 stack declares 100GB — decide if the box is
   still wanted at all.
7. **Guest graph budget.** The signed-out home streams the full 8.6k-fact
   graph to every visitor who enters. Give guests a capped slice (the
   public projection is already computed) and/or serve the graph model
   from a cached artifact rebuilt on change rather than live pages.

Expected landing zone after 1–5: DynamoDB back to $10–30, Lambda roughly
halved, total bill $50–80 including VAT. Items 1–3 are each small,
self-contained PRs.

## What July partly was: one-time

The lit backfills, the vendor mirror upload, the projection experiments,
and this session's harness driving are non-recurring. Even with no code
changes August would come in lower — but causes 1–4 are structural and
will grow with content and traffic, so the fixes above are still the
right spend.
