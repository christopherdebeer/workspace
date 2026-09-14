/**
 * ── WHAT SOFTENS A DISTANT ROAD, AND WHAT A FOCAL PLANE DOES INSTEAD ──
 *
 *   node devtools/focus-ab.mjs              (the fix: air blur off, tilt off)
 *   AIR=1 node devtools/focus-ab.mjs        (the control: the old coupling)
 *   TILT=mini node devtools/focus-ab.mjs    (the focal plane, on the chart)
 *
 * ONE VARIANT PER PROCESS. The harness fuse is twenty minutes and a settled
 * fixture with drawing on is minutes; two variants in one run is a run killed
 * with its last number half written.
 *
 * The instrument is `__tilt()`, which reports the two softening terms — the
 * air's and the focal plane's — SEPARATELY at a transect of points straight
 * ahead. That separation is the whole point of the change, and a frame cannot
 * show it: a soft pixel looks the same whichever term produced it.
 *
 * The frames are taken with the quantiser and dither LEFT ON, because the
 * question is not whether this resembles photographic depth of field in a
 * smooth image. It is whether the defocused region collapses into broad,
 * quiet pixel clusters while the focal band keeps Drive's fine detail.
 */
import { openDrive } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const AIR = process.env.AIR ?? '0';
const TILT = process.env.TILT ?? 'off';
const FIX = process.env.FIX ?? 'at-campsbay';
const OUT = process.env.OUT ?? '/tmp/drive-tools/focus';
mkdirSync(OUT, { recursive: true });
const TAG = `air${AIR}-tilt${TILT}`;
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: `fixture=${FIX}&cam=top&time=NOON&wx=clear&nodraw=1&airblur=${AIR}&tilt=${TILT}`,
  tag: `focus-${TAG}`, settle: 0, bootTimeout: 240000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

let quiet = 0, pw = -1, pc = -1, pb = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && t.builds === pb && t.seenWays > 0)
    ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds;
  if (quiet >= 4) break;
}
console.log(`[${el()}] settled: ways ${pw}, roadCells ${pc}, builds ${pb}`);

// PUT THE TRUCK ON A ROAD FIRST. The transect runs along the camera's own
// ground ray from under the eye, and from open veld it measures the veld.
await q(() => window.__toroad?.(400));
for (const cam of ['chase', 'top']) {
  await q((m) => window.__cam(m), cam);
  await d.page.waitForTimeout(2500);
  const t = await q(() => window.__tilt());
  const { ahead, at, ...head } = t;
  console.log(`  [${cam}] ${JSON.stringify(head)}`);
  console.log(`    under the rig: ${JSON.stringify(at)}`);
  console.log('    ahead (m: air / coc / blur):');
  console.log('      ' + ahead.map((r) => `${r.t}m ${r.air.toFixed(3)}/${r.coc.toFixed(3)}/${r.blur.toFixed(3)}`).join('  '));
}

// ── THE HONEST A/B IS ONE PROCESS, TWO UNIFORM VALUES ──
//
// Two separate boots of the same fixture are NOT a control: the wildlife, the
// sward's phase and the streaming order all differ, so a diff between them
// carries the change plus whatever the world did. Measured that way the first
// time: mean 0.85/255 with a worst pixel of 133.9, and the 133.9 was nothing
// to do with the blur.
//
// `__tilt({air})` sets the uniform live, so these two frames come from one
// boot, one settled world, one clock — and differ by exactly the term under
// test. The same trick the dither rack uses: re-composite what is already in
// rtScene rather than rendering the world twice.
if (process.env.AB === '1') {
  await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
  await q(() => window.__cam('chase'));
  await d.page.waitForTimeout(9000);
  for (const air of [1, 0]) {
    await q((a) => window.__tilt({ air: a }), air);
    await d.page.waitForTimeout(1200);
    writeFileSync(`${OUT}/ab-air${air}.png`, await d.page.screenshot({ timeout: 240000 }));
    console.log(`  shot ab-air${air}`);
  }
  // …and the same for the focal plane, so the two softenings can be told apart
  // in pixels and not only in the probe.
  // THE FOCAL PLANE, ON BOTH CAMERAS AND FROM ONE BOOT. `amount: null` puts
  // the preset back rather than pinning a number, so the ON frame is the look
  // as it actually ships on that camera — full on the chart, a third in chase.
  // The band itself is never set here in bare pixels: the preset states it as
  // a fraction of `halfPx`, half the art frame, which is the scale a viewer
  // can actually predict. `satPx` is printed beside it because it is the
  // ceiling on receding ground — a band at or over it never resolves.
  for (const cam of ['chase', 'top']) {
    await q((m) => window.__cam(m), cam);
    if (cam === 'top') await q(() => window.__zoom(0.9));
    await d.page.waitForTimeout(9000);
    for (const on of [0, 1]) {
      await q((v) => window.__tilt({ air: 0, amount: v ? null : 0 }), on);
      await d.page.waitForTimeout(1200);
      const t = await q(() => window.__tilt());
      writeFileSync(`${OUT}/ab-${cam}-tilt${on}.png`, await d.page.screenshot({ timeout: 240000 }));
      console.log(`  shot ab-${cam}-tilt${on}  amt ${t.amount} D ${t.focusDistM}m`
        + ` band ${t.sharpPx}-${t.blurPx} of half ${t.halfPx} / sat ${t.satPx}`
        + ` N ${JSON.stringify(t.focusN)}`);
    }
  }
}
if (process.env.SHOTS !== '0' && process.env.AB !== '1') {
  await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
  for (const [name, cam, zoom] of [['chase', 'chase', 0], ['top', 'top', 0.9]]) {
    await q((m) => window.__cam(m), cam);
    if (zoom) await q((z) => window.__zoom(z), zoom);
    await d.page.waitForTimeout(9000);
    writeFileSync(`${OUT}/${name}-${TAG}.png`, await d.page.screenshot({ timeout: 240000 }));
    console.log(`  shot ${name}`);
  }
  console.log(`  frames in ${OUT}`);
}
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
await d.close();
