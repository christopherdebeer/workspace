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
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'switches-'));
const built = join(out, 'switches.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/switches.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`, '--log-level=error'], { stdio: 'inherit' });
const { SWITCHES, URL_OWNED, qs, qsOn, qsNum, switchRows, urlWithSwitches } = await import(pathToFileURL(built).href);
const CLIENT = join(HERE, '../client');
const main = readFileSync(join(CLIENT, 'main.ts'), 'utf8');

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

// ── AND NOT BY REGEX EITHER, WHICH IS HOW SEVEN GOT PAST THIS TEST ──
//
// The check above counts one spelling — `new URLSearchParams(location.search)`
// — and a switch tested as `/[?&]nodraw=1/.test(location.search)` is not that
// spelling, so it cost nothing to add and the table never saw it. Seven were
// live when this was written: dem, hydro, cprobe, nodraw, noweld, nopins and
// nofill, none declared, none on the SETTINGS panel, none in this file's
// output. `?substrate=render` had already been caught being read this way and
// fixed one switch at a time; the lesson went into a comment in main.ts and
// the regex directly above that comment kept reading `hydro` by hand.
//
// So the assertion is on the SHAPE, not on a count: a query regex anywhere in
// the client is the reader going round the table, whatever it is spelled. The
// whole directory, because the next one will not be in main.ts.
const byRegex = [];
for (const f of readdirSync(CLIENT, { recursive: true })) {
  if (typeof f !== 'string' || !f.endsWith('.ts') || f.endsWith('switches.ts')) continue;
  const src = readFileSync(join(CLIENT, f), 'utf8');
  for (const m of src.matchAll(/\/\\?\[\?&\][a-zA-Z]+=?/g)) byRegex.push(`${f}: ${m[0]}…`);
}
ok('no client module matches the query string with a regex', byRegex.length === 0, byRegex);

// ── the readers ──
ok('absent means the caller default', qsOn('shrub', true, '') === true && qsOn('shrub', false, '') === false);
ok('?x=0 and ?x=off are off', !qsOn('shrub', true, '?shrub=0') && !qsOn('shrub', true, '?shrub=off'));
ok('anything else present is on', qsOn('shrub', false, '?shrub=1') && qsOn('shrub', false, '?shrub=yes'));
ok('a number falls back when it is not one', qsNum('treetris', 42, '?treetris=abc') === 42
  && qsNum('treetris', 42, '?treetris=900000') === 900000);
// ABSENT IS THE CALLER'S DEFAULT, which is the rule qsOn states and qsNum
// broke: `qs` answers null, Number(null) is 0, and 0 is finite, so every
// unset number switch read as zero. The two cases above both PASS against
// that bug — they only ever pass a value — which is why it shipped.
ok('a number that is not there falls back too',
  qsNum('treetris', 42, '') === 42 && qsNum('treetris', 42, '?other=1') === 42
  && qsNum('treetris', 42, '?treetris=') === 42
  && qsNum('treetris', 42, '?treetris=0') === 0);
ok('a bare key reads as present', qs('nodraw' in {} ? 'ez' : 'ez', '?ez') === '');

// ── the panel's own rows ──
const rows = switchRows('?ez=0&biome=arid');
const ez = rows.find((r) => r.id === 'ez');
ok('a set switch shows its value', ez.set && ez.value === '0', ez);
const unset = rows.find((r) => r.id === 'shrub');
ok('an unset one shows what happens without it', !unset.set && unset.value === 'on', unset);
ok('the panel lists every switch', rows.length === SWITCHES.length, [rows.length, SWITCHES.length]);

// ── THE PANEL'S RELOAD PRESERVES WHAT IT IS NOT CHANGING ──
// The drive's own URL rewrite once deleted every art-direction and
// instrumentation flag it did not itself write (see URL_OWNED's note). The
// SETTINGS reload builds a URL the same way and must not repeat it: a staged
// change to one switch leaves the other sixty-six exactly as they were.
const kept = urlWithSwitches({ biome: 'arid' }, '?t=dusk&mblur=2&lat=37.7');
ok('a staged change keeps every other key', kept.includes('t=dusk')
  && kept.includes('mblur=2') && kept.includes('lat=37.7') && kept.includes('biome=arid'), kept);
ok('a staged change overwrites its own key',
  urlWithSwitches({ biome: 'arid' }, '?biome=alpine') === '?biome=arid',
  urlWithSwitches({ biome: 'arid' }, '?biome=alpine'));
ok('null clears one key and only that key',
  urlWithSwitches({ ez: null }, '?ez=0&shore=0') === '?shore=0',
  urlWithSwitches({ ez: null }, '?ez=0&shore=0'));
ok('clearing the last key leaves no stray question mark',
  urlWithSwitches({ ez: null }, '?ez=0') === '', urlWithSwitches({ ez: null }, '?ez=0'));
ok('nothing staged is the query unchanged',
  urlWithSwitches({}, '?ez=0&biome=arid') === '?ez=0&biome=arid');
// A toggle's three states are the three the reader draws a distinction
// between, so the URL must be able to say each of them.
ok('a toggle can be staged on, off, or away',
  urlWithSwitches({ shore: '1' }, '') === '?shore=1'
  && urlWithSwitches({ shore: '0' }, '') === '?shore=0'
  && urlWithSwitches({ shore: null }, '?shore=1') === '');

// ── AND THE PANEL CAN TELL A SWITCH'S KIND ──
// The row needs it to know whether a tap cycles or asks for a value.
const kinds = new Set(switchRows('').map((r) => r.kind));
ok('every row carries a kind the panel understands',
  [...kinds].every((k) => ['toggle', 'number', 'choice', 'text'].includes(k)), [...kinds]);
const rawRow = switchRows('?ez=0').find((r) => r.id === 'ez');
ok('a row carries the raw value, so an edit starts from what is set',
  rawRow.raw === '0' && switchRows('').find((r) => r.id === 'ez').raw === null, rawRow);

const legacy = SWITCHES.filter((s) => s.marks.includes('legacy'));
console.log(`\n${SWITCHES.length} switches · ${legacy.length} marked legacy:`);
for (const s of legacy) console.log(`   ?${s.id.padEnd(10)} ${s.note}`);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
