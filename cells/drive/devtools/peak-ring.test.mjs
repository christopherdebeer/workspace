/**
 * WHAT THE SUMMIT RING COSTS, AND WHY IT NEED NOT COST IT TWICE.
 *
 *   node cells/drive/devtools/peak-ring.test.mjs
 *
 * Two claims, both about waste rather than about looks:
 *
 * 1. THE RING IS AS WIDE AS THE HORIZON, NOT AS WIDE AS THE CONSTANT. 350km
 *    is the reach of the tallest mountain on Earth. Over the Paris basin the
 *    high ground is a ridge, and d²/2R puts everything past ~70km under the
 *    curve — so the outer rings are forty tiles of Overpass spent on labels
 *    that can never draw. The reach is derived from the tallest summit the
 *    ring has actually reported, and it must MOVE when that changes.
 *
 * 2. A HOP DOES NOT RE-BUY THEM. `peaks` is local metres and has to be
 *    rebuilt at a new origin; the payload behind it is global and immutable.
 *    Throwing that away made the attract reel re-ask for a country's worth of
 *    tiles every cycle. The held count must survive the hop.
 *
 * Summits are injected, so this run needs no Overpass slot and says the same
 * thing every time.
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({
  // Étampes: real ground on the line, and genuinely flat — the nearest thing
  // over 1000m is the Massif Central, three hundred kilometres south.
  spot: 'lat=48.4344&lon=2.1611&h=0&cam=chase&wx=clear&time=NOON',
  tag: 'peakring', settle: 20000, menu: true });
const page = d.page;
let bad = 0;
const check = (n, c, saw) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : '  saw ' + JSON.stringify(saw)}`); };
const pk = () => page.evaluate(() => window.__peaks(0));

// ── 1. the reach follows the ground ──────────────────────────────
const flat = await pk();
check('flat country asks for a short ring, not the world-record one',
  flat.reachWantKm < 120, flat);
check('…and never less than a low ridge would justify', flat.reachWantKm >= 60, flat);

// A summit the size of the Massif Central's highest, and the reach must open.
await page.evaluate(() => window.__peakadd('Puy de Sancy', 45.5286, 2.8144, 1885));
const risen = await pk();
check('a real massif in the ring opens it up', risen.reachWantKm > flat.reachWantKm * 2, { flat: flat.reachWantKm, risen: risen.reachWantKm });
// …and never past the ceiling: 3 x 1885m is 5655m, whose horizon is 268km.
check('…but the horizon is the rule, not a bigger constant', risen.reachWantKm <= 350, risen);

await page.evaluate(() => window.__peakadd('Everest', 27.9881, 86.925, 8849));
const max = await pk();
check('the ceiling still caps it at the 350km constant', max.reachWantKm === 350, max);

// ── 2. the payload survives a hop ────────────────────────────────
// THE PRECONDITION IS NOT THE CLAIM. A summit tile is fetched only while the
// fine queue is idle, and a cold z8 box can cost Overpass the better part of
// a minute — so a run that saw none proves nothing about the cache either
// way, and must say SKIPPED rather than dress a vacuum up as a pass.
let before = await pk();
for (let i = 0; i < 60 && !before.held; i++) {
  await page.waitForTimeout(2000);
  before = await pk();
}
if (!before.held) {
  console.log('\nSKIPPED, NOT PASSED: no summit tile landed inside the wait —',
    'the ring never went out (fine queue still busy) or every mirror refused.', JSON.stringify(before));
  report(d.errors);
  await d.close();
  process.exit(2);
}
const heldBefore = before.held;
const hop = await page.evaluate(() => window.__hop(45.8326, 6.8652, 1000));   // Chamonix
check('the hop resolves', hop === 'ok', hop);
await page.waitForTimeout(4000);
const after = await pk();
check('the held payloads survive the hop (no re-buying a country)',
  after.held >= heldBefore, { heldBefore, after: after.held });
check('the local seats were rebuilt from scratch', after.known !== before.known || after.tiles !== before.tiles, { before, after });
check('the ceiling resets — the Alps must not licence a ring over Paris, nor the reverse',
  after.tallest !== 8849, after.tallest);

console.log('flat:', JSON.stringify(flat));
console.log('after hop:', JSON.stringify(after));
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
