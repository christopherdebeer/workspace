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
// Somewhere to be. Roads are identified by name AND place, so every test that
// touches identity has to say where it is standing.
const CAPE = [-33.92, 18.42], PARIS = [48.85, 2.35];

// ── 1. the deletion trap ────────────────────────────────────────────────
// Monday: the whole road loads and gets driven. Tuesday: only its first half
// streams in. Tuesday must not be able to delete Monday.
{
  const st = fakeStore(), c = clock();
  const mon = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const all = cps('kaapse', 12);
  for (const k of all) mon.take(mon.roadId('Ou Kaapse Weg', ...CAPE), k, 12);
  mon.flush();

  const tue = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const tid = tue.roadId('Ou Kaapse Weg', ...CAPE);
  // Half the road is on screen; the game asks about those checkpoints only.
  const seen = all.slice(0, 6);
  check('the loaded half is remembered', seen.every((k) => tue.took(tid, k)), null);
  // …and driving one of them writes.
  tue.take(tid, seen[0], 6);
  tue.flush();

  const wed = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const wid = wed.roadId('Ou Kaapse Weg', ...CAPE);
  check('the half that never loaded is STILL there',
    all.slice(6).every((k) => wed.took(wid, k)), wed.stats().top);
  check('…and the count did not shrink to what one session could see',
    wed.rec.get(wid).g === 12, wed.rec.get(wid));
}

// ── 2. a claim is immediate, and it answers for the whole road ──────────
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const chap = s.roadId("Chapman's Peak Drive", ...CAPE);
  for (const k of cps('chapmans', 5)) s.take(chap, k, 9);
  const before = st.writes;
  s.claim(chap, 9);
  check('a claim writes there and then, not on a timer', st.writes === before + 1, { before, after: st.writes });
  check('…and is not still pending', !s.dirty(), s.dirty());

  const next = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const nid = next.roadId("Chapman's Peak Drive", ...CAPE);
  check('a claimed road stays claimed', next.claimed(nid), next.stats().top);
  // Crumbs are dropped, so this is the thing that keeps the markers down and
  // stops a driven road re-pinging at you forever.
  check('…and answers for every checkpoint on it, including ones never collected',
    cps('chapmans', 9).every((k) => next.took(nid, k)), null);
  check('…while keeping no crumbs at all', next.stats().crumbs === 0, next.stats());
  const row = JSON.parse(st.raw.get(SURVEY_KEY)).roads[chap];
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
  const long = s.roadId('Long Street', ...CAPE);
  for (const k of cps('grind', 40)) { s.take(long, k, 40); s.tick(c.now()); }
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
  check('a v1 claim is still a claim', s.claimed(s.roadId('Rhodes Drive', ...CAPE)), s.stats().top);
  check('v1 crumbs are held until a road claims them', s.stats().v1 === 3, s.stats());
  // Road A loads: its two crumbs are recognised and move across.
  const alpha = s.roadId('Alpha Road', ...CAPE), beta = s.roadId('Beta Road', ...CAPE);
  check('a v1 crumb reads as collected on the road it belongs to',
    s.took(alpha, 'a:0') && s.took(alpha, 'a:1'), null);
  check('…and a checkpoint nobody ever drove does not', !s.took(alpha, 'a:9'), null);
  s.flush();
  check('the old flat list shrinks by exactly what migrated',
    JSON.parse(st.raw.get('drive.survey.cp')).length === 1, st.raw.get('drive.survey.cp'));
  check('the claimed-names key is left alone — it is the progress worth keeping',
    st.raw.get('drive.survey.done') !== null, st.raw.get('drive.survey.done'));
  s.took(beta, 'b:0');
  s.flush();
  check('…and is deleted once the last crumb finds its road',
    st.getItem('drive.survey.cp') === null, st.getItem('drive.survey.cp'));

  const next = openSurvey({ store: st, now: c.now, stamp: c.wall });
  check('the migrated crumbs survive on their new roads',
    next.took(next.roadId('Alpha Road', ...CAPE), 'a:0')
    && next.took(next.roadId('Beta Road', ...CAPE), 'b:0'), next.stats().top);
  check('…and did not leak onto a road they were never on',
    !next.took(next.roadId('Beta Road', ...CAPE), 'a:0'), null);
}

// ── 5. monotonic ───────────────────────────────────────────────────────
// The merge in `docs/drive-persistence.md` is union-and-max because progress
// only ever goes up. That has to be true of the local store first.
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const rd = s.roadId('Rhodes Drive', ...CAPE);
  for (const k of cps('r', 8)) s.take(rd, k, 8);
  s.grew(rd, 20);          // another fragment lands, the road is longer
  check('a longer road raises the total', s.rec.get(rd).t === 20, s.rec.get(rd));
  s.grew(rd, 12);          // …a shorter view of it must not lower it
  check('…and a shorter view of it does not', s.rec.get(rd).t === 20, s.rec.get(rd));
  s.take(rd, 'r:0', 3);    // a re-collect, from a session with less loaded
  check('collecting a crumb twice is not progress', s.rec.get(rd).g === 8, s.rec.get(rd));
  check('…and does not shrink the total either', s.rec.get(rd).t === 20, s.rec.get(rd));
  s.claim(rd, 20);
  s.take(rd, 'r:99', 20);
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
    const id = s.roadId(`Road ${i}`, ...CAPE);
    for (const k of cps(`road${i}`, per)) s.take(id, k, per);
    c.t += 10;
  }
  const held = s.stats().crumbs;
  s.flush();
  check('the cap holds', s.stats().crumbs <= SURVEY_CAP, { before: held, after: s.stats().crumbs });
  const oldest = s.roadId('Road 0', ...CAPE), newest = s.roadId(`Road ${roads - 1}`, ...CAPE);
  check('…by shedding the road gone longest untouched', s.rec.get(oldest).got.size === 0, s.rec.get(oldest));
  check('…and never the one just driven',
    s.rec.get(newest).got.size === per, s.rec.get(newest).got.size);
  check('…while the count of the shed road survives', s.rec.get(oldest).g === per, s.rec.get(oldest));
}

// ── 7. a full disk costs progress, never the drive ─────────────────────
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  st.full = true;
  let threw = null;
  const main = s.roadId('Main Street', ...CAPE);
  try { s.take(main, 'm:0', 4); s.claim(main, 4); } catch (e) { threw = String(e); }
  check('a quota error never reaches the game loop', threw === null, threw);
  check('…and the road still reads as claimed in this session', s.claimed(main), s.stats().top);
}

// ── 8. road identity ───────────────────────────────────────────────────
// Two things have to be true at once, and they pull in opposite directions:
// two roads that merely share a name are DIFFERENT roads, and one road
// approached from either end is the SAME road. The second is the dangerous
// one — getting it wrong tears a road's progress in half with nothing on
// screen to say so.
{
  const st = fakeStore(), c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const cape = s.roadId('Main Street', ...CAPE);
  const paris = s.roadId('Main Street', ...PARIS);
  check('same name, different cities: two roads', cape !== paris, { cape, paris });
  s.claim(cape, 6);
  check('claiming one does not claim the other', s.claimed(cape) && !s.claimed(paris), { cape, paris });

  // The road that straddles a cell boundary. Monday from the south side,
  // Tuesday from the north — one degree apart, and it must be one road.
  const south = s.roadId('Long Road', -33.98, 18.42);
  const north = s.roadId('Long Road', -32.98, 18.42);
  check('one road, approached from either side of a cell edge, is one road',
    south === north, { south, north });
  // …and the anchor is what is STORED, not what loaded first today.
  for (const k of cps('long', 4)) s.take(south, k, 4);
  s.flush();
  const tue = openSurvey({ store: st, now: c.now, stamp: c.wall });
  check('…including in a session that only ever sees the far end',
    cps('long', 4).every((k) => tue.took(tue.roadId('Long Road', -32.98, 18.42), k)), tue.stats().top);

  // Longitude wraps. 179.5°E and 179.5°W are a degree apart, not 359.
  const east = s.roadId('Date Line Road', 1.0, 179.6);
  const west = s.roadId('Date Line Road', 1.0, -179.6);
  check('the antimeridian is not a continent', east === west, { east, west });
}

// ── 9. the roads claimed before roads had identity ─────────────────────
// Old records are keyed by bare name. Their CLAIM cannot be placed — nothing
// in it says where it was earned — so it is answered from and never moved: as
// broad as it always was, no broader. Their CRUMBS carry positions, so those
// can be placed, and are.
{
  const st = fakeStore({
    [SURVEY_KEY]: JSON.stringify({ v: 2, roads: {
      'Rhodes Drive': { g: 9, t: 9, c: 1700000000000 },
      'Kloof Nek Road': { g: 2, t: 8, k: ['kloof:0', 'kloof:1'] },
    } }),
  });
  const c = clock();
  const s = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const rhodes = s.roadId('Rhodes Drive', ...CAPE);
  check('an old claim still answers', s.claimed(rhodes), s.stats().top);
  check('…and answers by name, wherever you are — the old breadth, unchanged',
    s.claimed(s.roadId('Rhodes Drive', ...PARIS)), null);

  const kloof = s.roadId('Kloof Nek Road', ...CAPE);
  check('an old crumb is recognised', s.took(kloof, 'kloof:0'), null);
  check('…and moves onto the anchored road', s.rec.get(kloof).got.has('kloof:0'), s.stats().top);
  check('…leaving the old record', !s.rec.get('Kloof Nek Road').got.has('kloof:0'), null);
  s.took(kloof, 'kloof:1');
  s.flush();
  const written = JSON.parse(st.raw.get(SURVEY_KEY)).roads;
  check('a spent unclaimed old record is dropped', written['Kloof Nek Road'] === undefined, Object.keys(written));
  check('…but the claimed one is kept forever — it is the only answer that claim has',
    written['Rhodes Drive']?.c > 0, written['Rhodes Drive']);
  check('…and the crumbs live under the anchored id now',
    (written[kloof]?.k ?? []).length === 2, written[kloof]);
}

// ── 10. what leaves the device, and what comes back ────────────────────
// The durable copy mirrors CLAIMS AND COUNTS, never crumbs, and folds back in
// by union-and-max. The watermark is wall-clock on purpose: it has to survive
// a reload, which a monotonic clock does not.
{
  const st = fakeStore(), c = clock();
  const store = openSurvey({ store: st, now: c.now, stamp: c.wall });
  const kloof = store.roadId('Kloof Nek Road', ...CAPE);
  for (const k of cps('kloof', 3)) store.take(kloof, k, 10);
  const mark = c.wall();                         // everything above is now "already sent"
  const rhodes = store.roadId('Rhodes Drive', ...CAPE);
  store.claim(rhodes, 12);

  const all = store.dump(0);
  check('a full dump carries every road with progress',
    Object.keys(all).length === 2, Object.keys(all));
  check('…as counts and claims, and NOT as crumbs',
    all[kloof].k === undefined && all[kloof].g === 3 && all[kloof].t === 10, all[kloof]);
  check('…with the claim time on the claimed one', all[rhodes].c > 0, all[rhodes]);

  const since = store.dump(mark);
  check('a later dump carries only what changed since',
    Object.keys(since).length === 1 && !!since[rhodes], Object.keys(since));

  // …and the other device's half arrives.
  const n = store.merge({
    [kloof]: { g: 9, t: 10 },                             // it drove more of it
    'Ou Kaapse Weg@-34,18': { g: 40, t: 40, c: 1700000000000 },  // and claimed one we have never seen
    [rhodes]: { g: 1, t: 2 },                             // …and knows less about this one
  });
  check('a merge reports what it changed', n === 2, n);
  check('a road driven further elsewhere goes up', store.rec.get(kloof).g === 9, store.rec.get(kloof));
  check('…a road claimed elsewhere arrives claimed',
    store.claimed('Ou Kaapse Weg@-34,18'), store.stats().top);
  check('…and a device that knows less cannot pull anything down',
    store.rec.get(rhodes).g === 12 && store.rec.get(rhodes).done > 0, store.rec.get(rhodes));
  check('…and a road claimed elsewhere answers for its checkpoints here',
    store.took('Ou Kaapse Weg@-34,18', 'never-collected'), null);

  // A claim's TIME is latched to the first one that actually happened.
  store.merge({ [rhodes]: { g: 12, t: 12, c: 1600000000000 } });
  check('an earlier claim time wins', store.rec.get(rhodes).done === 1600000000000, store.rec.get(rhodes));
  check('a merge is worth writing down', store.dirty(), store.dirty());
}

// ── 11. no store at all (private mode, blocked storage) ────────────────
{
  const s = openSurvey({ store: null, now: clock().now, stamp: () => 1 });
  const main = s.roadId('Main Street', ...CAPE);
  s.take(main, 'm:0', 4);
  s.flush();
  check('the game plays with nowhere to save', s.took(main, 'm:0'), null);
}

rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exitCode = bad ? 1 : 0;
