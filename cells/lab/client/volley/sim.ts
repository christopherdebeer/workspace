/**
 * Volley's game, on its own: a brick-breaker's field as a floor plan, nothing about how it's seen.
 *
 * The field is `W` wide (x from -W/2 to W/2) and `D` deep (z from 0, where the paddle is, to the back wall at D).
 * The bricks stand in ROWS rows of COLS across the far half, with a lane behind them before the back wall (a ball
 * that gets through rattles about in there). The ball is a circle in the plan; the paddle a segment at PADDLE_Z.
 * Where the ball meets the paddle sets the angle it leaves at, as ever. Past the paddle, it's gone.
 *
 * Everything random (the serve's angle, the layouts past the first few, the stand-in player) is from the seed, and
 * the step is fixed, so a seed and the same inputs are the same game.
 */
import { seeded, hash, type Rand } from '../kit/rng';

export const W = 7, D = 15;
export const COLS = 7, ROWS = 6;
export const BRICK_W = W / COLS, BRICK_D = 0.62, BRICK_Z0 = 8;
/** how much of its cell a brick fills (the rest is the joint between them) */
export const JOINT = 0.035;
export const R = 0.17;
export const PADDLE_Z = 0.5, PADDLE_HALF = 0.78, PADDLE_DEPTH = 0.22;
/** the paddle can't outrun this (the stand-in is held to it too) */
export const PADDLE_V = 15;
export const STEP = 1 / 240;
const MAX_ANGLE = (58 * Math.PI) / 180;

export type Phase = 'serve' | 'play' | 'clear' | 'over';
export type Ev =
  | { kind: 'brick'; row: number; col: number; x: number; z: number; broke: boolean }
  | { kind: 'wall'; x: number; z: number }
  | { kind: 'paddle'; x: number; z: number; off: number }
  | { kind: 'serve' | 'miss' | 'clear' | 'over'; x: number; z: number };

export interface Sim {
  seed: number;
  level: number;
  /** hit points by row * COLS + col (row 0 the nearest); 0 is gone */
  bricks: Uint8Array;
  left: number;
  ball: { x: number; z: number; vx: number; vz: number };
  speed: number;
  paddle: number;
  /** where the paddle is being asked to be */
  want: number;
  phase: Phase;
  lives: number;
  score: number;
  /** paddle returns this ball */
  rally: number;
  t: number;
  /** what happened in the last `advance`, for whoever draws and sounds it */
  events: Ev[];
  rand: Rand;
  /** the stand-in's aim for this approach (-1..1 across the paddle) */
  aim: number;
  acc: number;
}

export const brickX = (col: number) => -W / 2 + (col + 0.5) * BRICK_W;
export const brickZ = (row: number) => BRICK_Z0 + (row + 0.5) * BRICK_D;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A level's bricks. The first four are set pieces; after that, a seeded one (mirrored, with some that take two). */
export function layout(level: number, seed: number): Uint8Array {
  const b = new Uint8Array(ROWS * COLS);
  const set = (r: number, c: number, hp: number) => { b[r * COLS + c] = hp; };
  const kind = level <= 4 ? level : 5;
  const rand = seeded(hash(seed, level, 77));
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (kind === 1) set(r, c, 1); // the wall
    else if (kind === 2) set(r, c, c % 2 === 0 ? 1 : 0); // a colonnade: lanes straight through to the back
    else if (kind === 3) set(r, c, (r + c) % 2 === 0 ? 1 : 0); // chequer
    else if (kind === 4) { // a keep: a ring, a hard core
      const edge = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1;
      set(r, c, edge ? 1 : r >= 2 && r <= 3 && c >= 2 && c <= 4 ? 2 : 0);
    } else if (c <= COLS >> 1) {
      const v = rand(), hp = v < 0.22 ? 0 : v < 0.8 ? 1 : 2;
      set(r, c, hp); set(r, COLS - 1 - c, hp);
    }
  }
  if (!b.some((v) => v)) b.fill(1);
  return b;
}

export function create(seed = 1, level = 1): Sim {
  const s: Sim = {
    seed, level, bricks: layout(level, seed), left: 0, ball: { x: 0, z: 0, vx: 0, vz: 0 }, speed: 0, paddle: 0, want: 0,
    phase: 'serve', lives: 3, score: 0, rally: 0, t: 0, events: [], rand: seeded(hash(seed, 9)), aim: 0, acc: 0,
  };
  s.left = s.bricks.reduce((n, v) => n + (v ? 1 : 0), 0);
  rest(s);
  return s;
}

const baseSpeed = (level: number) => Math.min(10, 6.6 + 0.45 * (level - 1));
const topSpeed = (level: number) => baseSpeed(level) + 4.2;

/** the ball on the paddle, waiting to be served */
function rest(s: Sim) {
  s.ball.x = s.paddle; s.ball.z = PADDLE_Z + PADDLE_DEPTH / 2 + R + 0.02; s.ball.vx = 0; s.ball.vz = 0;
  s.speed = baseSpeed(s.level); s.rally = 0;
}

export function serve(s: Sim) {
  if (s.phase !== 'serve') return;
  const a = (s.rand() - 0.5) * 0.7;
  s.ball.vx = Math.sin(a) * s.speed; s.ball.vz = Math.cos(a) * s.speed;
  s.phase = 'play'; s.aim = s.rand() * 1.4 - 0.7;
  s.events.push({ kind: 'serve', x: s.ball.x, z: s.ball.z });
}

/** on to the next level (from 'clear'), or a new game (from 'over') */
export function next(s: Sim) {
  if (s.phase === 'clear') s.level++;
  else if (s.phase === 'over') { s.level = 1; s.score = 0; s.lives = 3; } else return;
  s.bricks = layout(s.level, s.seed); s.left = s.bricks.reduce((n, v) => n + (v ? 1 : 0), 0);
  s.phase = 'serve'; rest(s);
}

/** keep the ball from going sideways for ever: some of its speed is always along the field */
function steepen(s: Sim) {
  const b = s.ball, min = 0.28 * s.speed;
  if (Math.abs(b.vz) < min) {
    b.vz = (b.vz < 0 ? -1 : 1) * min;
    b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(s.speed * s.speed - min * min);
  }
}

function tick(s: Sim) {
  const h = STEP, b = s.ball;
  s.t += h;
  s.paddle += clamp(s.want - s.paddle, -PADDLE_V * h, PADDLE_V * h);
  s.paddle = clamp(s.paddle, -W / 2 + PADDLE_HALF, W / 2 - PADDLE_HALF);
  if (s.phase !== 'play') { if (s.phase === 'serve') b.x = s.paddle; return; }
  b.x += b.vx * h; b.z += b.vz * h;
  // the side walls, the back wall
  if (b.x < -W / 2 + R && b.vx < 0) { b.x = -W / 2 + R; b.vx = -b.vx; s.events.push({ kind: 'wall', x: b.x - R, z: b.z }); }
  if (b.x > W / 2 - R && b.vx > 0) { b.x = W / 2 - R; b.vx = -b.vx; s.events.push({ kind: 'wall', x: b.x + R, z: b.z }); }
  if (b.z > D - R && b.vz > 0) { b.z = D - R; b.vz = -b.vz; steepen(s); s.events.push({ kind: 'wall', x: b.x, z: D }); }
  // the bricks: the one it's deepest into, if any
  if (b.z + R > BRICK_Z0 && b.z - R < BRICK_Z0 + ROWS * BRICK_D) {
    const c0 = clamp(Math.floor((b.x - R + W / 2) / BRICK_W), 0, COLS - 1), c1 = clamp(Math.floor((b.x + R + W / 2) / BRICK_W), 0, COLS - 1);
    const r0 = clamp(Math.floor((b.z - R - BRICK_Z0) / BRICK_D), 0, ROWS - 1), r1 = clamp(Math.floor((b.z + R - BRICK_Z0) / BRICK_D), 0, ROWS - 1);
    let best = -1, bd = R, bnx = 0, bnz = 0;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (!s.bricks[r * COLS + c]) continue;
      const cx = brickX(c), cz = brickZ(r), hx = BRICK_W / 2 - JOINT, hz = BRICK_D / 2 - JOINT;
      const px = clamp(b.x, cx - hx, cx + hx), pz = clamp(b.z, cz - hz, cz + hz);
      let nx = b.x - px, nz = b.z - pz, d = Math.hypot(nx, nz);
      if (d >= bd) continue;
      if (d < 1e-6) { // its centre is inside: out by the nearest face
        const ox = hx - Math.abs(b.x - cx), oz = hz - Math.abs(b.z - cz);
        if (ox < oz) { nx = b.x < cx ? -1 : 1; nz = 0; } else { nx = 0; nz = b.z < cz ? -1 : 1; }
        d = 0;
      } else { nx /= d; nz /= d; }
      best = r * COLS + c; bd = d; bnx = nx; bnz = nz;
    }
    if (best >= 0) {
      const vn = b.vx * bnx + b.vz * bnz;
      if (vn < 0) {
        b.vx -= 2 * vn * bnx; b.vz -= 2 * vn * bnz;
        b.x += bnx * (R - bd); b.z += bnz * (R - bd);
        const row = Math.floor(best / COLS), col = best % COLS, broke = --s.bricks[best] === 0;
        if (broke) {
          s.left--; s.score += 10 * (row + 1);
          // (the far rows quicken it)
          s.speed = Math.min(topSpeed(s.level), s.speed + 0.03 + 0.02 * row);
          const k = s.speed / Math.hypot(b.vx, b.vz); b.vx *= k; b.vz *= k;
        }
        steepen(s);
        s.events.push({ kind: 'brick', row, col, x: brickX(col), z: brickZ(row), broke });
        if (!s.left) { s.phase = 'clear'; s.events.push({ kind: 'clear', x: b.x, z: b.z }); return; }
      }
    }
  }
  // the paddle
  const face = PADDLE_Z + PADDLE_DEPTH / 2;
  if (b.vz < 0 && b.z - R <= face && b.z >= PADDLE_Z - PADDLE_DEPTH && Math.abs(b.x - s.paddle) <= PADDLE_HALF + R) {
    const off = clamp((b.x - s.paddle) / PADDLE_HALF, -1, 1), a = off * MAX_ANGLE;
    s.rally++;
    s.speed = Math.min(topSpeed(s.level), s.speed + 0.12);
    b.vx = Math.sin(a) * s.speed; b.vz = Math.cos(a) * s.speed; b.z = face + R;
    s.aim = s.rand() * 1.4 - 0.7;
    s.events.push({ kind: 'paddle', x: b.x, z: face, off });
  }
  // past it
  if (b.z < -1.6) {
    s.lives--;
    s.events.push({ kind: 'miss', x: b.x, z: b.z });
    if (s.lives <= 0) { s.phase = 'over'; s.events.push({ kind: 'over', x: b.x, z: b.z }); } else { s.phase = 'serve'; rest(s); }
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

/** Where the ball will cross the paddle's line, were nothing but the side walls in its way. */
export function crossing(s: Sim): number | null {
  const b = s.ball;
  if (b.vz >= 0) return null;
  const t = (b.z - (PADDLE_Z + PADDLE_DEPTH / 2 + R)) / -b.vz;
  if (t < 0) return null;
  const lo = -W / 2 + R, span = W - 2 * R;
  let u = (b.x + b.vx * t - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u > span ? 2 * span - u : u);
}

/** A player to watch: serves, goes where the ball will come, a little off-centre so the returns vary. */
function standIn(s: Sim) {
  if (s.phase === 'serve') { if (s.t % 1 < STEP) serve(s); return; }
  if (s.phase !== 'play') { if (s.t % 2 < STEP) next(s); return; }
  const x = crossing(s);
  // (coming: be there, once it's clear of the bricks; going: drift back under it)
  s.want = x !== null && s.ball.z < BRICK_Z0 ? x - s.aim * PADDLE_HALF * 0.8 : s.ball.x * 0.5;
}
