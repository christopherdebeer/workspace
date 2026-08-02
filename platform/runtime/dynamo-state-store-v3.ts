/**
 * DynamoDB-backed `StateStore` on the **AWS SDK v3** (ADR-0042 Inc 1, the
 * platform-SDK-for-cells store). Behaviourally identical to `dynamo-state-store.ts`
 * (same substrate-table item shapes, via the shared `state-store-codec.ts`) — it
 * exists because a forge-deployed cell runs on the **Node 20** Lambda runtime,
 * which ships AWS SDK **v3** ambiently but NOT v2. So a cell that runs the read
 * pipeline via `createCellReader(createDynamoStateStoreV3(table), owner)` resolves
 * `@aws-sdk/*` from the runtime (externalized by the forge bundler) instead of
 * failing on the absent v2 `aws-sdk`.
 *
 * The SDK is **lazy-required inside the factory** (never a top-level import), so
 * importing this module costs nothing and doesn't force the SDK to load — the
 * platform convention the v2 store's top-level `import 'aws-sdk'` technically
 * breaks. The one `require` boundary is confined to minimal typed interfaces
 * (no `any` leaks past it).
 */
import {
  StatePreconditionError,
  touchKey,
  type ActorClass,
  type StateStore,
  type StateRecord,
  type EdgeRecord,
  type TrajectoryEvent,
  type PutGuard,
} from './state';
import {
  key as K,
  itemToRecord,
  itemToEdge,
  stripUndefined,
  touchesToItem,
  touchAttr,
  windowAttr,
  TOUCH_KEYS,
  WINDOW_BUCKET_ATTR,
  TRAJECTORY_TTL_SEC,
} from './state-store-codec';

/** The slice of the v3 DocumentClient this store uses — enough to stay typed
 *  without depending on `@aws-sdk/*` types at monorepo build (cells provide the
 *  package at runtime; the SDK is lazy-required). */
type Item = Record<string, unknown>;
interface V3Result {
  Item?: Item;
  Items?: Item[];
  Attributes?: Item;
  LastEvaluatedKey?: Record<string, unknown>;
}
interface V3Doc {
  send(cmd: unknown): Promise<V3Result>;
}
interface V3Lib {
  GetCommand: new (input: unknown) => unknown;
  PutCommand: new (input: unknown) => unknown;
  QueryCommand: new (input: unknown) => unknown;
  UpdateCommand: new (input: unknown) => unknown;
  DeleteCommand: new (input: unknown) => unknown;
  DynamoDBDocumentClient: { from(client: unknown, opts?: unknown): V3Doc };
}
interface V3ClientMod {
  DynamoDBClient: new (config: Record<string, unknown>) => unknown;
}

export function createDynamoStateStoreV3(tableName: string): StateStore {
  // Lazy require — resolved from the Lambda runtime (Node 20 ambient v3), never
  // bundled. Constructed once per store instance (per cold start), like the cells.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const client = require('@aws-sdk/client-dynamodb') as V3ClientMod;
  const lib = require('@aws-sdk/lib-dynamodb') as V3Lib;
  /* eslint-enable @typescript-eslint/no-var-requires */
  const doc = lib.DynamoDBDocumentClient.from(new client.DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });

  async function queryAll(input: Record<string, unknown>): Promise<Item[]> {
    const items: Item[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await doc.send(new lib.QueryCommand({ TableName: tableName, ...input, ExclusiveStartKey }));
      items.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
  }

  /** ADD ±delta to both endpoints' denormalized weighted degree (`degW`,
   *  2026-08-02 cost review; self-loop counts once — buildSignals parity).
   *  Conditional on the fact existing, so a dangling endpoint never mints a
   *  ghost item; the tend reconciler counts it in when the fact appears.
   *  Best-effort: a failed bump is drift the reconciler repairs, never a
   *  failed edge write. */
  async function bumpDegree(scope: string, from: string, to: string, delta: number): Promise<void> {
    const bump = async (key: string): Promise<void> => {
      try {
        await doc.send(
          new lib.UpdateCommand({
            TableName: tableName,
            Key: { pk: K.statePk(scope), sk: K.factSk(key) },
            UpdateExpression: 'ADD degW :d',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeValues: { ':d': delta },
          }),
        );
      } catch (err) {
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') {
          console.warn('degW bump failed (tend reconciles)', { key, error: (err as Error).message });
        }
      }
    };
    await bump(from);
    if (to !== from) await bump(to);
  }

  return {
    async nextSeq(scope: string): Promise<number> {
      const res = await doc.send(
        new lib.UpdateCommand({
          TableName: tableName,
          Key: { pk: K.seqPk(scope), sk: 'A' },
          UpdateExpression: 'ADD seq :one',
          ExpressionAttributeValues: { ':one': 1 },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return Number(res.Attributes?.seq ?? 0);
    },

    async currentSeq(scope: string): Promise<number> {
      const res = await doc.send(new lib.GetCommand({ TableName: tableName, Key: { pk: K.seqPk(scope), sk: 'A' } }));
      return Number(res.Item?.seq ?? 0);
    },

    async get(scope: string, k: string): Promise<StateRecord | null> {
      const res = await doc.send(new lib.GetCommand({ TableName: tableName, Key: { pk: K.statePk(scope), sk: K.factSk(k) } }));
      return res.Item ? itemToRecord(res.Item) : null;
    },

    async put(record: StateRecord, guard?: PutGuard): Promise<void> {
      // touches/window persist as FLAT attributes (t_hr…/w_hr…/w_b) so
      // `recordTouch` can bump one with a single ADD — never as nested maps.
      const { touches: _touches, window: _window, ...fields } = record;
      const item: Item = { pk: K.statePk(record.scope), sk: K.factSk(record.key), ...fields, ...touchesToItem(record) };
      if (record.type) {
        item.gsi2pk = K.typePk(record.scope, record.type);
        item.gsi2sk = record.updatedAt;
      }
      if (record.timerEffect === 'delete' && record.timerExpiresAt) {
        item.ttl = Math.floor(Date.parse(record.timerExpiresAt) / 1000) + 24 * 60 * 60;
      }
      const input: Record<string, unknown> = { TableName: tableName, Item: stripUndefined(item) };
      if (guard) {
        if (guard.expectRevision === null) {
          input.ConditionExpression = 'attribute_not_exists(pk)';
        } else {
          input.ConditionExpression = 'revision = :rev';
          input.ExpressionAttributeValues = { ':rev': guard.expectRevision };
        }
      }
      try {
        await doc.send(new lib.PutCommand(input));
      } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          throw new StatePreconditionError(`"${record.key}" failed its write condition`);
        }
        throw err;
      }
    },

    async list(scope: string, keyPrefix?: string): Promise<StateRecord[]> {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': K.statePk(scope), ':p': `KEY#${keyPrefix ?? ''}` },
      });
      return items.map(itemToRecord);
    },

    async listByType(scope: string, type: string): Promise<StateRecord[]> {
      const items = await queryAll({
        IndexName: 'gsi-type',
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: { ':pk': K.typePk(scope, type) },
      });
      return items.map(itemToRecord);
    },

    async putEdge(edge: EdgeRecord): Promise<void> {
      const res = await doc.send(
        new lib.PutCommand({
          TableName: tableName,
          Item: stripUndefined({
            pk: K.statePk(edge.scope),
            sk: K.edgeSk(edge.from, edge.rel, edge.to),
            gsi1pk: K.inPk(edge.scope, edge.to),
            gsi1sk: K.inSk(edge.rel, edge.from),
            ...edge,
          }),
          // ALL_OLD is the double-count guard: the similarTo reconciler
          // re-puts existing edges to refresh scores — the degree delta is
          // new-strength − old-strength (0 for a same-strength rewrite),
          // never a blind +1.
          ReturnValues: 'ALL_OLD',
        }),
      );
      const oldRaw = res.Attributes?.strength;
      const oldW = res.Attributes ? (oldRaw == null ? 1 : Number(oldRaw) || 0) : 0;
      const delta = (edge.strength ?? 1) - oldW;
      if (delta) await bumpDegree(edge.scope, edge.from, edge.to, delta);
    },

    async deleteEdge(scope, from, rel, to): Promise<void> {
      const res = await doc.send(
        new lib.DeleteCommand({
          TableName: tableName,
          Key: { pk: K.statePk(scope), sk: K.edgeSk(from, rel, to) },
          ReturnValues: 'ALL_OLD',
        }),
      );
      if (res.Attributes) {
        const w = res.Attributes.strength == null ? 1 : Number(res.Attributes.strength) || 0;
        if (w) await bumpDegree(scope, from, to, -w);
      }
    },

    async setDegree(scope: string, key: string, degW: number): Promise<void> {
      try {
        await doc.send(
          new lib.UpdateCommand({
            TableName: tableName,
            Key: { pk: K.statePk(scope), sk: K.factSk(key) },
            UpdateExpression: 'SET degW = :d',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeValues: { ':d': degW },
          }),
        );
      } catch (err) {
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
      }
    },

    async edgesFrom(scope, from, rel?): Promise<EdgeRecord[]> {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': K.statePk(scope), ':p': `EDGE#${from}|${rel ? `${rel}|` : ''}` },
      });
      return items.map(itemToEdge);
    },

    async edgesTo(scope, to, rel?): Promise<EdgeRecord[]> {
      const items = await queryAll(
        rel
          ? {
              IndexName: 'gsi-in',
              KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :p)',
              ExpressionAttributeValues: { ':pk': K.inPk(scope, to), ':p': `${rel}|` },
            }
          : {
              IndexName: 'gsi-in',
              KeyConditionExpression: 'gsi1pk = :pk',
              ExpressionAttributeValues: { ':pk': K.inPk(scope, to) },
            },
      );
      return items.map(itemToEdge);
    },

    async listEdges(scope): Promise<EdgeRecord[]> {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': K.statePk(scope), ':p': 'EDGE#' },
      });
      return items.map(itemToEdge);
    },

    async appendTrajectory(event: TrajectoryEvent): Promise<void> {
      await doc.send(
        new lib.PutCommand({
          TableName: tableName,
          Item: stripUndefined({
            pk: K.trajPk(event.scope),
            sk: K.trajSk(event.at, event.seq),
            op: event.op,
            scope: event.scope,
            key: event.key,
            rel: event.rel,
            to: event.to,
            at: event.at,
            seq: event.seq,
            ttl: Math.floor(Date.parse(event.at) / 1000) + TRAJECTORY_TTL_SEC,
          }),
        }),
      );
    },

    async recentTrajectory(scope: string, sinceMs: number): Promise<TrajectoryEvent[]> {
      const since = new Date(sinceMs).toISOString();
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND sk >= :since',
        ExpressionAttributeValues: { ':pk': K.trajPk(scope), ':since': since },
      });
      return items.map((i) => ({
        op: i.op as TrajectoryEvent['op'],
        scope: i.scope as string,
        key: (i.key as string | null) ?? null,
        ...(i.rel !== undefined ? { rel: i.rel as string } : {}),
        ...(i.to !== undefined ? { to: i.to as string } : {}),
        at: i.at as string,
        seq: Number(i.seq),
      }));
    },

    async recordTouch(scope: string, key: string, actor: ActorClass, op: 'read' | 'write', bucket: number): Promise<void> {
      const k = touchKey(actor, op);
      const Key = { pk: K.statePk(scope), sk: K.factSk(key) };
      const isCheckFailure = (err: unknown): boolean => (err as { name?: string }).name === 'ConditionalCheckFailedException';
      try {
        // Fast path: the window bucket is current (or was never set) → one ADD
        // bumps the lifetime counter and the in-bucket counter together.
        await doc.send(
          new lib.UpdateCommand({
            TableName: tableName,
            Key,
            UpdateExpression: `ADD ${touchAttr(k)} :one, ${windowAttr(k)} :one SET ${WINDOW_BUCKET_ATTR} = :bucket`,
            ConditionExpression: `attribute_exists(pk) AND (attribute_not_exists(${WINDOW_BUCKET_ATTR}) OR ${WINDOW_BUCKET_ATTR} = :bucket)`,
            ExpressionAttributeValues: { ':one': 1, ':bucket': bucket },
          }),
        );
      } catch (err) {
        if (!isCheckFailure(err)) throw err;
        // The bucket rolled over (or the fact is absent). Reset the window to
        // this bucket with only this touch, still bumping the lifetime counter.
        const zeroes = TOUCH_KEYS.map((tk) => `${windowAttr(tk)} = ${tk === k ? ':one' : ':zero'}`).join(', ');
        try {
          await doc.send(
            new lib.UpdateCommand({
              TableName: tableName,
              Key,
              UpdateExpression: `ADD ${touchAttr(k)} :one SET ${WINDOW_BUCKET_ATTR} = :bucket, ${zeroes}`,
              ConditionExpression: 'attribute_exists(pk)',
              ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':bucket': bucket },
            }),
          );
        } catch (err2) {
          if (!isCheckFailure(err2)) throw err2; // fact absent → attention on nothing is a no-op
        }
      }
    },
  };
}
