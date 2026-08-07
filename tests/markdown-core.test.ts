/**
 * The shared markdown renderer core (`@parc/ui` markdown.tsx), as home mounts
 * it — docs/home-hosts-lit.md steps 1–2.
 *
 * Three things are pinned here, each of which was a live defect before the
 * renderer stopped being forked:
 *
 *  1. A FENCE renders as its DECLARATION (chips + body), not as dead code. The
 *     whole dotlit fence vocabulary — output cells, directives, attrs, tags,
 *     transclusion sources, emit targets — was dropped on the apex.
 *  2. WIKI-LINKS resolve through the ONE shared resolver, so `[[a doc title]]`
 *     is `doc:a-doc-title` here exactly as in lit (home's local tokenizer took
 *     the text verbatim as a key → a dead `/r/a doc title` link), and a
 *     `[[key#member]]` fragment survives into the href.
 *  3. EXECUTION never leaks onto the guest-exposed apex: a `repl`/`run`/`agent`
 *     fence renders as source, never as a live cell.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from '../cells/home/client/safe-markdown';
import { parseFenceMeta, fenceToString } from '../platform/ui/fence';

const render = (text: string): string =>
  renderToStaticMarkup(React.createElement(SafeMarkdown, { text }));

describe('fences render as declarations', () => {
  it('shows the full info-string as chips, not just the first word', () => {
    const html = render('```js !plugin type=viewer of=foo #tag\nconst a = 1;\n```\n');
    expect(html).toContain('fence-chips');
    expect(html).toContain('>js<');          // fc-lang
    expect(html).toContain('!plugin');        // fc-dir
    expect(html).toContain('type=viewer');    // fc-attr
    expect(html).toContain('#tag');           // fc-tag
    // …and the body is still there, verbatim.
    expect(html).toContain('const a = 1;');
  });

  it('preserves the raw info-string for downstream enhancement', () => {
    const html = render('```js !plugin type=viewer of=foo\nx\n```\n');
    expect(html).toContain('data-fence="js !plugin type=viewer of=foo"');
  });

  it('marks an output cell and names its lang', () => {
    const html = render('```>img out.svg attached=true\nbody\n```\n');
    expect(html).toContain('fence-output');
    expect(html).toContain('⤷ output');
    expect(html).toContain('out.svg');
    // `attached=true` is provenance noise — not a chip (parity with lit).
    expect(html).not.toContain('attached=true<');
  });

  it('renders a transclusion source as a link to the source fact', () => {
    const html = render('```md < doc:some-doc\n```\n');
    expect(html).toContain('fc-src');
    expect(html).toContain('href="/r/doc:some-doc"');
  });

  it('renders a ```md fence as markdown, with its admonition directive', () => {
    const html = render('```md !warn\n**careful**\n```\n');
    expect(html).toContain('md-fence dir-warn');
    expect(html).toContain('<strong>careful</strong>');
  });

  it('leaves an undeclared fence bare — no chip row for `lang` alone', () => {
    const html = render('```\nplain\n```\n');
    expect(html).not.toContain('fence-chips');
    expect(html).toContain('plain');
  });
});

describe('execution stays in the editor trust context', () => {
  // Home is guest-exposed at the apex. A fence that DECLARES execution renders
  // as its declaration + source; lit is the only surface that runs it.
  for (const fence of ['repl', 'run', 'agent', 'js repl=server']) {
    it(`\`${fence}\` renders as source, never live`, () => {
      const html = render('```' + fence + '\nconsole.log(1)\n```\n');
      expect(html).toContain('console.log(1)');
      expect(html).toContain('<pre');
      expect(html).not.toContain('<button');
      expect(html).not.toContain('<iframe');
    });
  }
});

describe('wiki-links use the one shared resolver', () => {
  it('slugifies prose targets to doc: keys', () => {
    expect(render('See [[some doc title]].')).toContain('href="/r/doc:some-doc-title"');
  });

  it('treats a separator-bearing target as a real key', () => {
    expect(render('See [[kb/foo|Foo]].')).toContain('href="/r/kb/foo"');
  });

  it('carries a #member fragment into the href', () => {
    expect(render('See [[doc:x#sec]].')).toContain('href="/r/doc:x#sec"');
  });

  it('renders a bare [[#fragment]] as an in-document anchor', () => {
    expect(render('See [[#intro]].')).toContain('href="#intro"');
  });
});

describe('URL sanitization holds through the move', () => {
  it('drops a javascript: link but keeps its text', () => {
    const html = render('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('drops a javascript: image but keeps its alt', () => {
    const html = render('![alt text](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('alt text');
  });

  it('does not execute raw block HTML', () => {
    const html = render('<script>alert(1)</script>\n');
    expect(html).not.toContain('<script>');
  });
});

describe('the fence grammar recognises substrate keys as sources', () => {
  // `doc:x` is path-shaped for this purpose: substrate keys are colon-
  // separated, and a transclusion source names a fact far more often than a
  // file. Without this, `fromSource` was undefined and the fence rendered as
  // an empty code block on every surface.
  it('parses a colon-keyed source', () => {
    const m = parseFenceMeta('md < doc:some-doc');
    expect(m.fromSource).toBe('doc:some-doc');
    expect(m.source?.lang).toBe('txt');
  });

  it('keeps parse ∘ serialize a fixpoint for colon-keyed sources', () => {
    const once = fenceToString(parseFenceMeta('md < doc:some-doc'));
    expect(once).toBe('md < txt doc:some-doc');
    expect(fenceToString(parseFenceMeta(once))).toBe(once);
  });
});
