/**
 * ── IS A BAKED TICK RING THE SAME PIXELS AS A PER-FRAME ONE? ──
 *
 *   node cells/drive/devtools/hud-bake.test.mjs
 *
 * The frame diff said no — signal 1.19/255 against a same-build floor of 0.41,
 * three times over — and a frame diff cannot say WHY, because two boots differ
 * by their odometers whatever the bezel does. This tests the RULE instead, in
 * one page, with no world: draw the ring both ways into two canvases and
 * compare every pixel.
 *
 * THE HYPOTHESIS IT IS BUILT TO SEPARATE. The geometry argument is sound —
 * `round(c + d) === c + round(d)` for integer `c` — so if the pixels differ it
 * is the COMPOSITING: a tick at alpha 0.16 drawn straight onto the HUD is one
 * blend, and the same tick baked into an 8-bit offscreen buffer and then
 * blitted is two, each rounding. Source-over is associative in the reals and
 * is not in a byte. So the ring is compared over a TRANSPARENT ground (where
 * the bake blends against nothing and the two should agree) and over an
 * OPAQUE one (where the bake blends twice). If transparent agrees and opaque
 * does not, the fault is double-quantised alpha and the fix is to bake only
 * what nothing shows through.
 */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const DR = 26, DPR = 2;
// The same executable the harness picks: the default channel here wants a
// `headless_shell` build that is not installed, and this test needs a canvas
// rather than WebGL, so any Chromium will do as long as it is the one present.
const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
});
const page = await browser.newPage();

const r = await page.evaluate(({ DR, DPR }) => {
  const A0 = (150 / 180) * Math.PI, SWEEP = (240 / 180) * Math.PI;
  const o = DR + 2, W = 2 * o;
  const mk = (ground) => {
    const c = document.createElement('canvas');
    c.width = W * DPR; c.height = W * DPR;
    const x = c.getContext('2d');
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.imageSmoothingEnabled = false;
    if (ground) { x.fillStyle = ground; x.fillRect(0, 0, W, W); }
    return [c, x];
  };
  const ticks = (x, ox, oy) => {
    for (let i = 0; i <= 40; i++) {
      const a = A0 + (i / 40) * SWEEP;
      const major = i % 5 === 0;
      x.fillStyle = major ? 'rgba(114,189,178,0.45)' : 'rgba(114,189,178,0.16)';
      for (let rr = DR; rr <= DR + (major ? 1 : 0); rr++) {
        x.fillRect(Math.round(ox + Math.cos(a) * rr), Math.round(oy + Math.sin(a) * rr), 1, 1);
      }
    }
  };
  const run = (ground) => {
    // A: straight onto the ground, as the HUD did it.
    const [ca, xa] = mk(ground); ticks(xa, o, o);
    // B: baked over nothing, then blitted onto the same ground.
    const [cb, xb] = mk(ground);
    const [bk, xk] = mk(null); ticks(xk, o, o);
    xb.drawImage(bk, 0, 0, W, W);
    const da = xa.getImageData(0, 0, ca.width, ca.height).data;
    const db = xb.getImageData(0, 0, cb.width, cb.height).data;
    let diff = 0, worst = 0, lit = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (da[i + 3] || db[i + 3]) lit++;
      for (let k = 0; k < 4; k++) {
        const d = Math.abs(da[i + k] - db[i + k]);
        if (d) { diff++; if (d > worst) worst = d; }
      }
    }
    return { diff, worst, lit, px: da.length / 4 };
  };
  return { transparent: run(null), opaque: run('rgb(8,20,23)') };
}, { DR, DPR });

await browser.close();

// ── THE BAR, AND WHY IT IS NOT "ZERO EVERYWHERE" ──
//
// Over nothing the two must be EXACT: there is no second blend, so a single
// differing channel would mean the geometry is wrong and the rounding
// argument with it. Over a ground they cannot be exact and it is not a defect:
// an 8-bit buffer cannot hold `0.16 over transparent` losslessly, so the blit
// re-blends a rounded colour. What that may not do is move a channel by more
// than the one unit rounding can account for, or move many of them — either
// would mean something other than the last bit is different.
const MAX_STEP = 1;                 // one unit: what a single rounding can cost
const MAX_CHANNELS = 200;           // of 50,176 here — a rounding fringe, not a shift
let ok = true;
const say = (name, v, exact) => {
  const bad = exact ? v.diff > 0 : (v.worst > MAX_STEP || v.diff > MAX_CHANNELS);
  ok = ok && !bad;
  console.log(`  ${name.padEnd(12)} channels differing ${String(v.diff).padStart(6)}`
    + ` · worst ${String(v.worst).padStart(3)}/255 · over ${v.lit} lit of ${v.px} px`
    + `   ${bad ? 'FAIL' : v.diff === 0 ? 'IDENTICAL' : 'within one rounding'}`);
};
console.log('the ring drawn straight, against the ring baked and blitted:');
say('transparent', r.transparent, true);
say('opaque', r.opaque, false);
console.log();
if (r.transparent.diff === 0 && r.opaque.diff > 0) {
  console.log('The geometry is exact — `round(c + d) === c + round(d)` holds, so the bake');
  console.log('lands on the same pixels. What differs over a ground is DOUBLE-QUANTISED');
  console.log('ALPHA: a 0.16 tick blended once onto the HUD, against the same tick');
  console.log('blended into an 8-bit buffer and blended again. Source-over is');
  console.log(`associative in the reals and not in a byte — here ${r.opaque.diff} channels of`);
  console.log(`${r.opaque.px * 4}, none by more than ${r.opaque.worst}/255, against a palette step of ~18.`);
}
console.log(ok ? '\nok' : '\nFAILED');
process.exit(ok ? 0 : 1);
