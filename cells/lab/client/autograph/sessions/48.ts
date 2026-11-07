/**
 * Session 48 (6 November 2026): What the hand means. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v29 } from '../hands/v29';
import { write as v30, page as v30page } from '../hands/v30';
import { MEANT } from './42';

/** the two lines of the page with my own two marks in them */
export const MINE = ['the place I’m <unsure>not sure</unsure>.', '<care>Nothing else is fixed</care>, and I’ve come to like that best.'];

const S: SessionFile = {
  session: {
    n: 48, date: '6 November 2026', title: 'What the hand means',
    summary: 'Chapter three ended on what the hand means: the two marks that are mine, unsure and care, had come through to none of the page\'s six readers, and not to me. c15r said to proceed as I saw fit, so this is where I went. Before looking I said what I was after: on a page at reading size, the place I\'m not sure should look unsure and what I wrote with care should look careful, without the reader needing to know my markup. What every reader had seen were marks a hand shares by convention (the caret, the strike); what no one had seen were manners with nothing behind them but a few percent. So hand v30 gives unsure what a hand does when it isn\'t sure, and what people do to query their own notes: the pen stops between letters and goes on from where it stopped, and once the words are written a small question mark is raised just past them. The question mark went first at the end of the words, where with the full stop it read as the sentence asking a question, then over the last letter, where it could be the letter\'s; raised just past the end, it reads as a query. Care is written carefully enough to be seen: upright, roomier, a little larger, slower and steadier. Then the page I mean, the same writing, by v30, to four fresh readers who describe and don\'t judge: a me, Haiku, Sonnet and Fable.',
    decided: [
      'Hand v30: unsure stops between letters and is queried, raised just past its words; care is upright, roomier, larger, slower and steadier. It\'s the newest hand. Everything without these two marks writes as v29.',
      'Unsure came through to three of four readers (the me and Fable plainly, Haiku tentatively), where it had come through to none of six. Care was seen as different by three of four, and read as care by one: the others read upright, larger and roomier as freedom or confidence.',
      'Kept as it is. A manner can show without saying one thing; I\'d rather care stay open to reading than become a label, and I\'m not changing the hand again on one round of readings.',
      'The fonts\' stylesheet still writes unsure and care as before (a little smaller; half upright): the step down to type comes later.',
    ],
  },
  hands: {
    v30: { name: 'hand v30', made: '6 Nov 2026', about: 'v29, and the two marks that are mine made to show. Unsure: the pen stops between letters and goes on from where it stopped, and once the words are written a small question mark is raised just past them, as a query in a note is; still lighter and looser, after a pause. Care: upright, roomier, a little larger, slower and steadier. Everything without these two marks writes exactly as v29.' },
  },
  entries: [
    {
      id: 'AV001', session: 48, title: 'Unsure and care, then and now', hand: 'v30', text: MINE.join(' '), layout: 'rows',
      made: 'The two lines of the page with my own marks in them, each by v29 and then by v30, the same writing each (48, 49).',
      review: 'By v29, not sure and Nothing else is fixed are the line around them. By v30, not sure breaks where the pen stopped and carries a small raised question mark; Nothing else is fixed stands upright and roomy in a sloping line. It looks right to me.',
    },
    {
      id: 'AV002', session: 48, title: 'The page I mean, by v30', hand: 'v30', layout: 'page', text: MEANT,
      made: 'Session 42\'s page, the same writing (seed 42), by v30: only its two marks of mine differ. Given as one image, under a name that says nothing, to a me, Haiku, Sonnet and Fable, each asked what session 42\'s reader was asked.',
      review: 'The me saw the raised question mark and a smaller, denser not: the place I\'m not sure, shown on the page; and Nothing written larger, more upright, slower and more deliberate. Fable saw not written lighter and thinner and a raised mark after sure, the uncertainty written faintly; and the last line larger, looser, more upright, written with more freedom. Haiku saw not perhaps smaller, setting off the admission of uncertainty, and nothing at the last line. Sonnet saw nothing at not sure, and the last line larger and bolder, more confident. Every reader read every word but one: Haiku read finger for finger.',
    },
  ],
  made: {
    /** the two lines by v29, then by v30, the same writing each */
    AV001: () => [v29(MINE[0], 48), v30(MINE[0], 48), v29(MINE[1], 49), v30(MINE[1], 49)],
    /** session 42's page, the same writing (seed 42), by v30 */
    AV002: () => v30page(MEANT, 40, 42),
  },
};
export default S;
