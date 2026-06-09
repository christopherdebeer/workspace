/**
 * The dynamic-cell registry — the platform's runtime self-model.
 *
 * `forge` owns this table (its own `HttpServiceCell` DynamoDB table). It records
 * every dynamic cell so the platform can describe itself at runtime: who owns a
 * cell, what it's called, where its Lambda lives, who it's shared with, and what
 * state its stack is in. Other cells never read this table directly — they ask
 * `forge` (via its `resolveCell` command), preserving the cell boundary.
 *
 * Single-table `pk`/`sk` layout:
 *   - `CELL#<cellId>` / `A`            → the cell record
 *   - `OWNER#<owner>` / `CELL#<cellId>` → owner index (for `listByOwner`)
 */
import type { DynamoDB } from 'aws-sdk';

export type CellStatus = 'CREATING' | 'ACTIVE' | 'FAILED' | 'DELETING';

export interface CellRecord {
  cellId: string;
  name: string;
  owner: string;
  description: string | null;
  functionName: string;
  stackName: string;
  /** Principals allowed to invoke the cell (always includes the owner). */
  grants: string[];
  /** Public cells accept anonymous GETs via dispatch (a web-facing cell). */
  public: boolean;
  status: CellStatus;
  createdAt: string;
  updatedAt: string;
}

let docClient: DynamoDB.DocumentClient | undefined;

/** Inject a DocumentClient (tests). */
export function __setDocumentClient(stub: DynamoDB.DocumentClient | undefined): void {
  docClient = stub;
}

function getClient(): DynamoDB.DocumentClient {
  if (!docClient) {
    const AWS = require('aws-sdk') as typeof import('aws-sdk');
    docClient = new AWS.DynamoDB.DocumentClient();
  }
  return docClient;
}

const PROFILE_SK = 'A';

function toRecord(item: DynamoDB.DocumentClient.AttributeMap): CellRecord {
  return {
    cellId: String(item.cellId),
    name: String(item.name),
    owner: String(item.owner),
    description: (item.description as string | null) ?? null,
    functionName: String(item.functionName),
    stackName: String(item.stackName),
    grants: Array.isArray(item.grants) ? (item.grants as string[]) : [],
    public: !!item.public,
    status: item.status as CellStatus,
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  };
}

export interface CellRegistry {
  put(record: CellRecord): Promise<void>;
  get(cellId: string): Promise<CellRecord | null>;
  listByOwner(owner: string): Promise<CellRecord[]>;
  /** Cells the principal can access: those they own or were granted. */
  listAccessibleBy(principal: string): Promise<CellRecord[]>;
  setStatus(cellId: string, status: CellStatus): Promise<void>;
  addGrant(cellId: string, principal: string): Promise<CellRecord | null>;
}

export function createRegistry(tableName: string): CellRegistry {
  const db = getClient();

  const profileKey = (cellId: string) => ({ pk: `CELL#${cellId}`, sk: PROFILE_SK });

  return {
    async put(record: CellRecord): Promise<void> {
      await db
        .put({ TableName: tableName, Item: { ...profileKey(record.cellId), ...record } })
        .promise();
      await db
        .put({
          TableName: tableName,
          Item: { pk: `OWNER#${record.owner}`, sk: `CELL#${record.cellId}`, cellId: record.cellId },
        })
        .promise();
    },

    async get(cellId: string): Promise<CellRecord | null> {
      const res = await db.get({ TableName: tableName, Key: profileKey(cellId) }).promise();
      return res.Item ? toRecord(res.Item) : null;
    },

    async listByOwner(owner: string): Promise<CellRecord[]> {
      const idx = await db
        .query({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `OWNER#${owner}` },
        })
        .promise();
      const ids = (idx.Items ?? []).map((i) => String(i.cellId));
      const records = await Promise.all(ids.map((id) => this.get(id)));
      return records.filter((r): r is CellRecord => r !== null);
    },

    async listAccessibleBy(principal: string): Promise<CellRecord[]> {
      // Backed by a Scan of the profile rows (sk = "A"), filtered server-side on
      // the grants list (which always includes the owner). The registry is
      // small — bounded by the per-region cell quota — and there is no
      // grant-by-principal index, so a Scan is the right trade-off here; revisit
      // with a secondary index if cell counts grow large. Pages to completion.
      const records: CellRecord[] = [];
      let startKey: DynamoDB.DocumentClient.Key | undefined;
      do {
        const res = await db
          .scan({
            TableName: tableName,
            FilterExpression: 'sk = :a AND contains(grants, :p)',
            ExpressionAttributeValues: { ':a': PROFILE_SK, ':p': principal },
            ExclusiveStartKey: startKey,
          })
          .promise();
        for (const item of res.Items ?? []) records.push(toRecord(item));
        startKey = res.LastEvaluatedKey;
      } while (startKey);
      return records;
    },

    async setStatus(cellId: string, status: CellStatus): Promise<void> {
      await db
        .update({
          TableName: tableName,
          Key: profileKey(cellId),
          UpdateExpression: 'SET #s = :s, updatedAt = :u',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': status, ':u': new Date().toISOString() },
        })
        .promise();
    },

    async addGrant(cellId: string, principal: string): Promise<CellRecord | null> {
      const record = await this.get(cellId);
      if (!record) return null;
      if (!record.grants.includes(principal)) {
        record.grants = [...record.grants, principal];
        record.updatedAt = new Date().toISOString();
        await this.put(record);
      }
      return record;
    },
  };
}
