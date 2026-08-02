/**
 * Fences render as what they ARE on the shared sanitized core
 * (docs/home-hosts-lit.md steps 1–2, ADR-0059): plain code stays code, a lit
 * declaration renders its chip row + static body, `md` fences render nested
 * markdown (admonition-styled), and static-safe viewer langs go to the viewer
 * hook — never a dead ``` block with the meta line silently dropped, which is
 * exactly what home's old renderer did to every lit fence on the apex.
 *
 * Exercised through home's REAL wrapper (cells/home/client/safe-markdown) so
 * the marked-engine injection, the viewer hook, and the shared wiki rule are
 * all pinned as the apex actually ships them.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from '../cells/home/client/safe-markdown';

const render = (text: string): string =>
  renderToStaticMarkup(React.createElement(SafeMarkdown, { text }));

const fence = (info: string, body = ''): string => '```' + info + '\n' + body + '\n```\n';

describe('shared safe-markdown fence rendering', () => {
  it('a plain fence stays a plain code block (no chips)', () => {
    const html = render(fence('js', 'const a = 1;'));
    expect(html).toContain('language-js');
    expect(html).toContain('const a = 1;');
    expect(html).not.toContain('fence-chips');
  });

  it('a declaration fence renders the chip row + static body, meta preserved', () => {
    const html = render(fence('js tool.js !collapse #api', 'export {}'));
    expect(html).toContain('data-fence="js tool.js !collapse #api"');
    expect(html).toContain('fence-chips');
    expect(html).toContain('tool.js');
    expect(html).toContain('!collapse');
    expect(html).toContain('#api');
    // !collapse folds the body behind a <details>
    expect(html).toContain('<details>');
    expect(html).toContain('export {}');
  });

  it('an output cell (leading >) is marked as output, not dead code', () => {
    const html = render(fence('>toc'));
    expect(html).toContain('↳ output');
    expect(html).toContain('fence-output');
  });

  it('a transclusion declaration links its key-shaped source', () => {
    const html = render(fence('md < doc:foo'));
    expect(html).toContain('&lt; doc:foo');
    expect(html).toContain('href="/r/doc:foo"');
    expect(html).toContain('transcludes');
  });

  it('an md admonition fence renders nested markdown, not code', () => {
    const html = render(fence('md !warn', 'be **careful** here'));
    expect(html).toContain('dir-warn');
    expect(html).toContain('<strong>careful</strong>');
    expect(html).not.toContain('language-md');
  });

  it('a bare md fence renders nested markdown', () => {
    const html = render(fence('md', '# heading'));
    expect(html).toContain('md-fence');
    expect(html).toContain('<h1>heading</h1>');
  });

  it('static-safe viewer langs route to the viewer host, not a <pre>', () => {
    const html = render(fence('mermaid', 'graph TD; A-->B;'));
    expect(html).not.toContain('<pre');
  });
});

describe('shared wiki-link rule on home', () => {
  it('a bare title slugs to doc:<slug> (the lit/card rule, previously skipped here)', () => {
    const html = render('see [[Some Title]]');
    expect(html).toContain('href="/r/doc:some-title"');
    expect(html).toContain('>Some Title</a>');
  });

  it('a key-shaped target is used as-is', () => {
    const html = render('see [[kb/proj_sol|the project]]');
    expect(html).toContain('href="/r/kb/proj_sol"');
    expect(html).toContain('>the project</a>');
  });

  it('a fragment rides the href', () => {
    const html = render('see [[doc:x#doc-block:x/2]]');
    expect(html).toContain('href="/r/doc:x#doc-block%3Ax%2F2"');
  });
});
