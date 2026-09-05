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
for (const [mode, mi] of Object.entries(JSON.parse(process.env.MODES ?? '{"LOOSE":1,"REAL":2,"ARCADE":0}'))) {
  await d.page.evaluate((m) => { window.__dial('trac', m); window.__hold(0, 0, 1); }, mi);
  await waitS(2.5);                                   // brake to a genuine rest
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
      kmh: +(Math.abs(p.v) * 3.6).toFixed(2), slide: p.slideV };
  }, [HOLD_S, FRAME_CAP]);
  const rate = r.m / Math.max(r.secs, 0.05);
  console.log(`${mode}: ${JSON.stringify(r)}  →  ${(rate * 100).toFixed(1)} cm/s`);
  check(`${mode}: parked creep under 1cm/s`, rate < 0.01, { rate, ...r });
  check(`${mode}: the latch is holding`, r.park?.hold === true, r.park);
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
