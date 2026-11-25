/**
 * The body's own motion: how the rest of a fencer's body moves on its own, around the pose the footwork and the arm put it in.
 *
 * The footwork's pose is exact and rigid: the pelvis goes where the feet put it, the trunk is welded on top, the head on
 * the trunk, the rear arm is a pose blended by how far the lunge has gone. A body isn't welded. Its mass lags what the
 * legs do and catches up, its arm swings, it breathes, and standing still it is never quite still. Each of those is
 * here as a small damped spring (or a slow rhythm) driven by the pose's own motion, run in the bout's time substep by
 * substep, so it is deterministic, replays exactly, and slows in bullet time.
 *
 * What it gives back are offsets, in the fencer's frame (forward, up, right), that `Fencer.pose` adds to the rigid
 * pose before it builds the body's capsules (so the blade meets the body that's drawn). The weapon hand is not moved
 * by any of this: where it goes is the intent's, and the arm reaches it from wherever the shoulder has got to.
 *
 * Every effect has its dial in MOTION; set one to zero and that part of the body is rigid again.
 */
import { clamp } from './v3';

export const MOTION = {
  /** the trunk on the pelvis: an inverted pendulum that lags the pelvis's acceleration forward and back (Hz, damping
   * ratio, how far per m/s², at most m; and how much of a stop's throw forward gets through: a fencer braces the trunk
   * as the foot lands, and the trunk carried onto the opponent's point is the classic fault) */
  trunk: { hz: 1.7, zeta: 0.55, gain: 0.6, max: 0.04, brace: 0.3 },
  /** the legs as a spring under the pelvis: it sinks a little as a foot leaves the floor and overshoots a landing */
  legs: { hz: 2.6, zeta: 0.5, gain: 0.6, max: 0.025, lift: 0.3 },
  /** the head keeps itself steadier than the trunk it's on (the eyes level): what share of the trunk's sway and the
   * pelvis's bob it takes out, and the eye more again */
  head: { steady: 0.5, eye: 0.7 },
  /** breathing: breaths a second rested and tired, how far the chest rises rested and tired, m */
  breath: { rest: 0.27, tired: 0.62, lift: 0.0035, tiredLift: 0.009 },
  /** ready: en garde and still, never quite still. A small bob on the legs (m, Hz) and a slow shift of the weight
   * fore and aft (m, Hz), both irregular, both gone in a lunge and quietened in a step */
  ready: { bob: 0.006, bobHz: 1.6, shift: 0.012, shiftHz: 0.19 },
  /** the trunk turns further side-on as the arm extends: the rear shoulder goes back (m at full extension) */
  profile: 0.03,
  /** the rear arm: its pose follows the lunge through a spring that leads it (the arm is thrown before the feet land)
   * and overshoots, and the hand swings from the shoulder's acceleration like a pendulum */
  rear: { hz: 2.3, zeta: 0.38, lead: 0.07, ext: 0.12, swingHz: 1.25, swingZeta: 0.22, swing: 1, max: 0.08 },
};

type V2 = [number, number];
const spring = (x: number, v: number, drive: number, hz: number, zeta: number, h: number): V2 => {
  const w = 2 * Math.PI * hz, a = -w * w * x - 2 * zeta * w * v + drive;
  v += a * h;
  return [x + v * h, v];
};

/** what the pose needs from the body this substep */
export interface Drive {
  /** the rigid pose's pelvis along forward and up (m, in the world: forward is the fencer's) */
  pelvisF: number; pelvisU: number;
  /** how far the lunge has gone, and the weapon arm's extension, 0..1 */
  lunge: number; ext: number;
  /** the feet's lift off the floor, m */
  lift: number;
  /** a step or lunge under way */
  moving: boolean;
  fatigue: number;
}

export class BodyMotion {
  // (the outputs: offsets in the fencer's frame, m)
  /** the pelvis: forward, up */
  pelvis: V2 = [0, 0];
  /** the trunk's top over the pelvis: forward, up (the chest, the shoulders, the neck take it in proportion to height) */
  trunk: V2 = [0, 0];
  /** the head's offset beyond the trunk's (its steadying), and the eye's */
  head: V2 = [0, 0]; eye: V2 = [0, 0];
  /** how far back the rear shoulder turns */
  profile = 0;
  /** the lunge the rear arm is posed for (it leads and overshoots the feet), and its hand's swing: forward, up */
  rearLunge = 0; rearSwing: V2 = [0, 0];

  // (the state)
  private t = 0; private seed: number;
  private lastF = NaN; private lastU = 0; private vF = 0; private vU = 0;
  private lastL = 0;
  private sw: V2 = [0, 0]; private swV: V2 = [0, 0];
  private tr = 0; private trV = 0; private lg = 0; private lgV = 0;
  private rl = 0; private rlV = 0;
  private breath = 0; private ready = 1;

  constructor(seed = 0) { this.seed = seed; }

  /** stand still again (put back en garde): no motion carried over */
  reset() {
    this.lastF = NaN; this.vF = this.vU = 0; this.tr = this.trV = this.lg = this.lgV = 0;
    this.sw = [0, 0]; this.swV = [0, 0]; this.rl = this.rlV = 0; this.lastL = 0;
    this.pelvis = [0, 0]; this.trunk = [0, 0]; this.head = [0, 0]; this.eye = [0, 0]; this.rearSwing = [0, 0];
    this.rearLunge = 0; this.profile = 0;
  }

  update(d: Drive, h: number) {
    const C = MOTION;
    this.t += h;
    // the rigid pelvis's velocity and acceleration (the first substep after a reset only takes note of where it is)
    let aF = 0, aU = 0;
    if (Number.isFinite(this.lastF)) {
      const vF = (d.pelvisF - this.lastF) / h, vU = (d.pelvisU - this.lastU) / h;
      // (clamped: a placement mid-bout would otherwise be an enormous kick)
      aF = clamp((vF - this.vF) / h, -40, 40); aU = clamp((vU - this.vU) / h, -40, 40);
      this.vF = vF; this.vU = vU;
    }
    this.lastF = d.pelvisF; this.lastU = d.pelvisU;

    // the trunk lags the pelvis: accelerating forward leaves it behind, stopping throws it on
    const throwF = -aF * (aF < 0 ? C.trunk.brace : 1);
    [this.tr, this.trV] = spring(this.tr, this.trV, C.trunk.gain * throwF, C.trunk.hz, C.trunk.zeta, h);
    this.tr = clamp(this.tr, -C.trunk.max, C.trunk.max);
    // the legs give under the pelvis: it sinks as a foot lifts, and overshoots a landing
    [this.lg, this.lgV] = spring(this.lg, this.lgV, -C.legs.gain * aU - C.legs.lift * d.lift * (2 * Math.PI * C.legs.hz) ** 2, C.legs.hz, C.legs.zeta, h);
    this.lg = clamp(this.lg, -C.legs.max, C.legs.max);

    // ready: full en garde and still, less in a step, none in a lunge or with the arm out
    const want = (1 - d.lunge) * (d.moving ? 0.35 : 1) * (1 - 0.6 * d.ext);
    this.ready += (want - this.ready) * (1 - Math.exp(-h * 3));
    const s = this.seed, t = this.t, R = C.ready;
    // (irregular: two incommensurate rhythms each, the bob's depth itself wandering)
    const bob = R.bob * this.ready * (0.65 + 0.35 * Math.sin(t * 0.37 + s * 2.1))
      * (0.8 * Math.sin(2 * Math.PI * R.bobHz * t + s) + 0.2 * Math.sin(2 * Math.PI * R.bobHz * 1.618 * t + 2 * s));
    const shift = R.shift * this.ready * (0.7 * Math.sin(2 * Math.PI * R.shiftHz * t + 3 * s) + 0.3 * Math.sin(2 * Math.PI * R.shiftHz * 2.41 * t + s));

    // breathing: faster and deeper as the arm tires (the phase is integrated so a change of rate is smooth)
    const B = C.breath, f = clamp(d.fatigue, 0, 1);
    this.breath += h * 2 * Math.PI * (B.rest + (B.tired - B.rest) * f);
    const inhale = 0.5 - 0.5 * Math.cos(this.breath);
    const chestLift = (B.lift + (B.tiredLift - B.lift) * f) * inhale ** 1.4;

    this.pelvis = [shift, this.lg + bob];
    this.trunk = [this.tr, chestLift];
    // the head takes out part of the trunk's sway and the bob; the eye more
    this.head = [-C.head.steady * this.tr, -C.head.steady * (this.lg + bob)];
    this.eye = [-C.head.eye * this.tr, -C.head.eye * (this.lg + bob)];
    this.profile = C.profile * d.ext;

    // the rear arm: its pose leads the lunge, overshoots, and settles; extending the weapon arm draws it back a little
    const dL = (d.lunge - this.lastL) / h; this.lastL = d.lunge;
    const Rr = C.rear, target = clamp(d.lunge + Rr.lead * dL, -0.2, 1.35) + Rr.ext * d.ext;
    [this.rl, this.rlV] = spring(this.rl, this.rlV, (2 * Math.PI * Rr.hz) ** 2 * target, Rr.hz, Rr.zeta, h);
    this.rearLunge = this.rl;
    // and its hand swings from the shoulder, which moves with the pelvis and the trunk
    const shF = aF, shU = aU;
    for (const [i, a] of [[0, shF], [1, shU]] as const) {
      [this.sw[i], this.swV[i]] = spring(this.sw[i], this.swV[i], -Rr.swing * a, Rr.swingHz, Rr.swingZeta, h);
      this.sw[i] = clamp(this.sw[i], -Rr.max, Rr.max);
    }
    this.rearSwing = [this.sw[0], this.sw[1] + 0.25 * chestLift];
  }
}
