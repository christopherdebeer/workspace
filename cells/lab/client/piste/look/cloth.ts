/**
 * Cloth: the jacket (its body, both loose sleeves, the hem) and the knickers, each a tube of particles solved by
 * position-based dynamics every frame. Stretch is held firmly and squash only lightly (so cloth buckles into folds
 * instead of shrinking), a weak skip-one bend keeps it from crumpling, gravity pulls it down, and each garment is held
 * where a garment is held: the collar, the shoulders' seams, the cuffs at the gauntlet, the waistband, the knee bands.
 * It rests on and slides off a body a little fuller than the bones (the body's capsules, inflated), so the jacket
 * drapes from the shoulders, the sleeve bunches at a bent elbow, the hem swings after a lunge and settles.
 *
 * Visual only: it is driven by the pose fencer.ts already computes and touches nothing in the bout. Its state is kept
 * per Fencer object (a replay's copy of a fencer has its own), stepped in the bout's time (bullet time slows it too),
 * and put back on the body, settled, whenever the fencer jumps (placed en garde, a replay starting).
 */
import type { Fencer } from '../fencer';
import { type V, add, cross, len, lerp, madd, norm, scale, sub } from '../v3';
import { around } from './mesh';

interface Ring { c: V; u: V; w: V; ru: number; rw: number }
interface Collider { a: V; b: V; ra: number; rb: number }
interface Spec {
  name: string; rows: number; cols: number;
  /** a weighted, stiffened hem: its last rows this much heavier (as gravity on them), held flatter along their length */
  hem?: number;
  /** the garment's shape on the body at t (0 its top .. 1 its bottom) */
  ring: (f: Fencer, t: number) => Ring;
  /** rows held to the body */
  pins: number[];
  /** what it can't go through */
  colliders: (f: Fencer) => Collider[];
  /** where its seams run (fractions of the way round from the ring's u axis) */
  seams: number[];
  /** how much longer than its rest shape it is along its length (loose sleeves bunch) */
  slack: number;
}

const G = 9.81, ITER = 3, STEP = 1 / 90;
const up: V = [0, 1, 0];

/** a point along a polyline of joints, by fraction of its length */
function along(pts: V[], t: number): { p: V; d: V } {
  const ls: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = len(sub(pts[i + 1], pts[i])); ls.push(l); total += l; }
  let s = t * total;
  for (let i = 0; i < ls.length; i++) {
    if (s <= ls[i] || i === ls.length - 1) { const k = ls[i] > 1e-6 ? Math.min(1, s / ls[i]) : 0; return { p: lerp(pts[i], pts[i + 1], k), d: norm(sub(pts[i + 1], pts[i])) }; }
    s -= ls[i];
  }
  return { p: pts[pts.length - 1], d: [0, -1, 0] };
}
/** interpolate a profile of [t, a, b] keys */
function prof(keys: [number, number, number][], t: number): [number, number] {
  for (let i = 0; i < keys.length - 1; i++) if (t <= keys[i + 1][0]) {
    const k = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
    return [keys[i][1] + (keys[i + 1][1] - keys[i][1]) * k, keys[i][2] + (keys[i + 1][2] - keys[i][2]) * k];
  }
  const l = keys[keys.length - 1]; return [l[1], l[2]];
}
const wrist = (f: Fencer) => madd(f.hand, norm(sub(f.elbowLook, f.hand)), 0.105);

const JACKET: Spec = {
  name: 'jacket', rows: 13, cols: 20, pins: [0, 1], slack: 1, hem: 2.2, seams: [0.25, 0.75, 0.5],
  ring(f, t) {
    const c = f.capsules, pelvis = c[0].a, chest = c[0].b, neck = c[1].b, spine = norm(sub(neck, pelvis));
    // (down the spine from the collar to the hem, below the hips)
    const top = madd(neck, spine, 0.025), hem = madd(pelvis, spine, -0.14);
    const p = t < 0.3 ? lerp(top, lerp(chest, neck, 0.35), t / 0.3) : lerp(lerp(chest, neck, 0.35), hem, (t - 0.3) / 0.7);
    const [u] = around(spine, f.frame.f), w = norm(cross(spine, u));
    const [ru, rw] = prof([[0, 0.078, 0.072], [0.1, 0.135, 0.105], [0.24, 0.215, 0.16], [0.45, 0.198, 0.168], [0.7, 0.182, 0.158], [0.88, 0.19, 0.165], [1, 0.192, 0.168]], t);
    return { c: madd(p, u, 0.012 * Math.min(1, t * 3)), u, w, ru, rw };
  },
  colliders(f) {
    const c = f.capsules;
    return [
      { a: c[0].a, b: c[0].b, ra: 0.158, rb: 0.163 }, { a: c[1].a, b: c[1].b, ra: 0.15, rb: 0.07 },
      { a: c[3].a, b: c[3].b, ra: 0.09, rb: 0.08 }, { a: f.shoulder, b: f.elbowLook, ra: 0.08, rb: 0.065 }, { a: c[7].a, b: c[7].b, ra: 0.075, rb: 0.06 },
      { a: c[9].a, b: c[9].b, ra: 0.115, rb: 0.09 }, { a: c[11].a, b: c[11].b, ra: 0.115, rb: 0.09 },
    ];
  },
};
const sleeve = (rear: boolean): Spec => ({
  name: rear ? 'rear sleeve' : 'sleeve', rows: 10, cols: 10, pins: [0, 9], slack: 1.07, seams: [0.5],
  ring(f, t) {
    const c = f.capsules, pts = rear ? [c[7].a, c[7].b, madd(c[8].b, norm(sub(c[8].a, c[8].b)), 0.04)] : [madd(f.shoulder, norm(sub(f.shoulder, f.elbowLook)), 0.02), f.elbowLook, wrist(f)];
    const { p, d } = along(pts, t), [u, w] = around(d, f.frame.u);
    const [r] = prof([[0, rear ? 0.088 : 0.094, 0], [0.45, rear ? 0.072 : 0.078, 0], [0.8, 0.064, 0], [1, 0.05, 0]], t);
    return { c: p, u, w, ru: r, rw: r * 0.94 };
  },
  colliders(f) {
    const c = f.capsules, k = rear ? 7 : 4;
    // (the weapon arm as it's drawn: the elbow tucked under the forearm)
    const [ua, ub, fa, fb] = rear ? [c[k].a, c[k].b, c[k + 1].a, c[k + 1].b] : [f.shoulder, f.elbowLook, f.elbowLook, f.hand];
    return [{ a: ua, b: ub, ra: 0.062, rb: 0.052 }, { a: fa, b: fb, ra: 0.05, rb: 0.042 }, { a: c[0].a, b: c[0].b, ra: 0.158, rb: 0.163 }];
  },
});
const knickers = (rear: boolean): Spec => ({
  name: rear ? 'rear leg' : 'leg', rows: 8, cols: 10, pins: [0, 7], slack: 1.04, seams: [0.25],
  ring(f, t) {
    const c = f.capsules, th = c[rear ? 11 : 9], sh = c[rear ? 12 : 10];
    const band = lerp(sh.a, sh.b, 0.17), pts = [madd(th.a, up, 0.07), th.b, band];
    const { p, d } = along(pts, t), [u, w] = around(d, f.frame.f);
    const [r] = prof([[0, 0.122, 0], [0.35, 0.112, 0], [0.75, 0.088, 0], [1, 0.076, 0]], t);
    return { c: p, u, w, ru: r, rw: r * 0.92 };
  },
  colliders(f) {
    const c = f.capsules, k = rear ? 11 : 9;
    return [{ a: c[k].a, b: c[k].b, ra: 0.095, rb: 0.068 }, { a: c[k + 1].a, b: c[k + 1].b, ra: 0.064, rb: 0.05 }, { a: c[0].a, b: c[0].a, ra: 0.15, rb: 0.15 }];
  },
});
export const GARMENTS: Spec[] = [JACKET, sleeve(false), sleeve(true), knickers(false), knickers(true)];

/** one garment on one fencer */
export class Garment {
  readonly n: number;
  x: Float32Array; p: Float32Array;
  /** constraints: pairs, rest lengths, how firmly squash is resisted */
  ci: Int32Array; cr: Float32Array; cs: Float32Array;
  /** each particle's place in the fabric (m across, m along), its distance to a seam (m) */
  fu: Float32Array; fv: Float32Array; seam: Float32Array;
  /** per frame: normals, and how shut in each point is (contact with the body, inside a fold) */
  nrm: Float32Array; shade: Float32Array;

  constructor(readonly spec: Spec, f: Fencer) {
    const { rows, cols } = spec;
    this.n = rows * cols;
    this.x = new Float32Array(this.n * 3); this.p = new Float32Array(this.n * 3);
    this.nrm = new Float32Array(this.n * 3); this.shade = new Float32Array(this.n);
    this.fu = new Float32Array(this.n); this.fv = new Float32Array(this.n); this.seam = new Float32Array(this.n);
    this.place(f);
    // constraints from the shape it's made in: round (structural), down, the two diagonals (shear), skip-one (bend)
    const ci: number[] = [], cr: number[] = [], cs: number[] = [];
    const id = (i: number, j: number) => i * cols + ((j + cols) % cols);
    const add2 = (a: number, b: number, squash: number, slack = 1) => {
      ci.push(a, b);
      cr.push(Math.hypot(this.x[a * 3] - this.x[b * 3], this.x[a * 3 + 1] - this.x[b * 3 + 1], this.x[a * 3 + 2] - this.x[b * 3 + 2]) * slack);
      cs.push(squash);
    };
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      add2(id(i, j), id(i, j + 1), 0.7);
      if (i < rows - 1) { add2(id(i, j), id(i + 1, j), 0.5, spec.slack); add2(id(i, j), id(i + 1, j + 1), 0.3, spec.slack); add2(id(i, j + 1), id(i + 1, j), 0.3, spec.slack); }
      if (i < rows - 2) add2(id(i, j), id(i + 2, j), 0.14, spec.slack);
      add2(id(i, j), id(i, j + 2), 0.2);
      // (a hem: stiff round its length, so it swings as a band instead of flaring)
      if (spec.hem && i >= rows - 2) { add2(id(i, j), id(i, j + 2), 0.9); add2(id(i, j), id(i, j + 3), 0.6); if (i < rows - 1) add2(id(i, j), id(i + 1, j), 0.9, spec.slack); }
    }
    this.ci = Int32Array.from(ci); this.cr = Float32Array.from(cr); this.cs = Float32Array.from(cs);
    // the fabric's own coordinates, and its seams
    let vAcc = 0;
    for (let i = 0; i < rows; i++) {
      const ring = spec.ring(f, i / (rows - 1)), circ = Math.PI * (ring.ru + ring.rw);
      if (i > 0) vAcc += len(sub(spec.ring(f, i / (rows - 1)).c, spec.ring(f, (i - 1) / (rows - 1)).c)) * spec.slack;
      for (let j = 0; j < cols; j++) {
        const k = i * cols + j, fr = j / cols;
        this.fu[k] = fr * circ; this.fv[k] = vAcc;
        let d = 1;
        for (const s of spec.seams) { const dd = Math.abs(fr - s); d = Math.min(d, dd, 1 - dd); }
        this.seam[k] = d * circ;
      }
    }
  }

  /** the garment on the body in its made shape, at rest */
  place(f: Fencer) {
    const { rows, cols } = this.spec;
    for (let i = 0; i < rows; i++) {
      const r = this.spec.ring(f, i / (rows - 1));
      for (let j = 0; j < cols; j++) {
        const a = (j / cols) * Math.PI * 2, q = add(r.c, add(scale(r.u, Math.cos(a) * r.ru), scale(r.w, Math.sin(a) * r.rw))), k = (i * cols + j) * 3;
        this.x[k] = this.p[k] = q[0]; this.x[k + 1] = this.p[k + 1] = q[1]; this.x[k + 2] = this.p[k + 2] = q[2];
      }
    }
  }

  /** run on by dt (s) with the body as it is now */
  step(f: Fencer, dt: number) {
    const { rows, cols, pins } = this.spec, x = this.x, p = this.p;
    // where the held rows are now
    const held: { k: number; q: V }[] = [];
    for (const i of pins) {
      const r = this.spec.ring(f, i / (rows - 1));
      for (let j = 0; j < cols; j++) { const a = (j / cols) * Math.PI * 2; held.push({ k: (i * cols + j) * 3, q: add(r.c, add(scale(r.u, Math.cos(a) * r.ru), scale(r.w, Math.sin(a) * r.rw))) }); }
    }
    const cols_ = this.spec.colliders(f);
    const n = Math.min(4, Math.max(1, Math.ceil(dt / STEP))), h = dt / n, damp = Math.pow(0.22, h);
    const hemFrom = this.spec.hem ? (rows - 2) * cols * 3 : x.length, hemG = this.spec.hem ?? 1;
    for (let s = 0; s < n; s++) {
      for (let k = 0; k < x.length; k += 3) {
        const vx = (x[k] - p[k]) * damp, vy = (x[k + 1] - p[k + 1]) * damp, vz = (x[k + 2] - p[k + 2]) * damp;
        p[k] = x[k]; p[k + 1] = x[k + 1]; p[k + 2] = x[k + 2];
        x[k] += vx; x[k + 1] += vy - G * h * h * (k >= hemFrom ? hemG : 1); x[k + 2] += vz;
      }
      // (the held rows follow the body over the substeps)
      const blend = (s + 1) / n;
      for (let it = 0; it < ITER; it++) {
        for (const { k, q } of held) { x[k] += (q[0] - x[k]) * blend; x[k + 1] += (q[1] - x[k + 1]) * blend; x[k + 2] += (q[2] - x[k + 2]) * blend; }
        this.solve();
        collide(x, cols_);
      }
    }
    this.finish(cols_);
  }

  private solve() {
    const { x, ci, cr, cs } = this;
    for (let c = 0, m = cr.length; c < m; c++) {
      const a = ci[c * 2] * 3, b = ci[c * 2 + 1] * 3;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-7) continue;
      const diff = (d - cr[c]) / d, k = diff > 0 ? 0.5 : 0.5 * cs[c];
      const sx = dx * diff * k, sy = dy * diff * k, sz = dz * diff * k;
      x[a] += sx; x[a + 1] += sy; x[a + 2] += sz; x[b] -= sx; x[b + 1] -= sy; x[b + 2] -= sz;
    }
  }

  /** normals; and how shut in each point is: near the body (contact), inside a fold (the fold shading) */
  private finish(cs: Collider[]) {
    const { rows, cols } = this.spec, x = this.x, nr = this.nrm, sh = this.shade;
    const id = (i: number, j: number) => (Math.min(rows - 1, Math.max(0, i)) * cols + ((j + cols) % cols)) * 3;
    for (let i = 0; i < rows; i++) {
      // (the row's middle, to turn every normal outward)
      let mx = 0, my = 0, mz = 0;
      for (let j = 0; j < cols; j++) { const k = (i * cols + j) * 3; mx += x[k]; my += x[k + 1]; mz += x[k + 2]; }
      mx /= cols; my /= cols; mz /= cols;
      for (let j = 0; j < cols; j++) {
        const k = (i * cols + j) * 3, r = id(i, j + 1), l = id(i, j - 1), d = id(i + 1, j), u = id(i - 1, j);
        const ax = x[r] - x[l], ay = x[r + 1] - x[l + 1], az = x[r + 2] - x[l + 2];
        const bx = x[d] - x[u], by = x[d + 1] - x[u + 1], bz = x[d + 2] - x[u + 2];
        let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const ln = Math.hypot(nx, ny, nz) || 1; nx /= ln; ny /= ln; nz /= ln;
        if (nx * (x[k] - mx) + ny * (x[k + 1] - my) + nz * (x[k + 2] - mz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
        nr[k] = nx; nr[k + 1] = ny; nr[k + 2] = nz;
        // a fold: the point sits in from its neighbours' average (along its normal)
        const ax2 = (x[r] + x[l] + x[d] + x[u]) / 4 - x[k], ay2 = (x[r + 1] + x[l + 1] + x[d + 1] + x[u + 1]) / 4 - x[k + 1], az2 = (x[r + 2] + x[l + 2] + x[d + 2] + x[u + 2]) / 4 - x[k + 2];
        const fold = Math.max(0, (ax2 * nx + ay2 * ny + az2 * nz) * 22);
        // contact: how near the body's surface it lies
        let gap = 1;
        for (const c of cs) gap = Math.min(gap, surfaceGap(x, k, c));
        const contact = 1 - Math.max(0, 1 - gap / 0.025);
        sh[k / 3] = Math.max(0.6, 1 - 0.32 * Math.min(1, fold) - 0.12 * (1 - contact));
      }
    }
  }
}

function surfaceGap(x: Float32Array, k: number, c: Collider) {
  const abx = c.b[0] - c.a[0], aby = c.b[1] - c.a[1], abz = c.b[2] - c.a[2], l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-9 ? ((x[k] - c.a[0]) * abx + (x[k + 1] - c.a[1]) * aby + (x[k + 2] - c.a[2]) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x[k] - c.a[0] - abx * t, dy = x[k + 1] - c.a[1] - aby * t, dz = x[k + 2] - c.a[2] - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (c.ra + (c.rb - c.ra) * t);
}
/** nothing inside the body: each point pushed out to the nearest surface */
function collide(x: Float32Array, cs: Collider[]) {
  for (const c of cs) {
    const abx = c.b[0] - c.a[0], aby = c.b[1] - c.a[1], abz = c.b[2] - c.a[2], l2 = abx * abx + aby * aby + abz * abz;
    for (let k = 0; k < x.length; k += 3) {
      let t = l2 > 1e-9 ? ((x[k] - c.a[0]) * abx + (x[k + 1] - c.a[1]) * aby + (x[k + 2] - c.a[2]) * abz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = c.a[0] + abx * t, py = c.a[1] + aby * t, pz = c.a[2] + abz * t;
      const dx = x[k] - px, dy = x[k + 1] - py, dz = x[k + 2] - pz, d = Math.sqrt(dx * dx + dy * dy + dz * dz), r = c.ra + (c.rb - c.ra) * t;
      if (d < r && d > 1e-6) { const s = r / d; x[k] = px + dx * s; x[k + 1] = py + dy * s; x[k + 2] = pz + dz * s; }
    }
  }
}

/** A fencer's wardrobe: their garments, and when they were last stepped (and where, to see a jump). */
export class Wardrobe {
  garments: Garment[];
  private t = -1; private at: V = [0, 0, 0];
  constructor(f: Fencer) { this.garments = GARMENTS.map((s) => new Garment(s, f)); this.settle(f); }
  /** on the body again, and let it hang a moment */
  settle(f: Fencer) { for (const g of this.garments) { g.place(f); for (let i = 0; i < 12; i++) g.step(f, 1 / 60); } }
  /** run on to the bout's time t */
  update(f: Fencer, t: number) {
    const pelvis = f.capsules[0].a, jump = len(sub(pelvis, this.at));
    const dt = t - this.t;
    if (this.t < 0 || dt < -1e-6 || jump > 0.35 || dt > 0.5) this.settle(f);
    else if (dt > 1e-6) for (const g of this.garments) g.step(f, Math.min(dt, 1 / 24));
    this.t = t; this.at = [...pelvis] as V;
  }
}
