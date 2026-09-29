/**
 * Dragonflies and butterflies: the river's larger, steadier insects. Where the
 * fireflies are points of light that come and go, these are *creatures* — a
 * body with wings, a way of flying, places they like to land — and they carry
 * on by day when the fireflies are all but gone.
 *
 * A dragonfly hunts: long straight dashes at speed, a dead stop and a hover,
 * a turn on the spot, another dash; it perches on the rim of a leaf or a bud
 * with its wings flat, and it is curious about the boat, hanging over the bow.
 * A butterfly flutters: a wandering, bobbing flight with the wings beating
 * slowly, drawn to open flowers where it settles and lazily opens and closes
 * its wings, and now and then it rides on the boat for a while. A touch's wind
 * flushes either. Butterflies roost at dusk; dragonflies fly on into it.
 *
 * Everything is above the water, so parallax lifts them (see `atmosphere.ts`).
 */
import type { Field, Sky } from './atmosphere';
import type { Bloom, Pad } from './world';

export interface Critter {
  x: number;
  y: number;
  heading: number;
  /** Half-extent of the sprite, world units. */
  size: number;
  /** 0 dragonfly · 1 tortoiseshell · 2 cabbage white · 3 common blue · 4 brimstone. */
  kind: number;
  /** Dragonfly: wing blur 0 still … 1 beating. Butterfly: 0 wings flat … 1 closed over the back. */
  wing: number;
  /** Height above the water, in depth units (parallax lifts it). */
  h: number;
  seed: number;
  alpha: number;
  /** Turn rate, for the wings to bank into (butterflies). */
  turn: number;
}

type Perch = { kind: 'pad'; pad: Pad; a: number } | { kind: 'bloom'; bloom: Bloom } | { kind: 'boat'; lx: number; ly: number } | null;

interface Bug {
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  kind: number;
  seed: number;
  size: number;
  /** What it is doing, and until when. */
  mode: 'fly' | 'hover' | 'perch';
  until: number;
  tx: number;
  ty: number;
  perch: Perch;
  /** Wing beat phase (butterfly) / hover jitter phase (dragonfly). */
  phase: number;
  wing: number;
  h: number;
  /** Where it means to be, height-wise, and how fast it is climbing or sinking. */
  th: number;
  vh: number;
  turn: number;
  alpha: number;
}

export interface Scene {
  pads: Pad[];
  blooms: Bloom[];
  /** World position of a point in the boat's frame (x across, y along, bow +). */
  boatAt: (lx: number, ly: number) => [number, number];
  boatHeading: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Critters {
  private bugs: Bug[] = [];

  constructor(private count: { dragonflies: number; butterflies: number }) {}

  private seed(f: Field) {
    const total = this.count.dragonflies + this.count.butterflies;
    while (this.bugs.length < total) {
      const dragon = this.bugs.filter((b) => b.kind === 0).length < this.count.dragonflies;
      const x = f.x + rnd(-f.hw, f.hw);
      const y = f.y + rnd(-f.hh, f.hh);
      this.bugs.push({
        x, y, vx: 0, vy: 0, heading: rnd(0, Math.PI * 2),
        kind: dragon ? 0 : 1 + Math.floor(Math.random() * 4),
        seed: Math.random(),
        size: dragon ? rnd(8, 9.5) : rnd(6, 7.2),
        mode: 'fly', until: 0, tx: x, ty: y, perch: null,
        phase: rnd(0, 20), wing: 0, h: dragon ? 1 : 0.9, th: 1, vh: 0, turn: 0, alpha: 0,
      });
    }
  }

  shift(dy: number) {
    for (const b of this.bugs) {
      b.y -= dy;
      b.ty -= dy;
    }
  }

  /** Somewhere to land near (x, y): a leaf's rim, an open flower, or nothing. */
  private perchNear(b: Bug, s: Scene, reach: number): Perch {
    let best: Perch = null;
    let bestD = reach;
    if (b.kind > 0) {
      for (const bl of s.blooms) {
        if (bl.open < 0.6) continue;
        const d = Math.hypot(bl.x - b.x, bl.y - b.y);
        if (d < bestD) { bestD = d; best = { kind: 'bloom', bloom: bl }; }
      }
      if (best) return best;
    }
    for (const p of s.pads) {
      if (p.selected || p.drops.length > 0) continue; // never sit on a leaf the child is counting
      const d = Math.abs(Math.hypot(p.x - b.x, p.y - b.y) - p.r);
      if (d < bestD) { bestD = d; best = { kind: 'pad', pad: p, a: Math.atan2(b.x - p.x, b.y - p.y) }; }
    }
    return best;
  }

  private perchPoint(p: Perch, s: Scene): [number, number, number] | null {
    if (!p) return null;
    if (p.kind === 'pad') {
      const { pad, a } = p;
      if (pad.sink > 0.4) return null;
      return [pad.x + Math.sin(a) * pad.r * 0.92, pad.y + Math.cos(a) * pad.r * 0.92, a + Math.PI * 0.5];
    }
    if (p.kind === 'bloom') {
      const { bloom } = p;
      if (bloom.open < 0.4) return null;
      return [bloom.x, bloom.y, bloom.ang];
    }
    const [x, y] = s.boatAt(p.lx, p.ly);
    return [x, y, s.boatHeading + (p.lx > 0 ? 1.2 : -1.2)];
  }

  step(dt: number, t: number, f: Field, s: Scene, sky: Sky): Critter[] {
    this.seed(f);
    const out: Critter[] = [];
    const inView = (x: number, y: number, m: number) => Math.abs(x - f.x) < f.hw + m && Math.abs(y - f.y) < f.hh + m;
    for (const b of this.bugs) {
      const dragon = b.kind === 0;
      // butterflies roost as the light goes; dragonflies fly on into dusk
      const out01 = dragon ? 1 - smooth(0.75, 0.95, sky.dusk) : 1 - smooth(0.35, 0.65, sky.dusk);
      b.alpha += (out01 - b.alpha) * Math.min(1, dt * 0.5);
      const [wx, wy] = f.wind(b.x, b.y);
      const gust = Math.hypot(wx, wy);

      // one that has drifted well out of view comes back in from the other side
      if (!inView(b.x, b.y, 140)) {
        b.x = f.x + (b.x < f.x ? f.hw + 100 : -f.hw - 100);
        b.y = f.y + rnd(-f.hh, f.hh);
        b.mode = 'fly';
        b.perch = null;
        b.until = 0;
      }

      if (b.mode === 'perch') {
        const at = this.perchPoint(b.perch, s);
        const flushed = gust > (dragon ? 14 : 8) || !at || (t > b.until && b.alpha > 0.5);
        if (flushed) {
          b.mode = 'fly';
          b.perch = null;
          b.until = 0;
          const a = b.heading + rnd(-0.8, 0.8);
          b.vx = Math.sin(a) * (dragon ? 60 : 20);
          b.vy = Math.cos(a) * (dragon ? 60 : 20);
          b.vh = dragon ? 3 : 1.6; // it springs up as it leaves
          b.th = dragon ? rnd(1, 2.2) : rnd(1.2, 2.2);
        } else {
          // settled: it rides whatever it sits on
          b.x = at[0]; b.y = at[1];
          b.heading += wrapAngle(at[2] - b.heading) * Math.min(1, dt * 6);
          b.th = dragon ? 0.1 : 0.14;
          b.vh += (b.th - b.h) * 18 * dt - b.vh * 6 * dt;
          b.h = Math.max(0.05, b.h + b.vh * dt);
          b.turn *= Math.max(0, 1 - dt * 5);
          if (dragon) b.wing += (0 - b.wing) * Math.min(1, dt * 6);
          else {
            // a settled butterfly opens and closes its wings at leisure, then holds them up
            const lazy = 0.45 + 0.4 * Math.sin(t * 1.1 + b.seed * 9);
            const hold = Math.sin(t * 0.23 + b.seed * 5) > 0.3 ? 0.85 : lazy;
            b.wing += (hold - b.wing) * Math.min(1, dt * 3);
          }
        }
      }

      if (b.mode !== 'perch') {
        if (dragon) this.stepDragonfly(b, dt, t, f, s, wx, wy);
        else this.stepButterfly(b, dt, t, f, s, wx, wy);
      }

      if (b.alpha < 0.02) continue;
      out.push({ x: b.x, y: b.y, heading: b.heading, size: b.size, kind: b.kind, wing: b.wing, h: b.h, seed: b.seed, alpha: b.alpha, turn: b.turn });
    }
    return out;
  }

  private stepDragonfly(b: Bug, dt: number, t: number, f: Field, s: Scene, wx: number, wy: number) {
    if (t >= b.until) {
      if (b.mode === 'fly' || Math.random() < 0.55) {
        // a dash: somewhere in view, now and then over the boat's bow
        const toBoat = Math.random() < 0.18;
        if (toBoat) {
          const [bx, by] = s.boatAt(rnd(-8, 8), rnd(30, 70));
          b.tx = bx; b.ty = by;
        } else {
          const a = Math.random() * Math.PI * 2;
          const d = rnd(70, 220);
          b.tx = Math.max(f.x - f.hw, Math.min(f.x + f.hw, b.x + Math.sin(a) * d));
          b.ty = Math.max(f.y - f.hh, Math.min(f.y + f.hh, b.y + Math.cos(a) * d));
        }
        b.mode = 'fly';
        b.until = t + 4; // a dash ends on arrival; this is only a backstop
        // a dash climbs or drops: low over the water hunting, high over the leaves passing through
        b.th = toBoat ? rnd(1.4, 2.2) : Math.random() < 0.4 ? rnd(0.35, 0.8) : rnd(1, 2.6);
      } else {
        // a stop: hover, or settle on something close
        const perch = Math.random() < 0.5 ? this.perchNear(b, s, 34) : null;
        if (perch) {
          b.mode = 'perch';
          b.perch = perch;
          b.until = t + rnd(2.5, 7);
          return;
        }
        b.mode = 'hover';
        b.until = t + rnd(0.5, 2.2);
        b.tx = b.x; b.ty = b.y;
        b.th = Math.max(0.3, b.h + rnd(-0.5, 0.5));
      }
    }
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const d = Math.hypot(dx, dy);
    if (b.mode === 'fly') {
      // straight and fast; it stops dead when it gets there
      const sp = 95 + b.seed * 50;
      const want = d < 12 ? 0 : sp;
      const ux = d > 1e-3 ? dx / d : 0;
      const uy = d > 1e-3 ? dy / d : 0;
      const k = 1 - Math.exp(-9 * dt);
      b.vx += (ux * want - b.vx) * k;
      b.vy += (uy * want - b.vy) * k;
      if (d < 12) {
        b.until = t; // arrived: choose again next step (hover or perch)
        b.mode = 'hover';
        b.until = t + rnd(0.4, 1.8);
      }
    } else {
      // hovering: held on the spot with a fine tremor, turning its head about
      const k = 1 - Math.exp(-6 * dt);
      const jx = Math.sin(t * 9.3 + b.seed * 20) * 6 + dx * 2;
      const jy = Math.cos(t * 7.1 + b.seed * 13) * 6 + dy * 2;
      b.vx += (jx - b.vx) * k;
      b.vy += (jy - b.vy) * k;
      b.heading += Math.sin(t * 1.7 + b.seed * 6) * 0.6 * dt;
    }
    b.vx += wx * 0.4 * dt;
    b.vy += wy * 0.4 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 8) b.heading += wrapAngle(Math.atan2(b.vx, b.vy) - b.heading) * Math.min(1, dt * 12);
    b.wing += (1 - b.wing) * Math.min(1, dt * 8);
    // height: a spring toward where it means to be, with a little hunting about it
    const want = b.th + 0.12 * Math.sin(t * 2.1 + b.seed * 8);
    b.vh += (want - b.h) * 6 * dt - b.vh * 3.5 * dt;
    b.h = Math.max(0.15, Math.min(3, b.h + b.vh * dt));
    b.turn *= Math.max(0, 1 - dt * 6);
  }

  private stepButterfly(b: Bug, dt: number, t: number, f: Field, s: Scene, wx: number, wy: number) {
    // the beat: slow, and the body lurches up with each downstroke
    b.phase += dt * (6.5 + b.seed * 2.5) * Math.PI * 2;
    const beat = Math.sin(b.phase);
    // seen from above the wings never quite close in flight: they beat between flat and half-raised
    b.wing = 0.3 - 0.3 * beat;
    if (t >= b.until) {
      // where next: an open flower it can smell, the boat once in a while, or just onward
      const r = Math.random();
      let target: [number, number] | null = null;
      if (r < 0.4) {
        let best: Bloom | null = null;
        let bd = 260;
        for (const bl of s.blooms) {
          if (bl.open < 0.6) continue;
          const d = Math.hypot(bl.x - b.x, bl.y - b.y);
          if (d < bd && d > 20) { bd = d; best = bl; }
        }
        if (best) target = [best.x, best.y];
      } else if (r < 0.5) {
        target = s.boatAt(rnd(-14, 14), rnd(-40, 50));
      }
      if (!target) {
        const a = b.heading + rnd(-1.4, 1.4);
        target = [b.x + Math.sin(a) * rnd(40, 120), b.y + Math.cos(a) * rnd(40, 120)];
      }
      b.tx = Math.max(f.x - f.hw, Math.min(f.x + f.hw, target[0]));
      b.ty = Math.max(f.y - f.hh, Math.min(f.y + f.hh, target[1]));
      b.mode = 'fly';
      b.until = t + rnd(1.5, 4);
      // each leg floats at its own height; a leg toward a flower comes down to it
      b.th = target && r < 0.4 ? rnd(0.5, 0.9) : rnd(0.8, 2.2);
    }
    const dx = b.tx - b.x;
    const dy = b.ty - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 7) {
      // there: if it is a flower or the boat, settle for a while
      const perch = this.perchNear(b, s, 12) ?? this.boatPerch(b, s);
      if (perch && Math.random() < 0.85) {
        b.mode = 'perch';
        b.perch = perch;
        b.until = t + rnd(3, 9);
        return;
      }
      b.until = t;
    }
    // a wandering heading that keeps bending back toward where it is going
    const want = Math.atan2(dx, dy);
    const dh = wrapAngle(want - b.heading) * Math.min(1, dt * 1.6) + Math.sin(t * 2.3 + b.seed * 17) * 1.4 * dt;
    b.heading += dh;
    b.turn += (Math.max(-1, Math.min(1, dh / Math.max(dt, 1e-3) / 2.5)) - b.turn) * Math.min(1, dt * 5);
    const sp = (16 + b.seed * 10) * (0.55 + 0.7 * Math.max(0, beat));
    const k = 1 - Math.exp(-4 * dt);
    b.vx += (Math.sin(b.heading) * sp + wx * 0.9 - b.vx) * k;
    b.vy += (Math.cos(b.heading) * sp + wy * 0.9 - b.vy) * k;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // it rises on each stroke and sinks between, about a height that itself drifts;
    // a fresh climb off a perch carries it well up before it settles to its cruising height
    b.vh += (b.th - b.h) * 3 * dt - b.vh * 2 * dt;
    b.h = Math.max(0.2, Math.min(3, b.h + b.vh * dt + 0.35 * beat * dt * 6));
  }

  private boatPerch(b: Bug, s: Scene): Perch {
    for (const ly of [50, 30, -35]) {
      for (const lx of [-15, 15]) {
        const [x, y] = s.boatAt(lx, ly);
        if (Math.hypot(x - b.x, y - b.y) < 16) return { kind: 'boat', lx, ly };
      }
    }
    return null;
  }
}
