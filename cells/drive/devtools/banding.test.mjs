/**
 * A GRADIENT MUST NOT COME OUT AS TWO FLAT TONES.
 *
 *   node cells/drive/devtools/banding.test.mjs
 *
 * This world is quantised to fourteen palette levels on purpose — flat bands
 * of colour are the art, not a defect. What is a defect is a SHALLOW ramp
 * landing on exactly one level boundary, because that is not a band of colour,
 * it is a hillside cut in half with a moving edge.
 *
 * Reported three times as a two-tone mountain, "one deep and one insipid",
 * wavering as the camera moved. It survived a palette fix and a lighting fix
 * because it was never in the scene pass: __scenegrab of the hillside is one
 * clean tone, and the split is manufactured downstream by rounding the aerial
 * haze. Across a slope from 500m to 5km the haze moves the colour by about a
 * third of one level — so the ramp crosses ONE boundary, which is precisely
 * two tones. An ordered dither is what turns that into a weave, and it only
 * reproduces the input's mean if its threshold sweeps a FULL step; the
 * composite was running it at 0.6.
 *
 * SO THE MEASUREMENT IS RUN LENGTH, NOT COLOUR. "How much does the far half
 * differ from the near half" is the wrong question — the honest answer to it
 * is "a little, and it should". The question that separates a dithered ramp
 * from a rounded one is HOW FAR YOU CAN WALK ACROSS THE PICTURE WITHOUT THE
 * COLOUR CHANGING AT ALL. A dithered ramp breaks every few texels. A rounded
 * one runs the width of the frame.
 *
 * Vegetation is hidden for the reading: scrub is genuinely high-frequency and
 * would break every run on its own, hiding exactly the fault being looked for.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/**
 * The longest unbroken run of one exact colour along each row of a band of the
 * finished CANVAS, as a median over rows.
 *
 * The canvas, not the render target: everything that makes this fault — the
 * haze, the grade, the quantiser and its dither — lands after the scene pass,
 * and __scenegrab is blind to all of it. Decoded inside the page rather than
 * in node, which has no PNG reader and does not need one.
 */
async function runLength(page, y0, y1) {
  const shot = (await page.screenshot({ clip: { x: 0, y: y0, width: 390, height: y1 - y0 } })).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((go, no) => { img.onload = go; img.onerror = no; img.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const runs = [];
    for (let y = 0; y < c.height; y++) {
      let n = 1, best = 1;
      for (let px = 1; px < c.width; px++) {
        const a = (y * c.width + px) * 4, p = a - 4;
        n = (d[a] === d[p] && d[a + 1] === d[p + 1] && d[a + 2] === d[p + 2]) ? n + 1 : 1;
        if (n > best) best = n;
      }
      runs.push(best);
    }
    runs.sort((a, b) => a - b);
    return { rows: runs.length, median: runs[runs.length >> 1], width: c.width };
  }, shot);
}

const errors = [];
for (const [name, spot, bands] of [
  // Senqu from the cab, facing the escarpment the fault was reported from.
  // Two bands: the hillside itself, and the sky above it, which rounded the
  // same way and for the same reason.
  ['senqu', 'lat=-30.69248&lon=27.76397&h=6&cam=cab&wx=clear&t=MORNING',
    [['hillside', 300, 520, 34], ['sky', 100, 260, 90]]],
  // Uyuni: flat, empty and the same every run — the OTHER side of the trade.
  // A dither strong enough to break a ramp must not turn a salt flat into a
  // checkerboard, and a checkerboard is a SHORT run, so this spot is checked
  // from below: the ground is allowed to stay largely flat.
  ['uyuni', 'lat=-20.1338&lon=-67.4891&h=90&cam=cab&wx=clear&t=MORNING',
    [['salt', 400, 540, null]]],
]) {
  const d = await openDrive({ spot, tag: `band-${name}`, settle: 45000 });
  await d.page.evaluate(() => window.__hide('veg'));
  await d.page.waitForTimeout(2500);
  for (const [what, y0, y1, cap] of bands) {
    const r = await runLength(d.page, y0, y1);
    if (cap === null) {
      // The floor case: flat ground must still read as flat. Anything above a
      // few texels of unbroken colour is fine; a hard checkerboard would put
      // this at 1 or 2.
      check(`${name}: ${what} stays flat under a full-amplitude dither (run ${r.median}px)`,
        r.median >= 6, r);
    } else {
      check(`${name}: ${what} is dithered, not rounded (longest flat run ${r.median}px of ${r.width})`,
        r.median < cap, { ...r, cap });
    }
  }
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — ramps weave, flats stay flat');
report(errors);
if (bad) process.exitCode = 1;
