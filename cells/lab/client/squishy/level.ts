/**
 * Squishy: the course, apart from the drawing and the dumpling (so it can be tested on its own).
 *
 * A level is a seeded climb across a kitchen counter: towers of things stood up from the
 * counter (stacks of bamboo steamers, tea tins, jars under a chopping board, a plate on a tin,
 * a mango pudding, a lazy Susan that turns), each a top to land on, and the last a golden
 * steamer: home. Sometimes a pair of chopsticks lies from one top to the next. The counter
 * itself is too far down: land on it and it's back to the last top you stood on.
 *
 * Every tower is made sure of as it's laid: from the top before it, some flick (the way to it,
 * some strength) must land the dumpling's middle on it, by the same parabola the aiming line
 * draws. Units are centimetres; the dumpling is 6 across.
 */
import { hash, seeded, type Rand } from '../kit/rng';

export type V3 = [number, number, number];
export const G = 981;
/** the dumpling's size (its radius) */
export const RADIUS = 3;
/** a flick: from gentle to hard, always at this angle up */
export const V_MIN = 70, V_MAX = 340, LAUNCH = (60 * Math.PI) / 180;
/** how high the dumpling's middle sits above what it rests on */
export const REST_H = RADIUS * 0.62;

/** what each thing is made of, for the drawing */
export const MAT = { counter: 0, bamboo: 1, weave: 2, porcelain: 3, lacquer: 4, jelly: 5, tin: 6, jar: 7, board: 8, gold: 9, chopstick: 10, tiles: 11 } as const;

/** A solid the dumpling meets: a box (turned about the vertical), an upright cylinder, or a capsule. */
export interface Shape {
  kind: 'box' | 'cyl' | 'cap';
  /** box and cylinder: the centre; capsule: one end */
  c: V3;
  /** capsule: the other end */
  b: V3;
  /** box: half its size */
  h: V3;
  /** cylinder and capsule: the radius; cylinder: half its height */
  r: number;
  hh: number;
  yaw: number;
  /** grip, bounce, and turning (radians a second, about the vertical: a lazy Susan) */
  mu: number;
  bounce: number;
  spin: number;
  mat: number;
  lo: V3;
  hi: V3;
}
export type Top = 'start' | 'steamer' | 'plate' | 'board' | 'pudding' | 'susan' | 'tin' | 'goal';
export interface Tower {
  top: Top;
  /** the middle of its top surface */
  at: V3;
  /** how far from the middle a landing is a landing */
  r: number;
  yaw: number;
  shapes: Shape[];
}
export interface Level {
  n: number;
  towers: Tower[];
  /** everything solid: the counter, the towers, the chopsticks */
  shapes: Shape[];
  /** chopstick pairs, for the drawing: each a pair of capsules */
  sticks: Shape[];
}

const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
function bounds(s: Shape): Shape {
  if (s.kind === 'box') {
    const ex = Math.abs(Math.cos(s.yaw)) * s.h[0] + Math.abs(Math.sin(s.yaw)) * s.h[2], ez = Math.abs(Math.sin(s.yaw)) * s.h[0] + Math.abs(Math.cos(s.yaw)) * s.h[2];
    s.lo = [s.c[0] - ex, s.c[1] - s.h[1], s.c[2] - ez];
    s.hi = [s.c[0] + ex, s.c[1] + s.h[1], s.c[2] + ez];
  } else if (s.kind === 'cyl') {
    s.lo = [s.c[0] - s.r, s.c[1] - s.hh, s.c[2] - s.r];
    s.hi = [s.c[0] + s.r, s.c[1] + s.hh, s.c[2] + s.r];
  } else {
    s.lo = [Math.min(s.c[0], s.b[0]) - s.r, Math.min(s.c[1], s.b[1]) - s.r, Math.min(s.c[2], s.b[2]) - s.r];
    s.hi = [Math.max(s.c[0], s.b[0]) + s.r, Math.max(s.c[1], s.b[1]) + s.r, Math.max(s.c[2], s.b[2]) + s.r];
  }
  return s;
}
const base = (): Shape => ({ kind: 'box', c: [0, 0, 0], b: [0, 0, 0], h: [0, 0, 0], r: 0, hh: 0, yaw: 0, mu: 0.8, bounce: 0, spin: 0, mat: 0, lo: [0, 0, 0], hi: [0, 0, 0] });
export const box = (c: V3, h: V3, yaw: number, mat: number, mu = 0.8): Shape => bounds({ ...base(), kind: 'box', c, h, yaw, mat, mu });
/** an upright cylinder from y0 up to y1 */
export const cyl = (x: number, z: number, r: number, y0: number, y1: number, mat: number, mu = 0.8): Shape =>
  bounds({ ...base(), kind: 'cyl', c: [x, (y0 + y1) / 2, z], r, hh: (y1 - y0) / 2, mat, mu });
export const cap = (a: V3, b: V3, r: number, mat: number, mu = 0.7): Shape => bounds({ ...base(), kind: 'cap', c: a, b, r, mat, mu });

/** How far out each kind's top reaches, from its middle. */
function size(top: Top, r: Rand): number {
  switch (top) {
    case 'start': return 14;
    case 'goal': return 15;
    case 'steamer': return ramp(r, 10.5, 13.5);
    case 'plate': return ramp(r, 11, 14);
    case 'board': return 9;
    case 'pudding': return 7.5;
    case 'susan': return ramp(r, 13, 15);
    case 'tin': return ramp(r, 6.5, 8);
  }
}
/** A tower of a kind, its top at `at`: what holds it up from the counter, and what's on top. */
export function tower(top: Top, at: V3, rad: number, yaw: number, r: Rand): Tower {
  const [x, y, z] = at;
  const shapes: Shape[] = [];
  let landR = rad - 1;
  switch (top) {
    case 'start':
    case 'steamer':
    case 'goal':
      // a stack of bamboo steamers right down to the counter
      shapes.push(cyl(x, z, rad, 0, y, top === 'goal' ? MAT.gold : MAT.bamboo));
      break;
    case 'plate': {
      // a plate on a tea tin: glazed, and so a little slippery
      shapes.push(cyl(x, z, rad * 0.5, 0, y - 1.6, MAT.tin));
      shapes.push(cyl(x, z, rad, y - 1.6, y, MAT.porcelain, 0.55));
      break;
    }
    case 'board': {
      // a chopping board laid across two jars
      const ux = Math.cos(yaw), uz = -Math.sin(yaw);
      for (const s of [-1, 1]) shapes.push(cyl(x + ux * 9 * s, z + uz * 9 * s, 4.5, 0, y - 2.4, MAT.jar));
      shapes.push(box([x, y - 1.2, z], [15, 1.2, 9], yaw, MAT.board, 0.85));
      landR = 8;
      break;
    }
    case 'pudding': {
      // a mango pudding on a saucer on a tin: it gives, and throws you back up
      shapes.push(cyl(x, z, 5.5, 0, y - 6.2, MAT.tin));
      shapes.push(cyl(x, z, 10.5, y - 6.2, y - 5.4, MAT.porcelain, 0.5));
      const p = cyl(x, z, rad, y - 5.4, y, MAT.jelly, 0.85);
      p.bounce = 0.3;
      shapes.push(bounds(p));
      landR = rad - 1.5;
      break;
    }
    case 'susan': {
      // a lacquered lazy Susan on a tin, turning
      shapes.push(cyl(x, z, 6, 0, y - 1.4, MAT.tin));
      const s = cyl(x, z, rad, y - 1.4, y, MAT.lacquer, 0.85);
      s.spin = (r() < 0.5 ? -1 : 1) * ramp(r, 0.45, 0.8);
      shapes.push(bounds(s));
      break;
    }
    case 'tin': {
      // a tall tea tin: a small top
      shapes.push(cyl(x, z, rad, 0, y, MAT.tin));
      landR = rad - 1.5;
      break;
    }
  }
  return { top, at, r: landR, yaw, shapes };
}

// ─── meeting the course ──────────────────────────────────────────────────────────────────────────
/** a touch: the normal out of the surface, how deep (negative: apart by that much), the surface's own velocity there */
export interface Hit { nx: number; ny: number; nz: number; d: number; vx: number; vy: number; vz: number }
/**
 * A point with a skin of s against a shape: true if within s + gap of its surface, and then
 * the push out (normal, depth), the surface's velocity there.
 */
export function touch(sh: Shape, px: number, py: number, pz: number, s: number, o: Hit, gap = 0): boolean {
  const dx = px - sh.c[0], dy = py - sh.c[1], dz = pz - sh.c[2];
  o.vx = 0; o.vy = 0; o.vz = 0;
  if (sh.kind === 'box') {
    const cy = Math.cos(sh.yaw), sy = Math.sin(sh.yaw);
    const lx = cy * dx - sy * dz, ly = dy, lz = sy * dx + cy * dz;
    const [hx, hy, hz] = sh.h;
    const ex = lx - Math.max(-hx, Math.min(hx, lx)), ey = ly - Math.max(-hy, Math.min(hy, ly)), ez = lz - Math.max(-hz, Math.min(hz, lz));
    const dist = Math.hypot(ex, ey, ez);
    let nx: number, ny: number, nz: number;
    if (dist > 1e-6) {
      if (dist > s + gap) return false;
      nx = ex / dist; ny = ey / dist; nz = ez / dist;
      o.d = s - dist;
    } else {
      const ax = hx - Math.abs(lx), ay = hy - Math.abs(ly), az = hz - Math.abs(lz);
      if (ay <= ax && ay <= az) { nx = 0; ny = Math.sign(ly) || 1; nz = 0; o.d = s + ay; }
      else if (ax <= az) { nx = Math.sign(lx) || 1; ny = 0; nz = 0; o.d = s + ax; }
      else { nx = 0; ny = 0; nz = Math.sign(lz) || 1; o.d = s + az; }
    }
    o.nx = cy * nx + sy * nz; o.ny = ny; o.nz = -sy * nx + cy * nz;
    return true;
  }
  if (sh.kind === 'cyl') {
    const rr = Math.hypot(dx, dz), dr = rr - sh.r, dh = Math.abs(dy) - sh.hh;
    const rx = rr > 1e-6 ? dx / rr : 1, rz = rr > 1e-6 ? dz / rr : 0, sy = Math.sign(dy) || 1;
    if (dr <= 0 && dh <= 0) {
      if (-dr < -dh) { o.nx = rx; o.ny = 0; o.nz = rz; o.d = s - dr; }
      else { o.nx = 0; o.ny = sy; o.nz = 0; o.d = s - dh; }
    } else if (dr > 0 && dh > 0) {
      const dist = Math.hypot(dr, dh);
      if (dist > s + gap) return false;
      o.nx = (rx * dr) / dist; o.ny = (sy * dh) / dist; o.nz = (rz * dr) / dist; o.d = s - dist;
    } else if (dr > 0) {
      if (dr > s + gap) return false;
      o.nx = rx; o.ny = 0; o.nz = rz; o.d = s - dr;
    } else {
      if (dh > s + gap) return false;
      o.nx = 0; o.ny = sy; o.nz = 0; o.d = s - dh;
    }
    // (a turning top: its surface moves, ω × r)
    if (sh.spin) { o.vx = sh.spin * dz; o.vz = -sh.spin * dx; }
    return true;
  }
  const ax = sh.b[0] - sh.c[0], ay = sh.b[1] - sh.c[1], az = sh.b[2] - sh.c[2];
  const t = Math.max(0, Math.min(1, (dx * ax + dy * ay + dz * az) / (ax * ax + ay * ay + az * az || 1)));
  const ex = dx - ax * t, ey = dy - ay * t, ez = dz - az * t;
  const dist = Math.hypot(ex, ey, ez);
  if (dist > s + sh.r + gap || dist < 1e-6) return false;
  o.nx = ex / dist; o.ny = ey / dist; o.nz = ez / dist; o.d = s + sh.r - dist;
  return true;
}
/** The shapes whose bounds come within rad of a point. */
export function near(lv: Level, p: V3, rad: number, out: Shape[]): Shape[] {
  out.length = 0;
  for (const s of lv.shapes) {
    if (p[0] + rad < s.lo[0] || p[0] - rad > s.hi[0] || p[1] + rad < s.lo[1] || p[1] - rad > s.hi[1] || p[2] + rad < s.lo[2] || p[2] - rad > s.hi[2]) continue;
    out.push(s);
  }
  return out;
}

// ─── the flick, and where it goes ─────────────────────────────────────────────────────────────────
/** A flick the way yaw (from +z toward +x), so hard (0–1): the velocity it gives. */
export function launch(yaw: number, power: number): V3 {
  const v = V_MIN + (V_MAX - V_MIN) * Math.max(0, Math.min(1, power));
  return [Math.sin(yaw) * Math.cos(LAUNCH) * v, Math.sin(LAUNCH) * v, Math.cos(yaw) * Math.cos(LAUNCH) * v];
}
export interface Path { pts: V3[]; hit: { p: V3; n: V3; shape: Shape } | null; t: number }
/**
 * Where the dumpling's middle goes from `from` at `vel`: a parabola (its middle flies one; the
 * squish is about it) until a ball the size of its middle meets something.
 */
export function path(lv: Level, from: V3, vel: V3, max = 3): Path {
  const pts: V3[] = [];
  const h = 1 / 240, R = RADIUS * 0.82;
  const o: Hit = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
  const ns: Shape[] = [];
  let [x, y, z] = from, [vx, vy, vz] = vel;
  for (let i = 0, t = 0; t < max; i++, t += h) {
    vy -= G * h;
    x += vx * h; y += vy * h; z += vz * h;
    if (i % 8 === 0) pts.push([x, y, z]);
    // (not the top it's leaving, for the first moments)
    if (t < 0.05) continue;
    near(lv, [x, y, z], R + 1, ns);
    for (const s of ns) if (touch(s, x, y, z, R, o) && o.d > 0) {
      pts.push([x, y, z]);
      return { pts, hit: { p: [x, y, z], n: [o.nx, o.ny, o.nz], shape: s }, t };
    }
  }
  return { pts, hit: null, t: max };
}
/** Whether a point is on a tower's top: within its landing reach, and resting on it (not below). */
export function onTop(tw: Tower, p: V3, slack = 0): boolean {
  const dx = p[0] - tw.at[0], dz = p[2] - tw.at[2];
  if (p[1] < tw.at[1] - 0.5 || p[1] > tw.at[1] + RADIUS * 2.5) return false;
  if (tw.top === 'board') {
    const cy = Math.cos(tw.yaw), sy = Math.sin(tw.yaw);
    const lx = cy * dx - sy * dz, lz = sy * dx + cy * dz;
    return Math.abs(lx) < 14 + slack && Math.abs(lz) < 8 + slack;
  }
  return Math.hypot(dx, dz) < tw.r + slack;
}
/** The tower whose top a point is on, or -1. */
export function towerAt(lv: Level, p: V3, slack = 0): number {
  for (let i = lv.towers.length - 1; i >= 0; i--) if (onTop(lv.towers[i], p, slack)) return i;
  return -1;
}
/**
 * A flick from `from` that lands on tower k: the way to it, and the strength in the middle of
 * the band that lands there (the safest); null if none does.
 */
export function aim(lv: Level, from: V3, k: number): { yaw: number; power: number } | null {
  const tw = lv.towers[k];
  const yaw = Math.atan2(tw.at[0] - from[0], tw.at[2] - from[2]);
  let lo = -1, hi = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const pa = path(lv, from, launch(yaw, p));
    const ok = pa.hit && pa.hit.n[1] > 0.7 && tw.shapes.includes(pa.hit.shape) && onTop(tw, pa.hit.p, -1.5);
    if (ok) { if (lo < 0) lo = p; hi = p; } else if (lo >= 0) break;
  }
  // (a little short of the middle of the band: it carries on a little after it lands)
  return lo < 0 ? null : { yaw, power: lo + (hi - lo) * 0.4 };
}

// ─── a level ─────────────────────────────────────────────────────────────────────────────────────
/** what can come next, by level: the harder kinds come in as it goes */
function pickTop(r: Rand, n: number): Top {
  const pool: Top[] = ['steamer', 'steamer', 'board'];
  if (n >= 2) pool.push('plate', 'steamer');
  if (n >= 3) pool.push('pudding', 'tin');
  if (n >= 4) pool.push('susan', 'plate');
  if (n >= 6) pool.push('tin', 'pudding', 'susan');
  return pool[Math.floor(r() * pool.length)];
}
/** Level n: from the start steamer up and across to the golden one, every hop made sure of. */
export function buildLevel(n: number): Level {
  const r = seeded(hash(n, 0x5917));
  const counter = box([0, -10, 0], [3000, 10, 3000], 0, MAT.counter, 0.8);
  const lv: Level = { n, towers: [], shapes: [counter], sticks: [] };
  const add = (tw: Tower) => { lv.towers.push(tw); lv.shapes.push(...tw.shapes); };
  add(tower('start', [0, 16, 0], size('start', r), 0, r));
  const count = 6 + Math.min(10, n);
  let yaw = 0;
  for (let k = 1; k <= count; k++) {
    const prev = lv.towers[k - 1];
    const top: Top = k === count ? 'goal' : pickTop(r, n);
    const rad = size(top, r);
    const hard = Math.min(1, n / 10);
    let placed: Tower | null = null;
    for (let tries = 0; tries < 24 && !placed; tries++) {
      const shrink = 1 - tries * 0.035;
      const turn = ramp(r, -0.75, 0.75) * (tries > 12 ? 0.5 : 1);
      const gap = ramp(r, 5, 12 + 22 * hard) * shrink;
      const dy = ramp(r, -6, 8 + 10 * hard) * shrink;
      const y = Math.max(8, Math.min(320, prev.at[1] + dy));
      const prevR = prev.top === 'board' ? 10 : prev.r + 1;
      const d = prevR + gap + rad;
      const ny = yaw + turn;
      const at: V3 = [prev.at[0] + Math.sin(ny) * d, y, prev.at[2] + Math.cos(ny) * d];
      // (clear of every tower so far, a hand's width between)
      if (lv.towers.some((t) => Math.hypot(t.at[0] - at[0], t.at[2] - at[2]) < (t.top === 'board' ? 16 : t.r + 1) + (top === 'board' ? 16 : rad) + 6)) continue;
      const tw = tower(top, at, rad, ny + ramp(r, -0.4, 0.4), r);
      add(tw);
      const from: V3 = [prev.at[0], prev.at[1] + REST_H, prev.at[2]];
      if (aim(lv, from, k)) { placed = tw; yaw = ny; }
      else { lv.towers.pop(); lv.shapes.length -= tw.shapes.length; }
    }
    if (!placed) {
      // (nothing fitted: a steamer close by, a little up, which always does)
      const at: V3 = [prev.at[0] + Math.sin(yaw) * (prev.r + 18), prev.at[1] + 2, prev.at[2] + Math.cos(yaw) * (prev.r + 18)];
      add(tower(k === count ? 'goal' : 'steamer', at, 11, yaw, r));
    }
  }
  // chopsticks laid from one top to the next, now and then, where the two are near level
  for (let k = 1; k < lv.towers.length; k++) {
    const a = lv.towers[k - 1], b = lv.towers[k];
    if (Math.abs(a.at[1] - b.at[1]) > 5 || r() > 0.35 || a.top === 'susan' || b.top === 'susan') continue;
    const dx = b.at[0] - a.at[0], dz = b.at[2] - a.at[2], L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    const ea = a.top === 'board' ? 9 : a.r - 2, eb = b.top === 'board' ? 9 : b.r - 2;
    for (const s of [-1.6, 1.6]) {
      const A: V3 = [a.at[0] + ux * ea + px * s, a.at[1] + 0.6, a.at[2] + uz * ea + pz * s];
      const B: V3 = [b.at[0] - ux * eb + px * s, b.at[1] + 0.6, b.at[2] - uz * eb + pz * s];
      const st = cap(A, B, 0.6, MAT.chopstick, 0.6);
      lv.sticks.push(st);
      lv.shapes.push(st);
    }
  }
  return lv;
}
