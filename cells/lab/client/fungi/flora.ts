/**
 * The pasture's other life, under and among the grass:
 *
 * - **Mosses.** Cushions of upright shoots (a *Bryum*'s, a *Ceratodon*'s), their leaves in a close
 *   spiral; from them, sporophytes: a fine red seta, a capsule nodding at its top, green and then
 *   brown. Feather moss (*Brachythecium*) creeping over the soil and the thatch, its stems
 *   branched either side. Both in patches, where the sward is open.
 * - **Dung moss** (*Splachnum*), on some old pats: pale shoots, and on long setae, under each
 *   capsule, a swollen apophysis — an umbrella, magenta or yellow — the colour and the smell of it
 *   to bring flies, which carry its sticky spores to the next pat.
 * - **White clover**, in patches: stolons along the ground, and up from them on long stalks, leaves
 *   of three broad leaflets, each with its pale chevron.
 * - **Money spiders' sheet webs**, low in the grass: hammocks of silk. By day you hardly see them;
 *   at dawn they're silver with dew.
 *
 * All from the field's seed and the place, like the grass; drawn near the camera only.
 */
import { hash, seeded } from '../kit/rng';
import type { V3 } from './genome';
import { MAT, tubeOf, type Limbs } from './critters';
import type { Field } from './grass';

export const MAT_MOSS = 7;
export const MAT_LEAF = 8;
const CELL = 14;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ss = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));

/** smooth value noise over the field (0..1), seeded: where moss is, where clover is */
function patchy(world: number, k: number, x: number, z: number, scale: number) {
  const fx = x / scale;
  const fz = z / scale;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const h = (a: number, b: number) => (hash(world, k, a + 100000, b + 100000) % 10000) / 10000;
  const u = fx - ix;
  const v = fz - iz;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  return lerp(lerp(h(ix, iz), h(ix + 1, iz), su), lerp(h(ix, iz + 1), h(ix + 1, iz + 1), su), sv);
}

interface Cushion {
  x: number;
  z: number;
  R: number;
  H: number;
  col: V3;
  seed: number;
  sporo: number;
  dung: boolean;
  apo: V3;
}
interface Feather {
  x: number;
  z: number;
  a: number;
  L: number;
  col: V3;
  seed: number;
}
interface Clover {
  x: number;
  z: number;
  a: number;
  seed: number;
}
interface Web {
  x: number;
  z: number;
  R: number;
  h: number;
  seed: number;
}

/** A pat old enough for dung moss: where it is and how old (days), or null. */
export type OldPat = { x: number; z: number; age: number; seed: number };

function cell(world: number, ix: number, iz: number, f: Field, old: OldPat[]) {
  const r = seeded(hash(world, 0xf10a, ix + 100000, iz + 100000));
  const cx = (ix + 0.5) * CELL;
  const cz = (iz + 0.5) * CELL;
  const cushions: Cushion[] = [];
  const feathers: Feather[] = [];
  const clovers: Clover[] = [];
  const webs: Web[] = [];
  const open = f.under(cx, cz);
  const mossy = ss(0.5, 0.72, patchy(world, 1, cx, cz, 70));
  if (open > 0.95 && r() < mossy * 0.9) {
    for (let k = 0; k < 1 + Math.floor(r() * 2); k++) {
      const green: V3 = r() < 0.5 ? [lerp(0.25, 0.35, r()), lerp(0.42, 0.52, r()), 0.08] : [lerp(0.14, 0.2, r()), lerp(0.3, 0.38, r()), 0.07];
      cushions.push({ x: (ix + r()) * CELL, z: (iz + r()) * CELL, R: lerp(2.5, 7, r()), H: lerp(2, 5, r()), col: green, seed: r() * 100, sporo: r() < 0.6 ? Math.floor(r() * 9) : 0, dung: false, apo: [0, 0, 0] });
    }
  }
  if (open > 0.95 && r() < mossy * 0.8) {
    for (let k = 0; k < 2; k++) feathers.push({ x: (ix + r()) * CELL, z: (iz + r()) * CELL, a: r() * Math.PI * 2, L: lerp(14, 30, r()), col: [lerp(0.3, 0.42, r()), lerp(0.45, 0.55, r()), lerp(0.08, 0.14, r())], seed: r() * 100 });
  }
  // dung moss: on an old pat (some of them), in a few clumps
  for (const p of old) {
    if (Math.hypot(p.x - cx, p.z - cz) > 16 || (p.seed % 10) > 4 || p.age < 22) continue;
    if (r() < 0.55) {
      const magenta = p.seed % 2 < 1;
      const x = (ix + r()) * CELL;
      const z = (iz + r()) * CELL;
      if (Math.hypot(p.x - x, p.z - z) > 15) continue;
      const grow = ss(22, 32, p.age) * (1 - ss(50, 56, p.age));
      cushions.push({ x, z, R: lerp(2, 4, r()) * (0.4 + 0.6 * grow), H: lerp(2, 3.5, r()) * grow, col: [0.42, 0.55, 0.22], seed: r() * 100, sporo: Math.floor(lerp(3, 9, r()) * grow), dung: true, apo: magenta ? [0.78, 0.12, 0.42] : [0.95, 0.78, 0.15] });
    }
  }
  const clovery = ss(0.6, 0.78, patchy(world, 2, cx, cz, 90));
  if (open > 0.95 && r() < clovery) clovers.push({ x: (ix + r()) * CELL, z: (iz + r()) * CELL, a: r() * Math.PI * 2, seed: r() * 100 });
  if (open > 0.95 && r() < 0.05) webs.push({ x: (ix + r()) * CELL, z: (iz + r()) * CELL, R: lerp(15, 30, r()), h: lerp(5, 18, r()), seed: r() * 100 });
  return { cushions, feathers, clovers, webs };
}

const cache = new Map<string, { epoch: number; c: ReturnType<typeof cell> }>();
function cached(world: number, ix: number, iz: number, f: Field, old: OldPat[], epoch: number) {
  const key = `${world}:${ix}:${iz}`;
  const hit = cache.get(key);
  if (hit && hit.epoch === epoch) return hit.c;
  if (cache.size > 3000) cache.clear();
  const c = cell(world, ix, iz, f, old);
  cache.set(key, { epoch, c });
  return c;
}

/** The nearest of a kind to (x, z), for the lens: a moss cushion with capsules, dung moss, clover,
 *  a web — where to look, and how big it is. */
export type FloraKind = 'moss' | 'dungmoss' | 'clover' | 'web';
export function floraNear(world: number, f: Field, old: OldPat[], x: number, z: number, kind: FloraKind, epoch: number): { at: V3; size: number } | null {
  let best: { at: V3; size: number } | null = null;
  let bd = 1e9;
  const R = 150;
  for (let ix = Math.floor((x - R) / CELL); ix <= Math.floor((x + R) / CELL); ix++) {
    for (let iz = Math.floor((z - R) / CELL); iz <= Math.floor((z + R) / CELL); iz++) {
      const c = cached(world, ix, iz, f, old, epoch);
      const list: Array<{ x: number; z: number; y: number; size: number }> =
        kind === 'clover'
          ? c.clovers.map((p) => {
              // (its first leaf: where it is, as clover() puts it)
              const a = p.a + Math.sin(0.2 * 2 + p.seed) * 0.4;
              const H = 25 + ((p.seed * 2 * 3.1) % 1) * 45;
              return { x: p.x + Math.cos(a) * 6, z: p.z + Math.sin(a) * 6, y: H / 0.6, size: 18 };
            })
          : kind === 'web'
            ? c.webs.map((w) => ({ x: w.x, z: w.z, y: w.h, size: w.R * 0.8 }))
            : c.cushions.filter((m) => m.dung === (kind === 'dungmoss') && m.sporo > 2).map((m) => ({ x: m.x, z: m.z, y: m.dung ? 42 : 5, size: m.dung ? 14 : 7 }));
      for (const q of list) {
        const d = Math.hypot(q.x - x, q.z - z);
        if (d < bd) {
          bd = d;
          best = { at: [q.x, f.groundY(q.x, q.z) + q.y * 0.6, q.z], size: q.size };
        }
      }
    }
  }
  return best;
}

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Into the frame: limbs for the near, tufts (solids) for the further, dew for the webs. */
export function drawFlora(world: number, f: Field, old: OldPat[], look: V3, eye: V3, time: number, hour: number, epoch: number, out: Limbs, solid: number[], dew: number[]) {
  const R = 110;
  const wet = ss(1.5, 5, hour) * (1 - ss(8.5, 10.5, hour));
  for (let ix = Math.floor((look[0] - R) / CELL); ix <= Math.floor((look[0] + R) / CELL); ix++) {
    for (let iz = Math.floor((look[2] - R) / CELL); iz <= Math.floor((look[2] + R) / CELL); iz++) {
      const c = cached(world, ix, iz, f, old, epoch);
      for (const m of c.cushions) {
        const de = Math.hypot(m.x - eye[0], m.z - eye[2], eye[1]);
        if (de > 260) continue;
        const y0 = f.groundY(m.x, m.z);
        if (de > 30) {
          // (further off: a tuft)
          solid.push(m.x, y0 + m.H * 0.3, m.z, m.R, m.H * 0.7, m.R, ...m.col, 3);
        } else cushion(m, y0, f, time, out, de);
        sporophytes(m, y0, time, out, de);
      }
      for (const p of c.feathers) {
        const de = Math.hypot(p.x - eye[0], p.z - eye[2], eye[1]);
        if (de > 70) continue;
        feather(p, f, out);
      }
      for (const p of c.clovers) {
        const de = Math.hypot(p.x - eye[0], p.z - eye[2], eye[1]);
        if (de > 200) continue;
        clover(p, f, time, out, de);
      }
      for (const w of c.webs) {
        if (wet < 0.2) continue;
        const de = Math.hypot(w.x - eye[0], w.z - eye[2], eye[1]);
        if (de > 90) continue;
        web(w, f, wet, out, dew, de);
      }
    }
  }
}

/** a cushion of upright shoots, taller in its middle */
function cushion(m: Cushion, y0: number, f: Field, time: number, out: Limbs, de: number) {
  // (packed: their tips make the cushion's surface)
  const n = Math.min(160, Math.round(m.R * m.R * 7));
  let q = Math.floor(m.seed * 9973) >>> 0;
  const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * m.R;
    const x = m.x + Math.cos(a) * d;
    const z = m.z + Math.sin(a) * d;
    const h = m.H * Math.sqrt(Math.max(0.05, 1 - (d / m.R) ** 2)) * lerp(0.9, 1.08, rnd());
    const out_ = (d / m.R) * 0.5;
    const b: V3 = [x, f.groundY(x, z) - 0.3, z];
    const tip: V3 = [x + Math.cos(a) * h * out_, b[1] + h, z + Math.sin(a) * h * out_];
    const mid = add(b, [Math.cos(a) * h * out_ * 0.3, h * 0.55, Math.sin(a) * h * out_ * 0.3]);
    const r0 = (m.dung ? 0.3 : 0.24) * lerp(0.85, 1.15, rnd());
    tubeOf(out.lo, [b, mid, tip], [r0, r0 * 1.05, r0 * 0.7], m.col, MAT_MOSS, { seed: m.seed + k });
  }
  void time;
}
/** its sporophytes: a seta, curving, a capsule nodding at its top (a dung moss's on an umbrella) */
function sporophytes(m: Cushion, y0: number, time: number, out: Limbs, de: number) {
  if (de > 140) return;
  let q = Math.floor(m.seed * 7919) >>> 0;
  const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < m.sporo; k++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * m.R * 0.8;
    const b: V3 = [m.x + Math.cos(a) * d, y0 + m.H * 0.6, m.z + Math.sin(a) * d];
    const L = m.dung ? lerp(18, 35, rnd()) : lerp(9, 20, rnd());
    const lean = lerp(0.05, 0.25, rnd());
    const sway = Math.sin(time * 1.3 + m.seed + k) * 0.03;
    const dir: V3 = [Math.cos(a + 1) * (lean + sway), 1, Math.sin(a + 1) * (lean + sway)];
    const pts: V3[] = [b];
    for (let j = 1; j <= 4; j++) {
      const t = j / 4;
      pts.push(add(b, [dir[0] * L * t * t, L * t, dir[2] * L * t * t]));
    }
    const top = pts[4];
    const seta: V3 = m.dung ? [0.6, 0.45, 0.25] : [0.55, 0.12, 0.06];
    tubeOf(out.lo, pts, [0.09, 0.08, 0.07, 0.065, 0.06], seta, MAT.chitin, { seed: m.seed });
    if (m.dung) {
      // the umbrella, then the small capsule on it
      const u = (k + m.seed) % 1;
      const R = lerp(1.8, 3, u);
      const disc: V3[] = [top, add(top, [0, 0.25, 0]), add(top, [0, 0.55, 0]), add(top, [0, 0.75, 0]), add(top, [0, 0.95, 0])];
      tubeOf(de < 150 ? out.hi : out.mid, disc, [0.12, R * 0.75, R, R * 0.55, 0.25], m.apo, MAT.chitin, { seed: m.seed + k });
      const c0 = add(top, [0, 0.9, 0]);
      tubeOf(out.mid, [c0, add(c0, [0, 0.5, 0]), add(c0, [0, 1.1, 0])], [0.25, 0.32, 0.12], [0.35, 0.3, 0.2], MAT.chitin, { seed: m.seed });
    } else {
      // nodding: the capsule's axis turned over from the seta's
      const ripe = (m.seed + k * 0.37) % 1;
      const col: V3 = ripe < 0.5 ? [0.45, 0.5, 0.15] : [0.42, 0.24, 0.1];
      const hd: V3 = [Math.cos(a + 1) * 0.9, -0.45, Math.sin(a + 1) * 0.9];
      const cl = lerp(1.6, 2.6, ripe);
      const c1 = add(top, hd, cl * 0.25);
      const c2 = add(top, hd, cl * 0.7);
      const c3 = add(top, hd, cl);
      tubeOf(de < 50 ? out.hi : out.mid, [top, c1, c2, c3, add(top, hd, cl * 1.12)], [0.07, 0.3, 0.42, 0.3, 0.12], col, MAT.chitin, { seed: m.seed + k });
    }
  }
}
/** feather moss: a stem lying over the ground, leafy branches alternately either side */
function feather(p: Feather, f: Field, out: Limbs) {
  const n = 7;
  const pts: V3[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const a = p.a + Math.sin(t * 3 + p.seed) * 0.3;
    const x = p.x + Math.cos(a) * p.L * t;
    const z = p.z + Math.sin(a) * p.L * t;
    pts.push([x, f.groundY(x, z) + 0.3 + Math.sin(t * Math.PI) * 1.2, z]);
  }
  tubeOf(out.mid, pts, pts.map((_, k) => 0.3 * (1 - k / (n * 1.4))), p.col, MAT_MOSS, { seed: p.seed });
  for (let kk = 2; kk < (n - 1) * 2; kk++) {
    const k = Math.floor(kk / 2);
    for (const side of [-1, 1]) {
      if ((kk + (side > 0 ? 1 : 0)) % 2) continue;
      const b = pts[k];
      const t: V3 = [pts[k + 1][0] - pts[k - 1][0], 0, pts[k + 1][2] - pts[k - 1][2]];
      const l = Math.hypot(t[0], t[2]) || 1;
      const s: V3 = [(-t[2] / l) * side, 0, (t[0] / l) * side];
      const bl = p.L * 0.22 * (1 - k / n);
      const e = add(add(b, s, bl), [t[0] / l, 0.15, t[2] / l], bl * 0.6);
      tubeOf(out.lo, [b, add(add(b, s, bl * 0.5), [0, 0.4, 0]), e], [0.22, 0.2, 0.08], p.col, MAT_MOSS, { seed: p.seed + kk });
    }
  }
}
/** white clover: a stolon, and leaves on long stalks — three broad leaflets with a pale chevron */
function clover(p: Clover, f: Field, time: number, out: Limbs, de: number) {
  const n = 6;
  const st: V3[] = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const a = p.a + Math.sin(t * 2 + p.seed) * 0.4;
    const x = p.x + Math.cos(a) * 30 * t;
    const z = p.z + Math.sin(a) * 30 * t;
    st.push([x, f.groundY(x, z) + 0.6, z]);
  }
  tubeOf(out.lo, st, st.map(() => 0.6), [0.4, 0.42, 0.22], MAT_LEAF, { seed: p.seed });
  for (let k = 1; k < n; k += 2) {
    const b = st[k];
    const H = 25 + ((p.seed * (k + 1) * 3.1) % 1) * 45;
    const sway = Math.sin(time * 0.9 + p.seed + k) * 1.2;
    const lean = (((p.seed * (k + 2) * 1.7) % 1) - 0.5) * 8;
    const top: V3 = [b[0] + lean + sway, b[1] + H, b[2] + lean * 0.5];
    tubeOf(out.lo, [b, [b[0] + lean * 0.3, b[1] + H * 0.5, b[2] + lean * 0.1], top], [0.55, 0.5, 0.45], [0.36, 0.5, 0.2], MAT_LEAF, { seed: p.seed });
    const L = 9 + ((p.seed * (k + 3)) % 1) * 7;
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI * 2 + p.seed + k;
      const d: V3 = [Math.cos(a), -0.12, Math.sin(a)];
      const across: V3 = [-Math.sin(a), 0, Math.cos(a)];
      const pts: V3[] = [];
      const rad: number[] = [];
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        pts.push(add(top, [d[0] * L * t, d[1] * L * t - Math.sin(t * Math.PI) * 0.6 + t * t * 1.2 * -1, d[2] * L * t]));
        // (obovate: narrow at its base, broad, a little notched at its end)
        rad.push(L * 0.42 * Math.pow(Math.sin(Math.PI * Math.min(0.97, 0.06 + t * 0.62)), 0.9) * (t > 0.92 ? 0.85 : 1) + 0.15);
      }
      tubeOf(de < 60 ? out.mid : out.lo, pts, rad, [0.13, 0.32, 0.12], MAT_LEAF, { flat: 0.04, seed: p.seed + j, across, bands: 1 });
    }
  }
}
/** a money spider's sheet: a hammock of crossing threads, low between the blades; at dawn, dewed */
function web(w: Web, f: Field, wet: number, out: Limbs, dew: number[], de: number) {
  let q = Math.floor(w.seed * 6151) >>> 0;
  const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
  const y0 = f.groundY(w.x, w.z) + w.h;
  const at = (a: number, rr: number): V3 => {
    const x = w.x + Math.cos(a) * rr * w.R;
    const z = w.z + Math.sin(a) * rr * w.R * 0.8;
    // (a hammock: lowest in its middle)
    return [x, y0 - (1 - rr * rr) * w.R * 0.12, z];
  };
  const chords = 22;
  const step = de < 40 ? 0.45 : 0.8;
  for (let k = 0; k < chords; k++) {
    const a0 = rnd() * Math.PI * 2;
    const a1 = a0 + lerp(1.2, 3.1, rnd());
    const p0 = at(a0, 1);
    const p1 = at(a1, 1);
    const L = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    const m = Math.max(2, Math.floor(L / step));
    for (let i = 1; i < m; i++) {
      const t = i / m;
      const x = lerp(p0[0], p1[0], t);
      const z = lerp(p0[2], p1[2], t);
      const rr = Math.min(1, Math.hypot((x - w.x) / w.R, (z - w.z) / (w.R * 0.8)));
      const y = y0 - (1 - rr * rr) * w.R * 0.12;
      const s = (0.03 + 0.09 * rnd()) * wet;
      dew.push(x, y, z, s, s * 0.9, s, 1, 1, 1, 1);
    }
    tubeOf(out.lo, [p0, at((a0 + a1) / 2, 0.3), p1], [0.006, 0.006, 0.006], [0.85, 0.85, 0.85], MAT.seta, { seed: w.seed });
  }
}
