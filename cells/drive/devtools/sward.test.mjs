/**
 * A FIELD, NOT A SCATTER.
 *
 *   node cells/drive/devtools/sward.test.mjs
 *
 * Reported from the seat: even LUSH is "sparse and spikey", and the sward wants
 * far more blades over a far wider radius. Measured, LUSH was 10,311 tufts over
 * a 224m reach — about a fifth of a tuft per square metre, which is a meadow
 * described rather than drawn.
 *
 * THE CPU COULD NOT GET THERE AT ANY DENSITY, and that is the finding that
 * decided the design. refreshSward spent ~17ms building 6,609 instance
 * matrices — 2.6µs a tuft — so three hundred thousand would be three quarters
 * of a second a pass. Vertex-shader placement is not an optimisation of the old
 * approach here, it is the only road to the thing being asked for.
 *
 * So every per-blade decision moved: where it stands, which way it faces, how
 * big it is, whether it exists, what colour it fades to. The CPU keeps only
 * what a shader cannot ask — the shape of the ground, what grows there, and
 * where the tarmac is — in a field texture rebuilt when the truck leaves the
 * middle of it rather than every pass.
 *
 * WHAT THIS ASSERTS, AND WHY:
 *
 * (1) THE SHADER LINKS. Cheap, and the suite has learned to check it: a
 *     failed program renders nothing and every probe still reports success.
 *
 * (2) THE FIELD IS BUILT FROM A WORLD THAT HAS ARRIVED. The first version
 *     rebuilt only on movement, so a parked truck kept the field it built on
 *     frame one — before any OSM tile landed. The road mask was EMPTY, measured
 *     at paintedFrac 0.0000 with the truck sitting on a road, and grass grew
 *     straight up through the carriageway. That is the assertion with teeth:
 *     the mask must be painted, and it must be painted UNDER THE TRUCK.
 *
 * (3) IT IS ACTUALLY DENSER. Slots, reach, and the triangle count of a real
 *     frame, against the CPU path on the same spot in the same session.
 *
 * (4) THE GRASS HAS ITS WIND BACK. onBeforeCompile is one slot and three
 *     helpers in this file want it; terrainFx assigned straight over the top
 *     while grainFx chained, so grassMat's gust injection — set on the line
 *     before terrainFx was called — had been silently discarded. Every blade in
 *     the game stood dead still, which is most of why a field read as spikes.
 *     Nothing about that is visible in a stack trace, so it is asserted here.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// Open highland grassland: the case the report is about, and the one where a
// scatter and a field look nothing alike.
const d = await openDrive({
  spot: 'lat=-30.6944&lon=27.7642&h=90&cam=cab&wx=clear&t=NOON', tag: 'sward', settle: 50000 });
const page = d.page;
await page.evaluate(() => window.__hide('critters'));
// The field watches the world's size, so give the stream a moment to settle
// and the field a moment to notice.
await page.waitForTimeout(6000);

const gpu = await page.evaluate(() => window.__sward());
const gpuFrame = await page.evaluate(() => window.__gpu());
console.log(`      GPU  ${gpu.slots} slots in ${gpu.bands.length} bands`
  + ` (reach ${gpu.bands.map((b) => b.reach).join('/')}m) · field ${gpu.fieldMs}ms per ${gpu.rebuildAt}m`
  + ` · ${gpuFrame.tris} tris`);

check('the sward shader links', d.errors.filter((e) => e.startsWith('GLSL:')).length === 0,
  d.errors.filter((e) => e.startsWith('GLSL:')));
check('the GPU sward is what runs by default', gpu.gpu === true, gpu);
check('float textures can be filtered on this device', gpu.floatLinear === true, gpu);

// (2) THE FIELD, AND THE MASK UNDER THE TRUCK.
const mask = await page.evaluate(() => { const m = window.__swardmask(); delete m.png; return m; });
console.log(`      field rate mean ${gpu.field.rateMean}, ${gpu.field.rateZero}/${gpu.field.texels} bare`
  + ` · height ${gpu.field.hMin}..${gpu.field.hMax}m · mask painted ${(mask.paintedFrac * 100).toFixed(1)}%`);
check('the field carries real ground, not the spawn guess',
  gpu.field.hMax - gpu.field.hMin > 5 && gpu.field.rateMean > 0, gpu.field);
check('and the road mask has been drawn at all', mask.paintedFrac > 0.001, mask);

// (3) DENSER, MEASURED AGAINST THE THING IT REPLACES.
await page.evaluate(() => window.__sward(false));
await page.waitForTimeout(6000);
const cpuFrame = await page.evaluate(() => window.__gpu());
const cpu = await page.evaluate(() => window.__sward());
console.log(`      CPU  ${cpuFrame.veg.grass} tufts · ${cpuFrame.swardMs}ms every 700ms`
  + ` · ${cpuFrame.tris} tris`);
check(`the sward offers far more blades than the old lattice placed`
  + ` (${gpu.slots} slots vs ${cpuFrame.veg.grass} tufts)`,
  gpu.slots > cpuFrame.veg.grass * 8, { slots: gpu.slots, tufts: cpuFrame.veg.grass });
check(`and reaches further (${Math.max(...gpu.bands.map((b) => b.reach))}m vs 224m)`,
  Math.max(...gpu.bands.map((b) => b.reach)) > 300, gpu.bands);
check(`and puts more of it on screen (${gpuFrame.tris} tris vs ${cpuFrame.tris})`,
  gpuFrame.tris > cpuFrame.tris * 1.15, { gpu: gpuFrame.tris, cpu: cpuFrame.tris });
// THE COST IT REPLACES. The old pass ran every 700ms; the field runs when the
// truck has moved 48m, which at 25m/s is every two seconds.
check(`the field costs no more per rebuild than the pass it replaces`
  + ` (${gpu.fieldMs}ms per ${gpu.rebuildAt}m vs ${cpuFrame.swardMs}ms per 700ms)`,
  gpu.fieldMs < 120, { field: gpu.fieldMs, cpu: cpuFrame.swardMs });

// (4) THE WIND.
const fx = await page.evaluate(() => window.__fxchain());
console.log(`      shader chain: ${Object.entries(fx).map(([k, v]) => `${k}=${v.join('+') || 'none'}`).join(' ')}`);
check('the grass kept its wind through terrainFx and grainFx',
  fx.grass.includes('wind') && fx.grass.includes('terrainFx') && fx.grass.includes('grain'), fx);

report(d.errors);
await d.close();

// ── the road mask, where there IS a road ──
//
// This first ran at the grassland spawn and failed, correctly: __toroad found
// nothing within eighty metres, the truck never moved, and the mask under an
// off-road truck is supposed to read zero. The assertion was fine and the
// PLACE was wrong — highland Lesotho is chosen precisely because it has no
// tarmac in it. A claim about the carriageway needs a carriageway.
const r = await openDrive({
  spot: 'lat=-34.09710&lon=18.37582&h=107&cam=cab&wx=clear&t=NOON', tag: 'sward-road', settle: 45000 });
const put = await r.page.evaluate(() => window.__toroad());
// Forced, not waited for: the field rebuilds on 48m of travel and a snap to the
// nearest centreline is metres, so nothing would trigger it.
await r.page.evaluate(() => window.__sward(undefined, true));
const onRoad = await r.page.evaluate(() => { const m = window.__swardmask(); delete m.png; return m; });
console.log(`      put on ${put.name ?? 'a road'} (${put.moved}m): mask reads ${onRoad.atTruck}`
  + ` under the truck, ${onRoad.at20Left}/${onRoad.at20Right} twenty metres either side`
  + ` · ${(onRoad.paintedFrac * 100).toFixed(1)}% of the field is carriageway`);
check('the probe actually got onto a road, so the next check means something',
  put.ok === true, put);
check('the mask covers the carriageway the truck is standing on',
  onRoad.atTruck > 128, onRoad);
check('…and does not blanket the country either side of it',
  onRoad.at20Left < 128 || onRoad.at20Right < 128, onRoad);
check('…nor most of the map (the verge is where grass lives)',
  onRoad.paintedFrac < 0.25, onRoad);
report(r.errors);
await r.close();

// ── (5) NO RINGS: THE DELIVERED DENSITY PROFILE, AS ARITHMETIC ──
//
// Reported from the seat with a photograph: "I can see the 3 rings of sward."
// Damning, because the round before had made the band weights sum to one so
// density would be continuous BY CONSTRUCTION — and the construction was right
// and beside the point. A band of step s places at most ONE tuft per cell, so
// it can never exceed 1/s² per square metre whatever its keep says. Measured
// against a 4.9/m² target the keeps came out 0.99, ELEVEN and ONE HUNDRED AND
// FOUR, delivering 4.9, 0.44 and 0.047 — two order-of-magnitude cliffs, in
// exactly three rings. A PROBABILITY CLAMPED AT 1 FAILS SILENTLY: it does not
// warn, it just stops counting.
//
// So this reconstructs what each band actually DELIVERS, ceiling included, and
// walks the range looking for a step. No rendering: the fault was arithmetic
// and a picture is what failed to catch it last time. Had this existed, the
// three rings would have been a red line rather than a photograph.
{
  const b = gpu.bands;
  const target = (d) => 0.35 * gpu.lush * (gpu.near / Math.max(d, gpu.near)) ** gpu.fall;
  const smooth = (a, z, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (z - a || 1e-9)));
    return t * t * (3 - 2 * t);
  };
  const density = (d) => b.reduce((sum, k) => {
    const w = smooth(k.blend[0], k.blend[1], d) * (1 - smooth(k.blend[2], k.blend[3], d));
    // keep is a PROBABILITY: what the band is asked for, clamped at one.
    const keep = Math.min(1, target(d) * k.step * k.step * w);
    return sum + keep / (k.step * k.step);
  }, 0);
  const ds = [];
  for (let d = 6; d < 400; d *= 1.06) ds.push(d);
  let worst = 1, worstAt = 0;
  for (let i = 1; i < ds.length; i++) {
    const a = density(ds[i - 1]), z = density(ds[i]);
    const r = Math.max(a, z) / Math.max(1e-9, Math.min(a, z));
    if (r > worst) { worst = r; worstAt = ds[i]; }
  }
  for (const d of [10, 30, 60, 72, 120, 195, 300, 380]) {
    console.log(`      ${String(Math.round(d)).padStart(3)}m · target ${target(d).toFixed(3)}`
      + ` · delivered ${density(d).toFixed(3)} tufts/m2`);
  }
  // 6% of range per step, so a smooth 1/d^2.2 curve moves ~13% between samples.
  // A cliff is anything much past that; the rings were 11x and 104x.
  check(`density has no cliff across the bands (worst step ${worst.toFixed(2)}x at ${Math.round(worstAt)}m)`,
    worst < 1.35, { worst: +worst.toFixed(2), at: Math.round(worstAt) });
  // …AND EVERY BAND CAN ACTUALLY DELIVER WHAT IT IS ASKED FOR at the point it
  // takes over alone, which is the specific thing that was false.
  const over = b.filter((k) => target(k.blend[1]) > k.ceiling)
    .map((k) => ({ step: k.step, needs: +target(k.blend[1]).toFixed(3), ceiling: k.ceiling }));
  check('…because no band is asked past its own one-tuft-per-cell ceiling',
    over.length === 0, over);

  // ── AND EVERY FADE FINISHES BEFORE THE HARD EDGES ──
  //
  // The third ring in the report was not a density step at all. uGReach — the
  // global "past here, nothing" cut — was left at 368m by a retune that pushed
  // the outer band's fade to 400-452, so blades were cut by a hard circle a
  // full fade-width before they ever started fading. The field texture's own
  // half-width is a second such edge. Neither is visible to a density profile,
  // which is why the profile passed while the ground had a ring on it.
  const edges = b.map((k) => ({ step: k.step, fadeEnds: k.blend[3], reach: k.reach }))
    .filter((k) => k.fadeEnds > gpu.gReach || k.fadeEnds > gpu.fieldHalf || k.fadeEnds > k.reach);
  console.log(`      hard edges: cut at ${gpu.gReach}m, field half-width ${gpu.fieldHalf}m`
    + ` · outermost fade ends ${Math.max(...b.map((k) => k.blend[3]))}m`);
  check('every fade finishes inside the global cut, the field and its own lattice',
    edges.length === 0, edges);
}

// ── WATER, MINUS THE EDGE AND THE SHALLOWS ──
//
// Three separate things call themselves water here and the mask has to see all
// of them. The cover raster zeroes grass on class 80 and is 38m of resolution,
// so a ten-metre river registers in NO texel. An OSM lake is a POLYGON in
// waterPolys. And a river built by waterway() registers NEITHER — measured at a
// French river bank, six water cells in the whole world and none in the field —
// because a watercourse is a ribbon whose only registration is a CHANNEL, the
// same Seg shape the road grid uses, which is what surfaceAt has been reading
// all along.
const w = await openDrive({
  spot: 'lat=47.06552&lon=2.03928&h=90&cam=cab&wx=clear&t=NOON', tag: 'sward-water', settle: 55000 });
await w.page.evaluate(() => window.__hide('critters'));
await w.page.waitForTimeout(6000);
await w.page.evaluate(() => window.__sward(undefined, true));
const wm = await w.page.evaluate(() => { const m = window.__swardmask(); delete m.png; return m; });
console.log(`      river bank: ${wm.channels} channels + ${wm.waterPolys} polygons + ${wm.roadSegs} road segs`
  + ` -> ${(wm.paintedFrac * 100).toFixed(1)}% masked`);
check('the field found watercourses to mask at all',
  wm.channels > 0 || wm.waterPolys > 0, wm);
// THE LOAD-BEARING ONE. Roads alone painted 0.5% here; water takes it past 5%,
// so this cannot pass on the road mask by itself.
check(`water is masked, not just tarmac (${(wm.paintedFrac * 100).toFixed(1)}%)`,
  wm.paintedFrac > 0.03, wm);
// …AND NOT EVERYTHING. A margin left unmasked is the whole point of the ask —
// reeds and rough grass stand IN the shallows, and a body masked to its own
// outline reads as shaved.
check('…and the mask has not swallowed the countryside', wm.paintedFrac < 0.35, wm);
report(w.errors);
await w.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — a field, not a scatter');
if (bad) process.exitCode = 1;
