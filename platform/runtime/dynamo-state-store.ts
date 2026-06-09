/**
 * DynamoDB-backed StateStore for the observed-state primitive.
 *
 * Persists the storage-agnostic `StateStore` contract (see `./state.ts`) on the
 * shared **substrate table** (`platform/infra/substrate-table.ts`) — one
 * scope-partitioned table whose partition prefix is the authority boundary.
 *
 * Item shapes, all within one scope's partition family:
 *   - fact record:  pk=`STATE#<scope>`  sk=`KEY#<key>`     (durable — no TTL)
 *       + when typed: gsi2pk=`TYPE#<scope>#<type>`, gsi2sk=`<updatedAt>`
 *   - edge:         pk=`STATE#<scope>`  sk=`EDGE#<from>|<rel>|<to>`
 *       + inbound index: gsi1pk=`IN#<scope>#<to>`, gsi1sk=`<rel>|<from>`
 *   - trajectory:   pk=`TRAJ#<scope>`   sk=`<iso>#<seq>`   (TTL'd — salience only)
 *   - seq counter:  pk=`SEQ#<scope>`    sk=`A`             (atomic ADD)
 *
 * Facts are durable (supersede, don't delete); only the trajectory log carries a
 * TTL, since it exists purely to compute salience over a recent window. Every
 * GSI partition key repeats the scope so `dynamodb:LeadingKeys` conditions cover
 * index reads too.
 */
import { DynamoDB, AWSError } from 'aws-sdk';
import {
  StatePreconditionError,
  type StateStore,
  type StateRecord,
  type EdgeRecord,
  type TrajectoryEvent,
  type PutCondition,
} from './state';

/** How long trajectory events live (s). Comfortably beyond the salience window. */
const TRAJECTORY_TTL_SEC = 24 * 60 * 60;

export function createDynamoStateStore(tableName: string): StateStore {
  const db = new DynamoDB.DocumentClient();
  const statePk = (scope: string): string => `STATE#${scope}`;
  const trajPk = (scope: string): string => `TRAJ#${scope}`;
  const edgeSk = (from: string, rel: string, to: string): string => `EDGE#${from}|${rel}|${to}`;

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
      type: item.type ?? null,
      tags: Array.isArray(item.tags) ? item.tags : [],
    };
  }

  function toEdge(item: DynamoDB.DocumentClient.AttributeMap): EdgeRecord {
    return {
      scope: item.scope,
      from: item.from,
      rel: item.rel,
      to: item.to,
      strength: item.strength ?? null,
      createdAt: item.createdAt,
      writer: item.writer ?? null,
    };
  }

  async function queryAll(
    params: Omit<DynamoDB.DocumentClient.QueryInput, 'TableName'>,
  ): Promise<DynamoDB.DocumentClient.AttributeMap[]> {
    const items: DynamoDB.DocumentClient.AttributeMap[] = [];
    let ExclusiveStartKey: DynamoDB.DocumentClient.Key | undefined;
    do {
      const res = await db.query({ TableName: tableName, ...params, ExclusiveStartKey }).promise();
      items.push(...(res.Items ?? []));
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
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

    async currentSeq(scope: string): Promise<number> {
      const res = await db.get({ TableName: tableName, Key: { pk: `SEQ#${scope}`, sk: 'A' } }).promise();
      return Number(res.Item?.seq ?? 0);
    },

    async get(scope: string, key: string): Promise<StateRecord | null> {
      const res = await db
        .get({ TableName: tableName, Key: { pk: statePk(scope), sk: `KEY#${key}` } })
        .promise();
      return res.Item ? toRecord(res.Item) : null;
    },

    async put(record: StateRecord, cond?: PutCondition): Promise<void> {
      const item: DynamoDB.DocumentClient.AttributeMap = {
        pk: statePk(record.scope),
        sk: `KEY#${record.key}`,
        ...record,
      };
      // Typed facts join the type/recency index (scope-prefixed for LeadingKeys).
      if (record.type) {
        item.gsi2pk = `TYPE#${record.scope}#${record.type}`;
        item.gsi2sk = record.updatedAt;
      }
      const params: DynamoDB.DocumentClient.PutItemInput = { TableName: tableName, Item: item };
      if (cond?.ifAbsent || cond?.ifRevision === 0) {
        params.ConditionExpression = 'attribute_not_exists(pk)';
      } else if (cond?.ifRevision !== undefined) {
        params.ConditionExpression = 'revision = :ifrev';
        params.ExpressionAttributeValues = { ':ifrev': cond.ifRevision };
      }
      try {
        await db.put(params).promise();
      } catch (err) {
        if ((err as AWSError).code === 'ConditionalCheckFailedException') {
          throw new StatePreconditionError(`"${record.key}" failed its write condition`);
        }
        throw err;
      }
    },

    async list(scope: string): Promise<StateRecord[]> {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': statePk(scope), ':p': 'KEY#' },
      });
      return items.map(toRecord);
    },

    async listByType(scope: string, type: string): Promise<StateRecord[]> {
      const items = await queryAll({
        IndexName: 'gsi-type',
        KeyConditionExpression: 'gsi2pk = :pk',
        ExpressionAttributeValues: { ':pk': `TYPE#${scope}#${type}` },
      });
      return items.map(toRecord);
    },

    async putEdge(edge: EdgeRecord): Promise<void> {
      await db
        .put({
          TableName: tableName,
          Item: {
            pk: statePk(edge.scope),
            sk: edgeSk(edge.from, edge.rel, edge.to),
            gsi1pk: `IN#${edge.scope}#${edge.to}`,
            gsi1sk: `${edge.rel}|${edge.from}`,
            ...edge,
          },
        })
        .promise();
    },

    async deleteEdge(scope, from, rel, to): Promise<void> {
      await db
        .delete({ TableName: tableName, Key: { pk: statePk(scope), sk: edgeSk(from, rel, to) } })
        .promise();
    },

    async edgesFrom(scope, from, rel?): Promise<EdgeRecord[]> {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': statePk(scope), ':p': `EDGE#${from}|${rel ? `${rel}|` : ''}` },
      });
      return items.map(toEdge);
    },

    async edgesTo(scope, to, rel?): Promise<EdgeRecord[]> {
      const params: Omit<DynamoDB.DocumentClient.QueryInput, 'TableName'> = {
        IndexName: 'gsi-in',
        KeyConditionExpression: rel ? 'gsi1pk = :pk AND begins_with(gsi1sk, :p)' : 'gsi1pk = :pk',
        ExpressionAttributeValues: rel
          ? { ':pk': `IN#${scope}#${to}`, ':p': `${rel}|` }
          : { ':pk': `IN#${scope}#${to}` },
      };
      const items = await queryAll(params);
      return items.map(toEdge);
    },

    async listEdges(scope): Promise<EdgeRecord[]> {
      const items = await queryAll({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': statePk(scope), ':p': 'EDGE#' },
      });
      return items.map(toEdge);
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
      const items = await queryAll({
        // sk is `<iso>#<seq>`; an iso lower bound selects events at/after `since`.
        KeyConditionExpression: 'pk = :pk AND sk >= :since',
        ExpressionAttributeValues: { ':pk': trajPk(scope), ':since': since },
      });
      return items.map((i) => ({ op: i.op, scope: i.scope, key: i.key ?? null, at: i.at, seq: Number(i.seq) }));
    },
  };
}
