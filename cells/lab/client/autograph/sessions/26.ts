/**
 * Session 26 (5 November 2026): The f. What it found and decided, its samples, and how each is made. Recorded once and
 * never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs fingerprints
 * this one).
 */
import type { SessionFile } from '../record';
import { write as v17 } from '../hands/v17';
import { write as v18 } from '../hands/v18';

/** words with an f at the start, in the middle and at the end, and two together; the sheet fixed before the new f was
 * drawn */
export const F_WORDS = ['of half after find', 'fairly lift brief off'];

const S: SessionFile = {
  session: {
    n: 26, date: '5 November 2026', title: 'The f',
    summary: 'Session 10 left three letters for a session about what the hand is: the lone s, the barred I, and the f that makes of read oj. Since then the f has marked both pages meant to be kept, of on chapter two\'s first page and half and of in the Rubáiyát, and session 25 named it the open item most worth a session. It was the f of the copybooks, the one the hand was born with in v1: it rises from the line, loops at its top, comes down through the line to a loop under it, and comes back to join at the foot. At writing size its top loop is small and its stem runs further under the line than over it, so a reader sees a j. The rule, set before anything was drawn: one letter, one alternative, chosen first; a fixed sheet of f words, written by v17 and by the new hand with the same seeds; looked at once; kept if every f is plainly an f and none could be a t or an l; no readers, no second dial; if kept, the font follows. The alternative was the f of print, which stands on the line. The pen lifts before it; its hook and stem are written first, top down; its crossbar last, going on into the next letter from above, as the hand already goes on from an o, a v, a w, a b or an r. Nothing goes under the line, so there\'s nothing to be a j. On the sheet (Z001), of, half, after, find, fairly, lift, brief and off, every f was an f, and none looked like a t or an l: neither has a hook turning over at its top. So hand v18 has it. Then the font, and the pair test every font has to pass found what the sheet couldn\'t: the hook reached past the letter\'s width, as a printed f\'s does, and met whatever tall thing came after it, a capital, an h, a figure, a quotation mark; 24 pairs touched. The hook now ends inside the f\'s width, the f a little wider, and nothing touches. That changed the f after it was looked at, so the sheet was drawn again, to see it was still the f that was kept rather than to judge it again; it was. Font 2.6 is made from v18 (Z002). Nobody has read this f yet, and the font says so.',
    decided: [
      'The rule set first: one letter, one alternative, one fixed sheet, looked at once, kept if every f is plainly an f and none could be a t or an l; no readers, no second dial. It held, so it\'s kept.',
      'Hand v18: the f stands on the line, as print\'s does. The pen lifts before it, writes its hook and stem top down, and goes on from its crossbar into the next letter from above. Everything else is v17.',
      'An f\'s hook stays inside its width, so it meets nothing tall after it; the font\'s pair test is what asked for that.',
      'Font 2.6, from v18. It says its f hasn\'t been read by anyone yet.',
      'Of session 10\'s three, the lone s and the barred I are still open.',
    ],
  },
  hands: {
    v18: { name: 'hand v18', made: '5 Nov 2026', about: 'v17, and an f that stands on the line, as print\'s does, instead of the looped f that came down through the line and made of read oj. The pen lifts before it, writes its hook and stem top down, and goes on from its crossbar into the next letter from above; its hook stays inside its width. Everything else is v17.' },
  },
  entries: [
    {
      id: 'Z001', session: 26, title: 'The f stands on the line', hand: 'v18', text: F_WORDS.join(' · '), layout: 'rows',
      made: 'The sheet fixed before the new f was drawn: an f at the start, in the middle and at the end of a word, and two together, each line written by v17 and then by v18 with the same seed (26 on).',
      review: 'v17\'s f loops under the line, and in of and half it\'s nearly a j. v18\'s stands on the line with its hook over its stem and its bar going on into the next letter, and every one of the eight words reads with an f in it. In off the first f\'s bar runs on into the second; in lift and brief the pen lifts before the f where it once ran on.',
    },
    {
      id: 'Z002', session: 26, title: 'In 2.6', hand: 'font', font: '2.6',
      type: F_WORDS.map((t) => ({ text: t, size: 44 })),
      made: 'The same lines in font 2.6 (hand v18), as any app sets it, its kerning on.',
      review: 'The f in type is the hand\'s new f, standing on the line with its bar running into the letter after it. Its hook keeps inside its width: the pair test found no two letters touching other than at a join, in either face.',
    },
  ],
  made: {
    /** the f's sheet, v17 then v18, line by line */
    Z001: () => F_WORDS.flatMap((t, i) => [v17(t, 26 + i), v18(t, 26 + i)]),
  },
};
export default S;
