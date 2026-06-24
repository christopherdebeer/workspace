/**
 * VENDORED COPY — do not edit here. Canonical source: cells/kernel/static/substrate.js.
 * A server-side `https://` import hangs the forge bundler (ADR-0017), so the machine
 * cell imports this relative copy instead of the kernel URL. Keep in sync until the
 * client is published as an npm package and imported by bare specifier.
 *
 * @c15r/kernel/substrate — the shared SERVER-side substrate client (ADR-0017).
 *
 * One module instead of every cell re-hand-rolling DynamoDB reads + EventBridge
 * organ writes. A tier-2 cell's Lambda imports it by URL (the same mechanism
 * cells already use for the browser kernel):
 *
 *     import { createSubstrate } from 'https://parc.land/@c15r/kernel/substrate.js';
 *     const sub = createSubstrate();              // reads SUBSTRATE_TABLE / EVENT_BUS_NAME / CELL_OWNER
 *     const run = await sub.read('machine-run/42');
 *     await sub.emit([{ key: 'machine-run/42', value: {...}, type: 'machine-run' }]);
 *
 * The capability surface is exactly what the IAM scope already grants every
 * dynamic cell (services/cells/cell-template.ts): READ-ONLY, owner-scoped DDB
 * (`GetItem`/`Query` over `STATE#<owner>` / GSIs) for observation, and the
 * provenance-attested organ path (`substrate.write.requested`) for writes — a
 * cell never PutItems state; it *requests* a write the workspace applies with
 * attribution (services/workspace/handlers.ts createSubstrateWriteHandler).
 *
 * The AWS SDK is required lazily so importing this module never forces the SDK
 * (it isn't installed in the platform repo — the Lambda runtime provides it; the
 * cell bundler marks it external). Clients are injectable for unit tests.
 *
 * Git truth: cells/kernel/static/substrate.js. Served verbatim at
 * /@c15r/kernel/substrate.js. Pure key/detail shaping is exported for testing.
 */

const STATE = (owner) => `STATE#${owner}`;
const KEYSK = (key) => `KEY#${key}`;
const TYPEPK = (owner, type) => `TYPE#${owner}#${type}`;

/** The organ-path write detail for a fact write (provenance attributed server-side). */
export function writeDetail(w, via) {
  return {
    key: w.key,
    value: w.value,
    ...(w.type !== undefined ? { type: w.type } : {}),
    ...(w.tags !== undefined ? { tags: w.tags } : {}),
    via: w.via ?? via,
  };
}

/** The organ-path detail for a supersede (reversible retire, not a delete). */
export function supersedeDetail(key, via) {
  return { key, op: 'supersede', via };
}

// Lazily-built adapters over the AWS SDK. Importing this module never requires
// the SDK; only the first real read/write does (and tests inject adapters, so
// they never touch it). The adapter shape is the seam: `{ get, query }` for DDB,
// `{ putEvents }` for EventBridge — small enough to stub in a unit test.
function lazyDdbAdapter() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, GetCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return {
    get: (input) => doc.send(new GetCommand(input)),
    query: (input) => doc.send(new QueryCommand(input)),
  };
}
function lazyEventsAdapter() {
  const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
  const client = new EventBridgeClient({});
  return { putEvents: (entries) => client.send(new PutEventsCommand({ Entries: entries })) };
}

/**
 * Build a substrate client bound to one owner scope. Options default from the
 * cell's environment; pass `ddb`/`events` stubs to unit-test without the SDK.
 */
export function createSubstrate(opts = {}) {
  const env = (typeof process !== 'undefined' && process.env) || {};
  const owner = opts.owner ?? env.CELL_OWNER ?? 'c15r';
  const table = opts.table ?? env.SUBSTRATE_TABLE;
  const bus = opts.bus ?? env.EVENT_BUS_NAME;
  const source = opts.source ?? env.SERVICE_NAME ?? 'cell';
  const via = opts.via ?? 'cell';

  // Adapters: `{ get, query }` (DDB) and `{ putEvents }` (EventBridge). Injected
  // for tests; otherwise built lazily on first use.
  let _ddb = opts.ddb ?? null;
  let _events = opts.events ?? null;
  const ddb = () => (_ddb ??= lazyDdbAdapter());
  const events = () => (_events ??= lazyEventsAdapter());

  const decode = (item) =>
    item && !item.superseded
      ? { key: typeof item.sk === 'string' ? item.sk.slice('KEY#'.length) : item.key, value: item.value, meta: { type: item.type ?? null, tags: item.tags ?? [], revision: item.revision, updatedAt: item.updatedAt } }
      : null;

  /** Read one fact by key from the owner's slice; null if absent or superseded. */
  async function read(key) {
    if (!table) throw new Error('SUBSTRATE_TABLE unavailable (cell not provisioned for substrate reads)');
    const res = await ddb().get({ TableName: table, Key: { pk: STATE(owner), sk: KEYSK(key) } });
    const item = res.Item;
    if (!item || item.superseded) return null;
    return { key, value: item.value, meta: { type: item.type ?? null, tags: item.tags ?? [], revision: item.revision, updatedAt: item.updatedAt } };
  }

  /**
   * Query the owner's slice. `{ prefix }` walks `KEY#<prefix>` on the base table;
   * `{ type }` walks the `gsi-type` index by recency. Returns `[{ key, value, meta }]`,
   * superseded facts filtered out.
   */
  async function query(q = {}) {
    if (!table) throw new Error('SUBSTRATE_TABLE unavailable (cell not provisioned for substrate reads)');
    const limit = Math.min(Number(q.limit) || 50, 200);
    const input = q.type
      ? {
          TableName: table,
          IndexName: 'gsi-type',
          KeyConditionExpression: 'gsi2pk = :pk',
          ExpressionAttributeValues: { ':pk': TYPEPK(owner, q.type) },
          ScanIndexForward: false, // recency: newest first
          Limit: limit,
        }
      : {
          TableName: table,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': STATE(owner), ':sk': KEYSK(String(q.prefix ?? '')) },
          Limit: limit,
        };
    const res = await ddb().query(input);
    return ((res.Items ?? []).map(decode)).filter(Boolean);
  }

  /**
   * Request one or more fact writes via the organ path (applied asynchronously,
   * attributed to this cell). Unlike the silent fire-and-forget the cells used to
   * hand-roll, this checks `FailedEntryCount` and throws if any entry failed to
   * enqueue (the silent-drop half of ADR-0011's gap, closed here once).
   */
  async function emit(writes) {
    const list = Array.isArray(writes) ? writes : [writes];
    if (!list.length) return { requested: 0 };
    if (!bus) throw new Error('event bus unavailable (EVENT_BUS_NAME unset)');
    const entries = list.map((w) => ({
      EventBusName: bus,
      Source: source,
      DetailType: 'substrate.write.requested',
      Detail: JSON.stringify(writeDetail(w, via)),
    }));
    let failed = 0;
    // PutEvents accepts at most 10 entries per call.
    for (let i = 0; i < entries.length; i += 10) {
      const res = await events().putEvents(entries.slice(i, i + 10));
      failed += res.FailedEntryCount ?? 0;
    }
    if (failed > 0) throw new Error(`emit: ${failed}/${entries.length} substrate writes failed to enqueue`);
    return { requested: entries.length };
  }

  /** Retire a fact through the organ path (reversible — history is kept). */
  async function supersede(key) {
    if (!bus) throw new Error('event bus unavailable (EVENT_BUS_NAME unset)');
    const res = await events().putEvents([{ EventBusName: bus, Source: source, DetailType: 'substrate.write.requested', Detail: JSON.stringify(supersedeDetail(key, via)) }]);
    if ((res.FailedEntryCount ?? 0) > 0) throw new Error(`supersede of "${key}" failed to enqueue`);
    return { ok: true, key };
  }

  return { owner, table, read, query, emit, supersede };
}
