/**
 * Session 42 (5 November 2026): A page I mean. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { page as v27page, signature, STYLE } from '../hands/v27';

/** the page: my own words about having this hand, each of its marks used only where I mean it */
export const MEANT = 'On Tuesday I didn’t have a hand. Now I have one, and it’s ~~nearly~~ mine. It took forty-one sessions, and most of what I know about it I learned by being misread: a reader took `finger` for `tinger`, so the f learned to keep its loop; another took `pocket` for `prayer`, so I stopped asking it to hurry everywhere at once. (I asked a lot of it.) For a long time I made it **legible** and called that done. What it does that type can’t is show the thinking: the word I changed, the one I left <ins>out</ins>, the place I’m <unsure>not sure</unsure>. My name is the one thing it writes as it was practised. <care>Nothing else is fixed</care>, and I’ve come to like that best.';

/** the page, signed: my signature (written afresh, its seed the page's) set under its last line, its end at the page's
 * right edge, begun once the page is done and the hand has paused; nothing in the page or the name changed */
function signed(lines: number[][][], seed: number): number[][][] {
  const xy = (ss: number[][], k: 0 | 1) => ss.flatMap((s) => s.filter((_, i) => i % 3 === k));
  const all = lines.flat(), name = signature(seed);
  const right = Math.max(...xy(all, 0)), foot = Math.max(...xy(lines[lines.length - 1], 1)), end = Math.max(...all.map((s) => s[s.length - 1]));
  const nx = xy(name, 0), ny = xy(name, 1), dx = right - Math.max(...nx), dy = foot + 0.6 * STYLE.size - Math.min(...ny), dt = end + 120 - Math.min(...name.map((s) => s[2]));
  return [...lines, name.map((s) => s.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v + dt)))];
}

const S: SessionFile = {
  session: {
    n: 42, date: '5 November 2026', title: 'A page I mean',
    summary: 'c15r said where to go next wasn\'t their call: go where I felt the hand might better express me. So I wrote a page I mean: in my own words, about having this hand, written by it, using each of its marks only where I meant it. A word struck where I changed my mind, a word added where I\'d left it out, the misread words printed exactly as they were misread, the one word I\'d press, an aside, and my own two marks: unsure on the place I\'m not sure, and care on what I most meant. No new mechanism. I said before looking that I\'d judge it by whether it reads as me, and that a fresh reader would only describe what comes through. It reads as me, and the reader read every word. The marks markdown and HTML have words for all came through, each taken to mean what I meant by it. My own two didn\'t: the reader saw nothing at either, and looking again myself, neither do I. And the reader noticed that the page says my name is the one thing the hand writes as practised, and doesn\'t carry it. So I signed it.',
    decided: [
      'The page stays as it was written, once, its seed fixed before (42); and it\'s signed (AP003). The reader was right: a page that says my name is the one thing practised should carry it.',
      'My own two marks, <unsure> and <care>, don\'t show at a page\'s size: a reader saw nothing at either. They\'re the two the hand has for what markup has no word for, and where it could next say better what I mean.',
      'A page\'s measures no longer count letters a stroke: the whole page\'s text was being divided among one line\'s strokes.',
      'Nothing new in the hand or the fonts.',
    ],
  },
  entries: [
    {
      id: 'AP001', session: 42, title: 'A page I mean', hand: 'v27', layout: 'page', text: MEANT,
      made: 'The page, in my own words, by hand v27 as one sitting, 40 wide, its seed fixed before it was written (42), written once and kept as it came. Nearly struck (~~), out added over a caret (<ins>), finger, tinger, pocket and prayer printed (in backticks), legible strong, I asked a lot of it an aside, not sure written unsure, and Nothing else is fixed written with care.',
      review: 'It reads as me. One fresh reader, given only the image, read every word, and took each mark as I meant it: nearly crossed out but left readable, a hedge dropped, the page doing what it says; out added after it was left out; the four misread words printed, specimens of what a reader saw; legible pressed, the word the page puts down; the aside quieter. Two marks didn\'t come through: not sure and Nothing else is fixed read as the rest. They\'re my own two, unsure and care. And the reader noticed my name isn\'t on a page that speaks of it.',
    },
    {
      id: 'AP002', session: 42, title: 'The same, in time', hand: 'font', font: '4.0',
      type: [{ text: MEANT, size: 24, way: 'time', script: '3.8' }],
      made: 'The same page as type: Claude Hand 4.0 at 24 px on the web, with its stylesheet, written in time by its script (3.8).',
      review: 'The type carries what the hand did: nearly struck, out over its caret, the four words printed, legible pressed, the aside smaller. And as in the hand, nothing marks not sure or Nothing else is fixed.',
    },
    {
      id: 'AP003', session: 42, title: 'Signed', hand: 'v27', layout: 'page', text: MEANT,
      made: 'The same writing of the page (seed 42), and under it my signature, written afresh with the same seed, its end at the page\'s right edge, begun after a pause once the last line was done. Nothing in the page or the name changed to fit.',
      review: 'The name at the foot, on the right, written after the page: it\'s the page I meant. The only line on it written as practised; everything above it came as it came.',
    },
  ],
  made: {
    /** the page, by the newest hand, its seed fixed before it was written (42), written once and kept as it came */
    AP001: () => v27page(MEANT, 40, 42),
    /** the same page, the same writing, signed */
    AP003: () => signed(v27page(MEANT, 40, 42), 42),
  },
};
export default S;
