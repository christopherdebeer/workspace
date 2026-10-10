// Squishy's dumpling (jelly and dough) and course, on their own: at rest it keeps its shape and its volume; dropped,
// it squashes wide (not smaller) and comes back; flicked, its middle lands where the aiming arc
// says; tipped over it rolls back up; sat still it turns to look where it's asked; a chopstick is a stick; every level is the
// same level each time, every hop in it can be made, and flicked by the book it gets home
// without a fall; spin runs on or bites; the stove's butter slides and its lip catches, honey
// holds a splat, a lid lifts what's on it. (node cells/lab/devtools/squishy.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const L = await load('../client/squishy/level.ts');
const B = await load('../client/squishy/body.ts');
const M = await load('../client/squishy/mesh.ts');
const DT = 1 / 60;
const flat = { n: 0, chapter: 'counter', towers: [], sticks: [], movers: [], shapes: [L.box([0, -5, 0], [200, 5, 200], 0, 0)] };
const run = (d, lv, secs, each) => { for (let t = 0; t < secs; t += DT) { d.step(lv, DT, t); each?.(t); } };
const speed = (d) => Math.hypot(...d.vcom);

for (const kind of ['jelly', 'dough']) {
// ─── at rest ──────────────────────────────────────────────────────────────────────────────────
{
  const d = new B.Dumpling([0, L.REST_H + 0.3, 0], kind);
  assert.ok(d.n > 300, `particles: ${d.n}`);
  const h0 = d.height();
  run(d, flat, 3);
  for (const v of d.x) assert.ok(Number.isFinite(v));
  const vol = d.volume() / d.restVolume;
  assert.ok(Math.abs(vol - 1) < 0.03, `keeps its volume at rest: ${vol}`);
  assert.ok(speed(d) < 1, `settles: ${speed(d)}`);
  assert.ok(d.R[4] > 0.98, `upright: ${d.R[4]}`);
  assert.ok(d.height() > h0 * 0.7 && d.height() <= h0 * 1.05, `sits a little slumped, as soft things do: ${d.height() / h0}`);
  assert.ok(d.contacts > 0 && d.canFlick, 'on the ground, and can be flicked');
  console.log(`${kind} rest ok: ${d.n} particles, height ${(d.height() / h0).toFixed(2)}, volume ${vol.toFixed(3)}`);
}

// ─── dropped ──────────────────────────────────────────────────────────────────────────────────
{
  const d = new B.Dumpling([0, 30, 0], kind);
  const h0 = d.height();
  let minH = 9, volAtMin = 1, wide = 0, after = 0;
  run(d, flat, 2.5, (t) => {
    const h = d.height() / h0;
    if (h < minH) { minH = h; volAtMin = d.volume() / d.restVolume; let w = 0; for (let i = 0; i < d.n; i++) w = Math.max(w, Math.hypot(d.x[i * 3] - d.com[0], d.x[i * 3 + 2] - d.com[2])); wide = w; }
    if (t > 2) after = h;
  });
  assert.ok(minH < 0.8, `squashes when it lands: ${minH}`);
  assert.ok(volAtMin > 0.88, `squashed, not crushed: volume ${volAtMin}`);
  assert.ok(wide > L.RADIUS * 1.05, `bulges out: ${wide}`);
  assert.ok(after > minH + 0.05 && after > 0.7, `and comes back: ${after}`);
  assert.ok(d.R[4] > 0.95 && speed(d) < 2, 'upright and still');
  console.log(`${kind} drop ok: squashed to ${minH.toFixed(2)} (volume ${volAtMin.toFixed(2)}), back to ${after.toFixed(2)}`);
}

// ─── flicked: lands where the arc says, and stays ─────────────────────────────────────────────
{
  for (const [yaw, power] of [[0, 0.5], [1.2, 0.8], [-2, 0.2]]) {
    const d = new B.Dumpling([0, L.REST_H + 0.2, 0], kind);
    run(d, flat, 1);
    const vel = L.launch(yaw, power);
    const pa = L.path(flat, [...d.com], vel);
    assert.ok(pa.hit, 'the arc lands');
    d.flick(vel);
    assert.ok(!d.canFlick, 'no second flick at once');
    let land = null, flying = false;
    run(d, flat, 3, () => { if (d.contacts === 0) flying = true; if (!land && flying && d.contacts > 0) land = [...d.com]; });
    assert.ok(flying && land, 'it flew, and came down');
    const off = Math.hypot(land[0] - pa.hit.p[0], land[2] - pa.hit.p[2]);
    assert.ok(off < 1.5, `lands where the arc says (${yaw}, ${power}): ${off.toFixed(2)} cm off`);
    const slid = Math.hypot(d.com[0] - land[0], d.com[2] - land[2]);
    assert.ok(slid < 6, `and stays about there, dough plops: slid ${slid.toFixed(1)}`);
    assert.ok(d.R[4] > 0.95, `right way up after: ${d.R[4]}`);
    assert.ok(Math.abs(d.volume() / d.restVolume - 1) < 0.04);
  }
  console.log(`${kind} flick ok`);
}

// ─── sat still, it turns to look where it's asked (its face is its rest shape's +z) ───────────
{
  const d = new B.Dumpling([0, L.REST_H + 0.3, 0], kind);
  run(d, flat, 1);
  const off = () => { const fx = d.R[2], fz = d.R[8], l = d.look; return Math.abs(Math.atan2(fx * l[2] - fz * l[0], fx * l[0] + fz * l[2])) * 180 / Math.PI; };
  d.look = [-0.6, 0, -0.8];
  const before = off();
  run(d, flat, 1.5);
  assert.ok(before > 120 && off() < 6, `turns to look: ${before.toFixed(0)}° → ${off().toFixed(0)}°`);
  assert.ok(speed(d) < 2 && d.R[4] > 0.98, 'turning, it stays put and upright');
  console.log(`${kind} look ok`);
}

// ─── tipped over, on its side or its head, it rolls itself back up ─────────────────────────────
for (const ang of [1.6, 2.4, 3.1]) {
  const d = new B.Dumpling([0, 5, 0], kind);
  d.turn([1, 0, 0], ang);
  assert.ok(d.R[4] < 0, 'starts over');
  run(d, flat, 2);
  assert.ok(d.R[4] > 0.98, `${kind} rights itself from ${ang}: ${d.R[4]}`);
}
console.log(`${kind} righting ok`);

}

// ─── the meshes: a chopstick is a stick, end to end ───────────────────────────────────────────
{
  const out = [];
  M.capsule(out, [0, 0, 0], [20, 0, 0], 0.6, 10);
  let lo = Infinity, hi = -Infinity, mid = 0;
  const S = M.VSTRIDE;
  for (let i = 0; i < out.length; i += S * 3) { const xs = [out[i], out[i + S], out[i + 2 * S]]; if (Math.max(...xs) - Math.min(...xs) > 19) mid++; }
  for (let i = 0; i < out.length; i += M.VSTRIDE) { lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); }
  assert.ok(Math.abs(lo + 0.6) < 0.01 && Math.abs(hi - 20.6) < 0.01, `spans its length: ${lo} to ${hi}`);
  assert.ok(mid > 0, 'with a shaft between the ends');
  for (let i = 0; i < out.length; i += M.VSTRIDE) {
    const x = out[i], r = Math.hypot(out[i + 1], out[i + 2]);
    if (x > 0 && x < 20) assert.ok(Math.abs(r - 0.6) < 1e-6, 'its shaft is round');
  }
  console.log('mesh ok');
}

// ─── spin: topspin runs on, backspin bites ─────────────────────────────────────────────────────
{
  const butterFloor = L.box([0, -5, 0], [400, 5, 400], 0, 0, 0.28); butterFloor.tack = 0;
  const butter = { ...flat, shapes: [butterFloor] };
  const slid = (lv, spin) => {
    const d = new B.Dumpling([0, L.REST_H + 0.2, 0]);
    run(d, lv, 1);
    d.flick(L.launch(0, 0.6), spin);
    let land = null, flying = false;
    run(d, lv, 3, () => { if (d.contacts === 0) flying = true; if (!land && flying && d.contacts > 0) land = [...d.com]; });
    assert.ok(land, 'came down');
    assert.ok(d.R[4] > 0.9, 'upright after');
    return d.com[2] - land[2];
  };
  const none = slid(flat, 0), top = slid(flat, 1), noneB = slid(butter, 0), backB = slid(butter, -1), topB = slid(butter, 1);
  assert.ok(top > none * 1.5 + 2, `topspin runs on: ${top.toFixed(1)} vs ${none.toFixed(1)}`);
  assert.ok(topB > noneB * 1.5, `and on butter: ${topB.toFixed(1)} vs ${noneB.toFixed(1)}`);
  assert.ok(backB < noneB * 0.6 && backB >= -1, `backspin bites on butter: ${backB.toFixed(1)} vs ${noneB.toFixed(1)}`);
  console.log(`spin ok: slid ${none.toFixed(1)} plain, ${top.toFixed(1)} topspin; on butter ${noneB.toFixed(1)} plain, ${topB.toFixed(1)} topspin, ${backB.toFixed(1)} backspin`);
}

// ─── the stovetop's things ──────────────────────────────────────────────────────────────────────
{
  const r = () => 0.5;
  // butter: slippery, but the lip catches a landing that slides
  {
    const tw = L.tower('butter', [0, 20, 0], 12, 0, r);
    const lv = { n: 0, chapter: 'stove', towers: [tw], sticks: [], movers: [], shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0), ...tw.shapes] };
    // (dropped onto the butter going fast along the dish)
    const d = new B.Dumpling([-5, 26, 0]);
    d.flick([120, 0, 0]);
    let far = -Infinity;
    run(d, lv, 2.5, () => { far = Math.max(far, d.com[0]); });
    assert.ok(far > 1, `slid on the butter: to ${far.toFixed(1)}`);
    assert.ok(L.onTop(tw, d.com, 1) && d.com[1] > 18, `and the lip kept it on the dish: at ${d.com.map((v) => v.toFixed(1))}`);
    assert.ok(d.R[4] > 0.9, 'upright');
    console.log(`butter ok: slid to ${far.toFixed(1)}, kept`);
  }
  // honey: thrown against the jar's side, it sticks, and hangs there; flicked, it leaves
  {
    const tw = L.tower('honey', [0, 20, 0], 6.5, 0, r);
    const lv = { n: 0, chapter: 'stove', towers: [tw], sticks: [], movers: [], shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0), ...tw.shapes] };
    const d = new B.Dumpling([0, 20, -30]);
    d.flick([0, 150, 110]);
    let stuckAt = -1;
    run(d, lv, 3, (t) => { if (stuckAt < 0 && d.held > 1 && speed(d) < 10) stuckAt = t; });
    assert.ok(stuckAt > 0, 'stuck to the honey');
    assert.ok(d.held > 1 && d.pinned > 5 && speed(d) < 3, `and hangs there: held ${d.held}, pinned ${d.pinned}, speed ${speed(d).toFixed(1)}`);
    assert.ok(L.onTop(tw, d.com, 1), 'counted as on the honey');
    assert.ok(Math.abs(d.volume() / d.restVolume - 1) < 0.05, 'its shape kept');
    d.flick(L.launch(Math.PI, 0.5));
    let left = false;
    run(d, lv, 1, () => { if (d.contacts === 0) left = true; });
    assert.ok(left, 'flicked, it lets go');
    console.log(`honey ok: stuck at ${stuckAt.toFixed(2)} s`);
  }
  // a lid: it lifts on its cycle, and what's on it rides up
  {
    const tw = L.tower('lid', [0, 20, 0], 11, 0, r);
    const lid = tw.shapes[1];
    const lv = { n: 0, chapter: 'stove', towers: [tw], sticks: [], movers: tw.shapes.filter((s) => s.lift), shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0), ...tw.shapes] };
    const d = new B.Dumpling([0, 20 + L.REST_H + 2, 0]);
    let lo = 1e9, hi = -1e9, lidHi = -1e9, off = 0, frames = 0;
    run(d, lv, lid.lift.period * 1.5, () => { lo = Math.min(lo, d.com[1]); hi = Math.max(hi, d.com[1]); lidHi = Math.max(lidHi, lid.c[1]); frames++; if (d.contacts === 0) off++; });
    // (it may hop a frame as the lid rattles; it stays on)
    assert.ok(off < frames * 0.1 && d.contacts > 0, `stays on the lid: off it ${off} of ${frames} frames`);
    assert.ok(lidHi > lid.lift.y0 + 6.5, `the lid lifts: ${(lidHi - lid.lift.y0).toFixed(1)}`);
    assert.ok(hi - lo > 6, `and it rides up with it: ${(hi - lo).toFixed(1)}`);
    assert.ok(L.onTop(tw, d.com, 1), 'still on the lid');
    console.log(`lid ok: rode up ${(hi - lo).toFixed(1)}`);
  }
}

// ─── levels ───────────────────────────────────────────────────────────────────────────────────
{
  const kinds = new Set();
  for (let n = 1; n <= 10; n++) {
    const a = L.buildLevel(n), b = L.buildLevel(n);
    assert.deepEqual(a.towers.map((t) => [t.top, t.at, t.r]), b.towers.map((t) => [t.top, t.at, t.r]), `level ${n} is the same each time`);
    assert.equal(a.towers[0].top, 'start');
    assert.equal(a.towers.at(-1).top, 'goal');
    assert.ok(a.towers.length >= 7, `level ${n}: ${a.towers.length} tops`);
    for (const t of a.towers) kinds.add(t.top);
    // (every hop: from the middle of each top, a flick that lands on the next)
    for (let k = 1; k < a.towers.length; k++) assert.ok(L.hop(a, k - 1, k), `level ${n}: hop ${k - 1}→${k} can be made`);
  }
  for (const k of ['steamer', 'plate', 'board', 'pudding', 'susan', 'tin', 'butter', 'honey', 'lid', 'pan']) assert.ok(kinds.has(k), `a ${k} somewhere`);
  assert.equal(L.buildLevel(2).chapter, 'counter'); assert.equal(L.buildLevel(6).chapter, 'stove'); assert.equal(L.buildLevel(9).chapter, 'mixed');
  assert.ok(L.buildLevel(3).towers.every((t) => !['butter', 'honey', 'lid', 'pan'].includes(t.top)), 'the counter has none of the stove\'s things');
  assert.ok(L.buildLevel(7).movers.length > 0, 'level 7 has a lid');
  assert.notDeepEqual(L.buildLevel(1).towers.map((t) => t.at), L.buildLevel(2).towers.map((t) => t.at));
  console.log('levels ok');
}

// ─── flicked by the book (to the middle of the band, from where it sits), it gets home ─────────
{
  for (const [kind, n] of [1, 2, 3, 4, 5, 6, 7, 8].flatMap((n) => [['jelly', n], ['dough', n]]).filter(([k, n]) => k === 'jelly' || n % 2)) {
    const lv = L.buildLevel(n);
    const s = lv.towers[0].at;
    const d = new B.Dumpling([s[0], s[1] + L.REST_H + 2, s[2]], kind);
    let home = -1, still = 0;
    for (let t = 0; t < 150 && home < 0; t += DT) {
      d.step(lv, DT, t);
      assert.ok(d.com[1] > L.RADIUS * 2.2, `level ${n}: no fall (at ${t.toFixed(1)} s)`);
      const k = L.towerAt(lv, d.com, 1);
      still = Math.hypot(...d.drift) < 6 && d.contacts > 0 ? still + DT : 0;
      if (k === lv.towers.length - 1 && still > 0.4) { home = t; break; }
      const at = k >= 0 ? k : L.towerAt(lv, d.com, 4);
      if (still > 0.35 && d.canFlick && at >= 0 && at < lv.towers.length - 1) {
        const a = L.aim(lv, d.com, at + 1, t) ?? (lv.towers[at].jar ? null : L.aim(lv, d.com, at, t));
        assert.ok(a, `level ${n}: a way on from ${at}`);
        d.flick(L.launch(a.yaw, a.power)); still = 0;
      }
    }
    assert.ok(home >= 0, `${kind}: level ${n} home`);
    console.log(`${kind}: level ${n} home in ${home.toFixed(1)} s`);
  }
}
console.log('squishy ok');
