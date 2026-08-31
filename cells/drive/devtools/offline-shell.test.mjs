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
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..');
const ROOT = join(CELL, '../..');
const WORK = process.env.DRIVE_WORK ?? '/tmp/drive-tools';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── the cell's surface, reproduced from the cell's own files ──
const idx = readFileSync(join(CELL, 'index.ts'), 'utf8');
const shell = `<!doctype html><html>${idx.match(/<head>[\s\S]*?<\/body>/)[0]}</html>`
  .replace(/\$\{[^}]*\}/g, '');
mkdirSync(WORK, { recursive: true });
const bundlePath = join(WORK, 'offline-shell.js');
execSync(`npx esbuild ${join(CELL, 'client/main.ts')} --bundle --format=esm --outfile=${bundlePath}`,
  { stdio: 'pipe', cwd: ROOT });
const bundle = readFileSync(bundlePath);
// The stamp the cell computes, computed the same way, so the cache name here
// is the one production would use.
const stamp = createHash('sha1').update(bundle).digest('hex').slice(0, 12);
const sw = readFileSync(join(CELL, 'web/sw.js'), 'utf8').replace('__DRIVE_SW_BUILD__', stamp);

const port = 8900 + Math.floor(Math.random() * 90);
const served = new Set();
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  served.add(p);
  const send = (type, body, extra = {}) => {
    res.writeHead(200, { 'content-type': type, ...extra });
    res.end(body);
  };
  if (p === '/app.js') return send('application/javascript', bundle);
  if (p === '/sw.js') return send('application/javascript', sw, { 'cache-control': 'no-cache' });
  if (p === '/manifest.webmanifest') {
    return send('application/manifest+json', readFileSync(join(CELL, 'web/manifest.webmanifest')));
  }
  if (p.startsWith('/icons/')) {
    try { return send('image/png', readFileSync(join(CELL, 'web', p.slice(1)))); }
    catch { res.writeHead(404); return res.end('{}'); }
  }
  // Everything else the cell would serve as world data. Offline is the point
  // of this test, so nothing here needs to be real.
  if (p.startsWith('/~/') || p === '/state') { res.writeHead(404); return res.end('{}'); }
  return send('text/html; charset=utf-8', shell);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
server.unref();

// The same launch the main harness uses: the container's browser lives at a
// fixed path rather than in Playwright's own download directory, and there is
// no sandbox to be had. No proxy — everything this test talks to is on
// 127.0.0.1, and the point of the second half is that it talks to nothing.
const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
});
const ctx = await browser.newContext();
const page = await ctx.newPage();
try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });

  // Registration waits for `load`, and the install then precaches the whole
  // shell before it activates.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 });
  check('a worker took control of the page', true, null);
  check('and it precached the shell', [...served].includes('/app.js') && served.has('/sw.js'), [...served]);

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
  served.clear();
  await page.reload({ waitUntil: 'domcontentloaded' });

  check('the page came back with no network', await page.title() === 'drive — the real world, top down',
    await page.title());
  check('the server was not asked for any of it', served.size === 0, [...served]);
  check('the canvas is there', await page.$('#scene') !== null, null);
  // The bundle did not merely load, it RAN: these are set by main.ts.
  const ran = await page.waitForFunction(() => typeof window.__demsrc === 'function', null, { timeout: 60000 })
    .then(() => true).catch(() => false);
  check('and the game itself is running', ran, null);
} finally {
  await browser.close();
  server.close();
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
