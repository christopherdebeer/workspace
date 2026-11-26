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
import { BodyMotion } from './motion';
import type { Part, Weapon } from './weapons';
import { type V, type Frame, add, clamp, cross, dirWorld, dot, madd, norm, rot, scale, smooth, sub, toWorld, len } from './v3';

/** body measurements, m (an adult of 1.78 m: dials, not truths) */
export const BODY = {
  stance: 0.68,         // feet apart at en garde
  pelvis: 0.82,         // pelvis height at en garde (knees bent)
  lungeDrop: 0.14,      // how far the pelvis drops in a full lunge
  lungeFoot: 0.95,      // how far the front foot goes in a full lunge
  lungeHips: 0.46,      // how far the pelvis goes forward in it
  step: 0.36,           // an advance or a retreat
  stepTime: 0.3, lungeTime: 0.26, recoverTime: 0.36,
  // (the arm: shoulder to elbow, elbow to the middle of the grip, and the rear arm's elbow to wrist: an adult's of this
  // height, measured by devtools/piste-proportions.mjs)
  upperArm: 0.33, forearm: 0.32, gripToGuard: 0.06, rearForearm: 0.26,
  /** each shoulder joint's distance out from the trunk's axis, along the shoulders' line */
  shoulderOut: 0.175,
  eye: 0.7,             // eye above the pelvis
};

/** how far the guard can be from the shoulder: the arm straight, to the guard */
const ARM = BODY.upperArm + BODY.forearm + BODY.gripToGuard - 0.005;
/** the shoulders' line (forward, right), side on: rear shoulder to weapon shoulder */
const SHOULDER_LINE = [0.931, 0.364] as const;

/** how much further this athlete reaches than the one the bout's distances were first measured for (whose straight arm
 * put the guard 0.635 m from a shoulder 0.13 m forward of the trunk's axis): the straight arm's guard, and the bent
 * one's (m, along the piste). Distances that were tuned for that athlete add these */
export const REACH_GAIN = (0.04 + SHOULDER_LINE[0] * BODY.shoulderOut + 0.59 * ARM / 0.635) - (0.13 + 0.59);
export const GUARD_GAIN = (0.04 + SHOULDER_LINE[0] * BODY.shoulderOut) - 0.13;

/** the trunk's section, side on: half its depth across the piste, and how far its width runs past that fore and aft, m */
export const TRUNK = { depth: 0.115, wide: 0.045 };

/** how an arm tires: from what extension, seconds held straight to exhaustion, seconds bent to recover fully, how much
 * strength it costs at the end, how far the point trembles and the hand sags, m */
export const FATIGUE = { from: 0.55, tire: 9, rest: 5, weak: 0.55, tremor: 0.018, droop: 0.05 };

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
  shoulder: V = [0, 0, 0]; elbow: V = [0, 0, 0]; elbowLook: V = [0, 0, 0]; hand: V = [0, 0, 0];
  eye: V = [0, 0, 0];
  /** where the weapon shoulder would be if the body were rigid: the hand is placed from here (the body's own sway is
   * the body's, not the intent's) */
  anchor: V = [0, 0, 0];
  /** the rest of the body's own motion: its mass lagging, its rear arm swinging, its breathing (motion.ts) */
  readonly motion: BodyMotion;
  /**
   * How tired the weapon arm is, 0..1. An arm held out at shoulder height with a weapon at the end of it tires in
   * seconds; it recovers when it's bent. A tired arm is weaker (its muscles push less), and its point wanders: the
   * tremor of a tired muscle, and a droop.
   */
  fatigue = 0;
  /** seconds this fencer has lived (the tremor's clock: deterministic) */
  private age = 0;
  /** smoothed intent (a hand doesn't teleport even when a thumb does) */
  private ext = 0; private hx = 0; private hy = 0; private py = 0; private px = 0; private roll = 0;

  constructor(readonly weapon: Weapon, s: number, facing: 1 | -1) {
    this.s = s; this.facing = facing;
    this.motion = new BodyMotion(facing > 0 ? 0.4 : 2.9);
    this.pose();
    const [P, G] = this.handTarget();
    this.blade = new Blade(weapon, P, G);
    this.blade.thumb = thumbOf(norm(sub(G, P)), 0);
  }

  /** back to the en garde line */
  reset(s: number) {
    this.s = s; this.lunge = 0; this.front = BODY.stance / 2; this.back = -BODY.stance / 2; this.act = null; this.queued = null;
    this.ext = this.hx = this.hy = this.px = this.py = this.roll = 0;
    this.fatigue = 0;
    this.motion.reset();
    this.blade.strength = 1;
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
    const lean = 0.16 * L, sl = Math.sin(lean), cl = Math.cos(lean);
    // the body's own motion (motion.ts): the pelvis's own bob and shift, the trunk's sway over it (in proportion to
    // height: its top, half a metre up, takes all of it) and its breath, the head's steadying, the rear shoulder's turn
    const K = this.motion, pF = hipsFwd + K.pelvis[0], pU = hipsUp + K.pelvis[1], tF = K.trunk[0], tU = K.trunk[1];
    const at = (fwd: number, up: number, right: number, y: number) => toWorld(F, pF + fwd + sl * y + tF * y / 0.5, pU + cl * y + tU * Math.min(1, y / 0.42), right);
    const pelvis = toWorld(F, pF, pU, 0);
    const chest = at(0.04, 0, 0, 0.42);
    const neck = at(0.05, 0, 0, 0.52);
    // (the shoulders: either side of the trunk's axis along the shoulders' line, side on: the weapon shoulder leads,
    // toward the right)
    const SO = BODY.shoulderOut, sx = SHOULDER_LINE[0] * SO, sz = SHOULDER_LINE[1] * SO;
    this.shoulder = at(0.04 + sx, 0, sz, 0.47);
    this.anchor = toWorld(F, hipsFwd + 0.04 + sx + sl * 0.47, hipsUp + cl * 0.47, sz);
    const rearShoulder = at(0.04 - sx - K.profile, 0, -sz, 0.47);
    const head = madd(madd(at(0.07, 0, -0.01, 0.7), f, K.head[0]), u, K.head[1]);
    this.eye = madd(madd(at(0.13, 0, -0.005, BODY.eye), f, K.eye[0]), u, K.eye[1]);
    // legs: hips to knees (bent, out) to feet
    const hipF = toWorld(F, pF + 0.08, pU, 0.05), hipB = toWorld(F, pF - 0.08, pU, -0.03);
    const footF = toWorld(F, this.front, 0.05 + this.frontLift, 0.04), footB = toWorld(F, this.back, 0.05 + this.backLift, -0.06);
    const kneeF = knee(hipF, footF, 0.46, 0.46, add(scale(f, 1), [0, 0.2, 0]));
    const kneeB = knee(hipB, footB, 0.46, 0.46, add(scale(f, -0.3), add(scale(r, -0.8), [0, 0.2, 0])));
    // the weapon arm reaches for the grip, just behind the guard
    const P = this.blade ? this.blade.pommel : this.shoulder, G = this.blade ? this.blade.guard : this.shoulder;
    this.hand = this.blade ? madd(G, norm(sub(P, G)), BODY.gripToGuard) : this.shoulder;
    // (the elbow tucked under the forearm, a little out, as an arm carried forward holds it: one elbow, for the blades to
    // meet and for the eye)
    this.elbow = knee(this.shoulder, this.hand, BODY.upperArm, BODY.forearm, add(scale(r, 0.2), [0, -1, 0]));
    this.elbowLook = this.elbow;
    // the rear arm, relaxed, low and a little back (the modern épée carriage: no raised arm); in a lunge it swings back
    // and straightens, for balance. It's posed for the motion's lunge (thrown ahead of the feet, overshooting), turned
    // back with the shoulder, and its hand swings
    const Lr = K.rearLunge, [swF, swU] = K.rearSwing;
    // (its wrist hangs by the thigh, a little behind it, and the elbow is found for the arm's lengths, bending back and
    // out as a relaxed arm's does)
    const rearHand = toWorld(F, pF - 0.06 - 0.4 * Lr - K.profile + 0.3 * tF + swF, pU - 0.03 + 0.06 * Lr + swU, -0.25);
    const rearElbow = knee(rearShoulder, rearHand, BODY.upperArm, BODY.rearForearm, add(scale(f, -1), scale(r, -0.5)));
    this.capsules = [
      // (the trunk is an oval, wide along the piste and thin across it, side on: this, the core, is as thin as it is
      // across; two more at the end of the list widen it fore and aft. Fitted to the dressed figure: devtools/piste-fit.mjs)
      { a: pelvis, b: chest, ra: TRUNK.depth, rb: TRUNK.depth, part: 'torso' },
      { a: chest, b: neck, ra: 0.14, rb: 0.07, part: 'torso' },
      { a: madd(head, f, -0.01), b: madd(head, f, 0.02), ra: 0.14, rb: 0.14, part: 'head' },
      { a: this.shoulder, b: rearShoulder, ra: 0.065, rb: 0.065, part: 'torso' },
      { a: this.shoulder, b: this.elbow, ra: 0.065, rb: 0.055, part: 'arm' },
      { a: this.elbow, b: this.hand, ra: 0.042, rb: 0.036, part: 'arm' },
      { a: this.hand, b: madd(this.hand, norm(sub(P, G)), 0.06), ra: 0.04, rb: 0.035, part: 'hand' },
      { a: rearShoulder, b: rearElbow, ra: 0.062, rb: 0.055, part: 'arm' },
      { a: rearElbow, b: rearHand, ra: 0.04, rb: 0.033, part: 'arm' },
      { a: hipF, b: kneeF, ra: 0.1, rb: 0.08, part: 'leg' },
      { a: kneeF, b: footF, ra: 0.055, rb: 0.04, part: 'leg' },
      { a: hipB, b: kneeB, ra: 0.1, rb: 0.08, part: 'leg' },
      { a: kneeB, b: footB, ra: 0.055, rb: 0.04, part: 'leg' },
      { a: madd(footF, f, -0.07), b: madd(footF, f, 0.15), ra: 0.045, rb: 0.04, part: 'foot' },
      { a: madd(footB, r, -0.07), b: madd(footB, r, 0.12), ra: 0.045, rb: 0.04, part: 'foot' },
      { a: madd(pelvis, f, TRUNK.wide), b: madd(chest, f, TRUNK.wide), ra: TRUNK.depth, rb: TRUNK.depth, part: 'torso' },
      { a: madd(pelvis, f, -TRUNK.wide), b: madd(chest, f, -TRUNK.wide), ra: TRUNK.depth, rb: TRUNK.depth, part: 'torso' },
    ];
  }

  /**
   * Where the intent puts the hand: the pommel and the guard. En garde the guard is a little forward of and below
   * the shoulder, the point up a little and in; extended, the arm is straight at shoulder height, the blade in line.
   */
  handTarget(): [V, V] {
    const F = this.frame, e = this.ext;
    // (a tired arm trembles, at a tired muscle's eight to twelve times a second, and sags)
    const f = this.fatigue, a = this.age, wob = FATIGUE.tremor * f * f;
    const tx = wob * (Math.sin(a * 53.4) * 0.6 + Math.sin(a * 71.9 + 1.3) * 0.4), ty = wob * (Math.sin(a * 61.2 + 2.1) * 0.6 + Math.sin(a * 83.7) * 0.4);
    const G = this.guardFor(e, this.hx + tx, this.hy + ty - FATIGUE.droop * f * e);
    let dir = lineOf(F, e);
    dir = rot(dir, F.u, -this.px);
    dir = rot(dir, norm(cross(dir, F.u)), this.py);
    const P = madd(G, dir, -this.weapon.grip);
    return [P, G];
  }

  /** where the guard is sent at extension `e` with the hand moved (hx right, hy up), within the arm's reach */
  guardFor(e: number, hx: number, hy: number): V {
    const F = this.frame, S = this.anchor, toS = (a: number, b: number, c: number) => add(S, dirWorld(F, a, b, c));
    // (bent, the guard where any arm holds it, a little forward of and below the shoulder (a longer arm is just more
    // bent); straight, along the arm as far as this one reaches)
    const k = ARM / 0.635, mix = (a: number, b: number) => a + (b - a) * e;
    let G = toS(mix(0.36, 0.59 * k), mix(-0.2, -0.04 * k), mix(0.12, 0.01 * k));
    G = add(G, add(scale(F.r, hx), scale(F.u, hy)));
    const reach = ARM, d = sub(G, S), l = len(d);
    if (l > reach) G = madd(S, d, reach / l - 1);
    return G;
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
    this.age += h;
    // (tiring while the arm is out, the more the straighter; recovering while it's bent)
    const e = this.ext;
    this.fatigue = clamp(this.fatigue + h * (e > FATIGUE.from ? ((e - FATIGUE.from) / (1 - FATIGUE.from)) / FATIGUE.tire : -(1 - e) / FATIGUE.rest), 0, 1);
    this.blade.strength = 1 - FATIGUE.weak * this.fatigue;
    this.feet(h);
    this.follow(h);
    const L = this.lunge;
    this.motion.update({
      pelvisF: this.facing * this.s + BODY.lungeHips * L, pelvisU: BODY.pelvis - BODY.lungeDrop * L,
      lunge: L, ext: this.ext, lift: Math.max(this.frontLift, this.backLift), moving: !!this.act, fatigue: this.fatigue,
    }, h);
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
export function aimAt(f: Fencer, p: V, e: number, extraHand: [number, number] = [0, 0]): { hand: [number, number]; point: [number, number] } {
  // the guard doesn't depend on the wrist, so: where this extension puts it, then the wrist that points from there at
  // p (heading and elevation separately: the wrist's turn and tilt are exactly those); the hand shifted a little
  // toward p, and the wrist worked out again from the shifted guard
  const F = f.frame, O = { ...F, o: [0, 0, 0] as V }, base = toLocalDir(O, lineOf(F, e));
  const solve = (hand: [number, number]) => {
    const G = f.guardFor(e, hand[0] + extraHand[0], hand[1] + extraHand[1]), want = toLocalDir(O, norm(sub(p, G)));
    return [Math.atan2(want[2], want[0]) - Math.atan2(base[2], base[0]), Math.atan2(want[1], Math.hypot(want[0], want[2])) - Math.atan2(base[1], Math.hypot(base[0], base[2]))];
  };
  const [y0, p0] = solve([0, 0]);
  const hand: [number, number] = [clamp(y0 * 0.15, -0.08, 0.08), clamp(p0 * 0.2, -0.08, 0.08)];
  const [yaw, pitch] = solve(hand);
  return { point: [clamp(yaw, -0.7, 0.7), clamp(pitch, -0.7, 0.7)], hand };
}
/**
 * How far to extend (0 bent .. 1 straight) for `f`'s point to just reach `p` and press a couple of centimetres into
 * it. At close range a straight arm is longer than the distance, and the point slides past instead of landing: a
 * riposte or an attack from close is made with the arm only as long as it needs to be. (Below 0: too close even bent.)
 */
export function reachFor(f: Fencer, p: V): number {
  const need = len(sub(p, f.anchor)) - f.weapon.blade * 0.985 + 0.025;
  // (the guard's distance from the shoulder runs from about 0.43 m bent to 0.6 m straight for an arm that reaches 0.635 m,
  // the straight end in proportion for a longer one: see guardFor)
  const k = ARM / 0.635;
  return (need - 0.43) / (0.6 * k - 0.43);
}
const toLocalDir = (F: Frame, d: V): V => [dot(d, F.f), dot(d, F.u), dot(d, F.r)];

/** two-bone IK: the joint between `a` and `c`, bones `l1` and `l2`, bent toward `pole` */
export function knee(a: V, c: V, l1: number, l2: number, pole: V): V {
  const d = sub(c, a), L = clamp(len(d), 1e-4, l1 + l2 - 1e-4), dn = norm(d);
  const x = (L * L + l1 * l1 - l2 * l2) / (2 * L), y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pp = sub(pole, scale(dn, dot(pole, dn))), pn = len(pp) > 1e-6 ? norm(pp) : norm(cross(dn, [0, 0, 1]));
  return add(add(a, scale(dn, x)), scale(pn, y));
}
