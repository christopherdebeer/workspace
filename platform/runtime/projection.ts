/**
 * 2D projection of embedding vectors (ADR-0047 stage 2) — a *semantic* layout
 * for the home graph: a fact's position becomes its place in meaning-space, not
 * a force-of-edges equilibrium. Pure and DETERMINISTIC (fixed init, no RNG), so
 * the same vectors always yield the same map and a client can trust the coords.
 *
 * Method: PCA to the top two principal components via power iteration WITHOUT
 * forming the d×d covariance matrix (d = 1024 for Titan) — iterate v ← Xᵀ(X v),
 * O(n·d) per step. PCA is linear, so it smears the fine-grained clusters a UMAP
 * would separate, but it is cheap enough to run inline in a command and captures
 * the dominant axes of variation. UMAP is the intended upgrade behind the SAME
 * seam (a function from vectors to coords) — this is the honest, dependency-free
 * first cut that proves the pipeline end to end.
 */

/** Where the 2D/3D semantic layout is stored (ADR-0047 stage 2): a single owner
 *  fact the home graph peeks to place nodes in meaning-space. `_home/*` is
 *  plumbing (owner-only, filtered out of the node band itself). Shared here
 *  (not just in commands-search.ts) so the live vector-indexer can read/patch
 *  it too (ADR-0047 stage 3's incremental per-fact projection). */
export const LAYOUT_KEY = '_home/embed2d';

export interface Projected {
  keys: string[];
  /** One [x, y] per key, in the same order. */
  coords: Array<[number, number]>;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function normalizeInPlace(v: Float64Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
}

/** A deterministic unit seed vector (no RNG — reproducible layouts across runs). */
function seedVector(d: number, salt: number): Float64Array {
  const v = new Float64Array(d);
  // An irrational-stride sinusoid: spreads energy across all dimensions without
  // aligning to any axis, so power iteration converges to the real component.
  for (let i = 0; i < d; i++) v[i] = Math.sin((i + 1) * (salt + 1) * 0.6180339887498949);
  normalizeInPlace(v);
  return v;
}

/**
 * The top `k` principal components of the mean-centered rows `X` (n×d) by power
 * iteration. Each component is deflated (Gram–Schmidt) against the ones already
 * found, so they come back mutually orthogonal — the axes of a k-D projection.
 */
function principalComponents(X: Float64Array[], d: number, k: number, iters: number): Float64Array[] {
  const n = X.length;
  const pcs: Float64Array[] = [];
  const u = new Float64Array(n);
  for (let c = 0; c < k; c++) {
    let v = seedVector(d, c + 1);
    for (let it = 0; it < iters; it++) {
      for (let i = 0; i < n; i++) u[i] = dot(X[i], v, d); // u = X v   (length n)
      const w = new Float64Array(d);
      for (let i = 0; i < n; i++) {
        const ui = u[i], xi = X[i];
        for (let j = 0; j < d; j++) w[j] += xi[j] * ui; // w = Xᵀ u   (length d)
      }
      for (const prev of pcs) {
        const proj = dot(w, prev, d);
        for (let j = 0; j < d; j++) w[j] -= proj * prev[j]; // orthogonalize vs earlier PCs
      }
      normalizeInPlace(w);
      v = w;
    }
    pcs.push(v);
  }
  return pcs;
}

/** Project `vectors` (n×d, aligned to `keys`) onto their top-`comps` principal axes. */
export function pca(vectors: number[][], keys: string[], comps: number, opts?: { iters?: number }): { keys: string[]; coords: number[][] } {
  const { keys: kk, coords } = pcaWithBasis(vectors, keys, comps, opts);
  return { keys: kk, coords };
}

/** {@link pca}, also returning the basis (corpus mean + the principal axes
 *  themselves) it computed. The basis is what makes a projection reusable:
 *  once known, placing ONE MORE vector on the same map is a few dot products
 *  ({@link projectVector}) — no need to re-read or re-derive it over the
 *  whole index. `pca`/`pca2d` stay the coords-only convenience most callers
 *  want; this is for the (rarer) caller that needs to persist the basis. */
export function pcaWithBasis(
  vectors: number[][],
  keys: string[],
  comps: number,
  opts?: { iters?: number },
): { keys: string[]; coords: number[][]; mean: number[]; axes: number[][] } {
  const n = vectors.length;
  const d = n ? vectors[0].length : 0;
  if (n === 0 || d === 0) return { keys: [], coords: [], mean: [], axes: [] };
  const mean = new Float64Array(d);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const X: Float64Array[] = vectors.map((v) => {
    const r = new Float64Array(d);
    for (let j = 0; j < d; j++) r[j] = v[j] - mean[j];
    return r;
  });
  const pcs = principalComponents(X, d, comps, opts?.iters ?? 60);
  const coords = X.map((r) => pcs.map((pc) => dot(r, pc, d)));
  return { keys, coords, mean: Array.from(mean), axes: pcs.map((pc) => Array.from(pc)) };
}

/** Project onto the top-2 principal axes (the 2D map). */
export function pca2d(vectors: number[][], keys: string[], opts?: { iters?: number }): Projected {
  const { keys: kk, coords } = pca(vectors, keys, 2, opts);
  return { keys: kk, coords: coords.map((c) => [c[0] ?? 0, c[1] ?? 0] as [number, number]) };
}

/** The center/scale a batch of raw PCA coords was normalized with — persisting
 *  this (alongside the PCA basis) is what lets {@link projectVector} place a
 *  single new point on the SAME normalized map a batch run produced. */
export interface NormParams {
  /** Per-axis coord-space mean, subtracted before scaling. */
  center: number[];
  /** Uniform scale applied after centering (1 / the 98th-percentile radius). */
  scale: number;
}

/** The center/scale {@link normalizeCoordsN} would derive from `coords`, without
 *  applying it — split out so the batch path can persist it for reuse. */
export function computeNormParams(coords: number[][]): NormParams {
  if (!coords.length) return { center: [], scale: 1 };
  const dims = coords[0].length;
  const mean = new Array<number>(dims).fill(0);
  for (const c of coords) for (let j = 0; j < dims; j++) mean[j] += c[j];
  for (let j = 0; j < dims; j++) mean[j] /= coords.length;
  const centered = coords.map((c) => c.map((v, j) => v - mean[j]));
  const radii = centered.map((c) => Math.hypot(...c)).sort((a, b) => a - b);
  const p98 = radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.98))] || 1;
  return { center: mean, scale: p98 > 0 ? 1 / p98 : 1 };
}

/** Apply already-derived {@link NormParams} to raw coords (of any dimensionality). */
export function applyNormParams(coords: number[][], norm: NormParams): number[][] {
  return coords.map((c) => c.map((v, j) => clamp((v - (norm.center[j] ?? 0)) * norm.scale)));
}

/**
 * Center and robustly scale coords (of any dimensionality) into roughly [-1, 1] —
 * divide by the 98th-percentile radius so a few outliers don't shrink the whole
 * cloud, then clamp. All axes share the scale, so semantic distances survive.
 */
export function normalizeCoordsN(coords: number[][]): number[][] {
  if (!coords.length) return coords;
  return applyNormParams(coords, computeNormParams(coords));
}

/** 2D convenience over {@link normalizeCoordsN} (preserves the tuple type). */
export function normalizeCoords(coords: Array<[number, number]>): Array<[number, number]> {
  return normalizeCoordsN(coords) as Array<[number, number]>;
}

function clamp(v: number): number {
  return v < -1.3 ? -1.3 : v > 1.3 ? 1.3 : v;
}

/** The PCA basis a projection was computed with: the corpus mean (length `dim`)
 *  and the 3 principal axes (each length `dim`) — together with `norm`, enough
 *  to place ONE MORE vector on the exact same map via {@link projectVector},
 *  without re-reading or re-deriving it over the whole index. */
export interface PcaBasis {
  mean: number[];
  axes: [number[], number[], number[]];
}

/** The stored projection fact's value (`_home/embed2d`). Compact: coords rounded
 *  to 4 decimals. Each coord is [x, y, z] — the 2D map uses x,y and the 3D
 *  explore mode uses all three (a 2D reader simply ignores z). */
export interface ProjectionFact {
  method: 'pca';
  dim: number;
  count: number;
  generatedAt: string;
  /** key → [x, y, z], each in [-1.3, 1.3]. */
  coords: Record<string, [number, number, number]>;
  /** The basis this projection was computed with (absent on projections written
   *  before this field existed) — lets a live indexer place a newly-embedded
   *  vector on the same map incrementally. See {@link projectVector}. */
  basis?: PcaBasis;
  norm?: NormParams;
}

/** Build the storable projection fact from raw vectors (project to 3 PCs →
 *  normalize → round). Stores x,y,z so one fact serves both the 2D and 3D views.
 *  Also persists the basis (mean + axes + norm params) so a single new vector
 *  can later be placed on this SAME map via {@link projectVector}. */
export function projectionFact(vectors: number[][], keys: string[], dim: number, generatedAt: string): ProjectionFact {
  const { coords, mean, axes } = pcaWithBasis(vectors, keys, 3);
  const norm = computeNormParams(coords);
  const normed = applyNormParams(coords, norm);
  const out: Record<string, [number, number, number]> = {};
  for (let i = 0; i < keys.length; i++) {
    const c = normed[i] ?? [];
    out[keys[i]] = [round4(c[0] ?? 0), round4(c[1] ?? 0), round4(c[2] ?? 0)];
  }
  // The basis is `4 × dim` raw floats (mean + 3 axes) — at full float precision
  // that's real storage (~80KB at dim=1024) for no benefit: round6 keeps ~1e-6
  // precision (far below PCA's own iterative-approximation error) at roughly
  // half the bytes, same as coords rounding to 4dp.
  const basis: PcaBasis = {
    mean: mean.map(round6),
    axes: [(axes[0] ?? []).map(round6), (axes[1] ?? []).map(round6), (axes[2] ?? []).map(round6)],
  };
  const roundedNorm: NormParams = { center: norm.center.map(round6), scale: round6(norm.scale) };
  return { method: 'pca', dim, count: keys.length, generatedAt, coords: out, basis, norm: roundedNorm };
}

/**
 * Place ONE MORE vector on a map a batch {@link projectionFact} already
 * computed, using its persisted `basis`/`norm` — a few `dim`-length dot
 * products, no read of the rest of the index. This is what makes it possible
 * for a live per-fact indexer to keep the graph's coords fresh incrementally,
 * with the expensive whole-corpus PCA only needed for occasional basis
 * refreshes (the axes drift slowly as the corpus grows/shifts).
 */
export function projectVector(vector: number[], basis: PcaBasis, norm: NormParams): [number, number, number] {
  const d = basis.mean.length;
  const centered = new Float64Array(d);
  for (let j = 0; j < d; j++) centered[j] = vector[j] - basis.mean[j];
  const raw = basis.axes.map((axis) => dot(centered, axis, d));
  const c = applyNormParams([raw], norm)[0] ?? [];
  return [round4(c[0] ?? 0), round4(c[1] ?? 0), round4(c[2] ?? 0)];
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
