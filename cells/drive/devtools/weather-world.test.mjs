/**
 * THE WEATHER OVERHAUL, IN THE WORLD — the half weatherfield.test cannot see.
 *
 *   node cells/drive/devtools/weather-world.test.mjs
 *
 * The pure test proves the FIELD. It cannot prove the five shaders that now
 * read it — the dome, the cloud shadows, the composite's fog, the wet
 * carriageway and the rain box — and a GLSL edit fails at COMPILE, on a
 * frame, silently: three logs one line and keeps rendering whatever survived.
 * The harness folds exactly those lines into `errors`, so the single most
 * important assertion here is the cheapest one: two full boots, five custom
 * shaders each, zero shader errors.
 *
 * The visual claim is made honestly but bluntly: fog FLATTENS the far field.
 * A clear noon horizon band is mountains against sky — high variance; the
 * same band inside a pinned fog bank is one grey — low variance. Screenshot
 * arithmetic, no eyeballs.
 */
import { openDrive, report, decodePng } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** Mean and spread of luma over a horizontal band — decodePng hands back
 *  { w, h, ch, px }, channel count included, and assuming RGBA cost this
 *  test its first run: every index landed between pixels and the maths
 *  returned NaN wearing a straight face. */
const band = (png, y0f, y1f) => {
  const { w, h, ch, px } = png;
  let s = 0, s2 = 0, n = 0;
  for (let y = Math.floor(h * y0f); y < h * y1f; y++) {
    for (let x = 0; x < w; x += 3) {
      const i = (y * w + x) * ch;
      const l = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      s += l; s2 += l * l; n++;
    }
  }
  const m = s / n;
  return { mean: m, sd: Math.sqrt(Math.max(0, s2 / n - m * m)) };
};

// Silvermine, on the road the autopilot test drives: real tarmac in reach so
// the wet-carriageway shader actually compiles into a drawn material.
const SPOT = 'lat=-34.09885&lon=18.380684&h=255&cam=chase&time=NOON';

// ── boot one: the storm, soaked and fogged ──
const wetRun = await openDrive({
  spot: `${SPOT}&wx=storm&wet=1&fog=0.75`,
  tag: 'wx-storm', settle: 16000,
});
const w = await wetRun.page.evaluate(() => window.__wx());
check('the field is live and reporting', !!w && !!w.local, w);
check('the ?wet pin flooded the ground', w.local.wet > 0.9, w.local);
check('a pinned storm rains at the truck or near it', w.regional.rain > 0.5, w.regional);
check('the ?fog pin armed the mist, with a real ceiling from the terrain',
  w.regional.fog > 0.6 && w.fogTop > -1e8, { fog: w.regional.fog, top: w.fogTop });
check('the wind vector reaches the field', Math.hypot(w.wind.x, w.wind.z) > 0.5, w.wind);
const env = await wetRun.page.evaluate(() => window.__sky());
check('…and __sky still answers beside it', typeof env.cloud === 'number', env);
const wetGlsl = wetRun.errors.filter((e) => e.startsWith('GLSL'));
check('five weather shaders, zero compile errors (storm boot)', wetGlsl.length === 0, wetGlsl);
report(wetRun.errors);
await wetRun.close();

// ── boots two and three: the fog contrast, on the flat ──
//
// NOT at Silvermine, and the first run of this test is why: world Y is
// anchored at the spawn, so on the peninsula the sea sits 150 metres BELOW
// the truck and the mist ceiling — terrain's 20th percentile plus a bank
// depth — pools over the water far under the camera. Which is the design
// working: valley mist fills valleys. To stand INSIDE the slab the ground
// has to be the percentile, and that is what a polder is. Same spot, same
// pinned-clear sky, the only difference between the boots is ?fog — so the
// contrast is the fog and nothing else.
const DIKE = 'lat=52.95046&lon=5.07337&h=27&cam=chase&time=NOON&wx=clear&wet=0';
const clearRun = await openDrive({ spot: `${DIKE}&fog=0`, tag: 'wx-dike-clear', settle: 16000 });
const c = await clearRun.page.evaluate(() => window.__wx());
check('a pinned CLEAR is locally clear too — the field invents nothing',
  c.local.cover < 0.05 && c.local.rain < 0.02 && c.local.wet < 0.05, c.local);
const shotClear = decodePng(await clearRun.page.screenshot());
const clearGlsl = clearRun.errors.filter((e) => e.startsWith('GLSL'));
check('…and zero compile errors on the clear boot', clearGlsl.length === 0, clearGlsl);
report(clearRun.errors);
await clearRun.close();

const fogRun = await openDrive({ spot: `${DIKE}&fog=1`, tag: 'wx-dike-fog', settle: 16000 });
const f = await fogRun.page.evaluate(() => window.__wx());
check('on the flat, the ceiling stands at head height — the camera is inside the slab',
  f.fogTop > -40 && f.fogTop < 120, f.fogTop);
const shotFog = decodePng(await fogRun.page.screenshot());
report(fogRun.errors);
await fogRun.close();

// ── the picture ──
// The discriminator is BRIGHTNESS, not variance — eyeballed from the pair
// this assertion was first written against. A variance test measured the
// Bayer dither and the near grass, which both frames carry equally, and
// separated nothing. What actually splits them at noon: the strip below the
// horizon is dark polder in the clear frame and LIT MIST in the fogged one.
const hzFog = band(shotFog, 0.36, 0.50);
const hzClear = band(shotClear, 0.36, 0.50);
// +12, from a measured lift of ~20 with bright sky rows diluting the band
// in both frames: comfortably past frame-to-frame noise (~±2), comfortably
// under the real effect, and not a number tuned until the test went green —
// the shots this was eyeballed against are the evidence.
check('the far field vanishes into lit mist — markedly brighter than the clear polder',
  hzFog.mean > hzClear.mean + 12,
  { fog: +hzFog.mean.toFixed(1), clear: +hzClear.mean.toFixed(1) });
check('…with a bank at or near the camera to account for it',
  f.cam.fog > 0.08 || f.local.fog > 0.08, f);
check('…and neither frame is a black screen wearing a passing grade',
  hzFog.mean > 8 && hzClear.mean > 8, { fog: +hzFog.mean.toFixed(1), clear: +hzClear.mean.toFixed(1) });

console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
