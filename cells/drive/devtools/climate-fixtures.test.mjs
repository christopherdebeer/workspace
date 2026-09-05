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
const { siteAt, beltRainAt, upwindAt, treelineAt, seaTempAt } =
  await import(pathToFileURL(built).href);

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
 * `tilt` the fall per metre and `face` which way it falls (+1 toward the
 * equator, −1 away).
 */
const at = (lat, elev, coastM, relief = {}) => {
  const { up = 0, tilt = 0, face = 0, upwind = 0 } = relief;
  const env = {
    latAt: () => lat,
    latAbsAt: () => Math.abs(lat),
    coastAt: () => coastM,
    coverAt: () => null,
    groundAt: (x, z) => {
      const r = Math.hypot(x, z);
      if (r < 1) return elev;
      // Upwind relief lives out at 15-40km; the ring and the slope are local.
      if (r > 10000) return elev + upwind;
      if (r > 150) return elev + up;
      // A slope falling toward the equator has `face` +1. −z is north.
      const sunZ = lat >= 0 ? 1 : -1;
      return elev + (z / Math.max(1, Math.abs(z))) * 0 + tilt * z * face * sunZ;
    },
  };
  return siteAt(env, 0, 0);
};

console.log('── the circulation, before any land ──');
band('equator rain', beltRainAt(0), 2000, 2700);
band('subtropical-high rain at 25°', beltRainAt(25), 120, 400);
band('storm-track rain at 52°', beltRainAt(52), 900, 1200);
ok('the trades blow easterly, the westerlies do not',
  upwindAt(15)[0] === 1 && upwindAt(45)[0] === -1 && upwindAt(70)[0] === 1,
  [upwindAt(15), upwindAt(45), upwindAt(70)]);

console.log('\n── CAPE PENINSULA · fynbos (real: 17°C, ~515mm, summer-dry, maritime) ──');
const cape = at(-34.0, 200, 2000);
band('mean temperature', cape.heatC, 13, 21);
band('annual water', cape.waterMm, 250, 900);
ok('summer-dry, not winter-dry', cape.summerDry > 0.5 && cape.summerDry > cape.winterDry * 2, cape);
ok('maritime', cape.contin < 0.15, cape.contin);
ok('frost-free', cape.frostDays < 20, cape.frostDays);

console.log('\n── YOSEMITE · oak woodland to treeline (real: valley 1200m ~11°C, treeline ~3200m) ──');
const yoValley = at(37.75, 1200, 250000);
const yoHigh = at(37.75, 3000, 250000);
band('valley temperature', yoValley.heatC, 6, 15);
ok('valley is below the treeline', yoValley.treelineDelta < -800, yoValley.treelineDelta);
ok('3000m is near or above it', yoHigh.treelineDelta > -500, yoHigh.treelineDelta);
ok('summer-dry at this latitude too', yoValley.summerDry > 0.4, yoValley.summerDry);
ok('more continental than the Cape', yoValley.contin > cape.contin, [yoValley.contin, cape.contin]);

console.log('\n── SWISS ALPS · broadleaf to krummholz (real: 1600m ~4°C, treeline ~2200m) ──');
const alpLow = at(46.3, 700, 500000);
const alpHigh = at(46.3, 2400, 500000);
band('1600m-equivalent temperature', at(46.3, 1600, 500000).heatC, 0, 9);
ok('700m is well below the treeline', alpLow.treelineDelta < -1000, alpLow.treelineDelta);
ok('2400m is above it', alpHigh.treelineDelta > 0, alpHigh.treelineDelta);
ok('hard winters', alpHigh.frostDays > 150, alpHigh.frostDays);

console.log('\n── COASTAL CALIFORNIA · the fixture no climate model can pass ──');
// One climate cell. Two places. The whole argument for a local term.
const ridge = at(37.0, 300, 3000, { tilt: 0.35, face: 1 });
const ravine = at(37.0, 300, 3000, { up: 120, tilt: 0.35, face: -1 });
ok('identical climate', Math.abs(ridge.waterMm - ravine.waterMm) < 1
  && Math.abs(ridge.heatC - ravine.heatC) < 0.01, [ridge.waterMm, ravine.waterMm]);
ok('the sun-facing slope takes more sun', ridge.insolation > 0.7, ridge.insolation);
ok('the shaded ravine takes less', ravine.insolation < 0.3, ravine.insolation);
ok('and the ravine keeps its water', ravine.wetness > 0.6 && ridge.wetness < 0.2,
  [ravine.wetness, ridge.wetness]);

console.log('\n── TROPICAL RAINFOREST vs SAVANNA (Manaus 3°S ~2300mm; Zambia 13°S winter-dry) ──');
const manaus = at(-3.1, 60, 1400000);
const savanna = at(-13.0, 1100, 800000);
band('Manaus temperature', manaus.heatC, 24, 30);
band('Manaus water', manaus.waterMm, 1200, 2600);
ok('Manaus has no dry half-year', manaus.winterDry < 0.35 && manaus.summerDry < 0.2, manaus);
ok('the savanna does', savanna.winterDry > 0.6, savanna.winterDry);
ok('…and is drier', savanna.waterMm < manaus.waterMm * 0.8, [savanna.waterMm, manaus.waterMm]);

console.log('\n── MANGROVE COAST vs the same latitude inland ──');
const mangrove = at(-8.0, 1, 120);
const inland = at(-8.0, 40, 60000);
ok('salt at the waterline', mangrove.salt > 0.5, mangrove.salt);
ok('none inland', inland.salt < 0.01, inland.salt);
ok('warm enough for it', mangrove.heatC > 20, mangrove.heatC);

console.log('\n── HOT DESERT vs COLD STEPPE — the pair the five-class model calls one thing ──');
const sahara = at(25.0, 300, 600000);
const gobi = at(45.0, 1200, 1600000, { upwind: 2400 });
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
  ['Cape Town',    -34.0,   200,    2000,     0,   16.7,   515,  3.5,  0.55],
  ['Yosemite',      37.75, 1200,  250000, -1150,   11.0,   900,  3.5,  0.55],
  ['Zermatt',       46.0,  1600,  500000, -1200,    3.9,   700,  3.5,  0.55],
  ['Manaus',        -3.1,    60, 1400000,     0,   27.4,  2300,  3.5,  0.35],
  ['Lusaka',       -15.4,  1280,  800000,     0,   20.4,   830,  3.5,  0.60],
  ['Ulaanbaatar',   47.9,  1300, 1600000,  2400,   -0.4,   267,  3.5,  0.55],
  ['Singapore',      1.3,    15,    5000,     0,   27.8,  2170,  3.5,  0.35],
  ['Reykjavik',     64.1,    40,    2000,     0,    5.0,   800,  3.5,  0.55],
  ['Irkutsk',       52.3,   440, 2500000,     0,    1.0,   470,  3.5,  0.55],
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
  ['Tamanrasset', 22.8, 1380, 600000, 0, 22.0, 45],
  ['Death Valley', 36.5, -60, 250000, 2000, 25.0, 60],
]) {
  const s = at(lat, elev, coast, { upwind: up });
  console.log(`${name.padEnd(14)} ${s.heatC.toFixed(1).padStart(6)}C ${String(Math.round(s.waterMm)).padStart(5)}mm  `
    + `${realC.toFixed(1).padStart(6)}C ${String(realMm).padStart(5)}mm  `
    + `${(s.heatC - realC).toFixed(1)}C  x${(s.waterMm / realMm).toFixed(1)}`);
  ok(`${name}: still recognisably a desert (under 250mm)`, s.waterMm < 250, Math.round(s.waterMm));
  ok(`${name}: and still hot (over 15C)`, s.heatC > 15, +s.heatC.toFixed(1));
}

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
