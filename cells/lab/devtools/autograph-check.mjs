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
await build({ stdin: { contents: `export { MADE } from './client/autograph/samples'; export { CATALOG, SESSIONS, HANDS, NEWEST } from './client/autograph/catalog'; export { SESSION_FILES } from './client/autograph/sessions'; export { measure } from './client/autograph/measure'; export { KNOWS, letter, formsOf } from './client/autograph/hands/v2'; export { KNOWS as KNOWS4, letter as letter4, formsOf as formsOf4 } from './client/autograph/hands/v4'; export { BOOK } from './client/autograph/autobiography'; export { KNOWS as KNOWS5, letter as letter5, formsOf as formsOf5 } from './client/autograph/hands/v5'; export { KNOWS as KNOWS6, letter as letter6, formsOf as formsOf6 } from './client/autograph/hands/v6'; export { KNOWS as KNOWS7, letter as letter7, formsOf as formsOf7, STYLE as STYLE7, MANNERS as MANNERS7 } from './client/autograph/hands/v7'; export { typeset } from './client/autograph/typeset'; export { KNOWS as KNOWS9, letter as letter9, formsOf as formsOf9, STYLE as STYLE9, MANNERS as MANNERS9 } from './client/autograph/hands/v9'; export { KNOWS as KNOWS12, letter as letter12, formsOf as formsOf12, STYLE as STYLE12, MANNERS as MANNERS12 } from './client/autograph/hands/v12'; export { KNOWS as KNOWS13, letter as letter13, formsOf as formsOf13, STYLE as STYLE13, MANNERS as MANNERS13 } from './client/autograph/hands/v13'; export { KNOWS as KNOWS14, letter as letter14, formsOf as formsOf14, STYLE as STYLE14, MANNERS as MANNERS14 } from './client/autograph/hands/v14'; export { KNOWS as KNOWS18, letter as letter18, formsOf as formsOf18, STYLE as STYLE18, MANNERS as MANNERS18 } from './client/autograph/hands/v18'; export { KNOWS as KNOWS19, letter as letter19, formsOf as formsOf19, STYLE as STYLE19, MANNERS as MANNERS19, worn as worn19 } from './client/autograph/hands/v19'; export { KNOWS as KNOWS20, letter as letter20, formsOf as formsOf20, STYLE as STYLE20, MANNERS as MANNERS20, worn as worn20 } from './client/autograph/hands/v20'; export { KNOWS as KNOWS21, letter as letter21, formsOf as formsOf21, STYLE as STYLE21, MANNERS as MANNERS21, worn as worn21 } from './client/autograph/hands/v21'; export { KNOWS as KNOWS22, letter as letter22, formsOf as formsOf22, STYLE as STYLE22, MANNERS as MANNERS22 } from './client/autograph/hands/v22'; export { KNOWS as KNOWS23, letter as letter23, formsOf as formsOf23, STYLE as STYLE23, MANNERS as MANNERS23, worn as worn23 } from './client/autograph/hands/v23'; export { KNOWS as KNOWS24, letter as letter24, formsOf as formsOf24, STYLE as STYLE24, MANNERS as MANNERS24, worn as worn24, HURRY as HURRY24 } from './client/autograph/hands/v24'; export { KNOWS as KNOWS25, letter as letter25, formsOf as formsOf25, STYLE as STYLE25 } from './client/autograph/hands/v25'; export { KNOWS as KNOWS26, letter as letter26, formsOf as formsOf26, STYLE as STYLE26, MANNERS as MANNERS26, worn as worn26, HURRY as HURRY26 } from './client/autograph/hands/v26'; export { KNOWS as KNOWS27, letter as letter27, STYLE as STYLE27, formsOf as formsOf27, MANNERS as MANNERS27, worn as worn27, HURRY as HURRY27 } from './client/autograph/hands/v27'; export { KNOWS as KNOWS30, letter as letter30, STYLE as STYLE30, formsOf as formsOf30, MANNERS as MANNERS30, worn as worn30, HURRY as HURRY30 } from './client/autograph/hands/v30';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { MADE, CATALOG, SESSIONS, HANDS, NEWEST, SESSION_FILES, measure, KNOWS, letter, formsOf, KNOWS4, letter4, formsOf4, BOOK, KNOWS5, letter5, formsOf5, KNOWS6, letter6, formsOf6, KNOWS7, letter7, formsOf7, STYLE7, MANNERS7, typeset, KNOWS9, letter9, formsOf9, STYLE9, MANNERS9, KNOWS12, letter12, formsOf12, STYLE12, MANNERS12, KNOWS13, letter13, formsOf13, STYLE13, MANNERS13, KNOWS14, letter14, formsOf14, STYLE14, MANNERS14, KNOWS18, letter18, formsOf18, STYLE18, MANNERS18, KNOWS19, letter19, formsOf19, STYLE19, MANNERS19, worn19, KNOWS20, letter20, formsOf20, STYLE20, MANNERS20, worn20, KNOWS21, letter21, formsOf21, STYLE21, MANNERS21, worn21, KNOWS22, letter22, formsOf22, STYLE22, MANNERS22, KNOWS23, letter23, formsOf23, STYLE23, MANNERS23, worn23, KNOWS24, letter24, formsOf24, STYLE24, MANNERS24, worn24, HURRY24, KNOWS25, letter25, formsOf25, STYLE25, KNOWS26, letter26, formsOf26, STYLE26, MANNERS26, worn26, HURRY26, KNOWS27, letter27, STYLE27, formsOf27, MANNERS27, worn27, HURRY27, KNOWS30, letter30, STYLE30, formsOf30, MANNERS30, worn30, HURRY30 } = await import(outfile);
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
  // (from 1.8, spaced as the hand is: the letters as the hand sets them, before the font draws an s back and kerns it)
  { key: 'font 1.8', files: '1.8', src: () => [' ', ...KNOWS12].flatMap((ch) => formsOf12(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter12(ch, f, a, STYLE12)))) },
  { key: 'font 1.8 pressed', files: 'pressed-1.8', src: () => [' ', ...KNOWS12].flatMap((ch) => formsOf12(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter12(ch, f, a, { ...STYLE12, pace: STYLE12.pace * MANNERS12.strong.pace })))) },
  { key: 'font 1.9', files: '1.9', src: () => [' ', ...KNOWS13].flatMap((ch) => formsOf13(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter13(ch, f, a, STYLE13)))) },
  { key: 'font 1.9 pressed', files: 'pressed-1.9', src: () => [' ', ...KNOWS13].flatMap((ch) => formsOf13(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter13(ch, f, a, { ...STYLE13, pace: STYLE13.pace * MANNERS13.strong.pace })))) },
  { key: 'font 2.0', files: '2.0', src: () => [' ', ...KNOWS14].flatMap((ch) => formsOf14(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter14(ch, f, a, STYLE14)))) },
  { key: 'font 2.0 pressed', files: 'pressed-2.0', src: () => [' ', ...KNOWS14].flatMap((ch) => formsOf14(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter14(ch, f, a, { ...STYLE14, pace: STYLE14.pace * MANNERS14.strong.pace })))) },
  { key: 'font 2.6', files: '2.6', src: () => [' ', ...KNOWS18].flatMap((ch) => formsOf18(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter18(ch, f, a, STYLE18)))) },
  { key: 'font 2.6 pressed', files: 'pressed-2.6', src: () => [' ', ...KNOWS18].flatMap((ch) => formsOf18(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter18(ch, f, a, { ...STYLE18, pace: STYLE18.pace * MANNERS18.strong.pace })))) },
  // (2.7: one variable font, for the web only (its TTF too big to keep), its three masters: own pace, pressed, worn)
  { key: 'font 2.7', files: '2.7', web: true, src: () => [STYLE19, { ...STYLE19, pace: STYLE19.pace * MANNERS19.strong.pace }, 'worn'].flatMap((st) => { const set = () => [' ', ...KNOWS19].flatMap((ch) => formsOf19(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter19(ch, f, a, st === 'worn' ? STYLE19 : st)))); return st === 'worn' ? worn19(set) : set(); }) },
  // (2.8: its four masters: own pace, pressed, hurried (twice its own pace), worn)
  { key: 'font 2.8', files: '2.8', web: true, src: () => [STYLE20, { ...STYLE20, pace: STYLE20.pace * MANNERS20.strong.pace }, { ...STYLE20, pace: STYLE20.pace * 2 }, 'worn'].flatMap((st) => { const set = () => [' ', ...KNOWS20].flatMap((ch) => formsOf20(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter20(ch, f, a, st === 'worn' ? STYLE20 : st)))); return st === 'worn' ? worn20(set) : set(); }) },
  // (2.9: the same four masters, from v21)
  { key: 'font 2.9', files: '2.9', web: true, src: () => [STYLE21, { ...STYLE21, pace: STYLE21.pace * MANNERS21.strong.pace }, { ...STYLE21, pace: STYLE21.pace * 2 }, 'worn'].flatMap((st) => { const set = () => [' ', ...KNOWS21].flatMap((ch) => formsOf21(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter21(ch, f, a, st === 'worn' ? STYLE21 : st)))); return st === 'worn' ? worn21(set) : set(); }) },
  // (the writing font 3.2: one writing of each letter, at the hand's own pace with its moments, and pressed)
  { key: 'font writing 3.2', files: 'writing-3.2', web: true, src: () => [STYLE22, { ...STYLE22, pace: STYLE22.pace * MANNERS22.strong.pace }].flatMap((st) => [' ', ...KNOWS22].flatMap((ch) => formsOf22(ch).map((f) => letter22(ch, f, 1, st)))) },
  // (3.3, from v23, the looser pen: the full font's four masters, and the writing font)
  { key: 'font 3.3', files: '3.3', web: true, src: () => [STYLE23, { ...STYLE23, pace: STYLE23.pace * MANNERS23.strong.pace }, { ...STYLE23, pace: STYLE23.pace * 2 }, 'worn'].flatMap((st) => { const set = () => [' ', ...KNOWS23].flatMap((ch) => formsOf23(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter23(ch, f, a, st === 'worn' ? STYLE23 : st)))); return st === 'worn' ? worn23(set) : set(); }) },
  { key: 'font writing 3.3', files: 'writing-3.3', web: true, src: () => [STYLE23, { ...STYLE23, pace: STYLE23.pace * MANNERS23.strong.pace }].flatMap((st) => [' ', ...KNOWS23].flatMap((ch) => formsOf23(ch).map((f) => letter23(ch, f, 1, st)))) },
  // (3.4, from v24: the full font's four masters, hurried at four times its pace; and the writing font, hurried too)
  { key: 'font 3.4', files: '3.4', web: true, src: () => [STYLE24, { ...STYLE24, pace: STYLE24.pace * MANNERS24.strong.pace }, { ...STYLE24, pace: STYLE24.pace * HURRY24 }, 'worn'].flatMap((st) => { const set = () => [' ', ...KNOWS24].flatMap((ch) => formsOf24(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter24(ch, f, a, st === 'worn' ? STYLE24 : st)))); return st === 'worn' ? worn24(set) : set(); }) },
  { key: 'font writing 3.4', files: 'writing-3.4', web: true, src: () => [STYLE24, { ...STYLE24, pace: STYLE24.pace * MANNERS24.strong.pace }, { ...STYLE24, pace: STYLE24.pace * HURRY24 }].flatMap((st) => [' ', ...KNOWS24].flatMap((ch) => formsOf24(ch).map((f) => letter24(ch, f, 1, st)))) },
  // (3.5, still faces for any app, each a state of the hand chosen for what it says, in eight writings: from v24, Regular,
  // Pressed and Hurried; and the family of its own, Running, v23's loose pen at twice its pace)
  ...[['3.5', STYLE24], ['pressed-3.5', { ...STYLE24, pace: STYLE24.pace * MANNERS24.strong.pace }], ['hurried-3.5', { ...STYLE24, pace: STYLE24.pace * HURRY24 }]].map(([files, st]) => ({ key: `font ${files}`, files, src: () => [' ', ...KNOWS24].flatMap((ch) => formsOf24(ch).flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((a) => letter24(ch, f, a, st)))) })),
  { key: 'font running-3.5', files: 'running-3.5', src: () => [' ', ...KNOWS23].flatMap((ch) => formsOf23(ch).flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((a) => letter23(ch, f, a, { ...STYLE23, pace: STYLE23.pace * 2 })))) },
  // (3.7, more still faces from v25, care off, each set by the hand as autograph-font-faces.mjs sets it before the pen's
  // width is changed for the instrument or the size: Fair, the fair copy; Note and Sign, the hand small and large; Nib)
  ...[['fair-3.7', { ...STYLE25, pace: STYLE25.pace * 0.75, slant: STYLE25.slant * 0.5, track: STYLE25.track * 1.06 }], ['note-3.7', { ...STYLE25, track: STYLE25.track * 1.06 }], ['sign-3.7', STYLE25], ['nib-3.7', STYLE25]].map(([files, st]) => ({ key: `font ${files}`, files, src: () => [' ', ...KNOWS25].flatMap((ch) => formsOf25(ch).flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((a) => letter25(ch, f, a, st)))) })),
  // (3.8, from v26, care on and the f, e, r and v written with care: the variable font's four masters, the writing font,
  // and the still faces Regular, Pressed and Hurried)
  { key: 'font 3.8', files: '3.8', web: true, src: () => [STYLE26, { ...STYLE26, pace: STYLE26.pace * MANNERS26.strong.pace }, { ...STYLE26, pace: STYLE26.pace * HURRY26 }, 'worn'].flatMap((st) => { const set = () => [' ', ...KNOWS26].flatMap((ch) => formsOf26(ch).flatMap((f) => [1, 2, 3, 4].map((a) => letter26(ch, f, a, st === 'worn' ? STYLE26 : st)))); return st === 'worn' ? worn26(set) : set(); }) },
  { key: 'font writing 3.8', files: 'writing-3.8', web: true, src: () => [STYLE26, { ...STYLE26, pace: STYLE26.pace * MANNERS26.strong.pace }, { ...STYLE26, pace: STYLE26.pace * HURRY26 }].flatMap((st) => [' ', ...KNOWS26].flatMap((ch) => formsOf26(ch).map((f) => letter26(ch, f, 1, st)))) },
  ...[['still-3.8', 'still-3.8', STYLE26], ['pressed-3.8', 'pressed-3.8', { ...STYLE26, pace: STYLE26.pace * MANNERS26.strong.pace }], ['hurried-3.8', 'hurried-3.8', { ...STYLE26, pace: STYLE26.pace * HURRY26 }]].map(([key, files, st]) => ({ key: `font ${key}`, files, src: () => [' ', ...KNOWS26].flatMap((ch) => formsOf26(ch).flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((a) => letter26(ch, f, a, st)))) })),
  // (3.9, the hand printing: v27's printed letters, upright, nothing joined, in eight writings)
  { key: 'font print-3.9', files: 'print-3.9', src: () => [' ', ...KNOWS27].flatMap((ch) => [1, 2, 3, 4, 5, 6, 7, 8].map((a) => letter27(ch, 'i', a, { ...STYLE27, print: true, slant: STYLE27.slant * 0.3 }))) },
  // (4.0, from v27: the variable font's six masters, three writings each: its own pace, pressed, hurried, worn, and the
  // hand's two sizes, written small (a little more room) and large, before the pen's width is changed for them)
  { key: 'font 4.0', files: '4.0', web: true, src: () => [STYLE27, { ...STYLE27, pace: STYLE27.pace * MANNERS27.strong.pace }, { ...STYLE27, pace: STYLE27.pace * HURRY27 }, 'worn', { ...STYLE27, track: STYLE27.track * 1.06 }, STYLE27].flatMap((st) => { const set = () => [' ', ...KNOWS27].flatMap((ch) => formsOf27(ch).flatMap((f) => [1, 2, 3].map((a) => letter27(ch, f, a, st === 'worn' ? STYLE27 : st)))); return st === 'worn' ? worn27(set) : set(); }) },
  // (4.1, from v30, its s with a body again: the variable font's six masters as 4.0's, and the writing font)
  { key: 'font 4.1', files: '4.1', web: true, src: () => [STYLE30, { ...STYLE30, pace: STYLE30.pace * MANNERS30.strong.pace }, { ...STYLE30, pace: STYLE30.pace * HURRY30 }, 'worn', { ...STYLE30, track: STYLE30.track * 1.06 }, STYLE30].flatMap((st) => { const set = () => [' ', ...KNOWS30].flatMap((ch) => formsOf30(ch).flatMap((f) => [1, 2, 3].map((a) => letter30(ch, f, a, st === 'worn' ? STYLE30 : st)))); return st === 'worn' ? worn30(set) : set(); }) },
  { key: 'font writing 4.1', files: 'writing-4.1', web: true, src: () => [STYLE30, { ...STYLE30, pace: STYLE30.pace * MANNERS30.strong.pace }, { ...STYLE30, pace: STYLE30.pace * HURRY30 }].flatMap((st) => [' ', ...KNOWS30].flatMap((ch) => formsOf30(ch).map((f) => letter30(ch, f, 1, st)))) },
];
for (const F of FONTS) {
  const fp = createHash('sha256').update(JSON.stringify(F.src())).digest('hex').slice(0, 16);
  if (!fps[F.key]) { if (record) { fps[F.key] = fp; added++; } else changed.push(`${F.key} (no fingerprint: run with --record)`); }
  else if (fps[F.key] !== fp) changed.push(`${F.key} (was ${fps[F.key]}, now ${fp})`);
}
ok(FONTS.every((F) => (F.web ? ['woff2'] : ['ttf', 'woff2']).every((x) => existsSync(join(lab, `static/autograph/claude-hand-${F.files}.${x}`)))) && CATALOG.filter((e) => e.type).every((e) => e.type.every((l) => existsSync(join(lab, `static/autograph/claude-hand-${l.family ? `${l.family.toLowerCase()}-` : ''}${e.font ?? '0.41'}.woff2`)))), `the fonts' files are there (${FONTS.map((F) => F.files).join(', ')}), and every sample set in type names one`);
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
const SHEETS = ['1.2', '1.4', '1.8', '1.9', '2.0', '2.6', '2.7', '2.8', '2.9', '3.3', '3.4', '3.8', '4.0', '4.1'];
for (const v of SHEETS) {
  const f = join(lab, `static/autograph/claude-hand-${v}.css`), key = `stylesheet ${v}`;
  if (!existsSync(f)) { changed.push(`${key} (missing)`); continue; }
  const fp = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16);
  if (!fps[key]) { if (record) { fps[key] = fp; added++; } else changed.push(`${key} (no fingerprint: run with --record)`); }
  else if (fps[key] !== fp) changed.push(`${key} was edited (was ${fps[key]}, now ${fp}): a changed stylesheet is a new version`);
}
// (from session 31, the font's script for the web's time, kept and fingerprinted as the stylesheets are)
const SCRIPTS = ['3.1', '3.2', '3.3', '3.4', '3.8', '4.1'];
for (const v of SCRIPTS) {
  const f = join(lab, `static/autograph/claude-hand-time-${v}.js`), key = `script ${v}`;
  if (!existsSync(f)) { changed.push(`${key} (missing)`); continue; }
  const fp = createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 16);
  if (!fps[key]) { if (record) { fps[key] = fp; added++; } else changed.push(`${key} (no fingerprint: run with --record)`); }
  else if (fps[key] !== fp) changed.push(`${key} was edited (was ${fps[key]}, now ${fp}): a changed script is a new version`);
}
for (const e of CATALOG.filter((x) => x.type?.some((l) => l.way))) {
  const key = `${e.id} (as set)`, fp = createHash('sha256').update(JSON.stringify(e.type.map((l) => (l.way ? typeset(l.text, l.way === 'app' ? 'app' : 'web') + (l.way === 'time' ? ' (in time)' + (l.script ? ' ' + l.script : '') : '') : l.text)))).digest('hex').slice(0, 16);
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
