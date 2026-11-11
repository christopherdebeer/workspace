/**
 * Volley's game, on its own: a bouncy ball, a tunnel without end, slabs of bricks across it, and a hand.
 *
 * The tunnel runs along z. Its section is H high and W wide (W is whatever the screen's shape makes it), centred on
 * the axis. You are a pane of glass across the whole section, at `z`; the ball goes on ahead of you into the slabs
 * and comes back.
 *
 * The tunnel is a shaft, and you are lying at the bottom of it looking up: the ball falls (G) back down toward
 * you. Thrown up, it slows all the way, and if it meets nothing it stops and comes down again as fast as it left;
 * so how hard it's thrown is how high it gets. A bounce keeps most of its speed and not all; a throw's sideways
 * motion leaves it spinning, and the spin bends its flight until a bounce or the air takes it off. Thrown hard
 * enough it goes through a brick and on up into the next.
 *
 * There is no paddle. Wherever the ball comes back through the glass, a hand has to be there, and what the hand is
 * doing is how (and how hard) the ball leaves. A hand can be three things, and with the one hand (`mode` 'all') it is
 * whichever the finger is doing as the ball lands: moving, it hits; still and only just touched down, it catches;
 * still and long down, it is a pad. (A hit from a touch just made turns the ball more than one from a finger long
 * down, which is a bat being moved.) The other modes are each of the three alone:
 *
 *   pad    a finger on the glass is a sprung pad: the ball leaves by where on the pad it lands, about as fast as it
 *          came (never slow); a finger moving as it lands adds to it
 *   swipe  only a moving finger counts: the ball leaves the way the finger was going, as hard as it was going
 *   catch  a finger under the ball catches it; it is thrown when the finger lets go, the way and as hard as the
 *          finger was going (let go of a still finger and it's a toss)
 *
 * The glass goes forward down a clear tunnel and halts before bricks still standing. Break most of a slab and the
 * rest of it falls: you go on. A ball let through the glass is one of five gone. Everything random is from the seed,
 * and the step is fixed.
 */
import { seeded, hash, type Rand } from '../kit/rng';

export const H = 10, ROWS = 8, CELL = H / ROWS;
export const BRICK_T = 0.9, GAP = 13, FIRST = 18;
/** how far a brick stops short of its cell on each side */
export const JOINT = 0.04;
export const R = 0.34;
export const HAND_R = 1.15;
/** how far behind the glass a ball can still be reached */
export const LATE = 0.9;
export const FULL = 5;
/** how near the glass comes to bricks still standing; the share of a slab that, once all that's left, falls; and
 * however big the slab, this many broken is enough */
export const STAND = 3.6, GIVES = 0.4, MOST = 10;
export const STEP = 1 / 240;
export const MODES = ['all', 'pad', 'swipe', 'catch'] as const;
export type Mode = (typeof MODES)[number];

// the ball
/** the fall: back down the shaft, toward the glass */
export const G = 18;
/** what a bounce keeps: off a wall, off a brick */
const WALL = 0.9, BRICK = 0.9;
/** a ball meeting a brick this fast (along the tunnel) goes through it, and keeps this much */
export const THROUGH = 19, KEEPS = 0.8;
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
export interface Slab { i: number; z: number; cells: Uint8Array; left: number; total: number; hue: number }
export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number; sx: number; sy: number }
export type Ev =
  | { kind: 'brick'; x: number; y: number; z: number; hue: number; row: number; broke: boolean; through: boolean; hard: number }
  | { kind: 'fall'; x: number; y: number; z: number; hue: number; row: number }
  | { kind: 'wall' | 'hand'; x: number; y: number; z: number; hard: number }
  | { kind: 'catch' | 'serve' | 'miss' | 'over' | 'pass' | 'through'; x: number; y: number; z: number };

export interface Sim {
  seed: number;
  W: number; cols: number;
  mode: Mode;
  /** where the glass is, and how fast it's going */
  z: number; v: number;
  ball: Ball;
  phase: Phase;
  heldBy: number;
  integrity: number;
  broken: number; passed: number; returns: number;
  slabs: Slab[];
  nextSlab: number;
  /** the hands on the glass now (set by whoever reads the fingers) */
  hands: Hand[];
  events: Ev[];
  rand: Rand;
  /** the stand-in's mark: the brick it's trying for */
  mark: { x: number; y: number; z: number } | null;
  turn: 'pad' | 'swipe' | 'catch';
  t: number; acc: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const cellX = (s: { W: number; cols: number }, c: number) => -s.W / 2 + (c + 0.5) * (s.W / s.cols);
export const cellY = (r: number) => -H / 2 + (r + 0.5) * CELL;
export const colsFor = (aspect: number) => Math.max(3, Math.round((H * aspect) / CELL));
const slabZ = (seed: number, i: number) => FIRST + GAP * i - (i >= 3 && hash(seed, i, 5) % 4 === 0 ? GAP - 2.6 : 0);
/** how fast the glass would go: freely down a clear tunnel, slowing to a halt STAND short of bricks still standing */
export function driftFor(s: Sim): number {
  const sl = s.slabs.find((k) => k.left > 0), d = sl ? sl.z - BRICK_T / 2 - s.z : 99;
  const u = clamp((d - STAND) / 7, 0, 1);
  return Math.min(12, 6.5 + 0.15 * s.passed) * u * (2 - u);
}
/** how hard a hand sends the ball: by the kind of hand, how fast the finger was going, and (a pad) how fast it came */
export function power(s: Sim, mode: 'pad' | 'swipe' | 'catch', finger: number, came = 0): number {
  const deep = Math.min(4, s.passed * 0.12);
  const p = mode === 'pad' ? Math.max(17, came * 0.9) + finger * 0.4 : mode === 'swipe' ? 9 + finger * 0.75 : 14 + finger * 0.65;
  return clamp(p + deep, 13, POWER_MAX);
}

/** Slab `i` of this seed's tunnel: one of a few figures across the section, denser and harder the deeper it is. */
export function makeSlab(seed: number, i: number, cols: number): Slab {
  const rand = seeded(hash(seed, i, 31)), cells = new Uint8Array(cols * ROWS);
  const kind = i === 0 ? 0 : Math.floor(rand() * 7), flip = rand() < 0.5;
  const dens = Math.min(0.7, 0.34 + i * 0.015), hard = i > 5 ? Math.min(0.3, (i - 5) * 0.03) : 0;
  const mc = (cols - 1) / 2, mr = (ROWS - 1) / 2;
  let left = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) {
    const ce = Math.min(c, cols - 1 - c), re = Math.min(r, ROWS - 1 - r);
    const on =
      kind === 0 ? ce === 0 || re === 0 // a frame
      : kind === 1 ? Math.abs(c - mc) < 1 || Math.abs(r - mr) < 1 // a cross
      : kind === 2 ? (r + c) % 2 === (flip ? 1 : 0) // chequer
      : kind === 3 ? (flip ? c : r) % 2 === 0 // bars
      : kind === 4 ? ce < 1 || re < 2 // a window
      : kind === 5 ? hash(seed, i, ce, r) / 4294967296 < dens // a figure, mirrored
      : (r + (flip ? c : cols - 1 - c)) % 3 === 0; // diagonals
    if (!on) continue;
    cells[r * cols + c] = hash(seed, i, c, r, 9) / 4294967296 < hard ? 2 : 1;
    left++;
  }
  if (!left) { cells[Math.floor(mr) * cols + Math.floor(mc)] = 1; left = 1; }
  return { i, z: slabZ(seed, i), cells, left, total: left, hue: hash(seed, i, 3) % 6 };
}

export function create(seed = 1, aspect = 0.46, mode: Mode = 'all'): Sim {
  const cols = colsFor(aspect);
  const s: Sim = {
    seed, W: H * aspect, cols, mode, z: 0, v: 0, ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0 }, phase: 'ready', heldBy: 0,
    integrity: FULL, broken: 0, passed: 0, returns: 0, slabs: [], nextSlab: 0, hands: [], events: [], rand: seeded(hash(seed, 9)), mark: null, turn: 'pad', t: 0, acc: 0,
  };
  grow(s); rest(s);
  return s;
}
export function restart(s: Sim) {
  if (s.phase !== 'over') return;
  Object.assign(s, { z: 0, v: 0, integrity: FULL, broken: 0, passed: 0, returns: 0, slabs: [], nextSlab: 0, phase: 'ready', mark: null });
  grow(s); rest(s);
}
function grow(s: Sim) { while (slabZ(s.seed, s.nextSlab) < s.z + 110) s.slabs.push(makeSlab(s.seed, s.nextSlab++, s.cols)); }
function rest(s: Sim) { Object.assign(s.ball, { x: 0, y: 0, z: s.z + R + 0.05, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0 }); }
const at = (s: Sim) => ({ x: s.ball.x, y: s.ball.y, z: s.ball.z });
export const speed = (b: Ball) => Math.hypot(b.vx, b.vy, b.vz);

/** send the ball off from 'ready', leaning toward (ax, ay) (each -1..1 across the glass) */
export function serve(s: Sim, ax = 0, ay = 0) {
  if (s.phase !== 'ready') return;
  leave(s, 20 + Math.min(4, s.passed * 0.12), clamp(ax, -1, 1) * 4, clamp(ay, -1, 1) * 4, 0, 0);
  s.phase = 'play';
  s.events.push({ kind: 'serve', ...at(s) });
}
/** in 'catch': pick the waiting ball up under this finger */
export function grab(s: Sim, id: number) {
  if (s.phase !== 'ready' || (s.mode !== 'catch' && s.mode !== 'all')) return;
  s.phase = 'held'; s.heldBy = id;
}
/** in 'catch': the finger holding the ball has let go, moving like this */
export function release(s: Sim, id: number, vx = 0, vy = 0) {
  if (s.phase !== 'held' || s.heldBy !== id) return;
  const p = power(s, 'catch', Math.hypot(vx, vy));
  leave(s, p, vx * CARRY.catch, vy * CARRY.catch, vx, vy);
  s.phase = 'play'; s.returns++;
  s.events.push({ kind: 'hand', ...at(s), hard: p });
}
/** the ball leaves the glass this fast, with this much of it sideways (never most of it), spun by the finger */
function leave(s: Sim, p: number, lx: number, ly: number, fvx: number, fvy: number) {
  const m = Math.hypot(lx, ly), k = m > MAX_SIDE * p ? (MAX_SIDE * p) / m : 1, b = s.ball;
  b.vx = lx * k; b.vy = ly * k; b.vz = Math.sqrt(Math.max(0, p * p - b.vx * b.vx - b.vy * b.vy));
  const sm = Math.hypot(fvx, fvy) * SPIN_OF, sk = sm > SPIN_MAX ? SPIN_MAX / sm : 1;
  b.sx = fvx * SPIN_OF * sk; b.sy = fvy * SPIN_OF * sk;
  b.z = Math.max(b.z, s.z + R + 0.02);
  s.mark = null;
}

/** The ball's own motion for one step, with the shaft's walls: falling back toward you, bent by its spin, bouncing. Returns how hard
 * it struck a wall, if it did. (The game's step and the guess at where it will come back both use this.) */
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

function tick(s: Sim) {
  const h = STEP, b = s.ball;
  s.t += h;
  if (s.phase === 'over') return;
  if (s.phase === 'ready') { rest(s); return; }
  // the glass goes on: freely down a clear tunnel, to a halt before bricks still standing
  s.v += clamp(driftFor(s) - s.v, -20 * h, 9 * h);
  s.z += s.v * h;
  while (s.slabs.length && s.z >= s.slabs[0].z - BRICK_T / 2) { s.slabs.shift(); s.passed++; s.events.push({ kind: 'pass', x: 0, y: 0, z: s.z }); }
  grow(s);
  if (s.phase === 'held') {
    const hand = s.hands.find((k) => k.id === s.heldBy);
    if (!hand) { release(s, s.heldBy); return; }
    b.x = clamp(hand.x, -s.W / 2 + R, s.W / 2 - R); b.y = clamp(hand.y, -H / 2 + R, H / 2 - R); b.z = s.z + R + 0.05;
    return;
  }
  const struck = fly(b, s.W, h);
  if (struck > 2) s.events.push({ kind: 'wall', ...at(s), hard: struck });
  // the bricks: of the slabs it's in, the brick it's deepest into
  const cw = s.W / s.cols;
  let hit: Slab | null = null, hc = 0, hr = 0, bd = R, nx = 0, ny = 0, nz = 0;
  for (const sl of s.slabs) {
    if (sl.z - BRICK_T / 2 > b.z + R) break;
    if (!sl.left || sl.z + BRICK_T / 2 < b.z - R) continue;
    const c0 = clamp(Math.floor((b.x - R + s.W / 2) / cw), 0, s.cols - 1), c1 = clamp(Math.floor((b.x + R + s.W / 2) / cw), 0, s.cols - 1);
    const r0 = clamp(Math.floor((b.y - R + H / 2) / CELL), 0, ROWS - 1), r1 = clamp(Math.floor((b.y + R + H / 2) / CELL), 0, ROWS - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (!sl.cells[r * s.cols + c]) continue;
      const cx = cellX(s, c), cy = cellY(r), ex = cw / 2 - JOINT, ey = CELL / 2 - JOINT, ez = BRICK_T / 2;
      let dx = b.x - clamp(b.x, cx - ex, cx + ex), dy = b.y - clamp(b.y, cy - ey, cy + ey), dz = b.z - clamp(b.z, sl.z - ez, sl.z + ez);
      let d = Math.hypot(dx, dy, dz);
      if (d >= bd) continue;
      if (d < 1e-6) { // its centre is inside: out by the nearest face
        const ox = ex - Math.abs(b.x - cx), oy = ey - Math.abs(b.y - cy), oz = ez - Math.abs(b.z - sl.z);
        dx = dy = dz = 0;
        if (oz <= ox && oz <= oy) dz = b.z < sl.z ? -1 : 1; else if (ox <= oy) dx = b.x < cx ? -1 : 1; else dy = b.y < cy ? -1 : 1;
        d = 0;
      } else { dx /= d; dy /= d; dz /= d; }
      hit = sl; hc = c; hr = r; bd = d; nx = dx; ny = dy; nz = dz;
    }
  }
  if (hit) {
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn < 0) {
      const i = hr * s.cols + hc, hard = -vn;
      // (hard enough, and square on: through it and on; otherwise off it)
      const through = hit.cells[i] === 1 && hard >= THROUGH && Math.abs(nz) > 0.7;
      const broke = --hit.cells[i] === 0;
      if (through) { b.vx *= KEEPS; b.vy *= KEEPS; b.vz *= KEEPS; } else {
        b.vx -= (1 + BRICK) * vn * nx; b.vy -= (1 + BRICK) * vn * ny; b.vz -= (1 + BRICK) * vn * nz;
        b.x += nx * (R - bd); b.y += ny * (R - bd); b.z += nz * (R - bd);
        b.sx *= 0.4; b.sy *= 0.4;
      }
      if (broke) { hit.left--; s.broken++; }
      s.events.push({ kind: 'brick', x: cellX(s, hc), y: cellY(hr), z: hit.z, hue: hit.hue, row: hr, broke, through, hard });
      // (broken through: what's left of the slab falls)
      if (broke && hit.total - hit.left >= Math.min(Math.ceil(hit.total * (1 - GIVES)), MOST)) {
        for (let k = 0; k < hit.cells.length; k++) if (hit.cells[k]) { hit.cells[k] = 0; s.broken++; s.events.push({ kind: 'fall', x: cellX(s, k % s.cols), y: cellY(Math.floor(k / s.cols)), z: hit.z, hue: hit.hue, row: Math.floor(k / s.cols) }); }
        hit.left = 0;
        s.events.push({ kind: 'through', x: 0, y: 0, z: hit.z });
      }
    }
  }
  // (the glass, going on, never overtakes a ball that's going the same way: it's pushed along)
  if (b.vz >= 0 && b.z - R < s.z + 0.02) { b.z = s.z + R + 0.02; b.vz = Math.max(b.vz, s.v + 6); }
  // the glass: is there a hand where it comes through?
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

/** Where and when the ball will come back through the glass, were nothing but the walls in its way: its flight run
 * on (falling, bending, bouncing), the glass going as it's going. */
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

/** A player to watch: sends the ball off, is where it comes back, and tries for a brick of the nearest slab,
 * allowing for the fall. */
function standIn(s: Sim) {
  s.hands.length = 0;
  if (s.phase === 'over') { if (s.t % 3 < STEP) restart(s); return; }
  if (s.phase === 'ready') { if (s.t % 0.8 < STEP) { if (s.mode === 'catch' || s.mode === 'all') grab(s, -1); else serve(s, s.rand() * 2 - 1, s.rand() * 2 - 1); } return; }
  const p = s.phase === 'held' ? { x: s.ball.x, y: s.ball.y, t: 0, speed: 0 } : crossing(s);
  if (!p || p.t > 0.5) return;
  if (!s.mark) {
    const sl = s.slabs.find((k) => k.left > 0);
    if (sl) {
      let n = Math.floor(s.rand() * sl.left);
      for (let i = 0; i < sl.cells.length; i++) if (sl.cells[i] && n-- === 0) s.mark = { x: cellX(s, i % s.cols), y: cellY(Math.floor(i / s.cols)), z: sl.z };
    }
    s.mark ??= { x: 0, y: 0, z: s.z + 20 };
    // (with the one hand, it takes turns being each)
    s.turn = s.mode === 'all' ? (['pad', 'swipe', 'catch'] as const)[Math.floor(s.rand() * 3)] : s.mode;
  }
  const as = s.turn;
  const dx = s.mark.x - p.x, dy = s.mark.y - p.y, dz = Math.max(1, s.mark.z - BRICK_T / 2 - R - s.z);
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
