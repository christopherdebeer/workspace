/**
 * OCEAN MASK TESTS — no browser, no renderer, no truck.
 *
 *   node cells/drive/devtools/oceanmask.test.mjs
 *
 * The whole hydro cutover rests on one assertion, and it is cheap to check:
 *
 *   NO CHANGE IN DEM ELEVATION ALONE MAY CHANGE LAND INTO WATER.
 *
 * Every case below is a place you can drive to, reduced to the smallest grid
 * that still poses its question. Badwater Basin sits at −86m and is land;
 * a Dutch polder sits below the sea beside it and is land; the Pacific off
 * Big Sur reads +1.2m in the elevation source and is ocean. Elevation cannot
 * separate those three. Classification can.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'oceanmask-'));
const built = join(tmp, 'oceanmask.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/oceanmask.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { COVER_WATER, buildOceanMask, maskAt } = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** Build a w×h cover grid from rows of single characters.
 *   '.' open ocean (raw 0)   '~' class 80 water   '#' land (forest)   'b' bare */
const W = COVER_WATER;
const CLASS = { '.': 0, '~': W, '#': 10, b: 60, g: 30 };
function grid(rows) {
  const h = rows.length, w = rows[0].length;
  const data = new Uint8Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { data[y * w + x] = CLASS[c]; }));
  return { data, w, h };
}
/** A matching elevation grid from the same row art, via a per-character height. */
function heights(rows, at) {
  const h = rows.length, w = rows[0].length;
  const e = new Float32Array(w * h);
  rows.forEach((r, y) => [...r].forEach((c, x) => { e[y * w + x] = at(c, x, y); }));
  return e;
}
const show = (g, m) => {
  const out = [];
  for (let y = 0; y < g.h; y++) {
    let s = '';
    for (let x = 0; x < g.w; x++) s += m.data[y * g.w + x] ? 'O' : '·';
    out.push(s);
  }
  return out.join(' / ');
};

// ── 1. OPEN OCEAN NEEDS NO ARGUMENT ───────────────────────────────
{
  const rows = ['....', '....', '..~#', '..##'];
  const g = grid(rows);
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0 });
  ok(`raw zero is ocean without consulting anything (${stats.seeds} seeds)`,
    stats.seeds === 12, stats);
  ok(`…and the land next to it is not (${show(g, m)})`,
    m.data[2 * 4 + 3] === 0 && m.data[3 * 4 + 2] === 0, show(g, m));
}

// ── 2. BADWATER BASIN ─────────────────────────────────────────────
// −86m, and every pixel of it carries a land class. The old world decided
// this with `baseElev < -2` and a 30km suppression radius; the mask decides
// it by looking.
{
  const rows = ['bbbb', 'bbgb', 'bbbb'];
  const g = grid(rows);
  const elev = heights(rows, () => -86);
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  ok('a basin 86m below the sea is not the sea, because it has land classes',
    stats.ocean === 0, stats);
  ok('…and no amount of it turns into ocean', !maskAt(m, 0.5, 0.5), show(g, m));
}

// ── 3. THE DUTCH POLDER, WITH THE NORTH SEA IN THE SAME TILE ──────
// The case the 30km global suppression radius CANNOT express: dry land below
// sea level, a kilometre from visible ocean.
{
  const rows = [
    '.....',   // North Sea
    '..~..',   // the coastal band
    '#####',   // the dyke
    'ggggg',   // polder, below sea level and farmed
    'ggggg',
  ];
  const g = grid(rows);
  const elev = heights(rows, (c) => (c === '.' || c === '~' ? 0 : c === '#' ? 8 : -4));
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  ok(`the sea is ocean and the polder is not, in one tile (${show(g, m)})`,
    maskAt(m, 0.5, 0.1) && !maskAt(m, 0.5, 0.7) && !maskAt(m, 0.5, 0.9), show(g, m));
  ok('…and the dyke between them holds', !maskAt(m, 0.5, 0.5), show(g, m));
  ok(`…while the coastal band joined the sea (${stats.bridged} bridged)`,
    stats.bridged === 1, stats);
}

// ── 4. THE FLOOD DOES NOT WALK UP THE RIVER ───────────────────────
// A long class-80 channel running inland from open water. Unbounded, this
// is how a mountain lake becomes the sea.
{
  const rows = [
    '..........',
    '..........',
    '~~~~~~~~~~',   // the river, all one class, running inland
    '##########',
  ];
  const g = grid(rows);
  // Rising away from the coast, as a river does.
  const elev = heights(rows, (c, x) => (c === '~' ? x * 1.2 : c === '.' ? 0 : 20));
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  const reach = [...Array(10).keys()].filter((x) => m.data[2 * 10 + x]).length;
  ok(`the flood stops a few pixels up the river, not at its head (${reach}/10 reached)`,
    reach > 0 && reach <= 4, { reach, stats, map: show(g, m) });
  ok('…and refuses the rest on height', stats.refused > 0, stats);
}

// ── 5. A MOUNTAIN TARN IS NEVER THE SEA ───────────────────────────
{
  const rows = ['####', '#~~#', '#~~#', '####'];
  const g = grid(rows);
  const elev = heights(rows, () => 1400);
  const { stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  ok('a lake at 1400m with no ocean in the tile is not ocean', stats.ocean === 0, stats);
  ok('…and all four of its pixels are reported refused, not silently dropped',
    stats.refused === 4, stats);
}

// ── 6. …EVEN WHEN IT TOUCHES THE SEA, IF IT SITS ABOVE IT ─────────
// The gate that matters. A tarn draining to a coast is contiguous class 80
// all the way down; only height tells them apart.
{
  const rows = ['..~~', '..~~', '..~~', '..~~'];
  const g = grid(rows);
  // The right-hand column is a lake perched 40m up, touching the sea band.
  const elev = heights(rows, (c, x) => (x >= 2 ? 40 : 0));
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  ok(`contiguous water 40m above the datum stays out (${show(g, m)})`,
    !maskAt(m, 0.6, 0.5) && !maskAt(m, 0.9, 0.5), show(g, m));
  ok('…and the open water beside it is still in', maskAt(m, 0.1, 0.5), show(g, m));
  ok('…with every perched pixel refused', stats.refused === 8, stats);
}

// ── 7. NO ELEVATION YET ───────────────────────────────────────────
// Cover routinely arrives before terrain. Without heights the mask must still
// answer, on distance alone, rather than blanking the sea on approach.
{
  const rows = ['....', '..~~', '..~~', '####'];
  const g = grid(rows);
  const { stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0 });
  ok(`with no elevation the bounded flood still runs (${stats.ocean} ocean px)`,
    stats.ocean > stats.seeds, stats);
  ok('…and land still stops it', stats.ocean < g.w * g.h, stats);
}

// ── 8. THE BRIDGE IS A RADIUS, NOT A SCAN ORDER ───────────────────
// Breadth-first, so `bridgePx` means the same thing whichever side the seed
// is on. A depth-first walk would reach far further along one axis.
{
  const rows = ['.~~~~~~~~~'];
  const g = grid(rows);
  for (const px of [1, 2, 4, 8]) {
    const { stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, bridgePx: px });
    ok(`bridgePx ${px} reaches exactly ${px} water pixels`, stats.bridged === px, stats);
  }
}

// ── 9. DETERMINISM AND BOUNDS ─────────────────────────────────────
{
  const rows = ['.~#g', '~~#b', '##~.', 'g.~#'];
  const g = grid(rows);
  const elev = heights(rows, (c, x, y) => (x + y) % 5);
  const a = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  const b = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  ok('the same grid always gives the same mask', a.grid.data.join() === b.grid.data.join(), null);
  ok('every value is 0 or 255', [...a.grid.data].every((v) => v === 0 || v === 255),
    [...new Set(a.grid.data)]);
  ok('sampling outside the tile is false, not a wrap',
    !maskAt(a.grid, -0.1, 0.5) && !maskAt(a.grid, 1.2, 0.5) && !maskAt(a.grid, 0.5, 1.0), null);
}

// ── 9b. THE COAST, WHERE THERE IS NO ZERO AT ALL ──────────────────
// Measured off Big Sur: 31,723 class-80 pixels and ZERO seeds, so the flood
// never started. ESA ships WorldCover for land only, so raw zero means
// "outside any source file" — true open ocean, far offshore. Near a coast the
// file exists, covers the sea, and calls it class 80 like any other water.
{
  const rows = [
    '~~~~~~~~',   // the Pacific, class 80, running off the tile
    '~~~~~~~~',
    '~~~~####',
    '~~######',
    '########',
  ];
  const g = grid(rows);
  const elev = heights(rows, (c) => (c === '~' ? 0 : 60));
  const plain = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  ok(`without edge seeding a coast with no zeros is entirely missed (${plain.stats.ocean} ocean px)`,
    plain.stats.seeds === 0 && plain.stats.ocean === 0, plain.stats);
  const edged = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev, seedEdge: true });
  // COUNTED, NOT ASSERTED FROM MEMORY. Every water pixel here is contiguous
  // and at the datum, so the right answer is "all of them" — which the grid
  // can state itself. Three hand-counted expectations in this file have now
  // been wrong where the code was right.
  const water = rows.join('').split('').filter((c) => c === '~').length;
  ok(`…and with it the whole sea is found (${edged.stats.ocean}/${water} px, ${edged.stats.edgeSeeds} edge seeds)`,
    edged.stats.ocean === water, edged.stats);
  ok(`…without taking the land with it (${show(g, edged.grid)})`,
    !maskAt(edged.grid, 0.9, 0.9), show(g, edged.grid));
}

// ── 9c. AN ENCLOSED LAKE IS STILL NOT THE SEA ─────────────────────
// The sea leaves the tile; a lake does not. That is the whole of the edge
// rule, and this is the case it turns on — a lake AT the datum, which the
// height gate alone cannot reject.
{
  const rows = ['#####', '#~~~#', '#~~~#', '#####'];
  const g = grid(rows);
  const elev = heights(rows, () => 0);            // at sea level, and still a lake
  const { stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev, seedEdge: true });
  ok('a lake at the datum that touches no edge stays out', stats.ocean === 0, stats);
}

// ── 9e. THE COASTLINE CLOSES THE KNOWN MISS ───────────────────────
// Land already stops the flood, so a barrier can only change an answer where
// there is WATER ON BOTH SIDES of it — precisely and only the case the height
// gate cannot reach. OSM's coastline runs along the Afsluitdijk, so the wall
// falls exactly where it must, and none of this needs OSM's left-is-land
// convention: it is pure topology.
{
  const rows = ['~~~~~~', '~~~~~~', '######', '~~~~~~'];
  const g = grid(rows);
  const elev = heights(rows, () => 0);
  // Without a dyke in the cover at all — the harder case, where the two bodies
  // touch and only the coastline separates them.
  const open = ['~~~~~~', '~~~~~~', '~~~~~~', '~~~~~~'];
  const go = grid(open);
  const eo = heights(open, () => 0);
  const before = buildOceanMask(go.data, go.w, go.h, { datumM: 0, elevation: eo, seedEdge: true });
  ok(`with no coastline the whole basin is sea (${before.stats.ocean}/24)`,
    before.stats.ocean === 24, before.stats);

  // The coastline, rasterised across row 2 — the dyke's line.
  const barrier = new Uint8Array(go.w * go.h);
  for (let x = 0; x < go.w; x++) barrier[2 * go.w + x] = 1;
  const after = buildOceanMask(go.data, go.w, go.h,
    { datumM: 0, elevation: eo, seedEdge: true, barrier });
  // WHAT THE BARRIER ACTUALLY DOES, which is less than claimed and worth
  // stating exactly. The flood cannot CROSS the dyke — row 2 is walled and the
  // sea does not reach through it. But row 3 lies on the tile boundary, so
  // `seedEdge` seeds it directly and the wall is never consulted. A barrier
  // constrains the flood; it does not decide which side of itself is sea.
  ok(`the flood cannot cross the dyke (row 2 walled, ${after.stats.walled} blocked)`,
    !maskAt(after.grid, 0.5, 0.5) && after.stats.walled > 0, after.stats);
  ok('…while the seaward side is still sea', maskAt(after.grid, 0.5, 0.1), show(go, after.grid));
  // …AND THE CASE IS STILL OPEN, asserted as open. Closing it needs the side
  // test: OSM winds a coastline with land on the LEFT, so the seaward side of
  // the nearest segment is decidable locally, per candidate edge pixel. That
  // is the mechanism; a wall alone is not it.
  ok('an inland body ON the tile edge still seeds past the wall — a wall alone does not close it',
    maskAt(after.grid, 0.5, 0.9), { map: show(go, after.grid) });

  // ── AND THE SIDE TEST DOES CLOSE IT ──
  // OSM winds a coastline with land on the LEFT, so the side of any point is a
  // cross-product sign against the nearest segment. Here the dyke runs along
  // row 2 and everything below it is landward.
  const landward = new Uint8Array(go.w * go.h);
  for (let x = 0; x < go.w; x++) for (let y = 3; y < go.h; y++) landward[y * go.w + x] = 1;
  const sided = buildOceanMask(go.data, go.w, go.h,
    { datumM: 0, elevation: eo, seedEdge: true, barrier, landward });
  ok(`the IJsselmeer case closes (${show(go, sided.grid)})`,
    !maskAt(sided.grid, 0.5, 0.9), { stats: sided.stats, map: show(go, sided.grid) });
  ok('…and the sea in front of the dyke is untouched',
    maskAt(sided.grid, 0.5, 0.1) && maskAt(sided.grid, 0.5, 0.3), show(go, sided.grid));
  ok(`…with the refusals attributed to the coastline, not to height (${sided.stats.landward})`,
    sided.stats.landward > 0, sided.stats);
  ok(`…and the wall reports itself (${after.stats.walled} pixels blocked)`,
    after.stats.walled > 0, after.stats);
  // A tile with no coastline must be untouched by the feature existing.
  const none = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev, seedEdge: true });
  ok('a tile with no coastline reports zero walled', none.stats.walled === 0, none.stats);
}

// ── 9d. THE KNOWN MISS, ASSERTED AS A MISS (WITHOUT A COASTLINE) ──
// A large freshwater body AT the datum that DOES reach the tile edge reads as
// sea. That is the IJsselmeer behind the Afsluitdijk: −0.4m, enormous, and
// connected to nothing but a sluice. No local rule separates it from a bay —
// it needs either the OSM coastline (stage 4) or real connectivity. Written
// down so nobody "fixes" this by loosening the edge rule and quietly floods a
// hundred inland lakes to get one right.
{
  const rows = ['~~~~~~', '~~~~~~', '######', '~~~~~~'];
  const g = grid(rows);
  const elev = heights(rows, () => 0);
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev, seedEdge: true });
  ok(`without a coastline a datum-height body at the edge still reads as sea (${show(g, m)})`,
    maskAt(m, 0.5, 0.9), { stats, map: show(g, m) });
  ok('…and the dyke still separates the two, so it is two bodies, not one',
    !maskAt(m, 0.5, 0.6), show(g, m));
}

// ── 10. THE COST ──────────────────────────────────────────────────
// One mask per cover tile, built once. A 256² tile is the real case.
{
  const w = 256, h = 256;
  const cover = new Uint8Array(w * h);
  for (let i = 0; i < cover.length; i++) {
    const x = i % w, y = (i / w) | 0;
    cover[i] = y < 90 ? 0 : y < 100 ? W : x % 7 === 0 ? 30 : 10;
  }
  const elev = new Float32Array(w * h);
  const t0 = performance.now();
  let acc = 0;
  for (let k = 0; k < 20; k++) acc += buildOceanMask(cover, w, h, { datumM: 0, elevation: elev }).stats.ocean;
  const per = (performance.now() - t0) / 20;
  ok(`a 256² mask costs ${per.toFixed(2)}ms, well inside a tile build`, per < 12, { per, acc });
}

// ── 11. TERRAIN THAT NEVER ARRIVES ────────────────────────────────
// Cover tiles are ~8km; terrain streams a couple of kilometres around the
// truck. So most of the sea has NO elevation under it and never will, and how
// an unjudged pixel is treated decides whether there is a coast at all.
//
// Both wrong answers are on record. Calling an unknown pixel "at the datum"
// floods every low valley the DEM has not reached. Refusing it outright cuts
// the sea off at the edge of the loaded terrain — measured at Noordhoek as
// 306,773 unjudged pixels across nine masks, seven reporting no ocean, and
// photographed from the seat as a coastline in tile-shaped rectangles.
//
// The rule that survives both: an unknown pixel may TRAVEL but may not SEED.
{
  // Left half sea, right half land. Elevation is known only in the middle
  // columns — the streamed ring — and NaN elsewhere, as main now feeds it.
  const rows = [
    '~~~~~~~~##',
    '~~~~~~~~##',
    '~~~~~~~~##',
    '~~~~~~~~##',
  ];
  const g = grid(rows);
  const elev = heights(rows, (c, x) => (x >= 3 && x <= 6 ? (c === '~' ? 0 : 40) : NaN));
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h, {
    datumM: 0, elevation: elev, seedEdge: true,
  });
  ok(`the sea reaches past the last loaded tile (${stats.ocean} px, ${show(g, m)})`,
    maskAt(m, 0.05, 0.5) && maskAt(m, 0.55, 0.5), { stats, seen: show(g, m) });
  ok('…and the land beyond the ring is still land',
    !maskAt(m, 0.95, 0.5), show(g, m));
}
{
  // The other half of the rule. An inland pool of class 80 with no elevation
  // and no route to a datum-level seed must NOT become sea — this is the
  // valley-flooding failure, posed as a unit.
  const rows = [
    '##########',
    '###~~~~###',
    '###~~~~###',
    '##########',
  ];
  const g = grid(rows);
  const elev = heights(rows, () => NaN);       // nothing judged anywhere
  const { stats } = buildOceanMask(g.data, g.w, g.h, {
    datumM: 0, elevation: elev, seedEdge: true,
  });
  ok(`an unjudged inland pool seeds nothing (${stats.ocean} ocean, ${stats.refused} refused)`,
    stats.ocean === 0 && stats.refused === 8, stats);
}

// ── 12. THE SEA CONTINUES ACROSS A TILE BORDER ────────────────────
// A wholly-offshore cover tile is ALL class 80 with no elevation ever —
// no raw zeros (ESA classifies near-coast sea), no datum-level edge pixel.
// Measured off Big Sur as 65,536 refused and zero ocean, twice: whole tiles
// of open sea rendered as holes. The neighbour's established ocean at the
// shared border is the same evidence as in-tile travel, and seeds it.
{
  const rows = ['~~~~~~', '~~~~~~', '~~~~~~', '~~~~~~'];
  const g = grid(rows);
  const elev = heights(rows, () => NaN);
  const blank = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev, seedEdge: true });
  ok('with no neighbour to vouch, the offshore tile still seeds nothing',
    blank.stats.ocean === 0, blank.stats);
  const neigh = new Uint8Array(g.w * g.h);
  for (let x = 0; x < g.w; x++) neigh[x] = 1;          // the tile north of us is sea
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h,
    { datumM: 0, elevation: elev, seedEdge: true, neighbourOcean: neigh });
  ok(`vouched for, it fills entirely (${stats.ocean}/${g.w * g.h})`,
    stats.ocean === g.w * g.h, { stats, seen: show(g, m) });
}
// ── 13. WITHIN A CLIFF'S BLUR, THE COASTLINE OUTRANKS THE DEM ─────
// A coastal pixel that is mostly water samples its height from the cliff
// standing in the same pixel, reads far above the datum, and refuses — so
// the waterline sits seaward of the mapped coast. Marked nearCoastSea (the
// caller checked the winding), the height gate is waived; connectivity
// still decides, so the same value inland changes nothing.
{
  const rows = ['..~~##'];
  const g = grid(rows);
  // The two class-80 pixels carry cliff-bled heights of 12m and 18m.
  const elev = heights(rows, (c, x) => (c === '~' ? (x === 2 ? 12 : 18) : c === '.' ? 0 : 40));
  const refused = buildOceanMask(g.data, g.w, g.h, { datumM: 0, elevation: elev });
  ok('cliff-bled heights refuse without the waiver (the setback)',
    refused.stats.ocean === 2 && refused.stats.refused === 2, refused.stats);
  const nearSea = new Uint8Array(g.w * g.h);
  nearSea[2] = 1; nearSea[3] = 1;
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h,
    { datumM: 0, elevation: elev, nearCoastSea: nearSea });
  ok(`waived, the flood carries to the coast (${show(g, m)})`,
    maskAt(m, 2.5 / 6, 0.5) && maskAt(m, 3.5 / 6, 0.5) && !maskAt(m, 4.5 / 6, 0.5),
    { stats, seen: show(g, m) });
}

// ── 14. THE WALL HAS NO WIDTH ─────────────────────────────────────
// Rasterising the coastline as "pixels within a cover pixel of the line"
// made a ~62m dead strip along every mapped coast: at Big Sur the sea
// detached from the shore the moment the coastline streamed in, at datum
// elevation the whole way. With the signed side array the flood reaches
// seaward water right up to the line (cliff-bled heights waived), refuses
// water BEHIND the line, and blocks only the step that crosses it.
{
  const rows = ['..~~~~##~~#'];
  const g = grid(rows);
  // Seaward band carries cliff-bled heights; the lagoon behind the coast
  // sits at the datum — height alone would call IT sea and refuse the band.
  const elev = heights(rows, (c, x) => (c === '~' ? (x < 6 ? 9 : 0) : c === '.' ? 0 : 40));
  const side = new Int8Array(g.w * g.h);
  // main marks EVERY class-80 pixel near the coast, so the whole seaward
  // band carries +1 — a fixture marking only the last two would leave a
  // refused wall of unmarked cliff-bled pixels in front of them.
  side[2] = 1; side[3] = 1; side[4] = 1; side[5] = 1;
  side[8] = -1; side[9] = -1;   // the lagoon behind it
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h,
    { datumM: 0, elevation: elev, coastSide: side });
  ok(`seaward water reaches the line despite cliff-bled DEM (${show(g, m)})`,
    maskAt(m, 4.5 / 11, 0.5) && maskAt(m, 5.5 / 11, 0.5),
    { stats, seen: show(g, m) });
  ok('…and the lagoon behind the coast stays out',
    !maskAt(m, 8.5 / 11, 0.5) && !maskAt(m, 9.5 / 11, 0.5),
    { stats, seen: show(g, m) });
}
{
  // The dyke narrower than a pixel: two class-80 pixels ADJACENT, opposite
  // sides of the line. The step between them is the crossing, and only that
  // step is blocked.
  const rows = ['..~~~~'];
  const g = grid(rows);
  const side = new Int8Array(g.w * g.h);
  side[3] = 1; side[4] = -1; side[5] = -1;
  const { grid: m, stats } = buildOceanMask(g.data, g.w, g.h,
    { datumM: 0, elevation: heights(rows, () => 0), coastSide: side });
  ok(`the crossing step is walled and the far side stays out (${show(g, m)})`,
    maskAt(m, 3.5 / 6, 0.5) && !maskAt(m, 4.5 / 6, 0.5) && stats.walled + stats.landward > 0,
    { stats, seen: show(g, m) });
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — classification, not elevation');
if (bad) process.exitCode = 1;
