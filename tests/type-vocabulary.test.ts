/**
 * buildTypeVocabulary (ADR-0044 Inc 2, closing ADR-0042 Inc 2) — the pure
 * `$types` merge the gateway AND cell SSRs share. The invariant under test is
 * the per-facet merge (ADR-0002/0010): a slice override that sets only one
 * facet must not drop the canonical declaration's others, and every entry
 * comes out with its resolved `fields`/`present` attached.
 */
import { buildTypeVocabulary } from '../platform/runtime';

const CANON = {
  doc: {
    label: 'Document',
    icon: '📄',
    handlers: { open: { cell: 'lit', path: '/r/${key}' } },
    schema: { title: { type: 'string' } },
    present: { icon: '📄', titlePath: 'title' },
  },
  note: {
    label: 'Note',
    present: { icon: '📝' },
  },
};

describe('buildTypeVocabulary', () => {
  it('passes canonical types through, with resolved fields/present attached', () => {
    const out = buildTypeVocabulary(CANON, []);
    expect(Object.keys(out).sort()).toEqual(['doc', 'note']);
    const doc = out.doc as Record<string, unknown>;
    expect(doc.label).toBe('Document');
    expect(doc.fields).toBeDefined(); // resolved from schema
    expect((doc.present as Record<string, unknown>).icon).toBe('📄');
  });

  it('merges a slice override PER FACET — icon-only override keeps canonical handlers/schema', () => {
    const out = buildTypeVocabulary(CANON, [{ key: '_types/doc', value: { icon: '🗎' } }]);
    const doc = out.doc as Record<string, unknown>;
    expect(doc.icon).toBe('🗎'); // the override took
    expect(doc.handlers).toEqual(CANON.doc.handlers); // canonical facets survive
    expect(doc.schema).toEqual(CANON.doc.schema);
  });

  it('accepts bare type names AND _types/-prefixed keys for overrides', () => {
    const viaPrefix = buildTypeVocabulary(CANON, [{ key: '_types/note', value: { label: 'Memo' } }]);
    const viaBare = buildTypeVocabulary(CANON, [{ key: 'note', value: { label: 'Memo' } }]);
    expect((viaPrefix.note as Record<string, unknown>).label).toBe('Memo');
    expect((viaBare.note as Record<string, unknown>).label).toBe('Memo');
  });

  it('an override can INTRODUCE a slice-local type absent from the canon', () => {
    const out = buildTypeVocabulary(CANON, [{ key: '_types/ritual', value: { label: 'Ritual', present: { icon: '🕯' } } }]);
    expect(out.ritual).toBeDefined();
    expect((out.ritual as Record<string, unknown>).label).toBe('Ritual');
  });

  it('tolerates empty / undefined inputs', () => {
    expect(buildTypeVocabulary(undefined, undefined)).toEqual({});
    expect(Object.keys(buildTypeVocabulary(CANON, undefined))).toHaveLength(2);
    expect(buildTypeVocabulary(undefined, [{ key: '', value: { label: 'x' } }])).toEqual({});
    // A prefix-only key resolves to an empty type name — skipped, not a '' entry.
    expect(buildTypeVocabulary(undefined, [{ key: '_types/', value: { label: 'x' } }])).toEqual({});
  });

  it('membership parity: overriding never removes types, only reshapes them', () => {
    const out = buildTypeVocabulary(CANON, [{ key: '_types/doc', value: { label: 'Doc!' } }]);
    expect(Object.keys(out).sort()).toEqual(Object.keys(buildTypeVocabulary(CANON, [])).sort());
  });
});
