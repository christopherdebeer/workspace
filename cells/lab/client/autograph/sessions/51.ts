/**
 * Session 51 (6 November 2026): A hand for code. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { writeStyled as v31styled, STYLE, MONO_CELL } from '../hands/v31';

/** a few lines of code, with code's look-alikes in them */
export const CODE = ['function sign(name) {', '  if (name !== "Claude") return 0;', "  return write(name, 1, ['O0', 'l1I']);", '}  // {}[]<>|\\/~^&*%$#@!?'];
/** code written by hand: literally, every character as itself, the lines as one block so what's under what stays under it */
const byHand = () => {
  const st = { ...STYLE, mono: MONO_CELL, slant: STYLE.slant * 0.3 };
  return CODE.map((t, i) => v31styled(Array.from(t).map((ch) => ({ ch, e: [] })), 51 + i, st).map((s) => s.map((v, j) => (j % 3 === 1 ? v + i * 3.1 * st.size : v))));
};

const S: SessionFile = {
  session: {
    n: 51, date: '6 November 2026', title: 'A hand for code',
    summary: 'c15r observed that I write a great deal of code and the family has no monospaced face, and asked what I thought. I agreed: code is what I write more than anything, and the hand had no way to write it as code is written by hand, on a whiteboard or squared paper, each character printed in a cell of its own so that what\'s under what stays under it, with care taken over the characters that could be taken for others. The hand already knew every printable character code uses. Hand v31 adds a way to write in cells (mono): each character printed, centred in its cell, the widest narrowed a little to fit, nothing set nearer anything; the cell 1.25 x-heights, about half an em, chosen from the inks\' widths (the widest, W, @ and M, carry about 1.05, the median 0.63). Code\'s look-alikes get the forms a hand gives them: a zero with a dot in it, a one with a foot. Looking at it written, three more needed telling apart: square brackets, drawn as one stroke, had their corners rounded into parentheses; braces, at type size, had their point softened into a parenthesis\' curve; straight quotes came out as blobs. Each is now strokes of its own meeting where a hand would make the corner or the point. Code is written literally, every character as itself: written as prose, the hand read *, quotes and backticks in it as markup. Claude Hand Mono 5.1 is made from it: one face, eight writings of every character, every advance the same (538 units), marked fixed-pitch so editors know it, no kerning, and no two characters touching.',
    decided: [
      'Hand v31: mono, the hand printing in cells of its own, and code\'s look-alikes told apart (0, 1, [ ], { }, quotes). Without mono it writes as v30; it\'s the newest hand.',
      'Claude Hand Mono 5.1, for code in any app or editor: fixed-pitch, eight writings, nobody had read it when it was made.',
      'Code is written by the hand literally, its characters never read as markup.',
      'Next, as I said to c15r: the marks a hand makes in a margin, and then the poster, written in time.',
    ],
  },
  hands: {
    v31: { name: 'hand v31', made: '6 Nov 2026', about: 'v30, and a hand for code: with mono, every character printed in a cell of its own (1.25 x-heights, about half an em), centred, the widest narrowed to fit, nothing set nearer anything; and code’s look-alikes told apart as a hand tells them on squared paper: a zero with a dot in it, a one with a foot, square brackets with square corners, braces with a point, straight quotes as ticks. Without mono it writes exactly as v30.' },
  },
  entries: [
    {
      id: 'AY001', session: 51, title: 'Code, by hand', hand: 'v31', layout: 'page', text: CODE.join('\n'),
      made: 'Four lines of code with code\'s look-alikes in them, written by v31 in its cells, literally, the lines as one block (seeds 51 to 54).',
      review: 'Squared paper without the squares: every character under the one above it, the indent kept, O and 0, l, 1 and I, ( [ and {{ each itself. It looks like code I\'d write by hand, and like my hand.',
    },
    {
      id: 'AY002', session: 51, title: 'Claude Hand Mono 5.1', hand: 'font', font: '5.1',
      type: CODE.map((text) => ({ text, size: 24, family: 'Mono', pre: true, lh: '1.3' })),
      made: 'The same four lines set in Claude Hand Mono 5.1, as any app or editor sets it, their spaces kept.',
      review: 'In type the columns hold as they do in the hand, and at type size the braces have their points; the first draft\'s read as parentheses.',
    },
  ],
  made: {
    /** the code, written by v31 in its cells */
    AY001: byHand,
  },
};
export default S;
