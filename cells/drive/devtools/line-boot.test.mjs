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

// A run already in progress: 12.3km on the clock, saved at this very spot —
// and a SIGNED-IN ranger, because a docket names its ranger: the stored sync
// token is what lets the flag through. (The token is junk; the first sync
// fails quietly and the game does not care — the gate is optimistic by
// design, so an expired token never locks a ranger out at the roadside.)
const d = await openDrive({
  spot: 'lat=-34.08716&lon=18.42083&h=290&cam=top&wx=clear&line=1',
  tag: 'line', settle: 9000, route: serveCampaign,
  init: `localStorage.setItem('drive.line.v1', JSON.stringify({
    lat: -34.08716, lon: 18.42083, h: 290, odo: 12300, begunAt: 1700000000000, at: 1700000000000 }));
    localStorage.setItem('drive.sync.token', 'tok_test');
    localStorage.setItem('drive.marks.v1', JSON.stringify({
      v: 1, m: { 'x-done-elsewhere': 1700000000000 }, s: { 'ct-01': 1700000000000 } }));`,
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
// and nothing else. And the MINIMAP is a driving instrument, not the earned
// map: it strokes every way the stream KNOWS, survey or not, in both postures
// (the survey gate lives on the big chart's overview ink). The world streams
// on its own clock (a cold relay cache takes minutes), so wait for it to
// actually MEET a road before asking — the settle is not the world.
await d.page.waitForFunction(() => window.__line().world.mapKnown > 0, null, { timeout: 180000 })
  .catch(() => null);
const w = (await d.page.evaluate(() => window.__line())).world;
check('every building that streamed here is a ruin', w.intact === 0, w);
check('the HUD carries only the Service\'s kinds — and does carry them',
  w.hud.length > 0
  && w.hud.every((k) => ['mission', 'station', 'rig', 'drone', 'peak'].includes(k)), w.hud);
check('the minimap strokes every way the stream knows, unsurveyed included', w.mapKnown > 0, w);

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
// …and the refusal is a FIELD QUERY now: the tapped spot's pipeline books,
// on screen (the full record goes to the clipboard, which a headless page
// cannot read back — the toast carrying real state is the assertion).
check('…and it answers with the field books',
  await d.page.evaluate(() => /ELEV (OK|VOID)/.test(document.querySelector('#ov-toast')?.textContent ?? '')
    && /T16 \d+·\d+/.test(document.querySelector('#ov-toast')?.textContent ?? '')),
  await d.page.evaluate(() => document.querySelector('#ov-toast')?.textContent));

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

// ── the reset ──
// Hand the docket back, from SETTINGS, with the marks this boot carried in:
// two taps (the first only arms), then the game wipes the run and the marks
// and reboots off the line at the same spot. The server copy is unreachable
// here (the harness 404s /state) — that is the partial-failure path, and the
// local wipe must happen anyway.
const carried = await d.page.evaluate(() => window.__marks());
check('the boot carried marks to lose', carried.missions === 1 && carried.stations === 1, carried);
// The menu re-renders once on the frame after a tab switch (its signature
// catches up), rebuilding the buttons — at the harness's 2fps that rebuild
// can land BETWEEN two protocol taps and swallow the armed state (on a
// phone it is a 16ms flicker no thumb can beat). Settle first, then both
// taps in ONE evaluate with an in-page pause.
await d.page.evaluate(() => window.__menutab(4));
await d.page.waitForTimeout(1200);
const armed = await d.page.evaluate(async () => {
  const find = (re) => [...document.querySelectorAll('#menu button')]
    .find((b) => re.test(b.textContent ?? ''));
  find(/RESET THE LINE/)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const again = find(/TAP AGAIN TO WIPE/);
  again?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return !!again;
});
check('the first tap arms instead of firing', armed, null);
// The wipe is checked BEFORE the reboot lands: the harness's init script
// re-seeds localStorage on every navigation (that is what init scripts do),
// so the post-reboot page cannot witness its own emptiness here. Durability
// of the wipe across a boot is marks.test's job (write-through), and the
// reboot's own claim — off the line, no armed leg riding the URL — is
// checked after.
// Polled, not slept: on a saturated 2fps page the async wipe can land well
// over a second after the click, and the observation window closes when the
// reboot's navigation fires.
const wipedInTime = await d.page.waitForFunction(() =>
  window.__marks().missions === 0 && window.__marks().stations === 0
  && localStorage.getItem('drive.line.v1') === null,
null, { timeout: 20000, polling: 60 }).then(() => true).catch(() => false);
check('…and the docket is handed back — no run record, no marks', wipedInTime, null);
await d.page.waitForFunction(() =>
  !/line=1/.test(location.search) && document.querySelector('#boot')?.classList.contains('ready'),
null, { timeout: 200000 });
await d.page.waitForTimeout(3000);
await d.page.evaluate(() => window.__menutab(null));
const clean = await d.page.evaluate(() => ({ ln: window.__line(), url: location.search }));
check('the reset reboots off the line, with no leg riding the URL',
  clean.ln.on === false && !new URLSearchParams(clean.url).get('m') && !clean.ln.leg, clean);

// ── free drive untouched — and the gate ──
// The SAME boot, the SAME flag, no token: signed out, `&line=1` is refused
// and this is plain free drive. One boot proves both halves — the gate, and
// that what the gate falls back to still travels.
const f = await openDrive({
  spot: 'lat=-34.08716&lon=18.42083&h=290&cam=top&wx=clear&line=1',
  tag: 'free', settle: 9000, route: serveCampaign,
});
check('signed out, the flag is refused — a docket names its ranger',
  await f.page.evaluate(() => window.__line().on) === false, null);
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
// POLLED, not sampled. The double tap above TRAVELS — the truck lands
// somewhere the world has never streamed, and the ways it charts arrive on the
// network's clock, not on this file's. Sampling here read the instant after a
// teleport and called a working chart empty; measured, the ink is there about
// ten seconds later. A timeout is still a finding, it is just no longer a
// finding about how fast the tiles came back.
await f.page.waitForFunction(() => window.__line().world.mapKnown > 0
  && window.__minimap().ink > 0, null, { timeout: 180000 }).catch(() => null);
const fw = (await f.page.evaluate(() => window.__line())).world;
check('free drive strokes the same known ways', fw.mapKnown > 0, fw);
// The frame that follows the truck: a forced re-anchor must REPLAY its ink,
// not start blank — the regression that mattered was the layer smearing and
// going black once a drive left the spawn's 12km window.
const mm1 = await f.page.evaluate(() => window.__minimap());
check('the minimap layer carries ink', mm1.ink > 0 && mm1.feats > 0, mm1);
const mm2 = await f.page.evaluate(() => window.__minimap(true));
check('a re-anchored frame replays its ink', mm2.ink > 0 && mm2.feats > 0, mm2);
check('…and what ruined on the line was standing off it',
  (w.ruin > 0) === (fw.intact + fw.ruin > 0), { line: w, free: fw });

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
report(f.errors);
await d.close();
await f.close();
process.exitCode = bad ? 1 : 0;
