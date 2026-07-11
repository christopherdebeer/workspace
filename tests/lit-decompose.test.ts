/**
 * lit's markdown decomposition (ADR-0081) — pure planning only (no substrate
 * I/O): slug/title/summary derivation, block splitting + key minting, wiki
 * and relative-markdown-link extraction, and the stale-key/edge diffing the
 * orchestration layer (cells/lit/index.ts's `/_tools/decomposeMarkdown`)
 * uses to reconcile a re-decompose.
 */
import { slugFromPath, extractRelativeMdLinks, planDecomposition, staleKeys, diffEdges } from '../cells/lit/decompose';
import { extractWikiTargets } from '../platform/ui/wiki-link';

describe('slugFromPath', () => {
  it('strips a leading docs/ root and the markdown extension', () => {
    expect(slugFromPath('docs/architecture/adr/0081-typed-file-ingestion.md')).toBe('architecture/adr/0081-typed-file-ingestion');
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
      'doc:architecture/adr/breathe',
      'doc:architecture/compose',
    ]);
  });

  it('ignores external, anchor-only, absolute, and non-markdown links', () => {
    const content = '[ext](https://example.com/x.md) [anchor](#frag) [abs](/root.md) [img](./pic.png)';
    expect(extractRelativeMdLinks(content, path)).toEqual([]);
  });

  it('strips a trailing #fragment and an optional link title before resolving', () => {
    const content = '[sec](./breathe.md#section "a title")';
    expect(extractRelativeMdLinks(content, path)).toEqual(['doc:architecture/adr/breathe']);
  });
});

describe('planDecomposition', () => {
  const path = 'docs/architecture/adr/0081-typed-file-ingestion.md';

  it('derives slug/title/summary and splits into keyed, ordered blocks', () => {
    const content = '# Typed file ingestion\n\nThe put seam infers types. See [[kb/thing]] and [more](./breathe.md).\n\n## Sketch\n\nSecond block.';
    const plan = planDecomposition(path, content, extractWikiTargets);
    expect(plan.slug).toBe('architecture/adr/0081-typed-file-ingestion');
    expect(plan.docKey).toBe('doc:architecture/adr/0081-typed-file-ingestion');
    expect(plan.title).toBe('Typed file ingestion');
    expect(plan.summary).toBe('The put seam infers types.');
    expect(plan.blocks.map((b) => b.key)).toEqual([
      'doc-block:architecture/adr/0081-typed-file-ingestion/0',
      'doc-block:architecture/adr/0081-typed-file-ingestion/1',
    ]);
    expect(plan.blocks.map((b) => b.seq)).toEqual([0, 1]);
  });

  it('emits related edges for wiki-links and references edges for relative md links, from the owning block', () => {
    const content = '# T\n\nSee [[kb/thing]] and [more](./breathe.md).';
    const plan = planDecomposition(path, content, extractWikiTargets);
    const block0 = plan.blocks[0].key;
    expect(plan.edges).toContainEqual({ from: block0, rel: 'related', to: 'kb/thing' });
    expect(plan.edges).toContainEqual({ from: block0, rel: 'references', to: 'doc:architecture/adr/breathe' });
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
