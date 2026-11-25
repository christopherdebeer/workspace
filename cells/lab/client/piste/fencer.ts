/**
 * A fencer: feet on the piste, a body made of capsules (for the blade to meet and the eye to see), an arm reaching for
 * the guard, and the weapon in the hand. The body is kinematic (it goes where the footwork puts it); the weapon is
 * physical (blade.ts). The arm is the bridge: it is posed each step to reach the hand where the weapon actually is.
 *
 * The fencer's frame: origin on the floor midway between the feet at en garde, forward toward the opponent, up, and
 * right (the weapon side for a right-hander).
 */
import { Blade, thumbOf } from './blade';
import type { Intent } from './intent';
import { idle } from './intent';
import type { Part, Weapon } from './weapons';
import { type V, type Frame, add, clamp, cross, dirWorld, dist, dot, lerp, madd, norm, rot, scale, smooth, sub, toWorld, len } from './v3';

/** body measurements, m (an adult of 1.78 m: dials, not truths) */
export const BODY = {
  stance: 0.68,         // feet apart at en garde
  pelvis: 0.82,         // pelvis height at en garde (knees bent)
  lungeDrop: 0.14,      // how far the pelvis drops in a full lunge
  lungeFoot: 0.95,      // how far the front foot goes in a full lunge
  lungeHips: 0.46,      // how far the pelvis goes forward in it
  step: 0.36,           // an advance or a retreat
  stepTime: 0.3, lungeTime: 0.26, recoverTime: 0.36,
  upperArm: 0.3, forearm: 0.28, gripToGuard: 0.06,
  eye: 0.7,             // eye above the pelvis
};

type Act = { kind: 'advance' | 'retreat' | 'lunge' | 'recover'; t: number; dur: number; from: number };

export interface Capsule { a: V; b: V; ra: number; rb: number; part: Part }

export class Fencer {
  /** where on the piste the origin is (world x), and which way is forward (+1 or −1) */
  s: number; facing: 1 | -1;
  /** 0 en garde .. 1 full lunge */
  lunge = 0;
  /** feet along the fencer's forward axis, relative to the origin, and their lift */
  front = BODY.stance / 2; back = -BODY.stance / 2; frontLift = 0; backLift = 0;
  act: Act | null = null;
  queued: 'advance' | 'retreat' | null = null;
  intent: Intent = idle();
  readonly blade: Blade;
  frame!: Frame;
  /** the body this step, for the blade to meet and the eye to draw */
  capsules: Capsule[] = [];
  shoulder: V = [0, 0, 0]; elbow: V = [0, 0, 0]; hand: V = [0, 0, 0];
  eye: V = [0, 0, 0];
  /** smoothed intent (a hand doesn't teleport even when a thumb does) */
  private ext = 0; private hx = 0; private hy = 0; private py = 0; private px = 0; private roll = 0;

  constructor(readonly weapon: Weapon, s: number, facing: 1 | -1) {
    this.s = s; this.facing = facing;
    this.pose();
    const [P, G] = this.handTarget();
    this.blade = new Blade(weapon, P, G);
    this.blade.thumb = thumbOf(norm(sub(G, P)), 0);
  }

  /** back to the en garde line */
  reset(s: number) {
    this.s = s; this.lunge = 0; this.front = BODY.stance / 2; this.back = -BODY.stance / 2; this.act = null; this.queued = null;
    this.ext = this.hx = this.hy = this.px = this.py = this.roll = 0;
    this.intent = idle();
    this.pose();
    const [P, G] = this.handTarget();
    this.blade.place(P, G);
  }

  /** the footwork: one action at a time, a step asked for during another taken after it */
  feet(h: number) {
    const I = this.intent;
    if (I.step) { this.queued = I.step; I.step = null; }
    if (!this.act) {
      if (I.lunge && this.lunge < 1) this.act = { kind: 'lunge', t: 0, dur: BODY.lungeTime * (1 - this.lunge), from: this.lunge };
      else if (!I.lunge && this.lunge > 0) this.act = { kind: 'recover', t: 0, dur: BODY.recoverTime * this.lunge, from: this.lunge };
      else if (this.queued && this.lunge === 0) { this.act = { kind: this.queued, t: 0, dur: BODY.stepTime, from: this.s }; this.queued = null; }
    }
    const a = this.act;
    if (!a) return;
    a.t += h;
    const u = clamp(a.t / Math.max(1e-3, a.dur), 0, 1);
    const half = BODY.stance / 2, L = BODY.step;
    if (a.kind === 'advance' || a.kind === 'retreat') {
      const sign = a.kind === 'advance' ? 1 : -1;
      // (the leading foot goes first and the other follows: front then back to advance, back then front to retreat)
      const lead = smooth(u / 0.62), trail = smooth((u - 0.38) / 0.62);
      const fr = a.kind === 'advance' ? lead : trail, bk = a.kind === 'advance' ? trail : lead;
      // (the origin is midway between the feet: it moves with their mean, and each foot is placed about it)
      this.s = a.from + this.facing * sign * L * (fr + bk) / 2;
      this.front = half + sign * L * (fr - bk) / 2;
      this.back = -half + sign * L * (bk - fr) / 2;
      this.frontLift = Math.sin(Math.PI * clamp(fr, 0, 1)) * 0.035;
      this.backLift = Math.sin(Math.PI * clamp(bk, 0, 1)) * 0.03;
    } else {
      const to = a.kind === 'lunge' ? 1 : 0;
      // (a lunge kicks off fast and lands; a recovery pulls back)
      const e = a.kind === 'lunge' ? 1 - Math.pow(1 - u, 2.2) : smooth(u);
      this.lunge = a.from + (to - a.from) * e;
      this.front = half + BODY.lungeFoot * this.lunge;
      this.back = -half;
      this.frontLift = Math.sin(Math.PI * u) * 0.06 * Math.abs(to - a.from);
    }
    if (u >= 1) {
      if (a.kind === 'advance' || a.kind === 'retreat') { this.front = half; this.back = -half; this.frontLift = this.backLift = 0; }
      this.act = null;
    }
  }

  /** the body's pose from the feet, and the arm reaching for where the weapon is */
  pose() {
    const f: V = [this.facing, 0, 0], u: V = [0, 1, 0], r = cross(f, u);
    this.frame = { o: [this.s, 0, 0], f, u, r };
    const F = this.frame, L = this.lunge;
    const hipsFwd = BODY.lungeHips * L, hipsUp = BODY.pelvis - BODY.lungeDrop * L;
    // (side on: the weapon shoulder leads, the torso leans into a lunge)
    const lean = 0.16 * L;
    const pelvis = toWorld(F, hipsFwd, hipsUp, 0);
    const chest = toWorld(F, hipsFwd + 0.04 + Math.sin(lean) * 0.42, hipsUp + Math.cos(lean) * 0.42, 0.0);
    const neck = toWorld(F, hipsFwd + 0.05 + Math.sin(lean) * 0.52, hipsUp + Math.cos(lean) * 0.52, 0);
    this.shoulder = toWorld(F, hipsFwd + 0.13 + Math.sin(lean) * 0.47, hipsUp + Math.cos(lean) * 0.47, 0.05);
    const rearShoulder = toWorld(F, hipsFwd - 0.1 + Math.sin(lean) * 0.47, hipsUp + Math.cos(lean) * 0.47, -0.04);
    const head = toWorld(F, hipsFwd + 0.07 + Math.sin(lean) * 0.7, hipsUp + Math.cos(lean) * 0.7, -0.01);
    this.eye = toWorld(F, hipsFwd + 0.13 + Math.sin(lean) * BODY.eye, hipsUp + Math.cos(lean) * BODY.eye, -0.005);
    // legs: hips to knees (bent, out) to feet
    const hipF = toWorld(F, hipsFwd + 0.08, hipsUp, 0.05), hipB = toWorld(F, hipsFwd - 0.08, hipsUp, -0.03);
    const footF = toWorld(F, this.front, 0.05 + this.frontLift, 0.04), footB = toWorld(F, this.back, 0.05 + this.backLift, -0.06);
    const kneeF = knee(hipF, footF, 0.46, 0.46, add(scale(f, 1), [0, 0.2, 0]));
    const kneeB = knee(hipB, footB, 0.46, 0.46, add(scale(f, -0.3), add(scale(r, -0.8), [0, 0.2, 0])));
    // the weapon arm reaches for the grip, just behind the guard
    const P = this.blade ? this.blade.pommel : this.shoulder, G = this.blade ? this.blade.guard : this.shoulder;
    this.hand = this.blade ? madd(G, norm(sub(P, G)), BODY.gripToGuard) : this.shoulder;
    this.elbow = knee(this.shoulder, this.hand, BODY.upperArm, BODY.forearm, add(scale(r, 0.4), [0, -1, 0]));
    // the rear arm, up and behind (balance)
    const rearElbow = toWorld(F, hipsFwd - 0.3 + 0.1 * L, hipsUp + 0.56 - 0.3 * L, -0.08);
    const rearHand = toWorld(F, hipsFwd - 0.32 - 0.25 * L, hipsUp + 0.86 - 0.65 * L, -0.06);
    this.capsules = [
      { a: pelvis, b: chest, ra: 0.13, rb: 0.15, part: 'torso' },
      { a: chest, b: neck, ra: 0.14, rb: 0.07, part: 'torso' },
      { a: madd(head, f, -0.01), b: madd(head, f, 0.02), ra: 0.115, rb: 0.115, part: 'head' },
      { a: this.shoulder, b: rearShoulder, ra: 0.065, rb: 0.065, part: 'torso' },
      { a: this.shoulder, b: this.elbow, ra: 0.05, rb: 0.042, part: 'arm' },
      { a: this.elbow, b: this.hand, ra: 0.042, rb: 0.036, part: 'arm' },
      { a: this.hand, b: madd(this.hand, norm(sub(P, G)), 0.06), ra: 0.04, rb: 0.035, part: 'hand' },
      { a: rearShoulder, b: rearElbow, ra: 0.045, rb: 0.04, part: 'arm' },
      { a: rearElbow, b: rearHand, ra: 0.04, rb: 0.033, part: 'arm' },
      { a: hipF, b: kneeF, ra: 0.075, rb: 0.055, part: 'leg' },
      { a: kneeF, b: footF, ra: 0.055, rb: 0.04, part: 'leg' },
      { a: hipB, b: kneeB, ra: 0.075, rb: 0.055, part: 'leg' },
      { a: kneeB, b: footB, ra: 0.055, rb: 0.04, part: 'leg' },
      { a: madd(footF, f, -0.07), b: madd(footF, f, 0.15), ra: 0.045, rb: 0.04, part: 'foot' },
      { a: madd(footB, r, -0.07), b: madd(footB, r, 0.12), ra: 0.045, rb: 0.04, part: 'foot' },
    ];
  }

  /**
   * Where the intent puts the hand: the pommel and the guard. En garde the guard is a little forward of and below
   * the shoulder, the point up a little and in; extended, the arm is straight at shoulder height, the blade in line.
   */
  handTarget(): [V, V] {
    const F = this.frame, e = this.ext;
    const S = this.shoulder, toS = (a: number, b: number, c: number) => add(S, dirWorld(F, a, b, c));
    let G = toS(0.36 + 0.23 * e, -0.2 + 0.16 * e, 0.12 - 0.11 * e);
    G = add(G, add(scale(F.r, this.hx), scale(F.u, this.hy)));
    // (the arm only reaches so far)
    const reach = BODY.upperArm + BODY.forearm + BODY.gripToGuard - 0.005, d = sub(G, S), l = len(d);
    if (l > reach) G = madd(S, d, reach / l - 1);
    let dir = lineOf(F, e);
    dir = rot(dir, F.u, -this.px);
    dir = rot(dir, norm(cross(dir, F.u)), this.py);
    const P = madd(G, dir, -this.weapon.grip);
    return [P, G];
  }

  /** the intent, smoothed by how fast a body can do it (the muscle in blade.ts does the rest) */
  follow(h: number) {
    const I = this.intent, k = 1 - Math.exp(-h * 40);
    this.ext += (clamp(I.extend, 0, 1) - this.ext) * (1 - Math.exp(-h * 18));
    this.hx += (clamp(I.hand[0], -0.3, 0.3) - this.hx) * k;
    this.hy += (clamp(I.hand[1], -0.2, 0.2) - this.hy) * k;
    this.px += (clamp(I.point[0], -0.7, 0.7) - this.px) * k;
    this.py += (clamp(I.point[1], -0.7, 0.7) - this.py) * k;
    this.roll += (clamp(I.roll, -1.6, 1.6) - this.roll) * k;
  }

  /** one substep of the body: feet, pose, and where the hand is sent */
  step(h: number) {
    this.feet(h);
    this.follow(h);
    this.pose();
    const [P, G] = this.handTarget();
    this.blade.aim(P, G, h);
    this.blade.thumb = thumbOf(this.blade.handAxis, this.roll);
  }

  /** the front of the body along the piste (for keeping two fencers apart) */
  get reachFront(): number { return this.s + this.facing * Math.max(this.front, BODY.lungeHips * this.lunge + 0.2); }
  get extension() { return this.ext; }
}

/** the blade's natural line at extension e (before the wrist turns it): en garde the point up a little and in toward
 * the middle, extended straight along the arm */
export const lineOf = (F: Frame, e: number): V => norm(dirWorld(F, 1, 0.16 - 0.15 * e, -0.1 + 0.08 * e));

/**
 * The intent that points `f`'s weapon at world point `p` at extension `e`: the wrist turns the blade off its natural
 * line toward it, and the hand shifts a little toward it too. (The inverse of `handTarget`, near enough.)
 */
export function aimAt(f: Fencer, p: V, e: number): { hand: [number, number]; point: [number, number] } {
  const F = f.frame, O = { ...F, o: [0, 0, 0] as V };
  const want = toLocalDir(O, norm(sub(p, f.blade.guard))), base = toLocalDir(O, lineOf(F, e));
  const yaw = Math.atan2(want[2], want[0]) - Math.atan2(base[2], base[0]);
  const pitch = Math.atan2(want[1], Math.hypot(want[0], want[2])) - Math.atan2(base[1], Math.hypot(base[0], base[2]));
  return { point: [clamp(yaw, -0.6, 0.6), clamp(pitch, -0.6, 0.6)], hand: [clamp(yaw * 0.15, -0.08, 0.08), clamp(pitch * 0.2, -0.08, 0.08)] };
}
const toLocalDir = (F: Frame, d: V): V => [dot(d, F.f), dot(d, F.u), dot(d, F.r)];

/** two-bone IK: the joint between `a` and `c`, bones `l1` and `l2`, bent toward `pole` */
export function knee(a: V, c: V, l1: number, l2: number, pole: V): V {
  const d = sub(c, a), L = clamp(len(d), 1e-4, l1 + l2 - 1e-4), dn = norm(d);
  const x = (L * L + l1 * l1 - l2 * l2) / (2 * L), y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pp = sub(pole, scale(dn, dot(pole, dn))), pn = len(pp) > 1e-6 ? norm(pp) : norm(cross(dn, [0, 0, 1]));
  return add(add(a, scale(dn, x)), scale(pn, y));
}
