/**
 * THE INDEXED BANK PASS AGREES WITH THE UNINDEXED POINT QUERY.
 *
 *   node cells/drive/devtools/bank-pass.test.mjs
 *
 * The bank is read two ways and must not be written twice. `bankPass` is
 * STATION-DRIVEN through a grid, because a shoreline at half a field texel is
 * hundreds of stations and a refined tile is tens of thousands of vertices, so
 * the naive product is tens of millions of box tests for a build that used to
 * cost a hundred milliseconds all in. `bankTargetAtPacked` is a plain walk over
 * every station, which is what the diagnostic asks and the build never needs.
 * One `bankProfileY` between them, so they cannot disagree about the PROFILE —
 * and this is what says they do not disagree about which stations they reach.
 *
 * Three claims:
 *
 *   - EVERY VERTEX ENDS AT THE LOWER OF ITS OWN HEIGHT AND THE POINT QUERY'S,
 *     over a dense lattice with stations laid so their boxes straddle cell
 *     boundaries — which is the only arrangement that can catch a bucket that
 *     registers a station too narrowly.
 *   - `owned` IS SET WHEREVER A STATION SPOKE, refusal included: that is the
 *     flag the channel carve stands down on, and a refused station must own its
 *     land side while changing no height at all.
 *   - A ROAD VERTEX IS OWNED AND NOT LOWERED. Cutting a carriageway is the
 *     crossing authority's call; standing down there silently would let the
 *     carve dig it instead.
 *
 * The negative control is the whole point: the bundle is re-imported with the
 * station's own reach removed from its insertion box, so a station registers in
 * one cell only. Every claim above must then FAIL — a check that cannot fail on
 * the fault it names is decoration, which this file has recorded three times.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/bank-pass');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'terrain-kernel.mjs');
execSync(`npx esbuild ${join(CELL, 'client/terrain-kernel.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'inherit' });
const BROKEN = join(OUT, 'terrain-kernel-narrow.mjs');
{
  const src = readFileSync(BUNDLE, 'utf8');
  const needle = 'const m = reach + packed[o + 8];';
  if (!src.includes(needle)) { console.log('FAIL the negative control could not find the insertion box'); process.exit(1); }
  writeFileSync(BROKEN, src.replace(needle, 'const m = 0;'));
}
const mk = async (path) => (await import(path)).createTerrainKernel(
  () => ({ a: new Uint8Array(0), b: new Uint8Array(0) }), 1);
const K = await mk(BUNDLE);
const KN = await mk(BROKEN);

// The packet's layout is the resolver's; built by hand here rather than taken
// from bank-profile.ts, so what is under test is the KERNEL's reading of it and
// nothing else. [x, z, outX, outZ, waterline(absolute, already submerged),
// innerBed, innerReach, outerReach, alongM, k, protectReach, flags]
const STRIDE = 12;
const station = (o) => [
  o.x, o.z, o.nx, o.nz, o.wl, o.bed, o.inR, o.outR, o.alongM, o.k, o.protect ?? 0, o.flags ?? 0,
];

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

// A tile 240 m square on a 5 m lattice, with the river running east-west
// through the middle. The stations sit at 6 m along the shore — finer than the
// 24 m grid cell, so a station's own box spans several cells and several
// stations share each one, which is the arrangement the index has to survive.
const TILE = { tx: 0, ty: 0, xs: 0, zs: 0, w: 240, h: 240 };
const STEP = 5, NAT = 20;
const mkPos = () => {
  const cols = TILE.w / STEP + 1, rows = TILE.h / STEP + 1;
  const pos = new Float32Array(cols * rows * 3);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    pos[i * 3] = TILE.xs + c * STEP - ox;
    pos[i * 3 + 1] = NAT;
    pos[i * 3 + 2] = TILE.zs + r * STEP - oz;
    i++;
  }
  return pos;
};
const packed = (() => {
  const rows = [];
  for (let x = 12; x <= 228; x += 6) {
    // Both banks of a channel at z = 120, outward normals pointing away from it.
    rows.push(station({ x, z: 112, nx: 0, nz: -1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 3.5, k: 0.25 }));
    rows.push(station({ x, z: 128, nx: 0, nz: 1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 3.5, k: 0.25 }));
  }
  // One refused station away from the channel: it must own its land side and
  // move nothing, which is a different fact from "no station reached here".
  rows.push(station({ x: 60, z: 40, nx: 0, nz: 1, wl: 19, bed: 18, inR: 6, outR: 10, alongM: 6, k: 0.3, protect: 9, flags: 1 }));
  const out = new Float32Array(rows.length * STRIDE);
  rows.forEach((r, i) => out.set(r, i * STRIDE));
  return out;
})();

const storeOf = (onRoad = () => false) => ({
  grid: 24, baseElev: 0, onRoad,
  hydroBank: () => packed,
});

/** Run a kernel's pass and compare every vertex against the point query. */
const run = (kernel, onRoad = () => false) => {
  const pos = mkPos();
  const owned = new Uint8Array(pos.length / 3);
  const store = storeOf(onRoad);
  const moved = kernel.bankPass(store, TILE, pos, owned);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  let wrong = 0, ownedWrong = 0, lowered = 0, ownedN = 0, worst = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
    // The point query is the reference: it walks every station and knows
    // nothing of the grid, so a disagreement is the index's.
    const q = K.bankTargetAtPacked(packed, x, z);
    const road = onRoad(x, z);
    const want = q && q.y !== null && !road ? Math.min(NAT, q.y) : NAT;
    const got = pos[v * 3 + 1];
    if (Math.abs(got - want) > 1e-6) { wrong++; worst = Math.max(worst, Math.abs(got - want)); }
    if ((owned[v] === 1) !== !!(q && q.owned)) ownedWrong++;
    if (got < NAT - 1e-9) lowered++;
    if (owned[v]) ownedN++;
  }
  return { wrong, ownedWrong, lowered, ownedN, moved, worst, n: pos.length / 3 };
};

console.log('the indexed pass agrees with the point query:');
{
  const r = run(K);
  check(r.wrong === 0, `every vertex ends at the lower of its own height and the query's (wrong ${r.wrong}, worst ${r.worst.toFixed(6)} m)`);
  check(r.ownedWrong === 0, `owned matches the query's own flag at every vertex (mismatched ${r.ownedWrong})`);
  // Without these the run above is vacuous: a pass that touched nothing agrees
  // with a query that answers nothing everywhere.
  check(r.lowered > 200, `and it actually lowered ground (${r.lowered} of ${r.n} vertices, moved ${r.moved})`);
  check(r.ownedN > r.lowered, `owning more than it lowered — the refusal and the underwater flat own without moving (${r.ownedN} owned)`);
}

console.log('a road vertex is owned and not lowered:');
{
  const onRoad = (x, z) => Math.abs(z - 120) < 30 && x >= 90 && x <= 150;
  const r = run(K, onRoad);
  check(r.wrong === 0, `the pass leaves the carriageway where it found it (wrong ${r.wrong})`);
  const pos = mkPos(), owned = new Uint8Array(pos.length / 3);
  K.bankPass(storeOf(onRoad), TILE, pos, owned);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  let roadOwned = 0, roadMoved = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
    if (!onRoad(x, z)) continue;
    const q = K.bankTargetAtPacked(packed, x, z);
    if (!q) continue;
    if (owned[v]) roadOwned++;
    if (pos[v * 3 + 1] < NAT - 1e-9) roadMoved++;
  }
  check(roadOwned > 0 && roadMoved === 0,
    `road vertices a station reached are owned (${roadOwned}) and none was lowered (${roadMoved})`);
}

console.log('the refused station owns its land side and nothing else:');
{
  const pos = mkPos(), owned = new Uint8Array(pos.length / 3);
  K.bankPass(storeOf(), TILE, pos, owned);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  let owns = 0, moves = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
    if (Math.abs(x - 60) > 6 || z < 40 || z > 49) continue;      // inside its protect box only
    if (owned[v]) owns++;
    if (pos[v * 3 + 1] < NAT - 1e-9) moves++;
  }
  check(owns > 0 && moves === 0, `owned ${owns} vertices beside the refusal and moved ${moves}`);
}

console.log('THE CONTROL — a station registered in one cell only:');
{
  const r = run(KN);
  check(r.wrong > 0, `the narrow index misses stations the query finds (wrong ${r.wrong}, worst ${r.worst.toFixed(2)} m)`);
  check(r.ownedWrong > 0, `and gets the owned flag wrong too (mismatched ${r.ownedWrong})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
