/**
 * A captured scene drawn in ink (`?scene=plush&ink`, or the *ink* button): the scene's own splats made into a drawing,
 * not strokes laid over it. Every splat stays where it was captured, its shape and opacity its own; what changes is what
 * it means.
 *
 * - **body**: each splat in the paper's colour, at its own opacity, always kept. The scene still hides its own far side,
 *   so the drawing is opaque where the thing is, and blank paper where it's lit.
 * - **silhouette**: each flat splat (a disc: its smallest axis well under its middle one) also as ink, shown only from
 *   where it's near edge-on (mark kind 9, decided in the shader from its own normal, every frame). A disc seen edge-on is
 *   already a short line, and on a smooth surface the discs that are edge-on from the eye are the ones on its outline:
 *   the contour comes out of the field itself, from any view, with nothing traced. Its paper body steps aside at the
 *   same angles (kind 10), so the line isn't covered by its own disc.
 * - **tone**: each splat darker than the scene's paper level, or darker than its neighbours (a crease, a cast shadow, a
 *   printed pattern), also as ink, its opacity in a few steps of darkness, ranked by darkness: so the detail slider
 *   develops the drawing from its darkest masses to its half-tones, the outline throughout.
 */
import { bounds, type Splats } from './format';

const PAPER = [239, 231, 216], INK = [36, 31, 27];
export const INK_KIND = { body: 0, bodyFlat: 10, silhouette: 9, tone: 2 } as const;
export type InkDrawing = Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array; support: Uint8Array };
export interface InkStats { source: number; kept: number; flat: number; toned: number; marks: number; paper: number; ms: number }

export function inkScene(src: Splats, o: { steps?: number } = {}): { drawing: InkDrawing; stats: InkStats } {
  const t0 = performance.now(), steps = o.steps ?? 4, n0 = src.n;
  // ─── which splats: opaque enough, not giant (a capture's floaters), within the scene's body ───
  const maxS = new Float32Array(n0);
  for (let i = 0; i < n0; i++) maxS[i] = Math.max(src.scale[i * 3], src.scale[i * 3 + 1], src.scale[i * 3 + 2]);
  const sorted = Float32Array.from(maxS).sort(), p99 = sorted[Math.floor(n0 * 0.99)], med = sorted[Math.floor(n0 * 0.5)];
  const { centre: C, radius } = bounds(src);
  const keep: number[] = [];
  for (let i = 0; i < n0; i++) {
    if (src.rgba[i * 4 + 3] < 50 || maxS[i] > p99) continue;
    if (Math.hypot(src.pos[i * 3] - C[0], src.pos[i * 3 + 1] - C[1], src.pos[i * 3 + 2] - C[2]) > radius * 1.6) continue;
    keep.push(i);
  }
  const N = keep.length;
  // ─── each splat's lightness; the paper level (most of the lit surface) and the darkest ───
  const L = new Float32Array(N);
  keep.forEach((i, k) => { L[k] = (0.299 * src.rgba[i * 4] + 0.587 * src.rgba[i * 4 + 1] + 0.114 * src.rgba[i * 4 + 2]) / 255; });
  const Ls = Float32Array.from(L).sort(), Lp = Ls[Math.floor(N * 0.7)], Ld = Ls[Math.floor(N * 0.04)];
  // ─── its neighbours' lightness (a coarse grid's mean round it), so what's darker than its surroundings is inked ───
  const cell = Math.max(med * 6, radius / 120), grid = new Map<string, [number, number]>();
  const cellOf = (i: number) => [Math.floor(src.pos[i * 3] / cell), Math.floor(src.pos[i * 3 + 1] / cell), Math.floor(src.pos[i * 3 + 2] / cell)];
  keep.forEach((i, k) => { const key = cellOf(i).join(','), g = grid.get(key), w = src.rgba[i * 4 + 3]; if (g) { g[0] += L[k] * w; g[1] += w; } else grid.set(key, [L[k] * w, w]); });
  const around = (i: number) => { const [a, b, c] = cellOf(i); let s = 0, w = 0; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) { const g = grid.get(`${a + x},${b + y},${c + z}`); if (g) { s += g[0]; w += g[1]; } } return w ? s / w : 0; };

  // ─── each splat's normal (its smallest axis) and whether it's a disc ───
  const normal = new Float32Array(N * 3), flat = new Uint8Array(N), size = new Float32Array(N);
  keep.forEach((i, k) => {
    const sx = src.scale[i * 3], sy = src.scale[i * 3 + 1], sz = src.scale[i * 3 + 2], s = [sx, sy, sz].sort((p, q) => p - q);
    const ax = sx <= sy && sx <= sz ? 0 : sy <= sz ? 1 : 2;
    const w = src.rot[i * 4], x = src.rot[i * 4 + 1], y = src.rot[i * 4 + 2], z = src.rot[i * 4 + 3];
    const col = ax === 0 ? [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)] : ax === 1 ? [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)] : [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    const l = Math.hypot(col[0], col[1], col[2]) || 1;
    normal.set([col[0] / l, col[1] / l, col[2] / l], k * 3);
    flat[k] = s[0] < 0.3 * s[1] && src.rgba[i * 4 + 3] > 120 ? 1 : 0;
    size[k] = s[1] * s[2];
  });
  const sz = Float32Array.from(size).sort(), sizeRank = (v: number) => { let lo = 0, hi = N - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (sz[m] < v) lo = m + 1; else hi = m; } return lo / N; };

  // ─── the marks ───
  const tone = new Float32Array(N);
  let nFlat = 0, nTone = 0;
  for (let k = 0; k < N; k++) {
    const i = keep[k], g = Math.max(0, Math.min(1, (Lp - L[k]) / Math.max(0.05, Lp - Ld))), c = Math.max(0, Math.min(1, (around(i) - L[k]) * 4));
    tone[k] = Math.max(g ** 1.2, 0.8 * c);
    if (tone[k] > 0.12) nTone++;
    if (flat[k]) nFlat++;
  }
  const M = N + nFlat + nTone;
  const out: InkDrawing = { n: M, pos: new Float32Array(M * 3), scale: new Float32Array(M * 3), rot: new Float32Array(M * 4), rgba: new Uint8Array(M * 4), mark: new Uint8Array(M), rank: new Float32Array(M), normal: new Float32Array(M * 3), support: new Uint8Array(M) };
  let m = 0;
  const put = (k: number, kind: number, rgb: number[], a: number, rank: number, shrink = 1) => {
    const i = keep[k];
    out.pos.set(src.pos.subarray(i * 3, i * 3 + 3), m * 3);
    out.scale.set([src.scale[i * 3] * shrink, src.scale[i * 3 + 1] * shrink, src.scale[i * 3 + 2] * shrink], m * 3);
    out.rot.set(src.rot.subarray(i * 4, i * 4 + 4), m * 4);
    out.rgba.set([rgb[0], rgb[1], rgb[2], Math.round(Math.max(0, Math.min(1, a)) * 255)], m * 4);
    out.mark[m] = kind; out.rank[m] = Math.max(0, Math.min(1, rank)); out.normal.set(normal.subarray(k * 3, k * 3 + 3), m * 3);
    m++;
  };
  // (the bodies first, the ink after, so where the sort ties ink is drawn over paper)
  for (let k = 0; k < N; k++) put(k, flat[k] ? INK_KIND.bodyFlat : INK_KIND.body, PAPER, src.rgba[keep[k] * 4 + 3] / 255, 1);
  for (let k = 0; k < N; k++) {
    if (flat[k]) put(k, INK_KIND.silhouette, INK, 0.9, 0.3 + 0.65 * sizeRank(size[k]));
    if (tone[k] > 0.12) { const q = Math.ceil(tone[k] * steps) / steps; put(k, INK_KIND.tone, INK, (src.rgba[keep[k] * 4 + 3] / 255) * (0.1 + 0.6 * q), 0.15 + 0.8 * tone[k], 0.92); }
  }
  return { drawing: out, stats: { source: n0, kept: N, flat: nFlat, toned: nTone, marks: M, paper: +Lp.toFixed(2), ms: Math.round(performance.now() - t0) } };
}
