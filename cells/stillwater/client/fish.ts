/**
 * Fish under the pads, as boids (separation, alignment, cohesion) with depth.
 *
 * Two kinds of crowd share the water:
 *   - SCHOOLS of small minnows (kind 3): each fish flocks only with its own
 *     school, tightly, so a school turns as one body — and when it turns, the
 *     flanks catch the light and the whole school flashes silver;
 *   - a few larger fish (dark chub, pale carp, koi) that cruise loosely.
 *
 * Every fish holds nose-into-the-current (rheotaxis), shies from the hull,
 * and bolts from a scare — a tap, a gust of touch-wind, a bumped pad. A school
 * bolts together: the fish nearest the scare flee, and alignment carries the
 * turn through the rest. Strays too far from the view are re-seeded ahead
 * (a whole school at once, so schools stay schools).
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
  /** 0 dark chub, 1 pale carp, 2 koi, 3 minnow. */
  kind: number;
  phase: number;
  cruise: number;
  /** Which school (minnows); -1 for loners. */
  school: number;
  /** Silver flash from turning, 0..1. */
  flash: number;
  /** Which way it points: along its swim through the water, turned smoothly. */
  heading: number;
  /** Fixed per fish (its markings). */
  seed: number;
  /** Tail-beat phase (radians), integrated so the beat never jumps. */
  tail: number;
  /** How hard it's swimming through the water (speed relative to the current, smoothed). */
  effort: number;
}

export interface Scare {
  x: number;
  y: number;
  t: number;
  /** Reach (world units). */
  r: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class School {
  fish: Fish[] = [];
  scares: Scare[] = [];
  private schools: number;

  constructor(counts: { schools: number; perSchool: number; loners: number }, cx: number, cy: number) {
    this.schools = counts.schools;
    for (let s = 0; s < counts.schools; s++) {
      const x = cx + rnd(-180, 180);
      const y = cy + rnd(-350, 350);
      const z = rnd(0.15, 0.7);
      for (let i = 0; i < counts.perSchool; i++) this.fish.push(this.minnow(x + rnd(-30, 30), y + rnd(-30, 30), z, s));
    }
    for (let i = 0; i < counts.loners; i++) this.fish.push(this.loner(cx + rnd(-200, 200), cy + rnd(-400, 400), i));
  }

  private minnow(x: number, y: number, z: number, school: number): Fish {
    const a = rnd(0, Math.PI * 2);
    const cruise = rnd(20, 28);
    return { x, y, vx: Math.sin(a) * cruise, vy: Math.cos(a) * cruise, z: z + rnd(-0.06, 0.06), size: rnd(5.5, 8.5), kind: 3, phase: rnd(0, 100), cruise, school, flash: 0, tail: rnd(0, 6.3), effort: 0, seed: rnd(0, 1), heading: a };
  }

  private loner(x: number, y: number, i: number): Fish {
    const kind = i % 5 === 0 ? 2 : i % 2 === 0 ? 1 : 0;
    const a = rnd(0, Math.PI * 2);
    const cruise = kind === 0 ? rnd(14, 20) : rnd(9, 14);
    return {
      x,
      y,
      vx: Math.sin(a) * cruise,
      vy: Math.cos(a) * cruise,
      z: kind === 0 ? rnd(0.45, 0.95) : rnd(0.15, 0.45),
      size: kind === 0 ? rnd(12, 17) : rnd(24, 34),
      kind,
      phase: rnd(0, 100),
      cruise,
      school: -1,
      flash: 0,
      tail: rnd(0, 6.3),
      effort: 0,
      seed: rnd(0, 1),
      heading: a,
    };
  }

  /** Something startled the water here (a tap, a gust, a bump). */
  scare(x: number, y: number, r = 150) {
    this.scares.push({ x, y, t: 0, r });
    if (this.scares.length > 24) this.scares.shift();
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

    // school centroids, to keep schools together and re-seed them whole
    const cx = new Float64Array(this.schools);
    const cy = new Float64Array(this.schools);
    const cn = new Float64Array(this.schools);
    for (const f of fish)
      if (f.school >= 0) {
        cx[f.school] += f.x;
        cy[f.school] += f.y;
        cn[f.school]++;
      }
    for (let s = 0; s < this.schools; s++) {
      if (!cn[s]) continue;
      const mx = cx[s] / cn[s];
      const my = cy[s] / cn[s];
      const ox = mx - view.x;
      const oy = my - view.y;
      // (just out of sight is enough: they face upstream, so they fall behind a boat going
      // downstream, and the keep-near-the-view pull below would otherwise hold them in a
      // band just off-screen for ever)
      if (oy < -view.hh - 70 || Math.abs(ox) > view.hw + 160 || oy > view.hh + 800) {
        // the school is lost behind: bring it in ahead, out of sight
        const nx = view.x + rnd(-view.hw, view.hw);
        const ny = view.y + view.hh + rnd(80, 260);
        const z = rnd(0.15, 0.7);
        for (const f of fish)
          if (f.school === s) Object.assign(f, this.minnow(nx + rnd(-30, 30), ny + rnd(-30, 30), z, s));
        cx[s] = nx * cn[s];
        cy[s] = ny * cn[s];
      }
    }

    // Flocking neighbourhoods are spatially bucketed. Largest radius is 110,
    // so a 120-unit grid preserves the same local rules without O(n²) scans.
    const cell = 120;
    const grid = new Map<string, number[]>();
    const gridKey = (x: number, y: number) => x + ',' + y;
    for (let i = 0; i < n; i++) {
      const f = fish[i];
      const k = gridKey(Math.floor(f.x / cell), Math.floor(f.y / cell));
      const bucket = grid.get(k);
      if (bucket) bucket.push(i);
      else grid.set(k, [i]);
    }

    for (let i = 0; i < n; i++) {
      const f = fish[i];
      const minnow = f.kind === 3;
      let sx = 0;
      let sy = 0;
      let ax = 0;
      let ay = 0;
      let mx = 0;
      let my = 0;
      let count = 0;
      const radius = minnow ? 48 : f.kind === 0 ? 70 : 110;
      const gx0 = Math.floor(f.x / cell);
      const gy0 = Math.floor(f.y / cell);
      for (let gx = gx0 - 1; gx <= gx0 + 1; gx++)
        for (let gy = gy0 - 1; gy <= gy0 + 1; gy++) {
          const bucket = grid.get(gridKey(gx, gy));
          if (!bucket) continue;
          for (const j of bucket) {
            if (i === j) continue;
            const g = fish[j];
            if (minnow ? g.school !== f.school : g.school >= 0 || Math.abs(g.z - f.z) > 0.28 || (g.kind === 0) !== (f.kind === 0)) continue;
            const dx = g.x - f.x;
            const dy = g.y - f.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > radius * radius) continue;
            const d = Math.sqrt(d2) || 0.01;
            const personal = (f.size + g.size) * (minnow ? 0.75 : 0.9);
            if (d < personal) {
              sx -= (dx / d) * (personal - d);
              sy -= (dy / d) * (personal - d);
            }
            ax += g.vx;
            ay += g.vy;
            mx += g.x;
            my += g.y;
            count++;
          }
        }
      let fx = sx * (minnow ? 3 : 2.2);
      let fy = sy * (minnow ? 3 : 2.2);
      if (count) {
        const al = minnow ? 1.8 : 0.9;
        const co = minnow ? 0.5 : 0.25;
        fx += (ax / count - f.vx) * al + (mx / count - f.x) * co;
        fy += (ay / count - f.vy) * al + (my / count - f.y) * co;
      }
      if (minnow && cn[f.school]) {
        // a straggler swims back to its school
        fx += (cx[f.school] / cn[f.school] - f.x) * 0.08;
        fy += (cy[f.school] / cn[f.school] - f.y) * 0.08;
      }
      // wander
      f.phase += dt;
      const wob = minnow ? 10 : 6;
      fx += Math.sin(f.phase * 0.7 + (minnow ? f.school * 3 : i)) * wob;
      fy += Math.cos(f.phase * 0.53 + (minnow ? f.school * 5 : i * 1.7)) * wob;
      // rheotaxis: face into the current and hold against it
      const [cx0, cy0] = flow(f.x, f.y);
      const cs = Math.hypot(cx0, cy0);
      if (cs > 0.5) {
        const hold = minnow ? 0.25 : f.kind === 0 ? 0.35 : 0.6;
        fx += ((-cx0 / cs) * f.cruise - f.vx) * hold;
        fy += ((-cy0 / cs) * f.cruise - f.vy) * hold;
      }
      // the tail beats with the work of swimming THROUGH the water: holding still
      // against the current is a steady gentle swish, cruising a little quicker,
      // a dart a flurry. Small fish beat faster than big ones.
      const rel = Math.hypot(f.vx - cx0, f.vy - cy0);
      f.effort += (Math.min(rel, 90) - f.effort) * (1 - Math.exp(-2.5 * dt));
      f.tail += dt * (2.2 + f.effort * 0.11) * Math.sqrt(12 / f.size);
      // it points the way it swims through the water (upstream when holding
      // station), turning smoothly rather than snapping to every nudge
      if (rel > 1.5) {
        const want = Math.atan2(f.vx - cx0, f.vy - cy0);
        let dh = want - f.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        f.heading += dh * (1 - Math.exp(-(minnow ? 9 : 5) * dt));
      }
      // keep near the view; lone strays are re-seeded ahead
      const ox = f.x - view.x;
      const oy = f.y - view.y;
      if (Math.abs(ox) > view.hw + 60) fx -= Math.sign(ox) * 30;
      if (Math.abs(oy) > view.hh + 80) fy -= Math.sign(oy) * 30;
      if (!minnow && (oy < -view.hh - 70 || Math.abs(ox) > view.hw + 160 || oy > view.hh + 700)) {
        Object.assign(f, this.loner(view.x + rnd(-view.hw, view.hw), view.y + view.hh + rnd(80, 240), i));
        continue;
      }
      // shy of the hull (near-surface fish more so)
      const bx = f.x - boat.x;
      const by = f.y - boat.y;
      const bd = Math.hypot(bx, by) || 1;
      const shy = 95 * (1.2 - f.z);
      if (bd < shy) {
        fx += (bx / bd) * (shy - bd) * 3;
        fy += (by / bd) * (shy - bd) * 3;
      }
      // bolt from a scare: hard and fast, minnows hardest
      for (const s of this.scares) {
        const dx = f.x - s.x;
        const dy = f.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < s.r) {
          const k = (s.r - d) * (minnow ? 9 : 5) * (1 - s.t / 1.4);
          fx += (dx / d) * k;
          fy += (dy / d) * k;
        }
      }
      const pvx = f.vx;
      const pvy = f.vy;
      f.vx += fx * dt;
      f.vy += fy * dt;
      const sp = Math.hypot(f.vx, f.vy) || 1;
      const max = f.cruise * (minnow ? 4.5 : 3.2);
      const min = f.cruise * 0.5;
      const target = sp > max ? max : sp < min ? min : sp + (f.cruise - sp) * 0.4 * dt;
      f.vx = (f.vx / sp) * target;
      f.vy = (f.vy / sp) * target;
      // a sharp turn shows the flank: the silver flash
      const turn = Math.abs(pvx * f.vy - pvy * f.vx) / ((Math.hypot(pvx, pvy) || 1) * target);
      f.flash = Math.min(1, f.flash * Math.exp(-4 * dt) + turn * (minnow ? 6 : 1.5));
      // swimming is relative to the water, and the water is moving (less so near the bed)
      const drag = 1 - f.z * 0.5;
      f.x += (f.vx + cx0 * drag) * dt;
      f.y += (f.vy + cy0 * drag) * dt;
    }
  }
}
