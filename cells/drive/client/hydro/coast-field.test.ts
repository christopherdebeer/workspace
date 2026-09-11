import { solveCoastField, swellSlowness, swellWavelengthM } from './coast-field';
import { analyseHydroTile, buildHydroTile, HYDRO_BUILD_PROF } from './build-tile';
import { HydroBodyRegistry } from './body-registry';
import type { HydroTileInput } from './types';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`coast field: ${message}`);
};

/** A straight beach: dry for x < shore, shelving at `slope` metres per metre
 *  seaward; optionally two arms of land making a bay that opens east. */
function grid(n: number, pixelM: number, shore: number, slope: number, bay?: { armRows: number; armLength: number }) {
  const wet = new Uint8Array(n * n), coastal = new Uint8Array(n * n), interior = new Uint8Array(n * n);
  const depth = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const i = z * n + x;
    let land = x < shore;
    if (bay && x < bay.armLength && (z < bay.armRows || z >= n - bay.armRows)) land = true;
    if (land) continue;
    wet[i] = 1; coastal[i] = 1;
    depth[i] = (x - shore + 0.5) * pixelM * slope;
  }
  return { width: n, height: n, pixelM, wet, coastal, interior, depth, swellWavelengthM: 240 };
}

export function runCoastFieldTest(): void {
  assert(Math.abs(swellWavelengthM(1e6) - 240) < 1e-6 && Math.abs(swellWavelengthM(80) - 38) < 1e-6,
    'the swell wavelength is the shader\'s ramp: 38 m at no fetch, 240 m on the open sea');
  const k0 = (2 * Math.PI) / 240;
  const deep = swellSlowness(k0, 1000), shallow = swellSlowness(k0, 2);
  assert(Math.abs(deep - k0 / Math.sqrt(9.81 * k0)) < 1e-9, 'deep water keeps the deep-water slowness');
  assert(shallow > deep * 3, `two metres of water is much slower than deep (${shallow.toFixed(4)} vs ${deep.toFixed(4)} s/m)`);

  const n = 96, pixelM = 18.75, shore = 24;
  const beach = solveCoastField(grid(n, pixelM, shore, 0.05));
  const at = (x: number, z: number) => beach.data.subarray((z * n + x) * 4, (z * n + x) * 4 + 4);
  assert(at(10, 48)[0] === 0 && at(10, 48)[3] === 1, 'dry ground carries no travel and full exposure');
  const row = [];
  for (let x = shore; x < n; x++) row.push(at(x, 48)[0]);
  for (let x = 1; x < row.length; x++) assert(row[x] > row[x - 1], `travel increases seaward (x=${x + shore})`);
  assert(row[0] > 0 && row[0] < pixelM * 4, `the first wet texel is within a few texels of travel (${row[0].toFixed(1)} m)`);
  // Shallow water is slower: travel in deep-water metres outruns distance.
  const distAt = (x: number) => (x - shore + 1) * pixelM;
  assert(at(30, 48)[0] > distAt(30) * 1.3, `over the shallows travel outruns distance (${at(30, 48)[0].toFixed(0)} vs ${distAt(30).toFixed(0)} m)`);
  // …inside the band each texel adds distance at the dispersion's own rate
  // for the depth there (twelve metres is far from deep for a 240 m swell)…
  const dBand = at(38, 48)[0] - at(34, 48)[0];
  // The solver takes the DEEPER of the tile's own soundings and its beach
  // shelf, so the expectation has to take it too — here the shelf is deeper
  // than this fixture's 1-in-20 slope, and it is the shelf that sets the rate.
  const runM = (36 - shore + 0.5) * pixelM;
  const hBand = Math.max(runM * 0.05, runM * 0.06);
  const rateBand = Math.min(3, swellSlowness(k0, hBand) / deep);
  assert(Math.abs(dBand / (4 * pixelM) / rateBand - 1) < 0.08,
    `twelve metres down adds distance at the dispersion rate (${(dBand / (4 * pixelM)).toFixed(3)} vs ${rateBand.toFixed(3)})`);
  // …and past the sixteen-texel band the far field is grown at the deep
  // rate, monotone and seamless — the shader never phases on it out there.
  const dFar = at(90, 48)[0] - at(86, 48)[0];
  assert(Math.abs(dFar / (4 * pixelM) - 1) < 0.05, `the far field grows at the deep-water rate (${(dFar / (4 * pixelM)).toFixed(3)})`);
  for (let x = 38; x < 60; x++) assert(at(x + 1, 48)[0] - at(x, 48)[0] > 0, `no seam at the band's edge (x=${x})`);
  assert(at(60, 48)[1] > 0.99 && Math.abs(at(60, 48)[2]) < 0.05, 'the seaward direction off a straight beach points offshore');
  assert(at(28, 48)[3] > 0.95, `an open beach is exposed (${at(28, 48)[3].toFixed(2)})`);
  // Rows are identical along a straight beach: the solver has no sweep bias.
  assert(Math.abs(at(40, 20)[0] - at(40, 70)[0]) < pixelM * 0.05, 'the field is uniform along a straight beach');

  const bay = solveCoastField(grid(n, pixelM, shore, 0.05, { armRows: 20, armLength: 64 }));
  const bayAt = (x: number, z: number) => bay.data.subarray((z * n + x) * 4, (z * n + x) * 4 + 4);
  assert(bayAt(28, 48)[3] < 0.7, `the back of a bay is sheltered (${bayAt(28, 48)[3].toFixed(2)})`);
  assert(bayAt(28, 48)[3] < beach.data[(48 * n + 28) * 4 + 3] - 0.25, 'the bay is markedly less exposed than the open beach');
  assert(bayAt(90, 48)[3] > 0.9, `outside the bay the sea is open (${bayAt(90, 48)[3].toFixed(2)})`);
  // Inside the bay the travel still grows away from the nearest shore (its
  // back), and the arms are land the solve never crossed.
  assert(bayAt(44, 48)[0] > bayAt(30, 48)[0] && bayAt(30, 48)[0] > 0, 'travel grows out from the back of the bay');
  assert(bayAt(40, 10)[0] === 0 && bayAt(40, 10)[3] === 1, 'an arm of the bay is land');

  // ── A SEA WITH NO SOUNDINGS STILL REFRACTS ──
  // Terrarium encodes open water as zero, so a real sea arrives at a uniform
  // 0.40 m: every texel equally slow, the cap flattening them all to three
  // times deep, no gradient and therefore no refraction — a threefold phase
  // stretch and nothing else. The shelf profile restores the gradient.
  const flatGrid = grid(n, pixelM, shore, 0);
  for (let i = 0; i < flatGrid.depth.length; i++) if (flatGrid.wet[i]) flatGrid.depth[i] = 0.4;
  const flat = solveCoastField(flatGrid);
  const fAt = (x: number): number => flat.data[(48 * n + x) * 4];
  const nearRate = fAt(shore + 4) - fAt(shore + 2);
  const farRate = fAt(shore + 15) - fAt(shore + 13);
  assert(nearRate > farRate * 1.1,
    `a fill-flat sea still slows toward the beach (${nearRate.toFixed(1)} vs ${farRate.toFixed(1)} m per two texels)`);
  for (let x = shore + 1; x < shore + 20; x++) {
    assert(fAt(x + 1) > fAt(x), `and stays monotone across the band (x=${x})`);
  }

  // ── ONLY LAND STOPS A SWELL ──
  // Water of another kind — a land-cover polygon lying over the sea — used
  // to wall the exposure fan and read shelter on open water.
  const otherKind = grid(n, pixelM, shore, 0.05);
  for (let z = 30; z < 66; z++) for (let x = shore + 8; x < shore + 20; x++) {
    otherKind.coastal[z * n + x] = 0;              // wet, not this body's kind
  }
  const across = solveCoastField(otherKind);
  assert(across.data[((48 * n) + shore + 2) * 4 + 3] > 0.9,
    `a foreign water body does not shelter the beach behind it (${across.data[((48 * n) + shore + 2) * 4 + 3].toFixed(2)})`);

  // A tile wholly at sea, no shore in its grid: every texel carries the
  // plain (clamped) distance, never a zero that would read as the waterline.
  const open = solveCoastField(grid(n, pixelM, 0, 0.05));
  for (const z of [0, 48, 95]) for (const x of [0, 48, 95]) {
    assert(open.data[(z * n + x) * 4] >= 1000 && open.data[(z * n + x) * 4 + 3] === 1,
      `open sea carries the distance clamp and full exposure (${open.data[(z * n + x) * 4].toFixed(0)})`);
  }

  // The full build on a coastal tile carries the field, and it is cheap.
  const N = 33;
  const elev = new Float32Array(N * N), cov = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const wx = x / (N - 1);
    elev[z * N + x] = wx < 0.3 ? 12 - wx * 40 : -(wx - 0.3) * 60;
    cov[z * N + x] = Math.round(255 * (wx < 0.32 ? 0.5 : wx < 0.45 ? 0.8 : 1));
  }
  const input: HydroTileInput = {
    key: 'coast/0/0', revision: 1,
    bounds: { minX: 0, minZ: 0, maxX: 2400, maxZ: 2400 },
    elevation: { width: N, height: N, data: elev },
    features: [],
    oceanCoverage: { status: 'ready', grid: { width: N, height: N, data: cov } },
  };
  const registry = new HydroBodyRegistry(0);
  const analysis = analyseHydroTile(input);
  registry.updateTile(input.key, analysis.observations);
  const before = HYDRO_BUILD_PROF.coast;
  const field = buildHydroTile(input, registry, analysis, { fieldResolution: 128 });
  const coastMs = HYDRO_BUILD_PROF.coast - before;
  assert(field.hasWater && field.coast, 'a coastal tile builds a coast field');
  let wetTexels = 0, withTravel = 0;
  for (let i = 0; i < field.width * field.height; i++) {
    if (field.geometry[i * 4 + 1] <= 0) continue;
    wetTexels++;
    if (field.coast![i * 4] > 0) withTravel++;
  }
  assert(withTravel > wetTexels * 0.95, `every wet texel has a travel time (${withTravel}/${wetTexels})`);
  assert(coastMs < 60, `the coast solve is a small part of a build (${coastMs.toFixed(1)} ms at 128²)`);
  const off = buildHydroTile(input, registry, analysis, { fieldResolution: 128, coastField: false });
  assert(!off.coast, 'coastField: false builds no field');
  console.log(`  coast: fill-flat slowing ${nearRate.toFixed(1)}→${farRate.toFixed(1)} m/2 texels · beach cycles ${beach.stats.cycles} solve ${beach.stats.solveMs.toFixed(1)} ms exposure ${beach.stats.exposureMs.toFixed(1)} ms · tile build coast ${coastMs.toFixed(1)} ms`);
}
