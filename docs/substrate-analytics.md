# Substrate analytics — the live → Athena lane

> The ad-hoc / analytical read surface DynamoDB's access model can't serve, plus
> a permanent (TTL-free) at-rest archive of the substrate. Built as a second
> consumer on the SubstrateTable change stream, so it costs the write path
> nothing and can't perturb the reactor.

## Why

DynamoDB is not a throughput bottleneck for the substrate — bounded-scope reads
are single-digit ms (`docs/substrate-storage.md`). What it structurally cannot do
is answer a question you did not index for in advance: *"every `decision` across
all scopes tagged X in the last 30 days, ranked, joined to its neighbors."* The
storage doc names this the one honest limit (*"arbitrary graph / SQL territory"*).

This lane fills exactly that gap — full SQL over the whole substrate — without a
server to babysit and without touching the operational hot path. It also makes
the substrate's history **permanent**: the trajectory (`TRAJ#`) is TTL-bounded, so
the DynamoDB change feed erodes; landing every change in S3 gives the durable,
queryable ten-year memory the workspace promises.

## Shape

```
SubstrateTable (DynamoDB Stream, NEW_AND_OLD_IMAGES)
   ├─ vector-indexer   Lambda  → S3 Vectors        (semantic search, ADR-0030)
   └─ substrate-archiver Lambda → Kinesis Firehose → S3 lake (gzip, dt-partitioned)
                                                         │
                                        Glue table (partition projection, no crawler)
                                                         │
                                                      Athena  ← ad-hoc SQL
```

- **`services/substrate-archiver/handler.ts`** — the stream consumer. Filters to
  facts (`sk` = `KEY#…`; skips edges + the `TRAJ#`/`SEQ#` partitions), flattens
  each into the fact envelope as real columns, keeps the arbitrary fact body as a
  `value_json` string, and `PutRecordBatch`es to Firehose. Pure planner
  (`planArchiveRows`) is unit-tested; the handler is the thin IO shell. No-ops
  until `FIREHOSE_STREAM` is set, and never writes back to the substrate.
- **`platform/infra/analytics-lane.ts`** (`SubstrateAnalyticsLane`) — the lake
  bucket (**RETAINED** — truth at rest), an Athena results bucket (14-day
  lifecycle), the Firehose delivery stream (JSON + GZIP, `facts/dt=YYYY-MM-DD/`,
  60s buffer → near-live), a Glue database + `facts` table using **partition
  projection** (so no crawler / `MSCK REPAIR` is ever needed), and an Athena
  workgroup pinned to the results bucket.
- **PITR** on `SubstrateTable` — continuous backups (restore to any second in the
  last 35 days). The lane is the queryable archive; PITR is one-click DR.

## Query it

Athena, workgroup `substrate-<env>`, database `substrate_<env>`, table `facts`.

```sql
-- Facts by type in a scope, most-recent first
SELECT key, type, updated_at, writer
FROM facts
WHERE dt >= date_format(current_date - interval '30' day, '%Y-%m-%d')
  AND scope = 'c15r' AND type = 'decision'
ORDER BY updated_at DESC;

-- Reach into the arbitrary fact body
SELECT key, json_extract_scalar(value_json, '$.title') AS title
FROM facts
WHERE scope = 'c15r' AND type = 'project';

-- Write cadence per day (the substrate's metabolism)
SELECT dt, count(*) AS writes, count(DISTINCT key) AS facts_touched
FROM facts
WHERE event_name IN ('INSERT', 'MODIFY')
GROUP BY dt ORDER BY dt DESC;

-- Full revision history of one fact (the permanent trajectory)
SELECT revision, event_name, writer, via, archived_at
FROM facts
WHERE key = 'kb/proj_mental_models'
ORDER BY revision;
```

Notes:
- `dt` is a **projected** partition (range `2024-01-01,NOW`). Always constrain it
  when you can — it prunes S3 scan cost.
- A fact's full history is present because the archive is append-only: every
  stream event lands a row, so `revision`/`event_name` reconstruct the trajectory
  even past the DynamoDB TTL horizon.
- `tags` is an `array<string>`; use `contains(tags, 'x')`.

## Cost & posture

At personal-workspace scale this is pennies: Athena ~$5/TB scanned (gzip + `dt`
pruning keeps scans tiny), Firehose per-GB ingested, PITR ~20% on a small table,
S3 lake storage negligible. All serverless, aws-native, no idle compute — on the
repo's tenets. Facts only in v1; edges/trajectory could be added as further lanes.

## Later (deliberately out of v1)

- **Parquet** via Firehose record-format conversion (needs the Glue schema as the
  conversion target) — more scan-efficient than JSON, worth it only once volume
  justifies it.
- **Salience columns** (`score`/`standing`/`centrality`) are computed at read
  time, not stored, so they are absent here by design; recompute in SQL or join a
  periodic snapshot if needed.
