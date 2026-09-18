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

/**
 * …AND IT IS THE SAME HILLSIDE, PAINTED THE SAME WAY.
 *
 * The clip means the two layers never overlap, which is the point — and which
 * also makes "do they agree?" unanswerable from a normal frame, where the seam
 * mixes an honest difference in distance into every comparison. __farclip(off)
 * lifts the clip, so with the fine terrain hidden the shell stands exactly
 * where the fine world stood: same ground, same range, same sun. Then it is a
 * subtraction.
 *
 * What is asserted is the systematic part — the mean per-channel offset. A
 * band is a TONE difference across a boundary, and that is what this number
 * is. The per-pixel scatter is left alone on purpose: the shell's silhouette
 * is a 250m ladder and the fine world's is not, so along every ridge the two
 * disagree about which pixels are sky. That is level of detail doing its job.
 *
 * The caps are PER SPOT, because how much of the difference is reconcilable
 * depends on the ground. Over rolling country the shell stands on the same
 * hillside and the answer should be ~zero. Down a steep coast it stands where
 * its own chord puts it, which can be a ridge further out and a good deal more
 * air away — so some of the offset there is aerial perspective on honestly
 * different geometry, and no palette can talk it down.
 *
 * TRIED AND REJECTED: correcting the shell's slope for measurement lag. Both
 * layers read "rise across one DEM pixel over one vertex spacing", but a far
 * tile is eight fine tiles wide, so the shell measures over ~66m of ground
 * where the fine world measures over ~8m — and landscape being fractal, the
 * longer lag reads about 1.7x flatter. Scaling it back up is defensible
 * physics and made Senqu WORSE, from a bias of 1.5 to 14: the palette's slope
 * response is not linear, the two layers already agreed inside its flat band,
 * and the correction pushed the shell out of that band into rock. Matching the
 * statistic is not the same as matching the colour.
 */
async function bias(page) {
  await page.evaluate(() => window.__hide('far'));
  await page.waitForTimeout(2200);
  const fine = await page.evaluate(() => window.__scenegrab(2));
  await page.evaluate(() => { window.__hide('far', false); window.__hide('terrain'); window.__farclip(true); });
  await page.waitForTimeout(2800);
  const shell = await page.evaluate(() => window.__scenegrab(2));
  await page.evaluate(() => { window.__hide('far'); });
  await page.waitForTimeout(2200);
  const sky = await page.evaluate(() => window.__scenegrab(2));
  await page.evaluate(() => { window.__hide('far', false); window.__hide('terrain', false); window.__farclip(false); });
  await page.waitForTimeout(800);
  // Only where BOTH layers painted ground. Sky compared against sky says
  // nothing, and it is most of the upper frame.
  let n = 0, sum = [0, 0, 0];
  for (let i = 0; i < fine.n; i++) {
    let dF = 0, dS = 0;
    for (let c = 0; c < 3; c++) {
      dF = Math.max(dF, Math.abs(fine.px[i * 3 + c] - sky.px[i * 3 + c]));
      dS = Math.max(dS, Math.abs(shell.px[i * 3 + c] - sky.px[i * 3 + c]));
    }
    if (dF <= 8 || dS <= 8) continue;
    n++;
    for (let c = 0; c < 3; c++) sum[c] += shell.px[i * 3 + c] - fine.px[i * 3 + c];
  }
  return { n, bias: sum.map((x) => +(x / Math.max(1, n)).toFixed(1)) };
}

const errors = [];
for (const [name, spot, cap, tone] of [
  // Isterdalen: the valley the fault was reported from, from the cab.
  //
  // NOT ALIGNMENT-CHECKED, and the reason is the same one that made the clip
  // necessary. The shell's triangles chord straight over this gorge and come
  // to rest hundreds of metres above the valley floor, so with the clip lifted
  // it is not painting the same hillside a different colour — it is painting a
  // DIFFERENT PLACE, a plateau where the fine world has a valley. No palette
  // can reconcile those, which is precisely why the shell is clipped away here
  // rather than tinted into agreement.
  ['isterdalen', 'lat=62.54483&lon=7.71788&h=338&cam=cab&wx=clear&t=NOON', 0.2, 0],
  // Big Sur: steep coast, and the shell has real work to do at the horizon —
  // so the ceiling is looser, and the point is that it is a ceiling at all.
  ['big-sur', 'lat=36.3714&lon=-121.9020&h=80&cam=chase&wx=clear&t=NOON', 0.34, 18],
  // Senqu: rolling escarpment, chase cam, and the place the band was actually
  // reported from — one deep tone against one insipid one, across the seam.
  // The shell stands on the same ground here, so this is the tight one.
  ['senqu', 'lat=-30.6944&lon=27.7642&h=329&cam=chase&wx=clear&t=NOON', 0.34, 8],
]) {
  // `REV=<sha>` builds the client from that revision instead, so this suite can
  // be its own control. CLAUDE.md asks for that before blaming a change, and
  // this file needed it: the `fineR` check fails at isterdalen and senqu on
  // HEAD and on the parent alike — 45s of WALL time is not enough for the fine
  // ring to report a radius at two to four frames a second — so without a
  // control those two reasonably look like whatever you just touched.
  const d = await openDrive({ spot, tag: `far-${name}`, settle: 45000, ...(process.env.REV ? { rev: process.env.REV } : {}) });
  const far = await d.page.evaluate(() => window.__far());
  check(`${name}: the fine ring has a measured radius to clip against`,
    far.fineR > 0 && far.fineR >= far.tileM, { fineR: far.fineR, tileM: far.tileM });
  const s = await share(d.page, 'far');
  check(`${name}: the shell is a backdrop, not a lid (${(s * 100).toFixed(1)}% of frame)`,
    s < cap, { share: +s.toFixed(3), cap });
  if (tone) {
    const b = await bias(d.page);
    check(`${name}: shell and fine world paint one hillside alike (bias ${b.bias.join('/')})`,
      b.n > 400 && Math.max(...b.bias.map(Math.abs)) < tone, { ...b, tone });
  }
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — the shell stays behind the world');
report(errors);
if (bad) process.exitCode = 1;
