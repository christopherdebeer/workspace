/**
 * ── A DRY TILE'S SHORT-CIRCUIT IS THE OLD PATH, BYTE FOR BYTE ──
 *
 *   node cells/drive/devtools/hydro-dry.test.mjs
 *
 * `buildHydroTile` now skips eleven full-grid passes when the tile holds no
 * water, and writes their answer as a constant instead. The claim is that the
 * constant is EXACT — the value the skipped code provably produces with an
 * empty coverage array — and a claim like that is worth exactly as much as the
 * control that checks it. So this drives the SHIPPED function beside the one
 * it replaced, extracted from git, and requires every channel of every field
 * to be identical: geometry, dynamics, material, ground, the scalars, and the
 * optional structure and waterfall planes.
 *
 * THE OLD CODE IS THE TEST'S CONTROL — the rule `client/clip.test.mjs` set
 * when the Liang–Barsky clipper replaced the vertex walk, and the reason that
 * fix could be believed. A pass here says the skip changed nothing; it says
 * nothing about whether the skip is faster, which is `hydro-phases.mjs`.
 *
 * HOW THE CONTROL IS BUILT. `client/hydro/` is copied to node_modules/.cache
 * and its `build-tile.ts` overwritten with the revision's (REV=, default the
 * merge base with HEAD's parent — in practice whatever HEAD holds). Every
 * import in that chain is a sibling inside the directory, which is what makes
 * a directory copy enough; if build-tile ever reaches outside `hydro/`, this
 * has to copy the whole of `client/` the way openDrive({rev}) does.
 *
 * A WET CASE IS NOT OPTIONAL. A control that only ever ran the dry path would
 * pass with the guard inverted, so both fixtures run: a tile with a river in
 * it (which must take the untouched path) and a tile with none.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CELL, ROOT } from './harness.mjs';

// ── THE CONTROL IS PINNED, AND IT HAS TO BE ──
//
// This defaulted to HEAD, which was right for exactly as long as HEAD was the
// commit before the short-circuit: the moment it landed, HEAD's build-tile
// became the SHIPPED one and the test would have compared the fix against
// itself and passed vacuously. That is the `baseline-refresh.txt` trap — a
// check whose control moves with the code it is checking — and it is caught
// below by refusing a control that already carries the flag.
const REV = process.env.REV ?? '71f79db';
const cache = join(ROOT, 'node_modules/.cache/hydro-dry');
rmSync(cache, { recursive: true, force: true });
mkdirSync(cache, { recursive: true });

// The working tree's copy, bundled as it stands.
const bundle = (dir, out) => {
  execFileSync('npx', ['esbuild', join(dir, 'build-tile.ts'),
    '--bundle', '--format=esm', `--outfile=${out}`], { stdio: 'pipe', cwd: ROOT });
  return out;
};
const fixDir = join(cache, 'fix');
cpSync(join(CELL, 'client/hydro'), fixDir, { recursive: true });
const ctlDir = join(cache, 'ctl');
cpSync(join(CELL, 'client/hydro'), ctlDir, { recursive: true });
const ctlSrc = execFileSync('git', ['show', `${REV}:cells/drive/client/hydro/build-tile.ts`],
  { cwd: ROOT, maxBuffer: 1 << 26 }).toString('utf8');
// A CONTROL THAT ALREADY CARRIES THE CHANGE IS NOT A CONTROL. Refused loudly
// rather than passing quietly, because the failure mode of a stale pin is a
// green run that proves nothing.
if (ctlSrc.includes('anyCoverage')) {
  console.log(`\nthe control at ${REV} already has the short-circuit — it is not a control.`);
  console.log('Pin REV to a revision before the change, or retire this check.');
  process.exit(1);
}
writeFileSync(join(ctlDir, 'build-tile.ts'), ctlSrc);

const FIX = await import(bundle(fixDir, join(cache, 'fix.mjs')));
const CTL = await import(bundle(ctlDir, join(cache, 'ctl.mjs')));
const REG = await import(await (async () => {
  const out = join(cache, 'registry.mjs');
  execFileSync('npx', ['esbuild', join(fixDir, 'body-registry.ts'),
    '--bundle', '--format=esm', `--outfile=${out}`], { stdio: 'pipe', cwd: ROOT });
  return out;
})());

// ── THE TWO TILES ──
// A 1 km box with a 132-point elevation grid, the same shape hydroFeed hands
// the system: a valley falling east to west with a channel through it.
const N = 132;
const bounds = { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 };
const elevation = { width: N, height: N, data: new Float32Array(N * N), verticalDatum: 'absolute-m' };
for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
  const z = (iz / (N - 1)) * 1000;
  elevation.data[iz * N + ix] = 100 + Math.abs(z - 500) * 0.04;
}
const river = {
  id: 'w/1', kind: 'river', source: 'osm', intermittent: false, tidal: false,
  geometry: { type: 'line', widthM: 22, points: new Float32Array([40, 500, 500, 500, 960, 500]) },
};
const dryFeature = {
  id: 'w/2', kind: 'lake', source: 'osm', intermittent: false, tidal: false,
  // Wholly OUTSIDE the tile: hydroFeed gathers by bbox overlap with a pad, so
  // a body just past the edge is exactly the case that gets fed and paints
  // nothing — which is what makes a dry build so common.
  geometry: { type: 'area', polygons: [{ outer: new Float32Array([2000, 2000, 2100, 2000, 2100, 2100, 2000, 2100]), holes: [] }] },
};
const ocean = { status: 'ready', width: 2, height: 2, data: new Uint8Array(4), bounds };

const inputFor = (features) => ({
  key: 't/0', revision: 1, bounds, elevation, features,
  oceanCoverage: { status: 'unavailable' },
});

let fails = 0;
const eq = (name, a, b) => {
  if (a === b) return;
  console.log(`  FAIL ${name}: ${a} vs ${b}`); fails++;
};
const eqArr = (name, a, b) => {
  if (!a && !b) return;
  if (!a || !b) { console.log(`  FAIL ${name}: one side absent (${!!a} / ${!!b})`); fails++; return; }
  if (a.length !== b.length) { console.log(`  FAIL ${name}: length ${a.length} vs ${b.length}`); fails++; return; }
  let worst = 0, at = -1;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst !== 0) { console.log(`  FAIL ${name}: worst ${worst} at ${at} (${a[at]} vs ${b[at]})`); fails++; }
};

for (const [label, features] of [['dry', [dryFeature]], ['river', [river]]]) {
  const run = (M) => {
    const input = inputFor(features);
    const analysis = M.analyseHydroTile(input);
    const registry = new REG.HydroBodyRegistry(0);
    registry.updateTile(input.key, analysis.observations);
    return M.buildHydroTile(input, registry, analysis, { fieldResolution: 128, gutter: 6 });
  };
  const a = run(CTL), b = run(FIX);
  console.log(`${label}: coverage>0.005 in ${[...a.geometry].filter((_, i) => i % 4 === 0).filter((v) => v > 0.005).length} texels`);
  eq(`${label} width`, a.width, b.width);
  eq(`${label} elevationBaseM`, a.elevationBaseM, b.elevationBaseM);
  eq(`${label} waterBounds`, JSON.stringify(a.waterBounds ?? null), JSON.stringify(b.waterBounds ?? null));
  eqArr(`${label} geometry`, a.geometry, b.geometry);
  eqArr(`${label} dynamics`, a.dynamics, b.dynamics);
  eqArr(`${label} material`, a.material, b.material);
  eqArr(`${label} ground`, a.ground, b.ground);
  eqArr(`${label} structure`, a.structure, b.structure);
  eqArr(`${label} waterfalls`, a.waterfalls, b.waterfalls);
  eqArr(`${label} coast`, a.coast, b.coast);
}

// ── AND THE RETAINED CASE, WHICH IS THE ONE THAT COULD DELETE A SEA ──
//
// `anyCoverage` is set by the last-known-good retention as well as by a paint,
// because a rebuild that lands before its features do keeps the previous
// field's water — the straight-edged rectangle of sea that vanished at
// Monterey is what that retention exists to stop. A short-circuit that read
// only the paints would take the same rectangle away again, so the case is
// asserted rather than reasoned about: build a river tile, then rebuild it
// with NO features at all and hand the first field in as `previous`.
{
  const run = (M) => {
    const wetIn = inputFor([river]);
    const wetAn = M.analyseHydroTile(wetIn);
    const reg = new REG.HydroBodyRegistry(0);
    reg.updateTile(wetIn.key, wetAn.observations);
    const first = M.buildHydroTile(wetIn, reg, wetAn, { fieldResolution: 128, gutter: 6 });
    const bareIn = { ...inputFor([]), revision: 2 };
    const bareAn = M.analyseHydroTile(bareIn);
    return M.buildHydroTile(bareIn, reg, bareAn, { fieldResolution: 128, gutter: 6 }, first);
  };
  const a = run(CTL), b = run(FIX);
  let wet = 0;
  for (let i = 0; i < b.width * b.height; i++) if (b.geometry[i * 4] > 0.005) wet++;
  if (wet < 200) { console.log(`  FAIL retention kept no water (${wet} texels) — the case is vacuous`); fails++; }
  else console.log(`retained: ${wet} wet texels survive a featureless rebuild`);
  eqArr('retained geometry', a.geometry, b.geometry);
  eqArr('retained dynamics', a.dynamics, b.dynamics);
  eqArr('retained material', a.material, b.material);
  eqArr('retained ground', a.ground, b.ground);
  eqArr('retained structure', a.structure, b.structure);
}

// THE CONTROL HAS TO BE ABLE TO FAIL. A river tile whose field matched a dry
// one would mean both paths were producing the same nothing; this asserts the
// wet fixture really does carry water, so the comparison above has content.
{
  const input = inputFor([river]);
  const analysis = FIX.analyseHydroTile(input);
  const registry = new REG.HydroBodyRegistry(0);
  registry.updateTile(input.key, analysis.observations);
  const f = FIX.buildHydroTile(input, registry, analysis, { fieldResolution: 128, gutter: 6 });
  let wet = 0;
  for (let i = 0; i < f.width * f.height; i++) if (f.geometry[i * 4] > 0.005) wet++;
  if (wet < 200) { console.log(`  FAIL the wet fixture carries no water (${wet} texels)`); fails++; }
  else console.log(`river fixture carries ${wet} wet texels`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);
