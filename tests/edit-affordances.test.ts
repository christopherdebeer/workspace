/**
 * The editing affordances, and the shared field vocabulary underneath them.
 *
 * Three things are pinned:
 *
 *  1. `bodyText` (what a surface READS as a fact's body) and `bodyField` (where
 *     an in-place edit WRITES) resolve the same field, because they share one
 *     list. Home carried a forked `bodyText` whose list was missing
 *     `statement`, so a `claim` — whose entire content IS its statement — fell
 *     through to the `fields` hint and truncated mid-sentence at 160 chars.
 *     Deduping fixes that; colocating the write target keeps the two honest.
 *  2. The `SchemaForm` long-text seam: `@parc/ui` can't import an editor (the
 *     kit is pre-bundled with React as its only external), so a host injects
 *     one. A DECLARED markdown field must reach it — a `protocol`'s whole body
 *     is a markdown field that was being edited through a one-line input.
 *  3. `editFact` is one tap to the editor, not one tap to a peek you then have
 *     to find Edit inside.
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bodyText, bodyField } from '../platform/ui/render-hints';
import { SchemaForm, type LongTextProps } from '../platform/ui/form';
import { FactDetail, setTypeDecls, typeDeclsFrom } from '../cells/home/client/facts';

describe('bodyText and bodyField agree on one field', () => {
  const cases: Array<[string, unknown, string | null | undefined, string]> = [
    ['a bare string fact', 'just text', null, 'just text'],
    ['content', { content: 'c' }, 'content', 'c'],
    ['body', { body: 'b' }, 'body', 'b'],
    ['a claim’s statement', { statement: 's', confidence: 0.8 }, 'statement', 's'],
    ['markdown', { markdown: 'm' }, 'markdown', 'm'],
    ['no body at all', { bytes: 3 }, undefined, ''],
    ['a null value', null, undefined, ''],
  ];

  for (const [label, value, field, text] of cases) {
    it(`${label}: reads and writes the same place`, () => {
      expect(bodyField(value)).toBe(field);
      expect(bodyText(value)).toBe(text);
      // The invariant that matters: whatever bodyText returned came from the
      // field bodyField names — so an edit round-trips to what was shown.
      if (typeof field === 'string') expect((value as Record<string, string>)[field]).toBe(text);
    });
  }

  it('honours the priority order when several body fields are present', () => {
    const v = { note: 'n', content: 'c', statement: 's' };
    expect(bodyField(v)).toBe('content');
    expect(bodyText(v)).toBe('c');
  });

  it('skips an empty field rather than claiming it', () => {
    const v = { content: '', statement: 'the real body' };
    expect(bodyField(v)).toBe('statement');
    expect(bodyText(v)).toBe('the real body');
  });
});

describe('an in-place edit preserves the rest of the fact', () => {
  // The commit shape `{...value, [bodyField(value)]: next}` is what keeps an
  // edit from being destructive. Per-member editing on an assembled doc got
  // this wrong first time: it rebuilt a stand-in entry from the rendered TEXT
  // (`{content: shown}`) and wrote that back, silently dropping every other
  // field the member carried. Pinned as a plain data property here — the
  // component that performs it is exercised through DocBody.
  const commit = (value: unknown, next: string): unknown => {
    const f = bodyField(value);
    return f === null ? next : { ...(value as Record<string, unknown>), [f as string]: next };
  };

  it('keeps sibling fields when the body changes', () => {
    const member = { content: 'old body', id: 'blk-1', fold: false, seq: 2.5 };
    expect(commit(member, 'new body')).toEqual({ content: 'new body', id: 'blk-1', fold: false, seq: 2.5 });
  });

  it('writes the field the body was actually READ from', () => {
    // No `content` — the body is the claim's statement, so that is the target.
    const claim = { statement: 'old', confidence: 0.8, support: ['a'] };
    expect(commit(claim, 'new')).toEqual({ statement: 'new', confidence: 0.8, support: ['a'] });
  });

  it('replaces a bare string value wholesale', () => {
    expect(commit('old', 'new')).toBe('new');
  });
});

describe('the SchemaForm long-text seam', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content: { type: 'string', format: 'markdown' },
    },
    required: ['title'],
  };
  const spy = (seen: LongTextProps[]) => (p: LongTextProps): React.ReactNode => {
    seen.push(p);
    return React.createElement('div', { 'data-rich': p.name }, p.value);
  };

  it('routes a declared markdown field to the injected editor', () => {
    const seen: LongTextProps[] = [];
    const html = renderToStaticMarkup(
      React.createElement(SchemaForm, {
        schema, value: { title: 'T', content: '# body' }, onChange: () => undefined, renderLongText: spy(seen),
      }),
    );
    expect(seen.map((p) => p.name)).toEqual(['content']);
    expect(seen[0].format).toBe('markdown');
    expect(seen[0].value).toBe('# body');
    expect(html).toContain('data-rich="content"');
  });

  it('leaves short scalar fields as ordinary inputs', () => {
    const seen: LongTextProps[] = [];
    renderToStaticMarkup(
      React.createElement(SchemaForm, {
        schema, value: { title: 'T', content: 'x' }, onChange: () => undefined, renderLongText: spy(seen),
      }),
    );
    expect(seen.map((p) => p.name)).not.toContain('title');
  });

  it('falls back to the textarea when no editor is injected', () => {
    const html = renderToStaticMarkup(
      React.createElement(SchemaForm, { schema, value: { title: 'T', content: 'x' }, onChange: () => undefined }),
    );
    expect(html).toContain('<textarea');
  });
});

describe('editFact opens straight into the editor', () => {
  beforeAll(() => setTypeDecls(typeDeclsFrom({
    knowledge: { icon: '🧠', manager: '@c15r/home', handlers: { render: [{ hint: 'markdown' }] } },
  })));

  const entry = { key: 'kb/note', value: { content: 'the body' }, _meta: { type: 'knowledge', version: 3 } };

  it('renders the editor immediately with startEditing', () => {
    const html = renderToStaticMarkup(React.createElement(FactDetail, { e: entry, startEditing: true }));
    expect(html).toContain('Save');
    expect(html).toContain('Cancel');
    // The read view's body is NOT also on screen — this is the editor, not a
    // preview with an editor bolted under it.
    expect(html).not.toContain('neighbourhood');
  });

  it('renders the reading view without it', () => {
    const html = renderToStaticMarkup(React.createElement(FactDetail, { e: entry }));
    expect(html).toContain('the body');
    expect(html).not.toContain('>Save<');
  });
});
