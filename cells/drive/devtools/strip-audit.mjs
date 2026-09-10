/**
 * THE BATTER AGAINST THE GROUND, AT A LIVE SPOT. Reported from the cab at
 * Glencairn (\`?lat=-34.15515&lon=18.43619&h=14&cam=cab\`): a batter strip
 * drawn as a dark sheet from the verge into the sky, over a hillside and a
 * sward that were fine underneath. A strip is a wedge a few metres tall; a
 * sheet is one whose toe was seated on a number that was never ground.
 * \`__stripAudit\` counts, over every strip within reach, the vertices with
 * no height tile under them, the strips standing more than 5m off the mesh,
 * and the strips spanning more than 25m vertically — and names the tallest.
 *
 *   node devtools/strip-audit.mjs
 *   SPOT='lat=…&lon=…&h=…' REV=<sha> FRAME=1 TAG=<bundle name> node …
 *
 * Live, so the roads stream through the curl relay: budget three to five
 * minutes for the three-signal gate.
 */
import { openDrive, WORK } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const OUT = process.env.AUDIT_OUT ?? join(WORK, 'strip-audit');
mkdirSync(OUT, { recursive: true });
const SPOT = process.env.SPOT ?? 'lat=-34.15515&lon=18.43619&h=14';
const REV = process.env.REV || '';
const POLLS = +(process.env.SETTLE_POLLS ?? 120);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const d = await openDrive({ spot: `${SPOT}&cam=cab&time=NOON&nodraw=1`, tag: process.env.TAG ?? `strip-audit${REV ? '-ctl' : ''}`, settle: 0, bootTimeout: 240000, dpr: 2, rev: REV });
const q = async (fn, ...a) => d.page.evaluate(fn, ...a);
let quiet = 0, pw = -1, pc = -1, pb = -1, settled = false, last = null;
for (let i = 0; i < POLLS; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && t.builds === pb && t.inFlight === 0) ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds; last = t;
  if (quiet >= 5) { settled = true; console.log(`[${el()}] settled t+${(i + 1) * 3}s roadCells=${t.roadCells} seenWays=${t.seenWays} heightTiles=${t.heightTiles} builds=${t.builds}`); break; }
}
if (!settled) console.log(`[${el()}] NOT SETTLED after ${POLLS * 3}s: ${JSON.stringify(last)}`);
const a = await q(() => window.__stripAudit(3000, 10));
console.log(`[${el()}] strips ${a.strips} verts ${a.verts}: without ground ${a.vertsWithoutGround}; in the air >5m ${a.stripsInAirOver5m}; off the mesh either way >5m ${a.stripsOffGroundOver5m}; spanning >25m ${a.stripsSpanningOver25m}; fill ${JSON.stringify(a.fill)}`);
for (const s of a.tallest) console.log(`  in air ${s.inAir}m at ${JSON.stringify(s.airAt)} tile ${s.tile} verts ${s.verts} noTile ${s.noTile} worstOff ${s.worstOff}m span ${s.span}m box ${JSON.stringify(s.box)}`);
writeFileSync(join(OUT, `audit${process.env.TAG ? `-${process.env.TAG}` : REV ? '-ctl' : ''}.json`), JSON.stringify(a, null, 1));
if (process.env.FRAME === '1') {
  await q(() => window.__draw(true));
  await d.page.waitForTimeout(6000);
  await d.page.screenshot({ timeout: 120000 }).then((b) => writeFileSync(join(OUT, `cab${process.env.TAG ? `-${process.env.TAG}` : REV ? '-ctl' : ''}.png`), b));
}
console.log(`[${el()}] errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
await d.close();
