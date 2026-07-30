/**
 * Task-list checkboxes are for `- [ ]` / `- [x]` items ONLY.
 *
 * marked (12.x) sets `task: false` — a boolean — on every ORDINARY list item,
 * so the old `typeof it.task === 'boolean'` gate rendered a checkbox on every
 * bullet in the corpus (owner report 2026-07-30). Pin the corrected gate:
 * plain bullets stay bullets, task items get the checkbox with its state.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from '../cells/home/client/safe-markdown';

const render = (text: string): string =>
  renderToStaticMarkup(React.createElement(SafeMarkdown, { text }));

describe('safe-markdown task lists', () => {
  it('plain bullets render NO checkboxes', () => {
    const html = render('- alpha\n- beta\n- gamma\n');
    expect(html).not.toContain('type="checkbox"');
    expect((html.match(/<li/g) ?? []).length).toBe(3);
  });

  it('ordered lists render NO checkboxes', () => {
    const html = render('1. one\n2. two\n');
    expect(html).not.toContain('type="checkbox"');
  });

  it('task items render checkboxes with their checked state', () => {
    const html = render('- [ ] open\n- [x] done\n');
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect((html.match(/checked=""/g) ?? []).length).toBe(1);
  });

  it('a mixed list checkboxes only the task items', () => {
    const html = render('- plain\n- [ ] open\n- [x] done\n- also plain\n');
    expect((html.match(/<li/g) ?? []).length).toBe(4);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
  });
});
