/**
 * Fact (ADR-0013) — the monotonic floor, pinned as one executable spec.
 *
 * The base noun: a keyed `{ value, _meta }` with server-stamped provenance,
 * supersede-not-delete, CAS, read-time timers, and a TTL-bounded trajectory as its
 * temporal shadow. These invariants live scattered across state/workspace tests; this
 * file states the *contract* in one place, and asserts the one invariant the ADR adds —
 * the trajectory is a single log with two readers (Salience and `changes`).
 */
import { createObservedState, createMemoryStateStore } from '../platform/runtime/state';
import type { Identity } from '../platform/runtime';

const alice: Identity = { user: 'alice', scopes: [] };
const bob: Identity = { user: 'bob', scopes: [] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Fact: the monotonic floor (ADR-0013)', () => {
  it('wraps a value as { value, _meta } with server-stamped provenance', async () => {
    const s = createObservedState(createMemoryStateStore());
    const e = await s.put({ scope: 'r', key: 'k', value: { a: 1 }, type: 'note', tags: ['t'] }, alice);
    expect(e.value).toEqual({ a: 1 });
    expect(e._meta.revision).toBe(1);
    expect(e._meta.writer).toBe('alice');
    expect(e._meta.type).toBe('note');
    expect(e._meta.tags).toEqual(['t']);
    expect(e._meta.createdAt).toBe(e._meta.updatedAt);
    expect(e._meta.superseded).toBe(false);
  });

  it('is monotonic: a rewrite bumps revision and accumulates writers; birth is immutable', async () => {
    const s = createObservedState(createMemoryStateStore());
    const a = await s.put({ scope: 'r', key: 'k', value: 1 }, alice);
    const b = await s.put({ scope: 'r', key: 'k', value: 2 }, bob);
    expect(b._meta.revision).toBe(2);
    expect(b._meta.createdAt).toBe(a._meta.createdAt);
    expect([...b._meta.writers].sort()).toEqual(['alice', 'bob']);
  });

  it('supersede retires but never deletes — history stays retrievable, and a write revives', async () => {
    const s = createObservedState(createMemoryStateStore());
    await s.put({ scope: 'r', key: 'k', value: 'v1', type: 'note' }, alice);
    const sup = await s.supersede('r', 'k', 'k2', alice);
    expect(sup?._meta.superseded).toBe(true);
    expect(sup?._meta.supersededBy).toBe('k2');
    // not deleted: a read that includes the retired still finds it
    const withRetired = await s.read('r', { includeSuperseded: true, elision: 'none' });
    expect(withRetired.entries['k']).toBeDefined();
    // the revision chain continues — a fresh write revives the key
    const revived = await s.put({ scope: 'r', key: 'k', value: 'v2' }, alice);
    expect(revived._meta.superseded).toBe(false);
    expect(revived._meta.revision).toBeGreaterThan(1);
  });

  it('CAS: ifAbsent and ifRevision gate concurrent writers (precondition_failed)', async () => {
    const s = createObservedState(createMemoryStateStore());
    await s.put({ scope: 'r', key: 'k', value: 'first' }, alice);
    await expect(s.put({ scope: 'r', key: 'k', value: 'x', ifAbsent: true }, alice)).rejects.toThrow(/precondition_failed/);
    await expect(s.put({ scope: 'r', key: 'k', value: 'x', ifRevision: 5 }, alice)).rejects.toThrow(/precondition_failed/);
    const ok = await s.put({ scope: 'r', key: 'k', value: 'won', ifRevision: 1 }, alice);
    expect(ok._meta.revision).toBe(2);
    await expect(s.put({ scope: 'r', key: 'k', value: 'x', ifRevision: 0 }, alice)).rejects.toThrow(/precondition_failed/);
  });

  it('timer lease (delete): live now, absent after expiry — the crash-safe re-claim', async () => {
    const s = createObservedState(createMemoryStateStore());
    await s.put({ scope: 'r', key: 'lease', value: 'held', timer: { ms: 30, effect: 'delete' } }, alice);
    expect(await s.get('r', 'lease')).not.toBeNull();
    await sleep(50);
    expect(await s.get('r', 'lease')).toBeNull(); // lapsed → reads absent
    const reclaim = await s.put({ scope: 'r', key: 'lease', value: 'held2', ifAbsent: true }, bob);
    expect(reclaim._meta.writer).toBe('bob'); // CAS sees the lapsed lease as absent
  });

  it('timer reveal (enable): dormant now, live after expiry', async () => {
    const s = createObservedState(createMemoryStateStore());
    await s.put({ scope: 'r', key: 'rev', value: 'later', timer: { ms: 30, effect: 'enable' } }, alice);
    expect(await s.get('r', 'rev')).toBeNull(); // dormant until expiry
    await sleep(50);
    expect(await s.get('r', 'rev')).not.toBeNull(); // revealed
  });

  it('one trajectory, two readers: the same log feeds `changes` and Salience', async () => {
    const s = createObservedState(createMemoryStateStore());
    const head = (await s.changes('r', 'head')).seq;
    await s.put({ scope: 'r', key: 'k', value: 'v', type: 'note' }, alice);
    // reader A — `changes` tails the write event from the trajectory
    const tail = await s.changes('r', head);
    expect(tail.events.some((ev) => ev.op === 'write' && ev.key === 'k')).toBe(true);
    // reader B — Salience scores the fact from the SAME trajectory (recency > 0)
    const view = await s.read('r', { elision: 'none' });
    expect(view.entries['k']._meta.score).toBeGreaterThan(0);
    // a read is itself a trajectory event — the shared log captures what both readers consume
    const afterRead = await s.changes('r', head);
    expect(afterRead.events.some((ev) => ev.op === 'read')).toBe(true);
  });
});
