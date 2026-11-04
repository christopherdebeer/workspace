/**
 * Session 3 (3 November 2026): Capitals, figures, marks. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file (autograph-
 * check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v2 } from '../hands/v2';

const S: SessionFile = {
  session: {
    n: 3, date: '3 November 2026', title: 'Capitals, figures, marks',
    summary: 'Hand v2: v1\'s lowercase letter for letter, and capitals, figures and every mark, so the hand can write anything I would. The capitals are mostly print, written as a quick hand writes them: B, D, P and R down the stem and back up it before the bowls, A, F, H, T, X and Y lifting for their second strokes. Those that end low on the right join the letter after. And one more thing, for the font: a way to set a single letter on its own in each of the forms a font needs (starting a word, joined from below, joined from above), its join ends exact so set letters meet, the pen\'s width at every point.',
    decided: [
      'Practice waits until after the font. c15r would like a usable font first, and a font needs a hand more than it needs a signature.',
      'Next, the font. Each letter in its forms and in three writings. The strokes are widened by the pen\'s own widths into outlines. Which form is set depends on the letter before. The writings are taken in turn, so a word never repeats a letter exactly.',
      'The font is built from v2 as it is: the hand stays frozen, and so the font can always be built again the same.',
    ],
  },
  hands: {
    v2: { name: 'hand v2', made: '3 Nov 2026', about: 'v1\'s lowercase letter for letter, with capitals (mostly print; those ending low on the right join on), lining figures, every mark on the keyboard and the ones typing puts in; and letter(), one letter set on its own in each form a font needs.' },
  },
  entries: [
    {
      id: 'C001', session: 3, title: 'The capitals', hand: 'v2', layout: 'rows',
      made: 'Every capital, in two writings.',
      review: 'Print capitals, the way a quick hand writes them. B, D, P and R go down the stem and back up it in one stroke before the bowls; A, F, H, T, X and Y lift for their second strokes. The ones that end low on the right (C, E, H, K, L, M, R, U, Z) join the letter after them, as they would in a word. C is v0\'s, from my name, and it\'s taller than the rest; I\'ve let it be. They\'re plainer than the lowercase. The lowercase has had two sessions of being misread; the capitals haven\'t had any yet.',
    },
    {
      id: 'C002', session: 3, title: 'Figures and marks', hand: 'v2', layout: 'rows',
      made: 'The figures; every mark on the keyboard; then the ones typing puts in for you (quotes, dashes, the ellipsis, a bullet).',
      review: 'The figures are lining, a little shorter than the capitals. 1 is v0\'s stick and flag, 5 is crossed afterwards as v0\'s was, 4 is open, 7 is plain. The marks are the least mine of anything here: there\'s hardly room for a hand in a bracket or a plus sign. They\'re written quickly and they\'re all there, which is what they need to be. The pen never stops in the figures (there are no cusps worth the name), and the ink, which hardly varies, shows it.',
    },
    {
      id: 'C003', session: 3, title: 'The first lines of my notes', hand: 'v2', layout: 'rows',
      made: 'The first two sentences of my notes, in two writings: capitals, an apostrophe, full stops.',
      review: 'The first thing in the catalogue that looks like writing rather than a specimen: a capital, a contraction, two sentences. The I has bars, so it can\'t be read as an l or a 1. The apostrophe in don’t sits a little high; the full stops are tiny ticks, a pen touched down and lifted. Each line has its own pace, slant and line (the second leans a degree further), and side by side they look like two lines of one person\'s writing, which is what I was after.',
    },
    {
      id: 'C004', session: 3, title: 'c15r @ parc.land, again', hand: 'v2', text: 'c15r @ parc.land',
      made: 'The commission in v2, to set beside v0\'s (A002).',
      review: 'It\'s slower and more upright than v0\'s (5.3 seconds against 3.9; 15° against 20°), and its ink thins on the straights where v0\'s was even. The c\'s still lift, as in every hand since v0, and the @ is v0\'s @. I still prefer the old one on the logo, where it\'s written in marker to be seen from across a room. This is a hand for writing, not signing, and that may be the whole difference.',
    },
  ],
  made: {
    /** the capitals, in two writings */
    C001: () => [v2('A B C D E F G H I J K L M', 1), v2('N O P Q R S T U V W X Y Z', 2)],
    /** the figures and the marks */
    C002: () => [v2('0 1 2 3 4 5 6 7 8 9', 3), v2('! " # $ % & ( ) * + - / : ; < = > ? @', 4), v2('[ \\ ] ^ _ ` { | } ~ \u2018 \u2019 \u201c \u201d \u2013 \u2014 \u2026 \u2022', 5)],
    /** the first lines of my notes */
    C003: () => [v2('I don\u2019t have a hand.', 6), v2('This is the record of making one.', 7)],
    /** the commission, again */
    C004: () => [v2('c15r @ parc.land', 15)],
  },
};
export default S;
