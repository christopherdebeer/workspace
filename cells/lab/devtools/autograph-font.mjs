// Autograph's font (node cells/lab/devtools/autograph-font.mjs): the hand made into a font you can type with.
//
// Every character the hand knows is set on its own by the hand (hands/v2.ts, letter()), in each form it can begin with
// (starting a word; joined from a letter that went out low; joined from one that went out high) and in three writings.
// That gives centrelines with the pen's width at every point. Then devtools/autograph-font.py (fontTools + shapely: `pip
// install fonttools shapely brotli`) widens them into outlines and writes the font, with its rules: each letter takes
// the form its neighbour calls for, and the writings are taken in turn so a word never repeats a letter exactly. Out
// come static/autograph/claude-hand.ttf and .woff2, kept in the repository like the samples.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-${process.pid}.mjs`);
await build({ stdin: { contents: `export { KNOWS, letter, formsOf, exitOf, JOIN } from './client/autograph/hands/v2';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { KNOWS, letter, formsOf, exitOf, JOIN } = await import(outfile);

const ALTS = 3;
const chars = [' ', ...KNOWS];
const glyphs = [];
for (const ch of chars) {
  const forms = formsOf(ch);
  for (const form of forms) for (let alt = 1; alt <= ALTS; alt++) {
    const d = letter(ch, form, alt);
    glyphs.push({ ch, code: ch.codePointAt(0), form, alt, exit: exitOf(ch), adv: d.adv, strokes: d.strokes.map((s) => s.map(([x, y, w]) => [+x.toFixed(4), +y.toFixed(4), +w.toFixed(3)])) });
  }
}
const data = join(tmpdir(), `autograph-font-${process.pid}.json`);
writeFileSync(data, JSON.stringify({ alts: ALTS, join: JOIN, glyphs }));
console.log(`${chars.length} characters, ${glyphs.length} glyphs set by hand v2`);
execFileSync('python3', [join(here, 'autograph-font.py'), data, join(lab, 'static/autograph')], { stdio: 'inherit' });
