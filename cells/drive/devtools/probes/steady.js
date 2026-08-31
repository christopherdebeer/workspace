// WHERE A TYPICAL FRAME GOES — not a stalled one.
//
// The stall hunt worked: builds hold the thread 23ms at most now, and terrain
// re-seating went from scanning 3889 footprints to 0. And the frame
// distribution did not move: p50 33ms, which is a MEDIAN, not a burst. So the
// question is no longer "what blocks occasionally" but "what costs 33ms every
// single frame", and an instrument that only records frames over 100ms cannot
// see it at all.
export default function () {
  const c = window.__ctx;
  if (window.__steadyStop) window.__steadyStop();
  const origRaf = window.requestAnimationFrame.bind(window);
  let rafAcc = 0, renderAcc = 0;
  const undo = [];

  const rr = c.renderer.render.bind(c.renderer);
  const origRender = c.renderer.render;
  c.renderer.render = function (...a) {
    const t = performance.now();
    try { return rr(...a); } finally { renderAcc += performance.now() - t; }
  };
  undo.push(() => { c.renderer.render = origRender; });

  const origWrap = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => origRaf((ts) => {
    const s = performance.now();
    try { return cb(ts); } finally { rafAcc += performance.now() - s; }
  });
  undo.push(() => { window.requestAnimationFrame = origWrap; });

  // Every frame, not just the bad ones.
  const F = [];
  let last = performance.now();
  let raf = 0;
  const step = () => {
    const now = performance.now();
    F.push([now - last, rafAcc, renderAcc]);
    if (F.length > 600) F.shift();
    last = now; rafAcc = 0; renderAcc = 0;
    raf = origRaf(step);
  };
  raf = origRaf(step);

  window.__steadyStop = () => { cancelAnimationFrame(raf); undo.forEach((f) => f()); return F.length; };
  window.__steady = () => {
    if (F.length < 20) return { n: F.length };
    const q = (a, f) => { const s = a.slice().sort((x, y) => x - y);
      return +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(1); };
    const dt = F.map((r) => r[0]), loop = F.map((r) => r[1]), rend = F.map((r) => r[2]);
    const mean = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
    return { n: F.length,
      frameMs: { p50: q(dt, 0.5), p90: q(dt, 0.9), mean: mean(dt) },
      // inLoop includes inRender: the game calls render from inside its own
      // callback. `logic` is what is left after the draw, and `idle` is the
      // frame time the game never touched — browser work, compositing, or the
      // display simply not being ready for us.
      inLoop: { p50: q(loop, 0.5), p90: q(loop, 0.9), mean: mean(loop) },
      inRender: { p50: q(rend, 0.5), p90: q(rend, 0.9), mean: mean(rend) },
      logic: { mean: +(mean(loop) - mean(rend)).toFixed(1) },
      idle: { mean: +(mean(dt) - mean(loop)).toFixed(1) },
    };
  };
  return { watching: 'every frame', note: 'ask __steady()' };
}
