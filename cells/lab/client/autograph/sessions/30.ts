/**
 * Session 30 (5 November 2026): The f, looped. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v17 } from '../hands/v17';
import { write as v20 } from '../hands/v20';
import { write as v21 } from '../hands/v21';

/** where the f failed (ending a word) and where it belonged, and the Rubáiyát's own half and of: fixed before the f was
 * drawn */
export const F_PHRASES = ['of half off', 'finger after fairly', 'cancel half a Line,', 'a Word of it.'];

const S: SessionFile = {
  session: {
    n: 30, date: '5 November 2026', title: 'The f, looped',
    summary: 'Session 29 chose the f, again, and said each rule would now name what it protects. The f the hand was born with was read as a j where it ended a word (of and half, in sessions 10, 22 and 25); session 26 replaced it with the f of print, which c15r found off and the stock-take saw as the one letter that looked as if it came from somewhere else. Looking at why: the old f\'s lower loop went down past the line and round to the left and back up, exactly as the j\'s, the g\'s and the y\'s go, and at the end of a word that was all the eye needed. The rule, set first: one letter, one change of form, chosen before drawing: the looped f back, its lower loop turning forward to close on the line right of the stem, as a school cursive f\'s does, three fifths as deep as a j\'s, its top loop as wide as the l\'s, its crossbar as it was. It protects readability as a floor (ending a word, the f mustn\'t read as a j) and belonging (it must look as if it came from this hand); not v18\'s f, nor the old f\'s exact shape. A fixed sheet where the change could be seen: of half off, finger after fairly, and the Rubáiyát\'s cancel half a Line and a Word of it, each written by v17, v20 and the new hand; looked at once; kept if every f is plainly an f and it sits with its neighbours as v17\'s did. On the sheet (AD001) none of the new fs reads as a j: of, half and off read as written, where v17\'s long loop still makes of nearly oj; and in finger, after and fairly it\'s the hand\'s own letter again, joined like its neighbours, where v20\'s stands apart. The forward turn of the loop is small at writing size; the shallower loop does most of the work. So it\'s kept, as hand v21, and the font follows: 2.9 passes the pair test with it everywhere, pace to hurried and wear to 50, as 2.8 did, and nothing needed widening (AD002). Practice ran on v18\'s f, so the f doesn\'t wear until practice runs again. Nobody has read this f blind, and the font says so.',
    decided: [
      'The rule set first named what it protects: readability as a floor where the f ends a word, and belonging among its neighbours. Both held, so it\'s kept.',
      'Hand v21: the looped f back, its lower loop turning forward and closing on the line right of the stem, three fifths as deep as a j\'s, its top loop as wide as the l\'s, its crossbar as it was. Everything else is v20.',
      'The f of print is retired. It stays in v18 to v20 and in fonts 2.6 to 2.8, which keep their samples.',
      'Font 2.9 from v21, with the same axes and ends as 2.8. The f doesn\'t wear until practice runs again.',
      'Next, as session 29 set: hurry with the hand allowed to change at its own pace; then wear practised among neighbours.',
    ],
  },
  hands: {
    v21: { name: 'hand v21', made: '5 Nov 2026', about: 'v20, and the looped f back: its lower loop turning forward to close on the line right of the stem (a j\'s turns back), three fifths as deep as a j\'s, its top loop as wide as the l\'s, its crossbar as it was, joined like its neighbours again. Everything else is v20.' },
  },
  entries: [
    {
      id: 'AD001', session: 30, title: 'Three fs', hand: 'v21', text: F_PHRASES.join(' · '), layout: 'rows',
      made: 'Where the f failed (of, half, off), where it belonged (finger, after, fairly), and the Rubáiyát\'s own half and of, each phrase written by v17 (the looped f as it was), v20 (the f of print) and v21 (the looped f, turning forward), one writing to a phrase: the sheet fixed before the f was drawn, looked at once.',
      review: 'In v17\'s rows the long loop going back still makes of nearly oj. In v20\'s the f stands apart from its neighbours. In v21\'s none reads as a j, and in finger, after and fairly it\'s the hand\'s own letter again, joined like the rest. The forward turn is small at this size; the shallower loop does most of the work.',
    },
    {
      id: 'AD002', session: 30, title: 'In 2.9', hand: 'font', font: '2.9',
      type: F_PHRASES.map((t) => ({ text: t, size: 40 })),
      made: 'The same phrases set in font 2.9 at the hand\'s own pace, as any app sets it.',
      review: 'In type the f is the hand\'s looped f again, joined from the letter before it and going on low into the next; of, half and off read as they\'re written. The pair test found no two letters touching but where they join, at any pace or wear the font goes to.',
    },
  ],
  made: {
    /** each phrase by v17 (the looped f as it was), v20 (the f of print) and v21 (the looped f, turning forward), one writing */
    AD001: () => F_PHRASES.flatMap((t, i) => [v17(t, 30 + i), v20(t, 30 + i), v21(t, 30 + i)]),
  },
};
export default S;
