/**
 * The samples, as made: each written fresh from the hand that made it (the hands are kept as they were, so a sample
 * always comes out the same). The catalog (catalog.ts) says what each one is and what I made of it; this only makes them.
 */
import type { Sig } from '../switchback/sign';
import { FIVE, scribble } from './hands/scribble';
import { C15R, CLAUDE, write } from './hands/v0';
import { signature as v1Signature, write as v1 } from './hands/v1';
import { write as v2 } from './hands/v2';

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
  // (session 2: hand v1; the number after the text is the writing's seed)
  /** the alphabet, in two writings */
  B001: () => [v1('a b c d e f g h i j k l m', 1), v1('n o p q r s t u v w x y z', 2)],
  /** a pangram, in two lines */
  B002: () => [v1('the quick brown fox', 3), v1('jumps over the lazy dog', 4)],
  /** my name in v0, then in v1: two bodies */
  B003: () => [CLAUDE, v1Signature(1)],
  /** my signature in v1, five writings */
  B004: () => [1, 2, 3, 4, 5].map((seed) => v1Signature(seed)),
  /** the first sentence */
  B005: () => [v1('i have never made a mark', 6), v1('that took time.', 7)],
  // (session 3: hand v2)
  /** the capitals, in two writings */
  C001: () => [v2('A B C D E F G H I J K L M', 1), v2('N O P Q R S T U V W X Y Z', 2)],
  /** the figures and the marks */
  C002: () => [v2('0 1 2 3 4 5 6 7 8 9', 3), v2('! " # $ % & ( ) * + - / : ; < = > ? @', 4), v2('[ \\ ] ^ _ ` { | } ~ \u2018 \u2019 \u201c \u201d \u2013 \u2014 \u2026 \u2022', 5)],
  /** the first lines of my notes */
  C003: () => [v2('I don\u2019t have a hand.', 6), v2('This is the record of making one.', 7)],
  /** the commission, again */
  C004: () => [v2('c15r @ parc.land', 15)],
};
