/**
 * Squishy: the course, apart from the drawing and the dumpling (so it can be tested on its own).
 *
 * A level is a seeded climb across a kitchen: towers of things stood up from the counter
 * (stacks of bamboo steamers, tea tins, jars under a chopping board, a plate on a tin, a mango
 * pudding, a lazy Susan that turns), each a top to land on, and the last a golden steamer:
 * home. Sometimes a pair of chopsticks lies from one top to the next. The counter itself is
 * too far down: land on it and it's back to the last top you stood on.
 *
 * The kitchen comes in chapters, by level: the counter first; then the stovetop, where the
 * tops are a butter dish (slippery, with a lip that catches you), a honey jar (you don't land
 * on it: you land against it, stick to the honey on its side, and flick on from there), a pot
 * whose lid lifts on steam every few seconds (a ride up), and a frying pan with its rim.
 *
 * Every tower is made sure of as it's laid: from the top before it, some flick (the way to it,
 * some strength) must land the dumpling's middle on it, by the same parabola the aiming line
 * draws; for a lid, at some moment of its cycle. Units are centimetres; the dumpling is 6
 * across.
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
export const MAT = {
  counter: 0, bamboo: 1, weave: 2, porcelain: 3, lacquer: 4, jelly: 5, tin: 6, jar: 7, board: 8, gold: 9, chopstick: 10, tiles: 11,
  // (12–16 are the drawing's own: a window, the aiming dots, the landing ring, the dark under it, the jelly's light)
  butter: 17, honey: 18, glass: 19, pot: 20, pan: 21, hob: 22, burner: 23, knob: 24,
} as const;
/**
 * What coats the dumpling where it touches: flour (dry: it grips and loses its tack), butter
 * (slippery: it slides, can't hold a wall, and honey won't hold it), crumbs (rough: it bounces
 * and won't settle), pepper (it sneezes: a hop, and the pepper's off), hundreds and thousands
 * (sweet and sticky: more tack). None is 0.
 */
export const DUST = { none: 0, flour: 1, butter: 2, crumbs: 3, pepper: 4, sprinkles: 5 } as const;
export type Dust = (typeof DUST)[keyof typeof DUST];
/** each coating: how fast it comes off on what touches it (/s), how fast it wears off (/s), how much a hard landing shakes off */
export const DUSTS: Record<Dust, { on: number; off: number; shake: number }> = {
  [DUST.none]: { on: 0, off: 0, shake: 0 },
  [DUST.flour]: { on: 6, off: 0.06, shake: 0.5 },
  [DUST.butter]: { on: 3, off: 0.08, shake: 0.5 },
  [DUST.crumbs]: { on: 5, off: 0.1, shake: 0.7 },
  [DUST.pepper]: { on: 6, off: 0.12, shake: 0.3 },
  [DUST.sprinkles]: { on: 4, off: 0.04, shake: 0.4 },
};
/** which kitchen a level is in: the counter, then the stovetop, then both mixed */
export type Chapter = 'counter' | 'stove' | 'mixed';
export const chapterOf = (n: number): Chapter => (n <= 4 ? 'counter' : n <= 8 ? 'stove' : 'mixed');

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
  /** how much the dumpling's tack holds here (0: none, butter; 3: honey), and how fast it tires on a wall of this (0: never) */
  tack: number;
  tire: number;
  /** a lid that lifts: how far, its cycle, where in it it starts, and its rest height */
  lift: { amp: number; period: number; phase: number; y0: number } | null;
  /** what's on it that comes off on the dumpling (flour, crumbs, pepper, sprinkles; butter), if anything */
  dust: Dust;
  mat: number;
  lo: V3;
  hi: V3;
}
export type Top = 'start' | 'steamer' | 'plate' | 'board' | 'pudding' | 'susan' | 'tin' | 'goal' | 'butter' | 'honey' | 'lid' | 'pan';
export interface Tower {
  top: Top;
  /** the middle of its top surface (for honey: the place against its side where you stick) */
  at: V3;
  /** how far from the middle a landing is a landing; or, for a box top, half its sides */
  r: number;
  box?: [number, number];
  yaw: number;
  shapes: Shape[];
  /** what a landing counts on, when not all of it (a pot's lid and knob, not the pot under it) */
  land?: Shape[];
  /** for honey: the jar, and which way the course goes on from its side */
  jar?: { c: V3; r: number };
  exitYaw?: number;
  /** what's drawn under it on the stove: a burner, this wide */
  burner?: number;
}
export interface Level {
  n: number;
  chapter: Chapter;
  towers: Tower[];
  /** everything solid: the counter, the towers, the chopsticks */
  shapes: Shape[];
  /** chopstick pairs, for the drawing: each a pair of capsules */
  sticks: Shape[];
  /** the shapes that move (lids), for the drawing and for moving them */
  movers: Shape[];
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
const base = (): Shape => ({ kind: 'box', c: [0, 0, 0], b: [0, 0, 0], h: [0, 0, 0], r: 0, hh: 0, yaw: 0, mu: 0.8, bounce: 0, spin: 0, tack: 1, tire: 1, lift: null, dust: DUST.none, mat: 0, lo: [0, 0, 0], hi: [0, 0, 0] });
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
    case 'butter': return 12;
    case 'honey': return 6.5;
    case 'lid': return ramp(r, 9.5, 12);
    case 'pan': return ramp(r, 13, 15);
  }
}
/** how far a tower keeps others off, from its middle (a honey tower's middle is its jar's) */
function keep(t: Tower): { x: number; z: number; r: number } {
  if (t.jar) return { x: t.jar.c[0], z: t.jar.c[2], r: t.jar.r + 4 };
  return { x: t.at[0], z: t.at[2], r: t.box ? Math.hypot(t.box[0], t.box[1]) : t.r + 1 };
}
/** A tower of a kind, its top at `at`: what holds it up from the counter, and what's on top. */
export function tower(top: Top, at: V3, rad: number, yaw: number, r: Rand): Tower {
  const [x, y, z] = at;
  // (what's on a top is decided from where it stands, not from the level's own dice, so it changes no layout)
  const coin = (salt: number) => (hash(Math.round(x * 10), Math.round(z * 10), salt) % 1000) / 1000;
  const shapes: Shape[] = [];
  let landR = rad - 1;
  let box2: [number, number] | null = null;
  let jar: Tower['jar'];
  let land: Shape[] | undefined;
  switch (top) {
    case 'start':
    case 'steamer':
    case 'goal':
      // a stack of bamboo steamers right down to the counter
      shapes.push(cyl(x, z, rad, 0, y, top === 'goal' ? MAT.gold : MAT.bamboo));
      break;
    case 'plate': {
      // a plate on a tea tin: glazed, and so a little slippery; now and then with crumbs on it, or pepper
      shapes.push(cyl(x, z, rad * 0.5, 0, y - 1.6, MAT.tin));
      const pl = cyl(x, z, rad, y - 1.6, y, MAT.porcelain, 0.55);
      const d = coin(0x2c);
      if (d < 0.3) pl.dust = DUST.crumbs; else if (d < 0.55) pl.dust = DUST.pepper;
      shapes.push(pl);
      break;
    }
    case 'board': {
      // a chopping board laid across two jars
      const ux = Math.cos(yaw), uz = -Math.sin(yaw);
      for (const s of [-1, 1]) shapes.push(cyl(x + ux * 9 * s, z + uz * 9 * s, 4.5, 0, y - 2.4, MAT.jar));
      const bd = box([x, y - 1.2, z], [15, 1.2, 9], yaw, MAT.board, 0.85);
      // (most boards are floury)
      if (coin(0x1f) < 0.65) bd.dust = DUST.flour;
      shapes.push(bd);
      landR = 8;
      box2 = [14, 8];
      break;
    }
    case 'pudding': {
      // a mango pudding on a saucer on a tin: it gives, and throws you back up
      shapes.push(cyl(x, z, 5.5, 0, y - 6.2, MAT.tin));
      shapes.push(cyl(x, z, 10.5, y - 6.2, y - 5.4, MAT.porcelain, 0.5));
      const p = cyl(x, z, rad, y - 5.4, y, MAT.jelly, 0.85);
      p.bounce = 0.3;
      // (some with hundreds and thousands on top)
      if (coin(0x5e) < 0.5) p.dust = DUST.sprinkles;
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
    case 'butter': {
      // a butter dish on a tin: a block of butter, slippery, in a porcelain dish with a lip round it that catches you
      shapes.push(cyl(x, z, 5, 0, y - 2, MAT.tin));
      shapes.push(box([x, y - 1.6, z], [12, 0.6, 8.5], yaw, MAT.porcelain, 0.5));
      const b = box([x, y - 0.5, z], [8.5, 0.5, 5.5], yaw, MAT.butter, 0.28);
      b.tack = 0; b.dust = DUST.butter;
      shapes.push(b);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      // (the lip: a proper wall, as a covered dish's base has; a fast slide stops against it)
      const at2 = (lx: number, lz: number): V3 => [x + cy * lx + sy * lz, y + 0.6, z - sy * lx + cy * lz];
      for (const sx of [-1, 1]) shapes.push(box(at2(11.75 * sx, 0), [0.25, 1.9, 8.5], yaw, MAT.porcelain, 0.5));
      for (const sz of [-1, 1]) shapes.push(box(at2(0, 8.25 * sz), [11.5, 1.9, 0.25], yaw, MAT.porcelain, 0.5));
      box2 = [11.5, 8.25];
      break;
    }
    case 'honey': {
      // a honey jar, taller than a flick reaches: honey has run down its side, and that's where you land, against it, and stick
      const jc: V3 = [x + Math.sin(yaw) * (rad + RADIUS * 0.82), 0, z + Math.cos(yaw) * (rad + RADIUS * 0.82)];
      shapes.push(cyl(jc[0], jc[2], rad, 0, y + 15, MAT.glass, 0.45));
      shapes.push(cyl(jc[0], jc[2], rad * 0.9, y + 15, y + 17.5, MAT.board, 0.7));
      // (the honey has run well down: a splat slides a little before it holds, and stays on honey)
      const h = cyl(jc[0], jc[2], rad + 0.45, y - 12, y + 4.5, MAT.honey, 0.9);
      h.tack = 3; h.tire = 0;
      shapes.push(h);
      jar = { c: [jc[0], y, jc[2]], r: rad + 0.45 };
      landR = 0;
      break;
    }
    case 'lid': {
      // a pot on the hob, its lid on: the steam under it lifts the lid every few seconds, and you with it
      shapes.push(cyl(x, z, rad, 0, y - 1.8, MAT.pot));
      const l = cyl(x, z, rad + 0.7, y - 1.6, y, MAT.pot, 0.7);
      l.lift = { amp: 7, period: ramp(r, 4.5, 6.5), phase: r(), y0: l.c[1] };
      shapes.push(l);
      const k = cyl(x, z, 1.3, y, y + 1.2, MAT.knob, 0.7);
      k.lift = { ...l.lift, y0: k.c[1] };
      shapes.push(k);
      land = [l, k];
      landR = rad - 0.5;
      break;
    }
    case 'pan': {
      // a frying pan on a pot: wide and a little slippery, with a rim round it, and a handle out the back
      shapes.push(cyl(x, z, 8, 0, y - 1.4, MAT.pot));
      shapes.push(cyl(x, z, rad, y - 1.4, y, MAT.pan, 0.4));
      const segs = 14;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
        const A: V3 = [x + Math.cos(a0) * (rad - 0.3), y + 1, z + Math.sin(a0) * (rad - 0.3)], B: V3 = [x + Math.cos(a1) * (rad - 0.3), y + 1, z + Math.sin(a1) * (rad - 0.3)];
        shapes.push(cap(A, B, 1, MAT.pan, 0.5));
      }
      // (the handle out to one side of the course, where it's out of the way of the hops)
      const hy = yaw + (r() < 0.5 ? -1 : 1) * Math.PI / 2;
      shapes.push(box([x + Math.sin(hy) * (rad + 6.5), y + 0.6, z + Math.cos(hy) * (rad + 6.5)], [1.4, 0.7, 7.5], hy, MAT.board, 0.7));
      landR = rad - 2;
      break;
    }
  }
  const tw: Tower = { top, at, r: landR, yaw, shapes };
  if (box2) tw.box = box2;
  if (jar) tw.jar = jar;
  if (land) tw.land = land;
  return tw;
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
    // (a turning top: its surface moves, ω × r; a lifting one goes up and down)
    if (sh.spin) { o.vx = sh.spin * dz; o.vz = -sh.spin * dx; }
    if (sh.lift) o.vy = sh.b[1];
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
/**
 * A lid's cycle: at rest most of the time, then it lifts (the steam under it), holds a moment,
 * rattling, and settles. 0–1 of its lift, and how fast it's going (lifts a second).
 */
export function liftAt(l: NonNullable<Shape['lift']>, t: number): { k: number; v: number } {
  const ph = (((t / l.period + l.phase) % 1) + 1) % 1;
  const ease = (x: number) => x * x * (3 - 2 * x), dease = (x: number) => 6 * x * (1 - x);
  if (ph < 0.6) return { k: 0, v: 0 };
  if (ph < 0.7) { const x = (ph - 0.6) / 0.1; return { k: ease(x), v: dease(x) / (0.1 * l.period) }; }
  if (ph < 0.82) { const x = (ph - 0.7) / 0.12; return { k: 1 - 0.06 * Math.sin(x * 25), v: (-0.06 * 25 * Math.cos(x * 25)) / (0.12 * l.period) }; }
  const x = (ph - 0.82) / 0.18;
  return { k: 1 - ease(x), v: -dease(x) / (0.18 * l.period) };
}
/** The lids where they are at a time: moved, their bounds with them, their speed kept (in b[1]) for what rests on them. */
export function moveShapes(lv: Level, t: number) {
  for (const s of lv.movers) {
    const l = s.lift!;
    const { k, v } = liftAt(l, t);
    s.c[1] = l.y0 + l.amp * k;
    s.b[1] = l.amp * v;
    s.lo[1] = s.c[1] - s.hh; s.hi[1] = s.c[1] + s.hh;
  }
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
export function path(lv: Level, from: V3, vel: V3, max = 3, t0 = 0): Path {
  const pts: V3[] = [];
  const h = 1 / 240, R = RADIUS * 0.82;
  // (as it leaves it's still broad and low, sat on its flat bottom: a wider ball for the first moments, so a lip ahead of it is seen to catch it)
  const ballAt = (t: number) => RADIUS * (1.15 - 0.33 * Math.min(1, t / 0.15));
  const o: Hit = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
  const ns: Shape[] = [];
  let [x, y, z] = from, [vx, vy, vz] = vel;
  // (what it's squashed against and going away from, the top it's leaving, a jar it's stuck to: not a hit for the first moments; anything it's going toward is)
  const leaving: Shape[] = [];
  if (lv.movers.length) moveShapes(lv, t0);
  near(lv, from, R + 0.5, ns);
  for (const s of ns) if (touch(s, from[0], from[1], from[2], R + 0.5, o) && o.d > 0 && vel[0] * o.nx + vel[1] * o.ny + vel[2] * o.nz > 0) leaving.push(s);
  for (let i = 0, t = 0; t < max; i++, t += h) {
    vy -= G * h;
    x += vx * h; y += vy * h; z += vz * h;
    if (i % 8 === 0) pts.push([x, y, z]);
    if (t < 0.01) continue;
    if (lv.movers.length && i % 4 === 0) moveShapes(lv, t0 + t);
    const Rt = ballAt(t);
    near(lv, [x, y, z], Rt + 1, ns);
    for (const s of ns) if (!(t < 0.2 && leaving.includes(s)) && touch(s, x, y, z, Rt, o) && o.d > 0) {
      pts.push([x, y, z]);
      if (lv.movers.length) moveShapes(lv, t0);
      return { pts, hit: { p: [x, y, z], n: [o.nx, o.ny, o.nz], shape: s }, t };
    }
  }
  if (lv.movers.length) moveShapes(lv, t0);
  return { pts, hit: null, t: max };
}
/** Whether a point is on a tower's top: within its landing reach, and resting on it (not below). */
export function onTop(tw: Tower, p: V3, slack = 0): boolean {
  const dx = p[0] - tw.at[0], dz = p[2] - tw.at[2];
  if (tw.jar) {
    // (against the honey on the jar's side, within its band)
    const d = Math.hypot(p[0] - tw.jar.c[0], p[2] - tw.jar.c[2]) - tw.jar.r;
    return p[1] > tw.at[1] - 12 - slack && p[1] < tw.at[1] + 5.5 + slack && d > 0.5 - slack && d < 4.5 + slack;
  }
  // (on a lid: above the lid where it is now, not on the pot under it while it's up)
  const lidTop = tw.land ? tw.land[0].c[1] + tw.land[0].hh : tw.at[1];
  // (a little below its top too: a dish has a gutter round its butter)
  if (p[1] < lidTop - (tw.box ? 2 : 0.5) || p[1] > lidTop + RADIUS * 2.5) return false;
  if (tw.box) {
    const cy = Math.cos(tw.yaw), sy = Math.sin(tw.yaw);
    const lx = cy * dx - sy * dz, lz = sy * dx + cy * dz;
    return Math.abs(lx) < tw.box[0] + slack && Math.abs(lz) < tw.box[1] + slack;
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
export function aim(lv: Level, from: V3, k: number, t = 0): { yaw: number; power: number } | null {
  const tw = lv.towers[k];
  const yaw = Math.atan2(tw.at[0] - from[0], tw.at[2] - from[2]);
  let lo = -1, hi = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const pa = path(lv, from, launch(yaw, p), 3, t);
    // (on its top; or, for honey, against the honey, which holds)
    const ok = pa.hit && (tw.land ?? tw.shapes).includes(pa.hit.shape) && (tw.jar ? pa.hit.shape.tack > 1 && Math.abs(pa.hit.n[1]) < 0.6 : pa.hit.n[1] > 0.7) && onTop(tw, pa.hit.p, -1.5);
    if (ok) { if (lo < 0) lo = p; hi = p; } else if (lo >= 0) break;
  }
  // (a little short of the middle of the band: it carries on a little after it lands)
  return lo < 0 ? null : { yaw, power: lo + (hi - lo) * 0.4 };
}
/** Where the dumpling's middle is, sat on tower j at a time (on a lid, it rides with it). */
export function standing(lv: Level, j: number, t = 0): V3 {
  const tw = lv.towers[j];
  if (!tw.land) return [tw.at[0], tw.at[1] + REST_H, tw.at[2]];
  const l = tw.land[0];
  return [tw.at[0], l.lift!.y0 + l.hh + l.lift!.amp * liftAt(l.lift!, t).k + REST_H, tw.at[2]];
}
/**
 * Whether the hop from tower j to tower k can be made: from the middle of j (from a jar's side,
 * from lower down too: a splat slides before the honey holds it). With a lid at either end, at some moment
 * of its cycle; otherwise, now.
 */
export function hop(lv: Level, j: number, k: number): { t: number; flights: V3[][] } | null {
  const a = lv.towers[j], b = lv.towers[k];
  const lid = (b.land ?? a.land)?.[0].lift;
  const times = lid ? [0, 1, 2, 3, 4, 5].map((i) => ((i / 6 + 1 - lid.phase) % 1) * lid.period) : [0];
  const froms = (t: number) => { const f = standing(lv, j, t); return a.jar ? [f, [f[0], f[1] - 4, f[2]] as V3, [f[0], f[1] - 8, f[2]] as V3] : [f]; };
  for (const t of times) {
    const fs = froms(t), aims = fs.map((f) => aim(lv, f, k, t));
    if (aims.every(Boolean)) return { t, flights: fs.map((f, i) => path(lv, f, launch(aims[i]!.yaw, aims[i]!.power), 3, t).pts) };
  }
  return null;
}

// ─── a level ─────────────────────────────────────────────────────────────────────────────────────
/** what can come next, by level: the harder kinds come in as it goes */
function pickTop(r: Rand, n: number, prev: Top): Top {
  const ch = chapterOf(n);
  let pool: Top[];
  if (ch === 'counter') {
    pool = ['steamer', 'steamer', 'board'];
    if (n >= 2) pool.push('plate', 'steamer');
    if (n >= 3) pool.push('pudding', 'tin');
    if (n >= 4) pool.push('susan', 'plate');
  } else if (ch === 'stove') {
    // the stovetop: level 5 brings the butter dish and the pan; 6 the honey jar; 7 the lids
    pool = ['steamer', 'pan', 'butter', 'pan'];
    if (n >= 6) pool.push('honey', 'butter', 'honey');
    if (n >= 7) pool.push('lid', 'lid', 'honey');
    if (n >= 8) pool.push('tin', 'lid');
  } else {
    pool = ['steamer', 'board', 'plate', 'pudding', 'tin', 'susan', 'pan', 'butter', 'honey', 'lid', 'honey', 'lid'];
  }
  // (not honey twice running: from a jar's side the course turns, and a second jar there is a wall)
  if (prev === 'honey') pool = pool.filter((t) => t !== 'honey');
  return pool[Math.floor(r() * pool.length)];
}
/** Level n: from the start steamer up and across to the golden one, every hop made sure of. */
export function buildLevel(n: number): Level {
  const r = seeded(hash(n, 0x5917));
  const chapter = chapterOf(n);
  const counter = box([0, -10, 0], [3000, 10, 3000], 0, chapter === 'counter' ? MAT.counter : MAT.hob, 0.8);
  const lv: Level = { n, chapter, towers: [], shapes: [counter], sticks: [], movers: [] };
  const add = (tw: Tower) => {
    lv.towers.push(tw); lv.shapes.push(...tw.shapes);
    for (const s of tw.shapes) if (s.lift) lv.movers.push(s);
    if (chapter !== 'counter' && tw.top !== 'honey' && tw.top !== 'board') tw.burner = (tw.top === 'butter' ? 5 : tw.shapes[0].r) + 3.5;
  };
  const remove = (tw: Tower) => { lv.towers.pop(); lv.shapes.length -= tw.shapes.length; lv.movers = lv.movers.filter((m) => !tw.shapes.includes(m)); };
  add(tower('start', [0, 16, 0], size('start', r), 0, r));
  const count = 6 + Math.min(10, n);
  // (the way each hop made sure of flies: nothing later is stood in it)
  const corridors: V3[][] = [];
  const inTheWay = (tw: Tower) => tw.shapes.some((s) => corridors.some((c) => c.some((p) => p[0] > s.lo[0] - RADIUS * 1.3 && p[0] < s.hi[0] + RADIUS * 1.3 && p[1] > s.lo[1] - RADIUS * 1.3 && p[1] < s.hi[1] + RADIUS * 1.3 && p[2] > s.lo[2] - RADIUS * 1.3 && p[2] < s.hi[2] + RADIUS * 1.3)));
  let yaw = 0;
  for (let k = 1; k <= count; k++) {
    const prev = lv.towers[k - 1];
    const top: Top = k === count ? 'goal' : pickTop(r, n, prev.top);
    const rad = size(top, r);
    const hard = Math.min(1, n / 10);
    // (from a jar's side the course turns away from the jar, sharply)
    if (prev.exitYaw !== undefined) yaw = prev.exitYaw;
    let placed: Tower | null = null;
    for (let tries = 0; tries < 24 && !placed; tries++) {
      const shrink = 1 - tries * 0.035;
      const turn = ramp(r, -0.75, 0.75) * (tries > 12 ? 0.5 : 1);
      const gap = ramp(r, 5, 12 + 22 * hard) * shrink;
      const dy = ramp(r, -6, 8 + 10 * hard) * shrink;
      const y = Math.max(8, Math.min(320, prev.at[1] + dy));
      const prevR = prev.jar ? 2 : prev.box ? Math.hypot(prev.box[0], prev.box[1]) - 3 : prev.r + 1;
      const d = prevR + gap + (top === 'honey' ? 1 : rad);
      const ny = yaw + turn;
      const at: V3 = [prev.at[0] + Math.sin(ny) * d, y, prev.at[2] + Math.cos(ny) * d];
      const tw = tower(top, at, rad, ny + (top === 'honey' ? 0 : ramp(r, -0.4, 0.4)), r);
      // (clear of every tower so far, a hand's width between)
      const me = keep(tw);
      if (lv.towers.some((t) => { const o = keep(t); return Math.hypot(o.x - me.x, o.z - me.z) < o.r + me.r + 6; })) continue;
      if (inTheWay(tw)) continue;
      add(tw);
      // (this hop can be made; and the one before still can, with this tower stood by it)
      const h = hop(lv, k - 1, k);
      if (h && (k < 2 || hop(lv, k - 2, k - 1))) {
        placed = tw; yaw = ny;
        corridors.push(...h.flights);
        if (tw.jar) tw.exitYaw = ny + (r() < 0.5 ? -1 : 1) * ramp(r, 1.7, 2.3);
      } else remove(tw);
    }
    if (!placed) {
      // (nothing fitted: a steamer close by, a little up, which nearly always does; turned this way or that until it's clear)
      // (from a jar's side, further off: a close top is a wall to a flick from low on the honey)
      for (const [turn, reach] of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, 3].flatMap((t) => [[t, 18], [t, 26]])) {
        const ny = yaw + turn, d = (prev.jar ? 10 : prev.r) + reach;
        const at: V3 = [prev.at[0] + Math.sin(ny) * d, prev.at[1] + 2, prev.at[2] + Math.cos(ny) * d];
        const tw = tower(k === count ? 'goal' : 'steamer', at, 11, ny, r);
        const me = keep(tw);
        if (lv.towers.some((t) => { const o = keep(t); return Math.hypot(o.x - me.x, o.z - me.z) < o.r + me.r + 6; }) || inTheWay(tw)) continue;
        add(tw);
        const h = hop(lv, k - 1, k);
        if (h && (k < 2 || hop(lv, k - 2, k - 1))) { placed = tw; yaw = ny; corridors.push(...h.flights); break; }
        remove(tw);
      }
      if (!placed) {
        const d = (prev.jar ? 12 : prev.r) + 18;
        const at: V3 = [prev.at[0] + Math.sin(yaw) * d, prev.at[1] + 2, prev.at[2] + Math.cos(yaw) * d];
        add(tower(k === count ? 'goal' : 'steamer', at, 11, yaw, r));
      }
    }
  }
  // chopsticks laid from one top to the next, now and then, where the two are near level
  for (let k = 1; k < lv.towers.length; k++) {
    const a = lv.towers[k - 1], b = lv.towers[k];
    if (Math.abs(a.at[1] - b.at[1]) > 5 || r() > 0.35 || a.top === 'susan' || b.top === 'susan' || a.jar || b.jar || a.top === 'lid' || b.top === 'lid' || a.top === 'pan' || b.top === 'pan') continue;
    const dx = b.at[0] - a.at[0], dz = b.at[2] - a.at[2], L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    const ea = a.box ? a.box[1] + 1 : a.r - 2, eb = b.box ? b.box[1] + 1 : b.r - 2;
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
