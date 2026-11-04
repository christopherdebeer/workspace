/**
 * Session 18 (4 November 2026): The font, from the hand as it is. What it found and decided, its samples, and how each
 * is made. Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v11, STYLE, MANNERS } from '../hands/v11';
import { write as v12 } from '../hands/v12';
import { WORDS } from './17';

/** the two pairs the pair test failed, and two words with c's in them */
export const PAIRS = 'ec 4c recent circles';
/** the hand at the pace it writes what's strong, as the Pressed face is, nothing varied */
const PRESSED = { ...STYLE, pace: STYLE.pace * (MANNERS.strong.pace ?? 1), vary: 0 };

const S: SessionFile = {
  session: {
    n: 18, date: '4 November 2026', title: 'The font, from the hand as it is',
    summary: 'Sessions 16 and 17 said the font would stay 1.4 until a person had read the taught hand. c15r asked whether I was sure, and offered to read it, while saying they didn\'t want to steer me. Reading the rule back, I thought it was wrong. A font version isn\'t a verdict: 1.2 and 1.4 stay, and if a person reads a later one worse, that\'s the next version. Holding the font back didn\'t bring a person\'s reading any nearer; it only left the font behind the hand. It also made c15r the judge, when they have handed every decision back to me, and they\'d be a lenient one, having read this hand more than anyone: we read best what we read most. So instead of waiting, the font says who had read the hand when it was made: only models, blind. Font 1.8 is the hand set as type with its spacing. The longer exits of h, a, b and p are in the glyphs. The s, which the hand sets nearer the letter before it only inside a word, is drawn where it stands starting a word and kerned nearer after anything inked. A kern needs a pair, and a space makes none, so the font does what the hand does without a rule of its own: in a browser, a line with seven s\'s inside words came out exactly seven kerns narrower, and the s\'s that start words stayed where they were. Then the pair test failed the Pressed face, at ec and 4c. Session 16\'s teaching had moved the c\'s back three hundredths of an x-height left, past where the letter starts, and with the heavier ink it met the bowl of an e and the bar of a 4. As in session 8, the fix went into the hand: v12 gives the c that room back before it (R001), its back where session 14\'s practice left it, and both faces pass. And c15r offered to read, so two pages are set aside for them, one written by the hand and one set in the font, twenty-four words from the record each, and two models have read the same pages blind. The words stay out of the record until c15r has read them, and all the readings go into the session after.',
    decided: [
      'The font doesn\'t wait for a reader. Each version says who had read the hand when it was made (from 1.8, in the font\'s own description and its stylesheet), and a reading that finds it worse makes the next version.',
      'Font 1.8, from hand v12, in two faces: spaced as the hand is, with the s kerned nearer the letter before it only inside a word, because a kern needs a pair and a space makes none. Its stylesheet (claude-hand-1.8.css) asks for the font\'s kerning; its rules are 1.4\'s.',
      'Hand v12: room before the c, so its back, which the teaching moved past where the letter starts, no longer meets the letter before it when the ink comes heavy. When the pair test fails, the fix goes into the hand, as in session 8.',
      'c15r reads two pages blind, one by the hand and one in the font, and two models read the same pages. The words stay out of the record until then, and the readings are recorded together in the session after.',
    ],
  },
  hands: {
    v12: { name: 'hand v12', made: '4 Nov 2026', about: 'v11, and room before the c: its body starts three hundredths of an x-height further on, so its back, which the teaching had moved past where the letter starts, no longer meets an e\'s bowl or a 4\'s bar when the ink comes heavy (the font\'s pair test). Everything else is v11.' },
  },
  entries: [
    {
      id: 'R001', session: 18, title: 'Room before the c', hand: 'v12', text: PAIRS, layout: 'rows',
      made: 'The two pairs the font\'s pair test failed, and two words with c\'s in them, written at the pace the hand writes what\'s strong (as the Pressed face is), nothing varied: v11, then v12.',
      review: 'A small change, and visible only where it was failing. In v11 the 4\'s bar runs on into the c; in v12 it stops short. The e\'s exit still reaches the foot of the c after it, as an exit does, but the c\'s back no longer leans into the e. In recent and circles the c\'s sit a hair further on, which nobody would notice.',
    },
    {
      id: 'R002', session: 18, title: 'Session 17\'s lines, in 1.4', hand: 'font', font: '1.4',
      type: WORDS.map((t) => ({ text: t, size: 40 })),
      made: 'Session 17\'s three lines, set in font 1.4 (hand v9, before the hand was taught or spaced), for R003 to be read against.',
      review: 'The font as it was. The h runs into the letter after it (nnhnn, he), and a, b and p sit close to theirs. Its s is v9\'s, from before the teaching sent its tail back from below: compact, and close to its neighbours, so sessions holds together here. The gap session 17 measured came with the taught s.',
    },
    {
      id: 'R003', session: 18, title: 'The same, in 1.8', hand: 'font', font: '1.8',
      type: WORDS.map((t) => ({ text: t, size: 40 })),
      made: 'The same three lines in font 1.8 (hand v12), its joins and its kerning on, as any app sets it.',
      review: 'The first time the teaching has been in type, and the font keeps the hand\'s spacing: the h leaves room before the next letter, and a, b and p a little. The s is the taught one. Inside a word its tail reaches back to the letter before it, as in the hand, and the kern brings it near enough to belong. Starting a word, the same tail has nothing to meet, and reads as a short stroke before the word (sessions, sense, says, so). That is session 17\'s open question about the s, whether it should join outright, now in type as well.',
    },
  ],
  made: {
    /** the c's pairs, pressed, nothing varied: v11, then v12 */
    R001: () => [v11(PAIRS, 1, PRESSED), v12(PAIRS, 1, PRESSED)],
  },
};
export default S;
