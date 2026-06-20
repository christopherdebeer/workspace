/**
 * Resolution (ADR-0010) — the layered per-facet merge. `layer(...parts)` folds an
 * ordered stack of partial layers into one effective value: later wins per facet,
 * `undefined` is silent (never clobbers an earlier layer).
 */
import { layer } from '../platform/runtime/resolution';

describe('Resolution: layer()', () => {
  it('later layers win per facet', () => {
    expect(layer({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('an undefined facet is silent — it does not clobber an earlier value', () => {
    // the ADR-0002 bug: a slice overriding only `icon` must NOT drop canonical `handlers`
    const canonical = { icon: '📄', handlers: { open: ['x'] }, label: 'L' };
    const slice = { icon: '📝', handlers: undefined };
    expect(layer(canonical, slice)).toEqual({ icon: '📝', handlers: { open: ['x'] }, label: 'L' });
  });

  it('skips null/undefined layers entirely', () => {
    expect(layer({ a: 1 }, undefined, null, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('folds more than two layers (defaults ← config ← override)', () => {
    expect(layer({ w: 1, x: 1 }, { x: 2, y: 2 }, { y: 3, z: 3 })).toEqual({ w: 1, x: 2, y: 3, z: 3 });
  });

  it('an empty stack resolves to an empty value', () => {
    expect(layer()).toEqual({});
  });
});
