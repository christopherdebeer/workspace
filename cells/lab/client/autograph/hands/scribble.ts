/**
 * BEFORE LETTERS — the scribbles made on 3 November 2026 to fill a Switchback leaderboard for a screenshot, before there
 * was any hand: a looping line and a stroke under it, from a few numbers. Kept as the screenshot script made them (only
 * reshaped into a function of its own), and never edited.
 *
 * A sine wave run left to right, its height the absolute of another, a third pulling it about; then a bowed line under it.
 * The timing is a fiction: a hundredth of a second a point, and every seventh point lingering, so the ink looks as though
 * the hand slowed now and then.
 */
import type { Sig } from '../../switchback/sign';

/** one scribble: `seed` a phase, `n` how many loops, `w` how far across */
export function scribble(seed: number, n: number, w: number): Sig {
  const out: Sig = [];
  let t = 0;
  const s: number[] = [];
  for (let i = 0; i <= 120; i++) {
    const u = i / 120, a = u * Math.PI * 2 * n;
    s.push(Math.round(80 + w * u + 140 * Math.sin(a + seed)), Math.round(560 - 260 * Math.abs(Math.sin(a * 0.5 + seed)) - 80 * Math.cos(a * 1.3)), t);
    t += 1 + (i % 7 < 2 ? 3 : 0);
  }
  out.push(s);
  const f: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    f.push(Math.round(120 + w * 0.9 * u), Math.round(760 - 60 * Math.sin(u * Math.PI)), t);
    t += 1;
  }
  out.push(f);
  return out;
}

/** the five that were signed on that board (seed, loops, width), top to bottom */
export const FIVE: [number, number, number][] = [[4, 3, 2400], [9, 1.3, 1800], [1, 4.5, 2900], [12, 2, 2000], [7, 3.4, 1500]];
