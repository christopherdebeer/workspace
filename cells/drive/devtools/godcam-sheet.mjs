#!/usr/bin/env node
import { openDrive } from './harness.mjs';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

// ============================================================================
// ONE COMMAND: capture a grid of god-camera angles/times/weather/dev-overlay
// shots against a world fixture, then composite them into a single annotated
// PNG sheet — no separate compositing step, no env-var handshake between two
// scripts. Run with --help for the full option list.
// ============================================================================

const HELP = `
DRIVE god-camera contact sheet — capture + composite in one command.

Boots the drive game against a world fixture, shoots a grid of camera
angles across one or more times of day plus a weather-variant column and
a DEV row (tile-debug/OSM overlay, ground-view channels, X-RAY wire and
depth), then composites everything into one annotated PNG. Every image,
the probe dump, and the sheet all land under --work, all named with the
same run id so nothing from a previous run is ever silently overwritten.

USAGE
  node godcam-sheet.mjs --title "..." --description "..." [options]

REQUIRED
  --title <string>
      Short label for this run. Becomes the sheet's headline and the
      thing you scan for when looking through old runs later. Not
      optional: an untitled sheet is indistinguishable from every other
      untitled sheet in --work a week from now.

  --description <string>
      A DESCRIPTIVE PARAGRAPH — what you were investigating with this
      specific capture, what question it was meant to answer, and what
      in the images is actually worth looking at. This is the field that
      lets you (or anyone else) open manifest_<run>.json or the
      composited sheet later and know RETROACTIVELY where to focus
      analysis and evaluation, without having to reconstruct intent from
      the images alone or from a chat log that has since scrolled away.
      A run with no description is a run nobody can make sense of after
      the fact — pictures with no record of why they were taken. Write
      it as you would a lab notebook entry: what changed, what you
      expect to see if it worked, what would indicate it didn't.
      Required, not optional, for that reason. A short description is
      accepted but a warning is printed if it reads as a label rather
      than a paragraph (under ~12 words).

OPTIONS
  --run <id>          Disambiguates this capture from any other; every
                      output filename embeds it, so re-running never
                      silently overwrites a previous capture unless you
                      deliberately reuse the same id. Default: a
                      timestamp (YYYY-MM-DD_HH-MM-SS).
  --rows <list>       Comma-separated time-of-day rows to shoot, from
                      CYCLE/LIVE/DAWN/MORNING/NOON/AFTERNOON/DUSK/NIGHT.
                      --rows= (empty) skips the time-of-day grid
                      entirely and captures ONLY the DEV row — a fast
                      preview before committing to a full run.
                      Default: NOON,DUSK,NIGHT
  --fixture <id>      World fixture to load (see /lab/world for the
                      list). Default: at-yosemite
  --spot <query>      Boot a LIVE world instead of a fixture, e.g.
                      "lat=-34.09578&lon=18.36022&h=140" (as used by
                      REEL_DRIVES in client/reel-drives.ts). Overrides
                      --fixture; nodraw/wxlive are appended for you.
                      Slower and network-dependent — a live spot streams
                      real OSM/DEM/cover tiles rather than replaying a
                      captured fixture.
  --target <x,z>      Local-metre focus point every camera in the grid
                      frames. Default: -320,-160
  --out <path>        Final composited PNG path.
                      Default: <work>/contact-sheet_<run>.png
  --work <dir>        Directory for images/manifest/probes/sheet.
                      Default: $DRIVE_WORK or /tmp/drive-tools
  --cell-width <px>   Width of each thumbnail in the composited sheet.
                      Default: 200
  -h, --help          Show this and exit.

OUTPUT (all under --work, all sharing the run id)
  grid_<run>__<row>_<col>.png   one PNG per shot
  probes_<run>.json             a broad devtool-probe dump at --target,
                                 taken once right after settle, before
                                 any shot — ground/hydro/viewready/wx/
                                 tstats/far/census/cover/built/siteclim/
                                 sitecard/fixworld/wetmap
  manifest_<run>.json           title, description, git commit/branch/
                                 dirty flag, build stamp, fixture,
                                 target, every image's row/col/path,
                                 per-weather-shot __wx() readouts, the
                                 sheet's own path, and timings
  contact-sheet_<run>.png       the final composited sheet (or --out)

EXAMPLE
  node godcam-sheet.mjs \\
    --title "hydro fix — Ribbon Creek, full grid" \\
    --description "Confirming the shore-contact carve fix holds across \\
every time of day and weather variant at the creek crossing near the \\
default spawn. Expect the creek to sit visibly IN its banks rather than \\
floating over a flat-bottomed trench at every angle; the DEV row's tile \\
debug should show the fine ring settled with no dirty tiles. Follow-up \\
to the NOON-only smoke test in run 2026-09-19_22-51-12." \\
    --rows NOON,DUSK,NIGHT
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (!a.startsWith('--')) continue;
    const body = a.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) { args[body.slice(0, eq)] = body.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args[body] = next; i++; }
    else args[body] = true;
  }
  return args;
}

const argv = parseArgs(process.argv.slice(2));
if (argv.help) { console.log(HELP); process.exit(0); }

const missingArgs = [];
if (!argv.title || argv.title === true) missingArgs.push('--title');
if (!argv.description || argv.description === true) missingArgs.push('--description');
if (missingArgs.length) {
  console.error(`Missing required argument(s): ${missingArgs.join(', ')}\n`);
  console.error('Run with --help for usage and why these are required.');
  process.exit(1);
}
const TITLE = argv.title;
const DESCRIPTION = argv.description;
const descWords = DESCRIPTION.trim().split(/\s+/).filter(Boolean).length;
if (descWords < 12) {
  console.error(`WARNING: --description is ${descWords} word(s) — reads as a label, not a paragraph.`);
  console.error('It is what lets this run be understood retroactively; consider more detail.');
  console.error('Proceeding anyway (not a hard requirement on length, only on presence).\n');
}

// ---------------------------------------------------------------------------
// Configuration, all overridable from argv, defaults matching what this
// tool has been run with throughout this session's investigation.
// ---------------------------------------------------------------------------

// --spot overrides fixture entirely for a LIVE world boot (e.g.
// `--spot "lat=-34.09578&lon=18.36022&h=140"`), for the reel-drive
// postcards that have no captured fixture — nodraw/wxlive are appended
// automatically so a live spot settles as fast as a fixture does and
// isn't at the mercy of a live weather roll. FIXTURE is null in that
// case (there is none); the manifest and header both read `spot` first.
const FIXTURE = argv.spot ? null : String(argv.fixture ?? 'at-yosemite');
const SPOT = argv.spot ? `${String(argv.spot)}&nodraw=1&wxlive=0` : `fixture=${FIXTURE}&nodraw=1&wxlive=0`;
// A live spot spawns the truck at local (0,0); a captured fixture's own
// interesting ground is usually well away from its origin, which is why
// that default stays the yosemite-tuned (-320,-160).
const [tx, tz] = String(argv.target ?? (argv.spot ? '0,0' : '-320,-160')).split(',').map(Number);
const TARGET = { x: tx, z: tz };
const WORK = String(argv.work ?? process.env.DRIVE_WORK ?? '/tmp/drive-tools');
const CELL_W = Number(argv['cell-width'] ?? process.env.CELL_W ?? 200);
// --rows= (empty) skips the time-of-day loop entirely — just the DEV row —
// for a quick preview before committing to the full grid.
const ROWS = String(argv.rows ?? 'NOON,DUSK,NIGHT').split(',').map((s) => s.trim()).filter(Boolean);
// RUN disambiguates this capture from any other. Every image filename
// embeds it, so a second run can never silently overwrite a first's
// images unless the id is deliberately reused — the default is a fresh
// timestamp precisely so "run it again" is safe by default rather than
// "collide unless you remember not to".
const RUN = String(argv.run ?? new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19));
const OUT = String(argv.out ?? join(WORK, `contact-sheet_${RUN}.png`));

const T0 = Date.now();
const elapsed = () => ((Date.now() - T0) / 1000).toFixed(1);
function log(msg) {
  console.log(`[+${elapsed()}s]`, msg);
}
async function timed(label, fn) {
  const t0 = Date.now();
  log(`>> ${label}`);
  const result = await fn();
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  log(`<< ${label} (${dt}s)`);
  return result;
}

// The <meta name="drive-build"> tag the harness stamps is NOT a real
// deploy hash locally — it defaults to the literal string 'harnessbuild'
// (harness.mjs's own HARNESS_BUILD fallback). The commit/branch of THIS
// checkout is what actually says what code was captured, so it is read
// here, once, at process start — no browser needed for it.
function gitInfo() {
  const opts = { cwd: '/home/user/workspace', encoding: 'utf8' };
  const safe = (cmd) => { try { return execSync(cmd, opts).trim(); } catch { return null; } };
  const hash = safe('git rev-parse HEAD');
  const dirty = safe('git status --porcelain');
  return {
    commit: hash,
    commitShort: hash ? hash.slice(0, 12) : null,
    branch: safe('git rev-parse --abbrev-ref HEAD'),
    dirty: dirty !== null && dirty.length > 0,
  };
}
const GIT = gitInfo();
log(`title: ${TITLE}`);
log(`run: ${RUN}  git: ${GIT.branch ?? '?'}@${GIT.commitShort ?? '?'}${GIT.dirty ? ' (dirty working tree)' : ''}`);

const ANGLE_COLS = [
  { id: 'top',   x: TARGET.x, z: TARGET.z, y: 30, az: 20,  el: 80, dist: 700, fov: 55 },
  { id: 'N',     x: TARGET.x, z: TARGET.z, y: 20, az: 0,   el: 28, dist: 320, fov: 55 },
  { id: 'E',     x: TARGET.x, z: TARGET.z, y: 20, az: 90,  el: 28, dist: 320, fov: 55 },
  { id: 'S',     x: TARGET.x, z: TARGET.z, y: 20, az: 180, el: 28, dist: 320, fov: 55 },
  { id: 'W',     x: TARGET.x, z: TARGET.z, y: 20, az: 270, el: 28, dist: 320, fov: 55 },
  { id: 'wide1', x: TARGET.x, z: TARGET.z, y: 30, az: 45,  el: 45, dist: 550, fov: 55 },
  { id: 'wide2', x: TARGET.x, z: TARGET.z, y: 30, az: 225, el: 45, dist: 550, fov: 55 },
  { id: 'close', x: TARGET.x, z: TARGET.z, y: 6,  az: 30,  el: 12, dist: 70,  fov: 50 },
];

// Weather comparison holds ONE framing fixed so weather is the only thing
// that varies across these columns. 'close' (low, near-ground) shows rain/
// haze/storm far better than the distant 'wide1' aerial ever could — fog and
// wet ground read as almost nothing from 550m out.
const WX_CAM = ANGLE_COLS.find((c) => c.id === 'close');
const WX_VARIANTS = ['clear', 'haze', 'rain', 'storm'];

// DEV row.
//
// __tiledbg(true) draws the tile grid + OSM z16 vector ring's own key
// (WIRE/QUEUE/FAIL/DONE pips). It used to be `if (camMode === 'top' &&
// tileDbg)`, nested inside drawHud() past its `if (!hudOn) return`, so it
// could never draw for a god-camera shot at any HUD setting — a fix in
// main.ts (drawTileDebugOverlay, extracted out of drawHud) now gates it
// on `camMode === 'top' || camMode === 'god'` and calls it from drawHud's
// hudOn-off early return too, so it draws for __godcam() with the HUD
// left off. The overlay centres on `renderFocusXZ()`, which follows
// `godTarget` in god mode — the SAME 8 ANGLE_COLS framings used for every
// other row, just with tileDbg switched on, rather than a separate
// chart-camera detour. There is no separate "raw OSM vector" view
// distinct from this pip/grid overlay — the way/road geometry itself is
// just the ordinary 3D ribbon mesh, visible in every shot regardless of
// any of this.
//
// __groundview(id) IS a per-fragment terrain shader term and DOES apply
// in any camera, unlike tiledbg — kept on the close god-cam framing.
// __xray('wire'|'depth') is the scene-wide collision-geometry /
// occlusion-map debug pair; 'depth' also needs hudOn (drawLumaMap is
// gated the same way, inside drawHud's hudOn branch) but not camMode.
const GV_VARIANTS = ['cover', 'eco', 'substrate'];
const XRAY_COLS = ['xray-wire', 'xray-depth'];
const DEV_SHOTS = ANGLE_COLS.length + GV_VARIANTS.length + XRAY_COLS.length;
const TOTAL_SHOTS = ROWS.length * (ANGLE_COLS.length + WX_VARIANTS.length) + DEV_SHOTS;

const godcam = (d, c) => d.page.evaluate((c) => window.__godcam({
  x: c.x, z: c.z, y: c.y, az: c.az, el: c.el, dist: c.dist, fov: c.fov,
}), c);

// A running ledger of every step's duration, printed LIVE as each step
// completes (not just at the end) — the question "where did the latency
// between shots go" needs the per-step breakdown to show up in the stream
// as it happens, not only in a post-hoc table.
const ledger = [];
async function step(name, fn) {
  const t0 = Date.now();
  const result = await fn();
  const ms = Date.now() - t0;
  ledger.push({ name, ms });
  log(`    · ${name}: ${(ms / 1000).toFixed(2)}s`);
  return result;
}

// Every captured image's row/col/path, in order — the manifest's single
// source of truth for which row/col produced which file, so the
// compositing pass below (and anyone reading the manifest later) never
// has to re-derive a filename.
const outputs = [];

// A peek at the log's tail during a multi-minute run should answer "how
// far through" without counting lines — so every shot logs its own count,
// percentage and a running ETA. The ETA is timed from the FIRST shot, not
// from process start, so boot/settle/probe-dump overhead (~15-20s, fixed
// regardless of grid size) doesn't skew the per-shot average downward.
let shotsDone = 0;
let shotsStartTime = null;
function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '?';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}

log(`starting: run=${RUN} ${ROWS.length} rows × ${ANGLE_COLS.length + WX_VARIANTS.length} cols + DEV (${DEV_SHOTS} cols) = ${TOTAL_SHOTS} shots total`);

const d = await timed('openDrive (boot + goto)', () => openDrive({
  // no time=, no wx= — both are driven live below via __timeset/__wxnext
  // nodraw=1: boot and settle BLIND (frames are cheap to skip), then
  // __draw(true) once below turns painting back on for the whole capture.
  // Measured: this alone cut settle from 21-25s to ~4-6s. Toggling __draw
  // per-shot was ALSO tried and measured — it does NOT cut d.shot()'s
  // ~19-22s cost, which is a fixed cost of page.screenshot() on this box,
  // not contention from a busy render loop. So draw stays ON throughout
  // the capture; only the settle phase runs blind.
  spot: SPOT,
  settle: 0,
  bootTimeout: 90000,
  tag: 'grid-shared',
}));

async function takeShot(row, col) {
  if (shotsStartTime === null) shotsStartTime = Date.now();
  const name = `grid_${RUN}__${row}_${col}`;
  await step(`${row}/${col}: shot`, () => d.shot(name));
  outputs.push({ row, col, file: join(WORK, `${name}.png`) });
  shotsDone++;
  const pct = ((shotsDone / TOTAL_SHOTS) * 100).toFixed(0);
  const sinceFirst = (Date.now() - shotsStartTime) / 1000;
  const avg = sinceFirst / shotsDone;
  const remaining = avg * (TOTAL_SHOTS - shotsDone);
  log(`shot ${row}/${col} done — ${shotsDone}/${TOTAL_SHOTS} (${pct}%), avg ${avg.toFixed(1)}s/shot, ~${fmtDuration(remaining)} remaining`);
}

let build = null;
let probesFile = null;
const wxLog = [];

try {
  await step('hud off', () => d.page.evaluate(() => window.__hud(false)));

  // Terrain/hydro settle happens exactly ONCE — time and weather do not
  // affect what tiles exist, only how they are lit.
  // A live spot streams real OSM/DEM/cover tiles over the relay rather than
  // replaying a captured, already-arrived fixture, and this doctrine records
  // that taking minutes (Vélizy: ~8) — so it gets a longer poll budget than
  // a fixture, which is deterministic and settles in well under a minute.
  const MAX_SETTLE_POLLS = argv.spot ? 90 : 40;
  await timed('viewready settle poll', async () => {
    let vr = null;
    let polls = 0;
    for (let i = 0; i < MAX_SETTLE_POLLS; i++) {
      await d.page.waitForTimeout(3000);
      polls++;
      vr = await d.page.evaluate(([x, z, r]) => window.__viewready(x, z, r), [TARGET.x, TARGET.z, 550]);
      const tilesStr = vr.tiles.map((t) => `${t.key}[h${t.height ? 1 : 0}m${t.mesh ? 1 : 0}d${t.dirty ? 1 : 0}]`).join(' ');
      log(`  poll ${polls}: ready=${vr.ready} fine=${vr.fineReady} (${tilesStr}) far=${vr.farReady} (home ${vr.far.home}/${vr.far.asked}, inFlight ${vr.far.inFlight}, queued ${vr.far.queued})`);
      if (vr.ready) break;
    }
    return vr;
  });

  await step('draw on (settle was blind)', () => d.page.evaluate(() => window.__draw(true)));

  // The same stamp the game's own ABOUT page shows as BUILD — a
  // <meta name="drive-build"> tag the harness/index.ts fills in when
  // serving the shell. Read directly rather than adding a devtool probe:
  // it's already on the page.
  build = await step('read build stamp', () => d.page.evaluate(
    () => document.querySelector('meta[name="drive-build"]')?.getAttribute('content') ?? null,
  ));
  log(`  build: ${build}`);

  // A broad snapshot of the world's own devtool probes AT TARGET, taken
  // once right after settle, BEFORE any shot — the physical-geometry
  // evidence (ground, water, hydro, mesh/tile stats) is time/weather-
  // invariant, so this is the one baseline reading that matters for "is
  // the hydro fix real". Each call is wrapped so a probe that doesn't
  // exist on this revision reports an error string instead of aborting
  // the whole dump.
  const probes = await timed('probe dump at TARGET', () => d.page.evaluate(([x, z, r]) => {
    const safe = (fn) => {
      try { return fn(); } catch (e) { return { error: String((e && e.message) || e) }; }
    };
    return {
      ground: safe(() => window.__ground(x, z)),
      hydro: safe(() => window.__hydro()),
      viewready: safe(() => window.__viewready(x, z, r)),
      wx: safe(() => window.__wx()),
      clock: safe(() => window.__clock()),
      tstats: safe(() => window.__tstats()),
      far: safe(() => window.__far()),
      census: safe(() => window.__census()),
      cover: safe(() => window.__cover()),
      built: safe(() => window.__built()),
      siteclim: safe(() => window.__siteclim(x, z)),
      sitecard: safe(() => window.__sitecard(x, z)),
      fixworld: safe(() => window.__fixworld()),
      wetmap: safe(() => window.__wetmap(120, 25)),
    };
  }, [TARGET.x, TARGET.z, 550]));
  const probeFails = Object.entries(probes).filter(([, v]) => v && typeof v === 'object' && 'error' in v).map(([k]) => k);
  log(`  probes: ${Object.keys(probes).length - probeFails.length}/${Object.keys(probes).length} ok${probeFails.length ? `, unavailable: ${probeFails.join(', ')}` : ''}`);
  probesFile = join(WORK, `probes_${RUN}.json`);
  writeFileSync(probesFile, JSON.stringify({ run: RUN, title: TITLE, target: TARGET, at: new Date().toISOString(), probes }, null, 2));
  log(`  wrote ${probesFile}`);

  for (let ri = 0; ri < ROWS.length; ri++) {
    const row = ROWS[ri];
    await timed(`ROW ${row} (${ri + 1}/${ROWS.length})`, async () => {
      await step(`${row}: timeset`, () => d.page.evaluate((m) => window.__timeset(m), row));
      // The dial's own ramp (clockRamp) eases the displayed hour over ~1.6s;
      // give the sky/shadow terms a couple of seconds beyond that to settle.
      await step(`${row}: post-timeset wait`, () => d.page.waitForTimeout(3500));

      await step(`${row}: wx clear (snap)`, () => d.page.evaluate(() => window.__wxnext('clear', true)));
      await step(`${row}: post-wx wait`, () => d.page.waitForTimeout(1000));

      for (const c of ANGLE_COLS) {
        const clk0 = await step(`${row}/${c.id}: __clock (before)`, () => d.page.evaluate(() => window.__clock()));
        await step(`${row}/${c.id}: godcam`, () => godcam(d, c));
        await step(`${row}/${c.id}: settle wait`, () => d.page.waitForTimeout(2200));
        const clk1 = await step(`${row}/${c.id}: __clock (after)`, () => d.page.evaluate(() => window.__clock()));
        log(`    fps ${clk0.fps}->${clk1.fps}, frames advanced ${clk1.frames - clk0.frames}, frameMs ${clk1.frameMs}`);
        await takeShot(row, c.id);
      }

      for (const wxName of WX_VARIANTS) {
        await step(`${row}/wx-${wxName}: snap`, () => d.page.evaluate((s) => window.__wxnext(s, true), wxName));
        const w = await step(`${row}/wx-${wxName}: read __wx`, () => d.page.evaluate(() => window.__wx()));
        log(`  ${row}/wx-${wxName}: cover=${w.regional.cover} rain=${w.regional.rain} sky=${w.regional.sky} wet=${w.local.wet}`);
        wxLog.push({ row, wxName, wx: w });
        await step(`${row}/wx-${wxName}: post-snap wait`, () => d.page.waitForTimeout(1500));
        await step(`${row}/wx-${wxName}: godcam`, () => godcam(d, WX_CAM));
        await step(`${row}/wx-${wxName}: settle wait`, () => d.page.waitForTimeout(2200));
        await takeShot(row, `wx-${wxName}`);
      }
    });
  }

  await timed(`DEV row (${ROWS.length + 1}/${ROWS.length + 1}, final section)`, async () => {
    await step('DEV: timeset NOON', () => d.page.evaluate(() => window.__timeset('NOON')));
    await step('DEV: post-timeset wait', () => d.page.waitForTimeout(2000));
    await step('DEV: wx clear (snap)', () => d.page.evaluate(() => window.__wxnext('clear', true)));

    // Tile debug + OSM vector ring, on the SAME 8 god-cam angles every
    // other row uses — see the comment by DEV_SHOTS above for the main.ts
    // fix that makes this draw without the HUD on. No __cam('top') detour,
    // no __place, no __zoom: __godcam() re-centres the overlay itself via
    // renderFocusXZ().
    await step('DEV: tiledbg on', () => d.page.evaluate(() => window.__tiledbg(true)));
    for (const c of ANGLE_COLS) {
      await step(`DEV/${c.id}: godcam`, () => godcam(d, c));
      await step(`DEV/${c.id}: settle wait`, () => d.page.waitForTimeout(1500));
      await takeShot('DEV', c.id);
    }
    await step('DEV: tiledbg off', () => d.page.evaluate(() => window.__tiledbg(false)));

    // Ground-view channels, one fixed framing so the channel is the only
    // variable — the same discipline the weather columns use. Already in
    // camMode='god' from the tiledbg loop above, so no explicit __cam
    // call is needed here.
    for (const gv of GV_VARIANTS) {
      await step(`DEV/gv-${gv}: set`, () => d.page.evaluate((v) => window.__groundview(v), gv));
      await step(`DEV/gv-${gv}: godcam`, () => godcam(d, WX_CAM));
      await step(`DEV/gv-${gv}: settle wait`, () => d.page.waitForTimeout(1500));
      await takeShot('DEV', `gv-${gv}`);
    }
    await step('DEV: groundview off', () => d.page.evaluate(() => window.__groundview('off')));

    // X-RAY: WIRE strips the whole scene to its actual collision geometry;
    // DEPTH is the 40x88 occlusion-verdict map main.ts's own HUD reads,
    // drawn full-screen UNDER the live instruments by design ("a wrong pin
    // can be argued with on the spot") — it only draws while hudOn, so this
    // is the one pair of shots in the row that briefly undoes the "HUD off"
    // default. Both use the close (near-ground) framing: the point of each
    // is what's near the truck, same reasoning as the weather columns.
    await step('DEV/xray-wire: godcam', () => godcam(d, WX_CAM));
    await step('DEV/xray-wire: set', () => d.page.evaluate(() => window.__xray('wire')));
    // The wire sweep only re-applies every 2000ms while on (its own
    // throttle, so streamed-in tiles arriving solid get caught) — wait
    // past that.
    await step('DEV/xray-wire: settle wait', () => d.page.waitForTimeout(2200));
    await takeShot('DEV', 'xray-wire');

    await step('DEV/xray-depth: hud on', () => d.page.evaluate(() => window.__hud(true)));
    await step('DEV/xray-depth: set', () => d.page.evaluate(() => window.__xray('depth')));
    await step('DEV/xray-depth: godcam', () => godcam(d, WX_CAM));
    await step('DEV/xray-depth: settle wait', () => d.page.waitForTimeout(1500));
    await takeShot('DEV', 'xray-depth');

    await step('DEV: xray off', () => d.page.evaluate(() => window.__xray('off')));
    await step('DEV: hud off (restore)', () => d.page.evaluate(() => window.__hud(false)));
  });

  log(`errors: ${JSON.stringify(d.errors)}`);
} finally {
  await timed('close', () => d.close());
}

// The ledger: every step, its cost, running total — the answer to "where
// did the time actually go" without re-deriving it from timestamps by eye.
console.log('\n--- STEP LEDGER ---');
let total = 0;
for (const { name, ms } of ledger) {
  total += ms;
  console.log(`${(ms / 1000).toFixed(2).padStart(7)}s  [running ${(total / 1000).toFixed(1)}s]  ${name}`);
}
console.log(`TOTAL: ${(total / 1000).toFixed(1)}s over ${ledger.length} steps, wall clock ${elapsed()}s`);

// The manifest is written best-effort — a run that errored partway still
// gets one, covering whatever was actually captured, rather than nothing.
// sheetFile is filled in below, in this same process, once the composite
// actually exists.
const manifestFile = join(WORK, `manifest_${RUN}.json`);
const manifest = {
  run: RUN,
  title: TITLE,
  description: DESCRIPTION,
  build,
  git: GIT,
  fixture: FIXTURE,
  target: TARGET,
  spot: SPOT,
  rows: ROWS,
  angleCols: ANGLE_COLS.map((c) => c.id),
  wxVariants: WX_VARIANTS,
  gvVariants: GV_VARIANTS,
  xrayCols: XRAY_COLS,
  images: outputs,
  wxLog,
  probesFile,
  sheetFile: null,
  startedAt: new Date(T0).toISOString(),
  finishedAt: new Date().toISOString(),
};
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------
// COMPOSITE, in this same process — no second command. Chromium is already
// a dependency here (the harness uses it), so this is an HTML grid page
// rendered and screenshotted whole; no ImageMagick/sharp/Pillow needed.
// ---------------------------------------------------------------------------

await timed('composite sheet', async () => {
  const COLS = [...manifest.angleCols, ...WX_VARIANTS.map((w) => `wx-${w}`)];
  const DEV_COLS = [...manifest.angleCols, ...GV_VARIANTS.map((g) => `gv-${g}`), ...XRAY_COLS];

  function pathFor(row, col) {
    const hit = outputs.find((im) => im.row === row && im.col === col);
    return hit ? hit.file : null;
  }

  const missing = [];
  function tableFor(rows, cols, sepAt) {
    let t = `<table>\n<tr><th class="corner"></th>${cols.map((c, i) => `<th${i === sepAt ? ' class="sep"' : ''}>${c}</th>`).join('')}</tr>\n`;
    for (const row of rows) {
      t += `<tr><th class="row-label">${row}</th>`;
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const path = pathFor(row, col);
        const cellClass = i === sepAt ? ' class="sep"' : '';
        if (path && existsSync(path)) {
          t += `<td${cellClass}><img src="file://${path}"></td>`;
        } else {
          missing.push(`${row}/${col}`);
          t += `<td${cellClass}><div class="missing">missing<br>${row}<br>${col}</div></td>`;
        }
      }
      t += '</tr>\n';
    }
    return t + '</table>';
  }

  // A sheet with no title/description/timestamp/location/git/build on it
  // is a picture nobody can attribute or make sense of a week later.
  // Escaped because every one of these values ultimately comes from
  // outside this exact string (argv, git, a served meta tag) even though
  // the risk here is local-tooling-only.
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const composedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const gitLabel = `${esc(GIT.branch ?? '?')}@${esc(GIT.commitShort ?? '?')}${GIT.dirty ? ' (dirty)' : ''}`;
  const headerHtml = `<div class="hdr">
      <div class="hdr-title">${esc(TITLE)}</div>
      <div class="hdr-desc">${esc(DESCRIPTION)}</div>
      <div class="hdr-row"><b>run</b> ${esc(RUN)} &middot; <b>captured</b> ${esc(manifest.startedAt)} &rarr; ${esc(manifest.finishedAt)} &middot; <b>composited</b> ${composedAt}</div>
      <div class="hdr-row"><b>location</b> ${esc(FIXTURE ? `fixture=${FIXTURE}` : SPOT.replace(/&nodraw=1&wxlive=0$/, ''))} target (${TARGET.x}, ${TARGET.z})</div>
      <div class="hdr-row"><b>git</b> ${gitLabel} &middot; <b>build</b> ${esc(build ?? 'unknown')} <span style="color:#666">(harness stamp, not a deploy hash)</span></div>
    </div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#0b0b0b; font-family: -apple-system, monospace; color:#e8e8e8; }
  table { border-collapse: collapse; margin-bottom: 24px; }
  td, th { border: 1px solid #333; padding: 3px; text-align:center; vertical-align:middle; }
  th { background:#1a1a1a; font-size:13px; white-space:nowrap; }
  th.row-label { writing-mode: vertical-rl; transform: rotate(180deg); font-size:15px; }
  img { display:block; width: ${CELL_W}px; height:auto; }
  .missing { width:${CELL_W}px; height:${Math.round(CELL_W * 844 / 390)}px; background:#300;
             color:#f88; font-size:11px; display:flex; align-items:center; justify-content:center; }
  .corner { background:#000; }
  .sep th { border-left: 3px solid #555; }
  h2 { font-size:14px; color:#8cf; margin: 4px 0; }
  .hdr { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #333; max-width: 900px; }
  .hdr-title { font-size: 20px; font-weight: bold; color: #fff; margin-bottom: 6px; }
  .hdr-desc { font-size: 13px; color: #ccc; font-style: italic; line-height: 1.5; margin-bottom: 8px;
              padding: 8px 10px; background: #161616; border-left: 3px solid #8cf; white-space: pre-wrap; }
  .hdr-row { font-size: 12px; color: #aaa; margin-top: 2px; }
  .hdr-row b { color: #8cf; }
</style></head><body>
${headerHtml}
${tableFor(ROWS, COLS, manifest.angleCols.length)}
<h2>DEV — same 8 angles with tile debug (incl. OSM z16 vector ring) · ground-view channels · X-RAY wire/depth</h2>
${tableFor(['DEV'], DEV_COLS, manifest.angleCols.length)}
</body></html>`;

  const htmlPath = join(WORK, `_contact-sheet_${RUN}.html`);
  writeFileSync(htmlPath, html);
  if (missing.length) log(`  MISSING cells: ${missing.join(', ')}`);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
  await page.screenshot({ path: OUT, fullPage: true });
  await browser.close();
});

manifest.sheetFile = OUT;
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

console.log('\n--- OUTPUTS ---');
console.log(`run:         ${RUN}`);
console.log(`title:       ${TITLE}`);
for (const o of outputs) console.log(`  ${o.row}/${o.col}: ${o.file}`);
console.log(`manifest:    ${manifestFile}`);
console.log(`probes:      ${probesFile}`);
console.log(`sheet:       ${OUT}`);
