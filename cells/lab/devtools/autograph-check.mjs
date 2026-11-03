// Autograph's check (node cells/lab/devtools/autograph-check.mjs [--record]): the catalogue holds together (every entry
// has its sample and its hand, ids are unique, every session it names exists), every sample measures to finite numbers,
// and every sample still comes out exactly as it was made: its strokes are fingerprinted in
// client/autograph/fingerprints.json, and a sample that no longer matches its fingerprint means a hand was edited. That's
// the one rule (a changed hand is a new file). `--record` adds fingerprints for new samples; it never changes one.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-${process.pid}.mjs`);
await build({ stdin: { contents: `export { MADE } from './client/autograph/samples'; export { CATALOG, SESSIONS, HANDS } from './client/autograph/catalog'; export { measure } from './client/autograph/measure'; export { KNOWS, letter, formsOf } from './client/autograph/hands/v2';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { MADE, CATALOG, SESSIONS, HANDS, measure, KNOWS, letter, formsOf } = await import(outfile);
const fpFile = join(lab, 'client/autograph/fingerprints.json');
const fps = existsSync(fpFile) ? JSON.parse(readFileSync(fpFile, 'utf8')) : {};
const record = process.argv.includes('--record');
let bad = 0;
const ok = (good, line) => { if (!good) bad++; console.log(`${good ? 'ok  ' : 'FAIL'}  ${line}`); };

const ids = CATALOG.map((e) => e.id);
ok(new Set(ids).size === ids.length, `${ids.length} samples, ids unique`);
ok(CATALOG.every((e) => (MADE[e.id] || e.type) && HANDS[e.hand] && SESSIONS.some((s) => s.n === e.session)), 'every sample has its making (or its type), its hand and its session');
ok(Object.keys(MADE).every((id) => ids.includes(id)), 'nothing made that isn\'t catalogued');
const finite = CATALOG.filter((e) => MADE[e.id]).every((e) => MADE[e.id]().every((s) => Object.values(measure(s, e.text)).every((v) => v === undefined || Number.isFinite(v))));
ok(finite, 'every sample measures to finite numbers');
let added = 0;
const changed = [];
// (the font: its source, every letter as hand v2 sets it for the font, is fingerprinted like a sample; and its files
// are there)
const fontSrc = [' ', ...KNOWS].flatMap((ch) => formsOf(ch).flatMap((f) => [1, 2, 3].map((a) => letter(ch, f, a))));
const fontFp = createHash('sha256').update(JSON.stringify(fontSrc)).digest('hex').slice(0, 16);
if (!fps['font 0.4']) { if (record) { fps['font 0.4'] = fontFp; added++; } else changed.push('font 0.4 (no fingerprint: run with --record)'); }
else if (fps['font 0.4'] !== fontFp) changed.push(`font 0.4 (was ${fps['font 0.4']}, now ${fontFp})`);
ok(['claude-hand.ttf', 'claude-hand.woff2'].every((f) => existsSync(join(lab, 'static/autograph', f))), 'the font\'s files are there (static/autograph/claude-hand.ttf, .woff2)');
for (const e of CATALOG.filter((x) => MADE[x.id])) {
  const fp = createHash('sha256').update(JSON.stringify(MADE[e.id]())).digest('hex').slice(0, 16);
  if (!fps[e.id]) { if (record) { fps[e.id] = fp; added++; } else changed.push(`${e.id} (no fingerprint: run with --record)`); }
  else if (fps[e.id] !== fp) changed.push(`${e.id} (was ${fps[e.id]}, now ${fp})`);
}
if (added) writeFileSync(fpFile, JSON.stringify(fps, null, 2) + '\n');
ok(!changed.length, changed.length ? `samples no longer as made: ${changed.join(', ')}` : `every sample comes out exactly as it was made${added ? ` (${added} newly fingerprinted)` : ''}`);
process.exit(bad ? 1 : 0);
