/**
 * The lab's headless harness (Mistwood by default; EXPERIMENT=<id> for another): build the
 * client, serve the experiment's page as the cell would, open it in
 * Chromium (software GL — slow, but the same shaders), and drive it through its flags.
 *
 *   import { withWood } from './harness.mjs';
 *   await withWood(async (wood) => {
 *     const page = await wood.open('seed=moss-ford-7&fixed&hour=11');
 *     await wood.go(page, { x: 120, y: -40, heading: 90 });   // same page, no reload
 *     await wood.settle(page);                                  // grown and baked
 *     await wood.shot(page, 'there');                           // devtools/out/there.png
 *   });
 *
 * Everything a test needs is in the page: `window.__mistwood` (what the wood reports),
 * `window.__flags` (flag / setFlag / setFlags, as the overlay uses), `window.__wood()`.
 * Headless frames are slow (and dt is capped per frame), so the game clock runs slow: walk
 * by setting x, y rather than by waiting, and wait for `settled` rather than for time.
 */
import http from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
export const CELL = join(here, '..');
export const OUT = process.env.MISTWOOD_OUT ?? join(here, 'out');

/** Bundle a TypeScript entry for Node (for the pure-logic tools: deer, species). */
export async function bundleNode(entry) {
  const outfile = join(tmpdir(), `mistwood-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  await build({ entryPoints: [entry], bundle: true, platform: 'node', outfile, logLevel: 'warning' });
  return outfile;
}

/** Build the client and serve it, open a browser; run `fn`; clean up. */
export async function withWood(fn, { width = 390, height = 844 } = {}) {
  mkdirSync(OUT, { recursive: true });
  const built = await build({ entryPoints: [join(CELL, 'client/main.ts')], bundle: true, format: 'iife', target: 'es2020', write: false, logLevel: 'warning' });
  const app = built.outputFiles[0].text;
  // (the lab's page for the experiment, its bundle served from here)
  const exp = process.env.EXPERIMENT ?? 'mistwood';
  const html = readFileSync(join(CELL, `static/${exp}.html`), 'utf8').replace('{{app}}', '/app.js').replace(/\{\{assets\}\}/g, '/assets/');
  const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end(app);
    }
    if (u.pathname.startsWith('/assets/')) {
      // (the experiment's assets, as the cell serves them from static/<id>/)
      const f = join(CELL, `static/${exp}`, u.pathname.slice(8));
      if (existsSync(f)) { res.writeHead(200, { 'content-type': TYPES[f.split('.').pop()] ?? 'application/octet-stream' }); return res.end(readFileSync(f)); }
    }
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(html);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch({
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const wood = {
    base,
    browser,
    /** A page on the wood with these flags (a query string, without the `?`). Errors are collected. */
    async open(query = '', size = {}) {
      const page = await browser.newPage({ viewport: { width: size.width ?? width, height: size.height ?? height }, deviceScaleFactor: 1, hasTouch: !!size.hasTouch });
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && page.errors.push(m.text()));
      await page.goto(base + (query ? `?${query}` : ''), { timeout: 120000 });
      await page.waitForFunction(() => window.__mistwood, null, { timeout: 120000 });
      return page;
    },
    state: (page) => page.evaluate(() => window.__mistwood),
    /** Set flags in the page (live ones apply at once: x, y, heading, seed, hour, fog …). */
    go: (page, flags) => page.evaluate((f) => window.__flags.setFlags(f), flags),
    /** Wait until everything in view is grown and baked (or the time runs out). */
    async settle(page, ms = 240000) {
      const t0 = Date.now();
      // (a frame or two for a change to be seen, then until it says so)
      await page.waitForTimeout(1500);
      while (Date.now() - t0 < ms) {
        if ((await page.evaluate(() => window.__mistwood))?.settled) return true;
        await page.waitForTimeout(1000);
      }
      return false;
    },
    /** A screenshot to devtools/out/<name>.png; returns the path. */
    async shot(page, name) {
      const path = join(OUT, `${name}.png`);
      // (software rendering can take a while over a heavy frame)
      await page.screenshot({ path, timeout: 300000 });
      return path;
    },
    /** Images side by side (each `height` px tall) in one PNG — for looking, or for a reference beside a render. */
    async montage(paths, name, { height: h = 640, labels = [] } = {}) {
      const page = await browser.newPage({ viewport: { width: 400, height: h + 24 } });
      const imgs = paths.map((p, i) => `<figure><img src="data:image/${p.endsWith('.jpg') || p.endsWith('.jpeg') ? 'jpeg' : 'png'};base64,${readFileSync(p).toString('base64')}"><figcaption>${labels[i] ?? ''}</figcaption></figure>`).join('');
      await page.setContent(`<style>body{margin:0;display:flex;background:#222;font:12px monospace;color:#ccc}figure{margin:0}img{height:${h}px;display:block}figcaption{padding:4px}</style>${imgs}`);
      await page.waitForTimeout(300);
      const width = await page.evaluate(() => document.body.scrollWidth);
      await page.setViewportSize({ width, height: h + 24 });
      const path = join(OUT, `${name}.png`);
      // (software rendering can take a while over a heavy frame)
      await page.screenshot({ path, timeout: 300000 });
      await page.close();
      return path;
    },
  };
  try {
    return await fn(wood);
  } finally {
    await browser.close();
    srv.close();
  }
}

/** A tiny assertion log for the tests: prints ok/FAIL, exits 1 at the end on any failure. */
export function checks() {
  const fails = [];
  return {
    ok(what, cond, saw) {
      console.log(`${cond ? 'ok  ' : 'FAIL'}  ${what}${cond ? '' : ` — saw ${JSON.stringify(saw)}`}`);
      if (!cond) fails.push(what);
    },
    done() {
      if (fails.length) {
        console.log(`\n${fails.length} failed`);
        process.exit(1);
      }
      console.log('\nall passed');
    },
  };
}
