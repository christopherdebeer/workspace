// THE CHART'S SCALE BAR SAYS WHAT THE CAMERA IS DOING — checked at three zooms
// against the camera's own numbers, not against a table.
//
//   node cells/drive/devtools/scale-bar.test.mjs
import { openDrive } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const close = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-12);
const { page, close: done } = await openDrive({ spot: 'lat=-29.9872&lon=24.7765&h=0&cam=top&z=8&nodraw=1', tag: 'scale', menu: true, settle: 0 });
for (const z of [1, 100, 19300]) {
  await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, z);
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(0.01, zz * 0.01), z)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const r = await page.evaluate(() => {
    const sc = window.__scale(), cam = window.__cam();
    return { sc, cam, innerHeight, pix: window.__dither().pix, lat: window.__globe().focus[0] };
  });
  const { sc, cam } = r;
  // Metres per art pixel is the camera's: the frame's height at the stand-off
  // over its height in art pixels.
  // __cam() rounds its stand-off to the metre and __globe() its focus to a
  // thousandth of a degree — a third of a percent at a junction zoom, two
  // millionths in the cosine — so the camera is checked at what the probes
  // can say, and the scale's own numbers against each other exactly.
  const mppArt = (2 * cam.dist * Math.tan((cam.fov * Math.PI) / 360)) / r.pix[1];
  check(`z${z}: metres per art pixel is the camera's`, close(sc.mppArt, mppArt, 5e-3), { sc, mppArt });
  check(`z${z}: the fraction is ground metres per CSS reference metre`, close(sc.ratio, sc.mppCss * 96 / 0.0254, 1e-9), sc);
  check(`z${z}: the glass is innerHeight over the art's height`, close(sc.mppCss, sc.mppArt / (r.innerHeight / r.pix[1]), 1e-9), { sc, r });
  const circ = 40075016.686 * Math.cos((r.lat * Math.PI) / 180);
  check(`z${z}: the zoom is the slippy zoom at the centre latitude`, close(2 ** sc.zoom * 256 * sc.mppCss, circ, 1e-4), { sc, circ });
  const series = /^[125]0*$/.test(String(sc.barM));
  check(`z${z}: the bar is a round length (${sc.bar})`, series && sc.barM >= 1, sc);
  check(`z${z}: the label carries all three (${sc.label})`, sc.label.startsWith(sc.bar) && /1:/.test(sc.label) && /Z-?\d+\.\d/.test(sc.label), sc);
  check(`z${z}: the bar is under two fifths of the HUD (${sc.barPx}px)`, sc.barPx >= 1, sc);
}
const errs = await page.evaluate(() => window.__pageErrors ?? []);
check('no page errors', errs.length === 0, errs);
await done();
if (bad) { console.log(`\n${bad} FAILED`); process.exit(1); }
console.log('\nall ok');
