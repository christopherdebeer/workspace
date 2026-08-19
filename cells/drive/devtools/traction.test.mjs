/**
 * DO THE TYRES DECIDE ANYTHING?
 *
 *   node cells/drive/devtools/traction.test.mjs
 *
 * The model this game shipped with integrated position along the HEADING and
 * took its yaw rate straight off the steering rack, so the path curvature was
 * whatever the rack said whatever the ground was. Measured before the change:
 * 2.25g of corner on a 0.60 surface, 4.03g on tarmac, 4.14g of braking on
 * anything, and a corner radius of 6–16m at every speed from 15 to 140km/h.
 *
 * Three laws, and the first one is the whole point:
 *
 *   1. LATERAL ACCELERATION SATURATES NEAR MU. Asking for more lock past the
 *      limit buys no more corner — the truck fails to rotate, which is what
 *      understeer IS. The gap between what the rack asked for and what the
 *      truck did is the measurement.
 *   2. THE GROUND HAS A RANGE. Tarmac and a field are not within a few per
 *      cent of each other; the OSM surface tag reaches the contact patch.
 *   3. ARCADE IS STILL ARCADE. The old path is kept whole behind the dial, and
 *      a toggle that quietly changes the thing it is toggling away from is
 *      worse than no toggle.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({ spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON', tag: 'traction', settle: 20000 });

// ── 2. the ground has a range ──
// Sampled, not driven: friction is a property of the point, and a drive would
// only add the question of whether the truck stayed on it.
const spread = await d.page.evaluate(() => {
  const s = window.__drive;
  const find = (want) => {
    for (let r = 0; r < 400; r += 3) {
      for (let a = 0; a < 32; a++) {
        const x = s.x + Math.cos((a / 32) * 6.283) * r, z = s.z + Math.sin((a / 32) * 6.283) * r;
        if (window.__surfaceAt(x, z) === want) return [x, z];
      }
    }
    return null;
  };
  const at = (p) => {
    if (!p) return null;
    window.__drive.x = p[0]; window.__drive.z = p[1];
    return null;
  };
  const road = find('road'), field = find('ground');
  const read = (p) => { at(p); return null; };
  void read;
  return { road, field };
});
async function muAt(p) {
  await d.page.evaluate((q) => { window.__drive.x = q[0]; window.__drive.z = q[1]; window.__drive.speed = 0; }, p);
  await d.simWait(0.4);
  return d.page.evaluate(() => window.__phys().wheelMu.reduce((a, b) => a + b, 0) / 4);
}
const muRoad = spread.road ? await muAt(spread.road) : 0;
const muField = spread.field ? await muAt(spread.field) : 0;
check('tarmac and a field are different ground', muRoad / Math.max(muField, 0.01) > 1.4,
  { road: +muRoad.toFixed(2), field: +muField.toFixed(2) });
console.log(`        tarmac ${muRoad.toFixed(2)} · field ${muField.toFixed(2)}`);

// ── 1 and 3: hold a lock and see who is deciding ──
/** Hold one exact lock at one speed; return the peak lateral g and the rack's
 *  demand beside what the truck actually did. */
const START = spread.field ?? [0, 0];
async function bend(mode, lock) {
  // BACK TO THE SAME PATCH EVERY TIME. Each run leaves the truck a hundred
  // metres away in a field, and the next one would otherwise be measured
  // against whatever it had drifted into — a bush, a ditch, the sea. Four
  // measurements of four different places is not a comparison.
  await d.page.evaluate((o) => {
    window.__dial('trac', o.mode);
    window.__drive.x = o.at[0]; window.__drive.z = o.at[1];
    window.__drive.speed = 70 / 3.6; window.__drive.heading = 0;
    window.__hold(o.lock, 0, 0);
  }, { mode, lock, at: START });
  // THE PATH THE TRUCK ACTUALLY TRACED, from three sampled positions — not
  // |v·r|, which is the YAW radius and overstates the corner whenever the body
  // is slipping, because the velocity is then not perpendicular to it. Fitting
  // a circle through three points is the measurement a driver makes with a
  // stopwatch and a tape, and no part of the model can flatter it.
  const path = [];
  let last = null;
  for (let i = 0; i < 7; i++) {
    await d.simWait(0.12);
    const p = await d.page.evaluate(() => ({ ...window.__phys(), x: window.__drive.x, z: window.__drive.z }));
    path.push([p.x, p.z]);
    last = p;
  }
  await d.page.evaluate(() => window.__hold(null));
  await d.simWait(0.4);
  // The last three, so the turn-in transient is behind us.
  const [a2, b2, c2] = path.slice(-3);
  const d01 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
  const d12 = Math.hypot(c2[0] - b2[0], c2[1] - b2[1]);
  const d02 = Math.hypot(c2[0] - a2[0], c2[1] - a2[1]);
  const cross = Math.abs((b2[0] - a2[0]) * (c2[1] - a2[1]) - (b2[1] - a2[1]) * (c2[0] - a2[0]));
  const R = cross > 1e-6 ? (d01 * d12 * d02) / (2 * cross) : Infinity;
  const v = Math.hypot(last.v, last.slideV);
  return { ...last, R, g: R > 0 && Number.isFinite(R) ? (v * v) / (R * 9.81) : 0 };
}

const realLow = await bend(2, 0.3);
const realHigh = await bend(2, 1.0);
check('REAL: the truck refuses a corner it has no grip for',
  realHigh.yawRate < realHigh.rackYaw * 0.5, { rack: realHigh.rackYaw, got: realHigh.yawRate });
check('REAL: tripling the lock does not multiply the corner',
  realHigh.g < realLow.g * 1.6, { low: +realLow.g.toFixed(2), high: +realHigh.g.toFixed(2) });
check('REAL: the corner stays inside what the ground can hold',
  realHigh.g < realHigh.muF * 1.15,
  { held: +realHigh.g.toFixed(2), mu: realHigh.muF, radius: Math.round(realHigh.R) });
console.log(`        REAL  lock 0.3 -> ${realLow.g.toFixed(2)}g r=${Math.round(realLow.R)}m · lock 1.0 -> ${realHigh.g.toFixed(2)}g r=${Math.round(realHigh.R)}m (rack ${realHigh.rackYaw}, got ${realHigh.yawRate})`);

// WHO DECIDES THE CORNER, as one ratio: what the truck actually yawed over
// what the steering rack asked for. Surface-independent, speed-independent,
// and the whole difference between the two models in one number — the arcade
// truck does very nearly what the rack said, the tyre model does a fifth of
// it and the rest is the front sliding.
const arcHigh = await bend(0, 1.0);
const obey = (p) => Math.abs(p.yawRate) / Math.max(Math.abs(p.rackYaw), 0.01);
check('ARCADE is untouched: the rack still gets what it asks for',
  obey(arcHigh) > 0.6, { rack: arcHigh.rackYaw, got: arcHigh.yawRate, obey: +obey(arcHigh).toFixed(2) });
check('…and the tyre model plainly does not',
  obey(realHigh) < obey(arcHigh) * 0.5,
  { arcade: +obey(arcHigh).toFixed(2), real: +obey(realHigh).toFixed(2) });
console.log(`        obeys the rack: ARCADE ${(obey(arcHigh) * 100).toFixed(0)}% · REAL ${(obey(realHigh) * 100).toFixed(0)}%`);

report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — the tyres decide');
if (bad) process.exitCode = 1;
