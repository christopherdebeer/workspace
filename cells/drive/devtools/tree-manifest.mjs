/**
 * ── A TREE EXISTS BEFORE IT IS GEOMETRY: KNOWN AGAINST DRAWN ──
 *
 *   node cells/drive/devtools/tree-manifest.mjs
 *   FIX=at-campsbay SECS=180 node .../tree-manifest.mjs
 *
 * `treeRange` was how far a tree was DRAWN and, until the manifest, also how
 * far one EXISTED. This is the A/B for separating them: `?treemanifest=<m>`
 * equal to the draw range is the single ring this replaced.
 *
 * THREE CLAIMS, and only the first needs a browser at all:
 *
 *   1. the manifest KNOWS more trees than the renderer draws — the horizon a
 *      cheaper far representation will render into;
 *   2. nothing on screen changes — which `client/perf-check.mjs` already
 *      asserts byte-for-byte in pure node, so here it is a second witness
 *      (identical caps, placed counts and edges) rather than the proof;
 *   3. the near ring is not starved. Both walks are centre-out and the
 *      manifest pass runs LAST, so a wider manifest may only delay the far
 *      country — if `placed` differs between the legs at the same settle, that
 *      reasoning is wrong and this is where it shows.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const SECS = Number(process.env.SECS ?? 180);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

async function run(manifest) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear`
      + (manifest ? `&treemanifest=${manifest}` : ''),
    tag: `tree-manifest-${manifest || 'default'}`, settle: 0, bootTimeout: 300000,
  });
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  // THE MANIFEST SETTLES AFTER THE POPULATION, because the annulus takes the
  // seed budget's leftovers by construction. So the gate wants both: the drawn
  // triangles stop moving AND the manifest's seeded-cell count stops moving.
  let quiet = 0, pt = -1, pc = -1;
  for (let i = 0; i < SECS / 3; i++) {
    await d.page.waitForTimeout(3000);
    const e = await q(() => window.__ez());
    const t = e.tris ?? 0, c = e.manifest?.seeded ?? 0;
    quiet = (t === pt && c === pc && t > 0) ? quiet + 1 : 0;
    pt = t; pc = c;
    if (quiet >= 4) break;
  }
  const r = await q(() => window.__ez());
  const errs = d.errors.length;
  await d.close();
  return { ez: r, settled: quiet >= 4, errs };
}

const one = await run(700);
console.log(`[${el()}] single ring read`);
const two = await run(0);
console.log(`[${el()}] manifest read\n`);

const fams = Object.keys(one.ez.caps);
console.log(`── ${FIX} · ${one.settled && two.settled ? 'settled' : 'NOT SETTLED — provisional'}`
  + ` · errors ${one.errs}/${two.errs}`);
const row = (k, a, b, note = '') => console.log(
  `  ${k.padEnd(18)} ${String(a).padStart(10)} ${String(b).padStart(10)}  ${note}`);
console.log(`  ${''.padEnd(18)} ${'one ring'.padStart(10)} ${'manifest'.padStart(10)}`);
row('manifest range', `${one.ez.manifest.rangeM}m`, `${two.ez.manifest.rangeM}m`);
row('cells seeded', `${one.ez.manifest.seeded}/${one.ez.manifest.cells}`,
  `${two.ez.manifest.seeded}/${two.ez.manifest.cells}`);
for (const f of fams) {
  const k = (r) => r.ez.manifest.known[f] ?? 0;
  const p = (r) => r.ez[f]?.placed ?? 0;
  if (!k(one) && !k(two) && !p(one) && !p(two)) continue;
  row(`${f} known`, k(one), k(two), k(two) > k(one) ? `← +${k(two) - k(one)}` : '');
  row(`${f} placed`, p(one), p(two), p(one) === p(two) ? '' : '← DIFFERS: the near ring moved');
  row(`${f} edge`, one.ez.edge[f], two.ez.edge[f]);
}
const known = (r) => fams.reduce((s, f) => s + (r.ez.manifest.known[f] ?? 0), 0);
const placed = (r) => fams.reduce((s, f) => s + (r.ez[f]?.placed ?? 0), 0);
row('KNOWN total', known(one), known(two));
row('DRAWN total', placed(one), placed(two));
for (const [name, r] of [['one ring', one], ['manifest', two]]) {
  const ms = r.ez.ms?.phase ?? {};
  console.log(`\n  ${name.padEnd(9)} · known ${known(r)} of which drawn ${placed(r)}`
    + ` (${known(r) ? (placed(r) / known(r) * 100).toFixed(0) : '—'}%)`
    + ` · seed ${r.ez.ms?.seedMsNow ?? '—'}ms/refresh deferred ${r.ez.ms?.seedDeferred ?? '—'}`
    + ` · manifest pass ${ms.manifest ?? '—'}ms · refresh ${r.ez.ms?.refresh ?? '—'}ms`);
}
