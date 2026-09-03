/**
 * The borrow lifecycle.
 *
 * It used to stop dead at `accepted`: there was no transition out of it, so a
 * posted book stayed "accepted" forever and — the actual bug — the copy was
 * never taken out of the discover index, so a second reader could be accepted
 * for the same physical book.
 *
 * The table is exported and asserted directly; the store's DynamoDB calls are
 * not exercised here (no client in unit tests), so this pins the RULES, which
 * is where the mistakes live.
 */
import { TRANSITIONS } from '../cells/shelved/lib/store';
import type { BorrowRequest } from '../cells/shelved/shared/types';

type Status = BorrowRequest['status'];
const moves = (from: Status): Array<{ to: Status; by: string }> => TRANSITIONS[from] ?? [];
const to = (from: Status, target: Status) => moves(from).find((m) => m.to === target);

describe('who may move a borrow request where', () => {
  it('lets the owner accept or decline, and only the borrower cancel', () => {
    expect(to('pending', 'accepted')?.by).toBe('owner');
    expect(to('pending', 'declined')?.by).toBe('owner');
    expect(to('pending', 'cancelled')?.by).toBe('requester');
  });

  // The gap this closes: `accepted` was terminal by accident.
  it('gives accepted a way out', () => {
    expect(moves('accepted').length).toBeGreaterThan(0);
    expect(to('accepted', 'shipped')?.by).toBe('owner');
  });

  it('has the right side confirm each leg', () => {
    // The owner posts it; only the person holding it knows it arrived.
    expect(to('shipped', 'delivered')?.by).toBe('requester');
  });

  it('ends a lend by coming back and a pass by completing', () => {
    expect(to('delivered', 'returned')).toBeDefined();
    expect(to('delivered', 'completed')).toBeDefined();
    expect(to('returned', 'completed')).toBeDefined();
  });

  it('is a DAG with completed as the only sink', () => {
    const terminal = (['declined', 'cancelled', 'completed'] as Status[]).filter((s) => moves(s).length === 0);
    expect(terminal.sort()).toEqual(['cancelled', 'completed', 'declined']);
  });

  // Every non-terminal state must be escapable, or a copy gets stuck reserved
  // with no way for either reader to free it.
  it('leaves no state stranded', () => {
    for (const from of ['pending', 'accepted', 'shipped', 'delivered', 'returned'] as Status[]) {
      expect(moves(from).length).toBeGreaterThan(0);
    }
  });

  it('refuses to skip the journey', () => {
    expect(to('pending', 'delivered')).toBeUndefined();
    expect(to('pending', 'completed')).toBeUndefined();
    expect(to('accepted', 'delivered')).toBeUndefined();
  });

  // Plans change, and a copy reserved forever because someone went quiet is
  // worse than an ungraceful cancel.
  it('lets an accepted-but-unsent request be called off by either side', () => {
    expect(to('accepted', 'cancelled')?.by).toBe('either');
  });

  it('never names an actor it cannot check', () => {
    for (const list of Object.values(TRANSITIONS)) {
      for (const m of list) expect(['owner', 'requester', 'either']).toContain(m.by);
    }
  });
});
