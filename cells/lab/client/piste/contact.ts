/**
 * Contacts, solved as position constraints between the blades' passes: blade on blade (with friction, and remembered
 * sides so a fast blade can't pass through another between substeps), blade on the other's bell guard, blade on the
 * other's body, the tip on the body (a compliant contact whose force is what the button feels), and the floor.
 *
 * The hot loops don't allocate: closest points go through module scratch.
 */
import type { Blade } from './blade';
import type { Capsule } from './fencer';
import type { Part } from './weapons';
import { type V, dot, norm, sub } from './v3';

// closest points between segments (p1,q1) and (p2,q2), flat: results in S, T, D2
let S = 0, T = 0, D2 = 0;
function closest(a: Float64Array, i: number, j: number, b: Float64Array | V, k: number, l: number) {
  const p1x = a[i], p1y = a[i + 1], p1z = a[i + 2];
  const d1x = a[j] - p1x, d1y = a[j + 1] - p1y, d1z = a[j + 2] - p1z;
  const p2x = b[k], p2y = b[k + 1], p2z = b[k + 2];
  const d2x = b[l] - p2x, d2y = b[l + 1] - p2y, d2z = b[l + 2] - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const A = d1x * d1x + d1y * d1y + d1z * d1z, E = d2x * d2x + d2y * d2y + d2z * d2z, F = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  if (A < 1e-12 && E < 1e-12) { s = t = 0; }
  else if (A < 1e-12) { s = 0; t = Math.min(1, Math.max(0, F / E)); }
  else {
    const C = d1x * rx + d1y * ry + d1z * rz;
    if (E < 1e-12) { t = 0; s = Math.min(1, Math.max(0, -C / A)); }
    else {
      const B = d1x * d2x + d1y * d2y + d1z * d2z, den = A * E - B * B;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (B * F - C * E) / den)) : 0;
      t = (B * s + F) / E;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -C / A)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (B - C) / A)); }
    }
  }
  const wx = p1x + d1x * s - p2x - d2x * t, wy = p1y + d1y * s - p2y - d2y * t, wz = p1z + d1z * s - p2z - d2z * t;
  S = s; T = t; D2 = wx * wx + wy * wy + wz * wz;
}

/** the steel's friction on steel, on the body's fabric, and at the tip (an épée point bites) */
export const FRICTION = { steel: 0.25, body: 0.35, tip: 0.6 };

export interface ContactStats {
  /** blades that weren't touching met this substep: how fast they came together, m/s (0: no new contact) */
  clash: number;
  /** where */
  at: V;
  /** the blades are touching (a bind, a press, a slide) */
  touching: boolean;
  /** where they met (at the last new contact), as a fraction of each blade from its guard: 0 forte .. 1 tip */
  where: [number, number];
}

/** A pair of blades, with the sides each pair of segments was on when they were last close. */
export class BladePair {
  private side = new Map<number, [number, number, number]>();
  private touching = false;
  constructor(readonly a: Blade, readonly b: Blade) {}

  solve(stats: ContactStats) {
    const { a, b } = this;
    stats.clash = 0; stats.touching = false;
    if (!near(a, b, 0.06)) { this.side.clear(); this.touching = false; return; }
    let touching = false;
    // segments from the guard on (the grip is inside the hand)
    for (let i = 1; i < a.n - 1; i++) for (let j = 1; j < b.n - 1; j++) {
      closest(a.x, i * 3, i * 3 + 3, b.x, j * 3, j * 3 + 3);
      const key = i * 64 + j, d = Math.sqrt(D2), s = S, t = T;
      const R = a.r[i] + (a.r[i + 1] - a.r[i]) * s + b.r[j] + (b.r[j + 1] - b.r[j]) * t;
      if (d > 0.04) { this.side.delete(key); continue; }
      // the normal, from b to a
      let nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < 3; k++) {
        const pa = a.x[i * 3 + k] + (a.x[i * 3 + 3 + k] - a.x[i * 3 + k]) * s, pb = b.x[j * 3 + k] + (b.x[j * 3 + 3 + k] - b.x[j * 3 + k]) * t;
        const w = pa - pb;
        if (k === 0) nx = w; else if (k === 1) ny = w; else nz = w;
      }
      let pen = R - d;
      const was = this.side.get(key);
      if (d > 1e-9) { nx /= d; ny /= d; nz /= d; }
      else if (was) { nx = was[0]; ny = was[1]; nz = was[2]; }
      else continue;
      // (they were on the other sides last substep: one went through the other; push it back the way it came)
      if (was && nx * was[0] + ny * was[1] + nz * was[2] < 0) { nx = was[0]; ny = was[1]; nz = was[2]; pen = R + d; }
      this.side.set(key, [nx, ny, nz]);
      if (pen <= 0) continue;
      if (!this.touching) {
        if (!touching) stats.where = [(i - 1 + s) / (a.n - 2), (j - 1 + t) / (b.n - 2)];
        // (how fast they were coming together, this substep, before the contact took it out)
        let ap = 0;
        for (let k = 0; k < 3; k++) {
          const da = (a.x[i * 3 + k] - a.p[i * 3 + k]) * (1 - s) + (a.x[i * 3 + 3 + k] - a.p[i * 3 + 3 + k]) * s;
          const db = (b.x[j * 3 + k] - b.p[j * 3 + k]) * (1 - t) + (b.x[j * 3 + 3 + k] - b.p[j * 3 + 3 + k]) * t;
          ap -= (da - db) * (k === 0 ? nx : k === 1 ? ny : nz);
        }
        const speed = ap / H_OF(a);
        if (speed > stats.clash) { stats.clash = speed; stats.where = [(i - 1 + s) / (a.n - 2), (j - 1 + t) / (b.n - 2)]; stats.at = [a.x[i * 3] + (a.x[i * 3 + 3] - a.x[i * 3]) * s, a.x[i * 3 + 1] + (a.x[i * 3 + 4] - a.x[i * 3 + 1]) * s, a.x[i * 3 + 2] + (a.x[i * 3 + 5] - a.x[i * 3 + 2]) * s]; }
      }
      touching = true;
      const wa0 = a.w[i] * (1 - s), wa1 = a.w[i + 1] * s, wb0 = b.w[j] * (1 - t), wb1 = b.w[j + 1] * t;
      const W = wa0 * (1 - s) + wa1 * s + wb0 * (1 - t) + wb1 * t;
      if (W < 1e-12) continue;
      const lam = pen / W;
      push(a.x, i, nx, ny, nz, lam * wa0); push(a.x, i + 1, nx, ny, nz, lam * wa1);
      push(b.x, j, nx, ny, nz, -lam * wb0); push(b.x, j + 1, nx, ny, nz, -lam * wb1);
      // friction: take out sliding along the contact, up to μ times the push
      let tx = 0, ty = 0, tz = 0;
      for (let k = 0; k < 3; k++) {
        const da = (a.x[i * 3 + k] - a.p[i * 3 + k]) * (1 - s) + (a.x[i * 3 + 3 + k] - a.p[i * 3 + 3 + k]) * s;
        const db = (b.x[j * 3 + k] - b.p[j * 3 + k]) * (1 - t) + (b.x[j * 3 + 3 + k] - b.p[j * 3 + 3 + k]) * t;
        if (k === 0) tx = da - db; else if (k === 1) ty = da - db; else tz = da - db;
      }
      const tn = tx * nx + ty * ny + tz * nz;
      tx -= nx * tn; ty -= ny * tn; tz -= nz * tn;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-9) {
        const f = Math.min(1, (FRICTION.steel * pen) / tl) / W;
        tx /= tl; ty /= tl; tz /= tl;
        const fl = -f * tl;
        push(a.x, i, tx, ty, tz, fl * wa0); push(a.x, i + 1, tx, ty, tz, fl * wa1);
        push(b.x, j, tx, ty, tz, -fl * wb0); push(b.x, j + 1, tx, ty, tz, -fl * wb1);
      }
    }
    this.touching = touching;
    stats.touching = touching;
  }
}

/** the substep the blade was last stepped with (set by `predict`) */
const H_OF = (b: Blade) => b.lastH;

/**
 * The other blade on this weapon's bell: a spherical cap facing forward. A blade in front of the rim's plane and
 * inside the sphere is pushed out of it (the guard, rigid in the hand, takes its share at the guard node). Behind the
 * rim it's the hand and arm, which the body contact deals with.
 */
export function guardContact(owner: Blade, other: Blade): number {
  const wpn = owner.weapon, g = owner.guard, ax = owner.handAxis;
  const R = (wpn.guardR * wpn.guardR + wpn.guardDepth * wpn.guardDepth) / (2 * wpn.guardDepth);
  const c: V = [g[0] - ax[0] * R, g[1] - ax[1] * R, g[2] - ax[2] * R];
  const rim: V = [g[0] - ax[0] * wpn.guardDepth, g[1] - ax[1] * wpn.guardDepth, g[2] - ax[2] * wpn.guardDepth];
  const cc = [...c, ...c];
  let hit = 0;
  for (let j = 1; j < other.n - 1; j++) {
    closest(other.x, j * 3, j * 3 + 3, cc as unknown as V, 0, 3);
    const t = S, d = Math.sqrt(D2), rb = other.r[j] + (other.r[j + 1] - other.r[j]) * t;
    const pen = R + rb - d;
    if (pen <= 0 || d < 1e-9) continue;
    const q: V = [other.x[j * 3] + (other.x[j * 3 + 3] - other.x[j * 3]) * t, other.x[j * 3 + 1] + (other.x[j * 3 + 4] - other.x[j * 3 + 1]) * t, other.x[j * 3 + 2] + (other.x[j * 3 + 5] - other.x[j * 3 + 2]) * t];
    if (dot(sub(q, rim), ax) < 0) continue;
    const n = norm(sub(q, c));
    const w0 = other.w[j] * (1 - t), w1 = other.w[j + 1] * t, wg = owner.w[1];
    const W = w0 * (1 - t) + w1 * t + wg;
    const lam = pen / W;
    push(other.x, j, n[0], n[1], n[2], lam * w0); push(other.x, j + 1, n[0], n[1], n[2], lam * w1);
    push(owner.x, 1, n[0], n[1], n[2], -lam * wg);
    hit = Math.max(hit, lam);
  }
  return hit;
}

export interface TipContact {
  /** what the tip is on, and the force along its axis pressing the button, N */
  part: Part | null;
  axial: number;
  /** the force pressing on whatever it's on, N (the readout) */
  force: number;
}

/**
 * A blade on a body (kinematic capsules: the body doesn't give). The tip is a compliant contact (the fabric and the
 * flesh under it, stiffness `tipK`), solved as XPBD so the force it makes is a real force: that force along the
 * blade's axis is what the button feels. The rest of the blade just can't go into the body.
 */
export function bodyContact(blade: Blade, body: Capsule[], h: number, out: TipContact) {
  out.part = null; out.axial = 0; out.force = 0;
  const n = blade.n, tip = n - 1;
  for (const c of body) {
    if (!capsuleNear(blade, c)) continue;
    const cap = [...c.a, ...c.b];
    // the tip
    {
      const q = tip * 3;
      closest(blade.x, q, q, cap as unknown as V, 0, 3);
      const t = T, d = Math.sqrt(D2), rc = c.ra + (c.rb - c.ra) * t, pen = rc + blade.r[tip] - d;
      if (pen > 0 && d > 1e-9) {
        const px = c.a[0] + (c.b[0] - c.a[0]) * t, py = c.a[1] + (c.b[1] - c.a[1]) * t, pz = c.a[2] + (c.b[2] - c.a[2]) * t;
        const nx = (blade.x[q] - px) / d, ny = (blade.x[q + 1] - py) / d, nz = (blade.x[q + 2] - pz) / d;
        const w = blade.w[tip], at = 1 / (blade.weapon.tipK * h * h);
        const lam = pen / (w + at);
        push(blade.x, tip, nx, ny, nz, lam * w);
        const F = lam / (h * h);
        const ax = blade.tipAxis, along = -(ax[0] * nx + ax[1] * ny + ax[2] * nz);
        // (the point bites: sliding is held back up to μ times the push)
        tipFriction(blade, tip, nx, ny, nz, lam * w);
        if (F > out.force) { out.force = F; out.axial = Math.max(0, F * along); out.part = c.part; }
      }
    }
    // the rest of the blade
    for (let k = 1; k < n - 1; k++) {
      closest(blade.x, k * 3, k * 3 + 3, cap as unknown as V, 0, 3);
      const s = S, t = T, d = Math.sqrt(D2);
      if (k === n - 2 && s > 0.85) continue;
      const rc = c.ra + (c.rb - c.ra) * t, pen = rc + blade.r[k] - d;
      if (pen <= 0 || d < 1e-9) continue;
      const pa: V = [0, 0, 0];
      for (let m = 0; m < 3; m++) pa[m] = blade.x[k * 3 + m] + (blade.x[k * 3 + 3 + m] - blade.x[k * 3 + m]) * s - (c.a[m] + (c.b[m] - c.a[m]) * t);
      const nx = pa[0] / d, ny = pa[1] / d, nz = pa[2] / d;
      const w0 = blade.w[k] * (1 - s), w1 = blade.w[k + 1] * s, W = w0 * (1 - s) + w1 * s;
      if (W < 1e-12) continue;
      const lam = pen / W;
      push(blade.x, k, nx, ny, nz, lam * w0); push(blade.x, k + 1, nx, ny, nz, lam * w1);
    }
  }
}

function tipFriction(b: Blade, i: number, nx: number, ny: number, nz: number, pushed: number) {
  const q = i * 3;
  let tx = b.x[q] - b.p[q], ty = b.x[q + 1] - b.p[q + 1], tz = b.x[q + 2] - b.p[q + 2];
  const tn = tx * nx + ty * ny + tz * nz;
  tx -= nx * tn; ty -= ny * tn; tz -= nz * tn;
  const tl = Math.hypot(tx, ty, tz);
  if (tl < 1e-9) return;
  const f = Math.min(1, (FRICTION.tip * pushed) / tl);
  b.x[q] -= tx * f; b.x[q + 1] -= ty * f; b.x[q + 2] -= tz * f;
}

/** the floor: nothing goes through it */
export function floorContact(b: Blade) {
  for (let i = 0; i < b.n; i++) {
    const y = i * 3 + 1;
    if (b.x[y] < b.r[i]) {
      b.x[y] = b.r[i];
      // (and it drags on it)
      b.x[y - 1] += (b.p[y - 1] - b.x[y - 1]) * 0.5; b.x[y + 1] += (b.p[y + 1] - b.x[y + 1]) * 0.5;
    }
  }
}

function push(x: Float64Array, i: number, nx: number, ny: number, nz: number, s: number) {
  x[i * 3] += nx * s; x[i * 3 + 1] += ny * s; x[i * 3 + 2] += nz * s;
}

/** are two blades (their bounding boxes) within `m` of each other */
function near(a: Blade, b: Blade, m: number) {
  for (let k = 0; k < 3; k++) {
    let alo = Infinity, ahi = -Infinity, blo = Infinity, bhi = -Infinity;
    for (let i = 1; i < a.n; i++) { const v = a.x[i * 3 + k]; if (v < alo) alo = v; if (v > ahi) ahi = v; }
    for (let i = 1; i < b.n; i++) { const v = b.x[i * 3 + k]; if (v < blo) blo = v; if (v > bhi) bhi = v; }
    if (alo > bhi + m || blo > ahi + m) return false;
  }
  return true;
}
function capsuleNear(b: Blade, c: Capsule) {
  const r = Math.max(c.ra, c.rb) + 0.03;
  for (let k = 0; k < 3; k++) {
    const lo = Math.min(c.a[k], c.b[k]) - r, hi = Math.max(c.a[k], c.b[k]) + r;
    let blo = Infinity, bhi = -Infinity;
    for (let i = 1; i < b.n; i++) { const v = b.x[i * 3 + k]; if (v < blo) blo = v; if (v > bhi) bhi = v; }
    if (blo > hi || bhi < lo) return false;
  }
  return true;
}
