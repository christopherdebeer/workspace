// One limb, three ways (?scene=limb): the root tunnel's third arch out of the room, on its own, laid with the same
// number of deposits each way, and a camera that comes in to it from far off, turning round it as it comes:
// - **in parts**: the room's limb as it is (conservatory.ts `limbParts`): one loaded stroke far off, handing over by
//   its width on the screen to a line along each edge with a graded stroke between;
// - **a sweep**: one pass of a loaded brush (`limbSweep`): its pressure along it drives its width, its coverage and its
//   load together, so it thins into streaks and breaks where it's light and frays where it lifts;
// - **a sweep with accents**: the same with stretches of a line along one edge or the other, each there or not.
// The sweep's style is fitted to how the teacher's strokes run along themselves (devtools/splats-limb.mjs).
import { conservatory, limbParts, limbSweep, type AccentStyle, type RootParts, type SweepStyle } from './conservatory';
import type { Mark, V } from './marks';

export type LimbWay = 'parts' | 'sweep' | 'accents';
export const LIMB_WAYS: Array<[LimbWay, string]> = [['parts', 'in parts'], ['sweep', 'a sweep'], ['accents', 'a sweep with accents']];
export interface LimbStyle { sweep: SweepStyle; accent: AccentStyle }
/** the limb, where the camera looks, and how far off it starts and ends (m); its field of view the room's */
export const LIMB = { key: 'tunnel/arch 2', at: [-5.6, 2.75, 1.05] as V, far: 14, close: 2.2, eyeY: 1.8, fov: (55 * Math.PI) / 180 };

/** the limb's marks one way; every way lays as many deposits as the limb in parts does */
export function limbMarks(way: LimbWay, parts: RootParts, style: LimbStyle, key = LIMB.key): Mark[] {
  const m = conservatory({}).marks.find((x) => x.key === key); if (!m) return [];
  const fresh = (): Mark => ({ ...m, params: m.params.slice(), resid: m.resid.slice(), view: m.view.slice() });
  const inParts = limbParts(fresh(), parts); if (way === 'parts') return inParts;
  const budget = inParts.reduce((a, q) => a + q.count, 0);
  return limbSweep(fresh(), way === 'accents' ? { ...style.sweep, accent: style.accent } : { ...style.sweep, accent: undefined }, budget);
}
/** the eye `d` metres from where it looks: at standing height, 10° off square to the arch far off, 45° close to */
export function limbEye(d: number): { eye: V; at: V } {
  const k = Math.max(0, Math.min(1, Math.log(LIMB.far / d) / Math.log(LIMB.far / LIMB.close))), a = ((10 + 35 * k) * Math.PI) / 180;
  // (square to the arch: across the line between its feet)
  const n: V = [-0.507, 0, 0.862], al: V = [-0.862, 0, -0.507], dy = LIMB.eyeY - LIMB.at[1], h = Math.sqrt(Math.max(0.01, d * d - dy * dy));
  return { eye: [LIMB.at[0] + h * (n[0] * Math.cos(a) + al[0] * Math.sin(a)), LIMB.eyeY, LIMB.at[2] + h * (n[2] * Math.cos(a) + al[2] * Math.sin(a))], at: LIMB.at };
}
