/**
 * A scripted study of standing and small moves: from a stand, short light pushes of the stick in different directions
 * (aside, back, a diagonal, a turn right round, a little forward walk), each let go to stand again. Relative to the way
 * the body faced at the start. `?brush=1` films it; the tests measure it. What it shows is the feet: whether they stay
 * where they're put and step to keep the body over them, or slide.
 */
import type { Input } from './runner';

/** [start (s), length (s), direction (rad, 0 = the way it faces, positive to its left), how hard (0..1)] */
export const BRUSHES: [number, number, number, number][] = [
  [0.6, 0.25, Math.PI / 2, 0.35],
  [1.6, 0.3, Math.PI, 0.4],
  [2.6, 0.2, -Math.PI / 2, 0.3],
  [3.5, 0.35, Math.PI / 4, 0.45],
  [4.6, 0.45, Math.PI, 0.25],
  [5.7, 0.7, 0, 0.3],
  [6.9, 0.3, -2.4, 0.5],
];
export const BRUSH_SECONDS = 8.2;

/** what's asked at `t`, for a body that faced `heading` at the start */
export function brushInput(t: number, heading: number): Input {
  for (const [at, len, dir, mag] of BRUSHES) if (t >= at && t < at + len) { const a = heading + dir; return { x: Math.sin(a) * mag, z: Math.cos(a) * mag, jump: false }; }
  return { x: 0, z: 0, jump: false };
}
