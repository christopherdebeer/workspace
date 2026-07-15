/**
 * lit's markdown decomposition (ADR-0081) — pure planning only (no substrate
 * I/O): slug/title/summary derivation, block splitting + key minting, wiki
 * and relative-markdown-link extraction, and the stale-key/edge diffing the
 * orchestration layer (cells/lit/index.ts's `/_tools/decomposeMarkdown`)
 * uses to reconcile a re-decompose.
 */
import { slugFromPath, extractRelativeMdLinks, planDecomposition, factsFor, staleKeys, diffEdges } from '../cells/lit/decompose';
import { extractWikiTargets } from '../platform/ui/wiki-link';

describe('slugFromPath', () => {
  it('keeps the full path (including its root) and strips only the markdown extension', () => {
    // A live migration collided doc:machine (docs/machine.md) with a
    // pre-existing hand-authored doc:machine — the path root must survive
    // into the slug so a synced doc can never collide with the bare
    // doc:<slug> namespace interactive authoring uses.
    expect(slugFromPath('docs/architecture/adr/0081-typed-file-ingestion.md')).toBe('docs/architecture/adr/0081-typed-file-ingestion');
  });
  it('leaves a non-docs path alone but for the extension', () => {
    expect(slugFromPath('notes/2026-07-11.markdown')).toBe('notes/2026-07-11');
  });
});

describe('extractRelativeMdLinks', () => {
  const path = 'docs/architecture/adr/0081-typed-file-ingestion.md';

  it('resolves ./ and ../ links against the source path, dedupes', () => {
    const content = '[breathe](./breathe.md) and [again](./breathe.md) and [up](../compose.md)';
    expect(extractRelativeMdLinks(content, path)).toEqual([
      'doc:docs/architecture/adr/breathe',
      'doc:docs/architecture/compose',
    ]);
  });

  it('ignores external, anchor-only, absolute, and non-markdown links', () => {
    const content = '[ext](https://example.com/x.md) [anchor](#frag) [abs](/root.md) [img](./pic.png)';
    expect(extractRelativeMdLinks(content, path)).toEqual([]);
  });

  it('strips a trailing #fragment and an optional link title before resolving', () => {
    const content = '[sec](./breathe.md#section "a title")';
    expect(extractRelativeMdLinks(content, path)).toEqual(['doc:docs/architecture/adr/breathe']);
  });
});

describe('planDecomposition', () => {
  const path = 'docs/architecture/adr/0081-typed-file-ingestion.md';

  it('derives slug/title/summary and splits into keyed, ordered blocks', () => {
    const content = '# Typed file ingestion\n\nThe put seam infers types. See [[kb/thing]] and [more](./breathe.md).\n\n## Sketch\n\nSecond block.';
    const plan = planDecomposition(path, content, extractWikiTargets);
    expect(plan.slug).toBe('docs/architecture/adr/0081-typed-file-ingestion');
    expect(plan.docKey).toBe('doc:docs/architecture/adr/0081-typed-file-ingestion');
    expect(plan.title).toBe('Typed file ingestion');
    expect(plan.summary).toBe('The put seam infers types.');
    expect(plan.blocks.map((b) => b.key)).toEqual([
      'doc-block:docs/architecture/adr/0081-typed-file-ingestion/0',
      'doc-block:docs/architecture/adr/0081-typed-file-ingestion/1',
    ]);
    expect(plan.blocks.map((b) => b.seq)).toEqual([0, 1]);
  });

  it('emits related edges for wiki-links and references edges for relative md links, from the owning block', () => {
    const content = '# T\n\nSee [[kb/thing]] and [more](./breathe.md).';
    const plan = planDecomposition(path, content, extractWikiTargets);
    const block0 = plan.blocks[0].key;
    expect(plan.edges).toContainEqual({ from: block0, rel: 'related', to: 'kb/thing' });
    expect(plan.edges).toContainEqual({ from: block0, rel: 'references', to: 'doc:docs/architecture/adr/breathe' });
  });

  it('falls back to a filename-derived title and empty summary when there is no heading/prose', () => {
    const plan = planDecomposition('docs/architecture/adr/0081-typed-file-ingestion.md', '```js\nconsole.log(1)\n```', extractWikiTargets);
    expect(plan.title).toBe('typed file ingestion');
    expect(plan.summary).toBe('');
  });

  it('is deterministic — re-planning identical content yields an identical plan', () => {
    const content = '# T\n\nbody';
    expect(planDecomposition(path, content, extractWikiTargets)).toEqual(planDecomposition(path, content, extractWikiTargets));
  });

  it('folds a parent heading with no intro prose into its first subsection (no content-less block)', () => {
    // The ADR shape: `## Decisions` immediately followed by `### 1. …`. The
    // old splitter emitted a byte-identical bare `## Decisions` block per doc
    // (kb/contested-noise-floor-boilerplate-doc-blocks); it must now fold.
    const content = '# T\n\nintro prose.\n\n## Decisions\n\n### 1. First\n\nbody one.\n\n### 2. Second\n\nbody two.';
    const plan = planDecomposition(path, content, extractWikiTargets);
    const contents = plan.blocks.map((b) => b.content);
    // No block is a bare heading.
    expect(contents).not.toContain('## Decisions');
    // `## Decisions` rode into the first subsection; the second stands alone.
    expect(contents.some((c) => c.includes('## Decisions') && c.includes('### 1. First') && c.includes('body one.'))).toBe(true);
    expect(contents.some((c) => c.startsWith('### 2. Second') && c.includes('body two.'))).toBe(true);
    // Blocks: [intro, "## Decisions\n### 1 …", "### 2 …"] — the orphan is gone.
    expect(plan.blocks).toHaveLength(3);
  });

  it('still emits a heading-only block when it is genuinely trailing (nothing follows)', () => {
    const plan = planDecomposition(path, '# T\n\nbody.\n\n## Trailing', extractWikiTargets);
    expect(plan.blocks.map((b) => b.content)).toContain('## Trailing');
  });
});

describe('staleKeys', () => {
  it('returns existing keys absent from the new set', () => {
    expect(staleKeys(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });
  it('is empty when nothing was removed', () => {
    expect(staleKeys(['a'], ['a', 'b'])).toEqual([]);
  });
});

describe('diffEdges', () => {
  it('adds newly wanted edges and removes ones no longer authored', () => {
    const existing = [{ to: 'doc:a', rel: 'related' }, { to: 'doc:b', rel: 'related' }];
    const wanted = [{ to: 'doc:b', rel: 'related' }, { to: 'doc:c', rel: 'related' }];
    const { toAdd, toRemove } = diffEdges(existing, wanted);
    expect(toAdd).toEqual([{ to: 'doc:c', rel: 'related' }]);
    expect(toRemove).toEqual([{ to: 'doc:a', rel: 'related' }]);
  });
  it('distinguishes by rel, not just target', () => {
    const existing = [{ to: 'doc:a', rel: 'related' }];
    const wanted = [{ to: 'doc:a', rel: 'references' }];
    const { toAdd, toRemove } = diffEdges(existing, wanted);
    expect(toAdd).toEqual([{ to: 'doc:a', rel: 'references' }]);
    expect(toRemove).toEqual([{ to: 'doc:a', rel: 'related' }]);
  });
});

describe('factsFor: the interleaved fact list (ADR-0083 chunk substrate)', () => {
  const noWiki = (): string[] => [];
  const plan = planDecomposition('docs/x/y.md', '# T\n\nintro\n\nsecond\n\nthird', noWiki);

  it('interleaves: doc first, then each block immediately followed by its order decoration', () => {
    const facts = factsFor(plan);
    expect(facts[0].key).toBe(plan.docKey);
    for (let i = 0; i < plan.blocks.length; i++) {
      const b = plan.blocks[i];
      expect(facts[1 + i * 2].key).toBe(b.key);
      expect(facts[2 + i * 2].key).toBe(`_doc/${plan.slug}/${b.key}`);
    }
    expect(facts).toHaveLength(1 + plan.blocks.length * 2);
  });

  it('is deterministic across re-plans — chunk N of a later step slices the same list', () => {
    const again = factsFor(planDecomposition('docs/x/y.md', '# T\n\nintro\n\nsecond\n\nthird', noWiki));
    expect(again).toEqual(factsFor(plan));
    // A mid-list slice (an async chunk step) therefore lands identical facts.
    expect(again.slice(2, 4)).toEqual(factsFor(plan).slice(2, 4));
  });
});
