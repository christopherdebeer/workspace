/**
 * THE VISUAL SURVEY — pictures, not numbers. Six captures, sixteen spots
 * chosen for what they exercise, three frames each at double resolution:
 * chase, cab (the surface and its markings up close) and a top view at zoom
 * 0.35 (planform, mouths, the batter's footprint). Each fixture settles BLIND
 * (?nodraw=1, seconds instead of minutes) and drawing goes on only for the
 * frames that are kept. About thirty minutes for everything.
 *
 *   node devtools/survey.mjs            # frames to /tmp/drive-tools/survey
 *   SURVEY_OUT=… REV=<sha> node …       # elsewhere, or from a revision
 *
 * The frames are the critique; the first survey's findings are in CLAUDE.md
 * under "The visual survey".
 */
import { openDrive } from './harness.mjs';
import { writeFileSync } from 'node:fs';
const OUT = process.env.SURVEY_OUT ?? '/tmp/drive-tools/survey';
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const REV = process.env.REV || '';
const PLAN = [
  ['at-campsbay', [
    ['cb-junction', 0, 0, null, 'service road fork at the origin — the crop mouth'],
    ['cb-cheviots', 106, 407, null, 'The Cheviots Road rounded bend — the 0.53m station'],
    ['cb-eldon', 127, 248, null, 'Eldon Lane over Shanklin Crescent — a held pin'],
    ['cb-lowerkloof', -427, 40, null, 'Lower Kloof Road — the warped end'],
    ['cb-roundhouse', 132.9, -243.8, null, 'Round House Road — steepest cross-slope street, cut and fill batter'],
    ['cb-geneva', 544, 444, null, 'Geneva Drive dual carriageway split'],
  ]],
  ['at-bixby', [
    ['bx-shelf', -506, 294.2, 294, 'Cabrillo Highway on the cliff shelf — batter, parapet'],
    ['bx-viaduct', -414.2, 397.9, 343, 'Bixby Creek Bridge deck over the canyon'],
    ['bx-origin', 0, 0, null, 'the Big Sur report spot'],
  ]],
  ['at-carmel-a', [['ca-origin', 0, 0, null, 'junction case A']]],
  ['at-carmel-b', [['cb2-origin', 0, 0, null, 'junction case B']]],
  ['at-paris-west', [
    ['pw-origin', 2.5, 21.8, null, 'Avenue des Landes at the multi-lane urban example'],
    ['pw-washington', 213.4, -142.5, null, 'Boulevard Washington — a seven-way node'],
  ]],
  ['at-paris-south', [
    ['ps-origin', 0, 0, null, 'on the A 86'],
    ['ps-portal', -75.7, 26.9, null, 'the N 118 flyover portal'],
    ['ps-under', -74, 1, null, 'under the N 118 on the A 86'],
  ]],
];
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
for (const [fix, spots] of PLAN) {
  const d = await openDrive({ spot: `fixture=${fix}&cam=chase&time=NOON&cprobe=1&nodraw=1`, tag: `survey-${fix}`, settle: 0, bootTimeout: 150000, dpr: 2, rev: REV });
  const q = async (fn, ...a) => d.page.evaluate(fn, ...a);
  const shot = (f) => d.page.screenshot({ timeout: 120000 }).then((b) => writeFileSync(f, b));
  let quiet = 0, pw = -1, pc = -1, settled = false;
  for (let i = 0; i < 240; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(() => window.__tstats());
    quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc) ? quiet + 1 : 0;
    pw = t.seenWays; pc = t.roadCells;
    if (quiet >= 5) { settled = true; console.log(`[${el()}] ${fix}: settled t+${(i + 1) * 3}s roadCells=${t.roadCells} seenWays=${t.seenWays}`); break; }
  }
  if (!settled) console.log(`[${el()}] ${fix}: NOT SETTLED after 720s — pictures are of a partial world`);
  await q(() => window.__draw(true));
  await d.page.waitForTimeout(4000);
  for (const [name, x, z, h, why] of spots) {
    console.log(`[${el()}] ${name}: ${why}`);
    await q(([x, z, h]) => { window.__place(x, z, h === null ? undefined : h * Math.PI / 180); window.__drive.speed = 0; }, [x, z, h]);
    await q(() => window.__cam('chase'));
    await d.page.waitForTimeout(4000);
    await shot(`${OUT}/${name}-chase.png`);
    await q(() => window.__cam('cab'));
    await d.page.waitForTimeout(3000);
    await shot(`${OUT}/${name}-cab.png`);
    await q(() => window.__cam('top'));
    await q(() => window.__zoom(0.35));
    await d.page.waitForTimeout(5000);
    await shot(`${OUT}/${name}-top.png`);
  }
  console.log(`[${el()}] ${fix}: errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
  await d.close();
}
console.log(`total ${el()}`);
