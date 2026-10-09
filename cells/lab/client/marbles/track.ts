/**
 * Marble Run: the track, apart from the drawing and the solver (so it can be tested on its own).
 *
 * A run is a seed and a list of choices. From the gate at the top it goes down board by board:
 * each a wide, sloping tray, walled at the sides, with a field of obstacles in it — pegs,
 * curved deflectors, splitters that part the pack into lanes, chicanes, spinning crosses,
 * funnels that bring everyone together through a gap, gates, bumpers, a step down. Twelve
 * marbles go at once, and the board is wide enough that they meet: bump, split, catch up. At
 * the end of the run three boards are on offer (and three more): the choice is a number, so a
 * run is the seed and those numbers, and the same numbers are the same run.
 *
 * Units are centimetres; a marble is about 2 across; a board is 48 wide.
 */
import { hash, seeded, type Rand } from '../kit/rng';

export type V3 = [number, number, number];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** the board: its width, its walls' height */
export const WIDTH = 48;
export const WALL_H = 4.5;
/** marbles in a race */
export const FIELD_SIZE = 12;

export interface Frame {
  p: V3;
  /** along (down the board), up (out of the floor), across (to the left) */
  t: V3;
  n: V3;
  b: V3;
}
export const dirOf = (yaw: number, pitch: number): V3 => [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
/** A frame at a point, heading a way, sloping down by pitch. */
export function frameAt(p: V3, yaw: number, pitch: number): Frame {
  const t = dirOf(yaw, pitch);
  const b = norm(cross([0, 1, 0], t));
  const n = norm(cross(t, b));
  return { p, t, n, b };
}

/**
 * A board's geometry: everything on it is placed by (along, up, across). A straight board is its
 * frame; a bent board sweeps its frame round a circle (its middle an arc of the board's length,
 * turning by its turn, dropping at its slope), so the same (along, up, across) bends with it.
 */
export function frameAlong(bd: Board, along: number): Frame {
  if (!bd.turn) return { ...bd.frame, p: add(bd.frame.p, mul(bd.frame.t, along)) };
  const yaw0 = Math.atan2(bd.frame.t[0], bd.frame.t[2]);
  const yaw = yaw0 + (bd.turn * along) / bd.length;
  const t = dirOf(yaw, bd.slope);
  const b = norm(cross([0, 1, 0], t));
  const n = norm(cross(t, b));
  // the middle's point: round the centre of the turn, dropping
  const Rh = (bd.length * Math.cos(bd.slope)) / Math.abs(bd.turn), sg = Math.sign(bd.turn);
  const C = add(bd.frame.p, mul(bd.frame.b, sg * Rh));
  const p = add(add(C, mul(b, -sg * Rh)), [0, along * Math.sin(bd.slope), 0]);
  return { p, t, n, b };
}
export function toWorld(bd: Board, along: number, up: number, across: number): V3 {
  const f = frameAlong(bd, along);
  return add(add(f.p, mul(f.n, up)), mul(f.b, across));
}
/** A point's (along, up, across) on a board. */
export function toLocal(bd: Board, p: V3): [number, number, number] {
  const f0 = bd.frame;
  if (!bd.turn) {
    const d = sub(p, f0.p);
    return [dot(d, f0.t), dot(d, f0.n), dot(d, f0.b)];
  }
  const yaw0 = Math.atan2(f0.t[0], f0.t[2]);
  const Rh = (bd.length * Math.cos(bd.slope)) / Math.abs(bd.turn), sg = Math.sign(bd.turn);
  const C = add(f0.p, mul(f0.b, sg * Rh));
  // the heading at the point: from its bearing about the centre (b is (cos yaw, 0, -sin yaw));
  // the floor's normal leans along the slope, so a point above the floor is brought down to it
  // first, and the bearing taken again
  const alongOf = (q: V3) => {
    const ang = Math.atan2(q[2] - C[2], q[0] - C[0]);
    let yaw = sg > 0 ? Math.PI - ang : -ang;
    // (unwrapped to the nearest to the board's own range of headings)
    const mid = yaw0 + bd.turn! / 2;
    yaw = mid + Math.atan2(Math.sin(yaw - mid), Math.cos(yaw - mid));
    return ((yaw - yaw0) / bd.turn!) * bd.length;
  };
  let along = alongOf(p);
  for (let i = 0; i < 2; i++) {
    const f = frameAlong(bd, along);
    along = alongOf(sub(p, mul(f.n, dot(sub(p, f.p), f.n))));
  }
  const f = frameAlong(bd, along);
  const d = sub(p, f.p);
  return [along, dot(d, f.n), dot(d, f.b)];
}

/** A wall on a board: a segment in the board's plane (along, across), so thick. */
export interface Wall { a: [number, number]; b: [number, number]; thick: number }
/** A spinning cross on a board: at (along, across), so many arms so long, turning so fast (turns a second, signed). */
export interface Spinner { at: [number, number]; arms: number; half: number; rate: number }
export interface Board {
  /** its frame at its start (a bent board turns from there: see `frameAlong`) */
  frame: Frame;
  width: number;
  /** along its middle (arc length, if it bends) */
  length: number;
  slope: number;
  /** how far it turns, start to end (radians, signed: positive to the left); none, straight */
  turn?: number;
  walls: Wall[];
  /** along, across, radius */
  pegs: Array<[number, number, number]>;
  spinners: Spinner[];
  /** a wall across the top (the first board: the gate's back) */
  backWall: boolean;
  /** how far the next board's floor is below this one's end (a step down) */
  step: number;
  /** its sides' height, where not the usual (below a step they reach up to the board above) */
  sideH?: number;
}
export interface Section {
  kind: Kind;
  name: string;
  boards: Board[];
  /** where the next begins: the far edge's middle, heading on */
  end: { p: V3; yaw: number; pitch: number };
  length: number;
  drop: number;
}
export const KINDS = ['pegs', 'deflectors', 'splitter', 'chicane', 'spinners', 'funnel', 'gates', 'bumpers', 'step', 'zigzag', 'open', 'bend'] as const;
export type Kind = (typeof KINDS)[number];
const DEG = Math.PI / 180;

/** The top: the gate, heading north, the board already sloping. */
export const TOP = { p: [0, 400, 0] as V3, yaw: 0, pitch: -13 * DEG };

const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
const pick = <T>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

/** A curved wall: an arc of walls about a centre, from one angle to another (in the board's plane). */
function arc(walls: Wall[], cx: number, cy: number, radius: number, a0: number, a1: number, thick = 0.5) {
  const n = Math.max(3, Math.round((Math.abs(a1 - a0) * radius) / 3));
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    walls.push({ a: [cx + Math.cos(t0) * radius, cy + Math.sin(t0) * radius], b: [cx + Math.cos(t1) * radius, cy + Math.sin(t1) * radius], thick });
  }
}

/** A board of a kind from where the last ended, its particulars from the rng. */
export function section(kind: Kind, from: { p: V3; yaw: number; pitch: number }, r: Rand): Section {
  const slope = kind === 'open' ? -ramp(r, 14, 18) * DEG : -ramp(r, 10, 15) * DEG;
  const length = kind === 'step' ? ramp(r, 40, 56) : kind === 'bend' ? ramp(r, 84, 110) : ramp(r, 60, 96);
  const frame = frameAt(from.p, from.yaw, slope);
  const W = WIDTH, half = W / 2;
  const board: Board = { frame, width: W, length, slope, walls: [], pegs: [], spinners: [], backWall: false, step: 0 };
  // a bend turns a good way; some other boards turn a little (not the first: the gate is straight)
  if (kind === 'bend') board.turn = (r() < 0.5 ? -1 : 1) * ramp(r, 35, 65) * DEG;
  else if (kind !== 'step' && from !== TOP && r() < 0.35) board.turn = (r() < 0.5 ? -1 : 1) * ramp(r, 10, 26) * DEG;
  const s: Section = { kind, name: '', boards: [board], end: from, length, drop: 0 };
  // (the first 8 and last 6 are kept clear, so what comes in and goes out can)
  const clear0 = 8, clear1 = length - 6;
  switch (kind) {
    case 'pegs': {
      s.name = 'a field of pegs';
      const rows = Math.floor((clear1 - clear0) / 11);
      for (let i = 0; i < rows; i++) {
        const along = clear0 + 5 + i * 11;
        const n = 4 + (i % 2);
        for (let j = 0; j < n; j++) board.pegs.push([along + ramp(r, -1.5, 1.5), ((j + 0.5) / n - 0.5) * W * 0.9, ramp(r, 1.2, 2)]);
      }
      break;
    }
    case 'deflectors': {
      s.name = 'deflectors';
      // (slats and curved slats, all slanted: nothing a marble can rest against square to the slope)
      const n = Math.floor(ramp(r, 4, 7));
      for (let i = 0; i < n; i++) {
        const along = clear0 + ((clear1 - clear0) * (i + 0.5)) / n, across = ramp(r, -half * 0.55, half * 0.55);
        const side = r() < 0.5 ? 1 : -1;
        if (r() < 0.5) {
          const L = ramp(r, 10, 18), ang = ramp(r, 30, 50) * DEG;
          board.walls.push({ a: [along - (Math.cos(ang) * L) / 2, across - (side * Math.sin(ang) * L) / 2], b: [along + (Math.cos(ang) * L) / 2, across + (side * Math.sin(ang) * L) / 2], thick: 0.5 });
        } else {
          // (an arc with its round side up the board, from 32° off square to nearly along: steep everywhere)
          const radius = ramp(r, 8, 13);
          arc(board.walls, along + radius * 0.55, across + side * radius * 0.8, radius, Math.PI + side * 0.55, Math.PI + side * 1.4);
        }
        if (r() < 0.5) board.pegs.push([along + ramp(r, 4, 8), across - side * ramp(r, 6, 10), 1.6]);
      }
      break;
    }
    case 'splitter': {
      s.name = 'a splitter';
      // a V pointing up the board, then lanes, then out
      const tip = clear0 + 6, lanes = 2 + Math.floor(r() * 2);
      const spread = half * 0.7;
      board.walls.push({ a: [tip, 0], b: [tip + 18, -spread], thick: 0.5 }, { a: [tip, 0], b: [tip + 18, spread], thick: 0.5 });
      for (let k = 1; k < lanes; k++) {
        const x = (k / lanes - 0.5) * W * 0.5;
        board.walls.push({ a: [tip + 22, x], b: [Math.min(clear1, tip + 22 + ramp(r, 20, 30)), x + ramp(r, -6, 6)], thick: 0.5 });
      }
      board.pegs.push([clear1 - 4, ramp(r, -8, 8), 1.6]);
      break;
    }
    case 'chicane': {
      s.name = 'a chicane';
      const n = Math.max(2, Math.min(4, Math.floor((clear1 - clear0) / 22)));
      const span = (clear1 - clear0) / n;
      for (let i = 0; i < n; i++) {
        const along = clear0 + span * i;
        const side = i % 2 ? 1 : -1;
        // (a diagonal wall from one side most of the way across, leaving a gap at the other; shallow enough to slide down)
        board.walls.push({ a: [along, side * half], b: [along + Math.min(28, span - 4), -side * (half - ramp(r, 12, 16))], thick: 0.5 });
      }
      break;
    }
    case 'spinners': {
      s.name = 'spinners';
      const n = 2 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        const along = clear0 + ((clear1 - clear0) * (i + 0.5)) / n;
        const across = n === 1 ? 0 : ((i % 2) - 0.5) * W * 0.3 + ramp(r, -3, 3);
        board.spinners.push({ at: [along, across], arms: pick(r, [3, 4, 4]), half: ramp(r, 7, 10), rate: (r() < 0.5 ? -1 : 1) * ramp(r, 0.25, 0.5) });
        if (r() < 0.6) board.pegs.push([along + ramp(r, -6, 6), -Math.sign(across || 1) * ramp(r, 14, 19), 1.5]);
      }
      break;
    }
    case 'funnel': {
      s.name = 'a funnel';
      // the walls close in to a gap, then open again
      // (a gap three marbles wide: narrower, and twelve of them arch across it and jam, as grain does)
      const gap = ramp(r, 6.5, 8.5), waist = clear0 + ramp(r, 22, 32);
      board.walls.push({ a: [clear0, -half], b: [waist, -gap / 2], thick: 0.5 }, { a: [clear0, half], b: [waist, gap / 2], thick: 0.5 });
      board.walls.push({ a: [waist, -gap / 2], b: [waist + 6, -gap / 2], thick: 0.5 }, { a: [waist, gap / 2], b: [waist + 6, gap / 2], thick: 0.5 });
      // (and a fan of pegs to spread them again)
      for (let i = 0; i < 5; i++) board.pegs.push([waist + 16 + i * 5, (i - 2) * 5, 1.4]);
      break;
    }
    case 'gates': {
      s.name = 'gates';
      const n = Math.floor(ramp(r, 3, 5));
      for (let i = 0; i < n; i++) {
        const along = clear0 + ((clear1 - clear0) * (i + 0.4)) / n;
        // (chevrons across, pointing up the board, leaving gaps between: a different number each row;
        // a marble meeting one slides down a side to the gap)
        const gaps = 2 + (i % 2);
        const pitch = W / gaps;
        for (let g = 0; g <= gaps; g++) {
          const x = -half + g * pitch;
          const w = pitch * 0.28, d = w * Math.tan(38 * DEG);
          if (g > 0) board.walls.push({ a: [along, x], b: [along + d, x - w], thick: 0.5 });
          if (g < gaps) board.walls.push({ a: [along, x], b: [along + d, x + w], thick: 0.5 });
        }
      }
      break;
    }
    case 'bumpers': {
      s.name = 'bumpers';
      const n = Math.floor(ramp(r, 4, 7));
      for (let i = 0; i < n; i++) board.pegs.push([clear0 + ((clear1 - clear0) * (i + 0.5)) / n, ramp(r, -half * 0.6, half * 0.6), ramp(r, 3.5, 5.5)]);
      break;
    }
    case 'step': {
      s.name = 'a step down';
      // (the board in two: the second lower, so what flies off the edge lands between its sides)
      const h = ramp(r, 6, 10), la = length * 0.45;
      board.length = la;
      board.step = h;
      const p2 = add(add(frame.p, mul(frame.t, la)), [0, -h, 0]);
      // (closed at its start by the drop's face: what bounces back up it can't go under; and its
      // pegs well past where a flier lands, or it bounces off one back up the board)
      const lower: Board = { frame: frameAt(p2, from.yaw, slope), width: W, length: length - la, slope, walls: [], pegs: [], spinners: [], backWall: true, step: 0, sideH: WALL_H + h };
      for (let j = 0; j < 3; j++) lower.pegs.push([(length - la) * 0.75, (j - 1) * 12, 1.5]);
      s.boards.push(lower);
      break;
    }
    case 'zigzag': {
      s.name = 'a zigzag';
      // lanes that bend together: two walls in parallel bends
      // (one after another, never overlapping: two that overlap make a pocket a marble can't leave)
      const n = 3, span = (clear1 - clear0) / n;
      for (let i = 0; i < n; i++) {
        const along = clear0 + span * i;
        const side = i % 2 ? 1 : -1;
        board.walls.push({ a: [along, side * half * 0.35], b: [along + span - 2.5, -side * half * 0.35], thick: 0.5 });
      }
      break;
    }
    case 'open': {
      s.name = 'a straight';
      if (r() < 0.6) board.pegs.push([length * 0.5, ramp(r, -10, 10), 2]);
      break;
    }
    case 'bend': {
      s.name = `a bend to the ${board.turn! > 0 ? 'left' : 'right'}`;
      // (a few pegs, toward the outside, where they all end up)
      const n = 3 + Math.floor(r() * 3), out = -Math.sign(board.turn!);
      for (let i = 0; i < n; i++) board.pegs.push([clear0 + ((clear1 - clear0) * (i + 0.5)) / n, out * ramp(r, 2, 16), ramp(r, 1.5, 2.2)]);
      break;
    }
  }
  // (everything inside the board; a wall may meet a side, but never stop just short of it: a marble
  // coming down the side would wedge in the gap)
  const inside = (pt: [number, number]): [number, number] => [Math.max(1, Math.min(board.length - 1, pt[0])), Math.max(-half, Math.min(half, pt[1]))];
  for (const w of board.walls) { w.a = inside(w.a); w.b = inside(w.b); }
  board.pegs = board.pegs.map(([a, c, pr]) => [Math.max(6, Math.min(board.length - 3, a)), Math.max(-half + pr + 1, Math.min(half - pr - 1, c)), pr]);
  // the far edge: where the next board begins, heading on (turned, if the board bends)
  const lastB = s.boards[s.boards.length - 1];
  const endP = add(toWorld(lastB, lastB.length, 0, 0), [0, -lastB.step, 0]);
  s.end = { p: endP, yaw: from.yaw + s.boards.reduce((a, b) => a + (b.turn ?? 0), 0), pitch: slope };
  s.drop = from.p[1] - endP[1];
  return s;
}

/** The three candidates for the next board, by its place in the run and which three. */
export function candidates(seed: number, index: number, sections: Section[], page = 0): Section[] {
  const from = sections.length ? sections[sections.length - 1].end : TOP;
  const last = sections[sections.length - 1]?.kind;
  const out: Section[] = [];
  for (let k = 0; k < 3; k++) {
    const r = seeded(hash(seed, index, page * 3 + k, 0x3a7));
    let kind: Kind = pick(r, KINDS);
    for (let tries = 0; tries < 8 && (kind === last || (index === 0 && (kind === 'funnel' || kind === 'step' || kind === 'bend'))); tries++) kind = pick(r, KINDS);
    const s = section(kind, from, r);
    if (index === 0) s.boards[0].backWall = true;
    out.push(s);
  }
  return out;
}

/** A whole run: its sections from the seed and the choices (each a candidate's number: page * 3 + k). */
export function build(seed: number, choices: number[]): Section[] {
  const sections: Section[] = [];
  choices.forEach((c, i) => {
    const cs = candidates(seed, i, sections, Math.floor(c / 3));
    sections.push(cs[c % 3]);
  });
  return sections;
}

/** every marble: the same size (a glass marble, 16 mm across) */
export const MARBLE_R = 0.8;
/** the channel at the end: a marble and a half wide between the strips, so they come to rest in single file */
export const CHANNEL_HALF = MARBLE_R * 1.5 + 0.5;

/**
 * The finish: a funnel that brings everyone to a single gap, the chequered line across it, and
 * a channel beyond, one marble wide, closed at its far end: they come to rest in it in the order
 * they crossed, so the result is there to see.
 */
export function finish(end: { p: V3; yaw: number; pitch: number }): { board: Board; line: Frame; throat: number; lineAt: number; channelEnd: number } {
  const slope = -7 * DEG;
  const frame = frameAt(end.p, end.yaw, slope);
  const half = WIDTH / 2, ch = CHANNEL_HALF;
  const throat = 44, channelEnd = throat + FIELD_SIZE * MARBLE_R * 2 + 14;
  const length = channelEnd + 2;
  const walls: Wall[] = [
    { a: [0, -half], b: [throat, -ch], thick: 0.5 }, { a: [0, half], b: [throat, ch], thick: 0.5 },
    { a: [throat, -ch], b: [channelEnd, -ch], thick: 0.5 }, { a: [throat, ch], b: [channelEnd, ch], thick: 0.5 },
    { a: [channelEnd, -ch], b: [channelEnd, ch], thick: 0.5 },
  ];
  // (the line a little into the channel, where they are in single file for good: at the throat
  // itself two pressed together can still change places)
  const lineAt = throat + 5;
  const line = frameAt(add(frame.p, mul(frame.t, lineAt)), end.yaw, slope);
  return { board: { frame, width: WIDTH, length, slope, walls, pegs: [], spinners: [], backWall: false, step: 0 }, line, throat, lineAt, channelEnd };
}

/** The run as a query string, and back. */
export const encode = (seed: number, choices: number[]) => `seed=${seed}&run=${choices.join('.')}`;
export function decode(q: URLSearchParams): { seed: number; choices: number[] } {
  const seed = Number(q.get('seed')) || 0;
  const run = (q.get('run') ?? '').split('.').filter((x) => x !== '').map(Number).filter((x) => Number.isFinite(x) && x >= 0);
  return { seed, choices: run };
}
