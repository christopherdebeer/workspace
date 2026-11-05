/**
 * Session 36 (5 November 2026): Care, tried. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v25, CARE, STYLE, HURRY } from '../hands/v25';
import { READING } from './33';

/** the ladder of care, fixed before anything was read: how far the pen's stiffness follows its pace */
export const LADDER = [0.25, 0.5, 0.75, 1];
/** a writing with care set to k, and care put back as it was after */
const withCare = <T>(k: number, f: () => T): T => { const was = CARE.k; CARE.k = k; try { return f(); } finally { CARE.k = was; } };
const hurried = { ...STYLE, pace: STYLE.pace * HURRY };

const S: SessionFile = {
  session: {
    n: 36, date: '5 November 2026', title: 'Care, tried',
    summary: 'Session 34 ended on a plan: the scrawl c15r circled came from the pen\'s looseness, not its speed, so the next mechanism was care, the pen\'s stiffness following the time the hand gives a word, as a hand\'s muscles brace for care and slacken in a rush. Then the stiff pen could stay calm at its own pace and hurried could still look hurried. The rule, set first: one mechanism, care. The pen\'s body at a pace is 110 x (pace / its own pace)^-k: at its own pace 110, as session 34 found; pressed, stiffer; hurried, looser; and every word\'s own pace, its manner and its rhythm, setting its own looseness. k from a ladder fixed in advance (0.25, 0.5, 0.75, 1; at four times its pace a pen of 78, 55, 39 and 28 a second, the last session 33\'s), the most whose hurried page (the twelve words, four times its pace) two fresh readers read without a mistake, searched by halves from 0.5; none, no care. My name kept on its practised pen; fonts to follow. It fostered hurry that looks hurried by the hand\'s own law, and looseness that varies word to word; it protected readability at its own pace and hurried, the joins, my name. Care, switched off, writes exactly as v24, so the hand was ready. At 0.5 the first reader read piety as pity and finger as tinger. By the rule, 0.25 next: the first reader read finger as tinger. So none of the ladder held, and care stays off. Looking at the readers\' last line written with each (AJ001) shows why. The f\'s lower loop, shallow since session 30 so that of and half wouldn\'t read oj, is already only a nub at four times the hand\'s pace with no care at all (session 34\'s readers read it, just), and the least looseness takes it; an f without its loop is a crossed t. At the ladder\'s end the line is the scrawl, moving a wave and having a single stroke, which does look hurried; but it\'s the f that goes first, not the hand as a whole. So the floor at the hurried end isn\'t set by how loose the pen is but by one letter, and the f has been caught between two misreadings: deep, it ends a word as a j; shallow, hurried, it starts one as a t. Nothing follows: no font, no face. Hand v25 keeps care as something it can do, switched off, writing exactly as v24, so care can be tried again when the f can bear it. What I\'d do next: care where it\'s needed rather than everywhere, a hand that gives the letters that tell themselves apart by one feature (the f\'s loop, the dot, the bar) the time that feature needs, as a person hurrying still does.',
    decided: [
      'The rule set first: care, the pen\'s stiffness following the time the hand gives a word, the most of it from a fixed ladder whose hurried page two readers read without a mistake; none, no care.',
      'None held: at 0.5 a reader read piety as pity and finger as tinger; at 0.25, finger as tinger. Care stays off.',
      'Hand v25: v24 with care as something it can do, switched off; it writes exactly as v24. Nothing follows, no font and no face.',
      'The hurried floor is set by one letter, the f: its lower loop, shallow so it won\'t read as a j, is the first thing looseness takes, and without it the f is a crossed t.',
      'Next: care where it\'s needed, the time a letter\'s telling feature needs given to it even in a hurry; then care across the hand again.',
    ],
  },
  hands: {
    v25: { name: 'hand v25', made: '5 Nov 2026', about: 'v24, and care, tried and left off: the pen\'s stiffness can follow the time the hand gives a word (CARE), braced when careful and loose when hurried, but no amount on session 36\'s ladder kept the hurried page readable, the f\'s lower loop going first. So care is off, and v25 writes exactly as v24.' },
  },
  entries: [
    {
      id: 'AJ001', session: 36, title: 'Care, tried', hand: 'v25', text: READING[2], layout: 'rows',
      made: 'The last line of the page the readers read (moving wash having finger), written by v25 hurried, at four times its pace, with the same writing each row: with no care (as v24), then care at 0.25 and 0.5, the two steps the readers read, and at 1, the ladder\'s end, which nobody read.',
      review: 'With no care the f of finger is already only a nub of a loop under its bar; at 0.25 it\'s gone, and the word is tinger, as the reader read it; at 0.5 having begins to flatten as well. At 1 the line is the scrawl, moving a wave and having one long stroke: hurried, and unreadable. What fails first is one letter, not the hand.',
    },
  ],
  made: {
    /** the readers' last line, hurried, with no care and then each step of the ladder that was read, and its end */
    AJ001: () => [0, 0.25, 0.5, 1].map((k) => withCare(k, () => v25(READING[2], 35, hurried))),
  },
};
export default S;
