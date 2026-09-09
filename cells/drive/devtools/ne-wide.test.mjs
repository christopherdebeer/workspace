/**
 * THE BAKED WIDE CHART, HELD.
 *
 *   node cells/drive/devtools/ne-wide.test.mjs
 *
 * Pure: esbuild the module and import it, the route `culture.test.mjs` takes.
 * Seconds, no browser, no network, no Overpass — which is the entire point of
 * the change under test, so a test that needed any of them would be arguing
 * against it.
 *
 * What this has to prove is not "it returns something". The rungs it replaces
 * failed by returning nothing at all, and the way THIS layer would fail is by
 * returning something plausible and wrong: a tile that is empty where the world
 * has roads, geometry that has escaped its box, or a ladder that has quietly
 * stopped being a ladder.
 */
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..');
// The module reads `join(__dirname, 'static', 'ne-wide.b64')`, so the bundle has
// to sit where the asset is — one directory above `static/`, exactly as it does
// on the Lambda. Writing it to /tmp would fail the read and the test would be
// measuring its own scaffolding.
const OUT = join(CELL, 'node_modules', '.cache', 'ne-wide-test');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(CELL, '.ne-wide.test.mjs');
await build({
  entryPoints: [join(CELL, 'ne-wide.ts')], outfile: BUNDLE,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'error',
  // __dirname does not exist in an ESM bundle; the module uses it to find the
  // asset, so it is defined to the cell root — which is what it resolves to on
  // /var/task.
  define: { __dirname: JSON.stringify(CELL) },
});
const { neWide, neWideTile, NE_SCALERANK, NE_PLACE_RANK, NE_MAX_Z } = await import(`file://${BUNDLE}?${Date.now()}`);

function tileOf(lat, lon, z) {
  const n = 2 ** z, la = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n)];
}
function boundsOf(z, x, y) {
  const n = 2 ** z;
  const lat = (i) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * i) / n))) * 180) / Math.PI;
  return { latN: lat(y), latS: lat(y + 1), lonW: (x / n) * 360 - 180, lonE: ((x + 1) / n) * 360 - 180 };
}

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

// ── the asset loads ────────────────────────────────────────────────────
const set = neWide();
assert(set, 'ne-wide.b64 did not decode — run devtools/bake-ne-roads.mjs');
console.log(`decoded ${set.lines.length} lines, ${set.places.length} places, ` +
  `${(set.bytes / 1048576).toFixed(2)}MB in ${set.ms}ms`);
check(set.ms < 2000, `cold decode under 2s (${set.ms}ms) — it is paid once per Lambda`);

// ── COVERAGE: the whole reason this dataset was chosen ─────────────────
// A wide chart that works in France and is blank in the Karoo is the same
// failure with a new cause, so every place the game is actually driven gets an
// assertion. The bar is "there is a network here", not a count.
//
// THE UNIT IS THE RING, NOT THE TILE, AND THE FIRST CUT OF THIS TEST GOT THAT
// WRONG. It asserted a road in the tile under each spot and failed at the
// Serengeti and the Sundarbans — correctly reporting that those particular 78km
// boxes hold no major road, which is a fact about the Serengeti and not a
// defect in anything. A plain is allowed to be empty. What is NOT allowed is
// for the chart to be empty, and the chart never shows one tile: `ovLevelFor`
// picks the rung so that the 5x5 ring at `OV_RING_MAX` covers the view. So the
// assertion is made over the ring the client actually asks for.
//
// An assertion about one tile was an assertion about the world; an assertion
// about the ring is an assertion about what a player sees.
console.log('\nplaces the game is driven — the ring the chart asks for must carry roads:');
const SPOTS = [
  ['Cape Town', -33.93, 18.42], ['Senqu (Lesotho)', -30.71, 27.75],
  ['Paris', 48.86, 2.35], ['Big Sur', 36.27, -121.81],
  ['Yosemite', 37.75, -119.59], ['Serengeti', -2.33, 34.83],
  ['Outback (Alice)', -23.70, 133.88], ['Sundarbans', 21.95, 89.18],
];
const RING = 2;                       // OV_RING_MAX in client/main.ts: 5x5
for (const [name, lat, lon] of SPOTS) {
  const got = [];
  for (const z of [7, 8, 9]) {
    const [cx, cy] = tileOf(lat, lon, z);
    let n = 0;
    for (let dx = -RING; dx <= RING; dx++) {
      for (let dy = -RING; dy <= RING; dy++) {
        const span = 2 ** z;
        const x = ((cx + dx) % span + span) % span;   // longitude wraps; the world does
        const y = cy + dy;
        if (y < 0 || y >= span) continue;
        n += (neWideTile(z, x, y) ?? []).length;
      }
    }
    got.push(n);
  }
  check(got.every((n) => n > 0), `${name.padEnd(16)} 5x5 ring at z7/z8/z9 = ${got.join('/')} features`);
}

// ── THE LADDER IS A LADDER ─────────────────────────────────────────────
// The fault this replaces is z8, z9 and z10 asking for one class set over
// sixteen, four and one times the area. The baked rungs must be monotone in
// what they admit, and a coarser rung must not be DENSER per unit area than a
// finer one — which is the property "not a ladder" actually violates.
console.log('\nthe rungs admit progressively more:');
check(NE_SCALERANK[7] < NE_SCALERANK[8] && NE_SCALERANK[8] < NE_SCALERANK[9],
  `scalerank cuts strictly increase: ${NE_SCALERANK[7]} < ${NE_SCALERANK[8]} < ${NE_SCALERANK[9]}`);
check(NE_PLACE_RANK[7] < NE_PLACE_RANK[8] && NE_PLACE_RANK[8] < NE_PLACE_RANK[9],
  `place rank cuts strictly increase: ${NE_PLACE_RANK[7]} < ${NE_PLACE_RANK[8]} < ${NE_PLACE_RANK[9]}`);
{
  // Same ground, three rungs: a z7 tile over Europe against the four z8 and
  // sixteen z9 tiles inside it. Feature count must rise, and the count PER TILE
  // must stay in a band a chart can draw — that band is the thing the old
  // ladder had no opinion about.
  const [x7, y7] = tileOf(48.86, 2.35, 7);
  const n7 = (neWideTile(7, x7, y7) ?? []).length;
  let n8 = 0, n9 = 0, worst8 = 0, worst9 = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
    const c = (neWideTile(8, x7 * 2 + dx, y7 * 2 + dy) ?? []).length;
    n8 += c; worst8 = Math.max(worst8, c);
  }
  for (let dx = 0; dx < 4; dx++) for (let dy = 0; dy < 4; dy++) {
    const c = (neWideTile(9, x7 * 4 + dx, y7 * 4 + dy) ?? []).length;
    n9 += c; worst9 = Math.max(worst9, c);
  }
  console.log(`  Paris z7 tile: ${n7} features; its 4 z8 children ${n8} (worst ${worst8}); its 16 z9 ${n9} (worst ${worst9})`);
  check(n8 >= n7 && n9 >= n8, 'a finer rung over the same ground carries at least as much');
  check(worst9 < 4000 && worst8 < 4000,
    `no single tile is a wall of geometry (worst ${Math.max(worst8, worst9)} features)`);
}

// ── GEOMETRY STAYS IN ITS BOX ──────────────────────────────────────────
// `out geom` upstream returns a matched way's WHOLE geometry, which is how one
// coastline drags a continent into a 156km tile. The clip here exists so that
// cannot happen, and it keeps one point either side of the edge on purpose, so
// the assertion is "close to the box", not "inside it".
console.log('\ngeometry is clipped to the tile:');
{
  const [x, y] = tileOf(-33.93, 18.42, 8);
  const b = boundsOf(8, x, y);
  const w = b.lonE - b.lonW, h = b.latN - b.latS;
  const ways = neWideTile(8, x, y) ?? [];
  let worst = 0, pts = 0;
  for (const wy of ways) {
    for (const g of wy.geometry ?? []) {
      pts++;
      const dx = Math.max(0, b.lonW - g.lon, g.lon - b.lonE) / w;
      const dy = Math.max(0, b.latS - g.lat, g.lat - b.latN) / h;
      worst = Math.max(worst, dx, dy);
    }
    if (wy.lat !== undefined) {
      pts++;
      check(wy.lat >= b.latS && wy.lat <= b.latN && wy.lon >= b.lonW && wy.lon <= b.lonE,
        `place ${wy.tags?.name} is inside the tile`);
    }
  }
  console.log(`  Cape Town z8: ${ways.length} features, ${pts} points`);
  check(worst < 1.0, `no point more than one tile-width outside the box (worst ${(worst * 100).toFixed(0)}% of a tile)`);
  check(ways.every((wy) => (wy.geometry?.length ?? 1) >= 2 || wy.lat !== undefined),
    'no degenerate single-point way (a one-point ribbon has no direction to build from)');
}

// ── IT SPEAKS OSM, BECAUSE THE CLIENT MUST NOT KNOW ────────────────────
console.log('\nthe answer is shaped like an Overpass answer:');
{
  const [x, y] = tileOf(48.86, 2.35, 8);
  const ways = neWideTile(8, x, y) ?? [];
  const roads = ways.filter((w) => w.tags?.highway);
  const places = ways.filter((w) => w.tags?.place);
  check(roads.length > 0 && places.length > 0, `${roads.length} highways and ${places.length} places`);
  check(roads.every((w) => ['motorway', 'trunk', 'primary'].includes(w.tags.highway)),
    'every road carries an OSM highway class the client already draws');
  check(places.every((w) => ['city', 'town'].includes(w.tags.place) && w.tags.name),
    'every place carries an OSM place class and a name');
  check(ways.every((w) => w.id < 0), 'ids are negative — ways and relations already share the positive space');
  check(new Set(ways.map((w) => w.id)).size === ways.length, 'ids are unique within a tile');
}

// ── AN EMPTY ANSWER IS A REAL ANSWER ───────────────────────────────────
// Most of the planet is ocean. The rung that failed hardest was a pure ocean
// tile, and the fix has to answer that instantly rather than treat it as a miss.
console.log('\nthe empty ocean answers, and answers empty:');
{
  const [x, y] = tileOf(-35.0, -8.0, 8);
  const t0 = Date.now();
  const ways = neWideTile(8, x, y);
  check(Array.isArray(ways) && ways.length === 0,
    `South Atlantic z8 is an empty array, not a failure (${ways?.length} features, ${Date.now() - t0}ms)`);
}
{
  // The cost that matters is the worst tile, not the empty one: this is per
  // request on a warm Lambda and it is competing with a 400ms bank hit.
  const [x, y] = tileOf(48.86, 2.35, 9);
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) neWideTile(9, x, y);
  const ms = (Date.now() - t0) / 20;
  check(ms < 50, `a dense z9 tile slices in ${ms.toFixed(1)}ms (the bank hit it replaces is ~400ms)`);
}

check(NE_MAX_Z === 9, 'z10 and finer are still Overpass\'s job');
rmSync(BUNDLE, { force: true });
rmSync(OUT, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : '\nne-wide: all ok');
process.exit(fails ? 1 : 0);
