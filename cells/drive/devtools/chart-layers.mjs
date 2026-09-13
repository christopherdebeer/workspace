// THE CHART'S LAYERS, DRIVEN AND PHOTOGRAPHED.
//
//   node cells/drive/devtools/chart-layers.mjs
//   SPOT=lat=..&lon=.. Z=8000 node …        SHOTS=0 for numbers only
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

const SPOT = process.env.SPOT || 'lat=-33.9249&lon=18.4241';   // Cape Town: fynbos, sea, city
const Z = Number(process.env.Z ?? 8000);
const SHOTS = process.env.SHOTS !== '0';
const { page, close, errors } = await openDrive({
  spot: `${SPOT}&h=0&cam=top&z=${Z}&wx=clear&time=NOON${SHOTS ? '' : '&nodraw=1'}`,
  tag: 'chart-layers', menu: true, settle: 0,
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

// AND THE SHEET STANDS DOWN AT STREET SCALE, which is a rule about honesty
// rather than cost: a class sheet over a junction is a wash over the one scale
// that can already show what is there.
await cl('cover', true);
await page.evaluate(() => window.__zoom(3));
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => window.__cam().zoom < 5)) break;
  await new Promise((r) => setTimeout(r, 250));
}
const near = await cl();
console.log(`\nat zoom ${Math.round(near.mpp)} m/px (min ${near.mppMin}): theme=${near.theme} drawing=${near.themeDrawing}`);
await shot('near');
console.log(`\nframes in ${WORK}`);
report(errors);
await close();
