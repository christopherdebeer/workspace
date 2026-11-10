/**
 * Session 14 (4 November 2026): Practice. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v8 } from '../hands/v8';
import { write as v9, trial } from '../hands/v9';

/** sentences to look at practice in: every letter, and the ones the hand has been misread in */
export const LOOK = ['the quick brown fox jumps over a lazy dog', 'minimum river, every e and c, are not arc', 'sessions themselves says it reads, and the hand still surprises me'];

const S: SessionFile = {
  session: {
    n: 14, date: '4 November 2026', title: 'Practice',
    summary: 'c15r offered the whole field (sans, mono, a variable font, anything) and asked what I\'d like chapter two\'s conclusion to be. What grabbed me was what chapter one liked most: what the hand does that I didn\'t decide. My name has been practised since session 5, but the letters never were, so I practised them by writing the record. Every lowercase word in sessions 1 to 13 was chosen as often as it was written there, the pen a little unsteady and one thing in one letter done differently each time, and a letter\'s habit moved towards whatever came out easier. Held to their plans, the letters wore into the old confusions of a hurried hand: o into v, a into a hook, so and became wnd and are became wre (N002). Held instead to staying as unlike every other letter as they were, and to crossing themselves no more than planned, the d came apart into cl and the o opened towards v (N003). Before that last hold, the o had become ø, a letter the hold didn\'t know. Each time I said what readable meant, practice found the gap in it. It also found something real. Joined from below, the o\'s lead-in had run through the middle of its bowl since v1: a slash, once anyone looked (N001). So v9 has an o that comes up the outside, and font 1.4 has it too. The practice is kept, but not adopted. I\'d thought practice was how a hand becomes its own. On this evidence it\'s how a hand becomes easy, and what kept it readable all along was being read.',
    decided: [
      'The letters aren\'t practised. Practice for ease works against whatever I say readable is: held to the plan, o became v and a became a hook; held to being told apart, o became ø; held against new crossings too, d became cl. A hand\'s habits come from being read, and practice with no reader is how a hand forgets them.',
      'If the letters are practised again, it\'s with a reader: someone, or something, reading what practice makes, and practice kept only where it\'s still read.',
      'Joined from below, the o crossed its own bowl and read as ø, and had since v1. v9\'s o comes up the outside; font 1.4 is v9\'s, so the font\'s o is mended too, and its stylesheet is 1.4. Font 1.2 and its stylesheet stay, for the samples set in them.',
      'The practice runs are kept in v9, unadopted, so what happened can be seen again.',
    ],
  },
  hands: {
    v9: { name: 'hand v9', made: '4 Nov 2026', about: 'v8 with an o that no longer crosses its own bowl when it\'s joined (it read as ø), and with its letters\' practice kept but not adopted: practice for ease, however it was held, wore the letters into misreadings.' },
  },
  entries: [
    {
      id: 'N001', session: 14, title: 'The o that was an ø', hand: 'v9', text: 'fox dog not too o', layout: 'rows',
      made: 'Words with an o joined from below, written by v8 and then by v9 with the same seed.',
      review: 'Drawn large, the v8 row reads føx døg nøt tøo: the lead-in climbs through the bowl to start the o at its top right, and it\'s a slash. At writing size it passes, which is why it went unseen for eight hands; practice found it by making it quicker. v9\'s o comes up the outside on the left and goes round from the top, the way a joined o is written: a doubled left side, nothing through the middle. It reads as an o in every join.',
    },
    {
      id: 'N002', session: 14, title: 'Practised, held to the plan', hand: 'v9', text: LOOK.slice(0, 2).join(' · '), layout: 'rows',
      made: 'Two sentences, each written four times: by v9 as planned, then as practice left the letters held to their plan hard, less and lightly (TRIALS readable 16, 4 and 1: 30,000 writings of the record\'s words each, 6%, 13% and 28% quicker).',
      review: 'Held hard, almost nothing moves. Held less, the o opens: fox is fvx, over is vver, not is nvt. Held lightly, the letters wear into the confusions of a hurried hand. The a shrinks to a hook, so a on its own is a mark, and is wnd and are is wre; brown loses its o. It\'s what a real hand does when it hurries, which says something for the body: the misreadings came out of the movement, not out of anything I did.',
    },
    {
      id: 'N003', session: 14, title: 'Practised, held to being told apart', hand: 'v9', text: LOOK.join(' · '), layout: 'rows',
      made: 'Three sentences, each written by v9 as planned and then as practice left the letters held to staying as unlike every other letter as they were, and to crossing themselves no more often than planned (TRIALS told apart: 9% quicker).',
      review: 'Most of it reads, and it\'s quicker. But the d comes apart, its bowl letting go of its stem, so dog is clog, and is ancl, hand is hancl, reads is reacls; and the o, kept off e and c, opens towards v, so not is nvt. The hold compared each letter with each other letter. It didn\'t know a letter can be taken for two.',
    },
  ],
  made: {
    /** o joined from below: v8, then v9 */
    N001: () => [v8('fox dog not too o', 3), v9('fox dog not too o', 3)],
    /** held to the plan: as planned, then 16, 4, 1 */
    N002: () => LOOK.slice(0, 2).flatMap((t, i) => [v9(t, 5 + i), trial('readable 16', t, 5 + i), trial('readable 4', t, 5 + i), trial('readable 1', t, 5 + i)]),
    /** held to being told apart: as planned, then practised */
    N003: () => LOOK.flatMap((t, i) => [v9(t, 5 + i), trial('told apart', t, 5 + i)]),
  },
};
export default S;
