/* ---------------------------------------------------------------------------
 *  frame.ts — the viewport resolver (ADR-0015), isomorphic.
 *
 *  A frame is a Collection + a region. This module is the ONE place that turns
 *  a region into a camera, used identically by the SSR (cells/canvas/index.ts)
 *  and the interactive client (lib/network/storage.ts):
 *
 *      region  --regionBBox(els)-->  bbox  --fitRegion(screen)-->  camera
 *
 *  The region is screen-independent (persisted); the camera is derived per
 *  observer, so the same frame frames correctly on a phone and a wall display.
 * ------------------------------------------------------------------------- */

export interface BBox { minX: number; minY: number; maxX: number; maxY: number; }
export interface Camera { scale: number; tx: number; ty: number; }

/** A frame's region — derived from members/a query (follows content), or anchored. */
export type Region =
  | { kind: 'bbox'; minX: number; minY: number; maxX: number; maxY: number }
  | { kind: 'members'; members: string[] }
  | { kind: 'query'; query: { type?: string; tag?: string; prefix?: string } };

/** The fact stored at `frame:<id>` (type `frame`). It IS a collection; `region`
 *  is its render facet. `seq`/tour ordering lives in a `_doc/`-style decoration. */
export interface FrameValue {
  board: string;
  label?: string;
  region: Region;
  /** The viewpoint shown on open when no explicit ?frame is given. */
  default?: boolean;
}

/** A placed board element reduced to what region math needs (x,y are the CENTRE). */
export interface Placed {
  key: string;
  type?: string;
  tags?: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
}

function bboxOf(els: Placed[]): BBox | null {
  if (!els.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of els) {
    const s = e.scale || 1;
    const hw = ((e.width || 200) * s) / 2;
    const hh = ((e.height || 100) * s) / 2;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
    minX = Math.min(minX, e.x - hw);
    minY = Math.min(minY, e.y - hh);
    maxX = Math.max(maxX, e.x + hw);
    maxY = Math.max(maxY, e.y + hh);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** Match a placed element against an intensional region query (structural floor:
 *  the same type/tag/prefix vocabulary as `matchesSelector`). */
export function matchesRegionQuery(e: Placed, q: { type?: string; tag?: string; prefix?: string }): boolean {
  if (q.type && e.type !== q.type) return false;
  if (q.tag && !(e.tags ?? []).includes(q.tag)) return false;
  if (q.prefix && !e.key.startsWith(q.prefix)) return false;
  return true;
}

/** The canvas-space bbox a region denotes, given the board's placed elements.
 *  null when a derived region matches nothing (caller falls back to fit-all). */
export function regionBBox(region: Region, els: Placed[]): BBox | null {
  if (region.kind === 'bbox') {
    return { minX: region.minX, minY: region.minY, maxX: region.maxX, maxY: region.maxY };
  }
  if (region.kind === 'members') {
    const set = new Set(region.members);
    return bboxOf(els.filter((e) => set.has(e.key)));
  }
  if (region.kind === 'query') {
    return bboxOf(els.filter((e) => matchesRegionQuery(e, region.query)));
  }
  return null;
}

/** Fit a bbox into a w×h screen with fractional padding → the camera for
 *  `translate(tx,ty) scale(scale)`. Screen-independent: SSR/client/embed each
 *  fit the same region to their own dimensions (cf. tldraw zoomToBounds /
 *  map fitBounds). `maxScale` caps zoom-in on a tiny region. */
export function fitRegion(bbox: BBox, w: number, h: number, padFrac = 0.08, maxScale = 2): Camera {
  const bw = Math.max(bbox.maxX - bbox.minX, 1);
  const bh = Math.max(bbox.maxY - bbox.minY, 1);
  const pad = Math.min(w, h) * Math.max(0, padFrac);
  const scale = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh, maxScale);
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return { scale, tx: w / 2 - scale * cx, ty: h / 2 - scale * cy };
}

/** Resolve a frame straight to a camera for a screen — the whole pipeline.
 *  Returns null when the region is empty (derived, matched nothing). */
export function frameCamera(region: Region, els: Placed[], w: number, h: number, padFrac = 0.08): Camera | null {
  const bbox = regionBBox(region, els);
  return bbox ? fitRegion(bbox, w, h, padFrac) : null;
}

/* ── frame overlay (isomorphic) ─────────────────────────────────────────────
 *  The dashed region + label pill drawn over a board's frames. ONE renderer for
 *  the SSR (so frames paint on first load, not after a lazy client query) and
 *  the live client overlay (so they're pixel-identical). Tertiary by design:
 *  a thin dashed stroke and a small pill spaced off the region — present, never
 *  competing with the content. The markup is in WORLD coordinates; the layer it
 *  lives in is transformed exactly like the element container, so it tracks the
 *  board at any zoom/viewport. */

/** Breathing room (world units) between the members' bbox and the drawn region. */
export const FRAME_PAD = 16;
/** Gap (world units) between the label pill and the region's top edge. */
const FRAME_GAP = 12;
const FRAME_STROKE = '#c2cabf';      // tertiary: muted green-grey
const FRAME_FILL_DEFAULT = 'rgba(47,111,79,0.018)';
const FRAME_CHIP_BG = '#eef0ec';
const FRAME_CHIP_FG = '#7c8a80';

export interface FrameLike {
  key: string;
  value?: { label?: string; default?: boolean; region?: Region };
}

const svgEsc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** The inner SVG markup (a `<g>` per frame: dashed region rect + tappable label
 *  pill) for `#frames-layer`, in world coordinates. `frame-chip`/`data-frame`
 *  are read by the gesture FSM (client) for selection; inert under SSR. */
export function renderFramesSvg(frames: FrameLike[], placed: Placed[]): string {
  let out = '';
  for (const f of frames) {
    const region = f.value?.region;
    if (!region) continue;
    const bb = regionBBox(region, placed);
    if (!bb) continue;
    const frameId = f.key.replace(/^frame:/, '');
    const label = f.value?.label || frameId;
    const x = bb.minX - FRAME_PAD, y = bb.minY - FRAME_PAD;
    const w = Math.max(1, bb.maxX - bb.minX) + FRAME_PAD * 2;
    const h = Math.max(1, bb.maxY - bb.minY) + FRAME_PAD * 2;
    const fs = 14, padX = 8, chH = fs + 8;
    const text = (f.value?.default ? '◉ ' : '') + label;
    const chW = text.length * fs * 0.58 + padX * 2;
    const chipY = y - FRAME_GAP - chH;
    const fill = f.value?.default ? FRAME_FILL_DEFAULT : 'none';
    out +=
      `<g>` +
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="12"` +
      ` fill="${fill}" stroke="${FRAME_STROKE}" stroke-width="1" stroke-dasharray="3,6" vector-effect="non-scaling-stroke" style="pointer-events:none"/>` +
      `<g class="frame-chip" data-frame="${svgEsc(frameId)}" style="pointer-events:all;cursor:pointer">` +
      `<rect x="${x.toFixed(1)}" y="${chipY.toFixed(1)}" width="${chW.toFixed(1)}" height="${chH}" rx="7" fill="${FRAME_CHIP_BG}" stroke="${FRAME_STROKE}" vector-effect="non-scaling-stroke"/>` +
      `<text x="${(x + padX).toFixed(1)}" y="${(chipY + chH / 2).toFixed(1)}" dominant-baseline="central" fill="${FRAME_CHIP_FG}"` +
      ` style="font:600 ${fs}px -apple-system,system-ui,sans-serif;pointer-events:none;user-select:none">${svgEsc(text)}</text>` +
      `</g></g>`;
  }
  return out;
}
