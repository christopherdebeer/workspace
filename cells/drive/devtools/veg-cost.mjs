/**
 * WHERE refreshVeg's MILLISECONDS GO.
 *
 *   node cells/drive/devtools/veg-cost.mjs [range] [pop]
 *
 * The device put `treeRefresh` at 9% of session CPU, mean 93 ms a call, at the
 * rack's `range 2800m · pop 2x`. `vegMs` is one number for a function that
 * walks a ring of cells twice, sorts every tree by distance and composes a
 * matrix per plant, and one number cannot say which of those to cut.
 *
 * Run on a FIXTURE, so the world is identical every time and no tile arrival
 * can move the numbers, and at the rack's own upper stops as well as the
 * shipped defaults — the reported 93 ms was a stressed session, and a cut
 * measured only at the default is a cut measured where it does not matter.
 */
import { openDrive } from './harness.mjs';

const RANGE = process.argv[2] ?? '2800';
const POP = process.argv[3] ?? '2';

async function run(range, pop, vegseed = '1') {
  const d = await openDrive({
    spot: `fixture=at-campsbay&cam=chase&time=NOON&nodraw=1&treerange=${range}&treepop=${pop}&vegseed=${vegseed}`,
    tag: `vegcost-${range}-${pop}-${vegseed}`, settle: 0, bootTimeout: 120000,
  });
  // ── SAMPLED FROM BOOT, NOT AFTER SETTLING ──
  //
  // Seeding is a FIRST-VISIT cost: `seedCell` runs once per 220m cell, from
  // inside `refreshVeg`, and a settled world seeds nothing at all. Waiting for
  // quiet and then measuring reports the steady state and misses the entire
  // thing the device was complaining about. So every distinct refresh is
  // sampled from the first frame, and the report gives the median (the steady
  // state) beside the WORST (the arrival), which are different animals.
  const runs = await d.page.evaluate(() => new Promise((r) => {
    const out = [];
    let f = 0, lastTotal = -1, lastSeed = -1;
    const w = () => {
      const v = window.__vegdist();
      const changed = v.ms.refresh !== lastTotal || v.ms.seededNow !== lastSeed;
      if (changed && v.ms.phase && Object.keys(v.ms.phase).length) {
        lastTotal = v.ms.refresh; lastSeed = v.ms.seededNow;
        out.push({ total: v.ms.refresh, seedCells: v.ms.seededNow, seedMs: v.ms.seedMsNow,
          deferred: v.ms.seedDeferred, ...v.ms.phase });
      }
      if (out.length >= 60 || ++f > 1500) return r(out);
      requestAnimationFrame(w);
    };
    requestAnimationFrame(w);
  }));
  const ez = await d.page.evaluate(() => window.__ez());
  const st = await d.page.evaluate(() => window.__stand(3000));
  const errs = d.errors.slice();
  await d.close();
  return { runs, ez, st, errs };
}

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
for (const [range, pop, vs] of [[RANGE, POP, '1'], [RANGE, POP, '0']]) {
  const { runs, ez, st, errs } = await run(range, pop, vs);
  const keys = [...new Set(runs.flatMap((r) => Object.keys(r)))]
    .filter((k) => !['total', 'seedCells', 'seedMs', 'deferred'].includes(k));
  console.log(`\n${'='.repeat(64)}\nrange ${range}m · pop ${pop}x · seeding budget ${vs === '1' ? 'ON' : 'OFF (?vegseed=0)'} — ${st.trees} skeletons, `
    + `${Object.values(ez).filter((v) => v && typeof v === 'object' && 'placed' in v)
      .reduce((n, v) => n + v.placed, 0)} placed · ${runs.length} refreshes sampled`);
  console.log(`${'='.repeat(64)}`);
  const worst = runs.reduce((a2, b2) => (b2.total > a2.total ? b2 : a2), runs[0] ?? { total: 0 });
  console.log(`  total    ${med(runs.map((r) => r.total)).toFixed(1)} ms median · ${worst.total.toFixed(1)} ms worst`);
  const bySeed = runs.reduce((a2, b2) => ((b2.seedMs ?? 0) > (a2.seedMs ?? 0) ? b2 : a2), runs[0] ?? {});
  console.log(`  seeding  worst ${(bySeed.seedMs ?? 0).toFixed(1)} ms over ${bySeed.seedCells} cells`
    + ` (${bySeed.deferred ?? 0} deferred) · ${runs.reduce((n, r) => n + (r.seedCells ?? 0), 0)} cells seeded in all`);
  for (const k of keys) {
    const v = med(runs.map((r) => r[k] ?? 0));
    const share = v / Math.max(0.001, med(runs.map((r) => r.total))) * 100;
    console.log(`  ${k.padEnd(9)}${v.toFixed(1).padStart(6)} ms  ${share.toFixed(0).padStart(3)}%  ${'#'.repeat(Math.round(share / 3))}`);
  }
  if (errs.length) console.log(`  PAGE ERRORS ${JSON.stringify(errs.slice(0, 2))}`);
}
