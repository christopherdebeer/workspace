/**
 * A type's declared RENDER BINDING must actually be consumed — whichever
 * spelling it uses.
 *
 * `resolve()` only ever read `handlers.render[]`. But the Present facet
 * (ADR-0012) carries the same binding as `present.render` — `{hint}` or
 * `{viewer}` — and that is the shape the older `_types/<type>` facts still
 * living in slices use (`csv`, `json`, `mermaid`, `style`). So those types
 * resolved to NOTHING and fell through to the markdown/JSON floor: a fact
 * typed `mermaid` rendered as a wall of diagram source on a surface that draws
 * the identical content as a diagram when it arrives as a fence. One
 * declaration, two spellings, one of them consumed.
 */
import { resolve, type TypeDecl } from '../platform/ui/vocab';

const fact = (type: string, value: unknown = 'x') => ({ key: `${type}:1`, value, _meta: { type } });

describe('the Present facet is a render binding', () => {
  it('resolves a legacy flat `viewer` decl', () => {
    const decls: Record<string, TypeDecl> = { mermaid: { icon: '◉', viewer: 'mermaid' } };
    expect(resolve(fact('mermaid'), 'render', decls)).toEqual({ viewer: 'mermaid' });
  });

  it('resolves a served `present.render.viewer` decl', () => {
    const decls: Record<string, TypeDecl> = { csv: { present: { icon: '▦', render: { viewer: 'csv' } } } };
    expect(resolve(fact('csv'), 'render', decls)).toEqual({ viewer: 'csv' });
  });

  it('resolves a `present.render.hint` decl', () => {
    const decls: Record<string, TypeDecl> = { note: { present: { render: { hint: 'markdown' } } } };
    expect(resolve(fact('note'), 'render', decls)).toEqual({ hint: 'markdown' });
  });

  it('lets an explicit handlers.render win over the Present facet', () => {
    const decls: Record<string, TypeDecl> = {
      csv: { viewer: 'csv', handlers: { render: [{ hint: 'fields' }] } },
    };
    expect(resolve(fact('csv'), 'render', decls)).toEqual({ hint: 'fields' });
  });

  it('prefers the declared type over a less specific key-prefix signal', () => {
    // `mermaid:1`'s key prefix is also `mermaid`; the point is that the type's
    // own Present binding resolves before we ever fall to a weaker signal.
    const decls: Record<string, TypeDecl> = {
      diagram: { viewer: 'mermaid' },
      thing: { handlers: { render: [{ hint: 'fields' }] } },
    };
    const e = { key: 'thing/7', value: 'g', _meta: { type: 'diagram' } };
    expect(resolve(e, 'render', decls)).toEqual({ viewer: 'mermaid' });
  });

  it('falls back to the facet when every declared handler template misses', () => {
    // `${value.src}` is absent, so the handler is inapplicable — that must not
    // strand the type with no renderer at all.
    const decls: Record<string, TypeDecl> = {
      chart: { viewer: 'csv', handlers: { render: [{ surface: '${value.src}' }] } },
    };
    expect(resolve(fact('chart', {}), 'render', decls)).toEqual({ viewer: 'csv' });
  });

  it('leaves other intents untouched', () => {
    const decls: Record<string, TypeDecl> = { csv: { viewer: 'csv' } };
    expect(resolve(fact('csv'), 'open', decls)).toBeNull();
    expect(resolve(fact('csv'), 'edit', decls)).toBeNull();
  });

  it('still resolves nothing for a type with no binding at all', () => {
    expect(resolve(fact('mystery'), 'render', { mystery: { icon: '?' } })).toBeNull();
  });
});
