/**
 * ── INLAND WATER, FROM THE COVER RASTER ──
 *
 * The terrain painter has always known more water than the hydro field: it
 * paints every WorldCover class-80 pixel blue, while hydro was handed only
 * OSM ways and the ocean mask — class-80 flood-filled from the coast at the
 * sea datum, refusing everything above the datum or landward of the
 * coastline. An estuary is landward of the coastline by definition, and a
 * lagoon sits above the datum, so both existed only as paint: at George the
 * cache held one `waterway=river` centreline and the cover held a band
 * 110–270 m wide (measured through the cell's own cache).
 *
 * This module turns the class-80 pixels the ocean flood REFUSED into
 * polygons hydro can build bodies from. It is pixel-space arithmetic with
 * no world knowledge — the caller maps corners to metres and decides what
 * kind of water it is — so it can be tested in a millisecond.
 *
 * The rings are traced along PIXEL EDGES with the water on the right (screen
 * coordinates, y down), so an outer ring comes out clockwise and a hole
 * counter-clockwise; at a checkerboard corner the trace takes the right-most
 * turn, which keeps two loops that touch at a corner apart. Straight runs
 * are merged, one Chaikin pass takes the 38 m staircase off the shore, and a
 * Douglas–Peucker pass drops what the smoothing left collinear — the ring
 * is walked per texel by hydro's signed-distance, so every point costs.
 */

export interface InlandComponent {
  /** Class-80 pixels in the component. */
  pixels: number;
  /** Pixel bounds, inclusive. */
  minX: number; minY: number; maxX: number; maxY: number;
  /** Outer ring as flat [x, y, …] pixel-corner coordinates (0..width). */
  outer: number[];
  /** Islands, same encoding. */
  holes: number[][];
  /** True when the outer ring runs along the raster's edge — the water
   *  continues into the neighbouring tile. */
  onEdge: boolean;
  /** Pixels with a finite value in `known`, when one was given: the pixels
   *  a DEM tile already answers for. A component with none cannot be built
   *  yet, and will be retraced when it can. */
  known: number;
}

export const INLAND_WATER_CLASS = 80;

/** Class-80 pixels the ocean mask did not absorb. */
export function inlandMask(cover: Uint8Array, ocean: Uint8Array | null, n: number, waterClass = INLAND_WATER_CLASS): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = cover[i] === waterClass && !(ocean && ocean[i]) ? 1 : 0;
  return out;
}

/** A cheap signature of a mask, so an unchanged raster is not re-traced. */
export function maskSignature(mask: Uint8Array): number {
  let h = 0, c = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { h = (h + Math.imul(i + 1, 2654435761)) | 0; c++; }
  return (h ^ (c << 1)) | 0;
}

/** Four-connected components of the mask, largest first, each with its
 *  traced rings. Components under `minPixels` are dropped: a lone 38 m
 *  pixel is a shadow or a roof, not a pond. */
export function inlandComponents(mask: Uint8Array, width: number, height: number, minPixels = 4, maxComponents = 200, known?: Float32Array | null): InlandComponent[] {
  const n = width * height;
  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const i = stack.pop() as number;
      size++;
      const x = i % width, y = (i / width) | 0;
      if (x > 0 && mask[i - 1] && label[i - 1] < 0) { label[i - 1] = id; stack.push(i - 1); }
      if (x < width - 1 && mask[i + 1] && label[i + 1] < 0) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - width] && label[i - width] < 0) { label[i - width] = id; stack.push(i - width); }
      if (y < height - 1 && mask[i + width] && label[i + width] < 0) { label[i + width] = id; stack.push(i + width); }
    }
    sizes.push(size);
  }
  const order = sizes.map((size, id) => ({ size, id })).filter((c) => c.size >= minPixels)
    .sort((a, b) => b.size - a.size).slice(0, maxComponents);
  const out: InlandComponent[] = [];
  for (const { size, id } of order) {
    const rings = traceRings(label, id, width, height);
    if (!rings.length) continue;
    // The outer ring encloses the most area; the rest are islands.
    rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    let minX = width, minY = height, maxX = -1, maxY = -1, onEdge = false, knownN = 0;
    for (let i = 0; i < n; i++) {
      if (label[i] !== id) continue;
      const x = i % width, y = (i / width) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) onEdge = true;
      if (!known || Number.isFinite(known[i])) knownN++;
    }
    out.push({
      pixels: size, minX, minY, maxX, maxY, onEdge, known: knownN,
      outer: shapeRing(rings[0]),
      holes: rings.slice(1).map(shapeRing).filter((r) => r.length >= 6),
    });
  }
  return out;
}

/** Straight runs merged, one corner-cutting pass, then the collinear residue dropped. */
export function shapeRing(ring: number[]): number[] {
  return simplifyRing(chaikin(mergeCollinear(ring), 1), 0.2);
}

/** Boundary edges of one labelled component, linked into closed rings of
 *  pixel corners. Each edge has the component on its right. */
export function traceRings(label: Int32Array, id: number, width: number, height: number): number[][] {
  const W1 = width + 1;
  // edge key: start corner → list of end corners (usually one)
  const starts = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const k = y0 * W1 + x0, e = y1 * W1 + x1;
    const list = starts.get(k);
    if (list) list.push(e); else starts.set(k, [e]);
  };
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && label[y * width + x] === id;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (label[y * width + x] !== id) continue;
    if (!inside(x, y - 1)) add(x, y, x + 1, y);           // top, left→right
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);   // right, top→bottom
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);   // bottom, right→left
    if (!inside(x - 1, y)) add(x, y + 1, x, y);           // left, bottom→top
  }
  const rings: number[][] = [];
  for (const [k0, ends0] of starts) {
    while (ends0.length) {
      const ring: number[] = [];
      let k = k0;
      let e = ends0.pop() as number;
      let dx = (e % W1) - (k % W1), dy = ((e / W1) | 0) - ((k / W1) | 0);
      ring.push(k % W1, (k / W1) | 0);
      let guard = 0;
      while (e !== k0 && guard++ < 4 * width * height) {
        ring.push(e % W1, (e / W1) | 0);
        const list = starts.get(e);
        if (!list || !list.length) { ring.length = 0; break; }
        let pick = 0;
        if (list.length > 1) {
          // Right-most turn keeps the trace on the pixel it is rounding.
          let best = -Infinity;
          for (let i = 0; i < list.length; i++) {
            const cx = (list[i] % W1) - (e % W1), cy = ((list[i] / W1) | 0) - ((e / W1) | 0);
            const cross = dx * cy - dy * cx;            // >0 is a right turn with y down
            if (cross > best) { best = cross; pick = i; }
          }
        }
        const next = list.splice(pick, 1)[0];
        dx = (next % W1) - (e % W1); dy = ((next / W1) | 0) - ((e / W1) | 0);
        k = e; e = next;
      }
      if (ring.length >= 6) rings.push(ring);
    }
  }
  return rings;
}

/** Twice the signed area (screen coordinates: clockwise positive). */
export function ringArea(ring: number[]): number {
  let twice = 0;
  const n = ring.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twice += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return twice / 2;
}

/** Drop the middle point of every straight run. */
export function mergeCollinear(ring: number[]): number[] {
  const n = ring.length >> 1;
  if (n < 4) return ring.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n, q = (i + 1) % n;
    const ax = ring[i * 2] - ring[p * 2], ay = ring[i * 2 + 1] - ring[p * 2 + 1];
    const bx = ring[q * 2] - ring[i * 2], by = ring[q * 2 + 1] - ring[i * 2 + 1];
    if (ax * by - ay * bx === 0 && ax * bx + ay * by > 0) continue;
    out.push(ring[i * 2], ring[i * 2 + 1]);
  }
  return out;
}

/** Chaikin's corner cutting on a closed ring. */
export function chaikin(ring: number[], passes = 1): number[] {
  let cur = ring;
  for (let p = 0; p < passes; p++) {
    const n = cur.length >> 1;
    if (n < 3) return cur;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = cur[i * 2], ay = cur[i * 2 + 1], bx = cur[j * 2], by = cur[j * 2 + 1];
      out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
    }
    cur = out;
  }
  return cur;
}

/** Douglas–Peucker on a closed ring: split at the point farthest from the
 *  first, simplify the two open halves, keep the union. */
export function simplifyRing(ring: number[], tolerance: number): number[] {
  const n = ring.length >> 1;
  if (n < 6) return ring.slice();
  let far = 1, best = -1;
  for (let i = 1; i < n; i++) {
    const d = (ring[i * 2] - ring[0]) ** 2 + (ring[i * 2 + 1] - ring[1]) ** 2;
    if (d > best) { best = d; far = i; }
  }
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[far] = 1;
  const tol2 = tolerance * tolerance;
  const dp = (idx: number[]): void => {
    const stack: Array<[number, number]> = [[0, idx.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop() as [number, number];
      if (b - a < 2) continue;
      const ia = idx[a], ib = idx[b];
      const ax = ring[ia * 2], ay = ring[ia * 2 + 1], bx = ring[ib * 2], by = ring[ib * 2 + 1];
      const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
      let worst = tol2, at = -1;
      for (let i = a + 1; i < b; i++) {
        const ii = idx[i];
        const px = ring[ii * 2] - ax, py = ring[ii * 2 + 1] - ay;
        const t = len2 > 0 ? Math.max(0, Math.min(1, (px * vx + py * vy) / len2)) : 0;
        const d = (px - vx * t) ** 2 + (py - vy * t) ** 2;
        if (d > worst) { worst = d; at = i; }
      }
      if (at < 0) continue;
      keep[idx[at]] = 1;
      stack.push([a, at], [at, b]);
    }
  };
  const first: number[] = [];
  for (let i = 0; i <= far; i++) first.push(i);
  const second: number[] = [];
  for (let i = far; i < n; i++) second.push(i);
  second.push(0);
  dp(first); dp(second);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(ring[i * 2], ring[i * 2 + 1]);
  return out.length >= 6 ? out : ring.slice();
}
