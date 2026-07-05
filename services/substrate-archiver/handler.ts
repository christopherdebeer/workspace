/**
 * Substrate archiver — the analytics + durable-archive half of the substrate
 * table's change stream. A second consumer on the SubstrateTable DynamoDB stream
 * (alongside the vector indexer): each fact create/update/remove is flattened to
 * one JSON record and forwarded to Kinesis Firehose, which lands it in the lake
 * bucket (gzip, date-partitioned) for Athena. See `docs/substrate-analytics.md`.
 *
 * It never makes an access decision and never writes back to the substrate — it
 * only mirrors facts outward. A failure here cannot perturb the write path or the
 * reactor (it runs off the stream, not inside the write).
 */
import { DynamoDB, Firehose } from 'aws-sdk';

const unmarshall = DynamoDB.Converter.unmarshall;

/** Minimal shape of a DynamoDB stream record (avoids an @types/aws-lambda dep). */
interface StreamRecord {
  eventName?: 'INSERT' | 'MODIFY' | 'REMOVE';
  dynamodb?: { NewImage?: Record<string, unknown>; OldImage?: Record<string, unknown> };
}
interface StreamEvent {
  Records?: StreamRecord[];
}

/** The stored fact attributes the archiver flattens (see StateRecord / state-store-codec). */
interface FactItem {
  sk?: string;
  scope?: string;
  key?: string;
  value?: unknown;
  type?: string | null;
  tags?: string[];
  revision?: number;
  seq?: number;
  firstSeq?: number;
  writer?: string | null;
  via?: string | null;
  superseded?: boolean;
  supersededBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  timerExpiresAt?: string | null;
  timerEffect?: string | null;
}

/** One flattened row landed in the lake — real columns + the fact body as JSON. */
export interface FactRow {
  scope: string | null;
  key: string | null;
  type: string | null;
  tags: string[];
  revision: number | null;
  seq: number | null;
  first_seq: number | null;
  writer: string | null;
  via: string | null;
  superseded: boolean;
  superseded_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  timer_expires_at: string | null;
  timer_effect: string | null;
  event_name: string;
  value_json: string;
  archived_at: string;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function flatten(item: FactItem, eventName: string, archivedAt: string): FactRow {
  return {
    scope: item.scope ?? null,
    key: item.key ?? null,
    type: item.type ?? null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    revision: num(item.revision),
    seq: num(item.seq),
    first_seq: num(item.firstSeq),
    writer: item.writer ?? null,
    via: item.via ?? null,
    superseded: !!item.superseded,
    superseded_by: item.supersededBy ?? null,
    created_at: item.createdAt ?? null,
    updated_at: item.updatedAt ?? null,
    timer_expires_at: item.timerExpiresAt ?? null,
    timer_effect: item.timerEffect ?? null,
    event_name: eventName,
    value_json: JSON.stringify(item.value ?? null),
    archived_at: archivedAt,
  };
}

/**
 * Pure: turn a batch of stream records into flattened fact rows — the testable
 * core. Filters to facts (`sk` = `KEY#…`, skipping edges `EDGE#` and the
 * TRAJ#/SEQ# partitions), and reads the OldImage on REMOVE.
 */
export function planArchiveRows(event: StreamEvent, archivedAt: string): FactRow[] {
  const rows: FactRow[] = [];
  for (const r of event.Records ?? []) {
    const img = r.dynamodb?.NewImage
      ? (unmarshall(r.dynamodb.NewImage as DynamoDB.DocumentClient.AttributeMap) as FactItem)
      : null;
    const old = r.dynamodb?.OldImage
      ? (unmarshall(r.dynamodb.OldImage as DynamoDB.DocumentClient.AttributeMap) as FactItem)
      : null;
    const item = img ?? old;
    // Facts only: their sort key is `KEY#<key>` (skip edges + the non-fact partitions).
    if (!item || typeof item.sk !== 'string' || !item.sk.startsWith('KEY#')) continue;
    rows.push(flatten(item, r.eventName ?? 'UNKNOWN', archivedAt));
  }
  return rows;
}

const PUT_CHUNK = 500; // Firehose PutRecordBatch cap

let firehose: Firehose | null = null;
function client(): Firehose {
  if (!firehose) firehose = new Firehose();
  return firehose;
}

export async function handler(event: StreamEvent): Promise<void> {
  const streamName = process.env.FIREHOSE_STREAM;
  if (!streamName) return; // lane not configured → no-op (safe)

  const rows = planArchiveRows(event, new Date().toISOString());
  if (!rows.length) return;

  // Newline-delimit so the objects Firehose concatenates stay one-JSON-per-line.
  const records = rows.map((row) => ({ Data: `${JSON.stringify(row)}\n` }));
  for (let i = 0; i < records.length; i += PUT_CHUNK) {
    const batch = records.slice(i, i + PUT_CHUNK);
    const res = await client()
      .putRecordBatch({ DeliveryStreamName: streamName, Records: batch })
      .promise();
    if (res.FailedPutCount && res.FailedPutCount > 0) {
      // Best-effort: log and continue. The stream retries the whole batch on a
      // thrown error, which would re-forward already-delivered rows (dupes are
      // acceptable in an append-only analytics lake); a partial failure here is
      // rarer and not worth reprocessing the batch for.
      console.warn('substrate-archiver: partial Firehose delivery', {
        failed: res.FailedPutCount,
        of: batch.length,
      });
    }
  }
}
