/**
 * A MAPPED CLIFF IS A VERTICAL FACE, WHATEVER THE DEM SAYS.
 *
 * Drives the shipped `buildTile` over a DEM that smears a 46 m step across
 * twenty metres of ground — what a z14 raster makes of a sea cliff — with one
 * `natural=cliff` line where the map puts the face. The plain lattice and
 * the refined path both: the high side stands at the top, the low side sits
 * at the foot, the DEM beyond the reach is untouched, a road keeps its deck,
 * a "cliff" on ground that does not fall is left alone, and the line drawn
 * the wrong way round gives the same face, because the DEM decides which side
 * is down. The control is the same store with no cliff lines, on which the
 * ramp survives.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/cliff-face');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'terrain-kernel.mjs');
execSync(`npx esbuild ${join(CELL, 'client/terrain-kernel.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`, { stdio: 'inherit' });
const K = (await import(BUNDLE)).createTerrainKernel(() => ({ a: new Uint8Array(0), b: new Uint8Array(0) }), 1);

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

const TOP = 50, FOOT = 4, SEG = 48, W = 240;
// The face the map draws is at x = 120; the DEM falls from 50 to 4 between
// x = 120 and x = 140 — a two-pixel smear at z14.
const ramp = (x) => x <= 120 ? TOP : x >= 140 ? FOOT : TOP + (FOOT - TOP) * ((x - 120) / 20);
const data = new Float32Array(256 * 256);
for (let v = 0; v < 256; v++) for (let u = 0; u < 256; u++) data[v * 256 + u] = ramp((u / 255) * W);
const TILE = { tx: 0, ty: 0, xs: 0, zs: 0, w: W, h: W, data };
const LINE = { ax: 120, az: -20, bx: 120, bz: 260 };

const storeOf = (over = {}) => ({
  heights: new Map([['0/0', TILE]]),
  hasHeight: () => true,
  sampleHeight: (x) => ramp(x),
  sampleHeightRaw: (x) => ramp(x),
  sampleCover: () => 30, coverPaint: () => 30, coverWater: () => false,
  crossingAt: () => null, cover: { water: 80, built: 50 },
  seaAbs: () => -500, baseElev: 0,
  strips: new Map(), cutL: 24, channels: new Map(), grid: 24,
  hydroBreakLines: () => [], hydroBank: () => null, hydroFloor: () => null,
  cliffLines: () => [LINE],
  onRoad: () => false, palette: () => [0.5, 0.5, 0.5], areaTint: () => null,
  borders: new Map(), nrmCoarsePx: 1, nrmRes: 1, cutWash: 0, cprobe: false, carveLog: new Map(), cutRelief: false,
  ...over,
});
const build = (over = {}, refine = false) => {
  const b = K.buildTile(storeOf(over), TILE, SEG, false, refine);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  const at = (x, z) => {
    let best = Infinity, y = NaN;
    for (let v = 0; v < b.pos.length / 3; v++) {
      const d = Math.hypot(b.pos[v * 3] + ox - x, b.pos[v * 3 + 2] + oz - z);
      if (d < best) { best = d; y = b.pos[v * 3 + 1]; }
    }
    return { y, d: best };
  };
  return { b, at };
};

for (const refine of [false, true]) {
  console.log(`\n── ${refine ? 'THE REFINED PATH' : 'THE PLAIN LATTICE'} ──`);
  const ctl = build({ cliffLines: () => [] }, refine);
  const cliff = build({}, refine);
  const rev = build({ cliffLines: () => [{ ax: 120, az: 260, bx: 120, bz: -20 }] }, refine);
  const road = build({ onRoad: (x) => x > 100 && x < 140 }, refine);
  const bank = build({ sampleHeight: (x) => 20 + ramp(x) * 0.05, sampleHeightRaw: (x) => 20 + ramp(x) * 0.05 }, refine);

  const c1 = ctl.at(130, 120).y, k1 = cliff.at(130, 120).y;
  check(Math.abs(c1 - 27) < 3, `the control is the DEM's ramp mid-smear (x 130: ${c1.toFixed(1)} m)`);
  check(k1 < FOOT + 0.8, `the low side inside the smear sits at the foot (x 130: ${k1.toFixed(1)} m, foot ${FOOT})`);
  check(Math.abs(cliff.at(110, 120).y - TOP) < 0.5, `the high side stands at the top (x 110: ${cliff.at(110, 120).y.toFixed(1)} m)`);
  check(Math.abs(cliff.at(200, 120).y - FOOT) < 1e-3 && Math.abs(cliff.at(40, 120).y - TOP) < 1e-3,
    `beyond the reach the DEM is untouched (x 40: ${cliff.at(40, 120).y.toFixed(1)}, x 200: ${cliff.at(200, 120).y.toFixed(1)})`);
  if (refine) {
    const hi = cliff.at(119.4, 120), lo = cliff.at(120.6, 120);
    check(hi.d < 0.05 && lo.d < 0.05, `the creases put vertices a hair either side of the line (${hi.d.toFixed(2)} / ${lo.d.toFixed(2)} m off)`);
    check(hi.y - lo.y > (TOP - FOOT) * 0.9, `…and the face between them is a wall: ${hi.y.toFixed(1)} → ${lo.y.toFixed(1)} over 1.2 m`);
  }
  check(Math.abs(rev.at(130, 120).y - k1) < 1e-6 && Math.abs(rev.at(110, 120).y - cliff.at(110, 120).y) < 1e-6,
    'the line drawn the other way round gives the same face — the DEM decides the low side');
  check(Math.abs(road.at(130, 120).y - c1) < 1e-6, `a road keeps its deck (x 130 on a road: ${road.at(130, 120).y.toFixed(1)} m)`);
  const bc = build({ cliffLines: () => [], sampleHeight: (x) => 20 + ramp(x) * 0.05, sampleHeightRaw: (x) => 20 + ramp(x) * 0.05 }, refine);
  check(Math.abs(bank.at(130, 120).y - bc.at(130, 120).y) < 1e-6, 'a mapped cliff on a 2 m bank moves nothing');
}
console.log(fails ? `\n${fails} FAILED` : '\ncliff-face: all ok');
process.exit(fails ? 1 : 0);
