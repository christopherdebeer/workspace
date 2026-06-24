/**
 * Present (ADR-0012) — the affordance stage. `resolvePresent(fact, decl)` → the
 * Affordance set { icon, label, render, handlers } a surface needs to show a fact.
 */
import { resolvePresent, resolveLabel } from '../platform/runtime/present';

describe('Present: resolvePresent', () => {
  it('resolves icon, an envelope label path, render hint, and handlers', () => {
    const decl = { icon: '📄', label: 'value.title', render: { hint: 'markdown' }, handlers: { open: [{ path: '?doc=${match}' }] } };
    const a = resolvePresent({ key: 'doc:x', value: { title: 'Hello' }, type: 'doc' }, decl);
    expect(a).toEqual({ icon: '📄', label: 'Hello', render: { hint: 'markdown' }, handlers: { open: [{ path: '?doc=${match}' }] } });
  });

  it('supports the legacy bare titlePath (rooted at the value)', () => {
    const decl = { icon: '🔋', titlePath: 'name' };
    expect(resolvePresent({ key: 'cells/abc', value: { name: 'home' }, type: 'cell' }, decl).label).toBe('home');
  });

  it('a viewer declaration becomes a render binding', () => {
    const decl = { icon: '▦', viewer: 'csv' };
    expect(resolvePresent({ key: 'k', value: 'a,b', type: 'csv' }, decl).render).toEqual({ viewer: 'csv' });
  });

  it('falls back to the key when the label path misses or the type is undeclared', () => {
    expect(resolvePresent({ key: 'kb/1', value: {}, type: 'note' }, { label: 'value.title' }).label).toBe('kb/1');
    const floor = resolvePresent({ key: 'orphan/9', value: { x: 1 } }, undefined);
    expect(floor.label).toBe('orphan/9');
    expect(floor.handlers).toBeUndefined();
  });

  it('stringifies a numeric label (e.g. value.seq)', () => {
    expect(resolveLabel({ key: 'k', value: { seq: 2.25 } }, 'value.seq')).toBe('2.25');
  });
});
