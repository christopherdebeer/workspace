/**
 * @c15r/kernel/command-core — the headless command-surface engine both
 * palette UIs (home field computer, canvas cmd-palette) share. Pure logic:
 * matching/ranking, MRU recents (stale-drop, injected storage), wrap-around
 * selection. The gate pins the SHARED semantics the two hosts converged on.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS kernel SDK module (JSDoc-typed), mapped by jest to cells/kernel/static.
import { fuzzyMatch, matchScore, rankItems, createRecents, stepSelection } from 'vendor/command-core.js';

describe('command-core — matching', () => {
  it('fuzzyMatch is subsequence order-sensitive', () => {
    expect(fuzzyMatch('workspace.remember', 'wsrem')).toBe(true);
    expect(fuzzyMatch('workspace.remember', 'remws')).toBe(false);
    expect(fuzzyMatch('anything', '')).toBe(true);
  });

  it('matchScore tiers: word-start substring > mid substring > subsequence > none', () => {
    const wordStart = matchScore('workspace.query', 'query')!;
    const mid = matchScore('inquery-thing', 'query')!;
    const subseq = matchScore('quite every day', 'query')!;
    expect(wordStart).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(subseq);
    expect(matchScore('nothing here', 'query')).toBeNull();
    expect(matchScore('anything', '')).toBeNull(); // empty query = no match (hosts show idle state)
  });

  it('a shorter label leading with the query outranks a longer one', () => {
    expect(matchScore('link', 'link')!).toBeGreaterThan(matchScore('links-and-more-links', 'link')!);
  });
});

describe('command-core — rankItems', () => {
  const pool = [
    { id: 'a', searchText: 'workspace.remember save a fact' },
    { id: 'b', searchText: 'workspace.recall overview' },
    { id: 'c', searchText: 'canvas.addNote' },
    { id: 'd', searchText: 'workspace.remember alias' },
  ];

  it('drops non-matches, sorts best-first, is stable on ties, respects limit', () => {
    // Same hit position for both, so the shorter haystack ranks first (d).
    expect(rankItems(pool, 'remember').map((i: { id: string }) => i.id)).toEqual(['d', 'a']);
    expect(rankItems(pool, 'workspace', { limit: 2 }).length).toBe(2);
    expect(rankItems(pool, 'zzz')).toEqual([]);
  });

  it('honours a custom textOf', () => {
    const items = [{ name: 'alpha' }, { name: 'beta' }];
    expect(rankItems(items, 'bet', { textOf: (i: { name: string }) => i.name })).toEqual([{ name: 'beta' }]);
  });
});

describe('command-core — recents', () => {
  const memStorage = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  };

  it('MRU order, dedupe, bound, persistence round-trip', () => {
    const storage = memStorage();
    const r = createRecents({ key: 'k', limit: 3, storage });
    r.add('one'); r.add('two'); r.add('one'); r.add('three'); r.add('four');
    expect(r.ids()).toEqual(['four', 'three', 'one']);
    // A fresh instance reads the persisted list back.
    expect(createRecents({ key: 'k', limit: 3, storage }).ids()).toEqual(['four', 'three', 'one']);
  });

  it('resolve() drops ids missing from the live pool (stale/guarded items)', () => {
    const storage = memStorage();
    const r = createRecents({ key: 'k', storage });
    r.add('gone'); r.add('here');
    const pool = [{ id: 'here' }, { id: 'unrelated' }];
    expect(r.resolve(pool, (i: { id: string }) => i.id)).toEqual([{ id: 'here' }]);
  });

  it('storage failures are swallowed (recents are a convenience)', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    const r = createRecents({ key: 'k', storage: throwing });
    expect(r.ids()).toEqual([]);
    r.add('x'); // must not throw
    expect(r.ids()).toEqual(['x']); // in-memory MRU still works this session
  });
});

describe('command-core — stepSelection', () => {
  it('wraps both directions, enters from -1 at either end, -1 on empty', () => {
    expect(stepSelection(0, 1, 3)).toBe(1);
    expect(stepSelection(2, 1, 3)).toBe(0);
    expect(stepSelection(0, -1, 3)).toBe(2);
    expect(stepSelection(-1, 1, 3)).toBe(0);
    expect(stepSelection(-1, -1, 3)).toBe(2);
    expect(stepSelection(0, 1, 0)).toBe(-1);
  });
});
