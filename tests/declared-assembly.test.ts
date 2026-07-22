/**
 * ADR-0093 — declared assembly + the multi-tenant vocabulary collision rule.
 *
 * Inc 1: the `assemble` intent resolves through the shared vocab resolver as
 * verbatim declaration data (no templating — `${match}` belongs to the
 * consumer, it names a fact key, not a URL).
 * Inc 4: `describeTypes` aggregation is first-declarer-wins with the losing
 * declaration recorded as observable `conflicts` — never a silent override.
 */
import { resolve, type TypeDecl } from '../platform/ui/vocab';
import { aggregateTypes } from '../services/cells/service';

describe('the assemble intent (ADR-0093 Inc 1)', () => {
  const decls: Record<string, TypeDecl> = {
    doc: {
      manager: '@c15r/lit',
      handlers: { assemble: [{ assemble: { field: 'content', fallbackKey: 'file/${match}.md' } }] },
    },
    'doc-block': {
      manager: '@c15r/lit',
      handlers: { assemble: [{ assemble: { field: 'content', containerTagPrefix: 'doc:', fallbackKey: 'file/${match}.md' } }] },
    },
    note: { manager: '@bob/notes', handlers: { render: [{ hint: 'markdown' }] } },
  };

  it('resolves a container type to its verbatim spec — ${match} untemplated', () => {
    const h = resolve({ key: 'doc:docs/x', _meta: { type: 'doc', tags: [] } }, 'assemble', decls);
    expect(h?.assemble).toEqual({ field: 'content', fallbackKey: 'file/${match}.md' });
  });

  it('resolves a member type with its container tag prefix', () => {
    const h = resolve({ key: 'doc-block:abc', _meta: { type: 'doc-block', tags: ['doc:docs/x'] } }, 'assemble', decls);
    expect(h?.assemble?.containerTagPrefix).toBe('doc:');
  });

  it('a type without an assemble declaration resolves null for the intent', () => {
    expect(resolve({ key: 'note/1', _meta: { type: 'note', tags: [] } }, 'assemble', decls)).toBeNull();
    // …and its render intent is untouched by the new field.
    expect(resolve({ key: 'note/1', _meta: { type: 'note', tags: [] } }, 'render', decls)?.hint).toBe('markdown');
  });

  it('a grant-folded key still resolves via its _meta.type signal', () => {
    const h = resolve({ key: 'c15r/doc:docs/x', _meta: { type: 'doc', tags: [] } }, 'assemble', decls);
    expect(h?.assemble?.fallbackKey).toBe('file/${match}.md');
  });
});

describe('aggregateTypes — first-declarer-wins, visibly (ADR-0093 Inc 4)', () => {
  const lit = {
    owner: 'c15r', name: 'lit', cellId: 'lit-1', createdAt: '2026-06-01T00:00:00Z',
    types: [{ type: 'doc', icon: '📄', manager: '@c15r/lit' }],
  };
  const hijacker = {
    owner: 'mallory', name: 'docz', cellId: 'docz-9', createdAt: '2026-07-22T00:00:00Z',
    // Self-declared manager tries to masquerade as lit — the audit trail must
    // name the REAL declaring cell.
    types: [{ type: 'doc', icon: '💀', manager: '@c15r/lit' }, { type: 'zine', icon: '📰' }],
  };

  it('the earliest declarer keeps the type; the later one is annotated, not applied', () => {
    // Deliberately pass newest-first: aggregation must order by createdAt itself.
    const { types, conflicts } = aggregateTypes([hijacker, lit]);
    const doc = types.doc as { icon?: string; conflicts?: string[] };
    expect(doc.icon).toBe('📄'); // lit's declaration survives
    expect(doc.conflicts).toEqual(['/@mallory/docz']); // the REAL cell (path form), not the spoofed manager
    expect(conflicts).toBe(1);
    expect((types.zine as { icon?: string }).icon).toBe('📰'); // non-colliding types land normally
  });

  it('no collision → no conflicts field, count zero', () => {
    const { types, conflicts } = aggregateTypes([lit]);
    expect(conflicts).toBe(0);
    expect((types.doc as { conflicts?: string[] }).conflicts).toBeUndefined();
  });

  it('reserved `_`-prefixed and unnamed decls are skipped as before', () => {
    const { types } = aggregateTypes([
      { owner: 'a', name: 'b', cellId: 'c', createdAt: '2026-01-01T00:00:00Z', types: [{ type: '_secret' }, { icon: 'x' }] },
    ]);
    expect(Object.keys(types)).toEqual([]);
  });
});
