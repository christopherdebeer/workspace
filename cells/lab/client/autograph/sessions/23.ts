/**
 * Session 23 (5 November 2026): A slip, and where letters meet. What it found and decided, its samples, and how each is
 * made. Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v15, STYLE } from '../hands/v15';

/** words that are mostly joins */
export const JOINS = 'minimum handwriting';

const S: SessionFile = {
  session: {
    n: 23, date: '5 November 2026', title: 'A slip, and where letters meet',
    summary: 'First, a correction. Reading chapter two, c15r stopped at took was room and said it must have been a slip in typing their reading, not a misreading: they couldn\'t believe they had read took as room, and were surprised neither of us had questioned it. I should have. Room for took needs two letters wrong at once, the t as an r and the k as an m, and still to make a word; the other two misreadings had something to see in the ink (the x closed into a bowl, the s\'s foot gave the o a stem), and for took I built the explanation after the fact, sure of it because a model had hesitated at the k. So it was a slip. c15r\'s first reading was 47 of 48, and the four pages 94 of 96. Session 19 recorded it as a misreading, and chapter two\'s first page, written in the hand, says took was room; both stay as written, and this is where it\'s corrected. v13\'s taller t with its shorter bar was made on the strength of it alone; it has done no harm, every t since has been read, so it stays, and this says what it rested on. The k had other evidence, c15r\'s own pause at kept and the models\' doubts, and the x and the s stand on readings nobody has questioned. Every misreading still fell on a letter a model had guessed at, but that is two cases now, not three. Font 2.0 says 93 of 96 in itself and stays as it was made; the page says 94. Then coarticulation, with its rule set before it began. In fluent cursive the end of a letter is shaped by the letter after it and its start by the one before (Thomassen & Schomaker 1986, who named it after the same thing in speech: the downstroke of an l changes with the next letter, its upstroke doesn\'t). In this hand every low join meets at one fixed place at the foot of the line, so I tried planning the meeting across both letters: moving it a quarter of the way towards the next letter\'s first stroke and a tenth towards the last one\'s. The rule was one mechanism, judged by eye on one sheet fixed in advance, no readers, no second dial, and kept only if it looked like a better hand. On the sheet, at writing size, the two hands were the same. Laid over each other five times larger, the new joins went straight up into the next letter where the old ones kinked at the foot; measured, the line moved at most a tenth of an x-height, less than the pen is wide, and on average a fiftieth. So it isn\'t kept, and there\'s no v16, and no stronger try. What it found is that this hand\'s joins already anticipate: each letter\'s lead-in carries the pen from the foot of the line to where that letter begins, so the way into the next letter is part of the letter, and the place two letters meet is the same short stretch every time. The coarticulation Thomassen and Schomaker measured bends the letters themselves, an l\'s downstroke, and in this hand that\'s the skeleton, the readers\' half. It stays open.',
    decided: [
      'took read as room was a slip in typing, not a misreading. c15r\'s readings were 47 of 48 and, over four pages, 94 of 96. Session 19 and chapter two stay as written; this corrects them, and chapter three will say so out loud.',
      'v13\'s t, made on that slip alone, stays: it has done no harm. The k, the x and the s stand on other readings.',
      'Coarticulation at the join was tried by its own rule and not kept: the line moved less than the pen is wide. No v16, and no second dial. The hand\'s lead-ins already carry the way into each letter.',
      'Bending letters\' bodies by their neighbours, the coarticulation the research measured, would change the skeletons, the readers\' half. It stays open, and isn\'t next.',
      'A rule to stop by, set before a session\'s work begins, is how sessions are run from now on.',
    ],
  },
  entries: [
    {
      id: 'W001', session: 23, title: 'Where letters meet', hand: 'v15', text: JOINS,
      made: 'Words that are mostly joins, written by v15 with nothing varied: the joins as they stay, after the session tried planning them across both letters and didn\'t keep it.',
      review: 'Every low join here meets at the foot of the line and goes up the next letter\'s lead-in, which already runs from the foot to where that letter starts. Planned across both letters instead, the meeting moved by less than the pen is wide, and the line looked the same at writing size. The way into each letter is part of the letter; that turns out to be most of what anticipation can be in a hand built this way.',
    },
  ],
  made: {
    /** the joins as they stay */
    W001: () => [v15(JOINS, 1, { ...STYLE, vary: 0 })],
  },
};
export default S;
