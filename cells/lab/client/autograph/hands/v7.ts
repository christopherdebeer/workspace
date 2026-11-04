/**
 * HAND v7 — session 11, 4 November 2026. Kept as it was once used: a changed hand is a new file.
 *
 * v6, and emphasis, the ways a hand has of it. Type has italic and bold; a hand has older means. It underlines (after
 * the word, as it dots an i); it slows and presses, so the ink comes heavier by itself (the pen's own body, not a
 * second weight); it writes bigger; it prints a word letter by letter when it has to be read exactly; and it writes an
 * aside smaller and quicker. Text comes marked as I write it: *stress* or _stress_, **strong**, `literal`, and (an
 * aside). How each is written is a table (`MANNERS`), so the means can be tried against each other. Unmarked, v7 writes
 * exactly as v6 did, point for point.
 *
 * v6 was v5, and two habits learned from being misread, a day later:
 *
 * - **An e keeps its eye, however it's come into.** v5's e drew its eye's crossbar with its lead-in, the stroke up from
 *   the baseline. Where the lead-in is left off (starting a word, after a letter that goes out high, after a lift) the
 *   crossbar went with it and the e was a c: are read arc, every cvery, themselves themsclvcs. It's session 1's c the
 *   other way round. Now an e that isn't joined from below begins on its crossbar (`top`), draws it, and goes round:
 *   the way an e is written after o, v or w.
 * - **The apostrophe sits with its word.** v5's air either side of marks reached the apostrophe too, and didn't came
 *   apart as didn 't. A hand writes an apostrophe into the word, so it has no air now.
 *
 * v5 was v4, and what writing at the length of a page showed:
 *
 * - **Air around capitals, figures and marks.** Their widths were the width of what was drawn, so set side by side the
 *   pen's own thickness met its neighbour's: 7E, GE, TT, WW, VW all touched. A hand leaves space between capitals
 *   without thinking about it; now this one does (`AIR` either side).
 * - **Flatter accents on capitals.** At the font's line spacing an accent on a capital reached into the descenders of
 *   the line above. People write them lower and smaller over a capital; now this hand does too.
 * - **A page.** `page()` writes a paragraph as one sitting: one writing's draw for all of it (its pace, size, slant), the
 *   lines broken at a width as a hand breaks them, each line starting a little off the margin and running a little off
 *   level, as lines do.
 */
import type { Sig } from '../../switchback/sign';

/** a letter: how far it moves the pen on; its stroke's points (x, y pairs); how many of the first are the lead-in (left
 * off at the start of a word or after a lift); whether it goes out high (across the top into the next letter); whether
 * the pen lifts before it, or before and after it (`alone`); its marks (strokes of their own, made after the word); the
 * strokes it makes before its last one, each on its own (`pre`); and (from v6) its stroke when it isn't joined from
 * below, where leaving off the lead-in isn't enough (`top`: an e's crossbar is its lead-in) */
type Glyph = { w: number; p: number[]; lead?: number; high?: boolean; lift?: boolean; alone?: boolean; marks?: number[][]; pre?: number[][]; top?: number[] };

const LOOP = [0.3, 0.9, 0.46, 1.6, 0.42, 1.95, 0.3, 1.85, 0.22, 1.2, 0.16, 0.4];
const BOWL = [0.35, 0.75, 0.6, 0.95, 0.38, 1, 0.12, 0.75, 0.06, 0.3, 0.22, 0.02, 0.45, 0.15, 0.6, 0.55];

const G: Record<string, Glyph> = {
  a: { w: 0.86, lead: 2, p: [0, 0.12, ...BOWL, 0.64, 0.98, 0.6, 0.35, 0.64, 0.04, 0.86, 0.16] },
  b: { w: 0.86, lead: 1, high: true, p: [0, 0.12, ...LOOP, 0.17, 0.02, 0.22, 0.5, 0.42, 0.88, 0.62, 0.72, 0.58, 0.2, 0.36, 0.02, 0.2, 0.12, 0.4, 0.42, 0.62, 0.62, 0.86, 0.7] },
  c: { w: 0.64, lead: 2, lift: true, p: [0, 0.14, 0.42, 0.8, 0.5, 0.95, 0.36, 1, 0.12, 0.82, 0, 0.42, 0.1, 0.08, 0.34, 0, 0.64, 0.18] },
  d: { w: 0.9, lead: 2, p: [0, 0.12, ...BOWL, 0.74, 1.9, 0.66, 0.4, 0.68, 0.04, 0.9, 0.16] },
  e: { w: 0.66, lead: 1, p: [0, 0.12, 0.36, 0.42, 0.5, 0.72, 0.36, 0.92, 0.14, 0.7, 0.08, 0.3, 0.24, 0.02, 0.66, 0.16],
    // (not joined from below: in on the crossbar's left end, across it, and round, so the eye closes)
    top: [0.07, 0.44, 0.3, 0.47, 0.47, 0.6, 0.44, 0.84, 0.3, 0.93, 0.13, 0.78, 0.07, 0.42, 0.12, 0.13, 0.3, 0.01, 0.66, 0.16] },
  f: { w: 0.7, lead: 1, p: [0, 0.12, 0.3, 0.9, 0.48, 1.62, 0.44, 1.95, 0.32, 1.85, 0.26, 1.2, 0.2, 0, 0.14, -0.8, 0.08, -0.92, 0.04, -0.75, 0.2, -0.3, 0.48, 0.08, 0.7, 0.16], marks: [[0.02, 0.95, 0.48, 1]] },
  g: { w: 0.86, lead: 2, p: [0, 0.12, ...BOWL, 0.64, 0.98, 0.6, 0.3, 0.54, -0.6, 0.4, -0.92, 0.24, -0.85, 0.3, -0.45, 0.6, -0.05, 0.86, 0.16] },
  h: { w: 0.95, lead: 1, p: [0, 0.12, ...LOOP, 0.14, 0, 0.22, 0.55, 0.44, 0.98, 0.62, 0.85, 0.64, 0.3, 0.7, 0.02, 0.95, 0.16] },
  i: { w: 0.46, lead: 1, p: [0, 0.12, 0.16, 0.7, 0.22, 1, 0.18, 0.4, 0.22, 0.04, 0.46, 0.16], marks: [[0.25, 1.4, 0.28, 1.44]] },
  j: { w: 0.6, lead: 1, p: [0, 0.12, 0.16, 0.7, 0.22, 1, 0.18, 0, 0.12, -0.75, 0, -0.92, -0.08, -0.75, 0.1, -0.35, 0.36, -0.02, 0.6, 0.16], marks: [[0.25, 1.4, 0.28, 1.44]] },
  k: { w: 0.85, lead: 1, p: [0, 0.12, ...LOOP, 0.14, 0, 0.2, 0.5, 0.48, 0.95, 0.6, 0.76, 0.3, 0.48, 0.48, 0.36, 0.6, 0.04, 0.85, 0.16] },
  l: { w: 0.55, lead: 1, p: [0, 0.12, 0.32, 0.9, 0.46, 1.6, 0.42, 1.95, 0.3, 1.85, 0.22, 1.2, 0.18, 0.4, 0.26, 0.03, 0.55, 0.16] },
  m: { w: 1.22, lead: 1, p: [0, 0.1, 0.12, 0.75, 0.16, 1, 0.12, 0.4, 0.1, 0, 0.17, 0.55, 0.36, 0.98, 0.5, 0.85, 0.5, 0.3, 0.48, 0, 0.55, 0.55, 0.74, 0.98, 0.88, 0.85, 0.9, 0.3, 0.95, 0.02, 1.22, 0.16] },
  n: { w: 0.95, lead: 1, p: [0, 0.1, 0.12, 0.75, 0.16, 1, 0.12, 0.4, 0.1, 0, 0.18, 0.55, 0.4, 0.98, 0.58, 0.85, 0.6, 0.3, 0.66, 0.02, 0.95, 0.16] },
  o: { w: 0.9, lead: 2, high: true, p: [0, 0.12, 0.35, 0.75, 0.62, 0.95, 0.38, 1, 0.1, 0.75, 0.06, 0.3, 0.24, 0.02, 0.5, 0.12, 0.64, 0.5, 0.62, 0.92, 0.72, 0.84, 0.9, 0.86] },
  p: { w: 0.88, lead: 1, p: [0, 0.1, 0.18, 0.95, 0.14, 0.2, 0.1, -0.95, 0.12, -0.3, 0.2, 0.55, 0.42, 0.98, 0.66, 0.75, 0.6, 0.2, 0.35, 0, 0.22, 0.1, 0.5, 0.05, 0.88, 0.18] },
  q: { w: 0.92, lead: 2, p: [0, 0.12, ...BOWL, 0.64, 0.98, 0.6, 0.2, 0.58, -0.9, 0.66, -0.55, 0.82, -0.2, 0.92, 0.16] },
  r: { w: 0.66, lead: 1, high: true, p: [0, 0.1, 0.14, 0.75, 0.18, 1, 0.15, 0.4, 0.13, 0, 0.2, 0.55, 0.36, 0.9, 0.52, 0.98, 0.66, 0.9] },
  s: { w: 0.74, alone: true, p: [0.58, 0.86, 0.44, 1, 0.2, 0.96, 0.1, 0.76, 0.24, 0.56, 0.48, 0.45, 0.62, 0.25, 0.5, 0.04, 0.24, 0, 0.04, 0.12] },
  t: { w: 0.58, lead: 1, p: [0, 0.12, 0.2, 0.8, 0.3, 1.55, 0.24, 0.5, 0.26, 0.04, 0.58, 0.16], marks: [[0.04, 0.95, 0.58, 1]] },
  u: { w: 0.9, lead: 1, p: [0, 0.1, 0.12, 1, 0.1, 0.3, 0.26, 0, 0.5, 0.35, 0.6, 1, 0.56, 0.3, 0.64, 0.02, 0.9, 0.16] },
  v: { w: 0.82, lead: 1, high: true, p: [0, 0.12, 0.14, 0.85, 0.16, 1, 0.26, 0.4, 0.36, 0, 0.52, 0.55, 0.6, 1, 0.64, 0.86, 0.82, 0.88] },
  w: { w: 1.12, lead: 1, high: true, p: [0, 0.12, 0.12, 0.85, 0.14, 1, 0.2, 0.3, 0.32, 0, 0.48, 0.62, 0.52, 0.72, 0.6, 0.2, 0.72, 0, 0.88, 0.6, 0.92, 1, 0.96, 0.86, 1.12, 0.88] },
  x: { w: 0.82, lead: 1, p: [0, 0.12, 0.2, 0.9, 0.3, 1, 0.42, 0.6, 0.55, 0.1, 0.65, 0, 0.82, 0.16], marks: [[0.62, 0.96, 0.2, 0.04]] },
  y: { w: 0.88, lead: 1, p: [0, 0.1, 0.12, 1, 0.1, 0.3, 0.26, 0, 0.5, 0.35, 0.6, 1, 0.58, 0, 0.52, -0.7, 0.38, -0.92, 0.24, -0.82, 0.32, -0.42, 0.62, -0.05, 0.88, 0.16] },
  z: { w: 0.82, lead: 1, p: [0, 0.12, 0.06, 0.88, 0.3, 1, 0.6, 0.98, 0.1, 0.05, 0.36, 0.1, 0.62, 0.02, 0.82, 0.16] },
  // (capitals: cap height 1.7)
  A: { w: 0.95, lift: true, alone: true, pre: [[0, 0, 0.2, 0.85, 0.42, 1.72, 0.6, 0.85, 0.82, 0]], p: [0.18, 0.62, 0.66, 0.66] },
  B: { w: 0.85, lift: true, alone: true, p: [0.1, 1.7, 0.08, 0, 0.1, 1, 0.12, 1.68, 0.5, 1.65, 0.62, 1.3, 0.4, 0.95, 0.12, 0.9, 0.5, 0.86, 0.72, 0.45, 0.55, 0.05, 0.08, 0.02] },
  C: { w: 1.1, lift: true, p: [0.9, 1.55, 0.98, 1.8, 0.78, 1.98, 0.42, 1.88, 0.1, 1.35, 0, 0.6, 0.22, 0.06, 0.62, 0, 0.9, 0.2] },
  D: { w: 0.95, lift: true, alone: true, p: [0.12, 1.7, 0.1, 0.02, 0.12, 1, 0.14, 1.66, 0.5, 1.62, 0.82, 1.2, 0.84, 0.5, 0.55, 0.06, 0.08, 0.04] },
  E: { w: 0.82, lift: true, p: [0.72, 1.7, 0.12, 1.7, 0.1, 0.02, 0.82, 0.14], marks: [[0.12, 0.88, 0.56, 0.9]] },
  F: { w: 0.78, lift: true, alone: true, pre: [[0.72, 1.7, 0.12, 1.7, 0.1, 0]], p: [0.12, 0.9, 0.55, 0.92] },
  G: { w: 0.95, lift: true, alone: true, p: [0.85, 1.45, 0.7, 1.7, 0.35, 1.65, 0.08, 1.2, 0.05, 0.5, 0.3, 0.02, 0.7, 0.08, 0.85, 0.5, 0.85, 0.8, 0.5, 0.8] },
  H: { w: 0.95, lift: true, pre: [[0.1, 1.7, 0.08, 0]], p: [0.78, 1.7, 0.76, 0.02, 0.95, 0.14], marks: [[0.1, 0.88, 0.76, 0.9]] },
  I: { w: 0.62, lift: true, alone: true, pre: [[0.08, 1.7, 0.56, 1.72], [0.32, 1.7, 0.28, 0]], p: [0.04, 0, 0.52, 0.02] },
  J: { w: 0.9, lift: true, alone: true, pre: [[0.3, 1.7, 0.85, 1.72]], p: [0.62, 1.7, 0.6, 0.35, 0.45, 0, 0.18, 0.04, 0.05, 0.32] },
  K: { w: 0.95, lift: true, pre: [[0.1, 1.7, 0.08, 0]], p: [0.75, 1.7, 0.12, 0.8, 0.45, 0.6, 0.78, 0.02, 0.95, 0.14] },
  L: { w: 0.8, lift: true, p: [0.12, 1.7, 0.1, 0.02, 0.8, 0.14] },
  M: { w: 1.15, lift: true, p: [0.06, 0, 0.12, 1.7, 0.5, 0.55, 0.88, 1.7, 0.94, 0.02, 1.15, 0.14] },
  N: { w: 0.92, lift: true, alone: true, p: [0.08, 0, 0.12, 1.7, 0.78, 0.02, 0.82, 1.7] },
  O: { w: 0.98, lift: true, alone: true, p: [0.55, 1.7, 0.2, 1.55, 0.04, 0.9, 0.18, 0.15, 0.5, 0, 0.82, 0.25, 0.9, 0.95, 0.72, 1.55, 0.45, 1.72, 0.3, 1.6] },
  P: { w: 0.82, lift: true, alone: true, p: [0.1, 1.7, 0.08, 0, 0.1, 0.9, 0.12, 1.68, 0.5, 1.66, 0.74, 1.3, 0.55, 0.88, 0.12, 0.84] },
  Q: { w: 1, lift: true, alone: true, pre: [[0.55, 1.7, 0.2, 1.55, 0.04, 0.9, 0.18, 0.15, 0.5, 0, 0.82, 0.25, 0.9, 0.95, 0.72, 1.55, 0.45, 1.72, 0.3, 1.6]], p: [0.5, 0.4, 0.95, -0.1] },
  R: { w: 0.95, lift: true, p: [0.1, 1.7, 0.08, 0, 0.1, 0.9, 0.12, 1.68, 0.5, 1.66, 0.74, 1.3, 0.55, 0.88, 0.14, 0.84, 0.45, 0.6, 0.78, 0.02, 0.95, 0.14] },
  S: { w: 0.8, lift: true, alone: true, p: [0.7, 1.5, 0.5, 1.72, 0.18, 1.6, 0.12, 1.25, 0.4, 0.95, 0.68, 0.6, 0.62, 0.15, 0.3, 0, 0.04, 0.2] },
  T: { w: 0.92, lift: true, alone: true, pre: [[0.48, 1.7, 0.44, 0]], p: [0.02, 1.7, 0.9, 1.74] },
  U: { w: 1.02, lift: true, p: [0.08, 1.7, 0.06, 0.5, 0.25, 0.02, 0.6, 0.05, 0.78, 0.5, 0.8, 1.7, 0.78, 0.3, 0.82, 0.02, 1.02, 0.14] },
  V: { w: 0.88, lift: true, alone: true, p: [0.04, 1.7, 0.42, 0, 0.84, 1.72] },
  W: { w: 1.12, lift: true, alone: true, p: [0.02, 1.7, 0.28, 0, 0.55, 1.2, 0.8, 0, 1.08, 1.72] },
  X: { w: 0.88, lift: true, alone: true, pre: [[0.06, 1.7, 0.8, 0]], p: [0.8, 1.7, 0.06, 0] },
  Y: { w: 0.88, lift: true, alone: true, pre: [[0.05, 1.7, 0.42, 0.9]], p: [0.82, 1.7, 0.4, 0.9, 0.38, 0] },
  Z: { w: 0.98, lift: true, p: [0.08, 1.7, 0.8, 1.7, 0.06, 0.02, 0.98, 0.14] },
  // (figures: lining, 1.6 high)
  '0': { w: 0.78, alone: true, p: [0.42, 1.6, 0.12, 1.35, 0.05, 0.8, 0.15, 0.15, 0.4, 0, 0.62, 0.2, 0.7, 0.8, 0.62, 1.4, 0.4, 1.62, 0.3, 1.52] },
  '1': { w: 0.55, alone: true, p: [0.1, 1.3, 0.38, 1.62, 0.34, 0] },
  '2': { w: 0.82, alone: true, p: [0.08, 1.25, 0.25, 1.55, 0.5, 1.62, 0.7, 1.4, 0.65, 1, 0.06, 0.02, 0.75, 0.04] },
  '3': { w: 0.8, alone: true, p: [0.1, 1.45, 0.38, 1.62, 0.65, 1.45, 0.6, 1.05, 0.3, 0.88, 0.62, 0.75, 0.72, 0.35, 0.5, 0.02, 0.2, 0, 0.04, 0.2] },
  '4': { w: 0.85, alone: true, pre: [[0.55, 1.62, 0.04, 0.5, 0.8, 0.5]], p: [0.6, 1, 0.58, 0] },
  '5': { w: 0.82, alone: true, pre: [[0.22, 1.6, 0.16, 0.95, 0.4, 1.05, 0.62, 0.88, 0.66, 0.4, 0.48, 0.04, 0.22, 0.02, 0.06, 0.2]], p: [0.24, 1.62, 0.72, 1.66] },
  '6': { w: 0.78, alone: true, p: [0.62, 1.58, 0.35, 1.45, 0.12, 0.95, 0.08, 0.35, 0.3, 0, 0.58, 0.1, 0.66, 0.5, 0.45, 0.8, 0.18, 0.7, 0.1, 0.45] },
  '7': { w: 0.78, alone: true, p: [0.04, 1.6, 0.72, 1.62, 0.3, 0] },
  '8': { w: 0.8, alone: true, p: [0.6, 1.4, 0.38, 1.62, 0.15, 1.45, 0.2, 1.1, 0.42, 0.88, 0.68, 0.6, 0.65, 0.15, 0.38, 0, 0.12, 0.15, 0.1, 0.55, 0.38, 0.85, 0.6, 1.1, 0.62, 1.42, 0.5, 1.58] },
  '9': { w: 0.8, alone: true, p: [0.62, 1.25, 0.45, 1.6, 0.18, 1.5, 0.1, 1.15, 0.3, 0.9, 0.6, 1.05, 0.66, 1.4, 0.62, 0.6, 0.55, 0] },
  // (marks)
  '!': { w: 0.42, alone: true, pre: [[0.22, 1.7, 0.16, 0.5]], p: [0.12, 0.06, 0.17, 0.01] },
  '"': { w: 0.5, alone: true, pre: [[0.14, 1.75, 0.08, 1.42]], p: [0.34, 1.75, 0.28, 1.42] },
  '#': { w: 0.85, alone: true, pre: [[0.25, 1.4, 0.15, 0.2], [0.6, 1.4, 0.5, 0.2], [0.02, 1, 0.75, 1]], p: [-0.02, 0.55, 0.7, 0.55] },
  $: { w: 0.75, alone: true, pre: [[0.62, 1.3, 0.45, 1.5, 0.18, 1.42, 0.14, 1.1, 0.4, 0.85, 0.62, 0.5, 0.55, 0.12, 0.3, 0.02, 0.05, 0.2]], p: [0.38, 1.75, 0.34, -0.2] },
  '%': { w: 0.9, alone: true, pre: [[0.22, 1.55, 0.08, 1.35, 0.15, 1.12, 0.32, 1.2, 0.35, 1.45, 0.22, 1.55], [0.78, 1.6, 0.08, 0]], p: [0.62, 0.45, 0.48, 0.25, 0.55, 0.02, 0.72, 0.1, 0.75, 0.35, 0.62, 0.45] },
  '&': { w: 0.95, alone: true, p: [0.85, 0, 0.3, 0.75, 0.15, 1.2, 0.3, 1.55, 0.5, 1.45, 0.48, 1.15, 0.12, 0.6, 0.12, 0.2, 0.38, 0, 0.65, 0.15, 0.85, 0.6] },
  '(': { w: 0.5, alone: true, p: [0.42, 1.8, 0.15, 1.2, 0.1, 0.4, 0.38, -0.3] },
  ')': { w: 0.5, alone: true, p: [0.08, 1.8, 0.35, 1.2, 0.4, 0.4, 0.12, -0.3] },
  '*': { w: 0.66, alone: true, pre: [[0.35, 1.6, 0.3, 1], [0.08, 1.42, 0.58, 1.18]], p: [0.58, 1.45, 0.06, 1.15] },
  '+': { w: 0.75, alone: true, pre: [[0.36, 1.15, 0.34, 0.25]], p: [0, 0.7, 0.7, 0.72] },
  '-': { w: 0.58, alone: true, p: [0.06, 0.62, 0.5, 0.66] },
  '/': { w: 0.75, alone: true, p: [0.7, 1.75, 0.04, -0.2] },
  ':': { w: 0.38, alone: true, pre: [[0.15, 0.85, 0.19, 0.8]], p: [0.12, 0.06, 0.16, 0.01] },
  ';': { w: 0.4, alone: true, pre: [[0.17, 0.85, 0.21, 0.8]], p: [0.14, 0.08, 0.08, -0.24] },
  '<': { w: 0.78, alone: true, p: [0.7, 1.15, 0.06, 0.7, 0.7, 0.25] },
  '=': { w: 0.74, alone: true, pre: [[0.04, 0.92, 0.66, 0.94]], p: [0.04, 0.48, 0.66, 0.5] },
  '>': { w: 0.78, alone: true, p: [0.06, 1.15, 0.7, 0.7, 0.06, 0.25] },
  '?': { w: 0.72, alone: true, pre: [[0.08, 1.35, 0.3, 1.65, 0.6, 1.55, 0.62, 1.2, 0.35, 0.9, 0.3, 0.5]], p: [0.27, 0.06, 0.31, 0.01] },
  '@': { w: 1.2, alone: true, p: [0.68, 0.62, 0.5, 0.78, 0.3, 0.62, 0.3, 0.32, 0.5, 0.24, 0.66, 0.5, 0.7, 0.7, 0.66, 0.36, 0.76, 0.22, 0.98, 0.42, 1, 0.9, 0.72, 1.22, 0.28, 1.2, 0.02, 0.86, -0.02, 0.3, 0.25, -0.1, 0.65, -0.18, 0.95, -0.05] },
  '[': { w: 0.5, alone: true, p: [0.4, 1.8, 0.12, 1.8, 0.08, -0.3, 0.36, -0.3] },
  '\\': { w: 0.75, alone: true, p: [0.04, 1.75, 0.7, -0.2] },
  ']': { w: 0.5, alone: true, p: [0.08, 1.8, 0.36, 1.8, 0.32, -0.3, 0.04, -0.3] },
  '^': { w: 0.66, alone: true, p: [0.05, 1.25, 0.32, 1.65, 0.6, 1.25] },
  _: { w: 0.8, alone: true, p: [-0.02, -0.25, 0.8, -0.23] },
  '`': { w: 0.35, alone: true, p: [0.08, 1.75, 0.22, 1.5] },
  '{': { w: 0.52, alone: true, p: [0.45, 1.8, 0.25, 1.65, 0.24, 0.95, 0.08, 0.75, 0.22, 0.55, 0.2, -0.15, 0.42, -0.3] },
  '|': { w: 0.4, alone: true, p: [0.2, 1.85, 0.16, -0.35] },
  '}': { w: 0.52, alone: true, p: [0.08, 1.8, 0.28, 1.65, 0.28, 0.95, 0.44, 0.75, 0.3, 0.55, 0.3, -0.15, 0.08, -0.3] },
  '~': { w: 0.85, alone: true, p: [0.04, 0.65, 0.2, 0.82, 0.42, 0.65, 0.6, 0.5, 0.78, 0.68] },
  '\u2018': { w: 0.32, alone: true, p: [0.2, 1.42, 0.12, 1.56, 0.16, 1.75] },
  '\u2019': { w: 0.32, alone: true, p: [0.14, 1.75, 0.08, 1.42] },
  '\u201c': { w: 0.5, alone: true, pre: [[0.2, 1.42, 0.12, 1.56, 0.16, 1.75]], p: [0.4, 1.42, 0.32, 1.56, 0.36, 1.75] },
  '\u201d': { w: 0.5, alone: true, pre: [[0.14, 1.75, 0.08, 1.42]], p: [0.34, 1.75, 0.28, 1.42] },
  '\u2013': { w: 0.72, alone: true, p: [0.04, 0.65, 0.66, 0.68] },
  '\u2014': { w: 1.16, alone: true, p: [0.04, 0.65, 1.1, 0.68] },
  '\u2026': { w: 1, alone: true, pre: [[0.12, 0.06, 0.17, 0.01], [0.42, 0.06, 0.47, 0.01]], p: [0.72, 0.06, 0.77, 0.01] },
  '\u2022': { w: 0.55, alone: true, p: [0.25, 0.85, 0.33, 0.8, 0.3, 0.72, 0.22, 0.75, 0.25, 0.82] },
  '.': { w: 0.4, alone: true, p: [0.12, 0.06, 0.17, 0.01] },
  ',': { w: 0.4, alone: true, p: [0.14, 0.08, 0.08, -0.24] },
  "'": { w: 0.32, alone: true, p: [0.14, 1.75, 0.08, 1.42] },
  ' ': { w: 0.5, p: [] },
};

// (session 6: accents, and marks more, made from the letters there are)
/** the middle of a letter's body (x), not counting its lead-in or the stroke it goes out on: where an accent goes */
function centre(g: Glyph, cap: boolean) {
  let lo = Infinity, hi = -Infinity;
  for (const s of [...(g.pre ?? []), g.p.slice((g.lead ?? 0) * 2, cap || g.alone ? g.p.length : -2)]) {
    for (let i = 0; i < s.length; i += 2) if (s[i + 1] > 0.3 && s[i + 1] < (cap ? 1.8 : 1.1)) { lo = Math.min(lo, s[i]); hi = Math.max(hi, s[i]); }
  }
  return (lo + hi) / 2;
}
const ACCENT: Record<string, (cx: number, ty: number) => number[][]> = {
  acute: (cx, ty) => [[cx - 0.06, ty + 0.1, cx + 0.16, ty + 0.38]],
  grave: (cx, ty) => [[cx - 0.12, ty + 0.38, cx + 0.08, ty + 0.1]],
  circ: (cx, ty) => [[cx - 0.18, ty + 0.1, cx, ty + 0.36, cx + 0.18, ty + 0.1]],
  diaer: (cx, ty) => [[cx - 0.15, ty + 0.2, cx - 0.12, ty + 0.24], [cx + 0.12, ty + 0.2, cx + 0.15, ty + 0.24]],
  tilde: (cx, ty) => [[cx - 0.22, ty + 0.14, cx - 0.1, ty + 0.3, cx + 0.06, ty + 0.18, cx + 0.2, ty + 0.32]],
  ring: (cx, ty) => [[cx, ty + 0.38, cx - 0.12, ty + 0.27, cx - 0.04, ty + 0.12, cx + 0.12, ty + 0.18, cx + 0.12, ty + 0.32, cx, ty + 0.38]],
};
const ACCENTED: Record<string, [string, string[]]> = {
  a: ['a', ['\u00e1acute', '\u00e0grave', '\u00e2circ', '\u00e4diaer', '\u00e3tilde', '\u00e5ring']],
  e: ['e', ['\u00e9acute', '\u00e8grave', '\u00eacirc', '\u00ebdiaer']],
  i: ['i', ['\u00edacute', '\u00ecgrave', '\u00eecirc', '\u00efdiaer']],
  o: ['o', ['\u00f3acute', '\u00f2grave', '\u00f4circ', '\u00f6diaer', '\u00f5tilde']],
  u: ['u', ['\u00faacute', '\u00f9grave', '\u00fbcirc', '\u00fcdiaer']],
  y: ['y', ['\u00fdacute', '\u00ffdiaer']],
  n: ['n', ['\u00f1tilde']],
  A: ['A', ['\u00c1acute', '\u00c0grave', '\u00c2circ', '\u00c4diaer', '\u00c3tilde', '\u00c5ring']],
  E: ['E', ['\u00c9acute', '\u00c8grave', '\u00cacirc', '\u00cbdiaer']],
  I: ['I', ['\u00cdacute', '\u00ccgrave', '\u00cecirc', '\u00cfdiaer']],
  O: ['O', ['\u00d3acute', '\u00d2grave', '\u00d4circ', '\u00d6diaer', '\u00d5tilde']],
  U: ['U', ['\u00daacute', '\u00d9grave', '\u00dbcirc', '\u00dcdiaer']],
  Y: ['Y', ['\u00ddacute']],
  N: ['N', ['\u00d1tilde']],
};
for (const [base, list] of Object.values(ACCENTED)) {
  const g = G[base], cap = base !== base.toLowerCase(), cx = centre(g, cap), ty = cap ? 1.76 : 1.02;
  for (const item of list) {
    const ch = item[0], kind = item.slice(1);
    // (an i with an accent loses its dot; everything else keeps what it had, and the accent comes after the word)
    // (over a capital, an accent is written smaller, just clear of the letter: it mustn't reach into the line above)
    const acc = ACCENT[kind](cx, ty).map((s) => (cap ? s.map((v, i) => (i % 2 ? 1.85 + (v - ty - 0.1) * 0.55 : cx + (v - cx) * 0.85)) : s));
    G[ch] = { ...g, marks: [...(base === 'i' ? [] : g.marks ?? []), ...acc] };
  }
}
/** a cedilla, hooked under the foot of a c */
const cedilla = (cx: number) => [cx, 0.03, cx + 0.1, -0.14, cx - 0.02, -0.28, cx - 0.13, -0.24];
G['\u00e7'] = { ...G.c, marks: [cedilla(0.32)] };
G['\u00c7'] = { ...G.C, marks: [cedilla(0.6)] };
G['\u00f8'] = { ...G.o, marks: [[0.74, 1.12, 0.02, -0.1]] };
G['\u00d8'] = { ...G.O, marks: [[1, 1.88, 0, -0.12]] };
// (two letters run together: a's stroke into e's; o's into e's body)
G['\u00e6'] = { w: 1.26, lead: 2, p: [...G.a.p.slice(0, -2), ...G.e.p.map((v, i) => (i % 2 ? v : v + 0.6))] };
G['\u0153'] = { w: 1.28, lead: 2, p: [...G.o.p.slice(0, -4), ...G.e.p.slice(2).map((v, i) => (i % 2 ? v : v + 0.62))] };
G['\u00df'] = { w: 0.8, lift: true, alone: true, p: [0.1, 0, 0.12, 1.3, 0.28, 1.8, 0.55, 1.8, 0.62, 1.45, 0.38, 1.15, 0.65, 0.9, 0.7, 0.4, 0.5, 0.05, 0.28, 0.08] };
/** a letter's strokes (all of them), scaled and moved: for the fractions */
const strokesOf = (ch: string, s: number, dx: number, dy: number) => [...(G[ch].pre ?? []), G[ch].p, ...(G[ch].marks ?? [])].map((q) => q.map((v, i) => (i % 2 ? dy + v * s : dx + v * s)));
const fraction = (a: string, b: string): Glyph => {
  const all = [...strokesOf(a, 0.5, 0.02, 0.85), [0.86, 1.62, 0.12, 0], ...strokesOf(b, 0.5, 0.62, 0)];
  return { w: 1.12, alone: true, pre: all.slice(0, -1), p: all[all.length - 1] };
};
Object.assign(G, {
  '\u00b7': { w: 0.36, alone: true, p: [0.15, 0.64, 0.2, 0.6] },
  '\u20ac': { w: 0.86, alone: true, pre: [[0.78, 1.42, 0.58, 1.6, 0.28, 1.5, 0.12, 0.85, 0.24, 0.18, 0.52, 0, 0.8, 0.18], [0, 1, 0.6, 1.02]], p: [0, 0.7, 0.55, 0.72] },
  '\u00a3': { w: 0.86, alone: true, pre: [[0.7, 1.38, 0.56, 1.6, 0.32, 1.52, 0.26, 1.1, 0.24, 0.45, 0.08, 0.04, 0.78, 0.06]], p: [0.04, 0.82, 0.52, 0.84] },
  '\u00b0': { w: 0.45, alone: true, p: [0.22, 1.62, 0.1, 1.52, 0.14, 1.38, 0.28, 1.4, 0.33, 1.54, 0.22, 1.62] },
  '\u00d7': { w: 0.7, alone: true, pre: [[0.1, 1, 0.56, 0.4]], p: [0.56, 1, 0.1, 0.4] },
  '\u00f7': { w: 0.68, alone: true, pre: [[0, 0.7, 0.6, 0.72], [0.28, 1.08, 0.32, 1.04]], p: [0.26, 0.36, 0.3, 0.32] },
  '\u00a9': { w: 1.15, alone: true, pre: [[0.6, 1.55, 0.25, 1.42, 0.05, 0.8, 0.25, 0.15, 0.6, 0.02, 0.95, 0.2, 1.08, 0.8, 0.92, 1.4, 0.6, 1.55]], p: [0.72, 1, 0.6, 1.12, 0.42, 1.05, 0.36, 0.78, 0.44, 0.5, 0.62, 0.45, 0.74, 0.55] },
  '\u00a1': { w: 0.42, alone: true, pre: [[0.2, 0.95, 0.24, 0.91]], p: [0.22, 0.6, 0.15, -0.62] },
  '\u00bf': { w: 0.72, alone: true, pre: [[0.44, 0.95, 0.48, 0.91]], p: [0.46, 0.6, 0.42, 0.25, 0.14, -0.05, 0.1, -0.42, 0.36, -0.65, 0.62, -0.48] },
  '\u00ab': { w: 0.72, alone: true, pre: [[0.32, 0.95, 0.06, 0.62, 0.32, 0.3]], p: [0.62, 0.95, 0.36, 0.62, 0.62, 0.3] },
  '\u00bb': { w: 0.72, alone: true, pre: [[0.06, 0.95, 0.32, 0.62, 0.06, 0.3]], p: [0.36, 0.95, 0.62, 0.62, 0.36, 0.3] },
  '\u2713': { w: 1, alone: true, p: [0.04, 0.62, 0.3, 0.18, 0.95, 1.35] },
  '\u00bd': fraction('1', '2'),
  '\u00bc': fraction('1', '4'),
  '\u00be': fraction('3', '4'),
});

/** the space a hand leaves either side of a capital, a figure or a mark (x-heights) */
export const AIR = 0.1;
for (const [ch, g] of Object.entries(G)) {
  if (ch === ' ' || (ch.toLowerCase() === ch && ch.toUpperCase() !== ch) || ch === '\u00df') continue;
  // (an apostrophe is written into its word: no air)
  if (ch === "'" || ch === '\u2019') continue;
  const shift = (s: number[]) => s.map((v, i) => (i % 2 ? v : v + AIR));
  G[ch] = { ...g, w: g.w + 2 * AIR, p: shift(g.p), pre: g.pre?.map(shift), marks: g.marks?.map(shift) };
}

/** the letters v7 knows */
export const KNOWS = Object.keys(G).filter((c) => c !== ' ').join('');

/** how a hand writes, before a writing's own draw: its slant (x per y), size (x-height, in the pad's thousandths of its
 * height), spacing, pace (the pen's speed in x-heights a second where the line bends at a radius of one x-height), the
 * line's drift (rise per x-height across), and how much one writing differs from the next (1 is a hand's own) */
export type Style = { slant: number; size: number; track: number; pace: number; drift: number; vary: number };
export const STYLE: Style = { slant: 0.22, size: 220, track: 1, pace: 17, drift: 0.008, vary: 1 };

/** a seeded stream of numbers; `n()` a rough normal (mean 0, sd ~1) */
function stream(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const u = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return { u, n: () => (u() + u() + u() + u() - 2) * 1.73 };
}

/** a centripetal Catmull-Rom through the points, so many samples to a unit of length (as v0's) */
function spline(P: [number, number][], per = 24): [number, number][] {
  if (P.length < 2) return P.slice();
  const n = P.length, at = (i: number): [number, number] => i < 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]] : i >= n ? [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]] : P[i];
  const out: [number, number][] = [P[0]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const d = (a: number[], b: number[]) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * per));
    for (let k = 1; k <= steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps, q: [number, number] = [0, 0];
      for (let j = 0; j < 2; j++) {
        const a1 = ((t1 - t) * p0[j] + t * p1[j]) / t1, a2 = ((t2 - t) * p1[j] + (t - t1) * p2[j]) / (t2 - t1), a3 = ((t3 - t) * p2[j] + (t - t2) * p3[j]) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + t * a2) / t2, b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        q[j] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
      }
      out.push(q);
    }
  }
  return out;
}

/** the body: how long the pen takes over each step of a stroke. Its speed goes as the curvature to the −1/3 (the
 * two-thirds power law), capped where the line runs straight; it can only gain or lose so much speed over a distance,
 * so it starts from rest and ends at rest; and the speed is eased along the line, as a hand's is. Seconds from the
 * stroke's start, per point (x-height units). Where the line doubles back on itself (a cusp: the top of an i, the foot of
 * an n) the power law alone only slows it; a pen stops there, so it does */
const BRAKE = 0.08, ACCEL = 260, CUSP = 2;
function move(P: [number, number][], pace: number): number[] {
  const n = P.length, ds: number[] = [0], v: number[] = new Array(n);
  for (let i = 1; i < n; i++) ds.push(Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) { v[i] = pace * 0.15; continue; }
    const ax = P[i][0] - P[i - 1][0], ay = P[i][1] - P[i - 1][1], bx = P[i + 1][0] - P[i][0], by = P[i + 1][1] - P[i][1];
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)), len = Math.max(1e-4, (ds[i] + ds[i + 1]) / 2);
    v[i] = pace * Math.pow(Math.max(BRAKE, turn / len), -1 / 3);
    // (a cusp: the way in and the way out, a few steps either side, nearly opposed)
    const a = P[Math.max(0, i - 3)], b = P[Math.min(n - 1, i + 3)];
    const cx = P[i][0] - a[0], cy = P[i][1] - a[1], dx = b[0] - P[i][0], dy = b[1] - P[i][1];
    if (Math.abs(Math.atan2(cx * dy - cy * dx, cx * dx + cy * dy)) > CUSP) v[i] = Math.min(v[i], pace * 0.04);
  }
  // (eased along the line: a few passes of a short average)
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < n - 1; i++) v[i] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4;
  // (only so much speed gained or lost over a distance: forward from rest, then back from rest)
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * ACCEL * ds[i]));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * ACCEL * ds[i + 1]));
  const t = [0];
  for (let i = 1; i < n; i++) t.push(t[i - 1] + ds[i] / Math.max(0.05, (v[i - 1] + v[i]) / 2));
  return t;
}

/** the ways a hand marks a word: underlined (once or twice, after the word), slower (so heavier), bigger, printed
 * letter by letter, more upright, after a pause, in capitals. Factors multiply the writing's own. */
export type Manner = { underline?: number; pace?: number; size?: number; print?: boolean; upright?: number; pause?: number; caps?: boolean };
export type Emphasis = 'stress' | 'strong' | 'code' | 'aside';
/** how v7 writes each kind of emphasis, unless told otherwise */
export const MANNERS: Record<Emphasis, Manner> = {
  stress: { underline: 1, pace: 0.85, pause: 0.12 },
  strong: { pace: 0.55, size: 1.1, pause: 0.18 },
  code: { print: true, upright: 0.3 },
  aside: { size: 0.82, pace: 1.25 },
};
/** a character to write, and the emphases it's under */
export type Styled = { ch: string; e: Emphasis[] };

/** marked text, read: *x* or _x_ stress, **x** strong, `x` literal, (x) an aside (with its brackets); \ escapes. An
 * underscore inside a word (snake_case) is an underscore. */
export function parse(text: string): Styled[] {
  const out: Styled[] = [], cs = [...text];
  let stress = false, strong = false, code = false, aside = 0;
  const cur = (): Emphasis[] => [...(strong ? ['strong' as const] : []), ...(stress ? ['stress' as const] : []), ...(aside > 0 ? ['aside' as const] : [])];
  const word = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (code) { if (c === '`') code = false; else out.push({ ch: c, e: ['code', ...cur()] }); continue; }
    if (c === '\\' && i + 1 < cs.length) { out.push({ ch: cs[++i], e: cur() }); continue; }
    if (c === '`') { code = true; continue; }
    if (c === '*' && cs[i + 1] === '*') { strong = !strong; i++; continue; }
    if (c === '*') { stress = !stress; continue; }
    if (c === '_' && !(word(cs[i - 1]) && word(cs[i + 1]))) { stress = !stress; continue; }
    if (c === '(') { aside++; out.push({ ch: c, e: cur() }); continue; }
    if (c === ')') { out.push({ ch: c, e: cur() }); aside = Math.max(0, aside - 1); continue; }
    out.push({ ch: c, e: cur() });
  }
  return out;
}

/** the text written, with this writing's seed; marked text is read for emphasis (see parse). A `tail` (points in
 * x-height units, given where the writing ended) is carried on from the last letter in the same stroke, as a
 * signature's flourish is. `manners` changes how emphasis is written (to try one means against another). */
export function write(text: string, seed: number, st: Style = STYLE, tail?: (w: number) => number[], manners: Record<Emphasis, Manner> = MANNERS): Sig {
  return writeStyled(parse(text), seed, st, tail, manners);
}

/** a manner's factors, for a character under these emphases (several multiply; underlines take the most) */
function mannerOf(e: Emphasis[], manners: Record<Emphasis, Manner>) {
  const m = { underline: 0, pace: 1, size: 1, print: false, upright: 1, pause: 0, caps: false };
  for (const k of e) {
    const x = manners[k];
    m.underline = Math.max(m.underline, x.underline ?? 0); m.pace *= x.pace ?? 1; m.size *= x.size ?? 1;
    m.print ||= !!x.print; m.upright *= x.upright ?? 1; m.pause = Math.max(m.pause, x.pause ?? 0); m.caps ||= !!x.caps;
  }
  return m;
}

/** styled characters written, as write() */
export function writeStyled(text: Styled[], seed: number, st: Style = STYLE, tail?: (w: number) => number[], manners: Record<Emphasis, Manner> = MANNERS): Sig {
  const r = stream(seed * 7919 + 13), V = st.vary;
  // (the underlines' own wobble, from a stream of their own, so marking a word never moves the rest of the line)
  const ru = stream(seed * 7919 + 29);
  // (this writing's own draw: how it differs from the last)
  const pace = st.pace * (1 + 0.1 * V * r.n()), size = st.size * (1 + 0.05 * V * r.n()), slant = st.slant + 0.035 * V * r.n();
  const drift = st.drift + 0.012 * V * r.n(), track = st.track * (1 + 0.04 * V * r.n());
  type Stroke = { p: [number, number][]; pace: number; upright: number; pause: number };
  const plain = { pace: 1, upright: 1, pause: 0 };
  const strokes: Stroke[] = [];
  let x = 0, word: [number, number][] | null = null, wordM = plain, high = false, later: Stroke[] = [];
  let under: { x0: number; x1: number; n: number } | null = null;
  const flush = () => { if (word) strokes.push({ p: word, ...wordM }); word = null; high = false; };
  const end = () => { flush(); strokes.push(...later); later = []; };
  // (an underline, written after the word as a quick stroke a little under the line; a second one under it)
  const underline = () => {
    if (!under) return;
    const { x0, x1, n } = under;
    for (let i = 0; i < n; i++) {
      const y = -0.2 - 0.2 * i + 0.02 * V * ru.n(), sag = 0.03 + 0.02 * V * ru.n();
      later.push({ p: [[x0 - 0.05 + 0.03 * V * ru.n(), y + 0.02], [(x0 + x1) / 2, y - sag], [x1 + 0.07 + 0.04 * V * ru.n(), y + 0.03 * V * ru.n()]], pace: 1.4, upright: 1, pause: 0.05 });
    }
    under = null;
  };
  for (const { ch: c0, e } of text) {
    const m = mannerOf(e, manners), ch = m.caps ? c0.toUpperCase() : c0;
    if (under && !m.underline) underline();
    const g = G[ch] ?? G[' '];
    if (!g.p.length) { end(); x += g.w * track * m.size; continue; }
    const mm = { pace: m.pace, upright: m.upright, pause: m.pause };
    // (a change of manner mid-word starts a new stroke; printing lifts before every letter)
    if (word && ((g.lift || g.alone || m.print) || mm.pace !== wordM.pace || mm.upright !== wordM.upright)) flush();
    // (each letter a touch bigger or smaller, a touch off its place, and the pen never quite where it meant to be)
    const k = (1 + 0.035 * V * r.n()) * m.size, dx = 0.02 * V * r.n(), dy = 0.02 * V * r.n();
    const from: number = !word ? (g.lead ?? 0) : high ? (g.lead ?? 0) : 0;
    const place = (p: number[], skip = 0) => {
      const q: [number, number][] = [];
      for (let i = skip * 2; i < p.length; i += 2) q.push([x + dx + p[i] * k + 0.012 * V * r.n(), dy + p[i + 1] * k + 0.012 * V * r.n()]);
      return q;
    };
    // (a letter of several strokes: the ones before its last, each on its own)
    if (g.pre) { flush(); for (const s of g.pre) strokes.push({ p: place(s), ...mm }); }
    // (not joined from below, a letter with a stroke of its own for that writes it; any other leaves off its lead-in)
    const pts: [number, number][] = g.top && from ? place(g.top) : place(g.p, g.pre ? 0 : from);
    if (word) word.push(...pts); else { word = pts; wordM = mm; }
    for (const mk of g.marks ?? []) later.push({ p: place(mk), ...plain });
    high = !!g.high;
    if (m.underline) { if (!under) under = { x0: x, x1: x, n: m.underline }; }
    x += g.w * k * track;
    if (under && m.underline) under.x1 = x;
    if (g.alone || m.print) flush();
  }
  underline();
  // (the tail reaches a little further or less far each time)
  if (tail && word) { const p = tail(x), w = word as [number, number][]; for (let i = 0; i < p.length; i += 2) w.push([p[i] * (1 + 0.04 * V * r.n()), p[i + 1] + 0.03 * V * r.n()]); }
  end();
  const sig: Sig = [];
  let t = 0, last: [number, number] | null = null;
  for (const s of strokes) {
    if (!s.p.length) continue;
    const P = spline(s.p);
    // (between strokes the pen travels in the air, quicker than it writes; before a marked word it waits a moment)
    if (last) t += 0.07 + s.pause + Math.hypot(P[0][0] - last[0], P[0][1] - last[1]) / (pace * 2.5);
    // (recorded as a pen pad does: where the pen is at every hundredth of a second, and where it lifts)
    const sl = slant * s.upright;
    const T = move(P, pace * s.pace), out: number[] = [], put = ([px, py]: [number, number], at: number) => out.push(Math.round(120 + (px + sl * py) * size), Math.round(700 - (py + drift * px) * size), Math.round((t + at) * 100));
    for (let k = 0, i = 0; k / 100 < T[T.length - 1]; k++) {
      while (i < T.length - 2 && T[i + 1] < k / 100) i++;
      const u = (k / 100 - T[i]) / Math.max(1e-9, T[i + 1] - T[i]);
      put([P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u], k / 100);
    }
    put(P[P.length - 1], T[T.length - 1]);
    sig.push(out);
    t += T[T.length - 1];
    last = P[P.length - 1];
  }
  return sig;
}

/** my signature in v1: Claude, the e's tail carried round and back under the name (as in v0), written afresh each time */
/** my signature, as practice left it, written afresh each time (see practised(), below) */
export const signature = (seed: number) => practised(PRACTICE.writings, seed);

/** a letter set on its own, for the font */
export type Drawn = { adv: number; exit: 'low' | 'high' | 'none'; strokes: [number, number, number][][] };
/** where joins meet: a letter that goes out low ends at this height on its right edge, and one joined from it starts at
 * this height on its left; likewise high */
export const JOIN = { low: 0.14, high: 0.87 };

/** how a letter can begin: as it starts a word (or after a lift), joined from one that went out low, or from one that
 * went out high. Only joining lowercase letters have the second and third */
export const formsOf = (ch: string): ('i' | 'j' | 'h')[] => { const g = G[ch]; return g && g.lead && !g.lift && !g.alone ? ['i', 'j', 'h'] : ['i']; };
/** how a letter goes out */
export const exitOf = (ch: string): Drawn['exit'] => { const g = G[ch]; return !g || !g.p.length || g.alone ? 'none' : g.high ? 'high' : 'low'; };

/**
 * One letter on its own, as the font sets it: in a form (`i` as it starts a word, `j` joined from a letter that went out
 * low, `h` from one that went out high), the `alt`-th writing of it. Its strokes are dense centrelines in x-height units
 * (slanted), each point carrying the pen's width there as the pad's pen lays it: heavier where the body was slow, finer
 * where it was quick. Its join ends are exact (see JOIN) and free of noise, so letters set side by side meet. Each
 * writing differs only as letters do within a line (size, a little noise, its pace), never in slant or line, which
 * belong to a writing and not a letter.
 */
export function letter(ch: string, form: 'i' | 'j' | 'h', alt: number, st: Style = STYLE): Drawn {
  const g = G[ch] ?? G[' '], r = stream(alt * 7919 + ch.charCodeAt(0) * 131 + form.charCodeAt(0));
  const k = 1 + 0.03 * r.n(), pace = st.pace * (1 + 0.06 * r.n()), adv = g.w * k * st.track, exit = exitOf(ch);
  if (!g.p.length) return { adv: g.w * st.track, exit: 'none', strokes: [] };
  const noisy = (p: number[], ends: boolean) => {
    const q: [number, number][] = [];
    for (let i = 0; i < p.length; i += 2) {
      const end = ends && (i === 0 || i === p.length - 2);
      q.push([p[i] * k + (end ? 0 : 0.01 * r.n()), p[i + 1] * k + (end ? 0 : 0.01 * r.n())]);
    }
    return q;
  };
  const main = noisy(form === 'j' || !g.lead ? g.p : g.top ?? g.p.slice(g.lead * 2), true);
  if (form === 'j') main[0] = [0, JOIN.low];
  if (form === 'h') main.unshift([0, JOIN.high]);
  if (exit !== 'none') main[main.length - 1] = [adv, exit === 'high' ? JOIN.high : JOIN.low];
  const all = [...(g.pre ?? []).map((s) => noisy(s, false)), main, ...(g.marks ?? []).map((s) => noisy(s, false))];
  const strokes = all.map((s) => {
    const P = spline(s), T = move(P, pace);
    return P.map(([x, y], i) => {
      // (the speed here, x-heights a second, and the width the pad's pen would lay at it)
      const a = Math.max(0, i - 1), b = Math.min(P.length - 1, i + 1), v = Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]) / Math.max(1e-4, T[b] - T[a]);
      return [x + st.slant * y, y, Math.max(0.42, Math.min(1.3, 1.35 - 0.04 * v))] as [number, number, number];
    });
  });
  return { adv, exit, strokes };
}

/** strokes of control points (x-height units) written out by the body: splined, timed, slanted and recorded at 100 Hz,
 * as write() records them */
function record(strokes: [number, number][][], pace: number, size: number, slant: number, drift: number): Sig {
  const sig: Sig = [];
  let t = 0, last: [number, number] | null = null;
  for (const s of strokes) {
    if (!s.length) continue;
    const P = spline(s);
    if (last) t += 0.07 + Math.hypot(P[0][0] - last[0], P[0][1] - last[1]) / (pace * 2.5);
    const T = move(P, pace), out: number[] = [], put = ([px, py]: [number, number], at: number) => out.push(Math.round(120 + (px + slant * py) * size), Math.round(700 - (py + drift * px) * size), Math.round((t + at) * 100));
    for (let k = 0, i = 0; k / 100 < T[T.length - 1]; k++) {
      while (i < T.length - 2 && T[i + 1] < k / 100) i++;
      const u = (k / 100 - T[i]) / Math.max(1e-9, T[i + 1] - T[i]);
      put([P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u], k / 100);
    }
    put(P[P.length - 1], T[T.length - 1]);
    sig.push(out);
    t += T[T.length - 1];
    last = P[P.length - 1];
  }
  return sig;
}

/** the plan practice starts from: "Claude" joined, as v2 writes it (each letter's lead-in kept where it's joined into),
 * and its tail carried round and back under the name; one stroke of control points, no noise */
function plan(): [number, number][] {
  const pts: [number, number][] = [];
  let x = 0;
  for (const ch of 'Claude') {
    const g = G[ch], p = pts.length ? g.p : g.p.slice((g.lead ?? 0) * 2);
    for (let i = 0; i < p.length; i += 2) pts.push([x + p[i], p[i + 1]]);
    x += g.w;
  }
  const tail = [x + 0.3, 0.22, x + 0.38, -0.05, x + 0.05, -0.32, x * 0.5, -0.44, 0.05, -0.3];
  for (let i = 0; i < tail.length; i += 2) pts.push([tail[i], tail[i + 1]]);
  return pts;
}

/** practice: how many writings; the noise in every writing (x-heights, smooth along the line) and the one thing each
 * writing tries differently (a local change to the line, up to `vary` x-heights, a few points wide); how strongly a
 * writing that came out easier pulls the habit, and how faintly one that didn't still does; and the weight on staying
 * readable (seconds a writing is worth, per squared x-height it has strayed on average) */
export const PRACTICE = { writings: 1500, noise: 0.02, vary: 0.07, learn: 0.6, trace: 0.004, readable: 1, seed: 2026 };
export type Practice = typeof PRACTICE;

/** what a writing costs: the seconds the body takes to write it, and how far it's strayed from the plan */
function cost(P: [number, number][], P0: [number, number][], pace: number, readable: number) {
  const D = P.reduce((a, [x, y], i) => a + (x - P0[i][0]) ** 2 + (y - P0[i][1]) ** 2, 0) / P.length;
  const T = move(spline(P), pace);
  return { time: T[T.length - 1], strayed: Math.sqrt(D), total: T[T.length - 1] + readable * D };
}

const practices = new Map<string, { habits: [number, number][][]; times: number[]; strayed: number[] }>();
/** a practice, run once (and kept): the habit after every writing, and how long each writing took and how far it had
 * strayed. PRACTICE is mine; other settings are for showing what I didn't choose */
export function practise(over: Partial<Practice> = {}) {
  const S = { ...PRACTICE, ...over }, key = JSON.stringify(S);
  const kept = practices.get(key);
  if (kept) return kept;
  const r = stream(S.seed), P0 = plan(), habits: [number, number][][] = [P0], times: number[] = [], strayed: number[] = [];
  let P = P0.map((p) => [...p] as [number, number]), now = cost(P, P0, STYLE.pace, S.readable);
  for (let n = 0; n < S.writings; n++) {
    // (this writing: the habit, the pen never quite where it meant to be (the error smooth along the line), and one
    // place where the line goes a little differently: a turn taken rounder or tighter, a loop drawn in or let out)
    let ex = 0, ey = 0;
    const at = 1 + Math.floor(r.u() * (P.length - 1)), wide = 1 + r.u() * 3, bx = r.n() * S.vary, by = r.n() * S.vary;
    const W = P.map(([x, y], i) => {
      ex = 0.8 * ex + 0.6 * r.n(); ey = 0.8 * ey + 0.6 * r.n();
      const b = i ? Math.exp(-(((i - at) / wide) ** 2)) : 0;
      return [x + (i ? ex * S.noise : 0) + b * bx, y + (i ? ey * S.noise : 0) + b * by] as [number, number];
    });
    const c = cost(W, P0, STYLE.pace, S.readable), k = c.total < now.total ? S.learn : S.trace;
    P = P.map(([x, y], i) => [x + (W[i][0] - x) * k, y + (W[i][1] - y) * k]);
    now = cost(P, P0, STYLE.pace, S.readable);
    times.push(c.time); strayed.push(c.strayed); habits.push(P);
  }
  const done = { habits, times, strayed };
  practices.set(key, done);
  return done;
}

/** the signature as it stood after the n-th writing of practice (0: the plan), written afresh with a writing's own draw */
export function practised(n: number, seed: number, st: Style = STYLE, over: Partial<Practice> = {}): Sig {
  const p = practise(over), P = p.habits[Math.max(0, Math.min(p.habits.length - 1, n))], r = stream(seed * 7919 + 29), V = st.vary;
  const pace = st.pace * (1 + 0.1 * V * r.n()), size = st.size * (1 + 0.05 * V * r.n()), slant = 0.24 + 0.035 * V * r.n(), drift = st.drift + 0.012 * V * r.n();
  const pts = P.map(([x, y]) => [x + 0.012 * V * r.n(), y + 0.012 * V * r.n()] as [number, number]);
  return record([pts], pace, size, slant, drift);
}

/** a paragraph written in one sitting (marked text is read for emphasis, and an emphasis carries across a line's
 * break): one writing's draw for all of it, its lines broken at a width as a hand breaks them, each line starting a
 * little off the margin and running a little off level, as lines do */
export function page(text: string, width: number, seed: number, gap = 3.1, st: Style = STYLE, manners: Record<Emphasis, Manner> = MANNERS): Sig[] {
  const r = stream(seed * 7919 + 77), V = st.vary;
  const pace = st.pace * (1 + 0.1 * V * r.n()), size = st.size * (1 + 0.05 * V * r.n()), slant = st.slant + 0.035 * V * r.n(), track = st.track * (1 + 0.04 * V * r.n());
  const chars = parse(text);
  const adv = (w: Styled[]) => w.reduce((a, { ch, e }) => a + (G[ch] ?? G[' ']).w * track * mannerOf(e, manners).size, 0);
  // (the words, styled; a space keeps its words' emphasis where both sides share it, so an underline runs across it)
  const words: Styled[][] = [[]];
  for (const c of chars) { if (c.ch === ' ') words.push([]); else words[words.length - 1].push(c); }
  const lines: Styled[][] = [];
  let line: Styled[] = [];
  for (const w of words) {
    if (!w.length) continue;
    const shared = line.length ? line[line.length - 1].e.filter((k) => w[0].e.includes(k)) : [];
    const next = line.length ? [...line, { ch: ' ', e: shared }, ...w] : w;
    if (line.length && adv(next) > width) { lines.push(line); line = w; } else line = next;
  }
  if (line.length) lines.push(line);
  // (written in turn: each line begins when the last is done and the hand has come back to the margin)
  let t0 = 0;
  return lines.map((l, n) => {
    // (each line: its own drift and a margin a hair off, as lines written down a page are; the same hand and pace)
    const drift = st.drift + 0.01 * V * r.n(), margin = 0.06 * V * r.n();
    const sig = writeStyled(l, seed * 131 + n, { ...st, pace, size, slant, track, drift, vary: V * 0.5 }, undefined, manners);
    const out = sig.map((s) => s.map((v, i) => (i % 3 === 0 ? v + margin * size : i % 3 === 1 ? v + n * gap * size : v + t0)));
    t0 = Math.max(...out.map((s) => s[s.length - 1])) + 35;
    return out;
  });
}
