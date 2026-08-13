/**
 * DOES THE PHONE'S IMU ACTUALLY FILL THE SECOND BETWEEN GPS FIXES?
 *
 *   node cells/drive/devtools/imu.mjs [--mode=imu|dr|shake] [--run=30]
 *                                     [--outage=12,18] [--parked]
 *
 * There is no car and no accelerometer in a headless browser, so both are
 * synthesised: a known ground-truth drive (accelerate, cruise, a long
 * right-hand bend, brake), a 1Hz GPS reporting where the car WAS 0.7s ago with
 * metres of jitter, and a 60Hz DeviceMotion stream derived from the same truth
 * through an awkward mount — the phone yawed 25° off the car's axis, tilted 60°
 * from horizontal and rolled 10°, because a windscreen cradle is never square
 * to anything. The number that matters is the distance between where the game
 * thinks the car is and where it actually is.
 *
 *   dr     prediction and lead-compensated correction, no sensors
 *   imu    the same with the motion stream running
 *   shake  imu plus violent noise, i.e. a phone loose in a door pocket
 *
 * TWO TRAPS ARE BUILT INTO THIS FILE, both of which produced confident wrong
 * answers first time round.
 *
 * THE CLOCK. Headless renders this scene at about two frames a second, so
 * letting requestAnimationFrame drive the filter and setInterval deliver the
 * sensors integrated FIVE seconds of a thirty-second drive and reported the
 * shortfall as tracking error. The fusion is a pure function of (dt, samples,
 * performance.now), so the test supplies all three and runs the whole drive
 * synchronously — no frames, no timers, nothing to starve.
 *
 * THE MOUNT IS BOLTED TO THE CAR, NOT THE COMPASS. A first version rotated
 * world→device by a constant, which quietly means the phone holds its heading
 * while the car turns underneath it: the forward axis then swept around inside
 * the device frame through every bend, the learned axis smeared, and the leaked
 * centripetal read as three seconds of phantom braking.
 */
import { openDrive, report } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const mode = arg('mode', 'imu');
const RUN_S = Number(arg('run', 30));
const outage = arg('outage', '999,999').split(',').map(Number);
const parked = args.includes('--parked') || mode === 'shake';

const d = await openDrive({ tag: 'imu', settle: 6000 });   // let streaming settle so frames are cheap

await d.page.evaluate(({ mode, RUN_S, outage, parked }) => {
  // ── ground truth: a drive, as a pure function of elapsed seconds ──
  // accelerate 0→22 (0-5s), cruise (5-10), a 9°/s right bend (10-18),
  // brake 22→8 (18-24), crawl (24-30). The bend is the part the gyro is for;
  // the brake is what teaches the accelerometer which way is forward.
  const prof = parked ? () => ({ v: 0, a: 0, w: 0 }) : (t) => {
    if (t < 5) return { v: 4.4 * t, a: 4.4, w: 0 };
    if (t < 10) return { v: 22, a: 0, w: 0 };
    if (t < 18) return { v: 22, a: 0, w: (9 * Math.PI) / 180 };
    if (t < 24) return { v: 22 - (14 / 6) * (t - 18), a: -14 / 6, w: 0 };
    return { v: 8, a: 0, w: 0 };
  };
  const STEP = 0.005, N = Math.ceil((RUN_S + 2) / STEP);
  const T = new Float64Array(N * 4);           // x, z, heading, speed
  {
    let x = 0, z = 0, h = 0;
    for (let i = 0; i < N; i++) {
      const t = i * STEP, p = prof(t);
      T[i * 4] = x; T[i * 4 + 1] = z; T[i * 4 + 2] = h; T[i * 4 + 3] = p.v;
      h += p.w * STEP;
      x += p.v * Math.sin(h) * STEP;
      z -= p.v * Math.cos(h) * STEP;
    }
  }
  const truth = (t) => {
    const i = Math.max(0, Math.min(N - 1, Math.round(t / STEP)));
    return { x: T[i * 4], z: T[i * 4 + 1], h: T[i * 4 + 2], v: T[i * 4 + 3] };
  };
  // The car starts where the world was anchored, so truth and the game share an
  // origin and the error is a plain distance.
  const [ox, oz] = [window.__drive.x, window.__drive.z];
  window.__drive.heading = 0; window.__drive.speed = 0;

  // ── the mount: nothing about it is square to the car ──
  const rot = (yaw, pitch, roll) => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const Ry = [[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]];
    const Rx = [[1, 0, 0], [0, cp, sp], [0, -sp, cp]];
    const Rz = [[cr, sr, 0], [-sr, cr, 0], [0, 0, 1]];
    const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
    return mul(Rz, mul(Rx, Ry));
  };
  // CAR frame → DEVICE frame. Car frame is x=right, y=up, z=back, so the car
  // accelerates along -z.
  const R = rot((25 * Math.PI) / 180, (60 * Math.PI) / 180, (10 * Math.PI) / 180);
  const apply = (M, v) => ({
    x: M[0][0] * v.x + M[0][1] * v.y + M[0][2] * v.z,
    y: M[1][0] * v.x + M[1][1] * v.y + M[1][2] * v.z,
    z: M[2][0] * v.x + M[2][1] * v.y + M[2][2] * v.z,
  });

  const samples = [];
  let motionN = 0, fixN = 0;
  if (mode !== 'dr' && window.__imuForce) window.__imuForce();

  const realNow = performance.now.bind(performance);
  const t0 = realNow();
  let clock = t0;
  performance.now = () => clock;
  const DT = 1 / 60, GPS_LAG = 0.7;
  const [OUT_FROM, OUT_TO] = outage;
  const D = 180 / Math.PI;
  try {
    for (let i = 0; i < Math.round(RUN_S / DT); i++) {
      const t = i * DT;
      clock = t0 + t * 1000;
      // ── the phone, through the mount ──
      if (mode !== 'dr') {
        const p = prof(t);
        // Longitudinal along the car's own axis, centripetal to the right of it.
        const aCar = { x: p.v * p.w, y: 0, z: -p.a };
        const acc = apply(R, aCar);
        const grav = apply(R, { x: aCar.x, y: 9.81, z: aCar.z });
        // A positive rotation about world up is counter-clockwise; heading is a
        // clockwise bearing, so the truth's yaw rate enters negated.
        const om = apply(R, { x: 0, y: -p.w, z: 0 });
        const jolt = mode === 'shake' ? 1 : 0;
        const jr = () => (Math.random() - 0.5) * 2;
        const init = {
          acceleration: { x: acc.x + jolt * jr() * 5, y: acc.y + jolt * jr() * 5, z: acc.z + jolt * jr() * 5 },
          accelerationIncludingGravity: { x: grav.x + jolt * jr() * 5, y: grav.y + jolt * jr() * 5, z: grav.z + jolt * jr() * 5 },
          rotationRate: { alpha: om.z * D + jolt * jr() * 120, beta: om.x * D + jolt * jr() * 120, gamma: om.y * D + jolt * jr() * 120 },
          interval: DT * 1000,
        };
        let ev;
        try { ev = new DeviceMotionEvent('devicemotion', init); } catch { ev = new Event('devicemotion'); }
        if (ev.accelerationIncludingGravity == null) Object.assign(ev, init);
        dispatchEvent(ev);
        motionN++;
      }
      // ── the GPS: 1Hz, 0.7s late, ±3m of jitter, and OUT under the tunnel ──
      // Dead reckoning is the part of this that could invent a drive, so the run
      // can include a stretch with no fixes at all to watch what it does when
      // nothing is left to correct it.
      if (i % 60 === 0 && !(t >= OUT_FROM && t < OUT_TO)) {
        const p = truth(Math.max(0, t - GPS_LAG));
        const jx = (Math.random() - 0.5) * 6, jz = (Math.random() - 0.5) * 6;
        const [la, lo] = window.__toll(ox + p.x + jx, oz + p.z + jz);
        // The sixth argument is how old the fix already is when it lands — the
        // receiver's own solve-and-hand-up latency, which on a real device comes
        // off GeolocationPosition.timestamp.
        window.__feed(la, lo, ((p.h * 180) / Math.PI + 360) % 360, p.v, 8, GPS_LAG * 1000);
        fixN++;
      }
      window.__stepReal(DT);
      const p = truth(t);
      const dx = window.__drive.x - (ox + p.x), dz = window.__drive.z - (oz + p.z);
      let dh = window.__drive.heading - p.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      samples.push([t, Math.hypot(dx, dz), dh * D, window.__drive.speed - p.v]);
    }
  } finally { performance.now = realNow; }
  window.__imutape = { samples, motionN, fixN };
}, { mode, RUN_S, outage, parked });

const out = await d.page.evaluate(({ RUN_S }) => {
  const { samples, motionN, fixN } = window.__imutape;
  const stat = (rows, key) => {
    const v = rows.map((r) => Math.abs(r[key])).sort((a, b) => a - b);
    if (!v.length) return null;
    const q = (p) => +v[Math.min(v.length - 1, Math.floor(p * v.length))].toFixed(2);
    return { n: v.length, med: q(0.5), p95: q(0.95), max: +v[v.length - 1].toFixed(2) };
  };
  // The first 3s are the filter pulling in from a standing start, not tracking.
  const phases = {
    'cruise 6-10s': (r) => r[0] >= 6 && r[0] < 10,
    'bend 10-18s': (r) => r[0] >= 10 && r[0] < 18,
    'brake 18-24s': (r) => r[0] >= 18 && r[0] < 24,
    'all 6s+': (r) => r[0] >= 6,
  };
  const err = {};
  for (const [k, f] of Object.entries(phases)) {
    const rows = samples.filter(f);
    err[k] = { posM: stat(rows, 1), headDeg: stat(rows, 2), spdMS: stat(rows, 3) };
  }
  // A SIGNED second-by-second trace, because |error| hides whether the filter is
  // lagging or overshooting and those want opposite fixes.
  const trace = [];
  for (let s = 0; s < RUN_S; s++) {
    const rows = samples.filter((r) => r[0] >= s && r[0] < s + 1);
    if (!rows.length) continue;
    const mean = (k) => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(2);
    trace.push([s, mean(1), mean(2), mean(3)]);
  }
  return { fixN, motionN, tapeN: samples.length, RUN_S, trace, imu: window.__imu?.(), err };
}, { RUN_S });

console.log(mode, JSON.stringify(out, null, 1));
report(d.errors);
await d.close();
