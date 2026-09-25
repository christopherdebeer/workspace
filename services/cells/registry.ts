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

/** Bundling phase for a `cells.deploy`. Deploy runs asynchronously (the bundle
 *  can outlast the synchronous request/edge timeout — see service.ts `deploy`),
 *  so the phase is recorded here and callers poll `getCell` until it's terminal. */
export type DeployPhase = 'DEPLOYING' | 'DEPLOYED' | 'FAILED';
export interface DeployState {
  phase: DeployPhase;
  /** The deploy version (`Date.now()` string) — the requested one, and the
   *  landed one once DEPLOYED. */
  version: string;
  requestedAt: string;
  /** Present only when `phase === 'FAILED'`. */
  error?: string;
  /**
   * The immutable source snapshot this deploy bundles (`tree:<hash>`). Pinned
   * at request time, so the worker builds exactly the tree that was asked for
   * — not whatever src/ holds by the time the event is delivered.
   */
  treeVersion?: string;
  /** ADR-0099: who requested it and (optionally) why — provenance only. */
  note?: DeployNote;
}

/** A deploy's provenance (ADR-0099): the authorized caller + optional why/where-from. */
export interface DeployNote {
  /** The principal that requested the deploy. */
  by?: string;
  /** The delegated leaf actor (ADR-0024), when a child token deployed. */
  actor?: string;
  /** The self-declared participant (ADR-0086) — provenance only. */
  participant?: string;
  /** Why — a commit-message-grade line, optional. */
  description?: string;
  /** Where the source came from, e.g. `git:owner/repo@sha`. */
  source?: string;
}

/** The last deploy that actually landed, kept apart from `deploy` (which the next request overwrites). */
export interface DeployedState {
  version: string;
  treeVersion?: string;
  deployedAt: string;
}

export interface CellRecord {
  cellId: string;
  name: string;
  owner: string;
  description: string | null;
  functionName: string;
  stackName: string;
  /** Principals allowed to invoke the cell (always includes the owner). */
  grants: string[];
  /**
   * Per-tool grants: principal → tool-name patterns (exact, or trailing `*`
   * like `list_*`). A principal here can reach the cell (dispatch, discovery)
   * but only call matching tools — the granular alternative to the
   * all-or-nothing `grants[]` (docs/scope-grants.md §4).
   */
  toolGrants?: Record<string, string[]>;
  /** Public cells accept anonymous GETs via dispatch (a web-facing cell). */
  public: boolean;
  /**
   * ADR-0095 — the cell owns a CDN-fronted static prefix at
   * `/@<owner>/<slug>/~/…` and is the miss handler for it. Changing this
   * re-renders the stack (it grants an S3 statement and sets the env the
   * handler writes through), so it is not a registry-only flip like `public`.
   */
  publicNamespace?: boolean;
  /**
   * The fact types this cell manages (from its `types.json`) — the canonical,
   * globally-readable type vocabulary (docs/type-vocabulary.md). Lives on the
   * registry (one global table) rather than a per-user slice, so every user —
   * and the anonymous landing — resolves a fact's open/edit path the same way.
   */
  types?: Array<Record<string, unknown>>;
  /**
   * Declared SSR reads (from the cell's `ssr.json`): substrate reads forge runs
   * AS THE AUTHENTICATED CALLER (via its service client — shaped salience/vocab,
   * no token handed to the cell) and injects into the cell's invocation, so a
   * cell can server-render real content without holding a credential or touching
   * storage. See `runSsrReads` in service.ts.
   */
  ssrReads?: Array<{ as: string; target: string; input?: Record<string, unknown>; paths?: string[]; where?: Record<string, string> }>;
  /**
   * Declared caller-writes (Phase 4, docs/capability-consent.md): write intents a
   * cell may ask dispatch to apply AS THE CALLER — the write twin of `ssrReads`.
   * Each entry bounds an allowed key prefix and optional fact types. dispatch
   * enforces requested writes ⊆ these AND `scope(caller, write)` at the act
   * boundary; the cell never receives a token. Persisted like `ssrReads`.
   */
  callerWrites?: Array<{ keyPrefix: string; types?: string[]; crossSlice?: boolean }>;
  status: CellStatus;
  /** The last/in-flight async deploy's phase (set by `cells.deploy`; polled via
   *  `getCell`). Absent until the cell has been deployed at least once. */
  deploy?: DeployState;
  /** The last successful deploy — what `cells.status`/`cells.diff` call "deployed". */
  lastDeployed?: DeployedState;
  /** Lambda timeout override (seconds, 10–300). */
  timeoutSeconds?: number;
  /** Lambda memory override (MB, 128–3008; template default 512). CPU scales
   *  with memory — the latency knob for CPU-bound SSR/scene assembly. */
  memoryMb?: number;
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
    ...(item.toolGrants && typeof item.toolGrants === 'object'
      ? { toolGrants: item.toolGrants as Record<string, string[]> }
      : {}),
    ...(Array.isArray(item.types) ? { types: item.types as Array<Record<string, unknown>> } : {}),
    ...(Array.isArray(item.ssrReads) ? { ssrReads: item.ssrReads as CellRecord['ssrReads'] } : {}),
    ...(Array.isArray(item.callerWrites) ? { callerWrites: item.callerWrites as CellRecord['callerWrites'] } : {}),
    public: !!item.public,
    // These three are STACK SHAPE, and `toRecord` is an explicit projection —
    // anything not named here is silently dropped on read, so a subsequent
    // configureCell that omits a knob re-renders the stack WITHOUT it. Caught
    // live: `configureCell {timeoutSeconds:30}` came back `publicNamespace:
    // false` and removed the S3 grant it had just been given, because the
    // read-back said the cell never had one. `timeoutSeconds`/`memoryMb` had
    // the same hole — the comment in configureCell promising that "a
    // memory-only change never resets timeout" was not true, because the
    // stored value never survived the read.
    ...(typeof item.publicNamespace === 'boolean' ? { publicNamespace: item.publicNamespace } : {}),
    ...(typeof item.timeoutSeconds === 'number' ? { timeoutSeconds: item.timeoutSeconds } : {}),
    ...(typeof item.memoryMb === 'number' ? { memoryMb: item.memoryMb } : {}),
    status: item.status as CellStatus,
    ...(item.deploy && typeof item.deploy === 'object' ? { deploy: item.deploy as DeployState } : {}),
    ...(item.lastDeployed && typeof item.lastDeployed === 'object' ? { lastDeployed: item.lastDeployed as DeployedState } : {}),
    createdAt: String(item.createdAt),
    updatedAt: String(item.updatedAt),
  };
}

/** The projection above, exposed for tests — a dropped field here is a stack
 *  knob silently reset on the next reconfigure. */
export const __toRecordForTests = toRecord;

export interface CellRegistry {
  put(record: CellRecord): Promise<void>;
  get(cellId: string): Promise<CellRecord | null>;
  listByOwner(owner: string): Promise<CellRecord[]>;
  /** Cells the principal can access: those they own or were granted. */
  listAccessibleBy(principal: string): Promise<CellRecord[]>;
  /** All ACTIVE cells — for the global type vocabulary (read-only, type decls are public). */
  listActive(): Promise<CellRecord[]>;
  setStatus(cellId: string, status: CellStatus): Promise<void>;
  /** Record the async deploy phase (DEPLOYING → DEPLOYED/FAILED). */
  setDeploy(cellId: string, deploy: DeployState): Promise<void>;
  /** Record the deploy that landed (survives the next DEPLOYING marker). */
  setLastDeployed(cellId: string, deployed: DeployedState): Promise<void>;
  /** Grant a principal: every tool (no `tools`), or just the named tool patterns. Re-granting replaces. */
  addGrant(cellId: string, principal: string, tools?: string[]): Promise<CellRecord | null>;
  /** Remove a principal's access entirely (full and per-tool). */
  removeGrant(cellId: string, principal: string): Promise<CellRecord | null>;
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
      // the grants list (which always includes the owner) or a per-tool grant.
      // The registry is small — bounded by the per-region cell quota — and there
      // is no grant-by-principal index, so a Scan is the right trade-off here;
      // revisit with a secondary index if cell counts grow large. Pages to completion.
      const records: CellRecord[] = [];
      let startKey: DynamoDB.DocumentClient.Key | undefined;
      do {
        const res = await db
          .scan({
            TableName: tableName,
            FilterExpression: 'sk = :a AND (contains(grants, :p) OR attribute_exists(toolGrants.#p))',
            ExpressionAttributeNames: { '#p': principal },
            ExpressionAttributeValues: { ':a': PROFILE_SK, ':p': principal },
            ExclusiveStartKey: startKey,
          })
          .promise();
        for (const item of res.Items ?? []) records.push(toRecord(item));
        startKey = res.LastEvaluatedKey;
      } while (startKey);
      return records;
    },

    async listActive(): Promise<CellRecord[]> {
      // Scan the profile rows for ACTIVE cells — the global type vocabulary is
      // public (type decls say *how* to open a fact, not *whether* you may).
      const records: CellRecord[] = [];
      let startKey: DynamoDB.DocumentClient.Key | undefined;
      do {
        const res = await db
          .scan({
            TableName: tableName,
            FilterExpression: 'sk = :a AND #s = :active',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':a': PROFILE_SK, ':active': 'ACTIVE' },
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

    async setDeploy(cellId: string, deploy: DeployState): Promise<void> {
      await db
        .update({
          TableName: tableName,
          Key: profileKey(cellId),
          UpdateExpression: 'SET deploy = :d, updatedAt = :u',
          ExpressionAttributeValues: { ':d': deploy, ':u': new Date().toISOString() },
        })
        .promise();
    },

    async setLastDeployed(cellId: string, deployed: DeployedState): Promise<void> {
      await db
        .update({
          TableName: tableName,
          Key: profileKey(cellId),
          UpdateExpression: 'SET lastDeployed = :ld, updatedAt = :u',
          ExpressionAttributeValues: { ':ld': deployed, ':u': new Date().toISOString() },
        })
        .promise();
    },

    async addGrant(cellId: string, principal: string, tools?: string[]): Promise<CellRecord | null> {
      const record = await this.get(cellId);
      if (!record) return null;
      if (tools && tools.length && principal !== record.owner) {
        // Per-tool grant replaces any prior standing (a re-grant can narrow).
        record.toolGrants = { ...record.toolGrants, [principal]: [...tools] };
        record.grants = record.grants.filter((g) => g !== principal);
      } else {
        if (record.toolGrants && principal in record.toolGrants) {
          const { [principal]: _dropped, ...rest } = record.toolGrants;
          record.toolGrants = rest;
        }
        if (!record.grants.includes(principal)) record.grants = [...record.grants, principal];
      }
      record.updatedAt = new Date().toISOString();
      await this.put(record);
      return record;
    },

    async removeGrant(cellId: string, principal: string): Promise<CellRecord | null> {
      const record = await this.get(cellId);
      if (!record || principal === record.owner) return record;
      record.grants = record.grants.filter((g) => g !== principal);
      if (record.toolGrants && principal in record.toolGrants) {
        const { [principal]: _dropped, ...rest } = record.toolGrants;
        record.toolGrants = rest;
      }
      record.updatedAt = new Date().toISOString();
      await this.put(record);
      return record;
    },
  };
}
