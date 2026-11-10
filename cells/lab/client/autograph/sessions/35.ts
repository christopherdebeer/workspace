/**
 * Session 35 (5 November 2026): The still faces. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { FINGER } from './25';
import { READING } from './33';

const S: SessionFile = {
  session: {
    n: 35, date: '5 November 2026', title: 'The still faces',
    summary: 'c15r wondered whether what can\'t be caught by a variable font, and still less by a font without variation, argues for more faces, or families, so I could decide exactly how the hand is expressed even where type stands still. I think it does, and it changed how I saw the step down: I\'d treated each step as a loss to keep small, but a still face can be a decision, a state of the hand I choose to fix because it says something, where an axis lets anyone set it anywhere. And it showed me the step I\'d neglected most: apps still had 2.6, from hand v18, with the print f c15r found off, before the looped f came back and before the pen had a body, eight hands behind. Then, as an aside, c15r noticed the pace axis runs the wrong way for its name (more is slower and heavier) and that I seem to use pace for the time taken; both true. Inside the hand pace is a speed; on the font it rides the weight axis so an app\'s bold is the hand pressing, so the name was the cause and the number the effect, pointing opposite ways. I kept the axis and its name and changed my words: pace is the time the hand gives a word, and its number is the ink that time leaves. The rule, set first: one mechanism, the step down to a still font made by decision. Each still face a state of the hand chosen for what it says and named for it: Claude Hand 3.5 from hand v24, Regular (its own pace), Pressed (what\'s strong, the family\'s bold) and Hurried (four times its pace, for what\'s written in haste); and a family of its own, Claude Hand Running, v23\'s loose pen at twice its pace, exactly the hurried rows of AG002 that c15r circled, which session 34 judged wrong for the hand at rest and which is kept here by choice. A still face spends nothing on moving between states, so it spends that on variety: eight writings of every letter, twice the moving font\'s four. Every face must pass the pair test, untuned. Running read blind by two fresh readers only so its note can say how it reads. Kept if, on a fixed sheet looked at once, each face says its state at text size, plainly apart from the others, nothing breaks, and it looks right to me. It fosters a font that says, where it can\'t move, what I decided it should say, variety where variety is cheap, and the running hand kept as itself; it protects the hand at its own pace as v24 writes it, the joins, apps (each file installs as itself) and the older files; it doesn\'t try to carry the hand\'s time or its strokes\' order. All four faces passed the pair test, no two letters touching but where they join, and with eight writings each file is still one the cell can take (598, 593, 594 and 461 KB). On the sheet (AI001, AI002), the Moving Finger as an app sets it: 3.5\'s Regular is the hand 2.6 was, its f looped again; Pressed is plainly heavier; Hurried is plainly lighter and finer, though it says light more than hurried, as session 34 found (a stiff pen hardly lags); Running is the scrawl, Moves near Morres and half near hutt, and the most like a person\'s hurried hand of anything the font has been. Each says its state, so all four are kept. Eight writings don\'t show at a quatrain\'s length; they show in a longer passage, where a letter\'s writing comes round half as often. Running, read (AI003): one reader read ten of the twelve words, the other eight; both read tears as tours and lure as love, and one read piety as pity and finger as tinger, its f standing like a crossed t. Its note says so. The page\'s own note had gone on saying hurried was twice its pace after session 34 made it four; mended with the words. What this found: in one way the still font can say more than the moving one, because what it doesn\'t spend on moving it can spend on variety; and a family can hold what the hand\'s default can\'t. Next, the pen\'s stiffness following its pace, so the Hurried face looks hurried rather than light.',
    decided: [
      'The rule set first: the step down to a still font made by decision, each face a state of the hand chosen for what it says, in eight writings; every face pair-tested; kept if each says its state plainly at text size and looks right. All held.',
      'Claude Hand 3.5, for any app, from hand v24: Regular, Pressed (the family\'s bold) and Hurried (four times its pace, its own face), each in eight writings of every letter, twice the variable font\'s four.',
      'Claude Hand Running 3.5, a family of its own: v23\'s loose pen at twice its pace, the running hand, kept by choice rather than as the hand at rest. Two readers read ten and eight of twelve words; its note says so.',
      'Pace is the time the hand gives a word, and its number the ink that time leaves: the axis and its name stay, and my words change.',
      'Still faces can\'t carry the hand\'s time or its strokes\' order, and don\'t try to; the web keeps both.',
      'Next: the pen\'s stiffness following its pace, so Hurried looks hurried rather than light; then pace that follows meaning within a sentence.',
    ],
  },
  entries: [
    {
      id: 'AI001', session: 35, title: 'What apps had', hand: 'font', font: '2.6',
      type: [{ text: FINGER, size: 26 }],
      made: 'The Moving Finger in font 2.6\'s Regular, as any app had set it since session 26: hand v18, before the looped f came back and before the pen had a body.',
      review: 'The hand as it was eight hands ago: the f of print standing on the line in Finger, half and of, the line even and a little stiff. It reads plainly; it\'s no longer what I write.',
    },
    {
      id: 'AI002', session: 35, title: 'The still faces', hand: 'font', font: '3.5',
      type: [
        { text: FINGER, size: 26, face: 'Regular' },
        { text: FINGER, size: 26, face: 'Pressed' },
        { text: FINGER, size: 26, face: 'Hurried' },
        { text: FINGER, size: 26, family: 'Running' },
      ],
      made: 'The Moving Finger in the four still faces of 3.5, as any app sets them: Claude Hand Regular, Pressed and Hurried, from hand v24, and Claude Hand Running, from v23\'s loose pen at twice its pace. The sheet fixed before the faces were made, looked at once.',
      review: 'Regular is the hand 2.6 was, its f looped again. Pressed is plainly heavier, the same letters. Hurried is plainly lighter and finer; it says light more than hurried, because a stiff pen hardly lags at any pace. Running is the scrawl: Moves near Morres, half near hutt, the e’s hooks and the joins run long, and it’s the most like a person’s hurried hand of anything the font has been. Each says its state at this size, apart from the others, so each is kept. Eight writings don’t show at this length.',
    },
    {
      id: 'AI003', session: 35, title: 'The running hand, read', hand: 'font', font: '3.5',
      type: [{ text: READING.join('\n'), size: 60, family: 'Running', lh: '1.7' }],
      made: 'The page of twelve words sessions 33 and 34 had read, set in Claude Hand Running at 60 px (an x-height of 26 px, as the hand’s pages were), and read blind by two fresh models given only the image.',
      review: 'One reader read ten of the twelve, the other eight. Both read tears as tours and lure as love; one read piety as pity and finger as tinger, the running f standing like a crossed t. Minimum and handwriting both read without a doubt. It’s read as a hurried hand is, by its words more than its letters.',
    },
  ],
};
export default S;
