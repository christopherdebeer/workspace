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
import {
  embeddableText,
  metadataForFact,
  indexForScope,
  selectNeighbors,
  similarConfig,
  refreshSimilarEdges,
  dropSimilarEdges,
  createObservedState,
  projectVector,
  LAYOUT_KEY,
  type VectorRecord,
  type StateStore,
  type ProjectionFact,
} from '../../platform/runtime';
import { vectorsFromEnv } from '../../platform/runtime/s3-vectors-store';
import { createDynamoStateStoreV3 as createDynamoStateStore } from '../../platform/runtime/dynamo-state-store-v3';

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
  scope: string;
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
  const planFor = (index: string, scope: string): IndexPlan => {
    let p = plans.get(index);
    if (!p) plans.set(index, (p = { scope, puts: [], removes: new Set() }));
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
      planFor(index, scope).removes.add(key);
      continue;
    }
    const text = embeddableText(key, img?.value);
    if (!text) continue;
    // sha-skip: a metadata-only rewrite (same embeddable text, still live) leaves the
    // vector unchanged — don't re-embed.
    if (old && !old.superseded && embeddableText(key, old.value) === text) continue;
    planFor(index, scope).puts.push({ key, text, meta: metadataForFact({ type: img?.type ?? undefined, tags: img?.tags, superseded: false }) });
  }
  return plans;
}

export async function handler(event: StreamEvent): Promise<void> {
  const vectors = vectorsFromEnv();
  if (!vectors) return; // backend not configured → no-op (safe)

  const plans = planStreamWork(event);
  if (!plans.size) return;
  // ADR-0031: inferred similarTo edges live in the substrate table; the indexer writes
  // them directly through the raw store (no trajectory/resolve side effects).
  const sim = similarConfig();
  const table = process.env.SUBSTRATE_TABLE;
  const edgeStore: StateStore | null = sim.enabled && table ? createDynamoStateStore(table) : null;

  for (const [index, { scope, puts, removes }] of plans) {
    await vectors.store.ensureIndex(index, { dimension: DIM });
    let putVecs: number[][] = [];
    if (puts.length) {
      putVecs = await vectors.embedder.embed(puts.map((p) => p.text));
      const records: VectorRecord[] = puts.map((p, i) => ({ key: p.key, vector: putVecs[i], metadata: p.meta }));
      await vectors.store.put(index, records);
    }
    if (removes.size) await vectors.store.remove(index, [...removes]);

    // Reconcile inferred similarTo edges for this scope (best-effort: a failure must
    // not poison the stream batch — the vectors are already committed).
    if (edgeStore && (puts.length || removes.size)) {
      try {
        const now = new Date().toISOString();
        const existing = await edgeStore.listEdges(scope);
        for (let i = 0; i < puts.length; i++) {
          const matches = await vectors.store.query(index, putVecs[i], { topK: sim.k + 1 });
          const neighbors = selectNeighbors(matches, puts[i].key, { k: sim.k, minScore: sim.minScore });
          await refreshSimilarEdges(edgeStore, scope, puts[i].key, neighbors, sim.strength, existing, now);
        }
        for (const key of removes) await dropSimilarEdges(edgeStore, scope, key, existing);
      } catch (err) {
        console.warn('vector-indexer similarTo edge pass failed (vectors indexed)', { scope, error: (err as Error).message });
      }
    }

    // Keep the semantic-layout fact (`_home/embed2d`) fresh incrementally (ADR-0047
    // stage 3): once a batch `workspace.project` has run and persisted its basis,
    // placing ONE MORE vector on that same map is a few dot products
    // (projectVector) — no full-index re-read, no PCA. Best-effort + CAS'd: a
    // concurrent stream batch racing the same fact just skips this patch (the
    // next write, or the next full `project()`, catches it up); a missing/basis-
    // less fact (project() never run yet) is silently skipped — there is no map
    // to place a point on until the first batch run creates one.
    if (edgeStore && (puts.length || removes.size)) {
      try {
        await patchProjection(edgeStore, scope, puts.map((p, i) => ({ key: p.key, vector: putVecs[i] })), [...removes]);
      } catch (err) {
        console.warn('vector-indexer projection patch failed (vectors indexed)', { scope, error: (err as Error).message });
      }
    }
  }
}

/** Read-patch-write `_home/embed2d`'s coords for the keys this batch touched,
 *  using its persisted PCA basis. CAS'd on the read version so a losing race
 *  is a silent no-op rather than a lost update — see the call site above.
 *  Exported (like {@link planStreamWork}) so the incremental-projection logic
 *  is unit-testable against a plain `StateStore`, without AWS. */
export async function patchProjection(
  store: StateStore,
  scope: string,
  puts: Array<{ key: string; vector: number[] }>,
  removes: string[],
): Promise<void> {
  const state = createObservedState(store);
  const entry = await state.get(scope, LAYOUT_KEY);
  if (!entry) return; // no map yet — the first `workspace.project` creates one
  const fact = entry.value as ProjectionFact;
  if (!fact?.basis || !fact?.norm) return; // pre-basis projection — needs a fresh `project()` first
  let changed = false;
  const coords = { ...fact.coords };
  for (const { key, vector } of puts) {
    coords[key] = projectVector(vector, fact.basis, fact.norm);
    changed = true;
  }
  for (const key of removes) {
    if (key in coords) {
      delete coords[key];
      changed = true;
    }
  }
  if (!changed) return;
  await state.put({
    scope,
    key: LAYOUT_KEY,
    value: { ...fact, coords, count: Object.keys(coords).length },
    via: 'vector-indexer',
    type: 'graph-layout',
    ifVersion: entry._meta.version,
  });
}
