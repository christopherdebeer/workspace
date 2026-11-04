/**
 * The boulder's one shape (an icosphere pushed in and out, roughened and cleaved), shared: the renderer draws every
 * stone as it, scaled and turned, and the run stands on its top, so the crown the eye reads is the crown underfoot.
 */
export const LUMP_SEED = 1.7;
export function lumpMesh(seed: number) {
  // (an icosphere, three subdivisions, pushed in and out, and broken: a boulder)
  const t = (1 + Math.sqrt(5)) / 2;
  let V: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < 3; s++) {
    const mid = new Map<string, number>(), m = (a: number, b: number) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!mid.has(k)) { const p = V[a].map((q, i) => (q + V[b][i]) / 2), l = Math.hypot(...p); V.push(p.map((q) => q / l)); mid.set(k, V.length - 1); } return mid.get(k)!; };
    const G: number[][] = [];
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); G.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = G;
  }
  const h = (p: number[]) => { const s = Math.sin(p[0] * 3.1 + seed) * Math.sin(p[1] * 2.7 + seed * 2) * Math.sin(p[2] * 3.3 + seed * 3); return 1 + 0.16 * s + 0.08 * Math.sin(p[0] * 7 + p[2] * 5 + seed); };
  // (weathered: a finer roughness over the swell)
  const rough = (p: number[]) => 0.035 * Math.sin(p[0] * 13 + seed * 5) * Math.sin(p[1] * 11 - seed) * Math.sin(p[2] * 12 + seed * 2);
  V = V.map((p) => { const k = h(p) + rough(p); return [p[0] * k, Math.max(-0.3, p[1]) * k, p[2] * k]; });
  // (and broken: a few planes cleave it, so it has flat fractured faces and edges, not only swells)
  for (let c = 0; c < 3; c++) {
    const a = seed * 2.3 + c * 2.1, e = 0.5 - 0.35 * Math.sin(seed * 1.7 + c * 4.1), nx = Math.cos(a) * Math.cos(e), ny = Math.sin(e) * 0.8, nz = Math.sin(a) * Math.cos(e), nl = Math.hypot(nx, ny, nz);
    const d = 0.68 + 0.12 * Math.sin(seed * 3.3 + c);
    V = V.map((p) => { const t = (p[0] * nx + p[1] * ny + p[2] * nz) / nl - d; return t > 0 ? [p[0] - (nx / nl) * t, p[1] - (ny / nl) * t, p[2] - (nz / nl) * t] : p; });
  }
  // (shaded by its shape: each corner's normal the faces' round it, area-weighted, so swells are round and the cleaved
  // faces flat)
  const VN = V.map(() => [0, 0, 0]);
  const fn = F.map(([a, b, c]) => { const A = V[a], u = V[b].map((q, i) => q - A[i]), w = V[c].map((q, i) => q - A[i]); return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; });
  F.forEach((f, k) => { for (const v of f) for (let i = 0; i < 3; i++) VN[v][i] += fn[k][i]; });
  const P: number[] = [];
  for (const f of F) for (const v of f) { const n = VN[v], l = Math.hypot(...n) || 1; P.push(...V[v], n[0] / l, n[1] / l, n[2] / l); }
  return new Float32Array(P);
}

/** the lump's top, seen from above: its highest point over a grid on (x, z) in [-LUMP_R, LUMP_R], NaN off it */
export const LUMP_R = 1.45, LUMP_G = 56;
let topGrid: Float32Array | null = null;
export function lumpTop(): Float32Array {
  if (topGrid) return topGrid;
  const P = lumpMesh(LUMP_SEED), G = LUMP_G, T = new Float32Array(G * G).fill(NaN), cell = (2 * LUMP_R) / G;
  for (let f = 0; f < P.length; f += 18) {
    const A = [P[f], P[f + 1], P[f + 2]], B = [P[f + 6], P[f + 7], P[f + 8]], C = [P[f + 12], P[f + 13], P[f + 14]];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8 - i; j++) {
      const u = i / 8, v = j / 8, w = 1 - u - v, x = A[0] * w + B[0] * u + C[0] * v, y = A[1] * w + B[1] * u + C[1] * v, z = A[2] * w + B[2] * u + C[2] * v;
      const gi = Math.floor((x + LUMP_R) / cell), gj = Math.floor((z + LUMP_R) / cell);
      if (gi < 0 || gj < 0 || gi >= G || gj >= G) continue;
      const k = gi + gj * G; if (!(T[k] >= y)) T[k] = y;
    }
  }
  return (topGrid = T);
}
/** the lump's top at local (x, z) (unit size), or NaN off its edge */
export function lumpTopAt(x: number, z: number): number {
  const T = lumpTop(), G = LUMP_G, cell = (2 * LUMP_R) / G, fx = (x + LUMP_R) / cell - 0.5, fz = (z + LUMP_R) / cell - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  let s = 0, w = 0;
  for (const [a, b, k] of [[i, j, (1 - u) * (1 - v)], [i + 1, j, u * (1 - v)], [i, j + 1, (1 - u) * v], [i + 1, j + 1, u * v]] as const) {
    if (a < 0 || b < 0 || a >= G || b >= G) continue;
    const y = T[a + b * G]; if (Number.isNaN(y) || k <= 0) continue; s += y * k; w += k;
  }
  return w > 0.35 ? s / w : NaN;
}
