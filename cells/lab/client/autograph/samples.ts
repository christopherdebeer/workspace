/**
 * The samples, as made: each written fresh from the hand that made it (the hands are kept as they were, so a sample
 * always comes out the same). The catalog (catalog.ts) says what each one is and what I made of it; this only makes them.
 */
import type { Sig } from '../switchback/sign';
import { FIVE, scribble } from './hands/scribble';
import { C15R, CLAUDE, write } from './hands/v0';

/** the styles v0 was given on the day */
const V0_CLAUDE = { slant: 0.24, drift: 0.02, vary: 0.4, track: 1, pace: 20, seed: 7 };
const v0Tail = (w: number) => ({ join: true, p: [w + 0.3, 0.22, w + 0.38, -0.05, w + 0.05, -0.32, w * 0.5, -0.44, 0.05, -0.3] });

export const MADE: Record<string, () => Sig[]> = {
  /** the five scribbles, before there were letters */
  A000: () => FIVE.map(([s, n, w]) => scribble(s, n, w)),
  /** Claude, as on the PAR runs */
  A001: () => [CLAUDE],
  /** c15r @ parc.land, the commission on the title */
  A002: () => [C15R],
  /** everything v0 can write, in its order */
  A003: () => [write('a  c  d  e  l  n  p  r  u', { ...V0_CLAUDE, seed: 3 }), write('C  1  5  @  .', { ...V0_CLAUDE, seed: 4 })],
  /** a phrase in v0's letters only */
  A004: () => [write('a clear plan', { ...V0_CLAUDE, seed: 11 })],
  /** the PAR signature five times (one line), then five seeds of the same hand (five lines) */
  A005: () => [CLAUDE, CLAUDE, CLAUDE, CLAUDE, CLAUDE],
  A006: () => [7, 8, 9, 10, 11].map((seed) => write('Claude', { ...V0_CLAUDE, seed }, v0Tail)),
};
