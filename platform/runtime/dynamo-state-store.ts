/**
 * DynamoDB-backed StateStore for the observed-state primitive.
 *
 * Persists the storage-agnostic `StateStore` contract (see `./state.ts`) on the
 * platform's standard single-table `pk`/`sk` schema — the same shape the auth
 * cell uses — so it runs on the table an `HttpServiceCell({ persistence: {
 * dynamo: true, dynamoTtl: true } })` creates.
 *
 * Item shapes, all within one scope's partition family:
 *   - fact record:  pk=`STATE#<scope>`  sk=`KEY#<key>`     (durable — no TTL)
 *   - trajectory:   pk=`TRAJ#<scope>`   sk=`<iso>#<seq>`   (TTL'd — salience only)
 *   - seq counter:  pk=`SEQ#<scope>`    sk=`A`             (atomic ADD)
 *
 * Facts are durable (supersede, don't delete); only the trajectory log carries a
 * TTL, since it exists purely to compute salience over a recent window.
 */
import { DynamoDB } from 'aws-sdk';
import type { StateStore, StateRecord, TrajectoryEvent } from './state';

/** How long trajectory events live (s). Comfortably beyond the salience window. */
const TRAJECTORY_TTL_SEC = 24 * 60 * 60;

export function createDynamoStateStore(tableName: string): StateStore {
  const db = new DynamoDB.DocumentClient();
  const statePk = (scope: string): string => `STATE#${scope}`;
  const trajPk = (scope: string): string => `TRAJ#${scope}`;

  function toRecord(item: DynamoDB.DocumentClient.AttributeMap): StateRecord {
    return {
      scope: item.scope,
      key: item.key,
      value: item.value ?? null,
      revision: Number(item.revision),
      seq: Number(item.seq),
      firstSeq: Number(item.firstSeq),
      writer: item.writer ?? null,
      via: item.via ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      writers: Array.isArray(item.writers) ? item.writers : [],
      superseded: !!item.superseded,
      supersededBy: item.supersededBy ?? null,
    };
  }

  return {
    async nextSeq(scope: string): Promise<number> {
      const res = await db
        .update({
          TableName: tableName,
          Key: { pk: `SEQ#${scope}`, sk: 'A' },
          UpdateExpression: 'ADD seq :one',
          ExpressionAttributeValues: { ':one': 1 },
          ReturnValues: 'UPDATED_NEW',
        })
        .promise();
      return Number(res.Attributes?.seq ?? 0);
    },

    async get(scope: string, key: string): Promise<StateRecord | null> {
      const res = await db
        .get({ TableName: tableName, Key: { pk: statePk(scope), sk: `KEY#${key}` } })
        .promise();
      return res.Item ? toRecord(res.Item) : null;
    },

    async put(record: StateRecord): Promise<void> {
      await db
        .put({
          TableName: tableName,
          Item: { pk: statePk(record.scope), sk: `KEY#${record.key}`, ...record },
        })
        .promise();
    },

    async list(scope: string): Promise<StateRecord[]> {
      const items: DynamoDB.DocumentClient.AttributeMap[] = [];
      let ExclusiveStartKey: DynamoDB.DocumentClient.Key | undefined;
      do {
        const res = await db
          .query({
            TableName: tableName,
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
            ExpressionAttributeValues: { ':pk': statePk(scope), ':p': 'KEY#' },
            ExclusiveStartKey,
          })
          .promise();
        items.push(...(res.Items ?? []));
        ExclusiveStartKey = res.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items.map(toRecord);
    },

    async appendTrajectory(event: TrajectoryEvent): Promise<void> {
      await db
        .put({
          TableName: tableName,
          Item: {
            pk: trajPk(event.scope),
            sk: `${event.at}#${String(event.seq).padStart(12, '0')}`,
            op: event.op,
            scope: event.scope,
            key: event.key,
            at: event.at,
            seq: event.seq,
            ttl: Math.floor(Date.parse(event.at) / 1000) + TRAJECTORY_TTL_SEC,
          },
        })
        .promise();
    },

    async recentTrajectory(scope: string, sinceMs: number): Promise<TrajectoryEvent[]> {
      const since = new Date(sinceMs).toISOString();
      const events: TrajectoryEvent[] = [];
      let ExclusiveStartKey: DynamoDB.DocumentClient.Key | undefined;
      do {
        const res = await db
          .query({
            TableName: tableName,
            // sk is `<iso>#<seq>`; an iso lower bound selects events at/after `since`.
            KeyConditionExpression: 'pk = :pk AND sk >= :since',
            ExpressionAttributeValues: { ':pk': trajPk(scope), ':since': since },
            ExclusiveStartKey,
          })
          .promise();
        for (const i of res.Items ?? []) {
          events.push({ op: i.op, scope: i.scope, key: i.key ?? null, at: i.at, seq: Number(i.seq) });
        }
        ExclusiveStartKey = res.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return events;
    },
  };
}
