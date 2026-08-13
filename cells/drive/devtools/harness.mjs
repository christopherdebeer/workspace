/**
 * THE SHARED RIG for every drive tool.
 *
 * Every measurement in this folder needs the same eighty lines before it can
 * ask its first question: bundle the cell, serve it, launch Chromium, and get
 * the world booted. They were copy-pasted into a dozen throwaway scripts that
 * lived in a scratch directory and died with the session, which meant each new
 * question started by rebuilding the apparatus — and, more than once, by
 * rediscovering the same two traps below the hard way.
 *
 * TRAP ONE: CHROMIUM CANNOT USE THE AGENT PROXY. Tiles, elevation and Overpass
 * all fail TLS through it. Every https request is intercepted and relayed
 * through `curl` instead, with a SHA1 disk cache so a second run of anything is
 * offline and fast. The cache is why these tools are usable at all: a cold run
 * takes minutes, a warm one seconds.
 *
 * TRAP TWO: THE RELAY BYPASSES CSP. Requests routed this way never face the
 * page's content-security-policy, so a tool here is structurally BLIND to CSP
 * bugs — a blocked host looks like a working one. That cost a whole
 * investigation once, where every elevation measurement was quietly coming from
 * the fallback source. If you are testing whether something is reachable, this
 * is not the instrument.
 *
 * AND THE CLOCK: headless renders this world at two to four frames a second, so
 * WALL time is not sim time — dt is capped at 50ms, and a slow frame quietly
 * runs the world slower than the clock. Anything that integrates must wait on
 * `simWait`, never on a timeout.
 */
import { execSync, execFile } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CELL = join(HERE, '..');
export const ROOT = join(HERE, '../../..');
/** Build output and the relay cache. Outside the repo: both are derived. */
export const WORK = process.env.DRIVE_WORK
  ?? join(process.env.TMPDIR ?? '/tmp', 'drive-tools');
const CACHE = join(WORK, 'relay-cache');

/** The page shell, as the cell serves it. Kept beside the build so a tool can
 *  run without the cell host — and read fresh each time, because a stale copy
 *  of this file silently tests a stylesheet that is no longer shipped. */
function shell() {
  const idx = readFileSync(join(CELL, 'index.ts'), 'utf8');
  const m = idx.match(/<head>[\s\S]*?<\/body>/);
  if (!m) throw new Error('could not find the page shell in index.ts');
  return `<!doctype html><html>${m[0]}</html>`
    .replace(/\$\{[^}]*\}/g, '');   // the shell is a template literal
}

/**
 * Bundle, serve, launch, boot. Returns the page plus the handles a tool needs,
 * and a `close()` that tears down both the browser and the server.
 */
export async function openDrive(opts = {}) {
  const {
    spot = 'lat=-34.09905&lon=18.37835&h=0&cam=chase',
    port = 8800 + Math.floor(Math.random() * 90),
    tag = 'app',
    menu = true,
    settle = 0,
    rev = '',
    shim = '',
  } = opts;
  mkdirSync(WORK, { recursive: true });
  mkdirSync(CACHE, { recursive: true });

  // MEASURE AN OLDER BUILD. Almost every question worth asking here is "is this
  // better than what we had", and the answer needs both numbers from the same
  // rig on the same day — a remembered figure from three changes ago is not a
  // control. `rev` builds any revision's main.ts; `shim` is appended to it,
  // because an older build usually lacks the very probe the measurement reads
  // and reconstructing it there is the only way to compare like with like.
  //
  // IT HAS TO LIVE BESIDE THE REAL ONE. main.ts imports ./menu and ./overlays
  // by relative path and three from the repo's node_modules, so a copy bundled
  // out of a temp directory resolves none of them. Written into client/, built,
  // and removed again — including on failure, or a stray __rev-main.ts is left
  // in the cell and gets deployed.
  let src = opts.src ?? join(CELL, 'client/main.ts');
  let scratch = '';
  if (rev) {
    src = scratch = join(CELL, 'client/__rev-main.ts');
    writeFileSync(src, execSync(`git show ${rev}:cells/drive/client/main.ts`,
      { cwd: ROOT, maxBuffer: 64e6 }) + shim);
  }
  const bundle = join(WORK, `${tag}.js`);
  try {
    execSync(`npx esbuild ${src} --bundle --format=esm --outfile=${bundle}`, { stdio: 'pipe', cwd: ROOT });
  } finally {
    if (scratch) rmSync(scratch, { force: true });
  }

  const html = shell();
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/app.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(readFileSync(bundle)); }
    else if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
    else { res.writeHead(404); res.end('{}'); }
  });
  await new Promise((r) => server.listen(port, r));

  const browser = await chromium.launch({
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      // Post-quantum key agreement makes the relayed TLS handshakes fail.
      '--disable-features=UseMLKEM,PostQuantumKeyAgreement,PostQuantumKyber,EncryptedClientHello'],
  });
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true,
  });
  await ctx.route(/^https:\/\//, async (route) => {
    const req = route.request();
    const key = join(CACHE, createHash('sha1').update(req.url() + '|' + (req.postData() ?? '')).digest('hex'));
    if (existsSync(key)) return route.fulfill({ status: 200, body: readFileSync(key), contentType: 'application/octet-stream' });
    const args = ['-s', '-f', '--max-time', '60', '--cacert', '/root/.ccr/ca-bundle.crt'];
    // OVERPASS IS A POST, AND IT WANTS THE CONTENT TYPE. Dropped when this rig
    // was assembled from the throwaway scripts, and invisible for a long while
    // because every place under test was already in the relay cache from before.
    // At a cold location it meant no OSM at all — and a measurement of a world
    // with no roads in it reports zero seams and looks like good news.
    if (req.postData()) {
      args.push('--data-binary', req.postData(),
        '-H', 'Content-Type: application/x-www-form-urlencoded');
    }
    args.push(req.url());
    const body = await new Promise((res) => execFile('curl', args,
      { encoding: 'buffer', maxBuffer: 64e6 }, (e, o) => res(e ? null : o)));
    if (!body) return route.fulfill({ status: 502, body: '' });
    try { writeFileSync(key, body); } catch { /* cache is best-effort */ }
    return route.fulfill({ status: 200, body, contentType: 'application/octet-stream' });
  });

  const page = await ctx.newPage();
  const errors = [];
  // WITH THE STACK. `String(e)` gives "TypeError: Cannot read properties of
  // undefined (reading '0')" and nothing else, which names a bug without
  // locating it — and a bundled build has one file to search.
  page.on('pageerror', (e) => errors.push(
    `${String(e)}\n${(e && e.stack ? String(e.stack) : '').split('\n').slice(1, 4).join('\n')}`.slice(0, 600)));
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(`http://localhost:${port}/?${spot}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 120000 });
  if (menu) await page.evaluate(() => window.__menutab(null));
  if (settle) await page.waitForTimeout(settle);

  /** Let INTEGRATED seconds pass. Waiting on wall time at three frames a
   *  second measures the frame rate and calls it physics. */
  const simWait = async (s) => {
    const t0 = await page.evaluate(() => window.__clock().simS);
    await page.waitForFunction((a) => window.__clock().simS >= a.t0 + a.s, { t0, s },
      { timeout: 600000, polling: 250 });
  };

  return {
    page, errors, simWait,
    shot: (name) => page.screenshot({ path: join(WORK, `${name}.png`) }),
    async close() { await browser.close(); server.close(); },
  };
}

/**
 * ARRIVE SOMEWHERE, rather than appear there.
 *
 * Hops are short and each is followed by a wait, so the tile loader sees a rig
 * that MOVED — the same sequence of streams a driver causes — instead of one
 * that jumped. This matters because several defects in this world only exist on
 * the arrival path: what a tile's ways are chained with, and whether they were
 * already solved in a neighbour's halo, both depend on how you got there. A
 * spawn fixture, however faithful, is the case that already works.
 *
 * Position is written straight into the state object. The bicycle model
 * integrates from a standstill, so a written position simply stays written.
 */
export async function walkTo(page, lat, lon, opts = {}) {
  const { hop = 60, dwell = 3000, log = true } = opts;
  const target = await page.evaluate((ll) => window.__tolocal(ll[0], ll[1]), [lat, lon]);
  for (;;) {
    const left = await page.evaluate(({ t, hop: h }) => {
      const s = window.__drive;
      const dx = t[0] - s.x, dz = t[1] - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.5) {
        const step = Math.min(dist, h);
        s.x += (dx / dist) * step; s.z += (dz / dist) * step;
        s.heading = Math.atan2(dx, -dz);
      }
      return dist;
    }, { t: target, hop });
    if (log) process.stdout.write(`  ${Math.round(left)}m to go   \r`);
    if (left < 1) break;
    await page.waitForTimeout(dwell);
  }
  if (log) process.stdout.write('\n');
}

/** Print page errors and exit non-zero if any — every tool should end on this,
 *  because a measurement taken from a broken page is worse than none. */
export function report(errors) {
  console.log(`pageerrors: ${errors.length}`, errors.slice(0, 3));
  if (errors.length) process.exitCode = 1;
}
