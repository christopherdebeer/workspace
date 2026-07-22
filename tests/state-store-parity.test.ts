/**
 * StateStore backend parity (coherence audit, state-store-backends seam).
 *
 * The two backends round-trip differently by construction: the memory store
 * spreads records structurally (a new field survives automatically), while the
 * v3 Dynamo store funnels through the codec's hand-maintained field allowlist
 * (`itemToRecord`/`itemToEdge`) — so a new `StateRecord` field wired through
 * `put()` but missed in the codec is preserved in tests and silently DROPPED in
 * production. These tests close that trap: a fully-populated record/edge must
 * round-trip both backends to the same value, and the two `recordTouch`
 * implementations (memory `bumpTouches`/`bumpWindow` vs v3's DynamoDB `ADD` +
 * bucket-rollover fallback) must agree on the same (actor, op, bucket) sequence.
 *
 * The v3 store is driven FOR REAL — its lazy `require`s resolve to the mocked
 * `@aws-sdk/*` modules below, whose fake table implements exactly the
 * expression shapes the store issues. Both marshalling directions run.
 */
import { createMemoryStateStore, createObservedState } from '../platform/runtime';
import { createDynamoStateStoreV3 } from '../platform/runtime/dynamo-state-store-v3';
import { TOUCH_KEYS } from '../platform/runtime/state-store-codec';
import type { StateRecord, EdgeRecord, TouchCounters, TouchWindow, ActorClass, StateStore } from '../platform/runtime/state';

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  type Item = Record<string, unknown>;
  const table = new Map<string, Item>();
  const tkey = (key: Item): string => `${key.pk}|${key.sk}`;
  const checkFail = (): Error => Object.assign(new Error('conditional check failed'), { name: 'ConditionalCheckFailedException' });

  class Cmd {
    constructor(readonly input: Item) {}
  }
  class GetCommand extends Cmd {}
  class PutCommand extends Cmd {}
  class QueryCommand extends Cmd {}
  class UpdateCommand extends Cmd {}
  class DeleteCommand extends Cmd {}

  /** Evaluate the exact ConditionExpressions the v3 store issues. */
  function checkCondition(expr: string | undefined, item: Item | undefined, values: Item): void {
    if (!expr) return;
    if (expr.includes('attribute_not_exists(pk)')) {
      if (item) throw checkFail();
      return;
    }
    if (expr.includes('attribute_exists(pk)') && !item) throw checkFail();
    if (expr.includes('attribute_not_exists(w_b)')) {
      const ok = item?.w_b === undefined || item?.w_b === values[':bucket'];
      if (!ok) throw checkFail();
    }
    const rev = expr.match(/revision = :rev/);
    if (rev && item?.revision !== values[':rev']) throw checkFail();
  }

  /** Apply the `ADD a :v, b :v` / `SET x = :v, y = :v` grammar the store uses. */
  function applyUpdate(expr: string, item: Item, values: Item): void {
    const add = expr.match(/ADD ([^]*?)(?: SET |$)/)?.[1];
    const set = expr.match(/SET ([^]*)$/)?.[1];
    for (const part of add ? add.split(',') : []) {
      const [attr, ref] = part.trim().split(/\s+/);
      item[attr] = ((item[attr] as number | undefined) ?? 0) + (values[ref] as number);
    }
    for (const part of set ? set.split(',') : []) {
      const [attr, , ref] = part.trim().split(/\s+/);
      item[attr] = values[ref];
    }
  }

  const doc = {
    async send(cmd: Cmd): Promise<Item> {
      const input = cmd.input;
      if (cmd instanceof GetCommand) {
        return { Item: table.get(tkey(input.Key as Item)) };
      }
      if (cmd instanceof PutCommand) {
        const item = input.Item as Item;
        checkCondition(input.ConditionExpression as string | undefined, table.get(tkey(item)), (input.ExpressionAttributeValues as Item) ?? {});
        table.set(tkey(item), item);
        return {};
      }
      if (cmd instanceof DeleteCommand) {
        table.delete(tkey(input.Key as Item));
        return {};
      }
      if (cmd instanceof UpdateCommand) {
        const key = input.Key as Item;
        const values = (input.ExpressionAttributeValues as Item) ?? {};
        const existing = table.get(tkey(key));
        checkCondition(input.ConditionExpression as string | undefined, existing, values);
        const item = existing ?? { ...key };
        applyUpdate(input.UpdateExpression as string, item, values);
        table.set(tkey(key), item);
        return { Attributes: item };
      }
      if (cmd instanceof QueryCommand) {
        // Base-table forms only: `pk = :pk` (+ optional `begins_with(sk, :p)` /
        // `sk >= :since`). The parity tests don't exercise the GSIs.
        const values = input.ExpressionAttributeValues as Item;
        const items = [...table.values()].filter((i) => {
          if (i.pk !== values[':pk']) return false;
          if (values[':p'] !== undefined) return String(i.sk).startsWith(String(values[':p']));
          if (values[':since'] !== undefined) return String(i.sk) >= String(values[':since']);
          return true;
        });
        return { Items: items } as Item;
      }
      throw new Error('unhandled command');
    },
  };

  return {
    GetCommand,
    PutCommand,
    QueryCommand,
    UpdateCommand,
    DeleteCommand,
    DynamoDBDocumentClient: { from: () => doc },
    __table: table,
  };
});

const { __table } = jest.requireMock('@aws-sdk/lib-dynamodb') as { __table: Map<string, unknown> };

/** Zero-vs-absent is the one representational difference the two backends are
 *  ALLOWED: v3's rollover SETs every window counter (zeroes materialize), the
 *  memory store leaves untouched counters absent — and every consumer reads
 *  them `?? 0` (`countersFor`, state.ts). Canonicalize before comparing. */
const canonTouches = (t?: TouchCounters): Record<string, number> => Object.fromEntries(TOUCH_KEYS.map((k) => [k, t?.[k] ?? 0]));
const canonWindow = (w?: TouchWindow): Record<string, number | null> => ({ ...canonTouches(w), b: w?.b ?? null });

/** Every StateRecord field populated — the drift canary. A field added to
 *  StateRecord but not to the codec will fail the v3 round-trip below. */
const FULL: StateRecord = {
  scope: 'parity',
  key: 'fact/full',
  value: { title: 'a fully-populated fact', nested: { n: 1, list: ['a', 'b'] } },
  revision: 3,
  version: 'abcd1234abcd1234',
  seq: 41,
  firstSeq: 7,
  writer: 'alice',
  via: 'test:parity',
  as: 'participant/alpha',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-17T12:00:00.000Z',
  writers: ['alice', 'bob'],
  superseded: false,
  supersededBy: null,
  type: 'note',
  tags: ['parity', 'test'],
  timerExpiresAt: '2026-08-01T00:00:00.000Z',
  timerEffect: 'enable',
  seedReads: 12,
  seedWrites: 4,
  reward: 0.75,
  touches: { hr: 2, hw: 1, ar: 5, aw: 3, pr: 8, pw: 13 },
  window: { b: 494218, hr: 1, aw: 2 },
};

const FULL_EDGE: EdgeRecord = {
  scope: 'parity',
  from: 'fact/full',
  rel: 'similarTo',
  to: 'fact/other',
  strength: 0.3,
  createdAt: '2026-07-10T00:00:00.000Z',
  writer: 'platform/vectors',
  score: 0.513,
};

describe('StateStore backend parity (memory vs v3 codec)', () => {
  beforeEach(() => __table.clear());

  it('a fully-populated StateRecord round-trips both backends identically', async () => {
    const mem = createMemoryStateStore();
    const v3 = createDynamoStateStoreV3('parity-table');
    await mem.put({ ...FULL });
    await v3.put({ ...FULL });
    const a = await mem.get('parity', 'fact/full');
    const b = await v3.get('parity', 'fact/full');
    expect(b).toEqual(FULL); // the codec allowlist preserved every field
    expect(a).toEqual(FULL); // the structural spread did too
    // …and list() agrees with get().
    expect((await v3.list('parity', 'fact/'))[0]).toEqual(FULL);
  });

  it('a fully-populated EdgeRecord (incl. the ADR-0032 cosine score) round-trips both backends', async () => {
    const mem = createMemoryStateStore();
    const v3 = createDynamoStateStoreV3('parity-table');
    await mem.putEdge({ ...FULL_EDGE });
    await v3.putEdge({ ...FULL_EDGE });
    const a = (await mem.listEdges('parity'))[0];
    const b = (await v3.listEdges('parity'))[0];
    // The v3 edge item carries pk/sk/gsi* alongside the record fields; the codec
    // must strip them back out to exactly the EdgeRecord shape.
    expect(b).toEqual(FULL_EDGE);
    expect(a).toEqual(FULL_EDGE);
  });

  it('CAS guards agree: expectRevision mismatch throws on both backends', async () => {
    const mem = createMemoryStateStore();
    const v3 = createDynamoStateStoreV3('parity-table');
    for (const store of [mem, v3]) {
      await store.put({ ...FULL });
      await expect(store.put({ ...FULL }, { expectRevision: 99 })).rejects.toThrow(/condition/i);
      await expect(store.put({ ...FULL, key: 'fact/full' }, { expectRevision: null })).rejects.toThrow(/condition/i);
      await expect(store.put({ ...FULL }, { expectRevision: FULL.revision })).resolves.toBeUndefined();
    }
  });

  it('recordTouch agrees across backends through a bucket rollover', async () => {
    const seed: StateRecord = { ...FULL, key: 'fact/touched', touches: undefined, window: undefined } as StateRecord;
    const seq: Array<[ActorClass, 'read' | 'write', number]> = [
      ['human', 'read', 1],
      ['human', 'read', 1], // fast path: same bucket, second bump
      ['agent', 'write', 1],
      ['platform', 'write', 1],
      ['human', 'read', 2], // ROLLOVER: the window resets to bucket 2
    ];
    const run = async (store: StateStore): Promise<{ t: Record<string, number>; w: Record<string, number | null> }> => {
      await store.put({ ...seed });
      for (const [actor, op, bucket] of seq) await store.recordTouch('parity', 'fact/touched', actor, op, bucket);
      const rec = await store.get('parity', 'fact/touched');
      return { t: canonTouches(rec?.touches), w: canonWindow(rec?.window) };
    };
    const mem = await run(createMemoryStateStore());
    const v3 = await run(createDynamoStateStoreV3('parity-table'));
    expect(v3).toEqual(mem);
    // Pin the actual expected shape too, not just agreement:
    expect(mem.t).toEqual({ hr: 3, hw: 0, ar: 0, aw: 1, pr: 0, pw: 1 }); // lifetime survives the rollover
    expect(mem.w).toEqual({ hr: 1, hw: 0, ar: 0, aw: 0, pr: 0, pw: 0, b: 2 }); // window holds only bucket 2
  });

  it('recordTouch on an absent fact is a silent no-op on both backends', async () => {
    const mem = createMemoryStateStore();
    const v3 = createDynamoStateStoreV3('parity-table');
    for (const store of [mem, v3]) {
      await expect(store.recordTouch('parity', 'fact/ghost', 'human', 'read', 1)).resolves.toBeUndefined();
      expect(await store.get('parity', 'fact/ghost')).toBeNull();
    }
  });

  it('the observed-state pipeline runs identically over the v3 store (smoke)', async () => {
    const state = createObservedState(createDynamoStateStoreV3('parity-table'));
    const entry = await state.put({ scope: 'parity', key: 'smoke', value: { title: 'through the codec' } }, { user: 'alice', scopes: [] });
    expect(entry._meta.revision).toBe(1);
    const read = await state.get('parity', 'smoke', { user: 'alice', scopes: [] });
    expect(read?.value).toEqual({ title: 'through the codec' });
  });
});
