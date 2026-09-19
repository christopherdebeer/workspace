/**
 * IS ANYTHING BUILT AT A FORD, AND WHAT IS IT?
 *
 *   node cells/drive/devtools/ford-drift.mjs   [FIX=at-senqu-ford] [SPOT=lat,lon]
 *                                              [FORDS=0] [SHOTS=0] [SECS=]
 *
 * `ford-why.mjs` answers whether a POINT is a ford — the registry's word, the
 * layer the contact chose as support, both rules' verdicts. It cannot answer
 * whether anything was BUILT there, and for the whole life of this world the
 * answer was no: a ford's `implementation` is 'not-required', which is right
 * about a conduit and was read as "no geometry", so the crossing a driver
 * meets most often drew nothing at all. This is the other half.
 *
 * `__fords()` carries BOTH witnesses and they are not the same witness. The
 * ledger — asked, built, and each refusal named — is written by the rule under
 * test and can only ever confirm it. The scene walk beside it is independent:
 * every object in the world carrying `userData.ford`, and the triangles the
 * renderer was actually handed, so a drift that was solved and never committed
 * reads as `built 12` beside `tris 0`. This tool fails on that disagreement in
 * either direction rather than printing two numbers and leaving it.
 *
 * DRAWING IS ON BY DEFAULT, DELIBERATELY. `nodraw` never commits a frame and
 * never compiles a shader, so a run with it says nothing about whether the
 * drift is visible or its material links. The frames are the judgement; the
 * numbers are the evidence. `FORDS=0` is the exact control and must read zero
 * on both witnesses.
 *
 * `NODRAW=1` IS FOR A LIVE SPOT AND NOTHING ELSE. A drift is only built once
 * `osmStreamQuiet()` holds, and over the harness's curl relay at three frames
 * a second a busy place never gets there: the first Chapman's Peak run read
 * `asked 0` on a world still streaming at seven minutes, which is a
 * measurement of the relay and not of the rule. It says nothing about the
 * picture, and a run that uses it must say so.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? (process.env.SPOT ? '' : 'at-senqu-ford');
const SPOT = process.env.SPOT || '';
const SHOTS = process.env.SHOTS !== '0';
const SECS = +(process.env.SECS || 300);
const FORDS = process.env.FORDS ?? '1';
const WORK = process.env.DRIVE_WORK || '/tmp/drive-tools';

const NODRAW = process.env.NODRAW === '1';
const place = FIX ? `fixture=${FIX}` : `lat=${SPOT.split(',')[0]}&lon=${SPOT.split(',')[1]}`;
const d = await openDrive({
  spot: `${place}&cam=chase&tdbg=0&wxlive=0&time=NOON&wx=clear&fords=${FORDS}`
    + (NODRAW ? '&nodraw=1' : ''),
  tag: `ford-drift-${FORDS}`, settle: 0, bootTimeout: 300000,
});

// The doctrine's own settle rule for roads and water: dirty is not enough, the
// way count, the road cells and the hydro builds have to stop moving too. With
// drawing ON a frame is seconds, so the budget is wall clock rather than a poll
// count, and an unsettled world is NAMED as such with its counts beside it.
let prev = '', still = 0, settled = false;
const until = Date.now() + SECS * 1000;
while (Date.now() < until) {
  await d.page.waitForTimeout(4000);
  const s = await d.page.evaluate(() => {
    const w = window;
    const t = w.__tstats ? w.__tstats() : {};
    const h = w.__hydro ? w.__hydro() : null;
    return `${t.builds ?? 0}/${t.roadCells ?? 0}/${t.seenWays ?? 0}/${h?.buildProf?.builds ?? -1}`;
  });
  if (s === prev) { if (++still >= 4) { settled = true; break; } } else { still = 0; prev = s; }
}
console.log(`${settled ? 'settled' : 'NOT SETTLED'} at ${prev}  (terrainBuilds/roadCells/seenWays/hydroBuilds)`);
if (NODRAW) {
  console.log('NODRAW: nothing was drawn, so nothing here judges the picture');
}

const L = await d.page.evaluate(() => (window.__fords ? window.__fords() : null));
if (!L) { console.log('__fords is not on this build'); await d.close(); process.exit(1); }

console.log('\nTHE BUILDER\'S OWN LEDGER');
console.log(`  on ${L.on} · asked ${L.asked} · built ${L.built}`
  + ` · refused noSpan ${L.noSpan} noDeck ${L.noDeck} tooWide ${L.tooWide}`);
console.log(`  carriageway forded ${L.deckM} m`
  + ` · deepest standing water over an apron ${L.deepest} m`);
console.log('\nTHE SCENE, INDEPENDENTLY');
const S = L.scene;
console.log(`  meshes ${S.meshes} · triangles ${S.tris}`
  + ` · apron ${S.parts.apron} sill ${S.parts.sill} post ${S.parts.post}`);
if (S.box) {
  console.log(`  extent x ${S.box.x0.toFixed(1)}..${S.box.x1.toFixed(1)}`
    + ` · y ${S.box.y0.toFixed(2)}..${S.box.y1.toFixed(2)}`
    + ` · z ${S.box.z0.toFixed(1)}..${S.box.z1.toFixed(1)}`);
  for (const [x, y, z, g] of S.aprons) {
    console.log(`  apron [${x},${z}] at y ${y} over drawn ground ${g}`
      + ` — standing ${(y - g).toFixed(2)} m proud of it`);
  }
}
let bad = 0;
if (L.built > 0 && S.meshes === 0) {
  console.log('  FAIL the builder solved drifts that reached no mesh at all'); bad++;
}
if (L.built === 0 && S.meshes > 0) {
  console.log('  FAIL the scene carries drift geometry the builder never counted'); bad++;
}
if (L.on === false && (L.asked > 0 || S.meshes > 0)) {
  console.log('  FAIL ?fords=0 is not a control: something was still built'); bad++;
}
// A DEPTH THAT LOOKS LIKE AN ELEVATION IS A FRAME ERROR, and this tool exists
// partly because it found one: `restingLevelM` is metres above sea level while
// every other number in the crossing loop is local, so the first run of this
// read a drift under 1,789.76 m of standing water — the Drakensberg's own
// height wearing the word `depth`. Nothing anyone would ford is under eight
// metres of river, so the bound is a frame check rather than a taste.
if (L.built > 0 && L.deepest > 8) {
  console.log(`  FAIL ${L.deepest} m over an apron is not a depth —`
    + ' the water and the deck are being measured in different frames');
  bad++;
}
// AN APRON STANDING WELL CLEAR OF THE GROUND UNDER IT IS A SLAB OVER A HOLE.
// The channel is carved THROUGH a ford's footprint, and this unit deliberately
// does not move the carriageway (that is the profile's business), so where the
// deck was never dipped to the water the drift can end up a lid over a trench.
// The sills close what they can reach; past their own drop the gap is real and
// is reported rather than hidden, because it is the argument for #63.
for (const [x, y, z, g] of S.aprons) {
  if (y - g > 1.2) {
    console.log(`  GAP apron [${x},${z}] stands ${(y - g).toFixed(2)} m over its`
      + ' own drawn ground — the deck was never dipped, so the drift is a lid');
  }
}
// Three parts or it is not a drift: an apron with no sills is a slab lying on
// the bed, and one with no posts is invisible from the approach.
if (L.built > 0 && (!S.parts.apron || !S.parts.sill || !S.parts.post)) {
  console.log('  FAIL a drift was built without all three of its parts'); bad++;
}

// A frame AT a drift, which is the only thing that can judge it. The truck is
// put on the apron's own centre rather than at a coordinate typed by hand: a
// hand-aimed spot lands anywhere along a river, which is the trap the estuary
// survey already recorded.
if (SHOTS && !NODRAW && S.aprons.length) {
  const [cx, , cz] = S.aprons[0];
  console.log(`\nframing the first drift at ${cx}, ${cz}`);
  await d.page.evaluate(([x, z]) => {
    const w = window;
    if (w.__place) w.__place(x - 24, z);
    if (w.__hud) w.__hud(false);
  }, [cx, cz]);
  await d.page.waitForTimeout(9000);
  await d.page.screenshot({ path: `${WORK}/ford-drift-${FORDS}-chase.png`, timeout: 240000 });
  // The top view is framed ON the drift, not from the chase stand-off: the
  // chart camera targets the truck, so a rig parked for the chase frame puts
  // the apron at the edge of the pane — which is what the first run of this
  // photographed and read as a drift too small to judge.
  // THE RIG IS HIDDEN AND THE PAIR IS A HIDE-DIFF. A top frame targets the
  // TRUCK, so a rig parked on a drift 2.4 m across covers the thing being
  // photographed — which is what the first reframing of this produced. And a
  // still frame of a pale slab on pale ground is an opinion: the honest
  // witness is the same frame with the drift's own materials switched off, so
  // the pixels that differ ARE the drift.
  await d.page.evaluate(([x, z]) => {
    const w = window;
    if (w.__place) w.__place(x, z);
    if (w.__cam) w.__cam('top');
    if (w.__zoom) w.__zoom(0.3);
    if (w.__hide) w.__hide('rig');
  }, [cx, cz]);
  await d.page.waitForTimeout(12000);
  await d.page.screenshot({ path: `${WORK}/ford-drift-${FORDS}-top.png`, timeout: 240000 });
  await d.page.evaluate(() => {
    const w = window;
    for (const n of ['ford-apron', 'ford-sill', 'ford-post']) {
      if (w.__matShow) w.__matShow(n, false);
    }
  });
  await d.page.waitForTimeout(9000);
  await d.page.screenshot({ path: `${WORK}/ford-drift-${FORDS}-top-off.png`, timeout: 240000 });
  // AND A THIRD FRAME AT THE SAME SETTING, which is the floor the pair has to
  // be read against. The water is ANIMATED — the swell, the flow and the
  // dither re-weave every frame — so a bare hide-diff over a river reported
  // 38.5% of the pane moved for a drift 2.4 m across on a 40 m frame. A diff
  // with no same-setting control is a number with no scale; this file states
  // that for milliseconds and it is just as true of pixels.
  await d.page.waitForTimeout(9000);
  await d.page.screenshot({ path: `${WORK}/ford-drift-${FORDS}-top-off2.png`, timeout: 240000 });
  console.log(`frames in ${WORK}/ford-drift-${FORDS}-{chase,top,top-off,top-off2}.png`);
  console.log('  read the on/off diff against the off/off floor:'
    + ` node devtools/imgdiff.mjs ${WORK}/ford-drift-${FORDS}-top{,-off}.png /tmp/a.png`
    + ` and ${WORK}/ford-drift-${FORDS}-top-off{,2}.png /tmp/b.png`);
} else if (SHOTS) {
  console.log('\nno apron in the scene to frame');
}

console.log('\npageerrors:', d.errors.length, d.errors.slice(0, 6));
console.log(bad ? `\n${bad} FAILED` : '\nall good — the ledger and the scene agree');
await d.close();
process.exit(bad ? 1 : 0);
