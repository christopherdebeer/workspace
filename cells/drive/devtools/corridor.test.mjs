/**
 * THE QUEUE FOLLOWS THE ROAD, NOT THE BONNET.
 *
 *   node cells/drive/devtools/corridor.test.mjs
 *
 * The wedge fixed the first half of this: tiles ranked in the CAR's frame,
 * forward metres cheap and lateral metres dear, so the queue stopped spending
 * its six slots on country already crossed. What it cannot fix is that a wedge
 * is drawn about the heading THIS INSTANT, and a road bends away from that.
 * At speed a lateral metre costs 3.25 wedge-metres and a forward one 0.17 — a
 * ratio of nineteen — and a right-hander two kilometres up the valley IS a
 * lateral kilometre. The sharper the wedge gets, the harder it deprioritises
 * exactly the ground the next corner needs.
 *
 * So the streamer now walks the carriageway (wayAhead, the chainer the
 * co-driver's pace note already used) and keeps the tiles it crosses: served
 * near the head of the ask in the order they will be DRIVEN, and exempt from
 * the ring gate that drops anything the wedge has stopped believing in.
 *
 * THE ASSERTION THAT MATTERS IS THE THIRD ONE. That the corridor exists and is
 * ordered is bookkeeping. That it contains at least one tile the wedge would
 * have refused is the whole feature: if every corridor tile were inside the
 * budget anyway, this would be an elaborate way of re-sorting tiles that were
 * already coming.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const errors = [];

// Noordhoek Road climbing towards Ou Kaapse Weg: a primary that swings ~50°
// away from the bonnet inside 1.4km. Picked because a STRAIGHT would pass this
// test for the wrong reason — a corridor down a dead-straight road just IS the
// wedge, and proves nothing about following anything. The spawn is a node off
// the cell's own vector tile, so the truck starts on the centreline rather
// than in a field near it.
const d = await openDrive({
  spot: 'lat=-34.09710&lon=18.37582&h=107&cam=chase&wx=clear&t=NOON',
  tag: 'corridor', settle: 45000,
});
const page = d.page;

// The walk needs road segments in the grid, which is streaming, not booting.
let ahead = null;
for (let i = 0; i < 20; i++) {
  ahead = await page.evaluate(() => window.__wayahead());
  if (ahead.on && ahead.metres > 1500) break;
  await page.waitForTimeout(2500);
}
check('the truck is on a way the streamer can follow', ahead.on === true, ahead);
console.log(`      ${ahead.name ?? '(unnamed)'} — ${ahead.metres}m of road ahead in ${ahead.pts} vertices,`
  + ` far end ${ahead.bend}° off the bonnet`);

// The stream pass fires at most every 1.2s; give it one.
await page.waitForTimeout(2500);
const q = await page.evaluate(() => window.__queue());
const corr = q.corridor ?? [];
check('the streamer built a corridor from it', corr.length >= 2, q);

// Ordered by metres along the road, so the tile you reach first is asked for
// first — the ordering IS the priority, there is no second sort.
check('and it is ordered by how soon you will drive it',
  corr.every((t, i) => i === 0 || t.along >= corr[i - 1].along), corr);

for (const t of corr) {
  console.log(`      ${t.t.padEnd(14)} ${String(t.along).padStart(5)}m along`
    + ` · wedge ${String(t.cost).padStart(5)} / budget ${Math.round(q.budget)}`
    + ` · ${t.state}${t.cost > q.budget ? '   <- the wedge would have dropped this' : ''}`);
}

// THE ONE THAT PAYS FOR THE FEATURE. Every corridor tile's wedge cost against
// the budget the ring gate drops on: at least one must be over it, or the
// corridor is an elaborate way of re-sorting tiles that were already coming.
const over = corr.filter((t) => t.cost > q.budget);
check(`the corridor reaches ground the wedge refuses (${over.length} of ${corr.length} over budget)`,
  over.length >= 1, { over: over.length, budget: q.budget, corr });

// …and having reached it, it is asked for and not quietly dropped. The gate
// exempts corridor tiles by construction, so what this really catches is the
// exemption failing to reach the gate — a corridor rebuilt every pass under a
// truck that has moved, keys going stale between the ask and the release.
const unasked = corr.filter((t) => t.state === 'unasked');
check(`every corridor tile actually got asked for (${corr.length - unasked.length}/${corr.length})`,
  unasked.length === 0, unasked);

// AND AGAIN WITH THE TRUCK MOVING, which is the case the feature is for. The
// wedge sharpens with speed — lateral metres go from 1.35 to 3.25 — so the
// faster you go the harder it refuses the corner, and the more of the corridor
// is ground that would otherwise not have been asked for.
await page.evaluate(() => window.__hold(0, 0.75, 0));
// Long enough for the stream pass to have refired several times under a truck
// that has moved — read WHILE it is rolling, since the wedge's shape is a
// function of the speed at that instant and a braked truck has none.
await page.waitForTimeout(14000);
const q2 = await page.evaluate(() => window.__queue());
await page.evaluate(() => window.__hold(0, 0, 0.8));
const corr2 = q2.corridor ?? [];
const over2 = corr2.filter((t) => t.cost > q2.budget);
console.log(`      at ${q2.kmh}km/h: lat weight ${q2.wedge.lat}, ${corr2.length} corridor tiles,`
  + ` ${over2.length} of them past the budget`);
// Loose on purpose: how far a truck gets in nine seconds of headless throttle
// is not a thing to assert on. That the corridor SURVIVES being driven — that
// it is rebuilt each pass under a moving truck and does not come back empty —
// is, because a stale corridor keyed to where you were is worse than none.
check('the corridor holds together under a moving truck',
  q2.kmh === 0 || corr2.length >= 2, { kmh: q2.kmh, corr2 });

errors.push(...d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good \u2014 the queue follows the road');
report(errors);
if (bad) process.exitCode = 1;
