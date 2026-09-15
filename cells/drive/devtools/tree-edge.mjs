/**
 * ── HOW FAR OUT DOES A TREE ACTUALLY APPEAR? ──
 *
 *   node cells/drive/devtools/tree-edge.mjs
 *   FIX=at-campsbay node .../tree-edge.mjs
 *
 * Reported from the seat: trees pop into view, and they should come in further
 * out. The DRAW RANGE dial is not that distance — the ADMITTED EDGE is, and a
 * device dump reads `range 2800m` beside `edge b466/c223`.
 *
 * What set the edge was the triangle budget divided among ALL FIVE families at
 * their full caps, including the ones a place does not grow: at Yosemite the
 * guild plants no acacia and no palm, their caps were in the divisor anyway,
 * and the budget came out a third unspent while the trees that were there sat
 * pinned against a fifth of their caps. `?treedemand=0` is that old divisor and
 * this is the A/B.
 *
 * TWO BOOTS, which is sound here for the same reason the sward correlation is:
 * the quantity is a CPU field over a fixture, deterministic, and the counters
 * come out identical run to run. Drawing is on because the admission runs from
 * the frame loop, and the numbers are counts and metres rather than frame time.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const SECS = Number(process.env.SECS ?? 60);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function run(demand) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&treedemand=${demand}`,
    tag: `tree-edge-${demand}`, settle: 0, bootTimeout: 300000,
  });
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  // The population has to SETTLE: a refresh is sliced across frames and the
  // caps are re-derived every sweep, so an early read is of a half-filled ring.
  let quiet = 0, pp = -1;
  for (let i = 0; i < SECS / 3; i++) {
    await d.page.waitForTimeout(3000);
    const e = await q(() => window.__ez());
    const n = e.placed ?? e.slots ?? 0;
    quiet = (n === pp && n > 0) ? quiet + 1 : 0; pp = n;
    if (quiet >= 3) break;
  }
  const r = await q(() => ({ ez: window.__ez(), stand: window.__stand?.(400) ?? null }));
  const errs = d.errors.length;
  await d.close();
  return { ...r, settled: quiet >= 3, errs };
}

const off = await run(0);
console.log(`[${el()}] all-families divisor read`);
const on = await run(1);
console.log(`[${el()}] demand divisor read\n`);

const row = (k, a, b) => console.log(`  ${k.padEnd(14)} ${String(a).padStart(14)}   ${String(b).padStart(14)}`);
console.log(`── ${FIX} · ${off.settled && on.settled ? 'settled' : 'NOT SETTLED'} · errors ${off.errs}/${on.errs}`);
console.log(`  ${''.padEnd(14)} ${'treedemand=0'.padStart(14)}   ${'demand'.padStart(14)}`);
for (const k of ['capScale', 'placed', 'tris', 'budget']) {
  if (off.ez[k] !== undefined) row(k, off.ez[k], on.ez[k]);
}
const fams = Object.keys(off.ez.edge ?? off.ez.caps ?? {});
for (const f of fams) {
  row(`edge ${f}`, off.ez.edge?.[f] ?? '—', on.ez.edge?.[f] ?? '—');
  row(`cap ${f}`, off.ez.caps?.[f] ?? '—', on.ez.caps?.[f] ?? '—');
}
console.log(`\nThe edge is where a tree appears. A family the place does not grow`);
console.log(`should move neither column; the ones it does grow should move out.`);
console.log(JSON.stringify({ off: off.ez, on: on.ez }, null, 1).slice(0, 1400));
