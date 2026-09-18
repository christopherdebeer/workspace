/**
 * THE WATER WITNESS: what the wet classifier says around the truck, per fixture.
 *
 *   node cells/drive/devtools/wet-census.mjs [fixture ...]
 *
 * Boots each fixture CPU-only, lets the world stream, and tallies `__wetmap`
 * — the same `wetClassAt` the __wetdebug overlay paints — over the overlay's
 * own 768 m window at 129 × 129 (16,641 classifications). Two readings, at
 * 45 s and 75 s after boot, so a tally still moving is visible as such. The
 * ASCII raster of the second reading is saved beside the log.
 *
 * Classes: W drawn · D deck · U buried (level below the CARVED mesh) ·
 * E waterline band · F ford · C channel · O ocean · c cover-only ·
 * X surface says water, field says not drawn · . dry.
 *
 * This is the control table for every step toward one water boundary: the
 * counts before, the counts after, per fixture, same rig, same day. A step
 * that carves a red X is caught here; a step that buries a river is caught
 * here; a step that softens a shore shows in W and E.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const fixtures = process.argv.slice(2).length ? process.argv.slice(2)
  : ['at-senqu-ford', 'at-senqu-top', 'at-umgeni', 'at-yosemite', 'at-campsbay', 'at-simonstown', 'at-glencairn', 'at-bixby'];
const CLASSES = ['W', 'D', 'U', 'E', 'F', 'C', 'O', 'c', 'X', '.'];
mkdirSync('/tmp/drive-tools/wet-census', { recursive: true });
console.log(`fixture           t     ${CLASSES.map((c) => c.padStart(6)).join('')}   ms`);
for (const fixture of fixtures) {
  let d;
  try {
    d = await openDrive({ spot: `fixture=${fixture}&cam=chase&nodraw=1&tdbg=0&wxlive=0&time=NOON`, tag: `wet-census-${fixture}`, settle: 0, bootTimeout: 240000 });
  } catch (e) { console.log(`${fixture.padEnd(16)}  boot failed: ${String(e.message).slice(0, 80)}`); continue; }
  const q = (f, ...a) => d.page.evaluate(f, ...a);
  for (const t of [45, 75]) {
    await d.page.waitForTimeout(t === 45 ? 45000 : 30000);
    const r = await q(() => { const t0 = performance.now(); const rows = window.__wetmap(384, 129); return { rows, ms: +(performance.now() - t0).toFixed(0) }; });
    const tally = Object.fromEntries(CLASSES.map((c) => [c, 0]));
    for (const row of r.rows) for (const ch of row) if (ch in tally) tally[ch]++;
    console.log(`${fixture.padEnd(16)} ${String(t).padStart(3)}s  ${CLASSES.map((c) => String(tally[c]).padStart(6)).join('')}   ${r.ms}`);
    if (t === 75) writeFileSync(`/tmp/drive-tools/wet-census/${fixture}.txt`, r.rows.join('\n') + '\n');
  }
  if (d.errors.length) console.log(`${fixture.padEnd(16)}  errors: ${d.errors.slice(0, 2).join(' | ').slice(0, 160)}`);
  await d.close();
}
