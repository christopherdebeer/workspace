/**
 * Air and light over the river: a slow day that turns through golden hour to
 * dusk and a moonlit blue and back, fireflies that come out as it darkens,
 * pollen on the surface, silt suspended in the water column — all carried by
 * the current and pushed about by a touch's breath of wind.
 *
 * DEPTH. Everything here has a height relative to the surface, and parallax
 * follows it (see `parallax`): fireflies above the water slide faster than the
 * pads as the boat moves, silt below slower. That difference, more than any
 * shading, is what reads as depth on a top-down view.
 */
import type { Light, Mote } from './render';

/** How much smaller a thing looks per unit of depth below the surface (negative depth = above). */
export const DEPTH_K = 0.12;
export const parallax = (depth: number) => 1 / (1 + DEPTH_K * depth);

export interface Sky extends Light {
  /** 0 day … 1 night: fireflies, lantern, mist all follow it. */
  dusk: number;
  mist: number;
  mistCol: [number, number, number];
}

type V3 = [number, number, number];
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Key moments of the day; `skyAt` blends between neighbours. */
const KEYS: Array<{ at: number; sunEl: number; sunCol: V3; amb: V3; sky0: V3; sky1: V3; mist: number; mistCol: V3; dusk: number }> = [
  { at: 0.0, sunEl: 0.8, sunCol: [1.02, 0.95, 0.82], amb: [0.27, 0.36, 0.35], sky0: [0.42, 0.55, 0.52], sky1: [0.82, 0.88, 0.82], mist: 0.04, mistCol: [0.75, 0.82, 0.78], dusk: 0 },
  { at: 0.3, sunEl: 0.55, sunCol: [1.1, 0.84, 0.58], amb: [0.3, 0.32, 0.3], sky0: [0.55, 0.5, 0.42], sky1: [0.98, 0.84, 0.62], mist: 0.1, mistCol: [0.95, 0.8, 0.6], dusk: 0.15 },
  { at: 0.48, sunEl: 0.32, sunCol: [0.95, 0.55, 0.38], amb: [0.2, 0.22, 0.3], sky0: [0.35, 0.3, 0.42], sky1: [0.85, 0.55, 0.5], mist: 0.22, mistCol: [0.7, 0.55, 0.62], dusk: 0.6 },
  { at: 0.62, sunEl: 0.7, sunCol: [0.36, 0.44, 0.62], amb: [0.1, 0.14, 0.21], sky0: [0.1, 0.14, 0.24], sky1: [0.3, 0.36, 0.52], mist: 0.14, mistCol: [0.35, 0.42, 0.55], dusk: 1 },
  { at: 0.8, sunEl: 0.7, sunCol: [0.36, 0.44, 0.62], amb: [0.1, 0.14, 0.21], sky0: [0.1, 0.14, 0.24], sky1: [0.3, 0.36, 0.52], mist: 0.18, mistCol: [0.35, 0.42, 0.55], dusk: 1 },
  { at: 0.9, sunEl: 0.35, sunCol: [1.0, 0.7, 0.62], amb: [0.22, 0.24, 0.32], sky0: [0.42, 0.4, 0.5], sky1: [0.95, 0.75, 0.72], mist: 0.3, mistCol: [0.9, 0.78, 0.8], dusk: 0.4 },
  { at: 1.0, sunEl: 0.8, sunCol: [1.02, 0.95, 0.82], amb: [0.27, 0.36, 0.35], sky0: [0.42, 0.55, 0.52], sky1: [0.82, 0.88, 0.82], mist: 0.04, mistCol: [0.75, 0.82, 0.78], dusk: 0 },
];

/** A whole day in this many seconds. */
export const DAY = 900;

export function skyAt(phase: number): Sky {
  const ph = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].at <= ph) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(0, 1, (ph - a.at) / (b.at - a.at));
  const el = a.sunEl + (b.sunEl - a.sunEl) * t;
  // the sun (or moon) swings across from the upper left
  const az = 2.35 + Math.sin(ph * Math.PI * 2) * 0.35;
  const sun: V3 = [-Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
  return {
    sun,
    sunCol: mix3(a.sunCol, b.sunCol, t),
    amb: mix3(a.amb, b.amb, t),
    sky0: mix3(a.sky0, b.sky0, t),
    sky1: mix3(a.sky1, b.sky1, t),
    mist: a.mist + (b.mist - a.mist) * t,
    mistCol: mix3(a.mistCol, b.mistCol, t),
    dusk: a.dusk + (b.dusk - a.dusk) * t,
  };
}

interface Fly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Height above the water (world units of depth, 0.3…1.6). */
  h: number;
  phase: number;
  rate: number;
  /** Where it's darting now, and when it next changes its mind. */
  tx: number;
  ty: number;
  next: number;
}

interface Speck {
  x: number;
  y: number;
  /** Depth below the surface (0 = on it). */
  d: number;
  p: number;
  s: number;
}

export interface Field {
  x: number;
  y: number;
  hw: number;
  hh: number;
  flow: (x: number, y: number) => [number, number];
  wind: (x: number, y: number) => [number, number];
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Atmosphere {
  private flies: Fly[] = [];
  private pollen: Speck[] = [];
  private silt: Speck[] = [];

  constructor(private count: { flies: number; pollen: number; silt: number }) {}

  private seed(f: Field) {
    const at = (): [number, number] => [f.x + rnd(-f.hw, f.hw) * 1.2, f.y + rnd(-f.hh, f.hh) * 1.2];
    while (this.flies.length < this.count.flies) {
      const [x, y] = at();
      this.flies.push({ x, y, vx: 0, vy: 0, h: rnd(0.3, 1.6), phase: rnd(0, 20), rate: rnd(0.5, 1.2), tx: 0, ty: 0, next: 0 });
    }
    while (this.pollen.length < this.count.pollen) {
      const [x, y] = at();
      this.pollen.push({ x, y, d: 0, p: rnd(0, 10), s: rnd(1.4, 3.2) });
    }
    while (this.silt.length < this.count.silt) {
      const [x, y] = at();
      this.silt.push({ x, y, d: rnd(0.15, 1.1), p: rnd(0, 10), s: rnd(1.2, 2.6) });
    }
  }

  /** Keep a particle within the view (plus margin) by wrapping it across. */
  private wrap(p: { x: number; y: number }, f: Field, margin: number) {
    const w = (f.hw + margin) * 2;
    const h = (f.hh + margin) * 2;
    if (p.x < f.x - w / 2) p.x += w;
    else if (p.x > f.x + w / 2) p.x -= w;
    if (p.y < f.y - h / 2) p.y += h;
    else if (p.y > f.y + h / 2) p.y -= h;
  }

  shift(dy: number) {
    for (const list of [this.flies, this.pollen, this.silt]) for (const p of list) p.y -= dy;
  }

  /** The firefly that is out and nearest a world point, if one is within `r`. */
  nearestFly(x: number, y: number, r: number, dusk: number): { x: number; y: number; index: number } | null {
    const out = 0.12 + 0.88 * dusk;
    let best = -1;
    let bd = r;
    this.flies.forEach((fl, i) => {
      if (i / this.flies.length > out) return;
      const d = Math.hypot(fl.x - x, fl.y - y);
      if (d < bd) { bd = d; best = i; }
    });
    return best < 0 ? null : { x: this.flies[best].x, y: this.flies[best].y, index: best };
  }

  /** Noticed: it flashes once and darts. */
  wink(index: number, t: number) {
    const fl = this.flies[index];
    if (!fl) return;
    fl.phase = (2.2 - ((t * fl.rate) % 2.2)) % 2.2; // so the flash lands at cycle start
    const a = Math.random() * Math.PI * 2;
    fl.tx = Math.cos(a) * 70;
    fl.ty = Math.sin(a) * 70;
    fl.next = t + 0.5;
  }

  /** Advance and emit: `above` for the final pass, `below` for the underwater pass. */
  step(dt: number, t: number, f: Field, sky: Sky): { above: Mote[]; below: Mote[] } {
    this.seed(f);
    const above: Mote[] = [];
    const below: Mote[] = [];

    for (const p of this.pollen) {
      const [fx, fy] = f.flow(p.x, p.y);
      const [wx, wy] = f.wind(p.x, p.y);
      p.x += (fx + wx * 0.5) * dt;
      p.y += (fy + wy * 0.5) * dt;
      p.p += dt;
      this.wrap(p, f, 40);
      const tw = 0.08 + 0.18 * Math.max(0, Math.sin(p.p * 0.6));
      above.push({ x: p.x, y: p.y, size: p.s * 3, r: 1, g: 0.95, b: 0.75, a: tw * (1 - sky.dusk * 0.6), core: 0.4, z: 1 });
    }

    for (const p of this.silt) {
      const [fx, fy] = f.flow(p.x, p.y);
      p.x += fx * (1 - p.d * 0.4) * dt + Math.sin(t * 0.3 + p.p) * 1.5 * dt;
      p.y += fy * (1 - p.d * 0.4) * dt;
      this.wrap(p, f, 80);
      const tw = 0.06 + 0.08 * Math.max(0, Math.sin(t * 0.4 + p.p));
      below.push({ x: p.x, y: p.y, size: p.s * 2.4, r: 0.75, g: 0.85, b: 0.65, a: tw, core: 0.2, z: parallax(p.d) });
    }

    // fireflies: out at dusk, a few lingering by day. Small and busy — they dart,
    // hang, dart again — and each flashes briefly on its own rhythm (sometimes twice)
    const out = 0.12 + 0.88 * sky.dusk;
    for (let i = 0; i < this.flies.length; i++) {
      const fl = this.flies[i];
      if (t >= fl.next) {
        const hover = Math.random() < 0.3;
        const a = Math.random() * Math.PI * 2;
        const sp = hover ? rnd(0, 6) : rnd(25, 65);
        fl.tx = Math.cos(a) * sp;
        fl.ty = Math.sin(a) * sp;
        fl.next = t + (hover ? rnd(0.4, 1.2) : rnd(0.15, 0.6));
      }
      const [wx, wy] = f.wind(fl.x, fl.y);
      const k = 1 - Math.exp(-7 * dt);
      fl.vx += (fl.tx - fl.vx) * k + (wx * 1.4 + Math.sin(t * 13 + fl.phase * 7) * 30) * dt;
      fl.vy += (fl.ty - fl.vy) * k + (wy * 1.4 + Math.cos(t * 11 + fl.phase * 5) * 30) * dt;
      fl.x += fl.vx * dt;
      fl.y += fl.vy * dt;
      fl.h = Math.max(0.2, Math.min(1.8, fl.h + Math.sin(t * 1.3 + fl.phase) * 0.3 * dt));
      this.wrap(fl, f, 60);
      if (i / this.flies.length > out) continue;
      const cyc = (t * fl.rate + fl.phase) % 2.2;
      const flash = Math.exp(-Math.pow((cyc - 0.2) * 9, 2)) + (fl.phase % 1 > 0.6 ? Math.exp(-Math.pow((cyc - 0.55) * 9, 2)) * 0.7 : 0);
      const glow = (0.18 + 0.82 * flash) * (0.35 + 0.65 * sky.dusk);
      const par = 1 / (1 - DEPTH_K * fl.h * 0.8);
      above.push({ x: fl.x, y: fl.y, size: 2.6 + 6 * flash, r: 1, g: 0.95, b: 0.55, a: glow, core: 1, z: par });
      // its light on the water below: softer, dimmer, at the surface
      if (flash > 0.05) above.push({ x: fl.x, y: fl.y, size: 10 + 12 * flash, r: 0.9, g: 0.85, b: 0.45, a: glow * 0.14, core: 0, z: 1 });
    }
    return { above, below };
  }
}
