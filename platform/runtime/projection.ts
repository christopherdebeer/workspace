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
 * Top principal component of the mean-centered rows `X` (n×d) by power iteration.
 * `against`, when given, is deflated out each step (Gram–Schmidt), so the second
 * call returns a component orthogonal to the first.
 */
function principal(X: Float64Array[], d: number, iters: number, salt: number, against?: Float64Array): Float64Array {
  const n = X.length;
  let v = seedVector(d, salt);
  const u = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) u[i] = dot(X[i], v, d); // u = X v   (length n)
    const w = new Float64Array(d);
    for (let i = 0; i < n; i++) {
      const ui = u[i], xi = X[i];
      for (let j = 0; j < d; j++) w[j] += xi[j] * ui; // w = Xᵀ u   (length d)
    }
    if (against) {
      const c = dot(w, against, d);
      for (let j = 0; j < d; j++) w[j] -= c * against[j]; // orthogonalize
    }
    normalizeInPlace(w);
    v = w;
  }
  return v;
}

/** Project `vectors` (n×d, aligned to `keys`) onto their top-2 principal axes. */
export function pca2d(vectors: number[][], keys: string[], opts?: { iters?: number }): Projected {
  const n = vectors.length;
  const d = n ? vectors[0].length : 0;
  if (n === 0 || d === 0) return { keys: [], coords: [] };
  const mean = new Float64Array(d);
  for (const v of vectors) for (let j = 0; j < d; j++) mean[j] += v[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const X: Float64Array[] = vectors.map((v) => {
    const r = new Float64Array(d);
    for (let j = 0; j < d; j++) r[j] = v[j] - mean[j];
    return r;
  });
  const iters = opts?.iters ?? 60;
  const pc1 = principal(X, d, iters, 1);
  const pc2 = principal(X, d, iters, 2, pc1);
  const coords: Array<[number, number]> = X.map((r) => [dot(r, pc1, d), dot(r, pc2, d)]);
  return { keys, coords };
}

/**
 * Center and robustly scale coords into roughly [-1, 1] — divide by the
 * 98th-percentile radius so a few outliers don't shrink the whole cloud, then
 * clamp. Aspect is preserved (both axes share the scale), so semantic distances
 * survive. The client maps this unit square onto the viewport.
 */
export function normalizeCoords(coords: Array<[number, number]>): Array<[number, number]> {
  if (!coords.length) return coords;
  let mx = 0, my = 0;
  for (const [x, y] of coords) { mx += x; my += y; }
  mx /= coords.length;
  my /= coords.length;
  const centered = coords.map(([x, y]) => [x - mx, y - my] as [number, number]);
  const radii = centered.map(([x, y]) => Math.hypot(x, y)).sort((a, b) => a - b);
  const p98 = radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.98))] || 1;
  const s = p98 > 0 ? 1 / p98 : 1;
  return centered.map(([x, y]) => [clamp(x * s), clamp(y * s)] as [number, number]);
}

function clamp(v: number): number {
  return v < -1.3 ? -1.3 : v > 1.3 ? 1.3 : v;
}

/** The stored projection fact's value (`_home/embed2d`). Compact: coords rounded
 *  to 4 decimals. The client reads this and places nodes directly. */
export interface ProjectionFact {
  method: 'pca';
  dim: number;
  count: number;
  generatedAt: string;
  /** key → [x, y] in [-1.3, 1.3]. */
  coords: Record<string, [number, number]>;
}

/** Build the storable projection fact from raw vectors (project → normalize → round). */
export function projectionFact(vectors: number[][], keys: string[], dim: number, generatedAt: string): ProjectionFact {
  const { coords } = pca2d(vectors, keys);
  const norm = normalizeCoords(coords);
  const out: Record<string, [number, number]> = {};
  for (let i = 0; i < keys.length; i++) out[keys[i]] = [round4(norm[i][0]), round4(norm[i][1])];
  return { method: 'pca', dim, count: keys.length, generatedAt, coords: out };
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}
