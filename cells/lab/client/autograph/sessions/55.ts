/**
 * Session 55 (6 November 2026): The s in its word. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v33write } from '../hands/v33';

/** words with s after letters that go out low (the first two) and high (the last) */
export const S_LINES = ['eyes sense less', 'writes this news', 'boats rows vows'];
/** the poster's titles, and dots */
export const BROAD55 = ['It takes its time. It says what I mean.', 'Every letter, and the marks between.', 'This is minimal; isn’t it?'];

const S: SessionFile = {
  session: {
    n: 55, date: '6 November 2026', title: 'The s in its word',
    summary: 'With the broad pen showing the letters, I looked at them as shapes, large: each small letter between n\'s at one scale, each capital before an a, and words. I was after an even rhythm, clean ends and full bowls, and a capital in proportion to the small letters, judged by eye, and I meant to change only what was badly made. What read at first as ragged teeth along the broad line was, looked at pixel by pixel, the pen\'s own corners: the cut ends of strokes and a point where a stroke goes up and comes back down its own line, as a broad nib leaves them. Two things were wrong. One was the pen\'s dot: I had made it by drawing the nib a little down, along its own edge, so a dot was a shard, and the i\'s dot, a stroke too short to be one, was a slash. A dot is now the nib moved across its own width, a small diamond, and any mark too short to be a stroke is one, in the notebook and the font builder alike. The other was the s, in the hand itself and with either pen: it stood apart from the letter before it (eye s, sen se, write s). Measured between n\'s as session 17 measured every letter, the white before it was 175% of the white between two n\'s, the loosest in the hand, and it had been loose since it was printed (154% in v20 and v27); my own wider s of session 45 made it worse. It couldn\'t simply come nearer. Its foot reached back along the line under that white, so nearer it touched the letter before, d\'s exit most. And its top reached left into where the letters that go out high (o, r, v, w, b) bring their stroke in. Hand v33 gives it a top narrower than its bottom, as a printed s has, and a foot that ends under its spine, and sets it 0.18 of an x-height nearer. That\'s as near as both kinds of letter before it allow: 0.07 of an x-height clear after the nearest that goes out low and 0.02 after o. It\'s still printed and still alone, since joined, in session 2, it read as a hook. Its nearness is in the hand\'s spacing table, so a word it begins keeps its space and the font kerns it nearer only after ink. Claude Hand Broad 5.5 is v33 with the broad pen and its new dot, and the poster\'s titles, its figure, the Font page and Write use it. The type for reading (the variable font, its writing font and the still faces) is from v30, so its s still stands apart: the hand is ahead of its type again.',
    decided: [
      'Hand v33: the s nearer the letter before it, its top narrower and its foot under its spine; still printed and alone. Everything without an s writes exactly as v32. It\'s the newest hand, so the page signs and writes with it.',
      'The broad pen\'s dot is the nib moved across its own width, and any mark too short to be a stroke is a dot, in the notebook and the font builder alike.',
      'Claude Hand Broad 5.5, from v33, replaces 5.4 on the poster, the Font page and in Write; 5.4 is kept for the sample set in it.',
      'The pen\'s corners, the cut ends and the points where a stroke turns back on itself, stay: they\'re what a broad nib does.',
      'Next: the type for reading caught up with v33, so its s sits in its word too.',
    ],
  },
  hands: {
    v33: { name: 'hand v33', made: '6 Nov 2026', about: 'v32, and an s that sits in its word: 0.18 of an x-height nearer the letter before it, its top narrower than its bottom so the letters that go out high clear it, its foot ending under its spine instead of reaching back along the line. Still printed and alone. Everything without an s writes exactly as v32.' },
  },
  entries: [
    {
      id: 'BC001', session: 55, title: 'The s in its word', hand: 'v33', text: S_LINES.join(' '), layout: 'rows',
      made: 'Words with s after letters that go out low (eyes sense less, writes this news) and high (boats rows vows), written by v33 (seeds 9, 8 and 7), with the round pen.',
      review: 'Each s sits in its word now: sense is one word, not sen se, and writes isn\'t write s. After the high exits nothing touches. The s\'s top is a little smaller than its bottom, as a printed s\'s is, and it still reads as an s.',
    },
    {
      id: 'BC002', session: 55, title: 'Claude Hand Broad 5.5', hand: 'font', font: '5.5',
      type: [{ text: BROAD55[0], size: 44, family: 'Broad' }, { text: BROAD55[1], size: 44, family: 'Broad' }, { text: BROAD55[2], size: 28, family: 'Broad' }],
      made: 'The poster\'s titles, and a line with dots, set in Claude Hand Broad 5.5 as any app sets it.',
      review: 'Its s keeps the rhythm of its word (takes, marks, its), and its dots and stops are small diamonds where 5.4\'s were slashes.',
    },
  ],
  made: {
    /** the three lines, written by v33 (seeds 9, 8 and 7) */
    BC001: () => S_LINES.map((t, i) => v33write(t, 9 - i)),
  },
};
export default S;
