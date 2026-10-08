/**
 * A deer as geometry: a skinned mesh and the skeleton that moves it.
 *
 * The body is lofted from cross-sections (rump, haunch, the deep ribcage, the chest) over two
 * bones that meet mid-back, so the spine flexes in the bound; the neck and head are lofted too,
 * the head a wedge from skull to muzzle with its ears; the legs are tubes over three bones each
 * (the front: forearm, cannon, with the upper arm in the body; the hind: thigh, gaskin, the long
 * cannon below the hock), each vertex weighted to at most two bones. Pure: the same mesh and the
 * same pose from the same deer.
 *
 * The pose comes from what the herd's simulation says the deer is doing (deer.ts: where it is
 * and faces, how fast it goes, its head up or down, turned to you or not, lying up or standing):
 *
 * - its gait follows its speed over the ground, each a cycle of the four legs, the hooves set
 *   down where the ground is and left there while the body passes over (so they do not slide):
 *   a walk (four beats, the hind leg leading each side), a trot (diagonal pairs), and the bound
 *   it dashes in (the hind legs together, then the fore, with a moment in the air, the spine
 *   flexing and the body pitching, the tail up), blended into one another as it speeds up;
 * - standing, all four down; grazing, the neck down to the grass and the head nibbling, a slow
 *   step now and then; lying up, the legs folded under, the head up;
 * - alert, the head turned to look at you; the ears flick, the tail twitches.
 *
 * Each leg is solved for its hoof: the cannon set (upright on the ground, folded back in the
 * swing), the two bones above it bent to reach — the front elbow back, the hind stifle forward.
 */
import type { Deer } from './deer';

/** the bones: 0 hindquarters, 1 forequarters, 2 neck, 3 head, 4–5 ears, 6 tail, then each leg's
 *  three (upper, middle, lower): 7–9 left fore, 10–12 right fore, 13–15 left hind, 16–18 right hind */
export const BONES = 19;
/** floats per vertex: position, normal, albedo, two bones and the second's weight */
export const DEER_STRIDE = 12;

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ─── the deer at rest (metres, size 1; facing +z, its right +x, the ground at y 0) ────────────────
/** where the spine bends (mid-back) */
const MID: V3 = [0, 1.0, -0.06];
const NECK0: V3 = [0, 1.08, 0.5];
const HEAD0: V3 = [0, 1.62, 0.82];
const TAIL0: V3 = [0, 1.03, -0.66];
const EAR0: V3[] = [[-0.05, 1.69, 0.84], [0.05, 1.69, 0.84]];
/** the legs: hip (shoulder) and the lengths of the three bones; which way the middle joint bends
 *  (front elbow back, hind stifle forward) */
interface LegDef { hip: V3; L: [number, number, number]; bend: number; front: boolean; body: number }
const LEGS: LegDef[] = [
  { hip: [-0.12, 0.92, 0.38], L: [0.27, 0.31, 0.38], bend: -1, front: true, body: 1 },
  { hip: [0.12, 0.92, 0.38], L: [0.27, 0.31, 0.38], bend: -1, front: true, body: 1 },
  { hip: [-0.13, 0.98, -0.48], L: [0.31, 0.35, 0.44], bend: 1, front: false, body: 0 },
  { hip: [0.13, 0.98, -0.48], L: [0.31, 0.35, 0.44], bend: 1, front: false, body: 0 },
];
/** a leg's joints at rest: straight down from its hip */
const restJoints = (l: LegDef): V3[] => [l.hip, sub(l.hip, [0, l.L[0], 0]), sub(l.hip, [0, l.L[0] + l.L[1], 0]), sub(l.hip, [0, l.L[0] + l.L[1] + l.L[2], 0])];

// the colours of the coat (linear albedo)
const COAT: V3 = [0.2, 0.135, 0.085], BELLY: V3 = [0.33, 0.27, 0.2], RUMP: V3 = [0.46, 0.44, 0.39], LEG: V3 = [0.15, 0.11, 0.08], HOOF: V3 = [0.03, 0.028, 0.026], NOSE: V3 = [0.03, 0.03, 0.03], EARIN: V3 = [0.36, 0.3, 0.27];

// ─── the mesh ──────────────────────────────────────────────────────────────────────────────────
export function buildDeer(): { data: Float32Array; index: Uint32Array } {
  const data: number[] = [];
  const index: number[] = [];
  const vert = (p: V3, n: V3, c: V3, b0: number, b1: number, w: number) => { data.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], b0, b1, w); return data.length / DEER_STRIDE - 1; };
  /** a loft: rings about a line of centres, each an ellipse (half-widths across and up) in the
   *  plane across the line; colour and skin per ring (or per vertex, by the colour function) */
  const loft = (rings: Array<{ c: V3; rx: number; ry: number; b0: number; b1: number; w: number }>, side: V3, colour: (i: number, a: number, p: V3) => V3, around = 16, capEnds = true) => {
    const base = data.length / DEER_STRIDE;
    for (let i = 0; i < rings.length; i++) {
      const rg = rings[i];
      const ahead = norm(sub(rings[Math.min(i + 1, rings.length - 1)].c, rings[Math.max(i - 1, 0)].c));
      const u = norm(sub(side, mul(ahead, dot(side, ahead))));
      const v = cross(ahead, u);
      for (let j = 0; j < around; j++) {
        const a = (j / around) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        // (a little flat below, as a belly is)
        const flat = sa < 0 ? 1 - 0.18 * sa * sa : 1;
        const p = add(rg.c, add(mul(u, ca * rg.rx), mul(v, sa * rg.ry * flat)));
        const n = norm(add(mul(u, ca / rg.rx), mul(v, sa / rg.ry)));
        vert(p, n, colour(i, a, p), rg.b0, rg.b1, rg.w);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < around; j++) {
      const a = base + i * around + j, b = base + i * around + ((j + 1) % around), c = a + around, d = b + around;
      index.push(a, c, b, b, c, d);
    }
    if (capEnds) for (const [i, dir] of [[0, -1], [rings.length - 1, 1]] as const) {
      const rg = rings[i];
      const ahead = norm(sub(rings[Math.min(i + 1, rings.length - 1)].c, rings[Math.max(i - 1, 0)].c));
      const c = vert(add(rg.c, mul(ahead, dir * Math.min(rg.rx, rg.ry) * 0.6)), mul(ahead, dir), colour(i, 0, rg.c), rg.b0, rg.b1, rg.w);
      for (let j = 0; j < around; j++) {
        const a = base + i * around + j, b = base + i * around + ((j + 1) % around);
        if (dir < 0) index.push(c, b, a); else index.push(c, a, b);
      }
    }
  };
  // the body: rump to chest, over the hindquarters (0) and forequarters (1)
  const BODY: Array<[number, number, number, number]> = [
    // z, half-width, half-height, centre height
    [-0.7, 0.07, 0.08, 1.01], [-0.64, 0.15, 0.19, 0.99], [-0.52, 0.2, 0.26, 0.96], [-0.36, 0.2, 0.27, 0.94],
    [-0.18, 0.19, 0.26, 0.93], [0.0, 0.185, 0.27, 0.925], [0.18, 0.19, 0.3, 0.94], [0.34, 0.18, 0.3, 0.965],
    [0.48, 0.15, 0.25, 0.99], [0.58, 0.1, 0.17, 1.02], [0.63, 0.05, 0.09, 1.05],
  ];
  loft(BODY.map(([z, w, h, y]) => { const t = smooth(-0.2, 0.08, z); return { c: [0, y, z], rx: w, ry: h, b0: 0, b1: 1, w: t }; }), [1, 0, 0], (i, a, p) => {
    const s = Math.sin(a);
    // the rump patch white about the tail; the belly lighter; a darker line along the back
    const rump = smooth(-0.58, -0.68, p[2]) * smooth(-0.3, 0.2, s) * (1 - smooth(0.08, 0.12, Math.abs(p[0])));
    const belly = smooth(-0.35, -0.85, s);
    const back = smooth(0.85, 1, s) * 0.3;
    let c = mixV(COAT, BELLY, belly);
    c = mul(c, 1 - back);
    return mixV(c, RUMP, rump);
  }, 22);
  // the neck: from the chest up to the head (blended into the forequarters at its base)
  const NECK: Array<[number, number, number]> = [[0, 0.13, 0.16], [0.25, 0.1, 0.12], [0.55, 0.075, 0.09], [0.85, 0.065, 0.075], [1, 0.06, 0.07]];
  loft(NECK.map(([t, rx, ry]) => ({ c: add(add(NECK0, mul(sub(HEAD0, NECK0), t)), [0, -0.04 * Math.sin(Math.PI * t), 0.03 * Math.sin(Math.PI * t)]), rx, ry, b0: 1, b1: 2, w: smooth(0, 0.25, t) })), [1, 0, 0], (_i, a) => (Math.sin(a) < -0.5 ? BELLY : COAT), 14);
  // the head: a wedge from the skull to the muzzle, dark at the nose
  const fwd = norm([0, -0.42, 1]);
  const HEAD: Array<[number, number, number]> = [[-0.04, 0.05, 0.06], [0.02, 0.075, 0.085], [0.12, 0.07, 0.08], [0.22, 0.055, 0.065], [0.31, 0.042, 0.05], [0.37, 0.035, 0.04], [0.395, 0.022, 0.026]];
  // (its eyes dark, on either side, a little up)
  loft(HEAD.map(([t, rx, ry]) => ({ c: add(HEAD0, mul(fwd, t)), rx, ry, b0: 3, b1: 3, w: 0 })), [1, 0, 0], (i, a) => (i >= 5 ? NOSE : i === 2 && Math.abs(Math.cos(a)) > 0.88 && Math.sin(a) > -0.05 ? NOSE : Math.sin(a) < -0.4 ? BELLY : COAT), 14);
  // the ears: flattened cones, up and out and back
  EAR0.forEach((e, k) => {
    const out = k === 0 ? -1 : 1;
    const dir = norm([out * 0.55, 0.75, -0.35]);
    const rings = [0, 0.04, 0.09, 0.14, 0.17].map((t, i) => ({ c: add(e, mul(dir, t)), rx: [0.025, 0.035, 0.035, 0.024, 0.006][i], ry: [0.012, 0.012, 0.01, 0.008, 0.003][i], b0: 4 + k, b1: 4 + k, w: 0 }));
    loft(rings, [0, 0, 1], (_i, a) => (Math.sin(a) > 0 ? EARIN : COAT), 8);
  });
  // the tail: a short tuft, white beneath
  loft([0, 0.06, 0.12, 0.16].map((t, i) => ({ c: add(TAIL0, [0, -t * 0.8, -t * 0.55]), rx: [0.035, 0.04, 0.035, 0.01][i], ry: [0.03, 0.035, 0.03, 0.01][i], b0: 6, b1: 6, w: 0 })), [1, 0, 0], (_i, a) => (Math.sin(a) < 0 ? RUMP : COAT), 8);
  // the legs: tubes down each bone, joints blended, a hoof at the foot
  LEGS.forEach((l, k) => {
    const J = restJoints(l);
    const b = 7 + k * 3;
    const r = l.front ? [0.075, 0.05, 0.045, 0.032, 0.026, 0.022, 0.024, 0.026] : [0.09, 0.07, 0.05, 0.038, 0.03, 0.023, 0.025, 0.027];
    // stations: down the upper bone, the middle, the lower to the fetlock, the hoof
    const st: Array<{ y: number; r: number; b0: number; b1: number; w: number; c: V3 }> = [];
    const at = (i: number, t: number) => J[i][1] + (J[i + 1][1] - J[i][1]) * t;
    st.push({ y: at(0, -0.05), r: r[0], b0: l.body, b1: b, w: 0.6, c: COAT });
    st.push({ y: at(0, 0.5), r: r[1], b0: b, b1: b, w: 0, c: COAT });
    st.push({ y: at(0, 0.95), r: r[2], b0: b, b1: b + 1, w: 0.5, c: COAT });
    st.push({ y: at(1, 0.5), r: r[3], b0: b + 1, b1: b + 1, w: 0, c: LEG });
    st.push({ y: at(1, 0.97), r: r[4], b0: b + 1, b1: b + 2, w: 0.5, c: LEG });
    st.push({ y: at(2, 0.55), r: r[5], b0: b + 2, b1: b + 2, w: 0, c: LEG });
    st.push({ y: at(2, 0.86), r: r[6], b0: b + 2, b1: b + 2, w: 0, c: HOOF });
    st.push({ y: at(2, 1.0), r: r[7], b0: b + 2, b1: b + 2, w: 0, c: HOOF });
    loft(st.map((s) => ({ c: [l.hip[0], s.y, l.hip[2]] as V3, rx: s.r, ry: s.r * 1.15, b0: s.b0, b1: s.b1, w: s.w })), [1, 0, 0], (i) => st[i].c, 10);
  });
  return { data: new Float32Array(data), index: new Uint32Array(index) };
}
const mixV = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ─── matrices (column-major 4×4) ─────────────────────────────────────────────────────────────────
type M4 = Float32Array;
const ident = (): M4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
function mm(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}
const T = (v: V3): M4 => { const m = ident(); m[12] = v[0]; m[13] = v[1]; m[14] = v[2]; return m; };
/** about x: positive tips +z (the nose) down */
const Rx = (a: number): M4 => { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
/** about y: positive turns +z toward +x */
const Ry = (a: number): M4 => { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; };
/** about z: positive tips +y toward −x */
const Rz = (a: number): M4 => { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; };
const apply = (m: M4, p: V3): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
/** a bone turned about a joint: about `at` (rest), by `r`, then by `parent` */
const about = (parent: M4, at: V3, r: M4) => mm(parent, mm(T(at), mm(r, T(mul(at, -1)))));
/** a frame with axes x, y, z at `o`, for a bone whose rest frame is the model's own, from `rest` */
function frame(x: V3, y: V3, z: V3, o: V3, rest: V3): M4 {
  const m = new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1]);
  return mm(m, T(mul(rest, -1)));
}

// ─── the gaits ─────────────────────────────────────────────────────────────────────────────────
/** each gait: when each leg (LF, RF, LH, RH) starts its stance in the cycle, how long it stays
 *  down (duty), how far a stride goes (m, size 1), how high the hoof lifts, how far the cannon
 *  folds in the swing (front, hind) */
interface Gait { off: [number, number, number, number]; duty: number; stride: number; lift: number; fold: [number, number] }
const WALK: Gait = { off: [0.25, 0.75, 0, 0.5], duty: 0.64, stride: 1.05, lift: 0.1, fold: [1.0, 0.5] };
const TROT: Gait = { off: [0, 0.5, 0.5, 0], duty: 0.42, stride: 1.8, lift: 0.17, fold: [1.5, 0.8] };
const BOUND: Gait = { off: [0.5, 0.58, 0, 0.07], duty: 0.27, stride: 3.8, lift: 0.3, fold: [2.1, 1.2] };

interface State { phase: number; still: number; t: number; ear: [number, number]; tail: number }
/** the skeleton's pose for each deer, frame by frame (it keeps each one's step cycle) */
export class DeerRig {
  private states = new WeakMap<Deer, State>();
  /** the bones' matrices (BONES × 16 floats) for a deer this frame: `ground` its foot's height,
   *  `eye` where you are (it looks at you), dt the frame's seconds */
  pose(d: Deer, ground: number, eye: { x: number; z: number }, dt: number, out = new Float32Array(BONES * 16)): Float32Array {
    let s = this.states.get(d);
    if (!s) { s = { phase: d.gait / (Math.PI * 2), still: 1, t: (d.gait * 7.3) % 50, ear: [0, 0], tail: 0 }; this.states.set(d, s); }
    const k = d.size;
    const v = Math.max(0, d.speed) / k;
    s.t += dt;
    // which gaits, by speed (m/s at size 1): walking to 1.3, trotting to 3.6, bounding beyond
    const wt = smooth(1.1, 1.7, v) * (1 - smooth(3.2, 4.2, v)), wb = smooth(3.2, 4.2, v), ww = 1 - wt - wb;
    const stride = WALK.stride * ww + TROT.stride * wt + BOUND.stride * wb;
    // the cycle goes on as far as it has gone over the ground: no hoof slides
    s.phase = (s.phase + (v * dt) / stride) % 1;
    s.still += ((v > 0.04 ? 0 : 1) - s.still) * (1 - Math.exp(-dt * 6));
    const moving = 1 - s.still;
    const ph = s.phase;
    // (lying down and getting up are quick: the pose is mostly one or the other)
    const bed = smooth(0.15, 0.75, d.bed);
    // the body: bob and pitch with the gait, the spine flexing in the bound; low when lying up
    const bob = moving * (ww * 0.012 * Math.cos(ph * 4 * Math.PI) + wt * 0.03 * Math.abs(Math.sin(ph * 2 * Math.PI)) + wb * 0.16 * Math.max(0, Math.sin((ph - 0.15) * 2 * Math.PI)));
    const pitch = moving * wb * 0.16 * Math.sin((ph + 0.05) * 2 * Math.PI) + moving * ww * 0.012 * Math.sin(ph * 4 * Math.PI);
    const flex = moving * wb * 0.18 * Math.sin((ph - 0.1) * 2 * Math.PI);
    const lift = mix(bob, -0.57, bed);
    const root = mm(T([d.x, ground + lift * k, d.z]), mm(Ry(d.heading), scaleM(k)));
    const hind = about(root, MID, Rx(pitch + flex * 0.5 - bed * 0.04));
    const fore = about(root, MID, Rx(pitch - flex * 0.5 + bed * 0.03 + (1 - clamp(d.headUp, 0, 1)) * (1 - bed) * 0.12));
    // the head: down to graze, up alert, out in the bound; turned to look at you
    const up = clamp(d.headUp, 0, 1);
    const toYou = Math.atan2(eye.x - d.x, eye.z - d.z);
    let look = toYou - d.heading;
    look = Math.atan2(Math.sin(look), Math.cos(look));
    look = clamp(look, -1.4, 1.4) * clamp(d.headTurn, 0, 1);
    const nibble = (1 - up) * 0.05 * Math.sin(s.t * 7) * (Math.sin(s.t * 0.9) > 0 ? 1 : 0);
    // (grazing, the neck right down and the head turned back up from it, the muzzle in the grass)
    const neckPitch = mix(2.05, -0.1, up) + wb * moving * 0.55;
    const headPitch = mix(-0.79, 0.05, up) + nibble - wb * moving * 0.25;
    const neck = about(fore, NECK0, mm(Ry(look * 0.6), Rx(neckPitch)));
    const head = about(neck, HEAD0, mm(Ry(look * 0.4), Rx(headPitch)));
    // ears: flick now and then; forward when it looks at you
    for (let e = 0; e < 2; e++) {
      const tw = Math.sin(s.t * 0.7 + e * 2.1) > 0.92 ? Math.sin(s.t * 20 + e) * 0.4 : 0;
      s.ear[e] += (tw + clamp(d.headTurn, 0, 1) * 0.2 - s.ear[e]) * (1 - Math.exp(-dt * 12));
    }
    const ears = [0, 1].map((e) => about(head, EAR0[e], mm(Rz((e ? -1 : 1) * s.ear[e] * 0.5), Rx(-s.ear[e]))));
    // the tail: up, flagging, in the bound; a twitch now and then
    const twitch = Math.sin(s.t * 0.5) > 0.9 ? Math.sin(s.t * 18) * 0.25 : 0;
    s.tail += ((wb * moving > 0.3 ? 1.4 : 0) + twitch - s.tail) * (1 - Math.exp(-dt * 8));
    const tail = about(hind, TAIL0, Rx(s.tail));
    const bones: M4[] = [hind, fore, neck, head, ears[0], ears[1], tail];
    // the legs: each hoof's place, then its bones solved to reach it
    const right = apply(Ry(d.heading), [1, 0, 0]);
    const ahead = apply(Ry(d.heading), [0, 0, 1]);
    const upW: V3 = [0, 1, 0];
    LEGS.forEach((l, i) => {
      const par = l.body ? fore : hind;
      const hipW = apply(par, l.hip);
      // where the hoof goes, along the way (f) and up (y), for each gait, blended
      const target = (g: Gait) => {
        const p = (ph - g.off[i] + 1) % 1;
        const half = (g.stride * g.duty) / 2;
        if (p < g.duty) return { f: half - (p / g.duty) * 2 * half, y: 0, fold: 0 };
        const q = (p - g.duty) / (1 - g.duty);
        const sw = Math.sin(Math.PI * q);
        return { f: -half + q * 2 * half, y: g.lift * sw, fold: (l.front ? g.fold[0] : g.fold[1]) * sw };
      };
      const tw = target(WALK), tt = target(TROT), tb = target(BOUND);
      let f = (tw.f * ww + tt.f * wt + tb.f * wb) * moving;
      let y = (tw.y * ww + tt.y * wt + tb.y * wb) * moving;
      let fold = (tw.fold * ww + tt.fold * wt + tb.fold * wb) * moving;
      // (standing: the fore hooves a little forward of the shoulder, the hind under the hip)
      f += l.front ? 0.04 : -0.02;
      // lying up: folded under the body — the forelegs tucked back, the hind drawn forward
      f = mix(f, l.front ? -0.3 : 0.22, bed);
      y = mix(y, 0.0, bed);
      fold = mix(fold, l.front ? 1.5 : -1.45, bed);
      const footBase: V3 = [hipW[0], ground, hipW[2]];
      const hoof = add(add(footBase, mul(ahead, f * k)), mul(upW, y * k));
      // the cannon: up from the hoof, tilted as the leg folds — in the swing the hoof trails
      // behind its knee (fore) or hock (hind); lying up, the fore cannon along the ground ahead of
      // its hoof, the hind behind
      const tilt = fold * (l.front || bed > 0.5 ? 1 : 0.6);
      const cannon = norm(add(mul(upW, Math.cos(tilt)), mul(ahead, Math.sin(tilt))));
      const j2 = add(hoof, mul(cannon, l.L[2] * k));
      // two bones from the hip to the top of the cannon, bent the leg's way
      const L1 = l.L[0] * k, L2 = l.L[1] * k;
      const toJ = sub(j2, hipW);
      let dd = len(toJ);
      const dir = norm(toJ);
      dd = clamp(dd, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-4);
      const a = Math.acos(clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1));
      // (the bend in the plane of the leg's way: ahead × down)
      const bendAxis = norm(cross(dir, right));
      const j1 = add(hipW, mul(add(mul(dir, Math.cos(a)), mul(bendAxis, Math.sin(a) * l.bend)), L1));
      const J = restJoints(l);
      const pts = [hipW, j1, add(hipW, mul(dir, dd)), hoof];
      for (let b = 0; b < 3; b++) {
        const yv = norm(sub(pts[b], pts[b + 1])); // (the bone's +y: back up toward its joint)
        const xv = norm(sub(right, mul(yv, dot(right, yv))));
        const zv = cross(xv, yv);
        bones.push(frame(mul(xv, k), mul(yv, k), mul(zv, k), pts[b], J[b]));
      }
    });
    for (let b = 0; b < BONES; b++) out.set(bones[b], b * 16);
    return out;
  }
}
const scaleM = (k: number): M4 => { const m = ident(); m[0] = m[5] = m[10] = k; return m; };
