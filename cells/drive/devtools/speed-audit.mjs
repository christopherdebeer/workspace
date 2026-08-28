/**
 * IS THE SPEEDO HONEST, AND IN WHOSE SECONDS?
 *
 * The dial shows state.speed * 3.6 and the world is local METRES — so if the
 * integrator's dt matched wall time, dial km/h would BE ground km/h. But
 * stepWorld clamps dt to 50ms: below 20fps a frame integrates less sim time
 * than wall time passed, and the truck covers less real ground per wall
 * second than the dial claims — the dial is honest in SIM seconds only.
 *
 * Three numbers close the loop, on the proven autopilot fixture:
 *   dial km/h        what the instrument says
 *   sim  km/h        metres per SIM second   — should match the dial
 *   wall km/h        metres per WALL second  — what the eye experiences
 * and the ratio wall/sim should equal the measured sim rate (≈ 0.05 * fps
 * when fps < 20, 1 otherwise).
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({
  spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&wx=clear&time=NOON',
  tag: 'speed',
});
await d.page.waitForTimeout(12000);
await d.page.evaluate(() => { window.__dial('auto', 1); });
await d.page.evaluate(() => {
  const r = window.__autorect();
  const c = document.querySelector('canvas');
  const x = (r.x + r.w / 2) * r.s, y = (r.y + r.h / 2) * r.s;
  for (const t of ['pointerdown', 'pointerup']) {
    c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: 7, bubbles: true }));
  }
});
await d.simWait(6);                       // spool up in integrated seconds

const fps = await d.page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const loop = () => { n++; if (performance.now() - t0 < 6000) requestAnimationFrame(loop); else res(n / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(loop);
}));

const S = [];
for (let i = 0; i < 7; i++) {
  const s = await d.page.evaluate(() => {
    const r = window.__real();
    return { wall: performance.now() / 1000, sim: window.__clock().simS,
      x: r.car[0], z: r.car[1], kmh: r.kmh, mode: window.__auto().mode };
  });
  S.push(s);
  if (i < 6) await d.simWait(1.2);
}
let dist = 0, wall = 0, sim = 0, kmhSum = 0, kn = 0;
for (let i = 1; i < S.length; i++) {
  dist += Math.hypot(S[i].x - S[i - 1].x, S[i].z - S[i - 1].z);
  wall += S[i].wall - S[i - 1].wall;
  sim += S[i].sim - S[i - 1].sim;
  if (S[i].kmh > 1) { kmhSum += (S[i].kmh + S[i - 1].kmh) / 2; kn++; }
}
const dial = kn ? kmhSum / kn : 0;
console.log(`modes seen     ${[...new Set(S.map((s) => s.mode))].join(',')}`);
console.log(`fps            ${fps.toFixed(1)}`);
console.log(`dial km/h      ${dial.toFixed(1)}`);
console.log(`sim  km/h      ${((dist / sim) * 3.6).toFixed(1)}   (${dist.toFixed(0)}m / ${sim.toFixed(1)} sim s)`);
console.log(`wall km/h      ${((dist / wall) * 3.6).toFixed(1)}   (${dist.toFixed(0)}m / ${wall.toFixed(1)} wall s)`);
console.log(`sim rate       ${(sim / wall).toFixed(3)}  (sim seconds per wall second)`);
console.log(`predicted      ${Math.min(1, 0.05 * fps).toFixed(3)}  (dt clamp 0.05 * fps, capped at 1)`);
report(d.errors);
await d.close();
