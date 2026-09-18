/**
 * THE BANK FAULT, AS A DISTRIBUTION, PER FIXTURE.
 *
 *   node cells/drive/devtools/bank-census.mjs [fixture ...]
 *
 * The wet census counts how many points disagree; this reports how far the
 * ground stands over its own water where they do (`__bankfringe`), which is
 * the quantity a bank profile removes and the only one that can show a
 * half-fix. A step that halves the metres while leaving the count alone is
 * progress the count cannot see; a step that moves the count by burying the
 * evidence somewhere else shows here as metres that did not fall.
 *
 * `over` is metres of TRIANGLE above the drawn resting level at fringe-buried
 * points. `reach` is how far inside the wet mask those points lie: a fringe
 * reaching much past one field texel is not a fringe, and the number says so.
 *
 * Read the counts against wet-census's own U / I / P for the same fixture —
 * they are the same classifier, so they must agree.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const fixtures = process.argv.slice(2).length ? process.argv.slice(2)
  : ['at-senqu-ford', 'at-senqu-top', 'at-umgeni', 'at-bixby', 'at-glencairn', 'at-campsbay'];
mkdirSync('/tmp/drive-tools/bank-census', { recursive: true });
const rows = [];
console.log('fixture           drawn  fringe interior  prot   over med/p90/max        reach med/p90   ms');
for (const fixture of fixtures) {
  let d;
  try {
    d = await openDrive({ spot: `fixture=${fixture}&cam=chase&nodraw=1&tdbg=0&wxlive=0&time=NOON`, tag: `bank-census-${fixture}`, settle: 0, bootTimeout: 240000 });
  } catch (e) { console.log(`${fixture.padEnd(16)}  boot failed: ${String(e.message).slice(0, 80)}`); continue; }
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  await d.page.waitForTimeout(75000);
  const t0 = Date.now();
  const r = await q(() => window.__bankfringe(384, 129));
  const ms = Date.now() - t0;
  rows.push({ fixture, ...r, errors: d.errors });
  const o = r.over, re = r.reach;
  console.log(
    fixture.padEnd(16),
    String(r.drawn).padStart(6), String(r.buried.fringe).padStart(7),
    String(r.buried.interior).padStart(8), String(r.buried.protected).padStart(5),
    `   ${String(o.med).padStart(5)}/${String(o.p90).padStart(5)}/${String(o.max).padStart(5)}`,
    `      ${String(re.med).padStart(5)}/${String(re.p90).padStart(5)}`,
    String(ms).padStart(5));
  if (d.errors.length) console.log(`  page errors: ${JSON.stringify(d.errors).slice(0, 160)}`);
  await d.close();
}
writeFileSync('/tmp/drive-tools/bank-census/rows.json', JSON.stringify(rows, null, 1));
