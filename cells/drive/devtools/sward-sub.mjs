/**
 * ── IS THE SWARD READING THE SUBSTRATE'S FIELD? ──
 *
 *   node cells/drive/devtools/sward-sub.mjs
 *   FIX=at-senqu-top node .../sward-sub.mjs
 *
 * TWO BOOTS, AND THAT IS LEGITIMATE HERE ONLY BECAUSE THE MEASUREMENT IS NOT
 * PIXELS. `swardsub` is read once into a const at module init — as every world
 * switch is, and for the reason the switch table's own note gives — so there is
 * no live A/B. What makes two boots honest is a FIXTURE (no network, no arrival
 * order) and a CPU field: `__swardsub()` walks the sward's own density texels,
 * which are deterministic, where a frame diff across two boots would carry the
 * wildlife, the sward phase and the cloud deck.
 *
 * The headline is the CORRELATION between the sward's density and the
 * substrate's grass factor, and it is POSITIVE — a high factor means the
 * substrate allows grass. The control is not zero: the two fields already
 * shared one input, the cover class, which GRASS_M2 and TD_MAT both key off.
 * What the shared DOMAIN is worth is the gap between the two numbers.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-campsbay';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function run(on) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1&swardsub=${on ? 1 : 0}`,
    tag: `swardsub-${on ? 1 : 0}`, settle: 0, bootTimeout: 300000, dpr: 1,
  });
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  let quiet = 0, pb = -1, pw = -1;
  for (let i = 0; i < 80; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(() => window.__tstats());
    quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.builds > 0) ? quiet + 1 : 0;
    pb = t.builds; pw = t.seenWays;
    if (quiet >= 4) break;
  }
  // Force the field rather than waiting out a trigger that has no reason to
  // fire on a parked truck — the probe's own note.
  await q(() => window.__sward(undefined, true));
  const r = await q(() => window.__swardsub());
  const errs = d.errors.length;
  await d.close();
  return { ...r, errs, builds: pb };
}

const off = await run(false);
console.log(`[${el()}] swardsub=0  ${JSON.stringify(off)}`);
const on = await run(true);
console.log(`[${el()}] swardsub=1  ${JSON.stringify(on)}`);
console.log(`\n  correlation  ${off.correlation}  ->  ${on.correlation}`);
console.log(`  mean density ${off.meanDensity}  ->  ${on.meanDensity}`
  + `  (${(((on.meanDensity / off.meanDensity) - 1) * 100).toFixed(1)}%)`);
console.log(`  the substrate calls ${(on.thinnedShare * 100).toFixed(1)}% of the field mineral enough to thin`);
console.log(`  page/harness errors: ${off.errs} / ${on.errs}`);
