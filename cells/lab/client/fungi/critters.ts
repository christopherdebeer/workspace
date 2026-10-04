/**
 * The small animals of the dung: what lives with the fungi, and off them.
 *
 * Nematodes — eelworms, glassy and less than a millimetre — writhe in the wet dung. Some climb the
 * hat-throwers' stalks and wait on the sporangium (as lungworm larvae do on Pilobolus), to be
 * thrown with it, out into the grass, to be eaten with it by the next cow. Mites graze the fruit
 * and the mycelium, walking from one to the next; springtails sit, then spring.
 *
 * Where they are (and when) is from the seed and the terrarium's time, so a scrub lands on the
 * same animals in the same places; how they move — the gait, the wriggle, the spring — is in real
 * time, as they'd look under a lens while the hours went by around them.
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
  on?: { st: Stalk; from: number };
}
interface Mite {
  home: V3;
  roam: number;
  t0: number;
  t1: number;
  size: number;
  colour: V3;
  seed: number;
}
interface Spring {
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
  moments: Moment[];
}

/** (a nematode: clear, a little milky, lit through) */
const WORM: V3 = [0.78, 0.76, 0.66];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** (a smooth wander, -1..1: a few sines out of step) */
const wob = (t: number, s: number) => (Math.sin(t * 1.3 + s) + Math.sin(t * 0.71 + s * 2.3) * 0.7 + Math.sin(t * 0.37 + s * 4.1) * 0.5) / 2.2;

/** The animals of a terrarium: who, where and when. */
export function critters(seed: number, terr: Terrarium): Critters {
  const r = seeded(hash(seed, 0xc417));
  const worms: Worm[] = [];
  const mites: Mite[] = [];
  const springs: Spring[] = [];
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
            worms.push({ at, t0: st.t0 - lerp(0, 12, r()), t1: st.tEnd + lerp(0, 24, r()), len: lerp(0.45, 0.8, r()), r: lerp(0.014, 0.02, r()), seed: r() * 100 });
          }
        }
        if (q % 7 === 3) {
          // a climber: up the stalk as it ripens, onto the sporangium, and off with it
          const from = lerp(st.t1, st.tv || st.t1 + 2, r());
          worms.push({ at: st.base, t0: from - 2, t1: st.tl, len: lerp(0.45, 0.7, r()), r: lerp(0.016, 0.02, r()), seed: r() * 100, on: { st, from } });
          if (q % 21 === 3) moments.push({ T: st.tl - 0.8, at: [st.base[0], st.len * 0.85, st.base[2]], size: st.len * 0.5, kind: 'ride', who: j });
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
        if (r() < 0.6) mites.push({ home, roam: lerp(1, 2.5, r()), t0, t1, size: lerp(0.13, 0.22, r()), colour: r() < 0.7 ? [0.32, 0.16, 0.07] : [0.62, 0.42, 0.22], seed: r() * 100 });
        else springs.push({ home, roam: lerp(3, 7, r()), t0, t1, size: lerp(0.22, 0.36, r()), colour: r() < 0.6 ? [0.34, 0.37, 0.44] : [0.5, 0.46, 0.4], seed: r() * 100 });
      }
    }
    for (const c of cupClumps) {
      const a = r() * Math.PI * 2;
      const home: V3 = [c.c[0] + Math.cos(a) * c.R * 2, 0, c.c[2] + Math.sin(a) * c.R * 2];
      mites.push({ home, roam: 2, t0: c.t0 + 8, t1: Math.min(end, c.tEnd + 12), size: lerp(0.12, 0.18, r()), colour: [0.36, 0.18, 0.08], seed: r() * 100 });
    }
  });
  // (now and then the camera goes down to them)
  [...mites, ...springs].forEach((m, q) => {
    if (q % 4 === 0 && m.t1 - m.t0 > 8) moments.push({ T: m.t0 + 4, at: [m.home[0], 0.3, m.home[2]], size: 1.4, kind: 'graze', who: -1 });
  });
  return { worms, mites, springs, moments };
}

type Ground = (x: number, z: number) => number;

/** Push them into the frame's list: bodies and legs as spheres, nematodes as beads lit through. */
export function drawCritters(c: Critters, T: number, time: number, groundY: Ground, solid: number[]) {
  for (const w of c.worms) {
    if (T < w.t0 || T > w.t1) continue;
    const come = ease((T - w.t0) / 1.5) * ease((w.t1 - T) / 1.5);
    if (come <= 0.01) continue;
    const n = Math.max(6, Math.round(w.len / (w.r * 0.75)));
    if (w.on) {
      // climbing: head up, along the stalk; on the sporangium at the last, curled round its top
      const st = w.on.st;
      const s = state(st, T);
      if (s.thrown >= 0 || s.grown < 0.3) continue;
      const climb = ease((T - w.on.from) / Math.max(0.5, st.tl - 0.6 - w.on.from));
      const L = st.len * s.grown;
      for (let k = 0; k < n; k++) {
        const f = k / (n - 1);
        const u = Math.min(0.995, Math.max(0.01, climb * 0.98 - (f * w.len) / L));
        const at = along(st, s, u);
        const sway = Math.sin(time * 3 + w.seed + f * 5) * (0.4 + f * 0.8);
        const a = w.seed + sway * 0.6 + f * 0.4;
        const side = sideOf(at.t, a);
        const off = at.r + w.r * 0.8;
        const rr = w.r * (1 - 0.5 * Math.pow(Math.abs(f - 0.35) / 0.65, 2)) * come;
        solid.push(at.p[0] + side[0] * off, at.p[1] + side[1] * off, at.p[2] + side[2] * off, rr, rr, rr, ...WORM, 1);
      }
      continue;
    }
    // on the ground: a slow drift, and a wave down the body — head searching, raised now and then
    const drift = T * 0.25;
    const cx = w.at[0] + wob(drift, w.seed) * 1.2;
    const cz = w.at[2] + wob(drift, w.seed + 9) * 1.2;
    const head = w.seed + wob(drift * 0.7, w.seed + 3) * 3;
    const hx = Math.cos(head);
    const hz = Math.sin(head);
    const ph = time * (2 + (w.seed % 1.3));
    const lift = Math.max(0, Math.sin(time * 0.7 + w.seed)) * 0.8;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const along_ = (0.5 - f) * w.len;
      const lat = Math.sin(f * Math.PI * 2.2 - ph) * w.len * 0.13 * (0.4 + f);
      const x = cx + hx * along_ - hz * lat;
      const z = cz + hz * along_ + hx * lat;
      const up = lift * Math.max(0, 0.35 - f) * w.len * 0.9;
      const rr = w.r * (1 - 0.55 * Math.pow(Math.abs(f - 0.4) / 0.6, 2)) * come;
      solid.push(x, groundY(x, z) + rr * 0.6 + up, z, rr, rr, rr, ...WORM, 1);
    }
  }
  for (const m of c.mites) {
    if (T < m.t0 || T > m.t1) continue;
    const come = ease((T - m.t0) / 2) * ease((m.t1 - T) / 2);
    if (come < 0.05) continue;
    // a walk round its home, now stopping to graze, now going on; legs in two tripods of four
    const pace = time * 0.35 + m.seed;
    const go = 0.5 + 0.5 * Math.sin(time * 0.4 + m.seed * 3);
    const tt = pace + Math.sin(pace * 0.5) * 0.3;
    const x = m.home[0] + wob(tt * go + T * 0.05, m.seed) * m.roam;
    const z = m.home[2] + wob(tt * go + T * 0.05, m.seed + 5) * m.roam;
    const dx = wob(tt * go + 0.05 + T * 0.05, m.seed) * m.roam - (x - m.home[0]);
    const dz = wob(tt * go + 0.05 + T * 0.05, m.seed + 5) * m.roam - (z - m.home[2]);
    const hd = Math.atan2(dz, dx) || m.seed;
    const s = m.size * come;
    const y = groundY(x, z) + s * 0.9;
    const fx = Math.cos(hd);
    const fz = Math.sin(hd);
    // body: a glossy egg, a smaller head in front
    solid.push(x, y, z, s, s * 0.8, s, ...m.colour, 0);
    solid.push(x + fx * s * 1.05, y - s * 0.15, z + fz * s * 1.05, s * 0.4, s * 0.35, s * 0.4, ...m.colour, 0);
    const step = time * 9 * go;
    for (let k = 0; k < 8; k++) {
      const side = k < 4 ? 1 : -1;
      const i = k % 4;
      const a0 = hd + side * (0.55 + i * 0.62);
      const swing = Math.sin(step + (i % 2) * Math.PI + (side > 0 ? 0 : Math.PI)) * 0.25 * go;
      const a = a0 + swing;
      const reach = s * (i === 0 ? 2.8 : 2.3);
      // a leg: out and up to its knee, then down to the ground — a few beads
      for (let b = 1; b <= 7; b++) {
        const f = b / 7;
        const lx = x + Math.cos(a) * (s * 0.6 + reach * f);
        const lz = z + Math.sin(a) * (s * 0.6 + reach * f);
        const gy = groundY(lx, lz);
        const ly = lerp(y, gy, f * f) + Math.sin(f * Math.PI) * s * 0.9;
        const lr = s * 0.14 * (1 - f * 0.4);
        solid.push(lx, ly, lz, lr, lr, lr, m.colour[0] * 1.3, m.colour[1] * 1.3, m.colour[2] * 1.3, 0);
      }
    }
  }
  for (const sp of c.springs) {
    if (T < sp.t0 || T > sp.t1) continue;
    const come = ease((sp.t1 - T) / 2) * ease((T - sp.t0) / 2);
    if (come < 0.05) continue;
    // sitting, then — the furca let go — a spring to somewhere else near
    const period = 3.5 + (sp.seed % 2.5);
    const n = Math.floor((time + sp.seed) / period);
    const f = (time + sp.seed) / period - n;
    const spot = (k: number): V3 => {
      const q = seeded(hash(Math.floor(sp.seed * 1000), k));
      const a = q() * Math.PI * 2;
      const d = Math.sqrt(q()) * sp.roam;
      return [sp.home[0] + Math.cos(a) * d, q() * Math.PI * 2, sp.home[2] + Math.sin(a) * d];
    };
    const A = spot(n);
    const B = spot(n + 1);
    const hop = ease((f - 0.9) / 0.1);
    const x = lerp(A[0], B[0], hop);
    const z = lerp(A[2], B[2], hop);
    const hd = hop > 0 ? A[1] + hop * 4 : A[1];
    const s = sp.size * come;
    const y = groundY(x, z) + s * 0.35 + Math.sin(hop * Math.PI) * Math.hypot(B[0] - A[0], B[2] - A[2]) * 0.5;
    const fx = Math.cos(hd);
    const fz = Math.sin(hd);
    // a long soft body (four segments, tapering), a round head, two antennae feeling ahead
    for (let k = 0; k < 4; k++) {
      const o = (0.4 - k * 0.42) * s * 2;
      const rk = s * (0.42 - k * 0.05);
      solid.push(x + fx * o, y + rk * 0.1, z + fz * o, rk, rk * 0.85, rk, ...sp.colour, 3);
    }
    const hx = x + fx * s * 1.45;
    const hz = z + fz * s * 1.45;
    solid.push(hx, y + s * 0.05, hz, s * 0.34, s * 0.3, s * 0.34, sp.colour[0] * 0.8, sp.colour[1] * 0.8, sp.colour[2] * 0.85, 0);
    for (const side of [-1, 1]) {
      const a = hd + side * (0.45 + Math.sin(time * 2.3 + sp.seed + side) * 0.15);
      for (let b = 1; b <= 6; b++) {
        const f = b / 6;
        const d = s * (0.25 + f * 1.4);
        solid.push(hx + Math.cos(a) * d, y + s * 0.1 + Math.sin(f * 2.4) * s * 0.35, hz + Math.sin(a) * d, s * 0.06, s * 0.06, s * 0.06, ...sp.colour, 0);
      }
    }
  }
}

/** (a direction round a tangent, any frame will do) */
function sideOf(t: V3, a: number): V3 {
  const ref: V3 = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let x: V3 = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
  const l = Math.hypot(...x) || 1;
  x = [x[0] / l, x[1] / l, x[2] / l];
  const y: V3 = [t[1] * x[2] - t[2] * x[1], t[2] * x[0] - t[0] * x[2], t[0] * x[1] - t[1] * x[0]];
  return [x[0] * Math.cos(a) + y[0] * Math.sin(a), x[1] * Math.cos(a) + y[1] * Math.sin(a), x[2] * Math.cos(a) + y[2] * Math.sin(a)];
}
