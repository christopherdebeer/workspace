/**
 * Volley's game, on its own: a bouncy ball, a way without end, sheets of shards across it, and a hand.
 *
 * The way runs along z. Its section is H high and W wide (W is whatever the screen's shape makes it), centred on
 * the axis, and the ball rebounds from its four sides. You are a pane across the whole section, at `z`; the ball
 * goes on ahead of you into the sheets and comes back.
 *
 * A sheet is one fractured thing: a field of shards (the cells of a seeded Voronoi figure, each a convex polygon
 * with a thickness) with holes through it where shards were left out. The ball meets a shard as the solid it is.
 * It breaks the one it strikes; struck hard and square it goes through, and takes the shards round the place with
 * it, more of them the harder it was going. Glazed shards take two, and always turn the ball. Break most of a
 * sheet and what's left of it gives way.
 *
 * The ball is a ball thrown upward: it falls (G) back toward you. Thrown, it slows all the way, and if it meets
 * nothing it stops and comes back as fast as it left; so how hard it's thrown is how far it gets. A bounce keeps
 * most of its speed and not all; a throw's sideways motion leaves it spinning, and the spin bends its flight.
 *
 * There is no paddle. Wherever the ball comes back through the pane, a hand has to be there, and what the hand is
 * doing is how (and how hard) the ball leaves. A hand can be three things, and with the one hand (`mode` 'all') it is
 * whichever the finger is doing as the ball lands: moving, it hits; still and only just touched down, it catches;
 * still and long down, it is a pad. (A hit from a touch just made turns the ball more than one from a finger long
 * down, which is a bat being moved.) The other modes are each of the three alone.
 *
 * The pane goes forward down a clear way and halts before shards still standing. A ball let through the pane is one
 * of five gone. Everything random is from the seed, and the step is fixed.
 */
import { seeded, hash, type Rand } from '../kit/rng';

export const H = 10;
/** a sheet's thickness, the spacing of sheets, where the first is */
export const SHEET_T = 0.5, GAP = 13, FIRST = 14;
/** about how far apart a sheet's shards are; how much of itself a shard gives up to the joint round it */
export const GRAIN = 0.92, JOINT = 0.035;
/** how far a sheet runs on past the sides of the way (as a share of the way's width and height): its frame, which
 * the ball can't reach, there so that a sheet near you fills the eye */
export const FRAME = 0.5;
export const R = 0.34;
export const HAND_R = 1.15;
/** how far behind the pane a ball can still be reached */
export const LATE = 0.9;
export const FULL = 5;
/** how near the pane comes to shards still standing; the share of a sheet that, once all that's left, gives way;
 * and however big the sheet, this many broken is enough */
export const STAND = 3.6, GIVES = 0.4, MOST = 16;
export const STEP = 1 / 240;
export const MODES = ['all', 'pad', 'swipe', 'catch'] as const;
export type Mode = (typeof MODES)[number];

// the ball
/** the fall: back toward the pane */
export const G = 18;
/** what a bounce keeps: off a side, off a shard */
const WALL = 0.9, SHARD = 0.9;
/** a ball meeting a shard this fast (square on) goes through it, and keeps this much */
export const THROUGH = 19, KEEPS = 0.8;
/** going through, it takes the shards within this of where it struck, and this much further per unit of speed over */
const BURST = 0.75, BURST_PER = 0.07;
/** spin: how much of a hand's sideways speed becomes it, the most there can be, how hard it bends the flight, and
 * how long it lasts */
const SPIN_OF = 0.3, SPIN_MAX = 9, BEND = 1.3, SPIN_LIFE = 0.9;
// the hand
/** pad: how much of the ball's speed goes sideways at the pad's rim */
const PAD_K = 0.75;
/** how much of a finger's speed goes into the ball's direction */
const CARRY = { pad: 0.2, swipe: 0.35, catch: 0.35 };
/** the one hand ('all'): a touch younger than this when the ball lands is a catch; a moving finger's say over the
 * ball's direction, from a touch just made (a swipe at it) down to one long held (a bat being moved) */
export const FRESH = 0.3, SETTLED = 0.8;
const CARRY_FRESH = 0.42, CARRY_HELD = 0.16;
/** a finger slower than this isn't a swipe */
export const SWIPE_MIN = 5;
const MAX_SIDE = 0.8;
export const POWER_MAX = 34;

export type Phase = 'ready' | 'play' | 'held' | 'over';
export interface Hand { id: number; x: number; y: number; vx: number; vy: number; /** seconds since it touched down (left out: long ago) */ age?: number }
export type Act = 'pad' | 'hit' | 'catch';
/** What a hand is to a ball landing on it now. With the one hand: moving, it hits; still and only just down, it
 * catches; still and long down, it's a pad. */
export function actOf(mode: Mode, k: Hand): Act | null {
  const moving = Math.hypot(k.vx, k.vy) >= SWIPE_MIN;
  if (mode === 'pad') return 'pad';
  if (mode === 'swipe') return moving ? 'hit' : null;
  if (mode === 'catch') return 'catch';
  return moving ? 'hit' : (k.age ?? 9) < FRESH ? 'catch' : 'pad';
}

/** what a shard is made of: plain, fired red, or glazed (which takes two, and always turns the ball) */
export const PLAIN = 0, RED = 1, GLAZED = 2;
export interface Shard {
  /** its outline: x, y pairs, counter-clockwise, convex */
  poly: number[];
  cx: number; cy: number;
  /** the furthest its outline gets from (cx, cy) */
  r: number;
  hp: number;
  kind: number;
  /** beyond the sides of the way: the ball can't reach it, and it isn't counted */
  frame: boolean;
  /** the shards it shares an edge with */
  nb: number[];
}
export interface Sheet { i: number; z: number; shards: Shard[]; left: number; total: number; /** goes up whenever a shard of it changes */ ver: number }
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number; sx: number; sy: number }
export type Ev =
  /** a shard struck: `broke` if that was the end of it, `through` if the ball went on through, `chain` if it went
   * with a neighbour that was struck */
  | { kind: 'shard'; x: number; y: number; z: number; sheet: number; shard: number; broke: boolean; through: boolean; chain: boolean; hard: number }
  /** a shard of a sheet that has given way */
  | { kind: 'fall'; x: number; y: number; z: number; sheet: number; shard: number }
  | { kind: 'wall' | 'hand'; x: number; y: number; z: number; hard: number }
  | { kind: 'catch' | 'serve' | 'miss' | 'over' | 'pass' | 'through'; x: number; y: number; z: number };

export interface Sim {
  seed: number;
  W: number;
  mode: Mode;
  /** where the pane is, and how fast it's going */
  z: number; v: number;
  ball: Ball;
  phase: Phase;
  heldBy: number;
  integrity: number;
  broken: number; passed: number; returns: number;
  sheets: Sheet[];
  nextSheet: number;
  /** the hands on the pane now (set by whoever reads the fingers) */
  hands: Hand[];
  events: Ev[];
  rand: Rand;
  /** the stand-in's mark: the shard it's trying for */
  mark: { x: number; y: number; z: number } | null;
  turn: 'pad' | 'swipe' | 'catch';
  t: number; acc: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const unit = (...n: number[]) => hash(...n) / 4294967296;
const sheetZ = (seed: number, i: number) => FIRST + GAP * i - (i >= 3 && hash(seed, i, 5) % 4 === 0 ? GAP - 2.6 : 0);
/** how fast the pane would go: freely down a clear way, slowing to a halt STAND short of shards still standing */
export function driftFor(s: Sim): number {
  const sh = s.sheets.find((k) => k.left > 0), d = sh ? sh.z - SHEET_T / 2 - s.z : 99;
  const u = clamp((d - STAND) / 7, 0, 1);
  return Math.min(12, 6.5 + 0.15 * s.passed) * u * (2 - u);
}
/** how hard a hand sends the ball: by the kind of hand, how fast the finger was going, and (a pad) how fast it came */
export function power(s: Sim, mode: 'pad' | 'swipe' | 'catch', finger: number, came = 0): number {
  const deep = Math.min(4, s.passed * 0.12);
  const p = mode === 'pad' ? Math.max(17, came * 0.9) + finger * 0.4 : mode === 'swipe' ? 9 + finger * 0.75 : 14 + finger * 0.65;
  return clamp(p + deep, 13, POWER_MAX);
}

// ─── a sheet ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** the holes of sheet `i`: is this point in one? and, for the round ones, how far outside its rim (for glazing) */
function holesOf(seed: number, i: number, W: number) {
  const rand = seeded(hash(seed, i, 31)), kind = i === 0 ? 0 : Math.floor(rand() * 6), m = Math.min(W, H);
  // (fewer and smaller the further out: the sheets fill in)
  const open = Math.max(0.55, 1 - i * 0.02);
  const rounds: { x: number; y: number; r: number; glazed: boolean }[] = [];
  const round = (x: number, y: number, r: number) => rounds.push({ x, y, r: r * open, glazed: i >= 1 && rand() < Math.min(0.8, 0.3 + 0.04 * i) });
  const tests: ((x: number, y: number) => boolean)[] = [];
  if (kind === 0) { // an eye: one big hole, two small
    round((rand() - 0.5) * W * 0.2, (rand() - 0.5) * H * 0.2, m * 0.36);
    round(-W * 0.24, H * 0.36, m * 0.17); round(W * 0.24, -H * 0.36, m * 0.17);
  } else if (kind === 1 || kind === 5) { // a few holes, or a scatter of small ones
    const n = kind === 1 ? 3 + Math.floor(rand() * 2) : 7 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) round((rand() - 0.5) * W * 0.85, (rand() - 0.5) * H * 0.85, kind === 1 ? 0.9 + rand() * 0.9 : 0.55 + rand() * 0.4);
  } else if (kind === 2) { // arches, in rows
    const rows = 2 + Math.floor(rand() * 2), r = Math.min(W / 5, 1.5) * open;
    for (let a = 0; a < rows; a++) {
      const y0 = -H / 2 + ((a + 0.5) * H) / rows - r * 0.6, n = Math.max(1, Math.floor(W / (r * 2.7))), off = a % 2 ? 0.5 : 0;
      for (let k = 0; k < n + 1; k++) { const x0 = -W / 2 + ((k + 0.5 - off) * W) / n; tests.push((x, y) => Math.abs(x - x0) < r && y > y0 - r * 0.9 && (y < y0 || Math.hypot(x - x0, y - y0) < r)); }
    }
  } else if (kind === 3) { // a rose: petals round a centre
    const petals = 3 + Math.floor(rand() * 4), r0 = m * 0.44 * open, turn = rand() * 6.28, x0 = (rand() - 0.5) * W * 0.15, y0 = (rand() - 0.5) * H * 0.2;
    tests.push((x, y) => { const d = Math.hypot(x - x0, y - y0), a = Math.atan2(y - y0, x - x0) + turn; return d < r0 * (0.3 + 0.7 * Math.abs(Math.cos((petals * a) / 2)) ** 1.5) && d > r0 * 0.16; });
  } else { // bands across
    const a = rand() * Math.PI, nx = Math.cos(a), ny = Math.sin(a), w = 0.75 * open, gap = 2.9 + rand() * 1.2, off = rand() * gap;
    tests.push((x, y) => { const d = (((x * nx + y * ny + off) % gap) + gap) % gap; return d < w * 2; });
  }
  return {
    hole: (x: number, y: number) => rounds.some((o) => Math.hypot(x - o.x, y - o.y) < o.r) || tests.some((f) => f(x, y)),
    glazed: (x: number, y: number) => rounds.some((o) => o.glazed && Math.hypot(x - o.x, y - o.y) < o.r + GRAIN * 0.75),
  };
}

/** Sheet `i` of this seed's way: scattered sites, each one's Voronoi cell a shard, the ones in a hole left out. */
export function makeSheet(seed: number, i: number, W: number): Sheet {
  const ex = W * (0.5 + FRAME), ey = H * (0.5 + FRAME), { hole, glazed } = holesOf(seed, i, W);
  // sites: a staggered grid, each shaken
  const sx: number[] = [], sy: number[] = [];
  const nx = Math.max(2, Math.round((2 * ex) / GRAIN)), ny = Math.max(2, Math.round((2 * ey) / (GRAIN * 0.9))), gx = (2 * ex) / nx, gy = (2 * ey) / ny;
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    sx.push(-ex + (c + 0.5 + (r % 2 ? 0.25 : -0.25)) * gx + (unit(seed, i, r, c, 1) - 0.5) * gx * 0.8);
    sy.push(-ey + (r + 0.5) * gy + (unit(seed, i, r, c, 2) - 0.5) * gy * 0.8);
  }
  const n = sx.length, shards: Shard[] = [], index = new Int32Array(n).fill(-1), raw: number[][] = [];
  // (the frame's own edge is ragged: a sheet is a broken-off piece, not a board)
  const ragged = (x: number, y: number) => { const a = Math.atan2(y / ey, x / ex), d = Math.hypot(x / ex, y / ey); return d > 0.8 + 0.14 * Math.sin(a * 3 + i * 1.7 + seed) + 0.1 * Math.sin(a * 7 + i * 2.9); };
  for (let a = 0; a < n; a++) {
    const frame = Math.abs(sx[a]) > W / 2 || Math.abs(sy[a]) > H / 2;
    if (frame ? ragged(sx[a], sy[a]) : hole(sx[a], sy[a])) continue;
    // its cell: the sheet's whole rectangle, cut by the line halfway to each other site, nearest first
    let poly = [-ex, -ey, ex, -ey, ex, ey, -ex, ey];
    // (only the sites a few rows and columns round it can matter)
    const ar = Math.floor(a / nx), acol = a % nx, near: number[] = [];
    for (let r = Math.max(0, ar - 3); r <= Math.min(ny - 1, ar + 3); r++) for (let c = Math.max(0, acol - 3); c <= Math.min(nx - 1, acol + 3); c++) if (r * nx + c !== a) near.push(r * nx + c);
    near.sort((p, q) => (sx[p] - sx[a]) ** 2 + (sy[p] - sy[a]) ** 2 - (sx[q] - sx[a]) ** 2 - (sy[q] - sy[a]) ** 2);
    const cut: number[] = [];
    for (const b of near) {
      const dx = sx[b] - sx[a], dy = sy[b] - sy[a], d2 = dx * dx + dy * dy;
      let far = 0;
      for (let k = 0; k < poly.length; k += 2) far = Math.max(far, (poly[k] - sx[a]) ** 2 + (poly[k + 1] - sy[a]) ** 2);
      if (d2 > 4 * far) break; // (too far to cut it, and so is every one after)
      const mx = sx[a] + dx / 2, my = sy[a] + dy / 2, out: number[] = [];
      let did = false;
      for (let k = 0; k < poly.length; k += 2) {
        const x0 = poly[k], y0 = poly[k + 1], x1 = poly[(k + 2) % poly.length], y1 = poly[(k + 3) % poly.length];
        const s0 = (x0 - mx) * dx + (y0 - my) * dy, s1 = (x1 - mx) * dx + (y1 - my) * dy;
        if (s0 <= 0) out.push(x0, y0); else did = true;
        if (s0 <= 0 !== s1 <= 0) { const t = s0 / (s0 - s1); out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); }
      }
      if (did) cut.push(b);
      poly = out;
      if (poly.length < 6) break;
    }
    if (poly.length < 6) continue;
    let cx = 0, cy = 0;
    for (let k = 0; k < poly.length; k += 2) { cx += poly[k]; cy += poly[k + 1]; }
    cx /= poly.length / 2; cy /= poly.length / 2;
    let r = 0;
    for (let k = 0; k < poly.length; k += 2) { poly[k] = cx + (poly[k] - cx) * (1 - JOINT); poly[k + 1] = cy + (poly[k + 1] - cy) * (1 - JOINT); r = Math.max(r, Math.hypot(poly[k] - cx, poly[k + 1] - cy)); }
    const kind = !frame && glazed(sx[a], sy[a]) ? GLAZED : unit(seed, i, a, 7) < 0.15 ? RED : PLAIN;
    index[a] = shards.length; raw.push(cut);
    shards.push({ poly, cx, cy, r, hp: kind === GLAZED ? 2 : 1, kind, frame, nb: [] });
  }
  shards.forEach((s, k) => { s.nb = raw[k].map((b) => index[b]).filter((b) => b >= 0); });
  let left = shards.reduce((c, s) => c + (s.frame ? 0 : 1), 0);
  if (!left) { const s = shards.reduce((a, b) => (Math.hypot(b.cx, b.cy) < Math.hypot(a.cx, a.cy) ? b : a)); s.frame = false; left = 1; }
  return { i, z: sheetZ(seed, i), shards, left, total: left, ver: 0 };
}

/** The nearest point of a shard's outline to (x, y), or (x, y) itself if it's inside. */
function nearest(poly: number[], x: number, y: number): [number, number] {
  let inside = true, bx = 0, by = 0, bd = Infinity;
  for (let k = 0; k < poly.length; k += 2) {
    const x0 = poly[k], y0 = poly[k + 1], ex = poly[(k + 2) % poly.length] - x0, ey = poly[(k + 3) % poly.length] - y0;
    if (ex * (y - y0) - ey * (x - x0) < 0) inside = false;
    const t = clamp(((x - x0) * ex + (y - y0) * ey) / (ex * ex + ey * ey), 0, 1), px = x0 + ex * t, py = y0 + ey * t, d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; bx = px; by = py; }
  }
  return inside ? [x, y] : [bx, by];
}

// ─── the game ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function create(seed = 1, aspect = 0.46, mode: Mode = 'all'): Sim {
  const s: Sim = {
    seed, W: H * aspect, mode, z: 0, v: 0, ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0 }, phase: 'ready', heldBy: 0,
    integrity: FULL, broken: 0, passed: 0, returns: 0, sheets: [], nextSheet: 0, hands: [], events: [], rand: seeded(hash(seed, 9)), mark: null, turn: 'pad', t: 0, acc: 0,
  };
  grow(s); rest(s);
  return s;
}
export function restart(s: Sim) {
  if (s.phase !== 'over') return;
  Object.assign(s, { z: 0, v: 0, integrity: FULL, broken: 0, passed: 0, returns: 0, sheets: [], nextSheet: 0, phase: 'ready', mark: null });
  grow(s); rest(s);
}
function grow(s: Sim) { while (sheetZ(s.seed, s.nextSheet) < s.z + 100) s.sheets.push(makeSheet(s.seed, s.nextSheet++, s.W)); }
function rest(s: Sim) { Object.assign(s.ball, { x: 0, y: 0, z: s.z + R + 0.05, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0 }); }
const at = (s: Sim) => ({ x: s.ball.x, y: s.ball.y, z: s.ball.z });
export const speed = (b: Ball) => Math.hypot(b.vx, b.vy, b.vz);

/** send the ball off from 'ready', leaning toward (ax, ay) (each -1..1 across the pane) */
export function serve(s: Sim, ax = 0, ay = 0) {
  if (s.phase !== 'ready') return;
  leave(s, 20 + Math.min(4, s.passed * 0.12), clamp(ax, -1, 1) * 4, clamp(ay, -1, 1) * 4, 0, 0);
  s.phase = 'play';
  s.events.push({ kind: 'serve', ...at(s) });
}
/** pick the waiting ball up under this finger (the hands that can catch) */
export function grab(s: Sim, id: number) {
  if (s.phase !== 'ready' || (s.mode !== 'catch' && s.mode !== 'all')) return;
  s.phase = 'held'; s.heldBy = id;
}
/** the finger holding the ball has let go, moving like this */
export function release(s: Sim, id: number, vx = 0, vy = 0) {
  if (s.phase !== 'held' || s.heldBy !== id) return;
  const p = power(s, 'catch', Math.hypot(vx, vy));
  leave(s, p, vx * CARRY.catch, vy * CARRY.catch, vx, vy);
  s.phase = 'play'; s.returns++;
  s.events.push({ kind: 'hand', ...at(s), hard: p });
}
/** the ball leaves the pane this fast, with this much of it sideways (never most of it), spun by the finger */
function leave(s: Sim, p: number, lx: number, ly: number, fvx: number, fvy: number) {
  const m = Math.hypot(lx, ly), k = m > MAX_SIDE * p ? (MAX_SIDE * p) / m : 1, b = s.ball;
  b.vx = lx * k; b.vy = ly * k; b.vz = Math.sqrt(Math.max(0, p * p - b.vx * b.vx - b.vy * b.vy));
  const sm = Math.hypot(fvx, fvy) * SPIN_OF, sk = sm > SPIN_MAX ? SPIN_MAX / sm : 1;
  b.sx = fvx * SPIN_OF * sk; b.sy = fvy * SPIN_OF * sk;
  b.z = Math.max(b.z, s.z + R + 0.02);
  s.mark = null;
}

/** The ball's own motion for one step, with the four sides: falling back toward you, bent by its spin, bouncing.
 * Returns how hard it struck a side, if it did. (The game's step and the guess at where it will come back both use
 * this.) */
function fly(b: Ball, W: number, h: number): number {
  b.vz -= G * h;
  b.vx += b.sx * BEND * h; b.vy += b.sy * BEND * h;
  const fade = 1 - h / SPIN_LIFE; b.sx *= fade; b.sy *= fade;
  b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
  const hx = W / 2 - R, hy = H / 2 - R;
  let struck = 0;
  if (b.x < -hx && b.vx < 0) { b.x = -hx; struck = -b.vx; b.vx *= -WALL; b.sx *= 0.4; }
  if (b.x > hx && b.vx > 0) { b.x = hx; struck = b.vx; b.vx *= -WALL; b.sx *= 0.4; }
  if (b.y > hy && b.vy > 0) { b.y = hy; struck = b.vy; b.vy *= -WALL; b.sy *= 0.4; }
  if (b.y < -hy && b.vy < 0) { b.y = -hy; struck = -b.vy; b.vy *= -WALL; b.sy *= 0.4; }
  return struck;
}

/** one shard of a sheet takes a blow: an event, and (if that's the end of it) the counts */
function strike(s: Sim, sh: Sheet, k: number, through: boolean, chain: boolean, hard: number) {
  const d = sh.shards[k], broke = --d.hp === 0;
  sh.ver++;
  if (broke) { s.broken++; if (!d.frame) sh.left--; }
  s.events.push({ kind: 'shard', x: d.cx, y: d.cy, z: sh.z, sheet: sh.i, shard: k, broke, through, chain, hard });
}

function tick(s: Sim) {
  const h = STEP, b = s.ball;
  s.t += h;
  if (s.phase === 'over') return;
  if (s.phase === 'ready') { rest(s); return; }
  // the pane goes on: freely down a clear way, to a halt before shards still standing
  s.v += clamp(driftFor(s) - s.v, -20 * h, 9 * h);
  s.z += s.v * h;
  while (s.sheets.length && s.z >= s.sheets[0].z - SHEET_T / 2) { s.sheets.shift(); s.passed++; s.events.push({ kind: 'pass', x: 0, y: 0, z: s.z }); }
  grow(s);
  if (s.phase === 'held') {
    const hand = s.hands.find((k) => k.id === s.heldBy);
    if (!hand) { release(s, s.heldBy); return; }
    b.x = clamp(hand.x, -s.W / 2 + R, s.W / 2 - R); b.y = clamp(hand.y, -H / 2 + R, H / 2 - R); b.z = s.z + R + 0.05;
    return;
  }
  const struck = fly(b, s.W, h);
  if (struck > 2) s.events.push({ kind: 'wall', ...at(s), hard: struck });
  // the shards: of the sheets it's in, the shard it's deepest into
  let hit: Sheet | null = null, hk = 0, bd = R, nx = 0, ny = 0, nz = 0;
  for (const sh of s.sheets) {
    if (sh.z - SHEET_T / 2 > b.z + R) break;
    if (sh.z + SHEET_T / 2 < b.z - R) continue;
    for (let k = 0; k < sh.shards.length; k++) {
      const d = sh.shards[k];
      if (!d.hp || (b.x - d.cx) ** 2 + (b.y - d.cy) ** 2 > (d.r + R) ** 2) continue;
      const [qx, qy] = nearest(d.poly, b.x, b.y), qz = clamp(b.z, sh.z - SHEET_T / 2, sh.z + SHEET_T / 2);
      let dx = b.x - qx, dy = b.y - qy, dz = b.z - qz, dist = Math.hypot(dx, dy, dz);
      if (dist >= bd) continue;
      // (its centre is inside the shard: out by the nearer face)
      if (dist < 1e-6) { dx = dy = 0; dz = b.z < sh.z ? -1 : 1; dist = 0; } else { dx /= dist; dy /= dist; dz /= dist; }
      hit = sh; hk = k; bd = dist; nx = dx; ny = dy; nz = dz;
    }
  }
  if (hit) {
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn < 0) {
      const d = hit.shards[hk], hard = -vn;
      // (hard enough, and square on: through it and on, and the shards round the place go with it; otherwise off it)
      const through = d.hp === 1 && hard >= THROUGH && Math.abs(nz) > 0.7;
      strike(s, hit, hk, through, false, hard);
      if (through) {
        b.vx *= KEEPS; b.vy *= KEEPS; b.vz *= KEEPS;
        const reach = BURST + (hard - THROUGH) * BURST_PER;
        hit.shards.forEach((o, k) => { if (o.hp === 1 && Math.hypot(o.cx - b.x, o.cy - b.y) < reach + o.r * 0.5) strike(s, hit!, k, false, true, hard); });
      } else {
        b.vx -= (1 + SHARD) * vn * nx; b.vy -= (1 + SHARD) * vn * ny; b.vz -= (1 + SHARD) * vn * nz;
        b.x += nx * (R - bd); b.y += ny * (R - bd); b.z += nz * (R - bd);
        // (pushed out of the shard, but not out of the way)
        b.x = clamp(b.x, -s.W / 2 + R, s.W / 2 - R); b.y = clamp(b.y, -H / 2 + R, H / 2 - R);
        b.sx *= 0.4; b.sy *= 0.4;
      }
      // (broken through: what's left of the sheet gives way, frame and all)
      if (hit.left > 0 && hit.total - hit.left >= Math.min(Math.ceil(hit.total * (1 - GIVES)), MOST)) {
        hit.shards.forEach((o, k) => { if (o.hp) { o.hp = 0; s.broken++; s.events.push({ kind: 'fall', x: o.cx, y: o.cy, z: hit!.z, sheet: hit!.i, shard: k }); } });
        hit.left = 0; hit.ver++;
        s.events.push({ kind: 'through', x: 0, y: 0, z: hit.z });
      }
    }
  }
  // (the pane, going on, never overtakes a ball that's going the same way: it's pushed along)
  if (b.vz >= 0 && b.z - R < s.z + 0.02) { b.z = s.z + R + 0.02; b.vz = Math.max(b.vz, s.v + 6); }
  // the pane: is there a hand where it comes through?
  if (b.vz < 0 && b.z - R <= s.z && b.z >= s.z - LATE) {
    let best: Hand | null = null, bestD = Infinity, act: Act = 'pad';
    for (const k of s.hands) {
      const d = Math.hypot(b.x - k.x, b.y - k.y), a = actOf(s.mode, k);
      if (a && d <= (a === 'hit' ? HAND_R * 1.5 : HAND_R + R * 0.5) && d < bestD) { best = k; bestD = d; act = a; }
    }
    if (best) {
      if (act === 'catch') {
        s.phase = 'held'; s.heldBy = best.id; Object.assign(b, { vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, z: s.z + R + 0.05 });
        s.events.push({ kind: 'catch', ...at(s) });
      } else {
        const f = Math.hypot(best.vx, best.vy), came = speed(b);
        // (the one hand's hit: a touch just made is a swipe at the ball; one long held is a bat being moved, which
        // turns the ball less, and by where on it the ball landed as well)
        const u = s.mode === 'all' && act === 'hit' ? clamp(((best.age ?? 9) - FRESH) / (SETTLED - FRESH), 0, 1) : act === 'pad' ? 1 : 0;
        const p = s.mode === 'all' && act === 'hit' ? power(s, 'swipe', f) * (1 - u) + power(s, 'pad', f, came) * u : power(s, act === 'pad' ? 'pad' : 'swipe', f, came);
        const k = ((act === 'pad' ? 1 : u * 0.5) * PAD_K * p) / HAND_R;
        const c = act === 'pad' ? CARRY.pad : s.mode === 'all' ? CARRY_FRESH + (CARRY_HELD - CARRY_FRESH) * u : CARRY.swipe;
        leave(s, p, (b.x - best.x) * k + best.vx * c, (b.y - best.y) * k + best.vy * c, best.vx, best.vy);
        s.returns++;
        s.events.push({ kind: 'hand', ...at(s), hard: p });
      }
    }
  }
  if (b.z < s.z - LATE - 1.5) {
    s.integrity--;
    s.events.push({ kind: 'miss', ...at(s) });
    if (!s.integrity) { s.phase = 'over'; s.events.push({ kind: 'over', ...at(s) }); } else { s.phase = 'ready'; rest(s); }
  }
}

/** Run the game on by `dt` seconds (in fixed steps; what's left over is kept). Events since are in `s.events`. */
export function advance(s: Sim, dt: number, auto = false) {
  s.events.length = 0;
  s.acc += Math.min(dt, 0.25);
  while (s.acc >= STEP) {
    s.acc -= STEP;
    if (auto) standIn(s);
    tick(s);
  }
}

/** Where and when the ball will come back through the pane, were nothing but the sides in its way: its flight run
 * on (falling, bending, bouncing), the pane going as it's going. */
export function crossing(s: Sim): { x: number; y: number; t: number; speed: number } | null {
  if (s.phase !== 'play' || s.ball.vz >= 0) return null;
  const b = { ...s.ball }, h = 1 / 120;
  let z = s.z;
  for (let t = 0; t < 3; t += h) {
    if (b.z - R <= z) return { x: b.x, y: b.y, t, speed: speed(b) };
    fly(b, s.W, h); z += s.v * h;
  }
  return null;
}

/** A player to watch: picks the ball up, is where it comes back, and tries for a shard of the nearest sheet,
 * throwing hard enough to get there. */
function standIn(s: Sim) {
  s.hands.length = 0;
  if (s.phase === 'over') { if (s.t % 3 < STEP) restart(s); return; }
  if (s.phase === 'ready') { if (s.t % 0.8 < STEP) { if (s.mode === 'catch' || s.mode === 'all') grab(s, -1); else serve(s, s.rand() * 2 - 1, s.rand() * 2 - 1); } return; }
  const p = s.phase === 'held' ? { x: s.ball.x, y: s.ball.y, t: 0, speed: 0 } : crossing(s);
  if (!p || p.t > 0.5) return;
  if (!s.mark) {
    const sh = s.sheets.find((k) => k.left > 0);
    if (sh) {
      let n = Math.floor(s.rand() * sh.left);
      for (const d of sh.shards) if (d.hp && !d.frame && n-- === 0) s.mark = { x: clamp(d.cx, -s.W / 2 + R, s.W / 2 - R), y: clamp(d.cy, -H / 2 + R, H / 2 - R), z: sh.z };
    }
    s.mark ??= { x: 0, y: 0, z: s.z + 20 };
    // (with the one hand, it takes turns being each)
    s.turn = s.mode === 'all' ? (['pad', 'swipe', 'catch'] as const)[Math.floor(s.rand() * 3)] : s.mode;
  }
  const as = s.turn;
  const dx = s.mark.x - p.x, dy = s.mark.y - p.y, dz = Math.max(1, s.mark.z - SHEET_T / 2 - R - s.z);
  // (the sideways speed that gets it there, at this power: a few rounds, since each depends on the other)
  const aim = (pw: number) => { let lx = 0, ly = 0; for (let i = 0; i < 4; i++) { const vz = Math.sqrt(Math.max(pw * pw * 0.3, pw * pw - lx * lx - ly * ly)), rise = vz * vz - 2 * G * dz, T = rise > 0 ? (vz - Math.sqrt(rise)) / G : vz / G; lx = dx / T; ly = dy / T; } return { lx, ly }; };
  // (and it has to get there at all: thrown up, it's slowing all the way)
  const need = Math.sqrt(2 * G * dz) * 1.3;
  if (as === 'pad') {
    const pw = power(s, 'pad', 0, p.speed), { lx, ly } = aim(pw);
    let ox = lx / (PAD_K * pw), oy = ly / (PAD_K * pw);
    const m = Math.hypot(ox, oy), k = m > 0.9 ? 0.9 / m : 1;
    ox *= k; oy *= k;
    // (what the pad's rim can't give, the finger does: it's moving as the ball lands)
    let vx = (lx - ox * PAD_K * pw) / CARRY.pad, vy = (ly - oy * PAD_K * pw) / CARRY.pad;
    const fm = Math.hypot(vx, vy), fk = s.mode === 'all' ? 0 : fm > 30 ? 30 / fm : 1;
    vx *= fk; vy *= fk;
    s.hands.push({ id: -1, x: p.x - ox * HAND_R, y: p.y - oy * HAND_R, vx, vy, age: 9 });
  } else {
    // (a finger's speed is both how hard and how far sideways: find the speed whose throw wants that much sideways)
    let f = 22, vx = 0, vy = f;
    for (let i = 0; i < 5; i++) {
      const thrown = s.phase === 'held', c = thrown ? CARRY.catch : s.mode === 'all' ? CARRY_FRESH : CARRY.swipe;
      const { lx, ly } = aim(power(s, thrown ? 'catch' : 'swipe', f)), m = Math.hypot(lx, ly) || 1e-6;
      f = clamp(Math.max(m / c, thrown ? (need - 14) / 0.65 : (need - 9) / 0.75), SWIPE_MIN * 1.3, 40);
      vx = (lx / m) * f; vy = (ly / m) * f;
    }
    if (s.phase === 'held') { release(s, -1, vx, vy); return; }
    // (to catch: a still finger, only just down)
    if (as === 'catch') s.hands.push({ id: -1, x: p.x, y: p.y, vx: 0, vy: 0, age: 0 }); else s.hands.push({ id: -1, x: p.x, y: p.y, vx, vy, age: 0 });
  }
}
