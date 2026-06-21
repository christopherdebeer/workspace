/**
 * The type-vocabulary resolver (docs/type-vocabulary.md) — the pure routing
 * layer that replaces home's hardcoded `factHref` conventions. These cases
 * mirror the old behaviour exactly, plus the substrate-override ladder.
 */
import { resolve, declFor, deriveId, typeSignals, type TypeDecl } from '../platform/ui/vocab';

// parc's routing conventions as data — the explicit fixture the resolver is tested
// against (decoupled from any cell's DEFAULT_TYPE_DECLS, which is now a thin
// "last-resort fallback"; the canonical handlers live in each managing cell's
// types.json → $types).
const CONVENTIONS: Record<string, TypeDecl> = {
  doc: { icon: '📄', manager: '@c15r/lit', handlers: { open: [{ surface: '/@c15r/lit?doc=${match}' }] } },
  capture: { icon: '📥', manager: '@c15r/input', handlers: { open: [{ surface: '/@c15r/lit?doc=log:${value.captured}' }, { surface: '/@c15r/input' }] } },
  inbox: { icon: '📥', manager: '@c15r/input', handlers: { open: [{ surface: '/@c15r/lit?doc=log:${value.captured}' }, { surface: '/@c15r/input' }] } },
  cell: { icon: '🧩', manager: 'platform', handlers: { open: [{ surface: '${value.address}' }] } },
  canvas: { icon: '🌲', manager: '@c15r/canvas', handlers: { open: [{ surface: '/@c15r/canvas?canvas=${match}' }] } },
};

const open = (fact: Parameters<typeof resolve>[0]): string | null =>
  resolve(fact, 'open', CONVENTIONS)?.surface ?? null;

describe('typeSignals + deriveId', () => {
  it('derives an id from a prefixed key', () => {
    expect(deriveId('doc:foo')).toBe('foo');
    expect(deriveId('inbox/2026-06-13')).toBe('2026-06-13');
    expect(deriveId('plain')).toBe('plain');
  });
  it('orders signals most-specific first: type, key-prefix, tags', () => {
    const sigs = typeSignals({ key: 'doc:foo', _meta: { type: 'doc', tags: ['canvas:b1'] } });
    expect(sigs).toEqual([
      { type: 'doc', match: 'foo' },
      { type: 'doc', match: 'foo' },
      { type: 'canvas', match: 'b1' },
    ]);
  });
});

describe('resolve(open) mirrors the old factHref conventions', () => {
  it('doc: key → lit', () => {
    expect(open({ key: 'doc:intro', value: {} })).toBe('/@c15r/lit?doc=intro');
  });
  it('doc tag on a non-doc fact → lit', () => {
    expect(open({ key: 'note-7', value: {}, _meta: { type: 'knowledge', tags: ['doc:intro'] } })).toBe(
      '/@c15r/lit?doc=intro',
    );
  });
  it('capture WITH a date → the day-log in lit', () => {
    expect(open({ key: 'inbox/x', value: { captured: '2026-06-13' }, _meta: { type: 'capture' } })).toBe(
      '/@c15r/lit?doc=log:2026-06-13',
    );
  });
  it('capture WITHOUT a date falls through to the input cell', () => {
    expect(open({ key: 'inbox/x', value: { content: 'hi' }, _meta: { type: 'capture' } })).toBe('/@c15r/input');
  });
  it('an inbox/ key with no type still routes (key-prefix signal)', () => {
    expect(open({ key: 'inbox/y', value: {} })).toBe('/@c15r/input');
  });
  it('cell → its own address (raw, not encoded)', () => {
    expect(open({ key: 'cells/abc', value: { address: '/@c15r/notes' }, _meta: { type: 'cell' } })).toBe(
      '/@c15r/notes',
    );
  });
  it('canvas tag → the board', () => {
    expect(open({ key: 'e1', value: {}, _meta: { tags: ['canvas:slice'] } })).toBe('/@c15r/canvas?canvas=slice');
  });
  it('an unmapped fact has no open path', () => {
    expect(open({ key: 'random', value: { n: 1 }, _meta: { type: 'mystery' } })).toBeNull();
  });
  it('encodes scalar template values', () => {
    expect(open({ key: 'doc:a b/c', value: {} })).toBe('/@c15r/lit?doc=' + encodeURIComponent('a b/c'));
  });
});

describe('substrate _types override the defaults', () => {
  const decls = { ...CONVENTIONS, doc: { icon: '📘', handlers: { open: [{ surface: '/reader/${id}' }] } } };
  it('a user/cell declaration wins over the convention', () => {
    expect(resolve({ key: 'doc:intro', value: {} }, 'open', decls)?.surface).toBe('/reader/intro');
  });
  it('declFor picks the governing declaration (for icon/label)', () => {
    expect(declFor({ key: 'doc:intro', value: {} }, decls)?.icon).toBe('📘');
  });
});

describe('non-open intents resolve too', () => {
  const decls = {
    doc: { handlers: { open: [{ surface: '/@c15r/lit?doc=${match}' }], edit: [{ surface: '/@c15r/lit?doc=${match}&edit=1' }], create: [{ act: '@c15r/lit.create' }] } },
  };
  it('edit', () => {
    expect(resolve({ key: 'doc:x', value: {} }, 'edit', decls)?.surface).toBe('/@c15r/lit?doc=x&edit=1');
  });
  it('create resolves to an act target', () => {
    expect(resolve({ key: 'doc:x', value: {} }, 'create', decls)?.act).toBe('@c15r/lit.create');
  });
});
