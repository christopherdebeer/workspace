// THE FRAME COST, BUCKETED BY HOW FAST THE RIG IS MOVING.
//
// Everything about the picture has been ruled out: hiding 85% of the
// triangles and 82% of the draw calls moved the median frame by 0ms, the
// world renders at 320px tall so fill rate was never in it, and 60Hz is on
// offer (16% of frames land on one refresh). JS inside the frame callback is
// 8ms of a 33ms frame. So the time is going somewhere no rAF timer looks:
// promise continuations, decode callbacks, IndexedDB events — the streaming.
//
// If that is right, frame cost must track SPEED, because speed is what drives
// streaming — and a parked rig must be near 60. That is the driver's own
// observation about the drone, which streams nothing, stated as a number.
export default async function () {
  const c = window.__ctx;
  const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];  // [sum, n, worst] per bucket
  const bucket = (kmh) => kmh < 5 ? 0 : kmh < 40 ? 1 : kmh < 90 ? 2 : 3;
  let last = performance.now();
  await new Promise((done) => {
    const t0 = last;
    const step = () => {
      const now = performance.now();
      const dt = now - last; last = now;
      const b = B[bucket(Math.abs(c.state.speed) * 3.6)];
      b[0] += dt; b[1]++; if (dt > b[2]) b[2] = dt;
      if (now - t0 < 75000) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  const name = ['parked <5', 'slow 5-40', 'mid 40-90', 'fast 90+'];
  const out = {};
  B.forEach((b, i) => {
    if (!b[1]) return;
    out[name[i]] = { frames: b[1], meanMs: +(b[0] / b[1]).toFixed(1),
      fps: Math.round(1000 / (b[0] / b[1])), worstMs: Math.round(b[2]) };
  });
  return out;
}
