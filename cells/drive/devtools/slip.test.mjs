/**
 * EROSION AS PAINT.
 *
 *   node cells/drive/devtools/slip.test.mjs
 *
 * Getting the ground out from under the tarmac took the ragged look with it,
 * and the ragged look was the half worth keeping: "I do quite like the
 * 'erosion' feel but the swimming is just wrong." The swimming came from two
 * nearly coplanar surfaces trading places. The LOOK came from the crossing
 * curve between them being irregular. Only the first needed geometry, so the
 * second is repainted: where the ground meets the tarmac, the hillside's own
 * colour is dithered onto the deck, densest at the kerb and swept clean down
 * the crown.
 *
 * WHAT THIS ASSERTS, AND WHY EACH ONE IS HERE:
 *
 * (1) IT COMPILES. This is not boilerplate — it is the finding. The first
 *     version named a local `patch`, which is a RESERVED WORD in GLSL ES 3.00,
 *     and the whole carriageway program failed to link. No road was drawn
 *     anywhere in the world. Four separate probes reported the feature present
 *     and correct: the attribute was on the geometry, the material was on the
 *     mesh, the mesh was visible, the injected source contained the code. It
 *     took forcing the effect to solid red and seeing NO RED to find it,
 *     because three logs shader failures to the CONSOLE and throws nothing.
 *     The harness now watches for that on every test in the suite; this one
 *     asserts it explicitly because this is where it was learned.
 *
 * (2) IT IS KEYED TO THE GROUND, NOT THE SCREEN. An ordered dither on
 *     gl_FragCoord is the obvious way to break an edge on a 14-level palette,
 *     and it would crawl across the tarmac as the camera moved — which is the
 *     exact complaint this feature exists to answer. Asserted on the compiled
 *     fragment source: it must read the world position and must not read the
 *     fragment coordinate. Structural rather than photometric, and stated as
 *     such.
 *
 * (3) IT IS WHERE THE GROUND IS — AND THE RIGHT QUANTITY IS STRENGTH, NOT
 *     COVERAGE. This first asserted that dead-flat ground "very nearly does
 *     not" carry a slip, and Death Valley failed it at 95% of deck vertices.
 *     That assertion was the wrong shape rather than the feature being wrong:
 *     the roads there are TRACKS on ground that meets the tarmac along its
 *     whole length, so a faint dusting everywhere is exactly the claim being
 *     made — dirt where the ground reaches the road. What separates a dusting
 *     from a slide is the MASS term, the face standing above the kerb with
 *     something to come down, and that is where the two places part company:
 *     flat ground tops out at 0.34 with nothing above 0.4, the cutting reaches
 *     0.56 with a whole band up there. So the tail is what is asserted.
 *
 * (4) IT ACTUALLY PAINTS PIXELS — AGAINST A NOISE FLOOR. Two loads of the same
 *     spot are not identical: animals wander through frame, and a camel across
 *     the Wadi Rum road moved 4.8% of a road crop all by itself, which is more
 *     than the effect does. So the control is a slip=0 against a second slip=0,
 *     and the effect has to beat its own noise by a clear margin rather than
 *     merely be non-zero. The wildlife is also asked to stand down first
 *     (__hide('critters')), because a floor that moves between runs is not a
 *     floor — it went 0.11% one run and 1.85% the next, which is within a
 *     factor of two of the signal.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const CUT = 'lat=29.57427&lon=35.41870&h=204';   // Wadi Rum: road cut into hill
const FLAT = 'lat=36.4600&lon=-116.8700&h=180';  // Death Valley: dead flat

const errors = [];
const shoot = async (spot, k, tag) => {
  const d = await openDrive({
    spot: `${spot}&cam=cab&wx=clear&t=NOON&slip=${k}`, tag, settle: 45000 });
  // Stand the wildlife down before anything is photographed — see __hide.
  await d.page.evaluate(() => window.__hide('critters'));
  await d.page.waitForTimeout(1500);
  const coat = await d.page.evaluate(() => window.__slipcoat());
  const src = await d.page.evaluate(() => window.__slipsrc());
  const png = join(WORK, `${tag}.png`);
  await d.page.screenshot({ path: png });
  errors.push(...d.errors);
  await d.close();
  return { coat, src, png, errs: d.errors };
};

/** Fraction of a crop that moved, via the tool that already decodes PNGs. */
const moved = (a, b, crop) => {
  const r = spawnSync('node', [join(import.meta.dirname, 'imgdiff.mjs'), a, b,
    join(WORK, 'slip-diff.png'), `--crop=${crop}`, '--gain=5'], { encoding: 'utf8' });
  const m = (r.stdout ?? '').match(/pixels moved >3: ([\d.]+)%/);
  return m ? Number(m[1]) : NaN;
};

const on = await shoot(CUT, 1, 'slip-cut-on');
const off = await shoot(CUT, 0, 'slip-cut-off');
const off2 = await shoot(CUT, 0, 'slip-cut-off2');
const flat = await shoot(FLAT, 1, 'slip-flat');

// (1) THE ONE THAT WAS ACTUALLY WRONG.
check('the carriageway shader compiles and links',
  on.errs.filter((e) => e.startsWith('GLSL:')).length === 0,
  on.errs.filter((e) => e.startsWith('GLSL:')));

// (2) WORLD-ANCHORED, asserted on the source three compiled.
check('the slip reads the world position, not the fragment coordinate',
  on.src.injectedWorld === true && on.src.injectedScreen === false, on.src);
check('…and the compiled program bound it', on.src.compiled.ran === true
  && on.src.compiled.fColor === true && on.src.compiled.fLen > 500, on.src.compiled);

// (3) WHERE THE GROUND IS.
console.log(`      cutting  ${on.coat.painted}/${on.coat.verts} deck verts carry it`
  + ` (${(on.coat.frac * 100).toFixed(1)}%), max ${on.coat.max}`);
console.log(`      flat     ${flat.coat.painted}/${flat.coat.verts}`
  + ` (${(flat.coat.frac * 100).toFixed(1)}%), max ${flat.coat.max}`);
// Vertices in the top of the range — the ones the mass term lifted there.
const heavy = (c) => c.hist.slice(4).reduce((a, b) => a + b, 0);
console.log(`      heavy (>0.4): cutting ${heavy(on.coat)}, flat ${heavy(flat.coat)}`);
check('a road cut into a hillside carries a slip', on.coat.frac > 0.25, on.coat);
check('…and it carries SLIDES, not just dust', heavy(on.coat) > 50, on.coat.hist);
check('dead-flat ground gets the dust and none of the slides',
  heavy(flat.coat) === 0 && flat.coat.max < on.coat.max * 0.75,
  { flatMax: flat.coat.max, cutMax: on.coat.max, flatHeavy: heavy(flat.coat) });
check('?slip=0 turns it off completely',
  off.coat.painted === 0 && off.coat.max === 0, off.coat);
check('every built ribbon has the attribute', on.coat.noAttr === 0, on.coat);

// (4) IT PAINTS — AGAINST ITS OWN NOISE FLOOR.
const CROP = '0,400,390,190';   // the near carriageway, out of the HUD
const signal = moved(off.png, on.png, CROP);
const floor = moved(off.png, off2.png, CROP);
console.log(`      slip0 vs slip1 moved ${signal}% of the road crop;`
  + ` slip0 vs slip0 (the drifting-wildlife floor) moved ${floor}%`);
check(`the paint beats the noise floor (${signal}% against ${floor}%)`,
  Number.isFinite(signal) && Number.isFinite(floor) && signal > Math.max(1, floor * 3),
  { signal, floor });

console.log(bad ? `\n${bad} FAILED` : '\nall good — the erosion is back, and it holds still');
report(errors);
if (bad) process.exitCode = 1;
