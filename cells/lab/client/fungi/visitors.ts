/**
 * What comes to a pat from outside — big, at this scale: as long as the fungi are tall.
 *
 * - **Yellow dung flies** (*Scathophaga*). Within minutes of a pat's falling the males are on it:
 *   furry, golden, a centimetre long, each on its own patch of the crust, facing much the same
 *   way. They wait for the females, which come in fewer and greyer; a male that gets one rides
 *   her while she lays. They sit, groom, turn, dart to another spot. They're there by day, for
 *   the pat's first few days, while it's fresh.
 * - **Dung beetles** (*Aphodius*). Small, domed, glossy: a black shield, the wing cases chestnut
 *   or black, ridged; a shovel of a head; front legs broad and toothed for digging. They walk
 *   the pat, then dig in, and come up out of another hole; over its first week and more the pat
 *   is pitted with their holes.
 *
 * Built of limbs, like the mites. When, and on which pat, from the seed and the hour; how they
 * move in real time.
 */
import type { V3 } from './genome';
import { MAT, at, detail, frameOn, hr, leg, seta, tubeOf, type Limbs } from './critters';
import { patEdge } from './terrarium';

export interface PatInfo {
  x: number;
  z: number;
  drop: number;
  seed: number;
  lumps: number[];
}
type Ground = (x: number, z: number) => number;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ss = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** a point on the pat's surface (fraction `f` of the way out from its middle, at angle `a`) */
function onPat(p: PatInfo, a: number, f: number): [number, number] {
  const e = patEdge(p.lumps, a) * f;
  return [p.x + Math.cos(a) * e, p.z + Math.sin(a) * e];
}

// ─── the flies ──────────────────────────────────────────────────────────────────────────────────
interface Fly {
  pat: PatInfo;
  k: number;
  male: boolean;
  L: number;
  seed: number;
}
/** How many flies a pat has now: fresh, in daylight, warm. */
function flyCount(p: PatInfo, T: number) {
  const age = (T - p.drop) / 24;
  const hour = (21 + T) % 24;
  const day = ss(7, 9, hour) * (1 - ss(18, 20, hour));
  const fresh = ss(-0.02, 0.05, age) * (1 - ss(1.5, 4, age));
  return Math.round(lerp(4, 10, hr(p.seed, 7)) * day * fresh);
}
function fliesOn(p: PatInfo, T: number): Fly[] {
  const n = flyCount(p, T);
  const out: Fly[] = [];
  for (let k = 0; k < n; k++) out.push({ pat: p, k, male: hr(p.seed, k + 40) > 0.22, L: lerp(8, 10.5, hr(p.seed, k + 60)), seed: p.seed * 0.01 + k * 7.3 });
  return out;
}
/** Where a fly is now: sitting (where, which way) or flying (between two spots, how far) */
function flyAt(f: Fly, time: number) {
  // its spots on the pat: a new one every so often, a dart between
  const period = 7 + (f.seed % 1) * 14;
  const n = Math.floor((time + f.seed * 13) / period);
  const fr = (time + f.seed * 13) / period - n;
  // (the males all face much the same way — into the wind)
  const wind = hr(f.pat.seed, 3) * Math.PI * 2;
  const spot = (j: number) => {
    const [x, z] = onPat(f.pat, hr(f.seed, j) * Math.PI * 2, 0.15 + 0.75 * Math.sqrt(hr(f.seed + 1, j)));
    return { x, z, h: wind + (hr(f.seed + 2, j) - 0.5) * 1.4 };
  };
  const A = spot(n);
  const B = spot(n + 1);
  const dart = 0.04;
  const fly = fr > 1 - dart ? (fr - (1 - dart)) / dart : -1;
  if (fly < 0) return { x: A.x, z: A.z, h: A.h, fly: -1, air: 0 };
  const e = fly * fly * (3 - 2 * fly);
  const x = lerp(A.x, B.x, e);
  const z = lerp(A.z, B.z, e);
  const d = Math.hypot(B.x - A.x, B.z - A.z);
  return { x, z, h: Math.atan2(B.z - A.z, B.x - A.x), fly, air: Math.sin(Math.PI * fly) * (6 + d * 0.3) };
}
function drawFly(f: Fly, time: number, groundY: Ground, eye: V3, out: Limbs) {
  const s = flyAt(f, time);
  const L = f.L;
  const lod = detail(eye, [s.x, groundY(s.x, s.z), s.z], L * 0.25);
  if (lod > 2) return;
  const F = frameOn(groundY, s.x, s.z, s.h, L * 0.16 + s.air, s.fly >= 0 ? -0.15 : 0.08);
  out.shade.push(s.x, s.z, L * 0.35, 0.5 * (1 - Math.min(1, s.air / 8)));
  const gold: V3 = f.male ? [0.85, 0.58, 0.12] : [0.38, 0.36, 0.26];
  const list = lod === 0 ? out.hi : lod === 1 ? out.mid : out.lo;
  // head: eyes either side; thorax; abdomen tapering, curving down a little
  const head = at(F, L * 0.36, 0, L * 0.02);
  tubeOf(list, [at(F, L * 0.28, 0, 0.02 * L), head, at(F, L * 0.44, 0, -0.01 * L)], [L * 0.07, L * 0.1, L * 0.05], [0.8, 0.62, 0.3], MAT.soft, { seed: f.seed, flat: 0.85 });
  for (const side of [-1, 1]) tubeOf(list, [at(F, L * 0.33, side * L * 0.06, L * 0.03), at(F, L * 0.37, side * L * 0.075, L * 0.03), at(F, L * 0.41, side * L * 0.06, L * 0.03)], [L * 0.04, L * 0.065, L * 0.04], [0.45, 0.12, 0.06], MAT.chitin, { seed: f.seed + side });
  tubeOf(list, [at(F, L * 0.3, 0, 0), at(F, L * 0.16, 0, L * 0.03), at(F, L * 0.0, 0, L * 0.01)], [L * 0.08, L * 0.14, L * 0.1], gold, MAT.soft, { seed: f.seed + 3, flat: 0.85, bands: 0.1 });
  tubeOf(list, [at(F, -L * 0.02, 0, 0), at(F, -L * 0.2, 0, -L * 0.02), at(F, -L * 0.38, 0, -L * 0.06), at(F, -L * 0.5, 0, -L * 0.1)], [L * 0.09, L * 0.12, L * 0.09, L * 0.02], gold, MAT.soft, { seed: f.seed + 4, flat: 0.8, bands: 0.12 });
  // wings: folded back over it sitting, out and blurred flying — clear, faintly smoky
  const wingList = lod === 0 ? out.glassHi : out.glassMid;
  for (const side of [-1, 1]) {
    const root = at(F, L * 0.18, side * L * 0.07, L * 0.12);
    const spread = s.fly >= 0 ? 1.35 + Math.sin(time * 120 + side) * 0.3 : 0.32;
    const dir = nrm(add(add(F.f, F.s, side * Math.tan(spread)), F.u, s.fly >= 0 ? 0.1 : 0.03));
    const back: V3 = s.fly >= 0 ? dir : nrm(add(F.f, dir, -2));
    const wl = L * 0.82;
    const pts: V3[] = [];
    const rad: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      pts.push(add(root, back, wl * t));
      rad.push(L * 0.15 * Math.pow(Math.sin(Math.PI * Math.min(0.96, 0.08 + t * 0.85)), 0.8) + L * 0.005);
    }
    tubeOf(wingList, pts, rad, [0.95, 0.88, 0.7], MAT.worm, { flat: 0.03, seed: f.seed + side, bands: 1 });
  }
  // legs: three pairs, long, golden; grooming the front pair now and then
  const legCol: V3 = f.male ? [0.78, 0.55, 0.15] : [0.5, 0.45, 0.32];
  const legList = lod === 2 ? out.lo : lod === 1 ? out.mid : out.hi;
  const groom = Math.max(0, Math.sin(time * 0.6 + f.seed * 3)) > 0.7 && s.fly < 0;
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const hip = at(F, L * (0.26 - i * 0.08), side * L * 0.05, -L * 0.04);
      let foot: V3;
      if (s.fly >= 0) foot = at(F, L * (0.15 - i * 0.12), side * L * 0.3, -L * 0.18);
      else if (groom && i === 0) foot = at(F, L * 0.4, side * L * (0.03 + 0.04 * Math.sin(time * 14 + side)), L * 0.02 + Math.sin(time * 14) * L * 0.02);
      else {
        const g = at(F, L * (0.45 - i * 0.4), side * L * (0.42 - i * 0.02), 0);
        foot = [g[0], groundY(g[0], g[2]) + L * 0.005, g[2]];
      }
      const lp = leg(legList, hip, foot, F.u, L * 0.7, L * 0.022, legCol, 0.35);
      if (lod === 0) for (let k = 2; k < 6; k++) seta(out.lo, lp[k], nrm(add(F.u, add(lp[k + 1], lp[k], -1), 0.5)), F.f, L * 0.04, L * 0.003, [0.2, 0.15, 0.08]);
    }
  }
  // fur: the male's dense and golden, all over its thorax and abdomen
  if (lod === 0) {
    const fur: V3 = f.male ? [0.95, 0.72, 0.25] : [0.6, 0.58, 0.45];
    const nfur = f.male ? 70 : 30;
    for (let k = 0; k < nfur; k++) {
      const u = hr(f.seed, k + 100);
      const a = hr(f.seed + 5, k) * Math.PI * 2;
      const x = lerp(-0.45, 0.28, u) * L;
      const rr = (x > 0 ? 0.13 : 0.11 * (1 - Math.max(0, -x / L - 0.3) * 2)) * L;
      const base = add(at(F, x, Math.cos(a) * rr, Math.sin(a) * rr * 0.8), [0, 0, 0]);
      const dir = nrm(add(add(add([0, 0, 0], F.s, Math.cos(a)), F.u, Math.sin(a) + 0.3), F.f, -0.6));
      seta(out.lo, base, dir, [0, -1, 0], L * lerp(0.05, 0.1, hr(f.seed + 9, k)), L * 0.004, fur);
    }
  }
}

// ─── the beetles ────────────────────────────────────────────────────────────────────────────────
interface Beetle {
  pat: PatInfo;
  k: number;
  L: number;
  elytra: V3;
  seed: number;
}
/** How many beetles a pat has, and how many holes it's been bored with, at its age (days). */
function beetleCount(p: PatInfo, T: number) {
  const age = (T - p.drop) / 24;
  return Math.round(lerp(2, 6, hr(p.seed, 11)) * ss(0.1, 0.6, age) * (1 - ss(7, 12, age)));
}
function holeCount(p: PatInfo, T: number) {
  const age = (T - p.drop) / 24;
  return Math.round(lerp(6, 18, hr(p.seed, 12)) * ss(0.3, 8, age) * (1 - ss(40, 55, age)));
}
function holeAt(p: PatInfo, j: number): [number, number] {
  return onPat(p, hr(p.seed + 20, j) * Math.PI * 2, 0.1 + 0.75 * Math.sqrt(hr(p.seed + 21, j)));
}
function beetlesOn(p: PatInfo, T: number): Beetle[] {
  const out: Beetle[] = [];
  for (let k = 0; k < beetleCount(p, T); k++) {
    const red = hr(p.seed, k + 80) < 0.6;
    out.push({ pat: p, k, L: lerp(5, 8, hr(p.seed, k + 90)), elytra: red ? [0.42, 0.12, 0.05] : [0.05, 0.045, 0.04], seed: p.seed * 0.01 + k * 5.1 });
  }
  return out;
}
/** Where a beetle is: walking (where, which way, how far it's gone), or going down/up a hole */
function beetleAt(b: Beetle, time: number) {
  // a cycle: come up out of a hole, walk a while, go down another; under a while
  const period = 50 + (b.seed % 1) * 40;
  const n = Math.floor((time + b.seed * 17) / period);
  const fr = (time + b.seed * 17) / period - n;
  const nh = Math.max(1, holeCount(b.pat, b.pat.drop + 5 * 24));
  const h0 = holeAt(b.pat, Math.floor(hr(b.seed, n) * nh));
  const h1 = holeAt(b.pat, Math.floor(hr(b.seed + 1, n) * nh));
  const up = 0.08;
  const walk = 0.55;
  let sink = 0;
  let x: number;
  let z: number;
  let gone = 0;
  if (fr < up) {
    sink = 1 - fr / up;
    x = h0[0];
    z = h0[1];
    gone = 0;
  } else if (fr < up + walk) {
    const t = (fr - up) / walk;
    // (wandering, not straight: a curve between the holes)
    const mx = (h0[0] + h1[0]) / 2 + Math.sin(b.seed * 3 + n) * 8;
    const mz = (h0[1] + h1[1]) / 2 + Math.cos(b.seed * 3 + n) * 8;
    const u = t;
    x = (1 - u) * (1 - u) * h0[0] + 2 * u * (1 - u) * mx + u * u * h1[0];
    z = (1 - u) * (1 - u) * h0[1] + 2 * u * (1 - u) * mz + u * u * h1[1];
    gone = t * (Math.hypot(mx - h0[0], mz - h0[1]) + Math.hypot(h1[0] - mx, h1[1] - mz));
  } else if (fr < up * 2 + walk) {
    sink = (fr - up - walk) / up;
    x = h1[0];
    z = h1[1];
    gone = 999;
  } else return null;
  // heading: along its path (numerically)
  const t2 = Math.min(1, Math.max(0, (fr - up) / walk));
  const mx = (h0[0] + h1[0]) / 2 + Math.sin(b.seed * 3 + n) * 8;
  const mz = (h0[1] + h1[1]) / 2 + Math.cos(b.seed * 3 + n) * 8;
  const dx = 2 * (1 - t2) * (mx - h0[0]) + 2 * t2 * (h1[0] - mx);
  const dz = 2 * (1 - t2) * (mz - h0[1]) + 2 * t2 * (h1[1] - mz);
  return { x, z, h: Math.atan2(dz, dx), sink, gone };
}
function drawBeetle(b: Beetle, time: number, groundY: Ground, eye: V3, out: Limbs) {
  const s = beetleAt(b, time);
  if (!s) return;
  const L = b.L;
  const lod = detail(eye, [s.x, groundY(s.x, s.z), s.z], L * 0.3);
  if (lod > 2) return;
  const W = L * 0.48;
  const H = L * 0.36;
  // (going down a hole: head first, tipped, sinking)
  const F = frameOn(groundY, s.x, s.z, s.h, L * 0.08 + H / 2 - s.sink * H * 1.3, -s.sink * 0.6);
  out.shade.push(s.x, s.z, W * 0.8, 0.55 * (1 - s.sink));
  const list = lod === 0 ? out.hi : lod === 1 ? out.mid : out.lo;
  const black: V3 = [0.04, 0.035, 0.03];
  // elytra: a long dome, ridged lengthwise, the suture down its middle
  const pts: V3[] = [];
  const rad: number[] = [];
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    pts.push(at(F, lerp(L * 0.1, -L * 0.5, t), 0, H * 0.05));
    rad.push((W / 2) * Math.pow(Math.max(0.02, Math.sin(Math.PI * Math.min(0.97, 0.12 + t * 0.85))), 0.5));
  }
  tubeOf(list, pts, rad, b.elytra, MAT.chitin, { flat: 0.78, seed: b.seed, bands: 1 });
  // the pronotum, the head (a shovel), the clubbed antennae
  tubeOf(list, [at(F, L * 0.1, 0, H * 0.04), at(F, L * 0.2, 0, H * 0.02), at(F, L * 0.3, 0, -H * 0.02)], [W * 0.46, W * 0.5, W * 0.38], black, MAT.chitin, { flat: 0.62, seed: b.seed + 1, groove: 0.3 });
  tubeOf(list, [at(F, L * 0.29, 0, -H * 0.08), at(F, L * 0.38, 0, -H * 0.16), at(F, L * 0.44, 0, -H * 0.22)], [W * 0.3, W * 0.33, W * 0.22], black, MAT.chitin, { flat: 0.35, seed: b.seed + 2 });
  const legList = lod === 2 ? out.lo : lod === 1 ? out.mid : out.hi;
  const legCol: V3 = [0.12, 0.06, 0.03];
  if (lod === 0) {
    for (const side of [-1, 1]) {
      const a0 = at(F, L * 0.36, side * W * 0.22, -H * 0.12);
      const a1 = at(F, L * 0.44, side * W * 0.42, -H * 0.05);
      tubeOf(out.mid, [a0, a1, add(a1, F.s, side * L * 0.02)], [L * 0.012, L * 0.01, L * 0.03], [0.35, 0.2, 0.1], MAT.leg, { smooth: false });
    }
  }
  // the legs: walking in tripods; the front pair broad and toothed (for digging)
  const stride = L * 0.3;
  const ph = s.gone / stride;
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const set = (i + (side > 0 ? 1 : 0)) % 2;
      const p = ((ph + set * 0.5) % 1 + 1) % 1;
      let off: number;
      let lift = 0;
      if (p < 0.55) off = (0.5 - p / 0.55) * stride;
      else {
        const q = (p - 0.55) / 0.45;
        off = (-0.5 + q) * stride;
        lift = Math.sin(Math.PI * q) * L * 0.08;
      }
      if (s.sink > 0 || s.gone >= 999) off = 0;
      const hx = L * (0.18 - i * 0.16);
      const hip = at(F, hx, side * W * 0.2, -H * 0.3);
      const g = at(F, hx + [0.35, 0.0, -0.25][i] * L + off, side * (W * 0.5 + L * 0.3), 0);
      const foot: V3 = [g[0], groundY(g[0], g[2]) + lift, g[2]];
      const lp = leg(legList, hip, foot, F.u, L * 0.65, L * (i === 0 ? 0.05 : 0.04), legCol, 0.25);
      // (spines on the tibiae; teeth on the front ones)
      if (lod === 0) for (let k = 3; k < 6; k++) seta(out.lo, lp[k], nrm(add(add(lp[k + 1], lp[k], -1), F.s, side * 0.8)), F.u, L * (i === 0 && k === 4 ? 0.06 : 0.035), L * 0.008, black);
    }
  }
}
/** The holes they've bored: dark pits, a rim of crumbs. */
function drawHoles(p: PatInfo, T: number, groundY: Ground, eye: V3, solid: number[]) {
  const n = holeCount(p, T);
  if (!n || Math.hypot(p.x - eye[0], p.z - eye[2]) > 200) return;
  for (let j = 0; j < n; j++) {
    const [x, z] = holeAt(p, j);
    const y = groundY(x, z);
    const r = lerp(1.1, 1.8, hr(p.seed, j + 200));
    // (flush with the crust: a pit, not a disc on it)
    solid.push(x, y - r * 0.05, z, r, r * 0.12, r, 0.035, 0.025, 0.018, 2);
    for (let c = 0; c < 6; c++) {
      const a = hr(p.seed + j, c) * Math.PI * 2;
      const d = r * lerp(1.05, 1.6, hr(p.seed + j, c + 9));
      const cr = r * lerp(0.15, 0.3, hr(p.seed + j, c + 19));
      solid.push(x + Math.cos(a) * d, y + cr * 0.3, z + Math.sin(a) * d, cr, cr * 0.7, cr, 0.18, 0.13, 0.08, 2);
    }
  }
}

/** All the visitors to these pats, into the frame. */
export function drawVisitors(pats: PatInfo[], T: number, time: number, groundY: Ground, eye: V3, out: Limbs, solid: number[]) {
  for (const p of pats) {
    if (T < p.drop) continue;
    drawHoles(p, T, groundY, eye, solid);
    if (Math.hypot(p.x - eye[0], p.z - eye[2]) > 260) continue;
    for (const f of fliesOn(p, T)) drawFly(f, time, groundY, eye, out);
    for (const b of beetlesOn(p, T)) drawBeetle(b, time, groundY, eye, out);
  }
}
/** Something visiting near here, for the lens to follow: a fly, or a beetle; its position now. */
export function visitorNear(pats: PatInfo[], kind: 'flies' | 'beetle', T: number, near: V3, groundY: Ground): ((time: number) => V3) | null {
  let best: PatInfo | null = null;
  let d = 1e9;
  for (const p of pats) {
    const n = kind === 'flies' ? flyCount(p, T) : beetleCount(p, T);
    const e = Math.hypot(p.x - near[0], p.z - near[2]);
    if (n > 0 && e < d) {
      d = e;
      best = p;
    }
  }
  if (!best || d > 160) return null;
  const p = best;
  if (kind === 'flies') {
    const f = fliesOn(p, T)[0];
    return (time) => {
      const s = flyAt(f, time);
      return [s.x, groundY(s.x, s.z) + 2 + s.air, s.z];
    };
  }
  const bs = beetlesOn(p, T);
  return (time) => {
    // (whichever is up)
    for (const b of bs) {
      const s = beetleAt(b, time);
      if (s && s.sink < 0.9) return [s.x, groundY(s.x, s.z) + 1.5, s.z];
    }
    return [p.x, groundY(p.x, p.z) + 2, p.z];
  };
}
