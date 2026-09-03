/**
 * shelved's first paint — the layout the server sends before any data exists.
 *
 * Shelved served a bare shell whose only content was "opening your shelf…", so
 * every visitor got a blank cream page until the bundle parsed and made two
 * round trips. The server now renders the real components with empty data, and
 * the client renders the same tree until its first load resolves, so
 * `hydrateRoot` has matching markup to attach to.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { FirstPaint, FirstPaintBody, viewForPath } from '../cells/shelved/shared/FirstPaint';
import styled, { collectStyles } from '../cells/shelved/shared/styled';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('the page shelved serves before it knows anything', () => {
  it('renders real layout, not a spinner', () => {
    const html = renderToString(createElement(FirstPaint, { view: 'discover' as const }));
    expect(html).toContain('Find your next book on someone else’s shelf.');
    expect(html).toContain('Available books');
    expect(html).toContain('Shelved');
    // The thing this replaced.
    expect(html).not.toContain('Opening the shelves');
    expect(html).not.toContain('opening your shelf');
  });

  it('renders the shelf frame for the shelf view', () => {
    const html = renderToString(createElement(FirstPaint, { view: 'shelf' as const }));
    expect(html).toContain('Your shelf is personal.');
  });

  // THE failure this whole exercise turns on. `install()` only touches the DOM,
  // so a server render emits class names and, without the registry, no CSS —
  // unstyled content that then restyles, which is worse than the blank page it
  // replaced. Assert the sheet actually covers the classes in the markup.
  it('ships the CSS for the classes it just emitted', () => {
    const html = renderToString(createElement(FirstPaint, { view: 'discover' as const }));
    const css = collectStyles();
    expect(css.length).toBeGreaterThan(500);
    const used = Array.from(new Set(Array.from(html.matchAll(/class="([^"]+)"/g)).flatMap((m) => m[1].split(/\s+/))))
      .filter((c) => c.startsWith('sv-'));
    expect(used.length).toBeGreaterThan(5);
    const missing = used.filter((c) => !css.includes(`.${c}{`));
    expect(missing).toEqual([]);
  });

  // Both sides resolve the landing view through this, so they cannot disagree.
  it('resolves the same view from a path on either side of the wire', () => {
    expect(viewForPath('/')).toBe('discover');
    expect(viewForPath('/readers')).toBe('readers');
    expect(viewForPath('/reader/abc')).toBe('readers');
    expect(viewForPath('/book/w_1')).toBe('discover');
  });

  // The body is what App renders inside its own frame; rendering the full
  // FirstPaint there would nest a second frame, which is exactly the markup
  // difference hydration reports.
  it('body carries no frame of its own', () => {
    const body = renderToString(createElement(FirstPaintBody, { view: 'discover' as const }));
    expect(body).not.toContain('data-shelved-global');
  });
});

// `renderPage` injects by String.replace on two literals in the shell. A
// replace whose needle has drifted does not throw — it returns the string
// unchanged, so the cell would quietly go back to serving the blank shell with
// every test still green. Pin the literals themselves.
describe('the shell markers renderPage injects into', () => {
  const shell = readFileSync(join(__dirname, '../cells/shelved/static/index.html'), 'utf8');
  const source = readFileSync(join(__dirname, '../cells/shelved/index.ts'), 'utf8');

  it('still contains the boot div and the style slot, verbatim', () => {
    expect(shell).toContain('<!-- styled -->');
    expect(shell).toContain('<div id="app"><p class="boot">opening your shelf…</p></div>');
  });

  it('and index.ts targets exactly those', () => {
    expect(source).toContain(".replace('<!-- styled -->'");
    expect(source).toContain(`.replace('<div id="app"><p class="boot">opening your shelf…</p></div>'`);
  });

  // The client branches on this to hydrate rather than re-render from scratch.
  it('marks the server-rendered root so the client hydrates it', () => {
    expect(source).toContain('data-ssr="1"');
    const main = readFileSync(join(__dirname, '../cells/shelved/client/main.tsx'), 'utf8');
    expect(main).toContain("dataset.ssr === '1'");
    expect(main).toContain('hydrateRoot');
  });
});

// Class names were `sv-${++sequence}` — module evaluation order. The server
// bundle renders the first-paint tree and the browser loads the whole app, so
// the two never share an import graph: `.sv-1` was BrandNav's nav in one and a
// different rule in the other. The server's stylesheet then painted the wrong
// elements and hydration mismatched every className. Ids are content-derived
// now, which is the property that makes one stylesheet valid in both bundles.
describe('class names do not depend on module evaluation order', () => {
  it('derives the same class from the same rule text', () => {
    const a = styled.div`color: rebeccapurple; padding: 3px;`;
    const b = styled.span`color: rebeccapurple; padding: 3px;`;
    expect(String(a)).toBe(String(b));
  });

  it('derives different classes from different rule text', () => {
    const a = styled.div`color: rebeccapurple;`;
    const b = styled.div`color: seagreen;`;
    expect(String(a)).not.toBe(String(b));
  });

  it('never emits a counter-shaped id', () => {
    const css = collectStyles();
    const ids = Array.from(css.matchAll(/^\.(sv-[a-z0-9-]+)\{/gm)).map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(5);
    // `sv-1`, `sv-2`, … would mean the sequence counter came back.
    expect(ids.filter((id) => /^sv-\d+$/.test(id))).toEqual([]);
  });

  it('emits each rule once', () => {
    const ids = Array.from(collectStyles().matchAll(/^\.(sv-[a-z0-9-]+)\{/gm)).map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
