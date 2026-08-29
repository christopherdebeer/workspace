/**
 * CLIMATE FIELD TESTS — no browser, no renderer, no truck.
 *
 *   node cells/drive/devtools/climate.test.mjs
 *
 * Why this exists, precisely: the field's first cut sampled every 256m, the
 * far shell thrashed its cache, and the world stopped booting. That cost an
 * afternoon and three wrong hypotheses — and every fact needed to predict it
 * was arithmetic. THE CACHE BUDGET TEST BELOW would have failed in a
 * millisecond, before a browser was ever launched.
 *
 * The suites that do need a browser take four boots and about five minutes.
 * These take under a second, so they are the ones to run while iterating; the
 * browser is for integration, and `devtools/boot.mjs` answers "does it still
 * come up" in three seconds.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// TypeScript, compiled on the spot — the same route roadsolve.test.mjs takes.
// No build config to keep in step, and the module under test is the one the
// game ships rather than a copy of it.
const tmp = mkdtempSync(join(tmpdir(), 'climate-'));
const built = join(tmp, 'climate.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/climate.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
const {
  BIOME_ORDER, ALPINE, CLIM_G, CLIM_CACHE_MAX, ClimateField, climCompute,
  climPick, climPickRow, corners, seaTempAt, treelineAt,
  AltBand, ALT_BAND_NAMES, altBandAt, krummholz, swardLift, aspectLift, ASPECT_LIFT,
} = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── the curve against places we can actually drive to ──────────────
{
  const cases = [['Alps', 46, 2200, 250], ['Scandinavia', 62, 900, 200], ['Arctic margin', 70, 60, 200]];
  for (const [name, lat, real, tol] of cases) {
    const got = treelineAt(lat);
    ok(`treeline at ${name} (${lat}°) is ${Math.round(got)}m against a real ~${real}m`,
      near(got, real, tol), { got, real });
  }
  // The known miss, asserted AS a miss so nobody "fixes" the curve by
  // accident: continental interiors run high, and that residual is the
  // moisture term this curve does not take.
  ok('…and under-reads the continental Rockies, which is the moisture axis knocking',
    treelineAt(40) < 3000, { got: treelineAt(40), real: 3500 });
  ok('treeline reaches zero and never goes negative', treelineAt(89) === 0, treelineAt(89));
}
{
  const cases = [[0, 27, 1], [45, 13, 2], [60, 2.5, 2]];
  for (const [lat, want, tol] of cases) {
    ok(`sea-level temperature at ${lat}° is ~${want}°C`, near(seaTempAt(lat), want, tol),
      { got: +seaTempAt(lat).toFixed(1), want });
  }
}

// ── THE BUDGET. The test that was missing. ─────────────────────────
{
  // The far shell spans roughly a hundred kilometres. Whatever the spacing,
  // the corners it needs must FIT — a cap below the working set is not a cap,
  // it is a thrash: every read evicts a corner another read is about to want,
  // and twenty-five cover samples are paid again each time.
  const shell = corners(100000);
  ok(`a 100km consumer needs ${shell} corners, inside the ${CLIM_CACHE_MAX} cache`,
    shell < CLIM_CACHE_MAX, { shell, cap: CLIM_CACHE_MAX });
  // And the spacing that shipped first, kept as a regression: this is the
  // number that hung the boot.
  const at256 = corners(100000, 256);
  ok(`…where the original 256m spacing wanted ${at256}, which is why it hung`,
    at256 > CLIM_CACHE_MAX * 5, { at256 });
}

// ── the field: does it separate places, and does it do so smoothly ──
const mkEnv = (cover, lat, elev) => ({
  coverAt: () => cover, latAbsAt: () => lat, groundAt: typeof elev === 'function' ? elev : () => elev,
});
{
  const hotWet = climCompute(mkEnv(10, 5, 50), 0, 0, 0);      // tropical forest
  const hotDry = climCompute(mkEnv(60, 22, 200), 0, 0, 0);    // bare, subtropical
  ok('hot and wet reads tropical', BIOME_ORDER[hotWet.domIdx] === 'tropical', hotWet.w);
  ok('hot and dry reads arid', BIOME_ORDER[hotDry.domIdx] === 'arid', hotDry.w);
  ok('…so moisture alone separates them at the same latitude band',
    hotWet.domIdx !== hotDry.domIdx, [hotWet.domIdx, hotDry.domIdx]);
  const cold = climCompute(mkEnv(10, 62, 200), 0, 0, 0);
  ok('cold forest reads boreal', BIOME_ORDER[cold.domIdx] === 'boreal', cold.w);
  for (const c of [hotWet, hotDry, cold]) {
    ok('weights sum to one', near(c.w.reduce((a, b) => a + b, 0), 1, 1e-9), c.w);
  }
}
{
  // ALTITUDE, the axis that was silently missing: same latitude, same cover,
  // different height either side of the treeline.
  const low = climCompute(mkEnv(10, 46, 800), 0, 0, 0);
  const high = climCompute(mkEnv(10, 46, 2600), 0, 0, 0);
  ok(`below the treeline is not alpine (${BIOME_ORDER[low.domIdx]})`,
    low.domIdx !== ALPINE, low.w);
  ok(`above it is (${BIOME_ORDER[high.domIdx]}, alpine weight ${high.w[ALPINE].toFixed(2)})`,
    high.domIdx === ALPINE, high.w);
  ok('…and the temperature actually lapsed with the height',
    low.tempC - high.tempC > 10, { low: +low.tempC.toFixed(1), high: +high.tempC.toFixed(1) });
}
{
  // SMOOTHNESS. A field that steps is worse than one slightly wrong — a hard
  // boundary in a continuous world is a line the eye finds before any probe.
  // Elevation ramps across the walk, so this exercises the per-point treeline
  // too, which is where the lattice would have shown through.
  const f = new ClimateField(mkEnv(30, 46, (x) => 500 + x * 0.4));
  let worst = 0, worstAt = 0;
  let prev = null;
  for (let x = 0; x <= 12000; x += 100) {
    const c = f.at(x, 0, 500 + x * 0.4);
    const w = c.w.slice();
    if (prev) {
      for (let i = 0; i < 5; i++) worst = Math.max(worst, Math.abs(w[i] - prev[i]));
      if (worst === Math.max(...w.map((v, i) => Math.abs(v - prev[i])))) worstAt = x;
    }
    prev = w;
  }
  ok(`no step across 12km of climbing road (worst ${worst.toFixed(4)} per 100m at ${worstAt}m)`,
    worst < 0.05, { worst, worstAt });
  ok(`…and the walk crossed several lattice cells (${Math.round(12000 / CLIM_G)}), so it was tested`,
    12000 / CLIM_G > 3, 12000 / CLIM_G);
}
{
  // The cache must not thrash on a realistic walk, and evidence-free corners
  // must expire exactly once when cover lands rather than never or forever.
  let hasCover = false;
  const f = new ClimateField({
    coverAt: () => (hasCover ? 30 : null), latAbsAt: () => 46, groundAt: () => 600,
  });
  for (let x = 0; x < 100000; x += 500) f.at(x, 0, 600);
  ok(`a 100km walk leaves ${f.size} corners cached, no clear`, f.size < CLIM_CACHE_MAX, f.size);
  const before = f.at(0, 0, 600).hadCover;
  hasCover = true; f.noteCover();
  const after = f.at(0, 0, 600).hadCover;
  ok('a corner computed without cover is revisited when cover lands',
    before === false && after === true, { before, after });
}

// ── the pickers ────────────────────────────────────────────────────
{
  const tbl = { arid: [['cactus', 10]], boreal: [['conifer', 10]] };
  ok('a pure-arid climate picks the arid row',
    climPick(tbl, [1, 0, 0, 0, 0], () => 0.5) === 'cactus');
  ok('a pure-boreal one picks the boreal row',
    climPick(tbl, [0, 0, 0, 1, 0], () => 0.5) === 'conifer');
  // THE POINT OF BLENDING: a margin grows both, rather than flipping at a line.
  const mixed = [0.5, 0, 0, 0.5, 0];
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(climPick(tbl, mixed, () => i / 50));
  ok('a half-and-half margin grows both', seen.size === 2, [...seen]);
  ok('a table with no matching rows returns null',
    climPick({ tropical: [['palm', 1]] }, [1, 0, 0, 0, 0], () => 0.5) === null);
  const fauna = { temperate: [5, 5, 2], arid: [1, 3, 6] };
  ok('row tables pick by weight too', climPickRow(fauna, [1, 0, 0, 0, 0], 0.95) === 2,
    climPickRow(fauna, [1, 0, 0, 0, 0], 0.95));
}

// ── ALTITUDE BANDS ────────────────────────────────────────────────
{
  const tl = treelineAt(46);   // ~2307m, the Alps
  const at = (d) => ALT_BAND_NAMES[altBandAt(tl + d, tl)];
  ok('deep below the trees is montane', at(-1200) === 'montane', at(-1200));
  ok('just under the treeline is the thinning upper forest', at(-100) === 'treeline', at(-100));
  ok('just above it is krummholz', at(100) === 'krummholz', at(100));
  ok('higher still is alpine meadow', at(400) === 'meadow', at(400));
  ok('then scree', at(900) === 'scree', at(900));
  ok('then snow', at(1500) === 'snow', at(1500));
  // THE BANDS FOLLOW THE TREELINE, which is the whole point — the same
  // relative height is a different band at a different latitude only because
  // the treeline moved, never because a hard metre value was baked in.
  const arctic = treelineAt(68);
  ok(`the same band sequence holds at 68° where the treeline is ${Math.round(arctic)}m`,
    ALT_BAND_NAMES[altBandAt(arctic + 100, arctic)] === 'krummholz',
    ALT_BAND_NAMES[altBandAt(arctic + 100, arctic)]);
  ok('…and that is a far lower absolute height than the Alps krummholz',
    arctic + 100 < tl, { arctic: arctic + 100, alps: tl + 100 });
}
{
  // Krummholz is a CONTINUOUS collapse — a hard line of full trees stopping
  // dead is the most obvious tell of a synthetic mountain.
  const tl = 2300;
  ok('trees are full height in the forest', krummholz(tl - 800, tl) === 1);
  ok('nothing woody stands above the krummholz band', krummholz(tl + 400, tl) === 0);
  const mid = krummholz(tl + 100, tl);
  ok(`stunted in between (${mid.toFixed(2)} of full height)`, mid > 0 && mid < 0.3, mid);
  let worst = 0, prev = krummholz(tl - 900, tl);
  for (let d = -900; d <= 400; d += 10) {
    const v = krummholz(tl + d, tl);
    worst = Math.max(worst, Math.abs(v - prev)); prev = v;
  }
  ok(`and it never steps (worst ${worst.toFixed(3)} per 10m)`, worst < 0.03, worst);
  ok('the sward gets its best season in the meadow', swardLift(tl + 200, tl) > 1.2);
  ok('…and stops entirely under permanent snow', swardLift(tl + 1100, tl) === 0);
}

// ── ASPECT AS EFFECTIVE ELEVATION ─────────────────────────────────
{
  // North is -z. A slope descending north FACES north: shaded in the northern
  // hemisphere, so it should read as higher, colder ground.
  const slope = (dzPerM) => ({ coverAt: () => 30, latAbsAt: () => 46,
    groundAt: (x, z) => 1000 + z * dzPerM });
  // h = 1000 + z*k, so a POSITIVE k means height rises with z and the ground
  // descends toward -z, which is north: the shaded face. Getting this backwards
  // is exactly the kind of thing the test is for.
  const northFacing = aspectLift(slope(0.6), 0, 0, 46);    // descends toward -z (north)
  const southFacing = aspectLift(slope(-0.6), 0, 0, 46);   // descends toward +z (south)
  ok(`a pole-facing slope reads as higher ground (+${northFacing.toFixed(0)}m)`,
    northFacing > 50, northFacing);
  ok(`a sun-facing one reads as lower (${southFacing.toFixed(0)}m)`,
    southFacing < -50, southFacing);
  ok('the two are opposite and equal', near(northFacing, -southFacing, 1e-6),
    { northFacing, southFacing });
  ok('neither exceeds the declared lift', Math.abs(northFacing) <= ASPECT_LIFT + 1e-9, northFacing);
  // FLAT GROUND HAS NO ASPECT — otherwise noise in a plain becomes a climate.
  ok('a plain has no aspect at all', aspectLift(slope(0.001), 0, 0, 46) === 0,
    aspectLift(slope(0.001), 0, 0, 46));
  // AND IT FLIPS BELOW THE EQUATOR: the shaded face in Patagonia points south.
  const south = aspectLift(slope(0.6), 0, 0, -46);
  ok('below the equator the shaded face is the other one',
    Math.sign(south) === -Math.sign(northFacing), { north: northFacing, south });
  // A missing heightfield must not throw — this is asked during init.
  ok('an absent heightfield yields no lift rather than an exception',
    aspectLift({ coverAt: () => null, latAbsAt: () => 46,
      groundAt: () => { throw new Error('no terrain'); } }, 0, 0, 46) === 0);
}
{
  // THE PAYOFF, end to end: two facing hillsides at the SAME altitude land in
  // different bands, which is the thing that was impossible before.
  const tl = treelineAt(46);
  const h = tl - 120;                      // just inside the upper forest
  const shaded = altBandAt(h + ASPECT_LIFT, tl);
  const sunny = altBandAt(h - ASPECT_LIFT, tl);
  ok(`facing hillsides at one height read ${ALT_BAND_NAMES[sunny]} and ${ALT_BAND_NAMES[shaded]}`,
    shaded !== sunny, { sunny: ALT_BAND_NAMES[sunny], shaded: ALT_BAND_NAMES[shaded] });
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — the field varies, and it varies smoothly');
process.exit(bad ? 1 : 0);
