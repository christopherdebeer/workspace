/**
 * The grant fold's candidate generator, and the `total` it reports.
 *
 * `query`'s fold used to take a granted owner's top-FOLD_CAP by salience over
 * their WHOLE slice and then drop what the viewer could not see. That is the same
 * topK starvation `relevanceFor`'s `cover` argument exists to fix on the semantic
 * path — and worse here, because the count that survives the filter becomes the
 * reported `total`.
 *
 * Measured 2026-07-29 on the c15r public slice: 19 public grants cover ~135 facts,
 * 115 of them `doc-block:*` at salience 0.12–0.14. The owner's top 1200 of a
 * 7,600-fact slice is all 0.2–0.8, so essentially no block made the window — an
 * unauthenticated home graph reported `20/20` (the high-salience `doc:`/`file/`
 * identity facts) while every block it was entitled to read was invisible.
 * Selecting a node pulled in more, because per-key reads never went through the fold.
 *
 * `coveredScanPrefixes` is the fix: turn each grant pattern into a prefix scan so
 * the page cap bounds the COVERED set. `grantCovers` still runs on the results, so
 * enforcement is untouched — only the candidate generator stops starving it.
 */
import { coveredScanPrefixes } from '../services/workspace/commands-read';
import { grantCovers, WHOLE_SLICE } from '../services/workspace/grants';

describe('coveredScanPrefixes', () => {
  it('reduces each grant shape to a prefix scan', () => {
    // `prefix*` → its literal prefix; an exact key → itself.
    expect(coveredScanPrefixes(['doc-block:docs/guide/*'])).toEqual(['doc-block:docs/guide/']);
    expect(coveredScanPrefixes(['file/docs/cognitive-substrate.md'])).toEqual(['file/docs/cognitive-substrate.md']);
  });

  it('whole-slice subsumes every other scan', () => {
    expect(coveredScanPrefixes([WHOLE_SLICE])).toEqual(['']);
    expect(coveredScanPrefixes(['doc:docs/guide/*', WHOLE_SLICE, 'file/x.md'])).toEqual(['']);
  });

  it('collapses patterns already inside a broader prefix', () => {
    // A pattern nested in another adds a query and no facts.
    expect(coveredScanPrefixes(['doc:docs/guide/*', 'doc:docs/guide/concepts', 'doc:docs/other'])).toEqual([
      'doc:docs/guide/',
      'doc:docs/other',
    ]);
  });

  it('keeps the narrower of grant-vs-caller prefix, and drops a disjoint pair', () => {
    // Caller narrower than the grant → caller wins (both constraints hold).
    expect(coveredScanPrefixes(['doc-block:docs/*'], 'doc-block:docs/guide/')).toEqual(['doc-block:docs/guide/']);
    // Grant narrower than the caller → grant wins.
    expect(coveredScanPrefixes(['doc-block:docs/guide/*'], 'doc-block:docs/')).toEqual(['doc-block:docs/guide/']);
    // Disjoint → nothing can match, so no scan at all.
    expect(coveredScanPrefixes(['doc-block:docs/guide/*'], 'kb/')).toEqual([]);
  });

  it('a whole-slice grant still honours a caller prefix', () => {
    expect(coveredScanPrefixes([WHOLE_SLICE], 'kb/')).toEqual(['kb/']);
  });

  it('returns no scan for no patterns', () => {
    expect(coveredScanPrefixes([])).toEqual([]);
  });

  // The property that matters: a scan prefix must never EXCLUDE a fact the grant
  // covers. (It may over-include — `grantCovers` filters, as it always did.)
  it('never excludes a covered key', () => {
    const patterns = [
      'doc-block:docs/guide/*',
      'doc:docs/cognitive-substrate',
      'file/docs/guide/*',
      '_home/embed2d.pub',
    ];
    const keys = [
      'doc-block:docs/guide/concepts/5',
      'doc-block:docs/guide/for-agents/0',
      'doc:docs/cognitive-substrate',
      'file/docs/guide/index.md',
      '_home/embed2d.pub',
      'kb/private-thing', // not covered — must not be reachable either way
    ];
    const prefixes = coveredScanPrefixes(patterns);
    for (const key of keys) {
      const covered = patterns.some((p) => grantCovers(p, key));
      const scanned = prefixes.some((pre) => key.startsWith(pre));
      if (covered) expect(scanned).toBe(true); // the fix: every covered key is reachable
      // The converse is deliberately NOT asserted: over-scan is fine and filtered.
    }
    expect(prefixes.some((pre) => 'kb/private-thing'.startsWith(pre))).toBe(false);
  });

  // THE REGRESSION THIS BOUND EXISTS FOR. The first cut returned one scan per
  // pattern. Each scan is a separate query against a partition holding the
  // owner's whole slice, so on 19 public grants a guest graph went from 2 queries
  // to 20 — and under throttling already in flight the read failed outright.
  // A guest saw an EMPTY graph: strictly worse than the wrong `total` it replaced
  // (measured live 2026-07-29 21:28).
  describe('the scan bound', () => {
    const nineteen = [
      '_home/embed2d.pub',
      'doc-block:docs/ancestor/sync/pressure-field/*',
      'doc-block:docs/ancestor/sync/the-substrate-thesis/*',
      'doc-block:docs/ancestor/sync/what-becomes-true/*',
      'doc-block:docs/cognitive-substrate/*',
      'doc-block:docs/guide/*',
      'doc-block:docs/the-coupled-workspace/*',
      'doc:docs/ancestor/sync/pressure-field',
      'doc:docs/ancestor/sync/the-substrate-thesis',
      'doc:docs/ancestor/sync/what-becomes-true',
      'doc:docs/cognitive-substrate',
      'doc:docs/guide/*',
      'doc:docs/the-coupled-workspace',
      'file/docs/ancestor/sync/pressure-field.md',
      'file/docs/ancestor/sync/the-substrate-thesis.md',
      'file/docs/ancestor/sync/what-becomes-true.md',
      'file/docs/cognitive-substrate.md',
      'file/docs/guide/*',
      'file/docs/the-coupled-workspace.md',
    ];

    it('holds the live 19-grant set within budget', () => {
      const scans = coveredScanPrefixes(nineteen);
      expect(scans.length).toBeLessThanOrEqual(4);
      expect(scans.length).toBeGreaterThan(0);
    });

    it('merging only ever WIDENS, so no covered key becomes unreachable', () => {
      // The safety property. Merging replaces two prefixes with their common
      // prefix — a superset — and `grantCovers` still filters, so over-scan is
      // free but under-scan would silently hide facts the viewer may read.
      const scans = coveredScanPrefixes(nineteen);
      const keys = [
        'doc-block:docs/guide/concepts/5',
        'doc-block:docs/the-coupled-workspace/8',
        'doc:docs/cognitive-substrate',
        'file/docs/guide/index.md',
        'file/docs/the-coupled-workspace.md',
        '_home/embed2d.pub',
      ];
      for (const key of keys) {
        expect(nineteen.some((p) => grantCovers(p, key))).toBe(true); // precondition
        expect(scans.some((pre) => key.startsWith(pre))).toBe(true); // still reachable
      }
    });

    it('respects an explicit budget, down to a single scan', () => {
      expect(coveredScanPrefixes(nineteen, undefined, 2).length).toBeLessThanOrEqual(2);
      expect(coveredScanPrefixes(nineteen, undefined, 1)).toHaveLength(1);
      // A budget of 0 or less still yields one scan — never zero, which would
      // return nothing at all for a viewer who is entitled to something.
      expect(coveredScanPrefixes(nineteen, undefined, 0)).toHaveLength(1);
    });

    it('does not merge when already within budget', () => {
      // Three unrelated families stay three scans — no needless widening.
      const scans = coveredScanPrefixes(['kb/*', 'goal/*', 'note/*'], undefined, 4);
      expect(scans.sort()).toEqual(['goal/', 'kb/', 'note/']);
    });

    it('a merge that reaches the empty prefix collapses to whole-slice', () => {
      // Disjoint namespaces squeezed into one scan have no common prefix, so the
      // only honest answer is the whole slice — still filtered by grantCovers.
      expect(coveredScanPrefixes(['kb/*', 'zz/*'], undefined, 1)).toEqual(['']);
    });
  });

  it('the starvation case: low-salience covered facts get their own scan', () => {
    // The live shape — six doc-block families plus identity facts. Each family
    // becomes its own bounded scan, so a block at salience 0.13 is ranked against
    // its siblings rather than against the owner's whole slice.
    const live = [
      'doc-block:docs/guide/*',
      'doc-block:docs/the-coupled-workspace/*',
      'doc-block:docs/cognitive-substrate/*',
      'doc:docs/guide/*',
      'file/docs/guide/*',
      '_home/embed2d.pub',
    ];
    const prefixes = coveredScanPrefixes(live);
    // Within the scan budget, and every scan strictly narrower than the slice —
    // the whole-slice scan is what starved these facts in the first place.
    expect(prefixes.length).toBeLessThanOrEqual(4);
    expect(prefixes).not.toContain('');
    // A block at salience 0.13 is now ranked inside a doc-block scan rather than
    // against the owner's 8,000 higher-scoring facts.
    expect(prefixes.some((p) => 'doc-block:docs/guide/concepts/5'.startsWith(p))).toBe(true);
    expect(prefixes.every((p) => p.length > 0)).toBe(true);
  });
});
