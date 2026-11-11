/**
 * Volley's game, on its own: a ball, a tunnel without end, slabs of bricks across it, and a hand.
 *
 * The tunnel runs along z. Its section is H high and W wide (W is whatever the screen's shape makes it), centred on
 * the axis. You are a pane of glass across the whole section, at `z`, drifting forward; the ball goes on ahead of you
 * into the slabs and comes back. There is no paddle. Wherever the ball comes back through the glass, a hand has to
 * be there, and what the hand is doing is how the ball leaves. Three ways of being a hand (`mode`):
 *
 *   pad    a finger resting on the glass is a round pad: the ball leaves by where on the pad it lands, and a little
 *          by how the finger was moving
 *   swipe  only a moving finger counts: the ball leaves the way the finger was going
 *   catch  a finger under the ball catches it; it is thrown when the finger lets go, the way the finger was going
 *
 * The glass goes forward down a clear tunnel and comes to a halt before bricks still standing. Break three quarters
 * of a slab and the rest of it falls: you go on. A ball let through the glass is one of five gone. Everything random
 * is from the seed, and the step is fixed.
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
/** how near the glass comes to bricks still standing; and the share of a slab that, once all that's left, falls */
export const STAND = 4.5, GIVES = 0.25;
/** (and however big the slab, this many broken is enough) */
export const MOST = 14;
export const STEP = 1 / 240;
export const MODES = ['pad', 'swipe', 'catch'] as const;
export type Mode = (typeof MODES)[number];
/** pad: how much of the ball's speed goes sideways at the pad's rim; and how much of a finger's speed the ball takes */
const PAD_K = 0.7, CARRY: Record<Mode, number> = { pad: 0.2, swipe: 0.55, catch: 0.55 };
/** a finger slower than this isn't a swipe */
export const SWIPE_MIN = 5;
const MAX_SIDE = 0.8, MIN_ALONG = 0.55;

export type Phase = 'ready' | 'play' | 'held' | 'over';
export interface Hand { id: number; x: number; y: number; vx: number; vy: number }
export interface Slab { i: number; z: number; cells: Uint8Array; left: number; total: number; hue: number }
export type Ev =
  | { kind: 'brick'; x: number; y: number; z: number; hue: number; row: number; broke: boolean }
  | { kind: 'fall'; x: number; y: number; z: number; hue: number; row: number }
  | { kind: 'wall' | 'hand' | 'catch' | 'serve' | 'miss' | 'over' | 'pass' | 'through'; x: number; y: number; z: number };

export interface Sim {
  seed: number;
  W: number; cols: number;
  mode: Mode;
  /** where the glass is, and how fast it's going */
  z: number; v: number;
  ball: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  speed: number;
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
  return Math.min(8, 4.2 + 0.12 * s.passed) * u * (2 - u);
}
export const speedOf = (passed: number) => Math.min(21, 13 + 0.3 * passed);

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

export function create(seed = 1, aspect = 0.46, mode: Mode = 'pad'): Sim {
  const cols = colsFor(aspect);
  const s: Sim = {
    seed, W: H * aspect, cols, mode, z: 0, v: 0, ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, speed: speedOf(0), phase: 'ready', heldBy: 0,
    integrity: FULL, broken: 0, passed: 0, returns: 0, slabs: [], nextSlab: 0, hands: [], events: [], rand: seeded(hash(seed, 9)), mark: null, t: 0, acc: 0,
  };
  grow(s); rest(s);
  return s;
}
export function restart(s: Sim) {
  if (s.phase !== 'over') return;
  Object.assign(s, { z: 0, v: 0, integrity: FULL, broken: 0, passed: 0, returns: 0, slabs: [], nextSlab: 0, phase: 'ready', mark: null, speed: speedOf(0) });
  grow(s); rest(s);
}
function grow(s: Sim) { while (slabZ(s.seed, s.nextSlab) < s.z + 110) s.slabs.push(makeSlab(s.seed, s.nextSlab++, s.cols)); }
function rest(s: Sim) { Object.assign(s.ball, { x: 0, y: 0, z: s.z + R + 0.05, vx: 0, vy: 0, vz: 0 }); }

/** send the ball off from 'ready', leaning toward (ax, ay) (each -1..1 across the glass) */
export function serve(s: Sim, ax = 0, ay = 0) {
  if (s.phase !== 'ready') return;
  s.speed = speedOf(s.passed);
  leave(s, clamp(ax, -1, 1) * 0.3, clamp(ay, -1, 1) * 0.3);
  s.phase = 'play';
  s.events.push({ kind: 'serve', ...at(s) });
}
/** in 'catch': the finger holding the ball has let go, moving like this */
export function release(s: Sim, id: number, vx = 0, vy = 0) {
  if (s.phase !== 'held' || s.heldBy !== id) return;
  leave(s, (vx * CARRY.catch) / s.speed, (vy * CARRY.catch) / s.speed);
  s.phase = 'play'; s.returns++;
  s.events.push({ kind: 'hand', ...at(s) });
}
const at = (s: Sim) => ({ x: s.ball.x, y: s.ball.y, z: s.ball.z });
/** the ball leaves the glass with this much of its speed sideways (fx, fy), the rest ahead */
function leave(s: Sim, fx: number, fy: number) {
  const m = Math.hypot(fx, fy), k = m > MAX_SIDE ? MAX_SIDE / m : 1, b = s.ball;
  fx *= k; fy *= k;
  b.vx = fx * s.speed; b.vy = fy * s.speed; b.vz = Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy)) * s.speed;
  b.z = Math.max(b.z, s.z + R + 0.02);
  s.mark = null;
}
/** keep it from going sideways for ever: a share of its speed is always along the tunnel */
function steepen(s: Sim) {
  const b = s.ball, min = MIN_ALONG * s.speed;
  if (Math.abs(b.vz) >= min) return;
  const side = Math.hypot(b.vx, b.vy) || 1, k = Math.sqrt(s.speed * s.speed - min * min) / side;
  b.vx *= k; b.vy *= k; b.vz = (b.vz < 0 ? -1 : 1) * min;
}

function tick(s: Sim) {
  const h = STEP, b = s.ball;
  s.t += h;
  if (s.phase === 'over') return;
  if (s.phase === 'ready') { rest(s); return; }
  // the glass goes on: freely down a clear tunnel, to a halt before bricks still standing
  s.v += clamp(driftFor(s) - s.v, -14 * h, 5 * h);
  s.z += s.v * h;
  while (s.slabs.length && s.z >= s.slabs[0].z - BRICK_T / 2) { s.slabs.shift(); s.passed++; s.events.push({ kind: 'pass', x: 0, y: 0, z: s.z }); }
  grow(s);
  const hx = s.W / 2 - R, hy = H / 2 - R;
  if (s.phase === 'held') {
    const hand = s.hands.find((k) => k.id === s.heldBy);
    if (!hand) { const id = s.heldBy; release(s, id); return; }
    b.x = clamp(hand.x, -hx, hx); b.y = clamp(hand.y, -hy, hy); b.z = s.z + R + 0.05;
    return;
  }
  b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
  // the four walls
  if (b.x < -hx && b.vx < 0) { b.x = -hx; b.vx = -b.vx; s.events.push({ kind: 'wall', ...at(s) }); }
  if (b.x > hx && b.vx > 0) { b.x = hx; b.vx = -b.vx; s.events.push({ kind: 'wall', ...at(s) }); }
  if (b.y < -hy && b.vy < 0) { b.y = -hy; b.vy = -b.vy; s.events.push({ kind: 'wall', ...at(s) }); }
  if (b.y > hy && b.vy > 0) { b.y = hy; b.vy = -b.vy; s.events.push({ kind: 'wall', ...at(s) }); }
  // (a ball that threads everything is given back by the dark)
  const near = s.slabs.find((k) => k.left > 0);
  if (b.vz > 0 && b.z > (near ? near.z + GAP + 3 : s.z + 30)) b.vz = -b.vz;
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
      b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; b.vz -= 2 * vn * nz;
      b.x += nx * (R - bd); b.y += ny * (R - bd); b.z += nz * (R - bd);
      const broke = --hit.cells[hr * s.cols + hc] === 0;
      if (broke) { hit.left--; s.broken++; }
      steepen(s);
      s.events.push({ kind: 'brick', x: cellX(s, hc), y: cellY(hr), z: hit.z, hue: hit.hue, row: hr, broke });
      // (broken through: what little is left of the slab falls)
      if (broke && hit.total - hit.left >= Math.min(Math.ceil(hit.total * (1 - GIVES)), MOST)) {
        for (let i = 0; i < hit.cells.length; i++) if (hit.cells[i]) { hit.cells[i] = 0; s.broken++; s.events.push({ kind: 'fall', x: cellX(s, i % s.cols), y: cellY(Math.floor(i / s.cols)), z: hit.z, hue: hit.hue, row: Math.floor(i / s.cols) }); }
        hit.left = 0;
        s.events.push({ kind: 'through', x: 0, y: 0, z: hit.z });
      }
    }
  }
  // the glass: is there a hand where it comes through?
  if (b.vz < 0 && b.z - R <= s.z && b.z >= s.z - LATE) {
    let best: Hand | null = null, bestD = Infinity;
    for (const k of s.hands) {
      const d = Math.hypot(b.x - k.x, b.y - k.y);
      const reach = s.mode === 'swipe' ? (Math.hypot(k.vx, k.vy) >= SWIPE_MIN ? HAND_R * 1.5 : -1) : HAND_R + R * 0.5;
      if (d <= reach && d < bestD) { best = k; bestD = d; }
    }
    if (best) {
      s.speed = speedOf(s.passed);
      if (s.mode === 'catch') {
        s.phase = 'held'; s.heldBy = best.id; b.vx = b.vy = b.vz = 0; b.z = s.z + R + 0.05;
        s.events.push({ kind: 'catch', ...at(s) });
      } else {
        const k = s.mode === 'pad' ? PAD_K / HAND_R : 0, c = CARRY[s.mode] / s.speed;
        leave(s, (b.x - best.x) * k + best.vx * c, (b.y - best.y) * k + best.vy * c);
        s.returns++;
        s.events.push({ kind: 'hand', ...at(s) });
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

/** Where and when the ball will come back through the glass, were nothing but the walls in its way. */
export function crossing(s: Sim): { x: number; y: number; t: number } | null {
  const b = s.ball, closing = -b.vz + s.v;
  if (s.phase !== 'play' || b.vz >= 0) return null;
  const t = (b.z - R - s.z) / closing;
  if (t < 0) return null;
  const fold = (p: number, v: number, half: number) => { const span = 2 * half; let u = (p + v * t + half) % (2 * span); if (u < 0) u += 2 * span; return -half + (u > span ? 2 * span - u : u); };
  return { x: fold(b.x, b.vx, s.W / 2 - R), y: fold(b.y, b.vy, H / 2 - R), t };
}

/** A player to watch: sends the ball off, is where it comes back, and tries for a brick of the nearest slab. */
function standIn(s: Sim) {
  s.hands.length = 0;
  if (s.phase === 'over') { if (s.t % 3 < STEP) restart(s); return; }
  if (s.phase === 'ready') { if (s.t % 0.8 < STEP) serve(s, s.rand() * 2 - 1, s.rand() * 2 - 1); return; }
  const p = s.phase === 'held' ? { x: s.ball.x, y: s.ball.y, t: 0 } : crossing(s);
  if (!p) return;
  if (!s.mark) {
    const sl = s.slabs.find((k) => k.left > 0);
    if (sl) {
      let n = Math.floor(s.rand() * sl.left);
      for (let i = 0; i < sl.cells.length; i++) if (sl.cells[i] && n-- === 0) s.mark = { x: cellX(s, i % s.cols), y: cellY(Math.floor(i / s.cols)), z: sl.z };
    }
    s.mark ??= { x: 0, y: 0, z: s.z + 20 };
  }
  // (the share of its speed that has to go sideways to get there)
  const dx = s.mark.x - p.x, dy = s.mark.y - p.y, dz = Math.max(1, s.mark.z - s.z), d = Math.hypot(dx, dy, dz);
  let fx = dx / d, fy = dy / d;
  if (s.mode === 'pad') {
    const m = Math.hypot(fx, fy) / PAD_K, k = m > 0.9 ? 0.9 / m : 1;
    fx = (fx / PAD_K) * k; fy = (fy / PAD_K) * k;
    s.hands.push({ id: -1, x: p.x - fx * HAND_R, y: p.y - fy * HAND_R, vx: 0, vy: 0 });
  } else {
    const c = s.speed / CARRY[s.mode];
    let vx = fx * c, vy = fy * c;
    // (a swipe has to be moving: straight on is a small flick upward)
    if (s.mode === 'swipe' && Math.hypot(vx, vy) < SWIPE_MIN * 1.2) { const m = Math.hypot(vx, vy); if (m < 1e-3) { vx = 0; vy = SWIPE_MIN * 1.2; } else { vx *= (SWIPE_MIN * 1.2) / m; vy *= (SWIPE_MIN * 1.2) / m; } }
    if (s.phase === 'held') { release(s, -1, vx, vy); return; }
    s.hands.push({ id: -1, x: p.x, y: p.y, vx, vy });
  }
}
