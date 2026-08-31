/**
 * THE CELL'S OWN SHELL SURFACE, ON A LOOPBACK SERVER.
 *
 * `harness.mjs` is the right tool for the WORLD — it relays every https request
 * through curl with a disk cache, which is what makes driving real ground in a
 * test affordable. It is the wrong tool for anything about the page itself:
 * the relay bypasses CSP, it serves no `/sw.js`, and a service worker is
 * therefore invisible to it. It is also slow, because a cold run really does
 * fetch a planet.
 *
 * This serves the same shell out of `index.ts`, the same bundle, the same
 * `web/` assets and the same worker with the build stamp the cell substitutes
 * — on 127.0.0.1, which is a secure context, which is what makes a worker,
 * `caches` and `storage.estimate()` all legal. Nothing here touches the
 * network, so a boot is seconds and every world route answers 404 on purpose:
 * a test that uses this is asking about the page, not the planet.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CELL = join(HERE, '..');
const ROOT = join(CELL, '../..');
const WORK = process.env.DRIVE_WORK ?? '/tmp/drive-tools';

/** Build the client bundle and stand the shell up. Returns the origin, the
 *  paths that have been asked for since the last `served.clear()`, and a
 *  `close()`. */
export function serveShell(tag = 'shell') {
  const idx = readFileSync(join(CELL, 'index.ts'), 'utf8');
  const shell = `<!doctype html><html>${idx.match(/<head>[\s\S]*?<\/body>/)[0]}</html>`
    .replace(/\$\{[^}]*\}/g, '');
  mkdirSync(WORK, { recursive: true });
  const bundlePath = join(WORK, `${tag}.js`);
  execSync(`npx esbuild ${join(CELL, 'client/main.ts')} --bundle --format=esm --outfile=${bundlePath}`,
    { stdio: 'pipe', cwd: ROOT });
  const bundle = readFileSync(bundlePath);
  // The stamp the cell computes, computed the same way, so the cache name here
  // is the one production would use.
  const stamp = createHash('sha1').update(bundle).digest('hex').slice(0, 12);
  const sw = readFileSync(join(CELL, 'web/sw.js'), 'utf8').replace('__DRIVE_SW_BUILD__', stamp);

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
    // The world, which this server deliberately does not have.
    if (p.startsWith('/~/') || p === '/state') { res.writeHead(404); return res.end('{}'); }
    return send('text/html; charset=utf-8', shell);
  });
  const port = 8900 + Math.floor(Math.random() * 90);
  const ready = new Promise((r) => server.listen(port, '127.0.0.1', r));
  server.unref();
  return {
    origin: `http://127.0.0.1:${port}`,
    served,
    stamp,
    ready,
    close: () => server.close(),
  };
}

/** The same launch the main harness uses: the container's browser is at a fixed
 *  path rather than in Playwright's download directory, and there is no sandbox
 *  to be had. No proxy — everything here is loopback. */
export async function openShell(origin) {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  return { browser, ctx, page, close: () => browser.close() };
}
