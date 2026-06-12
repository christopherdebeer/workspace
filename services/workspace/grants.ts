/**
 * Grants — the sharing layer that turns the one Substrate into per-user *views*.
 *
 * A grant exposes a subset of an owner's slice into a grantee's workspace view:
 * a single `key`, a key prefix (`inbox/*`), or `*` for the whole slice. `mode`
 * is the verb: `read` (the default — visibility in the grantee's recall) or
 * `write` (write-through: the grantee may also `remember` into the covered
 * keys of the owner's slice, provenance-stamped as themselves). This is the
 * additive layer the substrate model anticipated — it changes which facts
 * `recall` assembles and which writes `remember` accepts, not the
 * observed-state primitive underneath. See docs/scope-grants.md.
 *
 * Storage mirrors the cell's other items on the standard pk/sk table:
 *   - by grantee:  pk=`GRANT#<grantee>`    sk=`<owner>#<key>`   (recall reads this)
 *   - by owner:    pk=`GRANTBY#<owner>`     sk=`<grantee>#<key>` (manage what I shared)
 */
import { DynamoDB } from 'aws-sdk';

/** `*` as the key means the whole slice is shared. */
export const WHOLE_SLICE = '*';

export type GrantMode = 'read' | 'write';

export interface Grant {
  owner: string;
  grantee: string;
  key: string;
  /** Absent = read (pre-mode grants stay read-only). Write implies read. */
  mode?: GrantMode;
  createdAt: string;
}

/** Whether a grant's key pattern covers a concrete key (`*` = whole slice; a trailing `*` = prefix). */
export function grantCovers(grantKey: string, key: string): boolean {
  if (grantKey === WHOLE_SLICE) return true;
  if (grantKey.endsWith('*')) return key.startsWith(grantKey.slice(0, -1));
  return grantKey === key;
}

export interface GrantStore {
  put(grant: Grant): Promise<void>;
  remove(owner: string, grantee: string, key: string): Promise<void>;
  /** Grants a viewer receives (used to assemble their view). */
  listForGrantee(grantee: string): Promise<Grant[]>;
  /** Grants an owner has made (used to manage sharing). */
  listByOwner(owner: string): Promise<Grant[]>;
}

export function createDynamoGrantStore(tableName: string): GrantStore {
  const db = new DynamoDB.DocumentClient();
  const item = (g: Grant) => ({
    owner: g.owner,
    grantee: g.grantee,
    key: g.key,
    ...(g.mode ? { mode: g.mode } : {}),
    createdAt: g.createdAt,
  });

  async function queryAll(pk: string): Promise<Grant[]> {
    const out: Grant[] = [];
    let ExclusiveStartKey: DynamoDB.DocumentClient.Key | undefined;
    do {
      const res = await db
        .query({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey,
        })
        .promise();
      for (const i of res.Items ?? [])
        out.push({
          owner: i.owner,
          grantee: i.grantee,
          key: i.key,
          ...(i.mode === 'write' || i.mode === 'read' ? { mode: i.mode as GrantMode } : {}),
          createdAt: i.createdAt,
        });
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  return {
    async put(grant) {
      await db
        .put({ TableName: tableName, Item: { pk: `GRANT#${grant.grantee}`, sk: `${grant.owner}#${grant.key}`, ...item(grant) } })
        .promise();
      await db
        .put({ TableName: tableName, Item: { pk: `GRANTBY#${grant.owner}`, sk: `${grant.grantee}#${grant.key}`, ...item(grant) } })
        .promise();
    },
    async remove(owner, grantee, key) {
      await db.delete({ TableName: tableName, Key: { pk: `GRANT#${grantee}`, sk: `${owner}#${key}` } }).promise();
      await db.delete({ TableName: tableName, Key: { pk: `GRANTBY#${owner}`, sk: `${grantee}#${key}` } }).promise();
    },
    listForGrantee(grantee) {
      return queryAll(`GRANT#${grantee}`);
    },
    listByOwner(owner) {
      return queryAll(`GRANTBY#${owner}`);
    },
  };
}

export function createMemoryGrantStore(): GrantStore {
  let grants: Grant[] = [];
  const same = (g: Grant, owner: string, grantee: string, key: string) =>
    g.owner === owner && g.grantee === grantee && g.key === key;
  return {
    async put(grant) {
      grants = grants.filter((g) => !same(g, grant.owner, grant.grantee, grant.key));
      grants.push({ ...grant });
    },
    async remove(owner, grantee, key) {
      grants = grants.filter((g) => !same(g, owner, grantee, key));
    },
    async listForGrantee(grantee) {
      return grants.filter((g) => g.grantee === grantee).map((g) => ({ ...g }));
    },
    async listByOwner(owner) {
      return grants.filter((g) => g.owner === owner).map((g) => ({ ...g }));
    },
  };
}
