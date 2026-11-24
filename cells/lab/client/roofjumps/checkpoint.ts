/**
 * Roof Jumps' checkpoints, where the street is a fall (`streetFail`): coming down to it is a life lost, and the runner is put
 * back where it last was surefooted, or at the last checkpoint it collected, whichever is later.
 *
 * Surefooted: on a roof (above the street), on its feet, for three seconds without leaving the ground; while it stays so, the
 * place it's standing is kept, moment by moment. A checkpoint is a thing to collect, placed on roofs that have ways on (reach.ts
 * `placeItems`): passed within a reach, it's taken, and becomes the place to come back to. What one looks like isn't settled:
 * for now a post with a flag on it (`itemBones`), drawn with the figure so every look has it.
 */
import type { City } from './city';
import type { M4 } from './m4';
import type { Bone } from './rig';
import type { Runner } from './runner';
import type { Spline } from './strokes';
import { STREET } from './reach';
import type { Item } from './reach';

/** where to come back to */
export interface Spot { x: number; y: number; z: number; heading: number; by: 'start' | 'surefooted' | 'item'; t: number }

export const SUREFOOTED = 3, TAKE = 1.3;

export class Checkpoints {
  spot: Spot;
  collected = new Set<string>();
  lost = 0;
  private groundSince = -1;
  private wasAbove = true;
  constructor(r: Runner) { this.spot = { x: r.x, y: r.y, z: r.z, heading: r.heading, by: 'start', t: 0 }; this.wasAbove = r.y >= STREET; }

  /**
   * One step: kept up to date from the runner; what happened, if anything: a checkpoint taken, or a life lost (then put the
   * runner back at `spot`, `respawn`).
   */
  update(r: Runner, city: City, t: number): { took?: Item; lost?: true } {
    const above = r.y >= STREET;
    // (a life: down in the street from above it)
    if (r.state === 'ground' && !above && this.wasAbove) { this.lost++; this.groundSince = -1; this.wasAbove = false; return { lost: true }; }
    this.wasAbove = above || this.wasAbove && r.state !== 'ground';
    if (r.state === 'ground' && above) {
      if (this.groundSince < 0) this.groundSince = t;
      if (t - this.groundSince >= SUREFOOTED && (this.spot.by !== 'item' || t - this.spot.t > SUREFOOTED)) this.spot = { x: r.x, y: r.y, z: r.z, heading: r.heading, by: 'surefooted', t };
    } else this.groundSince = -1;
    for (const it of city.itemsNear(r.x, r.z, TAKE)) {
      if (this.collected.has(it.id) || Math.abs(r.y - it.y) > 2) continue;
      this.collected.add(it.id); this.spot = { x: it.x, y: it.y, z: it.z, heading: r.heading, by: 'item', t };
      return { took: it };
    }
    return {};
  }

  /** the runner put back at the spot (a fresh one: standing, nothing carried over) */
  respawn(make: () => Runner): Runner {
    const r = make(); r.x = this.spot.x; r.y = this.spot.y; r.z = this.spot.z; r.heading = this.spot.heading; this.wasAbove = true; this.groundSince = -1;
    return r;
  }
}

/** a matrix: turned `yaw` about up, at (x, y, z) */
function at(x: number, y: number, z: number, yaw: number): M4 {
  const c = Math.cos(yaw), s = Math.sin(yaw), m = new Float32Array(16);
  m[0] = c; m[2] = -s; m[5] = 1; m[8] = s; m[10] = c; m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
}

/** the checkpoints not yet taken near (x, z), as blocks to draw with the figure: a post, and a flag on it that turns slowly */
export function itemBones(city: City, cp: Checkpoints, x: number, z: number, t: number, mat = 5, r = 45): Bone[] {
  const out: Bone[] = [];
  for (const it of city.itemsNear(x, z, r)) {
    if (cp.collected.has(it.id)) continue;
    const yaw = t * 0.8 + it.x * 0.37, m = at(it.x, it.y, it.z, yaw);
    out.push({ name: 'item:post', m, y0: 0, y1: 1.5, w0: 0.07, d0: 0.07, w1: 0.06, d1: 0.06, zc: 0, mat: 7 });
    out.push({ name: 'item:flag', m, x: 0.24, y0: 1.08, y1: 1.46, w0: 0.42, d0: 0.035, w1: 0.38, d1: 0.03, zc: 0, mat });
  }
  return out;
}

/** the checkpoints not yet taken, painted (the stroke looks): the post a pale upright stroke, the flag a warm one across it,
 * turning on the post; each a few strokes so it reads as made, not stamped */
export function itemSplines(city: City, cp: Checkpoints, x: number, z: number, t: number, r = 45): Spline[] {
  const out: Spline[] = [];
  for (const it of city.itemsNear(x, z, r)) {
    if (cp.collected.has(it.id)) continue;
    const yaw = t * 0.8 + it.x * 0.37, c = Math.cos(yaw), s = Math.sin(yaw), P = (u: number, y: number): [number, number, number] => [it.x + c * u, it.y + y, it.z - s * u];
    const n: [number, number, number] = [s, 0, c], k = it.id;
    out.push({ ctrl: [P(0, -0.02), P(0, 0.5), P(0, 1.0), P(0, 1.5)], widths: [0.07, 0.065, 0.06, 0.055], col: [0.86, 0.84, 0.78], key: `item:${k}:post`, load: 0.6, dry: 0.15, heart: 0.4, body: 0.001, taper: [0.01, 0.02] });
    for (const [j, y] of [[0, 1.4], [1, 1.27], [2, 1.14]] as const)
      out.push({ ctrl: [P(0.02, y), P(0.16, y + 0.01), P(0.3, y - 0.01), P(0.44, y - 0.02 * j)], widths: [0.14, 0.14, 0.13, 0.1], surfs: [n, n, n, n], col: j === 1 ? [0.78, 0.26, 0.15] : [0.86, 0.33, 0.18], key: `item:${k}:flag${j}`, load: 0.7, dry: 0.25, heart: 0.35, body: 0.001, taper: [0.01, 0.06] });
  }
  return out;
}
