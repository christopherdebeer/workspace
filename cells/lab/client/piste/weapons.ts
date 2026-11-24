/**
 * The weapons, as data. Everything physical about a weapon (its length, how its mass is spread, how stiff its blade
 * is, its guard) and everything the scoring apparatus needs (the tip's spring, how long it must stay closed, the
 * lockout) lives here, so a new weapon is a new entry and nothing else.
 *
 * Numbers are from the FIE material rules where they exist (blade length, guard size, tip spring, lockout) and
 * otherwise measured or estimated and left as dials (stiffness, how the mass is spread). Sabre (a cutting weapon,
 * with no tip button) needs a different registration, so it isn't here yet.
 */
export interface Weapon {
  name: string;
  /** guard to tip, m */
  blade: number;
  /** pommel to guard (the grip and the hand round it), m */
  grip: number;
  /** blade segments */
  segments: number;
  /** blade mass, kg, and how much more of it is at the forte than the foible (a tapered blade) */
  bladeMass: number; taper: number;
  /** the blade's bending stiffness EI, N·m² (at the forte; tapers toward the tip) */
  EI: number; EItip: number;
  /** the set a fencer puts in the blade: curvature, rad per metre, down from the thumb */
  set: number;
  /** blade half-thickness at the forte and at the tip, m (for contact) */
  rForte: number; rTip: number;
  /** the guard, a spherical bell: rim radius and depth, m */
  guardR: number; guardDepth: number;
  /** the tip: the force that closes it, N; how long it must stay closed to register, s; contact stiffness, N/m */
  tipForce: number; tipDwell: number; tipK: number;
  /** after the first touch, how long the other may still register, s */
  lockout: number;
  /** which parts of the body are valid target */
  target: (part: Part) => boolean;
}
export type Part = 'head' | 'torso' | 'arm' | 'hand' | 'leg' | 'foot';

export const EPEE: Weapon = {
  name: 'épée',
  blade: 0.9, grip: 0.11, segments: 12,
  bladeMass: 0.32, taper: 2.4,
  EI: 9, EItip: 2.2, set: 0.12,
  rForte: 0.0045, rTip: 0.0028,
  guardR: 0.0675, guardDepth: 0.055,
  // (750 g; the apparatus wants it closed 2 ms or so; épée's double-touch window is 40–50 ms)
  tipForce: 7.35, tipDwell: 0.002, tipK: 6000,
  lockout: 0.045,
  target: () => true,
};

export const FOIL: Weapon = {
  name: 'foil',
  blade: 0.9, grip: 0.11, segments: 12,
  bladeMass: 0.26, taper: 2.2,
  EI: 5.5, EItip: 1.2, set: 0.14,
  rForte: 0.004, rTip: 0.0024,
  guardR: 0.06, guardDepth: 0.03,
  // (500 g, 13–15 ms closed, 300 ms lockout; right of way decides a double, which the box doesn't)
  tipForce: 4.9, tipDwell: 0.014, tipK: 6000,
  lockout: 0.3,
  target: (p) => p === 'torso',
};

export const WEAPONS: Record<string, Weapon> = { epee: EPEE, foil: FOIL };
