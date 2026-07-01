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
  type StateStore,
  type StateRecord,
  type EdgeRecord,
  type TrajectoryEvent,
  type PutGuard,
} from './state';
import { key as K, itemToRecord, itemToEdge, stripUndefined, TRAJECTORY_TTL_SEC } from './state-store-codec';

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
      const item: Item = { pk: K.statePk(record.scope), sk: K.factSk(record.key), ...record };
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

    async list(scope: string): Promise<StateRecord[]> {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': K.statePk(scope), ':p': 'KEY#' },
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
      await doc.send(
        new lib.PutCommand({
          TableName: tableName,
          Item: stripUndefined({
            pk: K.statePk(edge.scope),
            sk: K.edgeSk(edge.from, edge.rel, edge.to),
            gsi1pk: K.inPk(edge.scope, edge.to),
            gsi1sk: K.inSk(edge.rel, edge.from),
            ...edge,
          }),
        }),
      );
    },

    async deleteEdge(scope, from, rel, to): Promise<void> {
      await doc.send(new lib.DeleteCommand({ TableName: tableName, Key: { pk: K.statePk(scope), sk: K.edgeSk(from, rel, to) } }));
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
      return items.map((i) => ({ op: i.op as TrajectoryEvent['op'], scope: i.scope as string, key: (i.key as string | null) ?? null, at: i.at as string, seq: Number(i.seq) }));
    },
  };
}
