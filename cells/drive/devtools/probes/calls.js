// IS IT THE DRAW CALLS?
//
// 60Hz is on offer (34 of 210 frames landed on one refresh) and we miss it
// about half the time. JS is 8ms of the 16.7 budget, and resolution barely
// moved the median — so it is not fill rate. Draw-call overhead fits what is
// left: 330-450 calls, cost paid in the browser's GPU process where no JS
// timer can see it, and independent of how many pixels each call covers.
//
// So hide the ones that cannot be seen anyway — everything well behind the
// car — and watch the median. This is also a direct test of whether retiring
// distant tiles would be worth the work, since that is exactly what it would
// remove. Fully restored at the end.
export default async function () {
  const c = window.__ctx;
  const sample = async (ms) => {
    const d = []; let last = performance.now();
    await new Promise((done) => {
      const t0 = last;
      const step = () => { const n = performance.now(); d.push(n - last); last = n;
        if (n - t0 < ms) requestAnimationFrame(step); else done(); };
      requestAnimationFrame(step);
    });
    d.shift();
    const s = d.slice().sort((a, b) => a - b);
    const g = window.__gpu();
    return { p50: +s[Math.floor(s.length / 2)].toFixed(1),
      fps: Math.round(1000 / (d.reduce((a, b) => a + b, 0) / d.length)),
      calls: g.calls, ktris: Math.round(g.tris / 1000) };
  };

  const base = await sample(8000);
  // Hide by distance from the CAMERA, not the car: in chase view they differ
  // by tens of metres, and this must not hide anything on screen.
  const box = new c.THREE.Box3(); const v = new c.THREE.Vector3();
  const hidden = [];
  const cam = c.camera.position;
  for (const o of c.worldGroup.children) {
    if (!o.visible) continue;
    try { box.setFromObject(o); box.getCenter(v); } catch { continue; }
    if (Math.hypot(v.x - cam.x, v.z - cam.z) < 1500) continue;
    o.visible = false; hidden.push(o);
  }
  const cut = await sample(8000);
  for (const o of hidden) o.visible = true;
  const back = await sample(8000);
  return { hidden: hidden.length, of: c.worldGroup.children.length,
    base, cut, restored: back,
    verdict: cut.p50 < base.p50 * 0.75 ? 'DRAW CALLS / DISTANT OBJECTS ARE THE COST'
      : 'distant objects are already free — the cost is near geometry or CPU' };
}
