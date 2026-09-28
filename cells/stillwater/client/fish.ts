/**
 * Fish under the pads: a boids flock (separation, alignment, cohesion) with
 * depth. Fish only school with fish near their own depth, so a deep shoal of
 * dark minnows and a few pale carp near the surface move as separate crowds
 * through the same water. They shy from the hull and from a tap, and keep to
 * the stretch of river the camera can see — a fish that falls far behind is
 * quietly re-seeded ahead, out of sight.
 */
import type { Boat } from './world';

export interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 = just under the surface, 1 = near the bed. */
  z: number;
  size: number;
  /** 0 dark minnow, 1 pale ghost carp, 2 koi. */
  kind: number;
  phase: number;
  cruise: number;
}

export interface Scare {
  x: number;
  y: number;
  t: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class School {
  fish: Fish[] = [];
  scares: Scare[] = [];

  constructor(count: number, cx: number, cy: number) {
    for (let i = 0; i < count; i++) this.fish.push(this.spawn(cx + rnd(-200, 200), cy + rnd(-400, 400), i));
  }

  private spawn(x: number, y: number, i: number): Fish {
    const kind = i % 11 === 0 ? 2 : i % 4 === 0 ? 1 : 0;
    const z = kind === 0 ? rnd(0.45, 0.95) : rnd(0.12, 0.45);
    const a = rnd(0, Math.PI * 2);
    const cruise = kind === 0 ? rnd(16, 26) : rnd(9, 15);
    return {
      x,
      y,
      vx: Math.sin(a) * cruise,
      vy: Math.cos(a) * cruise,
      z,
      size: kind === 0 ? rnd(11, 17) : kind === 1 ? rnd(24, 34) : rnd(26, 36),
      kind,
      phase: rnd(0, 100),
      cruise,
    };
  }

  scare(x: number, y: number) {
    this.scares.push({ x, y, t: 0 });
  }

  step(
    dt: number,
    boat: Boat,
    view: { x: number; y: number; hw: number; hh: number },
    shift: number,
    flow: (x: number, y: number) => [number, number],
  ) {
    if (shift) for (const f of this.fish) f.y -= shift;
    for (const s of this.scares) s.t += dt;
    this.scares = this.scares.filter((s) => s.t < 1.4);
    const fish = this.fish;
    const n = fish.length;
    for (let i = 0; i < n; i++) {
      const f = fish[i];
      let sx = 0;
      let sy = 0;
      let ax = 0;
      let ay = 0;
      let cx = 0;
      let cy = 0;
      let count = 0;
      const radius = f.kind === 0 ? 70 : 110;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const g = fish[j];
        if (Math.abs(g.z - f.z) > 0.28 || (g.kind === 0) !== (f.kind === 0)) continue;
        const dx = g.x - f.x;
        const dy = g.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const d = Math.sqrt(d2) || 0.01;
        const personal = (f.size + g.size) * 0.9;
        if (d < personal) {
          sx -= (dx / d) * (personal - d);
          sy -= (dy / d) * (personal - d);
        }
        ax += g.vx;
        ay += g.vy;
        cx += g.x;
        cy += g.y;
        count++;
      }
      let fx = sx * 2.2;
      let fy = sy * 2.2;
      if (count) {
        fx += (ax / count - f.vx) * 0.9 + (cx / count - f.x) * 0.25;
        fy += (ay / count - f.vy) * 0.9 + (cy / count - f.y) * 0.25;
      }
      // wander
      f.phase += dt;
      fx += Math.sin(f.phase * 0.7 + i) * 6;
      fy += Math.cos(f.phase * 0.53 + i * 1.7) * 6;
      // rheotaxis: fish turn to face into the current and hold against it
      const [cx0, cy0] = flow(f.x, f.y);
      const cs = Math.hypot(cx0, cy0);
      if (cs > 0.5) {
        const hold = f.kind === 0 ? 0.35 : 0.6;
        fx += (-cx0 / cs * f.cruise - f.vx) * hold;
        fy += (-cy0 / cs * f.cruise - f.vy) * hold;
      }
      // keep near the view; far strays are re-seeded ahead
      const ox = f.x - view.x;
      const oy = f.y - view.y;
      if (Math.abs(ox) > view.hw + 60) fx -= Math.sign(ox) * 30;
      if (Math.abs(oy) > view.hh + 80) fy -= Math.sign(oy) * 30;
      if (oy < -view.hh - 260 || Math.abs(ox) > view.hw + 400 || oy > view.hh + 700) {
        Object.assign(f, this.spawn(view.x + rnd(-view.hw, view.hw), view.y + view.hh + rnd(80, 240), i));
        continue;
      }
      // shy of the hull (near-surface fish more so)
      const bx = f.x - boat.x;
      const by = f.y - boat.y;
      const bd = Math.hypot(bx, by);
      const shy = 95 * (1.2 - f.z);
      if (bd < shy) {
        fx += (bx / bd) * (shy - bd) * 3;
        fy += (by / bd) * (shy - bd) * 3;
      }
      // and of a tap, briefly and hard
      for (const s of this.scares) {
        const dx = f.x - s.x;
        const dy = f.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 150) {
          const k = (150 - d) * 5 * (1 - s.t / 1.4);
          fx += (dx / d) * k;
          fy += (dy / d) * k;
        }
      }
      f.vx += fx * dt;
      f.vy += fy * dt;
      const sp = Math.hypot(f.vx, f.vy) || 1;
      const max = f.cruise * 3.2;
      const min = f.cruise * 0.5;
      const target = sp > max ? max : sp < min ? min : sp + (f.cruise - sp) * 0.4 * dt;
      f.vx = (f.vx / sp) * target;
      f.vy = (f.vy / sp) * target;
      // swimming is relative to the water, and the water is moving (less so near the bed)
      const drag = 1 - f.z * 0.5;
      f.x += (f.vx + cx0 * drag) * dt;
      f.y += (f.vy + cy0 * drag) * dt;
    }
  }
}
