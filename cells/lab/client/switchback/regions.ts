/**
 * The course's regions (`mood=course`, a flag for now): one descent, three things changing, each tied to what it belongs
 * to, after Astra's notes. Light, by how far down the course you are, across the whole scene (keyed to the station, so a
 * respawn at a checkpoint has the light that belongs there): the clear day at the top, warming below the cloud, toward
 * golden hour further down. Atmosphere, by altitude: a belt of cloud at a height partway down (seeded), above which the
 * valley's under a sea of cloud and the far ranges rise out of it, inside which the air closes in to tens of metres, and
 * below which it's a grey ceiling. Terrain, by place, built into the ground as it's laid: below a snowline under the belt,
 * the snow gives way to grass, patchy at its edge, the road's drifts dwindle and the pines thicken.
 */
import type { Course } from './course';
import { hash } from './course';

export type Time = 'day' | 'dusk' | 'night';
export const TIMES: Time[] = ['day', 'dusk', 'night'];
export const REGION = { on: false, beltS: 0, beltY: 0, half: 70, snowY: 0, seed: 1, time: 'day' as Time };
/** the regions for a mountain: where the belt is (its station and height), the snowline under it */
/** (time: the run's time of day, `time=day|dusk|night`; unset, the mountain's own, by its seed: day half the time,
 * dusk a third, night the rest) */
export function setRegions(c: Course, time?: string | null) {
  REGION.on = true; REGION.seed = c.seed;
  const r = hash(c.seed, 5, 74);
  REGION.time = (TIMES as string[]).includes(time ?? '') ? (time as Time) : r < 0.5 ? 'day' : r < 0.83 ? 'dusk' : 'night';
  REGION.beltS = 1000 + Math.round(hash(c.seed, 3, 71) * 500);
  REGION.beltY = c.point(REGION.beltS, 0).y;
  REGION.snowY = REGION.beltY - REGION.half - 20;
}
/** how far below the snowline a point is, 0 (snow) to 1 (grass), patchy round the line (by place) */
export function grassiness(x: number, y: number, z: number) {
  if (!REGION.on) return 0;
  const patch = (hash(REGION.seed, Math.round(x / 9), Math.round(z / 9), 72) - 0.5) * 60;
  return Math.max(0, Math.min(1, (REGION.snowY + patch - y) / 50));
}
/** the light's keys down the course, (station, mood): the run's time of day, drifting on as you go down (a day run warms
 * toward golden hour by the end of a long one; a dusk run darkens into night; night stays night). Not the terrain: the
 * lower slopes' grass and earth are laid in the ground, and coloured by whatever light there is */
export function lightKeys(): [number, string][] {
  return REGION.time === 'day' ? [[0, 'day'], [1500, 'day'], [5000, 'gold']] : REGION.time === 'dusk' ? [[0, 'gold'], [1800, 'gold'], [4500, 'moon']] : [[0, 'moon']];
}
