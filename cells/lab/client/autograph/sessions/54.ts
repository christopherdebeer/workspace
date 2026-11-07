/**
 * Session 54 (6 November 2026): The pen. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v32write } from '../hands/v32';

/** what the broad pen was looked at with: the masthead's words, and the capitals */
export const PEN_WORDS = ['Claude Hand', 'ABCDEFGHIJKLM NOPQRSTUVWXYZ'];
/** the Broad face, set as it's meant to be, large, and once at the size of reading */
export const BROAD_LINES = ['Claude Hand Broad', 'The Moving Finger writes; and, having writ,', 'Bring the long rope from the shed, and the lamp with the green glass.'];

const S: SessionFile = {
  session: {
    n: 54, date: '6 November 2026', title: 'The pen',
    summary: 'Asked what the poster told me about my hand, I said: set large it\'s thin. Its range is in time and meaning, never in form, and only the signature has presence. I wanted to start with the pen. Every line until now was drawn by a round pen whose width followed only the hand\'s speed. I tried two other pens on the same writing, drawn large. One was a broad pen, an edge held at an angle, so a line is as thick as the edge is turned across its way. The other was a pointed pen, swelling on the downstrokes. The pointed pen beaded at every join. The broad pen gave the hand presence at once: its downstrokes broad, the strokes that join its letters hairlines along the edge. Its slanted, joined forms looked made for that pen, and its capitals came out as italic capitals for the first time. Held at 40 degrees and about a quarter of an x-height across (1.8 times the round pen), it stayed light enough to read; at 30 degrees it went heavy. At the size of reading the round pen still reads better, because the hairlines fade and the letters come apart, as an italic does small. So it\'s a pen for display, which is what a broad pen is. It\'s the same pen in the notebook (ink.ts) and in the font builder: each step of a stroke is the parallelogram the edge passes over, all filled together as one shape, with the edge\'s own thickness as a fine line and the hand\'s speed still telling a little. The hand didn\'t change; this is v32 with another pen. Claude Hand Broad 5.4 is the hand set with it, in eight writings, no two letters touching. The poster\'s title and plate titles are set in it, it has a figure of its own among the relations, and my signature at the top is written with the broad pen. One reader, a Claude model shown only a sample in Broad at three sizes under a neutral name, read every word. It called it an italic, chancery hand from a broad-edged nib: bold at the largest size, lively in the middle, compact and legible small, where it could take writing for waiting at a glance.',
    decided: [
      'The broad pen: an edge at 40 degrees, 1.8 times the round pen across, the same in the notebook and the font. It\'s for display; the round pen stays the pen for reading.',
      'Claude Hand Broad 5.4, from hand v32 as it is, on the Font page, among Write\'s faces, and on the poster (its title, its plate titles and a figure of its own).',
      'My signature at the top of the poster is written with the broad pen; everywhere else it\'s as it was.',
      'The pointed pen was tried and left out: it beaded at every join.',
      'Next: the letters as forms, looked at large, now the pen shows them.',
    ],
  },
  entries: [
    {
      id: 'BB001', session: 54, title: 'Claude Hand, with the broad pen', hand: 'v32', text: PEN_WORDS[0], pen: 'broad',
      made: 'Claude Hand written by v32 (seed 54) and drawn with the broad pen: an edge at 40 degrees, 1.8 times the round pen across.',
      review: 'Its downstrokes are broad and its joins are hairlines; the C swells round its bowl. The tops of the d and the H have a small spur where the lead-in turns tightly under the edge, and at this size they pass for a pen\'s entry. Drawn with the round pen, the same writing looks like a felt-tip\'s.',
    },
    {
      id: 'BB002', session: 54, title: 'The capitals, with the broad pen', hand: 'v32', text: PEN_WORDS[1], pen: 'broad',
      made: 'The capitals written by v32 (seed 55) and drawn with the broad pen.',
      review: 'The capitals are italic capitals for the first time: the O, Q, S and G go from thick to thin as the edge turns through them. Nothing in their shapes changed; only the pen did.',
    },
    {
      id: 'BB003', session: 54, title: 'Claude Hand Broad 5.4', hand: 'font', font: '5.4',
      type: [{ text: BROAD_LINES[0], size: 64, family: 'Broad' }, { text: BROAD_LINES[1], size: 36, family: 'Broad' }, { text: BROAD_LINES[2], size: 20, family: 'Broad' }],
      made: 'Claude Hand Broad 5.4 set as any app sets it: large, then at 36 and 20 px.',
      review: 'Set large, it carries a page\'s title as the round faces never did. At 20 px it\'s lighter and a little scratchy, still read, but the Regular is the face for text.',
    },
  ],
  made: {
    /** written by v32 and drawn with the broad pen (the entry says which pen) */
    BB001: () => [v32write(PEN_WORDS[0], 54)],
    BB002: () => [v32write(PEN_WORDS[1], 55)],
  },
};
export default S;
