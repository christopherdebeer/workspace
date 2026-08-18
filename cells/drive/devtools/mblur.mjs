/**
 * WHAT THE SHUTTER DOES.
 *
 *   node cells/drive/devtools/mblur.mjs [--spot=...] [--kmh=190] [--settle=40000]
 *
 * ONE SCENE RENDER, TWO EXPOSURES. Each case drives the truck to a speed and
 * then asks `__mbpair` for the same frame twice — once with the shutter shut
 * and once with it open — by re-running the post chain over the render target
 * that is still sitting there. The two pictures differ by the dial and by
 * nothing else.
 *
 * That is not how this started. The first version drove the same corner twice
 * and photographed both, and its own control — the same setting shot twice —
 * moved 30% of the pixels while the effect under test moved 20%. The dust, the
 * wildlife, the suspension and the tiles still arriving are all bigger than an
 * eight-pixel streak. A comparison that cannot beat its own control is not a
 * comparison, so the method changed rather than the claim.
 *
 * Headless renders at 2-4fps, and the shutter is scaled by shutter/dt rather
 * than per frame, so these show the streak a 60fps player sees rather than the
 * one a three-frame-a-second capture would have painted.
 *
 * The canvas carries the WORLD only — the HUD is a separate DOM canvas over
 * the top — which is the half worth looking at here.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
// Chapman's Peak, sun and weather PINNED — without them two runs differ by the
// time of day as well as by the change.
const spot = arg('spot', 'lat=-34.06719&lon=18.37021&h=27&cam=chase&sunalt=22&time=AFTERNOON&wx=clear');
const kmh = Number(arg('kmh', 190));
const settle = Number(arg('settle', 40000));

const d = await openDrive({ spot, tag: 'mblur' });
await d.page.waitForTimeout(settle);
const mark = await d.page.evaluate(() => {
  const s = window.__drive;
  return { x: s.x, z: s.z, heading: s.heading };
});
console.log(`mark ${mark.x.toFixed(1)}, ${mark.z.toFixed(1)}  heading ${((mark.heading * 180) / Math.PI).toFixed(0)}°`);

const rows = [];
const pair = async (name, step, keys, v) => {
  await d.page.evaluate((a) => {
    const s = window.__drive;
    s.x = a.mark.x; s.z = a.mark.z; s.heading = a.mark.heading; s.speed = a.v;
    for (const k of a.keys) dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  }, { mark, v: v / 3.6, keys });
  await d.simWait(0.45);
  const r = await d.page.evaluate((st) => {
    const p = window.__mbpair(st);
    return { ...p, dbg: window.__mbdbg() };
  }, step);
  const w = (suffix, url) => {
    const f = join(WORK, `${name}-${suffix}.png`);
    writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
    return f;
  };
  w('off', r.off); w('on', r.on);
  await d.page.evaluate((k) => {
    for (const x of k) dispatchEvent(new KeyboardEvent('keyup', { key: x }));
    window.__drive.speed = 0;
  }, keys);
  await d.simWait(0.6);
  rows.push({ name, step, amt: r.amt, ...r.dbg });
  console.log(`-> ${name}-{off,on}.png   ${r.dbg.kmh}km/h  amt ${r.amt}`
    + `  camStep ${r.dbg.stepM}m  camYaw ${r.dbg.stepYawDeg}°`);
};

await pair('mb-straight-90', 1, ['w'], kmh);
await pair('mb-straight-180', 2, ['w'], kmh);
await pair('mb-straight-360', 3, ['w'], kmh);
// A corner, where the yaw term reaches the whole frame rather than only the
// ground under the nose. This is the case the effect either earns or loses on.
await pair('mb-corner-180', 2, ['w', 'd'], kmh);
await pair('mb-corner-360', 3, ['w', 'd'], kmh);
// From the seat: the cab camera is welded to the body, so it carries the
// suspension and the roll as well as the travel.
await d.page.evaluate(() => window.__setcam('cab'));
await d.simWait(0.5);
await pair('mb-cab-180', 2, ['w'], kmh);
await pair('mb-cab-360', 3, ['w'], kmh);
// THE MECHANISM, made unmistakable. Not a shipping setting and not a defence
// of one: 400km/h at a full-frame shutter exists so the pass can be SEEN to do
// the thing it claims before anyone argues about eight pixels.
await d.page.evaluate(() => window.__setcam('chase'));
await d.simWait(0.5);
await pair('mb-overspeed', 3, ['w'], 400);

console.log('');
console.log('  case                 step  shutter    amt    frame   camStep   camYaw    exposed    expYaw   km/h');
for (const r of rows) {
  console.log(`  ${r.name.padEnd(18)} ${String(r.step).padStart(4)}`
    + ` ${(r.shutterMs + 'ms').padStart(8)} ${r.amt.toFixed(3).padStart(6)}`
    + ` ${(r.dtMs.toFixed(0) + 'ms').padStart(7)} ${(r.stepM.toFixed(2) + 'm').padStart(9)}`
    + ` ${(r.stepYawDeg.toFixed(2) + '°').padStart(8)} ${(r.expM.toFixed(3) + 'm').padStart(10)}`
    + ` ${(r.expYawDeg.toFixed(3) + '°').padStart(9)} ${String(r.kmh).padStart(6)}`);
}
console.log(`\npixel grid ${rows[0]?.pix?.[0]} x ${rows[0]?.pix?.[1]}`);
console.log(`shots in ${WORK}`);
report(d.errors);
await d.close();
