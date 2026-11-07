/**
 * Mist: does a compact spatial asset (splats) plus a compact learned lighting function keep more of an expensive
 * scene's behaviour, within a phone's budget? (After Charles Grassi's "Neural Shaders, Explained With Clouds": a tiny
 * network estimating the light a cloud scatters toward the camera from nearby density at several scales, density toward
 * the sun, and the view angle, while the renderer still handles visibility and accumulation.)
 *
 * The scene: a bank of mist between bamboo stems, lit by a moving sun. Its density is procedural (`density`: noise
 * shaped into a low bank, the stems opaque columns in it, so they shadow it).
 *
 * The **reference** (`reference`), the expensive light at a point toward the eye: the sun's transmittance marched
 * through the density (48 steps), single scattering with a forward-scattering phase, multiple scattering approximated by
 * octaves of the same integral at falling extinction and anisotropy (after Wrenninge), and sky light from six
 * directions over the hemisphere, each marched (24 steps). About 200 density evaluations a point.
 *
 * The mist's **splats** are the same for every method: positions where the mist is, sized and made opaque by its
 * density. What changes is where each splat's brightness comes from:
 * - **reference**: the expensive model, per splat, on the CPU (slow to update: the truth to compare against);
 * - **baked**: the reference under one sun and view, then frozen (what ordinary splats store);
 * - **analytic**: a hand-written formula from cheap features (Beer–Lambert toward the sun, the phase, an ambient term);
 * - **neural**: a tiny network (13 → 16 → 16 → 2, 556 numbers) from the same cheap features, trained offline against
 *   the reference (devtools/splats-mist-train.mjs), evaluated per splat in the shader.
 *
 * The **cheap features** follow Grassi's (`features`, and the same in render.ts's shader): one coarse density grid
 * (48×24×32) and its mip pyramid (six levels), read for the mean density round the splat at six scales, the mean density
 * toward the sun at the same six scales (each level read at its own distance, so the reads tile the way out like a cone),
 * and the cosine between the view and the sun: 13 inputs, 12 reads. The network's recipe follows his too: squared ReLU
 * in the hidden layers, squared outputs (the sun's light and the sky's, separately), fitted to the light itself
 * (untransformed), on points where a camera's rays first meet the mist. The pyramid's sampled by hand (trilinear on exact
 * texels of a level) so the CPU and the GPU agree.
 */
import { stroke, wash, group, deposit, cylinderRegion, type Element, type V } from './brush';
import { octBytes } from './stone';
import { alloc, type Splats } from './format';

// ─── the density ───
const hash = (x: number, y: number, z: number, s: number) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x: number, y: number, z: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let c = 0; c < 8; c++) { const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2; r += hash(xi + dx, yi + dy, zi + dz, s) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w); }
  return r;
}
const fbm = (x: number, y: number, z: number, s: number) => { let a = 0.5, f = 1, t = 0; for (let o = 0; o < 4; o++) { t += a * vnoise(x * f, y * f, z * f, s + o * 17); a *= 0.5; f *= 2.03; } return t; };

/** the box the mist lives in */
export const BOX = { x0: -2, x1: 2, y0: 0, y1: 1.6, z0: -1.2, z1: 1.2 };
export interface MistShape { seed: number; stems: Array<[number, number, number]> }
/** a mist bank: its noise seed, and the bamboo stems standing in it (x, z, radius) */
export function mistShape(seed: number): MistShape {
  const stems: Array<[number, number, number]> = [];
  for (let k = 0; k < 9; k++) stems.push([-1.7 + 3.4 * hash(k, 1, 2, seed), -0.9 + 1.8 * hash(k, 3, 4, seed), 0.045 + 0.03 * hash(k, 5, 6, seed)]);
  return { seed, stems };
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** the density at a point: a low bank of noise, thinning upward and to the box's sides; the stems opaque in it */
export function density(m: MistShape, x: number, y: number, z: number): number {
  for (const [sx, sz, sr] of m.stems) if ((x - sx) ** 2 + (z - sz) ** 2 < sr * sr && y < BOX.y1) return 40;
  const n = fbm(x * 1.1 + m.seed * 7.3, y * 1.6, z * 1.1 - m.seed * 3.1, m.seed);
  const height = smooth(1.15, 0.2, y) * smooth(-0.02, 0.12, y), sides = smooth(2.0, 1.4, Math.abs(x)) * smooth(1.2, 0.8, Math.abs(z));
  return Math.max(0, (n - 0.42) * 6) * height * sides;
}

// ─── the expensive reference ───
/** extinction per unit density, the sun's and the sky's light */
export const SIGMA = 3.2, SUN = 1.6, SKY = 0.45;
const hg = (c: number, g: number) => (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * c, 1.5));
/** the optical depth from a point to the box's edge along a direction, marched */
function depthAlong(m: MistShape, p: V, d: V, steps: number): number {
  // (how far to the box's edge, or 2.4 at most)
  let tMax = 2.4;
  for (let a = 0; a < 3; a++) { const lo = [BOX.x0, BOX.y0, BOX.z0][a], hi = [BOX.x1, BOX.y1, BOX.z1][a]; if (d[a] > 1e-6) tMax = Math.min(tMax, (hi - p[a]) / d[a]); else if (d[a] < -1e-6) tMax = Math.min(tMax, (lo - p[a]) / d[a]); }
  if (tMax <= 0) return 0;
  const dt = tMax / steps; let tau = 0;
  for (let k = 0; k < steps; k++) { const t = (k + 0.5) * dt; tau += density(m, p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t) * dt; }
  return tau;
}
const SKY_DIRS: V[] = [[0, 1, 0], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7], [0.5, 0.4, 0.77]].map(([a, b, c]) => { const l = Math.hypot(a, b, c); return [a / l, b / l, c / l] as V; });
/** the sun-dependent part of the reference at a point (independent of the view): its sun optical depth, and its sky light */
export function referenceAt(m: MistShape, p: V, sun: V): { tau: number; sky: number } {
  const tau = depthAlong(m, p, sun, 48);
  let sky = 0; for (const d of SKY_DIRS) sky += Math.exp(-SIGMA * depthAlong(m, p, d, 24)); sky /= SKY_DIRS.length;
  return { tau, sky };
}
/** the reference light toward the eye, from that and the cosine between the view (toward the eye) and the sun */
export function referenceParts(r: { tau: number; sky: number }, cosVS: number): [number, number] {
  // (the phase: light from the sun scattered toward the eye, the angle between them; octaves of multiple scattering)
  let ms = 0, a = 1, b = 1, c = 1;
  for (let o = 0; o < 4; o++) { ms += a * Math.exp(-SIGMA * b * r.tau) * hg(cosVS, 0.6 * c); a *= 0.5; b *= 0.45; c *= 0.5; }
  return [SUN * ms * 4 * Math.PI * 0.12, SKY * r.sky];
}
/** the sun's part and the sky's together */
export const referenceLight = (r: { tau: number; sky: number }, cosVS: number): number => { const [a, b] = referenceParts(r, cosVS); return a + b; };

// ─── the density pyramid and the cheap features ───
export const GRID = { nx: 48, ny: 24, nz: 32 };
/** the pyramid's levels: the base grid, then each half the last (to one texel), as a GPU's mip chain would be */
export const LEVELS = 6;
export interface Mips { dims: Array<[number, number, number]>; data: Float32Array[] }
export const mipDims = (): Array<[number, number, number]> => { const d: Array<[number, number, number]> = [[GRID.nx, GRID.ny, GRID.nz]]; while (d.length < LEVELS) { const [a, b, c] = d[d.length - 1]; d.push([Math.max(1, a >> 1), Math.max(1, b >> 1), Math.max(1, c >> 1)]); } return d; };
/** the density on a coarse grid (each cell the mean of a few points in it), and its mip pyramid: each texel of a level
 * the mean of the texels under it in the one below, so level L's texel is the mean density of a block 2^L cells wide */
export function densityGrid(m: MistShape): Mips {
  const dims = mipDims(), [nx, ny, nz] = dims[0], base = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const [x, y, z] = cellPos(i, j, k);
    // (so thin stems still register)
    let s = 0; for (let q = 0; q < 4; q++) s += Math.min(8, density(m, x + ((q & 1) - 0.5) * 0.04, y, z + ((q >> 1) - 0.5) * 0.04));
    base[(k * ny + j) * nx + i] = s / 4;
  }
  const data = [base];
  for (let L = 1; L < LEVELS; L++) {
    const [ax, ay, az] = dims[L - 1], [bx, by, bz] = dims[L], src = data[L - 1], out = new Float32Array(bx * by * bz);
    const span = (i: number, a: number, b: number): [number, number] => [Math.floor((i * a) / b), Math.max(Math.floor((i * a) / b) + 1, Math.ceil(((i + 1) * a) / b))];
    for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
      const [i0, i1] = span(i, ax, bx), [j0, j1] = span(j, ay, by), [k0, k1] = span(k, az, bz); let s = 0, c = 0;
      for (let kk = k0; kk < k1; kk++) for (let jj = j0; jj < j1; jj++) for (let ii = i0; ii < i1; ii++) { s += src[(kk * ay + jj) * ax + ii]; c++; }
      out[(k * by + j) * bx + i] = s / c;
    }
    data.push(out);
  }
  return { dims, data };
}
const cellPos = (i: number, j: number, k: number): V => [BOX.x0 + ((i + 0.5) / GRID.nx) * (BOX.x1 - BOX.x0), BOX.y0 + ((j + 0.5) / GRID.ny) * (BOX.y1 - BOX.y0), BOX.z0 + ((k + 0.5) / GRID.nz) * (BOX.z1 - BOX.z0)];
/** one level of the pyramid sampled at a point, trilinear on exact texels, zero outside the box (as the shader does it) */
export function sampleGrid(g: Mips, p: V, L: number): number {
  const [nx, ny, nz] = g.dims[L], d = g.data[L];
  const fx = ((p[0] - BOX.x0) / (BOX.x1 - BOX.x0)) * nx - 0.5, fy = ((p[1] - BOX.y0) / (BOX.y1 - BOX.y0)) * ny - 0.5, fz = ((p[2] - BOX.z0) / (BOX.z1 - BOX.z0)) * nz - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), tx = fx - x0, ty = fy - y0, tz = fz - z0;
  const at = (i: number, j: number, k: number) => { if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0; return d[(k * ny + j) * nx + i]; };
  let r = 0;
  for (let c = 0; c < 8; c++) { const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2; r += at(x0 + dx, y0 + dy, z0 + dz) * (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz); }
  return r;
}
/** how far toward the sun each level is read: its texel's width (about), so the six reads tile the way out like a cone */
export const SUN_TAPS = Array.from({ length: LEVELS }, (_, L) => +(((BOX.x1 - BOX.x0) / GRID.nx) * 2 ** L).toFixed(4));
/**
 * The cheap features of a point for a sun and a view (toward the eye), as Grassi's: the mean density round the point at
 * six scales (one pyramid read each), the mean density toward the sun at the same six scales (one read each, at that
 * scale's distance), and the cosine between the view and the sun. 13 numbers, 12 reads.
 */
export function features(g: Mips, p: V, sun: V, view: V): number[] {
  const f: number[] = [];
  for (let L = 0; L < LEVELS; L++) f.push(sampleGrid(g, p, L));
  for (let L = 0; L < LEVELS; L++) { const d = SUN_TAPS[L]; f.push(sampleGrid(g, [p[0] + sun[0] * d, p[1] + sun[1] * d, p[2] + sun[2] * d], L)); }
  f.push(view[0] * sun[0] + view[1] * sun[1] + view[2] * sun[2]);
  return f;
}
/** the hand-written lighting's two terms from the features: Beer–Lambert toward the sun from its six reads (each covering
 * about its distance, the cones overlapping by half) with the phase, and an ambient falling with the density round it */
export function analyticTerms(f: number[]): [number, number] {
  let tau = 0; for (let L = 0; L < LEVELS; L++) tau += f[LEVELS + L] * SUN_TAPS[L] * 0.5;
  return [Math.exp(-SIGMA * tau) * hg(f[2 * LEVELS], 0.6) * 4 * Math.PI, Math.exp(-1.2 * f[3])];
}
/** the hand-written lighting (its two weights fitted to the reference on the training set, so it's a fair baseline) */
export function analytic(f: number[], k: { a: number; b: number }): number { const [s, m] = analyticTerms(f); return k.a * s + k.b * m; }

// ─── the tiny network ───
/** weights in order w1 b1 w2 b2 w3 b3 mean std; w3 is OUT×H, b3 OUT */
export interface Net { w1: number[]; b1: number[]; w2: number[]; b2: number[]; w3: number[]; b3: number[]; mean: number[]; std: number[] }
/** 13 → 16 → 16 → 2 (the sun's light and the sky's, sharing the hidden layers) */
export const IN = 13, H = 16, OUT = 2, NET_SIZE = IN * H + H + H * H + H + OUT * H + OUT + 2 * IN;
/** the largest light an output gives (squared outputs can't go negative; this caps them) */
export const OUT_MAX = 16;
/** the network's two lights (inputs normalised; squared ReLU, squared ReLU, then each output squared: no creases, no dead
 * outputs, and it predicts the light itself, untransformed) */
export function netParts(n: Net, f: number[]): number[] {
  const x = f.map((v, i) => (v - n.mean[i]) / n.std[i]), h1 = new Array(H), h2 = new Array(H);
  for (let j = 0; j < H; j++) { let s = n.b1[j]; for (let i = 0; i < IN; i++) s += n.w1[j * IN + i] * x[i]; h1[j] = s > 0 ? s * s : 0; }
  for (let j = 0; j < H; j++) { let s = n.b2[j]; for (let i = 0; i < H; i++) s += n.w2[j * H + i] * h1[i]; h2[j] = s > 0 ? s * s : 0; }
  const o: number[] = [];
  for (let k = 0; k < OUT; k++) { let s = n.b3[k]; for (let i = 0; i < H; i++) s += n.w3[k * H + i] * h2[i]; o.push(Math.min(OUT_MAX, s * s)); }
  return o;
}
export const netLight = (n: Net, f: number[]): number => netParts(n, f).reduce((a, b) => a + b, 0);

/** where a camera ray first collides with the mist: from outside the box along -view (view points toward the eye),
 * through the jittered spot (u, v) across the box; a free path drawn from the transmittance; null if it passes through */
export function cameraHit(m: MistShape, view: V, u: number, v: number, xi: number): V | null {
  const up: V = Math.abs(view[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const r = norm3(cross(up, view)), s = cross(view, r), c: V = [0, 0.7, 0];
  const o: V = [c[0] + view[0] * 3 + (r[0] * u * 2.2 + s[0] * v * 0.9), c[1] + view[1] * 3 + (r[1] * u * 2.2 + s[1] * v * 0.9), c[2] + view[2] * 3 + (r[2] * u * 2.2 + s[2] * v * 0.9)];
  const need = -Math.log(Math.max(1e-6, xi)), dt = 0.02; let tau = 0;
  for (let t = 0; t < 6; t += dt) {
    const p: V = [o[0] - view[0] * t, o[1] - view[1] * t, o[2] - view[2] * t];
    if (p[0] < BOX.x0 || p[0] > BOX.x1 || p[1] < BOX.y0 || p[1] > BOX.y1 || p[2] < BOX.z0 || p[2] > BOX.z1) continue;
    const d = density(m, ...p); if (d >= 40) return null;
    tau += SIGMA * d * dt; if (tau >= need) return p;
  }
  return null;
}
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// ─── the splats ───
/** the sun's direction from its azimuth and elevation (radians) */
export const sunDir = (az: number, el: number): V => [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
/** where the mist's splats are: drawn where it's dense, sized by the spacing, as opaque as its density makes them */
export function mistPoints(m: MistShape, count = 14000, seed = 3): Array<{ p: V; size: number; alpha: number }> {
  let r = seed * 9973 + 1; const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  const out: Array<{ p: V; size: number; alpha: number }> = [];
  for (let k = 0; out.length < count && k < count * 60; k++) {
    const p: V = [BOX.x0 + rnd() * (BOX.x1 - BOX.x0), BOX.y0 + rnd() * 1.2, BOX.z0 + rnd() * (BOX.z1 - BOX.z0)], d = density(m, ...p);
    if (d >= 40 || rnd() > Math.min(1, d / 1.2)) continue;
    const size = 0.05 + 0.04 * rnd();
    out.push({ p, size, alpha: Math.min(0.55, 1 - Math.exp(-SIGMA * d * size * 1.4)) });
  }
  return out;
}

export interface MistScene { shape: MistShape; grid: Mips; points: Array<{ p: V; size: number; alpha: number }>; drawing: Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array; feature: Uint8Array }; stems: number; occluder: Float32Array }
/** the mist marks' kind (render.ts lights them by the chosen method) */
export const LIT = 8;
/**
 * The scene: the mist's splats (kind LIT, coloured later by the method), and the bamboo stems drawn with the brushes
 * (silhouette strokes up their sides, nodes round them), and the stems' cylinders for the occluder.
 */
export function mistScene(seed: number, count = 14000): MistScene {
  const shape = mistShape(seed), grid = densityGrid(shape), points = mistPoints(shape, count);
  const els: Element[] = [];
  for (const [x, z, rr] of shape.stems) {
    const SIDES = 14, h = 1.75;
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2, d = (Math.PI * 2) / SIDES, n1: V = [Math.cos(a - d / 2), 0, Math.sin(a - d / 2)], n2: V = [Math.cos(a + d / 2), 0, Math.sin(a + d / 2)];
      const pts: V[] = []; for (let y = 0.01; y <= h; y += 0.04) pts.push([x + Math.cos(a) * rr, y, z + Math.sin(a) * rr]);
      const e = stroke({ pts, normals: pts.map(() => n1) }, { width: 0.006, taper: [0.02, 0.05] }, { mark: 4, profile: n2, colour: [230, 226, 214], alpha: 0.85 });
      els.push(...group(0.95, e));
    }
    for (let ny = 0.35; ny < h; ny += 0.36 + 0.05 * Math.sin(x * 9)) {
      const pts: V[] = [], ns: V[] = []; for (let k = 0; k <= 36; k++) { const a = (k / 36) * Math.PI * 2; pts.push([x + Math.cos(a) * (rr + 0.003), ny, z + Math.sin(a) * (rr + 0.003)]); ns.push([Math.cos(a), 0, Math.sin(a)]); }
      els.push(...group(0.9, stroke({ pts, normals: ns }, { width: 0.006, taper: [0.01, 0.01] }, { colour: [230, 226, 214], alpha: 0.85 })));
    }
    void wash; void cylinderRegion;
  }
  let rs = 5; const rnd = () => ((rs = (rs * 48271) % 2147483647) / 2147483647);
  const deps = els.flatMap((e) => deposit(e, rnd));
  const n = points.length + deps.length;
  const s = Object.assign(alloc(n), { mark: new Uint8Array(n), rank: new Float32Array(n), normal: new Float32Array(n * 3), feature: new Uint8Array(n) });
  points.forEach((pt, i) => { s.pos.set(pt.p, i * 3); s.scale.set([pt.size, pt.size, pt.size], i * 3); s.rot.set([1, 0, 0, 0], i * 4); s.rgba.set([255, 255, 255, Math.round(pt.alpha * 255)], i * 4); s.mark[i] = LIT; s.rank[i] = 1; s.normal.set([0, 1, 0], i * 3); });
  deps.forEach((d, j) => {
    const i = points.length + j; s.pos.set(d.p, i * 3); s.scale.set(d.s, i * 3); s.rot.set(quat(d.ax), i * 4);
    const col = d.profile ? [...octBytes(d.profile), 0] : d.c; s.rgba.set([col[0], col[1], col[2], Math.round(Math.min(1, d.a) * 255)], i * 4);
    s.mark[i] = d.mark; s.rank[i] = Math.max(0, Math.min(1, d.rank)); s.normal.set(d.n1 ?? d.ax[2], i * 3);
  });
  const tris: number[] = [];
  for (const [x, z, rr] of shape.stems) for (let k = 0; k < 14; k++) { const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2, r2 = rr * 0.95, h = 1.75; const A: V = [x + Math.cos(a0) * r2, 0, z + Math.sin(a0) * r2], B: V = [x + Math.cos(a1) * r2, 0, z + Math.sin(a1) * r2]; tris.push(...A, ...B, B[0], h, B[2], ...A, B[0], h, B[2], A[0], h, A[2]); }
  return { shape, grid, points, drawing: s, stems: deps.length, occluder: new Float32Array(tris) };
}
/** each mist splat's brightness by a method on the CPU: the reference (slow), or baked (the reference at one sun and view) */
export function referenceColours(sc: MistScene, sun: V, eye: V): Float32Array {
  const out = new Float32Array(sc.points.length);
  sc.points.forEach((pt, i) => { const v = norm3(sub3(eye, pt.p)), r = referenceAt(sc.shape, pt.p, sun); out[i] = referenceLight(r, v[0] * sun[0] + v[1] * sun[1] + v[2] * sun[2]); });
  return out;
}
const sub3 = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function quat([x, y, z]: [V, V, V]): [number, number, number, number] {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2], tr = m00 + m11 + m22;
  let w, a, b, c;
  if (tr > 0) { const q = Math.sqrt(tr + 1) * 2; w = q / 4; a = (m21 - m12) / q; b = (m02 - m20) / q; c = (m10 - m01) / q; }
  else if (m00 > m11 && m00 > m22) { const q = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / q; a = q / 4; b = (m01 + m10) / q; c = (m02 + m20) / q; }
  else if (m11 > m22) { const q = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / q; a = (m01 + m10) / q; b = q / 4; c = (m12 + m21) / q; }
  else { const q = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / q; a = (m02 + m20) / q; b = (m12 + m21) / q; c = q / 4; }
  const l = Math.hypot(w, a, b, c); return [w / l, a / l, b / l, c / l];
}
