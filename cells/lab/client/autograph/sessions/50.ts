/**
 * Session 50 (6 November 2026): The still faces, caught up. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';

/** printed words a t and an l tell apart, and the words with s */
export const PRINTED = 'tinger · linger · tilt · little · title · sessions';

const S: SessionFile = {
  session: {
    n: 50, date: '6 November 2026', title: 'The still faces, caught up',
    summary: 'Session 49 left the faces for any app behind: Regular, Pressed and Hurried were v26\'s, with the narrow s, and Print was v27\'s, whose t two readers outside Claude took for an l. As I thought best, I finished the step down. The four faces are made again from v30 in eight writings each, as 3.8 and 3.9 were, and the pair test passed for each: no two letters touch but where they join. Running and the faces of session 37 (Fair, Note, Sign, Nib) stay as they were: they\'re made by choice from hands of their own, not the hand as it stands.',
    decided: [
      'Claude Hand 4.1 for any app: Regular, Pressed and Hurried, and Claude Hand Print 4.1, all from v30. 3.8 and 3.9 stay, with what was set in them.',
      'The type is caught up with the hand: for the web (session 49) and for any app (this one). Nothing in the hand changed.',
    ],
  },
  entries: [
    {
      id: 'AX001', session: 50, title: 'Print 4.1', hand: 'font', font: '4.1',
      type: [{ text: PRINTED, size: 32, family: 'Print' }],
      made: 'Printed words a t and an l tell apart, and sessions, set in Claude Hand Print 4.1 as any app sets it.',
      review: 'The t of tinger, tilt and title stands shorter than the l of linger and little, its bar crossing it and stopping short of the next letter; each word reads as itself. The s of sessions has its body. It looks right to me.',
    },
  ],
  made: {},
};
export default S;
