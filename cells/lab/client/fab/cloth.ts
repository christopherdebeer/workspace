/**
 * The cloth: a pattern's pieces, meshed, laid out round the figure, sewn up and let fall. XPBD (extended
 * position-based dynamics: Macklin, Müller & Chentanez 2016) in its "small steps" form: many substeps a frame, one
 * pass of the constraints each. XPBD because its stiffnesses are compliances in real units, so a fabric's measured
 * properties go in as they are, and what comes out doesn't depend on how many times the solver goes round.
 *
 * In centimetres, grams, seconds:
 * - mass: each point carries its share of its triangles' flat area times the fabric's weight;
 * - stretch and shear: each edge of the mesh is a spring whose stiffness is the fabric's tensile stiffness *in that
 *   edge's direction on the cloth* (orthotropic: stiff along the warp and weft, soft on the bias) times the area it
 *   stands for over its length². A spring network, not a finite-element membrane: the compromise is stated, and the
 *   evidence bench measures what it gives;
 * - bending: the quadratic isometric bending energy (Bergou, Wardetzky, Harmon, Zorin & Grinspun 2006): at each
 *   interior point, the cotangent Laplacian of the positions, which is zero on the flat pattern, weighted by the
 *   fabric's flexural rigidity (from its Peirce bending length and weight) over the point's area. As a constraint, so
 *   stiff felt is as stable as limp chiffon;
 * - seams: zero-length constraints, drawn closed over the first moment (sewing);
 * - held points (a waistband): moved, not simulated, eased to where they're held, turning with the figure;
 * - air: drag on each point's speed through the cloth's normal, by its area over its mass, so chiffon floats and felt
 *   falls;
 * - the body: pushed out to a thickness off it, with Coulomb friction against its moving surface; and the cloth
 *   against itself: points kept a thickness apart (a spatial hash), except near seams and folds, where they're meant
 *   to meet.
 */
import * as body from './body';
import { physical, stiffAt, type Fabric } from './fabric';
import type { At, Piece } from './pattern';

type V3 = [number, number, number];
export interface Collider { distance(x: number, y: number, z: number, near?: number): number; hit: { nx: number; ny: number; nz: number } }
export interface Build {
  pieces: Array<Pick<Piece, 'nu' | 'nv' | 'flat' | 'grain' | 'start'>>;
  pairs: Array<{ a: At; b: At }>;
  /** held points, where in the figure's own frame */
  holds: Array<{ at: At; p: V3 }>;
  fabric: Fabric;
  collider?: Collider | null;
  /** how far off the body (cm) */
  margin?: number;
  self?: boolean;
  /** the floor: the stand's top (y = 0, r 26) and the bench (y = −5) */
  floor?: boolean;
}

export class Cloth {
  n = 0;
  pos!: Float32Array; prev!: Float32Array; inv!: Float32Array; nor!: Float32Array;
  /** each point's place on the bolt (cm, warp up: where the print is) and how far it is in from its piece's edge */
  flat!: Float32Array; edge!: Float32Array;
  piece!: Int16Array; gi!: Int16Array; gj!: Int16Array; lone!: Uint8Array;
  tris!: Uint32Array;
  grids: Array<{ base: number; nu: number; nv: number }> = [];
  // (springs: ends, rest length, compliance)
  la!: Int32Array; lb!: Int32Array; lr!: Float32Array; lc!: Float32Array;
  // (bending: per interior point, its stencil (points and weights), and compliance)
  bs!: Int32Array; bi!: Int32Array; bw!: Float32Array; bc!: Float32Array; bp!: Int32Array;
  // (seams: ends, their gap when laid out)
  sa!: Int32Array; sb!: Int32Array; s0!: Float32Array;
  // (tethers: each free point to its nearest held point on its own piece, no further than along the cloth)
  ti!: Int32Array; tt!: Int32Array; tr!: Float32Array;
  // (held: which, from where, to where in the figure's frame)
  hi!: Int32Array; hFrom!: Float32Array; hAt!: Float32Array;
  fabric: Fabric; drag: number; mu: number; margin: number;
  /** each point's half-thickness against the cloth itself: under half its nearest neighbour's distance */
  rad!: Float32Array;
  collider: Collider | null; self: boolean; floor: boolean;
  age = 0;
  /** goes up every step: whoever draws it knows when it's moved */
  version = 0;
  /** the figure's turn (radians) and how fast it's turning */
  spin = 0; omega = 0;
  substeps = 8;
  /** passes over the springs each substep */
  iters = 2;
  /** passes over bending each substep */
  bendIters = 3;
  /** substeps before each point's worth asking the body about again (it was far enough off it) */
  private wait = new Uint8Array(0);

  constructor(b: Build, from?: Cloth | null) {
    this.fabric = b.fabric; this.collider = b.collider === undefined ? body : b.collider; this.self = b.self ?? true; this.floor = b.floor ?? true;
    this.margin = b.margin ?? 0.5; this.mu = b.fabric.friction;
    const ph = physical(b.fabric);
    // (air: ½·ρ_air·C_d over the cloth's own weight a cm²)
    this.drag = (0.5 * 0.0012 * 1.0) / ph.rho;
    const warm = !!from && from.grids.length === b.pieces.length;
    const pos: number[] = [], flat: number[] = [], edge: number[] = [], piece: number[] = [], gi: number[] = [], gj: number[] = [];
    let base = 0;
    for (let k = 0; k < b.pieces.length; k++) {
      const pc = b.pieces[k], W = pc.nu + 1, g = pc.grain, wx = Math.cos(g), wy = Math.sin(g);
      this.grids.push({ base, nu: pc.nu, nv: pc.nv });
      for (let j = 0; j <= pc.nv; j++) for (let i = 0; i <= pc.nu; i++) {
        const u = i / pc.nu, v = j / pc.nv, f = pc.flat(u, v);
        const s = warm ? from!.sample(k, u, v) : pc.start(u, v);
        pos.push(s[0], s[1], s[2]);
        // (the print's along the warp: the piece's flat place turned by its grain)
        flat.push(f[0] * wx + f[1] * wy, -f[0] * wy + f[1] * wx);
        const du = Math.hypot(...sub(pc.flat(Math.min(1, u + 1 / pc.nu), v), pc.flat(Math.max(0, u - 1 / pc.nu), v))) / (i > 0 && i < pc.nu ? 2 : 1);
        const dv = Math.hypot(...sub(pc.flat(u, Math.min(1, v + 1 / pc.nv)), pc.flat(u, Math.max(0, v - 1 / pc.nv)))) / (j > 0 && j < pc.nv ? 2 : 1);
        edge.push(Math.min(i, pc.nu - i) * du, Math.min(j, pc.nv - j) * dv);
        piece.push(k); gi.push(i); gj.push(j);
      }
      base += W * (pc.nv + 1);
    }
    const n = (this.n = base);
    this.pos = new Float32Array(pos); this.prev = new Float32Array(pos); this.nor = new Float32Array(n * 3);
    this.flat = new Float32Array(flat); this.edge = new Float32Array(edge);
    this.piece = new Int16Array(piece); this.gi = new Int16Array(gi); this.gj = new Int16Array(gj);
    const idx = (a: At) => this.grids[a[0]].base + a[1] + a[2] * (this.grids[a[0]].nu + 1);
    const fx = (i: number) => { const k = piece[i], pc = b.pieces[k], g = this.grids[k]; return pc.flat(gi[i] / g.nu, gj[i] / g.nv); };
    const F = Array.from({ length: n }, (_, i) => fx(i));

    // (the mesh: two triangles a cell, the diagonal alternating so it has no bias of its own)
    const tris: number[] = [];
    for (const g of this.grids) {
      const W = g.nu + 1;
      for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nu; i++) {
        const a = g.base + i + j * W, bb = a + 1, c = a + W, d = c + 1;
        if ((i + j) % 2) tris.push(a, c, bb, bb, c, d); else tris.push(a, c, d, a, d, bb);
      }
    }
    this.tris = new Uint32Array(tris);
    // (mass: a third of each triangle's flat area, times the fabric's weight)
    const area = new Float64Array(n), cot = new Map<number, number>(), triA: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const [a, bb, c] = [tris[t], tris[t + 1], tris[t + 2]], A = Math.abs(cross2(sub(F[bb], F[a]), sub(F[c], F[a]))) / 2;
      triA.push(A); area[a] += A / 3; area[bb] += A / 3; area[c] += A / 3;
      // (cotangent weights, for bending: each corner's cot to the edge across from it)
      for (const [p, q, r] of [[a, bb, c], [bb, c, a], [c, a, bb]]) {
        const e1 = sub(F[q], F[p]), e2 = sub(F[r], F[p]), ct = dot2(e1, e2) / Math.max(1e-9, Math.abs(cross2(e1, e2)));
        const key = q < r ? q * n + r : r * n + q;
        cot.set(key, (cot.get(key) ?? 0) + ct / 2);
      }
    }
    this.inv = new Float32Array(n);
    for (let i = 0; i < n; i++) this.inv[i] = 1 / Math.max(1e-6, area[i] * ph.rho);

    // (springs, along every edge, by the cloth's stiffness in its direction)
    const la: number[] = [], lb: number[] = [], lr: number[] = [], lc: number[] = [], seen = new Set<number>(), edgeA = new Map<number, number>();
    for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
      const p = tris[t + e], q = tris[t + ((e + 1) % 3)], key = p < q ? p * n + q : q * n + p;
      edgeA.set(key, (edgeA.get(key) ?? 0) + triA[t / 3] / 3);
    }
    for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
      const p = tris[t + e], q = tris[t + ((e + 1) % 3)], key = p < q ? p * n + q : q * n + p;
      if (seen.has(key)) continue; seen.add(key);
      const d = sub(F[q], F[p]), l = Math.hypot(d[0], d[1]), gr = b.pieces[piece[p]].grain;
      // (the angle to the warp: the warp runs down the piece's centre line, turned by its grain)
      const phi = Math.atan2(d[0], -d[1]) - gr;
      const E = b.fabric.grain ? stiffAt(ph.E1, ph.E2, ph.G, phi) : stiffAt(ph.E1, ph.E1, ph.G, phi);
      const k = (E * edgeA.get(key)!) / (l * l);
      la.push(p); lb.push(q); lr.push(l); lc.push(1 / k);
    }
    this.la = new Int32Array(la); this.lb = new Int32Array(lb); this.lr = new Float32Array(lr); this.lc = new Float32Array(lc);

    // (bending: every point inside a piece, its cotangent Laplacian; compliance A/B)
    const nb: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
    for (const [key, w] of cot) { const p = Math.floor(key / n), q = key % n; nb[p].set(q, w); nb[q].set(p, w); }
    const bs: number[] = [0], bi: number[] = [], bw: number[] = [], bc: number[] = [], bp: number[] = [];
    for (let i = 0; i < n; i++) {
      const g = this.grids[piece[i]];
      if (gi[i] === 0 || gi[i] === g.nu || gj[i] === 0 || gj[i] === g.nv) continue;
      let sum = 0;
      for (const [q, w] of nb[i]) { bi.push(q); bw.push(w); sum += w; }
      bi.push(i); bw.push(-sum);
      bs.push(bi.length); bp.push(i); bc.push(area[i] / ph.B);
    }
    this.bs = new Int32Array(bs); this.bi = new Int32Array(bi); this.bw = new Float32Array(bw); this.bc = new Float32Array(bc); this.bp = new Int32Array(bp);

    // (seams, and what's held)
    const sa: number[] = [], sb: number[] = [];
    this.lone = new Uint8Array(n);
    for (const p of b.pairs) { const x = idx(p.a), y = idx(p.b); if (x === y) continue; sa.push(x); sb.push(y); }
    this.sa = new Int32Array(sa); this.sb = new Int32Array(sb);
    this.hi = new Int32Array(b.holds.map((h) => idx(h.at))); this.hAt = new Float32Array(b.holds.flatMap((h) => h.p));
    for (const i of this.hi) this.inv[i] = 0;
    // (near a seam or a fold, cloth's meant to meet cloth: not kept apart there)
    for (const i of [...sa, ...sb, ...this.hi]) {
      this.lone[i] = 1;
      for (const [q] of nb[i]) this.lone[q] = 1;
    }
    // (long-range attachments (Kim, Chentanez & Müller 2012): a woven cloth hardly stretches under its own weight, but
    // a solver that goes round once a substep lets a long hanging piece creep; so each point's tied to its nearest held
    // point no further than the cloth between them allows, plus what that much cloth would stretch hanging from it, in
    // that direction (on the bias, more))
    const ti: number[] = [], tt: number[] = [], tr: number[] = [];
    const heldBy = new Map<number, number[]>();
    for (const i of this.hi) { const k = piece[i]; if (!heldBy.has(k)) heldBy.set(k, []); heldBy.get(k)!.push(i); }
    for (let i = 0; i < n; i++) {
      const hs = heldBy.get(piece[i]);
      if (!hs || this.inv[i] === 0) continue;
      let best = -1, bd = Infinity;
      for (const q of hs) { const dd = (F[i][0] - F[q][0]) ** 2 + (F[i][1] - F[q][1]) ** 2; if (dd < bd) { bd = dd; best = q; } }
      const D = Math.sqrt(bd);
      if (D < 1e-6) continue;
      const dx = F[i][0] - F[best][0], dy = F[i][1] - F[best][1], phi = Math.atan2(dx, -dy) - b.pieces[piece[i]].grain;
      const E = b.fabric.grain ? stiffAt(ph.E1, ph.E2, ph.G, phi) : stiffAt(ph.E1, ph.E1, ph.G, phi);
      ti.push(i); tt.push(best); tr.push(D * (1 + (ph.rho * 980 * D) / E + 0.001));
    }
    this.ti = new Int32Array(ti); this.tt = new Int32Array(tt); this.tr = new Float32Array(tr);
    this.rad = new Float32Array(n).fill(0.8);
    for (let c = 0; c < lr.length; c++) { const r = 0.45 * lr[c]; if (r < this.rad[la[c]]) this.rad[la[c]] = r; if (r < this.rad[lb[c]]) this.rad[lb[c]] = r; }

    if (warm) { this.age = 3; this.spin = from!.spin; this.omega = from!.omega; }
    // (laid out, nothing starts inside the figure)
    if (this.collider) for (let i = 0; i < n; i++) if (this.inv[i] > 0) this.pushOut(i, 0, false);
    this.prev.set(this.pos);
    this.s0 = new Float32Array(sa.length);
    for (let c = 0; c < sa.length; c++) this.s0[c] = warm ? 0 : dist(this.pos, sa[c], sb[c]);
    this.hFrom = new Float32Array(this.hi.length * 3);
    for (let k = 0; k < this.hi.length; k++) this.hFrom.set(this.toBody(this.hi[k]), k * 3);
    this.wait = new Uint8Array(n);
    this.normals();
  }

  /** where a place on a piece is (u, v across and down it), between its four nearest points */
  sample(k: number, u: number, v: number): V3 {
    const g = this.grids[k], x = u * g.nu, y = v * g.nv, i = Math.min(g.nu - 1, Math.floor(x)), j = Math.min(g.nv - 1, Math.floor(y)), fx = x - i, fy = y - j, W = g.nu + 1;
    const o: V3 = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const at = (a: number, bb: number) => this.pos[(g.base + a + bb * W) * 3 + c];
      o[c] = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy;
    }
    return o;
  }
  private toBody(i: number): V3 {
    const c = Math.cos(this.spin), s = Math.sin(this.spin), x = this.pos[i * 3], z = this.pos[i * 3 + 2];
    return [x * c - z * s, this.pos[i * 3 + 1], x * s + z * c];
  }

  /** one frame */
  step(dt: number) {
    this.version++;
    const S = this.substeps, h = dt / S, { pos, prev, inv, nor } = this, n = this.n;
    for (let s = 0; s < S; s++) {
      this.age += h; this.spin += this.omega * h;
      // (predict: what it's moving, less the air's drag through it, and gravity)
      for (let i = 0; i < n; i++) {
        if (inv[i] === 0) continue;
        const i3 = i * 3;
        let vx = (pos[i3] - prev[i3]) / h, vy = (pos[i3 + 1] - prev[i3 + 1]) / h, vz = (pos[i3 + 2] - prev[i3 + 2]) / h;
        const vn = vx * nor[i3] + vy * nor[i3 + 1] + vz * nor[i3 + 2], k = 1 - 1 / (1 + this.drag * Math.abs(vn) * h);
        vx -= nor[i3] * vn * k; vy -= nor[i3 + 1] * vn * k; vz -= nor[i3 + 2] * vn * k;
        const damp = 1 - 0.6 * h;
        prev[i3] = pos[i3]; prev[i3 + 1] = pos[i3 + 1]; prev[i3 + 2] = pos[i3 + 2];
        pos[i3] += vx * damp * h; pos[i3 + 1] += (vy * damp - 980 * h) * h; pos[i3 + 2] += vz * damp * h;
      }
      // (held: eased over half a second from where it was laid to where it's held, and turned with the figure)
      const e0 = Math.min(1, this.age / 0.6), e = e0 * e0 * (3 - 2 * e0), cs = Math.cos(this.spin), sn = Math.sin(this.spin);
      for (let k = 0; k < this.hi.length; k++) {
        const i3 = this.hi[k] * 3, k3 = k * 3;
        const x = this.hFrom[k3] + (this.hAt[k3] - this.hFrom[k3]) * e, y = this.hFrom[k3 + 1] + (this.hAt[k3 + 1] - this.hFrom[k3 + 1]) * e, z = this.hFrom[k3 + 2] + (this.hAt[k3 + 2] - this.hFrom[k3 + 2]) * e;
        prev[i3] = pos[i3]; prev[i3 + 1] = pos[i3 + 1]; prev[i3 + 2] = pos[i3 + 2];
        pos[i3] = x * cs + z * sn; pos[i3 + 1] = y; pos[i3 + 2] = -x * sn + z * cs;
      }
      const h2 = h * h;
      for (let it = 0; it < this.iters; it++) this.springs(h2, it === 0);
      for (let it = 0; it < this.bendIters; it++) this.bending(h2, it === 0);
      this.tethers();
      // (sewing: each seam's gap closed over the first 0.8 s)
      const sw = Math.min(1, this.age / 0.8), sew = 1 - sw * sw * (3 - 2 * sw);
      for (let c = 0; c < this.sa.length; c++) this.distance(this.sa[c], this.sb[c], this.s0[c] * sew, 1e-8 / h2);
      if (this.self && s % 4 === 3) this.selfCollide();
      if (this.collider || this.floor) for (let i = 0; i < n; i++) if (inv[i] > 0) { if (this.wait[i] > 0) this.wait[i]--; else this.pushOut(i, h, true); }
    }
    this.normals();
  }

  private distance(a: number, b: number, rest: number, at: number) {
    const { pos, inv } = this, wa = inv[a], wb = inv[b], w = wa + wb + at;
    if (wa + wb === 0) return;
    const a3 = a * 3, b3 = b * 3, dx = pos[b3] - pos[a3], dy = pos[b3 + 1] - pos[a3 + 1], dz = pos[b3 + 2] - pos[a3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-7) return;
    const f = (d - rest) / d / w;
    pos[a3] += dx * f * wa; pos[a3 + 1] += dy * f * wa; pos[a3 + 2] += dz * f * wa;
    pos[b3] -= dx * f * wb; pos[b3 + 1] -= dy * f * wb; pos[b3 + 2] -= dz * f * wb;
  }
  private sl = new Float32Array(0);
  private springs(h2: number, first: boolean) {
    const { pos, inv, la, lb, lr, lc } = this;
    if (this.sl.length !== la.length) this.sl = new Float32Array(la.length);
    const L = this.sl;
    if (first) L.fill(0);
    for (let c = 0; c < la.length; c++) {
      const a = la[c], b = lb[c], wa = inv[a], wb = inv[b];
      if (wa + wb === 0) continue;
      const a3 = a * 3, b3 = b * 3, dx = pos[b3] - pos[a3], dy = pos[b3 + 1] - pos[a3 + 1], dz = pos[b3 + 2] - pos[a3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-7) continue;
      const at = lc[c] / h2, dl = (d - lr[c] - at * L[c]) / (wa + wb + at);
      L[c] += dl;
      const f = dl / d;
      pos[a3] += dx * f * wa; pos[a3 + 1] += dy * f * wa; pos[a3 + 2] += dz * f * wa;
      pos[b3] -= dx * f * wb; pos[b3 + 1] -= dy * f * wb; pos[b3 + 2] -= dz * f * wb;
    }
  }
  private tethers() {
    const { pos, ti, tt, tr } = this;
    for (let c = 0; c < ti.length; c++) {
      const a3 = ti[c] * 3, b3 = tt[c] * 3, dx = pos[a3] - pos[b3], dy = pos[a3 + 1] - pos[b3 + 1], dz = pos[a3 + 2] - pos[b3 + 2], d2 = dx * dx + dy * dy + dz * dz, r = tr[c];
      if (d2 <= r * r) continue;
      const f = r / Math.sqrt(d2);
      pos[a3] = pos[b3] + dx * f; pos[a3 + 1] = pos[b3 + 1] + dy * f; pos[a3 + 2] = pos[b3 + 2] + dz * f;
    }
  }
  /** XPBD's multipliers for bending (three a point), kept across the passes within a substep so more passes converge
   * on the cloth's true stiffness rather than adding to it */
  private bl = new Float32Array(0);
  private bending(h2: number, first: boolean) {
    const { pos, inv, bs, bi, bw, bc } = this;
    if (this.bl.length !== bc.length * 3) this.bl = new Float32Array(bc.length * 3);
    const L = this.bl;
    if (first) L.fill(0);
    for (let k = 0; k < bc.length; k++) {
      let cx = 0, cy = 0, cz = 0, wsum = 0;
      for (let q = bs[k]; q < bs[k + 1]; q++) { const p3 = bi[q] * 3, w = bw[q]; cx += pos[p3] * w; cy += pos[p3 + 1] * w; cz += pos[p3 + 2] * w; wsum += w * w * inv[bi[q]]; }
      const at = bc[k] / h2, den = wsum + at;
      if (den <= 0) continue;
      const k3 = k * 3, lx = -(cx + at * L[k3]) / den, ly = -(cy + at * L[k3 + 1]) / den, lz = -(cz + at * L[k3 + 2]) / den;
      L[k3] += lx; L[k3 + 1] += ly; L[k3 + 2] += lz;
      for (let q = bs[k]; q < bs[k + 1]; q++) { const p = bi[q], p3 = p * 3, f = bw[q] * inv[p]; pos[p3] += lx * f; pos[p3 + 1] += ly * f; pos[p3 + 2] += lz * f; }
    }
  }

  /** out of the body (to the margin), with friction against its surface as it turns; and off the stand and bench */
  private pushOut(i: number, h: number, friction: boolean) {
    const { pos, prev } = this, i3 = i * 3;
    if (this.floor) {
      const r2 = pos[i3] * pos[i3] + pos[i3 + 2] * pos[i3 + 2], fl = r2 < 676 ? 0.3 : -4.7;
      if (pos[i3 + 1] < fl) { pos[i3 + 1] = fl; if (friction) { prev[i3] += (pos[i3] - prev[i3]) * 0.7; prev[i3 + 2] += (pos[i3 + 2] - prev[i3 + 2]) * 0.7; } }
    }
    const col = this.collider;
    if (!col) return;
    const cs = Math.cos(this.spin), sn = Math.sin(this.spin);
    const x = pos[i3], y = pos[i3 + 1], z = pos[i3 + 2], bx = x * cs - z * sn, bz = x * sn + z * cs;
    const m = this.margin, d = col.distance(bx, y, bz, m + 6);
    // (far off: nothing moves 0.5 cm a substep, so it needn't ask again for a while)
    if (d >= m) { if (friction) this.wait[i] = Math.min(12, Math.floor((d - m) / 0.5)); return; }
    const hn = col.hit, nx = hn.nx * cs + hn.nz * sn, ny = hn.ny, nz = -hn.nx * sn + hn.nz * cs, push = m - d;
    pos[i3] += nx * push; pos[i3 + 1] += ny * push; pos[i3 + 2] += nz * push;
    if (!friction) return;
    // (Coulomb: what it's slid along the surface this substep, relative to the surface (turning with the figure),
    // taken back by as much as friction allows against how hard it was pushed)
    const sx = this.omega * z * h, sz = -this.omega * x * h;
    let tx = pos[i3] - prev[i3] - sx, ty = pos[i3 + 1] - prev[i3 + 1], tz = pos[i3 + 2] - prev[i3 + 2] - sz;
    const tn = tx * nx + ty * ny + tz * nz; tx -= nx * tn; ty -= ny * tn; tz -= nz * tn;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-9) return;
    const f = Math.min(1, (this.mu * push) / tl);
    pos[i3] -= tx * f; pos[i3 + 1] -= ty * f; pos[i3 + 2] -= tz * f;
  }

  // (cloth against itself: a spatial hash of cells a diameter across)
  private hashHead = new Int32Array(1 << 15); private hashNext = new Int32Array(0);
  private selfCollide() {
    const { pos, inv, piece, gi, gj, lone, rad } = this, n = this.n, cell = 1.6, M = (1 << 15) - 1;
    if (this.hashNext.length !== n) this.hashNext = new Int32Array(n);
    const head = this.hashHead, next = this.hashNext;
    head.fill(-1);
    const key = (x: number, y: number, z: number) => (Math.imul(x, 92837111) ^ Math.imul(y, 689287499) ^ Math.imul(z, 283923481)) & M;
    for (let i = 0; i < n; i++) { const k = key(Math.floor(pos[i * 3] / cell), Math.floor(pos[i * 3 + 1] / cell), Math.floor(pos[i * 3 + 2] / cell)); next[i] = head[k]; head[k] = i; }
    for (let i = 0; i < n; i++) {
      if (lone[i] || inv[i] === 0) continue;
      const i3 = i * 3, cx = Math.floor(pos[i3] / cell), cy = Math.floor(pos[i3 + 1] / cell), cz = Math.floor(pos[i3 + 2] / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        for (let j = head[key(cx + ox, cy + oy, cz + oz)]; j >= 0; j = next[j]) {
          if (j <= i || lone[j]) continue;
          // (neighbours on the same piece are already held apart by the cloth itself)
          if (piece[i] === piece[j] && Math.abs(gi[i] - gi[j]) <= 2 && Math.abs(gj[i] - gj[j]) <= 2) continue;
          const j3 = j * 3, dx = pos[j3] - pos[i3], dy = pos[j3 + 1] - pos[i3 + 1], dz = pos[j3 + 2] - pos[i3 + 2], dd = dx * dx + dy * dy + dz * dz;
          const rr = rad[i] + rad[j];
          if (dd >= rr * rr || dd < 1e-12) continue;
          const dl = Math.sqrt(dd), wi = inv[i], wj = inv[j], f = (dl - rr) / dl / (wi + wj);
          pos[i3] += dx * f * wi; pos[i3 + 1] += dy * f * wi; pos[i3 + 2] += dz * f * wi;
          pos[j3] -= dx * f * wj; pos[j3 + 1] -= dy * f * wj; pos[j3 + 2] -= dz * f * wj;
        }
      }
    }
  }

  /**
   * How sound the cloth is, beyond its stretch: what a stability verdict ought to look at.
   * - stretch: the 99th percentile and worst of every spring's strain; squash: the 1st percentile (in-plane
   *   compression real cloth would buckle out of rather than take);
   * - collapsed: the share of triangles squashed to under a tenth of their cut area;
   * - inside: how many points are inside the figure (more than 2 mm), and the deepest;
   * - seamGap: the widest any seam's still open (cm), once it's had time to be sewn.
   */
  health() {
    // (springs between two held points aren't simulated: a gathered or pleated edge is held squeezed into its band
    // on purpose)
    const live: number[] = [];
    let finite = true;
    for (let c = 0; c < this.la.length; c++) {
      if (this.inv[this.la[c]] === 0 && this.inv[this.lb[c]] === 0) continue;
      const v = dist(this.pos, this.la[c], this.lb[c]) / this.lr[c] - 1; if (!Number.isFinite(v)) finite = false; live.push(v);
    }
    const e = Float32Array.from(live).sort();
    const q = (f: number) => e[Math.min(e.length - 1, Math.floor(e.length * f))] ?? 0;
    let collapsed = 0;
    const { pos, flat, tris } = this;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      // (a triangle with two held corners is held to its shape (a pleat's fold held to one point of the band is meant to be flat))
      if ((this.inv[a] === 0 ? 1 : 0) + (this.inv[b] === 0 ? 1 : 0) + (this.inv[c] === 0 ? 1 : 0) >= 2) continue;
      const fa = Math.abs((flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]) - (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2])) / 2;
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const A = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      if (A < 0.1 * fa) collapsed++;
    }
    let inside = 0, deepest = 0;
    if (this.collider) {
      const cs = Math.cos(this.spin), sn = Math.sin(this.spin);
      for (let i = 0; i < this.n; i++) {
        if (this.inv[i] === 0) continue;
        const x = pos[i * 3], z = pos[i * 3 + 2], d = this.collider.distance(x * cs - z * sn, pos[i * 3 + 1], x * sn + z * cs, 1);
        if (d < -0.2) { inside++; deepest = Math.max(deepest, -d); }
      }
    }
    let seamGap = 0;
    for (let c = 0; c < this.sa.length; c++) seamGap = Math.max(seamGap, dist(pos, this.sa[c], this.sb[c]));
    return { finite, stretch99: q(0.99), stretchMax: e[e.length - 1] ?? 0, squash1: q(0.01), collapsed: collapsed / Math.max(1, tris.length / 3), inside, deepest, seamGap };
  }

  normals() {
    const { pos, nor, tris } = this;
    nor.fill(0);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nor[a] += nx; nor[a + 1] += ny; nor[a + 2] += nz; nor[b] += nx; nor[b + 1] += ny; nor[b + 2] += nz; nor[c] += nx; nor[c + 1] += ny; nor[c + 2] += nz;
    }
    for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
  }

  /** the worst stretch of any spring (0.02: 2% longer than cut), and whether anything's gone wrong */
  strain(): { max: number; p99: number; mean: number; ok: boolean } {
    let sum = 0, ok = true;
    const e = new Float32Array(this.la.length);
    for (let c = 0; c < this.la.length; c++) { e[c] = dist(this.pos, this.la[c], this.lb[c]) / this.lr[c] - 1; if (!Number.isFinite(e[c])) ok = false; sum += Math.abs(e[c]); }
    e.sort();
    return { max: e[e.length - 1] ?? 0, p99: e[Math.floor(e.length * 0.99)] ?? 0, mean: sum / Math.max(1, e.length), ok };
  }
}

const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];
const cross2 = (a: [number, number], b: [number, number]) => a[0] * b[1] - a[1] * b[0];
const dot2 = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];
const dist = (p: Float32Array, a: number, b: number) => Math.hypot(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]);
