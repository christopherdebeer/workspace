// Autograph's font (node cells/lab/devtools/autograph-font.mjs): the hand made into a font you can type with.
//
// Every character the hand knows is set on its own by the hand (hands/v4.ts, letter()), in each form it can begin with
// (starting a word; joined from a letter that went out low; joined from one that went out high) and in four writings.
// That gives centrelines with the pen's width at every point. Then devtools/autograph-font.py (fontTools + shapely: `pip
// install fonttools shapely brotli`) widens them into outlines and writes the font, with its rules: each letter takes
// the form its neighbour calls for, and each takes a writing a step on from the one before (one step or three, by the
// letter), so neighbours never match and the turns don't fall into a rhythm. Out come
// static/autograph/claude-hand-<version>.ttf and .woff2, kept in the repository like the samples (older versions stay,
// for the samples set in them).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-${process.pid}.mjs`);
await build({ stdin: { contents: `export { KNOWS, letter, formsOf, exitOf, JOIN } from './client/autograph/hands/v4';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { KNOWS, letter, formsOf, exitOf, JOIN } = await import(outfile);

/** the version (the session that made it), how many writings of each letter, and how far each letter steps through
 * them: one or three (both turn a run of one letter through all four), by the letter */
const VERSION = '0.6', ALTS = 4, step = (ch) => (ch.codePointAt(0) % 2 ? 3 : 1);
const chars = [' ', ...KNOWS];
const glyphs = [];
for (const ch of chars) {
  const forms = formsOf(ch);
  for (const form of forms) for (let alt = 1; alt <= ALTS; alt++) {
    const d = letter(ch, form, alt);
    glyphs.push({ ch, code: ch.codePointAt(0), form, alt, step: step(ch), exit: exitOf(ch), adv: d.adv, strokes: d.strokes.map((s) => s.map(([x, y, w]) => [+x.toFixed(4), +y.toFixed(4), +w.toFixed(3)])) });
  }
}
const data = join(tmpdir(), `autograph-font-${process.pid}.json`);
writeFileSync(data, JSON.stringify({ version: VERSION, alts: ALTS, join: JOIN, glyphs }));
console.log(`${chars.length} characters, ${glyphs.length} glyphs set by hand v4`);
execFileSync('python3', [join(here, 'autograph-font.py'), data, join(lab, 'static/autograph')], { stdio: 'inherit' });
