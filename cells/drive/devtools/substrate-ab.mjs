/**
 * ── DOES THE SUBSTRATE DRAW MATERIALS, OR JUST MORE NOISE ──
 *
 *   node cells/drive/devtools/substrate-ab.mjs
 *   SPOT='lat=37.73606&lon=-119.63732' node .../substrate-ab.mjs
 *   TD=dom node .../substrate-ab.mjs        (paint the classification)
 *   FIX=at-campsbay node .../substrate-ab.mjs
 *
 * The cascade's own measurement established the constraint this unit had to be
 * designed against: a brightness term at ±0.045 is two thirds of a palette
 * step, and a frame-wide mean of a NEAR-FIELD effect is dominated by the far
 * field that did not change. So this tool does two things that one differently:
 *
 *   THE A/B IS INTERLEAVED AND LIVE. sub0, sub1, sub0-b, sub1-b — the repeats
 *   are the SAME setting at the same temporal separation as the cross pairs,
 *   so their diff is the noise floor the measurement has to clear. The
 *   substrate's strength is a uniform precisely so this can be one boot.
 *
 *   AND THE DIFF IS CROPPED TO THE NEAR FIELD. The domain band-limits away at
 *   roughly fifteen metres a pixel, so most of a chase frame's sky and horizon
 *   is by construction unchanged, and a full-frame mean divides the signal by
 *   the area that could never have moved.
 *
 * The layered model's own witness is `TD=dom`, which paints the shader's three
 * SHARES — red the bedrock still visible, green the grassy cover, blue the
 * mantle over it — because a share computed on the CPU beside the shader is the
 * drifting mirror this file keeps warning about. `__tdetail().mat` reports the
 * geomorphic field it read and the shares at the domain's own mean, which is
 * what the far field gets and is exact.
 */
import { openDrive } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const TD = process.env.TD ?? 'on';
// The seat's own Yosemite spot: exposed granite and sward, which is the case
// the brief was written about. A fixture is deterministic and none of them is
// bare ground, so FIX= is the offline fallback rather than the default.
const SPOT = process.env.SPOT ?? 'lat=37.73606&lon=-119.63732';
const FIX = process.env.FIX ?? '';
const OUT = process.env.OUT ?? '/tmp/drive-tools/substrate';
const CAMS = (process.env.CAMS ?? 'chase,top').split(',');
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: (FIX ? `fixture=${FIX}` : SPOT) + `&cam=chase&time=NOON&wx=clear&nodraw=1&tdetail=${TD}`,
  tag: `substrate-${TD}`, settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

let quiet = 0, pw = -1, pc = -1, pb = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.roadCells === pc && t.builds > 0)
    ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds;
  if (quiet >= 4) break;
}
console.log(`[${el()}] settled: ways ${pw}, roadCells ${pc}, builds ${pb}`);

// WHAT THE GROUND UNDER THE TRUCK SAYS IT IS. Both halves of the evidence —
// the attribute and the palette's own colour — plus the classification they
// imply at the domain's mean. "The substrate is not drawing" is answerable
// from this line rather than from a guess about the cover raster.
const head = await q(() => {
  const t = window.__tdetail();
  return { mode: t.mode, sub: t.sub, dom: t.dom, domGonePx: t.domGonePx, mat: t.mat, cam: t.cam };
});
console.log(`  ${JSON.stringify(head)}`);
// …and at a spread of points around the truck, because one vertex is one
// vertex and the whole claim of a 10-50 m domain is that neighbours differ.
const around = await q(() => {
  const s = window.__drive;
  return [[0, 0], [60, 0], [0, 60], [-90, 40], [40, -90], [150, 150]]
    .map(([dx, dz]) => {
      const m = window.__submat(s.x + dx, s.z + dz);
      if (!m) return `${dx},${dz}: no mesh`;
      const f = m.field, e = m.midDom;
      // The FIELD is the evidence and the shares are what the fragment
      // composites; the vertex attribute is beside them because rough is still
      // the water gate and grain is still what the cover class says.
      return `${dx},${dz}: rough ${m.rough} grain ${m.grain} veg ${m.veg}`
        + (f ? ` | ex ${f.exposure} db ${f.debris} sd ${f.soilDepth} gp ${f.grassPot} ${f.family}` : ' | no field')
        + (e ? ` -> rock ${e.rock} mantle ${e.mantle} grass ${e.grass}` : '');
    });
});
for (const line of around) console.log(`    ${line}`);

await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
for (const cam of CAMS) {
  await q((m) => window.__cam(m), cam);
  if (cam === 'top') await q(() => window.__zoom(0.6));
  await d.page.waitForTimeout(9000);
  if (TD === 'dom' || TD === 'px') {
    writeFileSync(`${OUT}/${cam}-${TD}.png`, await d.page.screenshot({ timeout: 240000 }));
    console.log(`  shot ${cam}-${TD}`);
    continue;
  }
  // Interleaved: every repeat is adjacent to its twin, so the floor is measured
  // at the separation the comparison is made at.
  const legs = [['sub0', { sub: 0 }], ['sub1', { sub: 1 }], ['sub0-b', { sub: 0 }], ['sub1-b', { sub: 1 }],
    ['dom8', { sub: 1, dom: 8 }], ['dom40', { sub: 1, dom: 40 }], ['sub2', { sub: 2, dom: 18 }]];
  for (const [tag, o] of legs) {
    await q((v) => window.__tdetail(v), o);
    await d.page.waitForTimeout(500);
    writeFileSync(`${OUT}/${cam}-${tag}.png`, await d.page.screenshot({ timeout: 240000 }));
  }
  await q(() => window.__tdetail({ sub: 1, dom: 18 }));
  // THE CROP IS THE NEAR FIELD, in the frame's own coordinates: the lower half
  // and the middle three quarters, which on a chase frame is ground and on a
  // top frame is ground everywhere. A full-frame mean of a near-field term is
  // the term divided by the sky.
  const box = await q(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const crop = `--crop=${Math.round(box.w * 0.12)},${Math.round(box.h * 0.5)},`
    + `${Math.round(box.w * 0.76)},${Math.round(box.h * 0.46)}`;
  const pairs = [['sub0', 'sub0-b', 'floor-off'], ['sub1', 'sub1-b', 'floor-on'],
    ['sub0', 'sub1', 'SIGNAL'], ['sub1', 'dom8', 'dom 18 vs 8'],
    ['sub1', 'dom40', 'dom 18 vs 40'], ['sub1', 'sub2', 'amount 1 vs 2']];
  for (const [a, b, label] of pairs) {
    const out = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
      `${OUT}/${cam}-${a}.png`, `${OUT}/${cam}-${b}.png`, `${OUT}/${cam}-d-${a}-${b}.png`,
      crop, '--gain=8'], { encoding: 'utf8' });
    const m = out.match(/mean luma delta[^\n]*/);
    console.log(`  [${cam}] ${label.padEnd(14)} ${m ? m[0].trim() : out.trim().split('\n').pop()}`);
  }
}
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(`  harness errors: ${d.errors.length}${d.errors.length ? ' ' + JSON.stringify(d.errors.slice(0, 4)) : ''}`);
await d.close();
