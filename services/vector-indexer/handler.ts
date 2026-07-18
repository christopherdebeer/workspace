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
  indexableText,
  metadataForFact,
  indexForScope,
  selectNeighbors,
  similarConfig,
  refreshSimilarEdges,
  dropSimilarEdges,
  createObservedState,
  projectVector,
  LAYOUT_KEY,
  layoutShardKey,
  layoutShardOf,
  StatePreconditionError,
  type VectorRecord,
  type StateStore,
  type ProjectionFact,
  type LayoutManifest,
  type LayoutShard,
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
  /** Delete-effect timer (a lease/presence row) — ephemeral by declaration. */
  timerEffect?: 'delete' | 'enable' | null;
}

interface IndexPlan {
  scope: string;
  puts: Array<{ key: string; text: string; meta: ReturnType<typeof metadataForFact> }>;
  removes: Set<string>;
}

/**
 * Pure: turn a batch of stream records into per-index work (texts to embed + keys to
 * remove), with no embedding or IO — the testable core of the indexer. Filters to
 * facts (`sk` = `KEY#…`), drops the vector on REMOVE/supersession, and sha-skips a
 * metadata-only rewrite (same embeddable text, still live). Index membership is the
 * shared `indexableText` rule (one predicate for both vector writers); `dim` is the
 * active embedder's dimension — threaded from the caller so the index name and the
 * vectors written into it can never disagree (the old module-level env-derived DIM
 * re-decided it with divergent case-sensitivity vs `vectorsFromEnv`).
 */
export function planStreamWork(event: StreamEvent, dim: number): Map<string, IndexPlan> {
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
    const index = indexForScope(scope, dim);

    // Hard delete (incl. delete-effect timer TTL) or supersession → drop the vector.
    if (r.eventName === 'REMOVE' || img?.superseded) {
      planFor(index, scope).removes.add(key);
      continue;
    }
    // Membership is the ONE shared rule (`indexableText`): live, not ephemeral-
    // by-declaration, embeddable. A delete-effect timer — a lease, a presence
    // row — self-destructs and must never enter the index: embedding it mints
    // `similarTo` kinship edges between coordination artefacts, which then lead
    // the contested/suggestions views (timer-deleted leases held the top 19
    // contested slots at 0.99 cosine). Vocabulary-free — the timer IS the
    // declaration. The stream's extra duty over the shared rule is choosing
    // remove-vs-skip for a non-member: an ephemeral fact actively DROPS any
    // existing vector under its key (a durable fact later reusing it re-embeds
    // on its own write); a merely unembeddable value just skips.
    const text = indexableText({ key, value: img?.value, superseded: img?.superseded, timerEffect: img?.timerEffect });
    if (!text) {
      if (img?.timerEffect === 'delete') planFor(index, scope).removes.add(key);
      continue;
    }
    // sha-skip: a metadata-only rewrite (same embeddable text, still live) leaves the
    // vector unchanged — don't re-embed.
    if (old && !old.superseded && indexableText({ key, value: old.value, timerEffect: old.timerEffect }) === text) continue;
    planFor(index, scope).puts.push({ key, text, meta: metadataForFact({ type: img?.type ?? undefined, tags: img?.tags, superseded: false }) });
  }
  return plans;
}

export async function handler(event: StreamEvent): Promise<void> {
  const vectors = vectorsFromEnv();
  if (!vectors) return; // backend not configured → no-op (safe)

  // The embedder is the ONE dimension source — index name and written vectors
  // derive from the same value, so they cannot skew.
  const dim = vectors.embedder.dimension;
  const plans = planStreamWork(event, dim);
  if (!plans.size) return;
  // ADR-0031: inferred similarTo edges live in the substrate table; the indexer writes
  // them directly through the raw store (no trajectory/resolve side effects).
  const sim = similarConfig();
  const table = process.env.SUBSTRATE_TABLE;
  const edgeStore: StateStore | null = sim.enabled && table ? createDynamoStateStore(table) : null;

  for (const [index, { scope, puts, removes }] of plans) {
    await vectors.store.ensureIndex(index, { dimension: dim });
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
 *  using its persisted PCA basis. CAS'd on the read version, and RETRIED on a
 *  lost race (re-read fresh, re-apply this batch's delta, up to
 *  {@link PATCH_ATTEMPTS}) — the original silent-no-op-on-conflict design
 *  converged for a trickle of writes but diverged under exactly the load that
 *  matters: the 2026-07-12 ADR-0081 bulk backfill (155 docs × 4 concurrent
 *  workers → hundreds of stream batches racing this one fact) lost nearly
 *  every patch, and ~800+ renderable facts silently accumulated with no
 *  coordinate — rendering as the fixed-radius fallback ring in the home
 *  graph (the "cylinder halo" incident). Optimistic-concurrency retry makes
 *  a storm converge: each loser re-reads the winner's fact and reapplies
 *  only its own delta on top. Exported (like {@link planStreamWork}) so the
 *  logic is unit-testable against a plain `StateStore`, without AWS. */
const PATCH_ATTEMPTS = 4;
export async function patchProjection(
  store: StateStore,
  scope: string,
  puts: Array<{ key: string; vector: number[] }>,
  removes: string[],
): Promise<void> {
  const state = createObservedState(store);
  const entry = await state.get(scope, LAYOUT_KEY);
  if (!entry) return; // no map yet — the first `workspace.project` creates one
  const mv = entry.value as Partial<LayoutManifest> & Partial<ProjectionFact>;
  if (!mv?.basis || !mv?.norm) return; // pre-basis projection — needs a fresh `project()` first
  const basis = mv.basis, norm = mv.norm;

  // Sharded atlas (ADR-0082): group this batch's deltas by shard and patch
  // each shard independently — contention and payload both divide by the
  // shard count vs the old whole-monolith read-modify-write.
  if (typeof mv.shards === 'number' && mv.shards > 0) {
    const byShard = new Map<number, { puts: Array<{ key: string; xyz: [number, number, number] }>; removes: string[] }>();
    const bucket = (i: number) => {
      let b = byShard.get(i);
      if (!b) byShard.set(i, (b = { puts: [], removes: [] }));
      return b;
    };
    for (const { key, vector } of puts) bucket(layoutShardOf(key, mv.shards)).puts.push({ key, xyz: projectVector(vector, basis, norm) });
    for (const key of removes) bucket(layoutShardOf(key, mv.shards)).removes.push(key);
    for (const [i, delta] of byShard) await patchShard(state, scope, layoutShardKey(i), delta);
    return;
  }

  // Legacy monolith (pre-migration window): the original whole-fact CAS+retry.
  for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt++) {
    const cur = attempt === 0 ? entry : await state.get(scope, LAYOUT_KEY);
    if (!cur) return;
    const fact = cur.value as ProjectionFact;
    if (!fact?.basis || !fact?.norm) return;
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
    try {
      await state.put({
        scope,
        key: LAYOUT_KEY,
        value: { ...fact, coords, count: Object.keys(coords).length },
        via: 'vector-indexer',
        type: 'graph-layout',
        ifVersion: cur._meta.version,
      });
      return;
    } catch (err) {
      // Only a lost CAS race earns a retry; anything else propagates to the
      // caller's best-effort warn. The final lost race propagates too — a
      // dropped patch should be VISIBLE in the logs now, not silent.
      if (!(err instanceof StatePreconditionError) || attempt === PATCH_ATTEMPTS - 1) throw err;
      // Small jitter so N stream batches don't re-collide in lockstep.
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 160));
    }
  }
}

/** CAS+retry read-modify-write of ONE coord shard. A shard that doesn't
 *  exist yet (created between full project() runs) starts empty. */
async function patchShard(
  state: ReturnType<typeof createObservedState>,
  scope: string,
  shardKey: string,
  delta: { puts: Array<{ key: string; xyz: [number, number, number] }>; removes: string[] },
): Promise<void> {
  for (let attempt = 0; attempt < PATCH_ATTEMPTS; attempt++) {
    const cur = await state.get(scope, shardKey);
    const coords: Record<string, [number, number, number]> = { ...((cur?.value as LayoutShard | undefined)?.coords ?? {}) };
    let changed = false;
    for (const p of delta.puts) {
      coords[p.key] = p.xyz;
      changed = true;
    }
    for (const key of delta.removes) {
      if (key in coords) {
        delete coords[key];
        changed = true;
      }
    }
    if (!changed) return;
    try {
      await state.put({
        scope,
        key: shardKey,
        value: { coords },
        via: 'vector-indexer',
        type: 'graph-layout-shard',
        ...(cur ? { ifVersion: cur._meta.version } : { ifAbsent: true }),
      });
      return;
    } catch (err) {
      if (!(err instanceof StatePreconditionError) || attempt === PATCH_ATTEMPTS - 1) throw err;
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 160));
    }
  }
}
