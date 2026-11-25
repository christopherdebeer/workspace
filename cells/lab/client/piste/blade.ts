/**
 * The weapon as a physical thing: a chain of particles solved by XPBD (extended position-based dynamics) in small
 * substeps.
 *
 *   node 0      the pommel          ┐ the hand: two heavy particles, each pulled toward where the fencer means it to
 *   node 1      the guard           ┘ be by a muscle (a spring-damper with a force it can't exceed)
 *   node 2..N   the blade, forte to foible
 *   node N      the tip (the button)
 *
 * There is no "rotation" and no animation: the blade's angle at the hand is the line from pommel to guard, held there
 * by a stiff bend at the guard; past it the blade bends as a tapered beam (each joint's compliance from EI), with the
 * set a fencer puts in it. So leverage is real: a blow near the guard meets the hand's mass and the muscles behind it,
 * a blow on the foible moves a few grams of steel. Pressing the tip home buckles the blade; a beat makes it ring.
 *
 * The world solves contacts between the internal passes (`predict`, `solve`, then contacts, then `finish`).
 */
import type { Weapon } from './weapons';
import { type V, cross, dot, norm, sub, len } from './v3';

export const GRAVITY = 9.81;

export interface Muscle {
  /** natural frequency of the hand's servo, rad/s (how quickly a hand gets where it's sent) */
  omega: number;
  /** damping ratio */
  zeta: number;
  /** the most force each hand particle can be pushed with, N (pommel, guard) */
  fPommel: number; fGuard: number;
}
export const MUSCLE: Muscle = { omega: 20, zeta: 1, fPommel: 45, fGuard: 80 };

/** effective masses at the hand, kg (the arm's inertia felt at the grip, and the guard) */
const M_POMMEL = 0.5, M_GUARD = 0.75;
/** the blade is clamped in the hand: the bend at the guard is this much stiffer than the forte */
const CLAMP = 40;
/** light air and steel damping, 1/s */
const DAMP = 0.6;

export class Blade {
  readonly n: number;
  /** positions, previous positions, velocities (flat, stride 3) */
  readonly x: Float64Array; readonly p: Float64Array; readonly vel: Float64Array;
  readonly w: Float64Array; readonly m: Float64Array;
  /** rest length of segment i (i to i+1), radius at node i, bend compliance at joint i (i-1, i, i+1) */
  readonly rest: Float64Array; readonly r: Float64Array; readonly alpha: Float64Array;
  /** set (rest curvature) per joint, as an angle */
  readonly setAngle: Float64Array;
  /** where the hand means the pommel and guard to be, and how fast those targets are moving */
  readonly target = new Float64Array(6); readonly targetVel = new Float64Array(6);
  /** the thumb's direction (the blade's set bends away from it) */
  thumb: V = [0, 1, 0];
  muscle: Muscle = { ...MUSCLE };
  /** what's left of the arm's strength (fatigue takes it): scales what the muscles can push */
  strength = 1;
  /** the force each hand particle was pushed with last step (for a readout: how hard the hand is working) */
  readonly effort = new Float64Array(2);
  private sweep = 0;
  /** the substep last integrated over, s */
  lastH = 1 / 2000;

  constructor(readonly weapon: Weapon, pommel: V, guard: V) {
    const N = weapon.segments, n = N + 2;
    this.n = n;
    this.x = new Float64Array(n * 3); this.p = new Float64Array(n * 3); this.vel = new Float64Array(n * 3);
    this.w = new Float64Array(n); this.m = new Float64Array(n);
    this.rest = new Float64Array(n - 1); this.r = new Float64Array(n);
    this.alpha = new Float64Array(n); this.setAngle = new Float64Array(n);
    const seg = weapon.blade / N;
    // (a tapered blade: linear density falling from `taper` times the tip's to the tip's)
    let total = 0;
    const dens: number[] = [];
    for (let i = 0; i < N; i++) { const s = (i + 0.5) / N, d = weapon.taper + (1 - weapon.taper) * s; dens.push(d); total += d; }
    const node = new Float64Array(n);
    for (let i = 0; i < N; i++) { const mm = (weapon.bladeMass * dens[i]) / total; node[i + 1] += mm / 2; node[i + 2] += mm / 2; }
    node[0] += M_POMMEL; node[1] += M_GUARD;
    for (let i = 0; i < n; i++) { this.m[i] = node[i]; this.w[i] = 1 / node[i]; }
    this.rest[0] = weapon.grip;
    for (let i = 1; i < n - 1; i++) this.rest[i] = seg;
    for (let i = 0; i < n; i++) {
      const s = Math.max(0, (i - 1) / N);
      this.r[i] = i < 1 ? 0.015 : weapon.rForte + (weapon.rTip - weapon.rForte) * s;
    }
    // joint compliance: a joint of a beam with stiffness EI, between segments of length l, resists bending with
    // EI / l per radian; expressed as the sideways offset of the next node (l·θ), that's α = l³ / EI
    for (let i = 1; i < n - 1; i++) {
      const s = (i - 1) / N, EI = weapon.EI + (weapon.EItip - weapon.EI) * s, l = this.rest[i];
      this.alpha[i] = (l * l * l) / (EI * (i === 1 ? CLAMP : 1));
      this.setAngle[i] = i === 1 ? 0 : weapon.set * l;
    }
    this.place(pommel, guard);
  }

  /** Put the whole weapon straight along pommel → guard, at rest. */
  place(pommel: V, guard: V) {
    const d = norm(sub(guard, pommel));
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      if (i > 0) s += this.rest[i - 1];
      for (let k = 0; k < 3; k++) { this.x[i * 3 + k] = pommel[k] + d[k] * s; this.p[i * 3 + k] = this.x[i * 3 + k]; this.vel[i * 3 + k] = 0; }
    }
    this.target.set([...pommel, ...guard]);
    this.targetVel.fill(0);
  }

  at(i: number): V { return [this.x[i * 3], this.x[i * 3 + 1], this.x[i * 3 + 2]]; }
  velAt(i: number): V { return [this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2]]; }
  get tip(): V { return this.at(this.n - 1); }
  get guard(): V { return this.at(1); }
  get pommel(): V { return this.at(0); }
  /** the way the blade points at the tip (the button's axis) */
  get tipAxis(): V { return norm(sub(this.at(this.n - 1), this.at(this.n - 2))); }
  /** the way the hand holds it */
  get handAxis(): V { return norm(sub(this.at(1), this.at(0))); }

  /** Send the hand somewhere: pommel and guard targets; their velocity from the last target over `dt`. */
  aim(pommel: V, guard: V, dt: number) {
    for (let k = 0; k < 3; k++) {
      this.targetVel[k] = (pommel[k] - this.target[k]) / dt;
      this.targetVel[3 + k] = (guard[k] - this.target[3 + k]) / dt;
      this.target[k] = pommel[k]; this.target[3 + k] = guard[k];
    }
  }

  /** forces and integration: the hand's muscles (with the weapon's weight held up), gravity, damping */
  predict(h: number) {
    this.lastH = h;
    const { x, vel, p, m, n } = this;
    // the blade's weight, and its moment about the guard (held by the hand as a couple between pommel and guard)
    let W = 0, Wd = 0;
    const ax = norm(sub(this.at(1), this.at(0)));
    for (let i = 2; i < n; i++) {
      const wi = m[i] * GRAVITY;
      W += wi;
      // horizontal lever about the guard
      const dx = x[i * 3] - x[3], dz = x[i * 3 + 2] - x[5];
      Wd += wi * Math.hypot(dx, dz) * Math.sign(dx * ax[0] + dz * ax[2] || 1);
    }
    const lh = Math.max(0.05, Math.hypot(x[3] - x[0], x[5] - x[2]));
    const hold = [-(Wd / lh), W + Wd / lh];
    const { omega, zeta } = this.muscle, fmax = [this.muscle.fPommel * this.strength, this.muscle.fGuard * this.strength];
    for (let j = 0; j < 2; j++) {
      const k = m[j] * omega * omega, c = 2 * m[j] * omega * zeta;
      let fx = 0, fy = 0, fz = 0;
      fx = k * (this.target[j * 3] - x[j * 3]) + c * (this.targetVel[j * 3] - vel[j * 3]);
      fy = k * (this.target[j * 3 + 1] - x[j * 3 + 1]) + c * (this.targetVel[j * 3 + 1] - vel[j * 3 + 1]);
      fz = k * (this.target[j * 3 + 2] - x[j * 3 + 2]) + c * (this.targetVel[j * 3 + 2] - vel[j * 3 + 2]);
      const f = Math.hypot(fx, fy, fz);
      if (f > fmax[j]) { const s = fmax[j] / f; fx *= s; fy *= s; fz *= s; }
      this.effort[j] = Math.min(f, fmax[j]) / fmax[j];
      // (the arm also holds itself and the weapon up: that isn't part of the effort)
      fy += m[j] * GRAVITY + hold[j];
      vel[j * 3] += (fx / m[j]) * h; vel[j * 3 + 1] += (fy / m[j]) * h; vel[j * 3 + 2] += (fz / m[j]) * h;
    }
    const damp = Math.max(0, 1 - DAMP * h);
    for (let i = 0; i < n; i++) {
      vel[i * 3 + 1] -= GRAVITY * h;
      for (let k = 0; k < 3; k++) {
        const q = i * 3 + k;
        vel[q] *= damp;
        p[q] = x[q];
        x[q] += vel[q] * h;
      }
    }
  }

  /** the internal constraints: lengths, and the bend at each joint (one pass, alternating direction) */
  solve(h: number) {
    const { n } = this;
    const fwd = (this.sweep++ & 1) === 0;
    for (let s = 0; s < n - 1; s++) this.length(fwd ? s : n - 2 - s);
    const thumbSide = this.thumbPerp();
    for (let s = 1; s < n - 1; s++) this.bend(fwd ? s : n - 1 - s, h, thumbSide);
  }

  /** velocities from the step's motion */
  finish(h: number) {
    const { x, p, vel } = this;
    for (let q = 0; q < x.length; q++) vel[q] = (x[q] - p[q]) / h;
  }

  private length(i: number) {
    const { x, w } = this, a = i * 3, b = a + 3;
    const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-9) return;
    const ws = w[i] + w[i + 1], c = (l - this.rest[i]) / (l * ws);
    x[a] += dx * c * w[i]; x[a + 1] += dy * c * w[i]; x[a + 2] += dz * c * w[i];
    x[b] -= dx * c * w[i + 1]; x[b + 1] -= dy * c * w[i + 1]; x[b + 2] -= dz * c * w[i + 1];
  }

  /** the thumb's direction made square to the hand's axis */
  private thumbPerp(): V {
    const a = this.handAxis, t = this.thumb, d = dot(t, a);
    return norm([t[0] - a[0] * d, t[1] - a[1] * d, t[2] - a[2] * d]);
  }

  /**
   * Bending at joint i, as a second difference: with k = l(i,i+1)/l(i-1,i), the node after a straight joint is at
   * b + k(b − a), so C = c − (1+k)b + k·a (less the blade's set) is zero for a straight blade and is the sideways
   * offset of c otherwise. It's linear in the three positions, so its gradients are just 1, −(1+k), k.
   */
  private bend(i: number, h: number, thumb: V) {
    const { x, w } = this, A = (i - 1) * 3, B = i * 3, Cc = (i + 1) * 3;
    const k = this.rest[i] / this.rest[i - 1], set = this.setAngle[i] * this.rest[i];
    let cx = x[Cc] - (1 + k) * x[B] + k * x[A] + thumb[0] * set;
    let cy = x[Cc + 1] - (1 + k) * x[B + 1] + k * x[A + 1] + thumb[1] * set;
    let cz = x[Cc + 2] - (1 + k) * x[B + 2] + k * x[A + 2] + thumb[2] * set;
    const C = Math.hypot(cx, cy, cz);
    if (C < 1e-12) return;
    cx /= C; cy /= C; cz /= C;
    const wsum = w[i + 1] + (1 + k) * (1 + k) * w[i] + k * k * w[i - 1];
    const at = this.alpha[i] / (h * h);
    const dl = -C / (wsum + at);
    const gc = w[i + 1] * dl, gb = -(1 + k) * w[i] * dl, ga = k * w[i - 1] * dl;
    x[Cc] += cx * gc; x[Cc + 1] += cy * gc; x[Cc + 2] += cz * gc;
    x[B] += cx * gb; x[B + 1] += cy * gb; x[B + 2] += cz * gb;
    x[A] += cx * ga; x[A + 1] += cy * ga; x[A + 2] += cz * ga;
  }

  /** how far the blade is from straight: the largest distance of a node from the line guard → tip, m */
  bow(): number {
    const g = this.guard, t = this.tip, d = norm(sub(t, g));
    let worst = 0;
    for (let i = 2; i < this.n - 1; i++) {
      const q = sub(this.at(i), g), along = dot(q, d);
      worst = Math.max(worst, len([q[0] - d[0] * along, q[1] - d[1] * along, q[2] - d[2] * along]));
    }
    return worst;
  }
  /** the longest a segment is stretched, as a fraction of its length */
  strain(): number {
    let worst = 0;
    for (let i = 0; i < this.n - 1; i++) worst = Math.max(worst, Math.abs(len(sub(this.at(i + 1), this.at(i))) / this.rest[i] - 1));
    return worst;
  }
}

/** the hand's frame for a weapon pointing along `dir` with the thumb rolled by `roll` from up (radians) */
export function thumbOf(dir: V, roll: number): V {
  const up: V = [0, 1, 0], side = norm(cross(dir, up)), u = norm(cross(side, dir));
  return norm([u[0] * Math.cos(roll) + side[0] * Math.sin(roll), u[1] * Math.cos(roll) + side[1] * Math.sin(roll), u[2] * Math.cos(roll) + side[2] * Math.sin(roll)]);
}
