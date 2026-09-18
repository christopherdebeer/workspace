/**
 * ── THE TARGET, THE CEILING AND WHAT IS ACTUALLY DELIVERED, ON ONE CURVE ──
 *
 *   node cells/drive/devtools/sward-profile.mjs
 *   REV=<sha> …           a pinned control
 *   ARGS='swardcap=0&swardsites=14' …   the rule as it shipped
 *
 * ONE BOOT AND NO PIXELS. The quantity is a radial density profile computed
 * from the LIVE uniforms — the dials, the band table, the blend windows — so it
 * is deterministic, needs no fixture to settle and cannot be moved by the
 * wildlife or the weather. `nodraw` is safe for exactly that reason.
 *
 * WHAT IT IS FOR. A partition of unity can be arithmetically perfect and the
 * field can still ship as three rings, because the bands' weights are
 * continuous and their CAPACITY is not: a lattice of step s holds one tuft per
 * cell, so a band handed a keep above one delivers its ceiling and reports
 * nothing. `__sward()` had every input to see that — it reported each band's
 * ceiling and each band's window — and could not, because it never put the
 * ceiling and the requested density at the same RANGE. This does.
 *
 * READ `worst`: the lowest delivered/target ratio INSIDE the outer fade, where
 * a shortfall is a fault rather than the field deliberately ending.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-campsbay';
const ARGS = process.env.ARGS ?? '';
const REV = process.env.REV ?? '';
// The GRASS dial lives in localStorage, so a harness only ever sees its
// default. GRASS= asks the probe what this build would do at another stop —
// which is how the top stop, where the device dump found the fault, is
// measurable at all from here.
const GRASS = process.env.GRASS ? Number(process.env.GRASS) : undefined;

const d = await openDrive({
  spot: `fixture=${FIX}&nodraw=1&time=NOON&wx=clear${ARGS ? `&${ARGS}` : ''}`,
  tag: 'swardprofile', ...(REV ? { rev: REV } : {}),
});
try {
  // THE PROFILE NEEDS NO SETTLED WORLD. It is arithmetic over the band table
  // and the live uniforms, and the only thing that has to have happened is one
  // swardFrame — which is what writes uDens from the dials. Waiting on that
  // rather than on a clock keeps this a one-second tool.
  await d.page.waitForFunction(
    () => window.__swardprofile && window.__sward().bands[0].dens > 0,
    null, { timeout: 60000, polling: 100 });
  if (GRASS !== undefined) await d.page.evaluate((g) => { window.__GRASS_AT = g; }, GRASS);
  const p = await d.page.evaluate(() => {
    const w = window;
    return w.__swardprofile ? w.__swardprofile(2, 1, window.__GRASS_AT) : null;
  });
  if (!p) { console.log('NO __swardprofile — this revision predates the instrument'); process.exit(2); }
  console.log(`\nsites ${p.sites} · request ${p.dens}/m² · clamp ${p.clamp ? 'ON' : 'OFF'}`
    + ` · fall ${p.fall} from ${p.near} m`);
  console.log(`GRASS dial ${p.grassScale}x on the point COUNT · tuft x${p.tuft} lateral`
    + ` · fullness cap x${p.fullMax}`);
  console.log(`bands  ${p.bands.map((b) => `${b.step}m ceil ${b.ceiling}/m² reach ${b.reach} slots ${b.slots}`).join('\n       ')}`);
  console.log(`slots total ${p.bands.reduce((a, b) => a + b.slots, 0)}`);
  console.log(`fade from ${p.fadeFrom} m · gReach ${p.gReach} · field half ${p.fieldHalf}`);
  console.log(`margin past the outermost reach ${p.margin} m · rebuild at ${p.rebuildAt}`
    + ` · abandon at ${p.abandonAt}`
    + `  ${p.margin > p.rebuildAt ? 'ok' : 'SHORT — the drawn edge leaves the committed field'}`);
  console.log('\n   d   want    target  cap     delivered  of target  tuft  coverage  of want');
  for (const r of p.rows) {
    if (r.d % 8 && r.d > 8) continue;
    console.log(`${String(r.d).padStart(4)}  ${r.want.toFixed(4).padStart(7)}`
      + `  ${r.target.toFixed(4).padStart(7)}  ${r.cap.toFixed(3).padStart(7)}`
      + `  ${r.deliv.toFixed(4).padStart(9)}  ${(r.ratio * 100).toFixed(0).padStart(7)}%`
      + `  x${r.full.toFixed(2)}  ${r.cover.toFixed(4).padStart(8)}`
      + `  ${(r.coverRatio * 100).toFixed(0).padStart(5)}%`);
  }
  console.log(`\nWORST count  inside the fade: ${(p.worst.ratio * 100).toFixed(0)}% at ${p.worst.d} m`);
  console.log(`WORST COVER  inside the fade: ${(p.coverWorst.ratio * 100).toFixed(0)}% at ${p.coverWorst.d} m`
    + `   (widest tuft x${p.fullMaxSeen})`);
  console.log(`radii short of their own target: ${p.saturated} of ${p.rows.length}`);
  console.log(`page errors: ${d.errors.length}` + (d.errors.length ? ` ${JSON.stringify(d.errors.slice(0, 3))}` : ''));
  // A shortfall inside the fade IS the ring. Ten per cent is the bar: below
  // that the eye is looking at the dither, and above it the density steps.
  // COVERAGE is the bar, not the count: where a carrier is full the tufts widen
  // and the ground is still covered, which is what the eye is judging. A count
  // short of its target with coverage intact is the design working.
  const thin = p.margin <= p.rebuildAt;
  const bad = p.coverWorst.ratio < 0.9 || thin;
  if (thin) console.log('\nFAIL — the sward is drawn further out than the evidence field is guaranteed to reach');
  console.log(bad ? '\nFAIL — coverage steps: the law is asking for more than the carriers and the tufts together can give'
    : '\nok — coverage follows the law at every radius inside the fade');
  process.exitCode = bad ? 1 : 0;
} finally { await d.close(); }
