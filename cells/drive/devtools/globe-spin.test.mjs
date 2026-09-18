/**
 * THE GLOBE'S GESTURES, IN A REAL PAGE: a drag moves the PLACE, a tap lands on
 * the sphere, the rig never moves, and none of it happens while the streamed
 * shell is still drawn.
 *
 *   node cells/drive/devtools/globe-spin.test.mjs
 *
 * ── THIS FILE ONCE ASSERTED THE OPPOSITE, AND THE HISTORY IS THE POINT ──
 *
 * The first gesture pass made a drag a DISPOSABLE SPIN: an offset that was
 * scaled to nothing below the hand-over and decayed home, so zooming in
 * returned you to the truck. Reported from the seat as wrong, and it is:
 * zooming in on a place you went looking for is not a request to be taken
 * home. A drag now moves a RETAINED chart focus (panX/panZ) and the rig stays
 * exactly where it is. Nine assertions here failed the day that landed —
 * every one of them a faithful description of a contract that had been
 * replaced. They are restated against the new one rather than relaxed; a test
 * that survives a change of contract by being loosened is worse than one that
 * fails.
 *
 * `devtools/globe-navigation.test.cjs` covers the same rules exactly, in a VM
 * over extracted function bodies. This one is the wiring: that the probes
 * exist, that a real pointer reaches the real handler, that the page throws
 * nothing. Neither replaces the other.
 *
 * Numbers only by default. `SHOT=1` draws a frame of the browsed planet so the
 * pin can be looked at, which costs a few minutes of software rendering.
 */
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';

// Letsemeng: the same spot globe-view.mjs stands at, so the two tools' numbers
// are comparable. `nodraw` because nothing here is judged by eye unless SHOT
// asks for it, and the harness paints at three frames a second.
// fling=0: the drags below measure the RATE of a drag, and a lift that
// throws the planet would add the coast to every reading. The throw has its
// own block at the end, with the switch turned on for it.
const SPOT = 'lat=-29.9872&lon=24.7765&h=0&cam=top&wx=clear&nodraw=1&fling=0';
const PLANET_Z = 40000, CHART_Z = 8;
const { page, close } = await openDrive({ spot: `${SPOT}&z=${PLANET_Z}`, tag: 'globespin', menu: true, settle: 0 });

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL ${msg}`); } else console.log(`  ok   ${msg}`); };
/** Longitudes are compared the short way round, or a browse across the
 *  dateline reads as a 359-degree error. */
const dLon = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

/** `__zoom` sets a TARGET the zoom spring eases toward, so a zoom change needs
 *  frames to pass — and in this harness a frame is a third of a second. Wait on
 *  the reading, never on a timeout. */
// AND IT MUST NOT ASK FOR A CAMERA IT ALREADY HAS. `setCam` clears panX/panZ
// unconditionally — "pan is a glance, not a state to carry over", which is
// right for LEAVING the chart and is what makes leaving return you to the rig.
// A same-mode call still runs it, so a helper that politely re-asserted `top`
// on every zoom step wiped the browsed focus before each reading and reported
// the retained-place regression as unfixed. Cost four checks in this file.
async function zoomTo(z) {
  await page.evaluate((zz) => {
    if (window.__cam().mode !== 'top') window.__cam('top');
    window.__zoom(zz);
  }, z);
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
  await page.waitForTimeout(400);
}
const globe = () => page.evaluate(() => window.__globe());
const pan = () => page.evaluate(() => window.__pan());
const rig = () => page.evaluate(() => [window.__drive.x, window.__drive.z]);
/** Put the chart on a place without a finger, and let a globe frame consume it
 *  into the retained focus — which is the one thing `__globespin` still does
 *  now that a drag writes the focus directly. */
// THE OFFSET IS FROM THE FOCUS, NOT FROM THE RIG. `stepGlobe` consumes the
// spin into wherever the chart is already looking, so an offset measured from
// the truck lands somewhere else entirely the moment the chart is not on it —
// asked for 40N/140E from a chart parked at the south pole and got 15S/130E,
// which is the sum, correctly.
async function focusOn(lat, lon) {
  const [fLat, fLon] = (await globe()).focus;
  await page.evaluate(([a, b]) => window.__globespin(a, b), [lat - fLat, dLon(lon, fLon)]);
  await page.waitForTimeout(900);
  return (await globe()).focus;
}

console.log('\n=== the planet has the frame ===');
await zoomTo(PLANET_Z);
// THERE IS NOTHING LEFT TO WAIT FOR. The surface used to be a 317KB baked
// equirect PNG fetched on the first wide chart, and `globeFree` stayed 0 until
// it landed — so this block spent up to thirty seconds polling `tex` before it
// could ask anything. The graticule is drawn in the fragment shader, so the
// planet is browsable on the frame the chart reaches it, and `wire` reports
// which surface the build carries where `tex` used to report the fetch.
let g = await globe();
console.log(`  ${JSON.stringify(g)}`);
check(g.wire, 'the surface is drawn, not fetched');
check(g.shown, 'the planet is drawn');
// THE PICTURE DOES NOT HAND OVER; THE GESTURE DOES. This line used to require
// the shell to be OFF here, because `shellOn` carried `&& globeFree() === 0`:
// a spun globe standing beside a shell fixed under the truck would carry two
// different places through neighbouring pixels. Both are children of
// `planetGroup` now and are placed from ONE focus every frame, so they cannot
// disagree, and the ladder reaches z5 — the ring is 10,847km across against an
// 8,030km frame at the ceiling, so hiding it would open an edge rather than
// close one. What changes hands at `globeFree` is the drag. Asserting the pair:
// both backdrops drawn, and the gesture the planet's. Re-tying the two would
// fail this line rather than pass it.
check(g.shell && g.shown, 'both backdrops draw; only the gesture hands over');
check(g.free === 1, `globeFree is 1 (${g.free})`);
check(g.pin, 'the rig has a pin on it');

console.log('\n=== a drag moves the place, and ONLY the place ===');
await focusOn(-29.9872, 24.7765);
const rig0 = await rig();
let f0 = (await globe()).focus;
await drag(120, 0);
let f1 = (await globe()).focus;
console.log(`  rightward drag: ${JSON.stringify(f0)} -> ${JSON.stringify(f1)}`);
check(dLon(f1[1], f0[1]) < -1, `drag right moves the view WEST (${dLon(f1[1], f0[1]).toFixed(2)}°)`);
// A HORIZONTAL DRAG ON A SPHERE IS NOT A PARALLEL, so some latitude drift is
// the geometry rather than a fault: the grabbed point is carried along the
// great circle through it, and off the equator that curves. The assertion is
// that the drag is DOMINANTLY longitudinal — measured 0.57° of latitude for
// 10.23° of longitude, a twentieth, against the tenth allowed here.
check(Math.abs(f1[0] - f0[0]) < 0.1 * Math.abs(dLon(f1[1], f0[1])),
  `and stays on its parallel to a twentieth (${(f1[0] - f0[0]).toFixed(3)}° lat for ${dLon(f1[1], f0[1]).toFixed(2)}° lon)`);
// THE ONE INVARIANT THE WHOLE REDESIGN RESTS ON. Browsing is looking, not
// travelling: whatever the chart does, the rig and its fine world stay put.
let rig1 = await rig();
check(Math.hypot(rig1[0] - rig0[0], rig1[1] - rig0[1]) < 1,
  `and the rig has not moved (${Math.hypot(rig1[0] - rig0[0], rig1[1] - rig0[1]).toFixed(2)}m)`);

f0 = await focusOn(-29.9872, 24.7765);
await drag(0, 120);
f1 = (await globe()).focus;
console.log(`  downward drag: ${JSON.stringify(f0)} -> ${JSON.stringify(f1)}`);
check(f1[0] - f0[0] > 1, `drag down moves the view NORTH (${(f1[0] - f0[0]).toFixed(2)}°)`);
check(Math.abs(dLon(f1[1], f0[1])) < 0.5, `and barely moves the longitude (${dLon(f1[1], f0[1]).toFixed(3)}°)`);

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

// The map is bounded at ±85: past it the cosine that scales a horizontal drag
// runs away, and a chart looking straight down on a pole has no east.
const north = await focusOn(400, 24.7765);
check(north[0] > 84 && north[0] < 86, `the north pole is reachable (view reaches ${north[0]}°)`);
const south = await focusOn(-400, 24.7765);
check(south[0] < -84 && south[0] > -86, `and the south pole too (${south[0]}°)`);

console.log('\n=== the place is RETAINED through a zoom in ===');
// The regression the redesign exists for: browse somewhere, zoom in, and you
// are still there. Zooming in is not a request to be taken home; only leaving
// the chart is.
const browsed = await focusOn(40, 140);
check(Math.abs(browsed[0] - 40) < 1 && Math.abs(dLon(browsed[1], 140)) < 1,
  `browsed to ${JSON.stringify(browsed)}`);
for (const z of [110000, 15000, 1000, 8]) {
  await zoomTo(z);
  await page.waitForTimeout(900);
  const f = (await pan()).focus;
  check(Math.abs(f[0] - 40) < 1 && Math.abs(dLon(f[1], 140)) < 1,
    `z${z}: still at ${f.map((v) => +v.toFixed(2))}`);
}
rig1 = await rig();
check(Math.hypot(rig1[0] - rig0[0], rig1[1] - rig0[1]) < 1, 'and the rig never moved through any of it');
check((await pan()).remote, 'the chart knows it is browsing remotely');

console.log('\n=== leaving the chart returns to the rig ===');
await page.evaluate(() => window.__cam('chase'));
await page.waitForTimeout(600);
await zoomTo(CHART_Z);
await page.waitForTimeout(900);
let p = await pan();
check(Math.hypot(p.x, p.z) < 100, `the pan is home (${p.x}, ${p.z})`);
check(!p.remote, 'and the chart is no longer remote');

console.log('\n=== the tap lands on the sphere ===');
await zoomTo(PLANET_Z);
await focusOn(-29.9872, 24.7765);
// With the chart focused on the rig, the frame's centre is the rig's own
// point: the tap and the world must agree there or nothing downstream of the
// tap can.
const mid = await page.evaluate(() => {
  const w = window.__globeat(window.innerWidth / 2, window.innerHeight / 2);
  const d = window.__drive;
  return { hit: w, truck: [d.x, d.z] };
});
console.log(`  centre tap ${JSON.stringify(mid)}`);
check(mid.hit !== null, 'the centre of the frame is on the planet');
check(mid.hit && Math.hypot(mid.hit[0] - mid.truck[0], mid.hit[1] - mid.truck[1]) < 40000,
  'and it is the rig\'s own point');
// A tap in the corner of a frame the planet does not fill is space, and space
// is not a place.
check(await page.evaluate(() => window.__globeat(6, 6)) === null,
  'a tap in the corner, past the limb, hits nothing');

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
check(!g.pin, 'and the pin is not drawn');

await page.evaluate(() => { window.__drive.speed = 0; });
const panA = await pan();
await drag(100, 0);
const panB = await pan();
console.log(`  pan ${JSON.stringify(panA)} -> ${JSON.stringify(panB)}`);
check(Math.hypot(panB.x - panA.x, panB.z - panA.z) > 5, 'the same drag pans the chart');
check(Math.abs(panB.focus[0] - panA.focus[0]) < 0.2, 'as a nudge, not a browse');
pd = await page.evaluate(() => window.__poidraw());
check(!pd.planet && !pd.wide, `the pin layer is back on (${JSON.stringify(pd)})`);

// The scenery gate's own arithmetic, at the zoom it is stated at: a 3km
// catchment must span POI_SPREAD_PX (16) art pixels, which is 187.5 m/px.
for (const [z, want2] of [[300, false], [900, true]]) {
  await zoomTo(z);
  await page.waitForTimeout(800);
  pd = await page.evaluate(() => window.__poidraw());
  check(pd.wide === want2, `z${z}: ${pd.mpp} m/px, scenery ${pd.wide ? 'off' : 'on'} (wanted ${want2 ? 'off' : 'on'})`);
}

// THE PIN'S OWN BAND IS A GEOMETRY, NOT A SETTING. The sphere's radius on
// screen is R/mpp — 280 art pixels at z40,000 against a 148x320 frame, so at
// that zoom the disc is far wider than the glass and a browse past about
// fifteen degrees carries the rig's point off it. At the ceiling (z110,000)
// the radius is 102 pixels and the whole disc fits, so the pin is on screen
// wherever it is on the near face. That is why the default shot is taken at
// the ceiling: it is the frame in which the pin can be judged at all.
if (process.env.SHOT) {
  const [sl, sn] = (process.env.SPIN ?? '-10,-10').split(',').map(Number);
  await zoomTo(Number(process.env.SHOT_Z ?? 110000));
  await focusOn(sl, sn);
  await page.evaluate(() => window.__draw(true));
  const f0s = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__clock().frames) - f0s >= 4) break;
    await page.waitForTimeout(500);
  }
  const shot = join(WORK, 'globe-spun.png');
  await page.screenshot({ path: shot, timeout: 240000 });
  console.log(`\n  frame: ${shot}`);
}

// ── THE FLING: a throw coasts and comes to rest; a hold throws nothing ──
await focusOn(-29.9872, 24.7765);
// `__zoom` SETS A TARGET THE FRAME LOOP EASES TOWARD, and the harness runs at
// two to four frames a second, so a fixed wait after it is a wait on nothing:
// this block asked for 40,000 from the z900 the survey check left behind, slept
// 600ms, and dragged at whatever zoom the ease had reached — under the
// hand-over, where a drag is a flat pan and records no spin at all, which the
// throw then reported as "released at 0°/s". `zoomTo` polls until the zoom has
// actually arrived. (The same trap is written up in CLAUDE.md against
// `chart-dist.mjs`: the zoom and everything else live on different clocks.)
await zoomTo(40000);
await page.evaluate(() => { window.__fling(true); });
await page.waitForTimeout(600);
{
  const throwIt = async (restMs) => {
    const x0 = 195, y0 = 300;
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x0 + 15 * i, y0); await page.waitForTimeout(12); }
    if (restMs) await page.waitForTimeout(restMs);
    await page.mouse.up();
    await page.waitForTimeout(60);
    return (await globe()).focus;
  };
  const f1 = await throwIt(0);
  const v1 = (await page.evaluate(() => window.__fling())).fling;
  // Rest is when the spin reads zero, not a window guessed from the release:
  // at τ 0.45 s a 9°/s throw is under the stop threshold after ~2.3 s.
  let restMs = 0;
  for (; restMs < 5000; restMs += 100) {
    const f = (await page.evaluate(() => window.__fling())).fling;
    if (!f[0] && !f[1]) break;
    await page.waitForTimeout(100);
  }
  const f2 = (await globe()).focus;
  await page.waitForTimeout(300);
  const f3 = (await globe()).focus;
  check(dLon(f2[1], f1[1]) < -0.5, `a throw coasts on after the lift (released at ${v1[1]}°/s, ${dLon(f2[1], f1[1]).toFixed(2)}° more, westward)`);
  check(restMs < 5000 && Math.abs(dLon(f3[1], f2[1])) < 0.02, `and comes to rest (spin zero after ${restMs}ms, ${dLon(f3[1], f2[1]).toFixed(3)}° in the 300ms after)`);
  const g1 = await throwIt(250);
  await page.waitForTimeout(600);
  const g2 = (await globe()).focus;
  check(Math.abs(dLon(g2[1], g1[1])) < 0.02, `a finger that rested before lifting throws nothing (${dLon(g2[1], g1[1]).toFixed(3)}°)`);
  await page.evaluate(() => window.__fling(false));
}
const errs = await page.evaluate(() => window.__pageErrors ?? []);
check(errs.length === 0, `no page errors ${JSON.stringify(errs.slice(0, 2))}`);
await close();
console.log(fails ? `\n${fails} FAILURES` : '\nglobe-spin: all ok');
process.exit(fails ? 1 : 0);
