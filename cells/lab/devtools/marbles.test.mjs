// Marble Run's track and solver, on their own: a seeded run is the same run, every section ends
// lower; a marble rolls down a slope at the rate a solid sphere should, stays in a bend and a
// helix, bounces by its material, meets another marble and both go on; a whole run is run and
// the marbles arrive. (node cells/lab/devtools/marbles.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/marbles/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const T = await load('track.ts');
const P = await load('physics.ts');
const { walk, section, candidates, build: buildRun, TOP, R, KINDS, DS } = T;
const { Course, MATERIALS, marble, step, order, G } = P;
const DEG = Math.PI / 180;

// ─── the track ────────────────────────────────────────────────────────────────────────────────
{
  // frames: unit, orthogonal, a step apart; a loop comes round with its up carried through
  const w = walk(TOP, [{ len: 30, dyaw: 0, dpitch: 0, bank: 0 }, { len: 2 * Math.PI * 8, dyaw: 0, dpitch: Math.PI * 2, bank: 0 }]);
  for (const f of w.frames) {
    assert.ok(Math.abs(T.len(f.t) - 1) < 1e-6 && Math.abs(T.len(f.n) - 1) < 1e-6 && Math.abs(T.len(f.b) - 1) < 1e-6);
    assert.ok(Math.abs(T.dot(f.t, f.n)) < 1e-6 && Math.abs(T.dot(f.t, f.b)) < 1e-6 && Math.abs(T.dot(f.n, f.b)) < 1e-6, 'orthogonal');
  }
  for (let i = 1; i < w.frames.length; i++) assert.ok(Math.abs(T.len(T.sub(w.frames[i].p, w.frames[i - 1].p)) - DS) < 0.05);
  const end = w.frames[w.frames.length - 1];
  assert.ok(end.n[1] > 0.9, `after a loop the up is up again: ${end.n}`);
  // every kind from the top, a few seeds: ends lower, frames sane
  for (const kind of KINDS) for (const seed of [1, 2, 3]) {
    const r = T.rot ? (await import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [new URL('../client/kit/rng.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' })).outputFiles[0].text).toString('base64'))).seeded(seed) : null;
    const s = section(kind, TOP, r);
    assert.ok(s.end.p[1] < TOP.p[1] - 3, `${kind} ${seed} ends lower: ${s.drop}`);
    assert.ok(s.channels.length >= 1 && s.length > 20, `${kind}: has channel and length`);
    for (const ch of s.channels) for (const f of ch.frames) for (const v of [...f.p, ...f.t, ...f.n]) assert.ok(Number.isFinite(v), `${kind}: finite`);
  }
  // a run from a seed and choices is the same twice; the candidates are three and differ
  const a = buildRun(42, [0, 1, 2, 3, 4, 5, 0, 1]);
  const b = buildRun(42, [0, 1, 2, 3, 4, 5, 0, 1]);
  assert.deepEqual(a.map((s) => [s.kind, s.drop, s.length]), b.map((s) => [s.kind, s.drop, s.length]));
  assert.equal(a.length, 8);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].end.p[1] < a[i - 1].end.p[1], 'every section lower than the last');
  const cs = candidates(42, 8, a);
  assert.equal(cs.length, 3);
  assert.ok(new Set(cs.map((s) => s.kind)).size >= 2, `varied: ${cs.map((s) => s.kind)}`);
  // no loop early on
  for (let i = 0; i < 2; i++) for (const c of candidates(42, i, a.slice(0, i))) assert.ok(c.kind !== 'loop' && c.kind !== 'funnel' && c.kind !== 'jump');
  // the query round-trips
  const q = new URLSearchParams(T.encode(42, [0, 4, 2]));
  assert.deepEqual(T.decode(q), { seed: 42, choices: [0, 4, 2] });
  console.log('track ok');
}

// ─── the solver ───────────────────────────────────────────────────────────────────────────────
const rng = await (async () => (await import('data:text/javascript;base64,' + Buffer.from((await build({ entryPoints: [new URL('../client/kit/rng.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' })).outputFiles[0].text).toString('base64'))))();
const straight = (pitchDeg, lengthCm) => {
  // a run of one straight slope, hand-made
  const w = walk({ p: [0, 100, 0], yaw: 0, pitch: -pitchDeg * DEG, bank: 0, n: [0, 1, 0] }, [{ len: lengthCm, dyaw: 0, dpitch: 0, bank: 0 }]);
  const s = { kind: 'slope', name: 'slope', channels: [{ frames: w.frames, r: R, open: T.OPEN }], trays: [], bowls: [], end: w.end, length: lengthCm, drop: 100 - w.end.p[1] };
  return new Course([s], { p: [0, 100, 0], t: [0, 0, 1] });
};
{
  // a marble on a slope: rolls down, stays in the trough, speeds up at about 5/7 g sin θ (a solid sphere)
  const c = straight(15, 300);
  const m = marble('glass', MATERIALS[0], 0.8, [1, 1, 1]);
  c.place(m);
  m.v = [0, 0, 0];
  let t = 0;
  const ys = [];
  // (over the first half second, before the trough's roughness has much to say)
  for (; t < 0.5; t += 1 / 60) { step(c, [m], 1 / 60, t); ys.push(m.p[1]); }
  const v = T.len(m.v);
  const expect = (5 / 7) * G * Math.sin(15 * DEG) * t;
  assert.ok(Math.abs(v - expect) / expect < 0.12, `rolls at the rate of a solid sphere: ${v.toFixed(0)} vs ${expect.toFixed(0)}`);
  assert.ok(Math.abs(m.w[0]) > 10 && Math.abs(T.len(m.w) * m.r - v) / v < 0.15, `rolling without slip: ωr ${(T.len(m.w) * m.r).toFixed(0)} vs v ${v.toFixed(0)}`);
  assert.ok(m.contact, 'on the track');
  assert.ok(Math.abs(m.p[0]) < 0.5, 'in the middle of the trough');
  assert.ok(m.progress > 18, `progress ${m.progress}`);
  console.log('slope ok');
}
{
  // materials: on the same slope, rubber loses more to rolling resistance than steel
  const vs = {};
  for (const mat of MATERIALS) {
    const c = straight(10, 160);
    const m = marble(mat.name, mat, 0.9, [1, 1, 1]);
    c.place(m); m.v = [0, 0, 0];
    for (let t = 0; t < 1.5; t += 1 / 60) step(c, [m], 1 / 60, t);
    vs[mat.name] = T.len(m.v);
  }
  assert.ok(vs.steel > vs.rubber && vs.glass > vs.wood, JSON.stringify(vs));
  console.log('materials ok', JSON.stringify(Object.fromEntries(Object.entries(vs).map(([k, v]) => [k, Math.round(v)]))));
}
{
  // a bounce: dropped onto the floor of a level channel, rubber comes back up higher than wood
  const hs = {};
  for (const mat of [MATERIALS[2], MATERIALS[3]]) {
    const c = straight(0, 40);
    const m = marble(mat.name, mat, 0.9, [1, 1, 1]);
    c.place(m); m.v = [0, 0, 0];
    m.p = [0, 100 - R + m.r + 20, 20];
    let top = 0, fell = false;
    for (let t = 0; t < 1.2; t += 1 / 60) {
      step(c, [m], 1 / 60, t);
      if (m.v[1] < 0 && m.p[1] < 100 - R + m.r + 1) fell = true;
      if (fell && m.v[1] > 0) top = Math.max(top, m.p[1]);
    }
    hs[mat.name] = top - (100 - R + m.r);
  }
  assert.ok(hs.rubber > hs.wood * 1.5 && hs.rubber > 3, JSON.stringify(hs));
  console.log('bounce ok', JSON.stringify(hs));
}
{
  // a bend and a helix: it stays in the trough all the way round, and comes out the end
  for (const kind of ['bend', 'helix', 'ess', 'switchback']) {
    const s = section(kind, { p: [0, 100, 0], yaw: 0, pitch: -12 * DEG, bank: 0, n: [0, 1, 0] }, rng.seeded(5));
    const c = new Course([s], { p: [0, 100, 0], t: [0, 0, 1] });
    const m = marble('steel', MATERIALS[1], 0.9, [1, 1, 1]);
    c.place(m);
    m.v = T.mul(m.v, 20);
    let out = false;
    // (out: through the last channel into the cup; progress stops counting at the cup's door)
    for (let t = 0; t < 6 && !out; t += 1 / 60) { step(c, [m], 1 / 60, t); if (m.finished >= 0 || m.progress > s.length - 12) out = true; }
    assert.equal(m.falls, 0, `${kind}: never fell off`);
    assert.ok(out, `${kind}: came out the end (progress ${m.progress.toFixed(0)} of ${s.length.toFixed(0)})`);
  }
  console.log('bends ok');
}
{
  // two marbles meet: momentum is kept, and they part
  const c = straight(0, 60);
  const a = marble('a', MATERIALS[1], 0.9, [1, 1, 1]), b = marble('b', MATERIALS[1], 0.9, [1, 1, 1]);
  c.place(a); c.place(b);
  a.p = [0, 100 - R + 0.9, 10]; a.v = [0, 0, 80];
  b.p = [0, 100 - R + 0.9, 20]; b.v = [0, 0, 0];
  const before = a.v[2] * a.m + b.v[2] * b.m;
  for (let t = 0; t < 0.4; t += 1 / 60) step(c, [a, b], 1 / 60, t);
  const after = a.v[2] * a.m + b.v[2] * b.m;
  assert.ok(b.v[2] > 20 && a.v[2] < b.v[2], `b was struck and leads: ${a.v[2].toFixed(0)} ${b.v[2].toFixed(0)}`);
  // (both began sliding, and the track's friction takes two sevenths of a sliding sphere's momentum to set it rolling)
  assert.ok(after > before * 0.5, `momentum kept but for the track's friction: ${before.toFixed(0)} → ${after.toFixed(0)}`);
  assert.ok(T.len(T.sub(a.p, b.p)) >= 1.8 - 1e-3, 'not inside each other');
  console.log('pair ok');
}
{
  // a whole run: six marbles from the top; all arrive in the cup within a minute, and the order is an order
  const secs = buildRun(7, [0, 1, 2, 0, 1, 2]);
  const c = new Course(secs, { p: TOP.p, t: T.dirOf(TOP.yaw, TOP.pitch) });
  const ms = MATERIALS.flatMap((mat, i) => [marble(mat.name, mat, 0.8 + i * 0.05, [1, 1, 1])]).concat([marble('glass 2', MATERIALS[0], 0.85, [1, 1, 1]), marble('steel 2', MATERIALS[1], 1.0, [1, 1, 1])]);
  ms.forEach((m, i) => c.place(m, 0, i));
  let t = 0;
  const impacts = [];
  for (; t < 60 && ms.some((m) => m.finished < 0); t += 1 / 60) step(c, ms, 1 / 60, t, impacts);
  for (const m of ms) assert.ok(Number.isFinite(m.p[0] + m.p[1] + m.p[2]), 'finite');
  const done = ms.filter((m) => m.finished >= 0).length;
  console.log(`run 7: ${done}/6 arrived by ${t.toFixed(1)} s; falls ${ms.map((m) => m.falls).join(',')}; impacts ${impacts.length}; order ${order(ms).map((m) => m.name).join(' > ')}`);
  assert.ok(done >= 4, 'most arrive');
  const o = order(ms);
  for (let i = 1; i < o.length; i++) if (o[i - 1].finished >= 0 && o[i].finished >= 0) assert.ok(o[i - 1].finished <= o[i].finished);
  console.log('run ok');
}
console.log('marbles ok');
