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
    expect(prefixes).toHaveLength(6);
    expect(prefixes).toContain('doc-block:docs/guide/');
    // Crucially none of them is the whole slice — that was the starving scan.
    expect(prefixes).not.toContain('');
  });
});
