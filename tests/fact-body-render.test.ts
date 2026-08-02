/**
 * `FactBody` — home's render dispatcher — on the shapes that used to fall
 * through it.
 *
 * Two defects are pinned here:
 *
 *  1. `file` (ADR-0027) is ONE type over a heterogeneous corpus: small text
 *     stores `content` inline, binary/large objects carry `s3Key`/`url` and no
 *     body at all. It declared a flat `markdown` render, so a PNG resolved to
 *     the markdown hint, found no text, and fell all the way through to the
 *     raw-JSON floor — with its own `contentType` unread two fields away.
 *  2. Nothing wrapped the dispatcher. Every individual path fails soft, but a
 *     fact whose VALUE doesn't match its declared renderer's assumptions threw
 *     during render, and an unguarded throw unmounts the whole subtree — one
 *     bad fact blanked the peek sheet instead of just itself.
 *
 * These render through `renderToStaticMarkup`, which is also the SSR path, so
 * what is asserted here is what a signed-out visitor's first paint contains.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FactBody, FactBodyBoundary, FactBodyFailed, setTypeDecls, typeDeclsFrom, type ListEntry } from '../cells/home/client/facts';

const FILE_DECL = {
  file: { icon: '📄', label: 'value.path', manager: '@c15r/home', handlers: { render: [{ hint: 'file' }] } },
  mermaid: { icon: '◉', viewer: 'mermaid' },
};

beforeAll(() => setTypeDecls(typeDeclsFrom(FILE_DECL)));

const render = (e: ListEntry): string =>
  renderToStaticMarkup(React.createElement(FactBody, { e, full: true }));

describe('file facts render by contentType', () => {
  it('paints an image file rather than dumping its envelope', () => {
    const html = render({
      key: 'file/img/logo.png',
      value: { path: 'img/logo.png', contentType: 'image/png', bytes: 2048, url: 'https://example.com/logo.png', source: 's3:PutObject', sha: 'a' },
      _meta: { type: 'file' },
    });
    expect(html).toContain('<img');
    expect(html).toContain('https://example.com/logo.png');
  });

  it('reads inline markdown as markdown', () => {
    const html = render({
      key: 'file/docs/x.md',
      value: { path: 'docs/x.md', contentType: 'text/markdown', bytes: 12, content: '# Title\n\nbody text\n', source: 'docs-sync', sha: 'b' },
      _meta: { type: 'file' },
    });
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('body text');
  });

  it('shows a pointer with no body as an honest card, not raw JSON', () => {
    const html = render({
      key: 'file/big/archive.zip',
      value: { path: 'big/archive.zip', contentType: 'application/zip', bytes: 5_242_880, s3Key: 'x/y/z', source: 's3:PutObject', sha: 'c' },
      _meta: { type: 'file' },
    });
    expect(html).toContain('big/archive.zip');
    expect(html).toContain('application/zip');
    expect(html).toContain('5.0 MB');
    // The old floor stringified the whole value envelope into the body.
    expect(html).not.toContain('"sha"');
  });

  it('renders non-markdown inline text as code, not as markdown', () => {
    const html = render({
      key: 'file/src/a.ts',
      value: { path: 'src/a.ts', contentType: 'text/x-typescript', bytes: 20, content: '# not a heading', source: 'cells:deployed', sha: 'd' },
      _meta: { type: 'file' },
    });
    expect(html).not.toContain('<h1>');
    expect(html).toContain('# not a heading');
  });
});

describe('a broken renderer degrades to the fact, not to a blank', () => {
  // React error boundaries do NOT run during renderToStaticMarkup/renderToString
  // — the SSR half is guarded separately, in cells/home/index.ts, where a failed
  // render falls back to the cold-mount shell. So the boundary's own contract is
  // asserted directly here rather than through a DOM render (no jsdom in tree).
  const fallback = React.createElement('i', null, 'fallback');
  const child = React.createElement('b', null, 'body');

  it('renders its children while healthy', () => {
    const b = new FactBodyBoundary({ children: child, fallback });
    expect(b.render()).toBe(child);
  });

  it('latches to the fallback once a child throws', () => {
    expect(FactBodyBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const b = new FactBodyBoundary({ children: child, fallback });
    b.state = FactBodyBoundary.getDerivedStateFromError();
    expect(b.render()).toBe(fallback);
  });

  it('shows the fact’s fields and an error badge in the fallback', () => {
    const html = renderToStaticMarkup(
      React.createElement(FactBodyFailed, {
        e: { key: 'file/bad', value: { path: 'bad/thing.bin', bytes: 12 }, _meta: { type: 'file' } },
      }),
    );
    expect(html).toContain('renderer failed');
    expect(html).toContain('bad/thing.bin'); // the fact is still legible
  });
});
