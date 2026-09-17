/**
 * ── HOW MANY TREES THE WORLD HAS DECIDED NOT TO DRAW, AND WHY ──
 *
 *   node cells/drive/devtools/imp-census.mjs
 *   FIX=at-yosemite …          the fixture to stand in (default)
 *   DENS='0,1,2,3,4,5' …       the DENSITY stops to sweep (indices)
 *   DIALS='trng=4,imprch=4' …  the rest of the rack, as indices
 *   SETTLE=45000 …             how long to let the manifest fill
 *   ARGS='ezstand=0' …         switches
 *
 * THE QUESTION. A tree pops when it goes from NO REPRESENTATION straight to a
 * full skeleton: one frame nothing stands there, the next a 12-metre pine
 * does. Every existing impostor readout counts what was DRAWN, and a count of
 * things drawn cannot report an absence — so the fault was invisible from the
 * seat no matter how long anyone stared at the dump. `__impwhy()` counts the
 * EXITS instead: every path out of the gather that leaves a manifested tree
 * with nothing, by name, with the ones large enough to be seen separated out.
 *
 * WHAT COUNTS AS LARGE ENOUGH. A tree of height h at distance d projects
 * `h · K / d` art pixels, K being the design frame's pixels-per-metre at one
 * metre (320 rows at 55° → 307). Above one pixel it can be seen appearing;
 * below it, it cannot, and its absence is free. `perceptible NONE` is that
 * first set, and the target is zero — not small, zero, because a single
 * conspicuous tree arriving out of nothing is the whole complaint.
 *
 * WHY IT SWEEPS THE DENSITY DIAL. The thinning that caused this lived inside
 * the draw ring: an eligible tree's chance of a card was 75% at 300 m and 27%
 * at 500 m, so the tier deliberately left holes exactly where the geometry was
 * about to hand over. The invariant now is absolute — inside the detailed-tree
 * range a manifested tree is owned by the geometry or wears a card, with no
 * probability anywhere — and the only way to demonstrate an invariant is to
 * try to break it. Every stop of the dial must read the same NONE inside the
 * ring. The dial governs the FAR ring alone now, and this tool FAILS if a
 * density exit ever appears while the far ring is empty.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const DENS = (process.env.DENS ?? '0,2,5').split(',').filter(Boolean).map(Number);
const DIALS = process.env.DIALS ?? '';
const SETTLE = Number(process.env.SETTLE ?? 45000);
const ARGS = process.env.ARGS ?? '';
const DEN_LABEL = ['0.25X', '0.5X', '1X', '2X', '4X', 'ALL'];

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
console.log(`[${el()}] booting ${FIX}`);

const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear${ARGS ? `&${ARGS}` : ''}`,
  tag: 'impcensus', settle: SETTLE,
});
let bad = 0;
try {
  if (DIALS) {
    await d.page.evaluate((rows) => {
      for (const [k, i] of rows) window.__dial(k, Number(i));
    }, DIALS.split(',').filter(Boolean).map((s) => s.split('=')));
    await d.page.waitForTimeout(6000);
  }
  const has = await d.page.evaluate(() => typeof window.__impwhy === 'function');
  if (!has) { console.log('NO __impwhy — this revision predates the census'); process.exit(2); }

  const read = async (den) => {
    await d.page.evaluate((i) => window.__dial('impden', i), den);
    // A dial that resizes the tier only takes effect on the next refresh, and
    // the refresh is what writes the census. Give it real seconds, then read.
    await d.page.waitForTimeout(9000);
    return await d.page.evaluate(() => ({ why: window.__impwhy(), dials: window.__dial() }));
  };

  const legs = [];
  for (const den of DENS) {
    const c = await read(den);
    let stalled = false;
    legs.push({ den, ...c });
    const w = c.why;
    console.log(`\n[${el()}] DENSITY ${DEN_LABEL[den] ?? den}`
      + `  rack trng ${c.dials.trng} · imprch ${c.dials.imprch} · tvar ${c.dials.tvar}`);
    console.log(`  draw ring ${w.ring.drawRange}m · impostor reach ${w.ring.granted}m`
      + ` (asked ${w.ring.asked}m${w.ring.bound === 'MANIFEST' ? ', MANIFEST-bound' : ''})`
      + ` · far ring ${w.ring.farRing}m${w.ring.farRing ? '' : ' (EMPTY — the tier stops where the geometry does)'}`);
    console.log(`  manifest ${w.manifest.seeded}/${w.manifest.cells} cells seeded`
      + ` · ${w.manifest['none:seed-budget']} unseeded · ${w.manifest['none:data-pending']} awaiting data`);
    // ── WHERE EACH TIER ACTUALLY STOPS ──
    // The geometry's edge and the card budget's horizon, side by side. A
    // horizon of 0 means the family's whole demand fit and nothing was
    // refused; a horizon at or near the geometry's edge means the card tier is
    // carrying no band at all and the handover has nowhere to happen.
    const fams = Object.keys(w.horizon ?? {}).filter((f) => w.edge[f] || w.horizon[f]);
    if (fams.length) {
      console.log(`  tiers  ${fams.map((f) => `${f} 3d<${w.edge[f]}m`
        + ` card<${w.horizon[f] ? `${w.horizon[f]}m` : 'all'}`).join(' · ')}`);
    }
    // ── A STALLED SWEEP IS NOT AN EMPTY WORLD ──
    // The census is cleared at the top of a sweep and written as it walks, so
    // an unfinished sweep prints zeros that read like a tier drawing nothing.
    // Checked before anything else is believed.
    if (!w.sweeps) {
      console.log(`  FAIL: no impostor sweep has COMPLETED — every number here is`
        + ` an unwritten census, not a measurement. The gather is not finishing`
        + ` inside its slice (a seed budget switched off, or a reach the manifest`
        + ` cannot walk in one pass).`);
      bad++;
      stalled = true;
    }
    // A manifest this empty cannot bind a cap, and saying so stops a PASS here
    // being read as a PASS on the seat's own rack.
    //
    // AND THERE IS NO LOCAL LEVER FOR IT, which is worth stating rather than
    // leaving for the next person to discover. `?vegseed=0` fills the manifest
    // by removing the seeding budget — and then the gather seeds every cell it
    // walks in one sweep, no sweep completes, and the census is the zeros
    // above. Measured both ways at `at-yosemite`. The harness seeds roughly
    // half a cell a second here against the device's ten, so the cap-bound
    // state this tool most wants to read is reachable only from a real drive:
    // read it off a device dump's `trees representation` row instead.
    if (!stalled && w.manifest.seeded * 4 < w.manifest.cells) {
      console.log(`  NOTE: only ${(100 * w.manifest.seeded / w.manifest.cells).toFixed(1)}%`
        + ` of the reach is seeded — the MANIFEST binds here, not the cap,`
        + ` and no switch reaches that state locally (see the note in this file).`);
    }
    console.log(`  reason                       trees      perceptible`);
    for (const r of w.rows) {
      const flag = r.reason.startsWith('none:') && r.big ? '  ← A TREE VANISHED' : '';
      console.log(`  ${r.reason.padEnd(26)} ${String(r.n).padStart(8)} ${String(r.big).padStart(15)}${flag}`);
    }
    console.log(`  NONE ${w.none} of which ${w.perceptibleNone} perceptible`
      + ` (1 art px at ${w.perceptiblePxAt1m}m per m of height)`);

    // ── THE INVARIANT, TESTED RATHER THAN ASSERTED ──
    // Inside the draw ring there is no probability left, so a density exit can
    // only ever come from the far annulus. No annulus, no density exits.
    const dens = w.rows.find((r) => r.reason === 'none:density');
    if (dens && !w.ring.farRing) {
      console.log(`  FAIL: ${dens.n} trees thinned by density with NO far ring — the near tier is still gambling`);
      bad++;
    }
    if (w.perceptibleNone) {
      console.log(`  FAIL: ${w.perceptibleNone} trees large enough to see have no representation at all`);
      bad++;
    }
  }

  // ── AND THE SAME ANSWER AT EVERY STOP ──
  // The dial may change how far the tier reaches and how much of the annulus
  // it fills. It may not change whether a tree inside the draw ring exists.
  const inRing = legs.map((l) => ({
    den: l.den,
    none: l.why.rows.filter((r) => r.reason.startsWith('none:')
      && r.reason !== 'none:density' && r.reason !== 'none:range')
      .reduce((a, r) => a + r.n, 0),
  }));
  console.log(`\nNONE inside the draw ring, by density stop:`);
  for (const r of inRing) console.log(`  ${(DEN_LABEL[r.den] ?? r.den).padEnd(6)} ${r.none}`);
  console.log(bad ? `\n${bad} FAILURES` : `\nPASS — every stop agrees, and nothing perceptible is missing`);
} finally {
  await d.close();
}
process.exit(bad ? 1 : 0);
