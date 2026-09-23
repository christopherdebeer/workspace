/**
 * THE FILMIC PIPELINE ON THE GPU, not only its CPU reference.
 *
 *   node cells/drive/devtools/filmic-render.test.mjs
 *
 * Boots one fixed Alpine frame, reads the live uniforms at dawn and noon, and
 * lets the harness collect shader compiler errors. The HUD assertion is the
 * layer boundary the design depends on: scene colour ends on the WebGL canvas;
 * the fixed HUD canvas is composited afterwards and cannot be graded with it.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const d = await openDrive({
  spot: 'lat=46.534&lon=8.348&h=0&cam=chase&t=DAWN&wx=clear&wet=0&fog=0',
  tag: 'filmic-render',
  settle: 8000,
});

const dawn = await d.page.evaluate(() => window.__filmic());
check('dawn selects the lifted cool toe and warm-highlight decision',
  dawn.toe > 0.04 && dawn.saturation > 1.12
    && dawn.lift[2] > dawn.lift[0] && dawn.gain[0] > dawn.gain[2],
  dawn);
check('depth haze carries the slate/cyan target',
  same(dawn.depthTint, [0.85, 0.92, 1.05]) && dawn.depthSaturation === 0.85,
  dawn);
check('the optical vignette is the authored twelve percent',
  dawn.vignette === 0.12,
  dawn.vignette);
check('HUD is composited after the graded WebGL scene',
  dawn.hudPostGrade === true,
  dawn.hudPostGrade);

await d.page.evaluate(() => window.__timeset('NOON'));
await d.page.waitForTimeout(2400);
const noon = await d.page.evaluate(() => window.__filmic());
check('noon lands on the midday CDL exactly',
  same(noon.lift, [0.96, 0.96, 0.98])
    && same(noon.gamma, [0.97, 1.01, 0.99])
    && same(noon.gain, [1.02, 1.02, 1])
    && noon.saturation === 1.08 && noon.toe === 0.012,
  noon);

const glsl = d.errors.filter((error) => error.startsWith('GLSL'));
check('both compositor shaders compile on the GPU', glsl.length === 0, glsl);
report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
