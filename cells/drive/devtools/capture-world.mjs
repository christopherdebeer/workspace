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
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, CELL } from './harness.mjs';

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
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (i === tries - 1) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
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

// ── the ways ───────────────────────────────────────────────────────
const ways = [];
const seen = new Set();
for (const [x, y] of tileRange(OSM_Z)) {
  const buf = await get(`${CELL_BASE}/~/osm/v3/${OSM_Z}/${x}/${y}`);
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
    const pts = g.map(([la, lo]) => [
      +((lo - lon) * M_LON).toFixed(2),
      +((lat - la) * M_LAT).toFixed(2),
    ]);
    // Keep anything that comes within the box; a way that merely passes nearby
    // still shapes the junction at its edge.
    if (!pts.some(([e, s]) => Math.abs(e) < R * 1.4 && Math.abs(s) < R * 1.4)) continue;
    ways.push({ id: w.id, tags: w.tags ?? {}, pts });
  }
}

// ── the heights ────────────────────────────────────────────────────
// Terrarium: elevation = R*256 + G + B/256 - 32768. Sampled onto a regular
// grid over the box at roughly the DEM's own resolution — resampling finer
// would invent detail the source does not have, and coarser would lose the
// pixel-to-pixel roll that is the whole difficulty of a cliff road.
const demTiles = new Map();
for (const [x, y] of tileRange(DEM_Z)) {
  const buf = await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_Z}/${x}/${y}.png`);
  demTiles.set(`${x}/${y}`, decodePng(buf));
}
const demMetresPerPx = (40075016.7 / 2 ** DEM_Z) * Math.cos((lat * Math.PI) / 180) / 256;
const HN = Math.max(24, Math.min(256, Math.ceil((2 * R) / demMetresPerPx) + 1));
const hstep = (2 * R) / (HN - 1);
const elevAt = (e, s) => {
  const [fx, fy] = tileXY(latOf(s), lonOf(e), DEM_Z);
  const t = demTiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
  if (!t) return 0;
  const px = Math.min(255, Math.max(0, Math.round((fx - Math.floor(fx)) * 256)));
  const py = Math.min(255, Math.max(0, Math.round((fy - Math.floor(fy)) * 256)));
  const i = (py * t.w + px) * t.ch;
  return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
};
const heights = [];
for (let j = 0; j < HN; j++) {
  for (let i = 0; i < HN; i++) {
    heights.push(Math.round(elevAt(-R + i * hstep, -R + j * hstep) * 100));
  }
}

// ── the cover ──────────────────────────────────────────────────────
const covTiles = new Map();
for (const [x, y] of tileRange(COVER_Z)) {
  try {
    const buf = await get(`${CELL_BASE}/~/cover/v1/${COVER_Z}/${x}/${y}`);
    covTiles.set(`${x}/${y}`, decodePng(buf));
  } catch { /* a missing cover tile is grass, not a failed capture */ }
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
  height: { n: HN, step: +hstep.toFixed(3), cm: heights },
  cover: { n: CN, step: +cstep.toFixed(3), px: cover },
  ways,
};
const dir = join(CELL, 'client/fixtures');
mkdirSync(dir, { recursive: true });
const path = join(dir, `world-${name}.json`);
writeFileSync(path, JSON.stringify(out));
const hs = heights.filter((v) => v > -30000);
console.log(`captured ${name} at ${lat},${lon} r=${R}m`);
console.log(`  ways    ${ways.length} (${ways.filter((w) => w.tags.highway).length} highway)`);
console.log(`  heights ${HN}x${HN} @ ${hstep.toFixed(1)}m  ${(Math.min(...hs) / 100).toFixed(0)}..${(Math.max(...hs) / 100).toFixed(0)}m`);
console.log(`  cover   ${CN}x${CN} @ ${cstep.toFixed(1)}m  classes ${[...new Set(cover)].sort((a, b) => a - b).join(',')}`);
console.log(`  -> ${path}  (${(JSON.stringify(out).length / 1024).toFixed(0)}KB)`);
