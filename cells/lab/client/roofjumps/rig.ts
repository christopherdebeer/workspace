/**
 * Roof Jumps' figure: a skeleton posed from what the runner is doing. No keyframes: every pose is a handful of joint
 * angles worked out from the move and how far through it is, the stride's phase, the landing's weight, the wall.
 *
 * Thirteen bones (pelvis, torso, head, two-part arms, two-part legs, feet), forward kinematics, the hips set at the
 * height that puts the lower foot on the ground. `bones()` gives each bone's matrix and its extent as a tapered
 * block: a renderer can draw those blocks as they are (the lab's does), or hang anything else on the same matrices.
 *
 * The poses are half of it. The other half is reach: where the body says a hand wants to be (a hold: an edge, a sill,
 * a pipe, the wall, the ground), the arm is taken there, shoulder to elbow to hand, whatever the pose had it doing; and
 * let go of as smoothly. The feet the same: a foot that's down is where it was put (on the roof, a lip, a rail, a sill,
 * the wall) and stays there while the body goes over it. So the figure is posed like a drawing and holds on like a
 * mannequin.
 *
 * Local axes: +z forward, +y up. A limb hangs down its own -y; a positive swing carries it forward.
 *
 * Each move's pose is a function of the body alone (`target`), so a pose can be looked at without running anything:
 * the page's `study=` holds one, and its `sheet=` lays any of them out, five points through each, to be criticised.
 */
import type { Body } from './runner';
import { ident, point, rotX, rotY, rotZ, translate } from './m4';
import type { M4 } from './m4';
import { bodyOf, characterByName } from './character';
import { clipPose, MOCAP, swingPath } from './mocap';
import type { Body as Build, Block, Character } from './character';

/** the pose keys the captured locomotion gives */
const MOCAP_KEYS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'elL', 'elR', 'spreadL', 'spreadR', 'splay', 'hips', 'twist', 'lean', 'spine'] as const;

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
  /** the hips let down, off the ground: the body brought to what a hand is on */
  sink: number;
  /** the head turned (to its left +): it leads */
  look: number;
  /** the hips turned (to its left +): with the leading leg, the shoulders against them */
  hips: number;
}
const KEYS: (keyof Pose)[] = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'elL', 'elR', 'spreadL', 'spreadR', 'splay', 'spine', 'head', 'twist', 'lean', 'tilt', 'sink', 'look', 'hips'];
const zero = (): Pose => ({ hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, shL: 0, shR: 0, elL: 0, elR: 0, spreadL: 0, spreadR: 0, splay: 0, spine: 0, head: 0, twist: 0, lean: 0, tilt: 0, sink: 0, look: 0, hips: 0 });

/** a bone: its matrix, and its block from y0 (w0 × d0) to y1 (w1 × d1), centred zc along z */
export interface Bone { name: string; m: M4; y0: number; w0: number; d0: number; y1: number; w1: number; d1: number; zc: number; x?: number; mat?: number }

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** a bone's matrix at `o`, its own -y toward `to` (a limb hangs down its -y), turned about that as `fwd` suggests */
function aim(o: V3, to: V3, fwd: V3): M4 {
  const y = unit(sub(o, to)), x = unit(cross(y, fwd)), z = cross(x, y), m = ident();
  m[0] = x[0]; m[1] = x[1]; m[2] = x[2]; m[4] = y[0]; m[5] = y[1]; m[6] = y[2]; m[8] = z[0]; m[9] = z[1]; m[10] = z[2]; m[12] = o[0]; m[13] = o[1]; m[14] = o[2];
  return m;
}
/** an angle taken toward another by a share, the short way round */
const turnTo = (a: number, b: number, k: number) => { let d = b - a; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return a + d * k; };
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mixes = (ws: number[]) => (...v: number[]) => v.reduce((s, x, i) => s + x * ws[i], 0);
/** a limb's swing: forward for positive */
const sw = (m: M4, a: number) => rotX(m, -a);

export class Rig {
  /** who it draws: the character, and the body worked out from its proportions (character.ts) */
  readonly character: Character; readonly body: Build;
  constructor(character?: Character) { this.character = character ?? characterByName(null); this.body = bodyOf(this.character.proportions); }
  pose = zero();
  /** each joint's speed toward its pose; and the chest's lag behind the hips (rad) and its speed, the hips' last height
   * and speed: weight */
  private vel = zero(); private ph = 0; private lastPhase = 0; toe = [0, 0];
  /** how far a flight has got ready for the ground: it only goes on, so the ground falling away beneath (over an edge) never
   * unfolds it */
  private prep = 0; private chest = 0; private chestV = 0; private lastHip = 1; private hipV = 0;
  /** 1 on the ground, 0 off it, eased: where the hips ride */
  stood = 1;
  hipY = 1;
  /** how far this frame's pose is a running stride carried across a gap (followed as briskly as on the ground) */
  private carriedK = 0;
  bank = 0;
  private aside = 0;
  /** the pelvis carried toward a footfall the leg couldn't otherwise reach (world, m) */
  give: V3 = [0, 0, 0];
  /** a jump in where the body is that its motion doesn't explain (put onto a lip, onto a wall's top), drawn out of over a
   * tenth of a second rather than snapped to (world, m) */
  private slip: V3 = [0, 0, 0]; private was: V3 | null = null; private wasState = ''; private wasV: V3 = [0, 0, 0];
  /** each hand's reach: how much it has hold of the arm (0..1), and where to */
  private hands = { L: { w: 0, p: [0, 0, 0] as V3 }, R: { w: 0, p: [0, 0, 0] as V3 } };
  /** and each foot's: planted where it was put, the body going over it; and which way what it's on faces */
  soles = { L: { w: 0, p: [0, 0, 0] as V3, lost: false, yaw: 0, off: [0, 0, 0] as V3, aim: null as V3 | null, coming: false }, R: { w: 0, p: [0, 0, 0] as V3, lost: false, yaw: 0, off: [0, 0, 0] as V3, aim: null as V3 | null, coming: false } };
  on: V3 = [0, 1, 0];
  /** each free leg swung out at the hip (rad), so its foot keeps to its own side of the line, not across behind the other;
   * and how far to its own side each free foot was last drawn (m; null when down) */
  /** how far the clips have the legs (0..1): set by `target` */
  mocapK = 0;
  private legOut = [0, 0]; private freeLat: (number | null)[] = [null, null];

  /** The pose a body's move asks for. */
  target(r: Body, ph = r.phase): Pose {
    const p = zero(), s = r.speed / 10, u = r.mu, L = r.lead === 1;
    this.mocapK = 0;
    /** the legs and the arms, by which leg leads */
    const legs = (hipF: number, kneeF: number, hipB: number, kneeB: number) => { if (L) { p.hipL = hipF; p.kneeL = kneeF; p.hipR = hipB; p.kneeR = kneeB; } else { p.hipR = hipF; p.kneeR = kneeF; p.hipL = hipB; p.kneeL = kneeB; } };
    /** the arm opposite the leading leg, and the other */
    const arms = (shF: number, shB: number) => { if (L) { p.shR = shF; p.shL = shB; } else { p.shL = shF; p.shR = shB; } };
    const both = (k: 'el' | 'spread', v: number) => { if (k === 'el') p.elL = p.elR = v; else p.spreadL = p.spreadR = v; };
    /** a run's legs and arms, at a stride of `amp` */
    const stride = (a: number, amp: number, pump: number) => {
      const bend = (x: number) => Math.max(0, Math.cos(x + 0.5));
      // (the thigh driven well forward, the heel kicked up high behind after it leaves the ground)
      // (and reaching out in front late in the swing, so the foot meets the ground where it's to land)
      const reach = (x: number) => 0.25 * amp * Math.max(0, Math.sin(x + 0.9));
      p.hipL = 0.22 * amp + 1.08 * amp * Math.sin(a) + reach(a); p.hipR = 0.22 * amp - 1.08 * amp * Math.sin(a) + reach(a + Math.PI);
      p.kneeL = 0.12 + 1.7 * amp * bend(a); p.kneeR = 0.12 + 1.7 * amp * bend(a + Math.PI);
      p.shL = -pump * Math.sin(a); p.shR = pump * Math.sin(a);
      p.elL = 1.45 - 0.35 * Math.sin(a); p.elR = 1.45 + 0.35 * Math.sin(a);
      // (the hips turned with the leading leg, the shoulders further the other way, with the arms)
      const sw = Math.max(amp, Math.abs(pump)); p.hips = -0.12 * sw * Math.sin(a); p.twist = 0.4 * sw * Math.sin(a);
    };
    /**
     * The run, each leg by where it is in its own cycle (0 its touchdown, through its stance to its push-off at the stance's
     * share, then its swing back to the next touchdown): down, the thigh going from ahead to behind (the foot's held by its
     * footfall anyway); off, the knee folding fast to its deepest about two fifths through the swing, the thigh driven
     * through, then the shin reaching out to straighten nearly by touchdown, the thigh just retracting to meet the ground.
     * The arms go with the opposite legs.
     */
    const gait = (amp: number, pump: number) => {
      const sd = r.stanceFrac ?? 0.25, F = Math.PI / 2 + 0.3;
      const leg = (off: number) => {
        const c = ((((ph + off - F) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
        if (c < sd) { const s = c / sd; return { hip: (0.42 - 0.95 * s) * amp, knee: 0.35 + 0.45 * Math.sin(Math.PI * s) }; }
        // (the fold eased in off the ground (the heel coming up as the toe leaves, as fast as a knee does), deepest two fifths
        // through)
        const w = (c - sd) / (1 - sd), x = Math.min(1, w / 0.42), fold = (0.5 * (1 - (1 - x) * (1 - x)) + 0.5 * sm(0, 0.42, w)) * (1 - sm(0.42, 0.92, w));
        // (driven through, then pawed back to where the stance takes it from: the thigh lands where the stance starts)
        const hip = (-0.53 + 1.6 * sm(0.05, 0.72, w) - 0.65 * sm(0.72, 1, w)) * amp;
        // (folded heel toward the seat at speed, but no tighter than a sprinter's ~130°)
        return { hip, knee: 0.3 + Math.min(1.98, 0.1 + 1.85 * amp) * fold };
      };
      const a = leg(0), b = leg(Math.PI);
      p.hipL = a.hip; p.kneeL = a.knee; p.hipR = b.hip; p.kneeR = b.knee;
      p.shL = pump * b.hip / Math.max(0.3, amp); p.shR = pump * a.hip / Math.max(0.3, amp);
      p.elL = 1.45 + 0.3 * (b.hip / Math.max(0.3, amp)); p.elR = 1.45 + 0.3 * (a.hip / Math.max(0.3, amp));
      // (the hips turned with the leading leg; the shoulders against them, with the arms)
      p.hips = -0.12 * (a.hip - b.hip) / 2; p.twist = 0.4 * (a.hip - b.hip) / 2;
      // (the legs set a little in from the hips, so the feet come down near the line the body runs on, as a runner's do)
      p.splay = -0.07;
    };
    /** a running leg at `c` through its own cycle (0 its touchdown, the stance to `sd`, its swing back to 1): as `gait` has it */
    const legAt = (c: number, amp: number, sd: number) => {
      c = ((c % 1) + 1) % 1;
      if (c < sd) { const s2 = c / sd; return { hip: (0.42 - 0.95 * s2) * amp, knee: 0.35 + 0.45 * Math.sin(Math.PI * s2) }; }
      const w = (c - sd) / (1 - sd), x = Math.min(1, w / 0.42), fold = (0.5 * (1 - (1 - x) * (1 - x)) + 0.5 * sm(0, 0.42, w)) * (1 - sm(0.42, 0.92, w));
      return { hip: (-0.53 + 1.6 * sm(0.05, 0.72, w) - 0.65 * sm(0.72, 1, w)) * amp, knee: 0.3 + Math.min(1.98, 0.1 + 1.85 * amp) * fold };
    };
    /**
     * A small running jump carried in one stride (how far it is that way, 0..1): off the ground at a run, a short flight. The
     * flight is the stride's own, stretched to fit it: the push leg from its toe-off through its fold, the heel recovering
     * behind the hips; the other leg driven through and reaching out to take the far side. Each leg finishing what it
     * started, not both gathered under the hips to start again on landing.
     */
    // (not a precision: there the feet coming together is the point, the pace to be killed on landing)
    const carried = r.state === 'air' && r.move === 'bound' && r.from === 'ground' && r.speed > 4 && !r.precise ? 1 - sm(0.5, 0.75, r.flightT ?? 9) : 0;
    this.carriedK = carried;
    const strideThrough = (k: number) => {
      const sd = r.stanceFrac ?? 0.25, amp = Math.min(1.2, s * 1.05), cp = sd + (0.5 - sd) * Math.min(1, u);
      const push = legAt(cp, amp, sd), drive = legAt(cp + 0.5, amp, sd);
      // (the front leg is the one that didn't push: `legs` puts its first pair on it)
      const was = { ...p }; legs(drive.hip, drive.knee, push.hip, push.knee);
      const pump = 1.05 * amp, f = drive.hip / Math.max(0.3, amp), b = push.hip / Math.max(0.3, amp);
      if (L) { p.shL = pump * b; p.shR = pump * f; p.elL = 1.45 + 0.3 * b; p.elR = 1.45 + 0.3 * f; } else { p.shR = pump * b; p.shL = pump * f; p.elR = 1.45 + 0.3 * b; p.elL = 1.45 + 0.3 * f; }
      { const hl = L ? drive.hip : push.hip, hr = L ? push.hip : drive.hip; p.hips = -0.12 * (hl - hr) / 2; p.twist = 0.4 * (hl - hr) / 2; }
      p.lean = Math.min(0.5, 0.12 + 0.28 * s); p.spine = 0.06 + 0.12 * s; p.head = -0.3 * s; p.splay = -0.07;
      for (const key of KEYS) p[key] = was[key] + (p[key] - was[key]) * k;
    };
    switch (r.move) {
      case 'run': {
        const amp = Math.min(1.12, s * 0.95), k = Math.min(1, s);
        // (from a jog up, keyed to the feet; the two crossfaded so going through 2 m/s isn't a jump)
        const gk = r.state === 'ground' ? sm(1.6, 2.6, r.speed) : 0;
        // (a walk swings its arms more than its stride's size alone would: an easy swing, the elbows a little bent)
        const wk = r.state === 'ground' ? sm(0.2, 1, r.speed) * (1 - gk) : 0;
        if (gk < 1) stride(ph, amp, 1.05 * Math.max(amp, 0.42 * wk));
        if (gk > 0) { const was = { ...p }; gait(amp, 0.9 * amp); if (gk < 1) for (const key of KEYS) p[key] = was[key] + (p[key] - was[key]) * gk; }
        p.elL = 0.2 * (1 - k) + p.elL * k; p.elR = 0.2 * (1 - k) + p.elR * k;
        // (low and driving at pace, pitched well forward from the ankles, the head up to see where it's going)
        p.spine = 0.06 + 0.12 * s; p.lean = Math.min(0.58, 0.1 * k + 0.28 * s); p.head = -0.3 * s; both('spread', 0.1);
        // (the legs posed against the upright, not the leaning pelvis: the lean taken back out of them)
        p.hipL += p.lean * gk; p.hipR += p.lean * gk;
        // (on the ground below a sprint: the legs, the arms and the trunk as people move, from the captured walk, jog and run,
        // each leg at its own place in the runner's stride, stretched to its stance (mocap.ts); the feet still the rig's)
        const mk = MOCAP.on && r.state === 'ground' ? 1 - sm(6, 8, r.speed) : 0;
        this.mocapK = mk;
        if (mk > 0) {
          const F = Math.PI / 2 + 0.3, TAU = 2 * Math.PI, at = (o: number) => ((((ph - F - o) % TAU) + TAU) % TAU) / TAU;
          const c = clipPose(r.speed, at(0), at(Math.PI), r.stanceFrac ?? 0.25);
          // (the chest's pitch is the clip's movement about the rig's own carriage)
          if (c) for (const key of MOCAP_KEYS) if (key in c) p[key] += key === 'spine' ? c[key] * mk : (c[key] - p[key]) * mk;
        }
        break;
      }
      case 'dash': {
        // (flat out: far over the front foot, the arms swept back and still)
        if (r.state === 'ground' && r.speed > 2) gait(1.15, 0); else stride(ph, 1.22, 0);
        p.shL = p.shR = -1.15; both('el', 0.12); both('spread', 0.32); p.twist *= 0.4;
        p.lean = 0.56; p.spine = 0.16; p.head = -0.5;
        if (r.state === 'ground' && r.speed > 2) { p.hipL += p.lean; p.hipR += p.lean; }
        break;
      }
      case 'ledge': {
        // (along something narrow: short steps, the arms out and tipping against each other to keep it)
        const w = Math.sin(ph * 0.5);
        stride(ph, Math.min(0.8, s * 0.8), 0);
        p.shL = p.shR = 0; both('el', 0.1); p.spreadL = 1.3 + 0.3 * w; p.spreadR = 1.3 - 0.3 * w; p.tilt = 0.07 * w; p.twist *= 0.5;
        p.spine = 0.08; p.lean = 0.14; p.head = 0.1;
        break;
      }
      case 'roll': {
        // (a ball, over the shoulders: the turning itself is in bones())
        const open = sm(0.62, 1, u);
        legs(1.95 - 1.1 * open, 2.3 - 1.2 * open, 1.75 - 1.8 * open, 2.15 - 1.4 * open);
        p.spine = 0.75 - 0.45 * open; p.head = 0.65 - 0.65 * open;
        p.shL = p.shR = 1.1; both('el', 1.7); both('spread', 0.25);
        // (coming up: the weight over the front foot, the chest low, before it stands)
        const exit = sm(0.55, 0.8, u) * (1 - sm(0.88, 1, u)); p.lean += 0.75 * exit; p.head -= 0.35 * exit;
        break;
      }
      case 'vault': {
        // (over it on a hand: the body laid over to the hand's side, both legs swung through together on the other)
        const w = sm(0, 0.3, u) * (1 - sm(0.7, 1, u)), two = !!(r.reach.hl && r.reach.hr), s1 = L ? -1 : 1;
        // (the hips come down to the hand, the body laid well over it; the legs go through folded, off to the other side)
        legs(0.7 + 0.95 * w, 0.8 + 0.9 * w, 0.5 + 1.0 * w, 0.7 + 1.1 * w);
        arms(0.9, 0.5); both('el', 0.6); both('spread', 0.3);
        p.sink = 0.5 * w; p.tilt = two ? 0 : s1 * 0.75 * w; p.lean = two ? 0.25 + 0.95 * w : 0.3 + 0.35 * w; p.spine = 0.2 * w; p.head = -0.3 - (two ? 0.5 * w : 0);
        // (on two hands: straight through between them, flat, knees to the chest)
        if (two && !r.wheel) { p.hipL = p.hipR = 0.6 + 1.3 * w; p.kneeL = p.kneeR = 0.6 + 1.5 * w; }
        // (a cartwheel: long and open, the arms up over the head to the hands on it, the legs wide and near straight, wheeling
        // over; gathered again to come down on its feet)
        if (r.wheel) {
          const o = sm(0.08, 0.3, u) * (1 - sm(0.75, 0.95, u));
          legs(0.3 * (1 - o) + 0.15, 0.6 * (1 - o) + 0.15, 0.25 * (1 - o) - 0.1, 0.6 * (1 - o) + 0.12); p.splay = 0.85 * o;
          p.shL = p.shR = 0.9 + 2.1 * o; both('el', 0.5 - 0.4 * o); both('spread', 0.25 - 0.1 * o);
          p.sink = 0; p.tilt = 0; p.lean = 0.25 * (1 - o) + 0.05; p.spine = 0.05; p.head = -0.2 * o; p.twist = 0;
        }
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
        // (the body's length is the move: long off the ground (the drive knee up, the push leg straight out behind), gathered
        // tight over the gap (both knees to the chest, the arms in), long again reaching for the far side (the lead leg out
        // in front, the arms forward), then the legs under it for the ground)
        const m = mixes([1 - sm(0.1, 0.28, u), sm(0.1, 0.28, u) * (1 - sm(0.45, 0.62, u)), sm(0.45, 0.62, u) * (1 - sm(0.8, 0.95, u)), sm(0.8, 0.95, u)]);
        legs(m(1.05, 1.5, 1.25, 0.55), m(0.9, 2.0, 0.35, 0.6), m(-0.45, 1.2, 0.35, 0.3), m(0.4, 1.85, 1.0, 0.75));
        arms(m(1.0, 0.6, 1.25, 0.5), m(-0.9, 0.3, 0.6, -0.3)); both('el', m(1.1, 1.6, 0.4, 0.8)); both('spread', m(0.3, 0.2, 0.45, 0.4));
        p.twist = (L ? -1 : 1) * m(0.35, 0.05, 0.2, 0.1);
        p.lean = m(0.35, 0.5, 0.15, 0.2); p.spine = m(0, 0.45, -0.15, 0.05); p.head = m(-0.2, 0.15, -0.2, -0.1);
        if (carried > 0) strideThrough(carried);
        break;
      }
      case 'swing': {
        // (on one hand from a rail: that arm long overhead, the other out for balance; the body hung along the line from the
        // hand, legs long and trailing; a foot put to a face, that leg bent to it and taking load, the other trailing)
        const hand = r.swingLine, ft = r.swingFoot, holdL = !!r.reach.hl;
        if (holdL) { p.shL = 2.9; p.elL = 0.15; p.shR = 1.1; p.elR = 0.6; p.spreadR = 1.3; } else { p.shR = 2.9; p.elR = 0.15; p.shL = 1.1; p.elL = 0.6; p.spreadL = 1.3; }
        p.hipL = p.hipR = 0.15; p.kneeL = p.kneeR = 0.3;
        if (ft) { const k = Math.min(1, 0.4 + ft.press * 3); if (ft.side > 0) { p.hipL = 0.5 + 0.4 * k; p.kneeL = 0.6 + 0.8 * k; p.hipR = -0.25; } else { p.hipR = 0.5 + 0.4 * k; p.kneeR = 0.6 + 0.8 * k; p.hipL = -0.25; } }
        if (hand) {
          const fx = Math.sin(r.heading), fz = Math.cos(r.heading), lx = Math.cos(r.heading), lz = -Math.sin(r.heading);
          const af = hand[0] * fx + hand[2] * fz, al = hand[0] * lx + hand[2] * lz, au = Math.max(0.05, hand[1]);
          p.lean = Math.max(-1.2, Math.min(1.2, Math.atan2(af, au))); p.tilt = Math.max(-1.2, Math.min(1.2, -Math.atan2(al, au)));
        }
        p.spine = 0.1; p.head = -0.2;
        break;
      }
      case 'underbar': {
        // (under a bar feet first: the hands up on it, the body laid back under it, the legs out straight through the gap,
        // then down for the far side)
        const t = sm(0.1, 0.35, u) * (1 - sm(0.7, 0.95, u));
        legs(0.4 + 1.15 * t, 0.6 - 0.45 * t, 0.3 + 1.05 * t, 0.7 - 0.5 * t); p.splay = 0.08;
        p.shL = p.shR = 1.2 + 1.6 * t; both('el', 0.3); both('spread', 0.25);
        p.lean = 0.1 - 0.75 * t; p.spine = 0.15 * t; p.head = 0.2 * t;
        // (and the hips let down under it, laid back, a hand's breadth clear of it (the bar where the hands are))
        { const bar = r.reach.hl?.[1] ?? r.reach.hr?.[1]; if (bar !== undefined) p.sink = Math.max(p.sink, Math.min(0.6, r.y + 0.98 - (bar - 0.3)) * sm(0.05, 0.25, u) * (1 - sm(0.8, 0.98, u))); }
        break;
      }
      case 'kick': {
        // (off a wall: the pushing leg long behind toward it, the other knee driven up, the arms flung away from it, the body
        // turned off it; then gathering to land)
        const k = 1 - sm(0.35, 0.9, u);
        legs(0.4 + 0.8 * k, 0.6 + 0.6 * k, 0.2 - 0.6 * k, 0.5 - 0.3 * k);
        arms(0.6 + 0.6 * k, 0.2 - 0.5 * k); both('el', 0.5); p.spreadL = 0.5 + 0.9 * k; p.spreadR = 0.5 + 0.9 * k;
        p.tilt = -r.wallSide * 0.35 * k; p.twist = -r.wallSide * 0.3 * k; p.lean = 0.15; p.spine = -0.1 * k; p.head = -0.15;
        break;
      }
      case 'sideflip':
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
        // (long only as it leaves the ground, then knees to the chest)
        const m = mixes([1 - sm(0.08, 0.3, u), sm(0.08, 0.3, u) * (1 - sm(0.68, 0.88, u)), sm(0.68, 0.88, u)]);
        legs(m(0.05, 1.55, 0.6), m(0.15, 2.0, 0.75), m(-0.3, 1.35, 0.45), m(0.35, 1.85, 0.6));
        p.shL = p.shR = m(0.35, 0.5, 0.2); both('el', m(0.1, 0.6, 0.25)); both('spread', m(2.65, 1.5, 1.2)); p.splay = m(0, 0.1, 0.3);
        p.spine = m(-0.2, 0.4, 0.1); p.lean = m(0.08, 0.2, 0.12); p.head = m(-0.3, 0.1, 0.25);
        break;
      }
      case 'dive': {
        // (headfirst and flat, the hands leading, the legs left out behind; folding at the end into the roll)
        // (long off the edge, arched out over the drop and reaching further for the ground as it comes, then folding early
        // into the roll: never one held shape)
        // (the fold into the roll begins a fixed while before the ground, however long the flight; a long one spends its
        // middle looking for the ground, the arms adjusting)
        const prepD = r.state === 'air' ? Math.max(this.prep, 1 - sm(0.08, 0.38, r.ttc ?? 9)) : 0, f = sm(0, 0.3, u), t = Math.max(sm(0.85, 1, u), prepD), arch = sm(0.15, 0.45, u) * (1 - t);
        legs(-0.05 - 0.25 * arch + 1.5 * t, 0.1 + 0.5 * arch + 1.8 * t, -0.3 - 0.2 * arch + 1.6 * t, 0.45 + 0.6 * arch + 1.5 * t);
        p.shL = p.shR = 2.85 - 0.9 * t + 0.15 * arch; both('el', 0.1 + 0.9 * t); both('spread', 0.22 + 0.25 * arch);
        p.lean = 0.3 + 1.05 * f + 0.25 * t; p.spine = -0.12 - 0.3 * arch + 0.6 * t; p.head = -0.75 - 0.2 * arch + 1.1 * t;
        if ((r.flightT ?? 0) > 0.7) { const mid = Math.sin(Math.PI * u) * (1 - t); p.head += 0.35 * mid; p.spreadL += 0.3 * Math.sin(2 * Math.PI * u) * (1 - t); p.spreadR -= 0.3 * Math.sin(2 * Math.PI * u) * (1 - t); }
        break;
      }
      case 'fall': {
        // (coming down, not floating: the arms up and out for balance, the knees drawn up under it, ready to take the ground)
        legs(1.1, 1.5, 0.75, 1.35); p.splay = 0.12;
        p.shL = p.shR = 0.35; both('el', 0.45); both('spread', 2.15);
        p.spine = 0.2; p.lean = 0.12; p.head = -0.15;
        break;
      }
      case 'hang': {
        // (from a hold on the way up a face: caught, the legs swinging in under it; loaded, knees to the chest, the feet on the
        // wall; sprung, the whole body long, the arms up for the next; gathering a little as it comes to it)
        const ph = r.chainPhase ?? 0;
        if (ph === 0) { legs(0.35 + 0.3 * u, 0.5 + 0.4 * u, 0.2 + 0.3 * u, 0.6 + 0.3 * u); p.lean = -0.1; }
        else if (ph === 1) { const k = sm(0, 1, u); legs(0.65 + 0.9 * k, 0.9 + 1.2 * k, 0.55 + 0.85 * k, 0.8 + 1.2 * k); p.lean = -0.1 - 0.15 * k; p.spine = 0.25 * k; }
        else { const g = sm(0.55, 1, u); legs(-0.05 + 0.8 * g, 0.1 + 1.0 * g, -0.2 + 0.7 * g, 0.25 + 0.9 * g); p.lean = 0.05 - 0.15 * g; p.spine = -0.2 + 0.3 * g; }
        p.shL = p.shR = 2.9; both('el', 0.3); both('spread', 0.15); p.head = -0.4;
        // (from a lip, settled: a still hang, the arms straight, the knees bent and the feet set on the wall under it, the
        // head up to the lip)
        const ht = r.hangT ?? -1;
        if (ht >= 0) { const k = sm(0.2, 0.6, ht); legs(0.35 + 0.55 * k, 0.5 + 0.8 * k, 0.2 + 0.6 * k, 0.6 + 0.75 * k); both('el', 0.3 - 0.27 * k); p.lean = -0.1 - 0.1 * k; p.spine = 0.1 * k; p.head = -0.4 - 0.15 * k; }
        // (swung out from the wall under the hands: the body a pendulum from them, its line tipped by how far out the hips
        // are, the legs trailing long; its feet gone to a wall behind: the legs reached back to it, bent to take it, then
        // driven straight)
        const so = r.swingOut ?? 0, sf = r.swingFeet;
        if (so > 0.05 && !sf) { const k = Math.min(1, so / 1.2); p.lean += Math.atan(so / 1.1); legs(0.15 + 0.25 * k, 0.2 + 0.2 * k, -0.1, 0.3); both('el', 0.05); }
        if (sf) { const k = sm(0, 0.14, sf.t); legs(-0.35 - 0.25 * k, 1.2 - 0.3 * k, -0.25 - 0.2 * k, 1.0 - 0.2 * k); p.lean += 0.45; p.spine = -0.15; p.head = -0.2; }
        break;
      }
      case 'chimney': {
        // (up an alley wall to wall: the legs split across it, the pushing one long, the other gathered toward the far wall;
        // the arms out to both walls (the hands taken to them); a kick's gather and push by how far across it is)
        const k = sm(0, 0.35, u) * (1 - sm(0.75, 1, u));
        legs(0.9 + 0.5 * k, 1.4 - 0.6 * k, -0.1 - 0.3 * k, 0.6 + 0.3 * k); p.splay = 0.35 + 0.15 * k;
        p.shL = p.shR = 0.6; both('el', 0.35); both('spread', 1.45);
        p.tilt = -r.wallSide * 0.25 * (1 - 2 * u); p.lean = 0.12; p.spine = 0.1; p.head = -0.35;
        break;
      }
      case 'glide': {
        // (the slow one: upright, the arms straight out, one knee a little raised, the other leg trailing)
        // (sinking slowly, held: the arms straight out level, the legs long and together, a slow sway through it)
        const sway = Math.sin((r.airT ?? 0) * 2.3);
        legs(0.12, 0.18, 0.02, 0.22); p.splay = 0.04;
        p.shL = p.shR = 0; both('el', 0.04); p.spreadL = 1.55 + 0.08 * sway; p.spreadR = 1.55 - 0.08 * sway;
        p.tilt = 0.07 * sway; p.spine = -0.08; p.lean = 0.14; p.head = -0.25;
        break;
      }
      case 'climb': {
        // (pulled over a lip with no foot on the wall: up to the hands (elbows bending, the legs hanging); over them (the arms
        // straightening down, the chest forward over the top); the lead knee up onto it, then the weight onto that foot)
        if (r.pulling) {
          const a1 = sm(0, 0.45, u), a2 = sm(0.4, 0.7, u), a3 = sm(0.65, 0.95, u);
          const sh = 2.9 - 1.9 * a1 - 0.8 * a2 + 0.3 * a3; p.shL = p.shR = sh;
          both('el', 0.3 + 1.4 * a1 * (1 - a2) + 0.1 * a3); both('spread', 0.2 + 0.3 * a2);
          legs(0.2 + 0.2 * a1 + 1.4 * a3, 0.4 + 0.3 * a1 + 1.7 * a3 - 0.6 * sm(0.9, 1, u), 0.1 + 0.25 * a2 + 0.3 * a3, 0.3 + 0.5 * a2);
          p.lean = -0.1 + 0.25 * a1 + 0.45 * a2 - 0.5 * a3; p.spine = 0.1 + 0.3 * a2 - 0.25 * a3; p.head = -0.45 + 0.25 * a2;
          break;
        }
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
        stride((r.wallPhase ?? 0) + r.lead * Math.PI, 1.0, 0.5);
        const near = r.wallSide > 0;
        // (tipped off it as far as there's room: in a narrow alley, the far wall stops it)
        p.tilt = r.wallSide * 0.82 * Math.max(0.25, Math.min(1, ((r.roomAway ?? 9) - 0.35) / 0.9)); p.lean = 0.22; p.spine = 0.1; p.head = -0.2;
        if (near) { p.spreadL = 0.25; p.shL = -0.5; p.elL = 0.3; p.spreadR = 1.45; p.shR = 0.1; p.elR = 0.15; }
        else { p.spreadR = 0.25; p.shR = -0.5; p.elR = 0.3; p.spreadL = 1.45; p.shL = 0.1; p.elL = 0.15; }
        break;
      }
    }
    if (r.wallPlant) {
      legs(1.25, 1.55, -0.35, 0.65); arms(2.4, 1.8); p.lean = 0.22;
    }
    // (a flight getting ready for the ground a fixed while before it, whatever its length: the legs coming under, the arms
    // out for it, the head down to find it)
    if (r.state === 'air' && ['bound', 'spring', 'hop', 'flip', 'sideflip', 'fall', 'kick', 'underbar'].includes(r.move)) {
      // (the leg that lands is the front one, the one that didn't push: whichever that is, not always the left; and a stride
      // carried across a small gap is its own landing, its front leg reaching for the ground already)
      const k = Math.max(this.prep, 1 - sm(0.06, 0.3, r.ttc ?? 9)) * (1 - carried), L2: Partial<Pose> = L ? { hipL: 0.75, hipR: 0.4, kneeL: 0.95, kneeR: 0.85, shL: 0.5, shR: 0.5, spreadL: 0.7, spreadR: 0.7, lean: 0.18, spine: 0.15 } : { hipR: 0.75, hipL: 0.4, kneeR: 0.95, kneeL: 0.85, shL: 0.5, shR: 0.5, spreadL: 0.7, spreadR: 0.7, lean: 0.18, spine: 0.15 };
      if (k > 0) { for (const [key, v] of Object.entries(L2)) (p as unknown as Record<string, number>)[key] += (v - (p as unknown as Record<string, number>)[key]) * k; p.head += 0.35 * k; }
    }
    // (a save: short, pitched forward over the catching foot, the trailing knee coming through high; wide, the outside arm
    // flung open, the body leaning back toward the line; long, the chest caught forward over two quick steps)
    if (r.saveKind && r.state === 'ground') {
      const k = 1 - sm(0.05, 0.4, r.saveT ?? 1), side = r.saveSide ?? 1;
      if (r.saveKind === 'short') { p.lean += 0.45 * k; p.spine += 0.2 * k; if (side > 0) { p.hipR += 0.9 * k; p.kneeR += 1.1 * k; } else { p.hipL += 0.9 * k; p.kneeL += 1.1 * k; } p.head += 0.15 * k; }
      else if (r.saveKind === 'wide') { if (side > 0) p.spreadL += 1.4 * k; else p.spreadR += 1.4 * k; p.tilt -= side * 0.3 * k; p.twist += side * 0.25 * k; }
      else { p.lean += 0.28 * k; p.shL += 0.5 * k; p.shR += 0.5 * k; }
    }
    // (over clutter: the knees up high, the hips carried over it)
    if (r.state === 'ground' && (r.stepOver ?? 0) > 0) { const k = Math.min(1, (r.stepOver ?? 0) / 0.15); p.kneeL += 0.7 * k; p.kneeR += 0.7 * k; p.hipL += 0.4 * k; p.hipR += 0.4 * k; }
    // (the body's line shifted toward a footfall out to the side: the torso leans back over it, the far arm out)
    const sh = r.shift ?? 0; if (sh) { p.tilt -= sh * 1.4; if (sh > 0) p.spreadR += sh * 2.5; else p.spreadL -= sh * 2.5; }
    // (up against a wall: upright, the head back out of it)
    if (r.against) { p.lean = Math.min(p.lean, 0.1); p.spine = Math.min(p.spine, 0.05); p.head = Math.min(p.head, 0); }
    // (in the air with a wall close beside: the arm on that side kept in, not flung into it)
    if (r.state === 'air' && r.near) { if (r.near > 0) { p.spreadL = Math.min(p.spreadL, 0.35); p.shL = Math.min(p.shL, 1.2); } else { p.spreadR = Math.min(p.spreadR, 0.35); p.shR = Math.min(p.shR, 1.2); } }
    // (the head leads: turned into a turn a beat before the hips, looking where it's going)
    p.look = Math.max(-0.6, Math.min(0.6, r.turn * 0.22));
    // (going slowly and turning: the head, then the shoulders, round toward the new way before the hips and feet get there)
    { const ta = r.turnAhead ?? 0, lo = r.state === 'ground' ? 1 - sm(3, 6, r.speed) : 0;
      if (lo > 0 && ta) { p.look = Math.max(-0.9, Math.min(0.9, p.look + 0.7 * ta * lo)); p.twist += Math.max(-0.45, Math.min(0.45, 0.45 * ta)) * lo; p.hips += Math.max(-0.2, Math.min(0.2, 0.15 * ta)) * lo; } }
    // (a balance check at a lip: tipped out over it and back, twice, dying away; the arms out and wheeling to hold it, the
    // head down to the drop)
    { const k = r.teeter ?? 0; if (k > 0 && r.state === 'ground') { const fade = 1 - sm(0.6, 1, k), ph = k * 2 * Math.PI * 2.2; p.lean += 0.32 * Math.sin(ph) * fade + 0.08 * fade; p.shL = 1.35 + 0.6 * Math.sin(ph + 0.6) * fade; p.shR = 1.35 + 0.6 * Math.sin(ph + 0.6 + Math.PI) * fade; both('spread', 1.5 * fade + 0.2); both('el', 0.25); p.head -= 0.35 * fade; } }
    // (hanging from one hand, swinging on under it: the body tipped by the swing)
    if (r.swing) p.tilt += Math.max(-0.5, Math.min(0.5, -r.swing * 0.12));
    // (off the ground: the arms driven up hard through the first instant, as if they threw it, by the effort behind it)
    if (r.state === 'air' && u < 0.15 && ['spring', 'bound', 'hop', 'dive', 'flip', 'sideflip', 'underbar'].includes(r.move)) { const k = 1 - u / 0.15; p.shL += 0.9 * k; p.shR += 0.9 * k; }
    // (off balance: leaning with it, the arms out against it, windmilling as it comes back)
    const b = r.balance ?? 0, bv = r.balanceV ?? 0;
    if (b || bv) {
      p.tilt += b * 0.7; p.spreadL += Math.max(0, b) * 2.2 + Math.abs(b) * 0.4; p.spreadR += Math.max(0, -b) * 2.2 + Math.abs(b) * 0.4;
      p.shL += bv * 0.15; p.shR -= bv * 0.15;
    }
    // (spent, and slow: breathing hard, the chest heaving)
    if (r.state === 'ground' && r.speed < 4 && (r.stamina ?? 1) < 0.95) { const h = (1 - (r.stamina ?? 1)) * Math.sin((r.time ?? 0) * 7); p.spine += 0.06 * h + 0.08 * (1 - (r.stamina ?? 1)); p.head -= 0.04 * h; }
    if (r.state === 'climb' && r.move === 'climb') {
      const pull = sm(0.1, 0.8, u);
      legs(0.65 + pull, 1.3, -0.1, 0.65);
      arms(2.8 - pull * 2, 2.8 - pull * 2); p.lean = -0.23 + pull * 0.75;
    }
    if (r.committed && r.state === 'ground') {
      const load = r.load ?? 0;
      p.shL -= 1.3 * load; p.shR -= 1.3 * load; p.lean += 0.16 * load;
    }
    // (a landing's weight: down into the legs, the feet apart, the arms out and back)
    // (the wind-up as deep as the landing: an automatic takeoff loads nearly as deep as a tapped one)
    const c = r.state === 'ground' && r.move !== 'roll' ? Math.max(r.land, (r.load ?? 0) * (r.committed ? 0.95 : 0.8) * (0.75 + 0.35 * (r.effort ?? 0))) : 0;
    if (c > 0) {
      // (a landing's weight is taken in both legs; a wind-up is in the leg that's down, the other driving its knee up and
      // through ready to go, the chest down over the foot)
      const wind = r.state === 'ground' && (r.load ?? 0) > r.land, down = r.reach.fl && !r.reach.fr ? 1 : r.reach.fr && !r.reach.fl ? -1 : (r.lead === 1 ? -1 : 1);
      if (wind) {
        const ef = r.effort ?? 0, sup = down > 0, k = c * (0.45 + 1.1 * ef) * (1 - 0.5 * sm(3, 8, r.speed) * (1 - 0.6 * ef));
        if (sup) { p.hipL += 0.7 * k; p.kneeL += 1.3 * k; p.hipR += 1.4 * k; p.kneeR += 1.0 * k; } else { p.hipR += 0.7 * k; p.kneeR += 1.3 * k; p.hipL += 1.4 * k; p.kneeL += 1.0 * k; }
        // (up against a wall, the chest kept off it: the load goes down, not forward)
        if (!r.against) { p.spine += 0.5 * k; p.lean += 0.2 * k; }
      } else { p.hipL += 1.05 * c; p.hipR += 1.05 * c; p.kneeL += 1.8 * c; p.kneeR += 1.8 * c; p.splay += 0.22 * c; if (!r.against) p.spine += 0.45 * c; }
      p.shL -= 0.45 * c; p.shR -= 0.45 * c; p.spreadL += 0.7 * c; p.spreadR += 0.7 * c; p.head -= 0.1 * c;
    }
    // (on one foot, the hip on the free side lets down a little: the pelvis tipped over the foot that bears it)
    if (r.state === 'ground' && r.move !== 'roll') { const bear = r.reach.fl && !r.reach.fr ? 1 : r.reach.fr && !r.reach.fl ? -1 : 0; p.tilt += 0.06 * bear * (1 - 0.5 * sm(2, 6, r.speed)); }
    // (a wall close in front: the body pitched forward no further than leaves the head short of it)
    if (r.state === 'ground') { const room = r.roomAhead ?? 9; if (room < 1.1) { const most = Math.asin(Math.max(0, Math.min(1, (room - 0.2) / 0.9))); const over = p.lean + 0.5 * p.spine - most; if (over > 0) { p.lean -= over; } } }
    // (whatever was added up, a knee bends no further than a knee does: a heel to the seat on the ground is ~140°, a tuck
    // a little more)
    { const most = r.state === 'ground' && r.move !== 'roll' ? 2.4 : 2.6; p.kneeL = Math.min(most, p.kneeL); p.kneeR = Math.min(most, p.kneeR); }
    return p;
  }

  /** Ease the pose toward the body's; `dt` large sets it at once. */
  update(dt: number, r: Body): void {
    // (a swinging foot drawn nearer the line than six centimetres, or across it (a turn's lean carrying the free leg under the
    // body): the leg swung out at the hip until it's back on its own side; let go of slowly once it is)
    if (dt > 0 && dt <= 0.2) for (let i = 0; i < 2; i++) {
      const lat = this.freeLat[i], want = 0.06 * this.body.legScale;
      if (lat !== null && lat < want) this.legOut[i] = Math.min(0.35, this.legOut[i] + ((want - lat) / (0.85 * this.body.legScale)) * Math.min(1, 15 * dt));
      else this.legOut[i] = Math.max(0, this.legOut[i] - 0.8 * dt);
    }
    // (where it is against where its motion would have put it: the difference kept as an offset, eased away)
    if (this.was && dt > 0 && dt <= 0.2) {
      const ex = this.was[0] + this.wasV[0] * dt, ey = this.was[1] + this.wasV[1] * dt, ez = this.was[2] + this.wasV[2] * dt, jx = ex - r.x, jy = ey - r.y, jz = ez - r.z;
      // (never left trailing below where it's been put (into what it was put on): put up onto something, the hips start
      // where they were and the legs bend under them, then rise at the legs' pace; and not moves that carry the body by hand on purpose (a climb, a hang's spring): only a change of state, or the run and the flight)
      const steered = r.state === 'climb' || r.state === 'chimney' || r.state === 'plant';
      if ((!steered || r.state !== this.wasState) && Math.hypot(jx, jy, jz) > 0.06 && Math.hypot(jx, jy, jz) < 1.5) { this.slip[0] += jx; this.slip[1] += Math.max(0, jy); this.slip[2] += jz; if (jy < -0.06 && r.state === 'ground') this.hipY = Math.max(0.45, this.hipY + jy); }
      const k = Math.exp(-(r.state === "ground" ? 20 : 16) * dt); this.slip = [this.slip[0] * k, this.slip[1] * k, this.slip[2] * k];
    } else this.slip = [0, 0, 0];
    this.wasState = r.state; this.was = [r.x, r.y, r.z]; this.wasV = [r.vx ?? 0, r.state === 'air' || r.state === 'wall' ? r.vy ?? 0 : 0, r.vz ?? 0];
    // (each joint toward its pose as a spring a little under critical damping, so a limb carries past where it's going
    // and comes back: follow-through; set at once for a long step)
    // (the stride's phase as the limbs follow it: smoothed, so a footfall re-timed (a landing, a save, a stutter) is caught up
    // with, not snapped to)
    // (getting ready for the ground: only ever further, within a flight)
    if (r.state === 'air') this.prep = Math.max(this.prep, r.ttc !== undefined && r.ttc < 9 ? 1 - sm(0.06, 0.38, r.ttc) : 0); else this.prep = 0;
    // (its steady advance followed exactly, so the limbs aren't late; only a jump (a re-timed footfall) eased out)
    const wrap = (x: number) => x - Math.round(x / (2 * Math.PI)) * 2 * Math.PI;
    if (dt > 0.2) this.ph = r.phase;
    else { const step = wrap(r.phase - this.lastPhase); if (Math.abs(step) < 0.6) this.ph += step; this.ph += wrap(r.phase - this.ph) * (1 - Math.exp(-22 * dt)); }
    this.lastPhase = r.phase;
    // (the joints' springs: quick on the ground; slower in the air, but explosive for the first moment off it, so a takeoff
    // is a release, not an easing)
    // (and caught hanging: the body comes under the hands at once, not pitched on into the wall)
    const caught = r.move === 'hang' && (r.hangT ?? 9) < 0.2;
    const t = this.target(r, this.ph), w = r.state === 'ground' || this.carriedK > 0.5 ? 45 : caught ? 55 : r.state === 'air' && (r.airT ?? 9) < 0.12 && r.from === 'ground' ? 50 : 20, c = 2 * 0.72 * w;
    if (dt > 0.2) { for (const key of KEYS) { this.pose[key] = t[key]; this.vel[key] = 0; } }
    else for (const key of KEYS) { this.vel[key] += ((t[key] - this.pose[key]) * w * w - this.vel[key] * c) * dt; this.pose[key] += this.vel[key] * dt; }
    if (r.move === 'hang') { const most = 0.3 + Math.min(0.9, Math.atan((r.swingOut ?? 0) / 1.1) + (r.swingFeet ? 0.45 : 0)); if (this.pose.lean > most) { this.pose.lean = most; this.vel.lean = Math.min(0, this.vel.lean); } if (this.pose.spine > 0.35) { this.pose.spine = 0.35; this.vel.spine = Math.min(0, this.vel.spine); } }
    this.stood += ((r.state === 'ground' ? 1 : 0) - this.stood) * (1 - Math.exp(-14 * dt));
    this.bank += (Math.max(-0.45, Math.min(0.45, r.turn * 0.06 * Math.min(1, r.speed / 8))) - this.bank) * (1 - Math.exp(-10 * dt));
    // (walking or standing on one foot: the hips over it; along a wall, off it)
    // (the body's weight over the foot that bears it: right over it walking or standing on it, or loading it to go; a
    // little at a run, where the feet come down near the line anyway)
    const bear = r.state === 'ground' && r.move !== 'roll' ? (r.reach.fl && !r.reach.fr ? 1 : r.reach.fr && !r.reach.fl ? -1 : 0) : 0;
    const over = bear * (0.045 * (1 - 0.65 * sm(2, 6, r.speed)) + 0.04 * Math.min(1, (r.load ?? 0) * 1.5));
    this.aside += ((r.move === 'wallrun' ? -r.wallSide * 0.3 : over) - this.aside) * (1 - Math.exp(-(r.move === 'wallrun' ? 16 : 12) * dt));
    // (the hands: taken toward what they reach for, let go when there's nothing; a new hold is moved to, not jumped to)
    for (const [h, to] of [[this.hands.L, r.reach.hl], [this.hands.R, r.reach.hr]] as const) {
      if (to) { const e = h.w > 0.05 ? 1 - Math.exp(-32 * dt) : 1; for (let i = 0; i < 3; i++) h.p[i] += (to[i] - h.p[i]) * e; }
      h.w += ((to ? 1 : 0) - h.w) * (1 - Math.exp(-(to ? 22 : 14) * dt));
    }
    // (the feet: a footfall is where it is at once, and is left quickly)
    // (the swing leg brought onto the coming footfall over its last tenth of a second, so it's there as it lands, not
    // snatched to it)
    const nf = r.nextFoot, Ls0 = this.body.legScale;
    for (const [f, to, side] of [[this.soles.L, r.reach.fl, 1], [this.soles.R, r.reach.fr, -1]] as const) {
      // (a foot stepping at a walk, or standing: carried from where it left to where it's going, lifted first and carried after (an arc
      // as high as the step is long), put down; at a run the swing's own pose carries it instead)
      const sf = r.inStep ? r.inStep(side) : null;
      // (but from a jog up, the last tenth of a second is the landing's, below)
      if (!to && sf && r.state === 'ground' && !(r.speed > 2.2 && nf && nf.side === side && nf.t < 0.1)) {
        const wk = 1 - sm(2.2, 3.4, r.speed);
        if (wk > 0) {
          // (where it's going, eased toward when that changes in the air (a step planned as the other foot lands), not jumped to)
          const ka = 1 - Math.exp(-(sf.k > 0.85 ? 60 : 18) * dt); f.aim = f.aim ? [f.aim[0] + (sf.to[0] - f.aim[0]) * ka, f.aim[1] + (sf.to[1] - f.aim[1]) * ka, f.aim[2] + (sf.to[2] - f.aim[2]) * ka] : [...sf.to] as V3;
          sf.to = f.aim;
          const k = sf.k, path = MOCAP.on ? swingPath(r.speed, Math.min(1, sf.k / 0.9)) : null, e = path ? path.along : sm(0.1, 0.95, k), len = Math.hypot(sf.to[0] - sf.from[0], sf.to[2] - sf.from[2]), liftH = (0.05 + 0.08 * Math.min(1, len / 0.8)) * (1 + 0.3 * Math.max(0, r.speed - 1.5));
          let lift = liftH * Math.max(Math.sqrt(Math.max(0, Math.sin(Math.PI * Math.min(1, k * 1.05)))), 0.45 * Math.sqrt(Math.max(0, Math.sin(Math.PI * e)))); /* (and clear of the ground whenever it's travelling) */
          // (or as a person's foot goes: the captured path's height, for a step as long as the captured one, less for a short one;
          // never much under the hand-made arc, so a step re-aimed as it comes down isn't dragged over the ground)
          if (path) lift = Math.max(path.lift * 0.88 * Ls0 * Math.min(1, 0.35 + len / 0.7), 0.7 * lift);
          // (round its own side of the body, not through it: where the straight way from where it left to where it's going
          // would pass under the body or over to the other side (a sharp turn leaves a foot behind, across the new line), the
          // foot is swung round the hips the way that keeps it on its own side, from exactly where it left to where it lands)
          let fx2 = sf.from[0] + (sf.to[0] - sf.from[0]) * e, fz2 = sf.from[2] + (sf.to[2] - sf.from[2]) * e;
          { const lx = Math.cos(r.heading), lz = -Math.sin(r.heading), latOf = (x: number, z: number) => ((x - r.x) * lx + (z - r.z) * lz) * side;
            if (latOf(fx2, fz2) < 0.08 * this.body.legScale && (latOf(sf.from[0], sf.from[2]) < 0.1 || latOf(sf.to[0], sf.to[2]) < 0.1)) {
              const ax = sf.from[0] - r.x, az = sf.from[2] - r.z, bx = sf.to[0] - r.x, bz = sf.to[2] - r.z, ra = Math.hypot(ax, az), rb = Math.hypot(bx, bz);
              const a0 = Math.atan2(ax, az), b0 = Math.atan2(bx, bz); let d = b0 - a0; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
              const at = (k: number, dd: number) => { const th = a0 + dd * k, rr = Math.max(0.16, ra + (rb - ra) * k); return [r.x + Math.sin(th) * rr, r.z + Math.cos(th) * rr]; };
              // (the way round that passes its own side)
              const mid = at(0.5, d); if (latOf(mid[0], mid[1]) < 0) d -= Math.sign(d || 1) * 2 * Math.PI;
              if (Math.abs(d) < 1.5 * Math.PI) { const q = at(e, d); fx2 = q[0]; fz2 = q[1]; }
            } }
          f.p = [fx2, sf.from[1] + (sf.to[1] - sf.from[1]) * e + lift, fz2];
          // (and with the clips, through the middle of the swing the clip's own leg carries the foot (its thigh driven through,
          // its knee folded and opening), the path only taking it from the ground and setting it down on its footfall)
          // (how far through its swing by the stride's own clock, which the clip keeps; the step's `k` runs ahead of it)
          const TAU = 2 * Math.PI, sd = r.stanceFrac ?? 0.25, cyc = ((((r.phase - Math.PI / 2 - 0.3 - (side > 0 ? 0 : Math.PI)) % TAU) + TAU) % TAU) / TAU, sw = Math.max(0, (cyc - sd) / (1 - sd));
          const free = this.mocapK * 0.9 * sm(0.02, 0.15, sw) * (1 - sm(0.55, 0.82, sw)) * sm(0.02, 0.1, k);
          f.w = wk * (1 - free); f.lost = false; f.yaw = turnTo(f.yaw, r.heading, 1 - Math.exp(-14 * dt)); continue;
        }
      }
      f.aim = null;
      // (running, over its last tenth of a second the swinging foot is taken onto its footfall, a place fixed on the ground,
      // coming down the last few centimetres onto it: so it arrives there nearly still, pawed back to the ground's speed,
      // not flung forward and stopped dead; at a walk the step drawn above does this)
      const W = r.speed > 2.2 ? 0.1 : 0.025;
      f.coming = false;
      if (!to && nf && nf.side === side && nf.t < W && Math.hypot(nf.p[0] - r.x, nf.p[2] - r.z) < 0.6 + r.speed * nf.t && Math.abs(nf.p[1] - r.y) < 0.35) { const k = nf.t / W; f.p = [nf.p[0], nf.p[1] + 0.09 * Math.sqrt(k) * Ls0, nf.p[2]]; f.w = Math.max(f.w, sm(0, 1, 1 - k)); f.lost = false; f.coming = true; continue; }
      // (a new footfall is held afresh; one let go stays let go)
      // (a new footfall: no pivot carried over)
      if (to && Math.hypot(to[0] - f.p[0] + f.off[0], to[2] - f.p[2] + f.off[2]) > 0.02) f.off = [0, 0, 0];
      if (to && (!f.lost || Math.hypot(to[0] + f.off[0] - f.p[0], to[1] - f.p[1], to[2] + f.off[2] - f.p[2]) > 0.02)) { f.lost = false; f.p = [to[0] + f.off[0], to[1], to[2] + f.off[2]]; }
      if (!to) f.lost = false;
      const hold = to && !f.lost;
      // (taken up within a few frames: a running stance is under a tenth of a second)
      f.w += ((hold ? 1 : 0) - f.w) * (1 - Math.exp(-(hold ? (r.state === 'ground' ? 140 : 45) : 90) * dt));
      // (a foot down keeps pointing where it was put, the body turning over it, until it's stepped again; off the ground, or
      // just coming down, it points the way the body does)
      if (!hold || f.w < 0.5) f.yaw = turnTo(f.yaw, r.heading, 1 - Math.exp(-30 * dt));
      // (down, and the body turned well off it: the foot pivots on its ball, as a foot does, the heel swinging round)
      else if (this.on[1] > 0.7) {
        let d = r.heading - f.yaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        if (Math.abs(d) > 0.5) {
          const ny = r.heading - Math.sign(d) * 0.5, bx = f.p[0] + Math.sin(f.yaw) * 0.13, bz = f.p[2] + Math.cos(f.yaw) * 0.13;
          const px = bx - Math.sin(ny) * 0.13, pz = bz - Math.cos(ny) * 0.13;
          const ox = f.off[0] + px - f.p[0], oz = f.off[2] + pz - f.p[2];
          // (a foot can only be screwed round so far off where it was put (about a foot's length): past that it stays, and the
          // body twists over it until it's stepped)
          if (Math.hypot(ox, oz) <= 0.12) { f.p = [px, f.p[1], pz]; f.off = [ox, 0, oz]; f.yaw = ny; }
        }
      }
    }
    if (r.reach.fl || r.reach.fr) this.on = r.reach.fn ?? [0, 1, 0];
    // (the hips: where the lower foot reaches the ground; in the air, where they'd be standing, so the feet come up to them)
    const p = this.pose, leg = (hip: number, knee: number) => this.body.thigh * Math.cos(hip) * Math.cos(p.splay) + this.body.shin * Math.cos(hip - knee) * Math.cos(p.splay);
    // (but a run has its moment off the ground, both legs out: the hips don't drop into the split, they carry over it)
    const striding = r.move === 'run' || r.move === 'dash' || r.move === 'ledge', pace = Math.min(1, r.speed / 6);
    // (a wind-up's sink: deep from a stand (a squat to spring from), shallow at a run (the hips lowered a little over the
    // last steps and the takeoff leg bent under it, not a squat), deeper for a bigger jump)
    const ef = r.effort ?? 0, windDown = (r.load ?? 0) * (r.committed ? 0.95 : 0.8) * (1 - 0.7 * sm(3, 8, r.speed) * (1 - 0.6 * ef)) * (0.45 + 1.1 * ef);
    // (heights in the runner's metres, for its legs: scaled to this body's)
    const Ls = this.body.legScale;
    const carry = striding ? ((0.9 + 0.05 * Math.abs(Math.cos(this.ph))) * pace - 0.55 * Math.max(r.land, windDown)) * Ls : 0;
    // (running: the hips lowest through a stance (the leg bending to take it), highest in the flight between, higher for a step
    // planned long or over clutter; low enough that a leg can hold its footfall from in front to behind)
    const g = r.gait, stride = striding && g && pace > 0.4 ? (g.stance >= 0 ? 0.95 - 0.02 * pace * Math.sin(Math.PI * g.stance) : 0.95 + Math.min(0.16, 1.6 * (r.bounce ?? 0.03)) * pace * Math.sin(Math.PI * g.flight)) * Ls - 0.55 * Math.max(r.land, windDown) * Ls : -1;
    const ground = stride >= 0 ? stride : Math.max(carry, this.body.hipDrop + Math.max(leg(p.hipL, p.kneeL), leg(p.hipR, p.kneeR)) + this.body.sole) + (r.move === 'roll' ? 0.16 * Ls : 0) - (r.state === 'ground' ? 0.4 * windDown * Ls : 0);
    // (walking: the hips vault over each planted foot on a nearly straight leg, as a walk does: as high as such a leg reaches
    // to each foot down (a little more for one behind, its heel rising onto the toe), the lower of the two; so highest over
    // a foot, lowest as the weight passes from one to the other)
    const walk = r.state === 'ground' && r.move === 'run' && stride < 0 ? sm(0.2, 0.6, r.speed) * (1 - sm(2.2, 3, r.speed)) : 0;
    let vault = Infinity;
    if (walk > 0) {
      const fx = Math.sin(r.heading), fz = Math.cos(r.heading), legL = 0.985 * (this.body.thigh + this.body.shin);
      // (by the foot ahead or under: one well behind is on its way off, onto its toe, and reaches what it must that way)
      const down = [r.reach.fl, r.reach.fr].filter((f): f is V3 => !!f).map((f) => ({ f, along: (f[0] - r.x) * fx + (f[2] - r.z) * fz }));
      const lead = down.filter((d) => d.along > -0.15), use = lead.length ? lead : down;
      for (const { f, along } of use) {
        // (the joint sits a little under the pelvis's centre as it leans: 0.035 m more; a foot already out of reach, or well
        // off the level, says nothing about the vault)
        const dx = f[0] - r.x, dz = f[2] - r.z, reachL = legL + (along < -0.15 ? 0.12 : 0), d2 = dx * dx + dz * dz;
        if (d2 >= reachL * reachL * 0.9 || Math.abs(f[1] - r.y) > 0.2) continue;
        vault = Math.min(vault, this.body.hipDrop + 0.035 * Ls + Math.sqrt(reachL * reachL - d2) + this.body.sole + (f[1] - r.y));
      }
      // (and never more than a little under the pose's own height: the vault rides on the walk, it doesn't sit it down)
      if (vault < Infinity) vault = Math.max(vault, ground - 0.12 * Ls);
    }
    const groundW = walk > 0 && vault < Infinity ? ground * (1 - walk) + Math.min(ground, vault) * walk : ground;
    const hip = groundW * this.stood + (0.98 - p.sink) * Ls * (1 - this.stood);
    const hipTo = r.state === 'ground' && r.move !== 'roll' ? Math.min(hip, (0.99 - 0.46 * r.land) * Ls) : hip;
    // (the hips never jump up: risen to a new height at most as fast as legs push (6 m/s); let down as fast as a landing takes them)
    this.hipY = dt > 0 && dt <= 0.2 ? Math.max(this.hipY - 18 * dt, Math.min(this.hipY + 6 * dt, hipTo)) : hipTo;
    // (the chest a beat behind the hips: when they're stopped short (a landing), it carries on down and comes back up;
    // when they're thrown up, it's left a little behind)
    if (dt > 0 && dt <= 0.2) {
      const hy = r.y + this.hipY, v = (hy - this.lastHip) / dt, acc = Math.max(-200, Math.min(200, (v - this.hipV) / dt));
      this.lastHip = hy; this.hipV = v;
      this.chestV += (-170 * this.chest - 15 * this.chestV - acc * 0.012) * dt; this.chest = Math.max(-0.45, Math.min(0.45, this.chest + this.chestV * dt));
    } else { this.lastHip = r.y + this.hipY; this.hipV = 0; this.chest = this.chestV = 0; }
    // (a planted foot the leg can't reach from where the pose put the hips: the hips go to it (down, on the ground; toward
    // the wall, on one), as far as a body would sink or lean to keep its footing; past that, the foot lets go rather than
    // the leg being pulled out straight and the foot dragged off its footfall)
    const want: V3 = [0, 0, 0], P0 = this.pelvis(r, this.slip), fw = unit([P0[8], 0, P0[10]]);
    for (const [f, side] of [[this.soles.L, 1], [this.soles.R, -1]] as const) {
      // (a foot still coming down onto its footfall isn't on it: the body neither reaches for it nor gives it up)
      if (f.w < 0.05 || f.coming) continue;
      const s = point(P0, side * this.body.hipX, -this.body.hipDrop, 0), fall: V3 = [f.p[0] + this.on[0] * this.body.sole, f.p[1] + this.on[1] * this.body.sole, f.p[2] + this.on[2] * this.body.sole];
      const d = sub(fall, s), far = Math.hypot(d[0], d[1], d[2]), R = (this.body.thigh + this.body.shin) * 0.97;
      // (behind, the toe pivot gives the leg a heel's length more)
      const behind = this.on[1] > 0.7 && d[0] * fw[0] + d[2] * fw[2] < 0 ? 0.1 : 0, over = far - R - behind;
      if (over <= 0) continue;
      const flat = this.on[1] > 0.7, most = flat ? 0.14 : 0.12;
      let g: V3;
      if (flat) { const h = Math.hypot(d[0], d[2]), v = -d[1], R2 = R + behind; g = [0, h < R2 ? -Math.max(0, v - Math.sqrt(R2 * R2 - h * h)) : -most, 0]; }
      else g = [(d[0] / far) * over, (d[1] / far) * over, (d[2] / far) * over];
      const gl = Math.hypot(g[0], g[1], g[2]);
      if (gl > most) { g = [(g[0] * most) / gl, (g[1] * most) / gl, (g[2] * most) / gl]; }
      // (still out of reach: let go)
      if (over - Math.min(gl, most) > (flat ? 0.05 : 0.015) || far > 1.6) f.lost = true;
      for (let i = 0; i < 3; i++) if (Math.abs(g[i] * f.w) > Math.abs(want[i])) want[i] = g[i] * f.w;
    }
    // (taken quickly, given back a little slower)
    for (let i = 0; i < 3; i++) { const k = Math.abs(want[i]) > Math.abs(this.give[i]) ? 60 : 18; this.give[i] += (want[i] - this.give[i]) * (dt > 0.2 ? 1 : 1 - Math.exp(-k * dt)); }
  }

  private pelvis(r: Body, give: V3): M4 {
    const p = this.pose, spin = r.move === 'flip' ? 2 * Math.PI * sm(0.08, 0.9, r.mu) : r.move === 'roll' ? 2 * Math.PI * sm(0, 1, r.mu) : 0;
    const side = r.move === 'sideflip' ? (r.lead === 1 ? 1 : -1) * 2 * Math.PI * sm(0.08, 0.9, r.mu) : r.move === 'vault' && r.wheel ? (r.lead === 1 ? 1 : -1) * 2 * Math.PI * sm(0.1, 0.85, r.mu) : 0;
    const round = r.move === 'vault' && r.palmSpin ? 2 * Math.PI * sm(0.15, 0.85, r.mu) * (r.lead === 1 ? -1 : 1) : 0;
    const P = rotY(translate(ident(), r.x + give[0], r.y + give[1], r.z + give[2]), r.heading + round + p.hips);
    return rotZ(rotX(translate(P, this.aside, this.hipY, 0), p.lean + spin), this.bank + p.tilt + side);
  }

  /** The skeleton, placed in the world at the body. */
  bones(r: Body): Bone[] {
    const p = this.pose, out: Bone[] = [];
    // (turned right over, forwards, through a flip or a roll; over sideways, the lead leg's way; round on its hand, a palm
    // spin; and carried toward a footfall it couldn't otherwise reach)
    const P = this.pelvis(r, [this.give[0] + this.slip[0], this.give[1] + this.slip[1], this.give[2] + this.slip[2]]);
    const add = (name: string, m: M4, y0: number, w0: number, d0: number, y1: number, w1: number, d1: number, zc = 0) => out.push({ name, m, y0, w0, d0, y1, w1, d1, zc });
    const b = this.body, blk = (name: string, m: M4, k: Block) => add(name, m, k.y0, k.w0, k.d0, k.y1, k.w1, k.d1, k.zc ?? 0);
    blk('pelvis', P, b.blocks.pelvis);
    const S = rotY(rotX(translate(P, 0, b.spine, 0), p.spine + this.chest + b.stoop), p.twist);
    blk('torso', S, b.blocks.torso);
    blk('head', rotX(rotY(translate(S, 0, b.neck, 0), p.look), p.head - this.chest * 0.5 - b.stoop * 0.6), b.blocks.head);
    for (const side of [1, -1]) {
      const L = side > 0, n = L ? 'L' : 'R';
      const A = sw(rotZ(translate(S, side * b.shoulderX, b.shoulderY, 0), side * (L ? p.spreadL : p.spreadR)), L ? p.shL : p.shR);
      let F = sw(translate(A, 0, -this.body.upper, 0), L ? p.elL : p.elR), U = A;
      const hand = L ? this.hands.L : this.hands.R;
      if (hand.w > 0.01) {
        // (reaching: from where the pose had the hand toward the hold, by how much hold it has; the arm solved to there,
        // the elbow down and out and a little behind)
        const s: V3 = [A[12], A[13], A[14]], was = point(F, 0, -this.body.fore, 0);
        let to: V3 = [was[0] + (hand.p[0] - was[0]) * hand.w, was[1] + (hand.p[1] - was[1]) * hand.w, was[2] + (hand.p[2] - was[2]) * hand.w];
        let dir = sub(to, s), d = Math.hypot(dir[0], dir[1], dir[2]);
        const most = this.body.upper + this.body.fore - 0.005;
        if (d > most) { to = [s[0] + (dir[0] * most) / d, s[1] + (dir[1] * most) / d, s[2] + (dir[2] * most) / d]; d = most; }
        dir = unit(dir);
        const a = (this.body.upper * this.body.upper - this.body.fore * this.body.fore + d * d) / (2 * Math.max(d, 1e-3)), h = Math.sqrt(Math.max(0, this.body.upper * this.body.upper - a * a));
        const pole: V3 = [-P[4] * 0.7 - P[8] * 0.45 + side * P[0] * 0.5, -P[5] * 0.7 - P[9] * 0.45 + side * P[1] * 0.5, -P[6] * 0.7 - P[10] * 0.45 + side * P[2] * 0.5];
        const k = pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2], out2 = unit([pole[0] - dir[0] * k, pole[1] - dir[1] * k, pole[2] - dir[2] * k]);
        const elbow: V3 = [s[0] + dir[0] * a + out2[0] * h, s[1] + dir[1] * a + out2[1] * h, s[2] + dir[2] * a + out2[2] * h], fwd: V3 = [P[8], P[9], P[10]];
        U = aim(s, elbow, fwd); F = aim(elbow, to, fwd);
      }
      blk('upperArm' + n, U, b.blocks.upperArm);
      blk('foreArm' + n, F, b.blocks.foreArm);
      const hip = L ? p.hipL : p.hipR, knee = L ? p.kneeL : p.kneeR;
      const T = sw(rotZ(translate(P, side * b.hipX, -this.body.hipDrop, 0), side * (p.splay + this.legOut[L ? 0 : 1])), hip);
      let Th = T, K = sw(translate(T, 0, -this.body.thigh, 0), -knee), planted: V3 | null = null, plantK = 1;
      const sole = L ? this.soles.L : this.soles.R;
      if (sole.w > 0.01) {
        // (planted: the ankle taken from where the pose had it toward its footfall (a sole's depth off what it's on),
        // the leg solved to there, the knee forward)
        const s: V3 = [T[12], T[13], T[14]], was = point(K, 0, -this.body.shin, 0), fall: V3 = [sole.p[0] + this.on[0] * this.body.sole, sole.p[1] + this.on[1] * this.body.sole, sole.p[2] + this.on[2] * this.body.sole];
        const most = this.body.thigh + this.body.shin - 0.005;
        // (out of reach behind: up onto the toe, the heel lifting, the foot pivoting about its ball, so the leg stays on its
        // footfall to the push-off instead of dragging it)
        let toe = 0;
        // (walking and running from the clips: the heel comes up as far as the clip's knee wants, not only once the leg's run out:
        // so the knee's already bending through the push-off, the toe still down, as a person's does, not straight to the last)
        const dk = Math.sqrt(this.body.thigh ** 2 + this.body.shin ** 2 + 2 * this.body.thigh * this.body.shin * Math.cos(knee)), reachTo = Math.min(most, most + (dk - most) * this.mocapK * (1 - sm(1.8, 2.8, r.speed)));
        { const fw: V3 = this.on[1] > 0.7 && r.state === 'ground' ? [Math.sin(sole.yaw), 0, Math.cos(sole.yaw)] : unit([P[8], 0, P[10]]); if (Math.hypot(fall[0] - s[0], fall[1] - s[1], fall[2] - s[2]) > reachTo && (fall[0] - s[0]) * fw[0] + (fall[2] - s[2]) * fw[2] < 0) {
          // (the ball on the ground, under the foot: what it pivots about, so the toe stays where it is as the heel comes up)
          const on = this.on, ball: V3 = [fall[0] + fw[0] * this.body.ball - on[0] * this.body.sole, fall[1] - on[1] * this.body.sole, fall[2] + fw[2] * this.body.ball - on[2] * this.body.sole];
          // (the heel lifted just as far as it has to: solved, not stepped, so the ankle doesn't jump)
          const at = (th: number): V3 => { const c = Math.cos(th), sn = Math.sin(th), a = -this.body.ball * c + this.body.sole * sn, b = this.body.ball * sn + this.body.sole * c; return [ball[0] + fw[0] * a + on[0] * b, ball[1] + fw[1] * a + on[1] * b, ball[2] + fw[2] * a + on[2] * b]; };
          const far = (th: number) => { const c = at(th); return Math.hypot(c[0] - s[0], c[1] - s[1], c[2] - s[2]); };
          // (the clip's knee asking the heel up only so far (55°): past that, as the leg's length alone has it, so a foot left far
          // behind in a turn isn't stood up on its toe at once)
          const byKnee = reachTo < most && far(0.95) <= most, want = byKnee ? Math.max(reachTo, far(0.95)) : most;
          let lo = 0, hi = byKnee ? 0.95 : far(0) > most ? 1.5 : 0; if (far(hi) > want) lo = hi; else for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (far(m) > want) lo = m; else hi = m; }
          toe = Math.max(lo, hi === 1.5 && lo === 1.5 ? 1.5 : hi); /* (the heel coming up no faster than a heel can: ~12 rad/s, not stood on the toe in a frame) */ if (this.mocapK > 0 && r.speed < 3) toe = Math.min(toe, this.toe[L ? 0 : 1] + 0.25); const c = at(toe); fall[0] = c[0]; fall[1] = c[1]; fall[2] = c[2]; } }
        this.toe[L ? 0 : 1] = toe;
        // (on it once it's taken the weight: blended from the pose's foot onto the footfall through the touch, all the way on by
        // nine tenths of the weight, so a planted foot doesn't trail a tenth of the body's motion)
        const wk = Math.min(1, sole.w / 0.9); plantK = wk;
        let to: V3 = [was[0] + (fall[0] - was[0]) * wk, was[1] + (fall[1] - was[1]) * wk, was[2] + (fall[2] - was[2]) * wk];
        let dir = sub(to, s), d = Math.hypot(dir[0], dir[1], dir[2]);
        if (d > most) { to = [s[0] + (dir[0] * most) / d, s[1] + (dir[1] * most) / d, s[2] + (dir[2] * most) / d]; d = most; }
        dir = unit(dir);
        const a = (this.body.thigh * this.body.thigh - this.body.shin * this.body.shin + d * d) / (2 * Math.max(d, 1e-3)), h = Math.sqrt(Math.max(0, this.body.thigh * this.body.thigh - a * a));
        const pole: V3 = [P[8] + P[4] * 0.3, P[9] + P[5] * 0.3, P[10] + P[6] * 0.3], k = pole[0] * dir[0] + pole[1] * dir[1] + pole[2] * dir[2], out2 = unit([pole[0] - dir[0] * k, pole[1] - dir[1] * k, pole[2] - dir[2] * k]);
        const kneeAt: V3 = [s[0] + dir[0] * a + out2[0] * h, s[1] + dir[1] * a + out2[1] * h, s[2] + dir[2] * a + out2[2] * h], fwd: V3 = [P[8], P[9], P[10]];
        Th = aim(s, kneeAt, fwd); K = aim(kneeAt, to, fwd); planted = to;
      }
      blk('thigh' + n, Th, b.blocks.thigh);
      blk('shin' + n, K, b.blocks.shin);
      // (the foot: flat to the ground when it's on it, the toe pointed when it isn't)
      let Ft = sw(translate(K, 0, -this.body.shin, 0), -(hip - knee) * (0.35 + 0.5 * this.stood) - 0.5 * (1 - this.stood));
      if (planted) {
        // (and the foot flat to what it's on: its sole toward it, its toe the way the body faces, as near as that allows)
        const y: V3 = this.on, f0: V3 = this.on[1] > 0.7 && r.state === 'ground' ? [Math.sin(sole.yaw), 0, Math.cos(sole.yaw)] : this.on[1] < 0.7 && (r.state === 'climb' || r.state === 'chimney') ? [0, 1, 0] : [P[8], P[9], P[10]], kf = f0[0] * y[0] + f0[1] * y[1] + f0[2] * y[2];
        let z = unit([f0[0] - y[0] * kf, f0[1] - y[1] * kf, f0[2] - y[2] * kf]);
        if (Math.abs(kf) > 0.95) z = unit(cross([P[0], P[1], P[2]], y));
        // (on the toe: the foot pitched heel up about its ball)
        const th = this.toe[L ? 0 : 1]; if (th) { const yy = y; z = unit([z[0] * Math.cos(th) - yy[0] * Math.sin(th), z[1] * Math.cos(th) - yy[1] * Math.sin(th), z[2] * Math.cos(th) - yy[2] * Math.sin(th)]); }
        // (coming onto it, the sole turns from the swing's angle to flat as the weight comes on (a forefoot settling), not in
        // a frame)
        if (plantK < 1) { const sz: V3 = unit([Ft[8], Ft[9], Ft[10]]), sy: V3 = unit([Ft[4], Ft[5], Ft[6]]), e = plantK * plantK * (3 - 2 * plantK); z = unit([sz[0] + (z[0] - sz[0]) * e, sz[1] + (z[1] - sz[1]) * e, sz[2] + (z[2] - sz[2]) * e]); const yb = unit([sy[0] + (y[0] - sy[0]) * e, sy[1] + (y[1] - sy[1]) * e, sy[2] + (y[2] - sy[2]) * e]); const xb = unit(cross(yb, z)), y3 = cross(z, xb); Ft = ident(); Ft[0] = xb[0]; Ft[1] = xb[1]; Ft[2] = xb[2]; Ft[4] = y3[0]; Ft[5] = y3[1]; Ft[6] = y3[2]; Ft[8] = z[0]; Ft[9] = z[1]; Ft[10] = z[2]; Ft[12] = planted[0]; Ft[13] = planted[1]; Ft[14] = planted[2]; }
        else {
        const x = unit(cross(y, z)), y2 = cross(z, x); Ft = ident();
        Ft[0] = x[0]; Ft[1] = x[1]; Ft[2] = x[2]; Ft[4] = y2[0]; Ft[5] = y2[1]; Ft[6] = y2[2]; Ft[8] = z[0]; Ft[9] = z[1]; Ft[10] = z[2]; Ft[12] = planted[0]; Ft[13] = planted[1]; Ft[14] = planted[2];
        }
      }
      blk('foot' + n, Ft, b.blocks.foot);
      // (where this foot is against the line, if it's free: for the next frame's swing out)
      if (sole.w < 0.5 && r.state === 'ground') { const fx = Math.sin(r.heading), fz = Math.cos(r.heading), bp = point(Ft, 0, 0, b.ball); this.freeLat[L ? 0 : 1] = ((bp[0] - P[12]) * fz - (bp[2] - P[14]) * fx) * side; }
      else this.freeLat[L ? 0 : 1] = null;
    }
    // (dressed: each bone its material; and what's worn, on the bone it's fixed to, sized with the body (a head's with the
    // head))
    const c = this.character, sc = this.character.proportions.stature / 1.82;
    for (const o of out) o.mat = c.dress[o.name.replace(/[LR]$/, '') as keyof Character['dress']];
    for (const w of c.wears) {
      const on = out.find((o) => o.name === w.bone); if (!on) continue;
      const k = w.bone === 'head' ? this.body.blocks.head.w1 / 0.18 : sc, m = rotX(translate(on.m, w.at[0] * k, w.at[1] * k, w.at[2] * k), w.tilt ?? 0);
      out.push({ name: 'worn:' + w.bone, m, y0: w.block.y0 * k, w0: w.block.w0 * k, d0: w.block.d0 * k, y1: w.block.y1 * k, w1: w.block.w1 * k, d1: w.block.d1 * k, zc: (w.block.zc ?? 0) * k, x: (w.block.x ?? 0) * k, mat: w.mat });
    }
    return out;
  }
}
