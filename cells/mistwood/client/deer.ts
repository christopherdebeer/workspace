/**
 * Deer: a glimpse, never a spectacle. They come into the edge of what the fog
 * lets you see, a few together, grazing side-on. Come near — or walk towards
 * them — and one lifts its head, then turns it to look straight at you. Keep
 * still and they may go back to grazing; come closer and they go: a twig snaps,
 * and they bound away, rumps flashing white, into the fog.
 *
 * Drawn by the shader (render.ts DEER_FS) from a few shapes — body, neck, head,
 * ears, jointed legs, rump — posed each frame; fogged like everything else.
 */
import type { Rand } from './rng';

export type DeerState = 'graze' | 'alert' | 'look' | 'flee';

export interface Deer {
  x: number;
  z: number;
  /** the way it faces / runs (world, radians) */
  heading: number;
  state: DeerState;
  /** seconds in this state */
  t: number;
  /** how long it will stay in this state (if nothing makes it change) */
  until: number;
  headUp: number;
  headTurn: number;
  gait: number;
  speed: number;
  size: number;
  /** a twig will snap under it */
  snapAt: number;
}

export interface Listener {
  /** a twig snapped: where (world), how loud */
  snap(x: number, z: number, loudness: number): void;
}

const approach = (v: number, to: number, rate: number, dt: number) => v + (to - v) * (1 - Math.exp(-rate * dt));

export class Herd {
  deer: Deer[] = [];
  private nextAt: number;

  constructor(private r: Rand, first = 14, private near = 0) {
    this.nextAt = first;
  }

  /** Each frame: arrive now and then; notice you; look; go. */
  step(dt: number, t: number, eye: { x: number; z: number; yaw: number; speed: number }, onPath: (x: number, z: number) => number, ear: Listener) {
    const r = this.r;
    // a few come into the edge of the fog, ahead and to one side, side-on, grazing
    if (!this.deer.length && t >= this.nextAt) {
      const count = 1 + Math.floor(r() * 3);
      const ang = eye.yaw + (r() - 0.5) * 1.1;
      const dist = this.near || 27 + r() * 12;
      const cx = eye.x + Math.sin(ang) * dist;
      const cz = eye.z + Math.cos(ang) * dist;
      for (let i = 0; i < count; i++) {
        const side = (r() < 0.5 ? -1 : 1) * Math.PI / 2;
        this.deer.push({
          x: cx + (r() - 0.5) * 6,
          z: cz + (r() - 0.5) * 6,
          heading: eye.yaw + side + (r() - 0.5) * 0.6,
          state: 'graze',
          t: 0,
          until: 5 + r() * 12,
          headUp: r() < 0.3 ? 1 : 0,
          headTurn: 0,
          gait: r() * 6.28,
          speed: 0,
          size: 0.85 + r() * 0.25,
          snapAt: 0,
        });
      }
    }
    let fleeing = false;
    for (const d of this.deer) {
      d.t += dt;
      const dx = d.x - eye.x;
      const dz = d.z - eye.z;
      const dist = Math.hypot(dx, dz);
      // wary sooner if you come their way
      const towards = eye.speed * Math.max(0, (Math.sin(eye.yaw) * dx + Math.cos(eye.yaw) * dz) / Math.max(dist, 1));
      const wary = (this.near ? this.near * 0.5 : 19) + towards * 9;
      switch (d.state) {
        case 'graze':
          d.headUp = approach(d.headUp, Math.sin(d.t * 0.7 + d.gait) > 0.6 ? 0.6 : 0, 1.5, dt);
          d.headTurn = approach(d.headTurn, 0, 2, dt);
          if (dist < wary || d.t > d.until) this.set(d, 'alert', 0.8 + r() * 0.8);
          break;
        case 'alert':
          // the head comes up
          d.headUp = approach(d.headUp, 1, 5, dt);
          if (dist < wary * 0.7) this.set(d, 'flee', 0);
          else if (d.t > d.until) this.set(d, 'look', 1.5 + r() * 2.5);
          break;
        case 'look':
          // and turns to look at you
          d.headUp = approach(d.headUp, 1, 5, dt);
          d.headTurn = approach(d.headTurn, 1, 4, dt);
          if (dist < wary * 0.8 || eye.speed > 0.4 || d.t > d.until) {
            // still, and far enough: sometimes they settle again
            if (eye.speed < 0.2 && dist > wary && r() < 0.4) this.set(d, 'graze', 6 + r() * 10);
            else this.set(d, 'flee', 0);
          }
          break;
        case 'flee':
          fleeing = true;
          d.headUp = approach(d.headUp, 0.85, 6, dt);
          d.headTurn = approach(d.headTurn, 0, 6, dt);
          d.speed = approach(d.speed, 8 * d.size, 2.2, dt);
          d.gait += dt * (2.2 + d.speed * 0.12) * Math.PI * 2;
          d.x += Math.sin(d.heading) * d.speed * dt;
          d.z += Math.cos(d.heading) * d.speed * dt;
          if (d.snapAt && d.t >= d.snapAt) {
            ear.snap(d.x, d.z, 1 / (1 + dist / 25));
            d.snapAt = r() < 0.5 ? d.t + 0.15 + r() * 0.4 : 0;
          }
          break;
      }
    }
    // one goes, they all go
    if (fleeing)
      for (const d of this.deer)
        if (d.state !== 'flee') this.set(d, 'flee', 0, Math.random() * 0.3);
    // gone into the fog
    const before = this.deer.length;
    this.deer = this.deer.filter((d) => !(d.state === 'flee' && (Math.hypot(d.x - eye.x, d.z - eye.z) > 75 || d.t > 9)));
    if (before && !this.deer.length) this.nextAt = t + 35 + r() * 80;
    void onPath;
  }

  private set(d: Deer, s: DeerState, until: number, delay = 0) {
    d.state = s;
    d.t = -delay;
    d.until = until;
    if (s === 'flee') {
      // away from you, more or less, and a twig snaps as it goes
      d.heading = Math.atan2(d.x - this.lastEye.x, d.z - this.lastEye.z) + (this.r() - 0.5) * 1.2;
      d.snapAt = 0.05 + this.r() * 0.2;
    }
  }

  private lastEye = { x: 0, z: 0 };
  /** Where you are (for which way "away" is). */
  watch(x: number, z: number) {
    this.lastEye = { x, z };
  }
}
