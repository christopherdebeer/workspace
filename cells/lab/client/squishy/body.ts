/**
 * Squishy: the dumpling, a soft body.
 *
 * A dumpling is a skin of particles (its mesh's own vertices) held to its shape by shape
 * matching (Müller et al., 2005): each small step the particles' best-fit rotation and best-fit
 * stretch are found, and every particle is drawn a little toward where that shape would put
 * it. The stretch is let in part (kept to its volume), so it squashes when it lands, bulges
 * out at the sides, and wobbles back; the pull is soft enough to see, a few wobbles a second,
 * and damped. Each particle meets the course on its own, so a corner dents it and a floor
 * flattens its bottom, with Coulomb friction, the surface's own bounce and movement, and tack:
 * dough sticks, for a moment, even to a wall. Its momentum is its own, so in the air its middle
 * flies a plain parabola: the aiming line shows where it will go.
 */
import { G, RADIUS, near, touch, type Hit, type Level, type Shape, type V3 } from './level';

/** small steps a frame */
export const SUB = 10;
/** each particle's skin: how far from a surface it stops */
export const SKIN = 0.22;
/** how quickly it springs back to its shape (wobbles a second), and how little each wobble keeps */
const HZ = 9, ZETA = 0.14;
/** how much of its volume it keeps each step (it squashes out sideways rather than in), and how fast a roll dies on the ground (/s) */
const KEEP = 0.9, ROLL = 30;
/** on the ground it rights itself, like a roly-poly: how fast it turns back upright (rad/s at a right angle) */
const RIGHT = 9;
/** how fast it shuffles round to face you, at most (radians a second) */
const TURN = 4;
/** how much squash and stretch it takes (the rest held to its shape) */
const BETA = 0.25;
/** dough's tack: how hard it holds what it touches (cm/s²), and how near counts as touching */
const TACK = 900, STICK = 0.35;

/** The dumpling's rest shape: a round body with a flatter bottom, gathered at the top in pleats that twist to a knot. */
export function dumplingRest(rings = 16, segs = 28): { pos: Float32Array; tris: Uint16Array } {
  const R = RADIUS;
  const at = (h: number, r: number, th: number): V3 => {
    const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    let y = h < 0 ? h * 0.6 : h * 0.8;
    let rr = r * (h < 0 ? 1.12 : 1.12 - 0.38 * h * h);
    const pleat = sm(0.05, 0.7, h) * (1 - sm(0.88, 1, h)) * 0.1;
    rr *= 1 + pleat * Math.cos(12 * th + 4 * h);
    if (h > 0.8) y += (h - 0.8) * 0.9;
    return [Math.cos(th) * rr * R, y * R, Math.sin(th) * rr * R];
  };
  const pts: V3[] = [at(-1, 0, 0)];
  for (let i = 1; i <= rings; i++) {
    const phi = (i / (rings + 1)) * Math.PI;
    for (let j = 0; j < segs; j++) pts.push(at(-Math.cos(phi), Math.sin(phi), (j / segs) * Math.PI * 2));
  }
  pts.push(at(1, 0, 0));
  const top = pts.length - 1;
  const tris: number[] = [];
  const ring = (i: number, j: number) => 1 + (i - 1) * segs + (((j % segs) + segs) % segs);
  for (let j = 0; j < segs; j++) tris.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j + 1), d = ring(i + 1, j);
    tris.push(a, d, c, a, c, b);
  }
  for (let j = 0; j < segs; j++) tris.push(top, ring(rings, j + 1), ring(rings, j));
  // (each triangle turned to face out)
  const cx = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [pts[tris[k]], pts[tris[k + 1]], pts[tris[k + 2]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 - cx, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { const t = tris[k + 1]; tris[k + 1] = tris[k + 2]; tris[k + 2] = t; }
  }
  return { pos: new Float32Array(pts.flat()), tris: new Uint16Array(tris) };
}

const qmul = (a: number[], b: number[]) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function qmat(q: number[], m: Float64Array) {
  const [x, y, z, w] = q;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * w); m[2] = 2 * (x * z + y * w);
  m[3] = 2 * (x * y + z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - x * w);
  m[6] = 2 * (x * z - y * w); m[7] = 2 * (y * z + x * w); m[8] = 1 - 2 * (x * x + y * y);
}
/** The rotation nearest A (row-major), from the last one: a few steps of Müller, Bender et al.'s 2016 iteration. */
function rotationOf(A: Float64Array, q: number[], R: Float64Array, iters = 4) {
  for (let it = 0; it < iters; it++) {
    qmat(q, R);
    let ox = 0, oy = 0, oz = 0, d = 0;
    for (let j = 0; j < 3; j++) {
      const rx = R[j], ry = R[3 + j], rz = R[6 + j], ax = A[j], ay = A[3 + j], az = A[6 + j];
      ox += ry * az - rz * ay; oy += rz * ax - rx * az; oz += rx * ay - ry * ax;
      d += rx * ax + ry * ay + rz * az;
    }
    const s = 1 / (Math.abs(d) + 1e-9);
    ox *= s; oy *= s; oz *= s;
    const w = Math.hypot(ox, oy, oz);
    if (w < 1e-9) break;
    const h = Math.sin(w / 2) / w;
    const nq = qmul([ox * h, oy * h, oz * h, Math.cos(w / 2)], q);
    const l = Math.hypot(nq[0], nq[1], nq[2], nq[3]);
    q[0] = nq[0] / l; q[1] = nq[1] / l; q[2] = nq[2] / l; q[3] = nq[3] / l;
  }
  qmat(q, R);
}
function inv3(m: Float64Array, o: Float64Array) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  o[0] = A / det; o[1] = -(b * i - c * h) / det; o[2] = (b * f - c * e) / det;
  o[3] = B / det; o[4] = (a * i - c * g) / det; o[5] = -(a * f - c * d) / det;
  o[6] = C / det; o[7] = -(a * h - b * g) / det; o[8] = (a * e - b * d) / det;
}
const det3 = (m: Float64Array) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

export class Dumpling {
  n: number;
  tris: Uint16Array;
  /** where each particle is, how fast it goes, where it's going this step */
  x: Float32Array;
  v: Float32Array;
  p: Float32Array;
  /** each particle's place in the rest shape, about its middle */
  q: Float32Array;
  private aqqInv = new Float64Array(9);
  private quat = [0, 0, 0, 1];
  /** its turn and its squash, as last matched (row-major) */
  R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  A = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  com: V3 = [0, 0, 0];
  vcom: V3 = [0, 0, 0];
  restVolume: number;
  // touching, per particle: normal, depth pushed out this step, grip, bounce, surface velocity, normal speed coming in, and how (0 not, 1 touching, 2 near)
  private cn: Float32Array;
  private cd: Float32Array;
  private cmu: Float32Array;
  private cb: Float32Array;
  private cvs: Float32Array;
  private cv0: Float32Array;
  private cf: Uint8Array;
  private nearby: Shape[] = [];
  private hit: Hit = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
  /** how much tack is left (dough tires of holding a wall), seconds since it touched anything, since it was flicked */
  tack = 1;
  sinceContact = 9;
  sinceFlick = 9;
  /** particles touching, and whether any is on something steep */
  contacts = 0;
  onWall = false;
  /** the hardest it hit anything this frame (cm/s), and how far from its shape it is */
  impact = 0;
  deform = 0;
  /** being wound up for a flick: squeezed along a way, so much */
  squeeze: { d: V3; k: number } | null = null;
  /** which way it would like its face to look when it's sat still (a direction in the ground's plane), if any */
  look: V3 | null = null;

  constructor(at: V3) {
    const s = dumplingRest();
    this.n = s.pos.length / 3;
    this.tris = s.tris;
    const n = this.n;
    this.x = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.p = new Float32Array(n * 3); this.q = new Float32Array(n * 3);
    this.cn = new Float32Array(n * 3); this.cd = new Float32Array(n); this.cmu = new Float32Array(n); this.cb = new Float32Array(n);
    this.cvs = new Float32Array(n * 3); this.cv0 = new Float32Array(n); this.cf = new Uint8Array(n);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += s.pos[i * 3]; cy += s.pos[i * 3 + 1]; cz += s.pos[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const aqq = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      const q0 = s.pos[i * 3] - cx, q1 = s.pos[i * 3 + 1] - cy, q2 = s.pos[i * 3 + 2] - cz;
      this.q[i * 3] = q0; this.q[i * 3 + 1] = q1; this.q[i * 3 + 2] = q2;
      aqq[0] += q0 * q0; aqq[1] += q0 * q1; aqq[2] += q0 * q2; aqq[4] += q1 * q1; aqq[5] += q1 * q2; aqq[8] += q2 * q2;
    }
    aqq[3] = aqq[1]; aqq[6] = aqq[2]; aqq[7] = aqq[5];
    inv3(aqq, this.aqqInv);
    this.place(at);
    this.restVolume = this.volume();
  }
  /** At rest at a place (its middle there), upright, still. */
  place(at: V3) {
    for (let i = 0; i < this.n * 3; i++) { this.x[i] = at[i % 3] + this.q[i]; this.v[i] = 0; }
    this.quat = [0, 0, 0, 1];
    this.R.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.A.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.com = [...at] as V3;
    this.vcom = [0, 0, 0];
    this.tack = 1; this.sinceContact = 0; this.sinceFlick = 9; this.squeeze = null;
  }
  /** Whether it can be flicked: touching something (or only just off it), and not just flicked. */
  get canFlick() { return this.sinceContact < 0.2 && this.sinceFlick > 0.25; }
  /** Flicked: its middle goes at vel, a little of its wobble kept, a little roll forward. */
  flick(vel: V3) {
    const h = Math.hypot(vel[0], vel[2]) || 1;
    const wx = (vel[2] / h) * 2, wz = (-vel[0] / h) * 2;
    for (let i = 0; i < this.n; i++) {
      const rx = this.x[i * 3] - this.com[0], ry = this.x[i * 3 + 1] - this.com[1], rz = this.x[i * 3 + 2] - this.com[2];
      this.v[i * 3] = vel[0] + (this.v[i * 3] - this.vcom[0]) * 0.25 + (-wz * ry);
      this.v[i * 3 + 1] = vel[1] + (this.v[i * 3 + 1] - this.vcom[1]) * 0.25 + (wz * rx - wx * rz);
      this.v[i * 3 + 2] = vel[2] + (this.v[i * 3 + 2] - this.vcom[2]) * 0.25 + (wx * ry);
    }
    this.vcom = [...vel] as V3;
    this.tack = 0; this.sinceFlick = 0; this.squeeze = null;
  }
  /** Its volume (the skin's enclosed volume). */
  volume(x = this.x): number {
    let v = 0;
    const t = this.tris;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      v += x[a] * (x[b + 1] * x[c + 2] - x[b + 2] * x[c + 1]) - x[a + 1] * (x[b] * x[c + 2] - x[b + 2] * x[c]) + x[a + 2] * (x[b] * x[c + 1] - x[b + 1] * x[c]);
    }
    return v / 6;
  }
  /** How tall it stands now (top to bottom). */
  height(): number {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.n; i++) { const y = this.x[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
    return hi - lo;
  }

  /** The particles drawn toward the shape that best fits them (turned, partly squashed, kept to its volume). */
  private match(p: Float32Array, alpha: number) {
    const n = this.n, q = this.q;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const apq = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      const d0 = p[i * 3] - cx, d1 = p[i * 3 + 1] - cy, d2 = p[i * 3 + 2] - cz;
      const q0 = q[i * 3], q1 = q[i * 3 + 1], q2 = q[i * 3 + 2];
      apq[0] += d0 * q0; apq[1] += d0 * q1; apq[2] += d0 * q2;
      apq[3] += d1 * q0; apq[4] += d1 * q1; apq[5] += d1 * q2;
      apq[6] += d2 * q0; apq[7] += d2 * q1; apq[8] += d2 * q2;
    }
    rotationOf(apq, this.quat, this.R);
    // the stretch that fits best, kept to its volume
    const A = this.A, ai = this.aqqInv, R = this.R;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r * 3 + c] = apq[r * 3] * ai[c] + apq[r * 3 + 1] * ai[3 + c] + apq[r * 3 + 2] * ai[6 + c];
    const det = det3(A);
    if (det > 1e-6) { const s = 1 / Math.cbrt(det); for (let k = 0; k < 9; k++) A[k] *= s; } else A.set(R);
    const T = new Float64Array(9);
    for (let k = 0; k < 9; k++) T[k] = BETA * A[k] + (1 - BETA) * R[k];
    // (wound up for a flick: squeezed along the way it will go, and wider across, at the same volume)
    if (this.squeeze) {
      const [dx, dy, dz] = this.squeeze.d, k = this.squeeze.k;
      const sd = 1 - 0.38 * k, sp = 1 / Math.sqrt(sd);
      const D = [dx * dx, dx * dy, dx * dz, dy * dx, dy * dy, dy * dz, dz * dx, dz * dy, dz * dz];
      const S = new Float64Array(9);
      for (let k2 = 0; k2 < 9; k2++) S[k2] = (k2 % 4 === 0 ? sp : 0) + (sd - sp) * D[k2];
      const T2 = new Float64Array(9);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T2[r * 3 + c] = S[r * 3] * T[c] + S[r * 3 + 1] * T[3 + c] + S[r * 3 + 2] * T[6 + c];
      T.set(T2);
    }
    let dev = 0;
    for (let i = 0; i < n; i++) {
      const q0 = q[i * 3], q1 = q[i * 3 + 1], q2 = q[i * 3 + 2];
      const gx = cx + T[0] * q0 + T[1] * q1 + T[2] * q2, gy = cy + T[3] * q0 + T[4] * q1 + T[5] * q2, gz = cz + T[6] * q0 + T[7] * q1 + T[8] * q2;
      const ex = gx - p[i * 3], ey = gy - p[i * 3 + 1], ez = gz - p[i * 3 + 2];
      dev += ex * ex + ey * ey + ez * ez;
      p[i * 3] += ex * alpha; p[i * 3 + 1] += ey * alpha; p[i * 3 + 2] += ez * alpha;
    }
    this.deform = Math.sqrt(dev / n) / RADIUS;
  }

  /**
   * Its volume kept (most of the way, each step): every particle moved along the volume's
   * gradient there (the skin's outward normal, weighted by the area about it) by one amount.
   */
  private grad = new Float32Array(0);
  private keepVolume(p: Float32Array) {
    const n = this.n, t = this.tris;
    if (this.grad.length !== n * 3) this.grad = new Float32Array(n * 3);
    const g = this.grad;
    g.fill(0);
    let vol = 0;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2], bx = p[b], by = p[b + 1], bz = p[b + 2], cx = p[c], cy = p[c + 1], cz = p[c + 2];
      vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      g[a] += by * cz - bz * cy; g[a + 1] += bz * cx - bx * cz; g[a + 2] += bx * cy - by * cx;
      g[b] += cy * az - cz * ay; g[b + 1] += cz * ax - cx * az; g[b + 2] += cx * ay - cy * ax;
      g[c] += ay * bz - az * by; g[c + 1] += az * bx - ax * bz; g[c + 2] += ax * by - ay * bx;
    }
    vol /= 6;
    let w = 0;
    for (let i = 0; i < n * 3; i++) { g[i] /= 6; w += g[i] * g[i]; }
    const lam = (KEEP * (this.restVolume - vol)) / (w || 1);
    for (let i = 0; i < n * 3; i++) p[i] += g[i] * lam;
  }

  /** A frame: SUB small steps of falling, keeping its shape, meeting the course, friction and tack. */
  step(lv: Level, dt: number, time: number) {
    const n = this.n, h = dt / SUB;
    const { x, v, p, cn, cd, cmu, cb, cvs, cv0, cf } = this;
    const w0 = 2 * Math.PI * HZ;
    const alpha = Math.min(0.5, (w0 * h) ** 2);
    const damp = 2 * ZETA * w0 * h;
    const speed = Math.hypot(...this.vcom);
    near(lv, this.com, RADIUS * 1.8 + speed * dt + 1, this.nearby);
    const o = this.hit;
    let contacts = 0, wall = false, impact = 0;
    const tackOn = this.sinceFlick > 0.12;
    for (let s = 0; s < SUB; s++) {
      const t = time + s * h;
      for (let i = 0; i < n * 3; i++) {
        if (i % 3 === 1) v[i] -= G * h;
        p[i] = x[i] + v[i] * h;
      }
      this.match(p, alpha);
      this.keepVolume(p);
      // each particle against the course
      for (let i = 0; i < n; i++) {
        cf[i] = 0; cd[i] = 0;
        const i3 = i * 3;
        for (const sh of this.nearby) {
          if (!touch(sh, p[i3], p[i3 + 1], p[i3 + 2], SKIN, o, STICK)) continue;
          if (o.d > 0) {
            p[i3] += o.nx * o.d; p[i3 + 1] += o.ny * o.d; p[i3 + 2] += o.nz * o.d;
            const vn = (v[i3] - o.vx) * o.nx + (v[i3 + 1] - o.vy) * o.ny + (v[i3 + 2] - o.vz) * o.nz;
            if (cf[i] !== 1 || o.d > cd[i]) {
              cn[i3] = o.nx; cn[i3 + 1] = o.ny; cn[i3 + 2] = o.nz;
              cmu[i] = sh.mu; cb[i] = sh.bounce; cvs[i3] = o.vx; cvs[i3 + 1] = o.vy; cvs[i3 + 2] = o.vz; cv0[i] = vn;
            }
            cd[i] += o.d;
            cf[i] = 1;
          } else if (cf[i] === 0) {
            cn[i3] = o.nx; cn[i3 + 1] = o.ny; cn[i3 + 2] = o.nz;
            cmu[i] = sh.mu; cb[i] = 0; cvs[i3] = o.vx; cvs[i3 + 1] = o.vy; cvs[i3 + 2] = o.vz; cv0[i] = 0;
            cf[i] = 2;
          }
        }
      }
      // its middle against the course, as a ball (so no edge spears it between particles)
      {
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
        cx /= n; cy /= n; cz /= n;
        for (const sh of this.nearby) if (touch(sh, cx, cy, cz, RADIUS * 0.5, o) && o.d > 0) {
          for (let i = 0; i < n; i++) { p[i * 3] += o.nx * o.d; p[i * 3 + 1] += o.ny * o.d; p[i * 3 + 2] += o.nz * o.d; }
          cx += o.nx * o.d; cy += o.ny * o.d; cz += o.nz * o.d;
        }
      }
      // velocities from where they went; friction, bounce and tack where they touch
      let vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        let nvx = (p[i3] - x[i3]) / h, nvy = (p[i3 + 1] - x[i3 + 1]) / h, nvz = (p[i3 + 2] - x[i3 + 2]) / h;
        if (cf[i]) {
          const nx = cn[i3], ny = cn[i3 + 1], nz = cn[i3 + 2], sx = cvs[i3], sy = cvs[i3 + 1], sz = cvs[i3 + 2];
          let rx = nvx - sx, ry = nvy - sy, rz = nvz - sz;
          let vn = rx * nx + ry * ny + rz * nz;
          let tx = rx - nx * vn, ty = ry - ny * vn, tz = rz - nz * vn;
          let dvn = cf[i] === 1 ? cd[i] / h : 0;
          if (cf[i] === 1) {
            contacts++;
            if (ny < 0.5) wall = true;
            if (-cv0[i] > impact) impact = -cv0[i];
            if (cb[i] > 0 && cv0[i] < -40) vn = Math.max(vn, -cv0[i] * cb[i]);
          }
          // (dough's tack: drawn to what it touches, unless it's leaving it fast)
          if (tackOn && this.tack > 0 && vn < 60) { const a = TACK * this.tack * h; vn -= a; dvn += a; }
          const tm = Math.hypot(tx, ty, tz), lim = cmu[i] * dvn;
          const k = tm <= lim ? 0 : 1 - lim / tm;
          tx *= k; ty *= k; tz *= k;
          nvx = sx + nx * vn + tx; nvy = sy + ny * vn + ty; nvz = sz + nz * vn + tz;
        }
        v[i3] = nvx; v[i3 + 1] = nvy; v[i3 + 2] = nvz;
        x[i3] = p[i3]; x[i3 + 1] = p[i3 + 1]; x[i3 + 2] = p[i3 + 2];
        vx += nvx; vy += nvy; vz += nvz;
      }
      vx /= n; vy /= n; vz /= n;
      // its wobble damped: each particle's velocity drawn toward the body's own (its middle's, and
      // its turning); and on the ground, its roll dies (dough plops, and stays)
      this.dampWobble(vx, vy, vz, damp, contacts > 0 && this.sinceFlick > 0.12 ? ROLL * h : 0);
    }
    // the middle, the speed, and how it's touching
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; vx += v[i * 3]; vy += v[i * 3 + 1]; vz += v[i * 3 + 2]; }
    this.com = [cx / n, cy / n, cz / n];
    this.vcom = [vx / n, vy / n, vz / n];
    this.contacts = Math.round(contacts / SUB);
    this.onWall = wall;
    this.impact = impact;
    this.sinceContact = contacts > 0 ? 0 : this.sinceContact + dt;
    this.sinceFlick += dt;
    // tack tires on a wall; comes back in the air and on the flat
    if (wall) this.tack = Math.max(0, this.tack - dt * 0.9);
    else if (contacts === 0 || this.sinceFlick > 0.3) this.tack = Math.min(1, this.tack + dt * 1.5);
    this.shuffle(dt, contacts > 0);
  }
  /**
   * Sat still and upright, it shuffles round on its bottom to look where it's asked to (its face is
   * its rest shape's +z): the whole of it turned a little about its middle's upright, as dough would
   * by little hops, not spun against the friction under it.
   */
  private shuffle(dt: number, grounded: boolean) {
    const R = this.R, look = this.look;
    if (!look || !grounded || this.sinceFlick < 0.4 || R[4] < 0.8 || Math.hypot(...this.vcom) > 20) return;
    const fx = R[2], fz = R[8];
    const a = Math.atan2(fx * look[2] - fz * look[0], fx * look[0] + fz * look[2]);
    const th = -Math.sign(a) * Math.min(Math.abs(a) * 5, TURN) * dt;
    if (Math.abs(th) < 1e-5) return;
    const c = Math.cos(th), s = Math.sin(th), [cx, , cz] = this.com, x = this.x, v = this.v;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, dx = x[i3] - cx, dz = x[i3 + 2] - cz, vx = v[i3], vz = v[i3 + 2];
      x[i3] = cx + c * dx + s * dz; x[i3 + 2] = cz - s * dx + c * dz;
      v[i3] = c * vx + s * vz; v[i3 + 2] = -s * vx + c * vz;
    }
    const q = this.quat, nq = qmul([0, Math.sin(th / 2), 0, Math.cos(th / 2)], q);
    q[0] = nq[0]; q[1] = nq[1]; q[2] = nq[2]; q[3] = nq[3];
    qmat(q, R);
  }
  /** Damp what isn't the body moving as one: each particle's velocity drawn toward its middle's and its turning. */
  private dampWobble(vx: number, vy: number, vz: number, c: number, roll: number) {
    const n = this.n, x = this.x, v = this.v;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    // angular momentum and inertia about the middle; its turning ω = I⁻¹ L
    let lx = 0, ly = 0, lz = 0;
    const I = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const ux = v[i * 3] - vx, uy = v[i * 3 + 1] - vy, uz = v[i * 3 + 2] - vz;
      lx += ry * uz - rz * uy; ly += rz * ux - rx * uz; lz += rx * uy - ry * ux;
      const r2 = rx * rx + ry * ry + rz * rz;
      I[0] += r2 - rx * rx; I[1] -= rx * ry; I[2] -= rx * rz; I[4] += r2 - ry * ry; I[5] -= ry * rz; I[8] += r2 - rz * rz;
    }
    I[3] = I[1]; I[6] = I[2]; I[7] = I[5];
    const Ii = new Float64Array(9);
    inv3(I, Ii);
    const wx = Ii[0] * lx + Ii[1] * ly + Ii[2] * lz, wy = Ii[3] * lx + Ii[4] * ly + Ii[5] * lz, wz = Ii[6] * lx + Ii[7] * ly + Ii[8] * lz;
    // (on the ground: its turning drawn toward the turn that rights it, its own up toward the
    // world's; so a roll dies, and it settles on its flat bottom, face out)
    const k = Math.min(1, roll);
    const ux = this.R[1], uy = this.R[4], uz = this.R[7];
    const tx = (k > 0 ? RIGHT : 0) * -uz, tz = (k > 0 ? RIGHT : 0) * ux;
    const tilt = Math.hypot(tx, tz) / RIGHT;
    const ty = 0;
    // (upside down the axis is lost: any way over will do)
    const ex = (uy < 0 && tilt < 0.3 ? RIGHT : tx) - wx, ey = ty - wy, ez = tz - wz;
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const gx = vx + wy * rz - wz * ry, gy = vy + wz * rx - wx * rz, gz = vz + wx * ry - wy * rx;
      v[i * 3] -= (v[i * 3] - gx) * c; v[i * 3 + 1] -= (v[i * 3 + 1] - gy) * c; v[i * 3 + 2] -= (v[i * 3 + 2] - gz) * c;
      if (k > 0) { v[i * 3] += (ey * rz - ez * ry) * k; v[i * 3 + 1] += (ez * rx - ex * rz) * k; v[i * 3 + 2] += (ex * ry - ey * rx) * k; }
    }
  }
}
