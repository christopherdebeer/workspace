/**
 * What's thrown up and left behind on the water:
 * - **wakes**: a ribbon of foam behind each boat, widening and fading as it ages (edges bright, the middle churned);
 * - **spray**: drops off the bow when a boat's going fast, more as it slams into the chop; bursts where the surf
 *   breaks on the rocks;
 * - **foam patches**: thrown out at the bow, round a splash;
 * - and, put fresh each frame by the page: the line thrown to a little boat, the ring that says come alongside,
 *   sparkles when someone lands.
 */
import { FSTRIDE, FX, WSTRIDE } from './render';

interface Bit { kind: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; grow: number; age: number; life: number; alpha: number; col: readonly number[]; fall: number }
const WHITE = [1, 1, 1];

export class Marks {
  data = new Float32Array(4096 * FSTRIDE); count = 0;
  private bits: Bit[] = [];
  add(b: Partial<Bit> & { kind: number; x: number; y?: number; z: number }) {
    if (this.bits.length > 3000) return;
    this.bits.push({ y: 0, vx: 0, vy: 0, vz: 0, size: 0.5, grow: 0, age: 0, life: 1, alpha: 1, col: WHITE, fall: 0, ...b });
  }
  spray(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life = 0.7) { this.add({ kind: FX.SPRAY, x, y, z, vx, vy, vz, size, grow: size * 0.8, life, alpha: 0.6, fall: 9.8 }); }
  foam(x: number, z: number, vx: number, vz: number, size: number, life = 1.2, alpha = 0.8) { this.add({ kind: FX.FOAM, x, z, vx, vz, size, grow: size * 0.9, life, alpha }); }
  sparkle(x: number, y: number, z: number, col: readonly number[]) { this.add({ kind: FX.SPARK, x, y, z, vy: 1.2, size: 0.45, life: 0.6, alpha: 1, col }); }
  /** move everything on, and write the survivors out (the page then puts its own marks after them) */
  step(dt: number) {
    let n = 0;
    const d = this.data;
    for (let i = 0; i < this.bits.length; i++) {
      const b = this.bits[i];
      b.age += dt;
      if (b.age >= b.life) continue;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.vy -= b.fall * dt;
      const drag = Math.exp(-dt * (b.kind === FX.FOAM ? 1.2 : 0.4)); b.vx *= drag; b.vz *= drag;
      this.bits[n++] = b;
    }
    this.bits.length = n;
    this.count = 0;
    for (const b of this.bits) {
      const u = b.age / b.life, a = b.alpha * (b.kind === FX.SPARK ? 1 - u : Math.min(1, u * 6) * (1 - u) ** 1.3);
      this.put(b.kind, b.x, b.y, b.z, b.size + b.grow * u, 0, 0, 0, b.col[0], b.col[1], b.col[2], a);
    }
  }
  put(kind: number, x: number, y: number, z: number, size: number, x2: number, y2: number, z2: number, r: number, g: number, b: number, a: number) {
    if ((this.count + 1) * FSTRIDE > this.data.length) return;
    const d = this.data, o = this.count++ * FSTRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size; d[o + 4] = x2; d[o + 5] = y2; d[o + 6] = z2; d[o + 7] = kind;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
  }
  /** a line between two points, sagging, in short straight stretches */
  line(a: number[], b: number[], sag: number, width: number, col: readonly number[], upto = 1) {
    const N = 12;
    let px = a[0], py = a[1], pz = a[2];
    for (let i = 1; i <= N; i++) {
      const t = (i / N) * upto, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag;
      this.put(FX.LINE, px, py, pz, width, x, y, z, col[0], col[1], col[2], 1);
      px = x; py = y; pz = z;
    }
  }
  clear() { this.bits.length = 0; this.count = 0; }
}

/** each boat's wake: where its stern has been, lately, and how hard it was going */
export class Wakes {
  private trails: { x: number; z: number; ax: number; az: number; t: number; k: number }[][] = [];
  data = new Float32Array(5 * 160 * 6 * WSTRIDE); count = 0;
  private last: number[] = [];
  record(i: number, x: number, z: number, h: number, v: number, now: number) {
    const tr = this.trails[i] ?? (this.trails[i] = []);
    if (now - (this.last[i] ?? -1) < 0.08) return;
    this.last[i] = now;
    const k = Math.max(0, Math.min(1, (Math.abs(v) - 0.8) / 8));
    // (the stern, a little aft of it; and which way is across)
    tr.push({ x: x - Math.sin(h) * 5.2, z: z - Math.cos(h) * 5.2, ax: -Math.cos(h), az: Math.sin(h), t: now, k });
    while (tr.length && now - tr[0].t > 3.8) tr.shift();
  }
  build(now: number) {
    const d = this.data; let n = 0;
    const put = (x: number, z: number, u: number, age: number, k: number) => { const o = n++ * WSTRIDE; d[o] = x; d[o + 1] = z; d[o + 2] = u; d[o + 3] = age; d[o + 4] = k; };
    for (const tr of this.trails) {
      if (!tr) continue;
      for (let i = 0; i + 1 < tr.length && (n + 6) * WSTRIDE <= d.length; i++) {
        const p = tr[i], q = tr[i + 1], ap = now - p.t, aq = now - q.t, wp = 1.15 + ap * 1.1, wq = 1.15 + aq * 1.1;
        if (p.k < 0.02 && q.k < 0.02) continue;
        put(p.x + p.ax * wp, p.z + p.az * wp, 1, ap, p.k); put(p.x - p.ax * wp, p.z - p.az * wp, -1, ap, p.k); put(q.x - q.ax * wq, q.z - q.az * wq, -1, aq, q.k);
        put(p.x + p.ax * wp, p.z + p.az * wp, 1, ap, p.k); put(q.x - q.ax * wq, q.z - q.az * wq, -1, aq, q.k); put(q.x + q.ax * wq, q.z + q.az * wq, 1, aq, q.k);
      }
    }
    this.count = n;
  }
  clear() { this.trails = []; this.last = []; }
}
