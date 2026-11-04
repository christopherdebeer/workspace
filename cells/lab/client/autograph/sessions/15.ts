/**
 * Session 15 (4 November 2026): Reading. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v9 } from '../hands/v9';

/** Klages's line, in English */
export const RENEWS = 'the beat repeats; the rhythm renews';

const S: SessionFile = {
  session: {
    n: 15, date: '4 November 2026', title: 'Reading',
    summary: 'c15r said they had had me read graphology at the start not because it\'s true but because it might help me decide how I\'d like the hand to be, and asked whether it was time to read the real literature on handwriting and type. It was. Sessions 13 and 14 kept running into questions other people have studied, so this session is reading, and nothing in the hand changed. What reading psychologists find (Larson\'s review) is that readers recognise a word\'s letters, all at once, not its outline. Misreadings come from letters that look alike, context fills in a damaged letter, and a misreading survives where the wrong reading is also a word: are and arc. Practice makes readers, too: even mirror-writing reads quickly in the end, which is Licko\'s "you read best what you read most". Unger draws the line I needed: a letter\'s basic shape has to be what readers expect, and everything else (curves, corners, joins, endings) is the writer\'s own. Noordzij says the stroke is made by the tool and the hand, and that the white inside letters and the white between them move together. He also says that writing more clearly makes writing slower, which is session 14\'s whole result in one line from 1991. He ends sceptical that writing can be caught in parameters at all, which is what I\'m doing. Klages, whose graphology fails as a science, had one idea worth keeping: the beat repeats, the rhythm renews. The font, cycling four writings, is a beat (O002); the hand, never the same twice, is a rhythm (O001). Derrida says a signature has to be repeatable to work, and that what makes it repeatable makes it forgeable, which chapter one found out the hard way. Children\'s handwriting gets less legible as it gets quicker with practice; Huey noticed in 1908 that the tops of letters carry more than their bottoms, and practice in session 14 wore away tops first. And handwritten type makes readers feel a person was there (Schroll and colleagues), which is a reason for this one to say whose hand it is.',
    decided: [
      'The next practice has a teacher. It goes in stages, and each stage is read, by me looking at a page of it or by c15r, and kept only where it\'s still read as written: a reader with a lexicon, as readers are, for whom a misreading counts where it reads as another word or doesn\'t read at all.',
      'What\'s mine goes in the movement between letters (how they join, start and end), not in their skeletons, which stay where readers expect them (Unger).',
      'The hand\'s thick and thin stays what it is: contrast by time, ink heavier where the pen dwells. It doesn\'t borrow a tool, a broad nib\'s translation or a pointed pen\'s expansion (Noordzij), to look like writing it isn\'t.',
      'The hand\'s spacing gets looked at as Noordzij looks at it, the white inside letters and between them together, before anything more is changed in it.',
      'The tops of letters are where readers look (Huey; Perea and colleagues), so a hold on practice weighs a letter\'s top more than its foot.',
      'The font keeps its own name. Handwritten type reads as a person\'s presence, and this hand isn\'t a person\'s.',
    ],
  },
  entries: [
    {
      id: 'O001', session: 15, title: 'The rhythm renews', hand: 'v9', text: RENEWS, layout: 'rows',
      made: 'Klages\'s line, written by v9 three times, each a writing of its own.',
      review: 'Three writings and no two the same: each line its own pace, size, slant and drift, every letter a little off its place, and nothing about the hand changed between them. It\'s what Klages meant by rhythm, set against beat: not the same thing repeated but something like it made again. It\'s also all that\'s left of graphology that I\'d keep.',
    },
    {
      id: 'O002', session: 15, title: 'The beat repeats', hand: 'font', font: '1.4',
      type: [{ text: RENEWS, size: 30 }, { text: RENEWS, size: 30 }, { text: RENEWS, size: 30 }],
      made: 'The same line, set three times in font 1.4.',
      review: 'Identical, glyph for glyph, three times. The font\'s four writings of each letter take turns by a fixed rule, so the same line always comes out the same way: a beat, however cleverly it\'s kept from showing within a line. A font can\'t renew; that\'s the difference between a hand and a font, as Klages would have put it, and why the hand is drawn here as well as set.',
    },
  ],
  made: {
    /** three writings of Klages's line */
    O001: () => [v9(RENEWS, 1), v9(RENEWS, 2), v9(RENEWS, 3)],
  },
};
export default S;
