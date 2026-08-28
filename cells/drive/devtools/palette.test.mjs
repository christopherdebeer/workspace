/**
 * THE PALETTE, COUNTED — does the quantiser actually take effect?
 *
 *   node cells/drive/devtools/palette.test.mjs
 *
 * Asked from the seat, and the honest answer is a census, not a code read:
 * one boot, the dials moved live over the probe, and the same crop of the
 * same frame counted three ways. If PALETTE 2 + INK MONO does not collapse
 * the distinct-colour count to a handful, the dial is decoration — which is
 * exactly the doubt that was raised.
 *
 * Counting is done on 8-wide buckets per channel, because the screenshot is
 * of the upscaled canvas and resampling invents in-between values at pixel
 * edges; bucketing forgives the scaler without forgiving the quantiser.
 * Greyness is asserted per pixel — a blend of greys is still grey, so MONO
 * survives any scaler; a colour truck or a teal HUD leaking into the crop
 * would fail it honestly.
 */
import { openDrive, report, decodePng } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/**
 * Distinct bucketed colours in a mid-height, left-of-centre crop, plus how
 * much of it is COLOURED at all. Fractions, not worst-cases: world-anchored
 * POI labels ride the HUD canvas in teal and gold and stream in on their own
 * clock — one label in the crop is an instrument doing its job, not colour
 * leaking through the ink. (It cost this test a pass to learn that: the same
 * boot, three seconds later, grew a VILLAGE CARWASH label mid-crop.)
 */
const census = (png) => {
  const { w, h, ch, px } = png;
  const seen = new Set();
  const greyHist = new Map();
  let colored = 0, total = 0, greyTotal = 0;
  for (let y = Math.floor(h * 0.16); y < h * 0.44; y += 2) {
    for (let x = Math.floor(w * 0.06); x < w * 0.66; x += 2) {
      const i = (y * w + x) * ch;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      seen.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      total++;
      if (Math.abs(r - g) > 8 || Math.abs(g - b) > 8) colored++;
      else { greyHist.set(r >> 3, (greyHist.get(r >> 3) ?? 0) + 1); greyTotal++; }
    }
  }
  // The mass of the four strongest grey tones — DISTINCT-value counting is
  // the wrong statistic under a resampling screenshot: a 1-bit weave is
  // nothing but texel edges, and the scaler blends every one of them into a
  // manufactured in-between grey. What resampling cannot fake is where the
  // MASS sits: a genuine two-level frame is carried by a handful of modes
  // however many blends fringe them.
  const ranked = [...greyHist.values()].sort((a, b) => b - a);
  const top4 = ranked.slice(0, 4).reduce((a, b) => a + b, 0) / Math.max(1, greyTotal);
  // Top-2 for the true 1-bit dial: two tones plus the scaler's blend fringe.
  const top2 = ranked.slice(0, 2).reduce((a, b) => a + b, 0) / Math.max(1, greyTotal);
  return { n: seen.size, coloredF: colored / total, greyTop4: top4, greyTop2: top2 };
};

const d = await openDrive({
  spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&time=NOON&wx=clear&wet=0&fog=0',
  tag: 'palette', settle: 14000,
});

const dials = await d.page.evaluate(() => window.__dial());
check('the three dials exist and sit at the shipped defaults',
  dials.pal === '14' && dials.dith === 'FULL' && dials.ink === 'COLOUR',
  { pal: dials.pal, dith: dials.dith, ink: dials.ink });

const shot = async () => { await d.page.waitForTimeout(1200); return census(decodePng(await d.page.screenshot())); };

const at14 = await shot();
await d.page.evaluate(() => window.__dial('pal', 2));            // 4 steps
const at4 = await shot();
await d.page.evaluate(() => { window.__dial('pal', 1); window.__dial('ink', 1); });  // 2 steps + MONO: 3 greys
const at3tone = await shot();
await d.page.evaluate(() => window.__dial('pal', 0));            // 1 step + MONO: TRUE 1-bit
const at1bit = await shot();
await d.page.evaluate(() => { window.__dial('pal', 4); window.__dial('ink', 0); });  // back

check('the shipped 14-step frame is a real scene, not a test card',
  at14.n >= 25, at14);
// 14 against FOUR, not against OFF. Two runs put the 14-vs-OFF delta inside
// this census's own noise floor (+42%, then +18% — what has streamed into
// the crop moves the count more than the quantiser does), which is itself
// the finding: at 320p under a full-step Bayer weave, fourteen steps read
// as bands and weave, not as a colour count. Four steps is where the count
// itself collapses, and that contrast is decisive on every run.
check('coarsening 14 → 4 steps collapses the colour count',
  at4.n < at14.n * 0.65, { at14: at14.n, at4: at4.n });
check('PALETTE 2 + INK MONO: a few grey tones carry the frame (2 steps = 3 tones + weave)',
  at3tone.greyTop4 >= 0.55, { top4: +at3tone.greyTop4.toFixed(3) });
// THE TRUE 1-BIT CLAIM: one step, two tones. Mode-mass again, tighter — a
// genuine black-and-white frame puts its weight on TWO greys, and everything
// else is the screenshot scaler blending texel edges.
check('PALETTE 1 + INK MONO: TWO tones carry the frame — true black and white',
  at1bit.greyTop2 >= 0.6 && at1bit.greyTop2 > at3tone.greyTop2 - 0.05,
  { top2: +at1bit.greyTop2.toFixed(3), threeToneTop2: +at3tone.greyTop2.toFixed(3) });
check('…and colour all but vanishes from the frame — a stray label at most',
  at1bit.coloredF < 0.03, +at1bit.coloredF.toFixed(4));
check('…while the colour frame genuinely had colour to lose',
  at14.coloredF > 0.05, +at14.coloredF.toFixed(4));

const glsl = d.errors.filter((e) => e.startsWith('GLSL'));
check('no shader took offence', glsl.length === 0, glsl);
report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
