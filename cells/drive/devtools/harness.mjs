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
import zlib from 'node:zlib';
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
  // ── THE CELL'S OWN ROUTES, SERVED BY THE CELL'S OWN HANDLER ──
  //
  // "no cover loading in harness" was not a network problem and not a
  // client one: this server answered exactly two paths and 404'd everything
  // else, and land cover has no fallback. The OSM vectors survived because the
  // client drops to the Overpass mirrors when the proxy fails, and those go out
  // through the https relay above — cover only ever comes from ~/cover/v1,
  // which is COMPUTE: the cell range-reads the ESA WorldCover COGs from S3,
  // decodes the TIFF and renders a PNG. No route, no cover, and every local
  // frame has been rendered on the latitude guess instead of the real ground.
  // It cost a round: a shadow measurement at Yosemite came back on a white
  // fallback palette and could not be compared with a device screenshot.
  //
  // The handler is a plain function of {rawPath} returning {statusCode, body}
  // and imports nothing but node built-ins, so it runs here as-is. Measured at
  // 2.0s for a cold z12 tile over Yosemite, and cached on disk after that.
  //
  // ONLY ~/cover, DELIBERATELY. Routing ~/osm through the handler as well would
  // move the Overpass call SERVER-side, where the relay's disk cache cannot see
  // it — trading a cached mirror hit for a fresh 15s upstream budget on every
  // run. The vectors already work; this fixes the thing that does not.
  const cellCache = join(CACHE, 'cell');
  mkdirSync(cellCache, { recursive: true });
  let cellHandler = opts.cover === false ? null : undefined;
  const cellRoute = async (p) => {
    if (cellHandler === undefined) {
      try {
        const out = join(WORK, 'cell-index.mjs');
        execSync(`npx esbuild ${join(CELL, 'index.ts')} --bundle --platform=node --format=esm`
          + ` --packages=external --outfile=${out}`, { stdio: 'pipe', cwd: ROOT });
        cellHandler = (await import(`${out}?t=${Date.now()}`)).handler;
      } catch { cellHandler = null; }
    }
    if (!cellHandler) return null;
    const key = join(cellCache, createHash('sha1').update(p).digest('hex'));
    if (existsSync(key)) return { body: readFileSync(key), type: 'image/png' };
    const r = await cellHandler({ rawPath: p, requestContext: { http: { method: 'GET' } } });
    if (r.statusCode !== 200) return null;
    const body = r.isBase64Encoded ? Buffer.from(r.body, 'base64') : Buffer.from(String(r.body));
    try { writeFileSync(key, body); } catch { /* best effort */ }
    return { body, type: r.headers?.['content-type'] ?? 'application/octet-stream' };
  };
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/app.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(readFileSync(bundle)); }
    else if (p === '/') {
      // OPT-IN, and off by default. The real page ships a Content-Security
      // Policy and this server never has, so anything the policy forbids —
      // eval, a script from an unlisted host, a module imported from the wrong
      // origin — passes every test here and fails only on the device, where it
      // cannot be inspected. A test that cares about that passes the cell's own
      // CSP in (see its export in index.ts); everything else is unaffected,
      // because some tools legitimately eval into the page.
      const head = { 'content-type': 'text/html' };
      if (opts.csp) head['content-security-policy'] = opts.csp;
      res.writeHead(200, head);
      res.end(html);
    }
    // A BANKED RUN'S BLOB, so ?run= can be exercised at all: the cell's tape
    // route is DynamoDB + the edge store, neither of which exists here, and
    // without it a run link 404s and silently falls back to the plain hub —
    // which is exactly the behaviour under test.
    else if (p.startsWith('/~/tape/v1/') && opts.tape) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(readFileSync(opts.tape));
    }
    // SUMMIT TILES, PROXIED TO THE DEPLOYED CELL. Unlike the vectors there is
    // no Overpass fallback in the client for these, so a 404 here is not a
    // degraded test — it is the whole layer missing, and it hid the fact that
    // the ring's gate never opened. Running them through the cell handler
    // locally would spend a fresh 15s Overpass budget per tile; the deployed
    // route already holds them on S3 as immutable objects (measured under a
    // second), so the honest local stand-in is to read that.
    // THE OVERVIEW TILES, for the same reason and with the same caveat as the
    // summits below: the client has an Overpass fallback for the FINE tiles
    // and none for these, so a local 404 does not degrade the chart layer, it
    // deletes it — every harness run has been asking the overview questions of
    // an empty map. Proxied to the deployed cell, where the corridor is
    // already banked, rather than run through the handler locally (which would
    // spend a fresh upstream budget per tile; see the note by cellRoute).
    else if (p.startsWith('/~/osm/ov1/')) {
      fetch(`https://c15r-drive.on.parc.land${p}`)
        .then(async (r) => {
          if (!r.ok) { res.writeHead(r.status); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(Buffer.from(await r.arrayBuffer()));
        })
        .catch(() => { res.writeHead(503); res.end('{}'); });
    }
    else if (p.startsWith('/~/osm/peak1/')) {
      fetch(`https://c15r-drive.on.parc.land${p}`)
        .then(async (r) => {
          if (!r.ok) { res.writeHead(r.status); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(Buffer.from(await r.arrayBuffer()));
        })
        .catch(() => { res.writeHead(503); res.end('{}'); });
    }
    else if (p.startsWith('/~/cover/v1/')) {
      cellRoute(p).then((out) => {
        if (!out) { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'content-type': out.type });
        res.end(out.body);
      }).catch(() => { res.writeHead(503); res.end('{}'); });
    }
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
  /**
   * A SHADER THAT WILL NOT COMPILE IS NOT A PAGE ERROR, and that is exactly why
   * it needs watching here.
   *
   * three catches the failure, logs it to the CONSOLE and carries on; the page
   * throws nothing, the render loop keeps running, and every probe in the suite
   * answers cheerfully about geometry, attributes and materials that are never
   * drawn. Measured the hard way: a slip layer whose fragment shader used
   * `patch` — a reserved word in GLSL ES 3.00 — failed the whole carriageway
   * program to link, so no road was drawn at all, and four separate probes
   * reported the feature present and correct. It took a screenshot with the
   * effect forced to solid red, showing no red, to find it.
   *
   * One line in the console names it immediately. Folded into the same errors
   * array every tool already reports, so no test has to opt in.
   */
  page.on('console', (m) => {
    const t = m.text();
    if (!/Shader Error|not compiled|VALIDATE_STATUS|INVALID_OPERATION: useProgram/i.test(t)) return;
    // Only the first of each distinct failure: a broken program re-reports on
    // every frame, and two hundred identical lines hide the one that matters.
    const key = (t.match(/ERROR: \d+:\d+: .*/) ?? [t.slice(0, 120)])[0];
    if (!errors.some((e) => e.includes(key))) errors.push(`GLSL: ${key}`);
  });
  if (opts.init) await page.addInitScript(opts.init);
  // Intercepts, BEFORE the first load. A test that needs to stand in for an
  // upstream — the apex's OAuth endpoints, a `~/` route the local server 404s —
  // cannot install them after `goto`, because by then the page has already
  // asked. `opts.route(page)` runs with the page created and nothing loaded.
  if (opts.route) await opts.route(page);
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

/**
 * A SCREENSHOT AS NUMBERS.
 *
 * "The grass is darker than the ground" is a claim about a DIFFERENCE between
 * two things in the same frame, and for three rounds it was argued from the
 * eye: the palette was blamed twice and retuned twice while the actual fault
 * — a normal that DoubleSide was flipping to face DOWN on half the field —
 * sat underneath, immune to any colour anyone chose.
 *
 * What settled it was rendering the same view twice, once with the layer and
 * once with `__hide`, and dividing. That needs pixels, and playwright hands
 * back a PNG, so this is the decoder: enough of the spec for what the renderer
 * emits (8-bit, non-interlaced), and no dependency.
 */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let i = 8, idat = [], w = 0, h = 0, ct = 0, bd = 0;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8);
    const body = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); bd = body[8]; ct = body[9]; }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (bd !== 8) throw new Error(`unsupported bit depth ${bd}`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = zlibSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let p = 0, prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride); prev = line;
  }
  return { w, h, ch, px: out };
}
function zlibSync(b) { return zlib.inflateSync(b); }

/**
 * Over a horizontal slice of two frames of the same view — one with a layer,
 * one without — split the pixels into those the layer PAINTED and those it did
 * not, and give the mean luminance of each. The ratio is the answer to "is
 * this layer lit like the ground it stands on".
 */
export function layerVsGround(withPng, withoutPng, y0, y1, thresh = 18) {
  const A = decodePng(withPng), B = decodePng(withoutPng);
  if (A.w !== B.w || A.h !== B.h) throw new Error('frames differ in size');
  const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  let cov = 0, tot = 0, ls = 0, gs = 0, gn = 0;
  for (let y = Math.max(0, y0); y < Math.min(A.h, y1); y++) {
    for (let x = 0; x < A.w; x++) {
      const o = y * A.w * A.ch + x * A.ch;
      const d = Math.abs(A.px[o] - B.px[o]) + Math.abs(A.px[o + 1] - B.px[o + 1])
        + Math.abs(A.px[o + 2] - B.px[o + 2]);
      tot++;
      if (d > thresh) { cov++; ls += lum(A.px[o], A.px[o + 1], A.px[o + 2]); }
      else { gs += lum(B.px[o], B.px[o + 1], B.px[o + 2]); gn++; }
    }
  }
  return { cover: cov / Math.max(1, tot), painted: cov,
    layer: cov ? ls / cov : 0, ground: gn ? gs / gn : 0,
    ratio: cov && gn ? (ls / cov) / (gs / gn) : 0 };
}
