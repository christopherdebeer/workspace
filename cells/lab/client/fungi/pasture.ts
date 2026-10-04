/**
 * A pasture: the terrariums out in a field, and the field's own time.
 *
 * Time doesn't start from zero. The world's hour is the real one: arrive in the evening and
 * it's evening in the field. The pats are of every age: one dropped last night, one a week in
 * with its cups firing, one at three weeks inking, old ones crusted and going back to grass.
 * Cows keep coming. The field is tiled, and each tile has a few spots where, on a cycle of its
 * own, a pat is dropped (always at nine in the evening: the terrarium's hour nought). So which
 * pat is where, and how old, is a function of the seed and the hour alone — the same for anyone
 * looking at the same moment, and nothing needs to have been simulated before it.
 *
 * Each pat is a terrarium (its fungi, its animals), simulated from its own seed when it comes
 * near, and moved into place and time: its things to where it lies, its hours to when it fell.
 */
import { hash, seeded } from '../kit/rng';
import type { V3 } from './genome';
import { critters, type Critters } from './critters';
import { DAYS, terrarium, type Terrarium } from './terrarium';

/** how long a pat's fungi run (h), and when it's gone back to grass (h) */
export const PAT_LIFE = DAYS * 24 + 2;
export const PAT_GONE = 55 * 24;
/** a tile of the field (mm) */
export const TILE = 180;
/** (the epoch: a local midnight, in hours) */
const EPOCH_H = Date.UTC(2026, 0, 1) / 3.6e6;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The world's hour now: from the real clock, so that (T + 21) % 24 is the local hour. */
export function worldNow(now = new Date()): number {
  const local = now.getTime() - now.getTimezoneOffset() * 60000;
  return local / 3.6e6 - EPOCH_H - 21;
}
/** The world's date at hour T (read it with getUTC…: it's already local). */
export function dateOf(T: number): Date {
  return new Date((T + 21 + EPOCH_H) * 3.6e6);
}

/** A pat: its seed, where it lies, when it fell (the world's hour). */
export interface Drop {
  seed: number;
  x: number;
  z: number;
  drop: number;
}

/** A tile's spots: where pats come, each on its cycle (days) from its phase (days). */
function spots(world: number, tx: number, tz: number) {
  const r = seeded(hash(world, 0x9a5, tx + 10000, tz + 10000));
  const out: Array<{ x: number; z: number; period: number; phase: number; k: number }> = [];
  for (let k = 0; k < 6 && out.length < 3; k++) {
    const x = tx * TILE + lerp(35, TILE - 35, r());
    const z = tz * TILE + lerp(35, TILE - 35, r());
    const period = Math.round(lerp(62, 95, r()));
    const phase = Math.floor(r() * period);
    if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 80)) continue;
    out.push({ x, z, period, phase, k });
  }
  return out;
}

/** The pats lying within `reach` of (cx, cz) at hour T — and any falling in the next day. */
export function dropsNear(world: number, cx: number, cz: number, T: number, reach: number): Drop[] {
  const out: Drop[] = [];
  const day = Math.floor(T / 24);
  for (let tx = Math.floor((cx - reach) / TILE); tx <= Math.floor((cx + reach) / TILE); tx++) {
    for (let tz = Math.floor((cz - reach) / TILE); tz <= Math.floor((cz + reach) / TILE); tz++) {
      for (const s of spots(world, tx, tz)) {
        const c0 = Math.floor((day + s.phase) / s.period);
        const c1 = Math.floor((day + 1 + s.phase) / s.period);
        for (const c of c1 === c0 ? [c0] : [c0, c1]) {
          const d = c * s.period - s.phase;
          const drop = d * 24;
          if (T - drop > PAT_GONE || drop > T + 24) continue;
          // (never quite the same spot twice)
          const j = seeded(hash(world, 0x77, s.k, c + 100000, tx + 10000, tz + 10000));
          const x = s.x + (j() - 0.5) * 30;
          const z = s.z + (j() - 0.5) * 30;
          if (Math.hypot(x - cx, z - cz) > reach) continue;
          out.push({ seed: (hash(world, s.k, c + 100000, tx + 10000, tz + 10000) % 900000) + 1, x, z, drop });
        }
      }
    }
  }
  return out;
}

/** How high a pat stands (mm) at its age (h): fresh and full through its fungi's run, then
 *  drying, crusting, flattening, gone back into the grass. */
export function patHeight(age: number) {
  if (age < 0 || age > PAT_GONE) return 0;
  const k = Math.max(0, Math.min(1, (age - PAT_LIFE) / (PAT_GONE - PAT_LIFE)));
  return 3.2 * (1 - k * k * (3 - 2 * k));
}
/** A pat, simulated and moved into place and time. */
export interface Placed extends Drop {
  terr: Terrarium;
  crit: Critters;
}
export function place(d: Drop, light?: V3): Placed {
  const terr = terrarium(d.seed, light);
  const crit = critters(d.seed, terr);
  shiftTerr(terr, d.x, d.z, d.drop);
  shiftCrit(crit, d.x, d.z, d.drop);
  return { ...d, terr, crit };
}

const NEVER = 1e8;
const tShift = (t: number, dt: number) => (t >= NEVER ? t : t + dt);
const pShift = (p: V3, dx: number, dz: number) => {
  p[0] += dx;
  p[2] += dz;
};
/** Move a terrarium's things by (dx, dz) and its hours by dt. */
export function shiftTerr(t: Terrarium, dx: number, dz: number, dt: number) {
  for (const sp of t.species) {
    for (const st of sp.stalks) {
      pShift(st.base, dx, dz);
      st.t0 += dt;
      st.t1 += dt;
      st.tv += dt;
      st.tl = tShift(st.tl, dt);
      st.tEnd = tShift(st.tEnd, dt);
      for (const w of st.dew) w.t += dt;
    }
    for (const c of sp.cups) {
      pShift(c.c, dx, dz);
      c.t0 += dt;
      c.tEnd = tShift(c.tEnd, dt);
      for (const a of c.asci) {
        a.t0 += dt;
        a.tr += dt;
        a.tl += dt;
      }
      for (const w of c.dew) w.t += dt;
    }
  }
  for (const m of t.marks) {
    // (held marks ride their host, already moved; their p is only a fallback)
    pShift(m.p, dx, dz);
    m.t0 += dt;
    m.t1 = tShift(m.t1, dt);
  }
  for (const m of t.moments) {
    m.T += dt;
    m.at = [m.at[0] + dx, m.at[1], m.at[2] + dz];
  }
}
/** Move a terrarium's animals the same. (A climber's `at` is its stalk's base: already moved.) */
export function shiftCrit(c: Critters, dx: number, dz: number, dt: number) {
  for (const w of c.worms) {
    if (!w.on) pShift(w.at, dx, dz);
    else w.on.from += dt;
    w.t0 += dt;
    w.t1 = tShift(w.t1, dt);
    if (w.caught) w.caught.T += dt;
  }
  for (const t of c.traps) {
    pShift(t.p, dx, dz);
    t.t0 += dt;
    t.t1 += dt;
  }
  for (const m of [...c.mites, ...c.springs]) {
    pShift(m.home, dx, dz);
    m.t0 += dt;
    m.t1 = tShift(m.t1, dt);
  }
  for (const m of c.moments) {
    m.T += dt;
    m.at = [m.at[0] + dx, m.at[1], m.at[2] + dz];
  }
}
