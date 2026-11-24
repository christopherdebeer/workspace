/**
 * The scoring apparatus, which knows nothing of bodies or blades: it is told, each substep, whether each fencer's tip
 * is closed and on what, and it does what the real box does. A tip must stay closed for the weapon's dwell to
 * register; the first touch starts the lockout, and the other fencer's touch still counts inside it; when it runs
 * out, the box locks and the lights stay.
 *
 * What a light is worth (a point, nothing, a call for the referee) is the rules' business, not the box's: see `award`.
 */
import type { Part, Weapon } from './weapons';

export interface Light {
  /** valid target (coloured) or off target (white, where the weapon has one) */
  valid: boolean;
  part: Part;
  /** when it registered, s */
  t: number;
}

export class Box {
  lights: [Light | null, Light | null] = [null, null];
  first: number | null = null;
  /** how long each tip has been closed on what it's on now, s */
  closed: [number, number] = [0, 0];
  constructor(readonly weapon: Weapon) {}

  /** one substep: fencer i's tip closed (on `part`) or not */
  tip(i: 0 | 1, t: number, h: number, on: Part | null) {
    if (this.locked(t)) return;
    if (!on) { this.closed[i] = 0; return; }
    this.closed[i] += h;
    if (this.closed[i] + 1e-9 >= this.weapon.tipDwell && !this.lights[i]) this.register(i, t, on);
  }

  register(i: 0 | 1, t: number, part: Part) {
    if (this.lights[i] || this.locked(t)) return;
    if (this.first === null) this.first = t;
    this.lights[i] = { valid: this.weapon.target(part), part, t };
  }

  /** past the lockout after a first touch: nothing more registers */
  locked(t: number) { return this.first !== null && t - this.first > this.weapon.lockout; }
  reset() { this.lights = [null, null]; this.first = null; this.closed = [0, 0]; }
}

/** What the lights are worth: points to each fencer, and a word for it. Épée: every valid light is a point (a double
 * is a point each). Foil: one valid light alone is a point; off target, or both, are for the referee (right of way
 * isn't judged yet), so nothing. */
export function award(weapon: Weapon, lights: [Light | null, Light | null]): { points: [number, number]; call: string } {
  const [a, b] = lights;
  if (weapon.name === 'épée') {
    const p: [number, number] = [a?.valid ? 1 : 0, b?.valid ? 1 : 0];
    return { points: p, call: p[0] && p[1] ? 'coup double' : p[0] ? 'touch' : p[1] ? 'touched' : '' };
  }
  if (a && b) return { points: [0, 0], call: 'both lights: priority (not judged)' };
  const one = a ?? b, who = a ? 0 : 1;
  if (!one) return { points: [0, 0], call: '' };
  if (!one.valid) return { points: [0, 0], call: 'off target' };
  return { points: who === 0 ? [1, 0] : [0, 1], call: who === 0 ? 'touch' : 'touched' };
}
