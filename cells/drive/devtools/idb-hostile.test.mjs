/**
 * THE WORLD STREAMS WHEN THE CACHE DOES NOT ANSWER.
 *
 *   node cells/drive/devtools/idb-hostile.test.mjs
 *   REV=<sha> node cells/drive/devtools/idb-hostile.test.mjs   # against an older build
 *
 * The tile cache is best-effort — every read is written to answer "not
 * cached" and every caller is written to cope. But the promise that gates it
 * was settled only by `success` and `error`, and `indexedDB.open` has a third
 * outcome: `blocked`, when another tab holds the database. Safari can also
 * simply never call back. Neither had a handler and nothing bounded the wait,
 * so the gate never opened, and loadOsmTile marked each tile `osmLoaded` and
 * then parked on the await forever — nothing retried, because being marked
 * loaded is what stops a retry.
 *
 * Measured on a phone at the Paris aperture: every tile `pending`, inFlight 0,
 * queued 0, retries 0, proxy healthy, and the cell serving that exact tile in
 * half a second. No roads, no buildings, no error, and nothing in the game
 * that could have said so.
 *
 * So the claim under test is not "the cache works". It is that a cache which
 * NEVER ANSWERS costs you the cache and nothing else.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// An open that returns a request and then never fires a single handler —
// which is what a blocked database looks like from the calling code.
const deadIdb = () => {
  window.__idbOpens = 0;
  indexedDB.open = () => {
    window.__idbOpens++;
    return { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null,
      result: null, error: null, addEventListener() {} };
  };
};

const rev = process.env.REV ?? '';
const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON',
  tag: 'idb-hostile',
  init: deadIdb,
  rev,
});

check('the stub was actually reached, so the test is testing something',
  await d.page.evaluate(() => window.__idbOpens > 0), await d.page.evaluate(() => window.__idbOpens));

// Give streaming a generous window: the gate's own bail-out is 3s, and the
// tile still has to be fetched and built after it.
let f = null;
for (let i = 0; i < 30; i++) {
  await d.page.waitForTimeout(1000);
  f = await d.page.evaluate(() => window.__field());
  if ((f.mapKnown ?? 0) > 0 && f.state === 'done') break;
}

check('THE TILE UNDER THE CAR RESOLVED — not stuck pending forever',
  f?.state === 'done', f);
check('…and it carries ways', (f?.ways ?? 0) > 0, f?.ways);
check('the map knows roads', (f?.mapKnown ?? 0) > 0, f?.mapKnown);
check('…and there is road under the wheels to find', (f?.segsNear ?? 0) > 0, f?.segsNear);
// The cache is the thing we gave up, and it should be the ONLY thing: a live
// fetch is `cell` or `mirror`, never `cache`.
check('it came off the wire, since the cache is dead', f?.src !== 'cache', f?.src);

report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED${rev ? ` (rev ${rev})` : ''}` : `all good${rev ? ` (rev ${rev})` : ''}`);
