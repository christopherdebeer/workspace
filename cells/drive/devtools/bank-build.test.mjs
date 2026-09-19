/**
 * THE WHOLE BUILD, WITH A BANK IN IT.
 *
 *   node cells/drive/devtools/bank-build.test.mjs
 *
 * `bank-pass.test.mjs` holds the bank layer against its own point query. This
 * holds the COMPOSITION, by driving the shipped `buildTile` over a synthetic
 * tile whose ground is flat — so the only things that can move a vertex are
 * the three rules under test, and whatever a vertex ends at names which of
 * them spoke.
 *
 *   - THE INTERIOR FLOOR STANDS DOWN INSIDE THE BANK'S REGION. The published
 *     floor lowers ground to the field's own bed on an ~18 m lattice; run
 *     first, it cut the vertex to the bed before anything asked what shape the
 *     bank should be, and the bank — which only ever lowers — could not put
 *     back the shelf, the toe or the refusal the resolver decided on. So the
 *     region is decided in the heights pass and the floor applies outside it.
 *   - A REFUSAL BINDS THE FLOOR TOO. "Nothing may change here" has to mean the
 *     floor as well as the carve, or a refused rock face is planed by the one
 *     rule that was not told.
 *   - THE CHANNEL CARVE STANDS DOWN THERE AS WELL, which is the rule that
 *     shipped with stage C and is re-checked here through the build rather
 *     than through the pass.
 *   - AND NEITHER THE TILE BOUNDARY NOR THE ORDER OF ARRIVAL CHANGES ANY OF
 *     IT: two tiles sharing an edge agree along it, and building them in
 *     either order is byte-identical.
 *
 * Both controls are the rules themselves, taken away one at a time: with no
 * packet the floor cuts the whole band (so the fixture can see the floor at
 * all), and with no floor the bank's region is unchanged (so the agreement is
 * not the floor and the bank happening to want the same height).
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/bank-build');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'terrain-kernel.mjs');
execSync(`npx esbuild ${join(CELL, 'client/terrain-kernel.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'inherit' });
// THE CONTROL IS THE RULE THIS UNIT CHANGED: the floor applied whether or not
// a station spoke for the vertex, which is the order that shipped. Both height
// passes carry the same guard, so one substitution takes both.
const FLOORFIRST = join(OUT, 'terrain-kernel-floorfirst.mjs');
{
  const src = readFileSync(BUNDLE, 'utf8');
  const needle = 'if (floor && !bankOwned[i])';
  const hits = src.split(needle).length - 1;
  if (hits !== 2) { console.log(`FAIL the control expected two floor sites, found ${hits}`); process.exit(1); }
  writeFileSync(FLOORFIRST, src.split(needle).join('if (floor)'));
}
const mk = async (path) => (await import(path)).createTerrainKernel(
  () => ({ a: new Uint8Array(0), b: new Uint8Array(0) }), 1);
const K = await mk(BUNDLE);
const KF = await mk(FLOORFIRST);

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

// ── THE FIXTURE ──
// A flat plateau at 20 m, 240 m square. A river runs east-west at z = 120 with
// its two shores at z = 112 and z = 128. Three regions, and each is a
// different rule's answer:
//
//   z in [ 98, 142]   the bank owns it            -> the profile, 16.5 .. 20
//   z in [ 80,  97]   the floor's band, unowned   -> cut to the bed, 14
//   z in [143, 160]   the same                    -> cut to the bed, 14
//   x in [ 40,  80] at z ~ 40  a REFUSAL          -> untouched at 20, though
//                                                    the floor's band covers it
const GROUND = 20, BED = 14, SEG = 48;
const TILE = { tx: 0, ty: 0, xs: 0, zs: 0, w: 240, h: 240, data: new Float32Array(256 * 256).fill(GROUND) };
const STRIDE = 15;
const station = (o) => [
  o.x, o.z, o.nx, o.nz, o.wl, o.bed, o.inR, o.outR, o.fwd ?? o.alongM, o.k,
  o.protect ?? 0, o.flags ?? 0, o.back ?? o.alongM, o.chain ?? 0, o.slope ?? 0,
];
const pack = (rows) => {
  const out = new Float32Array(rows.length * STRIDE);
  rows.forEach((r, i) => out.set(r, i * STRIDE));
  return out;
};
const PACKET = (() => {
  const rows = [];
  for (let x = 6; x <= 234; x += 4) {
    rows.push(station({ x, z: 112, nx: 0, nz: -1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 2, k: 0.25, chain: 0 }));
    rows.push(station({ x, z: 128, nx: 0, nz: 1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 2, k: 0.25, chain: 1 }));
  }
  // THE REFUSAL, INSIDE THE FLOOR'S BAND AND OUTSIDE THE BANK'S REGION — which
  // is the only arrangement that can tell "the refusal bound the floor" from
  // "the floor was never asked here". It owns 8 m of its land side, z 82..90,
  // where the band reaches to 76 and the near shore's own reach stops at 98.
  for (let x = 40; x <= 80; x += 4) {
    rows.push(station({ x, z: 82, nx: 0, nz: 1, wl: 19, bed: 18, inR: 6, outR: 10, alongM: 2, k: 0.3, protect: 8, flags: 1, chain: 2 }));
  }
  return pack(rows);
})();
// THE FLOOR: the field's bed over a band far wider than the bank's region, so
// the two overlap and one of them has to win. NaN where the field says
// nothing, which is what the publisher writes.
const FLOOR = (() => {
  const n = 33, data = new Float32Array(n * n).fill(NaN);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const z = TILE.zs + (iz / (n - 1)) * TILE.h;
    if (Math.abs(z - 120) <= 44) data[iz * n + ix] = BED;
  }
  return { n, data };
})();
// A channel down the middle: the carve would cut its bed to 10 m, which is
// four metres under anything the bank or the floor wants, so a vertex at 10 is
// unmistakably the carve's.
const CHANNEL = { ax: -40, az: 120, bx: 280, bz: 120, hw: 7, ya: 10, yb: 10 };

const storeOf = (over = {}, tile = TILE) => {
  const channels = new Map();
  const seg = over.channel === null ? null : CHANNEL;
  if (seg) {
    for (let cx = -3; cx <= 14; cx++) for (let cz = 3; cz <= 7; cz++) {
      channels.set(`${cx},${cz}`, [seg]);
    }
  }
  const heights = new Map([[`${tile.tx}/${tile.ty}`, tile]]);
  return {
    heights,
    hasHeight: () => true,
    sampleHeight: () => GROUND,
    sampleHeightRaw: () => GROUND,
    sampleCover: () => 30,
    coverPaint: () => 30,
    coverWater: () => false,
    crossingAt: () => null,
    cover: { water: 80, built: 50 },
    seaAbs: () => -500,
    baseElev: 0,
    strips: new Map(),
    cutL: 24,
    channels,
    grid: 24,
    hydroBreakLines: () => [],
    hydroBank: () => PACKET,
    hydroFloor: () => FLOOR,
    onRoad: () => false,
    palette: () => [0.5, 0.5, 0.5],
    areaTint: () => null,
    borders: new Map(),
    nrmCoarsePx: 1,
    nrmRes: 1,
    cutWash: 0,
    cprobe: false,
    carveLog: new Map(),
    cutRelief: false,
    ...over,
  };
};

/** Build a tile and return a reader: the height at the vertex nearest a point. */
const build = (over = {}, tile = TILE, refine = false, kernel = K) => {
  const b = kernel.buildTile(storeOf(over, tile), tile, SEG, false, refine);
  const ox = tile.xs + tile.w / 2, oz = tile.zs + tile.h / 2;
  const at = (x, z) => {
    let best = Infinity, y = NaN;
    for (let v = 0; v < b.pos.length / 3; v++) {
      const d = Math.hypot(b.pos[v * 3] + ox - x, b.pos[v * 3 + 2] + oz - z);
      if (d < best) { best = d; y = b.pos[v * 3 + 1]; }
    }
    return y;
  };
  return { b, at, ox, oz };
};

for (const refine of [false, true]) {
  console.log(`\n── ${refine ? 'THE REFINED PATH' : 'THE PLAIN LATTICE'} ──`);

  console.log('the fixture can see all three rules:');
  const full = build({}, TILE, refine);
  const noBank = build({ hydroBank: () => null }, TILE, refine);
  const noFloor = build({ hydroFloor: () => null }, TILE, refine);
  // The floor's own band, away from the bank and away from the channel.
  check(Math.abs(noBank.at(120, 90) - BED) < 1e-3,
    `with no packet the floor cuts the band to its bed (z 90: ${noBank.at(120, 90).toFixed(2)} m)`);
  check(Math.abs(noBank.at(60, 86) - BED) < 1e-3,
    `including the ground the refusal will later protect (60, 86: ${noBank.at(60, 86).toFixed(2)} m)`);
  check(Math.abs(noBank.at(120, 200) - GROUND) < 1e-3,
    `and leaves the ground outside it (z 200: ${noBank.at(120, 200).toFixed(2)} m)`);

  console.log('the floor stands down inside the bank’s region:');
  // Ten metres out from the near shore: the bank's land side is
  // 18 + 0.25 x 10 = 20.5, above the plateau, so the bank cuts nothing here —
  // and the height must still be the plateau rather than the floor's bed.
  const outer = full.at(120, 102);
  check(Math.abs(outer - GROUND) < 1e-3,
    `land the bank owns but does not cut keeps its ground (z 102: ${outer.toFixed(2)} m, not ${BED})`);
  // Mid channel: both faces have marched in to the stated bed.
  const mid = full.at(120, 120);
  check(Math.abs(mid - 16.5) < 0.2,
    `and the profile carries the interior connection (z 120: ${mid.toFixed(2)} m, the stated bed 16.5)`);
  check(mid > BED + 1,
    `which is the bank's bed and not the floor's (${mid.toFixed(2)} vs ${BED})`);
  // …and just outside the region the floor is still doing its job.
  check(Math.abs(full.at(120, 90) - BED) < 1e-3,
    `a metre past what any station spoke for, the floor is unchanged (z 90: ${full.at(120, 90).toFixed(2)} m)`);

  console.log('a refusal binds the floor as well as the carve:');
  const ref = full.at(60, 86);
  check(Math.abs(ref - GROUND) < 1e-3,
    `protected ground is untouched though the floor's band covers it (${ref.toFixed(2)} m, floor would give ${BED})`);
  check(Math.abs(noBank.at(60, 86) - BED) < 1e-3,
    `— and the control says the floor really would have (${noBank.at(60, 86).toFixed(2)} m)`);

  console.log('the channel carve stands down inside the region too:');
  check(full.at(120, 120) > 12,
    `the carve did not cut the owned channel to its invert (${full.at(120, 120).toFixed(2)} m, invert 10)`);
  const carved = build({ hydroBank: () => null, hydroFloor: () => null }, TILE, refine);
  check(Math.abs(carved.at(120, 120) - 10) < 0.3,
    `— and with nothing owning it, it does (${carved.at(120, 120).toFixed(2)} m)`);

  console.log('THE CONTROL — the floor applied before ownership was decided:');
  {
    const c = build({}, TILE, refine, KF);
    check(Math.abs(c.at(120, 102) - BED) < 1e-3,
      `it plants the bed on land the bank owns and does not cut (z 102: ${c.at(120, 102).toFixed(2)} m)`);
    check(Math.abs(c.at(60, 86) - BED) < 1e-3,
      `and on ground a refusal is protecting (60, 86: ${c.at(60, 86).toFixed(2)} m)`);
    check(c.at(120, 120) < 16, `and under the profile's own bed mid channel (${c.at(120, 120).toFixed(2)} m)`);
  }

  console.log('the bank and the floor are not the same answer:');
  let differ = 0, n = 0;
  for (let z = 100; z <= 140; z += 5) {
    n++;
    if (Math.abs(full.at(120, z) - noFloor.at(120, z)) > 1e-4) differ++;
  }
  check(differ === 0,
    `taking the floor away changes nothing inside the region (${differ} of ${n} stations differ)`);
}

console.log('\n── A TILE EDGE, AND EITHER ARRIVAL ORDER ──');
{
  const B = { tx: 1, ty: 0, xs: 240, zs: 0, w: 240, h: 240, data: TILE.data };
  // The packet a gutter'd field gives both tiles: stations running across the
  // shared edge, so each tile's grid has to carry the ones outside its own box.
  const seam = pack(Array.from({ length: 80 }, (_, i) => 200 + i * 4).flatMap((x) => [
    station({ x, z: 112, nx: 0, nz: -1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 2, k: 0.25, chain: 0 }),
    station({ x, z: 128, nx: 0, nz: 1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 2, k: 0.25, chain: 1 }),
  ]));
  const bankOf = () => seam;
  const rowOf = (tile) => {
    const r = build({ hydroBank: bankOf, borders: new Map() }, tile, false);
    const out = new Map();
    for (let v = 0; v < r.b.pos.length / 3; v++) {
      const x = r.b.pos[v * 3] + r.ox, z = r.b.pos[v * 3 + 2] + r.oz;
      if (Math.abs(x - 240) > 1e-6) continue;
      out.set(z.toFixed(3), r.b.pos[v * 3 + 1]);
    }
    return out;
  };
  const a = rowOf(TILE), b = rowOf(B);
  let shared = 0, worst = 0, cut = 0;
  for (const [k, ya] of a) {
    const yb = b.get(k);
    if (yb === undefined) continue;
    shared++;
    worst = Math.max(worst, Math.abs(ya - yb));
    if (ya < GROUND - 1e-6) cut++;
  }
  check(shared > 0 && cut > 0, `the two tiles share their border row and the bank cut it (${shared} shared, ${cut} cut)`);
  check(worst < 1e-6, `and they agree along it (worst ${worst.toExponential(1)} m)`);

  const b2 = rowOf(B), a2 = rowOf(TILE);
  let drift = 0;
  for (const [k, y] of a) if (a2.get(k) !== y) drift++;
  for (const [k, y] of b) if (b2.get(k) !== y) drift++;
  check(drift === 0, `building them in the other order changes nothing (${drift} differ)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
