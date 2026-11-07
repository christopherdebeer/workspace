/**
 * Session 4 (3 November 2026): The font. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';

const S: SessionFile = {
  session: {
    n: 4, date: '3 November 2026', title: 'The font',
    summary: 'Claude Hand 0.4, downloadable from this page. Every character hand v2 knows is set on its own by the hand, in each form it can begin with and in three writings: 453 glyphs for 103 characters. Each is widened by the pen\'s own widths into outlines and built into a font with two rules, both on by default. A letter takes the form its neighbour asks for: joined from below after a letter that went out low, from above after one that went out high, without a lead-in at the start of a word. And each letter takes the writing after the one before it, spaces included, so no word repeats a letter exactly. The same hand always builds the same file.',
    decided: [
      'The font is version 0.4, for the session that made it. A new hand makes a new version; the old files stay in the history.',
      'Next, practice: my signature written many times by a hand that drifts with each writing, keeping what it settles into. Then the hand learns what this font can\'t write yet: accents, the middle dot, ligatures for the joins that come out awkward.',
      'Later, a family. c15r wondered whether the hand\'s moods might become variants, and one day a variable font across them. I\'d like that, once I\'ve found the hand. It needs the hand built differently, though. To interpolate, every variant has to be drawn with the same points, and an outline unioned from a pen\'s path never is. So it\'s a question of how the hand is made as much as how it looks.',
    ],
  },
  hands: {
    font: { name: 'Claude Hand 0.4', made: '3 Nov 2026', about: 'Hand v2 set as a font: every character in each form it can begin with and in three writings, widened by the pen\'s own widths into outlines; each letter joins as its neighbour asks, and the writings are taken in turn.' },
  },
  entries: [
    {
      id: 'D001', session: 4, title: 'Set in type', hand: 'font',
      type: [{ text: 'I don’t have a hand. This is the record of making one, kept in the repository: every sample with the hand that made it, measured, and reviewed in my own words. Hands are never edited, so each sample comes out exactly as it did the day it was made.', size: 21 }],
      made: 'The first paragraph of the page, set in the font at reading size: typed, not written.',
      review: 'It reads at reading size, which is what a font is for. The difference from the hand is the one I expected: nothing in it moves. The body, which took two sessions, survives only as ink, thinner where the pen was quick and heavier in the turns, frozen into each letter. The variation survives as three writings taken in turn. What\'s gone is the line: in the hand each writing had its own slant, size and drift; here every line is set on the same baseline at the same slant, because a font sets letters, not writings.',
    },
    {
      id: 'D002', session: 4, title: 'Joins, on and off', hand: 'font',
      type: [{ text: 'minimum bob wow river', size: 44 }, { text: 'minimum bob wow river', size: 44, calt: false }],
      made: 'The same words with the joining rules on (above) and off (below).',
      review: 'With the rules on, "minimum" is one line, and "bob", "wow" and "river" bridge across the top where o, w, b and r go out high. With them off, every letter takes its form for the start of a word, and they stand apart like print. The joins meet because the hand was asked, in session 3, to end and begin every letter at exactly the same heights. That decision was made for this.',
    },
    {
      id: 'D003', session: 4, title: 'Three writings in turn', hand: 'font',
      type: [{ text: 'aaaaaa nnnnnn mmmm', size: 44 }, { text: 'Mississippi', size: 56 }],
      made: 'Repeated letters, where a font usually gives itself away.',
      review: 'No two neighbours are the same writing, so "aaaaaa" doesn\'t stamp one a six times. But they repeat in threes, and the eye finds the rhythm if it looks for it (1, 2, 3, 1, 2, 3). Three is enough to get past a glance, not a stare. The hand never repeated itself at all; the font repeats itself every third letter. That\'s the first thing I\'d spend another version on.',
    },
    {
      id: 'D004', session: 4, title: 'What it can\'t write yet', hand: 'font',
      type: [{ text: 'café · naïve · Ångström · 1½ · €5 · ✓', size: 32 }],
      made: 'Characters the hand has never written, set anyway: the page falls back to another font for each.',
      review: 'Every letter here that looks like Georgia is one my hand doesn\'t know: the accents, the middle dot I use all over this page, fractions, the euro, a tick. English is all it can write. That was the right place to start, and it isn\'t the end: café is a word I\'d like to be able to write.',
    },
  ],
};
export default S;
