/**
 * scopeEdges cursor paging (2026-07-11, ADR-0081 home-cell incident): a
 * caller with a large edge projection must page rather than raise `limit` —
 * CloudFront's ~30s default origin timeout and the Lambda platform's 6MB
 * response cap both apply regardless of any Lambda-side timeout/memory
 * bump. Pure function — no store needed.
 */
import { scopeEdges } from '../services/workspace/shape';

const edge = (i: number) => ({ from: `a${i}`, rel: 'related', to: `b${i}` });

describe('scopeEdges: cursor paging', () => {
  it('pages through with limit, returning nextCursor until exhausted', () => {
    const all = Array.from({ length: 25 }, (_, i) => edge(i));
    const page1 = scopeEdges(all, { limit: 10 });
    expect(page1.edges).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.nextCursor).toBe('10');

    const page2 = scopeEdges(all, { limit: 10, cursor: page1.nextCursor });
    expect(page2.edges).toEqual(all.slice(10, 20));
    expect(page2.nextCursor).toBe('20');

    const page3 = scopeEdges(all, { limit: 10, cursor: page2.nextCursor });
    expect(page3.edges).toEqual(all.slice(20, 25));
    expect(page3.nextCursor).toBeUndefined(); // exhausted — last page has no more
  });

  it('omits nextCursor when everything fits in one page', () => {
    const all = Array.from({ length: 5 }, (_, i) => edge(i));
    const page = scopeEdges(all, { limit: 10 });
    expect(page.edges).toHaveLength(5);
    expect(page.nextCursor).toBeUndefined();
  });

  it('cursor applies after keys/rels filtering, not before', () => {
    const all = [edge(0), edge(1), { from: 'x', rel: 'other', to: 'y' }, edge(2), edge(3)];
    const filtered = scopeEdges(all, { rels: ['related'], limit: 2 });
    expect(filtered.total).toBe(4); // the 'other'-rel edge excluded from total too
    expect(filtered.edges).toEqual([edge(0), edge(1)]);
    const next = scopeEdges(all, { rels: ['related'], limit: 2, cursor: filtered.nextCursor });
    expect(next.edges).toEqual([edge(2), edge(3)]);
    expect(next.nextCursor).toBeUndefined();
  });

  it('no limit at all still honours a cursor (slice-from-offset, no further paging)', () => {
    const all = Array.from({ length: 5 }, (_, i) => edge(i));
    const rest = scopeEdges(all, { cursor: '3' });
    expect(rest.edges).toEqual(all.slice(3));
    expect(rest.nextCursor).toBeUndefined();
  });

  it('a malformed cursor falls back to offset 0 rather than throwing', () => {
    const all = Array.from({ length: 3 }, (_, i) => edge(i));
    const page = scopeEdges(all, { limit: 10, cursor: 'not-a-number' });
    expect(page.edges).toEqual(all);
  });

  it('{limit: 0} still counts everything (the "just count" idiom), no edges returned', () => {
    const all = Array.from({ length: 3 }, (_, i) => edge(i));
    const page = scopeEdges(all, { limit: 0 });
    expect(page.edges).toEqual([]);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBe('0');
  });
});

describe('scopeEdges: edgeShape thin trimming (2026-07-11, home-graph leanness)', () => {
  const richEdge = (i: number, derived?: boolean) => ({
    scope: 'c15r',
    from: `a${i}`,
    rel: 'related',
    to: `b${i}`,
    strength: 0.5,
    createdAt: '2026-01-01T00:00:00.000Z',
    writer: 'c15r',
    score: 0.9,
    ...(derived !== undefined ? { derived } : {}),
  });

  it('trims to {from,rel,to,derived?} when edgeShape is "thin"', () => {
    const all = [richEdge(0), richEdge(1, true)];
    const page = scopeEdges(all, { edgeShape: 'thin' });
    expect(page.edges).toEqual([
      { from: 'a0', rel: 'related', to: 'b0' },
      { from: 'a1', rel: 'related', to: 'b1', derived: true },
    ]);
  });

  it('defaults to full shape, unchanged, when edgeShape is absent', () => {
    const all = [richEdge(0)];
    const page = scopeEdges(all, {});
    expect(page.edges).toEqual(all);
  });

  it('thins AFTER paging, not before — total/cursor unaffected', () => {
    const all = Array.from({ length: 5 }, (_, i) => richEdge(i));
    const page = scopeEdges(all, { edgeShape: 'thin', limit: 2 });
    expect(page.total).toBe(5);
    expect(page.nextCursor).toBe('2');
    expect(page.edges).toEqual([
      { from: 'a0', rel: 'related', to: 'b0' },
      { from: 'a1', rel: 'related', to: 'b1' },
    ]);
  });
});
