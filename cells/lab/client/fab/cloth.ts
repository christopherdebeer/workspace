/**
 * The cloth: the pattern's pieces, meshed, laid round the figure, and sewn, as particles (position-based dynamics).
 *
 * Each piece wants to be its flat self: every point keeps its distance to its neighbours across and down (stretch),
 * across the diagonals (shear), and two along (bend: how stiff the fabric is). So a gore that's wider at the waist
 * than the waistband it's held to gathers; a circle skirt, three times as wide at its hem as its waist, falls in
 * folds; a felt one stands out in a bell where silk would hang. Seams draw their two edges together, harder over the
 * first moment, as if stitched; what's held (a waistband, a neck) is held. Gravity; the body pushes it out, each
 * garment kept its own layer's way off it, so a top lies over a skirt and a cape over both, and holds it with
 * friction.
 */
import { distance, hit } from './body';
import type { Fabric } from './fabric';
import type { Edge, Garment } from './pattern';

export interface Part {
  garment: Garment; fabric: Fabric;
  /** its particles (start, count) and triangles (start, count, in indices) */
  p0: number; pn: number; t0: number; tn: number;
  /** each piece's grid: its first particle, and its points across and down (less one) */
  grids: Array<{ base: number; nu: number; nv: number }>;
}

export class Cloth {
  n = 0;
  pos!: Float32Array; prev!: Float32Array; inv!: Float32Array; nor!: Float32Array;
  /** each particle's place on the flat pattern (cm) and how far it is from its piece's edge (cm) */
  flat!: Float32Array; edge!: Float32Array;
  margin!: Float32Array; friction!: Float32Array;
  ca!: Int32Array; cb!: Int32Array; rest!: Float32Array; stiff!: Float32Array;
  sa!: Int32Array; sb!: Int32Array;
  pinI!: Int32Array; pinAt!: Float32Array; pinFrom!: Float32Array;
  tris!: Uint32Array;
  parts: Part[] = [];
  age = 0;

  /**
   * `from`: the cloth this one replaces, as a dial turns: each point of a piece starts where the same place on the
   * same piece of the same garment was, so it reshapes rather than being sewn again from scratch.
   */
  constructor(garments: Array<{ garment: Garment; fabric: Fabric }>, from?: Cloth) {
    const pos: number[] = [], flat: number[] = [], edge: number[] = [], margin: number[] = [], fr: number[] = [], inv: number[] = [];
    const ca: number[] = [], cb: number[] = [], rest: number[] = [], stiff: number[] = [];
    const sa: number[] = [], sb: number[] = [], pinI: number[] = [], pinAt: number[] = [], tris: number[] = [];
    for (const { garment, fabric } of garments) {
      const p0 = pos.length / 3, t0 = tris.length, bases: number[] = [];
      const old = from?.parts.find((q) => q.garment.slot === garment.slot && q.garment.pieces.length === garment.pieces.length);
      const layer = 0.45 + garment.layer * 0.95;
      for (const pc of garment.pieces) {
        const base = pos.length / 3, W = pc.nu + 1;
        bases.push(base);
        const fl: Array<[number, number]> = [];
        for (let j = 0; j <= pc.nv; j++) for (let i = 0; i <= pc.nu; i++) {
          const u = i / pc.nu, v = j / pc.nv, f = pc.flat(u, v);
          const s = old && from ? sample(from, old.grids[bases.length - 1], u, v) : pc.start(u, v);
          pos.push(s[0], s[1], s[2]); flat.push(f[0], f[1]); fl.push(f);
          const pinned = pc.pin?.(u, v) ?? null;
          if (pinned) { pinI.push(base + i + j * W); pinAt.push(...pinned); }
          inv.push(pinned ? 0 : 1 / fabric.mass);
          margin.push(layer); fr.push(fabric.friction);
          // (how far in from the piece's edge: for the stitching along it)
          const du = Math.hypot(...sub2(pc.flat(Math.min(1, u + 1 / pc.nu), v), f)) || 1, dv = Math.hypot(...sub2(pc.flat(u, Math.min(1, v + 1 / pc.nv)), f)) || 1;
          edge.push(Math.min(i, pc.nu - i) * du, Math.min(j, pc.nv - j) * dv);
        }
        const at = (i: number, j: number) => base + i + j * W, len = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
        const link = (i0: number, j0: number, i1: number, j1: number, k: number) => {
          if (i1 < 0 || i1 > pc.nu || j1 < 0 || j1 > pc.nv) return;
          ca.push(at(i0, j0)); cb.push(at(i1, j1)); rest.push(len(fl[i0 + j0 * W], fl[i1 + j1 * W])); stiff.push(k);
        };
        for (let j = 0; j <= pc.nv; j++) for (let i = 0; i <= pc.nu; i++) {
          link(i, j, i + 1, j, 1); link(i, j, i, j + 1, 1);
          link(i, j, i + 1, j + 1, 0.85); link(i + 1, j, i, j + 1, 0.85);
          link(i, j, i + 2, j, fabric.bend); link(i, j, i, j + 2, fabric.bend);
        }
        for (let j = 0; j < pc.nv; j++) for (let i = 0; i < pc.nu; i++) {
          const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
          tris.push(a, c, b, b, c, d);
        }
      }
      // (the seams: each edge's points, paired along them; an edge longer than its mate pairs several to one, eased in)
      const walk = (e: Edge) => {
        const pc = garment.pieces[e.piece], W = pc.nu + 1, base = bases[e.piece], N = e.side[0] === 'u' ? pc.nv : pc.nu;
        const k0 = Math.round(e.from * N), k1 = Math.round(e.to * N), st = k1 >= k0 ? 1 : -1, out: number[] = [];
        for (let k = k0; ; k += st) {
          out.push(e.side === 'u0' ? base + k * W : e.side === 'u1' ? base + pc.nu + k * W : e.side === 'v0' ? base + k : base + k + pc.nv * W);
          if (k === k1) break;
        }
        return out;
      };
      for (const [ea, eb] of garment.seams) {
        const A = walk(ea), B = walk(eb), long = A.length >= B.length ? A : B, short = long === A ? B : A;
        for (let k = 0; k < long.length; k++) {
          const m = short[Math.round((k * (short.length - 1)) / Math.max(1, long.length - 1))];
          if (m !== long[k]) { sa.push(long[k]); sb.push(m); }
        }
      }
      this.parts.push({ garment, fabric, p0, pn: pos.length / 3 - p0, t0, tn: tris.length - t0, grids: garment.pieces.map((pc, k) => ({ base: bases[k], nu: pc.nu, nv: pc.nv })) });
    }
    this.n = pos.length / 3;
    this.pos = new Float32Array(pos); this.prev = new Float32Array(pos); this.inv = new Float32Array(inv); this.nor = new Float32Array(pos.length);
    this.flat = new Float32Array(flat); this.edge = new Float32Array(edge); this.margin = new Float32Array(margin); this.friction = new Float32Array(fr);
    this.ca = new Int32Array(ca); this.cb = new Int32Array(cb); this.rest = new Float32Array(rest); this.stiff = new Float32Array(stiff);
    this.sa = new Int32Array(sa); this.sb = new Int32Array(sb); this.pinI = new Int32Array(pinI); this.pinAt = new Float32Array(pinAt);
    this.pinFrom = new Float32Array(this.pinI.length * 3);
    for (let k = 0; k < this.pinI.length; k++) this.pinFrom.set(this.pos.subarray(this.pinI[k] * 3, this.pinI[k] * 3 + 3), k * 3);
    this.tris = new Uint32Array(tris);
    // (a cloth that's replacing one's already sewn)
    if (from) this.age = 1;
    // (laid round the figure, nothing starts inside it: each point out to its layer, before anything moves)
    for (let i = 0; i < this.n; i++) {
      if (this.inv[i] === 0) continue;
      const i3 = i * 3;
      for (let k = 0; k < 4; k++) {
        const m = this.margin[i], d = distance(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2], m);
        if (d >= m) break;
        this.pos[i3] += hit.nx * (m - d); this.pos[i3 + 1] += hit.ny * (m - d); this.pos[i3 + 2] += hit.nz * (m - d);
      }
      this.prev[i3] = this.pos[i3]; this.prev[i3 + 1] = this.pos[i3 + 1]; this.prev[i3 + 2] = this.pos[i3 + 2];
    }
    this.normals();
  }

  /** one frame: two substeps, each a prediction, ten rounds of the constraints, and the body */
  step(dt: number, iters = 10) {
    const sub = 2, h = dt / sub, g = -980 * h * h, { pos, prev, inv } = this;
    for (let s = 0; s < sub; s++) {
      this.age += h;
      const sew = Math.min(1, this.age / 1.2);
      for (let i = 0; i < this.n; i++) {
        if (inv[i] === 0) continue;
        const i3 = i * 3, vx = (pos[i3] - prev[i3]) * 0.985, vy = (pos[i3 + 1] - prev[i3 + 1]) * 0.985, vz = (pos[i3 + 2] - prev[i3 + 2]) * 0.985;
        prev[i3] = pos[i3]; prev[i3 + 1] = pos[i3 + 1]; prev[i3 + 2] = pos[i3 + 2];
        pos[i3] += vx; pos[i3 + 1] += vy + g; pos[i3 + 2] += vz;
      }
      // (what's held is drawn to where it's held over the first half second, not snapped there: a jerk would throw the
      // cloth hanging from it)
      const ease = Math.min(1, this.age / 0.5), e = ease * ease * (3 - 2 * ease);
      for (let k = 0; k < this.pinI.length; k++) {
        const i3 = this.pinI[k] * 3, k3 = k * 3;
        for (let c = 0; c < 3; c++) pos[i3 + c] = this.pinFrom[k3 + c] + (this.pinAt[k3 + c] - this.pinFrom[k3 + c]) * e;
      }
      for (let it = 0; it < iters; it++) {
        this.solve(this.ca, this.cb, this.rest, this.stiff, 1);
        this.solve(this.sa, this.sb, null, null, sew * 0.9);
        // (the body, every few rounds: a seam drawing in hard can pull a point clean through a thin arm between)
        if (it % 3 === 2 || it === iters - 1) this.collide();
      }
    }
    this.normals();
  }

  private solve(A: Int32Array, B: Int32Array, rest: Float32Array | null, stiff: Float32Array | null, k0: number) {
    const { pos, inv } = this;
    for (let c = 0; c < A.length; c++) {
      const a = A[c] * 3, b = B[c] * 3, wa = inv[A[c]], wb = inv[B[c]], w = wa + wb;
      if (w === 0) continue;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-6) continue;
      const r = rest ? rest[c] : 0, k = (stiff ? stiff[c] : 1) * k0;
      const C = d - r;
      const f = (C / d / w) * k;
      pos[a] += dx * f * wa; pos[a + 1] += dy * f * wa; pos[a + 2] += dz * f * wa;
      pos[b] -= dx * f * wb; pos[b + 1] -= dy * f * wb; pos[b + 2] -= dz * f * wb;
    }
  }

  private collide() {
    const { pos, prev, inv, margin, friction } = this;
    for (let i = 0; i < this.n; i++) {
      if (inv[i] === 0) continue;
      const i3 = i * 3;
      // (the stand's top: nothing goes through it)
      if (pos[i3 + 1] < 0.4) { pos[i3 + 1] = 0.4; prev[i3] += (pos[i3] - prev[i3]) * 0.6; prev[i3 + 2] += (pos[i3 + 2] - prev[i3 + 2]) * 0.6; }
      const m = margin[i], d = distance(pos[i3], pos[i3 + 1], pos[i3 + 2], m);
      if (d >= m) continue;
      const push = m - d, n = [hit.nx, hit.ny, hit.nz];
      pos[i3] += n[0] * push; pos[i3 + 1] += n[1] * push; pos[i3 + 2] += n[2] * push;
      // (friction: what it's moved along the body since last step, taken back in part)
      const mx = pos[i3] - prev[i3], my = pos[i3 + 1] - prev[i3 + 1], mz = pos[i3 + 2] - prev[i3 + 2], mn = mx * n[0] + my * n[1] + mz * n[2];
      const f = friction[i];
      prev[i3] += (mx - mn * n[0]) * f; prev[i3 + 1] += (my - mn * n[1]) * f; prev[i3 + 2] += (mz - mn * n[2]) * f;
    }
  }

  normals() {
    const { pos, nor, tris } = this;
    nor.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, b, c]) { nor[q] += nx; nor[q + 1] += ny; nor[q + 2] += nz; }
    }
    for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
  }
}
/** where a place on a piece of an old cloth is (u, v across and down it), between its four nearest points */
function sample(c: Cloth, g: { base: number; nu: number; nv: number }, u: number, v: number): [number, number, number] {
  const x = u * g.nu, y = v * g.nv, i = Math.min(g.nu - 1, Math.floor(x)), j = Math.min(g.nv - 1, Math.floor(y)), fx = x - i, fy = y - j, W = g.nu + 1;
  const at = (a: number, b: number, k: number) => c.pos[(g.base + a + b * W) * 3 + k];
  const o: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) o[k] = (at(i, j, k) * (1 - fx) + at(i + 1, j, k) * fx) * (1 - fy) + (at(i, j + 1, k) * (1 - fx) + at(i + 1, j + 1, k) * fx) * fy;
  return o;
}
const sub2 = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];
