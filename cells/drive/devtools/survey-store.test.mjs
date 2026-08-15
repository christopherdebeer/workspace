/**
 * WHAT A PLAYER HAS DRIVEN — the store, on its own.
 *
 *   node cells/drive/devtools/survey-store.test.mjs
 *
 * No browser, no truck, no tiles. The survey's memory is the one part of drive
 * where a bug is INVISIBLE: progress does not crash, it just quietly is not
 * there next time, and by then there is nothing left to debug against. So it
 * gets tested the way the road solver does — the shipped module, driven
 * directly, in milliseconds.
 *
 * The case that matters most, and the reason the store is a separate thing
 * from the loaded roads at all:
 *
 *   Roads arrive with the vector tiles, so a session loads only PART of a road
 *   you have driven before. Write the record out of what is on screen and the
 *   rest of that road's checkpoints are deleted — silently, permanently, with
 *   the road still reading as progress.
 *
 * The rest is arithmetic that has to stay monotonic (counts only go up, claims
 * never un-claim), a write budget (a crumb every 250m must not cost a full
 * serialise), and the migration off the v1 flat set, which has to carry 1500km
 * of real progress across without a moment where it is in neither store.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'survey-'));
const built = join(tmp, 'survey-store.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/survey-store.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const { openSurvey, SURVEY_KEY, SURVEY_CAP, SURVEY_FLUSH_MS } = await import(pathToFileURL(built).href);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** localStorage, with a count of what it cost. */
function fakeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    writes: 0, removes: 0, full: false,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (this.full) throw new Error('QuotaExceededError'); this.writes++; m.set(k, v); },
    removeItem(k) { this.removes++; m.delete(k); },
    raw: m,
  };
}
/** A clock the test drives, so the debounce is exact rather than slept through. */
function clock(t = 1000) {
  const c = { t, stamp: 1_700_000_000_000 };
  c.now = () => c.t;
  c.wall = () => c.stamp++;
  return c;
}
const cps = (road, n) => Array.from({ length: n }, (_, i) => `${road}:${i}`);

// ── 1. the deletion trap ────────────────────────────────────────────────
// Monday: the whole road loads and gets driven. Tuesday: only its first half
// streams in. Tuesday must not be able to delete Monday.
{
  const st = fakeStore(), c = clock();
  const mon = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const all = cps('kaapse', 12);
  for (const k of all) mon.take('Ou Kaapse Weg', k, 12);
  mon.flush();

  const tue = openSurvey({ store: st, now: c.now, stamp: c.wall });
  // Half the road is on screen; the game asks about those checkpoints only.
  const seen = all.slice(0, 6);
  check('the loaded half is remembered', seen.every((k) => tue.took('Ou Kaapse Weg', k)), null);
  // …and driving one of them writes.
  tue.take('Ou Kaapse Weg', seen[0], 6);
  tue.flush();

  const wed = openSurvey({ store: st, now: c.now, stamp: c.wall });
  check('the half that never loaded is STILL there',
    all.slice(6).every((k) => wed.took('Ou Kaapse Weg', k)), wed.stats().top);
  check('…and the count did not shrink to what one session could see',
    wed.rec.get('Ou Kaapse Weg').g === 12, wed.rec.get('Ou Kaapse Weg'));
}

// ── 2. a claim is immediate, and it answers for the whole road ──────────
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  for (const k of cps('chapmans', 5)) s.take("Chapman's Peak Drive", k, 9);
  const before = st.writes;
  s.claim("Chapman's Peak Drive", 9);
  check('a claim writes there and then, not on a timer', st.writes === before + 1, { before, after: st.writes });
  check('…and is not still pending', !s.dirty(), s.dirty());

  const next = openSurvey({ store: st, now: c.now, stamp: c.wall });
  check('a claimed road stays claimed', next.claimed("Chapman's Peak Drive"), next.stats().top);
  // Crumbs are dropped, so this is the thing that keeps the markers down and
  // stops a driven road re-pinging at you forever.
  check('…and answers for every checkpoint on it, including ones never collected',
    cps('chapmans', 9).every((k) => next.took("Chapman's Peak Drive", k)), null);
  check('…while keeping no crumbs at all', next.stats().crumbs === 0, next.stats());
  const row = JSON.parse(st.raw.get(SURVEY_KEY)).roads["Chapman's Peak Drive"];
  check('the written record is a count and a time, not a list',
    row.k === undefined && row.g === 9 && row.t === 9 && row.c > 0, row);
}

// ── 3. the write budget ────────────────────────────────────────────────
// The old store called save() from inside the collection loop: three
// checkpoints in one frame serialised the whole set three times, and at 1551km
// driven that was ~140KB every 250m.
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  for (const k of cps('grind', 40)) { s.take('Long Street', k, 40); s.tick(c.now()); }
  check('forty checkpoints in one frame cost nothing yet', st.writes === 0, st.writes);
  c.t += SURVEY_FLUSH_MS + 1;
  s.tick(c.now());
  check('…and one write once the debounce comes due', st.writes === 1, st.writes);
  s.tick(c.now());
  check('…and nothing at all while clean', st.writes === 1, st.writes);
}

// ── 4. off the v1 flat set ─────────────────────────────────────────────
// v1 kept every crumb in one list with no road attached, and claims as bare
// names. Both have to arrive intact, and the 140KB list has to actually go.
{
  const legacy = ['a:0', 'a:1', 'b:0'];
  const st = fakeStore({
    'drive.survey.cp': JSON.stringify(legacy),
    'drive.survey.done': JSON.stringify(['Rhodes Drive']),
  });
  const c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  check('a v1 claim is still a claim', s.claimed('Rhodes Drive'), s.stats().top);
  check('v1 crumbs are held until a road claims them', s.stats().v1 === 3, s.stats());
  // Road A loads: its two crumbs are recognised and move across.
  check('a v1 crumb reads as collected on the road it belongs to',
    s.took('Alpha Road', 'a:0') && s.took('Alpha Road', 'a:1'), null);
  check('…and a checkpoint nobody ever drove does not', !s.took('Alpha Road', 'a:9'), null);
  s.flush();
  check('the old flat list shrinks by exactly what migrated',
    JSON.parse(st.raw.get('drive.survey.cp')).length === 1, st.raw.get('drive.survey.cp'));
  check('the claimed-names key is left alone — it is the progress worth keeping',
    st.raw.get('drive.survey.done') !== null, st.raw.get('drive.survey.done'));
  s.took('Beta Road', 'b:0');
  s.flush();
  check('…and is deleted once the last crumb finds its road',
    st.getItem('drive.survey.cp') === null, st.getItem('drive.survey.cp'));

  const next = openSurvey({ store: st, now: c.now, stamp: c.wall });
  check('the migrated crumbs survive on their new roads',
    next.took('Alpha Road', 'a:0') && next.took('Beta Road', 'b:0'), next.stats().top);
  check('…and did not leak onto a road they were never on', !next.took('Beta Road', 'a:0'), null);
}

// ── 5. monotonic ───────────────────────────────────────────────────────
// The merge in `docs/drive-persistence.md` is union-and-max because progress
// only ever goes up. That has to be true of the local store first.
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  for (const k of cps('r', 8)) s.take('Rhodes Drive', k, 8);
  s.grew('Rhodes Drive', 20);          // another fragment lands, the road is longer
  check('a longer road raises the total', s.rec.get('Rhodes Drive').t === 20, s.rec.get('Rhodes Drive'));
  s.grew('Rhodes Drive', 12);          // …a shorter view of it must not lower it
  check('…and a shorter view of it does not', s.rec.get('Rhodes Drive').t === 20, s.rec.get('Rhodes Drive'));
  s.take('Rhodes Drive', 'r:0', 3);    // a re-collect, from a session with less loaded
  check('collecting a crumb twice is not progress', s.rec.get('Rhodes Drive').g === 8, s.rec.get('Rhodes Drive'));
  check('…and does not shrink the total either', s.rec.get('Rhodes Drive').t === 20, s.rec.get('Rhodes Drive'));
  s.claim('Rhodes Drive', 20);
  s.take('Rhodes Drive', 'r:99', 20);
  check('a claimed road takes no more crumbs', s.stats().crumbs === 0, s.stats());
}

// ── 6. the cap ─────────────────────────────────────────────────────────
// A quota guard, not a rule of the game. When it bites it must shed the roads
// gone longest untouched, and it must keep their COUNTS — those are what a
// signed-in player syncs, and they are cheap.
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const per = 900, roads = Math.ceil((SURVEY_CAP + per) / per);
  for (let i = 0; i < roads; i++) {
    for (const k of cps(`road${i}`, per)) s.take(`Road ${i}`, k, per);
    c.t += 10;
  }
  const held = s.stats().crumbs;
  s.flush();
  check('the cap holds', s.stats().crumbs <= SURVEY_CAP, { before: held, after: s.stats().crumbs });
  check('…by shedding the road gone longest untouched', s.rec.get('Road 0').got.size === 0, s.rec.get('Road 0'));
  check('…and never the one just driven',
    s.rec.get(`Road ${roads - 1}`).got.size === per, s.rec.get(`Road ${roads - 1}`).got.size);
  check('…while the count of the shed road survives', s.rec.get('Road 0').g === per, s.rec.get('Road 0'));
}

// ── 7. a full disk costs progress, never the drive ─────────────────────
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  st.full = true;
  let threw = null;
  try { s.take('Main Street', 'm:0', 4); s.claim('Main Street', 4); } catch (e) { threw = String(e); }
  check('a quota error never reaches the game loop', threw === null, threw);
  check('…and the road still reads as claimed in this session', s.claimed('Main Street'), s.stats().top);
}

// ── 8. no store at all (private mode, blocked storage) ─────────────────
{
  const s = openSurvey({ store: null, now: clock().now, stamp: () => 1 });
  s.take('Main Street', 'm:0', 4);
  s.flush();
  check('the game plays with nowhere to save', s.took('Main Street', 'm:0'), null);
}

rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exitCode = bad ? 1 : 0;
