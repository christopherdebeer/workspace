/**
 * Vector indexer (ADR-0030 Increment 2) — the live, incremental half of semantic
 * indexing. A consumer on the SubstrateTable's DynamoDB stream (NEW_AND_OLD_IMAGES,
 * dormant until now): each fact create/update is embedded and upserted into its
 * slice's vector index; supersession/delete removes it. The batch `reindex` admin
 * command is the replay; this keeps the index live without a hot-path cost (it runs
 * off the stream, not inside the write).
 *
 * It never makes an access decision — it only mirrors facts into the index, which is
 * a candidate generator re-checked authoritatively at search time (ADR-0030 Decision 1).
 */
import { DynamoDB } from 'aws-sdk';
import { embeddableText, metadataForFact, indexForScope, type VectorRecord } from '../../platform/runtime';
import { vectorsFromEnv } from '../../platform/runtime/s3-vectors-store';

const unmarshall = DynamoDB.Converter.unmarshall;

/** Minimal shape of a DynamoDB stream record (avoids an @types/aws-lambda dep). */
interface StreamRecord {
  eventName?: 'INSERT' | 'MODIFY' | 'REMOVE';
  dynamodb?: { NewImage?: Record<string, unknown>; OldImage?: Record<string, unknown> };
}
interface StreamEvent {
  Records?: StreamRecord[];
}

/** The fact attributes the indexer reads off an unmarshalled item. */
interface FactItem {
  sk?: string;
  scope?: string;
  key?: string;
  value?: unknown;
  type?: string | null;
  tags?: string[];
  superseded?: boolean;
}

const DIM = Number(process.env.VECTOR_DIM ?? (process.env.VECTOR_EMBEDDER === 'bedrock' ? 1024 : 256));

interface IndexPlan {
  puts: Array<{ key: string; text: string; meta: ReturnType<typeof metadataForFact> }>;
  removes: Set<string>;
}

/**
 * Pure: turn a batch of stream records into per-index work (texts to embed + keys to
 * remove), with no embedding or IO — the testable core of the indexer. Filters to
 * facts (`sk` = `KEY#…`), drops the vector on REMOVE/supersession, and sha-skips a
 * metadata-only rewrite (same embeddable text, still live).
 */
export function planStreamWork(event: StreamEvent): Map<string, IndexPlan> {
  const plans = new Map<string, IndexPlan>();
  const planFor = (index: string): IndexPlan => {
    let p = plans.get(index);
    if (!p) plans.set(index, (p = { puts: [], removes: new Set() }));
    return p;
  };
  for (const r of event.Records ?? []) {
    const img = r.dynamodb?.NewImage ? (unmarshall(r.dynamodb.NewImage as DynamoDB.DocumentClient.AttributeMap) as FactItem) : null;
    const old = r.dynamodb?.OldImage ? (unmarshall(r.dynamodb.OldImage as DynamoDB.DocumentClient.AttributeMap) as FactItem) : null;
    const item = img ?? old;
    // Facts only: their sort key is `KEY#<key>` (skip edges `EDGE#`, and the
    // TRAJ#/SEQ# partitions which aren't facts at all).
    if (!item || typeof item.sk !== 'string' || !item.sk.startsWith('KEY#')) continue;
    const scope = item.scope;
    const key = item.key;
    if (typeof scope !== 'string' || typeof key !== 'string') continue;
    const index = indexForScope(scope, DIM);

    // Hard delete (incl. delete-effect timer TTL) or supersession → drop the vector.
    if (r.eventName === 'REMOVE' || img?.superseded) {
      planFor(index).removes.add(key);
      continue;
    }
    const text = embeddableText(key, img?.value);
    if (!text) continue;
    // sha-skip: a metadata-only rewrite (same embeddable text, still live) leaves the
    // vector unchanged — don't re-embed.
    if (old && !old.superseded && embeddableText(key, old.value) === text) continue;
    planFor(index).puts.push({ key, text, meta: metadataForFact({ type: img?.type ?? undefined, tags: img?.tags, superseded: false }) });
  }
  return plans;
}

export async function handler(event: StreamEvent): Promise<void> {
  const vectors = vectorsFromEnv();
  if (!vectors) return; // backend not configured → no-op (safe)

  const plans = planStreamWork(event);
  if (!plans.size) return;
  for (const [index, { puts, removes }] of plans) {
    await vectors.store.ensureIndex(index, { dimension: DIM });
    if (puts.length) {
      const vecs = await vectors.embedder.embed(puts.map((p) => p.text));
      const records: VectorRecord[] = puts.map((p, i) => ({ key: p.key, vector: vecs[i], metadata: p.meta }));
      await vectors.store.put(index, records);
    }
    if (removes.size) await vectors.store.remove(index, [...removes]);
  }
}
