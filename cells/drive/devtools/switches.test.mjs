/**
 * ── THE SWITCH TABLE CANNOT ROT IN EITHER DIRECTION ──
 *
 * The typed reader already stops a switch being READ without being declared —
 * `qs('nosuch')` does not compile. This closes the other side: a switch
 * DECLARED and no longer read is a promise the code has stopped keeping, and
 * it is exactly how the ten forgotten flags came to exist in the first place.
 *
 * Pure: esbuild the table and read main.ts as text. Seconds, no browser.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'switches-'));
const built = join(out, 'switches.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/switches.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`, '--log-level=error'], { stdio: 'inherit' });
const { SWITCHES, URL_OWNED, qs, qsOn, qsNum, switchRows } = await import(pathToFileURL(built).href);
const main = readFileSync(join(HERE, '../client/main.ts'), 'utf8');

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── the table itself ──
const ids = SWITCHES.map((s) => s.id);
ok('every id is unique', new Set(ids).size === ids.length,
  ids.filter((v, i) => ids.indexOf(v) !== i));
ok('every switch says what it does', SWITCHES.every((s) => s.note && s.note.length > 12),
  SWITCHES.filter((s) => !s.note || s.note.length <= 12).map((s) => s.id));
ok('…and what happens without it', SWITCHES.every((s) => s.fallback && s.fallback.length),
  SWITCHES.filter((s) => !s.fallback).map((s) => s.id));
const MARKS = new Set(['legacy', 'bench', 'look', 'world', 'owned']);
ok('every mark is one of the five', SWITCHES.every((s) => s.marks.every((m) => MARKS.has(m))),
  SWITCHES.flatMap((s) => s.marks).filter((m) => !MARKS.has(m)));

// ── and it is the one the drive rewrites from ──
ok('URL_OWNED is derived, not typed twice',
  [...URL_OWNED].every((k) => ids.includes(k)) && URL_OWNED.size >= 6, [...URL_OWNED]);
ok('main.ts no longer keeps its own owned list', !/const URL_OWNED = new Set\(\[/.test(main));

// ── NOTHING DECLARED IS UNREAD ──
// The whole point. A switch in the table that main.ts never consults is a lie
// on the settings panel, and the panel is the thing that is supposed to stop
// anyone inventing one.
const unread = ids.filter((id) => {
  const re = new RegExp(`qs(?:Has|On|Num)?\\\\('${id}'\\\\)`);
  if (re.test(main)) return false;
  // read through a variable (the reel's two) or consumed as an owned key
  if (new RegExp(`'${id}'`).test(main)) return false;
  return !URL_OWNED.has(id);
});
ok('every declared switch is read somewhere', unread.length === 0, unread);

// ── AND NOTHING READ IS UNDECLARED ──
// The type system enforces this at build time; asserted here too so the reason
// survives a refactor that reaches for `URLSearchParams` again out of habit.
const raw = [...main.matchAll(/new URLSearchParams\(location\.search\)/g)].length;
ok('main.ts does not read the query string by hand any more', raw <= 2, raw);

// ── the readers ──
ok('absent means the caller default', qsOn('shrub', true, '') === true && qsOn('shrub', false, '') === false);
ok('?x=0 and ?x=off are off', !qsOn('shrub', true, '?shrub=0') && !qsOn('shrub', true, '?shrub=off'));
ok('anything else present is on', qsOn('shrub', false, '?shrub=1') && qsOn('shrub', false, '?shrub=yes'));
ok('a number falls back when it is not one', qsNum('treetris', 42, '?treetris=abc') === 42
  && qsNum('treetris', 42, '?treetris=900000') === 900000);
ok('a bare key reads as present', qs('nodraw' in {} ? 'ez' : 'ez', '?ez') === '');

// ── the panel's own rows ──
const rows = switchRows('?ez=0&biome=arid');
const ez = rows.find((r) => r.id === 'ez');
ok('a set switch shows its value', ez.set && ez.value === '0', ez);
const unset = rows.find((r) => r.id === 'shrub');
ok('an unset one shows what happens without it', !unset.set && unset.value === 'on', unset);
ok('the panel lists every switch', rows.length === SWITCHES.length, [rows.length, SWITCHES.length]);

const legacy = SWITCHES.filter((s) => s.marks.includes('legacy'));
console.log(`\n${SWITCHES.length} switches · ${legacy.length} marked legacy:`);
for (const s of legacy) console.log(`   ?${s.id.padEnd(10)} ${s.note}`);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
