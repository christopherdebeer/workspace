/**
 * Session 56 (6 November 2026): What the pen does as it goes. What it found and decided, its samples, and how each is
 * made. Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v34write, page as v34page } from '../hands/v34';

/** a sentence that rises, then falls, then speaks in another voice */
export const RISE = 'It <rising>gets louder, and louder, and louder</rising>, then <falling>trails away to almost nothing</falling>. Said in a round hand, then <broad>in another voice</broad>.';
/** the page written to be kept (session 25), written at length */
export const MOVING = 'The Moving Finger writes; and, having writ, Moves on: nor all thy Piety nor Wit Shall lure it back to cancel half a Line, Nor all thy Tears wash out a Word of it.';

const S: SessionFile = {
  session: {
    n: 56, date: '6 November 2026', title: 'What the pen does as it goes',
    summary: 'c15r asked whether the pen\'s broadness should vary, then whether variation can happen inside a letter, and suggested markup for changes within words and sentences, with the extremes explored before deciding. A variable font can vary only from glyph to glyph: each glyph is one outline for each setting of its axes. The hand\'s pen is worked out at every point, so it can change anywhere. I drew twelve extremes on one writing of a sentence, the pen as a shape (a rounded edge with a width, a thickness and an angle) swept along the line. Round to broad over a sentence looked the same continuous, a letter at a time, or a word at a time, so for any change slower than a letter type loses nothing. The nib turned inside every letter read as an unsteady hand: variation inside a letter carries something when the movement causes it (the edge thinning along its own direction, a pointed nib swelling on the way down) and is noise when it\'s imposed. Three things carried meaning. Widening or pressing harder read straight away as a sentence getting louder. A pen running dry and dipped again looked the most human of all, though it dipped in the middle of a word. And a flat, very broad edge was another voice. The angle swinging from 0 to 90 degrees just looked wrong. So I encoded what carried meaning, as markup that says what I mean. Hand v34 reads <rising> (pressing harder and harder), <falling> (lifting off, finer and paler) and <broad> (another voice), reckoned over the whole text so a rise goes on across a line\'s end. It changes nothing in how the hand moves, and carries the pen at each stroke\'s start and end. The notebook\'s pen is now one shape swept along the line, changing as the stroke goes, inside letters. Its ink can run out as it writes and is dipped again at a pause, as Write now has it. Type follows a word at a time, not a letter: a font changes letter by letter only by shaping each letter alone, which loses its joins. Louder is heavier on the pace axis, softer lighter and paler, and the broad voice is Claude Hand Broad. The pen as an axis of the font itself is still to come.',
    decided: [
      'Hand v34: <rising>, <falling> and <broad>, the pen as it goes, reckoned over the whole text; nothing in how the hand moves changes. It\'s the newest hand.',
      'The notebook\'s pen is a shape swept along the line, changing as the stroke goes; ink can run out and be dipped again at a pause, and Write draws with it.',
      'In type the pen changes a word at a time, so words keep their joins: louder heavier, softer lighter and paler, the broad voice in Claude Hand Broad. Text without the pen\'s elements is set exactly as before.',
      'Not encoded: the nib turned by where it is, the angle swept, speed as the whole pen. They were tried at their extremes and said nothing.',
      'Next: the pen as an axis of the variable font, set by size (round small, broad large) and free for markup to change; and the type for reading caught up with the hand.',
    ],
  },
  hands: {
    v34: { name: 'hand v34', made: '6 Nov 2026', about: 'v33, and what the pen does as it goes: <rising> (pressing harder and harder), <falling> (lifting off, finer and paler) and <broad> (another voice), reckoned over the whole text; each stroke carries the pen at its start and end for the notebook\'s pen to draw between. Nothing in how the hand moves changes: everything else writes exactly as v33.' },
  },
  entries: [
    {
      id: 'BD001', session: 56, title: 'Louder, and softer', hand: 'v34', text: RISE,
      made: 'The sentence written by v34 (seed 3), with the round pen, the pen changing as it goes.',
      review: 'The rise reads at once: louder, and louder, and louder, each heavier than the last and heavier inside its own letters. The fall goes finer and paler to almost nothing. The other voice is quiet at this size: thick and thin, where the round pen has none.',
    },
    {
      id: 'BD002', session: 56, title: 'Louder, and softer, with the broad pen', hand: 'v34', text: RISE, pen: 'broad',
      made: 'The same writing (seed 3) drawn with the broad pen.',
      review: 'With the broad pen the rise is a broader and broader edge; the fall keeps its hairlines and loses its weight.',
    },
    {
      id: 'BD003', session: 56, title: 'The ink running out', hand: 'v34', text: MOVING, layout: 'page', dip: true,
      made: 'The Moving Finger written by v34 as a page (lines broken at 26 x-heights, seed 6), with ink that runs out as the pen writes and is dipped again at the first pause once it\'s low, or straight away if it\'s dry.',
      review: 'The ink fades through a few words and comes back dark after a pause: after writes;, after on:. It never dips in the middle of a word unless it has run dry.',
    },
    {
      id: 'BD004', session: 56, title: 'Louder, and softer, in type', hand: 'font', font: '4.1',
      type: [{ text: RISE, size: 30, way: 'web' }],
      made: 'The sentence set in Claude Hand 4.1 on the web, the pen a word at a time: louder heavier on the pace axis, softer lighter and paler, the other voice in Claude Hand Broad 5.5.',
      review: 'Every word keeps its joins. The fall shows, paler a word at a time; the rise barely does, since the pace axis at its heaviest is not much heavier at this size. Type needs a pen of its own to rise as the hand does: the next thing to make.',
    },
  ],
  made: {
    BD001: () => [v34write(RISE, 3)],
    BD002: () => [v34write(RISE, 3)],
    BD003: () => v34page(MOVING, 26, 6),
  },
};
export default S;
