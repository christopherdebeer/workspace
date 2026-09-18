/**
 * ── WHERE DID THE TREE TRIANGLE BUDGET GO? ──
 *
 *   node cells/drive/devtools/tree-spend.mjs
 *   FIX=at-campsbay SECS=180 node .../tree-spend.mjs
 *
 * The budget A/B (`tree-edge.mjs`) fixed the DIVISION and left conifer and snag
 * still cut at Yosemite — while the frame drew HALF the triangles the allocator
 * believed it had spent. Two candidates, wanting different fixes: the admitted
 * trees are not all PLACED, or a tree costs less than the family it belongs to.
 *
 * So this puts the estimate and the realisation on one line. `cap` is what the
 * allocator allowed, `placed` what actually stood, `mean` the family's atlas
 * mean, `est` what the allocator charged and `real` the bill the GPU was handed
 * — the per-variant index counts off `__ezgeo`, which is the only honest source
 * for what a silhouette costs.
 *
 * `?treeprice=0` is the A/B: it charges the atlas mean again. TWO BOOTS, sound
 * here for the same reason `tree-edge`'s are — the quantity is a CPU allocation
 * over a fixture and the counters come out identical run to run.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const SECS = Number(process.env.SECS ?? 180);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function run(price) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&treeprice=${price}`,
    tag: `tree-spend-${price}`, settle: 0, bootTimeout: 300000,
  });
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  // THE POPULATION SETTLES, NOT THE FRAME COUNT — and the price converges one
  // refresh BEHIND the caps, so a read taken on the sweep that first learns the
  // price is of caps set by the mean. The drawn triangle count moves with every
  // admission and stops when both have settled.
  let quiet = 0, pp = -1;
  for (let i = 0; i < SECS / 3; i++) {
    await d.page.waitForTimeout(3000);
    const n = (await q(() => window.__ez())).tris ?? 0;
    quiet = (n === pp && n > 0) ? quiet + 1 : 0; pp = n;
    if (quiet >= 4) break;
  }
  const r = await q(() => ({ ez: window.__ez(), geo: window.__ezgeo() }));
  const errs = d.errors.length;
  await d.close();
  return { ...r, settled: quiet >= 4, errs };
}

const rows = { 0: await run(0) };
console.log(`[${el()}] atlas mean read`);
rows[1] = await run(1);
console.log(`[${el()}] as-drawn read\n`);

const triOf = (r, fam, i) => {
  const g = r.geo.find((x) => x.fam === fam && x.i === i);
  return g ? g.idx / 3 : 0;
};
const realOf = (r, f) => (r.ez[f]?.perVariant ?? []).reduce((s, n, i) => s + n * triOf(r, f, i), 0);

console.log(`── ${FIX} · ${rows[0].settled && rows[1].settled ? 'settled' : 'NOT SETTLED — provisional'}`
  + ` · errors ${rows[0].errs}/${rows[1].errs}`);
console.log(`  ${'family'.padEnd(10)} ${'price'.padStart(6)} ${'cap'.padStart(6)} ${'placed'.padStart(7)}`
  + ` ${'edge'.padStart(5)}   ${'price'.padStart(6)} ${'cap'.padStart(6)} ${'placed'.padStart(7)} ${'edge'.padStart(5)}`
  + `   ${'drawn/tree'.padStart(10)}`);
console.log(`  ${''.padEnd(10)} ${'── atlas mean ──'.padStart(27)}   ${'── as drawn ──'.padStart(27)}`);
for (const f of Object.keys(rows[0].ez.caps)) {
  const cell = (r) => `${String(r.ez.price?.[f] ?? '—').padStart(6)} ${String(r.ez.caps[f]).padStart(6)}`
    + ` ${String(r.ez[f]?.placed ?? 0).padStart(7)} ${String(r.ez.edge?.[f] ?? '—').padStart(5)}`;
  const placed = rows[1].ez[f]?.placed ?? 0;
  console.log(`  ${f.padEnd(10)} ${cell(rows[0])}   ${cell(rows[1])}   `
    + `${String(placed ? Math.round(realOf(rows[1], f) / placed) : 0).padStart(10)}`);
}
for (const k of [0, 1]) {
  const r = rows[k];
  let est = 0;
  for (const f of Object.keys(r.ez.caps)) est += r.ez.caps[f] * (r.ez.price?.[f] ?? r.ez.meanTris[f]);
  const real = Object.keys(r.ez.caps).reduce((s, f) => s + realOf(r, f), 0);
  console.log(`\n  ${k ? 'as drawn  ' : 'atlas mean'} · budget ${r.ez.budget} · charged ${Math.round(est)}`
    + ` · drawn ${real} (${(real / est * 100).toFixed(0)}% of what it was charged)`);
}
console.log(`\n  An edge equal to the draw range means the family was NOT CAPPED — including`);
console.log(`  a family with no candidates at all, so read the cap beside it before believing it.`);
