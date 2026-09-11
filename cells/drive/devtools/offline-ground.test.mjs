/**
 * THE GROUND HAS TO SURVIVE A RELOAD, AND THEN SURVIVE THE NETWORK GOING AWAY.
 *
 *   node cells/drive/devtools/offline-ground.test.mjs
 *
 * The world arrives through three fetches and, until the raster cache, only
 * ONE of them survived the tab: OSM ways were in IndexedDB, the heightfield and
 * the land cover were not. That produced the worst offline session available —
 * it booted, it drew the menu, it drew the roads you remembered, and there was
 * no planet under them. Both native shells reached that empty world FASTER than
 * the browser did, because they carry the bundle on disk.
 *
 * Two questions, in order, in one browsing context so the origin's storage is
 * the same storage:
 *
 *   1. does a first drive leave the ground on the device?
 *   2. with every source of it unreachable, does the world still come up on
 *      what was left?
 *
 * The sources are blocked rather than the whole network because the page and
 * the bundle come from the harness's own local server, which a blanket offline
 * would also cut. What is under test here is the WORLD DATA; the app shell is
 * `appshell.test.mjs`, statically, because this harness relays every request
 * through curl and cannot see a service worker at all.
 *
 * Chapman's Peak is not an arbitrary spot. Mapterhorn has no tile here below
 * z12, so what actually gets fetched is an ANCESTOR and the resample down to
 * z14 is ours — which is why the cache is keyed on the source URL, and why a
 * refused request has to keep climbing instead of giving up at the level that
 * was refused. Both of those were written because this test failed on them.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const spot = 'lat=-34.09905&lon=18.37835&h=0&cam=chase';
const d = await openDrive({ spot, tag: 'offline-ground' });
try {
  // Cover streams in BEHIND the boot — the overlay lifts on terrain, not on
  // ecology — so a straight read here would measure the wait, not the cache.
  // Twenty tiles rather than one: reloading after the first would be testing a
  // drive that had not happened yet.
  await d.page.waitForFunction(() => window.__cover().tiles > 20, null, { timeout: 90000 });
  // …and the writes are batched and land a second behind. Waiting on the
  // cache's own counter rather than on a timer means this cannot pass for
  // having been lucky about scheduling.
  await d.page.waitForFunction(() => window.__raster().stored > 20, null, { timeout: 60000 });
  const cold = await d.page.evaluate(() => ({
    ...window.__demsrc(), cover: window.__cover().tiles, ...window.__raster(),
  }));
  check('the first drive fetched heights', cold.mth + cold.aws > 0, cold);
  check('the first drive fetched cover', cold.cover > 20, cold);
  check('and the device kept them', cold.stored > 20 && cold.failed === 0, cold);

  // ── every source of ground goes away, and only then does the page reload ──
  // `~/dem/` is in the list because the elevation cutover put the cell in
  // front of the publisher: cutting the two hosts alone now leaves a route
  // that still answers, and the test would prove nothing.
  await d.page.route(/mapterhorn\.com|elevation-tiles-prod|\/~\/dem\/|\/~\/cover\//, (route) => route.abort());
  await d.page.reload();
  await d.page.waitForFunction(
    () => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 120000 });

  // openDrive closes the menu after a boot and a reload puts it back. The
  // streamer does not run behind it, so without this the second session never
  // asks for a cover tile at all and the check below reads `asked: 0` — which
  // is not a cache miss, it is a world that was never wound up.
  await d.page.evaluate(() => window.__menutab(null));

  const warm = await d.page.evaluate(() => window.__demsrc());
  check('the world booted with every elevation host unreachable', true, warm);
  check('its heights came off the disk', warm.disk > 0, warm);
  check('and it asked the network for none of them', warm.mth + warm.aws === warm.disk, warm);

  await d.page.waitForFunction(() => window.__cover().tiles > 0, null, { timeout: 60000 })
    .catch(() => undefined);
  const cover = await d.page.evaluate(() => ({ ...window.__cover(), ...window.__raster() }));
  check('the land cover came off the disk too', cover.tiles > 0, cover);
  check('and nothing stored had to be thrown away', cover.dropped === 0, cover);

  report(d.errors);
} finally {
  await d.close();
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
