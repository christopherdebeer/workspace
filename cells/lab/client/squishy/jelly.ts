/**
 * Squishy: a jelly to land on. A round jelly whose top is a membrane: nodes on rings and spokes,
 * each held to its rest height by a spring, damped, and drawn toward its neighbours (so a dent
 * spreads, and ripples). What it does to a landing is set, not left to come out of the membrane: the
 * dumpling sinks into it as into a bed, a spring that firms up, damped to give back what the jelly's
 * kind should (a panna cotta keeps a landing; a mango pudding gives most of it back; a konjac nearly
 * all), its top held to the dumpling's foot while it's in, and let go to wobble when it leaves. It
 * keeps its own clock, so however many things step it, it moves once.
 */
import type { Hit } from './level';

/**
 * How a jelly gives. Its top's wobble: how fast it springs back (Hz), how much of each wobble it keeps,
 * how heavy it is (the dumpling is 1), how far a dent spreads (Hz). And what a landing on it does, set by
 * what it should do, not left to come out of the wobble: how much of a landing it gives back (restitution),
 * and how far into it (of its height) a gentle landing goes (from 10 cm) and a hard one (from 50 cm). (So
 * how long it's in it follows: these are little jellies, a few cm deep; a landing's over in a few hundredths.)
 */
export interface JellyFeel { hz: number; zeta: number; mass: number; spread: number; e: number; soft: number; deep: number }
/**
 * The kinds: a panna cotta (soft: it takes a landing in, and keeps it), a mango pudding (lively: it gives
 * most of a landing back), a konjac jelly (firm and springy: it throws you up nearly as high as you fell).
 * A loaf and a sponge: soft, and dead.
 */
export const FEELS = {
  pannacotta: { hz: 5, zeta: 0.25, mass: 15, spread: 4, e: 0.2, soft: 0.5, deep: 0.8 },
  pudding: { hz: 7, zeta: 0.06, mass: 15, spread: 3, e: 0.75, soft: 0.28, deep: 0.5 },
  konjac: { hz: 14, zeta: 0.05, mass: 12, spread: 2, e: 0.92, soft: 0.22, deep: 0.42 },
  // (a loaf: soft under its crust, and dead)
  boule: { hz: 6, zeta: 0.4, mass: 20, spread: 3, e: 0.1, soft: 0.3, deep: 0.5 },
  // (a sponge: soft, and it soaks up a landing)
  sponge: { hz: 4.5, zeta: 0.6, mass: 8, spread: 5, e: 0.05, soft: 0.35, deep: 0.55 },
} satisfies Record<string, JellyFeel>;

export interface Jel {
  /** its middle, its foot, its top at rest (in the middle), its radius; and how far its top falls away to its rim at rest (a loaf's dome) */
  cx: number; cz: number; base: number; top: number; rad: number; dome: number;
  /** rings out from the middle, spokes round */
  R: number; S: number;
  /** each node's height off its rest (cm) and how fast it's going: the middle, then ring by ring */
  z: Float32Array; w: Float32Array;
  /** each node's neighbours (CSR) */
  nbrStart: Int32Array; nbr: Int32Array;
  feel: JellyFeel;
  /** its own time */
  t: number;
  /** (for the bench's measures) the energy its stops have taken: what a node was going with as it hit one */
  lost?: number;
  /** how far the dumpling's in it, as a bed (cm; 0, not), see `bedOf`, `holdJel`; and how high its middle was over its top as it touched, and how fast it came in */
  held?: number; ride?: number; vin?: number;
  /** its mould (see `Mould`), if it was set in one */
  mould?: Mould;
}
/**
 * The mould a pudding was set in: its side's radius up its height (of its top's radius, from its foot to its
 * top, PROF_N of them: a flan's taper, a bell's flare); its outline round (round; fluted, rounded ribs; a
 * flower, rounded petals pinched between; a square with soft corners), so many lobes, so deep; how much its top's
 * edge is rounded over; and which recipe it was set from (its layers, and what's on top: see the drawing).
 */
export interface Mould { prof: number[]; shape: number; lobes: number; lobe: number; bevel: number; recipe: number }
export const PROF_N = 9;
/** the outlines */
export const SHAPE = { round: 0, flute: 1, flower: 2, square: 3 } as const;
/**
 * The recipes, shared: 0 mango, caramel on top; 1 dark berry jelly, cream, clear pink (a ring mould's); 2 a
 * strawberry slab, clear pink, cream, clear pink, a strawberry on top; 3 vanilla panna cotta under clear raspberry
 * jelly, raspberries in it and on it; 4 blackcurrant mousse, white chocolate over it, sauce and a blackcurrant on
 * top; 5 a clear red jelly; 6 rainbow, thin stripes, piped hearts on top; 7 konjac, clear pink, deeper low down;
 * 8 mango on coconut cream; 9 panna cotta under a berry coulis; 10 konjac on a lychee-white layer.
 */
export const RECIPES_FOR: Record<'pudding' | 'pannacotta' | 'konjac', number[]> = { pudding: [0, 8, 6, 2, 0], pannacotta: [9, 3, 4, 1, 3], konjac: [7, 5, 10, 1, 5] };
/** what's set on top, by recipe: so many berries of a kind (0 raspberry, 1 strawberry, 2 blackcurrant), so big (cm) */
export const GARNISH: Record<number, { n: number; kind: number; r: number }> = { 2: { n: 1, kind: 1, r: 1.5 }, 3: { n: 3, kind: 0, r: 0.95 }, 4: { n: 1, kind: 2, r: 0.75 } };
/** A mould for a recipe of a kind (or the one wanted), from the dice: its taper or flare, its outline, its top. */
export function mouldFor(r: () => number, kind: 'pudding' | 'pannacotta' | 'konjac' = 'pudding', want?: number): { mould: Mould; dome: number } {
  const list = RECIPES_FOR[kind], picked = list[Math.floor(r() * list.length)], recipe = want ?? picked;
  let side = Math.floor(r() * 4), shape: number = r() < 0.5 ? SHAPE.flute : SHAPE.round, lobes = [8, 10, 12][Math.floor(r() * 3)], lobe = 0.05 + r() * 0.04, bevel = 0, dome = r() < 0.3 ? 0.4 + r() * 0.8 : 0;
  // (some recipes have their own mould: a slab's square, rainbow's flower, a red jelly's deep fluted one with a flat crown, a ring's
  // shallow ribs, a panna cotta's dariole, its edge rounded over)
  if (recipe === 2) { shape = SHAPE.square; side = 2; bevel = 0.3; dome = 0; }
  else if (recipe === 6) { shape = SHAPE.flower; lobes = 8; lobe = 0.16; side = 2; bevel = 0.4; dome = 0; }
  else if (recipe === 5) { shape = SHAPE.flute; lobes = 10; lobe = 0.11; side = 1; bevel = 0.8; dome = 0.4; }
  else if (recipe === 1) { shape = SHAPE.flute; lobes = 12; lobe = 0.05; side = 0; bevel = 1; dome = 0.6; }
  else if (recipe === 3 || recipe === 4 || recipe === 9) { shape = SHAPE.round; side = 3; bevel = 0.7 + r() * 0.4; dome = 0; }
  const flare = 0.12 + r() * 0.2;
  const prof = Array.from({ length: PROF_N }, (_, k) => {
    const t = k / (PROF_N - 1);
    // (a flan's straight taper; a bell's curve; a drum, nearly straight; a dariole, straight-sided, a little in at its top)
    return side === 0 ? 1 + flare * (1 - t) : side === 1 ? 1 + flare * 1.4 * (1 - t) ** 2.2 : side === 2 ? 1 + 0.03 * (1 - t) : 1 + 0.06 * (1 - t) ** 0.6;
  });
  return { mould: { prof, shape, lobes, lobe, bevel, recipe }, dome };
}
/** How wide its side is (of its top's radius) so far up it (0, its foot; 1, its top); and how fast that changes up it. */
export function profAt(j: Jel, t: number): number {
  const p = j.mould?.prof;
  if (!p) return 1;
  const x = Math.max(0, Math.min(1, t)) * (PROF_N - 1), k = Math.min(PROF_N - 2, Math.floor(x));
  return p[k] + (p[k + 1] - p[k]) * (x - k);
}
const profSlope = (j: Jel, t: number) => (profAt(j, t + 0.02) - profAt(j, t - 0.02)) / 0.04;
/** Its outline: how far out it comes this way round (of its radius). */
export function shapeAt(j: Jel, a: number): number {
  const m = j.mould;
  if (!m || m.shape === SHAPE.round) return 1;
  if (m.shape === SHAPE.flute) return 1 + m.lobe * Math.cos(m.lobes * a);
  if (m.shape === SHAPE.flower) return 1 - m.lobe * (1 - Math.abs(Math.cos((m.lobes * a) / 2)) ** 0.55);
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), p = 5;
  return 0.92 / (c ** p + s ** p) ** (1 / p);
}
/** how far out its outline comes, at most */
export const shapeMax = (j: Jel) => (!j.mould ? 1 : j.mould.shape === SHAPE.square ? 1.17 : j.mould.shape === SHAPE.flute ? 1 + j.mould.lobe : 1);
const shapeTo = (j: Jel, dx: number, dz: number) => shapeAt(j, Math.atan2(dz, dx));
const STEP = 1 / 600;
/** how far its top can go: down (of its height), and up (cm) */
const DOWN = 0.55, UP = 3;

export function makeJel(cx: number, cz: number, rad: number, base: number, top: number, feel: JellyFeel, dome = 0, R = 7, S = 24, mould?: Mould): Jel {
  // (not round: more spokes, so its rim follows its outline)
  if (mould && mould.shape !== SHAPE.round) S = Math.max(48, mould.lobes * 6);
  const N = 1 + R * S;
  const lists: number[][] = Array.from({ length: N }, () => []);
  const id = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * S + (((j % S) + S) % S));
  for (let j = 0; j < S; j++) { lists[0].push(id(1, j)); }
  for (let i = 1; i <= R; i++) for (let j = 0; j < S; j++) {
    const k = id(i, j), l = lists[k];
    l.push(id(i, j - 1), id(i, j + 1), i === 1 ? 0 : id(i - 1, j));
    if (i < R) l.push(id(i + 1, j));
  }
  const nbrStart = new Int32Array(N + 1), flat: number[] = [];
  for (let k = 0; k < N; k++) { nbrStart[k] = flat.length; flat.push(...lists[k]); }
  nbrStart[N] = flat.length;
  return { cx, cz, base, top, rad, dome, R, S, z: new Float32Array(N), w: new Float32Array(N), nbrStart, nbr: Int32Array.from(flat), feel: { ...feel }, t: -1, mould };
}

/** The nodes about a point and how much each counts (up to four), into idx/wt; how many. */
const idx = new Int32Array(4), wt = new Float32Array(4);
function about(j: Jel, dx: number, dz: number): number {
  const rr = Math.min(Math.hypot(dx, dz) / shapeTo(j, dx, dz), j.rad);
  const fr = (rr / j.rad) * j.R;
  const i0 = Math.min(j.R - 1, Math.floor(fr)), a = fr - i0;
  let th = Math.atan2(dz, dx) / (Math.PI * 2);
  if (th < 0) th += 1;
  const fs = th * j.S, s0 = Math.floor(fs) % j.S, b = fs - Math.floor(fs), s1 = (s0 + 1) % j.S;
  const ring = (i: number, s: number) => 1 + (i - 1) * j.S + s;
  let n = 0;
  if (i0 === 0) { idx[n] = 0; wt[n++] = 1 - a; }
  else { idx[n] = ring(i0, s0); wt[n++] = (1 - a) * (1 - b); idx[n] = ring(i0, s1); wt[n++] = (1 - a) * b; }
  idx[n] = ring(i0 + 1, s0); wt[n++] = a * (1 - b);
  idx[n] = ring(i0 + 1, s1); wt[n++] = a * b;
  return n;
}
/** Its top's height at a point (from its middle), off its middle's rest height: its dome, and where the membrane has it. */
export function surfAt(j: Jel, dx: number, dz: number): number {
  const f = shapeTo(j, dx, dz), q = Math.min(1, (dx * dx + dz * dz) / (j.rad * j.rad * f * f));
  // (its dome; and its edge rounded over, as the mould's corner was)
  const b = j.mould?.bevel ?? 0, e = b ? Math.max(0, (Math.sqrt(q) - 0.72) / 0.28) : 0;
  return heightAt(j, dx, dz) - j.dome * q - b * e * e;
}
/** The membrane's height off rest at a point (from its middle). */
export function heightAt(j: Jel, dx: number, dz: number): number {
  const n = about(j, dx, dz);
  let h = 0;
  for (let k = 0; k < n; k++) h += j.z[idx[k]] * wt[k];
  return h;
}
function speedAt(j: Jel, dx: number, dz: number): number {
  const n = about(j, dx, dz);
  let v = 0;
  for (let k = 0; k < n; k++) v += j.w[idx[k]] * wt[k];
  return v;
}
/** Its top's height at rest at a point (from its middle): where its top is, undented (a loaf's dome falls away). */
export const restAt = (j: Jel, dx: number, dz: number) => j.top - j.dome * Math.min(1, (dx * dx + dz * dz) / (j.rad * j.rad));
/** How much of a landing (cm/s, coming in) it gives back: all its kind does, but of a gentle landing less, so a bouncing dumpling settles, rather than bouncing on and on. */
export const givesBack = (j: Jel, vin: number) => j.feel.e * Math.min(1, Math.sqrt(Math.max(0, vin) / LIVELY));
/** How high (cm) a landing coming in at vin (cm/s) is thrown back up. */
export const bounceOf = (j: Jel, vin: number) => (givesBack(j, vin) * vin) ** 2 / (2 * G_);
/**
 * The dumpling in it as a bed: pushed back up by k x (1 + (x/x0)²) less c v, x how far in, v how fast (up):
 * a damped spring that firms up, damped as stiff as it is where it is (c = 2ζ√(its stiffness there)), so it
 * gives back as much of a hard landing as of a gentle one: e = exp(−ζπ/√(1−ζ²)). k and x0 so a landing
 * from 10 cm goes `soft` of its height in, and one from 50 cm `deep` (½v² = k (x²/2 + x⁴/4x0²), a unit of
 * mass; near enough, undamped).
 */
export function bedOf(j: Jel, vin = LIVELY): { k: number; zeta: number; x0: number } {
  const { soft, deep } = j.feel, L = Math.log(Math.max(0.01, Math.min(0.999, givesBack(j, vin))));
  const zeta = -L / Math.sqrt(Math.PI * Math.PI + L * L), H = j.top - j.base;
  const a = soft * H, b = deep * H, E1 = G_ * 10, E2 = G_ * 50;
  // (u = 1/4x0²: how much it firms; none, if going twice as fast gets it no deeper than a plain spring would)
  const u = Math.max(0, (E1 * b * b - E2 * a * a) / (2 * (E2 * a ** 4 - E1 * b ** 4)));
  const k = E1 / (a * a / 2 + a ** 4 * u);
  return { k, zeta, x0: u > 0 ? 1 / (2 * Math.sqrt(u)) : 1e6 };
}
const G_ = 980;
/** how fast a landing (cm/s; from 20 cm) a jelly gives all it can back of */
const LIVELY = 200;
/** how far past where it's pressed a dent falls away (cm); and how much of the dumpling's speed its top keeps, let go */
const FALL = 2.6, LET_GO = 0.6;
/**
 * Its top, under the dumpling in it: held to the dumpling's foot (depth in, flat across it, about (x, z), rf
 * across), and going as fast (vy); then let go of, the further out, the more, to go as it would. Let go of
 * altogether (depth 0), it keeps some of how fast it was going, and wobbles on.
 */
export function holdJel(j: Jel, x: number, z: number, rf: number, depth: number, vy: number) {
  const { R, S, rad } = j, lo = -DOWN * (j.top - j.base);
  if (depth <= 0) {
    if (j.held) { for (let k = 0; k < j.w.length; k++) j.w[k] *= LET_GO; j.held = 0; }
    return;
  }
  j.held = depth;
  const ox = x - j.cx, oz = z - j.cz;
  for (let i = 0; i <= R; i++) for (let s = 0; s < (i === 0 ? 1 : S); s++) {
    const a = (s / S) * Math.PI * 2, r = (i / R) * rad * shapeAt(j, a);
    const d = Math.hypot(Math.cos(a) * r - ox, Math.sin(a) * r - oz);
    const f = d <= rf ? 1 : d >= rf + FALL ? 0 : 0.5 + 0.5 * Math.cos(((d - rf) / FALL) * Math.PI);
    if (f <= 0) continue;
    const k = i === 0 ? 0 : 1 + (i - 1) * S + s, to = Math.max(lo, -depth);
    j.z[k] += (to - j.z[k]) * f; j.w[k] += (vy - j.w[k]) * f;
  }
}
/** On to time t, in its own fixed steps. */
export function stepJel(j: Jel, t: number) {
  // (first, after a long gap, or a clock started again: from now)
  if (j.t < 0 || t - j.t > 0.25 || t < j.t) j.t = t;
  const K = (2 * Math.PI * j.feel.hz) ** 2, C = 2 * j.feel.zeta * 2 * Math.PI * j.feel.hz, P = (2 * Math.PI * j.feel.spread) ** 2;
  const lo = -DOWN * (j.top - j.base);
  const { z, w, nbrStart, nbr } = j, N = z.length;
  while (j.t + STEP <= t) {
    j.t += STEP;
    for (let k = 0; k < N; k++) {
      let s = 0;
      const a0 = nbrStart[k], a1 = nbrStart[k + 1];
      for (let q = a0; q < a1; q++) s += z[nbr[q]];
      const lap = s / (a1 - a0) - z[k];
      w[k] += (-K * z[k] - C * w[k] + P * lap) * STEP;
    }
    for (let k = 0; k < N; k++) {
      z[k] += w[k] * STEP;
      if (z[k] < lo) { z[k] = lo; if (w[k] < 0) { j.lost = (j.lost ?? 0) + 0.5 * (j.feel.mass / N) * w[k] * w[k]; w[k] = 0; } }
      else if (z[k] > UP) { z[k] = UP; if (w[k] > 0) { j.lost = (j.lost ?? 0) + 0.5 * (j.feel.mass / N) * w[k] * w[k]; w[k] = 0; } }
    }
  }
}
/** Its highest point now (for its bounds). */
export function jelTop(j: Jel): number { let m = 0; for (let k = 0; k < j.z.length; k++) m = Math.max(m, j.z[k]); return j.top + m; }

/**
 * A point with a skin of s against the jelly: over its top, pushed out along the top as it is
 * there (tilted where it's dented); inside it, out the nearest way; round its side and its rim,
 * as a cylinder whose rim is where the top's edge is now. The top's speed comes with it.
 */
export function touchJel(j: Jel, px: number, py: number, pz: number, s: number, o: Hit, gap: number): boolean {
  o.vx = 0; o.vy = 0; o.vz = 0;
  const dx = px - j.cx, dz = pz - j.cz, rh = Math.hypot(dx, dz), sf = shapeTo(j, dx, dz), rr = rh / sf;
  const rx = rh > 1e-6 ? dx / rh : 1, rz = rh > 1e-6 ? dz / rh : 0;
  if (rr <= j.rad) {
    const ht = j.top + surfAt(j, dx, dz);
    if (py >= ht) {
      // (the top as it is here: its slope from either side)
      const e = 0.35;
      const gx = (surfAt(j, dx + e, dz) - surfAt(j, dx - e, dz)) / (2 * e), gz = (surfAt(j, dx, dz + e) - surfAt(j, dx, dz - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      const nx = -gx / l, ny = 1 / l, nz = -gz / l;
      const d = s - (py - ht) * ny;
      if (d < -gap) return false;
      o.nx = nx; o.ny = ny; o.nz = nz; o.d = d; o.vy = speedAt(j, dx, dz);
      return true;
    }
    if (py >= j.base) {
      const dTop = ht - py, dSide = (j.rad * profAt(j, (py - j.base) / (j.top - j.base)) - rr) * sf, dBot = py - j.base;
      if (dTop <= dSide && dTop <= dBot) { o.nx = 0; o.ny = 1; o.nz = 0; o.d = s + dTop; o.vy = speedAt(j, dx, dz); }
      else if (dSide <= dBot) { o.nx = rx; o.ny = 0; o.nz = rz; o.d = s + dSide; }
      else { o.nx = 0; o.ny = -1; o.nz = 0; o.d = s + dBot; }
      return true;
    }
    const d = s - (j.base - py);
    if (d < -gap) return false;
    o.nx = 0; o.ny = -1; o.nz = 0; o.d = d;
    return true;
  }
  const rim = j.top + surfAt(j, dx, dz);
  const dh = py > rim ? py - rim : py < j.base ? py - j.base : 0;
  if (dh === 0) {
    // (its side, as moulded: as wide as its mould is so far up, sloped as it tapers, so a bell's flare is to slide off)
    const H = j.top - j.base, t = (py - j.base) / H, sl = (j.rad * profSlope(j, t)) / H, c = 1 / Math.hypot(1, sl);
    const dist = (rr - j.rad * profAt(j, t)) * sf * c;
    if (dist > s + gap) return false;
    o.nx = rx * c; o.ny = -sl * c; o.nz = rz * c; o.d = s - dist;
    return true;
  }
  const dr = (rr - j.rad * (dh < 0 ? profAt(j, 0) : 1)) * sf;
  const dist = Math.hypot(dr, dh);
  if (dist > s + gap) return false;
  o.nx = (rx * dr) / dist; o.ny = dh / dist; o.nz = (rz * dr) / dist; o.d = s - dist;
  if (dh > 0) o.vy = speedAt(j, dx, dz) * o.ny;
  return true;
}

/**
 * Its mesh as it is now, into out (VSTRIDE floats a vertex: position, normal, material, uv): its
 * top, each node where it is, lit by its slope; its side, up to where its rim is; a coat on its top
 * (mat, if any) just over it.
 */
export function jelMesh(j: Jel, out: Float32Array, mat: number, coat = 0): number {
  const { R, S, rad } = j;
  const P = (i: number, s: number): [number, number, number] => {
    const a = (s / S) * Math.PI * 2, r = (i / R) * rad * shapeAt(j, a);
    const k = i === 0 ? 0 : 1 + (i - 1) * S + (s % S);
    return [j.cx + Math.cos(a) * r, j.top + j.z[k] - j.dome * (i / R) ** 2, j.cz + Math.sin(a) * r];
  };
  const Nrm = (i: number, s: number): [number, number, number] => {
    const a = (s / S) * Math.PI * 2, r = (i / R) * rad * shapeAt(j, a);
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r, e = 0.4;
    const gx = (surfAt(j, dx + e, dz) - surfAt(j, dx - e, dz)) / (2 * e), gz = (surfAt(j, dx, dz + e) - surfAt(j, dx, dz - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  };
  let o = 0;
  const put = (p: number[], n: number[], m: number, u: number, v: number) => {
    out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2]; out[o++] = n[0]; out[o++] = n[1]; out[o++] = n[2]; out[o++] = m; out[o++] = u; out[o++] = v;
  };
  const uv = (p: number[]) => [(p[0] - j.cx) / rad, (p[2] - j.cz) / rad];
  // (which recipe it was set from, carried in its material's fraction, for the drawing's layers)
  mat += (j.mould?.recipe ?? 0) * 0.01;
  const top = (m: number, lift: number) => {
    const L = (p: number[], n: number[]) => [p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift];
    for (let i = 0; i < R; i++) for (let s = 0; s < S; s++) {
      const a = P(i, s), b = P(i + 1, s), c = P(i + 1, s + 1), d = P(i, s + 1);
      const na = Nrm(i, s), nb = Nrm(i + 1, s), nc = Nrm(i + 1, s + 1), nd = Nrm(i, s + 1);
      const tri = (p: number[][], n: number[][]) => { for (let q = 0; q < 3; q++) { const pp = L(p[q], n[q]); const t = uv(pp); put(pp, n[q], m, t[0], t[1]); } };
      tri([a, c, b], [na, nc, nb]);
      tri([a, d, c], [na, nd, nc]);
    }
  };
  top(mat, 0);
  // its side, down from its rim as it is to its foot, as moulded: ring by ring up it, round its ribs (its (u, v):
  // how far round, and 2 + how far up, so the drawing knows where in its layers it is)
  const H = j.top - j.base, K = SIDE_RINGS;
  const ring = (k: number, s: number): number[] => {
    if (k === K) return P(R, s);
    const a = (s / S) * Math.PI * 2, t = k / K, r = rad * profAt(j, t) * shapeAt(j, a);
    return [j.cx + Math.cos(a) * r, j.base + t * H, j.cz + Math.sin(a) * r];
  };
  const G: number[][][] = [];
  for (let k = 0; k <= K; k++) { G.push([]); for (let s = 0; s <= S; s++) G[k].push(ring(k, s % S)); }
  const nrmAt = (k: number, s: number): number[] => {
    const up = G[Math.min(K, k + 1)][s], dn = G[Math.max(0, k - 1)][s], lf = G[k][(s + S - 1) % S], rt = G[k][(s + 1) % S];
    const ux = rt[0] - lf[0], uy = rt[1] - lf[1], uz = rt[2] - lf[2], vx = up[0] - dn[0], vy = up[1] - dn[1], vz = up[2] - dn[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    // (outward)
    const ox = G[k][s][0] - j.cx, oz = G[k][s][2] - j.cz;
    if (nx * ox + nz * oz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return [nx / l, ny / l, nz / l];
  };
  for (let k = 0; k < K; k++) for (let s = 0; s < S; s++) {
    const a = G[k][s], b = G[k + 1][s], c = G[k + 1][s + 1], d = G[k][s + 1];
    const na = nrmAt(k, s), nb = nrmAt(k + 1, s), nc = nrmAt(k + 1, (s + 1) % S), nd = nrmAt(k, (s + 1) % S);
    const ua = [s / S, 2 + k / K], ub = [s / S, 2 + (k + 1) / K], uc = [(s + 1) / S, 2 + (k + 1) / K], ud = [(s + 1) / S, 2 + k / K];
    put(a, na, mat, ua[0], ua[1]); put(b, nb, mat, ub[0], ub[1]); put(c, nc, mat, uc[0], uc[1]);
    put(a, na, mat, ua[0], ua[1]); put(c, nc, mat, uc[0], uc[1]); put(d, nd, mat, ud[0], ud[1]);
  }
  if (coat) top(coat, 0.06);
  // what's set on top, by its recipe: berries, sat a little into its top where it is now (its kind in their
  // material's fraction)
  const g = GARNISH[j.mould?.recipe ?? -1];
  if (g) for (let k = 0; k < g.n; k++) {
    const a = 0.8 + k * 2.1, rr = g.n > 1 ? rad * 0.55 : rad * 0.42;
    const gx = Math.cos(a) * rr, gz = Math.sin(a) * rr, gy = j.top + surfAt(j, gx, gz) + g.r * 0.55;
    const sy = g.kind === 1 ? 1.35 : 1;
    for (let la = 0; la < BLA; la++) for (let lo = 0; lo < BLO; lo++) {
      const pt = (u: number, v: number): [number[], number[]] => {
        const th = (u / BLA) * Math.PI, ph = (v / BLO) * Math.PI * 2, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        // (a strawberry: longer, to a point at its bottom)
        const w = g.kind === 1 ? 1 - 0.35 * Math.max(0, -n[1]) : 1;
        return [[j.cx + gx + n[0] * g.r * w, gy + n[1] * g.r * sy, j.cz + gz + n[2] * g.r * w], n];
      };
      const q = [pt(la, lo), pt(la + 1, lo), pt(la + 1, lo + 1), pt(la, lo + 1)], m = MAT_BERRY + g.kind * 0.01;
      for (const t of [0, 2, 1, 0, 3, 2]) put(q[t][0], q[t][1], m, la / BLA, lo / BLO);
    }
  }
  return o;
}
/** how many floats its mesh takes */
export const jelMeshSize = (j: Jel, coat = 0) => (j.R * j.S * 6 * (coat ? 2 : 1) + j.S * SIDE_RINGS * 6 + (GARNISH[j.mould?.recipe ?? -1]?.n ?? 0) * BLA * BLO * 6) * 9;
/** a berry's material (level.ts's MAT.berry; here so as not to depend on it) */
const MAT_BERRY = 46;
/** a berry's mesh: so many bands from its top down, so many round */
const BLA = 8, BLO = 12;
/** how many rings up its side it's drawn in */
const SIDE_RINGS = 8;
