/**
 * ── DOES A FOREST COVER ITS OWN GROUND? ──
 *
 *   node cells/drive/devtools/canopy-ab.mjs
 *   FIX=at-campsbay node .../canopy-ab.mjs      (a shrubland control)
 *
 * TWO BOOTS, AND THAT IS LEGITIMATE HERE FOR THE REASON `sward-sub.mjs` gives
 * one door over: `vegstems` is read once into a const at module init, as every
 * world switch is, so there is no live A/B — and what makes the pair honest is
 * a FIXTURE (no network, no arrival order) plus a measurement that is COUNTS
 * rather than pixels. A frame diff across two boots would carry the wildlife,
 * the sward phase and the cloud deck.
 *
 * What it reports, and the second row is the one the change is about:
 *
 *   - PLANTS PER HECTARE within 300 m, by kind. The seat's complaint was that
 *     a forest is see-through, and a stem count is what that is in numbers.
 *   - SITES PER SEEDED CELL, which is the manifest's own memory bill: the
 *     whole population is held in `vegGrid` whether or not it is drawn, so a
 *     multiplier here is a multiplier on what a phone carries.
 *   - THE REFRESH'S PHASE SPLIT, because the cost of a larger population lands
 *     on `ezAdmit` — a heap selection over every candidate — and on the seed.
 *     A density this tool says is beautiful and that row says is forty
 *     milliseconds is not a density that ships.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const R = Number(process.env.R ?? 300);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function run(stems) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1&vegstems=${stems}`,
    tag: `canopy-${stems}`, settle: 0, bootTimeout: 300000, dpr: 1,
  });
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  let quiet = 0, pb = -1, pt = -1;
  for (let i = 0; i < 90; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(() => ({ t: window.__tstats(), ez: window.__ez() }));
    const tris = t.ez.tris;
    quiet = (t.t.dirty === 0 && t.t.builds === pb && tris === pt && t.t.builds > 0) ? quiet + 1 : 0;
    pb = t.t.builds; pt = tris;
    if (quiet >= 4) break;
  }
  const out = await q((r) => {
    const st = window.__stand(r);
    const ez = window.__ez();
    const vd = window.__vegdist();
    // The manifest's own bill: how many sites the world is holding, and over
    // how many cells, which is what a per-cell multiplier actually multiplies.
    let sites = 0, cells = 0;
    const g = window.__vegcells ? window.__vegcells() : null;
    return { st, ez, ms: vd.ms, seed: { now: vd.seededNow, ms: vd.seedMsNow, deferred: vd.seedDeferred },
      manifest: ez.manifest ?? null, sites, cells, g };
  }, R);
  await d.close();
  return { stems, settled: quiet >= 4, ...out };
}

const legs = [];
for (const stems of [0, 1]) {
  console.log(`[${el()}] booting ${FIX} with vegstems=${stems}`);
  legs.push(await run(stems));
}
const [a, b] = legs;
const HA = (n) => (n ?? 0).toFixed(1);
console.log(`\n── ${FIX} · within ${R} m · ${a.settled && b.settled ? 'settled' : 'NOT SETTLED — read no further'}`);
for (const [tag, leg] of [['vegstems=0 (the uniform rate)', a], ['shipped', b]]) {
  const st = leg.st ?? {};
  console.log(`\n  ${tag}`);
  console.log(`    plants ${st.n ?? '—'} · ${HA(st.perHa)} per hectare · ${st.stands ?? '—'} stands`);
  if (st.kinds) console.log(`    by kind ${JSON.stringify(st.kinds)}`);
  console.log(`    known ${leg.manifest ? JSON.stringify(leg.manifest) : '—'}`);
  console.log(`    drawn ${(leg.ez.tris / 1e6).toFixed(2)}M tris · edges ${JSON.stringify(leg.ez.edge)}`);
  console.log(`    refresh phases ${JSON.stringify(leg.ms)}`);
  console.log(`    seeding ${leg.seed.now} cells this refresh in ${(leg.seed.ms ?? 0).toFixed(1)}ms`
    + ` · ${leg.seed.deferred} deferred`);
}
