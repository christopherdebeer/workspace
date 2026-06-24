/**
 * Unit tests for the shared server-side substrate client (cells/kernel/static/substrate.js,
 * ADR-0017). The AWS SDK is not installed in this repo (the Lambda runtime provides it),
 * so the client takes injectable `{ get, query }` / `{ putEvents }` adapters — these tests
 * exercise the key-shaping, superseded filtering, organ-write detail, and FailedEntryCount
 * handling without any SDK. Pure-ish I/O glue → stub adapters, no AWS.
 */
import { createSubstrate, writeDetail, supersedeDetail } from '../cells/kernel/static/substrate.js';

const detailsOf = (calls: Array<Array<{ Detail: string }>>) =>
  calls.flat().map((e) => JSON.parse(e.Detail));

describe('writeDetail / supersedeDetail (pure organ-path shaping)', () => {
  it('shapes a fact write, defaulting via', () => {
    expect(writeDetail({ key: 'k', value: { a: 1 }, type: 't', tags: ['x'] }, 'machine')).toEqual({
      key: 'k', value: { a: 1 }, type: 't', tags: ['x'], via: 'machine',
    });
  });
  it('omits absent type/tags and honours an explicit via', () => {
    expect(writeDetail({ key: 'k', value: 1, via: 'custom' }, 'machine')).toEqual({ key: 'k', value: 1, via: 'custom' });
  });
  it('shapes a supersede', () => {
    expect(supersedeDetail('k', 'machine')).toEqual({ key: 'k', op: 'supersede', via: 'machine' });
  });
});

describe('createSubstrate.read', () => {
  it('reads STATE#<owner>/KEY#<key> and unwraps the value', async () => {
    const calls: unknown[] = [];
    const ddb = { get: async (input: unknown) => { calls.push(input); return { Item: { value: { n: 7 }, type: 'machine-run', revision: 3 } }; }, query: async () => ({}) };
    const sub = createSubstrate({ owner: 'c15r', table: 'T', ddb });
    const out = await sub.read('machine-run/42');
    expect(calls[0]).toEqual({ TableName: 'T', Key: { pk: 'STATE#c15r', sk: 'KEY#machine-run/42' } });
    expect(out).toMatchObject({ key: 'machine-run/42', value: { n: 7 }, meta: { type: 'machine-run', revision: 3 } });
  });

  it('returns null for a missing or superseded fact', async () => {
    const sub = createSubstrate({ owner: 'c15r', table: 'T', ddb: { get: async () => ({ Item: undefined }), query: async () => ({}) } });
    expect(await sub.read('nope')).toBeNull();
    const sup = createSubstrate({ owner: 'c15r', table: 'T', ddb: { get: async () => ({ Item: { value: 1, superseded: true } }), query: async () => ({}) } });
    expect(await sup.read('gone')).toBeNull();
  });

  it('throws when the cell has no substrate table', async () => {
    const sub = createSubstrate({ owner: 'c15r', table: undefined, ddb: { get: async () => ({}), query: async () => ({}) } });
    await expect(sub.read('k')).rejects.toThrow(/SUBSTRATE_TABLE unavailable/);
  });
});

describe('createSubstrate.query', () => {
  it('queries by prefix on the base table, decoding sk → key and dropping superseded', async () => {
    let input: Record<string, unknown> = {};
    const ddb = {
      get: async () => ({}),
      query: async (i: Record<string, unknown>) => { input = i; return { Items: [
        { sk: 'KEY#machine-run/42§A', value: { node: 'A' } },
        { sk: 'KEY#machine-run/42§B', value: { node: 'B' }, superseded: true },
      ] }; },
    };
    const sub = createSubstrate({ owner: 'c15r', table: 'T', ddb });
    const out = await sub.query({ prefix: 'machine-run/42§' });
    expect(input.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :sk)');
    expect((input.ExpressionAttributeValues as Record<string, string>)[':sk']).toBe('KEY#machine-run/42§');
    expect(out).toEqual([{ key: 'machine-run/42§A', value: { node: 'A' }, meta: { type: null, tags: [], revision: undefined, updatedAt: undefined } }]);
  });

  it('queries by type on the gsi-type index, newest first', async () => {
    let input: Record<string, unknown> = {};
    const sub = createSubstrate({ owner: 'dave', table: 'T', ddb: { get: async () => ({}), query: async (i: Record<string, unknown>) => { input = i; return { Items: [] }; } } });
    await sub.query({ type: 'machine-run', limit: 10 });
    expect(input.IndexName).toBe('gsi-type');
    expect((input.ExpressionAttributeValues as Record<string, string>)[':pk']).toBe('TYPE#dave#machine-run');
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(10);
  });
});

describe('createSubstrate.emit', () => {
  it('emits one organ write per fact, attributed via the client default', async () => {
    const batches: Array<Array<{ Detail: string; DetailType: string; Source: string }>> = [];
    const events = { putEvents: async (entries: Array<{ Detail: string; DetailType: string; Source: string }>) => { batches.push(entries); return { FailedEntryCount: 0 }; } };
    const sub = createSubstrate({ owner: 'c15r', bus: 'BUS', source: 'cell-machine', via: 'machine.step', events });
    const out = await sub.emit([{ key: 'machine-run/1', value: { node: 'B' }, type: 'machine-run', tags: ['machine'] }]);
    expect(out).toEqual({ requested: 1 });
    expect(batches[0][0].DetailType).toBe('substrate.write.requested');
    expect(batches[0][0].Source).toBe('cell-machine');
    expect(detailsOf(batches)[0]).toEqual({ key: 'machine-run/1', value: { node: 'B' }, type: 'machine-run', tags: ['machine'], via: 'machine.step' });
  });

  it('chunks into PutEvents batches of 10', async () => {
    const batches: Array<unknown[]> = [];
    const events = { putEvents: async (entries: unknown[]) => { batches.push(entries); return { FailedEntryCount: 0 }; } };
    const sub = createSubstrate({ bus: 'BUS', events });
    await sub.emit(Array.from({ length: 23 }, (_, i) => ({ key: `k${i}`, value: i })));
    expect(batches.map((b) => b.length)).toEqual([10, 10, 3]);
  });

  it('throws when any entry fails to enqueue (no silent drop — ADR-0011 gap closed)', async () => {
    const sub = createSubstrate({ bus: 'BUS', events: { putEvents: async () => ({ FailedEntryCount: 1 }) } });
    await expect(sub.emit([{ key: 'k', value: 1 }])).rejects.toThrow(/failed to enqueue/);
  });

  it('is a no-op for an empty write list', async () => {
    let called = false;
    const sub = createSubstrate({ bus: 'BUS', events: { putEvents: async () => { called = true; return { FailedEntryCount: 0 }; } } });
    expect(await sub.emit([])).toEqual({ requested: 0 });
    expect(called).toBe(false);
  });
});

describe('createSubstrate.supersede', () => {
  it('emits a supersede detail', async () => {
    const batches: Array<Array<{ Detail: string }>> = [];
    const sub = createSubstrate({ via: 'machine.step', bus: 'BUS', events: { putEvents: async (e: Array<{ Detail: string }>) => { batches.push(e); return { FailedEntryCount: 0 }; } } });
    expect(await sub.supersede('machine-run/1')).toEqual({ ok: true, key: 'machine-run/1' });
    expect(detailsOf(batches)[0]).toEqual({ key: 'machine-run/1', op: 'supersede', via: 'machine.step' });
  });
});
