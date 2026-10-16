/**
 * Pattern making: from a slot's six dials, the pieces of a garment as they'd be cut from cloth (flat, in
 * centimetres, drafted to the mannequin's own measurements), where each is laid round the figure to be sewn, which
 * edges are sewn to which, and what's held (a waistband, a neckband).
 *
 * The dials, the same six for every slot, and how they meet in the cut:
 * - shape: how long (a skirt's length, a top's, a cape's);
 * - silhouette: how it stands away (a skirt's flare, pencil to full circle; a top's ease, fitted to trapeze; a cape's
 *   sweep, half a circle to a whole one);
 * - drape: how much more cloth than the body needs, gathered in (at a waist, a sleeve's head, a neck);
 * - pieces: how it's divided (a skirt's gores, a top's sleeves, a cape's panels): more seams, more shaping;
 * - fabric: what it's cut from (tulle, silk, cotton, wool, felt), which sets how it falls;
 * - print: what's on the cloth, laid on the flat pieces, so it meets itself at seams as a real print would.
 *
 * Each piece is a grid (u across, v down) over a flat shape; the grid's spacing is about the cloth's resolution.
 */
import { CHEST_Y, LIMBS, SHOULDER_Y, WAIST_Y, around, girth, onShoulder, type V3 } from './body';

export interface Dials { shape: number; silhouette: number; drape: number; pieces: number; fabric: number; print: number }
export type SlotId = 'skirt' | 'top' | 'cape';
export const DIALS: Array<keyof Dials> = ['shape', 'silhouette', 'drape', 'pieces', 'fabric', 'print'];

export interface Piece {
  name: string;
  /** grid points across (u) and down (v), less one */
  nu: number; nv: number;
  /** the flat pattern: centimetres, y down negative */
  flat: (u: number, v: number) => [number, number];
  /** where it's laid round the figure before it's sewn */
  start: (u: number, v: number) => V3;
  /** where it's held, if it is (a waistband's points) */
  pin?: (u: number, v: number) => V3 | null;
}
/** an edge of a piece: which side, and the stretch of it (0–1 along it), in the order it's walked */
export interface Edge { piece: number; side: 'u0' | 'u1' | 'v0' | 'v1'; from: number; to: number }
export interface Garment { slot: SlotId; pieces: Piece[]; seams: Array<[Edge, Edge]>; layer: number; label: string }

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** how many grid steps for a length (about 2.2 cm each) */
const steps = (len: number, min = 3) => Math.max(min, Math.round(len / 2.2));

// ─── a skirt: gores ────────────────────────────────────────────────────────────────────────────
function skirt(d: Dials): Garment {
  const n = 2 + Math.round(d.pieces * 8), gather = d.drape * 1.1, L = 16 + d.shape * 40, f = d.silhouette;
  const Wc = girth(WAIST_Y) + 2.5, top = (Wc * (1 + gather)) / n;
  // (flared toward a full circle: the hem as long as a circle's round the waist's own radius plus the length)
  const hem = top + (f * TAU * L) / n, th = (hem - top) / L;
  const flat = (u: number, v: number): [number, number] => {
    if (th < 1e-3) return [(u - 0.5) * lerp(top, hem, v), -v * L];
    const Ri = top / th, phi = (u - 0.5) * th, r = Ri + v * L;
    return [r * Math.sin(phi), -(r * Math.cos(phi) - Ri)];
  };
  const pieces: Piece[] = [];
  for (let k = 0; k < n; k++) {
    const ang = (u: number) => ((k + u) / n) * TAU;
    pieces.push({
      name: n === 2 ? (k === 0 ? 'front' : 'back') : `gore ${k + 1}`,
      nu: steps(hem), nv: steps(L, 4), flat,
      start: (u, v) => around(WAIST_Y - v * L * 0.92, ang(u), 1.4 + f * v * L * 0.55),
      pin: (u, v) => (v === 0 ? around(WAIST_Y, ang(u), 0.5) : null),
    });
  }
  const seams: Array<[Edge, Edge]> = [];
  for (let k = 0; k < n; k++) seams.push([{ piece: k, side: 'u1', from: 0, to: 1 }, { piece: (k + 1) % n, side: 'u0', from: 0, to: 1 }]);
  return { slot: 'skirt', pieces, seams, layer: 0, label: `${n} ${n === 2 ? 'pieces' : 'gores'}` };
}

// ─── a top: a front, a back, and sleeves ───────────────────────────────────────────────────────
const SLEEVES = ['no sleeves', 'cap sleeves', 'short sleeves', 'three-quarter sleeves', 'long sleeves'];
function top(d: Dials): Garment {
  const yTop = SHOULDER_Y + 1.2, hemY = lerp(76, 50, d.shape), L = yTop - hemY, ease = 1.07 + 0.12 * d.drape, arm = 12;
  const shoulderW = 30.5;
  // (the half-width of a panel at a height: the body's own, eased; then flaring toward the hem as the silhouette
  // opens; and above the chest, in toward the shoulders)
  const half = (y: number) => {
    const body = (girth(Math.max(y, 50)) / 2) * ease, open = d.silhouette * 16 * clamp01((CHEST_Y - y) / (CHEST_Y - hemY)) ** 1.4;
    const w = body + open;
    return y > CHEST_Y + 2 ? lerp(w, shoulderW, clamp01((y - CHEST_Y - 2) / (yTop - CHEST_Y - 2))) : w;
  };
  const neck = (front: boolean) => (u: number) => (front ? 5.5 : 1.8) * Math.max(0, 1 - ((u - 0.5) / 0.21) ** 2);
  const panel = (front: boolean): Piece => {
    const dip = neck(front);
    return {
      name: front ? 'front' : 'back', nu: steps(half(CHEST_Y)), nv: steps(L, 5),
      flat: (u, v) => { const y = yTop - dip(u) - v * (L - dip(u)); return [(u - 0.5) * half(y), y - yTop]; },
      start: (u, v) => {
        // (above the underarm, its sides drawn round to the front and back of the shoulder, clear of the arm)
        const y = yTop - dip(u) - v * (L - dip(u)), span = Math.PI * lerp(1, 0.62, clamp01((y - (yTop - arm)) / arm));
        const a = front ? (u - 0.5) * span : Math.PI - (0.5 - u) * span;
        return around(Math.min(y, 90), a, 2.2 + d.silhouette * 3 * v);
      },
      // (held at its shoulder seams, on the shoulders, as on a hanger; the neckline and the rest hang from there)
      pin: (u, v) => (v === 0 && (u <= 0.3 || u >= 0.7) ? onShoulder(front ? (u - 0.5) * shoulderW : (0.5 - u) * shoulderW, front, 1.4) : null),
    };
  };
  const pieces: Piece[] = [panel(true), panel(false)];
  const seams: Array<[Edge, Edge]> = [];
  const a = arm / L, sleeve = Math.min(4, Math.floor(d.pieces * 5));
  // (the sides, under the armholes; the shoulders, either side of the neck)
  seams.push([{ piece: 0, side: 'u0', from: a, to: 1 }, { piece: 1, side: 'u1', from: a, to: 1 }]);
  seams.push([{ piece: 0, side: 'u1', from: a, to: 1 }, { piece: 1, side: 'u0', from: a, to: 1 }]);
  seams.push([{ piece: 0, side: 'v0', from: 0, to: 0.29 }, { piece: 1, side: 'v0', from: 1, to: 0.71 }]);
  seams.push([{ piece: 0, side: 'v0', from: 1, to: 0.71 }, { piece: 1, side: 'v0', from: 0, to: 0.29 }]);
  if (sleeve > 0) {
    const len = [0, 7, 13, 23, 33][sleeve], puff = 1 + d.drape * 0.9;
    for (const side of [-1, 1] as const) {
      // (round its arm: the shoulder's capsule and the forearm's, down from the shoulder)
      const up = LIMBS[side < 0 ? 0 : 5], low = LIMBS[side < 0 ? 1 : 6];
      const along = (t: number): { c: V3; r: number; dir: V3 } => {
        const s = t * len, l1 = Math.hypot(up.b[0] - up.a[0], up.b[1] - up.a[1], up.b[2] - up.a[2]);
        const seg = s < l1 ? up : low, f2 = s < l1 ? s / l1 : Math.min(1, (s - l1) / Math.hypot(low.b[0] - low.a[0], low.b[1] - low.a[1], low.b[2] - low.a[2]));
        const dir: V3 = [seg.b[0] - seg.a[0], seg.b[1] - seg.a[1], seg.b[2] - seg.a[2]], dl = Math.hypot(...dir);
        return { c: [seg.a[0] + dir[0] * f2, seg.a[1] + dir[1] * f2, seg.a[2] + dir[2] * f2], r: seg.ra + (seg.rb - seg.ra) * f2, dir: [dir[0] / dl, dir[1] / dl, dir[2] / dl] };
      };
      // (a ring round the arm, down it from the shoulder; u = 0 and 1 under the arm, toward the body)
      const tube = (u: number, v: number): V3 => {
        const { c, r, dir } = along(v), ax: V3 = [0, 0, 1], b1: V3 = [dir[1] * ax[2] - dir[2] * ax[1], dir[2] * ax[0] - dir[0] * ax[2], dir[0] * ax[1] - dir[1] * ax[0]];
        const bl = Math.hypot(...b1) || 1, e1: V3 = [b1[0] / bl, b1[1] / bl, b1[2] / bl], e2: V3 = [dir[1] * e1[2] - dir[2] * e1[1], dir[2] * e1[0] - dir[0] * e1[2], dir[0] * e1[1] - dir[1] * e1[0]];
        const ph = u * TAU, ca = Math.cos(ph) * side, sa = -Math.sin(ph) * side, rr = r + 2.4;
        return [c[0] + (e1[0] * ca + e2[0] * sa) * rr, c[1] + (e1[1] * ca + e2[1] * sa) * rr, c[2] + (e1[2] * ca + e2[2] * sa) * rr];
      };
      const w0 = 2 * arm * 1.08 * puff, w1 = TAU * (along(1).r + 1.6) * (1 + d.silhouette * 0.5);
      pieces.push({
        name: side < 0 ? 'right sleeve' : 'left sleeve', nu: steps(w0), nv: steps(len, 3),
        // (its head rounded up over the shoulder)
        flat: (u, v) => [(u - 0.5) * lerp(w0, w1, v), -v * len + 2.6 * Math.sin(Math.PI * u) * (1 - v)],
        start: (u, v) => {
          // (its head laid round the armhole it's sewn to, easing into a tube round the arm further down)
          const hole = (): V3 => {
            const front = side < 0 ? u >= 0.5 : u <= 0.5, t = side < 0 ? (front ? (u - 0.5) / 0.5 : (0.5 - u) / 0.5) : (front ? (0.5 - u) / 0.5 : (u - 0.5) / 0.5);
            const pc = pieces[front ? 0 : 1], edgeU = side < 0 ? (front ? 0 : 1) : (front ? 1 : 0);
            return pc.start(edgeU, t * a);
          };
          const ring = tube(u, v), f = Math.min(1, Math.max(0, v / 0.35)), k = f * f * (3 - 2 * f);
          if (k >= 1) return ring;
          const h = hole();
          return [h[0] + (ring[0] - h[0]) * k, h[1] + (ring[1] - h[1]) * k, h[2] + (ring[2] - h[2]) * k];
        },
      });
      const k = pieces.length - 1;
      // (its underarm seam; and its head, round the armhole: down the front's side, up the back's)
      seams.push([{ piece: k, side: 'u0', from: 0, to: 1 }, { piece: k, side: 'u1', from: 0, to: 1 }]);
      if (side < 0) {
        seams.push([{ piece: k, side: 'v0', from: 0.5, to: 1 }, { piece: 0, side: 'u0', from: 0, to: a }]);
        seams.push([{ piece: k, side: 'v0', from: 0, to: 0.5 }, { piece: 1, side: 'u1', from: a, to: 0 }]);
      } else {
        seams.push([{ piece: k, side: 'v0', from: 0.5, to: 0 }, { piece: 0, side: 'u1', from: 0, to: a }]);
        seams.push([{ piece: k, side: 'v0', from: 1, to: 0.5 }, { piece: 1, side: 'u0', from: a, to: 0 }]);
      }
    }
  }
  return { slot: 'top', pieces, seams, layer: 1, label: SLEEVES[sleeve] };
}

// ─── a cape: sectors hung from the neck ────────────────────────────────────────────────────────
function cape(d: Dials): Garment {
  const p = 1 + Math.round(d.pieces * 5), L = 22 + d.shape * 40, sweep = lerp(0.5, 1, d.silhouette), gather = 1 + d.drape * 0.9;
  const neckY = 96.2, neckR = 6.3, cover = TAU * (1 - 0.08) * neckR, Th = sweep * TAU, Ri = (cover * gather) / Th, per = Th / p;
  const pieces: Piece[] = [];
  // (round the neck from just right of the front, round the back, to just left of it)
  const ang = (k: number, u: number) => TAU * 0.04 + ((k + u) / p) * TAU * 0.92;
  for (let k = 0; k < p; k++) {
    pieces.push({
      name: p === 1 ? 'cape' : `panel ${k + 1}`, nu: steps(per * (Ri + L)), nv: steps(L, 4),
      flat: (u, v) => { const phi = (u - 0.5) * per, r = Ri + v * L; return [r * Math.sin(phi), -(r * Math.cos(phi) - Ri)]; },
      start: (u, v) => {
        const a = ang(k, u), out = neckR + 1 + v * L * 0.75, y = neckY - v * L * 0.8;
        return [Math.sin(a) * out, Math.max(y, 20), Math.cos(a) * out - 0.4];
      },
      pin: (u, v) => { if (v !== 0) return null; const a = ang(k, u); return [Math.sin(a) * neckR, neckY, Math.cos(a) * neckR - 0.4]; },
    });
  }
  const seams: Array<[Edge, Edge]> = [];
  for (let k = 0; k + 1 < p; k++) seams.push([{ piece: k, side: 'u1', from: 0, to: 1 }, { piece: k + 1, side: 'u0', from: 0, to: 1 }]);
  return { slot: 'cape', pieces, seams, layer: 2, label: `${p} ${p === 1 ? 'piece' : 'panels'}` };
}

export function draft(slot: SlotId, d: Dials): Garment {
  return slot === 'skirt' ? skirt(d) : slot === 'top' ? top(d) : cape(d);
}

// ─── what the dials say ────────────────────────────────────────────────────────────────────────
export const FABRICS = ['tulle', 'silk', 'cotton', 'linen', 'wool', 'felt'];
export const PRINTS = ['plain', 'stripes', 'gingham', 'spots', 'flowers', 'stars'];
export function fabricName(t: number) { return FABRICS[Math.min(FABRICS.length - 1, Math.floor(t * FABRICS.length))]; }
export function printName(t: number) { const k = Math.min(23, Math.floor(t * 24)); return PRINTS[k % 6]; }
export function words(slot: SlotId, d: Dials, g: Garment): Record<keyof Dials, string> {
  const len = slot === 'skirt' ? ['mini', 'knee', 'midi', 'maxi'] : slot === 'top' ? ['cropped', 'waist', 'hip', 'tunic'] : ['short', 'elbow', 'long', 'floor'];
  const sil = slot === 'skirt' ? ['pencil', 'A-line', 'flared', 'circle'] : slot === 'top' ? ['fitted', 'easy', 'swing', 'trapeze'] : ['half circle', 'three-quarter', 'full', 'full circle'];
  const q = (t: number, a: string[]) => a[Math.min(a.length - 1, Math.floor(t * a.length))];
  return { shape: q(d.shape, len), silhouette: q(d.silhouette, sil), drape: q(d.drape, ['smooth', 'eased', 'gathered', 'ruffled']), pieces: g.label, fabric: fabricName(d.fabric), print: printName(d.print) };
}
