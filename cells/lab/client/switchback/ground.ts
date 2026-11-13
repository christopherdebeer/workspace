/**
 * Switchback's ground beside the road: the cross-section the world is drawn from, station by station (high up the wall on
 * the left, far down the drop on the right), its character drifting as you go down. The drawing builds its faces from it,
 * and the rider rides on it when off the road, so what you see under the wheels is what holds them.
 */
import { Course, hash } from './course';

/** the cross-section, wall side then drop side: how far out from the track's edge, and how far up (or down) */
export const WALL: [number, number][] = [[1.4, 0], [2.8, 3.8], [5.5, 12], [10, 24], [18, 39], [31, 58], [52, 84]];
export const DROP: [number, number][] = [[2.6, -0.05], [4.2, -2], [10, -10], [20, -24], [36, -44], [62, -74], [104, -114], [165, -165]];
export const STEP = 4;

/** a smooth value noise along the course (for how the mountain's character changes as you go down it) */
export function drift(seed: number, x: number, salt: number) {
  const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  return hash(seed, i, salt) * (1 - s) + hash(seed, i + 1, salt) * s;
}
/** the mountain's character at station i: how sheer the wall is (0 a snowy bank, 1 a cliff), how sheer the drop is (0 a
 * shelf, 1 straight down), and how much of a rock outcrop stands between the route and the drop */
export function character(c: Course, i: number) {
  const wall = drift(c.seed, i / 70, 1), drop = drift(c.seed, i / 90, 2), k = drift(c.seed, i / 34, 3);
  return { wall, drop, knob: Math.max(0, Math.min(1, (k - 0.6) / 0.25)) };
}

/** the ground's height across the section at station i (no track lift; a kicker's gap is a ravine): points (u, y) from
 * high up the wall to far down the drop, each with its jitter along the line (ds) */
export function section(c: Course, i: number) {
  const st = c.at(i), half = st.width / 2, out: { u: number; y: number; ds: number }[] = [];
  const j = (k: number, amp: number) => (hash(c.seed, i, k) - 0.5) * amp;
  const ch = character(c, i), wy = 0.25 + 0.95 * ch.wall, wu = 1.9 - 0.9 * ch.wall, dyk = 0.3 + 0.7 * ch.drop, duk = 1.9 - 0.9 * ch.drop;
  for (let k = WALL.length - 1; k >= 0; k--) { const [du0, dy0] = WALL[k], du = du0 * (k ? wu : 1), dy = dy0 * wy; out.push({ u: -half - du + (k ? j(k, du * 0.3) : 0), y: st.y + dy + (k ? j(k + 20, 0.6 + dy * 0.35) : 0), ds: k > 1 ? j(k + 80, STEP * 0.9) : 0 }); }
  const natural = st.site && st.site !== 'built';
  // (under the road the ground sinks away from it, so the two never lie in one plane: a little at its edges, more under its
  // middle, where the road's own roughness and the 4 m between sections would otherwise bring the ground up through it)
  const under = -0.15, sink = 0.3;
  // (a natural take-off: the ground itself rises under the ramp, a mound of snow and rock, not a trestle)
  const mound = st.feature === 'ramp' && natural ? st.lift : 0;
  out.push({ u: -half, y: st.y + under + mound * 0.9, ds: 0 }, { u: -half * 0.3, y: st.y + under - sink + mound - 0.15 * Math.sign(mound), ds: 0 }, { u: half * 0.3, y: st.y + under - sink + mound - 0.15 * Math.sign(mound), ds: 0 }, { u: half, y: st.y + under + mound * 0.9, ds: 0 });
  // (the drop: a shelf where it's gentle, straight down where it's sheer; an outcrop of rock rising beside the route where
  // the knob's up, the valley beyond it)
  const knob = [0, 4.5, 7, 3, 0, 0, 0, 0];
  for (let k = 0; k < DROP.length; k++) { const [du0, dy0] = DROP[k], du = du0 * (k ? duk : 1), dy = dy0 * (k ? dyk : 1) + knob[k] * ch.knob; out.push({ u: half + du + (k ? j(k + 40, du * 0.25) : 0), y: st.y + dy + (k > 1 ? j(k + 60, 0.6 - dy * 0.22) : 0), ds: k > 1 ? j(k + 90, STEP * 0.9) : 0 }); }
  if (mound) { out[WALL.length - 1].y += mound * 0.45; out[WALL.length + 4].y += mound * 0.35; }
  return out;
}

/** a natural gap's notch at station i, u across: how far below the ground as it would be the mountainside is cut there.
 * The whole way across: a cleft (narrow, sheer-sided, ~7 m deep) or a gorge (wide, ~20 m and more), deepest under the road,
 * running up the wall as a gully (shallower the higher) and on down the drop as a channel */
export function notch(c: Course, i: number, u: number) {
  const st = c.at(i);
  if (st.feature !== 'gap') return 0;
  // (no flat floor: the sides fall steeply from the lips and meet in a V, a stream's channel cut down its middle; the bed
  // falls away down the mountain (deeper toward the drop, as water runs), and it's rough with rock)
  const t = Math.max(0, Math.min(1, st.gapT ?? 0.5)), deep = st.site === 'gorge' ? 18 + (st.size === 4 ? 8 : 0) : 7;
  const v = Math.sin(Math.PI * t), channel = Math.max(0, 1 - Math.abs(t - 0.5) / 0.09);
  const D = deep * (0.25 * Math.min(1, v * 4) + 0.75 * v ** 1.6) + channel * (st.site === 'gorge' ? 2.2 : 1), half = st.width / 2;
  const f = u < -half ? Math.max(0.35, 0.85 - (0.5 * (-half - u)) / 50) : u <= half ? 0.85 + 0.15 * (u / half) : Math.max(0.45, 1 - (0.55 * (u - half)) / 120);
  const rough = 1 + 0.16 * (hash(c.seed, i, Math.round(u / 1.5), 41) - 0.5);
  return D * f * rough;
}

/** the height of a section at u across it */
export function groundAt(sec: { u: number; y: number }[], u: number) {
  for (let k = 0; k < sec.length - 1; k++) if (u >= sec[k].u && u <= sec[k + 1].u) { const f = (u - sec[k].u) / (sec[k + 1].u - sec[k].u || 1); return sec[k].y + (sec[k + 1].y - sec[k].y) * f; }
  return sec[u < sec[0].u ? 0 : sec.length - 1].y;
}

/** the ground (beside the road, not the road itself) at (s, u): between the sections the drawing is built from, every
 * STEP stations, as its faces lie (near the road's edge exactly; further out a little smoothed) */
export function ground(c: Course, s: number, u: number) {
  const s0 = Math.floor(s / STEP) * STEP, f = (s - s0) / STEP;
  return groundAt(section(c, s0), u) * (1 - f) + groundAt(section(c, s0 + STEP), u) * f - notch(c, Math.round(s), u);
}
