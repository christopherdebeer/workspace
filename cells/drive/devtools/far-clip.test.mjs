/**
 * THE COARSE SHELL IS A BACKDROP, NOT A LID.
 *
 *   node cells/drive/devtools/far-clip.test.mjs
 *
 * Reported from the seat in Isterdalen: "I see the road during boot only to be
 * obscured by a sheet." The sheet was the far terrain shell. It samples the
 * DEM every ~250m and is kept out of the fine world's way by sinking it twelve
 * metres — which is plenty in rolling country and nothing at all in a fjord,
 * where its triangles chord straight over a gorge a kilometre wide and eight
 * hundred deep and come to rest above the road at the bottom of it. Measured
 * with __hide('far') before the fix: the shell was painting 42% of a cab frame,
 * and under it were the road, the verges and the valley.
 *
 * The law, and the reason it is stated as a PICTURE rather than as a height:
 * the shell may legitimately fill a lot of frame at the horizon, so what must
 * be true is not "the shell is low" but
 *
 *   TURNING THE SHELL OFF BARELY CHANGES THE PICTURE NEAR THE TRUCK.
 *
 * Checked at a Norwegian valley (where it failed) and at Big Sur (steep coast,
 * the other place the owner drives), by grabbing the render target with and
 * without the shell and counting how much of it moved.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** How much of the frame a layer accounts for, as a fraction. */
async function share(page, layer) {
  const a = await page.evaluate(() => window.__scenegrab(4));
  await page.evaluate((l) => window.__hide(l), layer);
  await page.waitForTimeout(1200);
  const b = await page.evaluate(() => window.__scenegrab(4));
  await page.evaluate((l) => window.__hide(l, false), layer);
  await page.waitForTimeout(600);
  // PER CHANNEL. A luminance comparison agreed with a PNG diff on the shell and
  // then missed the fine terrain by seven times, because what it reveals at
  // Isterdalen is the fjord — a different colour at the same brightness.
  let moved = 0;
  for (let i = 0; i < a.n; i++) {
    const d0 = Math.abs(a.px[i * 3] - b.px[i * 3]);
    const d1 = Math.abs(a.px[i * 3 + 1] - b.px[i * 3 + 1]);
    const d2 = Math.abs(a.px[i * 3 + 2] - b.px[i * 3 + 2]);
    if (Math.max(d0, d1, d2) > 8) moved++;
  }
  return moved / a.n;
}

const errors = [];
for (const [name, spot, cap] of [
  // Isterdalen: the valley the fault was reported from, from the cab.
  ['isterdalen', 'lat=62.54483&lon=7.71788&h=338&cam=cab&wx=clear&t=NOON', 0.2],
  // Big Sur: steep coast, and the shell has real work to do at the horizon —
  // so the ceiling is looser, and the point is that it is a ceiling at all.
  ['big-sur', 'lat=36.3714&lon=-121.9020&h=80&cam=chase&wx=clear&t=NOON', 0.34],
]) {
  const d = await openDrive({ spot, tag: `far-${name}`, settle: 45000 });
  const far = await d.page.evaluate(() => window.__far());
  check(`${name}: the fine ring has a measured radius to clip against`,
    far.fineR > 0 && far.fineR >= far.tileM, { fineR: far.fineR, tileM: far.tileM });
  const s = await share(d.page, 'far');
  check(`${name}: the shell is a backdrop, not a lid (${(s * 100).toFixed(1)}% of frame)`,
    s < cap, { share: +s.toFixed(3), cap });
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — the shell stays behind the world');
report(errors);
if (bad) process.exitCode = 1;
