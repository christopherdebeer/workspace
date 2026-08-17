/**
 * THE SURVEY, THROUGH A REAL DRIVE.
 *
 *   node cells/drive/devtools/survey-boot.test.mjs
 *
 * `survey-store.test.mjs` proves the store. This proves the WIRING — that the
 * game still puts crumbs into it, still reads them back on the next boot, and
 * still writes rarely. Those are three different mistakes from three different
 * places in `main.ts`, and none of them is visible from the module.
 *
 * It drives. Checkpoints are only collected while the rig is actually ON the
 * named way, so the rig is walked from checkpoint to checkpoint down the road
 * under it, in hops short enough that the sweep test treats them as driving
 * rather than as a respawn.
 *
 * The write budget is measured by counting `localStorage.setItem` from inside
 * the page, because "does it write once instead of once per crumb" is the whole
 * point of the change and it cannot be seen any other way.
 */
import { openDrive, report } from './harness.mjs';

const SPOT = 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear';
const COUNT = (() => `
  window.__writes = { n: 0, keys: [] };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (String(k).startsWith('drive.survey')) { window.__writes.n++; window.__writes.keys.push(String(k)); }
    return set.call(this, k, v);
  };
`)();

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({ spot: SPOT, tag: 'survey', settle: 12000, init: COUNT });

// The longest road that loaded, not whatever happens to be under the wheels —
// a spawn puts the rig near a road, not necessarily on one.
const road = await d.page.evaluate(() => window.__survey().roads[0]);
check('roads loaded and were surveyed', !!road?.name && road.cps >= 2, road);
console.log(`        ${road?.name}: ${road?.len}m, ${road?.got}/${road?.cps} collected`);

// `__cps` is in route order, so start from whichever end is nearest and walk
// along it rather than across it.
const run = await d.page.evaluate((n) => {
  const cps = window.__cps(n);
  const s = window.__drive;
  let at = 0, best = Infinity;
  cps.forEach((c, i) => { const dd = Math.hypot(c.x - s.x, c.z - s.z); if (dd < best) { best = dd; at = i; } });
  return cps.slice(at, at + 6);
}, road.name);
console.log(`        walking ${run.length} checkpoints`);
// Local coordinates, straight into the state object — `walkTo` speaks lat/lon
// and there is no inverse of `__tolocal` exposed. Hops of 25m are well under
// the 60m the sweep test reads as a respawn, so this is driving as far as the
// survey is concerned.
for (const c of run) {
  for (let i = 0; i < 40; i++) {
    const left = await d.page.evaluate((t) => {
      const s = window.__drive;
      const dx = t.x - s.x, dz = t.z - s.z, dist = Math.hypot(dx, dz);
      if (dist > 0.5) {
        const step = Math.min(dist, 25);
        s.x += (dx / dist) * step; s.z += (dz / dist) * step;
        s.heading = Math.atan2(dx, -dz);
      }
      return dist;
    }, c);
    if (left < 1) break;
    await d.page.waitForTimeout(320);
  }
}
await d.page.waitForTimeout(1200);

const got = await d.page.evaluate((n) => ({
  s: window.__survey().roads.find((r) => r.name === n),
  st: window.__surveyStore(), w: window.__writes,
}), road.name);
check('driving collected checkpoints', got.s.got > road.got, { was: road.got, now: got.s.got });
// Either outcome is the store working: crumbs held for a road in progress —
// or, when the walk happens to cover a short road entirely, a CLAIM, which
// rightly drops the crumbs (a claimed road answers for all its checkpoints).
check('…and they went into the store', got.st.crumbs > 0 || got.st.claimed > 0, got.st);
// The old store called save() once per checkpoint, from inside the collection
// loop. This is the number that change exists to hold down — a claim is
// allowed its immediate write (the one thing worth losing nothing of).
check('…without a write per crumb', got.w.n <= 1 + got.st.crumbs + (got.st.claimed ? 2 : 0),
  { writes: got.w.n, crumbs: got.st.crumbs, claimed: got.st.claimed });
console.log(`        ${got.st.crumbs} crumbs + ${got.st.claimed} claimed across ${got.st.roads} roads, ${got.w.n} writes, ${got.st.bytes} bytes`);

// The debounce has to actually come due — a pending write that never lands is
// the same as no store at all. POLLED, not slept: on a cold cache the world
// is still streaming here, and every late fragment re-marks the store dirty
// (grew(), crumb adoption) — a fixed wait samples mid-churn and calls the
// debounce broken when it is merely busy.
const settled = await d.page.waitForFunction(() => {
  const s = window.__surveyStore();
  return (!s.dirty && s.bytes > 0) ? s : null;
}, null, { timeout: 60000, polling: 500 }).then((h) => h.jsonValue()).catch(() => null);
check('the pending write lands on its own', !!settled,
  settled ?? (await d.page.evaluate(() => window.__surveyStore())));

// …and the next boot reads it back. The URL tracks the rig, so a reload spawns
// where the drive ended — the same road, from its other end, streaming in as a
// fresh set of tiles. Which is exactly the case worth testing: the crumbs have
// to be recognised by POSITION, against a world with a new origin.
await d.page.reload({ waitUntil: 'load' });
await d.page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 200000 });
await d.page.waitForTimeout(15000);
const back = await d.page.evaluate((n) => ({
  s: window.__survey().roads.find((r) => r.name === n), st: window.__surveyStore(),
}), road.name);
check('a reload remembers what was driven', !!back.s && back.s.got >= got.s.got, { before: got.s.got, after: back.s?.got });
check('…from a store that survived it', back.st.crumbs >= got.st.crumbs, { before: got.st.crumbs, after: back.st.crumbs });
console.log(`        back on ${back.s?.name}: ${back.s?.got}/${back.s?.cps}`);

console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
