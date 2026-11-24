/**
 * Locomotion played from motion capture (mocap-clips.ts: real walking, jogging and running, retargeted onto the rig's
 * pose angles). The hand-made gait (rig.ts `gait`, `stride`) is the body as formulas; this is the body as people move,
 * which is where the read of an athlete comes from. The rig keeps everything that touches the world (where each foot
 * comes down and stays, the hips' height, a foot taken onto its footfall); the clips give the rest of the legs, the arms
 * and the trunk: their timing, their swing, the asymmetries and the weight in them.
 *
 * Played by the runner's own stride (distance matching): each leg at its place in the runner's cycle (0 its footfall),
 * its stance stretched or squeezed to the runner's (the clip's foot is down for its own share of the cycle; the runner's
 * for its): so the clip is in step with where the feet are actually put, at any pace, rather than at the pace it was
 * captured at. The clips are blended by pace (a walk, a jog, a run); above the run, into the hand-made sprint.
 */
import { CLIPS } from './mocap-clips';
import type { Clip } from './mocap-clips';

/** a clip's value of each key at a place in its cycle (0..1, looping) */
function sample(c: Clip, at: number): number[] {
  const N = c.frames.length, x = (((at % 1) + 1) % 1) * N, i = Math.floor(x), f = x - i, a = c.frames[i % N], b = c.frames[(i + 1) % N];
  return a.map((v, k) => v + (b[k] - v) * f);
}
/** a place in the runner's cycle for one leg (0 its footfall, its stance to `sd`) to the clip's (its stance to `duty`) */
const warp = (c: number, sd: number, duty: number) => (c < sd ? (c / sd) * duty : duty + ((c - sd) / (1 - sd)) * (1 - duty));
/** how long a clip's feet are down (left, right), guarded against a footfall misread at capture */
function duties(c: Clip): { l: number; r: number } {
  const l = c.marks.lOff > 0.08 && c.marks.lOff < 0.85 ? c.marks.lOff : 0.3, r = (((c.marks.rOff - c.marks.rOn) % 1) + 1) % 1;
  return { l, r: r > 0.08 && r < 0.85 ? r : l };
}
const BY = CLIPS.slice().sort((a, b) => a.speed - b.speed);
/** the two clips either side of a pace, and how far between */
function between(speed: number): { lo: Clip; hi: Clip; k: number } {
  const last = BY[BY.length - 1];
  if (speed >= last.speed) return { lo: last, hi: last, k: 0 };
  for (let i = 0; i + 1 < BY.length; i++) if (speed > BY[i].speed && speed <= BY[i + 1].speed) return { lo: BY[i], hi: BY[i + 1], k: (speed - BY[i].speed) / (BY[i + 1].speed - BY[i].speed) };
  return { lo: BY[0], hi: BY[0], k: 0 };
}

/**
 * The pose from the clips at a pace (m/s), for legs at `cL` and `cR` through their own cycles (0 each one's footfall),
 * each down for `sd` of it: the rig's pose keys (hipL … spine, splay) in radians. Null with no clips.
 */
export function clipPose(speed: number, cL: number, cR: number, sd: number): Record<string, number> | null {
  if (!BY.length) return null;
  const { lo, hi, k } = between(speed);
  const one = (c: Clip) => {
    const d = duties(c), s = Math.max(0.05, Math.min(0.9, sd));
    const pl = warp(cL, s, d.l), pr = c.marks.rOn + warp(cR, s, d.r), body = sample(c, pl), right = sample(c, pr), o: Record<string, number> = {};
    c.keys.forEach((key, i) => { o[key] = key.endsWith('R') && !['hips'].includes(key) ? right[i] : body[i]; });
    return o;
  };
  const a = one(lo), b = lo === hi ? a : one(hi), out: Record<string, number> = {};
  for (const key of Object.keys(a)) out[key] = a[key] + (b[key] - a[key]) * k;
  out.splay = ((out.splayL ?? 0) + (out.splayR ?? 0)) / 2;
  return out;
}
/**
 * Where a stepping foot is `k` (0..1) through its swing at a pace, as people's are: how far along from where it left to
 * where it lands (0..1), and its height off the ground as a share of the leg's length (hip to ankle). Up fast and early
 * behind the body, then carried forward low and set down; not the even arc of a hand-made step. Null with no clips.
 */
export function swingPath(speed: number, k: number): { along: number; lift: number } | null {
  if (!BY.length) return null;
  const { lo, hi, k: m } = between(speed), at = (a: number[], x: number) => { const n = a.length - 1, y = Math.max(0, Math.min(1, x)) * n, i = Math.min(n - 1, Math.floor(y)), f = y - i; return a[i] + (a[i + 1] - a[i]) * f; };
  // (the heel's already off the ground as the toe leaves: that rise belongs to the stance, so it's taken out here, the swing starting from the ground)
  const one = (c: Clip) => ({ along: at(c.swing.along, k), lift: Math.max(0, at(c.swing.lift, k) - c.swing.lift[0] * (1 - k)) });
  const a = one(lo), b = one(hi);
  return { along: a.along + (b.along - a.along) * m, lift: a.lift + (b.lift - a.lift) * m };
}
/** whether the clips are played (`?mocap=0` on the page: the hand-made gait alone, to compare) */
export const MOCAP = { on: !((typeof location !== 'undefined' && new URLSearchParams(location.search).get('mocap') === '0') || (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.MOCAP === '0') };
/** the clips' paces, slowest to fastest */
export const CLIP_SPEEDS = BY.map((c) => c.speed);
