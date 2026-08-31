/**
 * THE CARRIAGEWAY IS A BUILT SURFACE, NOT A SHEET OVER A HILLSIDE.
 *
 *   node cells/drive/devtools/deck-roll.test.mjs
 *   REV=<sha> node cells/drive/devtools/deck-roll.test.mjs      # the old way
 *
 * The deck's roll used to be the difference between the terrain sampled under
 * the two kerbs, clamped at 0.85m of half-width drop. That cap is 1.7m edge to
 * edge — about 23% across a 7.5m carriageway — and well short of it the deck
 * still rolled with every wobble in a heightfield sampled at 9.5m/px.
 *
 * Roads are not built that way. A carriageway carries a small crossfall to
 * shed water and superelevation on a bend, banked into the turn; the hillside
 * decides the cut and the fill either side, which the apron and the batter
 * already handle. The centreline still SEATS on its ground — only the roll
 * stopped being terrain's to decide.
 *
 * Read from the two kerb arrays the ribbon is built from, recorded after the
 * smoothing that finalises them — the deck plane itself, with nothing between
 * it and the vertices. An earlier cut tried to sample the drawn mesh through
 * meshSurfaceAt and measured nothing at all: that samples the TERRAIN mesh,
 * and a road's cross-width heights exist nowhere else.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const rev = process.env.REV ?? '';
// The corridor every other tool here measures, and the one confirmed to build
// road in this harness. A first cut of this used a Chapman's Peak cliff spot
// for the drama and measured nothing at all: no road within reach, __roll
// n=0, and — worse — the __decks assertion below passed VACUOUSLY on an empty
// object via Math.max(0, ...[]).
const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON',
  tag: `roll${rev ? '-old' : ''}`, rev, settle: 12000,
});

let roll = null;
for (let i = 0; i < 20; i++) {
  await d.page.waitForTimeout(2000);
  roll = await d.page.evaluate(() => window.__roll());
  if ((roll.n ?? 0) > 200) break;
}
check('road was built, so there are decks to measure', (roll?.n ?? 0) > 200, roll);
console.log(`      ${roll.n} stations | median ${roll.pc50}% p90 ${roll.pc90}%`
  + ` p99 ${roll.pc99}% worst ${roll.worstPc}%${rev ? ` (rev ${rev})` : ''}`);
if ((roll?.n ?? 0) <= 200) { report(d.errors); await d.close(); process.exit(1); }

// A designed deck: the crossfall is 2.5% and superelevation tops out at 6%, so
// nothing should be near double figures. The old rule could reach 23%.
check('THE MEDIAN DECK IS A CAMBER, not a hillside', roll.pc50 < 6, roll.pc50);
check('…and even the worst is a road that could have been built',
  roll.worstPc < 12, roll.worstPc);
check('nothing rolls past 15%', roll.over15pc === 0, roll);

// The seat is NOT what changed: the road must still sit on its ground rather
// than floating over it on a designed plane.
const decks = await d.page.evaluate(() => window.__decks(260));
const drops = Object.values(decks).map((v) => v.drop ?? 0);
check('there are decks in reach to ask about', drops.length > 0, decks);
if (drops.length) {
  check('the deck still sits on the ground it was seated to',
    Math.max(...drops) < 4, Math.max(...drops));
}

report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED` : 'all good');
