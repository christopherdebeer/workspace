/**
 * THE GLOBE'S GESTURES: A DRAG TURNS IT, A TAP LANDS ON IT, AND NEITHER DOES
 * ANYTHING WHILE THE STREAMED SHELL IS STILL DRAWN.
 *
 *   node cells/drive/devtools/globe-spin.test.mjs
 *
 * The whole design rests on ONE claim — that the planet may only be turned
 * where nothing else is drawing the same ground — and that claim is not
 * visible in a frame: a spun globe under a shell that did not spin looks like
 * a globe, until you notice the coastline crossing the shell's edge twice.
 * So the regime is asserted from both sides. At planet zoom a drag must move
 * `__globespin` and must not move `__pan`; at a driving chart zoom the same
 * drag must do the exact opposite.
 *
 * The directions are asserted as FACTS ABOUT A MAP rather than as signs in the
 * code, for the reason the flat pan's own note records: its rotation was once
 * a mirror (determinant −1), horizontal came out right and vertical came out
 * backwards, and no single-axis check would have caught it. Drag the world
 * right and the ground follows your thumb, so the view moves WEST; drag it
 * down and the view moves NORTH.
 *
 * Numbers only by default. `SHOT=1` draws a frame of the spun planet so the
 * pin can be looked at, which costs a few minutes of software rendering.
 */
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';

// Letsemeng: the same spot globe-view.mjs stands at, so the two tools' numbers
// are comparable. `nodraw` because nothing here is judged by eye unless SHOT
// asks for it, and the harness paints at three frames a second.
const SPOT = 'lat=-29.9872&lon=24.7765&h=0&cam=top&wx=clear&nodraw=1';
const PLANET_Z = 40000, CHART_Z = 8;
const { page, close } = await openDrive({ spot: `${SPOT}&z=${PLANET_Z}`, tag: 'globespin', menu: true, settle: 0 });

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };

/** `__zoom` sets a TARGET eased at 8/s, so a zoom change needs frames to pass
 *  — and in this harness a frame is a third of a second. Wait on the reading,
 *  never on a timeout. */
async function zoomTo(z) {
  await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, z);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(0.05, zz * 0.02), z)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}
/** A real pointer drag, in steps, the way a finger moves — one jump is not a
 *  drag and the handler integrates per move event. */
async function drag(dx, dy) {
  const x0 = 195, y0 = 300;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(x0 + (dx * i) / 8, y0 + (dy * i) / 8);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const spin = () => page.evaluate(() => window.__globespin());
const pan = () => page.evaluate(() => window.__pan());
const globe = () => page.evaluate(() => window.__globe());

console.log('\n=== the planet has the frame ===');
await zoomTo(PLANET_Z);
// The base texture is fetched on the first wide chart, and nothing is free to
// turn until it has landed — `globeFree` is 0 with no planet to turn.
for (let i = 0; i < 60; i++) {
  if ((await globe()).tex) break;
  await page.waitForTimeout(500);
}
let g = await globe();
console.log(`  ${JSON.stringify(g)}`);
check(g.tex, 'the base texture landed');
check(g.shown, 'the planet is drawn');
check(!g.shell, 'the streamed shell has handed over');
check(g.free === 1, `globeFree is 1 (${g.free})`);
check(g.pin, 'the truck has a pin on it');

await page.evaluate(() => window.__globespin(0, 0));
const pan0 = await pan();
await drag(120, 0);
let s = await spin();
console.log(`  after a rightward drag: ${JSON.stringify(s)}`);
check(s.lon < -1, `drag right turns the view WEST (lon ${s.lon}°)`);
check(Math.abs(s.lat) < 0.5, `and barely moves the latitude (${s.lat}°)`);
const panR = await pan();
check(Math.abs(panR.x - pan0.x) < 1 && Math.abs(panR.z - pan0.z) < 1,
  'and the flat pan does not move at all');

await page.evaluate(() => window.__globespin(0, 0));
await drag(0, 120);
s = await spin();
console.log(`  after a downward drag: ${JSON.stringify(s)}`);
check(s.lat > 1, `drag down turns the view NORTH (lat ${s.lat}°)`);
check(Math.abs(s.lon) < 0.5, `and barely moves the longitude (${s.lon}°)`);

// THE RATE IS THE GEOMETRY'S. A drag of the frame's own height must turn the
// Earth by the arc that height covers on the ground — which is what makes the
// place under the thumb keep up with it.
g = await globe();
const want = await page.evaluate(() => {
  const c = window.__cam();
  return (2 * c.dist * Math.tan((55 / 2) * Math.PI / 180) / window.innerHeight) / 6371000 * 180 / Math.PI;
});
check(Math.abs(g.degPerPx - want) / want < 0.02,
  `${g.degPerPx}°/px is the ground the frame covers (${want.toFixed(4)})`);

// THE SPIN IS APPLIED HERE, WHOLE. `applied` is the product with `globeFree`,
// and at 1 the two must agree — the other end of the same test is below.
await page.evaluate(() => window.__globespin(20, -60));
await page.waitForTimeout(500);
g = await globe();
check(Math.abs(g.applied[0] - 20) < 0.01 && Math.abs(g.applied[1] + 60) < 0.01,
  `a spin of 20,-60 is applied whole (${g.applied})`);

// THE WHOLE PLANET HAS TO BE REACHABLE FROM WHERE YOU ARE PARKED. The spin is
// stored as an offset from the truck, so a bound written on the offset bounds
// the wrong thing: at −30° a symmetric ±85 reaches +55° and stops, and Cape
// Town cannot be used to look at the Arctic. The bound is on the LATITUDE the
// view reaches, which is what this asks.
{
  await page.evaluate(() => window.__globespin(400, 0));
  const far = await spin();
  const at = (await globe()).at[0];
  const reach = at + far.lat;
  console.log(`  truck at ${at}°, spin clamped to ${far.lat}° — the view reaches ${reach.toFixed(1)}°`);
  check(reach > 84 && reach < 86, `the north pole is reachable from ${at}° (view reaches ${reach.toFixed(1)}°)`);
  await page.evaluate(() => window.__globespin(-400, 0));
  const s2 = await spin();
  const reach2 = at + s2.lat;
  check(reach2 < -84 && reach2 > -86, `and the south pole too (${reach2.toFixed(1)}°)`);
}

console.log('\n=== the tap lands on the sphere ===');
await page.evaluate(() => window.__globespin(0, 0));
await page.waitForTimeout(600);
// Unspun, the truck is at the top of the sphere, so the frame's centre is the
// truck's own point: the tap and the world must agree there or nothing
// downstream of the tap can.
const mid = await page.evaluate(() => {
  const w = window.__globeat(window.innerWidth / 2, window.innerHeight / 2);
  const d = window.__drive;
  return { hit: w, truck: [d.x, d.z] };
});
console.log(`  centre tap ${JSON.stringify(mid)}`);
check(mid.hit !== null, 'the centre of the frame is on the planet');
check(mid.hit && Math.hypot(mid.hit[0] - mid.truck[0], mid.hit[1] - mid.truck[1]) < 40000,
  'and it is the truck\'s own point');
// A tap in the corner of a frame the planet does not fill is space, and space
// is not a place.
const corner = await page.evaluate(() => window.__globeat(6, 6));
check(corner === null, 'a tap in the corner, past the limb, hits nothing');

console.log('\n=== the pin layer stands down ===');
let pd = await page.evaluate(() => window.__poidraw());
console.log(`  ${JSON.stringify(pd)}`);
check(pd.planet && pd.n === 0, `no pins at planet zoom (n ${pd.n})`);

console.log('\n=== and at a driving chart zoom, none of it ===');
check(await zoomTo(CHART_Z), `zoomed back to ${CHART_Z}`);
await page.waitForTimeout(1500);
g = await globe();
check(g.free === 0, `globeFree is 0 (${g.free})`);
check(g.shell, 'the shell is drawing again');
check(!g.pin, 'and the pin is put away');
// The spin decays home below the hand-over, so a spin banked at planet zoom
// cannot spring the chart to the far side of the world on the next zoom out.
await page.evaluate(() => window.__globespin(40, 80));
await page.waitForTimeout(3000);
s = await spin();
check(Math.abs(s.lat) < 4 && Math.abs(s.lon) < 8, `a banked spin decays home (${s.lat}, ${s.lon})`);

await page.evaluate(() => { window.__drive.speed = 0; window.__globespin(0, 0); });
const panA = await pan();
await drag(100, 0);
const panB = await pan();
s = await spin();
console.log(`  pan ${JSON.stringify(panA)} -> ${JSON.stringify(panB)}, spin ${JSON.stringify(s)}`);
check(Math.hypot(panB.x - panA.x, panB.z - panA.z) > 5, 'the same drag pans the chart');
check(Math.abs(s.lat) < 0.01 && Math.abs(s.lon) < 0.01, 'and does not turn the planet');
pd = await page.evaluate(() => window.__poidraw());
check(!pd.planet && !pd.wide, `the pin layer is back on (${JSON.stringify(pd)})`);

// The scenery gate's own arithmetic, at the zoom it is stated at: a 3km
// catchment must span POI_SPREAD_PX (16) art pixels, which is 187.5 m/px.
for (const [z, want] of [[300, false], [900, true]]) {
  await zoomTo(z);
  await page.waitForTimeout(800);
  pd = await page.evaluate(() => window.__poidraw());
  check(pd.wide === want, `z${z}: ${pd.mpp} m/px, scenery ${pd.wide ? 'off' : 'on'} (wanted ${want ? 'off' : 'on'})`);
}

// THE PIN'S OWN BAND IS A GEOMETRY, NOT A SETTING. The sphere's radius on
// screen is R/mpp — 280 art pixels at z40,000 against a 148x320 frame, so at
// that zoom the disc is far wider than the glass and a spin past about fifteen
// degrees carries the truck's point off it. At the ceiling (z110,000) the
// radius is 102 pixels and the whole disc fits, so the pin is on screen
// wherever it is on the near face. That is why the default shot is taken at
// the ceiling: it is the frame in which the pin can be judged at all.
if (process.env.SHOT) {
  const [sl, sn] = (process.env.SPIN ?? '20,-35').split(',').map(Number);
  await zoomTo(Number(process.env.SHOT_Z ?? 110000));
  await page.evaluate(([a, b]) => window.__globespin(a, b), [sl, sn]);
  await page.evaluate(() => window.__draw(true));
  const f0 = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__clock().frames) - f0 >= 4) break;
    await page.waitForTimeout(500);
  }
  const shot = join(WORK, 'globe-spun.png');
  await page.screenshot({ path: shot, timeout: 240000 });
  console.log(`\n  frame: ${shot}`);
}

const errs = await page.evaluate(() => window.__pageErrors ?? []);
check(errs.length === 0, `no page errors ${JSON.stringify(errs.slice(0, 2))}`);
await close();
console.log(fails ? `\n${fails} FAILURES` : '\nglobe-spin: all ok');
process.exit(fails ? 1 : 0);
