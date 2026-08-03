/**
 * Fence source ranges — the mechanism fence-grain editing rests on.
 *
 * Editing one fence in place commits by SPLICING the new body back into the
 * owning fact's markdown: `md.slice(0, from) + next + md.slice(to)`. A wrong
 * offset therefore doesn't render badly, it CORRUPTS the document — so the
 * two properties below are pinned rather than assumed:
 *
 *  1. marked's top-level `raw` values concatenate back to the source exactly.
 *     That invariant is what makes a running sum a true offset, and it is the
 *     only reason `renderBlocks(..., origin)` can hand out ranges at all.
 *  2. `fenceRangeOf` locates a fence's BODY within its own token, for every
 *     fence shape in the corpus — declared info-strings, `~~~`, indented,
 *     empty, and bodies that themselves contain backticks.
 *
 * Nested fences (inside a list or blockquote) deliberately get NO range: the
 * concatenation invariant doesn't survive container tokens, and a guess there
 * would splice into the wrong place.
 */
import { marked } from 'marked';
import { fenceRangeOf, fenceInfoOf, type MdToken } from '../platform/ui/markdown';
import { closeSafely } from '../cells/home/client/safe-markdown';

const lex = (md: string): MdToken[] => marked.lexer(md) as MdToken[];

/** The accumulator `renderBlocks` runs: each top-level token starts where the
 *  previous one ended. */
function fenceRanges(src: string): Array<{ info: string; text: string; range: ReturnType<typeof fenceRangeOf> }> {
  const out: Array<{ info: string; text: string; range: ReturnType<typeof fenceRangeOf> }> = [];
  let at = 0;
  for (const t of lex(src)) {
    if (t.type === 'code') out.push({ info: fenceInfoOf(t), text: String(t.text ?? ''), range: fenceRangeOf(t, at) });
    at += String(t.raw ?? '').length;
  }
  return out;
}

describe('the offset invariant', () => {
  const samples = [
    '# Title\n\nprose\n\n```js\nconst a = 1;\n```\n\nmore prose\n',
    'lead in\n\n```mermaid\ngraph TD;\nA-->B;\n```\n\n```csv\na,b\n1,2\n```\n',
    '```js !plugin type=viewer of=foo #tag\nx\n```\n\n- a list\n- of items\n\n> a quote\n',
    '~~~python\nprint(1)\n~~~\n',
    'para\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```txt\nend\n```\n',
  ];

  it('top-level raw values reconstruct the source exactly', () => {
    for (const src of samples) {
      expect(lex(src).map((t) => String(t.raw ?? '')).join('')).toBe(src);
    }
  });

  it('every fence body range slices back to that fence’s own text', () => {
    for (const src of samples) {
      const fences = fenceRanges(src);
      expect(fences.length).toBeGreaterThan(0);
      for (const f of fences) {
        expect(f.range).not.toBeNull();
        expect(src.slice(f.range!.body.from, f.range!.body.to)).toBe(f.text);
      }
    }
  });

  it('the block range covers the fence lines too', () => {
    const src = '```js\nconst a = 1;\n```\n';
    const [f] = fenceRanges(src);
    const block = src.slice(f.range!.block.from, f.range!.block.to);
    expect(block.startsWith('```js')).toBe(true);
    expect(block.trimEnd().endsWith('```')).toBe(true);
  });
});

describe('splicing an edited body back', () => {
  const splice = (src: string, r: { from: number; to: number }, next: string): string =>
    src.slice(0, r.from) + next + src.slice(r.to);

  it('replaces only the edited fence', () => {
    const src = 'intro\n\n```js\nold();\n```\n\noutro\n\n```csv\na,b\n```\n';
    const [first] = fenceRanges(src);
    const out = splice(src, first.range!.body, 'fresh();');
    expect(out).toBe('intro\n\n```js\nfresh();\n```\n\noutro\n\n```csv\na,b\n```\n');
  });

  it('edits the SECOND fence without disturbing the first', () => {
    const src = 'a\n\n```js\none\n```\n\nb\n\n```js\ntwo\n```\n';
    const second = fenceRanges(src)[1];
    expect(splice(src, second.range!.body, 'TWO')).toBe('a\n\n```js\none\n```\n\nb\n\n```js\nTWO\n```\n');
  });

  it('survives a body containing backticks', () => {
    const src = 'x\n\n````md\nuse ```js fences``` inline\n````\n';
    const [f] = fenceRanges(src);
    expect(src.slice(f.range!.body.from, f.range!.body.to)).toBe('use ```js fences``` inline');
    expect(splice(src, f.range!.body, 'plain')).toBe('x\n\n````md\nplain\n````\n');
  });

  it('handles an empty fence body without breaking the closing delimiter', () => {
    // The zero-width range sits ON the closing fence, so a naive splice would
    // produce '```js\nadded```' — a fence that never closes, which on the next
    // parse swallows the rest of the document. `closeSafely` is the guard.
    const src = 'x\n\n```js\n```\n';
    const [f] = fenceRanges(src);
    expect(f.range).not.toBeNull();
    expect(f.range!.body.from).toBe(f.range!.body.to);
    const naive = splice(src, f.range!.body, 'added');
    expect(naive).toBe('x\n\n```js\nadded```\n'); // what we must NOT write
    const safe = splice(src, f.range!.body, closeSafely('added', src, f.range!.body.to));
    expect(safe).toBe('x\n\n```js\nadded\n```\n');
    // …and it re-parses as one closed fence with the new body.
    const reparsed = fenceRanges(safe);
    expect(reparsed).toHaveLength(1);
    expect(reparsed[0].text).toBe('added');
  });

  it('leaves a non-empty body’s separator alone', () => {
    const src = 'x\n\n```js\nold\n```\n';
    const [f] = fenceRanges(src);
    expect(closeSafely('new', src, f.range!.body.to)).toBe('new');
  });
});

describe('ranges are withheld where they cannot be trusted', () => {
  it('gives a nested fence no offset of its own', () => {
    // A fence inside a list item: the top-level token is the LIST, so the
    // nested render gets no origin and the fence is read-only.
    const src = '- item\n\n  ```js\n  nested();\n  ```\n';
    expect(fenceRanges(src)).toHaveLength(0);
  });

  it('returns null for a token with no raw to measure', () => {
    expect(fenceRangeOf({ type: 'code', text: 'x' }, 0)).toBeNull();
  });
});
