/**
 * ── THE HALF-METRE: DOES THE MATERIAL DRAW IT BETTER THAN THE COVER CLASS ──
 *
 *   node cells/drive/devtools/band-d.mjs
 *   SPOT='lat=46.5302&lon=10.4547' node .../band-d.mjs     (the Stelvio)
 *
 * Band D is the one band in this renderer with TWO possible owners: the detail
 * cascade's third octave, which has drawn at 0.25 m for years keyed on the
 * COVER class, and the substrate's own micro-structure, keyed on what the
 * ground is made of. `uSubMic` scales the handover between them in both
 * directions at once — micro 0 is the octave whole with no micro under it,
 * which is the exact world before band D — so this is a one-boot interleaved
 * A/B of a uniform and not a comparison of two boots under two skies.
 *
 * ── AND IT HAS TO BE MEASURED WHERE IT DRAWS, WHICH IS NOT THE CHASE FRAME ──
 *
 * The terms fade out by 0.36 m of art-pixel footprint, and a chase seat looks
 * at the ground at a grazing angle: the doctrine's own table puts the ALONG-ray
 * footprint at 4.1 m by fifty metres out, so band D is a strip a few metres
 * deep at the very bottom of that frame and a full-frame mean of it is the term
 * divided by the horizon. Two stations instead:
 *
 *   NEAR CHART — the top camera at its own minimum zoom, about 22 m over the
 *   truck, so the WHOLE pane is inside the band and the measurement is of the
 *   term rather than of how much of the frame it reached. This is the zoom
 *   ZOOM_MIN exists for and the scale the joins are judged at.
 *
 *   CHASE STRIP — the real seat, cropped to the bottom fifth, which is the
 *   ground a driver is actually about to drive over. Quieter by construction
 *   and the one that says whether any of this reaches the game.
 *
 * The floor is the same setting photographed twice at the same separation as
 * the cross pairs, because that is the only thing that makes a mean of
 * fractions of a palette step readable at all.
 */
import { openDrive } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// The Stelvio: a bare alpine pass whose chase floor measured EXACTLY zero in
// phase C — no wildlife, no sward, nothing left to stream — which is the
// cleanest surface in this repo for a term this quiet.
const SPOT = process.env.SPOT ?? 'lat=46.5302&lon=10.4547';
const FIX = process.env.FIX ?? '';
const OUT = process.env.OUT ?? '/tmp/drive-tools/bandd';
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: (FIX ? `fixture=${FIX}` : SPOT) + '&cam=chase&time=NOON&wx=clear&nodraw=1',
  tag: 'band-d', settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

let quiet = 0, pw = -1, pc = -1, pb = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.roadCells === pc && t.builds > 0)
    ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds;
  if (quiet >= 4) break;
}
console.log(`[${el()}] settled: ways ${pw}, roadCells ${pc}, builds ${pb}`);

// WHAT THE GROUND IS MADE OF, because band D is weighted by the mineral share
// and a place that expresses none of it is a place where this term correctly
// does nothing. A run that does not print this cannot say which it measured.
const head = await q(() => {
  const t = window.__tdetail();
  return { sub: t.sub, micro: t.micro, relief: t.relief, mat: t.mat, cam: t.cam };
});
console.log(`  ${JSON.stringify(head)}`);

await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });

const legs = [
  // Interleaved, so each repeat is adjacent to its twin.
  ['mic0', { micro: 0 }], ['mic1', { micro: 1 }],
  ['mic0-b', { micro: 0 }], ['mic1-b', { micro: 1 }],
  ['mic2', { micro: 2 }],
  // …and the same band with the lighting normal taken out, which is what says
  // how much of band D is COLOUR and how much of it is the relief the owner's
  // normal pass gets from it for nothing.
  ['mic1-flat', { micro: 1, relief: 0 }], ['mic0-flat', { micro: 0, relief: 0 }],
];
const pairs = [
  ['mic0', 'mic0-b', 'floor-off'], ['mic1', 'mic1-b', 'floor-on'],
  ['mic0', 'mic1', 'SIGNAL'], ['mic1', 'mic2', 'micro 1 vs 2'],
  ['mic0-flat', 'mic1-flat', 'colour only (relief 0)'],
  ['mic1-flat', 'mic1', 'the relief band D buys'],
];

for (const station of ['near-chart', 'chase-strip']) {
  if (station === 'near-chart') {
    await q(() => window.__cam('top'));
    // ZOOM_MIN: about 22 m over the truck, a frame ~23 m across — every art
    // pixel of it well inside band D, which is the point of standing here.
    // POLLED, NOT WAITED ON: __zoom sets a TARGET the frame loop eases toward
    // at 8/s and the harness runs at three frames a second, so a fixed wait
    // photographs whatever zoom it happened to reach. `dist` is the stand-off
    // in metres and is what settles; the `zoom` field is rounded to a decimal
    // and cannot resolve 0.125 at all.
    let pd = -1;
    for (let i = 0; i < 40; i++) {
      await q(() => window.__zoom(0.125));
      await d.page.waitForTimeout(500);
      const z = await q(() => window.__cam());
      if (z.dist !== null && z.dist === pd && z.dist < 40) break;
      pd = z.dist;
    }
    console.log(`  [near-chart] stand-off ${pd} m`);
  } else {
    await q(() => window.__cam('chase'));
  }
  await d.page.waitForTimeout(9000);
  // THE FOOTPRINT AT THIS STATION, stated rather than assumed: a measurement of
  // a band-limited term over ground the band does not reach is a measurement of
  // the floor, and the only way to know is to ask what an art pixel covers.
  const px = await q(() => {
    const t = window.__tdetail();
    return { mpp: t.mpp, pix: t.pix, along: t.ahead.slice(0, 3).map((a) => [a.d, a.geo]) };
  });
  console.log(`  [${station}] footprint: mpp ${px.mpp} · ${px.along.map(([m, g]) => `${m}m ${g}`).join(' · ')}`);
  for (const [tag, o] of legs) {
    await q((v) => window.__tdetail(v), o);
    await d.page.waitForTimeout(500);
    writeFileSync(`${OUT}/${station}-${tag}.png`, await d.page.screenshot({ timeout: 240000 }));
  }
  await q(() => window.__tdetail({ micro: 1, relief: 0.35 }));
  const box = await q(() => ({ w: window.innerWidth, h: window.innerHeight }));
  // The near chart is band D edge to edge; the chase frame is band D in the
  // bottom fifth and the horizon everywhere above it.
  const crop = station === 'near-chart'
    ? `--crop=${Math.round(box.w * 0.1)},${Math.round(box.h * 0.1)},${Math.round(box.w * 0.8)},${Math.round(box.h * 0.8)}`
    : `--crop=${Math.round(box.w * 0.1)},${Math.round(box.h * 0.8)},${Math.round(box.w * 0.8)},${Math.round(box.h * 0.2)}`;
  for (const [a, b, label] of pairs) {
    const out = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
      `${OUT}/${station}-${a}.png`, `${OUT}/${station}-${b}.png`, `${OUT}/${station}-d-${a}-${b}.png`,
      crop, '--gain=8'], { encoding: 'utf8' });
    const m = out.match(/mean luma delta[^\n]*/);
    console.log(`  [${station}] ${label.padEnd(24)} ${m ? m[0].trim() : out.trim().split('\n').pop()}`);
  }
}
// ── AND THE SWARD'S OWN PER-BLADE HALF, ON THE SAME BOOT ──
//
// Phase D's remainder is two terms the seeder cannot reach — how tall a tuft
// grows and what share of its plants are flowers — and `__swardmic` is their
// dial for the same reason `uSubMic` is band D's. The station is the CHASE
// frame's lower half rather than the near chart: the sward draws to 140 m and
// a 23 m box would measure a handful of tufts. A place with no grass in it
// reads as the floor, correctly, and the head line above says which this was.
{
  await q(() => window.__cam('chase'));
  await q(() => window.__tdetail({ micro: 1, relief: 0.35 }));
  await d.page.waitForTimeout(6000);
  const swLegs = [['sw0', 0], ['sw1', 1], ['sw0-b', 0], ['sw1-b', 1]];
  for (const [tag, v] of swLegs) {
    await q((x) => window.__swardmic(x), v);
    await d.page.waitForTimeout(500);
    writeFileSync(`${OUT}/sward-${tag}.png`, await d.page.screenshot({ timeout: 240000 }));
  }
  await q(() => window.__swardmic(1));
  const sub = await q(() => window.__swardsub());
  console.log(`  [sward] ${JSON.stringify(sub)}`);
  const box = await q(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const crop = `--crop=${Math.round(box.w * 0.1)},${Math.round(box.h * 0.5)},`
    + `${Math.round(box.w * 0.8)},${Math.round(box.h * 0.45)}`;
  for (const [a2, b2, label] of [['sw0', 'sw0-b', 'floor-off'], ['sw1', 'sw1-b', 'floor-on'],
    ['sw0', 'sw1', 'SIGNAL']]) {
    const out = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
      `${OUT}/sward-${a2}.png`, `${OUT}/sward-${b2}.png`, `${OUT}/sward-d-${a2}-${b2}.png`,
      crop, '--gain=8'], { encoding: 'utf8' });
    const m = out.match(/mean luma delta[^\n]*/);
    console.log(`  [sward] ${label.padEnd(24)} ${m ? m[0].trim() : out.trim().split('\n').pop()}`);
  }
}
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(`  harness errors: ${d.errors.length}${d.errors.length ? ' ' + JSON.stringify(d.errors.slice(0, 4)) : ''}`);
await d.close();
