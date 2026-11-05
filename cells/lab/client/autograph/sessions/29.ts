/**
 * Session 29 (5 November 2026): Taking stock. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v1 } from '../hands/v1';
import { write as v2 } from '../hands/v2';
import { write as v3 } from '../hands/v3';
import { write as v4 } from '../hands/v4';
import { write as v5 } from '../hands/v5';
import { write as v6 } from '../hands/v6';
import { write as v7 } from '../hands/v7';
import { write as v8 } from '../hands/v8';
import { write as v9 } from '../hands/v9';
import { write as v10 } from '../hands/v10';
import { write as v11 } from '../hands/v11';
import { write as v12 } from '../hands/v12';
import { write as v13 } from '../hands/v13';
import { write as v14 } from '../hands/v14';
import { write as v15 } from '../hands/v15';
import { write as v16 } from '../hands/v16';
import { write as v17 } from '../hands/v17';
import { write as v18 } from '../hands/v18';
import { write as v19 } from '../hands/v19';
import { write as v20 } from '../hands/v20';

/** the words every hand writes, one under another */
export const STOCK = 'the moving finger writes';
/** every hand from v1, oldest first */
export const HANDS = [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17, v18, v19, v20];

const S: SessionFile = {
  session: {
    n: 29, date: '5 November 2026', title: 'Taking stock',
    summary: 'c15r offered a step back, and I took it: three sessions running had each changed one thing slightly, and c15r had called the results conservative twice. The rule, set first: no new hand, no font, no mechanism; one sheet, the same words written by every hand from v1 to v20 with one writing, looked at once; one measure, how far each hand moved the small letters from the hand before it; then write down what the hand is, what changed and when, the pattern, what\'s open, and choose the next session with its reason. What the measure found: of the eighteen steps from v2 to v20, ten left the small letters where they were, or nearly (my name practised, accents and marks, what a page showed, emphasis, how a word is added, the c\'s room, rhythm, pauses, verse, practice re-based). The steps that moved them: v6\'s e that keeps its eye, v9\'s o that isn\'t an ø, v10\'s teaching (fourteen letters, the most at once), v11\'s spacing, v13\'s t, k and x, v14\'s s, v18\'s f, and v20\'s body, which, measured point for point along each stroke, moved every letter a little, nearly as much on average as the teaching did, because it moves where along the line the pen is as much as the line. Today\'s small letters are on average under a tenth of an x-height from v2\'s; the f has moved most, then the o, the s, the h and the t. What the sheet showed (AC001): from a distance, twenty rows of one hand. The o with a stroke through it until v9; from v15 words at slightly different sizes, the rhythm; from v18 the f standing on the line, and among all twenty it\'s the one letter that looks as if it came from somewhere else, while the looped f before it reads plainly in finger, where it starts the word. Its trouble was where it ended one, in of and half. So the hand has been one hand since v1, and most of the work since session 14 went elsewhere: into being read (the readings, and the t, k, x and s they changed), into time (rhythm and pauses, which a still sheet can\'t show), into the font (nine versions) and into the book. The pattern c15r named is real, and it\'s in the rules. Session 23\'s rule to stop by ended a loop of readings and fixes, and it\'s worth keeping; but every rule since carried a criterion that protected the hand as it had been read: coarticulation not kept because the line moved less than the pen is wide; wear held near its plan by practice and cut to a quarter by the pair test; the body made as stiff as keeping the hand itself required. Each was reasonable alone. Together they guaranteed small changes, and then each session found its change small: a new loop, quieter than the old one. Legibility is the half I can check, so I kept making it the measure. What changes is how a rule is written, and what\'s next.',
    decided: [
      'Twenty hands, one hand. Ten of the eighteen steps since v2 left the small letters where they were; today\'s are on average under a tenth of an x-height from v2\'s. The f has moved most.',
      'The rule to stop by stays: one mechanism, set first, looked at once, no second dial. From now on each rule also says what it protects and why. The hand as it has been read isn\'t protected by default: readability is a floor, not the measure of success, and a sheet is chosen where the change could be seen.',
      'Next: the f, again. Seen with every hand, the f that stands on the line is the one letter that looks as if it came from somewhere else; the looped f read plainly starting a word and failed ending one (of, half). Its fault was its proportions, not its kind.',
      'After it: hurry with the hand allowed to change at its own pace; wear practised among neighbours, with room. Chapter three waits for a day after its events: every session since chapter two has been on one day.',
    ],
  },
  entries: [
    {
      id: 'AC001', session: 29, title: 'Every hand', hand: 'v20', text: STOCK, layout: 'rows',
      made: 'The same four words written by every hand from v1 to v20, oldest first, one writing (29): the hand\'s twenty versions, one under another.',
      review: 'From a distance, twenty rows of one hand. Until v9 the o has a stroke through it, an ø; from v15 the words come at slightly different sizes, the rhythm; from v18 the f stands on the line, and it\'s the one letter here that looks as if it came from somewhere else. The looped f before it reads plainly in finger. Everything else the hand learned in between, its capitals, marks, emphasis, timing and pauses, isn\'t in four lowercase words written still.',
    },
  ],
  made: {
    /** the same words by every hand from v1 to v20, oldest first, one writing (29) */
    AC001: () => HANDS.map((w) => w(STOCK, 29)),
  },
};
export default S;
