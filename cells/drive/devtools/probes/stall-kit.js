// AN INSTRUMENT THAT OUTLIVES THE CRASH.
//
// The tab is being killed — uptime keeps resetting and every hot-loaded probe
// dies with it — so an in-memory series can never contain the interesting
// part, which is the last few seconds before the end. The samples go to
// localStorage instead, tagged with a boot id, and are read back AFTER the
// restart. What killed it is written down by the thing that died.
//
// Small and bounded on purpose: a diagnostic that fills the origin's quota
// would break the tile cache, which is the same storage the game depends on.
const K = 'drive.perf.log';
const MAX = 150;
export default function () {
  const c = window.__ctx;
  for (const k of ['__samplerStop', '__stallStop', '__acctStop']) if (window[k]) window[k]();

  const boot = Math.random().toString(36).slice(2, 8);
  const read = () => { try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch { return []; } };
  const log = read();
  // A fresh boot is itself the most important event in the series.
  log.push({ b: boot, boot: 1, t: 0 });

  const write = () => {
    try {
      while (log.length > MAX) log.shift();
      localStorage.setItem(K, JSON.stringify(log));
    } catch { /* quota — the game's cache matters more than the log */ }
  };

  let meshes = 0;
  const countMeshes = () => { let n = 0; c.scene.traverse((o) => { if (o.isMesh) n++; }); return n; };

  const sample = () => {
    const i = c.renderer.info;
    // Every count that can only go up, plus the frame distribution that is the
    // symptom. If they climb together, growth is the cause and not a bystander.
    meshes = countMeshes();
    const f = window.__frames();
    log.push({ b: boot, t: Math.round(performance.now() / 1000),
      fps: f.fps, p99: f.p99, bad: f.over33pc,
      geo: i.memory.geometries, tex: i.memory.textures,
      prog: i.programs?.length ?? 0, mesh: meshes,
      kid: c.worldGroup.children.length,
      km: Math.round(Math.abs(c.state.speed) * 3.6) });
    write();
  };
  sample();
  const si = setInterval(sample, 5000);
  window.__samplerStop = () => { clearInterval(si); return log.length; };

  // Stalls, still O(1) per frame.
  const undo = [];
  const R = []; window.__stalls = R;
  let undoRender = () => {};
  // INSIDE THE GAME LOOP, OR BETWEEN FRAMES?
  //
  // The draw is 5-16ms of a 380ms frame, so the cost is JavaScript — but that
  // is two very different bugs. If it is inside the game's own rAF callback,
  // the loop is doing too much per frame. If it is OUTSIDE, the time is going
  // to work the loop never asked for on that frame: fetch continuations, image
  // decode callbacks, IndexedDB events, GC — streaming spilling into the
  // frame. One is fixed by budgeting the loop, the other by getting the work
  // off the main thread entirely.
  const origRaf = window.requestAnimationFrame.bind(window);
  let rafAcc = 0;
  window.requestAnimationFrame = (cb) => origRaf((ts) => {
    const s = performance.now();
    try { return cb(ts); } finally { rafAcc += performance.now() - s; }
  });
  undo.push(() => { window.requestAnimationFrame = origRaf; });
  const cheap = () => { const i = c.renderer.info;
    return { geo: i.memory.geometries, tex: i.memory.textures,
      prog: i.programs?.length ?? 0, kid: c.worldGroup.children.length }; };
  // HOW MUCH OF A LONG FRAME WAS THE DRAW ITSELF.
  //
  // The accountant cleared parsing, decoding, normals and IndexedDB — together
  // barely 500ms against stalls of 100-320ms EACH. The one thing it did not
  // time was renderer.render, and that is the whole difference between "the
  // game is doing too much work" and "the driver is stalling on a pipeline":
  // one is fixed by scheduling, the other by what is in the scene.
  let renderAcc = 0;
  {
    const rr = c.renderer.render.bind(c.renderer);
    const orig = c.renderer.render;
    c.renderer.render = function (...a) {
      const t = performance.now();
      try { return rr(...a); } finally { renderAcc += performance.now() - t; }
    };
    undoRender = () => { c.renderer.render = orig; };
  }
  let prev = cheap(); let last = performance.now(); let raf = 0;
  const step = () => {
    const now = performance.now(); const dt = now - last; last = now;
    const s = cheap();
    if (dt > 100) {
      // inRender vs the rest: the split that names the culprit.
      R.push({ ms: Math.round(dt), inRender: Math.round(renderAcc),
        inLoop: Math.round(rafAcc), offLoop: Math.round(dt - rafAcc),
        dProg: s.prog - prev.prog, dGeo: s.geo - prev.geo,
        dTex: s.tex - prev.tex, dKid: s.kid - prev.kid, prog: s.prog, geo: s.geo });
      if (R.length > 150) R.shift();
    }
    prev = s; renderAcc = 0; rafAcc = 0; raf = origRaf(step);
  };
  raf = origRaf(step);
  window.__stallStop = () => { cancelAnimationFrame(raf); undoRender(); return R.length; };

  // Main-thread accounting, reversible as before.
  const A = {}; window.__acct = A;
  const note = (k, ms) => { const a = A[k] ?? (A[k] = { n: 0, ms: 0, max: 0 });
    a.n++; a.ms = +(a.ms + ms).toFixed(1); if (ms > a.max) a.max = +ms.toFixed(1); };
  const wrap = (o, n, k) => { const f = o?.[n]; if (typeof f !== 'function') return;
    o[n] = function (...a) { const t = performance.now();
      try { return f.apply(this, a); } finally { note(k, performance.now() - t); } };
    undo.push(() => { o[n] = f; }); };
  const CC = window.CanvasRenderingContext2D?.prototype;
  wrap(JSON, 'parse', 'JSON.parse'); wrap(JSON, 'stringify', 'JSON.stringify');
  wrap(CC, 'getImageData', 'getImageData'); wrap(CC, 'drawImage', 'drawImage');
  wrap(CC, 'fillText', 'fillText'); wrap(CC, 'strokeText', 'strokeText');
  wrap(CC, 'measureText', 'measureText');
  wrap(window.IDBObjectStore?.prototype, 'put', 'idb.put');
  const G = c.THREE?.BufferGeometry?.prototype;
  wrap(G, 'computeVertexNormals', 'computeVertexNormals');
  wrap(c.renderer, 'compile', 'renderer.compile');
  window.__acctStop = () => { undo.forEach((f) => f()); return 'restored'; };

  // THE POINT OF ALL THIS: the tail of the log, across boots.
  window.__perflog = (n = 40) => read().slice(-n);
  window.__perlclear = () => { try { localStorage.removeItem(K); } catch { /* fine */ } return 'cleared'; };
  return { boot, kept: log.length, note: '__perflog(n) survives a reload' };
}
