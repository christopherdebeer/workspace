/**
 * Roof Jumps' figure: a skeleton posed from what the runner is doing. No keyframes: every pose is a handful of joint
 * angles worked out from the stride's phase, the flight's rise and fall, the landing's weight, the wall.
 *
 * Thirteen bones (pelvis, torso, head, two-part arms, two-part legs, feet), forward kinematics, the hips set at the
 * height that puts the lower foot on the ground. `bones()` gives each bone's matrix and its extent as a tapered
 * block: a renderer can draw those blocks as they are (the lab's does), or hang anything else on the same matrices.
 *
 * Local axes: +z forward, +y up. A limb hangs down its own -y; a positive swing carries it forward.
 */
import type { Runner } from './runner';
import { ident, rotX, rotY, rotZ, translate } from './m4';
import type { M4 } from './m4';

export interface Pose {
  hipL: number; hipR: number; kneeL: number; kneeR: number;
  shL: number; shR: number; elL: number; elR: number;
  /** the arms out from the sides */
  spread: number;
  spine: number; head: number;
  /** the whole body tipped forward about the hips */
  lean: number;
}
const KEYS: (keyof Pose)[] = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'elL', 'elR', 'spread', 'spine', 'head', 'lean'];
const zero = (): Pose => ({ hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0, shR: 0, elL: 0, elR: 0, spread: 0, spine: 0, head: 0, lean: 0 });

/** a bone: its matrix, and its block from y0 (w0 × d0) to y1 (w1 × d1), centred zc along z */
export interface Bone { name: string; m: M4; y0: number; w0: number; d0: number; y1: number; w1: number; d1: number; zc: number }

const THIGH = 0.44, SHIN = 0.44, SOLE = 0.07, HIP = 0.06;
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** a limb's swing: forward for positive */
const sw = (m: M4, a: number) => rotX(m, -a);

export class Rig {
  pose = zero();
  /** 1 on the ground, 0 off it, eased: where the hips ride */
  private stood = 1;
  private hipY = 1;
  private bank = 0;

  /** The pose the runner's state asks for. */
  target(r: Runner): Pose {
    const p = zero(), s = Math.min(1.25, r.speed / 10);
    if (r.state === 'ground') {
      const a = r.phase, bend = (x: number) => Math.max(0, Math.cos(x + 0.5));
      p.hipL = s * (0.2 + 0.85 * Math.sin(a)); p.hipR = s * (0.2 - 0.85 * Math.sin(a));
      p.kneeL = 0.1 + s * 1.35 * bend(a); p.kneeR = 0.1 + s * 1.35 * bend(a + Math.PI);
      p.shL = -s * 0.85 * Math.sin(a); p.shR = s * 0.85 * Math.sin(a);
      p.elL = p.elR = 0.2 + 1.2 * Math.min(1, s);
      p.spine = 0.06 + 0.18 * s; p.lean = 0.16 * s; p.head = -0.1 * s; p.spread = 0.08;
    } else if (r.state === 'air') {
      // (the flight: driving up off one leg, tucked over the top, reaching down for the landing)
      const u = Math.max(-1, Math.min(1, r.vy / Math.max(6, r.vy0))), up = sm(0.15, 0.7, u), down = sm(0.15, 0.7, -u), top = 1 - up - down;
      const mix = (a: number, b: number, c: number) => a * up + b * top + c * down;
      const hipF = mix(1.25, 1.35, 0.8), kneeF = mix(1.5, 1.75, 0.45), hipB = mix(-0.75, 0.9, 0.3), kneeB = mix(0.35, 1.6, 0.75);
      const shF = mix(1.5, 0.9, 2.5), shB = mix(-0.7, 0.9, 2.3);
      if (r.lead) { p.hipL = hipF; p.kneeL = kneeF; p.hipR = hipB; p.kneeR = kneeB; p.shR = shF; p.shL = shB; }
      else { p.hipR = hipF; p.kneeR = kneeF; p.hipL = hipB; p.kneeL = kneeB; p.shL = shF; p.shR = shB; }
      p.elL = p.elR = mix(0.9, 0.7, 0.3); p.spread = mix(0.1, 0.45, 0.5);
      p.spine = mix(0.05, 0.35, 0); p.lean = mix(0.28, 0.12, -0.1); p.head = mix(-0.15, 0, 0.2);
    } else {
      // (up a wall: a run stood on end, the hands going up ahead)
      const a = r.climbT * 15;
      p.hipL = 0.7 + 0.6 * Math.sin(a); p.hipR = 0.7 - 0.6 * Math.sin(a);
      p.kneeL = 0.8 + 0.6 * Math.cos(a); p.kneeR = 0.8 - 0.6 * Math.cos(a);
      p.shL = 2.5 - 0.5 * Math.sin(a); p.shR = 2.5 + 0.5 * Math.sin(a); p.elL = p.elR = 0.5;
      p.spine = -0.1; p.lean = -0.12; p.head = -0.4; p.spread = 0.1;
    }
    // (a landing's weight: down into the legs, the arms back; a roll is all of that)
    const c = r.roll >= 0 ? 1 : r.state === 'ground' ? r.land : 0;
    if (c > 0) {
      p.hipL += 1.0 * c; p.hipR += 1.0 * c; p.kneeL += 1.7 * c; p.kneeR += 1.7 * c; p.spine += 0.5 * c;
      p.shL -= 0.5 * c; p.shR -= 0.5 * c; p.head += 0.3 * c;
    }
    return p;
  }

  update(dt: number, r: Runner): void {
    const t = this.target(r), k = 1 - Math.exp(-(r.state === 'ground' ? 26 : 13) * dt);
    for (const key of KEYS) this.pose[key] += (t[key] - this.pose[key]) * k;
    this.stood += ((r.state === 'ground' ? 1 : 0) - this.stood) * (1 - Math.exp(-14 * dt));
    this.bank += (Math.max(-0.4, Math.min(0.4, r.turn * 0.05 * Math.min(1, r.speed / 8))) - this.bank) * (1 - Math.exp(-10 * dt));
    // (the hips: where the lower foot reaches the ground; in the air, where they'd be standing, so the feet come up to them)
    const p = this.pose, leg = (hip: number, knee: number) => THIGH * Math.cos(hip) + SHIN * Math.cos(hip - knee);
    const ground = HIP + Math.max(leg(p.hipL, p.kneeL), leg(p.hipR, p.kneeR)) + SOLE;
    this.hipY = ground * this.stood + 0.98 * (1 - this.stood);
  }

  /** The skeleton, placed in the world at the runner. */
  bones(r: Runner): Bone[] {
    const p = this.pose, out: Bone[] = [];
    const flip = r.roll >= 0 ? 2 * Math.PI * sm(0, 1, r.roll) : 0;
    let P = rotY(translate(ident(), r.x, r.y, r.z), r.heading);
    P = rotZ(rotX(translate(P, 0, this.hipY, 0), p.lean + flip), this.bank);
    const add = (name: string, m: M4, y0: number, w0: number, d0: number, y1: number, w1: number, d1: number, zc = 0) => out.push({ name, m, y0, w0, d0, y1, w1, d1, zc });
    add('pelvis', P, -0.09, 0.26, 0.17, 0.1, 0.3, 0.18);
    const S = rotX(translate(P, 0, 0.1, 0), p.spine);
    add('torso', S, 0, 0.27, 0.16, 0.47, 0.37, 0.21);
    add('head', rotX(translate(S, 0, 0.5, 0), p.head), 0, 0.16, 0.18, 0.23, 0.18, 0.2, 0.015);
    for (const side of [1, -1]) {
      const L = side > 0, n = L ? 'L' : 'R';
      const A = sw(rotZ(translate(S, side * 0.225, 0.43, 0), -side * p.spread), L ? p.shL : p.shR);
      add('upperArm' + n, A, 0, 0.09, 0.09, -0.29, 0.075, 0.075);
      add('foreArm' + n, sw(translate(A, 0, -0.29, 0), L ? p.elL : p.elR), 0, 0.075, 0.075, -0.31, 0.055, 0.06);
      const hip = L ? p.hipL : p.hipR, knee = L ? p.kneeL : p.kneeR;
      const T = sw(translate(P, side * 0.095, -HIP, 0), hip);
      add('thigh' + n, T, 0, 0.135, 0.14, -THIGH, 0.1, 0.105);
      const K = sw(translate(T, 0, -THIGH, 0), -knee);
      add('shin' + n, K, 0, 0.095, 0.1, -SHIN, 0.07, 0.075);
      // (the foot: flat to the ground when it's on it, the toe pointed when it isn't)
      add('foot' + n, sw(translate(K, 0, -SHIN, 0), -(hip - knee) * (0.35 + 0.5 * this.stood) - 0.5 * (1 - this.stood)), -SOLE, 0.085, 0.25, 0, 0.08, 0.2, 0.06);
    }
    return out;
  }
}
