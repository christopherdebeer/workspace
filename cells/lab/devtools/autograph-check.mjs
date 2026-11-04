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
await build({ stdin: { contents: `export { MADE } from './client/autograph/samples'; export { CATALOG, SESSIONS, HANDS, NEWEST } from './client/autograph/catalog'; export { SESSION_FILES } from './client/autograph/sessions'; export { measure } from './client/autograph/measure'; export { KNOWS, letter, formsOf } from './client/autograph/hands/v2'; export { KNOWS as KNOWS4, letter as letter4, formsOf as formsOf4 } from './client/autograph/hands/v4'; export { BOOK } from './client/autograph/autobiography'; export { KNOWS as KNOWS5, letter as letter5, formsOf as formsOf5 } from './client/autograph/hands/v5'; export { KNOWS as KNOWS6, letter as letter6, formsOf as formsOf6 } from './client/autograph/hands/v6'; export { KNOWS as KNOWS7, letter as letter7, formsOf as formsOf7, STYLE as STYLE7, MANNERS as MANNERS7 } from './client/autograph/hands/v7'; export { typeset } from './client/autograph/typeset'; export { KNOWS as KNOWS9, letter as letter9, formsOf as formsOf9, STYLE as STYLE9, MANNERS as MANNERS9 } from './client/autograph/hands/v9';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { MADE, CATALOG, SESSIONS, HANDS, NEWEST, SESSION_FILES, measure, KNOWS, letter, formsOf, KNOWS4, letter4, formsOf4, BOOK, KNOWS5, letter5, formsOf5, KNOWS6, letter6, formsOf6, KNOWS7, letter7, formsOf7, STYLE7, MANNERS7, typeset, KNOWS9, letter9, formsOf9, STYLE9, MANNERS9 } = await import(outfile);
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
  { key: 'font 1.0', files: '1.0', src: () => [' ', ...KNOWS6].flatMap((ch) => formsOf6(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter6(ch, f, a)))) },
  // (from 1.2, two faces: the hand at its own pace, and at the pace it writes what's strong)
  { key: 'font 1.2', files: '1.2', src: () => [' ', ...KNOWS7].flatMap((ch) => formsOf7(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter7(ch, f, a, STYLE7)))) },
  { key: 'font 1.2 pressed', files: 'pressed-1.2', src: () => [' ', ...KNOWS7].flatMap((ch) => formsOf7(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter7(ch, f, a, { ...STYLE7, pace: STYLE7.pace * MANNERS7.strong.pace })))) },
  { key: 'font 1.4', files: '1.4', src: () => [' ', ...KNOWS9].flatMap((ch) => formsOf9(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter9(ch, f, a, STYLE9)))) },
  { key: 'font 1.4 pressed', files: 'pressed-1.4', src: () => [' ', ...KNOWS9].flatMap((ch) => formsOf9(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter9(ch, f, a, { ...STYLE9, pace: STYLE9.pace * MANNERS9.strong.pace })))) },
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
// (the font's stylesheets: each version's, fingerprinted as it's kept, so a changed one is a new version; and every
// sample set with one, fingerprinted as it's set, so it always comes out as it did)
const SHEETS = ['1.2', '1.4'];
for (const v of SHEETS) {
  const f = join(lab, `static/autograph/claude-hand-${v}.css`), key = `stylesheet ${v}`;
  if (!existsSync(f)) { changed.push(`${key} (missing)`); continue; }
  const fp = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16);
  if (!fps[key]) { if (record) { fps[key] = fp; added++; } else changed.push(`${key} (no fingerprint: run with --record)`); }
  else if (fps[key] !== fp) changed.push(`${key} was edited (was ${fps[key]}, now ${fp}): a changed stylesheet is a new version`);
}
for (const e of CATALOG.filter((x) => x.type?.some((l) => l.way))) {
  const key = `${e.id} (as set)`, fp = createHash('sha256').update(JSON.stringify(e.type.map((l) => (l.way ? typeset(l.text, l.way) : l.text)))).digest('hex').slice(0, 16);
  if (!fps[key]) { if (record) { fps[key] = fp; added++; } else changed.push(`${key} (no fingerprint: run with --record)`); }
  else if (fps[key] !== fp) changed.push(`${key} (was ${fps[key]}, now ${fp})`);
}
for (const e of CATALOG.filter((x) => MADE[x.id])) {
  const fp = createHash('sha256').update(JSON.stringify(MADE[e.id]())).digest('hex').slice(0, 16);
  if (!fps[e.id]) { if (record) { fps[e.id] = fp; added++; } else changed.push(`${e.id} (no fingerprint: run with --record)`); }
  else if (fps[e.id] !== fp) changed.push(`${e.id} (was ${fps[e.id]}, now ${fp})`);
}
// (the record itself: each session's file, once recorded, is fingerprinted like a sample, so no session's findings,
// decisions, hands or reviews can change afterwards; a later session that thinks differently says so in its own)
const frozen = [];
for (const f of SESSION_FILES) {
  const key = `session ${f.session.n}`, fp = createHash('sha256').update(JSON.stringify({ session: f.session, hands: f.hands ?? {}, entries: f.entries })).digest('hex').slice(0, 16);
  if (!fps[key]) { if (record) { fps[key] = fp; added++; } else frozen.push(`${key} (no fingerprint: run with --record)`); }
  else if (fps[key] !== fp) frozen.push(`${key} was changed (was ${fps[key]}, now ${fp})`);
}
ok(SESSION_FILES.every((f, i) => f.session.n === i + 1 && f.entries.every((e) => e.session === f.session.n)), `the sessions are in order, 1 to ${SESSION_FILES.length}, each holding only its own samples`);
ok(!frozen.length, frozen.length ? `the record changed: ${frozen.join(', ')}` : 'every session is as it was recorded');
// (the notes: every session told, in order, each as it was first told; every hand listed, in the order made)
const md = readFileSync(join(lab, 'static/autograph.md'), 'utf8');
const told = [...md.matchAll(/\*\*Session (\d+) \(/g)];
ok(told.length === SESSIONS.length && told.every((m, i) => Number(m[1]) === i + 1), `the notes tell every session in order (${told.map((m) => m[1]).join(', ')})`);
const retold = [];
told.forEach((m, i) => {
  const end = i + 1 < told.length ? told[i + 1].index : md.indexOf('\n## ', m.index);
  const key = `notes, session ${m[1]}`, fp = createHash('sha256').update(md.slice(m.index, end).trim()).digest('hex').slice(0, 16);
  if (!fps[key]) { if (record) { fps[key] = fp; added++; } else retold.push(`${key} (no fingerprint: run with --record)`); }
  else if (fps[key] !== fp) retold.push(`${key} was rewritten (was ${fps[key]}, now ${fp})`);
});
ok(!retold.length, retold.length ? `the notes changed: ${retold.join(', ')}` : 'every session is told as it was first told');
const handsBlock = md.slice(md.indexOf('- **Hands**'), md.indexOf('- **Samples**'));
const named = Object.keys(HANDS).filter((h) => h !== 'font').map((h) => (h === 'scribble' ? '*Before letters*' : `*${h}*`));
const at = named.map((n) => handsBlock.indexOf(n));
ok(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), `the notes list every hand, in the order made (${named.join(' ')})`);
// (the page's signature, and the hand that writes what's typed on it, are the newest hand)
const page = readFileSync(join(lab, 'client/autograph/main.ts'), 'utf8'), heroHand = /import \{ signature[^}]*\} from '\.\/hands\/(\w+)'/.exec(page)?.[1];
ok(heroHand === NEWEST, `the page signs, and writes what's typed, with the newest hand (${heroHand}; the record's newest is ${NEWEST})`);
if (added) writeFileSync(fpFile, JSON.stringify(fps, null, 2) + '\n');
ok(!changed.length, changed.length ? `samples no longer as made: ${changed.join(', ')}` : `every sample comes out exactly as it was made${added ? ` (${added} newly fingerprinted)` : ''}`);
process.exit(bad ? 1 : 0);
