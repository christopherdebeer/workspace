/**
 * CULTURE TESTS — no browser, no renderer, no truck.
 *
 *   node cells/drive/devtools/culture.test.mjs
 *
 * The rule from the diversity plan is "every new field gets a probe before it
 * gets a feature", and the rule from the last two days is that anything which
 * is arithmetic should be answerable in under a second rather than in a
 * five-minute browser run. Everything below is arithmetic.
 *
 * What these are actually guarding, in order of how much each has already
 * cost this project:
 *
 *   1. NO CHECKERBOARD. A grid-quantised hash drew visible squares across
 *      every hillside once already. The Voronoi boundary test below is the
 *      cheap version of noticing that.
 *   2. NO ORIGIN DEPENDENCE. World x,z rebase; a paint keyed to them repaints
 *      the world when they do.
 *   3. NO CALL-ORDER DEPENDENCE. Tiles stream in network order. A look that
 *      differed by arrival order would be a non-reproducible defect, and this
 *      session has already produced one of those.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'culture-'));
const built = join(tmp, 'culture.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/culture.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
const {
  SCOPE, hash3, unit, unitN, absMetres, cellAt, seedAt,
  BUILD_CULTURES, ROAD_CULTURES, pickCulture, sharpen, snowLoad, roofSnowBias, buildLookAt, paintFor, roadLookAt,
} = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** A stand-in world: a fixed origin, and metres converted back to degrees.
 *  Whatever the real projection does, this file only needs latLonAt to be a
 *  smooth invertible map, which it is. */
const envAt = (lat0, lon0) => ({
  latLonAt: (x, z) => [lat0 - z / 111320, lon0 + x / (111320 * Math.cos((lat0 * Math.PI) / 180))],
});

// ── 1. THE HASH IS UNSIGNED, ALWAYS ───────────────────────────────
// bPaint shipped a signed hash once and half the buildings in the world
// became unlit white slabs, because `h % n` came out negative and
// `new Mesh(geo, undefined)` falls back to a flat 1.0 MeshBasicMaterial.
{
  let min = Infinity, max = -Infinity, negs = 0;
  for (let i = -5000; i < 5000; i++) {
    const h = hash3(i, i * 7 - 3, 0x9e37);
    if (h < 0) negs++;
    min = Math.min(min, h); max = Math.max(max, h);
  }
  ok('the hash never goes negative over 10k inputs, either sign', negs === 0, { negs, min });
  ok('…and it uses the full 32-bit range', max > 4.2e9 && min < 5e6, { min, max });
  const u = [];
  for (let i = 0; i < 20000; i++) u.push(unit(hash3(i, 0, 1)));
  const mean = u.reduce((a, b) => a + b, 0) / u.length;
  ok(`unit() is uniform enough to weight with (mean ${mean.toFixed(4)})`,
    Math.abs(mean - 0.5) < 0.01, { mean });
  ok('…and stays inside [0,1)', Math.min(...u) >= 0 && Math.max(...u) < 1,
    { lo: Math.min(...u), hi: Math.max(...u) });
}

// ── 2. A SEED IS STABLE INSIDE ITS SCOPE ──────────────────────────
// This is the whole M3 claim. If it does not hold, a village does not agree
// with itself and the feature has no point.
{
  const env = envAt(45, 6);
  const s0 = seedAt(env, 0, 0, 'settlement');
  let same = 0, total = 0;
  // Sample well inside the scope: 40m is an eighth of the 320m settlement
  // cell, so a point that close is almost always in the same cell. Almost —
  // a site can sit near an edge, which is why this is a rate, not an absolute.
  for (let a = 0; a < 360; a += 15) {
    const r = 40;
    const x = r * Math.cos((a * Math.PI) / 180), z = r * Math.sin((a * Math.PI) / 180);
    total++;
    if (seedAt(env, x, z, 'settlement') === s0) same++;
  }
  ok(`a settlement seed holds over a 40m radius (${same}/${total})`, same / total > 0.8, { same, total });

  // And it must CHANGE at a distance well past the scope, or the "region"
  // and "settlement" scopes are the same thing wearing two names.
  let diff = 0, n = 0;
  for (let d = 1000; d <= 20000; d += 1000) { n++; if (seedAt(env, d, 0, 'settlement') !== s0) diff++; }
  ok(`…and differs at every distance past 1km (${diff}/${n})`, diff === n, { diff, n });

  // The scope ladder must actually be a ladder. Measured as the MEAN interval
  // between boundary crossings along a long traverse, not as the first change
  // from one origin: an origin can sit arbitrarily close to a boundary, and
  // the first version of this test read `district` as changing in 10m for
  // exactly that reason. A mean over hundreds of crossings has no such luck.
  const scopes = ['stand', 'settlement', 'district', 'region'];
  const meanGap = scopes.map((s) => {
    const step = Math.max(2, Math.round(SCOPE[s] / 40));
    const span = SCOPE[s] * 60;
    let prev = seedAt(env, 0, 0, s), crossings = 0;
    for (let d = step; d < span; d += step) {
      const v = seedAt(env, d, 0, s);
      if (v !== prev) crossings++;
      prev = v;
    }
    return crossings ? span / crossings : Infinity;
  });
  const rising = meanGap.every((d, i) => i === 0 || d > meanGap[i - 1] * 2);
  ok(`the scopes nest: mean crossing every ${meanGap.map((d) => `${Math.round(d)}m`).join(' < ')}`,
    rising, { meanGap });
  // …and each is within a factor of two of the scope it advertises, or the
  // named radius is a fiction.
  const honest = scopes.every((s, i) => meanGap[i] > SCOPE[s] * 0.5 && meanGap[i] < SCOPE[s] * 2.5);
  ok('…and each scope crosses at about the radius it advertises',
    honest, scopes.map((s, i) => `${s}: ${Math.round(meanGap[i])}m vs ${SCOPE[s]}m`));
}

// ── 3. NO CHECKERBOARD ────────────────────────────────────────────
// The flower-patch failure, caught arithmetically. A grid-quantised region
// would put every boundary on an axis-aligned line, so a long axis-aligned
// traverse would cross boundaries at exactly regular intervals. Jittered
// Voronoi must not.
{
  const scale = 1000, salt = 0x1234;
  const cross = [];
  let prev = cellAt(0, 0, scale, salt).seed, last = 0;
  for (let d = 1; d < 60000; d += 1) {
    const s = cellAt(d, 0, scale, salt).seed;
    if (s !== prev) { cross.push(d - last); last = d; prev = s; }
  }
  const uniq = new Set(cross).size;
  ok(`boundaries along an axis are irregular, not a lattice (${cross.length} crossings, ${uniq} distinct gaps)`,
    uniq > cross.length * 0.5, { crossings: cross.length, uniq });
  const onGrid = cross.filter((g) => g % scale === 0).length;
  ok('…and essentially none of them land on the grid pitch',
    onGrid <= 1, { onGrid, of: cross.length });

  // A DIAGONAL traverse is the one a grid gives away on: axis-aligned cells
  // crossed diagonally produce a strong period at scale*sqrt(2)/2.
  const dcross = [];
  let dprev = cellAt(0, 0, scale, salt).seed, dlast = 0;
  for (let d = 1; d < 60000; d += 1) {
    const s = cellAt(d * 0.7071, d * 0.7071, scale, salt).seed;
    if (s !== dprev) { dcross.push(d - dlast); dlast = d; dprev = s; }
  }
  const dspread = Math.max(...dcross) - Math.min(...dcross);
  ok(`…and a diagonal traverse is irregular too (gaps spread ${dspread}m)`,
    dspread > scale * 0.5, { dspread, n: dcross.length });
}

// ── 4. NO DEGENERATE CELLS ────────────────────────────────────────
// Jitter at a full half-cell lets two sites coincide, which collapses a
// region to zero area and folds its boundary back on itself. 0.42 is chosen
// to prevent that; this is the check that it does.
{
  let minGap = Infinity;
  const scale = 1000, salt = 0x77;
  for (let iz = 0; iz < 60; iz++) {
    for (let ix = 0; ix < 60; ix++) {
      // Recover each site the same way cellAt does, and measure to its
      // right-hand and lower neighbours.
      const site = (gx, gz) => {
        const s = hash3(gx, gz, salt);
        return [(gx + 0.5 + (unit(s) - 0.5) * 0.84) * scale, (gz + 0.5 + (unitN(s, 1) - 0.5) * 0.84) * scale];
      };
      const a = site(ix, iz);
      for (const b of [site(ix + 1, iz), site(ix, iz + 1)]) {
        minGap = Math.min(minGap, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
  }
  ok(`no two neighbouring sites collapse together (closest ${minGap.toFixed(0)}m of ${scale}m)`,
    minGap > scale * 0.1, { minGap, scale });
}

// ── 5. THE SCOPE LATTICES DO NOT STACK ────────────────────────────
// Unsalted, every scope quantises the same plane and a settlement boundary
// lands on a region boundary everywhere — so all change happens on one line
// and the world gets one dramatic transition instead of several quiet ones.
{
  const env = envAt(45, 6);
  let coincide = 0, n = 0;
  let pr = seedAt(env, 0, 0, 'region'), ps = seedAt(env, 0, 0, 'settlement');
  for (let d = 10; d < 300000; d += 10) {
    const r = seedAt(env, d, 0, 'region'), s = seedAt(env, d, 0, 'settlement');
    if (r !== pr) { n++; if (s !== ps) coincide++; }
    pr = r; ps = s;
  }
  ok(`region and settlement boundaries are independent (${coincide}/${n} coincided)`,
    n > 0 && coincide / n < 0.25, { coincide, n });
}

// ── 6. ORIGIN REBASE MUST NOT REPAINT THE WORLD ───────────────────
// The reason every seed here comes from lat/lon. Two envs describing the SAME
// geography with different world origins must give the same answer.
{
  const a = envAt(45, 6);
  // The same place, but the world origin moved 5km east and 3km north — what
  // an attract-cycle rebase does.
  const b = { latLonAt: (x, z) => a.latLonAt(x + 5000, z - 3000) };
  const w = [0.1, 0.1, 0.6, 0.1, 0.1];
  let same = 0, n = 0;
  for (let i = 0; i < 200; i++) {
    const x = (i % 20) * 137, z = Math.floor(i / 20) * 211;
    // b's (x,z) names the same ground as a's (x+5000, z-3000) — that is what
    // the shifted env says. Comparing against a's (x-5000, z+3000) compared
    // two different places and duly found them different.
    const la = buildLookAt(a, x + 5000, z - 3000, w, 300);
    const lb = buildLookAt(b, x, z, w, 300);
    n++;
    if (la.culture.key === lb.culture.key && la.palette.join() === lb.palette.join()) same++;
  }
  ok(`a 5km origin rebase changes nothing (${same}/${n} identical)`, same === n, { same, n });
}

// ── 7. CALL ORDER IS IRRELEVANT ───────────────────────────────────
{
  const env = envAt(45, 6);
  const w = [0.1, 0.2, 0.4, 0.2, 0.1];
  const pts = Array.from({ length: 120 }, (_, i) => [i * 97 - 5000, i * 61 - 3000]);
  const fwd = pts.map(([x, z]) => buildLookAt(env, x, z, w, 400).palette.join());
  const rev = [...pts].reverse().map(([x, z]) => buildLookAt(env, x, z, w, 400).palette.join()).reverse();
  ok('answers do not depend on the order they were asked in', fwd.join('|') === rev.join('|'),
    { first: fwd[0], firstRev: rev[0] });
}

// ── 8. A SETTLEMENT AGREES WITH ITSELF ────────────────────────────
// The headline claim, and the thing bPaint(id) got wrong. Buildings within
// one settlement must share a small palette; buildings a region apart must
// not.
{
  const env = envAt(45, 6);
  const w = [0.05, 0.05, 0.7, 0.15, 0.05];
  const look = buildLookAt(env, 0, 0, w, 250);
  ok(`a settlement commits to exactly three paints, all distinct`,
    look.palette.length === 3 && new Set(look.palette).size === 3, look.palette);
  ok('…all of them drawn from its own culture', look.palette.every((p) => look.culture.wall.includes(p)),
    { palette: look.palette, culture: look.culture.key });

  // Every building in a 150m village must wear one of those three.
  const worn = new Set();
  for (let z = -150; z <= 150; z += 10) {
    for (let x = -150; x <= 150; x += 10) {
      worn.add(paintFor(env, look, x, z));
    }
  }
  ok(`and 961 buildings across that village wear ${worn.size} paints, not twelve`,
    worn.size <= 3, { worn: worn.size });

  // …but the paint still VARIES building to building. A village of one
  // colour is as wrong as a village of twelve.
  ok('…while still varying between neighbours', worn.size >= 2, { worn: worn.size });
}

// ── 9. CULTURE FOLLOWS CLIMATE ────────────────────────────────────
// Slate and timber in the Sahara would be the "different coloured grass"
// failure again: variety that ignores the world it varies over.
{
  const roll = (n) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);
  const share = (w, set) => {
    const c = {};
    for (const r of roll(400)) { const k = pickCulture(set, w, r).key; c[k] = (c[k] ?? 0) + 1; }
    return c;
  };
  const arid = share([1, 0, 0, 0, 0], BUILD_CULTURES);
  const boreal = share([0, 0, 0, 1, 0], BUILD_CULTURES);
  const alpine = share([0, 0, 0, 0, 1], BUILD_CULTURES);
  ok(`the desert builds in earth and ochre, not timber (${JSON.stringify(arid)})`,
    (arid.adobe ?? 0) + (arid.ochre ?? 0) > 320 && (arid.timber ?? 0) < 20, arid);
  ok(`the boreal forest builds in timber and stone (${JSON.stringify(boreal)})`,
    (boreal.timber ?? 0) + (boreal.stone ?? 0) > 240 && (boreal.adobe ?? 0) < 5, boreal);
  ok(`the alpine builds in stone above all (${JSON.stringify(alpine)})`,
    (alpine.stone ?? 0) > (alpine.timber ?? 0), alpine);

  const aridR = share([1, 0, 0, 0, 0], ROAD_CULTURES);
  const borealR = share([0, 0, 0, 1, 0], ROAD_CULTURES);
  ok(`desert roads are chip seal more than anything else (${JSON.stringify(aridR)})`,
    (aridR.chipseal ?? 0) > (aridR.euro ?? 0), aridR);
  ok(`cold roads are nordic more than chip seal (${JSON.stringify(borealR)})`,
    (borealR.nordic ?? 0) > (borealR.chipseal ?? 0), borealR);

  // Every culture must be reachable from SOME climate, or it is dead code
  // that only looks like variety.
  const reachable = new Set();
  for (const b of [0, 1, 2, 3, 4]) {
    const w = [0, 0, 0, 0, 0]; w[b] = 1;
    for (const r of roll(200)) reachable.add(pickCulture(BUILD_CULTURES, w, r).key);
  }
  ok(`all ${BUILD_CULTURES.length} building cultures are reachable`,
    reachable.size === BUILD_CULTURES.length, { reachable: [...reachable] });

  // …and no single climate collapses to one culture, which would make a
  // whole continent uniform again by a different route.
  for (const [name, w] of [['arid', [1, 0, 0, 0, 0]], ['temperate', [0, 0, 1, 0, 0]], ['boreal', [0, 0, 0, 1, 0]]]) {
    const s = share(w, BUILD_CULTURES);
    ok(`${name} still offers more than one tradition (${Object.keys(s).length})`,
      Object.keys(s).length >= 2, s);
  }
}

// ── 9b. ROAD CONVENTION IS NATIONAL, NOT LOCAL ────────────────────
// Measured at Gordes: temperate France drew `nordic` — yellow centre, no edge
// line, frost wear — because the first affinity table was nearly flat, and one
// region in five is not a tail. Markings hold over a country and change at a
// border, so the temperate tail has to be genuinely small.
{
  const roll = (n) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);
  const share = (w, set) => {
    const c = {};
    for (const r of roll(400)) { const k = pickCulture(set, w, r).key; c[k] = (c[k] ?? 0) + 1; }
    return c;
  };
  // The actual Gordes weights, off the live field rather than invented.
  const gordes = [0.008, 0.148, 0.558, 0.211, 0.074];
  const g = share(sharpen(gordes), ROAD_CULTURES);
  ok(`a temperate French region is euro far more often than nordic (${JSON.stringify(g)})`,
    (g.euro ?? 0) > 3 * (g.nordic ?? 1), g);
  ok('…and nordic is under a tenth of it', (g.nordic ?? 0) / 400 < 0.10, { nordic: (g.nordic ?? 0) / 400 });
  ok('…while a boreal region is nordic more than anything else',
    (() => { const b = share(sharpen([0, 0, 0.18, 0.52, 0.30]), ROAD_CULTURES);
      return (b.nordic ?? 0) > (b.euro ?? 0) && (b.nordic ?? 0) > (b.yellow ?? 0); })(),
    share(sharpen([0, 0, 0.18, 0.52, 0.30]), ROAD_CULTURES));
  ok('…and desert chip seal never turns up in the arctic',
    (share([0, 0, 0, 1, 0], ROAD_CULTURES).chipseal ?? 0) < 10,
    share([0, 0, 0, 1, 0], ROAD_CULTURES));
}

// ── 9c. SNOW VETOES A ROOF MATERIAL ───────────────────────────────
// Measured at Flagstaff: 2100m, snow load 0.89, and the world built Provençal
// lime render under clay pantiles — then STEEPENED it, which is worse. A
// pantile roof lifts and shatters under a freeze; slate and shingle are what
// actually get built.
{
  ok('below half a load the bias does nothing at all',
    [0, 0.2, 0.49].every((s2) => ['flat', 'pantile', 'slate', 'shingle'].every((rt) => roofSnowBias(rt, s2) === 1)),
    { at: 0.49, pantile: roofSnowBias('pantile', 0.49) });
  ok('a heavy load all but removes flat and pantile',
    roofSnowBias('flat', 1) < 0.1 && roofSnowBias('pantile', 1) < 0.15,
    { flat: roofSnowBias('flat', 1), pantile: roofSnowBias('pantile', 1) });
  ok('…and favours the ones that survive it',
    roofSnowBias('slate', 1) > 1.5 && roofSnowBias('shingle', 1) > 1.5,
    { slate: roofSnowBias('slate', 1), shingle: roofSnowBias('shingle', 1) });

  // Altitude alone, holding climate fixed. NOT Flagstaff's own weights: those
  // are 40% boreal, where slate and shingle already win 294 times in 300 at
  // any height, so the first version of this test measured nothing at all. A
  // temperate climate is where pantile is the norm and the veto has work to do.
  const env = envAt(45, 7);
  const w = [0.01, 0.05, 0.80, 0.10, 0.04];
  const shedding = new Set(['slate', 'shingle']);
  // STEP BY MORE THAN A REGION. The first version stepped ~1.1km per sample,
  // so 300 points spanned 330km and landed inside about four regions — four
  // rolls of the die reported as three hundred, which is how it managed to
  // read 250 one way and 157 the other from a bias that only moves the odds
  // by ten points. A region is 96km, so the step has to clear it.
  let lowShed = 0, highShed = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const x = i * 137000, z = i * 91000;
    if (shedding.has(buildLookAt(env, x, z, w, 200).culture.roofTex)) lowShed++;
    if (shedding.has(buildLookAt(env, x, z, w, 2100).culture.roofTex)) highShed++;
  }
  // The predicted move is 57.5% -> 68.3% of the weight, so the bar is a
  // tenth, not a doubling: a veto that only fires above half a load and then
  // scales is meant to tilt the odds, not to overrule the region.
  ok(`at 2100m ${highShed}/${N} temperate regions roof in slate or shingle, against ${lowShed}/${N} at 200m`,
    highShed > lowShed * 1.12,
    { lowShed, highShed, snowLow: +snowLoad(w, 200).toFixed(2), snowHigh: +snowLoad(w, 2100).toFixed(2) });
}

// ── 10. SNOW LOAD STEEPENS ROOFS ──────────────────────────────────
{
  ok('a hot lowland has no snow load', snowLoad([1, 0, 0, 0, 0], 100) < 0.05,
    { v: snowLoad([1, 0, 0, 0, 0], 100) });
  ok('a high alpine has nearly all of it', snowLoad([0, 0, 0, 0, 1], 2200) > 0.9,
    { v: snowLoad([0, 0, 0, 0, 1], 2200) });
  ok('and it rises monotonically with height',
    [0, 500, 1000, 1500, 2000].every((h, i, a) => i === 0 || snowLoad([0, 0, 0.5, 0.5, 0], h) >= snowLoad([0, 0, 0.5, 0.5, 0], a[i - 1])),
    [0, 500, 1000, 1500, 2000].map((h) => +snowLoad([0, 0, 0.5, 0.5, 0], h).toFixed(3)));

  const env = envAt(46, 8);
  const w = [0, 0, 0.3, 0.3, 0.4];
  const low = buildLookAt(env, 0, 0, w, 200).pitch;
  const high = buildLookAt(env, 0, 0, w, 2400).pitch;
  ok(`the same village roofs steeper at altitude (${low.toFixed(2)} -> ${high.toFixed(2)})`,
    high > low, { low, high });
  ok('…and pitch never runs past vertical', high <= 0.95, { high });
}

// ── 11. THE COST ──────────────────────────────────────────────────
// Every building in a tile calls buildLookAt. A 3×3 Voronoi scan twice over
// is cheap, but "cheap" is a claim and this is the measurement — the same
// budget discipline that would have caught the climate lattice hang.
{
  const env = envAt(45, 6);
  const w = [0.1, 0.1, 0.5, 0.2, 0.1];
  const N = 20000;
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < N; i++) acc += buildLookAt(env, i * 13, i * 7, w, 300).palette[0];
  const per = ((performance.now() - t0) / N) * 1000;
  ok(`buildLookAt costs ${per.toFixed(2)}us — a 2000-building tile is ${(per * 2000 / 1000).toFixed(1)}ms`,
    per * 2000 / 1000 < 12, { per, acc: acc > 0 });
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — a place, not twelve creams');
if (bad) process.exitCode = 1;
