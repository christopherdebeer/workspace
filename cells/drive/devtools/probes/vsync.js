// IS 60Hz EVEN ON OFFER?
//
// The median frame is pinned at 33ms through every resolution from full to a
// third, which is the shape of a CAP rather than a load — and there is no
// frame limiter anywhere in the game. If the display can deliver 60Hz, some
// frames must arrive at ~16.7ms; if the fastest frame in several hundred is
// still ~33ms, the browser is only offering 30 and no amount of work removed
// from our side will change it.
export default async function () {
  const d = [];
  let last = performance.now();
  await new Promise((done) => {
    const t0 = last;
    const step = () => {
      const now = performance.now();
      d.push(now - last); last = now;
      if (now - t0 < 8000) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  d.shift();
  const s = d.slice().sort((a, b) => a - b);
  const at = (f) => +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(1);
  // How many landed near one refresh vs two, at 60Hz.
  const near = (ms, tol) => d.filter((x) => Math.abs(x - ms) < tol).length;
  return { n: d.length, min: +s[0].toFixed(1), p05: at(0.05), p25: at(0.25), p50: at(0.5),
    at16: near(16.7, 4), at33: near(33.3, 5), at50: near(50, 6),
    verdict: s[0] < 22 ? '60Hz IS available — we are missing it'
      : 'CAPPED at 30Hz by the browser/OS, not by our workload' };
}
