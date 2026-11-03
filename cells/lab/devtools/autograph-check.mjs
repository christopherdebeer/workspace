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
await build({ stdin: { contents: `export { MADE } from './client/autograph/samples'; export { CATALOG, SESSIONS, HANDS } from './client/autograph/catalog'; export { measure } from './client/autograph/measure'; export { KNOWS, letter, formsOf } from './client/autograph/hands/v2'; export { KNOWS as KNOWS4, letter as letter4, formsOf as formsOf4 } from './client/autograph/hands/v4'; export { BOOK } from './client/autograph/autobiography'; export { KNOWS as KNOWS5, letter as letter5, formsOf as formsOf5 } from './client/autograph/hands/v5';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { MADE, CATALOG, SESSIONS, HANDS, measure, KNOWS, letter, formsOf, KNOWS4, letter4, formsOf4, BOOK, KNOWS5, letter5, formsOf5 } = await import(outfile);
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
// (the fonts: each one's source, every letter as its hand sets it for the font, is fingerprinted like a sample; and
// each version's files are there, and every sample set in type names one that is)
const FONTS = [
  { key: 'font 0.4', files: '0.41', src: () => [' ', ...KNOWS].flatMap((ch) => formsOf(ch).flatMap((f) => [1, 2, 3].map((a) => letter(ch, f, a)))) },
  { key: 'font 0.6', files: '0.6', src: () => [' ', ...KNOWS4].flatMap((ch) => formsOf4(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter4(ch, f, a)))) },
  { key: 'font 0.8', files: '0.8', src: () => [' ', ...KNOWS5].flatMap((ch) => formsOf5(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter5(ch, f, a)))) },
];
for (const F of FONTS) {
  const fp = createHash('sha256').update(JSON.stringify(F.src())).digest('hex').slice(0, 16);
  if (!fps[F.key]) { if (record) { fps[F.key] = fp; added++; } else changed.push(`${F.key} (no fingerprint: run with --record)`); }
  else if (fps[F.key] !== fp) changed.push(`${F.key} (was ${fps[F.key]}, now ${fp})`);
}
ok(FONTS.every((F) => ['ttf', 'woff2'].every((x) => existsSync(join(lab, `static/autograph/claude-hand-${F.files}.${x}`)))) && CATALOG.filter((e) => e.type).every((e) => existsSync(join(lab, `static/autograph/claude-hand-${e.font ?? '0.41'}.woff2`))), `the fonts' files are there (${FONTS.map((F) => F.files).join(', ')}), and every sample set in type names one`);
// (the book: its chapters in order, each written, and the PDF there; and each chapter fingerprinted like a sample, so a
// chapter once written is never edited)
ok(BOOK.chapters.every((c, i) => c.n === i + 1 && c.text.length && c.text.every((p) => p.length)) && existsSync(join(lab, 'static/autograph/in-my-own-hand.pdf')), `the book: ${BOOK.chapters.length} chapter${BOOK.chapters.length === 1 ? '' : 's'}, and its PDF`);
for (const c of BOOK.chapters) {
  const key = `chapter ${c.n}`, fp = createHash('sha256').update(JSON.stringify(c)).digest('hex').slice(0, 16);
  if (!fps[key]) { if (record) { fps[key] = fp; added++; } else changed.push(`${key} (no fingerprint: run with --record)`); }
  else if (fps[key] !== fp) changed.push(`${key} was edited (was ${fps[key]}, now ${fp}): a chapter is written once`);
}
for (const e of CATALOG.filter((x) => MADE[x.id])) {
  const fp = createHash('sha256').update(JSON.stringify(MADE[e.id]())).digest('hex').slice(0, 16);
  if (!fps[e.id]) { if (record) { fps[e.id] = fp; added++; } else changed.push(`${e.id} (no fingerprint: run with --record)`); }
  else if (fps[e.id] !== fp) changed.push(`${e.id} (was ${fps[e.id]}, now ${fp})`);
}
if (added) writeFileSync(fpFile, JSON.stringify(fps, null, 2) + '\n');
ok(!changed.length, changed.length ? `samples no longer as made: ${changed.join(', ')}` : `every sample comes out exactly as it was made${added ? ` (${added} newly fingerprinted)` : ''}`);
process.exit(bad ? 1 : 0);
