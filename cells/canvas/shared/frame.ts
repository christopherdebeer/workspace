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
