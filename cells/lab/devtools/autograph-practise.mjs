// Autograph's letter practice (node cells/lab/devtools/autograph-practise.mjs [--readable=4] [--distinct=0] [--out=f.json]):
// hand v9's letters practised by writing the words of the record, sessions 1 to 13 (every lowercase word in their
// summaries, decisions, samples and reviews, each as often as it was written). Prints what practice did, letter by
// letter: how often each was practised, how often a writing came out easier, how far it strayed from its plan, and how
// much quicker the record's words come out; `--out` saves where it left the letters. Session 14's runs are kept in v9 as
// TRIALS (readable 16, 4 and 1; and readable 1 with distinct 400, which also holds against new crossings); none was
// adopted.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const outfile = join(tmpdir(), `autograph-practise-${process.pid}.mjs`);
await build({ stdin: { contents: `export { practiseLetters, PRACTICE_LETTERS } from './client/autograph/hands/v9'; export { SESSION_FILES } from './client/autograph/sessions';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { practiseLetters, PRACTICE_LETTERS, SESSION_FILES } = await import(outfile);

// (the record's words: sessions 1 to 13, as they were written)
const texts = [];
for (const f of SESSION_FILES.filter((f) => f.session.n <= 13)) {
  texts.push(f.session.title, f.session.summary, ...f.session.decided);
  for (const e of f.entries) texts.push(e.title, e.text ?? '', e.made, e.review, ...(e.type ?? []).map((l) => l.text));
}
const words = texts.join(' ').split(/[^A-Za-z]+/).filter((w) => /^[a-z]+$/.test(w));
const over = {};
for (const k of ['readable', 'writings', 'seed', 'vary', 'trace', 'distinct']) if (opt[k] !== undefined) over[k] = Number(opt[k]);
console.log(`${words.length} words from the record (${new Set(words).size} different); practice ${JSON.stringify({ ...PRACTICE_LETTERS, ...over })}`);
const t0 = Date.now();
const p = practiseLetters(words, over);
console.log(`practised in ${((Date.now() - t0) / 1000).toFixed(1)} s; the record's words take ${p.before.toFixed(1)} s before, ${p.after.toFixed(1)} s after (${((1 - p.after / p.before) * 100).toFixed(1)}% quicker)`);
const rows = Object.keys(p.habits).map((ch) => `${ch}  practised ${String(p.tried[ch] ?? 0).padStart(5)}  easier ${String(p.easier[ch] ?? 0).padStart(4)}  strayed ${p.strayed[ch].toFixed(3)} x-heights`);
console.log(rows.join('\n'));
if (opt.out) writeFileSync(String(opt.out), JSON.stringify(p.habits));
