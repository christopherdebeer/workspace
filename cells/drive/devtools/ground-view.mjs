/**
 * ── A GROUND VIEW IS A CHANNEL, SO IT HAS TO WORK IN EVERY CAMERA ──
 *
 *   node cells/drive/devtools/ground-view.mjs
 *   FIX=at-campsbay node .../ground-view.mjs
 *   SPOT='lat=37.73606&lon=-119.63732' node .../ground-view.mjs
 *
 * The thematic layers were a decal on the far shell, drawn in the top camera
 * past 15 m a pixel. The claim of this unit is that they are a uniform on the
 * terrain material now, so the same chip paints the same ground from the seat,
 * from the cab and from the chart, on the fine ring AND the shell.
 *
 * That is three assertions and none of them is a screenshot:
 *
 *   - the chip sets the CHANNEL and not a sheet (`view`, `sheets` 0);
 *   - the legend is tallied off the attribute the FRAGMENT reads, so it names
 *     classes that are actually under the camera;
 *   - and the frame MOVES in chase, which is the camera the old mechanism
 *     could not reach at all. A diff against the same camera with the view off
 *     is the measurement; the picture is the illustration.
 */
import { openDrive } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const SPOT = process.env.SPOT ?? 'lat=37.73606&lon=-119.63732';
const FIX = process.env.FIX ?? '';
const OUT = process.env.OUT ?? '/tmp/drive-tools/gview';
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: (FIX ? `fixture=${FIX}` : SPOT) + '&cam=chase&time=NOON&wx=clear&nodraw=1',
  tag: 'gview', settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

let quiet = 0, pb = -1, pw = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.builds > 0) ? quiet + 1 : 0;
  pb = t.builds; pw = t.seenWays;
  if (quiet >= 4) break;
}
console.log(`[${el()}] settled: builds ${pb}, ways ${pw}`);

await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
const box = await q(() => ({ w: window.innerWidth, h: window.innerHeight }));
const crop = `--crop=${Math.round(box.w * 0.12)},${Math.round(box.h * 0.5)},`
  + `${Math.round(box.w * 0.76)},${Math.round(box.h * 0.46)}`;

for (const cam of ['chase', 'top']) {
  await q((m) => window.__cam(m), cam);
  if (cam === 'top') await q(() => window.__zoom(0.6));
  await d.page.waitForTimeout(9000);
  // OFF first, and again at the end, so the floor is measured at the same
  // separation as every comparison — the rule every A/B in this repo follows.
  const shots = [];
  for (const [tag, id, on] of [['off', 'cover', false], ['cover', 'cover', true],
    ['off-b', 'cover', false], ['substrate', 'substrate', true], ['eco', 'eco', true],
    ['end', 'eco', false]]) {
    const st = await q((a) => {
      const r = window.__chartlayers(a.id, a.on);
      return { view: r.view, viewLayer: r.viewLayer, theme: r.theme, sheets: r.sheets,
        tallied: r.tallied, legend: r.legend.map((x) => x.name) };
    }, { id, on });
    // The tally runs on the stream pass; give it one before reading the legend.
    await d.page.waitForTimeout(2500);
    const st2 = await q(() => {
      const r = window.__chartlayers();
      return { view: r.view, theme: r.theme, sheets: r.sheets, tallied: r.tallied,
        legend: r.legend.map((x) => x.name) };
    });
    writeFileSync(`${OUT}/${cam}-${tag}.png`, await d.page.screenshot({ timeout: 240000 }));
    shots.push(tag);
    console.log(`  [${cam}] ${tag.padEnd(10)} view=${String(st2.view).padEnd(9)}`
      + ` sheet=${String(st2.theme)} sheets=${st2.sheets} tallied=${st2.tallied}`
      + ` legend=[${st2.legend.join(' ')}]`);
    void st;
  }
  for (const [a, b, label] of [['off', 'off-b', 'floor'], ['off', 'cover', 'COVER'],
    ['off', 'substrate', 'SUBSTRATE']]) {
    const out = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
      `${OUT}/${cam}-${a}.png`, `${OUT}/${cam}-${b}.png`, `${OUT}/${cam}-d-${label}.png`,
      crop, '--gain=4'], { encoding: 'utf8' });
    const m = out.match(/mean luma delta[^\n]*/);
    console.log(`  [${cam}] ${label.padEnd(10)} ${m ? m[0].trim() : out.trim().split('\n').pop()}`);
  }
}
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(`  harness errors: ${d.errors.length}${d.errors.length ? ' ' + JSON.stringify(d.errors.slice(0, 4)) : ''}`);
await d.close();
