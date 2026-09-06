/**
 * THE CLIMATE MODEL, AGAINST REAL PLACES.
 *
 *   node cells/drive/devtools/climate-fixtures.test.mjs
 *
 * The five-biome model is checked against itself: it is fed a moisture read
 * off the land cover and asked which biome that is, which is partly circular
 * and cannot be wrong in an interesting way. `siteAt` is not — it takes
 * latitude, height, distance to the sea and the shape of the terrain, and
 * reports physical quantities that the world can be consulted about.
 *
 * So this is a test against the WORLD, not against the code. Each fixture is a
 * real place with published climate normals, and the assertions are bands wide
 * enough to be honest about a model built from three gaussians and a lapse
 * rate — but narrow enough that getting a place's CHARACTER wrong fails.
 * Cape Town must come out summer-dry and maritime; Manaus must come out wet
 * all year; the Gobi must come out bitter in winter and dry.
 *
 * Pure TypeScript, bundled and imported — no browser, no tiles, no cover
 * raster, seconds rather than minutes. The same route culture.test.mjs takes.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'climate-'));
const built = join(tmp, 'climate.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/climate.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { siteAt, aspectLift, beltRainAt, upwindAt, treelineAt, seaTempAt } =
  await import(pathToFileURL(built).href);
// The baked coast field, bundled separately — atob is a browser global that
// node has had since 16, so the module loads unchanged.
const coastBuilt = join(tmp, 'coast.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/coast.ts'), '--bundle', '--format=esm',
  `--outfile=${coastBuilt}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { coastKm, onLand } = await import(pathToFileURL(coastBuilt).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const band = (name, v, lo, hi) =>
  ok(`${name} in [${lo}, ${hi}]`, v >= lo && v <= hi, +(+v).toFixed(2));

/**
 * A site is a latitude, a height, a distance to the sea, and a piece of
 * terrain. `relief` describes the ground around the point so the local half
 * has something to read: `up` is how much higher the ring is (a hollow),
 * `tilt` the fall per metre, `face` which way it falls RELATIVE TO THE SUN
 * (+1 toward the equator, −1 away) and `fall` which way it falls in ABSOLUTE
 * world terms (+1 toward +z, which is south, whatever the hemisphere).
 *
 * BOTH, DELIBERATELY. `face` reads naturally and is hemisphere-relative — and
 * a hemisphere-relative fixture cannot catch a hemisphere-symmetric error,
 * which is exactly what happened: this helper's own hillside carried the same
 * inverted sign as `siteAt`, the two agreed, and every insolation assertion
 * below was green while the model called a pole-facing slope full sun. `fall`
 * is the control that has no opinion about the sun at all, so the SAME piece
 * of ground can be asked about at +45° and −45° and must answer oppositely.
 */
const at = (lat, elev, coastKm, relief = {}) => {
  const { up = 0, tilt = 0, face = 0, fall = 0, upwind = 0, seaM = null } = relief;
  const env = {
    latAt: () => lat,
    latAbsAt: () => Math.abs(lat),
    // Kilometres for continentality; metres, separately, for salt.
    coastKmAt: () => coastKm,
    seaNearAt: () => seaM,
    coverAt: () => null,
    groundAt: (x, z) => {
      const r = Math.hypot(x, z);
      if (r < 1) return elev;
      // Upwind relief lives out at 15-40km; the ring and the slope are local.
      if (r > 10000) return elev + upwind;
      if (r > 150) return elev + up;
      // GROUND FALLING TOWARD +z IS GROUND WHOSE HEIGHT DECREASES WITH z, so
      // a fall of `k` per metre toward +z is `-k*z`. That minus is the one the
      // first version of this helper was missing.
      //
      // `face` +1 means "toward the equator": +z (south) in the north, −z in
      // the south, so it carries the hemisphere. `fall` +1 means "+z", full
      // stop. They add, so a fixture may use either.
      const sunZ = lat >= 0 ? 1 : -1;
      return elev - tilt * z * (face * sunZ + fall);
    },
  };
  const site = siteAt(env, 0, 0);
  // The shipping aspect term, over the SAME ground, so the two can be checked
  // against each other rather than each against its author's idea of a slope.
  // `northness` is +1 poleward, so a positive lift is the shaded face.
  site.aspectLiftM = aspectLift(env, 0, 0, lat);
  return site;
};

console.log('── the circulation, before any land ──');
band('equator rain', beltRainAt(0), 2000, 2700);
band('subtropical-high rain at 25°', beltRainAt(25), 120, 400);
band('storm-track rain at 52°', beltRainAt(52), 900, 1200);
ok('the trades blow easterly, the westerlies do not',
  upwindAt(15)[0] === 1 && upwindAt(45)[0] === -1 && upwindAt(70)[0] === 1,
  [upwindAt(15), upwindAt(45), upwindAt(70)]);

console.log('\n── CAPE PENINSULA · fynbos (real: 17°C, ~515mm, summer-dry, maritime) ──');
const cape = at(-34.0, 200, 2);
band('mean temperature', cape.heatC, 13, 21);
band('annual water', cape.waterMm, 250, 900);
ok('summer-dry, not winter-dry', cape.summerDry > 0.5 && cape.summerDry > cape.winterDry * 2, cape);
ok('maritime', cape.contin < 0.15, cape.contin);
ok('frost-free', cape.frostDays < 20, cape.frostDays);

console.log('\n── YOSEMITE · oak woodland to treeline (real: valley 1200m ~11°C, treeline ~3200m) ──');
const yoValley = at(37.75, 1200, 250);
const yoHigh = at(37.75, 3000, 250);
band('valley temperature', yoValley.heatC, 6, 15);
ok('valley is below the treeline', yoValley.treelineDelta < -800, yoValley.treelineDelta);
ok('3000m is near or above it', yoHigh.treelineDelta > -500, yoHigh.treelineDelta);
ok('summer-dry at this latitude too', yoValley.summerDry > 0.4, yoValley.summerDry);
ok('more continental than the Cape', yoValley.contin > cape.contin, [yoValley.contin, cape.contin]);

console.log('\n── SWISS ALPS · broadleaf to krummholz (real: 1600m ~4°C, treeline ~2200m) ──');
const alpLow = at(46.3, 700, 500);
const alpHigh = at(46.3, 2400, 500);
band('1600m-equivalent temperature', at(46.3, 1600, 500).heatC, 0, 9);
ok('700m is well below the treeline', alpLow.treelineDelta < -1000, alpLow.treelineDelta);
ok('2400m is above it', alpHigh.treelineDelta > 0, alpHigh.treelineDelta);
ok('hard winters', alpHigh.frostDays > 150, alpHigh.frostDays);

console.log('\n── COASTAL CALIFORNIA · the fixture no climate model can pass ──');
// One climate cell. Two places. The whole argument for a local term.
const ridge = at(37.0, 300, 3, { tilt: 0.35, face: 1 });
const ravine = at(37.0, 300, 3, { up: 120, tilt: 0.35, face: -1 });
ok('identical climate', Math.abs(ridge.waterMm - ravine.waterMm) < 1
  && Math.abs(ridge.heatC - ravine.heatC) < 0.01, [ridge.waterMm, ravine.waterMm]);
ok('the sun-facing slope takes more sun', ridge.insolation > 0.7, ridge.insolation);
ok('the shaded ravine takes less', ravine.insolation < 0.3, ravine.insolation);
// ── AND THE SAME HILLSIDE, ASKED IN BOTH HEMISPHERES ──
// `fall` has no opinion about the sun: this is one piece of ground falling
// toward +z (south) at 1:3. In the north that is the sunny face; at the same
// latitude south of the equator it is the shaded one. A sign error in either
// the model or this helper is symmetric and would pass every assertion above;
// it cannot pass this pair.
const fallsSouthN = at(45.0, 300, 400, { tilt: 0.35, fall: 1 });
const fallsSouthS = at(-45.0, 300, 400, { tilt: 0.35, fall: 1 });
ok('a south-falling slope is sunny in the NORTHERN hemisphere',
  fallsSouthN.insolation > 0.7, fallsSouthN.insolation);
ok('…and shaded in the southern', fallsSouthS.insolation < 0.3, fallsSouthS.insolation);
// And against the term the game has actually shipped for months: aspectLift
// treats a poleward face as extra HEIGHT, so its sign is the opposite of the
// sun's. Two independent readings of one slope, and they must disagree.
for (const [what, s] of [['north', fallsSouthN], ['south', fallsSouthS],
  ['a sunny ridge', ridge], ['a shaded ravine', ravine]]) {
  ok(`insolation and aspectLift agree about ${what}`,
    (s.insolation > 0.5) === (s.aspectLiftM < 0),
    { insolation: +s.insolation.toFixed(2), aspectLiftM: +s.aspectLiftM.toFixed(1) });
}
ok('and the ravine keeps its water', ravine.wetness > 0.6 && ridge.wetness < 0.2,
  [ravine.wetness, ridge.wetness]);

console.log('\n── TROPICAL RAINFOREST vs SAVANNA (Manaus 3°S ~2300mm; Zambia 13°S winter-dry) ──');
const manaus = at(-3.1, 60, 1400);
const savanna = at(-13.0, 1100, 800);
band('Manaus temperature', manaus.heatC, 24, 30);
band('Manaus water', manaus.waterMm, 1200, 2600);
ok('Manaus has no dry half-year', manaus.winterDry < 0.35 && manaus.summerDry < 0.2, manaus);
ok('the savanna does', savanna.winterDry > 0.6, savanna.winterDry);
ok('…and is drier', savanna.waterMm < manaus.waterMm * 0.8, [savanna.waterMm, manaus.waterMm]);

console.log('\n── MANGROVE COAST vs the same latitude inland ──');
const mangrove = at(-8.0, 1, 0, { seaM: 120 });
const inland = at(-8.0, 40, 60);
ok('salt at the waterline', mangrove.salt > 0.5, mangrove.salt);
ok('none inland', inland.salt < 0.01, inland.salt);
ok('warm enough for it', mangrove.heatC > 20, mangrove.heatC);

console.log('\n── HOT DESERT vs COLD STEPPE — the pair the five-class model calls one thing ──');
const sahara = at(25.0, 300, 600);
const gobi = at(45.0, 1200, 1600, { upwind: 2400 });
band('Sahara water', sahara.waterMm, 0, 350);
band('Gobi water', gobi.waterMm, 0, 400);
ok('the Sahara does not freeze', sahara.frostDays < 30, sahara.frostDays);
ok('the Gobi does, bitterly', gobi.frostDays > 120, gobi.frostDays);
ok('and its winter is far colder', gobi.winterC < sahara.winterC - 15,
  [gobi.winterC, sahara.winterC]);
ok('the Gobi sits in a rain shadow', gobi.rainShadow > 0.5, gobi.rainShadow);

console.log('\n── the sea is not evidence-free ──');
const unknown = at(40, 300, null);
ok('an unknown coast is middling, not continental', !unknown.hadCoast
  && unknown.contin > 0.3 && unknown.contin < 0.6, unknown.contin);
ok('and reports no salt rather than guessing', unknown.salt === 0, unknown.salt);

/**
 * ── AND THE NORMALS THEMSELVES, WITH THE ERROR STATED ──
 *
 * Everything above tests CHARACTER — summer-dry, maritime, above the treeline
 * — which is what the guilds will read. This tests the numbers against
 * published means, because the first version of these fixtures passed a model
 * that was six degrees wrong at Reykjavik and had half of Manaus's rain: the
 * bands were wide enough to be useless. The tolerances here are the ones the
 * model actually earns, and tightening them is how the next improvement gets
 * noticed rather than absorbed.
 *
 * `up` is the upwind ground at 15-40km: negative where the air climbed to
 * reach the site (a windward range), positive where it had to cross one first.
 */
console.log('\n── against published normals ──');
console.log('site            model            real       error');
const NORMALS = [
  // name,          lat,    elev, coast,   up,     realC, realMm, tolC, tolMm
  ['Cape Town',    -34.0,   200,       2,     0,   16.7,   515,  3.5,  0.55],
  ['Yosemite',      37.75, 1200,     250, -1150,   11.0,   900,  3.5,  0.55],
  ['Zermatt',       46.0,  1600,     250, -1200,    3.9,   700,  3.5,  0.55],
  ['Manaus',        -3.1,    60,    1200,     0,   27.4,  2300,  3.5,  0.35],
  ['Lusaka',       -15.4,  1280,     800,     0,   20.4,   830,  3.5,  0.60],
  ['Ulaanbaatar',   47.9,  1300,    1380,  2400,   -0.4,   267,  3.5,  0.55],
  ['Singapore',      1.3,    15,      57,     0,   27.8,  2170,  3.5,  0.35],
  ['Reykjavik',     64.1,    40,      24,     0,    5.0,   800,  3.5,  0.55],
  ['Irkutsk',       52.3,   440,    1827,     0,    1.0,   470,  3.5,  0.55],
];
for (const [name, lat, elev, coast, up, realC, realMm, tolC, tolMm] of NORMALS) {
  const s = at(lat, elev, coast, { upwind: up });
  const dC = s.heatC - realC;
  const rat = s.waterMm / realMm;
  console.log(`${name.padEnd(14)} ${s.heatC.toFixed(1).padStart(6)}C ${String(Math.round(s.waterMm)).padStart(5)}mm  `
    + `${realC.toFixed(1).padStart(6)}C ${String(realMm).padStart(5)}mm  `
    + `${(dC >= 0 ? '+' : '') + dC.toFixed(1)}C  x${rat.toFixed(2)}`);
  ok(`${name}: within ${tolC}C`, Math.abs(dC) <= tolC, +dC.toFixed(1));
  ok(`${name}: rain within ${(1 / (1 - tolMm)).toFixed(1)}x`,
    rat >= 1 - tolMm && rat <= 1 / (1 - tolMm), +rat.toFixed(2));
}

/**
 * THE DESERTS ARE THE KNOWN MISS, and it is recorded rather than tuned away.
 * A heated plateau does not cool at the free-air lapse rate — Tamanrasset sits
 * 1380m up and stays hot — and three gaussians have no way to make a place as
 * dry as the Sahara actually is. Asserted LOOSELY and deliberately, so the
 * suite says out loud where the model is weakest instead of omitting it.
 */
console.log('\n── the known miss: deserts run cold and wet in this model ──');
for (const [name, lat, elev, coast, up, realC, realMm] of [
  ['Tamanrasset', 22.8, 1380, 600, 0, 22.0, 45],
  ['Death Valley', 36.5, -60, 250, 2000, 25.0, 60],
]) {
  const s = at(lat, elev, coast, { upwind: up });
  console.log(`${name.padEnd(14)} ${s.heatC.toFixed(1).padStart(6)}C ${String(Math.round(s.waterMm)).padStart(5)}mm  `
    + `${realC.toFixed(1).padStart(6)}C ${String(realMm).padStart(5)}mm  `
    + `${(s.heatC - realC).toFixed(1)}C  x${(s.waterMm / realMm).toFixed(1)}`);
  ok(`${name}: still recognisably a desert (under 250mm)`, s.waterMm < 250, Math.round(s.waterMm));
  ok(`${name}: and still hot (over 15C)`, s.heatC > 15, +s.heatC.toFixed(1));
}

/**
 * ── AND NOW WITH THE REAL FIELD UNDER IT ──
 *
 * Everything above hands `siteAt` a coast distance by hand, which tests the
 * model and not the data. This drives it from the BAKED field at real
 * coordinates, so a bake that is upside down, off by a hemisphere or scaled
 * wrongly fails here rather than in a screenshot three weeks later. The
 * distances themselves are checked first, because a climate built on a broken
 * lookup would be wrong in ways that still looked plausible.
 */
console.log('\n── the baked coast field, at real coordinates ──');
for (const [name, lat, lon, lo, hi] of [
  ['Cape Town',      -34.00,  18.42,    0,   60],
  ['Reykjavik',       64.14, -21.94,    0,   60],
  ['Singapore',        1.35, 103.82,    0,   90],
  ['Zermatt',         46.02,   7.75,  150,  400],
  ['Yosemite',        37.75,-119.55,  150,  400],
  ['Manaus',          -3.12, -60.02,  900, 1600],
  ['Ulaanbaatar',     47.89, 106.92, 1100, 1900],
  ['Irkutsk',         52.29, 104.30, 1500, 2300],
]) {
  const km = coastKm(lat, lon);
  console.log(`  ${name.padEnd(14)} ${Math.round(km).toString().padStart(5)} km`);
  ok(`${name}: coast distance in [${lo}, ${hi}] km`, km >= lo && km <= hi, Math.round(km));
}
ok('mid-Pacific is sea', !onLand(0, -140), coastKm(0, -140));
ok('mid-Sahara is land', onLand(23, 12), coastKm(23, 12));
// A hemisphere flip is the classic bake bug and reads as plausible everywhere
// except where the two hemispheres disagree, so it is asserted directly.
ok('the field is not flipped in latitude',
  coastKm(52.29, 104.30) > 1000 && coastKm(-52.29, 104.30) < 200,
  [Math.round(coastKm(52.29, 104.3)), Math.round(coastKm(-52.29, 104.3))]);

console.log('\n── the whole chain: baked coast into the site model ──');
const real = (lat, lon, elev, up = 0) => siteAt({
  latAt: () => lat, latAbsAt: () => Math.abs(lat),
  coastKmAt: () => coastKm(lat, lon),
  seaNearAt: () => null,
  coverAt: () => null,
  groundAt: (x, z) => (Math.hypot(x, z) > 10000 ? elev + up : elev),
}, 0, 0);
for (const [name, lat, lon, elev, up, realC, tolC] of [
  ['Reykjavik',   64.14, -21.94,   40,     0,  5.0, 3.5],
  ['Irkutsk',     52.29, 104.30,  440,     0,  1.0, 3.5],
  ['Cape Town',  -34.00,  18.42,  200,     0, 16.7, 3.5],
  ['Manaus',      -3.12, -60.02,   60,     0, 27.4, 3.5],
  ['Zermatt',     46.02,   7.75, 1600, -1200,  3.9, 3.5],
]) {
  const s = real(lat, lon, elev, up);
  const d = s.heatC - realC;
  console.log(`  ${name.padEnd(14)} ${s.heatC.toFixed(1).padStart(6)}C  `
    + `${String(Math.round(s.waterMm)).padStart(5)}mm  cont ${s.contin.toFixed(2)}  `
    + `(${(d >= 0 ? '+' : '') + d.toFixed(1)}C)`);
  ok(`${name}: end to end within ${tolC}C`, Math.abs(d) <= tolC, +d.toFixed(1));
}

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
