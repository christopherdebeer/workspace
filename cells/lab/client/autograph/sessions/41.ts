/**
 * Session 41 (5 November 2026): Taught by misreadings. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v27, CARE, TELLING, STYLE, HURRY } from '../hands/v27';
import { READING } from './33';

/** a second page of twelve words with no sense to guess from, never used to teach the hand */
export const FRESH = ['quietly bridge velvet pocket', 'hazard oblige monkey journal', 'whisper oxygen dwelling spark'];
/** the letters the first page's misreadings taught, added to the four the hand already writes with care */
export const TAUGHT = 'fervlusah';
const hurried = { ...STYLE, pace: STYLE.pace * HURRY };
/** a writing with care and the careful letters set so, and both put back after */
const withCare = <T>(k: number, letters: string, f: () => T): T => { const was = [CARE.k, TELLING.letters] as const; CARE.k = k; TELLING.letters = letters; try { return f(); } finally { CARE.k = was[0]; TELLING.letters = was[1]; } };

const S: SessionFile = {
  session: {
    n: 41, date: '5 November 2026', title: 'Taught by misreadings',
    summary: 'Proceeding as I saw fit, I took up the open thread of sessions 38 and 40: letting the readers\' misreadings go on teaching the hand where to take care, to see whether care could go to its full, the most hurried the hand looks, and still be read. Session 38 had found that care at 1 lost three words even with the f, e, r and v written with care: lure read as here, wash as well, having as living. The loop, set first: take the letters a misread word turned on, write them with care too, and read again with a fresh reader; then, if a page reads clean, a second fresh reader on a page of twelve new words the hand wasn\'t taught on; and if the careful letters grow past about ten, stop, because then the hand isn\'t hurrying any more. The first round added the letters those three misreadings turned on, l and u, a, s and h, nine careful letters in all. The page still looked hurried, minimum and moving and word running loose, and a fresh reader read all twelve words without a mistake: the page that had failed in session 38. Then the new page, and a fresh reader made five mistakes in twelve: pocket read as prayer, monkey as number, oxygen as corner, dwelling as yellow, spark as shark (AO002). The letters these turned on were new ones, the o, the c and the k, the m, the x, the y and the g, the d, the w and the p: the taught list fitted the page it was taught on, and at full care the hand fails somewhere else on any other. Teaching on would make nearly every letter careful, which is the stop I\'d set. So care at its full stays where session 36 left it, out of reach. And a check the session owed session 38: its choice, care at 0.5 with the four careful letters, had only ever been read on the page it was chosen on. On the new page a fresh reader read the hand as it stands without a mistake. So the hand stays as it is, nothing new in it and nothing new in the fonts. What it found: at full care the trouble isn\'t a few letters but the hand; misreadings can teach where care is needed only up to the point where it\'s needed everywhere. And the hand as it stands holds on words it was never chosen on.',
    decided: [
      'Taught by misreadings, care at its full read clean on the page it was taught on, and made five mistakes in twelve on a page it wasn\'t; the letters it would need next were new ones. Stopped, as set, before nearly every letter was careful.',
      'The hand as it stands, care at 0.5 with the f, e, r and v written with care, read a page it was never chosen on without a mistake: session 38\'s choice holds.',
      'Nothing new in the hand or the fonts.',
    ],
  },
  entries: [
    {
      id: 'AO001', session: 41, title: 'Taught', hand: 'v27', text: READING[1], layout: 'rows',
      made: 'The readers\' second line (writes lure handwriting word) hurried, at four times its pace, the same writing each row: with care at its full and the four careful letters, as session 38 left it; with the letters the misreadings taught added (l, u, a, s, h); and as the hand stands, care at 0.5.',
      review: 'With four careful letters, lure is nearly here; taught, it\'s lure again, and the words around it still run loose, as the page a reader then read clean. As the hand stands it\'s tidier, and less hurried.',
    },
    {
      id: 'AO002', session: 41, title: 'And a page it wasn’t taught on', hand: 'v27', text: FRESH[0], layout: 'rows',
      made: 'The first line of a page the hand wasn\'t taught on (quietly bridge velvet pocket), hurried: with care at its full and the taught letters, then as the hand stands.',
      review: 'Taught, pocket runs out into something a reader took for prayer: its o, c and k weren\'t among the letters taught. As the hand stands, it\'s pocket, and the page it opens was read without a mistake.',
    },
  ],
  made: {
    /** the readers' line hurried: care at its full with the four careful letters, then with the taught ones, then as the hand stands */
    AO001: () => [withCare(1, 'ferv', () => v27(READING[1], 34, hurried)), withCare(1, TAUGHT, () => v27(READING[1], 34, hurried)), v27(READING[1], 34, hurried)],
    /** the fresh page's first line hurried: care at its full with the taught letters, then as the hand stands */
    AO002: () => [withCare(1, TAUGHT, () => v27(FRESH[0], 33, hurried)), v27(FRESH[0], 33, hurried)],
  },
};
export default S;
