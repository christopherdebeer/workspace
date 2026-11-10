/**
 * The sort. Splats are drawn blended (each over what's behind it), so they have to be drawn in order, farthest first,
 * and the order changes as the view turns. This is the part of splatting that ordinary 3D rendering doesn't have (a
 * depth buffer can't do it: the splats are translucent), and on a phone it's the main cost besides filling pixels.
 *
 * A counting sort on a 16-bit depth: each splat's depth along the way the camera looks, scaled into 65536 buckets
 * between the nearest and farthest; count each bucket, add the counts up, and drop each splat into its place. Linear in
 * the number of splats (a million in tens of milliseconds), and exact enough: two splats in the same bucket are
 * within 1/65536 of the scene's depth of each other. Only the direction matters, not where the camera is (moving
 * along the view shifts every depth alike), so it's done again only when the view turns.
 *
 * Run off the page's thread in a worker (`serve`, the same bundle as the page loaded with `?worker=splats`), so the
 * page keeps drawing with the last order while the next is worked out.
 */
export class Sorter {
  private depth = new Float32Array(0); private key = new Uint16Array(0); private counts = new Uint32Array(65536);
  /** the order, farthest first, for a view looking along `dir` (x y z, world space) */
  sort(pos: Float32Array, n: number, dir: ArrayLike<number>, out = new Uint32Array(n)): Uint32Array {
    if (this.depth.length < n) { this.depth = new Float32Array(n); this.key = new Uint16Array(n); }
    const D = this.depth, K = this.key, C = this.counts, dx = dir[0], dy = dir[1], dz = dir[2];
    let lo = Infinity, hi = -Infinity;
    // (depth along the view: larger is farther)
    for (let i = 0; i < n; i++) { const d = dx * pos[i * 3] + dy * pos[i * 3 + 1] + dz * pos[i * 3 + 2]; D[i] = d; if (d < lo) lo = d; if (d > hi) hi = d; }
    const k = 65535 / (hi - lo || 1);
    C.fill(0);
    for (let i = 0; i < n; i++) { const b = ((hi - D[i]) * k) | 0; K[i] = b; C[b]++; }
    // (bucket 0 is the farthest: its splats go first)
    for (let b = 0, at = 0; b < 65536; b++) { const c = C[b]; C[b] = at; at += c; }
    for (let i = 0; i < n; i++) out[C[K[i]]++] = i;
    return out;
  }
}

export interface SortData { kind: 'data'; pos: Float32Array; n: number }
export interface SortAsk { kind: 'sort'; id: number; dir: [number, number, number] }
export interface SortDone { id: number; order: Uint32Array; ms: number }

/** the worker's side: keep the centres it's given, and answer each ask with the order for that view */
export function serve() {
  const sorter = new Sorter();
  let pos: Float32Array = new Float32Array(0), n = 0;
  self.onmessage = (e: MessageEvent<SortData | SortAsk>) => {
    const m = e.data;
    if (m.kind === 'data') { pos = m.pos; n = m.n; return; }
    const t0 = performance.now(), order = sorter.sort(pos, n, m.dir);
    const done: SortDone = { id: m.id, order, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(done, [order.buffer]);
  };
}
