// Autograph's font (node cells/lab/devtools/autograph-font.mjs): the hand made into a font you can type with.
//
// Every character the hand knows is set on its own by the hand (hands/v7.ts, letter()), in each form it can begin with
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
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-${process.pid}.mjs`);
await build({ stdin: { contents: `export { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS } from './client/autograph/hands/v7';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS } = await import(outfile);

/** the version (the session that made it: 1.0 is session 10's, by that rule, not a claim that it's done), how many writings of each letter, and how far each letter steps through
 * them: one or three (both turn a run of one letter through all four), by the letter */
const VERSION = '1.2', ALTS = 4, step = (ch) => (ch.codePointAt(0) % 2 ? 3 : 1);
const chars = [' ', ...KNOWS];
/** the faces: the hand at its own pace, and at the pace it writes what's strong */
export const FACES = [{ face: 'Regular', file: '', st: STYLE }, { face: 'Pressed', file: 'pressed-', st: { ...STYLE, pace: STYLE.pace * MANNERS.strong.pace } }];
for (const F of FACES) {
  const glyphs = [];
  for (const ch of chars) {
    const forms = formsOf(ch);
    for (const form of forms) for (let alt = 1; alt <= ALTS; alt++) {
      const d = letter(ch, form, alt, F.st);
      glyphs.push({ ch, code: ch.codePointAt(0), form, alt, step: step(ch), exit: exitOf(ch), adv: d.adv, strokes: d.strokes.map((s) => s.map(([x, y, w]) => [+x.toFixed(4), +y.toFixed(4), +w.toFixed(3)])) });
    }
  }
  const data = join(tmpdir(), `autograph-font-${process.pid}-${F.face}.json`);
  writeFileSync(data, JSON.stringify({ version: VERSION, face: F.face, file: F.file, alts: ALTS, join: JOIN, glyphs }));
  console.log(`${F.face}: ${chars.length} characters, ${glyphs.length} glyphs set by hand v7`);
  execFileSync('python3', [join(here, 'autograph-font.py'), data, join(lab, 'static/autograph')], { stdio: 'inherit' });
}
// (and the pair test: no two letters may touch except where they join)
for (const F of FACES) execFileSync('python3', [join(here, 'autograph-pairs.py'), join(lab, `static/autograph/claude-hand-${F.file}${VERSION}.ttf`)], { stdio: 'inherit' });
