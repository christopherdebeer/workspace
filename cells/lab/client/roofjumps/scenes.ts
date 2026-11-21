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
import type { Box, Course, HoldKind } from './city';
import { Runner } from './runner';
import type { Input } from './runner';
import { Rig } from './rig';
import type { Character } from './character';
import { point } from './m4';

export interface Frame {
  t: number; x: number; y: number; z: number; vx: number; vz: number; vy: number; speed: number; state: string; move: string;
  fl: boolean; fr: boolean; save: string; hang: number;
  /** the drawn body: the hips jumped this frame; a held foot's ball moved (m); a held foot out of the leg's reach */
  jump: boolean; slid: number; stretched: boolean; pelvisY: number;
  /** the drawn body: each foot's ball (on the ground under the sole), and the pelvis */
  ballL: number[]; ballR: number[]; pelvis: number[];
}
export interface Run { frames: Frame[]; runner: Runner; ups: { t: number; foot: boolean; move: string; by: string; side: string }[]; lands: { t: number; v: number; from: string; save: string; side: string }[]; moves: { t: number; move: string }[] }
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
  /** a still eye to film it from too, wide on the whole room (`?fixed` on the page) */
  eye?: [number, number, number];
  /** filmed close (frames every 1/30 s) from just before its first takeoff, or from the time this gives; not across the whole run */
  close?: boolean | ((r: Run) => number);
  /** what makes a run of it the same move again (for the basin: devtools/roofjumps-basin.mjs); by default, its sequence */
  signature?: (r: Run) => string;
  /** the signature of the move the scene is after (the basin's target); by default, whatever the unperturbed run does */
  move?: string;
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

/**
 * The courtyard: one room to cross three ways (after Astra's brief). From the start roof (13 m) the far side's high opening
 * (a notch 13.4 m up between a taller building and the side wall) is in view. A narrow parapet (0.5 m wide, 12.5 m) runs
 * from just off the start roof's edge toward the opening; below it and beside it a broad roof (10 m); on the left a side
 * wall (20 m) rises past everything. The same corner serves several purposes: the parapet is a line to run, an edge to
 * catch; the side wall is a wall to run, a wall to plant feet on from a swing. `mirror`: the room the other way round (x
 * about 28); `shift`: the parapet that much nearer the side wall. Positions in a run's inputs are in the unmirrored room.
 */
interface Yard { mirror: boolean; shift: number }
const yardBoxes = (y: Yard): Box[] => {
  const m = (b: Box): Box => (y.mirror ? { ...b, x0: 56 - b.x1, x1: 56 - b.x0 } : b);
  return [
    B(14, 40, 2, 14, 13), // the start roof
    B(14, 39.5, 17, 29, 10), // the broad roof, up to the opening's face
    B(36.6 + y.shift, 37.1 + y.shift, 15, 28, 12.5), // the parapet (a body's width short of the far side: a way round its end)
    B(39.5, 42, 10, 36, 20), // the side wall
    B(36.5, 39.5, 29, 31.5, 13.4), // the opening: its sill, the notch's floor
    B(14, 36.5, 29, 42, 18), B(36.5, 39.5, 31.5, 42, 18), // the far side, and the opening's back
  ].map(m);
};
/** the room, started from `sx` along the start roof (26: square to the room; further left, lined up with the parapet) */
const yard = (y: Yard, sx = 26): Course => ({ boxes: yardBoxes(y), start: { x: y.mirror ? 56 - sx : sx, z: 4 }, alone: true });
/** the still eye on the room: high over the start roof's right-hand edge, looking across it at three-quarters */
const yardEye = (y: Yard): [number, number, number] => [y.mirror ? 56 - 24 : 24, 19.5, 12.5];
/** the run's x in the unmirrored room, and a stick angle the right way round */
const yx = (y: Yard, r: Runner) => (y.mirror ? 56 - r.x : r.x);
const ygo = (y: Yard, deg: number, mag = 1) => go(y.mirror ? -deg : deg, mag);
const onOpening = (y: Yard) => (f: { x: number; y: number; z: number; state: string }) => { const x = y.mirror ? 56 - f.x : f.x; return f.state === 'ground' && Math.abs(f.y - 13.4) < 0.05 && f.z > 29 && f.z < 31.5 && x > 36.5 && x < 39.5; };
const onParapet = (y: Yard) => (f: { x: number; y: number; z: number; state: string }) => { const x = y.mirror ? 56 - f.x : f.x; return f.state === 'ground' && Math.abs(f.y - 12.5) < 0.05 && x > 36.5 + y.shift && x < 37.2 + y.shift; };
const endsUp = (y: Yard): Should => ({ says: 'it ends stood in the opening', check: (r) => ok(r.frames.slice(-30).some(onOpening(y)), `ended at x ${r.runner.x.toFixed(1)}, y ${r.runner.y.toFixed(1)}, z ${r.runner.z.toFixed(1)} (${r.runner.state})`) });

/** someone finding their way: down onto the broad roof, slow, a look up, and up into the opening from below */
const yardFind = (y: Yard): Scene => ({
  key: 'yard-find' + (y.mirror ? '-mirror' : '') + (y.shift ? '-shift' : ''), title: 'The courtyard, finding a way' + (y.mirror ? ' (mirrored)' : ''),
  asks: 'Someone finding their way. An ordinary bound down onto the broad roof, slow across it toward the opening, a pause under it (theirs: the stick let go), then pressed at it: up, both hands on the sill, a knee over, stood. Satisfying first time.',
  watch: 'The bound and its landing; the slow approach; the pause under the opening; the reach and the knee.',
  course: yard(y), seconds: 8, eye: yardEye(y),
  input: (t, r, m) => {
    if (r.state === 'ground' && r.y > 13.3 && r.z > 28) return none;
    if (!m.down && r.state === 'ground' && r.y < 10.1 && r.z > 17) m.down = t;
    if (!m.down) return go(0);
    // (slow across the broad roof to under the opening, a pause there, then at it)
    if (!m.under && r.z > 28.2 && yx(y, r) > 37.6 + y.shift) m.under = t;
    if (!m.under) { const px = yx(y, r) < 36 + y.shift && r.z < 28.2 ? 35.8 + y.shift : 38.4 + y.shift, ddx = px - yx(y, r), ddz = 28.5 - r.z; return ygo(y, (Math.atan2(ddx, ddz) * 180) / Math.PI, Math.hypot(ddx, ddz) < 1.2 ? 0.3 : 0.5); }
    return t < m.under + 0.7 ? none : go(0);
  },
  should: [...commonShoulds,
    { says: 'it comes down onto the broad roof first', check: (r) => { const l = r.lands[0], f = l && r.frames.find((x) => x.t >= l.t); return ok(!!f && Math.abs(f.y - 10) < 0.05, f ? `first landing at y ${f.y.toFixed(1)}` : 'no landing'); } },
    { says: 'it stands under the opening a beat before going up', check: (r) => { const st = r.frames.filter((f) => f.state === 'ground' && f.z > 26 && Math.abs(f.y - 10) < 0.05 && f.speed < 0.6); return ok(st.length >= 30, `${(st.length / 120).toFixed(2)} s stood under it`); } },
    endsUp(y),
  ],
});

/** someone who knows the room: onto the parapet, along it, into the side wall, up it to the opening */
const yardKnow = (y: Yard): Scene => ({
  key: 'yard-know' + (y.mirror ? '-mirror' : '') + (y.shift ? '-shift' : ''), title: 'The courtyard, knowing the room' + (y.mirror ? ' (mirrored)' : '') + (y.shift ? ' (parapet moved)' : ''),
  asks: 'Someone who knows it. From a little further left, onto the near end of the parapet, along its narrow top, and off it into the side wall: a wall foot that sends them up and on to the opening. The first footfall should be seen setting up the third: the takeoff arranged two strides before the parapet, the parapet foot already turning the body toward the wall.',
  watch: 'The stride before the parapet; the foot on its top; the turn into the wall; the wall foot; arriving in the opening without a stop.',
  course: yard(y, 33), seconds: 6, eye: yardEye(y),
  input: (t, r, m) => {
    if (r.state === 'ground' && r.y > 13.3 && r.z > 28) return none;
    if (!m.on && r.state === 'ground' && Math.abs(r.y - 12.5) < 0.05 && r.z > 15) m.on = t;
    // (across the start roof to the parapet's line, then straight down it: the takeoff lined up two strides out)
    if (!m.on) return ygo(y, Math.max(-30, Math.min(30, (36.85 + y.shift - yx(y, r)) * 12)));
    if (r.state === 'wall' || m.wall) { m.wall = 1; return ygo(y, 0); }
    return r.z < 21 ? go(0) : ygo(y, 40);
  },
  should: [...commonShoulds,
    { says: 'it runs the parapet\'s top', check: (r) => { const n = r.frames.filter(onParapet(y)).length; return ok(n >= 24, `${(n / 120).toFixed(2)} s on it`); } },
    { says: 'then a foot on the side wall', check: (r) => ok(r.frames.some((f) => f.state === 'wall'), seq(r)) },
    { says: 'and no hang on the way: it flows', check: (r) => ok(!r.moves.some((x) => x.move === 'hang'), seq(r)) },
    endsUp(y),
  ],
});

/** someone saving a line: too square off the parapet, a hand catches it, the swing, feet to the side wall, up to the opening */
const yardSave = (y: Yard): Scene => ({
  key: 'yard-save' + (y.mirror ? '-mirror' : '') + (y.shift ? '-shift' : ''), title: 'The courtyard, saving a line' + (y.mirror ? ' (mirrored)' : '') + (y.shift ? ' (parapet moved)' : ''),
  asks: 'Someone saving a line. Along the parapet, then turned at the wall too square and too late: the foot takes the weight but the hips carry on over the edge, and the wall step is gone. A hand catches the parapet; the body swings out below the line it meant to take. Pressed toward the side wall on the swing, the feet go to it, and off them up to the opening\'s sill from below. The mistake opens a route with a different rhythm.',
  watch: 'The foot that can\'t turn the body; the hand catching; the swing (which way, how far); the feet meeting the side wall; the reach up to the sill.',
  course: yard(y, 33), seconds: 7, eye: yardEye(y),
  move: 'caught going over › feet to the wall › into the opening',
  signature: (r) => { const m = r.runner.made as Record<string, number>; return [(m.overcatch ?? 0) ? 'caught going over' : '', (m.swingkick ?? 0) ? 'feet to the wall' : '', r.frames.slice(-30).some(onOpening(y)) ? 'into the opening' : 'not in'].filter(Boolean).join(' › '); },
  input: (t, r, m) => {
    if (r.state === 'ground' && r.y > 13.3 && r.z > 28) return none;
    if (!m.on && r.state === 'ground' && Math.abs(r.y - 12.5) < 0.05 && r.z > 15) m.on = t;
    // (across the start roof to the parapet's line, then straight down it: the takeoff lined up two strides out)
    if (!m.on) return ygo(y, Math.max(-30, Math.min(30, (36.85 + y.shift - yx(y, r)) * 12)));
    if (!m.turned && r.z > 25) m.turned = t;
    if (!m.turned) return go(0);
    if (!m.hung && r.move === 'hang') m.hung = t;
    if (!m.hung) return ygo(y, 85);
    if (!m.kicked && r.move === 'kick') m.kicked = t;
    // (a beat in the swing, then toward the side wall for the feet; off them, at the opening, and pulled into it)
    return t < m.hung + 0.25 ? none : !m.kicked ? ygo(y, 85) : ygo(y, 5);
  },
  should: [...commonShoulds,
    { says: 'it runs the parapet\'s top', check: (r) => { const n = r.frames.filter(onParapet(y)).length; return ok(n >= 24, `${(n / 120).toFixed(2)} s on it`); } },
    { says: 'a hand catches the parapet as the hips go over', check: (r) => { const h = r.frames.find((f) => f.state === 'climb' && f.y < 12 && f.y > 9.5); return ok(!!h, h ? `hung at y ${h.y.toFixed(1)}` : seq(r)); } },
    { says: 'the body swings out under the hand (half a metre or more)', check: (r) => { const hs = r.frames.filter((f) => f.state === 'climb' && f.move === 'hang'); const xs = hs.map((f) => (y.mirror ? 56 - f.x : f.x)); const sw = xs.length ? Math.max(...xs) - Math.min(...xs) : 0; return ok(sw >= 0.5, `swung ${sw.toFixed(2)} m`); } },
    { says: 'then the feet on the side wall, off the swing', check: (r) => { const h = r.frames.findIndex((f) => f.move === 'hang'); return ok(h >= 0 && r.frames.slice(h).some((f) => f.state === 'wall' || f.move === 'kick'), seq(r)); } },
    endsUp(y),
  ],
});

/**
 * One stride across a gap (after Astra's note: "the runner loses the stride as soon as they leave the roof"). A run, then a
 * narrow gap where a footfall would be: the push foot the last to leave, the other knee already coming through and taking
 * the far roof, the push heel still recovering behind and coming through into the next step; the beat stretched a little,
 * not stopped and started again. `at`: where the gap starts (moved half a stride, the other foot pushes).
 */
const strideGap = (at: number, gap: number): Course => ({ boxes: gap ? [B(24, 40, 2, at, 12), B(24, 40, at + gap, 60, 12)] : [B(24, 40, 2, 60, 12)], start: { x: 32, z: 4 }, alone: true });
const flightOf = (r: Run) => { const u = r.ups[0], l = u && r.lands.find((x) => x.t > u.t); return u && l ? r.frames.filter((f) => f.t > u.t && f.t < l.t) : []; };
/** the feet along the way it runs (+z), and how often in the flight they're bunched under the hips together */
const gathered = (r: Run) => { const fl = flightOf(r); return fl.length ? fl.filter((f) => Math.abs(f.ballL[2] - f.ballR[2]) < 0.3).length / fl.length : 1; };
/** the push foot's next footfall after the landing: how long after it */
const nextOf = (r: Run, side: string) => { const l = r.lands[0]; if (!l) return null; const fs = r.frames.filter((f) => f.t > l.t); for (let i = 1; i < fs.length; i++) { const a = side === 'L' ? fs[i - 1].fl : fs[i - 1].fr, b = side === 'L' ? fs[i].fl : fs[i].fr; if (!a && b) return fs[i].t - l.t; } return null; };
const strideShoulds: Should[] = [
  { says: 'off one foot, landing on the other', check: (r) => { const u = r.ups[0], l = r.lands[0]; const okk = !!u && !!l && (u.side === 'L' || u.side === 'R') && (l.side === 'L' || l.side === 'R') && u.side !== l.side; return ok(okk, u && l ? `off ${u.side || 'no foot'}, landed on ${l.side || '?'}` : seq(r)); } },
  { says: 'one leg coming through while the other goes down: the feet not gathered together under the hips (under a third of the flight within 30 cm of each other along the run)', check: (r) => { const g = gathered(r); return ok(g < 0.34, `${Math.round(100 * g)}% of the flight gathered`); } },
  { says: 'the push leg comes through into the next step, a stride\'s time after the landing', check: (r) => { const u = r.ups[0]; const n = u ? nextOf(r, u.side) : null; return ok(n !== null && n < 0.4, n === null ? 'no next step by the push foot' : `${n.toFixed(2)} s after the landing`); } },
];
const strideScene = (key: string, title: string, at: number, gap: number): Scene => ({
  key, title,
  asks: gap ? 'Three ordinary strides, then a narrow gap where the next footfall would be. One stride should carry across it: the push foot the last thing to leave the near roof, the other knee already travelling and taking the far roof, the push heel still recovering behind the hips there and coming through into the next step. The gap stretches the beat a little; it doesn\'t stop the run in the air and start it again on landing.' : 'The reference: the same run with no gap, to see the stride the gap should keep.',
  watch: gap ? 'From the side: follow the toe that left the near roof all the way to its next step, while the other leg takes the landing. From behind: whether it still reads.' : 'The rhythm of the footfalls, to hold the gap\'s against.',
  course: strideGap(at, gap), seconds: 3.2, close: true,
  input: (t, r) => (r.z > 40 ? none : go(0)),
  should: gap ? [...commonShoulds, ...strideShoulds] : [...commonShoulds],
});

/**
 * The stairwell (after Astra: a move nobody named). Two flights beside a well, a half-landing round the well's end, the
 * inside rail doubling back round it, and the upper landing's edge out over the well's end, its underside a little above
 * the rail. Run down the first flight too fast to take the turn, the rail is caught and the body swings round it out over
 * the well; swung flat and wide enough, the trailing foot can reach that underside, and pressed there, the leg's load
 * sends the body out down the second flight. Nothing in the room marks that underside as a place for a foot.
 */
/** where down the first flight the turn's asked (the scripted player's decision) */
let STAIR_TURN = 19.1;
export const setStairTurn = (z: number) => { STAIR_TURN = z; };
/** how high the upper landing's underside is over the well (the rail at the turn is at 9.9) */
let SOFFIT = 10.05;
export const setSoffit = (y: number) => { SOFFIT = y; };
export const stairwell = (start: number): Course => {
  const boxes: Box[] = [B(30.6, 40, 2, 14, 12), B(14, 29.4, 2, 13, 6), B(29.4, 30.6, 12, 21, 3)];
  for (let i = 0; i < 8; i++) boxes.push(B(30.6, 33, 14 + i * 0.625, 14 + (i + 1) * 0.625, 12 - 0.375 * (i + 1), TAG.STAIR));
  boxes.push(B(30.6, 33, 19, 21, 9), B(27, 33, 21, 22, 9), B(27, 29.4, 19, 21, 9));
  for (let i = 0; i < 8; i++) boxes.push(B(27, 29.4, 19 - (i + 1) * 0.75, 19 - i * 0.75, 9 - 0.375 * (i + 1), TAG.STAIR));
  // (the stairwell's walls, and the upper landing's edge out over the well's end: a slab, open beneath)
  boxes.push(B(33, 34, 13, 23, 15), B(26, 27, 12, 23, 15), B(26, 34, 22, 23, 15));
  boxes.push({ x0: 29.4, x1: 30.6, z0: 19, z1: 21, y0: SOFFIT, y1: SOFFIT + 0.3, tag: TAG.SLAB });
  const rail = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => ({ kind: 'rail' as const, ax, ay, az, bx, by, bz, nx: 0, nz: 0 });
  return { boxes, holds: [rail(30.6, 12.9, 14, 30.6, 9.9, 19), rail(30.6, 9.9, 19, 30.6, 9.9, 21), rail(30.6, 9.9, 21, 29.4, 9.9, 21), rail(29.4, 9.9, 21, 29.4, 9.9, 19), rail(29.4, 9.9, 19, 29.4, 6.9, 13)], start: { x: start, z: 4 }, alone: true };
};

/**
 * The holds' scenes: across a 5.5 m alley from a 6 m roof, a jump at a taller face comes up short, and what's on the face
 * decides the climb. Each steered as a player would: into the wall, or along it while hanging.
 */
function holdScenes(): Scene[] {
  const F = 25.5, out = (k: HoldKind) => (k === 'ledge' ? 0.3 : k === 'ac' ? 0.48 : 0);
  const H = (kind: HoldKind, x0: number, x1: number, y: number) => ({ kind, ax: x0, ay: y, az: F - out(kind), bx: x1, by: y, bz: F - out(kind), nx: 0, nz: -1 });
  const pipe = (x: number, top: number) => ({ kind: 'pipe' as const, ax: x, ay: 0, az: F, bx: x, by: top, bz: F, nx: 0, nz: -1 });
  const course = (hi: number, holds: Course['holds'], x = 32): Course => ({ boxes: [B(20, 44, 0, 20, 6), B(20, 44, F, 40, hi)], holds, start: { x, z: 8 }, alone: true });
  // (run at the lip and jump; hanging, steered by `steer`; up top, stand)
  const input = (hi: number, steer: (r: Runner) => Input) => (t: number, r: Runner, mem: Record<string, number>): Input => {
    if (r.y > hi - 0.1 && r.state === 'ground') return none;
    if (r.state === 'climb') return steer(r);
    if (!mem.jumped && r.state === 'ground' && r.z > 19.3) { mem.jumped = 1; return { ...go(0), jump: true }; }
    return go(0);
  };
  const made = (r: Run, k: string) => ((r.runner.climbsBy as Record<string, number>)[k] ?? 0);
  const onTop = (hi: number) => ({ says: `and onto the ${hi} m roof`, check: (r: Run) => ok(r.runner.y > hi - 0.1, `ended at y ${r.runner.y.toFixed(1)}; ${seq(r)}; ${JSON.stringify(r.runner.climbsBy)}`) });
  return [
    {
      key: 'pipe-one-hand', title: 'A pipe to the side, one hand, and up it',
      asks: 'Short of a 15 m roof with nothing on the face but a drainpipe 0.7 m to the side of the jump. A hand goes out sideways to it, the body hanging turned off it; it comes square, the other hand on, and goes up the pipe hand over hand to the lip.',
      watch: 'The one-armed catch, side-on; the swing square; the knees clamping the pipe on the way up.',
      course: course(15, [pipe(32.7, 15)]), seconds: 8, input: input(15, () => go(0)),
      should: [...commonShoulds,
        { says: 'caught one-handed, to the side', check: (r) => ok(r.runner.oneHanded > 0, `${r.runner.oneHanded} one-handed`) },
        { says: 'up the pipe hand over hand', check: (r) => ok(made(r, 'pipe') > 0, JSON.stringify(r.runner.climbsBy)) },
        onTop(15)],
    },
    {
      key: 'ledge-step-up', title: 'A ledge, stepped up onto',
      asks: 'Short of an 11.5 m roof, a stone ledge across the face at 8.6 m. Caught; a foot is got onto it and the body stands up on it, the chest to the wall; from standing, a reach and a jump to the lip.',
      watch: 'The step-up (knee on, stood up) and the jump from standing, against springing from a hang.',
      course: course(11.5, [H('ledge', 20.1, 43.9, 8.6)]), seconds: 7, input: input(11.5, () => go(0)),
      should: [...commonShoulds,
        { says: 'stepped up onto the ledge, and up from standing on it', check: (r) => ok(made(r, 'step-up') > 0 && made(r, 'up-from-standing') > 0, JSON.stringify(r.runner.climbsBy)) },
        onTop(11.5)],
    },
    {
      key: 'shimmy-across', title: 'Along a sill, across to a pipe',
      asks: 'Short of a 15 m roof; a sill at 9 m that stops short, a pipe 1.6 m past its end. Steered along the wall: shimmied hand over hand to the sill\'s end, a spring across to the pipe (the leading hand first), and up it.',
      watch: 'The hands leapfrogging along the sill; the sideways spring and one-armed catch; the pipe.',
      course: course(15, [H('sill', 27, 31, 9), pipe(32.6, 15)], 29), seconds: 9.5, input: input(15, (r) => (r.x < 32.2 ? { x: 1, z: 0.15, jump: false } : go(0))),
      should: [...commonShoulds,
        { says: 'shimmied along the sill, then across to the pipe', check: (r) => ok(made(r, 'shimmy') > 0 && made(r, 'across') > 0, JSON.stringify(r.runner.climbsBy)) },
        { says: 'and up the pipe', check: (r) => ok(made(r, 'pipe') > 0, JSON.stringify(r.runner.climbsBy)) },
        onTop(15)],
    },
    {
      key: 'diagonal-unit', title: 'Up and across to a unit, and up from it',
      asks: 'Short of a 15 m roof; a sill at 9 m, and up and to the side a unit under a window. Steered up and that way: sprung diagonally for the unit, stepped up onto it, and from standing on it, the lip.',
      watch: 'The diagonal spring and its one-handed catch; the unit used as a step.',
      course: course(15, [H('sill', 27, 33, 9), H('ac', 30.6, 31.5, 11.9)], 29), seconds: 7, input: input(15, (r) => (r.y < 9 ? { x: 0.7, z: 0.7, jump: false } : go(0))),
      should: [...commonShoulds,
        { says: 'sprung up and across to the unit, and stepped up onto it', check: (r) => ok(made(r, 'diagonal') > 0 && made(r, 'step-up') > 0, JSON.stringify(r.runner.climbsBy)) },
        onTop(15)],
    },
  ];
}

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
    course: twoGaps(), seconds: 5,
    input: (t, r, m) => { if (!m.turned && r.z > 15.5) m.turned = t; if (m.turned && !m.back && r.state === 'ground' && r.z > 21) m.back = t + 0.25; if (r.z > 40 && r.state === 'ground') return none; return m.back && t > m.back ? go(0) : m.turned ? go(-35) : go(0); },
    should: [...commonShoulds,
      { says: 'the first landing is a wide save', check: (r) => ok(r.lands[0]?.save === 'wide', `first landing: ${r.lands[0]?.save || 'clean'}`) },
      { says: 'it costs the line into gap two: the second takeoff later, slower or angled off the line, against the clean run', check: (r) => { const ref = runScene(SCENES[0]); const a = r.ups[1], b = ref.ups[1]; if (!a || !b) return ok(false, 'no second takeoff'); const fa = r.frames.find((f) => f.t >= a.t)!, fb = ref.frames.find((f) => f.t >= b.t)!; const ang = Math.abs(Math.atan2(fa.vx, fa.vz) * 57.3); const cost = a.t - b.t > 0.1 || fb.speed - fa.speed > 1.5 || ang > 10; return ok(cost, `second takeoff ${a.t.toFixed(2)} s at ${fa.speed.toFixed(1)} m/s, ${ang.toFixed(0)}° off the line (clean: ${b.t.toFixed(2)} s at ${fb.speed.toFixed(1)} m/s)`); } },
    ],
  },
  {
    key: 'short-catch', title: 'Underpowered, caught short',
    asks: 'A 4.2 m gap to a roof 2.5 m higher, approached at a light press (0.6: just enough to commit to the jump). The athlete shouldn\'t make it clean; the hand should catch the lip, the body swing under, and then it hangs, until the player chooses: left alone 1.5 s it stays; pressed in, it pulls up.',
    watch: 'The near hand first; the swing under; a still hang (feet set on the wall, arms straight); then the pull-up when pressed.',
    course: { boxes: [B(24, 40, 2, 18, 12), B(24, 40, 22.2, 40, 14.5)], start: { x: 32, z: 4 }, alone: true }, seconds: 5.6,
    input: (t, r, m) => { if (!m.hung && r.move === 'hang') m.hung = t; if (r.y > 14.4 && r.state === 'ground') return none; return !m.hung ? go(0, 0.6) : t < m.hung + 1.5 ? none : go(0); },
    should: [...commonShoulds,
      { says: 'the lip is caught', check: (r) => ok(count(r, 'hang') > 0, seq(r)) },
      { says: 'left alone, it stays hanging', check: (r) => { const h = first(r, (f) => f.move === 'hang'); if (!h) return ok(false, 'never hung'); const still = r.frames.filter((f) => f.t > h.t + 0.4 && f.t < h.t + 1.4); return ok(still.length > 0 && still.every((f) => f.move === 'hang'), still.every((f) => f.move === 'hang') ? 'held' : 'let go'); } },
      { says: 'pressed in, it pulls up onto the higher roof', check: (r) => ok(r.runner.y > 14.4 && r.runner.state === 'ground', `ended ${r.runner.state} at y ${r.runner.y.toFixed(1)}`) },
    ],
  },
  {
    key: 'gait-walk', title: 'Gait: a walk on a long flat roof',
    asks: 'Nothing in the way, a light press: a walk. Does it look like a person walking: legs nearly straight, the hips riding over each foot in turn, the heel down first and the toe last, both feet down together for a moment at each step, the arms swinging easily?',
    watch: 'The knees and feet, from the side and from behind (devtools/roofjumps-legs.mjs films and measures it).',
    course: { boxes: [B(4, 60, 2, 62, 9)], start: { x: 32, z: 4 }, alone: true }, seconds: 6, input: () => go(0, 0.25),
    should: [...commonShoulds],
  },
  {
    key: 'gait-jog', title: 'Gait: a jog on a long flat roof',
    asks: 'Nothing in the way, half a press: the plainest running there is. Do the legs look like a person jogging: a soft knee at touchdown, the foot under the hips, the heel lifting behind, a little bounce, feet on two close lines that never cross?',
    watch: 'The knees and feet, from the side and from behind (devtools/roofjumps-legs.mjs films and measures it).',
    course: { boxes: [B(4, 60, 2, 62, 9)], start: { x: 32, z: 4 }, alone: true }, seconds: 5, input: () => go(0, 0.45),
    should: [...commonShoulds],
  },
  {
    key: 'gait-run', title: 'Gait: running flat out on a long flat roof',
    asks: 'Nothing in the way, a full press: the run at speed. Do the legs look like an athlete running: the thigh driven high, the heel folding to the seat, the foot pawing back to land under the hips, a short stance, no stamp, no wobble?',
    watch: 'The knees and feet, from the side and from behind (devtools/roofjumps-legs.mjs films and measures it).',
    course: { boxes: [B(4, 60, 2, 62, 9)], start: { x: 32, z: 4 }, alone: true }, seconds: 5.5, input: (t, r) => (r.z > 56 ? none : go(0)),
    should: [...commonShoulds],
  },
  {
    key: 'gait-wander', title: 'Gait: wandering a rooftop at a slow, changing pace',
    asks: 'How a player moves when not running anywhere: a semi-random wander about a wide empty roof, the stick drifting between a light and a middling press, turning gently and now and then sharply, easing off, pausing, setting off again. Does it look like a person walking and jogging about: weight onto each foot, toes where it\'s going, no hop at a walk, no twisting on a planted foot, no legs crossing in a turn?',
    watch: 'The feet through the turns, the pauses and the restarts (devtools/roofjumps-legs.mjs measures and films it).',
    course: { boxes: [B(2, 62, 2, 62, 9)], start: { x: 32, z: 30 }, alone: true }, seconds: 16,
    input: (t, r) => {
      // (in spells of 1.2 to 2.6 s, each with its own press and turn, from a seeded hash of which spell it is; every fifth a
      // pause; a sharp change of heading now and then; drawn back toward the middle when far out)
      const h = (n: number) => { let x = Math.imul(n * 2654435761, 1597334677) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };
      let at = 0, i = 0; while (at + 1.2 + 1.4 * h(i * 7 + 1) <= t) { at += 1.2 + 1.4 * h(i * 7 + 1); i++; }
      const k = (t - at) / (1.2 + 1.4 * h(i * 7 + 1));
      if (i % 5 === 4) return none;
      let head = 0; for (let j = 0; j <= i; j++) head += (h(j * 7 + 2) - 0.5) * (h(j * 7 + 3) < 0.25 ? 2.8 : 1.1);
      head += (h(i * 7 + 4) - 0.5) * 0.8 * k;
      const dx = r.x - 32, dz = r.z - 32, far = Math.hypot(dx, dz);
      if (far > 18) head = Math.atan2(-dx, -dz);
      const mag = 0.15 + 0.5 * h(i * 7 + 5);
      return { x: Math.sin(head) * mag, z: Math.cos(head) * mag, jump: false };
    },
    should: [...commonShoulds],
  },
  {
    key: 'paint-alley', title: 'The painted alley: an approach, a correction in the air, a catch',
    asks: 'The replay the brushwork looks are judged on (strokes.ts): a roof approach, the stick swung left in the air and back, and a lip caught short across an alley to a higher roof, a tall dark block beyond it and another to the left, so a dry gap in a near wall has something dark behind it to leak. Does the runner still catch, hang and pull up?',
    watch: 'In each look: where the hand is going and when it closes on the coping; which shoe bears weight; the air between the body and the far wall before the catch; the far wall\'s paint staying planted as the eye swings.',
    course: { boxes: [B(24, 40, 2, 18, 12), B(22, 42, 22.2, 40, 14.5), B(20, 44, 46, 60, 27), B(6, 19, 6, 38, 21), B(42, 54, 0, 16, 9)], start: { x: 32, z: 4 } }, seconds: 6,
    eye: [44, 16.5, 13],
    input: (t, r, m) => {
      if (!m.hung && r.move === 'hang') m.hung = t;
      if (!m.air && r.state === 'air') m.air = t;
      if (r.y > 14.4 && r.state === 'ground') return r.z > 30 ? none : go(0, 0.5);
      if (m.air && !m.hung) return t < m.air + 0.22 ? go(24, 0.6) : go(0, 0.6);
      return !m.hung ? go(0, 0.6) : t < m.hung + 1.2 ? none : go(0);
    },
    should: [...commonShoulds,
      { says: 'the lip is caught', check: (r) => ok(count(r, 'hang') > 0, seq(r)) },
      { says: 'pressed in, it pulls up onto the higher roof', check: (r) => ok(r.runner.y > 14.4 && r.runner.state === 'ground', `ended ${r.runner.state} at y ${r.runner.y.toFixed(1)}`) },
    ],
  },
  {
    key: 'hang-intents', title: 'Hanging: stay, pass along, go up',
    asks: 'Caught as above; then the stick asks three things in turn: nothing (stay), along the wall (shimmy along the lip, hand over hand), then into it (up). Can the player get, and recognise, each?',
    watch: 'Whether steering along the wall moves the hands along the lip (it should), or lets go.',
    course: { boxes: [B(24, 40, 2, 18, 12), B(16, 48, 22.2, 40, 14.5)], start: { x: 32, z: 4 }, alone: true }, seconds: 6.6,
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
    course: { boxes: [B(24, 40, 2, 30, 12)], start: { x: 32, z: 4 }, alone: true }, seconds: 4,
    input: (t, r) => (r.z < 22 ? go(0) : none),
    should: [...commonShoulds,
      { says: 'it stops on the roof, not off the edge', check: (r) => ok(r.runner.y > 11.9 && r.runner.z < 30, `ended at z ${r.runner.z.toFixed(2)}, y ${r.runner.y.toFixed(1)}`) },
      { says: 'it ends standing on both feet', check: (r) => { const f = r.frames[r.frames.length - 1]; return ok(f.fl && f.fr && f.speed < 0.1, `${f.fl && f.fr ? 'both feet' : 'one foot'}, ${f.speed.toFixed(2)} m/s`); } },
      { says: 'it comes to a stand close to the lip (within 0.8 m) and checks its balance there (a teeter)', check: (r) => { const gap = 30 - r.runner.z, n = (r.runner.made as Record<string, number>).teeter ?? 0; return ok(gap < 0.8 && n > 0, `stopped ${gap.toFixed(2)} m from the lip, ${n ? 'a teeter' : 'no teeter'}`); } },
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
    asks: 'Off a ledge down a storey, landing 2 m from the next gap (to a roof a metre up, so the two can\'t be taken as one bound). The landing should sink by the impact and the next jump go off the landing foot (a rebound), not stop or stutter.',
    watch: 'The landing\'s depth; one foot down; the rebound into the next gap.',
    course: { boxes: [B(24, 40, 2, 16, 15), B(24, 40, 16, 23.5, 12), B(24, 40, 26.5, 44, 13)], start: { x: 32, z: 4 }, alone: true }, seconds: 4,
    input: (t, r) => (r.z > 32 && r.state === 'ground' ? none : go(0)),
    should: [...commonShoulds,
      { says: 'it goes on into the next gap within half a second of landing', check: (r) => { const l = r.lands[0], u = r.ups.find((x) => l && x.t > l.t); return ok(!!l && !!u && u.t - l.t < 0.5, l && u ? `${(u.t - l.t).toFixed(2)} s on the ground` : seq(r)); } },
      { says: 'ends across the gap', check: (r) => ok(r.runner.z > 26.5 && r.runner.y > 12.9, `ended z ${r.runner.z.toFixed(1)}`) },
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
    input: (t, r) => (r.y > 11.9 && r.state === 'ground' && r.z > 12 ? none : go(0)),
    should: [...commonShoulds,
      { says: 'it reaches the roof (12 m)', check: (r) => ok(r.runner.y > 11.9, `ended at y ${r.runner.y.toFixed(1)}; ${seq(r)}`) },
      { says: 'by repeated hangs, a storey each', check: (r) => { const n = (r.runner.made as Record<string, number>).hang ?? 0; return ok(n >= 3, `${n} hangs`); } },
    ],
  },
  {
    key: 'tic-tac', title: 'Off one wall to a higher lip',
    asks: 'A lip 5.7 m up, just beyond a straight jump\'s reach, in a corner with a taller wall alongside. A traceur kicks off the side wall (a tic-tac) to gain the height and catch it.',
    watch: 'Whether the side wall is used to go up toward the lip, or just run along.',
    course: { boxes: [B(16, 48, 16, 34, 5.7), B(36, 40, 2, 16, 10)], start: { x: 33, z: 4 }, alone: true }, seconds: 5,
    input: (t, r) => (r.y > 5.6 && r.state === 'ground' && r.z > 18 ? none : go(12)),
    should: [...commonShoulds,
      { says: 'it gets onto the 5.7 m roof', check: (r) => ok(r.runner.y > 5.6, `ended at y ${r.runner.y.toFixed(1)}; ${seq(r)}`) },
      { says: 'by kicking off the side wall', check: (r) => ok(count(r, 'kick') > 0 && r.runner.y > 5.6, seq(r)) },
    ],
  },
  {
    key: 'short-grab', title: 'Short of a roof, a sill grabbed',
    asks: 'A jump across a 5.5 m alley at a roof 12 m up, too high to reach from a 6 m roof: it comes up short. A traceur doesn\'t fall to the street past the sills on the face: a hand grabs the one in reach, and from there it\'s a climb.',
    watch: 'Whether the falling body takes the sill in front of it as it comes down, and goes on up from it to the lip.',
    course: { boxes: [B(20, 44, 0, 20, 6), B(20, 44, 25.5, 40, 12)], holds: [3, 6, 9].map((y) => ({ kind: 'sill' as const, ax: 26, ay: y, az: 25.5, bx: 38, by: y, bz: 25.5, nx: 0, nz: -1 })), start: { x: 32, z: 8 }, alone: true }, seconds: 5,
    input: (t, r, mem) => { if (r.y > 11.9 && r.state === 'ground') return none; if (!mem.jumped && r.state === 'ground' && r.z > 19.3) { mem.jumped = 1; return { ...go(0), jump: true }; } return go(0); },
    should: [...commonShoulds,
      { says: 'a sill grabbed in the air as the jump comes down short', check: (r) => ok(r.runner.holdsGrabbed > 0, `${r.runner.holdsGrabbed} grabbed; ${seq(r)}`) },
      { says: 'never down into the alley (no lower than the 6 m roof it left, less a body)', check: (r) => { const lo = Math.min(...r.frames.map((f) => f.y)); return ok(lo > 4, `lowest ${lo.toFixed(1)} m`); } },
      { says: 'and up from it onto the 12 m roof', check: (r) => ok(r.runner.y > 11.9, `ended at y ${r.runner.y.toFixed(1)}; ${seq(r)}`) },
    ],
  },
  ...holdScenes(),
  {
    key: 'underbar', title: 'Under a bar across a gap',
    asks: 'A bar across a 2.4 m gap, 1.3 m above the roofs. Under it feet first, hands on it: is there room for the hips and the trailing foot, and does the body actually pass beneath it?',
    watch: 'The hands on the bar; the hips and feet passing under it; the exit.',
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
    course: { boxes: [B(2, 64, 2, 60, 9), B(12, 20, 12, 12.8, 10, TAG.UNIT, 9), B(17, 25, 24, 24.8, 10, TAG.UNIT, 9), B(27, 41, 41.5, 42.3, 10, TAG.UNIT, 9)], start: { x: 16, z: 4 }, alone: true }, seconds: 6,
    input: (t, r) => (r.z > 43.5 ? none : r.z < 15 ? go(0) : r.z < 27 ? go(30) : go(60)),
    should: [...commonShoulds,
      { says: 'all three boxes vaulted', check: (r) => ok(count(r, 'vault') >= 3, `${count(r, 'vault')} vaults; ${seq(r)}`) },
      { says: 'the steepest one taken round on a hand (a palm spin or cartwheel), not as the square one was', check: (r) => { const m = r.runner.made as Record<string, number>; const n = (m.palmspin ?? 0) + (m.cartwheel ?? 0); return ok(n >= 1, `palm spins ${m.palmspin ?? 0}, cartwheels ${m.cartwheel ?? 0}`); } },
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
    course: { boxes: [B(16, 48, 2, 40, 9), B(28, 36, 12, 18, 10.5, TAG.HUT, 9)], start: { x: 32, z: 4 }, alone: true }, seconds: 5,
    input: (t, r) => (r.z < 11.4 ? go(0, 0.4) : go(0)),
    should: [...commonShoulds,
      { says: 'it ends up on the box', check: (r) => ok(r.frames.some((f) => f.y > 10.4 && f.state === 'ground'), seq(r)) },
      { says: 'by a climb or mantle, not a full spring over it', check: (r) => { const m = r.moves.find((x) => x.t > 0.5 && x.move !== 'run'); return ok(!!m && (m.move === 'climb' || m.move === 'hang'), m ? `first move: ${m.move}` : 'none'); } },
    ],
  },
  yardFind({ mirror: false, shift: 0 }), yardKnow({ mirror: false, shift: 0 }), yardSave({ mirror: false, shift: 0 }),
  yardKnow({ mirror: true, shift: 0 }), yardSave({ mirror: false, shift: 0.5 }),
  {
    key: 'stair-swing', title: 'The stairwell: round the rail, a foot on the underside',
    asks: 'Down the first flight too fast to take the turn, the rail caught and swung round. Swung flat and wide, the trailing foot can reach the underside of the landing\'s edge over the well; leaned toward it, the foot takes load there; let go, the leg sends the body out down the second flight, landing running. No marker says that underside is for a foot.',
    watch: 'The hand on the rail; the swing out over the well; the foot on the underside, the body between hand and foot; the exit down the second flight.',
    course: stairwell(31.5), seconds: 4.5,
    move: 'swing › underside › down the flight',
    eye: [31.8, 15.5, 12.2], close: (r) => Math.max(0, (r.moves.find((x) => x.move === 'swing')?.t ?? 0.3) - 0.1),
    signature: (r) => { const m = r.runner.made as Record<string, number>, f = r.frames[r.frames.length - 1]; return [(m.railswing ?? 0) ? 'swing' : '', (m.underfoot ?? 0) ? 'underside' : (m.swingfoot ?? 0) ? 'foot' : '', f.state === 'ground' && f.x < 29.45 && f.z < 19 ? 'down the flight' : f.y < 5.5 ? 'into the well' : 'elsewhere'].filter(Boolean).join(' › '); },
    input: (t, r, m) => { if (!m.turn && r.z > STAIR_TURN) m.turn = t; if (!m.turn) return go(0); if (r.state === 'swing') { if (!m.foot && r.swingFoot) m.foot = t; if (m.foot && t > m.foot + 0.06) return go(-150); return r.x < 30.5 ? go(0, 0.8) : go(180); } return r.z < 14 && r.state === 'ground' ? none : go(180); },
    should: [...commonShoulds,
      { says: 'the rail is caught, and the body swings round it', check: (r) => ok(count(r, 'swing') > 0, seq(r)) },
      { says: 'the trailing foot finds the underside, and takes load there', check: (r) => { const m = r.runner.made as Record<string, number>; return ok((m.underfoot ?? 0) > 0, `underside ${m.underfoot ?? 0}, any face ${m.swingfoot ?? 0}`); } },
      { says: 'out down the second flight, running', check: (r) => { const f = r.frames[r.frames.length - 1]; return ok(f.state === 'ground' && f.x < 29.45 && f.x > 26.9 && f.z < 19, `ended at x ${f.x.toFixed(1)}, y ${f.y.toFixed(1)}, z ${f.z.toFixed(1)} (${f.state})`); } },
    ],
  },
  strideScene('stride-flat', 'Three strides, no gap', 0, 0), strideScene('stride-gap-a', 'One stride across a gap', 22, 1.4), strideScene('stride-gap-b', 'One stride across a gap, off the other foot', 20, 1.4),
];

/** run a scene, the drawn body with it, and keep what the checks need */
export function runScene(s: Scene, seed = 1, character?: Character): Run {
  const city = new City(seed, false, s.course), r = new Runner(city, character), rig = new Rig(character); rig.update(1, r);
  const DT = 1 / 120, mem: Record<string, number> = {}, frames: Frame[] = [], ups: Run['ups'] = [], lands: Run['lands'] = [], moves: Run['moves'] = [{ t: 0, move: r.move }];
  let prevPv: number[] | null = null; const prevBall: (number[] | null)[] = [null, null], prevFall: (number[] | null)[] = [null, null], prevSet = [false, false];
  for (let i = 0; i < s.seconds / DT; i++) {
    const t = i * DT, s0 = r.state, m0 = r.move, vy0 = r.vy, sp0 = r.speed, fl0 = r.reach.fl, fr0 = r.reach.fr; r.takeoffBy = '';
    r.step(DT, s.input(t, r, mem)); rig.update(DT, r);
    if (r.move !== m0) moves.push({ t, move: r.move });
    if (s0 === 'ground' && r.state === 'air' && r.vy > 0) ups.push({ t, foot: !!(fl0 || fr0), move: r.move, by: r.takeoffBy, side: fl0 && fr0 ? 'both' : fl0 ? 'L' : fr0 ? 'R' : '' });
    if (s0 === 'air' && r.state === 'ground') lands.push({ t, v: -vy0, from: m0, save: r.saveKind ?? '', side: '' });
    // (which foot took the landing: the first down after it)
    { const l = lands[lands.length - 1]; if (l && !l.side && r.state === 'ground' && t - l.t < 0.3) l.side = r.reach.fl && r.reach.fr ? 'both' : r.reach.fl ? 'L' : r.reach.fr ? 'R' : ''; }
    const b = rig.bones(r), at = (n: string) => b.find((o) => o.name === n)!.m, pm = at('pelvis'), pv = [pm[12], pm[13], pm[14]];
    const jump = !!prevPv && Math.hypot(pv[0] - prevPv[0], pv[1] - prevPv[1], pv[2] - prevPv[2]) > Math.max(0.15, (Math.max(sp0, r.speed) + Math.abs(vy0) + Math.abs(r.vy)) * DT + 0.12);
    prevPv = pv;
    let slid = 0, stretched = false;
    for (const [k, s2, key] of [[0, 'L', 'fl'], [1, 'R', 'fr']] as const) {
      const now = r.reach[key], fm = at('foot' + s2), ball = [fm[12] + fm[8] * rig.body.ball - fm[4] * rig.body.sole, fm[13] + fm[9] * rig.body.ball - fm[5] * rig.body.sole, fm[14] + fm[10] * rig.body.ball - fm[6] * rig.body.sole], sole = s2 === 'L' ? rig.soles.L : rig.soles.R;
      const same = !!now && !!prevFall[k] && now[0] === prevFall[k]![0] && now[2] === prevFall[k]![2];
      // (planted this frame and the last: a foot still coming down onto its footfall isn't sliding on it)
      const set = sole.w > 0.9 && !sole.lost;
      if (same && set && prevSet[k] && prevBall[k]) slid += Math.hypot(ball[0] - prevBall[k]![0], ball[2] - prevBall[k]![2]);
      prevSet[k] = set;
      if (now && sole.w > 0.9 && !sole.lost) { const hp = point(at('thigh' + s2), 0, 0, 0), on = rig.on; if (Math.hypot(now[0] + on[0] * 0.07 - hp[0], now[1] + on[1] * 0.07 - hp[1], now[2] + on[2] * 0.07 - hp[2]) > 0.9) stretched = true; }
      prevBall[k] = ball; prevFall[k] = now ? [...now] : null;
    }
    const ballOf = (n: string) => { const fm = at(n), bl = rig.body.ball, so = rig.body.sole; return [fm[12] + fm[8] * bl - fm[4] * so, fm[13] + fm[9] * bl - fm[5] * so, fm[14] + fm[10] * bl - fm[6] * so]; };
    frames.push({ t, x: r.x, y: r.y, z: r.z, vx: r.vx, vz: r.vz, vy: r.vy, speed: r.speed, state: r.state, move: r.move, fl: !!r.reach.fl, fr: !!r.reach.fr, save: r.saveKind ?? '', hang: r.hangT, jump, slid, stretched, pelvisY: pv[1], ballL: ballOf('footL'), ballR: ballOf('footR'), pelvis: pv });
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
