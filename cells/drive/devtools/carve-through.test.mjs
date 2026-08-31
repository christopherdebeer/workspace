/**
 * THE GROUND MUST NOT STAND THROUGH THE TARMAC.
 *
 *   node cells/drive/devtools/carve-through.test.mjs
 *
 * Reported from the seat as z-fighting in the cab — "swimming overlays where
 * road and terrain are near the camera". The near plane was shipped as the
 * lever (?near=) on the arithmetic that depth resolution goes as d²·ε/near,
 * and the reporter tried 0.4 and 1.0 and saw no difference. They were right,
 * and the theory was wrong at its first step: THE DEPTH BUFFER IS 24-BIT, read
 * off the framebuffer rather than assumed. One LSB at 20m is 0.2mm against a
 * designed budget of 80mm. Four hundred to one. There is no depth fight to fix
 * at any near plane, and this test asserts that too, so the theory cannot come
 * back.
 *
 * WHAT IS ACTUALLY THERE IS GEOMETRY. On the Wadi Rum road the ground stood
 * THROUGH the tarmac by 8-25cm from 2 to 12 metres in front of the cab — and
 * every corner of every offending triangle sat exactly on its dig limit. The
 * carve was not undershooting; it was caged, by CUT_WASH.
 *
 * AND THE CAGE WAS A DELIBERATE, MEASURED TRADE THAT DOES NOT SURVIVE SLOPE.
 * The wash lets the cut floor climb away from the kerb so a road is not a flat
 * 21m shelf, and it was tuned at Noordhoek with the cost written into the
 * source and accepted: "terrain through the tarmac 13.5%, p95 0.09m — pokes
 * that are centimetres, which do not read at all". That holds on gentle ground
 * and fails on steep, for a reason that is arithmetic rather than bad luck: the
 * wash's cap on a corner is its LEVER ARM times 0.1, the lever arm is set by
 * the mesh cell (~21m, fixed) and not by the terrain, while the drop a corner
 * needs is set by the RELIEF. Flat country needs no drop and never feels the
 * cap. A road cut into a hillside needs a metre and is denied 0.9 of it.
 *
 * So the wash became a preference: normal passes respect it, and where they
 * leave a deck buried by more than a poke that READS (RELIEF_MIN, the wash's
 * own criterion written as a number) a relief pass re-runs without it, billing
 * the corner under the carriageway first.
 *
 * THE TEST IS THE A/B, at three places chosen for what they disagree about —
 * a desert hill road, a flat suburb, and a corniche — with ?relief=0 standing
 * in for the old behaviour. Both halves have to hold: the burial goes to zero,
 * AND the verge does not turn back into the excavated bench the wash exists to
 * prevent, which is the failure mode of every previous attempt at this.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const SPOTS = [
  // The seat the report came from: a road cut into rising ground.
  { name: 'wadi rum', spot: 'lat=29.57427&lon=35.41870&h=204', verge: true },
  // Where the wash was tuned. Its burial here is centimetres, so this is the
  // place relief must NOT go to work — the regression half of the test.
  { name: 'noordhoek', spot: 'lat=-34.09710&lon=18.37582&h=107', verge: true },
  // A ledge cut in a cliff. The verge metric compares the carved mesh against
  // a 30m DEM cell, and here that cell is an average of the cliff FACE — so it
  // reads tens of metres of "excavation" that is really landform. The burial
  // count needs no raster and is the number to read here.
  { name: 'chapmans peak', spot: 'lat=-34.07977&lon=18.35767&h=200', verge: false },
];

const errors = [];
/** Settle, then wait until the probe is actually standing on a road — a
 *  zero-sample reading is not a clean bill, and it used to look like one. */
const measure = async (spot, relief) => {
  const d = await openDrive({
    spot: `${spot}&cam=cab&wx=clear&t=NOON${relief ? '' : '&relief=0'}`,
    tag: `carve-${relief ? 'on' : 'off'}`, settle: 40000,
  });
  let r = null;
  for (let i = 0; i < 20; i++) {
    r = await d.page.evaluate(() => window.__zfight());
    if (r.onRoad && r.samples > 0) break;
    // A SPAWN COORDINATE IS A WISH. Whether it lands on tarmac depends on how
    // the way was clipped and which tile arrived first, and the Chapman's Peak
    // corniche lands beside its road often enough to make this a coin flip —
    // it failed here once with the truck 0/33 on-road while the control run
    // measured 33. Waiting longer makes a flake slower, not rarer, so after a
    // few passes it asks to be put on the road instead.
    if (i === 4) await d.page.evaluate(() => window.__toroad());
    await d.page.waitForTimeout(3000);
  }
  errors.push(...d.errors);
  await d.close();
  return r;
};

for (const s of SPOTS) {
  const off = await measure(s.spot, false);
  const on = await measure(s.spot, true);
  const worst = (r) => {
    const g = r.rows.filter((q) => q.gap < 0).map((q) => q.gap);
    return g.length ? Math.min(...g) : 0;
  };
  console.log(`\n  ── ${s.name} — ${on.onRoad ? `${on.roadM}m of road walked` : 'OFF-ROAD'}`
    + ` · ${on.depthBits}-bit depth, LSB at 20m ${on.lsbAt20m}m vs an ${on.budget * 2}m budget`);
  console.log(`     buried   ${String(off.through).padStart(2)}/${off.samples} (worst ${worst(off).toFixed(3)}m)`
    + `  ->  ${String(on.through).padStart(2)}/${on.samples} (worst ${worst(on).toFixed(3)}m)`);
  console.log(`     verge up ${off.vergeUp.p95}m  ->  ${on.vergeUp.p95}m p95  (${on.vergeUp.n} pts, the cutting)`);
  console.log(`     verge dn ${off.vergeDown.p95}m  ->  ${on.vergeDown.p95}m p95  (${on.vergeDown.n} pts, the bench)`);
  console.log(`     carve    ${off.carve.msPerTile}ms/tile  ->  ${on.carve.msPerTile}ms/tile`
    + `, ${on.carve.relieved}/${on.carve.tiles} tiles needed relief`);

  check(`${s.name}: the probe stood on a road, so the count means something`,
    on.onRoad && on.samples > 0 && off.samples > 0, { on: on.samples, off: off.samples });
  // THE ONE THE REPORT IS ABOUT.
  check(`${s.name}: no ground left standing through the tarmac`,
    on.through === 0, on.rows.filter((q) => q.gap < 0));
  // …AND IT WAS THERE TO BE FIXED. A pass on a spot that never had the fault
  // proves nothing, and two of these three would have passed vacuously.
  check(`${s.name}: and the old rule really did bury it (${off.through}/${off.samples})`,
    off.through > 0, off);
  // NOT DEPTH. Asserted at whatever near plane the build is using, because the
  // whole point is that this does not depend on it.
  check(`${s.name}: nothing is close enough to depth-fight at ${on.depthBits} bits`,
    on.fight === 0 && on.depthBits >= 24, { fight: on.fight, bits: on.depthBits, lsb: on.lsbAt20m });

  if (s.verge) {
    // THE COST, BOUNDED — AND ON THE RIGHT HALF OF THE ROAD.
    //
    // This first asserted on the whole verge and failed Wadi Rum at 0.77m ->
    // 1.05m, which looked like exactly the bench the wash exists to prevent.
    // Split by side, all 117 of those points are on the UPHILL half: the road
    // is in cutting for its whole length there, and a cutting getting deeper
    // where the hill is steeper is a cutting, not damage. Condemning it would
    // condemn every mountain road ever built.
    //
    // The bench is the OTHER half — ground dug out where nature was already
    // below the tarmac, which buys nothing and reads as a pale shelf. That is
    // what must not move, and at Noordhoek it does not move at all (0.086m
    // before and after), while Wadi Rum has no downhill verge to spoil.
    check(`${s.name}: the bench did not come back`
      + ` (downhill p95 ${off.vergeDown.p95}m -> ${on.vergeDown.p95}m)`,
      on.vergeDown.n === 0
        || (on.vergeDown.p95 < 0.40 && on.vergeDown.p95 - off.vergeDown.p95 < 0.05),
      { off: off.vergeDown, on: on.vergeDown });
  }
  // Relief runs at most two extra passes and only on tiles that need them. The
  // rebuild queue serves one tile per 200ms, so this is the budget it fits in.
  check(`${s.name}: the carve still fits its rebuild slot (${on.carve.msPerTile}ms)`,
    on.carve.msPerTile < 120, on.carve);
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — the ground stays under the road');
report(errors);
if (bad) process.exitCode = 1;
