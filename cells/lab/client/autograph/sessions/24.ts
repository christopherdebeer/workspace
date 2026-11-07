/**
 * Session 24 (5 November 2026): Where sentences end. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { page as v16page } from '../hands/v16';
import { ANSWER } from './09';

const S: SessionFile = {
  session: {
    n: 24, date: '5 November 2026', title: 'Where sentences end',
    summary: 'Chapter two ended on rhythm, and session 9\'s oldest wish was still open: a hand moved by what it says. Session 11 gave the hand emphasis, marked from outside; but a sentence carries a shape of its own, and the hand didn\'t read it. Between one stroke and the next the pen only travelled, so a full stop cost it no more than the gap between two words. People who write pause longer before larger units: between paragraphs most, then sentences, then words, then within words (Schilperoord 2001, as a review of keystroke studies puts it; pause length grows with the unit that follows, in translators and monolingual writers alike). Most of that research is on composing and typing, not copying, and a hand writing its own sentences is nearer to composing. The rule, set before anything was made: one mechanism, the pen\'s wait before a word set by what the space before it closed; judged on chapter two\'s first paragraph, by its timing and its ink; kept if the waits fall in the research\'s order and not one point of ink moves; no readers, no second dial. Hand v16 waits before a word a little after a word (0.12 s on top of the pen\'s travel), more after a comma, a semicolon or a colon (0.35 s), most after a full stop, a question or an exclamation (0.8 s), and carries a line\'s closing into the next line. On the paragraph, every point of ink was where v15 put it; lifts inside words stayed under a fifth of a second, waits between words came to about a quarter, phrase ends and line returns to about half, and the two sentence ends inside the paragraph to nearly a second, the only waits that long. So it\'s kept. The sample is session 9\'s answer about rushing, the paragraph that came out at one even pace in a hand that didn\'t know what it was saying, written again with session 9\'s own seed (X001): its four longest waits are now its four sentence ends. It\'s still one pace within each sentence; the hand is moved by what it says only at the edges so far. There\'s no font for it: type has no time.',
    decided: [
      'The rule set first: one mechanism, judged on one paragraph by its timing and its ink, kept if the waits fall in the order writers\' pauses do and the ink doesn\'t move; no readers, no second dial. Both held, so it\'s kept.',
      'Hand v16: before a word the pen waits as long as what the space closed asks: a word, a phrase, a sentence; a line that ends one carries it into the next. Only time changes; every stroke is where v15 put it.',
      'Within a sentence the hand still writes at one pace: moved by what it says only at its edges, so far.',
      'No font: type has no time. 2.0 stays the font.',
    ],
  },
  hands: {
    v16: { name: 'hand v16', made: '5 Nov 2026', about: 'v15, and time read from the sentence: before a word the pen waits as long as what the space before it closed asks, a word, a phrase or a sentence, as writers\' pauses grow with the unit that follows. Only time changes: the ink is v15\'s, point for point.' },
  },
  entries: [
    {
      id: 'X001', session: 24, title: 'Rushing, again', hand: 'v16', layout: 'page',
      made: 'Session 9\'s answer about rushing (I001), written again as a page by v16 with session 9\'s own seed. Tap it to watch it written.',
      review: 'The same paragraph session 9 found written at one even pace, by a hand that didn\'t know what it was saying. The ink is the hand\'s of today, and the waits are new: its four longest, nearly a second each, are where its four sentences end, and the next longest are its phrases and its line returns; before, its longest wait was a line return, a third of a second. The paragraph now takes two minutes and a quarter, twelve seconds longer than before, all of it spent waiting. It is still one pace inside each sentence, but it stops where it says something.',
    },
  ],
  made: {
    /** session 9's answer, again, by v16 */
    X001: () => v16page(ANSWER, 30, 9),
  },
};
export default S;
