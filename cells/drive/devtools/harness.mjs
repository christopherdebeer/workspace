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
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { offlineAliasFlags } from './offline-deps.mjs';

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
    .replace(/\$\{[^}]*\}/g, '')    // the shell is a template literal
    // THE HARNESS STAMPS ITS SHELL TOO. The deployed cell puts a hash of the
    // app.js it served in this meta (index.ts, stampOf) and the client reads
    // it back to say which build is running; a harness page left it as the
    // raw placeholder, so the one screen that reports it could never be
    // exercised here. `HARNESS_BUILD` is what this page claims to be and
    // `HARNESS_SERVED` (below) what the server will admit to — set them apart
    // and the STALE path is reproducible without deploying anything.
    .replace('__DRIVE_BUILD_STAMP__', process.env.HARNESS_BUILD ?? 'harnessbuild');
}

/**
 * Bundle, serve, launch, boot. Returns the page plus the handles a tool needs,
 * and a `close()` that tears down both the browser and the server.
 */
// ── THE DEAD-MAN FUSE ──
//
// Everything above is best-effort cleanup, and best-effort cleanup is exactly
// what fails on the paths nobody anticipated. The failure it guards is not a
// slow run: it is a run whose WORK IS ALREADY DONE, parked in ep_poll on a
// handle nobody closed, invisible because a `| tail` upstream will not flush
// until the process it is reading from reaches EOF. One of those sat here for
// three hours and eight minutes having spent one second of CPU, with its
// verdict — a plain `BOOT FAILED` line — trapped in the pipe the whole time.
// A wall clock is the only thing that catches that class, because from the
// inside the program has no idea it is stuck.
const FUSE_MIN = Number(process.env.HARNESS_FUSE_MIN ?? 20);
let fuseArmed = false;
function armFuse() {
  if (fuseArmed || FUSE_MIN <= 0) return;
  fuseArmed = true;
  const t0 = Date.now();
  const timer = setTimeout(() => {
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    // stderr first and unbuffered: whatever is downstream needs to see this
    // even though we are about to deny it a graceful EOF.
    process.stderr.write(`\n[harness] FUSE BLOWN after ${mins} min `
      + `(HARNESS_FUSE_MIN=${FUSE_MIN}). The run is being killed, not waited on.\n`
      + `[harness] If the work looked finished, this is a LEAKED HANDLE, not slow code:\n`
      + `[harness]   something threw past its close(), or a browser was never closed.\n`);
    // _exit, not exit: an exit handler that awaits a wedged browser is the
    // very thing that produced the zombie.
    process.exit(9);
  }, FUSE_MIN * 60000);
  timer.unref();
}

export async function openDrive(opts = {}) {
  armFuse();
  const {
    spot = 'lat=-34.09905&lon=18.37835&h=0&cam=chase',
    port: askPort = 8800 + Math.floor(Math.random() * 90),
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
  // THE WHOLE CLIENT COMES FROM THE REVISION, not main.ts alone. The first
  // version wrote the old main.ts beside the CURRENT siblings, and a control
  // built that way measures the old main.ts over the new roadsolve.ts — which
  // is no control at all once the change under test lives in a sibling. So
  // the revision's entire client/ is unpacked under node_modules/.cache, which
  // is inside the repo (three resolves upward from there) and outside the
  // cell's source (nothing under it is deployed); ./menu and ../lab-dials
  // resolve within the unpacked tree. Nothing is written into client/ now, so
  // there is no stray file to leave behind on failure.
  let src = opts.src ?? join(CELL, 'client/main.ts');
  if (rev) {
    const sha = execSync(`git rev-parse --short=12 ${rev}`, { cwd: ROOT }).toString().trim();
    const dir = join(CELL, 'node_modules/.cache/rev', sha);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execSync(`git archive ${sha} cells/drive/client | tar -x --strip-components=2 -C ${dir}`, { cwd: ROOT, maxBuffer: 64e6 });
    src = join(dir, 'client/main.ts');
    if (shim) writeFileSync(src, readFileSync(src, 'utf8') + shim);
  }
  // SANITISED, because this tag becomes an esbuild --outfile path. A tag with
  // a space in it fails as `Must use "outdir" when there are multiple input
  // files` — an error about something else entirely, which has now cost two
  // runs. The tag is a label; the filename is a filename.
  const safeTag = String(tag).replace(/[^A-Za-z0-9._-]+/g, '-');
  const bundle = join(WORK, `${safeTag}.js`);
  execSync(`npx esbuild ${src} --bundle --format=esm ${offlineAliasFlags()} --outfile=${bundle}`, { stdio: 'pipe', cwd: ROOT });

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
        // IN A DIRECTORY WITH `static/` BESIDE IT. The handler reads baked
        // assets off disk relative to its own __dirname — ne-wide.b64 for the
        // overview, cover-wide.b64 for the coarse cover — exactly as it does
        // from /var/task on the deploy. Bundled loose into WORK it finds
        // neither, and the routes that need them answer 503 with nothing to
        // say why: measured, every ~/cover/w1 tile in the harness.
        const dir = join(WORK, 'cell');
        mkdirSync(dir, { recursive: true });
        try { rmSync(join(dir, 'static'), { force: true }); } catch { /* first run */ }
        symlinkSync(join(CELL, 'static'), join(dir, 'static'), 'dir');
        const out = join(dir, 'index.mjs');
        // …AND THE BUNDLE HAS TO KNOW WHERE IT IS. `__dirname` DOES NOT EXIST
        // IN AN ESM BUNDLE — esbuild leaves the identifier alone and node
        // throws `__dirname is not defined` the first time a route reads an
        // asset. The symlink above was added to fix the coarse cover and could
        // not have: measured on the bundle this line produces,
        // `~/cover/w1/4/8/6` answered `503 {"error":"no coarse cover baked"}`
        // and `~/osm/ov1/7/19/48` fell past its bake to a 43s Overpass timeout
        // with `bakeMissing: "__dirname is not defined"` in the body. Every
        // harness run since those routes shipped has been testing the fallback.
        // The handler's own error strings are what say so — `serveOverview`
        // reports why the bake did not answer, which is the whole reason that
        // field exists.
        execSync(`npx esbuild ${join(CELL, 'index.ts')} --bundle --platform=node --format=esm`
          + ` --packages=external --define:__dirname=${JSON.stringify(JSON.stringify(dir))}`
          + ` --outfile=${out}`, { stdio: 'pipe', cwd: ROOT });
        cellHandler = (await import(`${out}?t=${Date.now()}`)).handler;
      } catch { cellHandler = null; }
    }
    if (!cellHandler) return null;
    const key = join(cellCache, createHash('sha1').update(p).digest('hex'));
    // THE TYPE IS CACHED BESIDE THE BODY. This returned a hardcoded
    // 'image/png' on a cache hit, which was true while ~/cover was the only
    // route through here and silently wrong the moment a second one arrived:
    // ~/dem/v1 answers image/webp for a tile and text/plain for an absence,
    // and the client tells those two apart BY THE CONTENT TYPE.
    if (existsSync(key)) {
      const type = existsSync(`${key}.type`) ? readFileSync(`${key}.type`, 'utf8') : 'image/png';
      return { body: readFileSync(key), type };
    }
    const r = await cellHandler({ rawPath: p, requestContext: { http: { method: 'GET' } } });
    if (r.statusCode !== 200) return null;
    let body = r.isBase64Encoded ? Buffer.from(r.body, 'base64') : Buffer.from(String(r.body));
    const type = r.headers?.['content-type'] ?? 'application/octet-stream';
    // AND THE ENCODING IS UNWOUND HERE, ONCE. `serveOverview` answers gzip;
    // `serveDem` and the cover routes do not, which is why this was invisible
    // until a vector route came through. The server below writes a bare
    // content-type, so a gzipped body reached the page as bytes it then tried
    // to parse as JSON: every coarse chart tile threw, every one was filed in
    // `ovFailedAt`, and the chart read `0/25 · 25 RETRY` with a route that was
    // answering 200 in fourteen milliseconds. Decoding here keeps the disk
    // cache plain and leaves every consumer route as it was.
    if (r.headers?.['content-encoding'] === 'gzip') body = zlib.gunzipSync(body);
    try { writeFileSync(key, body); writeFileSync(`${key}.type`, type); } catch { /* best effort */ }
    return { body, type };
  };
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/app.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); res.end(readFileSync(bundle)); }
    // What the SERVER says it is serving — the cell's own /build route (see
    // index.ts). The ABOUT page asks this and compares it with the stamp in
    // the shell it booted from, so a test can put them apart deliberately.
    else if (p === '/build') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ build: process.env.HARNESS_SERVED ?? process.env.HARNESS_BUILD ?? 'harnessbuild', cell: 'harness', at: Date.now() }));
    }
    // ── THE CAPTURED FIXTURES, WHICH ARE NO LONGER IN THE BUNDLE ──
    //
    // They were `import world-bixby.json`, so they arrived inside app.js and
    // this server never had to know about them. Six captures came to 2.37MB
    // against a 1.51MB bundle, so they moved to static/fixtures/ and are
    // fetched — which means a fixture test 404s here unless this route exists,
    // and it 404s as an EMPTY PLANET rather than as an error, because a world
    // with no ways looks exactly like a world that built nothing.
    //
    // Straight off disk rather than through the cell handler: the handler is
    // only wired up for ~/cover (see below) and this is a file read, not
    // compute. Same strict name test as the cell's own route.
    else if (p.startsWith('/fixtures/') && /^world-[a-z0-9-]+\.json$/.test(p.slice(10))) {
      try {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(readFileSync(join(CELL, 'static/fixtures', p.slice(10))));
      } catch { res.writeHead(404); res.end(); }
    }
    // The shell, at `/` and at whatever OTHER route the caller asked for. The
    // deployed cell serves this same 3162-byte document for any app path — a
    // client-side route branch cannot fire unless the page is served there —
    // and this server answered `{}` to /hydro, which reads on screen as a lab
    // that renders nothing and reports no error, because none happened. Only
    // the explicitly requested path is added, so every existing test keeps the
    // 404 it relies on for a missing tile.
    else if (p === '/' || (opts.pagePath && p === opts.pagePath.split('?')[0])) {
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
    // THE FINE VECTOR TILES, from the same place the PHONE gets them.
    //
    // The note by cellRoute says routing these through the handler locally
    // would move the Overpass call server-side and spend a fresh upstream
    // budget per tile. True — but the conclusion drawn from it, to serve them
    // from nowhere and let the client fall back to the Overpass mirrors, means
    // every harness run depends on a busy public service that the player's
    // session does not: the phone reads this route, off S3, and only falls back
    // if the cell itself is unreachable. Measured the day the mirrors went dark
    // from this network: the deployed route answered a tile in 0.47s while
    // every local test failed with `upstreamDown: true` and no roads at all.
    //
    // So proxy it, exactly as the overview and summit tiles below already are,
    // and for the same reason: read what is banked rather than re-earning it.
    // The client's mirror fallback still exists and is still what a bad deploy
    // degrades to; it just stops being the harness's PRIMARY source.
    //
    // MATCHED BY SHAPE, NOT BY VERSION. This read `/~/osm/v3/` while the
    // client had moved to `~/osm/v4/` (water relations), so every fine tile
    // 404'd here and every harness run silently drove the client's Overpass
    // mirror fallback — the exact thing the paragraph above says it stopped
    // being. The cell's own TILE_RE accepts v2..v4; match the same shape.
    else if (/^\/~\/osm\/v\d+\//.test(p) && opts.osm !== false) {
      fetch(`https://c15r-drive.on.parc.land${p}`)
        .then(async (r) => {
          if (!r.ok) { res.writeHead(r.status); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(Buffer.from(await r.arrayBuffer()));
        })
        .catch(() => { res.writeHead(503); res.end('{}'); });
    }
    // THE OVERVIEW IS TWO ROUTES WEARING ONE PATH, and the harness has to
    // split them or it can only ever test the half that is already deployed.
    // The fine rungs (z10 and in) are Overpass queries and must be read from
    // the BANK, exactly as the fine vectors are — re-earning them here would
    // be minutes of a public service per run. The wide rungs (z9 and out) are
    // arithmetic over `static/ne-wide.b64`, a file in this repo: running them
    // through the handler costs nothing, exercises the route code the phone
    // will run, and — the reason this exists — lets a change to the LADDER be
    // measured before it is deployed. A rung added to the bake is otherwise a
    // 400 here until a deploy, which reads as a broken client.
    else if (p.startsWith('/~/osm/ov1/')) {
      const oz = Number(p.split('/')[4]);
      if (Number.isFinite(oz) && oz <= 9) {
        cellRoute(p).then((out) => {
          if (!out) { res.writeHead(404); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': out.type });
          res.end(out.body);
        }).catch(() => { res.writeHead(503); res.end('{}'); });
      } else fetch(`https://c15r-drive.on.parc.land${p}`)
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
    // ECOREGION TILES, and for the third time the same reason: the client has
    // no fallback for these, so a 404 here does not degrade the answer, it
    // deletes it — and it deletes it PERMANENTLY, because `loadEcoTile` reads
    // a 4xx as "this tile is not coming, whatever we do" and never asks again.
    // A run against this server therefore reported `ecoState: failed` on frame
    // zero and looked exactly like a broken route on the cell. One z5 tile
    // covers twelve hundred kilometres, so this is one fetch a continent.
    else if (p.startsWith('/~/eco/v1/')) {
      fetch(`https://c15r-drive.on.parc.land${p}`)
        .then(async (r) => {
          if (!r.ok) { res.writeHead(r.status); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(Buffer.from(await r.arrayBuffer()));
        })
        .catch(() => { res.writeHead(503); res.end('{}'); });
    }
    // ── THE ELEVATION TILES, THROUGH THE CELL'S OWN HANDLER ──
    //
    // Through the handler rather than proxied to the deploy, unlike the
    // vectors: `serveDem` is a proxy and a HEAD walk, not an Overpass budget,
    // so running it locally costs one upstream request and exercises the route
    // code the phone will run. Both of its answers matter here — a tile is
    // image/webp and an absence is a text/plain sentinel naming where to climb
    // — which is why cellRoute had to learn to remember a content type.
    // The coarse cover, from the bake in static/ — through the handler for the
    // same reason ~/cover/v1 is: it is compute over an asset in this repo, and
    // running it locally proves the route rather than the deploy.
    else if (p.startsWith('/~/cover/w1/')) {
      cellRoute(p).then((out) => {
        if (!out) { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'content-type': out.type });
        res.end(out.body);
      }).catch(() => { res.writeHead(503); res.end('{}'); });
    }
    else if (p.startsWith('/~/dem/v1/') && opts.dem !== false) {
      cellRoute(p).then((out) => {
        if (!out) { res.writeHead(404); res.end('{}'); return; }
        res.writeHead(200, { 'content-type': out.type });
        res.end(out.body);
      }).catch(() => { res.writeHead(503); res.end('{}'); });
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
  // A RANDOM PORT COLLIDES ONCE IN NINETY, AND IT USED TO BE FATAL. Two harness
  // runs side by side — a survey and the lab suite — drew the same port and
  // the suite died on EADDRINUSE before its first lab. Unless the caller
  // pinned a port, a collision is a re-draw, not a failure.
  let port = askPort;
  await new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      server.once('error', (e) => {
        if (e && e.code === 'EADDRINUSE' && opts.port === undefined && tries++ < 12) {
          port = 8800 + Math.floor(Math.random() * 90);
          attempt();
        } else reject(e);
      });
      server.listen(port, () => { server.removeAllListeners('error'); resolve(); });
    };
    attempt();
  });
  // A listening socket is a live handle, and a live handle means node cannot
  // exit. When a run threw between here and its `close()`, this server alone
  // held the process open — measured once at three hours and eight minutes for
  // a script whose actual work finished in two. Unref'd, it serves exactly as
  // before but stops voting on whether the program is done.
  server.unref();

  // ── HEADLESS IS A SOFTWARE RASTERISER, AND THAT IS A MEASUREMENT TRAP ──
  //
  // The default here is `headless_shell`, whose WebGL is SwiftShader: every
  // vertex and every fragment is executed on the CPU. It is the right default —
  // it runs anywhere, needs no display, and is what every correctness tool in
  // this folder wants. But it means a number from this rig is not this
  // machine's GPU and is certainly not a phone's: vertex-heavy work (the sward's
  // 1.75M vertices) is punished out of all proportion, while the fragment cost
  // of a full-resolution post chain barely registers.
  //
  // `headed: true` launches the real Chromium against the real driver — Metal on
  // this Mac — which is the only way anything in here can speak about frame
  // TIME rather than frame CORRECTNESS. It needs a display, so it is opt-in.
  //
  // `dpr` matters for the same reason and is easy to miss: the post chain's last
  // pass renders to the DEFAULT FRAMEBUFFER, which is scaled by device pixel
  // ratio, while the scene target is pinned near 320p. At the harness default of
  // 1 that penalty is invisible; a phone runs at 2 or 3, where it is four to
  // nine times the fragments. Measuring the composite at dpr 1 measures the one
  // configuration no player has.
  const browser = await chromium.launch({
    headless: !opts.headed,
    // ── A KILL MUST KILL ──
    //
    // Playwright's default SIGTERM handler tries to shut the browser down
    // gracefully first. If the browser is the thing that is wedged, the
    // handler waits on it forever and a plain `kill` does nothing — the one
    // three-hour zombie here survived SIGTERM and needed SIGKILL. Cleanup is
    // `close()`'s job and the fuse below is the backstop; a signal should end
    // the process, not open a negotiation.
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      // Post-quantum key agreement makes the relayed TLS handshakes fail.
      '--disable-features=UseMLKEM,PostQuantumKeyAgreement,PostQuantumKyber,EncryptedClientHello',
      // ── VSYNC HIDES EVERY ANSWER ON A FAST GPU ──
      //
      // Headed on an M4 Pro at 390x844, every configuration this rig can set
      // measured 8.33ms — grass OFF and grass LUSH, 240P and FULL, bloom on and
      // bloom off, all of them, to two decimal places. That is not a result: it
      // is the ProMotion panel's 120Hz refresh, and rAF deltas were reporting
      // the DISPLAY rather than the work. A saturated measurement reads exactly
      // like a free feature, which is the most expensive way to be wrong here.
      //
      // Unthrottled, a frame takes as long as it takes and a dial move shows up.
      // Strictly for timing runs: it spins the GPU flat out, so it is opt-in and
      // never on for a correctness tool.
      ...(opts.novsync ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
  });
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true,
    ...(opts.dpr ? { deviceScaleFactor: opts.dpr } : {}),
  });
  await ctx.route(/^https:\/\//, async (route) => {
    const req = route.request();
    const key = join(CACHE, createHash('sha1').update(req.url() + '|' + (req.postData() ?? '')).digest('hex'));
    if (existsSync(key)) return route.fulfill({ status: 200, body: readFileSync(key), contentType: 'application/octet-stream' });
    // The agent box's CA bundle, WHERE THERE IS ONE. On a workstation there is
    // not, and passing a --cacert that does not exist fails curl before it
    // opens a socket — so every relayed request 502s, which reads as "the whole
    // internet is down" rather than "this flag is wrong". Off the agent box,
    // curl's own system trust store is the right answer anyway.
    const args = ['-s', '-f', '--max-time', '60'];
    if (existsSync('/root/.ccr/ca-bundle.crt')) args.push('--cacert', '/root/.ccr/ca-bundle.crt');
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
  // ── A CELL IS NOT ONLY THE GAME ──
  //
  // `pagePath` opens some other route this cell serves — the hydro lab at
  // /hydro is the first — and skips the boot wait, because only the game
  // signals #boot.ready. Everything else the harness gives you (the local
  // server, the collected page errors, the GLSL sniffer, the screenshot) is
  // exactly as useful on a bench page as on the world, and without this a
  // second route has no instrument at all.
  if (opts.pagePath) {
    await page.goto(`http://localhost:${port}${opts.pagePath}`, { waitUntil: 'load', timeout: 60000 });
    if (settle) await page.waitForTimeout(settle);
    return {
      page, errors,
      shot: (name) => page.screenshot({ path: join(WORK, `${name}.png`) }),
      async close() { await browser.close(); server.close(); },
    };
  }
  await page.goto(`http://localhost:${port}/?${spot}`, { waitUntil: 'load', timeout: 60000 });
  // ── A FAILED BOOT MUST SAY WHY ──
  //
  // This used to be a bare waitForFunction, so a world that threw during
  // module init cost 120 seconds and then reported `TimeoutError` with an
  // empty log — while the page error that actually explained it sat in
  // `errors`, unreachable, because the throw happens before openDrive returns.
  // Measured against one afternoon: three wrong hypotheses and an hour, for a
  // fault the collected error names outright. The wait is the same; what comes
  // out of it when it fails is not.
  try {
    await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'),
      null, { timeout: opts.bootTimeout ?? 120000 });
  } catch (e) {
    const why = errors.length ? `\n  ${errors.slice(0, 6).join('\n  ')}` : ' no page errors captured —'
      + ' the module loaded but never signalled ready, which is a HANG rather than a throw:'
      + ' look for unbounded work on the build path.';
    await browser.close(); server.close();
    throw new Error(`world never booted [${tag}] after ${(opts.bootTimeout ?? 120000) / 1000}s:${why}`);
  }
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
    // Playwright's own default screenshot timeout is 30000ms, and this
    // file's own doctrine already measures d.shot() at ~19-22s FIXED cost
    // on this box — thin margin on a page under any extra load. Measured
    // failing at exactly that default: a god-camera contact-sheet run over
    // Romsdalen's mountain terrain threw `page.screenshot: Timeout 30000ms
    // exceeded` on its very first shot and killed a 49-shot capture with it.
    // 60s is headroom, not a new cost — a normal shot still takes ~20s.
    shot: (name) => page.screenshot({ path: join(WORK, `${name}.png`), timeout: 60000 }),
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
