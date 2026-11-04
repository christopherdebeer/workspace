/**
 * Session 17 (4 November 2026): The white. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v10, STYLE } from '../hands/v10';
import { write as v11 } from '../hands/v11';

/** each letter that was looked at, between n's, as a type designer spaces a face */
export const BETWEEN = 'nnhnn nnann nnbnn nnpnn nnsnn';
/** words where the white showed */
export const WORDS = ['nnhnn hand he happen chapter', 'sessions sense says this is so', 'about probably apple bank'];

const S: SessionFile = {
  session: {
    n: 17, date: '4 November 2026', title: 'The white',
    summary: 'c15r asked for the next session, and the record said what it was: session 15 decided that the hand\'s spacing would be looked at, the white inside letters and between them together, before anything more was changed. So I measured it the way a type designer spaces a face (devtools/autograph-white.mjs): each letter between n\'s, and the white beside it, at three heights through the x-height, against the white between two n\'s. My first measure counted downstrokes, and it was wrong for this hand. In a joined hand the joining stroke rises right beside the next letter, and a bowl\'s right side is an upstroke, so what the eye takes for stems are partly upstrokes; any stroke through the x-height is a wall. Measured that way, the n\'s own rhythm is even, its inside as wide as the space between two, and most letters sit within a fifth of it. The open letters, c and r, gape after themselves as they do in type, and r\'s open side is what keeps rn from reading as m. Four letters crowded the one after: h most, at half the n\'s white, then a, b and p. And the s, printed and standing alone, left twice the n\'s white before it: session 9\'s words with s\'s breaking into pieces, measured at last. By eye, two of these mattered: the h, which ran into the next n, and the s, so that sense read as sen se. Hand v11 lets the exits of h, a, b and p run a little further, and sets an s inside a word nearer the letter before it (Q001, Q002). I meant to keep its tail clear of that letter\'s exit, and measuring showed it already wasn\'t: the tail session 16\'s practice gave the s reaches back from below and touched the exit before it in v10, and touches it a little more now. The s session 2 kept apart, because joined it read as a hook, joins by touch, and no blind reader has read a hook. Two blind readers read forty words in each hand. Both read every word, and the hesitations were no more than readers differ by; but the reader of v11 wasn\'t sure app stem was two words, because an s starting a word had moved into the space before it. So an s starting a word stays where it was. The white before an s inside a word is still loose, at about one and a half times the n\'s, deliberately: the rest of the gap is the s standing alone, which is a question about what the hand is, not about its spacing.',
    decided: [
      'The hand\'s white is looked at the way a face is spaced: each letter between n\'s, the white either side of it against the white between two n\'s, at three heights, counting every stroke through the x-height as a wall (devtools/autograph-white.mjs).',
      'Hand v11: the exits of h, a, b and p run a little further before the next letter, and an s inside a word sits nearer the letter before it. The open letters keep their openness. My name keeps its spacing.',
      'A change that moves letters is read blind before it\'s kept, and a reader\'s doubt about where one word ends counts like a guessed letter.',
      'The s stays printed, and touches the letter before it with the tail practice gave it; blind readers read it as an s. Whether it should be joined outright, with a stroke, waits for a person reading it.',
      'The font still waits for a person to read the hand; it\'s 1.4 until then.',
    ],
  },
  hands: {
    v11: { name: 'hand v11', made: '4 Nov 2026', about: 'v10, spaced: the exits of h, a, b and p run a little further before the next letter, and an s inside a word sits nearer the letter before it, from a look at the white between n\'s. My name is spaced as it was.' },
  },
  entries: [
    {
      id: 'Q001', session: 17, title: 'Between n\'s', hand: 'v11', text: BETWEEN, layout: 'rows',
      made: 'The letters whose white was uneven, each between n\'s as a type designer spaces a face, with nothing varied: v10, then v11.',
      review: 'The h no longer runs into the n after it, and a, b and p leave a little room before theirs. The s is nearer the n before it, and its tail, sent back from below by session 16\'s practice, meets the n\'s exit: it touched in v10 already, a twentieth of an x-height apart, and touches a little more here. Drawn large, the two look like one stroke with a lift in it. The n\'s themselves are as they were: their rhythm was the even one, and everything else is measured against it.',
    },
    {
      id: 'Q002', session: 17, title: 'Spaced, in words', hand: 'v11', text: WORDS.join(' · '), layout: 'rows',
      made: 'Three lines, each written by v10 and then by v11 with the same seed.',
      review: 'In words the difference is small and even. Hand, happen and chapter keep a steadier rhythm, about and apple breathe, and sessions and sense hold together where they used to come apart at every s. Nothing reads differently; it\'s the white that changed, and white is most of what a page is.',
    },
  ],
  made: {
    /** the letters between n's, nothing varied: v10, then v11 */
    Q001: () => [v10(BETWEEN, 1, { ...STYLE, vary: 0 }), v11(BETWEEN, 1, { ...STYLE, vary: 0 })],
    /** the three lines, v10 then v11 */
    Q002: () => WORDS.flatMap((t, i) => [v10(t, 4 + i), v11(t, 4 + i)]),
  },
};
export default S;
