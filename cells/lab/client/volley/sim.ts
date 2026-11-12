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
import { H, SHEET_T, GAP, FIRING, GLAZED, makeSheet, sheetZ, firingOf, type Sheet } from './sheet';
export { H, SHEET_T, GAP, FIRST, GRAIN, JOINT, FRAME, FIRING, PLAIN, FIRED, HARD, SOFT, RED, GLAZED, makeSheet, sheetZ, firingOf, type Shard, type Sheet } from './sheet';

export const R = 0.34;
export const HAND_R = 1.15;
/** how far behind the pane a ball can still be reached */
export const LATE = 0.9;
export const FULL = 5;
/** how near the pane comes to shards still standing; the share of a sheet that, once all that's left, gives way;
 * and however big the sheet, this many broken is enough */
export const STAND = 8, GIVES = 0.4, MOST = 12;
export const STEP = 1 / 240;
export const MODES = ['all', 'pad', 'swipe', 'catch'] as const;
export type Mode = (typeof MODES)[number];

// the ball
/** the fall: back toward the pane */
export const G = 12;
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

export type Phase = 'ready' | 'play' | 'held' | 'over' | 'done';
/** what a run is: five lives and it's over (go again from the last firing reached, if you like); a course of
 * COURSE firings against the clock, no lives, a miss costing time; or free, nothing counted */
export const RULES = ['lives', 'run', 'free'] as const;
export type Rules = (typeof RULES)[number];
export const COURSE = 4, MISS_TIME = 2;
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

export interface Ball { x: number; y: number; z: number; vx: number; vy: number; vz: number; sx: number; sy: number }
export type Ev =
  /** a shard struck: `broke` if that was the end of it, `through` if the ball went on through, `chain` if it went
   * with a neighbour that was struck */
  | { kind: 'shard'; x: number; y: number; z: number; sheet: number; shard: number; broke: boolean; through: boolean; chain: boolean; hard: number; /** where the ball met it, and its own way back out */ px: number; py: number; nx: number; ny: number; nz: number }
  /** a shard of a sheet that has given way */
  | { kind: 'fall'; x: number; y: number; z: number; sheet: number; shard: number }
  | { kind: 'wall' | 'hand'; x: number; y: number; z: number; hard: number }
  | { kind: 'catch' | 'serve' | 'miss' | 'over' | 'pass' | 'through'; x: number; y: number; z: number }
  /** a firing finished: the next one's door is ahead; and the course's last, done */
  | { kind: 'checkpoint' | 'done'; x: number; y: number; z: number; firing: number; clock: number };

export interface Sim {
  seed: number;
  W: number;
  mode: Mode;
  rules: Rules;
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
  /** goes up whenever the ball's flight is changed (a hand, a shard, a side): the guess at its crossing is kept till then */
  flight: number;
  guess: { flight: number; at: number; c: { x: number; y: number; t: number; speed: number } | null } | null;
  /** the course's clock (from the first throw, misses added in), and the clock at each firing finished */
  clock: number; started: boolean; misses: number; splits: number[];
  /** the sheet the last firing reached begins with (where a run can go again from), and whether this one did */
  from: number; continued: boolean;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** how fast the pane would go: freely down a clear way, slowing to a halt STAND short of shards still standing */
export function driftFor(s: Sim, z = s.z): number {
  const sh = s.sheets.find((k) => k.left > 0), d = sh ? sh.z - SHEET_T / 2 - z : 99;
  const u = clamp((d - STAND) / 7, 0, 1);
  return Math.min(12, 6.5 + 0.15 * s.passed) * u * (2 - u);
}
/** the pane's speed a step on, from where it is and how fast it's going */
const paneStep = (s: Sim, z: number, v: number, h: number) => v + clamp(driftFor(s, z) - v, -20 * h, 9 * h);
/** how hard a hand sends the ball: by the kind of hand, how fast the finger was going, and (a pad) how fast it came */
export function power(s: Sim, mode: 'pad' | 'swipe' | 'catch', finger: number, came = 0): number {
  const deep = Math.min(4, s.passed * 0.12);
  const p = mode === 'pad' ? Math.max(17, came * 0.9) + finger * 0.4 : mode === 'swipe' ? 9 + finger * 0.75 : 14 + finger * 0.65;
  return clamp(p + deep, 13, POWER_MAX);
}

// ─── a sheet ─────────────────────────────────────────────────────────────────────────────────────────────────────────

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

export function create(seed = 1, aspect = 0.46, mode: Mode = 'all', rules: Rules = 'lives'): Sim {
  const s: Sim = {
    seed, W: H * aspect, mode, rules, z: 0, v: 0, ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0 }, phase: 'ready', heldBy: 0,
    integrity: FULL, broken: 0, passed: 0, returns: 0, sheets: [], nextSheet: 0, hands: [], events: [], rand: seeded(hash(seed, 9)), mark: null, turn: 'pad', t: 0, acc: 0,
    clock: 0, started: false, misses: 0, splits: [], from: 0, continued: false, flight: 0, guess: null,
  };
  grow(s); rest(s);
  return s;
}
/** Again, from the start; or (lives) from the door of the last firing reached. */
export function restart(s: Sim, fromCheckpoint = false) {
  if (s.phase !== 'over' && s.phase !== 'done') return;
  const k = fromCheckpoint && s.rules === 'lives' ? s.from : 0;
  Object.assign(s, { z: k ? sheetZ(s.seed, k) - SHEET_T / 2 - STAND : 0, v: 0, integrity: FULL, broken: 0, passed: k, returns: 0, sheets: [], nextSheet: k, phase: 'ready', mark: null, clock: 0, started: false, misses: 0, splits: [], continued: k > 0 });
  if (!k) s.from = 0;
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
  s.phase = 'play'; s.started = true;
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
  s.phase = 'play'; s.returns++; s.started = true;
  s.events.push({ kind: 'hand', ...at(s), hard: p });
}
/** the ball leaves the pane this fast, with this much of it sideways (never most of it), spun by the finger */
function leave(s: Sim, p: number, lx: number, ly: number, fvx: number, fvy: number) {
  const m = Math.hypot(lx, ly), k = m > MAX_SIDE * p ? (MAX_SIDE * p) / m : 1, b = s.ball;
  b.vx = lx * k; b.vy = ly * k; b.vz = Math.sqrt(Math.max(0, p * p - b.vx * b.vx - b.vy * b.vy));
  const sm = Math.hypot(fvx, fvy) * SPIN_OF, sk = sm > SPIN_MAX ? SPIN_MAX / sm : 1;
  b.sx = fvx * SPIN_OF * sk; b.sy = fvy * SPIN_OF * sk;
  b.z = Math.max(b.z, s.z + R + 0.02);
  s.mark = null; s.flight++;
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

interface Contact { sheet: Sheet; k: number; d: number; nx: number; ny: number; nz: number }
/** The shard (of the sheets it's in) the ball is deepest into, if any, and which way is out of it. Shards in `gone`
 * (keys `sheet:shard`) are taken as broken already, and sheets in `fallen` as given way. */
function contact(sheets: Sheet[], b: Ball, gone?: Set<number>, fallen?: Set<number>): Contact | null {
  let best: Contact | null = null, bd = R;
  for (const sh of sheets) {
    if (sh.z - SHEET_T / 2 > b.z + R) break;
    if (sh.z + SHEET_T / 2 < b.z - R || fallen?.has(sh.i)) continue;
    for (let k = 0; k < sh.shards.length; k++) {
      const d = sh.shards[k];
      if (!d.hp || (b.x - d.cx) ** 2 + (b.y - d.cy) ** 2 > (d.r + R) ** 2 || gone?.has(sh.i * 4096 + k)) continue;
      const [qx, qy] = nearest(d.poly, b.x, b.y), qz = clamp(b.z, sh.z - SHEET_T / 2, sh.z + SHEET_T / 2);
      let dx = b.x - qx, dy = b.y - qy, dz = b.z - qz, dist = Math.hypot(dx, dy, dz);
      if (dist >= bd) continue;
      // (its centre is inside the shard: out by the nearer face)
      if (dist < 1e-6) { dx = dy = 0; dz = b.z < sh.z ? -1 : 1; dist = 0; } else { dx /= dist; dy /= dist; dz /= dist; }
      bd = dist; best = { sheet: sh, k, d: dist, nx: dx, ny: dy, nz: dz };
    }
  }
  return best;
}
/** The ball meets a shard it's moving into (`hp` blows left in it): hard enough and square on, it goes through it and
 * on, a little slower; otherwise off it. Returns whether it went through. */
function meet(b: Ball, c: Contact, hp: number, W: number): boolean {
  const vn = b.vx * c.nx + b.vy * c.ny + b.vz * c.nz;
  if (hp === 1 && -vn >= THROUGH && Math.abs(c.nz) > 0.7) { b.vx *= KEEPS; b.vy *= KEEPS; b.vz *= KEEPS; return true; }
  b.vx -= (1 + SHARD) * vn * c.nx; b.vy -= (1 + SHARD) * vn * c.ny; b.vz -= (1 + SHARD) * vn * c.nz;
  b.x += c.nx * (R - c.d); b.y += c.ny * (R - c.d); b.z += c.nz * (R - c.d);
  // (pushed out of the shard, but not out of the way)
  b.x = clamp(b.x, -W / 2 + R, W / 2 - R); b.y = clamp(b.y, -H / 2 + R, H / 2 - R);
  b.sx *= 0.4; b.sy *= 0.4;
  return false;
}

/** one shard of a sheet takes a blow: an event, and (if that's the end of it) the counts */
function strike(s: Sim, sh: Sheet, k: number, through: boolean, chain: boolean, hard: number, px = sh.shards[k].cx, py = sh.shards[k].cy, n: [number, number, number] = [0, 0, -1]) {
  const d = sh.shards[k], broke = --d.hp === 0;
  sh.ver++;
  if (broke) { s.broken++; if (!d.frame) sh.left--; } else if (Number.isNaN(d.hx)) { d.hx = px; d.hy = py; }
  s.events.push({ kind: 'shard', x: d.cx, y: d.cy, z: sh.z, sheet: sh.i, shard: k, broke, through, chain, hard, px, py, nx: n[0], ny: n[1], nz: n[2] });
}

function tick(s: Sim) {
  const h = STEP, b = s.ball;
  s.t += h;
  if (s.phase === 'over' || s.phase === 'done') return;
  if (s.started && s.rules === 'run') s.clock += h;
  if (s.phase === 'ready') { rest(s); return; }
  // the pane goes on: freely down a clear way, to a halt before shards still standing
  s.v = paneStep(s, s.z, s.v, h);
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
  if (struck) s.flight++;
  if (struck > 2) s.events.push({ kind: 'wall', ...at(s), hard: struck });
  // the shards: of the sheets it's in, the shard it's deepest into
  const ct = contact(s.sheets, b);
  const hit = ct?.sheet ?? null, hk = ct?.k ?? 0, bd = ct?.d ?? R, nx = ct?.nx ?? 0, ny = ct?.ny ?? 0, nz = ct?.nz ?? 0;
  if (hit) {
    const vn = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vn < 0) {
      const d = hit.shards[hk], hard = -vn;
      // (hard enough, and square on: through it and on, and the shards round the place go with it; otherwise off it)
      const px = b.x - nx * R, py = b.y - ny * R, through = meet(b, ct!, d.hp, s.W);
      s.flight++;
      strike(s, hit, hk, through, false, hard, px, py, [nx, ny, nz]);
      if (through) {
        const reach = BURST + (hard - THROUGH) * BURST_PER;
        hit.shards.forEach((o, k) => { if (o.hp === 1 && Math.hypot(o.cx - b.x, o.cy - b.y) < reach + o.r * 0.5) strike(s, hit!, k, false, true, hard); });
      }
      // (broken through: what's left of the sheet gives way, frame and all)
      if (hit.left > 0 && hit.total - hit.left >= Math.min(Math.ceil(hit.total * (1 - GIVES)), MOST)) {
        hit.shards.forEach((o, k) => { if (o.hp) { o.hp = 0; s.broken++; s.events.push({ kind: 'fall', x: o.cx, y: o.cy, z: hit!.z, sheet: hit!.i, shard: k }); } });
        hit.left = 0; hit.ver++;
        s.events.push({ kind: 'through', x: 0, y: 0, z: hit.z });
        // (the last of a firing: a checkpoint; the last of the course, done)
        if ((hit.i + 1) % FIRING === 0 && hit.i + 1 > s.from) {
          const firing = (hit.i + 1) / FIRING;
          s.from = hit.i + 1; s.splits.push(s.clock);
          if (s.rules === 'lives') s.integrity = Math.min(FULL, s.integrity + 1);
          if (s.rules === 'run' && firing >= COURSE) { s.phase = 'done'; s.events.push({ kind: 'done', x: 0, y: 0, z: hit.z, firing, clock: s.clock }); return; }
          s.events.push({ kind: 'checkpoint', x: 0, y: 0, z: hit.z, firing, clock: s.clock });
        }
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
    s.misses++;
    if (s.rules === 'lives') s.integrity--;
    if (s.rules === 'run') s.clock += MISS_TIME;
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

/** Where and when the ball will come back through the pane: its whole flight run on (falling, bending, off the
 * sides, and off or through the shards in its way, by the same rule as the game), the pane going as it will. So
 * it's known as soon as the ball leaves the hand whether it will come back off the sheet or go through it, and
 * where it will come down either way. Kept until something changes the flight (a hand, a shard, a side), or for a
 * tenth of a second. */
export function crossing(s: Sim): { x: number; y: number; t: number; speed: number } | null {
  if (s.phase !== 'play') return null;
  const g = s.guess;
  if (g && g.flight === s.flight && s.t - g.at < 0.1) return g.c && { ...g.c, t: g.c.t - (s.t - g.at) };
  const b = { ...s.ball }, h = 1 / 120, gone = new Set<number>(), fallen = new Set<number>(), broke = new Map<number, number>();
  let z = s.z, v = s.v, c: { x: number; y: number; t: number; speed: number } | null = null;
  for (let t = 0; t < 3; t += h) {
    if (b.vz < 0 && b.z - R <= z) { c = { x: b.x, y: b.y, t, speed: speed(b) }; break; }
    fly(b, s.W, h); v = paneStep(s, z, v, h); z += v * h;
    const ct = contact(s.sheets, b, gone, fallen);
    if (ct && b.vx * ct.nx + b.vy * ct.ny + b.vz * ct.nz < 0) {
      const d = ct.sheet.shards[ct.k], hp = d.hp, hard = -(b.vx * ct.nx + b.vy * ct.ny + b.vz * ct.nz);
      const through = meet(b, ct, hp, s.W), key = ct.sheet.i * 4096;
      const n0 = gone.size;
      if (hp === 1) gone.add(key + ct.k);
      if (through) { const reach = BURST + (hard - THROUGH) * BURST_PER; ct.sheet.shards.forEach((o, k) => { if (o.hp === 1 && Math.hypot(o.cx - b.x, o.cy - b.y) < reach + o.r * 0.5) gone.add(key + k); }); }
      // (enough of it broken, and the sheet gives way: the rest of the flight goes on without it)
      const sh = ct.sheet, n = (broke.get(sh.i) ?? 0) + gone.size - n0;
      broke.set(sh.i, n);
      if (sh.left > 0 && sh.total - sh.left + n >= Math.min(Math.ceil(sh.total * (1 - GIVES)), MOST)) fallen.add(sh.i);
    }
    if (b.vz >= 0 && b.z - R < z + 0.02) { b.z = z + R + 0.02; b.vz = Math.max(b.vz, v + 6); }
  }
  s.guess = { flight: s.flight, at: s.t, c };
  return c;
}

/** A player to watch: picks the ball up, is where it comes back, and tries for a shard of the nearest sheet,
 * throwing hard enough to get there. */
function standIn(s: Sim) {
  s.hands.length = 0;
  if (s.phase === 'over' || s.phase === 'done') { if (s.t % 3 < STEP) restart(s); return; }
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
