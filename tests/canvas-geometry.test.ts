/**
 * Geometry guards for the canvas cell (cells/canvas/client/lib/geometry.ts) —
 * the bounds that stop a runaway pinch from painting a 100k-px element (the
 * reproduced iOS Safari compositor tab-kill) and heal facts a past runaway
 * already persisted.
 */
import {
  clampElementScale,
  maxScaleFor,
  pinchFactor,
  sanitizeElementGeometry,
  MIN_EL_SCALE,
  MAX_EL_SCALE,
  MAX_PAINT_SIDE,
  MIN_PINCH_START_DIST,
} from '../cells/canvas/client/lib/geometry';

describe('pinchFactor', () => {
  it('is the plain ratio for a normal pinch', () => {
    expect(pinchFactor(200, 100)).toBeCloseTo(2);
  });
  it('floors a (near-)coincident start distance instead of exploding', () => {
    // the reproduced crash: fingers landing 0.5px apart, spread to 240px,
    // made the raw ratio 480× — one gesture, one 115k-px element
    expect(pinchFactor(240, 0.5)).toBeCloseTo(240 / MIN_PINCH_START_DIST);
    expect(pinchFactor(240, 0)).toBeCloseTo(240 / MIN_PINCH_START_DIST);
    expect(pinchFactor(240, undefined)).toBeCloseTo(240 / MIN_PINCH_START_DIST);
  });
  it('never returns a non-finite or non-positive factor', () => {
    expect(pinchFactor(NaN, 100)).toBe(1);
    expect(pinchFactor(Infinity, 100)).toBe(1);
    expect(pinchFactor(-5, 100)).toBe(1);
  });
});

describe('clampElementScale / maxScaleFor', () => {
  const el = { width: 240, height: 120 };
  it('clamps into [MIN_EL_SCALE, MAX_EL_SCALE] for a normal-sized element', () => {
    expect(clampElementScale(481, el)).toBe(MAX_EL_SCALE);
    expect(clampElementScale(0.0001, el)).toBe(MIN_EL_SCALE);
    expect(clampElementScale(2, el)).toBe(2);
  });
  it('caps the PAINTED side, so a wide element allows less scale', () => {
    const wide = { width: 8000, height: 100 };
    expect(maxScaleFor(wide)).toBeCloseTo(MAX_PAINT_SIDE / 8000);
    expect(clampElementScale(10, wide)).toBeCloseTo(MAX_PAINT_SIDE / 8000);
  });
  it('falls back on non-finite input', () => {
    expect(clampElementScale(NaN, el, 3)).toBe(3);
    expect(clampElementScale(Infinity, el, 3)).toBe(3);
    expect(clampElementScale(undefined, el)).toBe(1);
  });
});

describe('sanitizeElementGeometry', () => {
  it('leaves sane geometry untouched', () => {
    const el = { x: 10, y: -20, width: 240, height: 120, scale: 1.5, rotation: 45 };
    expect(sanitizeElementGeometry(el)).toBe(false);
    expect(el).toEqual({ x: 10, y: -20, width: 240, height: 120, scale: 1.5, rotation: 45 });
  });
  it('heals a fact poisoned by a past runaway pinch', () => {
    const el: any = { x: 195, y: 300, width: 240, height: 120, scale: 481 };
    expect(sanitizeElementGeometry(el)).toBe(true);
    expect(el.scale).toBeLessThanOrEqual(MAX_EL_SCALE);
    expect(el.width * el.scale).toBeLessThanOrEqual(MAX_PAINT_SIDE);
  });
  it('heals non-finite and absurd values', () => {
    const el: any = { x: NaN, y: Infinity, width: 1e7, height: -4, scale: NaN, rotation: NaN, zIndex: NaN };
    sanitizeElementGeometry(el);
    expect(el.x).toBe(0);
    expect(el.y).toBe(0);
    expect(el.width).toBe(MAX_PAINT_SIDE);
    expect(el.height).toBe(120);
    expect(el.scale).toBeGreaterThanOrEqual(MIN_EL_SCALE);
    expect(el.rotation).toBe(0);
    expect(el.zIndex).toBe(1);
  });
  it('does not invent a scale on elements that never had one', () => {
    const el: any = { x: 0, y: 0, width: 240, height: 120 };
    sanitizeElementGeometry(el);
    expect(el.scale).toBeUndefined();
  });
});
