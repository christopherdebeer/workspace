/**
 * THE ROAD BENCH — road archetype x data failure mode.
 *
 *   node cells/drive/devtools/roadbench/bench.mjs
 *   node cells/drive/devtools/roadbench/bench.mjs --fixture=shelf
 *
 * A fixture is one road with a REFERENCE surface it is known to sit on. Every
 * variant degrades that one surface in one way, so a difference in the answer
 * has one cause — which a collection of geographically diverse roads can never
 * give you, because in those everything differs at once.
 *
 * The real Terrarium tile belongs here as ONE variant beside the rest. It is
 * not the reference: its resolution, provenance and seams are among the things
 * being measured, so it cannot also be the measuring stick.
 *
 * WHAT A FIXTURE NEEDS, and deliberately not more: a truth profile along the
 * authoritative alignment, a reference height field near the road, and the OSM
 * geometry as OSM actually has it. Not a national LiDAR raster — a few hundred
 * elevations and a small patch is all a contrast needs, which keeps fixtures
 * small, clearly derivative, and easy to attribute.
 */
import { solveChain, latCands, chosenOffsets, BENCH_OFFS } from './solver.mjs';
import * as D from './degrade.mjs';
import { scoreProfile, scoreCompensation, row } from './score.mjs';

/** Run one variant: build candidates from `sample`, solve, score. */
export function runVariant({ fixture, sample, name, dx = 0, dz = 0, weights }) {
  const pts = fixture.drawn;                     // where the game puts the road
  const cand = pts.map((_, i) => latCands(pts, i, sample));
  const got = solveChain(pts, cand, fixture.maxGrade, null, null, undefined, weights);
  const offsets = chosenOffsets(cand, got);
  const s = scoreProfile({
    pts, got, truth: fixture.truthOnLine,
    grades: fixture.grades, bridgeMask: fixture.bridgeMask,
  });
  const comp = (dx || dz) ? scoreCompensation({ pts, offsets, dx, dz }) : null;
  return { name, score: s, comp, got, offsets };
}

/** The standard contrast set, from one reference surface. */
export function variants(fixture) {
  const ref = fixture.reference;
  const box = fixture.box;
  const out = [
    { name: 'reference (1m)', sample: ref },
    { name: 'resample 3m', sample: D.resample(ref, 3, box) },
    { name: 'resample 10m', sample: D.resample(ref, 10, box) },
    { name: 'resample 30m', sample: D.resample(ref, 30, box) },
    // ACROSS THE ROAD, NOT ALONG IT. A first cut displaced in +x, which for a
    // road running down +x is longitudinal — on a constant grade that is a
    // constant height shift, which the datum reconciliation correctly removes,
    // so every displacement variant scored a perfect zero and tested nothing.
    // Misregistration only matters in the lateral component, which is exactly
    // what scoreCompensation decomposes.
    { name: 'displaced 5m', sample: D.displace(ref, 0, 5), dx: 0, dz: 5 },
    { name: 'displaced 15m', sample: D.displace(ref, 0, 15), dx: 0, dz: 15 },
    { name: 'displaced 30m', sample: D.displace(ref, 0, 30), dx: 0, dz: 30 },
    // OFF THE CANDIDATE LATTICE ON PURPOSE. BENCH_OFFS is spaced every 15m, so
    // a 15 or 30m shift can be compensated EXACTLY and flatters the DP. 22m
    // cannot: the best it can do is 15 or 30, and what it does with a shift it
    // cannot cancel is the more honest question.
    { name: 'displaced 22m (off-lattice)', sample: D.displace(ref, 0, 22), dx: 0, dz: 22 },
    { name: 'vertical bias +7m', sample: D.bias(ref, 7) },
    { name: 'tile steps 0.4m', sample: D.tileSteps(ref, 600, 0.4) },
    { name: '10m + displaced 15m',
      sample: D.pipe(ref, [(s) => D.resample(s, 10, box), (s) => D.displace(s, 0, 15)]),
      dx: 0, dz: 15 },
  ];
  if (fixture.canopy) {
    out.push({ name: 'DSM (canopy)', sample: D.dsm(ref, { cover: fixture.canopy }) });
    out.push({ name: 'DSM + 10m', sample: D.resample(D.dsm(ref, { cover: fixture.canopy }), 10, box) });
  }
  if (fixture.waterAt) {
    out.push({ name: 'water bench', sample: D.water(ref, fixture.waterAt) });
  }
  return out;
}

export function runFixture(fixture, { weights } = {}) {
  const rows = [];
  for (const v of variants(fixture)) {
    rows.push(runVariant({ fixture, weights, ...v }));
  }
  return rows;
}

export function report(fixture, rows) {
  console.log(`\n── ${fixture.id}: ${fixture.name}`);
  console.log(`   truth ${fixture.truthGrade} · ${fixture.stations} stations · ${fixture.attribution}`);
  for (const r of rows) console.log('   ' + row(r.name, r.score, r.comp));
}
