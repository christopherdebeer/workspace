/**
 * The small animals of the dung: what lives with the fungi, and off them.
 *
 * - **Nematodes** (eelworms): glassy, under a millimetre, their gut a granular streak down them.
 *   They crawl in the wet film over the dung: each body slides along its own sinuous track, the
 *   wave running back down it, now and then reversing. Some climb the hat-throwers' stalks and
 *   stand on the sporangium, waving (nictating), to be thrown with it. Lungworm larvae do this on
 *   Pilobolus: thrown out into the grass, they're eaten with it by the next cow.
 * - **Mites:** two families. *Macrochelids* are flat, chestnut, glossy and quick. They dash and
 *   stop, their first legs held up as feelers, tapping, their palps working. *Oribatids*
 *   (beetle mites) are round and nearly black, with two club-headed sensilla. They're slow.
 * - **Springtails:** soft, granular, segmented, with four-jointed antennae and a black patch of
 *   eyes each side. They sit; then the furca folded under them snaps down and they're gone,
 *   tumbling, to land a few body-lengths off.
 *
 * Each is built of limbs (swept tubes: a polyline of up to twenty-four points, with radii — see
 * LIMB_VS): a body, legs jointed at their segments, palps, setae. Legs step in a gait whose phase
 * is how far the body has gone, so feet stay planted while it moves and still when it stops.
 *
 * Where they are (and when) is from the seed and the terrarium's time, so a scrub lands on the
 * same animals in the same places; how they move is in real time, as they'd look under a lens
 * while the hours went by around them.
 */
import { hash, seeded } from '../kit/rng';
import { along, state, type Stalk, type V3 } from './genome';
import { DAYS, GRID, SPAN, type Moment, type Terrarium } from './terrarium';

interface Worm {
  /** where it lives (on the ground), from when till when */
  at: V3;
  t0: number;
  t1: number;
  len: number;
  r: number;
  seed: number;
  /** a climber: up which stalk, starting when (it goes with the sporangium) */
  on?: { st: Stalk; from: number; capFlat: number };
  /** caught in a trap: which, and when */
  caught?: { trap: Trap; T: number };
}
/** a nematode-trapping fungus's snare: a little net of sticky hyphal loops, and its spores */
interface Trap {
  p: V3;
  t0: number;
  t1: number;
  seed: number;
}
interface Mite {
  kind: 'macro' | 'ori';
  home: V3;
  roam: number;
  t0: number;
  t1: number;
  /** its body's length (mm) */
  size: number;
  colour: V3;
  seed: number;
}
interface Spring {
  kind: 'hypo' | 'iso' | 'ento';
  home: V3;
  roam: number;
  t0: number;
  t1: number;
  size: number;
  colour: V3;
  seed: number;
}
export interface Critters {
  worms: Worm[];
  mites: Mite[];
  springs: Spring[];
  traps: Trap[];
  moments: Moment[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The animals of a terrarium: who, where and when. */
export function critters(seed: number, terr: Terrarium): Critters {
  const r = seeded(hash(seed, 0xc417));
  const worms: Worm[] = [];
  const mites: Mite[] = [];
  const springs: Spring[] = [];
  const traps: Trap[] = [];
  const moments: Moment[] = [];
  const cell = SPAN / GRID;
  const wet = (p: V3) => {
    const gx = Math.floor((p[0] + SPAN / 2) / cell);
    const gz = Math.floor((p[2] + SPAN / 2) / cell);
    return gx >= 0 && gz >= 0 && gx < GRID && gz < GRID && terr.dung[gz * GRID + gx] > 0.4;
  };
  const end = DAYS * 24 + 2;
  terr.species.forEach((sp, j) => {
    const live = sp.stalks;
    // nematodes come in with the dung; they gather where the throwers are, and climb them
    if (sp.g.throws) {
      live.forEach((st, q) => {
        if (q % 3 === 0) {
          for (let k = 0; k < 2; k++) {
            const a = r() * Math.PI * 2;
            const d = lerp(0.5, 4, r());
            const at: V3 = [st.base[0] + Math.cos(a) * d, 0, st.base[2] + Math.sin(a) * d];
            if (!wet(at)) continue;
            const len = lerp(0.5, 1.1, r());
            worms.push({ at, t0: st.t0 - lerp(0, 12, r()), t1: st.tEnd + lerp(0, 24, r()), len, r: len / lerp(28, 38, r()), seed: r() * 100 });
          }
        }
        if (q % 7 === 3) {
          // a climber: up the stalk as it ripens, onto the sporangium, and off with it
          const from = lerp(st.t1, st.tv || st.t1 + 2, r());
          const len = lerp(0.35, 0.5, r());
          worms.push({ at: st.base, t0: from - 2, t1: st.tl, len, r: len / lerp(22, 28, r()), seed: r() * 100, on: { st, from, capFlat: sp.g.capFlat } });
          if (q % 21 === 3) moments.push({ T: st.tl - 0.8, at: [st.base[0], st.len * 0.95, st.base[2]], size: st.len * 0.32, kind: 'ride', who: j });
        }
      });
    }
    // mites and springtails come to graze where something is fruiting (and stay a while after)
    const clumps: Stalk[] = [];
    for (const st of live) if (!clumps.some((o) => Math.hypot(o.base[0] - st.base[0], o.base[2] - st.base[2]) < 6 && Math.abs(o.t1 - st.t1) < 30)) clumps.push(st);
    const cupClumps = sp.cups.filter((c, q) => q % 3 === 0);
    for (const st of clumps) {
      const n = 1 + Math.floor(r() * 2.4);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2;
        const d = lerp(0.5, 3, r());
        const home: V3 = [st.base[0] + Math.cos(a) * d, 0, st.base[2] + Math.sin(a) * d];
        const t0 = st.t1 + lerp(-4, 10, r());
        const t1 = Math.min(end, st.tEnd + lerp(4, 30, r()));
        if (r() < 0.6) {
          const macro = r() < 0.65;
          mites.push(
            macro
              ? { kind: 'macro', home, roam: lerp(1, 2.2, r()), t0, t1, size: lerp(0.55, 0.9, r()), colour: [lerp(0.38, 0.5, r()), lerp(0.15, 0.22, r()), lerp(0.05, 0.09, r())], seed: r() * 100 }
              : { kind: 'ori', home, roam: lerp(0.5, 1, r()), t0, t1, size: lerp(0.4, 0.6, r()), colour: [lerp(0.1, 0.18, r()), lerp(0.05, 0.09, r()), lerp(0.02, 0.04, r())], seed: r() * 100 },
          );
        } else {
          const roll = r();
          const kind: Spring['kind'] = roll < 0.45 ? 'hypo' : roll < 0.75 ? 'iso' : 'ento';
          const colour: V3 = kind === 'hypo' ? [0.1, 0.11, 0.17] : kind === 'iso' ? [0.62, 0.62, 0.6] : [0.66, 0.52, 0.26];
          springs.push({ kind, home, roam: lerp(2, 4, r()), t0, t1, size: kind === 'hypo' ? lerp(0.9, 1.3, r()) : lerp(1, 1.6, r()), colour, seed: r() * 100 });
        }
      }
    }
    for (const c of cupClumps) {
      const a = r() * Math.PI * 2;
      const home: V3 = [c.c[0] + Math.cos(a) * c.R * 2, 0, c.c[2] + Math.sin(a) * c.R * 2];
      mites.push({ kind: 'macro', home, roam: 1.5, t0: c.t0 + 8, t1: Math.min(end, c.tEnd + 12), size: lerp(0.5, 0.75, r()), colour: [0.42, 0.18, 0.07], seed: r() * 100 });
    }
  });
  // (now and then the camera goes down to them)
  [...mites, ...springs].forEach((m, q) => {
    if (q % 4 === 0 && m.t1 - m.t0 > 8) moments.push({ T: m.t0 + 4, at: [m.home[0], 0.3, m.home[2]], size: m.size * 1.3, kind: 'graze', who: -1, follow: q });
  });
  // where there are nematodes enough, a trapping fungus comes, and sets its snares in the wet;
  // now and then one is caught: it struggles, is still, is filled with the fungus, and is gone
  const crawlers = worms.filter((w) => !w.on);
  for (let k = 0; k < crawlers.length; k += 6) {
    const w = crawlers[k];
    const tc = Math.max(w.t0 + 4, 6 * 24) + r() * 48;
    if (tc > w.t1 - 2 || tc > end - 30) continue;
    const trap: Trap = { p: [w.at[0] + (r() - 0.5) * 0.6, 0, w.at[2] + (r() - 0.5) * 0.6], t0: tc - lerp(6, 20, r()), t1: tc + 48, seed: r() * 100 };
    traps.push(trap);
    w.caught = { trap, T: tc };
    w.t1 = Math.max(w.t1, tc + 30);
    if (traps.length % 2 === 1) moments.push({ T: tc + 0.6, at: [trap.p[0], 0.15, trap.p[2]], size: w.len * 0.9, kind: 'trap', who: -1 });
  }
  return { worms, mites, springs, traps, moments };
}

// ─── drawing: limbs ──────────────────────────────────────────────────────────────────────────────

/** a limb's row: up to 24 points (x, y, z, radius), then colour + material, then count, flatness,
 *  seed, smooth; then its length and two more (a springtail's pale bands, its eyes); then spare */
export const MAXP = 24;
export const ROWW = MAXP + 4;
/** The frame's limbs, by mesh (fine, middling, coarse) and pass (opaque, or glass), and the
 *  ground's contact shadows under them (x, z, radius, depth). */
export interface Limbs {
  hi: number[];
  mid: number[];
  lo: number[];
  /** grass: near, far */
  bladeHi: number[];
  bladeLo: number[];
  glassHi: number[];
  glassMid: number[];
  shade: number[];
}
export const limbs = (): Limbs => ({ hi: [], mid: [], lo: [], bladeHi: [], bladeLo: [], glassHi: [], glassMid: [], shade: [] });

export const MAT = { chitin: 0, leg: 1, seta: 2, soft: 3, worm: 4 } as const;
export const MAT_PLANT = 5;
export const MAT_GRASS = 6;
/** a blade: a ribbon, its width across `across`; torn (grazed) or browning at its tip */
export function blade(list: number[], pts: V3[], rad: number[], col: V3, seed: number, across: V3, torn: number, brown: number) {
  tube(list, pts, rad, col, MAT_GRASS, { flat: 0.1, seed, bands: torn, eyes: brown, across });
}
/** a flat limb: a ribbon (a blade of grass) */
export function ribbon(list: number[], pts: V3[], rad: number[], col: V3, mat: number, seed: number) {
  tube(list, pts, rad, col, mat, { flat: 0.18, seed });
}
interface TubeOpts {
  flat?: number;
  seed?: number;
  smooth?: boolean;
  bands?: number;
  eyes?: number;
  groove?: number;
  /** which way its width goes (a blade's) */
  across?: V3;
}
function tube(list: number[], pts: V3[], rad: number[], col: V3, mat: number, o: TubeOpts = {}) {
  const n = Math.min(MAXP, pts.length);
  let L = 0;
  for (let i = 1; i < n; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  for (let i = 0; i < MAXP; i++) {
    if (i < n) list.push(pts[i][0], pts[i][1], pts[i][2], rad[i]);
    else list.push(0, 0, 0, 0);
  }
  list.push(col[0], col[1], col[2], mat, n, o.flat ?? 1, o.seed ?? 0, o.smooth === false ? 0 : 1, L, o.bands ?? 0, o.eyes ?? 0, o.groove ?? 0, ...(o.across ?? [0, 0, 0]), 0);
}

// (small vector sums, inline)
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

type Ground = (x: number, z: number) => number;
/** a body's frame: where, and its forward, its side and its up */
interface Frame {
  o: V3;
  f: V3;
  s: V3;
  u: V3;
}
const at = (F: Frame, x: number, y: number, z: number): V3 => [F.o[0] + F.f[0] * x + F.s[0] * y + F.u[0] * z, F.o[1] + F.f[1] * x + F.s[1] * y + F.u[1] * z, F.o[2] + F.f[2] * x + F.s[2] * y + F.u[2] * z];
/** a frame standing on the ground at (x, z), facing `heading`, its up the ground's (tipped `pitch` about its side) */
function frameOn(groundY: Ground, x: number, z: number, heading: number, lift: number, pitch = 0): Frame {
  const e = 0.15;
  const gx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e);
  const gz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
  const up = nrm([-gx, 1, -gz]);
  const f0: V3 = [Math.cos(heading), 0, Math.sin(heading)];
  let f = nrm(add(f0, up, -dot(f0, up)));
  let u = up;
  const s = nrm(crs(u, f));
  if (pitch) {
    const c = Math.cos(pitch);
    const sn = Math.sin(pitch);
    [f, u] = [nrm(add(scl(f, c), u, sn)), nrm(add(scl(u, c), f, -sn))];
  }
  return { o: add([x, groundY(x, z), z], up, lift), f, s, u };
}
/** a wandering loop round `home`, of about radius R: where on it at ξ (mm along), and its heading */
function track(home: V3, R: number, sd: number, xi: number): { x: number; z: number; h: number } {
  const pos = (x: number) => {
    const th = x / R + sd;
    const rho = R * (1 + 0.35 * Math.sin(2 * th + sd * 3) + 0.2 * Math.sin(3 * th + sd * 5));
    return [home[0] + rho * Math.cos(th), home[2] + rho * Math.sin(th)];
  };
  const p = pos(xi);
  const q = pos(xi + 0.02);
  return { x: p[0], z: p[1], h: Math.atan2(q[1] - p[1], q[0] - p[0]) };
}
/** ∫ max(0, sin) from 0 to x: how far something has gone that goes, and stops, and goes */
function goes(x: number) {
  const P = Math.PI * 2;
  const k = Math.floor(x / P);
  const m = x - k * P;
  return 2 * k + (m < Math.PI ? 1 - Math.cos(m) : 2);
}
/** (a seeded number from a few others, 0..1) */
const hr = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * A leg, from its hip to its foot (on the ground, or held up), arched over at its knee: seven
 * points — coxa, trochanter, femur, genu, tibia, tarsus, claw — jointed, thinning.
 */
function leg(list: number[], H: V3, foot: V3, up: V3, len: number, r0: number, col: V3, arch: number, mat: number = MAT.leg) {
  const ts = [0, 0.1, 0.2, 0.38, 0.56, 0.8, 1];
  const pts = ts.map((t) => add(mix(H, foot, t), up, arch * len * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9)));
  const rad = [1, 0.92, 0.82, 0.72, 0.62, 0.48, 0.22].map((k) => r0 * k);
  tube(list, pts, rad, col, mat, mat === MAT.leg ? { smooth: false } : { smooth: false, bands: 0.3 });
  return pts;
}
/** a seta: a fine hair from `base`, out along `dir`, curving with `bend` */
function seta(list: number[], base: V3, dir: V3, bend: V3, len: number, r: number, col: V3) {
  const a = add(base, dir, len * 0.5);
  const b = add(add(base, dir, len), bend, len * 0.25);
  tube(list, [base, add(a, bend, len * 0.06), b], [r, r * 0.7, r * 0.25], col, MAT.seta);
}

/** How finely to draw something this big this far away: 0 fine, 1 middling, 2 coarse, 3 not. */
function detail(eye: V3, p: V3, size: number) {
  const d = Math.hypot(eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]) / size;
  return d < 25 ? 0 : d < 70 ? 1 : d < 200 ? 2 : 3;
}

/** One animal on its own, at the middle, for a close look (`?one&critter=macro`, `ori`, `hypo`,
 *  `iso`, `ento`, `worm`). */
export function zoo(kind: string, seed: number): Critters {
  const r = seeded(hash(seed, 0x200));
  const c: Critters = { worms: [], mites: [], springs: [], traps: [], moments: [] };
  const home: V3 = [0, 0, 0];
  if (kind === 'worm') c.worms.push({ at: home, t0: -1e9, t1: 1e9, len: 1, r: 1 / 32, seed: r() * 100 });
  else if (kind === 'trap') {
    // (caught at hour 9: struggling at 10, still by 12, filled by 20)
    const trap: Trap = { p: home, t0: -1e9, t1: 1e9, seed: r() * 100 };
    c.traps.push(trap);
    c.worms.push({ at: home, t0: -1e9, t1: 1e9, len: 0.9, r: 0.9 / 30, seed: r() * 100, caught: { trap, T: Number(globalThis.location?.search.match(/caught=([\d.]+)/)?.[1] ?? 9) } });
  }
  else if (kind === 'macro' || kind === 'ori') c.mites.push({ kind, home, roam: 0.8, t0: -1e9, t1: 1e9, size: kind === 'macro' ? 0.8 : 0.5, colour: kind === 'macro' ? [0.42, 0.17, 0.06] : [0.13, 0.07, 0.03], seed: r() * 100 });
  else {
    const k = (['hypo', 'iso', 'ento'].includes(kind) ? kind : 'hypo') as Spring['kind'];
    const colour: V3 = k === 'hypo' ? [0.1, 0.11, 0.17] : k === 'iso' ? [0.62, 0.62, 0.6] : [0.66, 0.52, 0.26];
    c.springs.push({ kind: k, home, roam: 0.8, t0: -1e9, t1: 1e9, size: 1.2, colour, seed: r() * 100 });
  }
  return c;
}

/** Where one of the mites (then springtails) is now: for the lens to follow. */
export function whereIs(c: Critters, q: number, T: number, time: number, groundY: Ground): V3 | null {
  if (q < c.mites.length) {
    const m = c.mites[q];
    const macro = m.kind === 'macro';
    const v = macro ? 0.55 : 0.07;
    const w = macro ? 0.55 : 0.25;
    const tr = track(m.home, m.roam, m.seed, (v * goes(time * w + m.seed)) / w + T * 0.2);
    return [tr.x, groundY(tr.x, tr.z) + m.size * 0.25, tr.z];
  }
  const sp = c.springs[q - c.mites.length];
  if (!sp) {
    const w = c.worms[q - c.mites.length - c.springs.length];
    if (!w) return null;
    if (w.caught && T > w.caught.T) return [w.caught.trap.p[0], groundY(w.caught.trap.p[0], w.caught.trap.p[2]), w.caught.trap.p[2]];
    const xi = 0.1 * time + ((0.1 * 1.6) / 0.21) * Math.sin(0.21 * time + w.seed) - w.len * 0.5;
    const t = track(w.at, 0.35 + (w.seed % 0.6), w.seed, xi);
    return [t.x, groundY(t.x, t.z), t.z];
  }
  const period = 4 + (sp.seed % 3);
  const n = Math.floor((time + sp.seed) / period);
  const a = hr(sp.seed, n) * Math.PI * 2;
  const d = Math.sqrt(hr(sp.seed + 3, n)) * sp.roam;
  const x = sp.home[0] + Math.cos(a) * d;
  const z = sp.home[2] + Math.sin(a) * d;
  return [x, groundY(x, z) + sp.size * 0.2, z];
}

/** The frame's animals, as limbs (and their shadows). */
export function drawCritters(c: Critters, T: number, time: number, groundY: Ground, eye: V3, out: Limbs) {
  for (const w of c.worms) {
    if (T < w.t0 || T > w.t1) continue;
    const come = ease((T - w.t0) / 1.5) * ease((w.t1 - T) / 1.5);
    if (come <= 0.01) continue;
    if (w.on) climber(w, T, time, eye, out);
    else if (w.caught && T > w.caught.T) caught(w, T, time, groundY, eye, out);
    else crawler(w, come, time, groundY, eye, out);
  }
  for (const t of c.traps) if (T > t.t0 && T < t.t1) trap(t, T, time, groundY, eye, out);
  for (const m of c.mites) {
    if (T < m.t0 || T > m.t1) continue;
    const come = ease((T - m.t0) / 2) * ease((m.t1 - T) / 2);
    if (come < 0.05) continue;
    mite(m, come, T, time, groundY, eye, out);
  }
  for (const s of c.springs) {
    if (T < s.t0 || T > s.t1) continue;
    const come = ease((s.t1 - T) / 2) * ease((T - s.t0) / 2);
    if (come < 0.05) continue;
    springtail(s, come, time, groundY, eye, out);
  }
}

// (a nematode: clear, the faintest straw; its gut showing through)
const WORM: V3 = [0.9, 0.88, 0.8];
/** a nematode's radius down its length (0 head .. 1 tail): a blunt head, a long fine tail */
const wormR = (x: number) => (0.55 + 0.45 * ease(x / 0.1)) * (1 - 0.92 * ease((x - 0.72) / 0.28));

function crawler(w: Worm, come: number, time: number, groundY: Ground, eye: V3, out: Limbs) {
  const L = w.len * (0.6 + 0.4 * come);
  const lod = detail(eye, w.at, L);
  if (lod > 2) return;
  // its track: a wandering loop through the wet; along it, a sine its body lies in and slides
  // along — the wave running back down it — at times backing up
  const v = 0.1;
  const xi = v * time + ((v * 1.6) / 0.21) * Math.sin(0.21 * time + w.seed);
  const R = 0.35 + (w.seed % 0.6);
  const A = 0.1 * L;
  const lam = 0.55 * L;
  const pts: V3[] = [];
  const rad: number[] = [];
  const N = lod === 0 ? 16 : 10;
  for (let k = 0; k < N; k++) {
    const x = k / (N - 1);
    const s = xi - x * L;
    const t = track(w.at, R, w.seed, s);
    const side = A * Math.sin((2 * Math.PI * s) / lam);
    // (its head, searching: lifted and swinging as it goes)
    const head = Math.max(0, 1 - x / 0.16);
    const swing = head * head * 0.07 * L * Math.sin(time * 2.6 + w.seed);
    const px = t.x - Math.sin(t.h) * (side + swing);
    const pz = t.z + Math.cos(t.h) * (side + swing);
    const lift = head * head * L * 0.08 * Math.max(0, Math.sin(time * 0.9 + w.seed * 2));
    const rr = w.r * wormR(x);
    pts.push([px, groundY(px, pz) + rr * 0.75 + lift, pz]);
    rad.push(rr);
  }
  tube(lod === 0 ? out.glassHi : out.glassMid, pts, rad, WORM, MAT.worm, { flat: 0.85, seed: w.seed });
}

/** A nematode in a snare: held near its head; thrashing, then weaker, then still; then the
 *  fungus grows through it — it goes milky, then white and slack — and it's gone. */
function caught(w: Worm, T: number, time: number, groundY: Ground, eye: V3, out: Limbs) {
  const c = w.caught!;
  const since = T - c.T;
  if (since > 30) return;
  const lod = detail(eye, c.trap.p, w.len);
  if (lod > 2) return;
  const fight = 1 - ease(since / 2.5);
  const filled = ease((since - 4) / 14);
  const slack = ease((since - 20) / 9);
  const L = w.len;
  const A = 0.1 * L * (0.4 + 0.6 * fight);
  const head = w.seed * 2;
  const hx = Math.cos(head);
  const hz = Math.sin(head);
  const N = lod === 0 ? 16 : 10;
  const pts: V3[] = [];
  const rad: number[] = [];
  for (let k = 0; k < N; k++) {
    const x = k / (N - 1);
    // (held at a quarter of its length: the rest lashing about it)
    const s = (x - 0.22) * L;
    const lash = Math.sin(x * 9 - time * (2 + 7 * fight) + w.seed) * A * (0.3 + 0.7 * Math.min(1, Math.abs(s) / (0.3 * L)));
    const curl = Math.sin(time * 0.8 * fight + w.seed) * fight * 0.6 * x;
    const ang = head + curl + (1 - fight) * Math.sin(x * 4 + w.seed) * 0.5;
    const px = c.trap.p[0] - Math.cos(ang) * s - hz * lash;
    const pz = c.trap.p[2] - Math.sin(ang) * s + hx * lash;
    const rr = w.r * wormR(x) * (1 - 0.35 * slack);
    pts.push([px, groundY(px, pz) + rr * 0.7 + (Math.abs(s) < 0.06 ? 0.03 : 0), pz]);
    rad.push(rr);
  }
  const col = mix(WORM, [1, 1, 0.98], filled);
  tube(lod === 0 ? out.glassHi : out.glassMid, pts, rad, col, MAT.worm, { flat: 0.85 - 0.3 * slack, seed: w.seed, groove: filled });
}

/** The snare: loops of sticky hypha joined in a little three-dimensional net, hyphae out over the
 *  ground from it, and two or three upright conidiophores, each with a head of pear-shaped,
 *  two-celled spores. */
function trap(t: Trap, T: number, time: number, groundY: Ground, eye: V3, out: Limbs) {
  const lod = detail(eye, t.p, 0.4);
  if (lod > 1) return;
  const grow = ease((T - t.t0) / 4) * (1 - ease((T - (t.t1 - 6)) / 6));
  if (grow <= 0.02) return;
  const y0 = groundY(t.p[0], t.p[2]);
  const col: V3 = [0.86, 0.88, 0.84];
  const hr0 = 0.006;
  // hyphae out over the ground: fine, wandering, branching
  for (let k = 0; k < 9; k++) {
    const a = hr(t.seed, k) * Math.PI * 2;
    const L = (0.3 + 0.6 * hr(t.seed + 1, k)) * grow;
    const pts: V3[] = [];
    for (let j = 0; j < 8; j++) {
      const d = (L * j) / 7;
      const aa = a + Math.sin(j * 1.7 + k * 3.1) * 0.45;
      const x = t.p[0] + Math.cos(aa) * d;
      const z = t.p[2] + Math.sin(aa) * d;
      pts.push([x, groundY(x, z) + hr0 * 0.6, z]);
    }
    tube(out.lo, pts, pts.map((_, j) => hr0 * (0.7 - j * 0.05)), [0.7, 0.72, 0.68], MAT.seta);
  }
  // the net: loops, each off the last, standing every way
  const loops = Math.round(3 + 3 * grow);
  let c: V3 = [t.p[0], y0 + 0.04, t.p[2]];
  for (let k = 0; k < loops; k++) {
    const R = 0.05 + 0.02 * hr(t.seed + 2, k);
    const n = nrm([hr(t.seed + 3, k) - 0.5, 0.4 + hr(t.seed + 4, k), hr(t.seed + 5, k) - 0.5]);
    const n2 = nrm(crs(n, [0, 1, 0.01]));
    const ax = crs(n, n2);
    const pts: V3[] = [];
    for (let j = 0; j <= 10; j++) {
      const a = (j / 10) * Math.PI * 2;
      pts.push(add(add(c, n2, Math.cos(a) * R), ax, Math.sin(a) * R + R));
    }
    tube(lod === 0 ? out.mid : out.lo, pts, pts.map(() => hr0 * 1.1), col, MAT.seta);
    c = add(add(c, n2, R * (hr(t.seed, k + 9) - 0.5) * 2.4), ax, R * 1.2);
  }
  if (lod > 0) return;
  // conidiophores: upright, a head of spores
  for (let k = 0; k < 3; k++) {
    const a = hr(t.seed + 6, k) * Math.PI * 2;
    const b: V3 = [t.p[0] + Math.cos(a) * 0.2, 0, t.p[2] + Math.sin(a) * 0.2];
    b[1] = groundY(b[0], b[2]);
    const H = (0.3 + 0.2 * hr(t.seed + 7, k)) * grow;
    const sway = Math.sin(time * 0.7 + k) * 0.01;
    const top: V3 = [b[0] + sway, b[1] + H, b[2]];
    tube(out.lo, [b, [b[0], b[1] + H * 0.5, b[2]], top], [hr0 * 1.2, hr0, hr0 * 0.9], col, MAT.seta);
    if (grow < 0.6) continue;
    for (let j = 0; j < 8; j++) {
      const aa = (j / 8) * Math.PI * 2 + k;
      const d: V3 = nrm([Math.cos(aa), 0.5 + 0.3 * Math.sin(j * 2.1), Math.sin(aa)]);
      const p0 = add(top, d, 0.006);
      tube(out.mid, [p0, add(p0, d, 0.014), add(p0, d, 0.028)], [0.006, 0.01, 0.007], [0.9, 0.9, 0.86], MAT.seta);
    }
  }
}

function climber(w: Worm, T: number, time: number, eye: V3, out: Limbs) {
  const on = w.on!;
  const st = on.st;
  const s = state(st, T);
  if (s.thrown >= 0 || s.grown < 0.3) return;
  const lod = detail(eye, st.base, w.len);
  if (lod > 2) return;
  const Ls = st.len * s.grown;
  // up the stalk over the first part of its wait; then onto the sporangium, standing, waving
  const reach = on.from + (st.tl - on.from) * 0.55;
  const climb = ease((T - on.from) / Math.max(0.5, reach - on.from));
  const pts: V3[] = [];
  const rad: number[] = [];
  const N = 14;
  if (climb < 0.999 || st.cap <= 0) {
    const a0 = w.seed * 2.4;
    for (let k = 0; k < N; k++) {
      const x = k / (N - 1);
      const u = Math.min(0.97, Math.max(0.01, climb * 0.95 - (x * w.len * 0.85) / Ls));
      const p = along(st, s, u);
      // (round the stalk as it goes, the wave running back down it)
      const a = a0 + 0.45 * Math.sin(x * 9 - time * 3.2);
      const ring = round(p.t, a);
      const rr = w.r * wormR(x);
      pts.push(add(p.p, ring, p.r + rr * 0.8));
      rad.push(rr);
    }
  } else {
    // nictating: its tail held to the sporangium, the rest standing off it, circling, searching
    const top = along(st, s, 1);
    const cr = st.cap * (0.35 + 0.65 * s.ripe);
    const cap = add(top.p, top.t, cr * on.capFlat * 0.7);
    const a = w.seed * 3.1;
    const ring = round(top.t, a);
    const anchor = add(add(cap, ring, cr * 0.85), top.t, cr * on.capFlat * 0.4);
    const out0 = nrm(add(ring, top.t, 0.8));
    const sweep = time * (1.4 + (w.seed % 0.5));
    const side = nrm(crs(out0, top.t));
    let p = anchor;
    const seg = w.len / (N - 1);
    const tail: V3[] = [];
    for (let k = 0; k < N; k++) {
      const x = k / (N - 1);
      // (from the tail up: bending more toward the head, the head tracing a circle)
      const bend = x * x * 1.3;
      const d = nrm(add(add(out0, side, Math.cos(sweep) * bend), top.t, Math.sin(sweep) * bend * 0.8 + x * 0.3));
      if (k > 0) p = add(p, d, seg);
      tail.push(p);
    }
    tail.reverse();
    for (let k = 0; k < N; k++) {
      pts.push(tail[k]);
      rad.push(w.r * wormR(k / (N - 1)));
    }
  }
  tube(lod === 0 ? out.glassHi : out.glassMid, pts, rad, WORM, MAT.worm, { seed: w.seed });
}
/** (a direction round a tangent) */
function round(t: V3, a: number): V3 {
  const ref: V3 = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = nrm(crs(t, ref));
  const y = crs(t, x);
  return add(scl(x, Math.cos(a)), y, Math.sin(a));
}

function mite(m: Mite, come: number, T: number, time: number, groundY: Ground, eye: V3, out: Limbs) {
  const macro = m.kind === 'macro';
  const L = m.size * (0.5 + 0.5 * come);
  const W = L * (macro ? 0.64 : 0.82);
  const H = L * (macro ? 0.3 : 0.62);
  const lod = detail(eye, m.home, L);
  if (lod > 2) return;
  const sd = m.seed;
  // a dash, a stop, a dash: how far it's gone (feet keep to that, so they stay where they're put)
  const v = macro ? 0.55 : 0.07;
  const w = macro ? 0.55 : 0.25;
  const xi = (v * goes(time * w + sd)) / w + T * 0.2;
  const tr = track(m.home, m.roam, sd, xi);
  const clear = L * (macro ? 0.13 : 0.18);
  const stride = L * (macro ? 0.36 : 0.22);
  const ph = xi / stride;
  const F = frameOn(groundY, tr.x, tr.z, tr.h, clear + H / 2 + Math.sin(ph * Math.PI * 4) * L * 0.006);
  const list = lod === 0 ? out.hi : lod === 1 ? out.mid : out.lo;
  // its body: an egg, flattened (a macrochelid's) or domed (a beetle mite's), front narrower
  const pts: V3[] = [];
  const rad: number[] = [];
  const N = 11;
  for (let k = 0; k < N; k++) {
    const x = 1 - (2 * k) / (N - 1);
    const egg = macro ? 1 - 0.16 * x : x > 0.35 ? 0.62 + 0.38 * (1 - (x - 0.35) / 0.65) : 1;
    const rr = (W / 2) * Math.pow(Math.max(0, 1 - x * x), 0.55) * egg;
    pts.push(at(F, (x * L) / 2, 0, macro ? 0 : -H * 0.08 * x));
    rad.push(Math.max(rr, L * 0.02));
  }
  tube(list, pts, rad, m.colour, MAT.chitin, { flat: H / W, seed: sd, groove: macro ? 1 : 0.4 });
  out.shade.push(F.o[0], F.o[2], W * 0.75, macro ? 0.5 : 0.6);
  const legCol = mix(m.colour, [0.8, 0.5, 0.26], macro ? 0.28 : 0.25);
  const legList = lod === 2 ? out.lo : lod === 1 ? out.mid : out.hi;
  // the legs: four pairs, hips under its front half; I held up as feelers (a macrochelid's),
  // II–IV walking in two alternating sets
  const lens = macro ? [0.98, 0.68, 0.66, 0.84] : [0.6, 0.52, 0.52, 0.6];
  const hipX = macro ? [0.36, 0.18, 0.02, -0.14] : [0.3, 0.16, 0.0, -0.14];
  const spread = [0.95, 0.5, -0.35, -0.85];
  const r0 = L * (macro ? 0.056 : 0.036);
  const duty = 0.62;
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const len = lens[i] * L;
      const H0 = at(F, hipX[i] * L, side * W * 0.3, -H * 0.38);
      let foot: V3;
      if (i === 0 && macro) {
        // feelers: out in front, up, tapping
        const tap = Math.pow(Math.max(0, Math.sin(time * 6.5 + side * 1.7 + sd)), 6);
        foot = at(F, L * 0.5 + len * 0.62, side * len * 0.38, len * (0.22 - 0.32 * tap) + Math.sin(time * 2.1 + side) * len * 0.06);
      } else {
        const set = (i + (side > 0 ? 1 : 0)) % 2;
        const p = (((ph + set * 0.5 + i * 0.07) % 1) + 1) % 1;
        let off: number;
        let lift = 0;
        if (p < duty) off = (0.5 - p / duty) * stride;
        else {
          const q = (p - duty) / (1 - duty);
          off = (-0.5 + q) * stride;
          lift = Math.sin(Math.PI * q) * len * 0.14;
        }
        const ang = spread[i];
        const fx = hipX[i] * L + Math.sin(ang) * len * 0.72 + off;
        const fy = side * (W * 0.3 + Math.cos(ang) * len * 0.72);
        const g = at(F, fx, fy, 0);
        foot = [g[0], groundY(g[0], g[2]) + r0 * 0.25 + lift, g[2]];
      }
      const lp = leg(legList, H0, foot, F.u, len, r0 * (i === 0 ? 0.85 : 1), legCol, i === 0 && macro ? 0.18 : 0.24);
      // (its setae: several to a segment, sticking out every way, long and fine on the feelers)
      if (lod === 0) {
        for (let k = 1; k < 6; k++) {
          for (let h = 0; h < (i === 0 && macro ? 3 : 2); h++) {
            const ax = nrm(add(lp[k + 1], lp[k], -1));
            const t = 0.25 + 0.5 * hr(sd + i * 7 + side, k * 3 + h);
            const a = hr(sd + k, i * 5 + h + side) * Math.PI * 2;
            const ring = round(ax, a);
            const dir = nrm(add(add(ring, ax, 0.9), F.u, 0.3));
            const sl = (i === 0 && macro ? L * 0.16 : L * 0.07) * (0.6 + 0.6 * hr(k, h + i));
            seta(out.lo, add(mix(lp[k], lp[k + 1], t), ring, r0 * 0.5), dir, scl(ax, 1), sl, r0 * 0.09, legCol);
          }
        }
      }
    }
  }
  if (lod > 0) return;
  // its mouthparts: the gnathosoma, palps working either side, chelicerae between them
  const g0 = at(F, L * 0.47, 0, -H * 0.12);
  const g1 = at(F, L * 0.58, 0, -H * 0.24);
  tube(out.hi, [g0, g1], [L * 0.07, L * 0.045], mix(m.colour, legCol, 0.4), MAT.chitin, { flat: 0.7, seed: sd + 1 });
  if (macro) {
    for (const side of [-1, 1]) {
      const work = Math.sin(time * 8 + side * 1.6 + sd) * 0.5 + 0.5;
      const pb = at(F, L * 0.52, side * L * 0.07, -H * 0.2);
      const tip = at(F, L * 0.74, side * L * 0.1, -H * 0.55 - work * L * 0.06 + H * 0.2);
      leg(out.hi, pb, tip, F.u, L * 0.3, L * 0.022, legCol, 0.2);
      const c0 = at(F, L * 0.56, side * L * 0.015, -H * 0.2);
      const c1 = at(F, L * 0.7, side * L * (0.025 + 0.012 * work), -H * 0.3);
      tube(out.hi, [c0, c1], [L * 0.016, L * 0.008], legCol, MAT.leg);
    }
  } else {
    // a beetle mite's two sensilla: fine stalks up off its front, each with a club on top
    for (const side of [-1, 1]) {
      const b = at(F, L * 0.24, side * W * 0.13, H * 0.36);
      const sway = Math.sin(time * 1.3 + side + sd) * 0.04;
      const p1 = at(F, L * (0.2 + sway), side * W * 0.22, H * 0.62);
      const p2 = at(F, L * (0.13 + sway), side * W * 0.3, H * 0.82);
      const p3 = at(F, L * (0.06 + sway), side * W * 0.34, H * 0.92);
      tube(out.hi, [b, p1, p2, p3], [L * 0.008, L * 0.007, L * 0.028, L * 0.006], legCol, MAT.leg);
    }
  }
  // its setae: in pairs over its back, longer round the margin and behind, pale, swept back
  const setaCol = mix(legCol, [0.85, 0.75, 0.5], 0.4);
  const pairs = macro ? 14 : 7;
  for (let k = 0; k < pairs; k++) {
    const fx = 0.8 - (1.6 * k) / (pairs - 1);
    const rim = hr(sd, k) < 0.45;
    const fy = rim ? Math.sqrt(Math.max(0, 1 - fx * fx)) * 0.92 : 0.15 + 0.45 * hr(sd + 1, k) * Math.sqrt(Math.max(0, 1 - fx * fx));
    for (const side of [-1, 1]) {
      const lx = (fx * L) / 2;
      const ly = (side * fy * W) / 2;
      const zz = Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy)) * (H / 2);
      const base = at(F, lx, ly, zz);
      const nl = nrm([fx / (L / 2), (side * fy) / (W / 2), zz / (H / 2) / (H / 2)]);
      const n: V3 = nrm(add(add(scl(F.f, nl[0]), F.s, nl[1]), F.u, nl[2] + 0.2));
      const dir = nrm(add(add(n, F.f, -0.9), F.s, side * (rim ? 0.6 : 0.1)));
      const sl = L * (rim || fx < -0.4 ? 0.13 : 0.07) * (macro ? 1 : 0.6);
      seta(out.lo, base, dir, scl(F.u, -1), sl, L * 0.007, setaCol);
    }
  }
}

function springtail(sp: Spring, come: number, time: number, groundY: Ground, eye: V3, out: Limbs) {
  const L = sp.size * (0.55 + 0.45 * come);
  const lod = detail(eye, sp.home, L);
  if (lod > 2) return;
  const plump = sp.kind === 'hypo';
  // sitting, then — its furca let go — a spring, tumbling, to somewhere else near
  const period = 4 + (sp.seed % 3);
  const n = Math.floor((time + sp.seed) / period);
  const f = (time + sp.seed) / period - n;
  const spot = (k: number) => {
    const a = hr(sp.seed, k) * Math.PI * 2;
    const d = Math.sqrt(hr(sp.seed + 3, k)) * sp.roam;
    return { x: sp.home[0] + Math.cos(a) * d, z: sp.home[2] + Math.sin(a) * d, h: hr(sp.seed + 7, k) * Math.PI * 2 };
  };
  const A = spot(n);
  const B = spot(n + 1);
  const jump = f > 0.9 ? (f - 0.9) / 0.1 : -1;
  const flying = jump >= 0;
  const tau = flying ? jump : 0;
  const x = lerp(A.x, B.x, tau);
  const z = lerp(A.z, B.z, tau);
  const dist = Math.hypot(B.x - A.x, B.z - A.z);
  const h = flying ? lerp(A.h, B.h, tau) : A.h;
  const H = L * (plump ? 0.42 : 0.3);
  const spins = 1 + Math.floor(hr(sp.seed, n) * 2);
  const pitch = flying ? -tau * Math.PI * 2 * spins : 0;
  const air = flying ? Math.sin(Math.PI * tau) * dist * 0.55 : 0;
  const F = frameOn(groundY, x, z, h, H * 0.75 + air, pitch);
  const list = lod === 0 ? out.hi : lod === 1 ? out.mid : out.lo;
  if (!flying || air < L * 0.5) out.shade.push(x, z, L * 0.5, 0.45 * (1 - Math.min(1, air / L)));
  // its body: head, three thoracic segments, six abdominal — points alternating between the
  // joins (narrow, pale) and the segments' middles; its back a little arched
  const segs = plump ? [0.2, 0.15, 0.2, 0.22, 0.23, 0.24, 0.25, 0.25, 0.22, 0.15] : [0.17, 0.11, 0.15, 0.16, 0.16, 0.16, 0.16, 0.17, 0.14, 0.09];
  const lens = plump ? [0.18, 0.07, 0.09, 0.09, 0.09, 0.09, 0.1, 0.11, 0.1, 0.08] : [0.17, 0.08, 0.1, 0.1, 0.09, 0.09, 0.09, 0.14, 0.08, 0.06];
  const total = lens.reduce((a, b) => a + b, 0);
  const pts: V3[] = [];
  const rad: number[] = [];
  let pos = 0.5;
  pts.push(at(F, L * pos, 0, -H * 0.1));
  rad.push(L * (plump ? 0.12 : 0.1));
  for (let k = 0; k < segs.length; k++) {
    const l = (lens[k] / total) * L;
    const mid = pos - l / (2 * L);
    const end = pos - l / L;
    // (arched; its head down a little, the end of its abdomen curving down to the ground)
    const droop = (x: number) => -Math.pow(Math.max(0, -x - 0.18), 2) * H * 2.2;
    const arch = Math.sin(Math.PI * (0.5 - mid)) * H * 0.12 + droop(mid);
    pts.push(at(F, mid * L, 0, arch + (k === 0 ? -H * 0.12 : 0)));
    rad.push(segs[k] * L * (plump ? 0.66 : 0.56));
    pts.push(at(F, end * L, 0, Math.sin(Math.PI * (0.5 - end)) * H * 0.12 - Math.pow(Math.max(0, -end - 0.18), 2) * H * 2.2));
    rad.push(segs[k] * L * (plump ? 0.66 : 0.56) * (k === segs.length - 1 ? 0.3 : 0.9));
    pos = end;
  }
  tube(list, pts, rad, sp.colour, MAT.soft, { flat: plump ? 0.82 : 0.75, seed: sp.seed, bands: sp.kind === 'ento' ? 0.12 : 0.22, eyes: 1 });
  const legCol = mix(sp.colour, [0.75, 0.75, 0.8], 0.18);
  const legList = lod === 2 ? out.lo : lod === 1 ? out.mid : out.hi;
  // its legs: three short pairs under the thorax (tucked, in the air)
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const hx = L * (0.27 - i * 0.09);
      const H0 = at(F, hx, side * L * 0.06, -H * 0.3);
      const shuffle = Math.sin(time * 1.7 + i + side + sp.seed) * L * 0.015;
      let foot: V3;
      if (flying) foot = at(F, hx - L * 0.05, side * L * 0.18, -H * 0.45);
      else {
        const g = at(F, hx + (1 - i) * L * 0.05 + shuffle, side * L * (0.13 + i * 0.015), 0);
        foot = [g[0], groundY(g[0], g[2]) + L * 0.008, g[2]];
      }
      leg(legList, H0, foot, F.u, L * 0.2, L * 0.036, legCol, 0.12, MAT.soft);
    }
  }
  if (lod > 1) return;
  // its antennae: four segments each, forward, out and up, feeling about
  const al = L * (sp.kind === 'ento' ? 0.55 : plump ? 0.28 : 0.42);
  for (const side of [-1, 1]) {
    const b = at(F, L * 0.48, side * L * 0.045, H * 0.05);
    const sw = Math.sin(time * 1.9 + side * 2 + sp.seed) * 0.25 + (flying ? -0.5 : 0);
    const pts2: V3[] = [b];
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      pts2.push(at(F, L * 0.48 + al * t * 0.85, side * (L * 0.045 + al * t * (0.35 + sw * 0.4)), H * 0.05 + al * (t * 0.35 - t * t * 0.25)));
    }
    tube(lod === 0 ? out.hi : out.mid, pts2, [L * 0.034, L * 0.03, L * 0.026, L * 0.024, L * 0.012], sp.colour, MAT.soft, { seed: sp.seed + side, bands: 0.5 });
  }
  // its furca: folded forward under it, held; in the jump, swung down and back
  const swing = flying ? Math.min(1, tau / 0.15) * Math.PI * 1.05 : 0;
  const fl = L * (plump ? 0.22 : sp.kind === 'ento' ? 0.48 : 0.4);
  const base = at(F, -L * 0.22, 0, -H * 0.4);
  for (const side of [-1, 1]) {
    const a = Math.PI - swing;
    const dx = Math.cos(a);
    const dz = -Math.sin(a);
    const mid = add(base, add(add(scl(F.f, -dx * fl * 0.4), F.u, dz * fl * 0.4), F.s, side * L * 0.02));
    const tip = add(base, add(add(scl(F.f, -dx * fl), F.u, dz * fl - L * 0.02), F.s, side * L * 0.035));
    tube(lod === 0 ? out.hi : out.mid, [base, mid, tip], [L * 0.035, L * 0.022, L * 0.008], legCol, MAT.leg, { smooth: false });
  }
  if (lod > 0) return;
  // its setae: a few long fine ones (sensory), most behind
  for (let k = 0; k < 16; k++) {
    const t = hr(sp.seed, k + 30);
    const side = k % 2 ? 1 : -1;
    const bx = L * (0.4 - t * 0.85);
    const base2 = at(F, bx, side * L * 0.08, H * 0.42);
    const dir = nrm(add(add(F.u, F.f, -0.7), F.s, side * 0.5));
    seta(out.lo, base2, dir, scl(F.f, -1), L * (0.04 + 0.06 * hr(sp.seed, k)) * (k < 3 ? 2.2 : 1), L * 0.005, mix(legCol, [0.85, 0.85, 0.85], plump ? 0.15 : 0.4));
  }
}
