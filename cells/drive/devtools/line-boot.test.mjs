/**
 * THE LINE, THROUGH A REAL BOOT.
 *
 *   node cells/drive/devtools/line-boot.test.mjs
 *
 * Campaign mode's contract, which is three promises and a refusal:
 *
 *   1. the mode RESUMES — `&line=1` rides the URL like every other piece of
 *      drive state, and the CONTINUE record (position, metres, begun-when)
 *      survives a reload;
 *   2. the legs ARM THEMSELVES in order, from the marks — a leg done stays
 *      done, so the campaign always knows which leg is open;
 *   3. free drive is UNTOUCHED — the same boot without the flag is the same
 *      game it always was, teleport included;
 *   4. and the refusal: ON the line, a double tap is not travel. A ranger's
 *      position is the one thing a run is about.
 *
 * Runs at the Cape test area, not Paris — the mechanics under test are
 * identical anywhere, and the harness cannot stream the banlieue. The Paris
 * boot itself is checked LIVE against the deployed cell, where the tile cache
 * and the Cover's OSM exclusion are real.
 */
import { openDrive, report } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'line-'));
const out = join(dir, 'index.cjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node', '--format=cjs',
  '--external:@aws-sdk/*', `--outfile=${out}`], { stdio: 'pipe' });
const { handler } = await import(out);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const serveCampaign = async (page) => {
  await page.route(/\/~\/campaign\//, async (route) => {
    const v = new URL(route.request().url()).pathname.split('/').pop();
    const r = await handler({ rawPath: `/~/campaign/${v}`, requestContext: { http: { method: 'GET' } } });
    if (r.statusCode !== 200) return route.fulfill({ status: r.statusCode, body: '{}', contentType: 'application/json' });
    return route.fulfill({ status: 200, body: gunzipSync(Buffer.from(r.body, 'base64')).toString(), contentType: 'application/json' });
  });
};

// A run already in progress: 12.3km on the clock, saved at this very spot.
const d = await openDrive({
  spot: 'lat=-34.08716&lon=18.42083&h=290&cam=top&wx=clear&line=1',
  tag: 'line', settle: 9000, route: serveCampaign,
  init: `localStorage.setItem('drive.line.v1', JSON.stringify({
    lat: -34.08716, lon: 18.42083, h: 290, odo: 12300, begunAt: 1700000000000, at: 1700000000000 }))`,
});

// ── the mode ──
const ln = await d.page.evaluate(() => window.__line());
check('the flag puts the boot on the line', ln.on === true, ln);
check('…resuming the run\'s metres, not zeroing them', ln.odo === 12300, ln.odo);
check('…and the first leg armed itself from the marks', ln.leg?.id === 'line-01', ln);
check('no cover built here — Paris\'s shell is not the Cape\'s business', ln.covers === 0, ln.covers);

// ── the world on the line ──
// Outside a Cover nothing has been kept up since the Leaving: every building
// that streams takes the ruin path. The HUD carries the Service's instruments
// and nothing else. And the chart shows what the survey has recorded — a
// fresh boot has recorded nothing, so every named road that streamed is HELD
// off the map, still physically there to drive. The world streams on its own
// clock (a cold relay cache takes minutes), so wait for the chart to actually
// MEET a road before asking what it did with it — the settle is not the world.
await d.page.waitForFunction(() => window.__line().world.chartHeld > 0, null, { timeout: 180000 })
  .catch(() => null);
const w = (await d.page.evaluate(() => window.__line())).world;
check('every building that streamed here is a ruin', w.intact === 0, w);
check('the HUD carries only the Service\'s kinds — and does carry them',
  w.hud.length > 0
  && w.hud.every((k) => ['mission', 'station', 'rig', 'drone', 'peak'].includes(k)), w.hud);
check('the chart holds back every unsurveyed road', w.chartHeld > 0, w);

// ── the refusal ──
// The double tap is synthesized IN PAGE: the harness renders at a few fps, so
// two protocol round-trip taps cannot reliably land inside the 450ms window a
// real thumb hits without thinking.
const dbltap = (page) => page.evaluate(() => {
  const cv = document.querySelector('#scene');
  const ev = (type, id) => new PointerEvent(type, {
    pointerId: id, clientX: 195, clientY: 260, bubbles: true, isPrimary: true, pointerType: 'touch' });
  cv.dispatchEvent(ev('pointerdown', 7)); cv.dispatchEvent(ev('pointerup', 7));
  cv.dispatchEvent(ev('pointerdown', 8)); cv.dispatchEvent(ev('pointerup', 8));
});
const before = await d.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
await dbltap(d.page);
await d.page.waitForTimeout(800);
const after = await d.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
check('a double tap does not teleport a ranger',
  Math.hypot(after.x - before.x, after.z - before.z) < 8, { before, after });
check('…and the refusal says so, once',
  await d.page.evaluate(() => /THE LINE IS DRIVEN/.test(document.querySelector('#ov-toast')?.textContent ?? '')), null);

// ── the menu ──
const hub = await d.page.evaluate(() => {
  window.__menutab(0);
  return [...document.querySelectorAll('#menu .m-navrow')].map((r) => r.querySelector('.name')?.textContent);
});
check('THE LINE leads the hub stack', hub[0] === 'THE LINE', hub);
const screen = await d.page.evaluate(() => {
  window.__menutab(5);
  return document.querySelector('#menu')?.textContent ?? '';
});
check('the line screen carries the run and its legs',
  /PARIS – DAKAR/.test(screen) && /LEGS/.test(screen) && /THE LINE · LEG 1/.test(screen), screen.slice(0, 200));
await d.page.evaluate(() => window.__menutab(null));

// ── the resume ──
await d.page.reload({ waitUntil: 'load' });
await d.page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 200000 });
await d.page.waitForTimeout(4000);
await d.page.evaluate(() => window.__menutab(null));
const back = await d.page.evaluate(() => ({ ln: window.__line(), url: location.search }));
check('a reload stays on the line — the flag rides the URL', back.ln.on === true, back.url);
check('…with the run\'s record intact', back.ln.odo >= 12300 && back.ln.leg?.id === 'line-01', back.ln);

// ── free drive untouched ──
const f = await openDrive({
  spot: 'lat=-34.08716&lon=18.42083&h=290&cam=top&wx=clear',
  tag: 'free', settle: 9000, route: serveCampaign,
});
const fbefore = await f.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
await dbltap(f.page);
await f.page.waitForTimeout(800);
const fafter = await f.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z, ln: window.__line() }));
check('off the line the same double tap still travels',
  Math.hypot(fafter.x - fbefore.x, fafter.z - fbefore.z) > 20, { fbefore, fafter });
check('…and free drive is not on the line', fafter.ln.on === false, fafter.ln.on);
// The same tiles, the other posture: free drive charts every road as it
// streams and keeps its intact stock — the campaign's world is a LENS, not a
// migration. Wait for the same world the line boot saw: if the line boot's
// tiles carried buildings, the free boot's will too, on their own clock.
if (w.intact + w.ruin > 0) {
  await f.page.waitForFunction(() =>
    window.__line().world.intact + window.__line().world.ruin > 0, null, { timeout: 180000 })
    .catch(() => null);
}
const fw = (await f.page.evaluate(() => window.__line())).world;
check('free drive holds nothing back from the chart', fw.chartHeld === 0, fw);
check('…and what ruined on the line was standing off it',
  (w.ruin > 0) === (fw.intact + fw.ruin > 0), { line: w, free: fw });

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
report(f.errors);
await d.close();
await f.close();
process.exitCode = bad ? 1 : 0;
