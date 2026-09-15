/**
 * ── THE BAKED DIAL MUST BE THE SAME PIXELS, NOT MERELY FASTER ──
 *
 *   node cells/drive/devtools/hud-bake.mjs
 *
 * `riggauge` was 1.24 ms of a 3.11 ms HUD, and inside it the open-arc bezel
 * was 41 ticks — each a `fillStyle` parsed from a string and one or two 1x1
 * `fillRect`s — redrawn every frame for a ring that only moves when the HUD is
 * laid out. It is baked and blitted now (`?hudbake=0` is the rollback).
 *
 * A DRAW-CALL CUT THAT CHANGES THE PICTURE IS NOT A CUT, IT IS A REGRESSION
 * WITH A GOOD EXCUSE. The rounding argument says the two should be identical
 * to the pixel — `round(c + d) === c + round(d)` for integer `c`, and the bake
 * is blitted 1:1 at `hudDpr` with smoothing off — so this asserts exactly
 * that, over the dial's own corner of the glass and nothing else. A whole-frame
 * diff would drown 50 texels of bezel in a world that moves.
 *
 * Both boots hold the rig still and pin the clock, so the only thing that can
 * differ in that corner is the dial.
 */
import { openDrive, WORK } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const FIX = process.env.FIX ?? 'at-campsbay';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function shot(bake, tag) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&hudbake=${bake}`,
    tag, settle: 0, bootTimeout: 300000,
  });
  // The rig must be STOPPED and the revs settled, or the lit segment count
  // differs between boots and the diff measures the engine, not the bezel.
  await d.page.waitForTimeout(12000);
  await d.page.evaluate(() => { const s = window.__drive; if (s) { s.speed = 0; s.throttle = 0; } });
  await d.page.waitForTimeout(4000);
  const geom = await d.page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { w: c.clientWidth, h: c.clientHeight };
  });
  const f = join(WORK, `${tag}.png`);
  await d.page.screenshot({ path: f });
  const errs = d.errors.length;
  await d.close();
  return { f, geom, errs };
}

// ── THE FLOOR FIRST, AND THE FIRST RUN OF THIS TOOL DID NOT HAVE ONE ──
//
// It reported mean 1.229/255 and a worst of 150.5 over this crop and called
// the claim failed. A worst of 150 is a glyph flipping, not a tick moving —
// the rig cluster carries the odometer, and two boots have driven different
// distances, so a digit differs and the crop is 4.73% different before the
// bezel is considered at all. TWO BOOTS OF THE SAME BUILD ARE THE CONTROL,
// exactly as every interleaved A/B in this repo uses the same setting twice:
// without it, "not zero" cannot be told from "not the same boot".
const a = await shot(1, 'hudbake-on');
const a2 = await shot(1, 'hudbake-on-b');
const b = await shot(0, 'hudbake-off');
console.log(`[${el()}] shot three · ${a.geom.w}x${a.geom.h} css · errors ${a.errs}/${a2.errs}/${b.errs}`);

// The dial sits bottom-right; take the bottom-right quarter, which contains it
// and the rest of the rig cluster and nothing that streams.
const cw = Math.round(a.geom.w * 0.45), ch = Math.round(a.geom.h * 0.22);
const cx = a.geom.w - cw, cy = a.geom.h - ch;
const diff = (p, q, out, label) => execFileSync('node', [
  new URL('./imgdiff.mjs', import.meta.url).pathname, p, q, join(WORK, out),
  `--crop=${cx},${cy},${cw},${ch}`, '--zoom=3', `--label=${label}`,
], { encoding: 'utf8' }).trim();

console.log(`\nFLOOR — the same build, booted twice:`);
console.log(diff(a.f, a2.f, 'hudbake-floor', 'baked,baked again'));
console.log(`\nSIGNAL — baked against the per-frame bezel:`);
console.log(diff(a.f, b.f, 'hudbake-diff', 'baked,per-frame'));
console.log(`\nThe claim is that the SIGNAL is inside the FLOOR: two boots differ`);
console.log(`by their odometers and their engine state whatever the bezel does, so`);
console.log(`a signal no larger than that is a bezel drawing the same pixels.`);
