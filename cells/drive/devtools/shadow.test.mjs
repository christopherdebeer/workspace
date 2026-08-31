/**
 * THE SHADOW BOX: A CROP THAT MOVED, AND A GRID THAT SLID.
 *
 *   node cells/drive/devtools/shadow.test.mjs
 *
 * Reported from the seat as one thing — "shadows seem dis/miss-connected to
 * the viewport, they slide in and out of a mask/crop" — and it was two, which
 * is why it reads as a single unplaceable wrongness:
 *
 * (1) THE CROP IS REAL AND IT RIDES YOU. The sun casts through ONE cascade
 *     about 220m across, re-centred on the truck every frame. A cab sees 900m.
 *     Everything past the box is lit as though the sun could see it, so a
 *     cliff's shadow SWITCHES ON as the box reaches it — at a radius, moving
 *     at driving speed, across ground that is standing still. The old comment
 *     claimed "the aerial haze hides the boundary"; haze hides things at a
 *     DISTANCE, and this boundary is at a RADIUS.
 *
 * (2) THE GRID SLID. The box was re-centred at whatever position the physics
 *     produced, so its texel lattice moved continuously under a world that was
 *     not moving. At 0.21m per texel and 25m/s that re-quantises every shadow
 *     edge in the world a hundred times a second, each stepping a texel back
 *     and forth. That is the swimming.
 *
 * WHAT THIS ASSERTS:
 *   - the fade patch actually took. It did NOT, first time, and reported a
 *     working feature: the anchor was a literal getShadow call copied from the
 *     r160 source, and the three that runs is not r160 — it passes a
 *     shadowIntensity argument the import pin does not predict. A silent
 *     String.replace miss is indistinguishable from a feature that does
 *     nothing, which is the whole reason this check exists.
 *   - the centre lands ON the texel grid when the snap is on, and off it when
 *     it is not. Measured AFTER the snap, so a basis that does not match the
 *     one three builds fails here rather than quietly buying nothing.
 *   - the box's own numbers, so the crop is written down rather than argued
 *     about: how far the shadows reach against how far the camera sees.
 */
import { openDrive, report, layerVsGround } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (cond) { console.log(`ok    ${name}`); return; }
  bad++; console.log(`FAIL  ${name}\n      saw: ${JSON.stringify(saw)}`);
};

// A fjord: the most relief per square kilometre anywhere in the spot list, so
// there is something for the sun to cast past. Side-lit at fifteen degrees —
// straight into the sun is a lens flare and straight away from it is a scene
// with no shadows in it at all, and both have been photographed by mistake.
const d = await openDrive({
  spot: 'lat=62.54483&lon=7.71788&h=90&cam=cab&wx=clear&time=NOON&sunalt=15', tag: 'shadow', settle: 50000 });
const page = d.page;
await page.evaluate(() => { window.__hide('critters'); window.__hide('sward'); });
await page.evaluate(() => { window.__dial('shq', 2); window.__dial('sdark', 3); });
await page.waitForTimeout(7000);

const box = await page.evaluate(() => window.__shadowbox());
console.log(`      box ${box.box}m across at ${box.map} -> ${box.mPerTexel}m per texel`
  + ` · reach ${box.reach}m against a ${box.viewRadius}m view`
  + ` · fade ${box.fade} · darkness patch ${box.dark}`);

check('the sun is casting at all', box.on === true, box);
// THE ONE THAT HAS ALREADY CAUGHT A SILENT MISS.
check('the box-edge fade patch found its anchor in the running three',
  box.fade === true, { fade: box.fade, saw: box.fadeSaw });
check('and the darkness patch still has its own', box.dark === true, box);
// Not a fault — the design — but written down, because the round before
// argued about whether the boundary existed.
check(`the crop is smaller than the view, which is why it is visible`
  + ` (${box.reach}m of shadow in a ${box.viewRadius}m view)`,
  box.reach < box.viewRadius, box);

// ── the grid ──
//
// Seven centimetres a step: a third of a texel, so an unsnapped box lands
// somewhere different every time and a snapped one cannot move at all.
const walk = async () => {
  const out = [];
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => { window.__drive.x += 0.07; window.__drive.z += 0.07; });
    await page.waitForTimeout(600);
    out.push(await page.evaluate(() => window.__shadowbox().phase));
  }
  return out;
};
await page.evaluate(() => window.__shadowbox({ snap: false }));
const raw = await walk();
await page.evaluate(() => window.__shadowbox({ snap: true }));
const snapped = await walk();
console.log(`      sub-texel phase of the box centre: unsnapped ${raw.map((v) => v.toFixed(3)).join(' ')}`
  + ` · snapped ${snapped.map((v) => v.toFixed(3)).join(' ')}`);
check('unsnapped, the box centre wanders off the texel grid as the truck moves',
  Math.max(...raw) > 0.15 && new Set(raw.map((v) => v.toFixed(3))).size > 2, raw);
check('snapped, it lands on the grid every frame',
  Math.max(...snapped) < 1e-6, snapped);

check('no shader failed to compile', d.errors.filter((e) => e.startsWith('GLSL:')).length === 0,
  d.errors.filter((e) => e.startsWith('GLSL:')));
report(d.errors);
await d.close();

// ── (2) THE THING THE BOX CANNOT DO: A HILL SHADING ITS OWN VALLEY ──
//
// Reported from the seat with the spot — Yosemite, the Pohono Trail on the
// south rim — and "no clear shadows being cast, across times of day". Measured
// there before any of this, as the share of the frame that changes when the
// sun's shadows are switched off:
//
//     DAWN 0.01%  MORNING 0.01%  NOON 0.01%  AFTERNOON 0.01%  DUSK 19%
//
// The shadow map was working exactly as specified on a landscape it cannot
// describe: the thing that shades that valley is a wall of granite a kilometre
// away and nine hundred metres up, outside a 220m box both laterally and in
// depth. Only at dusk do shadows grow long enough for their first two hundred
// metres to land near the truck.
//
// So the landscape is marched against a coarse heightfield instead, and the
// assertion that matters is not "there are shadows" — a bug produces those in
// quantity — but that the answer MOVES WITH THE SUN. A high sun casts almost
// nothing; a low one casts across the country. The first cut failed exactly
// this: it painted 24% of the frame with the sun five degrees off vertical,
// which is acne at landscape scale, and it read 22-24% at every hour of the
// day. An effect that does not vary with the light is not a shadow.
const y = await openDrive({
  spot: 'lat=37.70753&lon=-119.68158&h=62&cam=chase&wx=clear&time=NOON', tag: 'shadow-march', settle: 55000 });
// VEGETATION TOO, and it is not tidiness. The harness serves land cover now,
// so this spot is 88% FOREST instead of the bare fallback it used to render,
// and refreshVeg reshuffles its instances on a 900ms tick — which showed up as
// a noise floor ALTERNATING 11.9% / 1.0% / 11.6% between identical frames.
// A floor that oscillates is a moving object, not a settling world.
await y.page.evaluate(() => {
  window.__hide('critters'); window.__hide('sward'); window.__hide('veg');
});
await y.page.evaluate(() => { window.__dial('shq', 2); window.__dial('sdark', 3); });
await y.page.waitForTimeout(14000);
const m0 = (await y.page.evaluate(() => window.__shadowbox())).march;
console.log(`      march field ${m0.n}x${m0.n} at ${m0.m}m = ${m0.span}m of country`
  + ` · ${m0.steps} steps · ${m0.ms}ms a sweep · ground ${m0.hMin}..${m0.hMax}m`);
check('the march field is built and switched on', m0.on === true && m0.ready === true, m0);
check('and it holds real country rather than a flat guess', m0.hMax - m0.hMin > 200, m0);

// SAME PAGE, SAME GROUND. __sunalt moves the sun without a reload, because two
// loads of one spot do not put the same world under the wheels and this is a
// comparison between sun heights, not between worlds.
const frame = async () => { await y.page.waitForTimeout(900); return y.page.screenshot(); };
// ── THE NOISE FLOOR FIRST, AND IT IS NOT A FORMALITY ──
//
// This suite spent a round chasing numbers that swung between 0.1% and 24% for
// the same settings, because a spot the local harness cannot stream keeps
// arriving between frames and every screenshot differs for reasons that have
// nothing to do with the sun. Two frames with NOTHING changed between them say
// how much of any reading below is the world settling.
// Read three times and keep the LAST. A world that is still arriving only ever
// gets quieter, so the first pair measures the tail of the boot rather than the
// floor — 13.6% on one run against 1.8% the pair after it, and the test failed
// itself on the difference.
// READ UNTIL IT IS QUIET, not a fixed three times. Terrain tiles keep landing
// at a cold spot long after boot, and one arriving between two frames repaints
// a tenth of them — measured as a floor that went 1.8% / 11.8% / 0.5%, so a
// fixed count passes or fails on where the spike happens to fall. Wait for a
// quiet pair instead, and say so if one never comes.
const fs = [];
let floor = 1;
for (let i = 0; i < 6 && floor >= 0.04; i++) {
  floor = layerVsGround(await frame(), await frame(), 140, 620, 12).cover;
  fs.push(floor);
}
console.log(`      noise floor between two identical frames: ${fs.map((v) => (v * 100).toFixed(2) + '%').join(' -> ')}`);
check(`the world went still enough to measure against (${(floor * 100).toFixed(2)}%)`,
  floor < 0.04, fs);
// EACH READING GETS ITS OWN FLOOR, and is retaken if the world moved during
// it. One floor at the top is not enough: tiles keep landing, and a reading
// taken across one arriving measured 11.6% with the sun overhead — the same
// magnitude as the spike, and indistinguishable from the acne this is here to
// catch. Quiet pair first, then the measurement, then trust it.
const paints = async (deg) => {
  await y.page.evaluate((v) => window.__sunalt(v), deg);
  // LONGER THAN IT LOOKS LIKE IT NEEDS. At 1.4s the sun had not caught up and
  // the "overhead" frame was still the previous sun's — which read as the
  // march being blind to elevation, and was the harness being asked too soon.
  await y.page.waitForTimeout(1600);
  let cover = null, quiet = 1;
  for (let i = 0; i < 4 && cover === null; i++) {
    quiet = layerVsGround(await frame(), await frame(), 140, 620, 12).cover;
    if (quiet >= 0.04) continue;
    const on = await frame();
    await y.page.evaluate(() => window.__shadowbox({ march: false }));
    const off = await frame();
    await y.page.evaluate(() => window.__shadowbox({ march: true }));
    await y.page.waitForTimeout(500);
    cover = layerVsGround(on, off, 140, 620, 12).cover;
  }
  if (cover === null) throw new Error(`the world never went still at sunalt ${deg} (last ${quiet})`);
  return cover;
};
const high = await paints(85);
const low = await paints(8);
console.log(`      march paints ${(high * 100).toFixed(2)}% of the view with the sun at 85 degrees,`
  + ` ${(low * 100).toFixed(2)}% at 8`);
// THE ACNE CHECK. Five degrees off vertical, nothing on this earth is in
// terrain shadow but a cliff face, and the first cut said a quarter of the
// frame was.
check(`a sun overhead shades almost nothing (${(high * 100).toFixed(2)}%)`,
  high < 0.06, { high, floor });
// …AND IT IS NOT SIMPLY SWITCHED OFF. A march that always returns "lit" would
// pass the check above and be worthless.
check(`a low sun shades the country (${(low * 100).toFixed(2)}%)`,
  low > 0.05 && low > floor * 4, { low, floor });
check('…and does more of it than a high one', low > high * 2, { low, high });
check('no shader failed to compile in the march', y.errors.filter((e) => e.startsWith('GLSL:')).length === 0,
  y.errors.filter((e) => e.startsWith('GLSL:')));
report(y.errors);
await y.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — the box holds still, and the hill shades its own valley');
if (bad) process.exitCode = 1;
