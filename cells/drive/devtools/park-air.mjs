/**
 * SLIP AT A STANDSTILL, AND WHAT BRINGS A FLYING TRUCK DOWN.
 *
 *   node cells/drive/devtools/park-air.mjs [spot]
 *
 * Two questions from the seat, both about a rule standing in for physics:
 *
 *   1. A STOPPED TRUCK MUST NOT MOVE. Hands off the controls on a slope. Any
 *      travel at all is the creep — and the creep was structural: the hold
 *      zeroed the velocities AFTER the integrator had already moved the truck
 *      for the frame, so every frame still contributed its own displacement.
 *   2. A FLYING TRUCK FALLS AT g. Kick the body upward and watch it come back.
 *      The old reseat teleported it onto the terrain the moment it cleared six
 *      metres, so the apex and the descent ARE the measurement: an apex near
 *      v²/2g, and an acceleration near -9.81 the whole way down.
 *
 * Sim seconds are expensive in the harness (roughly ten real ones each), so
 * the windows are short and the thresholds are stated per second.
 */
import { openDrive, report } from './harness.mjs';

const spot = process.argv[2] || 'lat=46.55525&lon=10.43907&h=277&cam=chase&sunalt=45&wx=clear';
const HOLD_S = +(process.env.HOLD_S ?? 6);
const d = await openDrive({ spot, tag: 'parkair', settle: 18000 });

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
// BOUNDED IN FRAMES AS WELL AS IN SIM SECONDS. dt is capped, so a headless
// page that renders slowly runs the world slower than the clock, and a window
// stated purely in sim seconds can outlast the harness. Every wait here ends at
// whichever bound arrives first and reports the sim seconds it actually got.
const FRAME_CAP = +(process.env.FRAME_CAP ?? 400);
const waitS = (s) => d.page.evaluate(([n, cap]) => new Promise((r) => {
  const t0 = window.__clock().simS; let f = 0;
  const w = () => (window.__clock().simS - t0 > n || ++f > cap ? r() : requestAnimationFrame(w));
  requestAnimationFrame(w);
}), [s, FRAME_CAP]);

console.log(`\n── STOPPED, HANDS OFF, ${HOLD_S} sim seconds ──`);
// ON A ROAD, ON PURPOSE. The first run took its measurement wherever the spot
// dropped the truck, which at Stelvio is a 35° scree face — a slope no tyre
// holds, so the model correctly let it go and the run read that as a failure.
// A road is where "stopped" means anything, and its grade is inside what any
// surface can hold, which is exactly where the old creep lived.
// A ROAD FIRST, THEN THE FLATTEST FIELD. Roads are often not streamed in the
// harness, and the fallback matters: the only way to read the grade at a point
// is to stand the truck on it, so this drives the search — teleport, let the
// body seat, read what the latch thinks of the slope, keep the first ground it
// can actually hold. Without it every run is measured on whatever face the
// spot happened to drop the truck on.
const cands = await d.page.evaluate(() => {
  const s = window.__drive, out = [];
  for (const want of ['road', 'field', 'grass', 'sand', 'ground']) {
    for (let r = 0; r < 500 && out.length < 9; r += 7) {
      for (let a = 0; a < 24 && out.length < 9; a++) {
        const x = s.x + Math.cos((a / 24) * 6.283) * r, z = s.z + Math.sin((a / 24) * 6.283) * r;
        if (window.__surfaceAt(x, z) === want) out.push([x - s.x, z - s.z, want, Math.round(r)]);
      }
    }
    if (out.length) break;
  }
  return out;
});
let road = null;
for (const c of cands) {
  await d.page.evaluate((j) => window.__jump(j[0], j[1]), c);
  await waitS(1.5);
  const p = await d.page.evaluate(() => window.__phys().park);
  console.log(`  candidate ${c[2]} ${c[3]}m: ${p.slopeDeg}° against ${p.maxDeg}° of hold`);
  if (p.slopeDeg <= p.maxDeg) { road = [-c[0], -c[1], c[2], c[3]]; break; }
}
if (road) console.log(`standing on ${road[2]} ${road[3]}m from the spot`);
else console.log('nothing holdable within 500m — measuring where it stands');
// BACK TO THE SAME PATCH EVERY MODE. Whatever the search settled on is the
// bench; a mode that lets the truck go would otherwise hand the next one a
// different hillside and three measurements of three places is not a
// comparison.
const bench = await d.page.evaluate(() => [window.__drive.x, window.__drive.z]);
for (const [mode, mi] of Object.entries(JSON.parse(process.env.MODES ?? '{"LOOSE":1,"REAL":2,"ARCADE":0}'))) {
  await d.page.evaluate((b) => {
    window.__jump(b[0] - window.__drive.x, b[1] - window.__drive.z);
  }, bench);
  await d.page.evaluate((m) => { window.__dial('trac', m); window.__hold(0, 0, 1); }, mi);
  await waitS(3);                                     // land, then brake to a rest
  const r = await d.page.evaluate(async ([n, cap]) => {
    window.__hold(0, 0, 0);                           // hands off entirely
    const s = window.__drive;
    const x0 = s.x, z0 = s.z, t0 = window.__clock().simS;
    let peak = 0, f = 0;
    await new Promise((res) => {
      const w = () => {
        peak = Math.max(peak, Math.hypot(s.x - x0, s.z - z0));
        return window.__clock().simS - t0 > n || ++f > cap ? res() : requestAnimationFrame(w);
      };
      requestAnimationFrame(w);
    });
    const p = window.__phys();
    return { m: +Math.hypot(s.x - x0, s.z - z0).toFixed(3), peak: +peak.toFixed(3),
      secs: +(window.__clock().simS - t0).toFixed(2), frames: f, park: p.park,
      surf: window.__surfaceAt(s.x, s.z),
      kmh: +(Math.abs(p.v) * 3.6).toFixed(2), slide: p.slideV };
  }, [HOLD_S, FRAME_CAP]);
  const rate = r.m / Math.max(r.secs, 0.05);
  console.log(`${mode}: ${JSON.stringify(r)}  →  ${(rate * 100).toFixed(1)} cm/s`);
  // THE MODEL'S OWN CLAIM IS THE ASSERTION. Under the repose angle the truck
  // must not move at all; over it, it must genuinely go — a slope steeper than
  // the tyres can hold is not a bug, and pinning the truck there would be one.
  if (r.park?.slopeDeg <= r.park?.maxDeg) {
    check(`${mode}: on ${r.surf} at ${r.park.slopeDeg}° (holds to ${r.park.maxDeg}°) — latched`,
      r.park?.hold === true, r.park);
    check(`${mode}: …and did not move (under 1cm/s)`, rate < 0.01, { rate, ...r });
  } else {
    check(`${mode}: at ${r.park?.slopeDeg}° past the ${r.park?.maxDeg}° the surface holds — it slides`,
      r.park?.hold === false && rate > 0.05, { rate, ...r });
  }
}


console.log('\n── LAUNCHED, THEN LEFT ALONE ──');
await d.page.evaluate(() => { window.__dial('trac', 1); window.__hold(0, 0, 1); });
const fall = await d.page.evaluate(() => new Promise((res) => {
  const rows = [];
  window.__launch(14);
  const t0 = window.__clock().simS;
  const tick = () => {
    const s = window.__susp();
    rows.push([+(window.__clock().simS - t0).toFixed(3), s.vBodyY, s.gap, s.grounded, s.air]);
    if (window.__clock().simS - t0 < 6 && rows.length < 600) requestAnimationFrame(tick);
    else res(rows);
  };
  requestAnimationFrame(tick);
}));
await d.page.evaluate(() => { window.__hold(null); });
const apex = Math.max(...fall.map((r) => r[2]));
const desc = fall.filter((r) => r[1] < -1 && r[2] > 1);
const accs = [];
for (let i = 1; i < desc.length; i++) {
  const dt = desc[i][0] - desc[i - 1][0];
  if (dt > 0.001) accs.push((desc[i][1] - desc[i - 1][1]) / dt);
}
accs.sort((a, b) => a - b);
const med = accs.length ? accs[accs.length >> 1] : NaN;
console.log(`apex=${apex.toFixed(2)}m (v=14 predicts ${(14 * 14 / 19.62).toFixed(2)}m) ` +
  `frames=${fall.length} descentFrames=${desc.length} medianAccel=${med.toFixed(2)} m/s^2`);
for (const r of fall.filter((_, i) => i % 5 === 0).slice(0, 24)) {
  console.log(`  t=${String(r[0]).padStart(6)} gap=${String(r[2]).padStart(7)} vBodyY=${String(r[1]).padStart(7)} gnd=${r[3]} air=${r[4]}`);
}
check('the truck actually cleared six metres', apex > 6, { apex });
check('apex within 20% of v^2/2g', Math.abs(apex - 9.99) < 2.0, { apex });
check('the fall is gravity', Math.abs(med + 9.81) < 0.8, { med });
check('it landed', fall[fall.length - 1][2] < 0.6, fall[fall.length - 1]);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
report(d.errors);
await d.close();
