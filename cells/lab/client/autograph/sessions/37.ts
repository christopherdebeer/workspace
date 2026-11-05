/**
 * Session 37 (5 November 2026): What a hand can be. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v25, CARE, STYLE, HURRY } from '../hands/v25';
import { write as v23, STYLE as STYLE23 } from '../hands/v23';
import { FINGER } from './25';
import { PHRASES } from './27';

const TWO = FINGER.split('\n').slice(0, 2).join('\n');
/** a writing with care set to k, and care put back as it was after */
const withCare = <T>(k: number, f: () => T): T => { const was = CARE.k; CARE.k = k; try { return f(); } finally { CARE.k = was; } };

const S: SessionFile = {
  session: {
    n: 37, date: '5 November 2026', title: 'What a hand can be',
    summary: 'c15r asked whether we should look at how type organises faces and families, to see whether the set I\'d chosen was the one I wanted or whether there were others I\'d like to express even before the hand could; and said rules are meant to be broken, in creativity and expression at least. Session 36 had shown it: a rule that took readers as its gate ended with nothing made, the readers\' floor become the measure again, the trap session 29 had named one level up. So this session kept the rules that keep me honest (say what I\'m after before looking, look once, tell what I find straight) and broke the rest: no one mechanism, no ladder, no gate; research first, then make what I found I wanted, judged by eye, readers if at all only to describe. The reading. Type has long cut one design differently for different sizes, sturdier and more open for captions, finer for display (and a variable font\'s optical size axis lets a browser choose by the size it sets); what handwriting research finds is that a hand keeps its letters\' shapes at any size, size controlled apart from shape, so for a hand what changes with size is its pen, which doesn\'t scale. Handwriting families are often cut by instrument, pen, felt-tip, brush and pencil, because the tool makes the contrast: pencil and ballpoint a monoline, a brush or a flexible pointed nib thick downstrokes and hairline upstrokes, the pressure coming on just after a turn and going just before the next. Scripts come formal and casual (Recursive\'s Casual axis runs from linear to casual), and Zapfino first came as four alphabets to mix. What I made, six faces from the hand as it stands, the pen\'s widths changed for the size or the instrument where that was the thing: Fair, the fair copy, written as the hand writes with care; Print, every letter on its own; Note and Sign, the hand written small and large with the same pen; Nib, the hand with a pointed pen; Rushed, the hand at four times its pace with care full on. Looked at together, once (AK001). Fair reads as the careful copy it is. Note, set small, is plainly sturdier and easier to read than the regular face, which goes spindly there; Sign, set large, is a fine light line where the regular face goes heavy: the hand\'s own optical sizes, from one pen. Nib is a different instrument, not a different weight, and the one I like best; one pair touches in it, a 7 before an apostrophe. Print only lifted the cursive letters apart: a printing hand needs letters of its own, which this hand hasn\'t got. And Rushed came out all but the same as Claude Hand Running (AK002): care at its full at four times the pace reaches the same scrawl as session 33\'s loose pen at twice, so Running already holds it. Kept: Fair, Note and Sign, faces of Claude Hand, and Claude Hand Nib, a family of its own, as 3.7, for any app; eight writings each, nobody having read them. Not kept: Print and Rushed, and why. What it found: the hand had more in it than pace, and type\'s old divisions, size and instrument and formality, were ways to say it; what it can\'t yet say is a printing hand, a pencil\'s grain, and its time on the web at a size of its own.',
    decided: [
      'This session broke the usual rule on purpose: research first, then making what I found I wanted, judged by eye, with no ladder and no readers\' gate. Kept from the rules: say what I\'m after before looking, look once, tell it straight.',
      'Claude Hand 3.7, for any app: Fair, the fair copy; Note and Sign, the hand written small and large with the same pen, its own optical sizes; and Claude Hand Nib, the hand with a pointed pen. Eight writings each; nobody has read them.',
      'Not kept: Print, which only lifted the cursive letters apart (a printing hand needs letters of its own), and Rushed, which came out as Claude Hand Running already is.',
      'Still to be able to say: a printing hand, a pencil\'s grain, and the hand\'s sizes on the web, where an optical size axis would let a page choose them by itself.',
    ],
  },
  entries: [
    {
      id: 'AK001', session: 37, title: 'More of what a hand can be', hand: 'font', font: '3.7',
      type: [
        { text: TWO, size: 26, family: 'Fair' },
        { text: TWO, size: 26, family: 'Nib' },
        { text: FINGER.split('\n').slice(2).join(' '), size: 13, family: 'Note' },
        { text: 'The Moving Finger', size: 56, family: 'Sign' },
      ],
      made: 'The Moving Finger in the faces kept from session 37, as any app sets them: its first two lines in Fair and in Claude Hand Nib at 26 px; its last two in Note at 13 px, where type is set small; and its first words in Sign at 56 px, where it\'s set large.',
      review: 'Fair is upright and unhurried, a copy made to keep. Nib swells on every downstroke and thins to a hairline going up, the F of Finger and the M of Moves most of all: a different instrument, not a heavier hand. Note at 13 px stays solid and open where the regular face goes thin; Sign at 56 px is a fine line, the letters large and the pen not, as when a hand writes big with the pen it has.',
    },
    {
      id: 'AK002', session: 37, title: 'Rushed is Running', hand: 'v25', text: PHRASES.slice(0, 2).join(' · '), layout: 'rows',
      made: 'Each of the Moving Finger\'s first two phrases written rushed, by v25 at four times its pace with care at its full (1), then running, by v23 at twice its pace on session 33\'s loose pen (Claude Hand Running), the same writing each pair.',
      review: 'All but the same: the rushed rows are a touch more worn down (Moving flatter, and nearly gone into its hook), but it\'s one scrawl. The pen can only lag so far, and both reach it. So Running already is the rushed hand, and Rushed isn\'t kept.',
    },
  ],
  made: {
    /** each phrase rushed (v25 at four times its pace, care at 1), then running (v23 at twice its pace), the same writing */
    AK002: () => PHRASES.slice(0, 2).flatMap((t, i) => [
      withCare(1, () => v25(t, 37 + i, { ...STYLE, pace: STYLE.pace * HURRY })),
      v23(t, 37 + i, { ...STYLE23, pace: STYLE23.pace * 2 }),
    ]),
  },
};
export default S;
