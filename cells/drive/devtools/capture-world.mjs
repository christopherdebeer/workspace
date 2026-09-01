/**
 * CAPTURE A REAL PLACE AS A PLAYABLE FIXTURE.
 *
 *   node cells/drive/devtools/capture-world.mjs NAME --lat=.. --lon=.. [--r=700]
 *
 * The world arrives through exactly three fetches — a terrarium height tile, a
 * WorldCover class tile and a vector tile of OSM ways — so a fixture that
 * answers those three IS the world, and the entire production pipeline runs
 * against it with no network at all. `world-fixtures.ts` has authored ones; this
 * makes captured ones, from somewhere that actually goes wrong.
 *
 * WHY THIS EXISTS. Reproducing a real defect meant booting the streaming world
 * at its coordinates: six minutes through the harness's curl relay, different
 * every run because tile arrival order is weather, and half the frames taken
 * before the world had finished arriving. The two Big Sur reports that prompted
 * this each cost that, twice, and the second one told me nothing the first had
 * not. A captured fixture is ~40 seconds, identical every time, and can be
 * checked in beside the bug it reproduces.
 *
 * NO BROWSER. `devtools/capture.mjs` records a live session's renderWays calls
 * in arrival order, which is the right tool for solver-ordering defects and the
 * wrong one here — it needs the slow boot it is trying to replace, and what it
 * captures replays into the solver rather than into a world you can look at.
 * All three sources are plain HTTPS: the cell serves the ways and the cover, and
 * the DEM comes from AWS. So this is three fetches and some arithmetic.
 *
 * WHAT IT DELIBERATELY DOES NOT CAPTURE: arrival order. A captured world is a
 * world that has ALREADY ARRIVED — every tile present from the first frame.
 * That makes it useless for "it only happens on a drive-in and not on a reload"
 * (capture.mjs is for that) and ideal for everything else, because a defect that
 * survives a settled world is a defect in the geometry rather than in the
 * streaming.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, CELL, ROOT } from './harness.mjs';

// THE SHIPPING CONDITIONER, NOT A COPY OF IT. See client/demrepair.ts: a raw
// terrarium pixel is not what the game builds, and a fixture captured from raw
// pixels reproduces corruption the game repairs. esbuild it into the repo (the
// same route every other tool here takes to a client module) and import it.
const dmOut = join(ROOT, 'node_modules/.cache/drive-demrepair.mjs');
mkdirSync(join(ROOT, 'node_modules/.cache'), { recursive: true });
execFileSync('npx', ['esbuild', join(CELL, 'client/demrepair.ts'),
  '--bundle', '--format=esm', `--outfile=${dmOut}`], { stdio: 'pipe', cwd: ROOT });
const { demBad, demFloor, demPatch, demSpikes, repairDem } = await import(dmOut);
// …and the shipping clipper, for the same reason. `captured()` clips every way
// to the captured box when it reads the file, so geometry outside it is bytes
// that are decoded, parsed and then thrown away on every boot. Paris arrived at
// 2,289KB; the tag trim took it to 1,578KB and this takes the rest.
const clOut = join(ROOT, 'node_modules/.cache/drive-clip.mjs');
execFileSync('npx', ['esbuild', join(CELL, 'client/clip.ts'),
  '--bundle', '--format=esm', `--outfile=${clOut}`], { stdio: 'pipe', cwd: ROOT });
const { clipToBounds } = await import(clOut);

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? 'capture';
const num = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a === undefined ? d : Number(a.slice(k.length + 3));
};
const lat = num('lat', NaN), lon = num('lon', NaN);
const R = num('r', 700);              // half-width of the captured box, metres
if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error('need --lat= and --lon=');
  process.exit(1);
}

const CELL_BASE = process.env.DRIVE_CELL ?? 'https://c15r-drive.on.parc.land';
const OSM_Z = 16, COVER_Z = 12, DEM_Z = 14;
/** The projection the game uses at its own origin — flat, and the same
 *  constants, so a captured way lands where the live one did. */
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((lat * Math.PI) / 180);

const lonOf = (e) => lon + e / M_LON;
const latOf = (s) => lat - s / M_LAT;
/** Fractional tile coordinates, so a sample can be bilinear rather than nearest
 *  — a 7.7m DEM pixel taken nearest-neighbour puts 7.7m stair-steps in the
 *  ground, and a road profile solved over stair-steps is not the road. */
const tileXY = (la, lo, z) => {
  const n = 2 ** z;
  const r = (la * Math.PI) / 180;
  return [
    ((lo + 180) / 360) * n,
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  ];
};

/** A 503 from a cold tile is the edge giving up while the Lambda finishes and
 *  BANKS the result — the next request is a CDN hit. That self-healing is the
 *  whole design of the tile bank, so a retry here is not papering over a
 *  failure, it is the documented second half of the first request. */
async function get(url, tries = 6, orNull = false) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (i === tries - 1) {
      if (orNull) return null;
      throw new Error(`${url}: HTTP ${res.status} after ${tries} tries`);
    }
    // BACKED OFF PAST THE LAMBDA, NOT PAST THE EDGE. The edge gives up at
    // ~15.5s while the cell has 50s to finish and bank, so a ladder totalling
    // NINE seconds spends all four of its tries inside one upstream build and
    // then declares the tile dead — it never once asks a question the cell has
    // had time to answer. That is what a dense cold z16 over Paris did: four
    // tries, four 503s, capture aborted. 3+6+9+12+15 = 45s straddles the whole
    // budget instead.
    const wait = 3000 * (i + 1);
    // Two segments of path: enough to say WHICH tile without the host. `/~/`
    // is not in the AWS DEM url, so this cannot key off it.
    if (i === 1) console.log(`  ...${url.split('/').slice(-3).join('/')} is cold; waiting for the cell to bank it`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error('unreachable');
}

/** Every tile of one layer that the box touches. */
function tileRange(z) {
  const [x0, y0] = tileXY(latOf(-R), lonOf(-R), z);
  const [x1, y1] = tileXY(latOf(R), lonOf(R), z);
  const out = [];
  for (let x = Math.floor(Math.min(x0, x1)); x <= Math.floor(Math.max(x0, x1)); x++) {
    for (let y = Math.floor(Math.min(y0, y1)); y <= Math.floor(Math.max(y0, y1)); y++) {
      out.push([x, y]);
    }
  }
  return out;
}

/**
 * ── A CAPTURE CARRIES WHAT THE GAME READS, AND NOT THE REST ──
 *
 * The Paris capture came to 2,289KB, which is most of a bundle for one place,
 * and 973KB of that was TAGS. `source` alone was 511KB — the OSM contributor's
 * note about where they got the data, on five thousand buildings, carried into
 * a game bundle that has never once looked at it. Also present and unread:
 * addr:*, phone, website, email, fax, wikidata, opening hours, every name:xx
 * translation.
 *
 * This is the game's own KEEP_TAGS (main.ts), which is the list writeTileCache
 * already applies before anything reaches IndexedDB — so a captured way now
 * carries exactly what a streamed one does, and no capture can accidentally
 * test the renderer on a tag the live world would have thrown away.
 *
 * The extras beyond that list are deliberate and few: `lanes` and its family
 * are kept-but-unread TODAY, and the whole reason the Camps Bay capture is
 * interesting is that width ignores them — a capture that dropped them could
 * not be used to fix that. `oneway`, `width`, `junction` and `ref` are the same
 * bet, small and specific.
 */
const KEEP_TAGS = new Set([
  'highway', 'building', 'building:levels', 'natural', 'waterway', 'landuse',
  'leisure', 'tunnel', 'bridge', 'layer', 'name', 'amenity', 'shop', 'surface',
  'smoothness', 'tracktype', 'height', 'building:height', 'roof:shape',
  'roof:levels', 'roof:colour', 'building:colour', 'building:material',
  'religion', 'denomination', 'man_made', 'power', 'generator:source',
  'historic', 'aeroway', 'content', 'covered', 'cutting', 'embankment',
  'incline', 'maxheight',
  // …and the carriageway-width evidence the renderer does not read yet.
  'lanes', 'lanes:forward', 'lanes:backward', 'oneway', 'width', 'junction', 'ref',
]);
const keepTags = (t) => {
  const out = {};
  for (const k of Object.keys(t ?? {})) if (KEEP_TAGS.has(k)) out[k] = t[k];
  return out;
};

// ── the ways ───────────────────────────────────────────────────────
// ONE TILE THAT WILL NOT BUILD MUST NOT COST THE OTHER EIGHT.
//
// Paris is the case. The cell's Overpass budget is 44s and a dense central z16
// can exceed it outright — CLAUDE.md says so — so a capture that throws on the
// first refusal spends four minutes fetching, warms the bank for every tile it
// touched, and then writes nothing. Worse, the tiles it DID get are the
// expensive ones: each run banks what it managed, so aborting discards exactly
// the progress that would have made the next run cheap.
//
// So a refused vector tile is RECORDED and the capture goes on. It is named in
// the output, because a fixture missing a corner of its road network is a fact
// about the fixture and not something to find out later from a hole in it. Run
// the capture again and the banked tiles come back instantly; the ones that
// genuinely cannot be built stay named.
// ── AND FETCHED SIDE BY SIDE, BECAUSE A LADDER IS SPENT WAITING ──
//
// The first cut asked for one tile at a time. Measured over Paris: 20 vector
// tiles, and a cold one costs six attempts of ~13s edge timeout plus 45s of
// backoff — about two minutes each, so twenty of them is FORTY MINUTES. Worse,
// it is forty minutes in which the cell is only ever building ONE tile: the
// whole point of the ladder is to give the Lambda time to finish and bank, and
// serialising means every tile waits out its own build alone.
//
// Four at a time is the game's own shape (OSM_GATE is 6, and this is a devtool
// that should ask for less than a player does). The waiting overlaps, so the
// wall clock is the slowest tile rather than the sum of all of them, and the
// cell builds four at once.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const ways = [];
const seen = new Set();
const missing = [];
const osmTiles = tileRange(OSM_Z);
console.log(`  fetching ${osmTiles.length} vector tiles, 4 at a time...`);
const bufs = await pool(osmTiles, 4, ([x, y]) =>
  get(`${CELL_BASE}/~/osm/v3/${OSM_Z}/${x}/${y}`, 6, true));
for (let ti = 0; ti < osmTiles.length; ti++) {
  const [x, y] = osmTiles[ti];
  const buf = bufs[ti];
  if (!buf) { missing.push(`${OSM_Z}/${x}/${y}`); continue; }
  const tile = JSON.parse(buf.toString('utf8'));
  for (const w of tile.ways ?? []) {
    // One OSM way reaches several tiles clipped differently. Keyed by id AND
    // endpoints for the reason fixtures/load.mjs records: collapsing by id
    // alone deletes the clip that is under test.
    const g = w.geometry ?? [];
    if (!g.length) continue;
    // GEOMETRY IS [lat, lon] PAIRS, not {lat, lon} objects. Written as objects
    // first, which produced NaN for every coordinate — and NaN fails the box
    // test silently, so the capture reported "0 ways" as though the place had
    // no roads rather than as though the reader was wrong.
    const k = `${w.id}:${g.length}:${g[0][0]},${g[0][1]}:${g[g.length - 1][0]},${g[g.length - 1][1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // A DECIMETRE is finer than anything downstream reads a way at — the
    // solver densifies to 12m stations — and it is 10% of the file.
    const pts = g.map(([la, lo]) => [
      +((lo - lon) * M_LON).toFixed(1),
      +((lat - la) * M_LAT).toFixed(1),
    ]);
    // Keep anything that comes within the box; a way that merely passes nearby
    // still shapes the junction at its edge.
    if (!pts.some(([e, s]) => Math.abs(e) < R * 1.4 && Math.abs(s) < R * 1.4)) continue;
    // CLIPPED TO THE BOX HERE TOO, and to exactly the box `captured()` will
    // clip it to. The height grid spans +/-R and clamps to its edge row beyond,
    // so a way carried further than that is road over invented ground — which
    // the reader already refuses. Writing it out anyway only costs bytes.
    //
    // North is -s and east is e: a relabelling, because the clipper's box is
    // named in lat/lon and the arithmetic is affine.
    for (const run of clipToBounds(pts.map(([e, s]) => ({ lat: -s, lon: e })),
      { latN: R, latS: -R, lonW: -R, lonE: R })) {
      if (run.length < 2) continue;      // a corner graze has no length to build from
      ways.push({ id: w.id, tags: keepTags(w.tags),
        pts: run.map((q) => [+q.lon.toFixed(1), +(-q.lat).toFixed(1)]) });
    }
  }
}

// ── the heights ────────────────────────────────────────────────────
// Terrarium: elevation = R*256 + G + B/256 - 32768. Sampled onto a regular
// grid over the box at roughly the DEM's own resolution — resampling finer
// would invent detail the source does not have, and coarser would lose the
// pixel-to-pixel roll that is the whole difficulty of a cliff road.
const demTiles = new Map();
const demReport = [];
const demRange = tileRange(DEM_Z);
const demBufs = await pool(demRange, 4, ([x, y]) =>
  get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_Z}/${x}/${y}.png`));
for (let di = 0; di < demRange.length; di++) {
  const [x, y] = demRange[di];
  const t = decodePng(demBufs[di]);
  // Terrarium: elevation = R*256 + G + B/256 - 32768.
  let e = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const o = i * t.ch;
    e[i] = t.px[o] * 256 + t.px[o + 1] + t.px[o + 2] / 256 - 32768;
  }
  // Looped, not `Math.min(...e)`: that spreads 65,536 arguments onto the call
  // stack, which is a stack overflow waiting for a slightly bigger tile.
  let rlo = Infinity, rhi = -Infinity;
  for (let i = 0; i < e.length; i++) { if (e[i] < rlo) rlo = e[i]; if (e[i] > rhi) rhi = e[i]; }
  const raw = [rlo, rhi];
  // Metres per pixel at THIS tile's latitude — the tests are statements about
  // the ground, so they are made in ground units.
  const tLat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** DEM_Z))) * 180) / Math.PI;
  const mpp = (40075016.686 * Math.cos((tLat * Math.PI) / 180)) / (2 ** DEM_Z * 256);
  // A capture is always the FINE layer, so it always gets the fine floor: -500m
  // says "land, near enough", and a reading below the Dead Sea in 2km of ground
  // the truck drives on is a decode error rather than bathymetry.
  const floor = demFloor(DEM_Z, DEM_Z);
  const bad = demBad(e, floor);
  const spikes = demSpikes(e, mpp);
  // A TILE THE GAME WOULD REFUSE IS NOT A TILE THE FIXTURE MAY KEEP. The game
  // returns null and the streamer asks again; a capture has nobody to ask, so
  // it says so out loud rather than banking ground the game would never build.
  const refused = bad > e.length * 0.02 ? 'range' : spikes > e.length * 0.03 ? 'spiked' : null;
  if (bad) demPatch(e, floor);
  let fixed = 0;
  e = repairDem(e, mpp, (_, n) => { fixed = n; });
  demTiles.set(`${x}/${y}`, e);
  demReport.push({ x, y, raw, bad, spikes, fixed, refused });
}
const demMetresPerPx = (40075016.7 / 2 ** DEM_Z) * Math.cos((lat * Math.PI) / 180) / 256;
const HN = Math.max(24, Math.min(256, Math.ceil((2 * R) / demMetresPerPx) + 1));
const hstep = (2 * R) / (HN - 1);
/** One conditioned pixel, addressed on the GLOBAL pixel grid — so a sample
 *  straddling a tile edge resolves each corner in its own tile rather than
 *  clamping to the edge of one. */
const elevPx = (gx, gy) => {
  const t = demTiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
  if (!t) return null;
  return t[(((gy % 256) + 256) % 256) * 256 + (((gx % 256) + 256) % 256)];
};
/** Bilinear, as the grid comment above promises. It used to round, which is a
 *  7.7m stair-step in ground a road profile is then solved over. */
const elevAt = (e, s) => {
  const [fx, fy] = tileXY(latOf(s), lonOf(e), DEM_Z);
  const gx = fx * 256 - 0.5, gy = fy * 256 - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const tx = gx - x0, ty = gy - y0;
  const a = elevPx(x0, y0), b = elevPx(x0 + 1, y0), c = elevPx(x0, y0 + 1), d = elevPx(x0 + 1, y0 + 1);
  if (a === null) return 0;
  const e0 = a * (1 - tx) + (b ?? a) * tx;
  const e1 = (c ?? a) * (1 - tx) + (d ?? b ?? a) * tx;
  return e0 * (1 - ty) + e1 * ty;
};
// BASE64 Int16 CENTIMETRES, not JSON integers. The height grid is the largest
// thing in a capture by some way — 55,696 samples came to 325KB written out as
// numbers, which is most of a bundle for one place. Two bytes a sample is a
// third of that, and centimetres are already far finer than a 7.7m DEM pixel
// earns. Stored relative to the site's own floor so the range always fits an
// Int16: the whole Earth's relief does not, one 1.4km box always does.
const raw = new Int16Array(HN * HN);
const abs = [];
for (let j = 0; j < HN; j++) {
  for (let i = 0; i < HN; i++) abs.push(elevAt(-R + i * hstep, -R + j * hstep));
}
const base = Math.floor(Math.min(...abs));
for (let i = 0; i < abs.length; i++) {
  raw[i] = Math.max(-32768, Math.min(32767, Math.round((abs[i] - base) * 100)));
}
const heights = Buffer.from(raw.buffer).toString('base64');

// ── the cover ──────────────────────────────────────────────────────
const covTiles = new Map();
{
  const range = tileRange(COVER_Z);
  const bufs = await pool(range, 4, ([x, y]) =>
    get(`${CELL_BASE}/~/cover/v1/${COVER_Z}/${x}/${y}`, 6, true));
  // A missing cover tile is grass, not a failed capture.
  for (let i = 0; i < range.length; i++) {
    if (bufs[i]) covTiles.set(`${range[i][0]}/${range[i][1]}`, decodePng(bufs[i]));
  }
}
const CN = 64;
const cstep = (2 * R) / (CN - 1);
const cover = [];
for (let j = 0; j < CN; j++) {
  for (let i = 0; i < CN; i++) {
    const e = -R + i * cstep, s = -R + j * cstep;
    const [fx, fy] = tileXY(latOf(s), lonOf(e), COVER_Z);
    const t = covTiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
    if (!t) { cover.push(30); continue; }
    const px = Math.min(255, Math.max(0, Math.round((fx - Math.floor(fx)) * 256)));
    const py = Math.min(255, Math.max(0, Math.round((fy - Math.floor(fy)) * 256)));
    // The raster stores the CLASS INDEX in red — it is a number, not a colour,
    // which is why nothing here goes near a colour space.
    cover.push(t.px[(py * t.w + px) * t.ch]);
  }
}

const out = {
  name, origin: { lat, lon }, r: R,
  captured: new Date().toISOString().slice(0, 10),
  height: { n: HN, step: +hstep.toFixed(3), base, b64: heights },
  cover: { n: CN, step: +cstep.toFixed(3), px: cover },
  ways,
};
const dir = join(CELL, 'client/fixtures');
mkdirSync(dir, { recursive: true });
const path = join(dir, `world-${name}.json`);
writeFileSync(path, JSON.stringify(out));
const hs = abs;
console.log(`captured ${name} at ${lat},${lon} r=${R}m`);
console.log(`  ways    ${ways.length} (${ways.filter((w) => w.tags.highway).length} highway)`);
if (missing.length) {
  console.log(`  ** ${missing.length} VECTOR TILE(S) NEVER BUILT: ${missing.join(' ')}`);
  console.log('     Those corners have no roads in them. Re-run to retry — every');
  console.log('     tile that DID land is banked now, so a second pass is cheap.');
}
console.log(`  heights ${HN}x${HN} @ ${hstep.toFixed(1)}m  ${Math.min(...hs).toFixed(0)}..${Math.max(...hs).toFixed(0)}m`);
for (const t of demReport) {
  const dirty = t.bad || t.spikes || t.fixed || t.refused;
  console.log(`  dem ${DEM_Z}/${t.x}/${t.y} raw ${t.raw[0].toFixed(0)}..${t.raw[1].toFixed(0)}m`
    + (dirty ? `  bad ${t.bad}  spiked ${t.spikes}  repaired ${t.fixed}px`
      + (t.refused ? `  ** THE GAME WOULD REFUSE THIS TILE (${t.refused}) **` : '') : '  clean'));
}
console.log(`  cover   ${CN}x${CN} @ ${cstep.toFixed(1)}m  classes ${[...new Set(cover)].sort((a, b) => a - b).join(',')}`);
console.log(`  -> ${path}  (${(JSON.stringify(out).length / 1024).toFixed(0)}KB)`);
