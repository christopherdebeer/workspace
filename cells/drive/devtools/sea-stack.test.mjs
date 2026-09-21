/**
 * A RING WITH A HEIGHT STANDS UP OUT OF A DEM THAT NEVER SAW IT.
 *
 * Drives the shipped `buildTile` over a flat sea-level DEM with one
 * `natural=rock` ring carrying `height=45` — a sea stack, mapped or authored.
 * On both paths: inside the ring the ground stands 45 m over the base, the
 * water beyond it is untouched, the colour pass reads the inside as bare
 * ground whatever the cover raster says, a ring drawn on a hill rises from
 * the hill, and the control with no plinths is the flat sea bed.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/sea-stack');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'terrain-kernel.mjs');
execSync(`npx esbuild ${join(CELL, 'client/terrain-kernel.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`, { stdio: 'inherit' });
const K = (await import(BUNDLE)).createTerrainKernel(() => ({ a: new Uint8Array(0), b: new Uint8Array(0) }), 1);

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

const SEG = 48, W = 240, H = 45;
const flat = new Float32Array(256 * 256).fill(0);
const TILE = { tx: 0, ty: 0, xs: 0, zs: 0, w: W, h: W, data: flat };
// A 40 m square stack centred at (120, 120), drawn as OSM would: closed.
const RING = { pts: [[100, 100], [140, 100], [140, 140], [100, 140]], height: H };
const hill = (x) => 20 + x * 0.1;

const storeOf = (over = {}) => ({
  heights: new Map([['0/0', TILE]]),
  hasHeight: () => true,
  sampleHeight: () => 0,
  sampleHeightRaw: () => 0,
  sampleCover: () => 80, coverPaint: () => 80, coverWater: () => true,
  crossingAt: () => null, cover: { water: 80, built: 50 },
  seaAbs: () => -500, baseElev: 0,
  strips: new Map(), cutL: 24, channels: new Map(), grid: 24,
  hydroBreakLines: () => [], hydroBank: () => null, hydroFloor: () => null,
  cliffLines: () => [], plinths: () => [RING],
  onRoad: () => false,
  // The palette reports which cover it was handed: red for bare, blue for water.
  palette: (e, s, cover) => (cover === 60 ? [1, 0, 0] : [0, 0, 1]),
  areaTint: () => null,
  borders: new Map(), nrmCoarsePx: 1, nrmRes: 1, cutWash: 0, cprobe: false, carveLog: new Map(), cutRelief: false,
  ...over,
});
const build = (over = {}, refine = false) => {
  const b = K.buildTile(storeOf(over), TILE, SEG, false, refine);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  const at = (x, z) => {
    let best = Infinity, y = NaN, i = -1;
    for (let v = 0; v < b.pos.length / 3; v++) {
      const d = Math.hypot(b.pos[v * 3] + ox - x, b.pos[v * 3 + 2] + oz - z);
      if (d < best) { best = d; y = b.pos[v * 3 + 1]; i = v; }
    }
    return { y, d: best, r: b.col ? b.col[i * 3] : (b.colors ? b.colors[i * 3] : NaN) };
  };
  return { b, at };
};

for (const refine of [false, true]) {
  console.log(`\n── ${refine ? 'THE REFINED PATH' : 'THE PLAIN LATTICE'} ──`);
  const ctl = build({ plinths: () => [] }, refine);
  const stack = build({}, refine);
  check(Math.abs(ctl.at(120, 120).y) < 1e-6, `the control is the flat sea bed (centre: ${ctl.at(120, 120).y.toFixed(1)} m)`);
  check(Math.abs(stack.at(120, 120).y - H) < 0.5, `inside the ring the ground stands at the height (centre: ${stack.at(120, 120).y.toFixed(1)} m)`);
  check(Math.abs(stack.at(110, 130).y - H) < 0.5, `…out to the rounding (x 110 z 130: ${stack.at(110, 130).y.toFixed(1)} m)`);
  check(Math.abs(stack.at(180, 120).y) < 1e-6 && Math.abs(stack.at(120, 60).y) < 1e-6,
    `the sea beyond the ring is untouched (x 180: ${stack.at(180, 120).y.toFixed(1)}, z 60: ${stack.at(120, 60).y.toFixed(1)})`);
  const inside = stack.at(120, 120), outside = stack.at(180, 120);
  check(inside.r === 1 && outside.r === 0, `the colour pass reads the inside as bare ground and the outside as water (r ${inside.r} / ${outside.r})`);
  if (refine) {
    const hi = stack.at(139.4, 120), lo = stack.at(140.6, 120);
    check(hi.d < 0.05 && lo.d < 0.05, `the creases put vertices a hair either side of the ring (${hi.d.toFixed(2)} / ${lo.d.toFixed(2)} m off)`);
    check(hi.y - lo.y > H * 0.9, `…and the face between them is a wall: ${hi.y.toFixed(1)} → ${lo.y.toFixed(1)} over 1.2 m`);
  }
  // The crown given outright — a stack whose top was read off the mainland.
  const told = build({ plinths: () => [{ pts: RING.pts, height: NaN, top: 52 }] }, refine);
  check(Math.abs(told.at(120, 120).y - 52) < 0.5, `a ring with a stated crown stands at it, height or no height (centre: ${told.at(120, 120).y.toFixed(1)} m)`);
  // Not a drum: the crown rounds off toward the ring.
  const edge = stack.at(101.5, 120).y, mid = stack.at(120, 120).y;
  check(mid - edge > 2 && mid - edge < 4.5, `the crown rounds toward the edge (centre ${mid.toFixed(1)}, 1.5 m in ${edge.toFixed(1)})`);
  const onHill = build({ sampleHeight: hill, sampleHeightRaw: hill,
    heights: new Map([['0/0', { ...TILE, data: Float32Array.from({ length: 256 * 256 }, (_, i) => hill(((i % 256) / 255) * W)) }]]) }, refine);
  check(Math.abs(onHill.at(120, 120).y - (hill(120) + H)) < 1.5, `a ring on a hill rises from the hill (centre: ${onHill.at(120, 120).y.toFixed(1)} m, hill ${hill(120).toFixed(1)} + ${H})`);
}
console.log(fails ? `\n${fails} FAILED` : '\nsea-stack: all ok');
process.exit(fails ? 1 : 0);
