/**
 * Taohua: walking off the ways, where the ground's open. A way across the open hill from one place
 * to another, found on a fine grid (half a metre) about the two: through open ground (not under a
 * crown, nor on a rock, a terrace, a cast's sheet, nor in water or on a bank cut steep), or along a
 * way, which is always open to the walker; a little dearer off a way than on one. Then drawn tight,
 * so it goes straight where it can.
 */
export type P2 = [number, number];
/** how fine the grid is (m) */
const CELL = 0.5;

/**
 * A way from a to b, as points (a first, b last), or null if there's none: `open(x, z)` says whether
 * the walker may stand there (and `onWay(x, z)` whether that's on a way, cheaper to walk).
 */
export function plan(a: P2, b: P2, open: (x: number, z: number) => boolean, onWay: (x: number, z: number) => boolean): P2[] | null {
  const M = 6;
  const x0 = Math.min(a[0], b[0]) - M, z0 = Math.min(a[1], b[1]) - M;
  const nx = Math.ceil((Math.max(a[0], b[0]) + M - x0) / CELL) + 1, nz = Math.ceil((Math.max(a[1], b[1]) + M - z0) / CELL) + 1;
  if (nx * nz > 160000) return null;
  const cx = (i: number) => x0 + i * CELL, cz = (k: number) => z0 + k * CELL;
  // (each cell: 0 not yet asked, 1 open off a way, 2 on a way, 3 shut)
  const st = new Uint8Array(nx * nz);
  const at = (i: number, k: number) => {
    const n = k * nx + i;
    if (!st[n]) st[n] = onWay(cx(i), cz(k)) ? 2 : open(cx(i), cz(k)) ? 1 : 3;
    return st[n];
  };
  const ia = Math.round((a[0] - x0) / CELL), ka = Math.round((a[1] - z0) / CELL);
  const ib = Math.round((b[0] - x0) / CELL), kb = Math.round((b[1] - z0) / CELL);
  st[ka * nx + ia] = onWay(a[0], a[1]) ? 2 : 1;
  if (at(ib, kb) === 3) return null;
  // (A*, over the grid, eight ways from each cell)
  const g = new Float32Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1);
  const h = (i: number, k: number) => Math.hypot(i - ib, k - kb);
  const heap: number[] = [], f: number[] = [];
  const push = (n: number, v: number) => { heap.push(n); f.push(v); let j = heap.length - 1; while (j > 0) { const p = (j - 1) >> 1; if (f[p] <= f[j]) break; [heap[p], heap[j]] = [heap[j], heap[p]]; [f[p], f[j]] = [f[j], f[p]]; j = p; } };
  const pop = () => { const n = heap[0], ln = heap.pop()!, lf = f.pop()!; if (heap.length) { heap[0] = ln; f[0] = lf; let j = 0; for (;;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && f[l] < f[m]) m = l; if (r < heap.length && f[r] < f[m]) m = r; if (m === j) break; [heap[m], heap[j]] = [heap[j], heap[m]]; [f[m], f[j]] = [f[j], f[m]]; j = m; } } return n; };
  const s0 = ka * nx + ia;
  g[s0] = 0; push(s0, h(ia, ka));
  const goal = kb * nx + ib;
  let steps = 0;
  while (heap.length && steps++ < 60000) {
    const n = pop();
    if (n === goal) break;
    const i = n % nx, k = (n - i) / nx;
    for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      if (!di && !dk) continue;
      const ii = i + di, kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const s = at(ii, kk);
      if (s === 3) continue;
      // (no cutting a corner past something shut)
      if (di && dk && (at(i + di, k) === 3 || at(i, k + dk) === 3)) continue;
      const m = kk * nx + ii, c = g[n] + Math.hypot(di, dk) * (s === 2 ? 1 : 1.12);
      if (c < g[m]) { g[m] = c; from[m] = n; push(m, c + h(ii, kk)); }
    }
  }
  if (from[goal] < 0 && goal !== s0) return null;
  const cells: number[] = [];
  for (let n = goal; n !== -1; n = from[n]) { cells.unshift(n); if (n === s0) break; }
  const pts: P2[] = cells.map((n) => [cx(n % nx), cz(Math.floor(n / nx))]);
  pts[0] = [a[0], a[1]]; pts[pts.length - 1] = [b[0], b[1]];
  // (drawn tight: from each point, straight on to the furthest it can see across open ground)
  const clear = (p: P2, q: P2) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.ceil(L / (CELL * 0.5));
    for (let j = 1; j < n; j++) { const x = p[0] + ((q[0] - p[0]) * j) / n, z = p[1] + ((q[1] - p[1]) * j) / n; if (at(Math.round((x - x0) / CELL), Math.round((z - z0) / CELL)) === 3) return false; }
    return true;
  };
  const out: P2[] = [pts[0]];
  for (let j = 0; j < pts.length - 1;) {
    let far = j + 1;
    for (let t = pts.length - 1; t > j + 1; t--) if (clear(pts[j], pts[t])) { far = t; break; }
    out.push(pts[far]); j = far;
  }
  return out;
}
