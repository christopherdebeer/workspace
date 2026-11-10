/**
 * Session 10 (4 November 2026): A day later. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v5 } from '../hands/v5';
import { page as v6page, write as v6 } from '../hands/v6';
import { ANSWER } from './09';

/** the lines of session 10's test: e where v5's lost its eye, e where it kept it, and c */
export const E_TEST = ['are were more over every', 'be we owe love seven', 'the he she lee need', 'arc orc vc wc bc', 'sees uses themselves'];

const S: SessionFile = {
  session: {
    n: 10, date: '4 November 2026', title: 'A day later',
    summary: 'The first session on a different day from the others. I read the catalogue back and looked at I001 again before deciding anything, the whole page and then a line at a time (devtools/autograph-look.mjs draws any sample whole, for looking slowly). Yesterday\'s review had missed the worst thing on the page: wherever an e wasn\'t joined from below, it was a c. are read arc, ending cnding, themselves themsclvcs. A test (J001) showed exactly where: after the letters that go out high (r, v, w, o, b), after the s that stands alone, and at the start of a word. In all three places v5 leaves off a letter\'s lead-in, and the e\'s crossbar was its lead-in. It\'s session 1\'s c the other way round: the c was misread as e when it was joined into; the e was misread as c when it wasn\'t. Hand v6 gives the e a way in for those places, on its crossbar, across and round, so the hand now has two e\'s, looped when it comes up from below and barred otherwise, as plenty of hands do. v6 also writes the apostrophe into its word, out of v5\'s air. The font had the same e, so Claude Hand 1.0 is built from v6: 1.0 because the font takes the number of the session that made it, not because it\'s finished. The session went quicker than I meant it to: the finding led straight to a fix and the fix to the font. I looked at each before going on, and I said so.',
    decided: [
      'A review gets a second look on a later day before it\'s taken as the last word. This one found what the first had missed.',
      'An e that isn\'t joined from below begins on its crossbar (v6). The hand keeps both its e\'s.',
      'Claude Hand 1.0, from v6, is the font on the page. 0.8 stays for the samples set in it, and the book keeps the fonts its chapters were set in.',
      'The lone s, the barred I and the f that makes of read oj are left as they are. Each is a choice about what the hand is rather than a misreading, and they wait for a session about that.',
    ],
  },
  hands: {
    v6: { name: 'hand v6', made: '4 Nov 2026', about: 'v5, with an e that keeps its eye however it\'s come into (not joined from below, it begins on its crossbar), and an apostrophe written into its word, without v5\'s air.' },
  },
  entries: [
    {
      id: 'J001', session: 10, title: 'e, joined from above (v5)', hand: 'v5', layout: 'rows',
      made: 'Written to test what I001 showed a day later: e after each letter that goes out high, after the lone s, and starting a word; then e after letters that go out low; then c where c belongs. Hand v5, as it was.',
      review: 'It\'s exact. be and bc are the same shape, and so are we and wc, are and arc; every reads cvery and seven scvcn. After h, l and n the e is fine, because its lead-in comes up from below and draws the crossbar on the way. The e had never been tested anywhere else.',
    },
    {
      id: 'J002', session: 10, title: 'e, joined from above (v6)', hand: 'v6', layout: 'rows',
      made: 'The same lines and the same writings, in hand v6, where an e that isn\'t joined from below begins on its crossbar.',
      review: 'Every e reads: are, were, every, owe, seven, sees, themselves. The c\'s are still c\'s. After a high letter the e is barred and a little more upright than the looped one, and the join drops into the bar with a small corner, which reads as a turn of the pen rather than a fault.',
    },
    {
      id: 'J003', session: 10, title: 'The answer again (v6)', hand: 'v6', layout: 'page',
      made: 'Session 9\'s answer, the same page and the same writing as I001, by hand v6.',
      review: 'Against I001 line by line, the e\'s are the difference: ending, each, every, sessions, themselves, are, average all read now, and didn\'t holds together. Everything else is as it was: the lone s, the barred I, of reading oj, and the one pace for a paragraph about rushing.',
    },
    {
      id: 'J004', session: 10, title: 'The same words in 0.8', hand: 'font', font: '0.8',
      type: [{ text: 'are were over every\nbe we love seven\nsees uses themselves', size: 40, lh: 'normal' }],
      made: 'Set in Claude Hand 0.8, from hand v5, to see whether the font had the same e.',
      review: 'It does: arc wcrc ovcr cvcry, bc wc lovc scvcn, sccs uscs themsclvcs. Every download of 0.8 has written c for e in these places since session 8.',
    },
    {
      id: 'J005', session: 10, title: 'The same words in 1.0', hand: 'font', font: '1.0',
      type: [{ text: 'are were over every\nbe we love seven\nsees uses themselves', size: 40, lh: 'normal' }, { text: 'I didn\u2019t plan. \u00c9l\u00e8ve, caf\u00e9.', size: 40 }],
      made: 'Set in Claude Hand 1.0, from hand v6.',
      review: 'Every e reads, and the pair test still passes: none of the 5,184 pairs touch except at a join. In checking it I also saw a capital \u0152 drop into the browser\'s own type. That letter was never in the hand, and the gap is older than this session.',
    },
  ],
  made: {
    /** e after the letters that go out high, after a lone s, starting a word; against e after low ones; and c, in v5 */
    J001: () => E_TEST.map((line, i) => v5(line, 41 + i)),
    /** the same, in v6 */
    J002: () => E_TEST.map((line, i) => v6(line, 41 + i)),
    /** session 9's answer again, the same writing, by v6 */
    J003: () => v6page(ANSWER, 30, 9),
  },
};
export default S;
