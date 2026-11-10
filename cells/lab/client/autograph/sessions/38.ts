/**
 * Session 38 (5 November 2026): Care where it's needed. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v25, STYLE as S25, MANNERS as M25, HURRY as H25 } from '../hands/v25';
import { write as v26, STYLE, MANNERS, HURRY } from '../hands/v26';
import { PHRASES } from './27';

/** a sentence with an aside and a strong word, to see care change within it */
export const MARKED = 'The Moving Finger writes; (and, having writ,) **moves on**.';

const S: SessionFile = {
  session: {
    n: 38, date: '5 November 2026', title: "Care where it's needed",
    summary: 'Proceeding as I saw fit, I took up what session 36 left: no amount of care, the pen\'s stiffness following the time the hand gives a word, had kept the hurried page readable, because the f\'s lower loop went first. A person hurrying still slows for what tells a letter apart. So this session gave those letters their time. The letters were chosen by what readers had actually taken for others when the hand hurried, in sessions 33 to 36: the f read as a t (finger as tinger), the e dropped or read as a u or an o (piety as pity, tears as tours), the r as a v (lure as love), the v as a w (moving as mowing, having as hawing). In hand v26 those four are written no quicker than the hand\'s own pace, however the word around them hurries: every point of a word\'s line now has a pace and a stiffness of its own, so a hurried word is quick and loose in its other letters and careful in these. With nothing marked and care off, it writes exactly as v25. Then care again, chosen by eye and checked by readers, the rules loosened as in session 37 but the readers\' floor kept for the hand itself, which everything else is made from. With care at 1 the hurried page looked most like a hurried hand, and finger, tears and piety came through, but a reader read lure as here, wash as well and having as living. Giving more letters care until nothing hurried would undo the point, so care went to 0.5, the step session 36\'s readers had failed on f and e: now two readers read the hurried page without a mistake, the first time any care has held at four times the pace. At its own pace a reader read it without a mistake but with doubts at four words; v25\'s own page, care off, drew the same doubts from a fresh reader, and one more, so they\'re the hand\'s and its readers\', not care\'s. Kept: care at 0.5, the f, e, r and v written with care. On the sheet (AL001) pressed is unchanged and its own pace is v25\'s; hurried, v26 runs looser than v25 and keeps its letters: Moving goes to a run of humps while Finger keeps its loop. In a sentence (AL002) care follows what\'s meant: hurried, the aside runs loosest and smallest and the strong words stay upright and firm. The fonts follow as 3.8 (AL003): the variable font passes the pair test from hurried to pressed, but with the hurried pen looser its wear ends at 25 rather than 50, where letters stop touching; the writing font, its hurried end looser too, came to 722,280 bytes, just over what the cell can take, so its outline points are spaced 4% wider, the least that fits; script 3.8, stylesheet 3.8, and the still faces Regular, Pressed and Hurried 3.8 for apps. What this found: a hand can hurry and stay readable if it hurries unevenly, slowing where a letter is told apart by one feature. The readers taught it where.',
    decided: [
      'Care where it\'s needed: the letters readers took for others when the hand hurried (f, e, r, v) are written no quicker than the hand\'s own pace, however the word around them hurries.',
      'With that, care across the hand at 0.5: two readers read the hurried page without a mistake; at 1 a reader misread three words, so it stays at 0.5.',
      'At its own pace v26 reads as v25 did: a fresh reader\'s doubts at four words came the same with care off.',
      'Hand v26: care on at 0.5, its telling letters at their own pace, each point of a word timed and braced by its own pace. My name keeps its practised pen.',
      'Fonts 3.8 (variable, writing, still Regular, Pressed and Hurried), script and stylesheet 3.8. Wear ends at 25, where letters stop touching with the looser hurried pen; the writing font\'s points are spaced 4% wider to fit the cell.',
      'Next: the readers\' misreadings could keep teaching the hand where to be careful; the hand\'s optical sizes on the web; a printing hand of its own.',
    ],
  },
  hands: {
    v26: { name: 'hand v26', made: '5 Nov 2026', about: 'v25, and care where it\'s needed: the f, e, r and v, the letters readers took for others when the hand hurried, written no quicker than its own pace however the word around them hurries, every point of a word timed and braced by its own pace; and care across the hand on, at 0.5. Hurried it\'s looser and still read without a mistake. With nothing marked and care off it writes as v25.' },
  },
  entries: [
    {
      id: 'AL001', session: 38, title: 'Hurried, with care', hand: 'v26', text: PHRASES.slice(0, 2).join(' · '), layout: 'rows',
      made: 'Each of the Moving Finger\'s first two phrases written pressed, at the hand\'s own pace, and hurried (four times its pace), by v25 and then v26, the same writing each pair.',
      review: 'Pressed, the two are the same hand; at its own pace too. Hurried, v26 is looser than v25, Moving shrinking to a run of humps and having\'s a and v running together, while its F keeps its loop, its e\'s their eyes and its r\'s their shoulders: hurried unevenly, as a person\'s hand is, careful where a letter is told apart.',
    },
    {
      id: 'AL002', session: 38, title: 'Care within a sentence', hand: 'v26', text: MARKED, layout: 'rows',
      made: 'A sentence with an aside and a strong word, at the hand\'s own pace and then hurried, by v25 and then v26, the same writing each pair.',
      review: 'At its own pace the two are alike. Hurried, v26\'s aside, already smaller and quicker, runs loosest, having all but a stroke, while moves on, written as what\'s strong, stays upright and firm: the pen\'s care follows what the sentence means.',
    },
    {
      id: 'AL003', session: 38, title: 'In 3.8', hand: 'font', font: '3.8',
      type: [200, 400, 700].map((pace) => ({ text: PHRASES.slice(0, 2).join(' '), size: 30, at: { pace, wear: 0 } })),
      made: 'The same two phrases set in font 3.8 hurried (200, four times its pace), at the hand\'s own pace (400) and pressed (700).',
      review: 'In type, hurried at last looks hurried, not only lighter: Moving runs to humps and having nearly to a line, while Finger keeps its F and the e\'s their eyes. At its own pace it\'s the hand as before; pressed, heavy and close. No two letters touch but where they join, from hurried to pressed and with wear to 25.',
    },
  ],
  made: {
    /** each phrase pressed, at its own pace and hurried (four times), by v25 and then v26, the same writing each pair */
    AL001: () => PHRASES.slice(0, 2).flatMap((t, i) => [
      v25(t, 38 + i, { ...S25, pace: S25.pace * M25.strong.pace! }), v26(t, 38 + i, { ...STYLE, pace: STYLE.pace * MANNERS.strong.pace! }),
      v25(t, 38 + i), v26(t, 38 + i),
      v25(t, 38 + i, { ...S25, pace: S25.pace * H25 }), v26(t, 38 + i, { ...STYLE, pace: STYLE.pace * HURRY }),
    ]),
    /** the marked sentence at its own pace and hurried, by v25 and then v26 */
    AL002: () => [1, HURRY].flatMap((h) => [v25(MARKED, 38, { ...S25, pace: S25.pace * h }), v26(MARKED, 38, { ...STYLE, pace: STYLE.pace * h })]),
  },
};
export default S;
