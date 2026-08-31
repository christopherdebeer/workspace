/**
 * DOES THE BROWSER START WITH THE RADIO OFF?
 *
 *   node cells/drive/devtools/offline-shell.test.mjs
 *
 * An installed PWA with no service worker is a bookmark: with no network the
 * browser shows its own error page and not one line of this game runs. Both
 * native shells carry the bundle inside the application and have never had
 * that problem, which is exactly why it went unnoticed for so long — the
 * offline case was only ever tried where it already worked.
 *
 * The main harness cannot answer this. It relays every https request through
 * curl, which is what makes it structurally blind to CSP, and a service worker
 * lives on the far side of both. So this stands up its own server instead: the
 * same shell out of index.ts, the same bundle, the same `web/` assets, and the
 * same `web/sw.js` with the build stamp the cell would substitute. It runs on
 * 127.0.0.1, which is a secure context, which is what makes registration legal
 * at all.
 *
 * Then it goes offline for real — Playwright's own switch, not a route filter
 * — and reloads. What has to survive is the page, the bundle, and enough of
 * the game to have executed: an empty world is expected here and is somebody
 * else's test (`offline-ground.test.mjs`).
 */
import { serveShell, openShell } from './shell-server.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const srv = serveShell('offline-shell');
await srv.ready;
const b = await openShell(srv.origin);
const { page, ctx } = b;

try {
  // Registration waits for `load`, and the install then precaches the whole
  // shell before it activates.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 });
  check('a worker took control of the page', true, null);
  check('and it precached the shell', srv.served.has('/app.js') && srv.served.has('/sw.js'), [...srv.served]);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    return { names, keys: (await cache.keys()).map((r) => new URL(r.url).pathname).sort() };
  });
  check('the cache is named for the build', cached.names.some((n) => n.startsWith('drive-shell-')), cached);
  check('the page is in it', cached.keys.includes('/'), cached);
  check('the bundle is in it', cached.keys.includes('/app.js'), cached);
  check('the manifest and every icon are in it',
    cached.keys.filter((k) => k.startsWith('/icons/')).length === 5
    && cached.keys.includes('/manifest.webmanifest'), cached);

  // ── the radio goes off ──
  await ctx.setOffline(true);
  srv.served.clear();
  await page.reload({ waitUntil: 'domcontentloaded' });

  check('the page came back with no network', await page.title() === 'drive — the real world, top down',
    await page.title());
  check('the server was not asked for any of it', srv.served.size === 0, [...srv.served]);
  check('the canvas is there', await page.$('#scene') !== null, null);
  // The bundle did not merely load, it RAN: these are set by main.ts.
  const ran = await page.waitForFunction(() => typeof window.__demsrc === 'function', null, { timeout: 60000 })
    .then(() => true).catch(() => false);
  check('and the game itself is running', ran, null);
} finally {
  await b.close();
  srv.close();
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
