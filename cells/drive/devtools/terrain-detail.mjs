/**
 * ── IS THE TERRAIN MOTTLE DETAIL OR ALIASING, AND WHERE ──
 *
 *   node devtools/terrain-detail.mjs                 (the fwidth band limit)
 *   TD=mpp node devtools/terrain-detail.mjs          (the legacy chart fade)
 *   TD=px  node devtools/terrain-detail.mjs          (paint the footprint)
 *   TD=off node devtools/terrain-detail.mjs          (no mottle: the control)
 *   AB=1   node devtools/terrain-detail.mjs          (mpp vs on, ONE BOOT)
 *
 * The question is not whether the mottle looks nice. It is whether an art
 * pixel at a given range is smaller than the mottle's shortest wavelength —
 * and if it is not, the term is drawing a moire against the palette dither
 * rather than drawing ground.
 *
 * `__tdetail()` answers that in metres along a transect, which is the reading
 * the heat map has to agree with. Both are taken, because a false-colour frame
 * with no numbers beside it is a picture of a claim, not a measurement.
 *
 * AB=1 IS ONE BOOT. Both rulers are compiled into the shader and chosen by a
 * uniform precisely so this comparison does not have to be two boots: two
 * boots of this world differ by wildlife, sward phase and streaming order
 * before they differ by the term under test, and a pixel diff across them is
 * a diff of the world. Only `tdetail=px` needs its own process, because it
 * replaces the ground colour rather than scaling it.
 */
import { openDrive } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const TD = process.env.TD ?? 'on';
// A LIVE SPOT, because no fixture in the set is bare ground. The cascade's
// loudest case is rough 1.0 — exposed rock and salt — and every captured world
// here is Cape fynbos, Paris or a Norwegian fjord. SPOT= takes a raw query
// (SPOT='lat=-20.1338&lon=-67.4891' is the Uyuni salt flat).
const SPOT = process.env.SPOT ?? '';
const FIX = process.env.FIX ?? 'at-campsbay';
// ROAD=0 leaves the truck where it spawned. __toroad puts it on a carriageway,
// and a carriageway does not wear terrainFx at all — so the first run of this
// measured a frame whose entire near field was ROAD and concluded the cascade
// did nothing. The near ground has to be ground.
const ROAD = process.env.ROAD !== '0';
const OUT = process.env.OUT ?? '/tmp/drive-tools/tdetail';
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: (SPOT ? SPOT : `fixture=${FIX}`) + `&cam=chase&time=NOON&wx=clear&nodraw=1&tdetail=${TD}`,
  tag: `tdetail-${TD}`, settle: 0, bootTimeout: 240000, dpr: 1,
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
if (ROAD) await q(() => window.__toroad?.(400));

for (const cam of ['chase', 'cab', 'top']) {
  await q((m) => window.__cam(m), cam);
  await d.page.waitForTimeout(2500);
  const t = await q(() => window.__tdetail());
  const { ahead, build, ...head } = t;
  console.log(`  [${cam}] ${JSON.stringify(head)}`);
  // The kernel's colour loop is where aTd's cost lands; printed once per camera
  // so a regression shows up beside the look it paid for.
  if (build) console.log(`    build: ${JSON.stringify(build)}`);
  console.log('    d / across / along / GEO | coarse | oct 4m/1m/0.25m:');
  console.log('      ' + ahead.map((r) =>
    `${r.d}m ${r.across}/${r.along}/${r.geo} ${r.keepPx} [${r.oct.join(' ')}]`).join('  '));
}

// The frames. `nodraw` comes off for these; the heat map is worthless without
// the world drawn under the same camera the numbers were taken from.
await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
for (const [name, cam, zoom] of [['chase', 'chase', 0], ['cab', 'cab', 0], ['top', 'top', 0.9]]) {
  await q((m) => window.__cam(m), cam);
  if (zoom) await q((z) => window.__zoom(z), zoom);
  await d.page.waitForTimeout(9000);
  if (process.env.AB === '1' && TD !== 'px') {
    // ── ONE BOOT IS NOT ENOUGH ON ITS OWN; THE WORLD IS STILL MOVING ──
    //
    // The first cut of this took three shots 1.2 s apart and read means under
    // 1/255 with a worst pixel of 126 — and the 126 was a deer. Wildlife, the
    // sward's phase and the cloud deck all advance between shots, so even
    // inside one boot a cross-setting diff carries the world's own motion.
    //
    // The pass is therefore INTERLEAVED: mpp, px, mpp, px. The two mpp frames
    // (and the two px frames) are the SAME setting at the same temporal
    // separation as the cross pairs, so their diff is the floor this
    // measurement has to clear. Without that number the cross diff is not
    // evidence of anything. `off` rides along because the question "does the
    // band limit remove too much" is really "how close is it to no mottle".
    // …AND AN AMPLITUDE LADDER, because the first pass established that the
    // ruler change does not clear the floor and the obvious next question is
    // whether the TERM does. +/-0.045 against a palette step of 0.07 is two
    // thirds of a step, so a sweep to four times it says how loud a procedural
    // surface term has to be before 14 levels and a dither can carry it —
    // which is the constraint every later one of these has to be designed to.
    // ── THE OCTAVE LADDER: WHAT EACH ONE ADDS, ON ONE SETTLED WORLD ──
    //
    // oct 0 is the world before the cascade — the 15 m mottle alone. Each step
    // switches on one finer octave, so the diff between consecutive frames is
    // exactly that octave and nothing else. The interleaved repeat (oct3 twice)
    // gives the floor at the same temporal separation: without it a cross diff
    // carries the world's own motion, and the first attempt at this read a
    // worst pixel of 126 that turned out to be a deer.
    // ROUGH= forces the material, so the loud case (bare rock and salt, 1.0)
    // can be judged from a fixture. Real bare ground reaching 1.0 is a separate
    // question and the `mat` read-back above answers it.
    const ROUGH = process.env.ROUGH ? Number(process.env.ROUGH) : null;
    const GRAIN = process.env.GRAIN ? Number(process.env.GRAIN) : null;
    if (ROUGH !== null) await q((o) => window.__tdetail(o), { rough: ROUGH, grain: GRAIN ?? 0.85 });
    // INTERLEAVED AND MATCHED. Each consecutive pair is one leg apart, so the
    // repeats (oct0 twice, oct3 twice) are the floor at the SAME separation as
    // the comparisons. The first attempt put the repeats four legs from their
    // twins and produced a floor larger than the signal, which says nothing
    // about either.
    const legs = [['oct0', 0], ['oct3', 3], ['oct0-b', 0], ['oct3-b', 3],
      ['oct1', 1], ['oct2', 2], ['off', -1]];
    for (const [tag, oct] of legs) {
      await q((o) => window.__tdetail(o), oct < 0 ? { amount: 0 } : { oct, amount: 1 });
      // Long enough for the uniform to reach a drawn frame at 3 fps, short
      // enough that the world has not walked far.
      await d.page.waitForTimeout(500);
      writeFileSync(`${OUT}/${name}-ab-${tag}.png`, await d.page.screenshot({ timeout: 240000 }));
    }
    await q(() => window.__tdetail({ rule: 'px', oct: 3, amount: 1 }));
    console.log(`  shot ${name}-ab-{${legs.map((l) => l[0]).join(',')}}`);
  } else {
    writeFileSync(`${OUT}/${name}-${TD}.png`, await d.page.screenshot({ timeout: 240000 }));
    console.log(`  shot ${name}-${TD}`);
  }
}
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
await d.close();
