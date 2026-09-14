/**
 * ── WHICH PHASE OF A HYDRO BUILD, ON A FIXTURE ──
 *
 *   node cells/drive/devtools/hydro-phases.mjs
 *   FIX=at-senqu-top node .../hydro-phases.mjs
 *   SPOT='lat=37.73606&lon=-119.63732' node .../hydro-phases.mjs   (live)
 *
 * A device dump names `hydroBuild` as the top slow-frame phase and cannot say
 * WHERE the milliseconds go; HYDRO_BUILD_PROF has answered that since the
 * Breede River cut, on `__hydro().buildProf`, and a phone has no console. The
 * dump carries the row now — and a row on a phone is a round trip through the
 * seat, so this is the same reading taken here, deterministically, where a
 * change can be measured before it ships.
 *
 * WHY A FIXTURE AND NOT A BENCH. The predecessor was a hand-built bench
 * (`node_modules/.cache/hydrobench.ts` in the doctrine) that reconstructed a
 * `HydroTileInput` from a raw v4 tile and a synthetic DEM. It reproduced the
 * Breede's 292 ms to the millisecond and it is GONE — node_modules/.cache is
 * not in git — so the doctrine names a tool nobody has. A capture answers the
 * same question through the ACTUAL feed path (`hydroFeed` gathers the features,
 * builds the ocean mask, traces the cover's inland water), needs no
 * reconstruction to go stale, and is checked in beside the number it explains.
 * What it cannot do is isolate one tile; for that, read `worst` below and
 * capture a tighter box.
 *
 * NODRAW, AND WHY THAT IS SAFE HERE. The measurement is CPU milliseconds
 * inside a synchronous function, not pixels and not throughput — the harness's
 * software renderer cannot change what one build costs, only how often the
 * frame loop gets round to asking for one. `?nodraw=1` is what makes a
 * settle 30 seconds instead of six minutes.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const SPOT = process.env.SPOT ?? '';
const SKIP = process.env.HYDROSKIP ?? '1';
// THE A/B. `hydrodry=0` runs a waterless tile's eleven full-grid passes
// anyway, which is the only honest control for a saving that is per BUILD:
// the session mean is set by the few tiles that hold water whichever way it
// is set, so it is the `dry builds` row that has to move.
const DRY = process.env.DRY ?? '1';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const where = SPOT ? SPOT : `fixture=${FIX}`;
const d = await openDrive({
  spot: `${where}&cam=chase&time=NOON&wx=clear&nodraw=1&hydroskip=${SKIP}&hydrodry=${DRY}`,
  tag: 'hydro-phases', settle: 0, bootTimeout: 420000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

// THE THREE-SIGNAL GATE, not a timeout: a world still building is a world
// whose hydro builds are still the FIRST ones, and a first build is the one
// case the skip can never take.
let quiet = 0, pb = -1, pw = -1, ph = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  const h = await q(() => window.__hydro().buildProf.builds);
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && h === ph && t.builds > 0)
    ? quiet + 1 : 0;
  pb = t.builds; pw = t.seenWays; ph = h;
  if (quiet >= 3) break;
  if (i % 4 === 0) console.log(`[${el()}] dirty ${t.dirty} builds ${t.builds} ways ${t.seenWays} hydro ${h}`);
}

const r = await q(() => {
  const H = window.__hydro();
  return {
    prof: H.buildProf,
    landcover: H.landcover,
    feats: H.feats, tiles: H.stats?.tiles ?? null,
    mesh: H.mesh,
  };
});
const settled = quiet >= 3;
const errs = d.errors.length;
await d.close();

const P = r.prof;
// The laps are disjoint; `search` is timed inside the per-texel loop, so it is
// a SUBSET of `texels` and adding it again would double-count the phase this
// whole row exists to attribute. `other` is the residual no lap covers.
const PHASES = ['ocean', 'analyse', 'raster', 'texels', 'sources',
  'fill', 'majority', 'occlude', 'extent', 'shore', 'ground', 'pack', 'coast'];
const lapped = PHASES.reduce((a, k) => a + P[k], 0);
const other = +(P.meanMs - lapped).toFixed(1);
const pct = (v) => `${(100 * v / Math.max(0.001, P.meanMs)).toFixed(0)}%`.padStart(4);
// ns A TEXEL, not just ms: every phase below `sources` is a full-grid pass, so
// a build on a flowing tile (258² against a dry 130²) costs four times what
// the same line costs elsewhere and the ms column cannot tell an expensive
// pass from a big grid.
const ns = (v) => `${(v * 1e6 / Math.max(1, P.texels_n)).toFixed(0)}`.padStart(5);
const row = (k, v) => console.log(`  ${k.padEnd(9)} ${String(v).padStart(6)} ms ${pct(v)} ${ns(v)} ns/texel`);

console.log(`\n[${el()}] ${where} · ${settled ? 'SETTLED' : 'NOT SETTLED'} · ${P.builds} builds`);
console.log(`  mean ${P.meanMs} ms · max ${P.maxMs} ms · ${P.texels_n} texels a build`);
row('ocean', P.ocean); row('analyse', P.analyse); row('raster', P.raster);
row('texels', P.texels); console.log(`    of which search ${P.search} ms`);
row('sources', P.sources);
for (const k of ['fill', 'majority', 'occlude', 'extent', 'shore', 'ground', 'pack']) row(k, P[k]);
row('coast', P.coast); row('other', other);
console.log(`  per build: items ${P.itemsPerBuild} · area ${P.areaItems} · flowing ${P.flowingAreas}`
  + ` · searched texels ${P.searchTexels} · paints ${P.paints}`);
// THE RATIO THAT DECIDES WHETHER THE PRICE IS FAIR. Every phase below
// `analyse` walks the whole grid, so a tile is charged for its AREA and not
// for the water in it. A wet share near zero means the build is overhead.
console.log(`  water: ${P.covered_n} of ${P.texels_n} texels wet `
  + `(${(100 * P.covered_n / Math.max(1, P.texels_n)).toFixed(2)}%)`);
console.log(`  builds WITH water    ${P.wetBuilds} · ${P.wetMs} ms · ${P.wetTexels} texels each`);
console.log(`  builds with NO water ${P.dryBuilds} · ${P.dryMs} ms · ${P.dryTexels} texels each   [hydrodry=${DRY}]`);
console.log(`  store: feats ${r.feats} · cover-traced ${r.landcover.feats} (${r.landcover.rivers} rivers,`
  + ` ${r.landcover.pixels}px, maxPts ${r.landcover.maxPts}) · water tris ${r.mesh.tris}`);
console.log(`  page/harness errors: ${errs}`);
