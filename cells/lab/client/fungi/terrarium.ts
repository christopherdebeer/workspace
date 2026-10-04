/**
 * Hat-throwers' terrarium: a pellet of dung and the fungi that come to it, one after another, over
 * three weeks — the rules, apart from the drawing.
 *
 * On dung the fungi come in an order (a succession, and a real one): the pin moulds and the
 * hat-throwers first, within days; the jelly cups after a week or so; the inkcaps last, at two or
 * three weeks. Each lives as mycelium in the dung before it fruits, eating it and taking ground
 * from the others; where it's thickest and the dung still has food and water in it, it fruits.
 * As the dung is eaten, the early ones give out and the later ones take their ground.
 *
 * The ground is a grid of cells over the pellet, each with its food, its water and each species'
 * mycelium, stepped every few hours through the whole three weeks (all of it from the seed, so a
 * terrarium is the same every time). From it come the fruit — each flush placed where its species
 * is thickest — and the moments worth watching, for the camera.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { makeCushion, makeStalk, species, type Cushion, type Form, type Genome, type Stalk, type V3 } from './genome';

/** the ground's grid: cells a side, over a square this wide (mm) */
export const GRID = 48;
export const SPAN = 56;
/** the simulation's step (h) */
export const STEP = 6;
/** how long a terrarium runs (days) */
export const DAYS = 21;

export interface Species {
  g: Genome;
  /** the day it arrives (as spores, landing) */
  arrive: number;
  stalks: Stalk[];
  cups: Cushion[];
}
/** A moment worth watching: what, where, how big (mm), whose. */
export interface Moment {
  T: number;
  at: V3;
  size: number;
  kind: 'emerge' | 'throw' | 'open' | 'ink' | 'fire' | 'stuck' | 'ride' | 'graze' | 'squirt';
  who: number;
}
export interface Terrarium {
  species: Species[];
  /** the ground through time: per step, per cell, RGBA — mycelium (all), water, food, dung */
  ground: Uint8Array[];
  moments: Moment[];
  /** the pellet: where there's dung (1) and where there's not */
  dung: Float32Array;
  /** what's been thrown and landed: sporangia stuck where they hit (the ground, or something
   * standing there), and packets of spores the cups have fired, each from when to when */
  marks: Mark[];
}
/** Something small left lying (or stuck): where, how big (mm), its colour, from when, until when;
 * on the ground (its height to be found there) or held up on something. */
export interface Mark {
  p: V3;
  r: number;
  c: V3;
  t0: number;
  t1: number;
  ground: boolean;
  kind: 'cap' | 'spores';
  /** stuck to something standing: how far up it (0–1) and round it */
  on?: { st: Stalk; s: number; a: number };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Who comes, and when: the succession, from the seed. */
function cast(r: Rand, r2: Rand): Array<{ form: Form; arrive: number }> {
  const out: Array<{ form: Form; arrive: number }> = [];
  const early: Form = r() < 0.65 ? 'thrower' : 'pin';
  out.push({ form: early, arrive: lerp(0, 0.8, r()) });
  if (r() < 0.4) out.push({ form: early === 'thrower' ? 'pin' : 'thrower', arrive: lerp(0.5, 2, r()) });
  if (r() < 0.8) out.push({ form: 'cup', arrive: lerp(3.5, 6, r()) });
  if (r() < 0.85 || out.length < 2) out.push({ form: 'inkcap', arrive: lerp(7.5, 11, r()) });
  // (and, in some, the second wave's others: an eyelash cup, the flask fungi)
  if (r2() < 0.5) out.push({ form: 'eyelash', arrive: lerp(3, 5.5, r2()) });
  if (r2() < 0.55) out.push({ form: 'flask', arrive: lerp(4.5, 7.5, r2()) });
  return out;
}

/** How each kind lives in the dung: how fast it spreads and grows, how hard it eats, what it
 * eats (sugar: quick, soon gone; fibre: tough, lasting), how it holds its ground, how long before
 * it fruits (days), how often (days), how much fruit for its mycelium. The early ones live on the
 * sugars and are done when they are; the inkcaps live on the fibre, and come into their own late. */
const LIFE: Record<Form, { spread: number; grow: number; eat: number; sugar: number; hold: number; lag: number; every: number; yield: number }> = {
  pin: { spread: 0.22, grow: 0.5, eat: 0.06, sugar: 1, hold: 0.6, lag: 1, every: 1, yield: 6 },
  thrower: { spread: 0.18, grow: 0.45, eat: 0.05, sugar: 1, hold: 0.7, lag: 1.2, every: 1, yield: 6 },
  cup: { spread: 0.12, grow: 0.32, eat: 0.03, sugar: 0.4, hold: 1, lag: 2, every: 2, yield: 0.6 },
  inkcap: { spread: 0.12, grow: 0.34, eat: 0.025, sugar: 0, hold: 1.8, lag: 2.5, every: 1, yield: 1 },
  eyelash: { spread: 0.1, grow: 0.3, eat: 0.03, sugar: 0.5, hold: 0.9, lag: 1.8, every: 3, yield: 0.5 },
  flask: { spread: 0.14, grow: 0.3, eat: 0.03, sugar: 0.3, hold: 1.1, lag: 2.2, every: 2, yield: 3 },
};

export function terrarium(seed: number): Terrarium {
  const r = seeded(hash(seed, 0x7e2));
  const who = cast(r, seeded(hash(seed, 0x7e3)));
  const n = GRID * GRID;
  const cell = SPAN / GRID;
  const at = (i: number): [number, number] => [((i % GRID) + 0.5) * cell - SPAN / 2, (Math.floor(i / GRID) + 0.5) * cell - SPAN / 2];
  // the pellet: a lumpy round of dung, wet and full; round it, bare ground
  const dung = new Float32Array(n);
  const lumps = [r(), r(), r(), r()].map((v) => v * Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const [x, z] = at(i);
    const a = Math.atan2(z, x);
    const edge = 21 * (1 + 0.12 * Math.sin(a * 2 + lumps[0]) + 0.08 * Math.sin(a * 3 + lumps[1]) + 0.05 * Math.sin(a * 5 + lumps[2]));
    dung[i] = Math.max(0, Math.min(1, (edge - Math.hypot(x, z)) / 3));
  }
  const sugar = Float32Array.from(dung, (d) => d * (0.8 + 0.2 * r()));
  const fibre = Float32Array.from(dung, (d) => d * (0.85 + 0.15 * r()));
  /** what a species finds to eat in a cell */
  const food = (i: number, j: number) => {
    const k = LIFE[sp[j].g.form].sugar;
    return sugar[i] * k + fibre[i] * (1 - k);
  };
  const water = Float32Array.from(dung, (d) => 0.35 + 0.55 * d);
  const sp: Species[] = who.map((w, i) => ({ g: species(hash(seed, 0x51, i), w.form), arrive: w.arrive, stalks: [], cups: [] }));
  // (they all lean to the one light: the terrarium's)
  for (const s of sp) s.g.light = sp[0].g.light;
  const myc = sp.map(() => new Float32Array(n));
  const ground: Uint8Array[] = [];
  const moments: Moment[] = [];
  const steps = Math.ceil((DAYS * 24) / STEP) + 1;
  const fruited = sp.map(() => -1);
  const marks: Mark[] = [];
  /** spores fired and landing: where they'll start new mycelium, and when */
  const pending: Array<{ i: number; t: number; j: number }> = [];
  for (let k = 0; k < steps; k++) {
    const T = k * STEP;
    const day = T / 24;
    const hour = (21 + T) % 24;
    const night = hour >= 21 || hour < 6;
    // water: the dung dries by day and takes up dew by night, a little drier each day; and the
    // sugars go anyway (bacteria, yeasts), if nothing here eats them first
    for (let i = 0; i < n; i++) {
      sugar[i] *= 0.985;
      water[i] = Math.max(0.1, Math.min(1, water[i] + (night ? 0.05 : -0.05) * (0.4 + dung[i]) - 0.004 * dung[i]));
    }
    // spores that have landed since the last step germinate where they fell, if it's dung
    for (let q = pending.length - 1; q >= 0; q--) {
      const pd = pending[q];
      if (pd.t > T) continue;
      if (dung[pd.i] > 0.4) myc[pd.j][pd.i] = Math.max(myc[pd.j][pd.i], 0.22);
      pending.splice(q, 1);
    }
    sp.forEach((s, j) => {
      const m = myc[j];
      const life = LIFE[s.g.form];
      // arriving: spores land and germinate here and there on the dung
      if (day >= s.arrive && day < s.arrive + STEP / 24) {
        const rr = seeded(hash(seed, 0xa11, j));
        for (let q = 0; q < 6; q++) {
          for (let t = 0; t < 30; t++) {
            const i = Math.floor(rr() * n);
            if (dung[i] > 0.6) {
              m[i] = Math.max(m[i], 0.3);
              break;
            }
          }
        }
      }
      if (day < s.arrive) return;
      // spread and grow: into the cells round it, as fast as there's food and water; where
      // another holds the ground more strongly, slower
      const next = Float32Array.from(m);
      for (let i = 0; i < n; i++) {
        const x = i % GRID;
        const z = Math.floor(i / GRID);
        let around = 0;
        let c = 0;
        if (x > 0) { around += m[i - 1]; c++; }
        if (x < GRID - 1) { around += m[i + 1]; c++; }
        if (z > 0) { around += m[i - GRID]; c++; }
        if (z < GRID - 1) { around += m[i + GRID]; c++; }
        around /= c;
        let rival = 0;
        sp.forEach((o, jj) => { if (jj !== j) rival = Math.max(rival, myc[jj][i] * LIFE[o.g.form].hold); });
        const room = Math.max(0, 1 - rival / (life.hold + rival + 1e-3) * 1.4);
        const ok = food(i, j) * water[i];
        next[i] += (life.spread * Math.max(0, around - m[i]) * dung[i] + life.grow * m[i] * (1 - m[i]) * ok) * room;
        // starved: it dies back
        if (food(i, j) < 0.12) next[i] *= 0.82;
        next[i] = Math.max(0, Math.min(1, next[i]));
      }
      m.set(next);
      for (let i = 0; i < n; i++) {
        const bite = m[i] * life.eat * (0.5 + water[i]);
        sugar[i] = Math.max(0, sugar[i] - bite * life.sugar);
        fibre[i] = Math.max(0, fibre[i] - bite * (1 - life.sugar) * 0.6);
      }
      // fruiting: once a day (or every few) after it's settled in, at nine in the evening, where it's
      // thickest and the dung still feeds it
      const lastFlush = fruited[j];
      const due = day >= s.arrive + life.lag && (lastFlush < 0 || day - lastFlush >= life.every - 1e-6) && Math.abs(hour - 21) < 1e-6;
      if (!due) return;
      fruited[j] = day;
      flush(s, j, m, T, seeded(hash(seed, 0xf1, j, k)));
    });
    // the ground, at this step: mycelium (all of it), water, food, and whose it mostly is
    const snap = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      let total = 0;
      for (const m of myc) total += m[i];
      snap[i * 4] = Math.round(Math.min(1, total) * 255);
      snap[i * 4 + 1] = Math.round(water[i] * 255);
      snap[i * 4 + 2] = Math.round((sugar[i] * 0.4 + fibre[i] * 0.6) * 255);
      snap[i * 4 + 3] = Math.round(dung[i] * 255);
    }
    ground.push(snap);
  }
  // the throwers' sporangia: each flies off toward the light and lands — mostly out on the
  // ground, now and then on something standing in the way, stuck to it (as they stick to grass
  // in a field, to be eaten with it)
  const standing = sp.flatMap((s) => s.stalks);
  sp.forEach((s, j) => {
    if (!s.g.throws) return;
    s.stalks.forEach((st, q) => {
      const rr = seeded(hash(seed, 0x1a9, j, q));
      const h = Math.hypot(st.fly[0], st.fly[2]) || 1;
      const d = lerp(4, 26, rr());
      const at: V3 = [st.base[0] + (st.fly[0] / h) * d, 0, st.base[2] + (st.fly[2] / h) * d];
      let host: Stalk | null = null;
      for (const o of standing) {
        if (o === st || o.t1 > st.tl || o.tEnd < st.tl) continue;
        // (anything standing near its line of flight, short of where it would land, and tall enough)
        const ox = o.base[0] - st.base[0];
        const oz = o.base[2] - st.base[2];
        const along = (ox * st.fly[0] + oz * st.fly[2]) / h;
        const off = Math.abs(ox * st.fly[2] - oz * st.fly[0]) / h;
        const reach = (o.bell ? o.bell * 1.1 : o.r * 3) + st.cap;
        if (along > 0 && along < d && off < reach && o.len > st.len * 0.5 && rr() < 0.55) {
          host = o;
          break;
        }
      }
      const r = st.cap * 0.9;
      if (host) {
        if (q % 5 === 0) moments.push({ T: st.tl + 1, at: [host.base[0], host.len * 0.8, host.base[2]], size: host.len * 0.8 + (host.bell || 0) * 2, kind: 'stuck', who: sp.indexOf(sp.find((x) => x.stalks.includes(host!))!) });
        marks.push({ p: at, r, c: s.g.capColour, t0: st.tl + 0.08, t1: host.tEnd - 1, ground: false, kind: 'cap', on: { st: host, s: host.bell ? 1 : lerp(0.5, 0.95, rr()), a: rr() * Math.PI * 2 } });
      } else marks.push({ p: at, r, c: s.g.capColour, t0: st.tl + 0.08, t1: st.tl + lerp(48, 120, rr()), ground: true, kind: 'cap' });
    });
  });
  return { species: sp, ground, moments, dung, marks };

  /** A flush of one species' fruit: as many as its mycelium can feed, where it's thickest. */
  function flush(s: Species, j: number, m: Float32Array, T: number, rr: Rand) {
    let weight = 0;
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = m[i] > 0.35 ? Math.pow(m[i], 3) * food(i, j) * water[i] : 0;
      weight += w[i];
    }
    if (weight <= 0) return;
    const pick = () => {
      let t = rr() * weight;
      for (let i = 0; i < n; i++) if ((t -= w[i]) <= 0) return i;
      return n - 1;
    };
    const place = (i: number): V3 => {
      const [x, z] = at(i);
      return [x + (rr() - 0.5) * cell, 0, z + (rr() - 0.5) * cell];
    };
    const g = s.g;
    if (g.form === 'cup') {
      const count = Math.min(5, Math.round(weight * LIFE.cup.yield));
      for (let q = 0; q < count; q++) {
        const c = place(pick());
        if (s.cups.some((o) => o.tEnd > T && Math.hypot(o.c[0] - c[0], o.c[2] - c[2]) < (o.R + g.cushion) * 1.1)) continue;
        const cu = makeCushion(rr, g, c, T + rr() * 6, lerp(40, 80, rr()));
        s.cups.push(cu);
        // each ascus's spores fly off as one and land a little way off, where (if it's dung, and
        // not too dry) they start the species again
        for (const a of cu.asci) {
          const ang = rr() * Math.PI * 2;
          const d = lerp(2, 16, Math.sqrt(rr()));
          const pt: V3 = [c[0] + Math.cos(ang) * d, 0, c[2] + Math.sin(ang) * d];
          marks.push({ p: pt, r: a.r * 1.5, c: g.spore, t0: a.tl + 0.05, t1: a.tl + 40 + rr() * 30, ground: true, kind: 'spores' });
          const gx = Math.floor((pt[0] + SPAN / 2) / cell);
          const gz = Math.floor((pt[2] + SPAN / 2) / cell);
          if (gx >= 0 && gz >= 0 && gx < GRID && gz < GRID && rr() < 0.35) pending.push({ i: gz * GRID + gx, t: a.tl + 18, j });
        }
        // (its asci fire in waves: watch the busiest stretch)
        const fires = cu.asci.map((a) => a.tl).sort((a, b) => a - b);
        moments.push({ T: fires[Math.floor(fires.length / 2)] ?? cu.t0 + 8, at: [c[0], cu.Hc * 0.8, c[2]], size: cu.R * 4, kind: 'fire', who: j });
      }
      return;
    }
    const max = g.form === 'inkcap' ? 22 : g.form === 'eyelash' ? 8 : 70;
    const count = Math.min(max, Math.round(weight * LIFE[g.form].yield));
    // (in clumps: a flush comes up from a few places where the mycelium has gathered)
    const per = g.form === 'inkcap' ? 6 : g.form === 'eyelash' ? 3 : 14;
    const clumps = Array.from({ length: Math.max(1, Math.round(count / per)) }, () => place(pick()));
    let first: Stalk | null = null;
    for (let q = 0; q < count; q++) {
      const cl = clumps[q % clumps.length];
      const d = Math.sqrt(rr()) * (g.form === 'inkcap' || g.form === 'eyelash' ? 4 : g.form === 'flask' ? 2 : 3);
      const a = rr() * Math.PI * 2;
      const st = makeStalk(rr, g, [cl[0] + Math.cos(a) * d, 0, cl[2] + Math.sin(a) * d], T);
      s.stalks.push(st);
      first = first ?? st;
      if (g.throws && q % 6 === 0) moments.push({ T: st.tl, at: [st.base[0], st.len * 0.9, st.base[2]], size: st.len * 1.2, kind: 'throw', who: j });
    }
    if (first) {
      const k = g.form === 'inkcap' ? (rr() < 0.5 ? 'open' : 'ink') : g.form === 'flask' ? 'squirt' : 'emerge';
      const t = k === 'open' ? first.t1 : k === 'ink' ? first.t1 + 6.5 : k === 'squirt' ? first.t1 + 4 : first.t1 - 0.4;
      moments.push({ T: t, at: [first.base[0], first.len * 0.6, first.base[2]], size: first.len * 1.4 + (first.bell || 0) * 2, kind: k, who: j });
    }
  }
}
