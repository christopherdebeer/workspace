// Squishy's dumpling (jelly and dough) and course, on their own: at rest it keeps its shape and its volume; dropped,
// it squashes wide (not smaller) and comes back; flicked, its middle lands where the aiming arc
// says; tipped over it rolls back up; sat still it turns to look where it's asked; a chopstick is a stick; every level is the
// same level each time, every hop in it can be made, and flicked by the book it gets home
// without a fall; spin runs on or bites; the stove's butter slides and its lip catches, honey
// holds a splat, a lid lifts what's on it; flour, butter, crumbs, pepper and sprinkles coat it
// where it touched and have their say; a tap nudges it; sheets (a spoon, a towel, a ramp) hold it
// as solids do, a thin one isn't fallen through; the first levels are a set, The Preparation
// Table, every hop in it sure; poked it dents and rolls, held it's drawn out; hung from honey it
// droops, and climbs up and over. (node cells/lab/devtools/squishy.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const L = await load('../client/squishy/level.ts');
const B = await load('../client/squishy/body.ts');
const M = await load('../client/squishy/mesh.ts');
const C = await load('../client/squishy/course.ts');
const P = await load('../client/squishy/props.ts');
const J = await load('../client/squishy/jelly.ts');
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
  // a jelly: dropped on, it dents where it lands and springs back; a konjac throws it up again, nearly as high, unasked, and
  // again, lower each time, till it's sat on it; a panna cotta takes the landing in
  {
    const drop = (feel, kind) => {
      const jl = L.jelly(0, 0, 9, 0, 6, L.MAT.jelly, J.FEELS[feel]);
      const lv = { n: 0, chapter: 'counter', towers: [], sticks: [], movers: [], jellies: [jl], kill: -50, ground: 0, decor: [], shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0), jl] };
      const d = new B.Dumpling([0, 6 + L.REST_H + 40, 0], kind);
      const rest = 6 + L.REST_H;
      let dent = 0, landed = -1, again = 0, air = true;
      run(d, lv, 4.5, (t) => {
        dent = Math.min(dent, jl.jel.z[0]);
        const nowAir = d.contacts === 0;
        if (air && !nowAir && landed < 0) landed = t;
        if (landed >= 0 && nowAir && t > landed + 0.05) again = Math.max(again, d.com[1] - rest);
        air = nowAir;
      });
      return { dent, again, sat: d.com[1] - rest, still: speed(d) };
    };
    for (const kind of ['dough', 'jelly']) {
      const kj = drop('konjac', kind), pc = drop('pannacotta', kind);
      assert.ok(kj.dent < -0.5 && pc.dent < -0.5, `${kind}: a landing dents it: konjac ${kj.dent.toFixed(2)}, panna cotta ${pc.dent.toFixed(2)}`);
      assert.ok(kj.again > 28, `${kind}: the konjac throws it up again, most of the way: ${kj.again.toFixed(1)} cm of 40`);
      assert.ok(pc.again < 3, `${kind}: the panna cotta hardly does: ${pc.again.toFixed(1)} cm of 40`);
      assert.ok(Math.abs(kj.sat) < 2 && Math.abs(pc.sat) < 2, `${kind}: and it ends sat on it: ${kj.sat.toFixed(2)}, ${pc.sat.toFixed(2)}`);
      console.log(`${kind} jelly ok: konjac throws it ${kj.again.toFixed(1)} cm, panna cotta ${pc.again.toFixed(1)}; dents ${kj.dent.toFixed(2)}, ${pc.dent.toFixed(2)}`);
    }
  }
  // a lid: shut, mostly; on its cycle the steam rattles it, and what's on it is jolted, and stays on
  {
    const tw = L.tower('lid', [0, 40, 0], 11, 0, r);
    const lid = tw.land[0];
    const pot = tw.shapes[0];
    assert.ok(pot.hh * 2 < 2 * 11 * 0.8 && pot.c[1] - pot.hh > 5, `a pot of a pot's size, on a stand: ${(pot.hh * 2).toFixed(1)} tall, its foot at ${(pot.c[1] - pot.hh).toFixed(1)}`);
    const lv = { n: 0, chapter: 'stove', towers: [tw], sticks: [], movers: tw.shapes.filter((s) => s.lift), shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0), ...tw.shapes] };
    const d = new B.Dumpling([0, 40 + L.REST_H + 2, 0]);
    let lo = 1e9, hi = -1e9, lidHi = -1e9, off = 0, frames = 0, up = 0;
    run(d, lv, 1, () => {});
    run(d, lv, lid.lift.period * 1.5, () => { lo = Math.min(lo, d.com[1]); hi = Math.max(hi, d.com[1]); lidHi = Math.max(lidHi, lid.c[1]); frames++; if (d.contacts === 0) off++; if (lid.c[1] > lid.lift.y0 + 0.05) up++; });
    assert.ok(up < frames * 0.2, `the lid's shut most of the time: up ${up} of ${frames} frames`);
    assert.ok(lidHi > lid.lift.y0 + 0.5 && lidHi < lid.lift.y0 + 1.5, `it rattles, a little: ${(lidHi - lid.lift.y0).toFixed(2)}`);
    assert.ok(off < frames * 0.15 && d.contacts > 0, `stays on the lid: off it ${off} of ${frames} frames`);
    assert.ok(hi - lo > 0.3, `jolted by it: ${(hi - lo).toFixed(2)}`);
    assert.ok(L.onTop(tw, d.com, 1), 'still on the lid');
    console.log(`lid ok: rattled ${(lidHi - lid.lift.y0).toFixed(2)}, jolted ${(hi - lo).toFixed(2)}`);
  }
}

// ─── coatings: picked up where it touches, worn off in time, each with its say ───────────────────
{
  const dusted = (dust, mu = 0.8) => { const f = L.box([0, -5, 0], [400, 5, 400], 0, 0, mu); f.dust = dust; return { ...flat, shapes: [f] }; };
  const coatOn = (dust, secs = 2.5) => { const d = new B.Dumpling([0, L.REST_H + 0.3, 0], 'dough'); run(d, dusted(dust), secs); return d; };
  for (const k of [L.DUST.flour, L.DUST.butter, L.DUST.crumbs, L.DUST.sprinkles]) {
    const d = coatOn(k);
    assert.ok(d.coated[k] > 0.08 && d.coatMost === k, `picks up ${k}: ${d.coated[k].toFixed(2)}`);
    let n = 0; for (let i = 0; i < d.n; i++) if (d.coat[i] > 0.05) n++;
    assert.ok(n > d.n * 0.08 && n < d.n * 0.7, `on the part of it that touched, not all over: ${n} of ${d.n}`);
    const was = d.coated[k];
    run(d, flat, 8);
    assert.ok(d.coated[k] < was * 0.8, `wears off: ${was.toFixed(2)} → ${d.coated[k].toFixed(2)}`);
  }
  // landed hard in flour, it splashes up its sides: some of what's above its middle (what's seen) is floured too
  {
    const d = new B.Dumpling([0, L.REST_H + 30, 0], 'dough');
    run(d, dusted(L.DUST.flour), 1);
    let up = 0, above = 0;
    for (let i = 0; i < d.n; i++) if (d.x[i * 3 + 1] > d.com[1] - 0.3) { above++; if (d.coat[i] > 0.1) up++; }
    const soft = coatOn(L.DUST.flour, 1);
    let up0 = 0; for (let i = 0; i < soft.n; i++) if (soft.x[i * 3 + 1] > soft.com[1] - 0.3 && soft.coat[i] > 0.1) up0++;
    assert.ok(up > above * 0.15 && up > up0 * 2, `a hard landing in flour floured its sides: ${up} of ${above} above its middle (set down gently: ${up0})`);
    console.log(`splash ok: ${up} of ${above} above its middle floured`);
  }
  // butter: it slides much further, and honey won't hold it
  const slide = (d) => { d.flick(L.launch(0, 0.6)); let land = null, fly = false; run(d, { ...flat, shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0, 0.5)] }, 3, () => { if (d.contacts === 0) fly = true; if (!land && fly && d.contacts > 0) land = [...d.com]; }); return d.com[2] - land[2]; };
  const plain = slide(coatOn(L.DUST.none)), buttered = slide(coatOn(L.DUST.butter));
  assert.ok(buttered > plain * 3 + 3, `buttered, it slides: ${buttered.toFixed(1)} vs ${plain.toFixed(1)}`);
  {
    // (a jar high on its stand, its honey well off the floor: so it's the honey's hold that's tried, not a bounce back into it off the floor)
    const tw = L.tower('honey', [0, 40, 0], 6.5, 0, () => 0.5);
    const lv = { n: 0, chapter: 'stove', towers: [tw], sticks: [], movers: [], shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0), ...tw.shapes] };
    const d = new B.Dumpling([0, 40, -30], 'dough');
    for (let i = 0; i < d.n; i++) { d.coat[i] = 0.8; d.coatKind[i] = L.DUST.butter; }
    d.flick([0, 150, 110]);
    let stuck = 0;
    run(d, lv, 3, () => { if (d.pinned > 4) stuck++; });
    assert.ok(stuck === 0 && d.com[1] < 40 - L.JAR_UNDER + L.RADIUS, `honey won't hold butter: held ${stuck} frames, slid down to y ${d.com[1].toFixed(1)}`);
  }
  // pepper: it sneezes, and the pepper's off it
  {
    const d = coatOn(L.DUST.pepper, 1);
    let sneezes = 0;
    run(d, flat, 6, () => { if (d.sneezed) sneezes++; });
    assert.ok(sneezes >= 1 && sneezes <= 4, `sneezes: ${sneezes}`);
    assert.ok(d.coated[L.DUST.pepper] < 0.02, 'and the pepper is off it');
  }
  console.log('coatings ok');
}

// ─── a nudge: a tap rolls it a hand's width, no more ────────────────────────────────────────────
{
  const d = new B.Dumpling([0, L.REST_H + 0.3, 0], 'dough');
  run(d, flat, 1);
  d.nudge([0, 0, 1]);
  let top = 0;
  run(d, flat, 2.5, () => { top = Math.max(top, d.com[1]); });
  assert.ok(d.com[2] > 5 && d.com[2] < 16, `rolls a little way: ${d.com[2].toFixed(1)}`);
  assert.ok(top < 8, `and hardly leaves the ground: up to ${top.toFixed(1)}`);
  assert.ok(d.R[4] > 0.95 && Math.hypot(...d.drift) < 2, 'upright and still after');
  console.log(`nudge ok: ${d.com[2].toFixed(1)} cm`);
}

// ─── sheets: a surface of triangles, so thick, is met as a solid is ───────────────────────────────
{
  const on = (shapes) => ({ ...flat, shapes });
  const rest = (lv) => { const d = new B.Dumpling([0, L.REST_H + 0.5, 0], 'dough'); run(d, lv, 2); return d; };
  // (a flat sheet over nothing, as a floor: it sits on it as on a box)
  const pr = P.surface((u, v) => [(u - 0.5) * 40, 0, (v - 0.5) * 40], 16, 16, 0.4, 0, 0.8, [0, 1, 0]);
  const a = rest(on([L.box([0, -5, 0], [200, 5, 200], 0, 0)])), b = rest(on(pr.shapes));
  assert.ok(Math.abs(a.com[1] - b.com[1]) < 0.3, `on a sheet as on a box: ${a.com[1].toFixed(2)} vs ${b.com[1].toFixed(2)}`);
  assert.ok(b.R[4] > 0.98 && speed(b) < 1 && Math.abs(b.volume() / b.restVolume - 1) < 0.03, 'upright, still, its volume kept');
  // (thin: a towel's thickness, dropped on from high, not fallen through)
  const thin = P.surface((u, v) => [(u - 0.5) * 40, 10, (v - 0.5) * 40], 20, 20, 0.3, 0, 1, [0, 1, 0]);
  const d = new B.Dumpling([0, 60, 0], 'dough');
  let low = Infinity;
  run(d, on(thin.shapes), 2.5, () => { low = Math.min(low, d.com[1]); });
  assert.ok(low > 10.5 && d.com[1] > 11, `a thin sheet holds a long drop: lowest ${low.toFixed(2)}`);
  // (a ramp of 20°, gripping: it stays where it's put)
  const ramp = P.surface((u, v) => [(u - 0.5) * 40, (v - 0.5) * 40 * Math.tan(0.35), (v - 0.5) * 40], 16, 16, 0.4, 0, 0.8, [0, 1, 0]);
  const e = new B.Dumpling([0, L.REST_H + 0.6, 0], 'dough');
  run(e, on(ramp.shapes), 3);
  assert.ok(Math.abs(e.com[2]) < 2.5, `holds on a 20° ramp: slid ${e.com[2].toFixed(2)}`);
  // (a spoon's bowl: dropped into, it stays in)
  const sp = P.spoon([0, 0, 0], 0, 28, 9);
  const f = new B.Dumpling([0.6, 9, -0.5], 'dough');
  run(f, on([L.box([0, -5, 0], [200, 5, 200], 0, 0), ...sp.shapes]), 2.5);
  assert.ok(Math.hypot(f.com[0], f.com[2]) < 3.5 && f.com[1] > 1.5, `the bowl keeps it: at ${f.com.map((v) => v.toFixed(1))}`);
  // (a towel's hanging side: thrown at it, it holds a while, gripping linen)
  const hang = P.surface((u, v) => [(v - 0.5) * 30, u * 30, 0], 12, 12, 0.3, 0, 1, [0, 0, -1]);
  hang.shapes[0].tack = 2; hang.shapes[0].tire = 0.6;
  const g = new B.Dumpling([0, 15, -12], 'dough');
  g.flick([0, 30, 110]);
  let held = 0;
  run(g, on(hang.shapes), 5, () => { if (g.contacts > 0 && g.onWall) held += DT; });
  assert.ok(held > 1.2 && held < 4.5, `it clings to the towel's side a while, then lets go: ${held.toFixed(2)} s`);
  console.log(`sheets ok: on a sheet at ${b.com[1].toFixed(2)}, clung ${held.toFixed(2)} s`);
}

// ─── touched: a poke where it's poked, a hold that draws the dough out ───────────────────────────
{
  const nearest = (d, p) => { let b = 0, bd = 1e9; for (let i = 0; i < d.n; i++) { const dd = Math.hypot(d.x[i * 3] - p[0], d.x[i * 3 + 1] - p[1], d.x[i * 3 + 2] - p[2]); if (dd < bd) { bd = dd; b = i; } } return b; };
  const poked = (dir) => {
    const d = new B.Dumpling([0, L.REST_H + 0.3, 0], 'dough'); run(d, flat, 1);
    const i = nearest(d, [d.com[0] - dir[0] * 5, d.com[1] - dir[1] * 5, d.com[2] - dir[2] * 5]);
    d.poke([d.x[i * 3], d.x[i * 3 + 1], d.x[i * 3 + 2]], dir);
    let dent = 0; run(d, flat, 0.2, () => { dent = Math.max(dent, d.deform); });
    run(d, flat, 2.5);
    return { went: Math.hypot(d.com[0], d.com[2]), along: d.com[2], dent, up: d.R[4] };
  };
  const side = poked([0, 0, 1]), top = poked([0, -1, 0]);
  assert.ok(side.along > 4 && side.went < 14 && side.dent > 0.1, `poked at its back, it rolls on a little, dented: ${JSON.stringify(side)}`);
  assert.ok(top.went < 1 && top.dent > 0.1 && top.up > 0.95, `poked from above, it dents where it is: ${JSON.stringify(top)}`);
  const d = new B.Dumpling([0, L.REST_H + 0.3, 0], 'dough'); run(d, flat, 1);
  d.grab = { w: d.hold(nearest(d, [0, d.com[1], -5])), pull: [0, 0.6, -3] };
  run(d, flat, 1);
  let out = -1e9; for (let j = 0; j < d.n; j++) out = Math.max(out, -d.x[j * 3 + 2]);
  assert.ok(out > 5 && Math.hypot(d.com[0], d.com[2]) < 0.6, `held and pulled, the dough's drawn out where it's held, the rest stays: out to ${out.toFixed(2)}`);
  d.grab = null; run(d, flat, 1.5);
  out = -1e9; for (let j = 0; j < d.n; j++) out = Math.max(out, -d.x[j * 3 + 2]);
  assert.ok(out < 4.2, `let go, it comes back: ${out.toFixed(2)}`);
  console.log('touch ok');
}

// ─── hung from honey it droops; aimed into the jar it climbs up and over onto its top ───────────
for (const kind of ['dough', 'jelly']) {
  const tw = L.tower('honey', [0, 20, 0], 6.5, 0, () => 0.5);
  const lv = { n: 0, chapter: 'stove', towers: [tw], sticks: [], movers: [], kill: -50, ground: 0, decor: [], shapes: [L.box([0, -5, 0], [400, 5, 400], 0, 0), ...tw.shapes] };
  const top = tw.shapes[1].c[1] + tw.shapes[1].hh;
  const d = new B.Dumpling([0, 20, -30], kind);
  d.flick([0, 150, 110]);
  run(d, lv, 2.5);
  let lo = 1e9, hi = -1e9, py = 0, m = 0;
  for (let i = 0; i < d.n; i++) { lo = Math.min(lo, d.x[i * 3 + 1]); hi = Math.max(hi, d.x[i * 3 + 1]); }
  for (let i = 0; i < d.n; i++) if (d.pin[i]) { py += d.x[i * 3 + 1]; m++; }
  assert.ok(d.clinging && d.limp > 0.8, `${kind} clings, limp`);
  assert.ok(hi - lo > 5.6 && hi - lo < 11 && d.com[1] < py / m - 0.5, `${kind} droops from where it's stuck: ${(hi - lo).toFixed(1)} tall, its middle ${(py / m - d.com[1]).toFixed(1)} below the patch`);
  const c = L.climbAim(lv, d.com, d.wallN, 0);
  assert.ok(c, `${kind}: a climb onto the jar`);
  d.flick(L.climbLaunch(c.power), 0, d.wallN);
  run(d, lv, 3);
  assert.ok(Math.hypot(d.com[0] - tw.jar.c[0], d.com[2] - tw.jar.c[2]) < 6.5 && d.com[1] > top && d.R[4] > 0.9, `${kind} climbed up and over onto the jar's top: at ${d.com.map((v) => v.toFixed(1))}`);
  console.log(`${kind} climb ok: droop ${(hi - lo).toFixed(1)} tall; up and over at power ${c.power.toFixed(2)}`);
}

// ─── levels ───────────────────────────────────────────────────────────────────────────────────
{
  const kinds = new Set();
  for (let n = 1; n <= 24; n++) {
    const a = C.buildLevel(n), b = C.buildLevel(n);
    assert.deepEqual(a.towers.map((t) => [t.top, t.at, t.r]), b.towers.map((t) => [t.top, t.at, t.r]), `level ${n} is the same each time`);
    assert.ok(['start', 'pad'].includes(a.towers[0].top));
    assert.equal(a.towers.at(-1).top, 'goal');
    assert.ok(a.towers.length >= 6, `level ${n}: ${a.towers.length} tops`);
    for (const t of a.towers) kinds.add(t.top);
    // (every hop: from the middle of each top, a flick that lands on the next)
    for (let k = 1; k < a.towers.length; k++) assert.ok(L.hop(a, k - 1, k), `level ${n}: hop ${k - 1}→${k} can be made`);
    // (no safe ground anywhere: the table's or the counter's top is the fall, and every spot's well up off it)
    assert.ok(a.kill > 3 && a.towers.every((t) => t.at[1] > a.kill + 8), `level ${n}: its top's the fall, every spot well above it`);
  }
  for (const k of ['steamer', 'plate', 'board', 'pudding', 'susan', 'tin', 'butter', 'honey', 'lid', 'pan', 'pad', 'spoon', 'bench', 'paddle', 'tilt', 'boule', 'tray', 'stand', 'bin', 'shelf', 'jelly', 'sponge', 'soap', 'drainer', 'rack', 'sill']) assert.ok(kinds.has(k), `a ${k} somewhere`);
  // (several levels to a place, and each laid fresh: no two alike, and the next in a place not the last again)
  for (const [n, ch] of [[1, 'table'], [4, 'table'], [5, 'counter'], [8, 'counter'], [9, 'sink'], [12, 'sink'], [13, 'stove'], [16, 'stove'], [17, 'mixed']]) assert.equal(C.buildLevel(n).chapter, ch, `level ${n} is at ${ch}`);
  { const seqs = new Map(); for (let n = 1; n <= 24; n++) { const q = C.buildLevel(n).towers.map((t) => t.top).join(' '); assert.ok(!seqs.has(q), `level ${n} is laid as level ${seqs.get(q)} was`); seqs.set(q, n); }
    for (let n = 1; n < 16; n++) { if (C.buildLevel(n).chapter !== C.buildLevel(n + 1).chapter) continue; const a = C.buildLevel(n).towers.map((t) => t.top), b = C.buildLevel(n + 1).towers.map((t) => t.top); const same = a.filter((t, k) => b[k] === t).length; assert.ok(same <= Math.max(3, a.length * 0.45), `levels ${n} and ${n + 1} too alike: ${a.join(' ')} / ${b.join(' ')}`); } }
  // (each place's first level: what it's known by. The table, a spoon and a towel; the counter, its shelf reached by a towel; the sink, bubbles, and its sill reached by the dishcloth)
  const t1 = C.buildLevel(1);
  assert.ok(t1.ground < -50 && t1.decor.length > 0, 'a table, with legs, over a floor');
  assert.ok(t1.shapes.some((sh) => sh.kind === 'sheet' && sh.mat === L.MAT.spoon) && t1.shapes.some((sh) => sh.kind === 'sheet' && sh.mat === L.MAT.towel), 'a spoon and a towel');
  assert.ok(C.buildLevel(5).towers.some((t) => t.wall && t.top === 'shelf'), 'a shelf on the counter, reached by its towel');
  for (let n = 5; n <= 8; n++) assert.ok(C.buildLevel(n).towers.every((t) => !['butter', 'honey', 'lid', 'pan'].includes(t.top)), `level ${n}: the counter has none of the stove's things`);
  { const s9 = C.buildLevel(9); assert.ok(s9.towers.some((t) => t.wall && t.top === 'sill') && s9.shapes.some((sh) => sh.mat === L.MAT.bubble && sh.bounce > 0.5), 'the sink: bubbles, a sill reached by its dishcloth'); }
  assert.ok(C.buildLevel(15).movers.length > 0, 'level 15 has a lid');
  const dusts = new Set(); for (let n = 1; n <= 16; n++) for (const sh of C.buildLevel(n).shapes) if (sh.dust) dusts.add(sh.dust);
  for (const k of [L.DUST.flour, L.DUST.butter, L.DUST.crumbs, L.DUST.pepper, L.DUST.sprinkles]) assert.ok(dusts.has(k), `something with ${k} on it, in the first sixteen levels`);
  // (what things stand on: each kind of support turns up, and the steamers are one among them)
  { const mats = new Set(), tops = new Set(); let onCounter = 0, all = 0;
    for (let n = 7; n <= 16; n++) for (const t of C.buildLevel(n).towers) { all++; tops.add(t.top); for (const sh of t.shapes) mats.add(`${sh.kind}:${sh.mat}`); if (t.shapes.every((sh) => sh.lo[1] < 0.5 ? sh.mat === L.MAT.tin || sh.mat === L.MAT.jar || sh.mat === L.MAT.bamboo || sh.mat === L.MAT.gold || sh.mat === L.MAT.pot : true) && !t.jar && t.top !== 'bin') onCounter++; }
    for (const [what, k] of [['a stool or a crate', `cap:${L.MAT.board}`], ['cookbooks', `box:${L.MAT.book}`], ['an upturned bowl or a cooling rack', `cap:${L.MAT.steel}`], ['a cake stand', `cyl:${L.MAT.porcelain}`]]) assert.ok(mats.has(k), `somewhere, ${what}`);
    assert.ok(tops.has('stand') && tops.has('rack'), 'somewhere, a tiered stand and a bare rack to land on');
    assert.ok(onCounter < all * 0.35, `most things stand on something: ${onCounter} of ${all} on tins or the counter`); }
  { const lv = C.bench('supports'); for (let k = 1; k < lv.towers.length; k++) assert.ok(L.hop(lv, k - 1, k), `the supports bench: hop ${k - 1}→${k}`); }
  console.log('levels ok');
}

// ─── flicked by the book (to the middle of the band, from where it sits), it gets home ─────────
{
  for (const [kind, n] of Array.from({ length: 16 }, (_, i) => i + 1).flatMap((n) => [['jelly', n], ['dough', n]]).filter(([k, n]) => k === 'jelly' || n % 2)) {
    const lv = C.buildLevel(n);
    const s = lv.towers[0].at;
    const d = new B.Dumpling([s[0], s[1] + L.REST_H + 2, s[2]], kind);
    let home = -1, still = 0, check = 0, falls = 0;
    for (let t = 0; t < 150 && home < 0; t += DT) {
      d.step(lv, DT, t);
      // (fallen: back to the last spot, as in play; a fall or two's allowed, more says a hop that doesn't hold)
      if (d.com[1] < lv.kill) { falls++; assert.ok(falls <= 2, `${kind}: level ${n}: ${falls} falls (at ${t.toFixed(1)} s)`); const a = lv.towers[check].at; d.place([a[0], a[1] + L.REST_H + 2, a[2]]); still = 0; continue; }
      const k = L.towerAt(lv, d.com, 1);
      if (k >= 0 && d.contacts > 0 && speed(d) < 30) check = Math.max(check, k);
      still = Math.hypot(...d.drift.map((v, i) => v - L.carried(lv, d.com)[i])) < 6 && d.sinceContact < 0.12 ? still + DT : 0;
      if (k === lv.towers.length - 1 && still > 0.4) { home = t; break; }
      // (off any top, on the table: on from the last it stood on; past home, off it: back on to it)
      const near = k >= 0 ? k : L.towerAt(lv, d.com, 4), on = near >= 0 ? near : check, at = on === lv.towers.length - 1 && k !== on ? on - 1 : on;
      if (still > 0.35 && d.canFlick && at >= 0 && at < lv.towers.length - 1) {
        const a = L.autoFlick(lv, d.com, at, t, d.coated[L.DUST.butter], d.clinging ? d.wallN : null);
        if (a) { d.flick(a.climb ? L.climbLaunch(a.power) : L.launch(a.yaw, a.power), 0, a.climb ?? null); still = 0; }
      }
    }
    assert.ok(home >= 0, `${kind}: level ${n} home`);
    console.log(`${kind}: level ${n} home in ${home.toFixed(1)} s${falls ? `, ${falls} fall${falls > 1 ? 's' : ''}` : ''}`);
  }
}
// ─── the breakfast counter: stations over a fall; each way through it gets home, for either dumpling ──
{
  const WAYS = { 'by the tray': [0, 1, 2, 4, 5, 6, 7], 'by the bread bin': [0, 3, 4, 5, 6, 7] };
  for (const [a, b] of C.BREAKFAST_WAYS) assert.ok(L.hop(C.bench('breakfast'), a, b), `the breakfast counter: a way from ${a} to ${b}`);
  // (no safe ground: every spot's well above the counter, which is the fall)
  { const lv = C.bench('breakfast'); assert.ok(lv.towers.every((t) => t.at[1] > lv.kill + 8), 'the breakfast counter: every spot well above the fall'); }
  for (const kind of ['jelly', 'dough']) for (const [name, r] of Object.entries(WAYS)) {
    const lv = C.bench('breakfast');
    // (the autopilot kept to this way: from each spot on it, the next on it)
    lv.next = lv.towers.map((_, k) => { const i = r.indexOf(k); return i >= 0 && i < r.length - 1 ? r[i + 1] : r[r.length - 1]; });
    const s = lv.towers[0].at;
    const d = new B.Dumpling([s[0], s[1] + L.REST_H + 2, s[2]], kind);
    let home = -1, still = 0, check = 0, falls = 0;
    for (let t = 0; t < 90 && home < 0; t += DT) {
      d.step(lv, DT, t);
      // (fallen: back to the last spot it stood on, as in play)
      if (d.com[1] < lv.kill) { falls++; const a = lv.towers[check].at; d.place([a[0], a[1] + L.REST_H + 2, a[2]]); still = 0; continue; }
      const k = L.towerAt(lv, d.com, 1);
      if (k >= 0 && d.contacts > 0 && speed(d) < 30) check = k;
      still = Math.hypot(...d.drift.map((v, i) => v - L.carried(lv, d.com)[i])) < 6 && d.sinceContact < 0.12 ? still + DT : 0;
      if (k === lv.towers.length - 1 && still > 0.4) { home = t; break; }
      const near = k >= 0 ? k : L.towerAt(lv, d.com, 4), on = near >= 0 ? near : check, at = on === lv.towers.length - 1 && k !== on ? on - 1 : on;
      if (still > 0.35 && d.canFlick && at >= 0 && at < lv.towers.length - 1) {
        const a = L.autoFlick(lv, d.com, at, t, d.coated[L.DUST.butter], d.clinging ? d.wallN : null);
        if (a) { d.flick(a.climb ? L.climbLaunch(a.power) : L.launch(a.yaw, a.power), 0, a.climb ?? null); still = 0; }
      }
    }
    assert.ok(home >= 0, `${kind}: the breakfast counter, ${name}, home`);
    console.log(`${kind}: the breakfast counter, ${name}, home in ${home.toFixed(1)} s${falls ? `, ${falls} falls` : ''}`);
  }
}
console.log('squishy ok');
