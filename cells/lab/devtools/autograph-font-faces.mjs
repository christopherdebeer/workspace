// Autograph's still faces (node cells/lab/devtools/autograph-font-faces.mjs), from 3.5 (session 35): the font for any
// app, where type can't move.
//
// The moving font (autograph-font.mjs) is for the web: one variable font that goes anywhere between the hand's states.
// An app can't move a font, so here each face is a state of the hand chosen because it says something, and named for
// what it says. Claude Hand, from hand v24: Regular, the hand at its own pace; Pressed, at the pace it writes what's
// strong (the family's bold, so an app's bold is the hand pressing); Hurried, at four times its own pace, the moving
// font's hurried end, for what's written in haste. And a family of its own, Claude Hand Running: the running hand,
// v23's loose pen at twice its pace, which session 34 judged wrong for the hand at rest and which is kept here by choice.
//
// A still face spends nothing on moving between states, so it spends that on variety: eight writings of every letter,
// twice the moving font's four, each letter stepping one or three through them (both coprime with eight, so a run of one
// letter goes through all of them). If a face's file were too big for the cell to take, it would have fewer: the most
// that fit, stepping coprime.
//
// Each face is set by the hand, written by autograph-font.py and pair-tested by autograph-pairs.py: no two letters may
// touch except where they join. What a still face can't carry, the hand's time and its strokes' order, it doesn't try to.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-faces-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * as v24 from './client/autograph/hands/v24'; export * as v23 from './client/autograph/hands/v23';`, resolveDir: lab, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning',
});
const { v24, v23 } = await import(outfile);
const VERSION = '3.5', OUT = process.env.FONT_OUT ?? join(lab, 'static/autograph');
/** the most a file can be for the cell to take it (a signed push carries at most this) */
const MOST = 720000;
/** how many writings, and how far each letter steps through them: one or three, both coprime with eight */
const ALTS = Number(process.env.ALTS ?? 8), step = (ch) => (ch.codePointAt(0) % 2 ? 3 : 1);
/** what's said of each family when it's made: who had read it */
const READ = {
  'Claude Hand': 'When it was made, its hand (v24) at its own pace had been read blind by a model without a doubt, and hurried (four times its pace, the Hurried face) by two models without a mistake; no person had read it. Made for any app, where type can\'t move: each face a state of the hand chosen for what it says. What a still font can\'t carry, the hand\'s time and its strokes\' order, it doesn\'t try to.',
  'Claude Hand Running': process.env.RUNNING_READ ?? 'Nobody had read it yet.',
};
const hurried = { ...v24.STYLE, pace: v24.STYLE.pace * v24.HURRY };
export const FACES = [
  { family: 'Claude Hand', face: 'Regular', file: '', hand: 'v24', H: v24, st: v24.STYLE },
  { family: 'Claude Hand', face: 'Pressed', file: 'pressed-', hand: 'v24', H: v24, st: { ...v24.STYLE, pace: v24.STYLE.pace * v24.MANNERS.strong.pace } },
  { family: 'Claude Hand', face: 'Hurried', file: 'hurried-', hand: 'v24', H: v24, st: hurried, says: ', every letter written at four times the pace the hand writes at its own, in haste, so its ink comes lighter and its line a little looser' },
  { family: 'Claude Hand Running', face: 'Regular', file: 'running-', hand: 'v23', H: v23, st: { ...v23.STYLE, pace: v23.STYLE.pace * 2 }, says: ': the running hand, the looser pen of session 33 at twice its own pace, its letters cut short and run together as a hand in a hurry runs them' },
];
const only = process.env.FACES ? process.env.FACES.split(',') : null;
for (const F of FACES) {
  const key = F.file.replace(/-$/, '') || 'regular';
  if (only && !only.includes(key)) continue;
  const { KNOWS, letter, formsOf, exitOf, JOIN, SPACING } = F.H;
  const NEARER = Object.entries(SPACING).filter(([, d]) => d < 0);
  const glyphs = [];
  for (const ch of [' ', ...KNOWS]) {
    for (const form of formsOf(ch)) for (let alt = 1; alt <= ALTS; alt++) {
      const d = letter(ch, form, alt, F.st), back = -(NEARER.find(([c]) => c === ch)?.[1] ?? 0) * F.st.track;
      glyphs.push({ ch, code: ch.codePointAt(0), form, alt, step: step(ch), exit: exitOf(ch), adv: d.adv + back, strokes: d.strokes.map((s) => s.map(([x, y, w]) => [+(x + back).toFixed(4), +y.toFixed(4), +w.toFixed(3)])) });
    }
  }
  const data = join(tmpdir(), `autograph-font-faces-${process.pid}-${key}.json`);
  writeFileSync(data, JSON.stringify({ version: VERSION, hand: F.hand, read: READ[F.family], family: F.family, face: F.face, file: F.file, says: F.says, alts: ALTS, join: JOIN, kern: NEARER.map(([ch, d]) => ({ after: 'inked', ch, by: d * F.st.track })), glyphs }));
  console.log(`${F.family} ${F.face}: ${glyphs.length} glyphs set by hand ${F.hand}, ${ALTS} writings`);
  execFileSync('python3', [join(here, 'autograph-font.py'), data, OUT], { stdio: 'inherit' });
  const ttf = join(OUT, `claude-hand-${F.file}${VERSION}.ttf`), size = statSync(ttf).size;
  if (size > MOST) throw new Error(`${ttf} is ${size} bytes, more than the cell can take: fewer writings (ALTS)`);
  // (and the pair test, told which letters go out high, from the hand, so it sets each pair as the font does)
  const HIGH = [...KNOWS].filter((ch) => /[a-z]/.test(ch) && exitOf(ch) === 'high').join('');
  execFileSync('python3', [join(here, 'autograph-pairs.py'), ttf, HIGH], { stdio: 'inherit' });
}
