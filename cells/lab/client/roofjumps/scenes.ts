/**
 * Scenes: short authored courses, each with a scripted hand on the stick, run the same every time, to film and to judge.
 * Not a showcase of what the runner does: each asks a question about what it should do, some of which it can't yet
 * (shimmy along a ledge it hangs from, kick off one wall to reach a higher lip, choose a vault by the angle it comes at,
 * teeter at a lip it stopped short of). Each scene says what it exercises, what to watch, and what the athlete *should*
 * do, as checks on the run; the checks that fail are the critique. `?scene=<key>` films one on the page;
 * `devtools/roofjumps-scenes.mjs` runs them all, checks them, films them and writes the report.
 *
 * Courses run along +z from a start facing +z (the figure's left is +x). Heights in metres; a storey is 3.
 */
import { City, TAG } from './city';
import type { Box, Course } from './city';
import { Runner } from './runner';
import type { Input } from './runner';
import { Rig } from './rig';
import { point } from './m4';

export interface Frame {
  t: number; x: number; y: number; z: number; vx: number; vz: number; vy: number; speed: number; state: string; move: string;
  fl: boolean; fr: boolean; save: string; hang: number;
  /** the drawn body: the hips jumped this frame; a held foot's ball moved (m); a held foot out of the leg's reach */
  jump: boolean; slid: number; stretched: boolean; pelvisY: number;
}
export interface Run { frames: Frame[]; runner: Runner; ups: { t: number; foot: boolean; move: string; by: string }[]; lands: { t: number; v: number; from: string; save: string }[]; moves: { t: number; move: string }[] }
export interface Should { says: string; check: (r: Run) => { ok: boolean; saw: string } }
export interface Scene {
  key: string; title: string;
  /** what it exercises, and the question it asks */
  asks: string;
  /** what to look at when it's filmed */
  watch: string;
  /** what we suspect it can't or doesn't do, that it should (empty: a check on what it should already do) */
  gap?: string;
  course: Course; seconds: number;
  input: (t: number, r: Runner, mem: Record<string, number>) => Input;
  should: Should[];
}

const B = (x0: number, x1: number, z0: number, z1: number, y1: number, tag: number = TAG.BUILDING, y0 = 0): Box => ({ x0, x1, z0, z1, y0, y1, tag: tag as Box['tag'] });
const go = (deg: number, mag = 1): Input => { const a = (deg * Math.PI) / 180; return { x: Math.sin(a) * mag, z: Math.cos(a) * mag, jump: false }; };
const none: Input = { x: 0, z: 0, jump: false };
const RIGHT = -90, LEFT = 90;

// (helpers for checks)
const ok = (cond: boolean, saw: string) => ({ ok: cond, saw });
const after = (r: Run, t: number) => r.frames.filter((f) => f.t >= t);
const first = (r: Run, pred: (f: Frame) => boolean) => r.frames.find(pred);
const count = (r: Run, m: string) => r.moves.filter((x) => x.move === m).length;
const seq = (r: Run) => r.moves.map((m) => m.move).filter((m, i, a) => m !== 'run' && m !== a[i - 1]).join(' › ');
const pops = (r: Run) => r.frames.filter((f) => f.jump).length;
const plantedSlide = (r: Run) => r.frames.reduce((s, f) => s + f.slid, 0);
/** cm a second a planted foot moves, over the time a foot is planted */
const slideRate = (r: Run) => (100 * plantedSlide(r)) / Math.max(1 / 120, r.frames.filter((f) => f.fl || f.fr).length / 120);
const commonShoulds: Should[] = [
  { says: 'the drawn body never jumps (hips no further in a frame than its motion and a step)', check: (r) => ok(pops(r) === 0, `${pops(r)} frames`) },
  { says: 'every takeoff off the ground has a foot under it', check: (r) => { const n = r.ups.filter((u) => !u.foot).length; return ok(n === 0, `${r.ups.length - n}/${r.ups.length} with a foot down`); } },
  { says: 'a planted foot stays put (under 3 cm a second of planted time)', check: (r) => ok(slideRate(r) < 3, `${slideRate(r).toFixed(1)} cm/s (${(plantedSlide(r) * 100).toFixed(0)} cm in all)`) },
];

/** two gaps of 3 m between three roofs of a height, the line straight down +z */
const twoGaps = (): Course => ({ boxes: [B(24, 40, 2, 18, 12), B(24, 40, 21, 31, 12), B(24, 40, 34, 52, 12)], start: { x: 32, z: 4 }, alone: true });

export const SCENES: Scene[] = [
  {
    key: 'transfer-clean', title: 'A clean transfer, two gaps',
    asks: 'The baseline: a held line across two ordinary gaps. Does each takeoff come off a foot planted short of the lip, the strides opening into it, the first landing leaving it set for the second?',
    watch: 'The last stride before each lip; which foot takes off; whether the first landing runs straight into the second run-up.',
    course: twoGaps(), seconds: 4.5, input: (t, r) => (r.z > 40 && r.state === 'ground' ? none : go(0)),
    should: [...commonShoulds,
      { says: 'both gaps crossed, ending on the third roof', check: (r) => ok(r.runner.z > 34 && r.runner.y > 11, `ended at z ${r.runner.z.toFixed(1)}, y ${r.runner.y.toFixed(1)}`) },
      { says: 'no save needed: the landings are clean', check: (r) => ok(r.lands.every((l) => !l.save), r.lands.map((l) => l.save || 'clean').join(', ')) },
    ],
  },
  {
    key: 'late-change', title: 'A late change of mind',
    asks: 'The same two gaps, but the stick swings 35° right in the last stride before the first lip. The athlete should still make it, land wide (the hips carrying sideways, the catching foot out wide), and pay for it on the way into the second gap: position, not just a stumble that is taken back at once.',
    watch: 'The first landing: the wide foot, the outside arm. Then the second run-up: is the line into gap two worse (angled, an extra step, a shorter stride)?',
    gap: 'A save restores the original options quickly; the cost should show two steps later.',
    course: twoGaps(), seconds: 5,
    input: (t, r, m) => { if (!m.turned && r.z > 15.5) m.turned = t; if (m.turned && !m.back && r.state === 'ground' && r.z > 21) m.back = t + 0.25; if (r.z > 40 && r.state === 'ground') return none; return m.back && t > m.back ? go(0) : m.turned ? go(-35) : go(0); },
    should: [...commonShoulds,
      { says: 'the first landing is a wide save', check: (r) => ok(r.lands[0]?.save === 'wide', `first landing: ${r.lands[0]?.save || 'clean'}`) },
      { says: 'it costs the line into gap two: the second takeoff comes later, or slower, than in the clean run', check: (r) => { const t2 = r.ups[1]?.t ?? 99; return ok(t2 > 2.55, `second takeoff at ${t2.toFixed(2)} s (clean ≈ 2.4 s)`); } },
    ],
  },
  {
    key: 'short-catch', title: 'Underpowered, caught short',
    asks: 'A 4.2 m gap to a roof 2.5 m higher, approached at a light press (0.6: just enough to commit to the jump). The athlete shouldn\'t make it clean; the hand should catch the lip, the body swing under, and then it hangs, until the player chooses: left alone 1.5 s it stays; pressed in, it pulls up.',
    watch: 'The near hand first; the swing under; a still hang (feet set on the wall, arms straight); then the pull-up when pressed.',
    course: { boxes: [B(24, 40, 2, 18, 12), B(24, 40, 22.2, 40, 14.5)], start: { x: 32, z: 4 }, alone: true }, seconds: 5,
    input: (t, r, m) => { if (!m.hung && r.move === 'hang') m.hung = t; if (r.y > 14.4 && r.state === 'ground') return none; return !m.hung ? go(0, 0.6) : t < m.hung + 1.5 ? none : go(0); },
    should: [...commonShoulds,
      { says: 'the lip is caught', check: (r) => ok(count(r, 'hang') > 0, seq(r)) },
      { says: 'left alone, it stays hanging', check: (r) => { const h = first(r, (f) => f.move === 'hang'); if (!h) return ok(false, 'never hung'); const still = r.frames.filter((f) => f.t > h.t + 0.4 && f.t < h.t + 1.4); return ok(still.length > 0 && still.every((f) => f.move === 'hang'), still.every((f) => f.move === 'hang') ? 'held' : 'let go'); } },
      { says: 'pressed in, it pulls up onto the higher roof', check: (r) => ok(r.runner.y > 14.4 && r.runner.state === 'ground', `ended ${r.runner.state} at y ${r.runner.y.toFixed(1)}`) },
    ],
  },
  {
    key: 'hang-intents', title: 'Hanging: stay, pass along, go up',
    asks: 'Caught as above; then the stick asks three things in turn: nothing (stay), along the wall (shimmy along the lip, hand over hand), then into it (up). Can the player get, and recognise, each?',
    watch: 'Whether steering along the wall moves the hands along the lip (it should), or lets go.',
    gap: 'There is no shimmy: steering along the wall while hanging lets go after a beat.',
    course: { boxes: [B(24, 40, 2, 18, 12), B(16, 48, 22.2, 40, 14.5)], start: { x: 32, z: 4 }, alone: true }, seconds: 6,
    input: (t, r, m) => { if (!m.hung && r.move === 'hang') { m.hung = t; m.x0 = r.x; } if (r.y > 14.4 && r.state === 'ground') return none; if (!m.hung) return go(0, 0.6); const s = t - m.hung; return s < 1 ? none : s < 2.4 ? go(RIGHT) : go(0); },
    should: [...commonShoulds,
      { says: 'steered along the wall, it moves along the lip still hanging (a shimmy), not let go', check: (r) => { const h = first(r, (f) => f.move === 'hang'); if (!h) return ok(false, 'never hung'); const along = r.frames.filter((f) => f.t > h.t + 1.1 && f.t < h.t + 2.3); const held = along.every((f) => f.move === 'hang'); const moved = along.length ? Math.abs(along[along.length - 1].x - along[0].x) : 0; return ok(held && moved > 0.4, `${held ? 'held' : 'let go'}, moved ${moved.toFixed(2)} m along`); } },
      { says: 'then pressed in, it pulls up', check: (r) => ok(r.runner.y > 14.4, `ended at y ${r.runner.y.toFixed(1)}`) },
    ],
  },
  {
    key: 'edge-stop', title: 'Stopping at the lip',
    asks: 'A run at a roof\'s edge, the stick let go 8 m short. It should come to a stand before the lip, and if it ends close, check its balance there (a teeter, arms out) rather than just standing.',
    watch: 'The deceleration (steps shortening, weight back); the stop; any balance check near the edge.',
    gap: 'No teeter or balance check at an edge it stopped close to.',
    course: { boxes: [B(24, 40, 2, 30, 12)], start: { x: 32, z: 4 }, alone: true }, seconds: 4,
    input: (t, r) => (r.z < 22 ? go(0) : none),
    should: [...commonShoulds,
      { says: 'it stops on the roof, not off the edge', check: (r) => ok(r.runner.y > 11.9 && r.runner.z < 30, `ended at z ${r.runner.z.toFixed(2)}, y ${r.runner.y.toFixed(1)}`) },
      { says: 'it ends standing on both feet', check: (r) => { const f = r.frames[r.frames.length - 1]; return ok(f.fl && f.fr && f.speed < 0.1, `${f.fl && f.fr ? 'both feet' : 'one foot'}, ${f.speed.toFixed(2)} m/s`); } },
      { says: 'stopped within a metre of the lip, it shows a balance check (a teeter)', check: (r) => { const near = 30 - r.runner.z < 1; return ok(!near, near ? `stopped ${(30 - r.runner.z).toFixed(2)} m from the lip, no teeter` : `stopped ${(30 - r.runner.z).toFixed(2)} m short`); } },
    ],
  },
  {
    key: 'sharp-turns', title: 'Sharp turns at pace',
    asks: 'A big roof: a run, a hard 90° right, then a full reversal. The turns should be made on the feet (the outside foot planted, the body leaning in, a plant and pivot for the reversal), not skated.',
    watch: 'The plant foot in each turn; the lean; the reversal (a braking plant, a pivot, a push the other way).',
    course: { boxes: [B(4, 60, 4, 60, 9)], start: { x: 50, z: 8 }, alone: true }, seconds: 5,
    input: (t) => (t < 1.5 ? go(0) : t < 3 ? go(RIGHT) : t < 4.4 ? go(LEFT) : none),
    should: [...commonShoulds,
      { says: 'the reversal takes under 0.8 s from asking to running the other way', check: (r) => { const back = r.frames.find((x) => x.t > 3 && x.vx > 3); return ok(!!back && back.t - 3 < 0.8, back ? `${(back.t - 3).toFixed(2)} s` : 'never'); } },
    ],
  },
  {
    key: 'drop-rebound', title: 'Down a storey and straight on',
    asks: 'Off a ledge down a storey, landing 2 m from the next gap. The landing should sink by the impact and the next jump go off the landing foot (a rebound), not stop or stutter.',
    watch: 'The landing\'s depth; one foot down; the rebound into the next gap.',
    course: { boxes: [B(24, 40, 2, 16, 15), B(24, 40, 16, 19.5, 12), B(24, 40, 22.5, 40, 12)], start: { x: 32, z: 4 }, alone: true }, seconds: 4,
    input: (t, r) => (r.z > 28 && r.state === 'ground' ? none : go(0)),
    should: [...commonShoulds,
      { says: 'it goes on into the next gap within half a second of landing', check: (r) => { const l = r.lands[0], u = r.ups.find((x) => l && x.t > l.t); return ok(!!l && !!u && u.t - l.t < 0.5, l && u ? `${(u.t - l.t).toFixed(2)} s on the ground` : seq(r)); } },
      { says: 'ends across the gap', check: (r) => ok(r.runner.z > 22.5 && r.runner.y > 11.9, `ended z ${r.runner.z.toFixed(1)}`) },
    ],
  },
  {
    key: 'precision-rail', title: 'A precision landing on a wall top',
    asks: 'A gap onto a wall a metre wide running the way it\'s going, then on along it and across to the next roof. The landing should stick and balance; the run along it short-stepped, arms out.',
    watch: 'The stick on landing; balance along the wall; the takeoff off its end.',
    course: { boxes: [B(24, 40, 2, 16, 12), B(31.5, 32.5, 19, 31, 12, TAG.BEAM), B(24, 40, 34, 50, 12)], start: { x: 32, z: 4 }, alone: true }, seconds: 5,
    input: (t, r) => (r.z > 38 && r.state === 'ground' ? none : go(0)),
    should: [...commonShoulds,
      { says: 'it lands on the wall top and stays on it', check: (r) => { const on = r.frames.filter((f) => f.z > 20 && f.z < 30 && f.state === 'ground'); return ok(on.length > 30 && on.every((f) => f.y > 11.9), `${on.length} frames on it`); } },
      { says: 'and crosses to the far roof', check: (r) => ok(r.runner.z > 34 && r.runner.y > 11.9, `ended z ${r.runner.z.toFixed(1)}, y ${r.runner.y.toFixed(1)}`) },
    ],
  },
  {
    key: 'stair-ascent', title: 'Up a face, storey by storey',
    asks: 'The reference\'s best passage: from the street, a face with a sill at every storey. The same action repeated (a reach, a hang, a load, a spring) should gain a storey each time with a rhythm, and end: over the top, a crouch, a walk out.',
    watch: 'The rhythm of the repeated storeys; the gather before each spring; the ending at the top.',
    course: { boxes: [B(20, 44, 10, 30, 12)], holds: [3, 6, 9].map((y) => ({ kind: 'sill' as const, ax: 26, ay: y, az: 10, bx: 38, by: y, bz: 10, nx: 0, nz: -1 })), start: { x: 32, z: 4 }, alone: true }, seconds: 7,
    input: () => go(0),
    should: [...commonShoulds,
      { says: 'it reaches the roof (12 m)', check: (r) => ok(r.runner.y > 11.9, `ended at y ${r.runner.y.toFixed(1)}; ${seq(r)}`) },
      { says: 'by repeated hangs, a storey each', check: (r) => ok(count(r, 'hang') >= 3, `${count(r, 'hang')} hangs`) },
    ],
  },
  {
    key: 'tic-tac', title: 'Off one wall to a higher lip',
    asks: 'A lip 5.7 m up, just beyond a straight jump\'s reach, in a corner with a taller wall alongside. A traceur kicks off the side wall (a tic-tac) to gain the height and catch it.',
    watch: 'Whether the side wall is used to go up toward the lip, or just run along.',
    gap: 'No tic-tac: a wall is only run along, run up, or kicked away from.',
    course: { boxes: [B(16, 48, 16, 34, 5.7), B(36, 40, 2, 16, 10)], start: { x: 33, z: 4 }, alone: true }, seconds: 5,
    input: () => go(12),
    should: [...commonShoulds,
      { says: 'it gets onto the 5.7 m roof', check: (r) => ok(r.runner.y > 5.6, `ended at y ${r.runner.y.toFixed(1)}; ${seq(r)}`) },
      { says: 'by kicking off the side wall', check: (r) => ok(count(r, 'kick') > 0 && r.runner.y > 5.6, seq(r)) },
    ],
  },
  {
    key: 'underbar', title: 'Under a bar across a gap',
    asks: 'A bar across a 2.4 m gap, 1.3 m above the roofs. Under it feet first, hands on it: is there room for the hips and the trailing foot, and does the body actually pass beneath it?',
    watch: 'The hands on the bar; the hips and feet passing under it; the exit.',
    gap: 'The underbar is chosen from height samples; whether the body clears beneath the bar isn\'t checked.',
    course: { boxes: [B(24, 40, 2, 18, 12), B(24, 40, 20.4, 36, 12)], bars: [{ x0: 26, x1: 38, z0: 19.15, z1: 19.25, y: 13.3 }], start: { x: 32, z: 4 }, alone: true }, seconds: 4,
    input: (t, r) => (r.z > 26 && r.state === 'ground' ? none : go(0)),
    should: [...commonShoulds,
      { says: 'it goes under the bar', check: (r) => ok(count(r, 'underbar') > 0, seq(r)) },
      { says: 'its hips stay below the bar while under it', check: (r) => { const under = r.frames.filter((f) => Math.abs(f.z - 19.2) < 0.3); const most = Math.max(...under.map((f) => f.pelvisY), -1); return ok(under.length > 0 && most < 13.1, `hips up to ${most.toFixed(2)} m (bar 13.3)`); } },
    ],
  },
  {
    key: 'vault-angles', title: 'Vaults, by the angle they\'re met at',
    asks: 'Three waist-high boxes met straight on, at 30°, and at 60°. The vault should be chosen by the approach: straight on, a speed or dash vault; at an angle, a side (lazy) vault off the near hand.',
    watch: 'Which hand goes down, and how the legs pass, at each angle.',
    gap: 'The vault is chosen by alternation (two hands every other one, a spin every third, a cartwheel), not by the angle it\'s met at.',
    course: { boxes: [B(4, 64, 2, 60, 9), B(28, 36, 12, 12.8, 10, TAG.UNIT, 9), B(33, 41, 24, 24.8, 10, TAG.UNIT, 9), B(46, 56, 34, 34.8, 10, TAG.UNIT, 9)], start: { x: 32, z: 4 }, alone: true }, seconds: 6,
    input: (t, r) => (r.z > 38 ? none : r.z < 15 ? go(0) : r.z < 27 ? go(30) : go(60)),
    should: [...commonShoulds,
      { says: 'all three boxes vaulted', check: (r) => ok(count(r, 'vault') >= 3, `${count(r, 'vault')} vaults; ${seq(r)}`) },
    ],
  },
  {
    key: 'street-deadend', title: 'From the street, out of a dead end',
    asks: 'Started in a 2.2 m alley that ends in a wall. Held into the end: it should go up wall to wall and out onto a roof, not stand pressing.',
    watch: 'The way up (a wall run into a chimney, or one from a stand); the top-out.',
    course: { boxes: [B(20, 30, 0, 40, 9), B(32.2, 44, 0, 40, 9), B(20, 44, 40, 48, 12)], start: { x: 31.1, z: 4 }, alone: true }, seconds: 7,
    input: () => go(0),
    should: [...commonShoulds,
      { says: 'it gets up onto a roof', check: (r) => ok(r.runner.y > 8.9, `ended at y ${r.runner.y.toFixed(1)}; ${seq(r)}`) },
    ],
  },
  {
    key: 'mantle-box', title: 'Up onto a chest-high box',
    asks: 'Walked up to a box 1.5 m high, then pressed into it. A body would mantle (hands on top, a push, a knee up) or a small cat-jump; not a full spring over the top, and not stuck.',
    watch: 'The hands on the top; the push and knee; ending stood on it.',
    gap: 'There is no mantle: it springs as for a wall, or bumps.',
    course: { boxes: [B(16, 48, 2, 40, 9), B(28, 36, 12, 18, 10.5, TAG.HUT, 9)], start: { x: 32, z: 4 }, alone: true }, seconds: 5,
    input: (t, r) => (r.z < 10.6 ? go(0, 0.4) : go(0)),
    should: [...commonShoulds,
      { says: 'it ends up on the box', check: (r) => ok(r.frames.some((f) => f.y > 10.4 && f.state === 'ground'), seq(r)) },
      { says: 'by a climb or mantle, not a full spring over it', check: (r) => { const m = r.moves.find((x) => x.t > 0.5 && x.move !== 'run'); return ok(!!m && (m.move === 'climb' || m.move === 'hang'), m ? `first move: ${m.move}` : 'none'); } },
    ],
  },
];

/** run a scene, the drawn body with it, and keep what the checks need */
export function runScene(s: Scene, seed = 1): Run {
  const city = new City(seed, false, s.course), r = new Runner(city), rig = new Rig(); rig.update(1, r);
  const DT = 1 / 120, mem: Record<string, number> = {}, frames: Frame[] = [], ups: Run['ups'] = [], lands: Run['lands'] = [], moves: Run['moves'] = [{ t: 0, move: r.move }];
  let prevPv: number[] | null = null; const prevBall: (number[] | null)[] = [null, null], prevFall: (number[] | null)[] = [null, null];
  for (let i = 0; i < s.seconds / DT; i++) {
    const t = i * DT, s0 = r.state, m0 = r.move, vy0 = r.vy, sp0 = r.speed, fl0 = r.reach.fl, fr0 = r.reach.fr; r.takeoffBy = '';
    r.step(DT, s.input(t, r, mem)); rig.update(DT, r);
    if (r.move !== m0) moves.push({ t, move: r.move });
    if (s0 === 'ground' && r.state === 'air' && r.vy > 0) ups.push({ t, foot: !!(fl0 || fr0), move: r.move, by: r.takeoffBy });
    if (s0 === 'air' && r.state === 'ground') lands.push({ t, v: -vy0, from: m0, save: r.saveKind ?? '' });
    const b = rig.bones(r), at = (n: string) => b.find((o) => o.name === n)!.m, pm = at('pelvis'), pv = [pm[12], pm[13], pm[14]];
    const jump = !!prevPv && Math.hypot(pv[0] - prevPv[0], pv[1] - prevPv[1], pv[2] - prevPv[2]) > Math.max(0.15, (Math.max(sp0, r.speed) + Math.abs(vy0) + Math.abs(r.vy)) * DT + 0.12);
    prevPv = pv;
    let slid = 0, stretched = false;
    for (const [k, s2, key] of [[0, 'L', 'fl'], [1, 'R', 'fr']] as const) {
      const now = r.reach[key], fm = at('foot' + s2), ball = [fm[12] + fm[8] * 0.13, fm[13], fm[14] + fm[10] * 0.13], sole = s2 === 'L' ? rig.soles.L : rig.soles.R;
      const same = !!now && !!prevFall[k] && now[0] === prevFall[k]![0] && now[2] === prevFall[k]![2];
      if (same && sole.w > 0.9 && !sole.lost && prevBall[k]) slid += Math.hypot(ball[0] - prevBall[k]![0], ball[2] - prevBall[k]![2]);
      if (now && sole.w > 0.9 && !sole.lost) { const hp = point(at('thigh' + s2), 0, 0, 0), on = rig.on; if (Math.hypot(now[0] + on[0] * 0.07 - hp[0], now[1] + on[1] * 0.07 - hp[1], now[2] + on[2] * 0.07 - hp[2]) > 0.9) stretched = true; }
      prevBall[k] = ball; prevFall[k] = now ? [...now] : null;
    }
    frames.push({ t, x: r.x, y: r.y, z: r.z, vx: r.vx, vz: r.vz, vy: r.vy, speed: r.speed, state: r.state, move: r.move, fl: !!r.reach.fl, fr: !!r.reach.fr, save: r.saveKind ?? '', hang: r.hangT, jump, slid, stretched, pelvisY: pv[1] });
  }
  return { frames, runner: r, ups, lands, moves };
}

/** a scene's checks, run */
export function judge(s: Scene, run: Run): { says: string; ok: boolean; saw: string }[] {
  return s.should.map((x) => { try { return { says: x.says, ...x.check(run) }; } catch (e) { return { says: x.says, ok: false, saw: `check failed: ${(e as Error).message}` }; } });
}

export const sceneByKey = (k: string | null) => SCENES.find((s) => s.key === k) ?? null;
/** the moves of a run, in order, the running between left out */
export const sequence = seq;
