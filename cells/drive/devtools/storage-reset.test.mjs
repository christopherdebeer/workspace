/**
 * THE SETTINGS SCREEN HAS TO BE ABLE TO GIVE THE DEVICE BACK.
 *
 *   node cells/drive/devtools/storage-reset.test.mjs
 *
 * Drive keeps things in four places — localStorage, sessionStorage, two
 * IndexedDB databases, and the Cache Storage the service worker precaches into
 * — and every one of them fails SILENTLY by design: they are best-effort, so
 * every path swallows its error. A clear that misses a store reports success
 * exactly as loudly as one that works. The only way to know is to look after.
 *
 * It runs on the loopback shell server rather than the main harness, for two
 * reasons that both matter. The harness serves no `/sw.js` and relays through
 * curl, so it has NO worker and NO cache to drop — precisely half of what is
 * being tested here would be untestable. And it fetches real ground, so a run
 * costs five minutes; this one costs seconds because the storage it clears is
 * seeded rather than driven.
 *
 * Seeding is not a shortcut around the real thing. What the reset has to do is
 * remove OUR keys, OUR databases and OUR caches and leave a neighbour's alone,
 * and a planted neighbour proves that far better than a real drive would —
 * a browser cell can share an origin with every other cell on its host, so a
 * `localStorage.clear()` here would be somebody else's lost save.
 *
 * The buttons are driven by the words on them: a reset that is not wired to
 * anything is not a reset, and a label this test cannot find is one a player
 * cannot find either.
 */
import { serveShell, openShell } from './shell-server.mjs';

const T_SYSTEM = 4;

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const srv = serveShell('storage-reset');
await srv.ready;
const b = await openShell(srv.origin);
const { page } = b;

/** Tap a settings button by the words on it. */
const tap = (label) => page.evaluate((want) => {
  const el = [...document.querySelectorAll('#menu .m-btn')]
    .find((x) => x.querySelector('.lab')?.textContent === want);
  if (!el) return false;
  el.click();
  return true;
}, label);

try {
  // The bundle has to be running before anything can be asked of it. The world
  // never arrives here — every `/~/` route 404s — so this waits on the probes,
  // not on the boot overlay.
  await page.waitForFunction(() => typeof window.__storage === 'function', null, { timeout: 60000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 });

  // ── seed: ours, and a neighbour's ──
  const seeded = await page.evaluate(async () => {
    localStorage.setItem('drive.survey.v2', '{"seeded":true}');
    localStorage.setItem('drive.dials', '{"seeded":true}');
    localStorage.setItem('drive.line.v1', '{"seeded":true}');
    sessionStorage.setItem('drive.attract.go', 'seeded');
    // A NEIGHBOUR on the same origin. Nothing drive does may touch this.
    localStorage.setItem('notes.draft', 'someone else’s work');
    await caches.open('notes-shell-v1').then((c) => c.put('/notes', new Response('x')));
    await new Promise((done) => {
      const q = indexedDB.open('notes-cache', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('kv');
      q.onsuccess = () => { q.result.close(); done(); };
      q.onerror = () => done();
    });
    // Ground in the world cache, through the same database the game uses.
    await new Promise((done) => {
      const q = indexedDB.open('drive-cache', 2);
      q.onsuccess = () => {
        const db = q.result;
        const tx = db.transaction(['osm', 'raster'], 'readwrite');
        // A MEGABYTE A TILE, because that is what a real one weighs and a
        // delete of four kilobytes proves nothing about a delete of a cache.
        // The database being dropped in the second half holds real data, has
        // just been written to, and is being deleted out from under a live
        // handle — a toy payload would skip all three.
        for (let i = 0; i < 8; i++) {
          tx.objectStore('osm').put({ ts: Date.now(), ways: [] }, `5/16/1/${i}`);
          tx.objectStore('raster').put(
            { ts: Date.now(), type: 'image/png', bytes: new ArrayBuffer(1024 * 1024), size: 1024 * 1024 },
            `https://tiles.test/${i}.webp`);
        }
        tx.oncomplete = () => { db.close(); done(); };
        tx.onerror = () => { db.close(); done(); };
      };
      q.onerror = () => done();
    });
    return true;
  });
  check('the device was seeded', seeded, null);

  await page.evaluate(() => window.__menutab(4), T_SYSTEM);
  const before = await page.evaluate(() => window.__storage());
  check('ours is on the device', before.local.length >= 3 && before.session.length === 1, before);
  check('and so is the world cache', before.ways === 8 && before.tiles === 8, before);
  check('and the app shell is cached', before.caches.some((c) => c.startsWith('drive-shell-')), before);
  check('and a worker is registered', before.worker === 1, before);

  // ── the cheap button: the world cache, and nothing else ──
  check('CLEAR THE WORLD CACHE is on the settings screen', await tap('CLEAR THE WORLD CACHE'));
  await page.waitForFunction(async () => {
    const s = await window.__storage();
    return s.ways === 0 && s.tiles === 0;
  }, null, { timeout: 30000, polling: 100 });
  const cleared = await page.evaluate(() => window.__storage());
  check('it emptied the world cache', cleared.ways === 0 && cleared.tiles === 0, cleared);
  check('and left every setting alone', cleared.local.length === before.local.length, cleared);
  check('and left the offline copy alone',
    cleared.caches.some((c) => c.startsWith('drive-shell-')) && cleared.worker === 1, cleared);
  // Emptying the STORES rather than dropping the database is what keeps the
  // handle live — a session that had to reload to free space would be a worse
  // button than none.
  check('and the game is still running',
    await page.evaluate(() => typeof window.__demsrc === 'function'), null);

  // ── the whole device ──
  check('RESET THIS DEVICE is on the settings screen', await tap('RESET THIS DEVICE'));
  const armed = await page.evaluate(() => window.__storage());
  check('one tap only arms it', armed.local.length === cleared.local.length, armed);
  check('and the second tap is offered', await tap('TAP AGAIN TO CLEAR EVERYTHING'));

  // The reset reloads 1.6s after it reports, so this reads the state while it
  // stands rather than waiting for a line that a navigation is about to take.
  await page.waitForFunction(async () => (await window.__storage()).local.length === 1,
    null, { timeout: 20000, polling: 50 });
  const wiped = await page.evaluate(() => window.__storage());
  check('every local key of ours is gone', wiped.local.length === 0, wiped.local);
  check('every session key of ours is gone', wiped.session.length === 0, wiped.session);
  check('every cache of ours is gone',
    !wiped.caches.some((c) => c.startsWith('drive-shell-')), wiped.caches);
  check('the worker is unregistered', wiped.worker === 0, wiped);

  // THE TRAP THIS TEST EXISTS FOR. `pagehide` flushes the survey, the marks and
  // the docket to localStorage — which is how a phone ending a session keeps
  // its last few hundred metres, and also how a reset quietly undoes itself,
  // because the reload it schedules IS a pagehide.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const afterHide = await page.evaluate(() => window.__storage());
  check('and an unload does not write them back', afterHide.local.length === 0, afterHide.local);

  // ── the neighbour ──
  const neighbour = await page.evaluate(async () => ({
    key: localStorage.getItem('notes.draft'),
    cache: (await caches.keys()).includes('notes-shell-v1'),
    db: (await indexedDB.databases()).map((d) => d.name).includes('notes-cache'),
  }));
  check("a neighbouring cell's key survived", neighbour.key !== null, neighbour);
  check("a neighbouring cell's cache survived", neighbour.cache, neighbour);
  check("a neighbouring cell's database survived", neighbour.db, neighbour);
} finally {
  await b.close();
  srv.close();
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
