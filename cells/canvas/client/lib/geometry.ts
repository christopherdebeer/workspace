/**
 * geometry.ts — hard bounds on element geometry.
 *
 * Why this module exists: the mobile-Safari tab-kill. A two-finger gesture
 * whose fingers land (nearly) together makes the pinch ratio newDist/startDist
 * explode — reproduced in headless Chrome: an 8px start spread to 300px set
 * el.scale to 37 (an 8,900px-wide element); a coincident start set it to 481
 * (a 115,000×9,000px paint area). Desktop GPUs absorb that; iOS Safari's
 * compositor memory limit kills the tab. Worse, the gesture's commit PERSISTS
 * the exploded scale as a fact, so the poisoned board then crashes "randomly"
 * on every later visit. These bounds are enforced at both ends: gesture math
 * clamps what a gesture can produce, and load-time sanitisation heals what a
 * past explosion may already have persisted.
 */

export const MIN_EL_SCALE = 0.05;
export const MAX_EL_SCALE = 20;

/** The longest side an element may PAINT at (width×scale), in px. Past ~16k
 *  even desktop GPUs tile; on iOS a single multi-10k-px layer is a tab-kill. */
export const MAX_PAINT_SIDE = 16384;

/** Two fingers closer than this at pinch start carry no usable ratio signal —
 *  the denominator floor that keeps newDist/startDist out of the hundreds. */
export const MIN_PINCH_START_DIST = 24;

export const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** The largest scale this element may take without its painted box exceeding
 *  MAX_PAINT_SIDE on either side (never below MIN_EL_SCALE, so a huge width
 *  can't make the bound itself invalid). */
export function maxScaleFor(el: { width?: number; height?: number }): number {
  const side = Math.max(isFiniteNum(el.width) ? el.width : 240, isFiniteNum(el.height) ? el.height : 120, 1);
  return Math.max(MIN_EL_SCALE, Math.min(MAX_EL_SCALE, MAX_PAINT_SIDE / side));
}

/** Clamp a prospective element scale; a non-finite input takes the fallback. */
export function clampElementScale(v: unknown, el: { width?: number; height?: number }, fallback = 1): number {
  const n = isFiniteNum(v) ? v : fallback;
  return clamp(isFiniteNum(n) ? n : 1, MIN_EL_SCALE, maxScaleFor(el));
}

/** A safe pinch ratio: floored denominator, finite, positive. */
export function pinchFactor(newDist: number, startDist: number | undefined): number {
  const denom = Math.max(isFiniteNum(startDist) ? startDist : 0, MIN_PINCH_START_DIST);
  const f = (isFiniteNum(newDist) ? newDist : denom) / denom;
  return isFiniteNum(f) && f > 0 ? f : 1;
}

/**
 * Heal an element's geometry IN PLACE wherever elements enter canvasState from
 * outside (SSR hydrate, substrate load, live-sync merge): a fact poisoned by a
 * past runaway gesture must render at a survivable size, not re-crash every
 * load. Returns true when anything was out of bounds.
 */
export function sanitizeElementGeometry(el: Record<string, any>): boolean {
  let healed = false;
  const fix = (k: string, v: number): void => { el[k] = v; healed = true; };

  // A collapsed side (a runaway content-height sync once persisted sub-pixel
  // heights) is as unusable as an exploded one: the element becomes an
  // uninteractable sliver at any zoom. Heal absurdly-small back to defaults.
  if (!isFiniteNum(el.width) || el.width < 8) fix('width', 240);
  else if (el.width > MAX_PAINT_SIDE) fix('width', MAX_PAINT_SIDE);
  if (!isFiniteNum(el.height) || el.height < 8) fix('height', 120);
  else if (el.height > MAX_PAINT_SIDE) fix('height', MAX_PAINT_SIDE);

  if (el.scale !== undefined) {
    const s = clampElementScale(el.scale, el, 1);
    if (s !== el.scale) fix('scale', s);
  }
  if (!isFiniteNum(el.x)) fix('x', 0);
  else if (Math.abs(el.x) > 1e6) fix('x', clamp(el.x, -1e6, 1e6));
  if (!isFiniteNum(el.y)) fix('y', 0);
  else if (Math.abs(el.y) > 1e6) fix('y', clamp(el.y, -1e6, 1e6));
  if (el.rotation !== undefined && !isFiniteNum(el.rotation)) fix('rotation', 0);
  if (el.zIndex !== undefined && !isFiniteNum(el.zIndex)) fix('zIndex', 1);
  return healed;
}
