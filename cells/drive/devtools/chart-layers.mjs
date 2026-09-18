// THE CHART'S LAYERS, DRIVEN AND PHOTOGRAPHED.
//
//   PHASE=basic node cells/drive/devtools/chart-layers.mjs   (the key and the sheets)
//   PHASE=sweep SHOTS=0 node …                                (a zoom-out, sampled)
//   PHASE=near  node …                                        (the seat's own zoom)
//   SPOT=lat=..&lon=.. Z=8000 SHOTS=0 REV=<sha> node …
//
// Asked from the seat: split the overview into layers so cover and eco can be
// toggled with a key and a legend. This drives the key the way a thumb does
// (`__chartlayers(id)` makes the same call a tap does), waits for each sheet
// to bake, and reports what it found: how many of the shell's tiles carry a
// sheet, what the legend claims, and what a tile's bake cost.
//
// THE FRAMES ARE THE JUDGEMENT and the numbers are the evidence. A class map
// is a claim about a place — the Cape is fynbos, the shelf is water — and the
// only way to know whether it reads at fourteen quantised levels through a
// Bayer dither is to look at one.
import { openDrive, WORK, report } from './harness.mjs';
import { join } from 'node:path';

// ONE PHASE A PROCESS. The harness fuse is twenty minutes (HARNESS_FUSE_MIN)
// and all three phases together blew it — a run that is killed mid-way is a
// run whose last number nobody should quote. `PHASE=basic|sweep|near`, and
// `SHOTS=0` for a phase whose answer is numbers, which is what makes the sweep
// usable at all: with drawing on, one probe round trip is five seconds and a
// sixty-second sweep is twelve samples.
const PHASE = process.env.PHASE || 'basic';
const REV = process.env.REV || '';
const SPOT = process.env.SPOT || 'lat=-33.9249&lon=18.4241';   // Cape Town: fynbos, sea, city
const Z = Number(process.env.Z ?? 8000);
const SHOTS = process.env.SHOTS !== '0';
const { page, close, errors } = await openDrive({
  spot: `${SPOT}&h=0&cam=top&z=${Z}&wx=clear&time=NOON${SHOTS ? '' : '&nodraw=1'}`,
  tag: REV ? `chart-layers-${REV.slice(0, 7)}` : 'chart-layers', menu: true, settle: 0, rev: REV,
});
const cl = (id, on) => page.evaluate(([i, o]) => window.__chartlayers(i ?? undefined, o), [id ?? null, on]);
const shot = async (name) => {
  if (!SHOTS) return;
  await page.evaluate(() => window.__draw(true));
  const f0 = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__clock().frames) - f0 >= 3) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await page.screenshot({ path: join(WORK, `layers-${name}.png`), timeout: 240000 });
};
const settle = async (want) => {
  for (let i = 0; i < 90; i++) {
    const s = await cl();
    if (want(s)) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return cl();
};

await page.evaluate((z) => { window.__cam('top'); window.__zoom(z); }, Z);
for (let i = 0; i < 60; i++) {
  if (await page.evaluate((z) => Math.abs(window.__cam().zoom - z) < z * 0.02, Z)) break;
  await new Promise((r) => setTimeout(r, 250));
}
// The shell first: every sheet rides one of its tiles, so a sheet count is
// meaningless until the ring is home.
const base = await settle((s) => s.shell >= 20);
if (PHASE === 'basic') {
console.log(`\nchart at zoom ${Z} · ${base.mpp} m/px · shell ${base.shell} tiles`);
console.log(`the key: ${base.layers.map((l) => `${l.name}${l.on ? '*' : ''}`).join(' ')}`
  + `   (* = on; chips at ${base.rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)}`).join(' ')})`);
await shot('base');

for (const id of ['cover', 'eco']) {
  await cl(id, true);
  const s = await settle((v) => v.sheets >= v.shell && v.shell > 0);
  console.log(`\n${id.toUpperCase()} on: theme=${s.theme} drawing=${s.themeDrawing}`
    + ` sheets ${s.sheets}/${s.shell} · ${s.baked} baked at ${s.bakeMs}ms a tile`);
  console.log(`  legend: ${s.legend.length ? s.legend.map((r) => `${r.name} ${(r.share * 100).toFixed(0)}%`).join(' · ') : '(empty)'}`);
  await shot(id);
}

// The base map's own two halves, which had never been separable.
await cl('cover', false); await cl('eco', false);
await cl('roads', false);
const noRoads = await settle((s) => !s.roads);
console.log(`\nROADS off: roads drawn ${noRoads.roads}, labels still ${noRoads.labels} of ${noRoads.places} places`);
await shot('no-roads');
await cl('roads', true); await cl('places', false);
const noPlaces = await settle((s) => s.labels === 0);
console.log(`PLACES off: labels ${noPlaces.labels}, roads drawn ${noPlaces.roads}`);
await shot('no-places');
await cl('places', true);
}

if (PHASE === 'sweep') {
// ── DOES THE SHEET SURVIVE A ZOOM, AND DOES IT FINISH? ──
//
// Reported from the seat with five frames: "only some of the viewport loading
// eco and then not proceeding... loading and then throwing away on zoom in
// when its replacement isn't yet built". Two different faults with one look,
// and two numbers tell them apart — the sheet going EMPTY while the shell is
// still drawing (the discard), and `unknown` never reaching zero (the fill).
// PRIME AT THE ZOOM THE SWEEP STARTS FROM, not at the tool's default. The
// first cut settled at Z, then zoomed to the start, then jumped — so the level
// had already swapped twice before the measurement began and the state at the
// jump was whatever that left. Prime where the gesture starts.
const sweepFrom = Number(process.env.SWEEP_FROM ?? 300);
const sweepTo = Number(process.env.SWEEP_TO ?? 20000);
await page.evaluate((z) => window.__zoom(z), sweepFrom);
for (let i = 0; i < 60; i++) {
  if (await page.evaluate((z) => Math.abs(window.__cam().zoom - z) < z * 0.05, sweepFrom)) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cl('eco', false);
await cl('cover', true);
for (let i = 0; i < 90; i++) {
  const s = await cl();
  if (s.sheets >= s.shell && s.shell > 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const primed = await cl();
console.log(`\nprimed at zoom ${sweepFrom}: ${primed.sheets}/${primed.shell} sheets`);
await page.evaluate((z) => window.__zoom(z), sweepTo);
const t0 = Date.now(); const samples = [];
while (Date.now() - t0 < 60000) {
  samples.push(await cl());
  await new Promise((r) => setTimeout(r, 250));
}
// A sheet is DISCARDED when the shell is drawing tiles and the class map is
// not — the state a level swap used to create on every band crossing.
const blank = samples.filter((s) => s.themeDrawing && s.shell > 0 && s.sheets === 0);
let run = 0, worst = 0;
for (const s of samples) {
  if (s.themeDrawing && s.shell > 0 && s.sheets === 0) { run++; worst = Math.max(worst, run); } else run = 0;
}
const last = samples[samples.length - 1];
// THE LIFETIME RULE, AS A NUMBER. A sheet on a RETIRED shell tile is the thing
// the fix exists to allow: keyed by the tile key it is impossible, so a
// control reads a flat zero here whatever the timing does. The blank count
// above is the SYMPTOM and the harness can barely sample it — a bake is 1.6ms
// and a harness tile lands fast, so the window the seat sees over a real
// network is a frame or two here. This is the mechanism, and it does not
// depend on catching that window.
const retMax = Math.max(...samples.map((s) => s.retiredSheets ?? 0));
const levels = [...new Set(samples.map((s) => s.farZ))];
console.log(`\nzoom-out ${sweepFrom} → ${sweepTo} with COVER on, ${samples.length} samples:`);
console.log(`  sheet EMPTY while the shell drew: ${blank.length} (${((blank.length / samples.length) * 100).toFixed(0)}%),`
  + ` longest ${(worst * 0.25).toFixed(1)}s`);
console.log(`  ended ${last.sheets}/${last.shell} sheets · unknown ${last.unknown} (mostly sea)`
  + ` · still filling ${last.filling} · ${last.baked} baked (${last.rebaked} again)`);
console.log(`  shell levels crossed ${levels.join(' ')} · most sheets held on RETIRED tiles: ${retMax}`);
await shot('after-sweep');
}

if (PHASE === 'near') {
// THE SEAT'S OWN ZOOM: a ten-kilometre frame, where the fine ring is a quarter
// of the glass and used to punch a hole in the sheet.
for (const id of ['cover', 'eco']) {
  await cl('cover', id === 'cover'); await cl('eco', id === 'eco');
  await page.evaluate(() => window.__zoom(60));
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.__cam().zoom < 70)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const s = await settle((v) => v.sheets >= v.shell && v.shell > 0);
  console.log(`\n${id.toUpperCase()} at ${Math.round(s.mpp)} m/px: sheets ${s.sheets}/${s.shell}`
    + ` · unknown ${s.unknown} · filling ${s.filling}`
    + ` · legend ${s.legend.map((r) => r.name).join(',') || '(empty)'}`);
  await shot(`near-${id}`);
}

// AND THE SHEET STANDS DOWN AT STREET SCALE, which is a rule about honesty
// rather than cost: a class sheet over a junction is a wash over the one scale
// that can already show what is there.
await cl('eco', false);
await cl('cover', true);
await page.evaluate(() => window.__zoom(3));
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => window.__cam().zoom < 5)) break;
  await new Promise((r) => setTimeout(r, 250));
}
const near = await cl();
console.log(`\nat zoom ${Math.round(near.mpp)} m/px (min ${near.mppMin}): theme=${near.theme} drawing=${near.themeDrawing}`);
await shot('street');
}
console.log(`\nframes in ${WORK}`);
report(errors);
await close();
