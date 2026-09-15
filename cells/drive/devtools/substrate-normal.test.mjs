/**
 * THE SUBSTRATE'S MATERIAL STRUCTURE REACHES LIGHTING.
 *
 *   node cells/drive/devtools/substrate-normal.test.mjs
 *
 * The DEM normal remains the terrain's shape. This test holds the camera,
 * geomorphic field and material classification still, then flips only the
 * live material-relief uniform. Interleaved repeats measure the renderer's
 * own noise floor beside the signal, so a moving blade or late frame cannot
 * pass as bedding catching the sun.
 */
import { decodePng, openDrive, report } from './harness.mjs';

let bad = 0;
const ok = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'fixture=at-campsbay&cam=top&time=NOON&wx=clear&nodraw=1',
  tag: 'substrate-normal',
  settle: 12000,
  bootTimeout: 90000,
  dpr: 1,
});

await d.page.evaluate(() => {
  window.__draw(true);
  window.__hud(false);
  window.__hide('rig');
  window.__hide('critters');
  window.__hide('sward');
  window.__hide('veg');
  window.__hide('sea');
  window.__zoom(0.6);
});
await d.page.waitForTimeout(1500);
const initialRelief = await d.page.evaluate(() => window.__tdetail().relief);

const capture = async (relief) => {
  const state = await d.page.evaluate((value) => {
    const detail = window.__tdetail({ sub: 1, relief: value });
    return { relief: detail.relief, sub: detail.sub, mat: detail.mat };
  }, relief);
  await d.page.waitForTimeout(250);
  return { state, png: await d.page.screenshot({ timeout: 120000 }) };
};

const offA = await capture(0);
const onA = await capture(4);
const offB = await capture(0);
const onB = await capture(4);
await d.page.evaluate((relief) => window.__tdetail({ relief }), initialRelief);

const delta = (aBuf, bBuf) => {
  const a = decodePng(aBuf), b = decodePng(bBuf);
  if (a.w !== b.w || a.h !== b.h || a.ch !== b.ch) throw new Error('frames differ in shape');
  // The truck is the centre of a top view. Keep the measurement on its loaded
  // fine terrain rather than dividing it by the coastal fixture's animated
  // water and the far shell where no substrate field is bound.
  const x0 = Math.floor(a.w * 0.2), x1 = Math.ceil(a.w * 0.8);
  const y0 = Math.floor(a.h * 0.2), y1 = Math.ceil(a.h * 0.8);
  let sum = 0, moved = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * a.ch;
      const la = a.px[i] * 0.299 + a.px[i + 1] * 0.587 + a.px[i + 2] * 0.114;
      const lb = b.px[i] * 0.299 + b.px[i + 1] * 0.587 + b.px[i + 2] * 0.114;
      const d = Math.abs(la - lb);
      sum += d;
      if (d > 3) moved++;
      n++;
    }
  }
  return { mean: sum / n, movedPct: moved * 100 / n };
};

const floor = [
  delta(offA.png, offB.png),
  delta(onA.png, onB.png),
];
const signal = [
  delta(offA.png, onA.png),
  delta(offB.png, onB.png),
];
const maxFloorMean = Math.max(...floor.map((v) => v.mean));
const maxFloorMoved = Math.max(...floor.map((v) => v.movedPct));
const minSignalMean = Math.min(...signal.map((v) => v.mean));
const minSignalMoved = Math.min(...signal.map((v) => v.movedPct));

ok('the live relief dial round-trips 0 and 4',
  offA.state.relief === 0 && onA.state.relief === 4,
  { off: offA.state.relief, on: onA.state.relief });
ok('relief changes no geomorphic material classification',
  JSON.stringify(offA.state.mat) === JSON.stringify(onA.state.mat),
  { off: offA.state.mat, on: onA.state.mat });
ok('material relief moves lit terrain above the same-setting frame floor',
  minSignalMean > maxFloorMean + 0.2
    && minSignalMoved > maxFloorMoved + 2,
  { floor, signal });

report(d.errors);
await d.close();
if (d.errors.length) bad++;
console.log(bad ? `\n${bad} FAILED`
  : '\nall good — substrate structure perturbs lighting without changing its material field');
if (bad) process.exitCode = 1;
