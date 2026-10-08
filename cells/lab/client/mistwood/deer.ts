/**
 * Deer that live here. Each wood has its herds, each with a home range: a lying-up place in cover,
 * and grazing out on the grass of the glades and the wet edges near it. They keep the hours deer
 * keep — out at dawn and dusk, lying up in the middle of the day, about at night — and they are
 * there when you come back.
 *
 * They know you first by ear: your steps (loud in dry leaves, soft on the path), and then by eye,
 * when the fog lets them see you and you move. Their alarm builds with what they hear and see, and
 * falls away if you keep still: heads come up; one turns to look at you, stamps, barks; and then
 * they go — not just away from you, but into cover, where they stop and look back. Later they
 * drift home again.
 *
 * And you hear them before you see them: a rustle of steps in the leaves somewhere off in the
 * fog, a stamp, a bark, twigs snapping as they run.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import type { Place } from './world';

export type Mode = 'bedded' | 'graze' | 'alert' | 'flee' | 'return';

export interface Deer {
  x: number;
  z: number;
  /** the way it faces (world, radians) */
  heading: number;
  headUp: number;
  /** its head turned to look at you */
  headTurn: number;
  gait: number;
  speed: number;
  size: number;
  /** 0 standing … 1 lying up */
  bed: number;
  /** where it is going (grazing, it wanders a little about the herd's spot) */
  tx: number;
  tz: number;
  /** seconds it will stay put here, grazing */
  pause: number;
  /** a step until the next rustle */
  step: number;
  /** its coat: 0 plain, 1 dappled (a herd's deer all one or the other) */
  coat: number;
}

export interface Herd {
  key: string;
  homeX: number;
  homeZ: number;
  deer: Deer[];
  mode: Mode;
  /** the mode it settles back to when the alarm passes */
  calm: 'bedded' | 'graze';
  /** seconds in this mode, and how long before it changes of itself */
  t: number;
  until: number;
  /** 0 … 1: how alarmed */
  alarm: number;
  spotX: number;
  spotZ: number;
  barks: number;
  nextBark: number;
  stamped: boolean;
  r: Rand;
}

/** What the deer know of the land. */
export interface Land {
  seed: number;
  place(x: number, z: number): Place;
  pathDist(x: number, z: number): number;
}

/** What they make heard: where, and how loud (at the source). */
export interface Ear {
  rustle(x: number, z: number, loud: number): void;
  snap(x: number, z: number, loud: number): void;
  stamp(x: number, z: number, loud: number): void;
  bark(x: number, z: number, loud: number): void;
}

export interface Eye {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** how far the fog lets anything be seen (m) */
  vis: number;
  hour: number;
}

/** The grid of home ranges (m); about half the squares have a herd. */
const HOME = 120;
const approach = (v: number, to: number, rate: number, dt: number) => v + (to - v) * (1 - Math.exp(-rate * dt));
const angleTo = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** How much the deer are about at this hour: most at dawn and dusk, least at midday. */
export function activity(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const peak = Math.max(Math.exp(-(((h - 6.5) / 1.8) ** 2)), Math.exp(-(((h - 19) / 1.8) ** 2)));
  const night = h < 5 || h > 21 ? 0.5 : 0;
  return Math.max(0.2 + 0.8 * peak, night);
}

export class Deerland {
  herds = new Map<string, Herd>();
  calm = false;

  constructor(private land: Land) {}

  /** Every deer, for drawing. */
  *all(): Iterable<Deer> {
    for (const h of this.herds.values()) yield* h.deer;
  }

  /** (Debug) a herd here, now, grazing or lying up. */
  bring(x: number, z: number, bedded: boolean, hour: number) {
    const h = this.make('debug', x, z, hour, seeded(hash(this.land.seed, 0xdee7)));
    h.calm = bedded ? 'bedded' : 'graze';
    h.mode = h.calm;
    for (const d of h.deer) d.bed = bedded ? 1 : 0;
    this.herds.set('debug', h);
  }

  step(dt: number, t: number, eye: Eye, ear: Ear) {
    this.populate(eye);
    for (const h of this.herds.values()) this.stepHerd(h, dt, eye, ear);
    void t;
  }

  // ─── where the herds live: made as you come near their range, let go when far ───────────────
  private populate(eye: Eye) {
    for (const [k, h] of this.herds) if (k !== 'debug' && Math.hypot(h.homeX - eye.x, h.homeZ - eye.z) > 280) this.herds.delete(k);
    for (let I = Math.floor((eye.x - 200) / HOME); I <= Math.floor((eye.x + 200) / HOME); I++)
      for (let J = Math.floor((eye.z - 200) / HOME); J <= Math.floor((eye.z + 200) / HOME); J++) {
        const key = `${I},${J}`;
        if (this.herds.has(key)) continue;
        const r = seeded(hash(this.land.seed, 77, I, J));
        if (r() > 0.5) continue;
        // the lying-up place: in cover, off the paths, not in water
        let bx = 0;
        let bz = 0;
        let best = -Infinity;
        for (let k = 0; k < 10; k++) {
          const x = (I + 0.15 + 0.7 * r()) * HOME;
          const z = (J + 0.15 + 0.7 * r()) * HOME;
          const f = this.land.place(x, z);
          const score = (1 - f.open) * 0.6 + f.disturb * 0.4 + f.wet * 0.2 - (f.water > 0 ? 9 : 0) - (this.land.pathDist(x, z) < 8 ? 0.6 : 0) + r() * 0.2;
          if (score > best) {
            best = score;
            bx = x;
            bz = z;
          }
        }
        if (Math.hypot(bx - eye.x, bz - eye.z) > 200) continue;
        this.herds.set(key, this.make(key, bx, bz, eye.hour, r));
      }
  }

  private make(key: string, x: number, z: number, hour: number, r: Rand): Herd {
    const count = 2 + Math.floor(r() * 4);
    const out = r() < activity(hour);
    // (its coat from its key, not from r: the herd's other draws are as they were)
    const coat = hash(this.land.seed, 0xc0a7, ...[...key].map((ch) => ch.charCodeAt(0))) % 2;
    const deer: Deer[] = [];
    for (let i = 0; i < count; i++) {
      const dx = x + (r() - 0.5) * 8;
      const dz = z + (r() - 0.5) * 8;
      deer.push({ x: dx, z: dz, heading: r() * 6.28, headUp: 1, headTurn: 0, gait: r() * 6.28, speed: 0, size: 0.82 + r() * 0.28, bed: out ? 0 : 1, tx: dx, tz: dz, pause: r() * 6, step: r(), coat });
    }
    const h: Herd = { key, homeX: x, homeZ: z, deer, mode: out ? 'graze' : 'bedded', calm: out ? 'graze' : 'bedded', t: 0, until: 40 + r() * 90, alarm: 0, spotX: x, spotZ: z, barks: 0, nextBark: 0, stamped: false, r };
    if (out) this.newSpot(h);
    else this.bedSpot(h);
    return h;
  }

  /** Somewhere to graze, near home: grass — the glades, the wet edges. */
  private newSpot(h: Herd) {
    let best = -Infinity;
    for (let k = 0; k < 8; k++) {
      const a = h.r() * 6.283;
      const d = 8 + h.r() * 32;
      const x = h.homeX + Math.sin(a) * d;
      const z = h.homeZ + Math.cos(a) * d;
      const f = this.land.place(x, z);
      const grass = f.open * 0.8 + (f.wet > 0.3 && f.wet < 0.75 ? 0.4 : 0) + f.disturb * 0.3 - (f.water > 0 ? 9 : 0) + h.r() * 0.3;
      if (grass > best) {
        best = grass;
        h.spotX = x;
        h.spotZ = z;
      }
    }
    for (const d of h.deer) this.wanderTo(h, d);
  }
  /** Back to lie up: the home place, in cover. */
  private bedSpot(h: Herd) {
    h.spotX = h.homeX;
    h.spotZ = h.homeZ;
    for (const d of h.deer) {
      d.tx = h.homeX + (h.r() - 0.5) * 7;
      d.tz = h.homeZ + (h.r() - 0.5) * 7;
    }
  }
  private wanderTo(h: Herd, d: Deer) {
    for (let k = 0; k < 4; k++) {
      const x = h.spotX + (h.r() - 0.5) * 10;
      const z = h.spotZ + (h.r() - 0.5) * 10;
      if (this.land.place(x, z).water > 0) continue;
      d.tx = x;
      d.tz = z;
      return;
    }
  }

  private set(h: Herd, m: Mode, until: number) {
    h.mode = m;
    h.t = 0;
    h.until = until;
  }

  private stepHerd(h: Herd, dt: number, eye: Eye, ear: Ear) {
    const r = h.r;
    h.t += dt;
    // where they are, and how far you are from them
    let cx = 0;
    let cz = 0;
    for (const d of h.deer) {
      cx += d.x;
      cz += d.z;
    }
    cx /= h.deer.length;
    cz /= h.deer.length;
    const dist = Math.hypot(eye.x - cx, eye.z - cz);
    // ─ what they make of you: heard (your steps: loud in leaves, soft on the path), seen (if
    //   the fog allows and you move), and too near whatever you do
    let stim = 0;
    if (!this.calm && dist < 90) {
      const at = this.land.place(eye.x, eye.z);
      const underfoot = this.land.pathDist(eye.x, eye.z) < 1.2 ? 0.45 : 0.8 + 0.7 * (1 - at.open) * (1 - at.wet);
      const hear = eye.speed * underfoot * Math.max(0, 1 - dist / 55);
      const seen = dist < eye.vis ? (1 - dist / eye.vis) * (eye.speed > 0.2 ? 1 : 0.2) * (1 - 0.45 * (1 - at.open)) : 0;
      const close = dist < 11 ? 1 - dist / 11 : 0;
      stim = hear * 0.55 + seen * 0.9 + close * 1.6;
      // lying up, they hold tight — until they don't
      if (h.mode === 'bedded') stim *= 0.55;
    }
    h.alarm = Math.max(0, Math.min(1, h.alarm + dt * (stim * 0.45 - (0.035 + (eye.speed < 0.1 ? 0.04 : 0)) * Math.max(0, 1 - stim * 3))));
    // the one that has seen you
    const watcher = h.deer[0];
    switch (h.mode) {
      case 'graze':
      case 'bedded':
        if (h.alarm > 0.3) this.set(h, 'alert', 0);
        else if (h.t > h.until) {
          // the hours turn them out to graze, or back to lie up
          const out = r() < activity(eye.hour);
          h.calm = out ? 'graze' : 'bedded';
          this.set(h, h.calm, 40 + r() * 100);
          if (out) this.newSpot(h);
          else this.bedSpot(h);
        }
        break;
      case 'alert':
        // heads up; one turns to look; it stamps, it barks; and if it goes on, they go
        if (h.alarm > 0.55 && !h.stamped) {
          h.stamped = true;
          ear.stamp(watcher.x, watcher.z, 0.8);
        }
        if (h.alarm > 0.62 && h.barks < 4 && h.t > h.nextBark && r() < 0.7) {
          ear.bark(watcher.x, watcher.z, 1);
          h.barks++;
          h.nextBark = h.t + 1.2 + r() * 1.5;
        }
        if (h.alarm > 0.8) this.flee(h, eye);
        else if (h.alarm < 0.18) {
          h.stamped = false;
          h.barks = 0;
          this.set(h, h.calm, 30 + r() * 60);
        }
        break;
      case 'flee':
        // into cover, then they stop and look back
        if (h.deer.every((d) => Math.hypot(d.tx - d.x, d.tz - d.z) < 3) || h.t > 14) {
          h.alarm = Math.min(h.alarm, 0.6);
          this.set(h, 'return', 0);
          h.stamped = true;
        }
        break;
      case 'return':
        // watching from cover until the alarm passes; then home, to lie up or graze again
        if (h.alarm < 0.15 && h.until === 0) {
          h.until = 1;
          h.spotX = h.homeX;
          h.spotZ = h.homeZ;
          for (const d of h.deer) this.wanderTo(h, d);
        }
        if (h.alarm > 0.85) this.flee(h, eye);
        if (h.until === 1 && Math.hypot(cx - h.homeX, cz - h.homeZ) < 8) {
          h.stamped = false;
          h.barks = 0;
          this.set(h, h.calm, 30 + r() * 60);
          if (h.calm === 'graze') this.newSpot(h);
          else this.bedSpot(h);
        }
        break;
    }
    // ─ each deer
    const fleeing = h.mode === 'flee';
    const watching = h.mode === 'alert' || (h.mode === 'return' && h.until === 0);
    for (let i = 0; i < h.deer.length; i++) {
      const d = h.deer[i];
      const toYou = Math.atan2(eye.x - d.x, eye.z - d.z);
      const lying = h.mode === 'bedded' || (h.mode === 'alert' && d.bed > 0.5 && h.alarm < 0.7);
      d.bed = approach(d.bed, lying && Math.hypot(d.tx - d.x, d.tz - d.z) < 1 ? 1 : 0, lying ? 0.6 : 4, dt);
      const tdx = d.tx - d.x;
      const tdz = d.tz - d.z;
      const far = Math.hypot(tdx, tdz);
      let want = 0;
      if (fleeing) want = (7 + 1.5 * r()) * d.size;
      else if (!watching && d.bed < 0.3 && far > 0.6 && d.pause <= 0) want = h.mode === 'return' ? 0.9 : 0.4;
      d.speed = approach(d.speed, want, fleeing ? 2.4 : 2, dt);
      if (d.speed > 0.05 && far > 0.3) {
        // turn towards where it is going (fast when running), and go
        const a = Math.atan2(tdx, tdz);
        d.heading += angleTo(d.heading, a) * (1 - Math.exp(-dt * (fleeing ? 8 : 2.5)));
        const s = Math.min(d.speed * dt, far);
        d.x += Math.sin(d.heading) * s;
        d.z += Math.cos(d.heading) * s;
        d.gait += dt * (fleeing ? 2.2 + d.speed * 0.12 : 1.6) * Math.PI * 2;
        // steps: a rustle in the leaves (heard far off in the fog); running, twigs snap
        // (not every step is heard: now and then one in the leaves, more as they run)
        d.step -= dt * d.speed * (fleeing ? 0.3 : 0.45);
        if (d.step <= 0) {
          d.step = 1 + r() * 1.5;
          const f = this.land.place(d.x, d.z);
          const leaves = (1 - f.open) * (1 - f.wet);
          if (fleeing && r() < 0.15 + 0.3 * leaves) ear.snap(d.x, d.z, 0.7 + 0.3 * r());
          else ear.rustle(d.x, d.z, (fleeing ? 0.9 : 0.35) * (0.6 + 0.8 * leaves));
        }
      } else if (!fleeing && !watching && h.mode === 'graze') {
        // grazing here a while, then a few steps on
        d.pause -= dt;
        if (d.pause <= 0 && far <= 0.6) {
          d.pause = 3 + r() * 9;
          this.wanderTo(h, d);
        }
      }
      // the head: down to graze now and then, up when lying or alarmed; the watcher looks at you
      const grazingHead = h.mode === 'graze' && d.speed < 0.15 ? (Math.sin(h.t * 0.5 + i * 1.7) > 0.45 ? 0.6 : 0) : 1;
      d.headUp = approach(d.headUp, fleeing ? 0.85 : watching || d.bed > 0.5 ? 1 : grazingHead, 4, dt);
      const looks = watching && (i === 0 || h.alarm > 0.5) ? 1 : 0;
      d.headTurn = approach(d.headTurn, looks, 4, dt);
      // standing alert, they turn side-on to you (to watch, and be ready to go)
      if (watching && d.speed < 0.1 && d.bed < 0.5) d.heading += angleTo(d.heading, toYou + (Math.sin(d.heading - toYou) >= 0 ? 1 : -1) * 1.3) * (1 - Math.exp(-dt * 1.2));
    }
  }

  /** Away from you and into cover. */
  private flee(h: Herd, eye: Eye) {
    const r = h.r;
    let cx = 0;
    let cz = 0;
    for (const d of h.deer) {
      cx += d.x;
      cz += d.z;
    }
    cx /= h.deer.length;
    cz /= h.deer.length;
    const away = Math.atan2(cx - eye.x, cz - eye.z);
    let best = -Infinity;
    let bx = cx;
    let bz = cz;
    for (let k = 0; k < 9; k++) {
      const a = away + (k / 8 - 0.5) * 2.4;
      const run = 40 + r() * 25;
      const x = cx + Math.sin(a) * run;
      const z = cz + Math.cos(a) * run;
      const f = this.land.place(x, z);
      const score = Math.cos(a - away) + (1 - f.open) * 0.7 - (f.water > 0 ? 9 : 0) + r() * 0.2;
      if (score > best) {
        best = score;
        bx = x;
        bz = z;
      }
    }
    for (const d of h.deer) {
      d.tx = bx + (r() - 0.5) * 8;
      d.tz = bz + (r() - 0.5) * 8;
      d.pause = 0;
      d.step = r() * 0.3;
    }
    this.set(h, 'flee', 0);
  }
}
