/**
 * THINGS THAT HAPPENED ONCE — the marks store, on its own.
 *
 *   node cells/drive/devtools/marks.test.mjs
 *
 * A mark is an event that latches: a mission completed, a station woken. The
 * record is WHEN it first happened, and everything here follows from that one
 * sentence — a second occurrence cannot move the moment later, a merge can
 * only move it earlier (the other device's truth that it happened first), and
 * a mark can never be unset. The failure this store exists to prevent is the
 * campaign's: a completed leg that quietly un-completes on reload.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'marks-'));
const built = join(tmp, 'marks.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/marks.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { openMarks } = await import(pathToFileURL(built).href);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
function fakeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    writes: 0, full: false,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (this.full) throw new Error('quota'); this.writes++; m.set(k, v); },
    removeItem(k) { m.delete(k); },
    raw: m,
  };
}
function clock() {
  const c = { t: 1000, stamp: 1_700_000_000_000 };
  c.now = () => c.t;
  c.wall = () => c.stamp++;
  return c;
}

// ── latching ───────────────────────────────────────────────────────────
{
  const st = fakeStore(), c = clock();
  const mk = openMarks({ store: st, now: c.now, stamp: c.wall });
  check('nothing has happened yet', !mk.has('m', 'paris-leg-1') && mk.at('s', 'ST-01') === 0, null);
  mk.set('m', 'paris-leg-1');
  const first = mk.at('m', 'paris-leg-1');
  check('a mark records its moment', first > 0, first);
  mk.set('m', 'paris-leg-1');
  check('doing it again does not move the moment', mk.at('m', 'paris-leg-1') === first, mk.at('m', 'paris-leg-1'));
  mk.flush();
  const back = openMarks({ store: st, now: c.now, stamp: c.wall });
  check('a reload remembers, at the same moment', back.at('m', 'paris-leg-1') === first, back.at('m', 'paris-leg-1'));
  check('…and kinds do not bleed', !back.has('s', 'paris-leg-1'), null);
}

// ── the write pattern ──────────────────────────────────────────────────
{
  const st = fakeStore(), c = clock();
  const mk = openMarks({ store: st, now: c.now, stamp: c.wall });
  mk.set('s', 'ST-01'); mk.set('s', 'ST-02'); mk.set('m', 'leg-1');
  mk.tick(c.now());
  check('a burst of marks costs nothing yet', st.writes === 0, st.writes);
  c.t += 2000;
  mk.tick(c.now());
  check('…and one write when the debounce comes due', st.writes === 1, st.writes);
  check('…leaving nothing pending', !mk.dirty(), mk.dirty());
}

// ── the merge: union and MIN ───────────────────────────────────────────
// Counts go up; latched events go EARLIER. The truth about a thing that can
// only happen once is the first time it happened, whichever device saw it.
{
  const st = fakeStore(), c = clock();
  const mk = openMarks({ store: st, now: c.now, stamp: c.wall });
  mk.set('m', 'leg-1', 5000);
  let n = mk.merge({ m: { 'leg-1': 3000, 'leg-2': 7000 }, s: { 'ST-09': 4000 } });
  check('a merge unions what it never saw', n === 3 && mk.has('m', 'leg-2') && mk.has('s', 'ST-09'), n);
  check('…and an earlier moment wins', mk.at('m', 'leg-1') === 3000, mk.at('m', 'leg-1'));
  n = mk.merge({ m: { 'leg-1': 9000 } });
  check('…while a later one changes nothing', n === 0 && mk.at('m', 'leg-1') === 3000, mk.at('m', 'leg-1'));
  check('a merge is worth writing down', mk.dirty(), mk.dirty());
  n = mk.merge({ m: { '': 1, junk: NaN, neg: -5 } });
  check('junk cannot latch', n === 0, n);
}

// ── the sync watermark ─────────────────────────────────────────────────
{
  const st = fakeStore(), c = clock();
  const mk = openMarks({ store: st, now: c.now, stamp: c.wall });
  mk.set('m', 'leg-1');
  const mark = c.wall();
  mk.set('s', 'ST-03');
  const all = mk.dump(0), since = mk.dump(mark);
  check('a full dump carries everything', !!all.m?.['leg-1'] && !!all.s?.['ST-03'], all);
  check('a later dump carries only what changed', !since.m && !!since.s?.['ST-03'], since);
}

// ── the reset: forgetting is deliberate, immediate, and durable ────────
{
  const st = fakeStore(), c = clock();
  const mk = openMarks({ store: st, now: c.now, stamp: c.wall });
  mk.set('m', 'line-01'); mk.set('s', 'pd-01'); mk.flush();
  const writesBefore = st.writes;
  mk.reset();
  check('a reset forgets every mark', mk.count('m') === 0 && mk.count('s') === 0, [mk.count('m'), mk.count('s')]);
  check('…writes through immediately — a reset lost to a crash is worse than none',
    st.writes > writesBefore, st.writes);
  const back = openMarks({ store: st, now: c.now, stamp: c.wall });
  check('…and the next boot finds a clean docket', back.count('m') === 0 && back.count('s') === 0, null);
  // Latching still works afterwards — a reset is a restart, not a scar.
  back.set('m', 'line-01');
  check('the campaign can be earned again', back.has('m', 'line-01'), null);
}

// ── a full disk costs durability, never the drive ──────────────────────
{
  const st = fakeStore(), c = clock();
  const mk = openMarks({ store: st, now: c.now, stamp: c.wall });
  st.full = true;
  let threw = null;
  try { mk.set('m', 'leg-1'); mk.flush(); } catch (e) { threw = String(e); }
  check('a quota error never reaches the game loop', threw === null, threw);
  check('…and the mark still holds in this session', mk.has('m', 'leg-1'), null);
  const none = openMarks({ store: null, now: c.now, stamp: c.wall });
  none.set('s', 'ST-01'); none.flush();
  check('the game plays with nowhere to save', none.has('s', 'ST-01'), null);
}

rmSync(tmp, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exitCode = bad ? 1 : 0;
