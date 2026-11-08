/**
 * The stone's drawing fitted as a field (`?scene=field`; `&field=flat` for the baseline): Gaussians over the stone and
 * the ground, each with an ink opacity that depends on the direction it's seen from (nine low-order terms of the view
 * direction, fitted by devtools/splats-field-fit.mjs to the brush-drawn stone rendered from 36 views). Mark kind 11:
 * the renderer evaluates each disc's opacity from its terms every frame (render.ts), the terms packed into the bits a
 * drawing's feature and element ids use (four at 8 bits, five at 6, each over −12…12).
 */
import type { Splats } from './format';

export const FIELD_KIND = 11;
const INK = [36, 31, 27], LO = -12, HI = 12;
const q = (v: number, bits: number) => Math.round(((Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)) * ((1 << bits) - 1));

/** the experiment's assets folder (static/splats/, served with the page) */
const ASSETS = (() => { const m = typeof document !== 'undefined' ? document.querySelector<HTMLMetaElement>('meta[name=assets]') : null; return m?.content && !m.content.includes('{{') ? m.content : ''; })();
/** a fitted field's file (static/splats/field-<name>.bin), fetched */
export async function fetchField(name: string): Promise<ArrayBuffer> {
  const r = await fetch(`${ASSETS}field-${name}.bin`); if (!r.ok) throw new Error(`no fitted field '${name}' (${r.status})`);
  return r.arrayBuffer();
}
/** a fitted field's file into splats: a 12-byte header (discs, bytes a disc, the span of its places), then the discs */
export function fieldDrawing(file: ArrayBuffer, flat = false): Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array; feature: Uint32Array; element: Uint32Array } {
  const head = new DataView(file, 0, 12), N = head.getUint32(0, true), K = head.getUint32(4, true), SPAN = head.getFloat32(8, true);
  const B = new Uint8Array(file, 12), dv = new DataView(file, 12);
  const s = { n: N, pos: new Float32Array(N * 3), scale: new Float32Array(N * 3), rot: new Float32Array(N * 4), rgba: new Uint8Array(N * 4), mark: new Uint8Array(N), rank: new Float32Array(N), normal: new Float32Array(N * 3), feature: new Uint32Array(N), element: new Uint32Array(N) };
  const term = (b: number) => (b / 255) * (HI - LO) + LO;
  for (let i = 0; i < N; i++) {
    const o = i * K, p = [0, 1, 2].map((k) => (dv.getInt16(o + k * 2, true) / 32767) * SPAN), n = unOct(B[o + 6], B[o + 7]), sz = B[o + 8] * 0.0002;
    const t1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), t2 = cross(n, t1);
    s.pos.set(p, i * 3); s.scale.set([sz, sz, 0.0008], i * 3); s.rot.set(quat(t1, t2, n), i * 4); s.normal.set(n, i * 3);
    s.rgba.set([INK[0], INK[1], INK[2], 255], i * 4); s.mark[i] = FIELD_KIND; s.rank[i] = 1;
    const c = flat ? [term(B[o + 18]), 0, 0, 0, 0, 0, 0, 0, 0] : Array.from(B.subarray(o + 9, o + 18), term);
    s.feature[i] = (q(c[0], 8) | (q(c[1], 8) << 8) | (q(c[2], 8) << 16) | (q(c[3], 8) << 24)) >>> 0;
    s.element[i] = (q(c[4], 6) | (q(c[5], 6) << 6) | (q(c[6], 6) << 12) | (q(c[7], 6) << 18) | (q(c[8], 6) << 24)) >>> 0;
  }
  return s;
}
const unOct = (a: number, b: number) => { let x = (a / 255) * 2 - 1, y = (b / 255) * 2 - 1; const z = 1 - Math.abs(x) - Math.abs(y); if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); } return norm([x, y, z]); };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function quat(x: number[], y: number[], z: number[]): number[] {
  const tr = x[0] + y[1] + z[2];
  if (tr > 0) { const w = Math.sqrt(tr + 1) * 2; return [w / 4, (y[2] - z[1]) / w, (z[0] - x[2]) / w, (x[1] - y[0]) / w]; }
  if (x[0] > y[1] && x[0] > z[2]) { const w = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2; return [(y[2] - z[1]) / w, w / 4, (y[0] + x[1]) / w, (z[0] + x[2]) / w]; }
  if (y[1] > z[2]) { const w = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2; return [(z[0] - x[2]) / w, (y[0] + x[1]) / w, w / 4, (z[1] + y[2]) / w]; }
  const w = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2; return [(x[1] - y[0]) / w, (z[0] + x[2]) / w, (z[1] + y[2]) / w, w / 4];
}
