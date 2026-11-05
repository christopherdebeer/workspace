// Autograph's font (node cells/lab/devtools/autograph-font.mjs): the hand made into a font you can type with.
//
// Every character the hand knows is set on its own by the hand (hands/v18.ts, letter(); 1.2 was v7's, 1.4 v9's, 1.8 v12's, 1.9 v13's, 2.0 v14's), in each form it can begin with
// (starting a word; joined from a letter that went out low; joined from one that went out high) and in four writings.
// That gives centrelines with the pen's width at every point. Then devtools/autograph-font.py (fontTools + shapely: `pip
// install fonttools shapely brotli`) widens them into outlines and writes the font, with its rules: each letter takes
// the form its neighbour calls for, and each takes a writing a step on from the one before (one step or three, by the
// letter), so neighbours never match and the turns don't fall into a rhythm. Out come
// static/autograph/claude-hand-<version>.ttf and .woff2, kept in the repository like the samples (older versions stay,
// for the samples set in them).
//
// Since 1.2 (session 12) in two faces, each the hand at a pace: Regular, and Pressed, every letter written at the pace
// the hand writes what's strong (MANNERS.strong), so its ink comes heavier by itself, from the pen's body, the way the
// hand presses. It's the family's bold, so an app's bold is the hand pressing. (The hand's quicker manners, asides and
// doubts, lighten the ink by under a tenth: not enough to be a face.) Each face also says where its underline and strike
// go, where the hand writes them, so an app's underline and strike sit where a pen puts them.
//
// Since 1.8 (session 18) the font is spaced as the hand is (v11's spacing, and v12's room before the c): the letters
// whose exits run further before the next letter are set with them, and a letter that sits nearer the one before it only
// inside a word (the s) is drawn where it stands starting a word, with a kern that brings it nearer after anything inked.
// A kern needs a pair, and a space or a line's start makes none, so starting a word it keeps the word space, as the hand
// does.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-${process.pid}.mjs`);
await build({ stdin: { contents: `export { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS, SPACING } from './client/autograph/hands/v18';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS, SPACING } = await import(outfile);
const HAND = 'v18';

/** the version (the session that made it: 1.0 is session 10's, by that rule, not a claim that it's done), how many writings of each letter, and how far each letter steps through
 * them: one or three (both turn a run of one letter through all four), by the letter */
const VERSION = '2.6', ALTS = 4, step = (ch) => (ch.codePointAt(0) % 2 ? 3 : 1);
const chars = [' ', ...KNOWS];
/** (1.8) the letters that sit nearer the one before them only inside a word: how much nearer (x-heights, less than
 * nothing). The hand has them drawn already nearer; the font draws them back where they stand starting a word, and kerns */
const NEARER = Object.entries(SPACING).filter(([, d]) => d < 0);
/** (1.8) what's said of the font when it's made: who had read the hand it was made from */
const READ = 'When it was made, one person had read the hands before it blind, 94 words of 96 over four pages, and models had misread none. This hand\'s f, which stands on the line, hadn\'t been read by anyone yet.';
// (2.0's: 'When it was made, one person had read the hands before it blind, 93 words of 96 over four pages, and models had misread none; in this hand the s, whose foot made lost read last, keeps its foot to itself.' One of the three, took read as room, was found in session 23 to have been a slip in typing.)
// (1.9's: 'When it was made, the hand before it (v12) had been read blind by one person, who misread two words of 48, and by models, who misread none; in this hand the t, k and x misread in them are written anew.')
// (1.8's: 'When it was made, only models had read this hand blind; no person yet.')
/** the faces: the hand at its own pace, and at the pace it writes what's strong */
export const FACES = [{ face: 'Regular', file: '', st: STYLE }, { face: 'Pressed', file: 'pressed-', st: { ...STYLE, pace: STYLE.pace * MANNERS.strong.pace } }];
for (const F of FACES) {
  const glyphs = [];
  for (const ch of chars) {
    const forms = formsOf(ch);
    for (const form of forms) for (let alt = 1; alt <= ALTS; alt++) {
      const d = letter(ch, form, alt, F.st), back = -(NEARER.find(([c]) => c === ch)?.[1] ?? 0) * F.st.track;
      glyphs.push({ ch, code: ch.codePointAt(0), form, alt, step: step(ch), exit: exitOf(ch), adv: d.adv + back, strokes: d.strokes.map((s) => s.map(([x, y, w]) => [+(x + back).toFixed(4), +y.toFixed(4), +w.toFixed(3)])) });
    }
  }
  const data = join(tmpdir(), `autograph-font-${process.pid}-${F.face}.json`);
  writeFileSync(data, JSON.stringify({ version: VERSION, hand: HAND, read: READ, face: F.face, file: F.file, alts: ALTS, join: JOIN, kern: NEARER.map(([ch, d]) => ({ after: 'inked', ch, by: d * F.st.track })), glyphs }));
  console.log(`${F.face}: ${chars.length} characters, ${glyphs.length} glyphs set by hand ${HAND}`);
  execFileSync('python3', [join(here, 'autograph-font.py'), data, join(lab, 'static/autograph')], { stdio: 'inherit' });
}
// (and the pair test: no two letters may touch except where they join)
// (the pair test told which letters go out high, from the hand, so it sets each pair as the font does)
const HIGH = [...KNOWS].filter((ch) => /[a-z]/.test(ch) && exitOf(ch) === 'high').join('');
for (const F of FACES) execFileSync('python3', [join(here, 'autograph-pairs.py'), join(lab, `static/autograph/claude-hand-${F.file}${VERSION}.ttf`), HIGH], { stdio: 'inherit' });
