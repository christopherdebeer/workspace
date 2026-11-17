/**
 * Roof Jumps' figure: a skeleton posed from what the runner is doing. No keyframes: every pose is a handful of joint
 * angles worked out from the move and how far through it is, the stride's phase, the landing's weight, the wall.
 *
 * Thirteen bones (pelvis, torso, head, two-part arms, two-part legs, feet), forward kinematics, the hips set at the
 * height that puts the lower foot on the ground. `bones()` gives each bone's matrix and its extent as a tapered
 * block: a renderer can draw those blocks as they are (the lab's does), or hang anything else on the same matrices.
 *
 * Local axes: +z forward, +y up. A limb hangs down its own -y; a positive swing carries it forward.
 *
 * Each move's pose is a function of the body alone (`target`), so a pose can be looked at without running anything:
 * the page's `study=` holds one, and its `sheet=` lays any of them out, five points through each, to be criticised.
 */
import type { Body } from './runner';
import { ident, rotX, rotY, rotZ, translate } from './m4';
import type { M4 } from './m4';

export interface Pose {
  hipL: number; hipR: number; kneeL: number; kneeR: number;
  shL: number; shR: number; elL: number; elR: number;
  /** each arm out from its side */
  spreadL: number; spreadR: number;
  /** the legs apart */
  splay: number;
  spine: number; head: number;
  /** the shoulders turned against the hips */
  twist: number;
  /** the whole body tipped forward about the hips, and over to one side */
  lean: number; tilt: number;
}
const KEYS: (keyof Pose)[] = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'elL', 'elR', 'spreadL', 'spreadR', 'splay', 'spine', 'head', 'twist', 'lean', 'tilt'];
const zero = (): Pose => ({ hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0, shR: 0, elL: 0, elR: 0, spreadL: 0, spreadR: 0, splay: 0, spine: 0, head: 0, twist: 0, lean: 0, tilt: 0 });

/** a bone: its matrix, and its block from y0 (w0 × d0) to y1 (w1 × d1), centred zc along z */
export interface Bone { name: string; m: M4; y0: number; w0: number; d0: number; y1: number; w1: number; d1: number; zc: number }

const THIGH = 0.44, SHIN = 0.44, SOLE = 0.07, HIP = 0.06;
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixes = (ws: number[]) => (...v: number[]) => v.reduce((s, x, i) => s + x * ws[i], 0);
/** a limb's swing: forward for positive */
const sw = (m: M4, a: number) => rotX(m, -a);

export class Rig {
  pose = zero();
  /** 1 on the ground, 0 off it, eased: where the hips ride */
  private stood = 1;
  private hipY = 1;
  private bank = 0;
  private aside = 0;

  /** The pose a body's move asks for. */
  target(r: Body): Pose {
    const p = zero(), s = r.speed / 10, u = r.mu, L = r.lead === 1;
    /** the legs and the arms, by which leg leads */
    const legs = (hipF: number, kneeF: number, hipB: number, kneeB: number) => { if (L) { p.hipL = hipF; p.kneeL = kneeF; p.hipR = hipB; p.kneeR = kneeB; } else { p.hipR = hipF; p.kneeR = kneeF; p.hipL = hipB; p.kneeL = kneeB; } };
    /** the arm opposite the leading leg, and the other */
    const arms = (shF: number, shB: number) => { if (L) { p.shR = shF; p.shL = shB; } else { p.shL = shF; p.shR = shB; } };
    const both = (k: 'el' | 'spread', v: number) => { if (k === 'el') p.elL = p.elR = v; else p.spreadL = p.spreadR = v; };
    /** a run's legs and arms, at a stride of `amp` */
    const stride = (a: number, amp: number, pump: number) => {
      const bend = (x: number) => Math.max(0, Math.cos(x + 0.5));
      p.hipL = 0.18 * amp + 0.95 * amp * Math.sin(a); p.hipR = 0.18 * amp - 0.95 * amp * Math.sin(a);
      p.kneeL = 0.12 + 1.55 * amp * bend(a); p.kneeR = 0.12 + 1.55 * amp * bend(a + Math.PI);
      p.shL = -pump * Math.sin(a); p.shR = pump * Math.sin(a);
      p.elL = 1.45 - 0.35 * Math.sin(a); p.elR = 1.45 + 0.35 * Math.sin(a);
      p.twist = -0.28 * amp * Math.sin(a);
    };
    switch (r.move) {
      case 'run': {
        const amp = Math.min(1.12, s * 0.95), k = Math.min(1, s);
        stride(r.phase, amp, 1.05 * amp);
        p.elL = 0.2 * (1 - k) + p.elL * k; p.elR = 0.2 * (1 - k) + p.elR * k;
        p.spine = 0.05 + 0.12 * s; p.lean = 0.1 * k + 0.13 * s; p.head = -0.14 * s; both('spread', 0.1);
        break;
      }
      case 'dash': {
        // (flat out: far over the front foot, the arms swept back and still)
        stride(r.phase, 1.22, 0);
        p.shL = p.shR = -1.15; both('el', 0.12); both('spread', 0.32); p.twist *= 0.4;
        p.lean = 0.56; p.spine = 0.16; p.head = -0.5;
        break;
      }
      case 'ledge': {
        // (along something narrow: short steps, the arms out and tipping against each other to keep it)
        const w = Math.sin(r.phase * 0.5);
        stride(r.phase, Math.min(0.8, s * 0.8), 0);
        p.shL = p.shR = 0; both('el', 0.1); p.spreadL = 1.3 + 0.3 * w; p.spreadR = 1.3 - 0.3 * w; p.tilt = 0.07 * w; p.twist *= 0.5;
        p.spine = 0.08; p.lean = 0.14; p.head = 0.1;
        break;
      }
      case 'roll': {
        // (a ball, over the shoulders: the turning itself is in bones())
        p.hipL = 1.95; p.hipR = 1.75; p.kneeL = 2.3; p.kneeR = 2.15; p.spine = 0.75; p.head = 0.65;
        p.shL = p.shR = 1.1; both('el', 1.7); both('spread', 0.25);
        break;
      }
      case 'hop': {
        // (a hurdle: the lead leg out over it, the other folded up behind, low and leaning into it)
        const w = sm(0, 0.3, u) * (1 - sm(0.7, 1, u));
        legs(0.5 + 0.95 * w, 0.9 - 0.5 * w, -0.1 - 0.2 * w, 0.5 + 1.75 * w); p.splay = 0.18 * w;
        arms(1.25, -0.9); both('el', 1.2); both('spread', 0.2); p.twist = (L ? -1 : 1) * 0.3;
        p.lean = 0.42; p.spine = 0.2; p.head = -0.3;
        break;
      }
      case 'bound': {
        // (a split in the air: the front leg reaching, the back one left behind, the chest up; then the front leg down for the ground)
        const w = sm(0, 0.3, u) * (1 - sm(0.72, 1, u)), d = sm(0.72, 1, u);
        legs(0.45 + 1.0 * w + 0.25 * d, 0.5 - 0.35 * w - 0.2 * d, 0.1 - 1.25 * w, 0.9 - 0.45 * w + 0.4 * d);
        arms(0.95 * w + 0.4, -1.1 * w - 0.2); both('el', 0.9); both('spread', 0.35); p.twist = (L ? -1 : 1) * 0.35 * w;
        p.lean = 0.26 - 0.1 * w; p.spine = -0.22 * w; p.head = -0.1;
        break;
      }
      case 'flip': {
        // (tucked tight and turned over forwards; opened out again to land)
        const t = sm(0.05, 0.3, u) * (1 - sm(0.78, 1, u));
        legs(0.3 + 1.5 * t, 0.3 + 1.9 * t, 0.1 + 1.55 * t, 0.4 + 1.75 * t);
        p.shL = p.shR = 2.6 - 1.5 * t; both('el', 0.2 + 1.3 * t); both('spread', 0.35 - 0.15 * t);
        p.spine = 0.6 * t; p.head = 0.5 * t; p.lean = 0.1;
        break;
      }
      case 'spring': {
        // (straight up off both feet, long, the arms thrown up; knees to the chest over the top; then down, feet apart)
        const m = mixes([1 - sm(0.3, 0.5, u), sm(0.3, 0.5, u) * (1 - sm(0.68, 0.88, u)), sm(0.68, 0.88, u)]);
        legs(m(0.05, 1.55, 0.6), m(0.15, 2.0, 0.75), m(-0.3, 1.35, 0.45), m(0.35, 1.85, 0.6));
        p.shL = p.shR = m(0.35, 0.5, 0.2); both('el', m(0.1, 0.6, 0.25)); both('spread', m(2.65, 1.5, 1.2)); p.splay = m(0, 0.1, 0.3);
        p.spine = m(-0.2, 0.4, 0.1); p.lean = m(0.08, 0.2, 0.12); p.head = m(-0.3, 0.1, 0.25);
        break;
      }
      case 'dive': {
        // (headfirst and flat, the hands leading, the legs left out behind; folding at the end into the roll)
        const f = sm(0, 0.3, u), t = sm(0.78, 1, u);
        legs(-0.05 + 1.5 * t, 0.1 + 1.8 * t, -0.3 + 1.6 * t, 0.45 + 1.5 * t);
        p.shL = p.shR = 2.85 - 0.9 * t; both('el', 0.1 + 0.9 * t); both('spread', 0.22);
        p.lean = 0.3 + 1.05 * f + 0.25 * t; p.spine = -0.12 + 0.6 * t; p.head = -0.75 + 1.1 * t;
        break;
      }
      case 'glide': {
        // (the slow one: upright, the arms straight out, one knee a little raised, the other leg trailing)
        legs(0.3, 0.75, -0.28, 0.2);
        p.shL = p.shR = -0.12; both('el', 0.05); both('spread', 1.5);
        p.spine = -0.1; p.lean = 0.26; p.head = -0.2;
        break;
      }
      case 'climb': {
        // (up a wall: a run stood on end, leaning back off it, the hands going up ahead)
        const a = r.climbT * 15;
        p.hipL = 0.75 + 0.65 * Math.sin(a); p.hipR = 0.75 - 0.65 * Math.sin(a);
        p.kneeL = 0.85 + 0.65 * Math.cos(a); p.kneeR = 0.85 - 0.65 * Math.cos(a);
        p.shL = 2.5 - 0.55 * Math.sin(a); p.shR = 2.5 + 0.55 * Math.sin(a); both('el', 0.5); both('spread', 0.12);
        p.spine = -0.12; p.lean = -0.2; p.head = -0.45;
        break;
      }
      case 'wallrun': {
        // (along a wall: tipped right off it, the feet on it; the near arm trailing along it, the far one out for balance)
        stride(r.wallT * 14 + r.lead * Math.PI, 1.0, 0.5);
        const near = r.wallSide > 0;
        p.tilt = r.wallSide * 0.82; p.lean = 0.22; p.spine = 0.1; p.head = -0.2;
        if (near) { p.spreadL = 0.25; p.shL = -0.5; p.elL = 0.3; p.spreadR = 1.45; p.shR = 0.1; p.elR = 0.15; }
        else { p.spreadR = 0.25; p.shR = -0.5; p.elR = 0.3; p.spreadL = 1.45; p.shL = 0.1; p.elL = 0.15; }
        break;
      }
    }
    // (a landing's weight: down into the legs, the feet apart, the arms out and back)
    const c = r.state === 'ground' && r.move !== 'roll' ? r.land : 0;
    if (c > 0) {
      p.hipL += 1.05 * c; p.hipR += 1.05 * c; p.kneeL += 1.8 * c; p.kneeR += 1.8 * c; p.spine += 0.45 * c; p.splay += 0.22 * c;
      p.shL -= 0.45 * c; p.shR -= 0.45 * c; p.spreadL += 0.7 * c; p.spreadR += 0.7 * c; p.head -= 0.1 * c;
    }
    return p;
  }

  /** Ease the pose toward the body's; `dt` large sets it at once. */
  update(dt: number, r: Body): void {
    const t = this.target(r), k = 1 - Math.exp(-(r.state === 'ground' ? 28 : 18) * dt);
    for (const key of KEYS) this.pose[key] += (t[key] - this.pose[key]) * k;
    this.stood += ((r.state === 'ground' ? 1 : 0) - this.stood) * (1 - Math.exp(-14 * dt));
    this.bank += (Math.max(-0.45, Math.min(0.45, r.turn * 0.06 * Math.min(1, r.speed / 8))) - this.bank) * (1 - Math.exp(-10 * dt));
    this.aside += ((r.move === 'wallrun' ? -r.wallSide * 0.5 : 0) - this.aside) * (1 - Math.exp(-16 * dt));
    // (the hips: where the lower foot reaches the ground; in the air, where they'd be standing, so the feet come up to them)
    const p = this.pose, leg = (hip: number, knee: number) => THIGH * Math.cos(hip) * Math.cos(p.splay) + SHIN * Math.cos(hip - knee) * Math.cos(p.splay);
    // (but a run has its moment off the ground, both legs out: the hips don't drop into the split, they carry over it)
    const striding = r.move === 'run' || r.move === 'dash' || r.move === 'ledge', pace = Math.min(1, r.speed / 6);
    const carry = striding ? (0.9 + 0.05 * Math.abs(Math.cos(r.phase))) * pace - 0.55 * r.land : 0;
    const ground = Math.max(carry, HIP + Math.max(leg(p.hipL, p.kneeL), leg(p.hipR, p.kneeR)) + SOLE) + (r.move === 'roll' ? 0.16 : 0);
    this.hipY = ground * this.stood + 0.98 * (1 - this.stood);
  }

  /** The skeleton, placed in the world at the body. */
  bones(r: Body): Bone[] {
    const p = this.pose, out: Bone[] = [];
    // (turned right over, forwards, through a flip or a roll)
    const spin = r.move === 'flip' ? 2 * Math.PI * sm(0.08, 0.9, r.mu) : r.move === 'roll' ? 2 * Math.PI * sm(0, 1, r.mu) : 0;
    let P = rotY(translate(ident(), r.x, r.y, r.z), r.heading);
    P = rotZ(rotX(translate(P, this.aside, this.hipY, 0), p.lean + spin), this.bank + p.tilt);
    const add = (name: string, m: M4, y0: number, w0: number, d0: number, y1: number, w1: number, d1: number, zc = 0) => out.push({ name, m, y0, w0, d0, y1, w1, d1, zc });
    add('pelvis', P, -0.09, 0.26, 0.17, 0.1, 0.3, 0.18);
    const S = rotY(rotX(translate(P, 0, 0.1, 0), p.spine), p.twist);
    add('torso', S, 0, 0.27, 0.16, 0.47, 0.37, 0.21);
    add('head', rotX(translate(S, 0, 0.5, 0), p.head), 0, 0.16, 0.18, 0.23, 0.18, 0.2, 0.015);
    for (const side of [1, -1]) {
      const L = side > 0, n = L ? 'L' : 'R';
      const A = sw(rotZ(translate(S, side * 0.225, 0.43, 0), side * (L ? p.spreadL : p.spreadR)), L ? p.shL : p.shR);
      add('upperArm' + n, A, 0, 0.09, 0.09, -0.29, 0.075, 0.075);
      add('foreArm' + n, sw(translate(A, 0, -0.29, 0), L ? p.elL : p.elR), 0, 0.075, 0.075, -0.31, 0.055, 0.06);
      const hip = L ? p.hipL : p.hipR, knee = L ? p.kneeL : p.kneeR;
      const T = sw(rotZ(translate(P, side * 0.095, -HIP, 0), side * p.splay), hip);
      add('thigh' + n, T, 0, 0.135, 0.14, -THIGH, 0.1, 0.105);
      const K = sw(translate(T, 0, -THIGH, 0), -knee);
      add('shin' + n, K, 0, 0.095, 0.1, -SHIN, 0.07, 0.075);
      // (the foot: flat to the ground when it's on it, the toe pointed when it isn't)
      add('foot' + n, sw(translate(K, 0, -SHIN, 0), -(hip - knee) * (0.35 + 0.5 * this.stood) - 0.5 * (1 - this.stood)), -SOLE, 0.085, 0.25, 0, 0.08, 0.2, 0.06);
    }
    return out;
  }
}
