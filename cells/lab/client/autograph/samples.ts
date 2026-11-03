/**
 * The samples, as made: each written fresh from the hand that made it (the hands are kept as they were, so a sample
 * always comes out the same). The catalog (catalog.ts) says what each one is and what I made of it; this only makes them.
 */
import type { Sig } from '../switchback/sign';
import { FIVE, scribble } from './hands/scribble';
import { C15R, CLAUDE, write } from './hands/v0';
import { signature as v1Signature, write as v1 } from './hands/v1';
import { write as v2 } from './hands/v2';
import { STYLE as V3_STYLE, practised } from './hands/v3';
import { write as v4 } from './hands/v4';
import { BOOK, firstLine } from './autobiography';
import { page } from './hands/v5';

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
  // (session 5: hand v3, practice; written without a writing's own draw where it's the habit that's shown)
  /** my name after 0, 100, 500 and 1,500 writings of practice */
  E001: () => [0, 100, 500, 1500].map((n) => practised(n, 1, { ...V3_STYLE, vary: 0 })),
  /** after 1,500 writings, with a heavy, my, and almost no weight on staying readable */
  E002: () => [12, 1, 0.1].map((readable) => practised(1500, 1, { ...V3_STYLE, vary: 0 }, { readable })),
  /** the practised signature, five writings */
  E003: () => [1, 2, 3, 4, 5].map((seed) => practised(1500, seed)),
  // (session 6: hand v4)
  /** the accents, the capitals' accents, and the marks */
  F001: () => [
    v4('\u00e1 \u00e0 \u00e2 \u00e4 \u00e3 \u00e5 \u00e9 \u00e8 \u00ea \u00eb \u00ed \u00ec \u00ee \u00ef', 1),
    v4('\u00f3 \u00f2 \u00f4 \u00f6 \u00f5 \u00f8 \u00fa \u00f9 \u00fb \u00fc \u00fd \u00ff \u00f1 \u00e7 \u00e6 \u0153 \u00df', 2),
    v4('\u00c1 \u00c0 \u00c2 \u00c4 \u00c3 \u00c5 \u00c9 \u00c8 \u00ca \u00cb \u00cd \u00d3 \u00d6 \u00d8 \u00dc \u00d1 \u00c7', 3),
    v4('\u00b7 \u20ac \u00a3 \u00b0 \u00d7 \u00f7 \u00a9 \u00a1 \u00bf \u00ab \u00bb \u00bd \u00bc \u00be \u2713', 4),
  ],
  /** what the font couldn't write, written */
  F002: () => [v4('caf\u00e9 \u00b7 na\u00efve \u00b7 \u00c5ngstr\u00f6m \u00b7 1\u00bd \u00b7 \u20ac5 \u00b7 \u2713', 5), v4('Gar\u00e7on, deux caf\u00e9s cr\u00e8me.', 6)],
  // (session 7: the autobiography)
  /** the book's first line, as the hand writes it at the head of chapter one */
  G001: () => [v4(firstLine(BOOK.chapters[0]), BOOK.chapters[0].seed)],
  // (session 8: hand v5)
  /** chapter one's first paragraph, written by the hand as a page in one sitting */
  H003: () => page(BOOK.chapters[0].text[0], 30, 8),
};
