// Locomotion from motion capture (the CMU Graphics Lab Motion Capture Database, mocap.cs.cmu.edu: "the motion capture
// data may be copied, modified, or redistributed without permission"): fetched, read, retargeted onto Roof Jumps' rig as
// its own pose angles (rig.ts), one clean cycle kept for each gait, and written as client/roofjumps/mocap-clips.ts.
//
// Retargeting: the rig is driven by angles, not positions, so each frame of a capture is read as those angles, in the
// frames the rig uses (x the body's left, y up, z forward): the pelvis's turn off the line of travel (hips) and its pitch
// (lean); the chest's pitch past that, about its own mean (spine) and its turn against the pelvis (twist); each thigh's swing forward (hip)
// and out (splay), each knee's bend; each upper arm's swing forward (shoulder) and out (spread), each elbow's bend. The
// feet, the hips' height and everything touching the world stay the rig's own (its footfalls, its IK).
//
// A cycle: from one left footfall to the next, in the steadiest stretch of the take, resampled to 48 even steps and its
// ends crossfaded so it loops; with where in it each foot comes down and lifts (so the rig can stretch the stance to its
// own), its pace, and its stride.
//
//   node cells/lab/devtools/mocap/cmu.mjs            (fetches what it needs into devtools/out/mocap/, then converts)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readAsf, readAmc, pose } from './amc.mjs';
const OUT = new URL('../out/mocap/', import.meta.url).pathname, CLIPS = new URL('../../client/roofjumps/mocap-clips.ts', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** the gaits kept, each from one take (subject, take): a walk, a jog and a run */
const GAITS = [
  { name: 'walk', subject: 16, take: '16_15', says: 'walk' },
  { name: 'jog', subject: 16, take: '16_36', says: 'run/jog' },
  { name: 'run', subject: 143, take: '143_01', says: 'Run' },
];
async function fetchTo(url, file) {
  if (existsSync(file)) return;
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
for (const g of GAITS) {
  await fetchTo(`http://mocap.cs.cmu.edu/subjects/${g.subject}/${g.subject}.asf`, `${OUT}${g.subject}.asf`);
  await fetchTo(`http://mocap.cs.cmu.edu/subjects/${g.subject}/${g.take}.amc`, `${OUT}${g.take}.amc`);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
/** a vector in a frame (x, y, z axes) */
const inF = (v, F) => [dot(v, F.x), dot(v, F.y), dot(v, F.z)];
/** a frame turned about its y by `yaw` then pitched forward about its x by `pitch` (the rig's rotY, then rotX) */
const turn = (F, yaw, pitch) => {
  const c = Math.cos(yaw), s = Math.sin(yaw), z1 = F.z.map((v, i) => v * c + F.x[i] * s), x1 = F.x.map((v, i) => v * c - F.z[i] * s);
  const cp = Math.cos(pitch), sp = Math.sin(pitch), y2 = F.y.map((v, i) => v * cp + z1[i] * sp), z2 = z1.map((v, i) => v * cp - F.y[i] * sp);
  return { x: x1, y: y2, z: z2 };
};

function convert(g) {
  const sk = readAsf(readFileSync(`${OUT}${g.subject}.asf`, 'utf8')), P = readAmc(readFileSync(`${OUT}${g.take}.amc`, 'utf8')).map((fr) => pose(sk, fr)), n = P.length, DT = 1 / 120;
  // (footfalls: the ball or the heel near the ground and nearly still)
  const gB = Math.min(...P.flatMap((p) => [p.lfoot[1], p.rfoot[1]])), gA = Math.min(...P.flatMap((p) => [p.ltibia[1], p.rtibia[1]]));
  const down = (i, s) => { const b = P[i][s + 'foot'], a = P[i][s + 'tibia'], q = P[Math.max(0, i - 1)]; const vb = Math.hypot(b[0] - q[s + 'foot'][0], b[2] - q[s + 'foot'][2]) / DT, va = Math.hypot(a[0] - q[s + 'tibia'][0], a[2] - q[s + 'tibia'][2]) / DT; return (b[1] - gB < 0.035 && vb < 0.8) || (a[1] - gA < 0.03 && va < 0.8); };
  const falls = (s) => { const o = []; for (let i = 3; i < n; i++) if (down(i, s) && !down(i - 1, s) && !down(i - 2, s) && !down(i - 3, s)) o.push(i); return o; };
  const lifts = (s) => { const o = []; for (let i = 3; i < n; i++) if (!down(i, s) && down(i - 1, s) && down(i - 2, s)) o.push(i); return o; };
  const L = falls('l'), R = falls('r'), Ll = lifts('l'), Rl = lifts('r');
  if (L.length < 2) throw new Error(`${g.take}: fewer than two left footfalls`);
  // (the steadiest cycle: of those between left footfalls, the one whose pace is nearest the take's median)
  const pace = (a, b) => Math.hypot(P[b].root[0] - P[a].root[0], P[b].root[2] - P[a].root[2]) / ((b - a) * DT);
  const cyc = L.slice(1).map((b, i) => ({ a: L[i], b, v: pace(L[i], b) })), med = [...cyc].sort((p, q) => p.v - q.v)[Math.floor(cyc.length / 2)].v;
  const { a, b } = cyc.sort((p, q) => Math.abs(p.v - med) - Math.abs(q.v - med))[0];
  const T = (b - a) * DT, stride = Math.hypot(P[b].root[0] - P[a].root[0], P[b].root[2] - P[a].root[2]), F0 = unit([P[b].root[0] - P[a].root[0], 0, P[b].root[2] - P[a].root[2]]);
  const at = (list) => { const i = list.find((k) => k > a && k < b) ?? list.find((k) => k > a); return i === undefined ? NaN : ((i - a) / (b - a)) % 1; };
  const marks = { lOff: at(Ll), rOn: at(R), rOff: at(Rl) };
  // (the line of travel, the base frame: z along it, y up, x to its left)
  const B = { z: F0, y: [0, 1, 0], x: cross([0, 1, 0], F0) };
  const frame = (p) => {
    // (the pelvis: its left from hip to hip; its turn off the line; its pitch, by the trunk, low back to chest)
    const left = unit([p.lhipjoint[0] - p.rhipjoint[0], 0, p.lhipjoint[2] - p.rhipjoint[2]]), pf = cross(left, [0, 1, 0]);
    const hips = Math.atan2(dot(pf, B.x), dot(pf, B.z));
    const trunk = sub(p.lowerneck, p.root), Bh = turn(B, hips, 0), tl = inF(trunk, Bh), lean = Math.atan2(tl[2], tl[1]);
    const Pf = turn(B, hips, lean);
    // (the chest: the upper trunk's pitch past the lower's, and the shoulders' turn against the hips)
    const up = inF(sub(p.lowerneck, p.thorax), Pf), lowT = inF(sub(p.thorax, p.root), Pf), spine = Math.atan2(up[2], up[1]) - Math.atan2(lowT[2], lowT[1]);
    const sl = unit([p.lclavicle[0] - p.rclavicle[0], 0, p.lclavicle[2] - p.rclavicle[2]]), sf = cross(sl, [0, 1, 0]), twist = Math.atan2(dot(sf, Pf.x), dot(sf, Pf.z));
    const S = turn(Pf, twist, 0); // (the arms against the trunk turned with the shoulders: the chest's own curve is the person's, not the rig's)
    const o = { hips, lean, spine, twist };
    for (const [s, side] of [['l', 1], ['r', -1]]) {
      const t = inF(sub(p[s + 'femur'], p[s + 'hipjoint']), Pf), sh = sub(p[s + 'tibia'], p[s + 'femur']);
      o['hip' + s.toUpperCase()] = Math.atan2(t[2], -t[1]);
      o['splay' + s.toUpperCase()] = Math.atan2(t[0] * side, Math.hypot(t[1], t[2]));
      o['knee' + s.toUpperCase()] = ang(sub(p[s + 'femur'], p[s + 'hipjoint']), sh);
      const u = inF(sub(p[s + 'humerus'], p[s + 'clavicle']), S), fo = sub(p[s + 'radius'], p[s + 'humerus']);
      o['sh' + s.toUpperCase()] = Math.atan2(u[2], -u[1]);
      o['spread' + s.toUpperCase()] = Math.atan2(u[0] * side, Math.hypot(u[1], u[2]));
      o['el' + s.toUpperCase()] = ang(sub(p[s + 'humerus'], p[s + 'clavicle']), fo);
    }
    return o;
  };
  const raw = []; for (let i = a; i <= b; i++) raw.push(frame(P[i]));
  const keys = Object.keys(raw[0]), N = 48, frames = [];
  for (let k = 0; k < N; k++) {
    const x = (k / N) * (raw.length - 1), i = Math.floor(x), f = x - i, A = raw[i], Bf = raw[Math.min(raw.length - 1, i + 1)];
    frames.push(keys.map((kk) => A[kk] + (Bf[kk] - A[kk]) * f));
  }
  // (the chest's pitch past the trunk's as its movement about the person's own carriage (their back's curve isn't the rig's):
  // the cycle's mean taken out, the rig keeping its own)
  { const j = keys.indexOf('spine'), m = frames.reduce((a, f) => a + f[j], 0) / N; for (const f of frames) f[j] -= m; for (const r of raw) r.spine -= m; }
  // (looped: the last fifth eased toward the first frame, so the cycle has no seam)
  const last = raw[raw.length - 1], first = raw[0], seam = keys.map((kk) => first[kk] - last[kk]);
  for (let k = 0; k < N; k++) { const w = Math.max(0, (k / N - 0.8) / 0.2); frames[k] = frames[k].map((v, j) => v + seam[j] * w * w * (3 - 2 * w)); }
  // (the swing foot's way through the air, left foot, lift to footfall: its ankle's height off the ground (as a share of the
  // leg's length, hip to ankle) and how far along from where it left to where it lands, at 16 even steps of the swing; so
  // the rig's stepping foot, which it carries itself at a walk, takes a person's path, not an arc)
  const legLen = sk.bones.lfemur.len + sk.bones.ltibia.len, i0 = Math.round(a + marks.lOff * (b - a)), i1 = b;
  const ank = (i) => P[i].ltibia, along0 = dot(ank(i0), F0), along1 = dot(ank(i1), F0), rest = Math.min(ank(i0)[1], ank(i1)[1]);
  const swing = { lift: [], along: [] };
  for (let k = 0; k <= 16; k++) { const x = i0 + (k / 16) * (i1 - i0), i = Math.min(i1 - 1, Math.floor(x)), f = x - i, lerp = (u, v) => u + (v - u) * f;
    const q = ank(i).map((v, j) => lerp(v, ank(i + 1)[j]));
    swing.lift.push(+(Math.max(0, q[1] - rest) / legLen).toFixed(4)); swing.along.push(+((dot(q, F0) - along0) / (along1 - along0 || 1)).toFixed(4)); }
  return { name: g.name, from: `CMU ${g.take} (${g.says})`, speed: stride / T, stride, seconds: T, marks, swing, keys, frames: frames.map((fr) => fr.map((v) => +v.toFixed(4))) };
}

const clips = GAITS.map(convert);
for (const c of clips) console.log(`${c.name} swing lift ${c.swing.lift.map((v) => v.toFixed(2)).join(' ')}\n      along ${c.swing.along.map((v) => v.toFixed(2)).join(' ')}`);
for (const c of clips) console.log(`${c.name.padEnd(5)} ${c.from.padEnd(22)} ${c.speed.toFixed(2)} m/s, stride ${c.stride.toFixed(2)} m in ${c.seconds.toFixed(2)} s; left off at ${c.marks.lOff.toFixed(2)}, right down ${c.marks.rOn.toFixed(2)}, off ${c.marks.rOff.toFixed(2)}; hip L ${(Math.min(...c.frames.map((f) => f[c.keys.indexOf('hipL')])) * 57.3).toFixed(0)}…${(Math.max(...c.frames.map((f) => f[c.keys.indexOf('hipL')])) * 57.3).toFixed(0)}°, knee L to ${(Math.max(...c.frames.map((f) => f[c.keys.indexOf('kneeL')])) * 57.3).toFixed(0)}°, lean ${(c.frames.reduce((s, f) => s + f[c.keys.indexOf('lean')], 0) / c.frames.length * 57.3).toFixed(0)}°`);
writeFileSync(CLIPS, `/**
 * Locomotion cycles from motion capture, retargeted onto the rig's pose angles (devtools/mocap/cmu.mjs writes this file;
 * don't edit it by hand). From the CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), whose data "may be copied,
 * modified, or redistributed without permission". Each: one cycle from a left footfall to the next, 48 even steps, looped;
 * where in it the left foot lifts and the right comes down and lifts; the swing foot's path (its ankle's height, as a share
 * of the leg, and how far along, through the swing); its pace (m/s), stride (m) and length (s); the
 * angles, in radians, in \`keys\`' order.
 */
export interface Clip { name: string; from: string; speed: number; stride: number; seconds: number; marks: { lOff: number; rOn: number; rOff: number }; swing: { lift: number[]; along: number[] }; keys: string[]; frames: number[][] }
export const CLIPS: Clip[] = ${JSON.stringify(clips)};
`);
console.log(`→ ${CLIPS}`);
