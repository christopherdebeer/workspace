// Marble Run's track and solver, on their own: a seeded run is the same run, every board ends
// lower; a marble rolls down a board at the rate a solid sphere should, a wall turns it, a peg
// bounces it, a spinner flings it, it bounces by its material, meets another marble and both
// go on; a whole run of twelve is run and they cross the line. (node cells/lab/devtools/marbles.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const T = await load('../client/marbles/track.ts');
const P = await load('../client/marbles/physics.ts');
const rng = await load('../client/kit/rng.ts');
const { section, candidates, build: buildRun, TOP, KINDS, WIDTH, frameAt } = T;
const { Course, MATERIALS, marble, step, order, G } = P;
const DEG = Math.PI / 180;

// ─── the track ────────────────────────────────────────────────────────────────────────────────
{
  for (const kind of KINDS) for (const seed of [1, 2, 3]) {
    const s = section(kind, TOP, rng.seeded(seed));
    assert.ok(s.end.p[1] < TOP.p[1] - 5, `${kind} ${seed} ends lower: ${s.drop}`);
    assert.ok(s.boards.length >= 1 && s.boards.length <= 3, `${kind}: boards`);
    for (const bb of s.boards) assert.ok(bb.width > 12 && bb.length > 5, `${kind}: a board of a sane size`);
    const b = s.boards[0];
    assert.equal(b.width, WIDTH);
    for (const w of b.walls) for (const v of [...w.a, ...w.b]) assert.ok(Number.isFinite(v));
    // (walls and pegs inside the board, and not in the first few centimetres)
    for (const w of b.walls) for (const pt of [w.a, w.b]) assert.ok(pt[0] >= 0 && pt[0] <= b.length + 1 && Math.abs(pt[1]) <= WIDTH / 2 + 0.01, `${kind}: wall in the board ${pt}`);
    for (const [a, c] of b.pegs) assert.ok(a > 5 && a < b.length && Math.abs(c) < WIDTH / 2 - 1, `${kind}: peg in the board`);
  }
  const a = buildRun(42, [0, 1, 2, 3, 4, 5, 0, 1]);
  const b = buildRun(42, [0, 1, 2, 3, 4, 5, 0, 1]);
  assert.deepEqual(a.map((s) => [s.kind, s.drop, s.length]), b.map((s) => [s.kind, s.drop, s.length]));
  for (let i = 1; i < a.length; i++) assert.ok(a[i].end.p[1] < a[i - 1].end.p[1]);
  // (no back wall at the top: the field rests against the gate, and the run can be seen from behind)
  assert.ok(!a[0].boards[0].backWall && !a[1].boards[0].backWall, 'no back wall at the top');
  const cs = candidates(42, 8, a);
  assert.equal(cs.length, 3);
  assert.ok(new Set(cs.map((s) => s.kind)).size >= 2);
  assert.deepEqual(T.decode(new URLSearchParams(T.encode(42, [0, 4, 2]))), { seed: 42, choices: [0, 4, 2] });
  console.log('track ok');
}

// ─── the solver ───────────────────────────────────────────────────────────────────────────────
/** a run of one open board, hand-made, so long, so steep */
const board = (pitchDeg, lengthCm, extra = {}) => {
  const frame = frameAt([0, 100, 0], 0, -pitchDeg * DEG);
  const bd = { frame, width: WIDTH, length: lengthCm, slope: -pitchDeg * DEG, walls: [], pegs: [], spinners: [], backWall: true, step: 0, ...extra };
  const end = T.add(frame.p, T.mul(frame.t, lengthCm));
  const s = { kind: 'open', name: 'open', boards: [bd], end: { p: end, yaw: 0, pitch: -pitchDeg * DEG }, length: lengthCm, drop: 100 - end[1] };
  return new Course([s], { p: [0, 100, 0], yaw: 0, pitch: -pitchDeg * DEG });
};
{
  // on a slope: rolls down, stays on the floor, speeds up at about 5/7 g sin θ (a solid sphere), rolling without slip
  const c = board(15, 300);
  const m = marble('glass', MATERIALS[0], 0.8, [1, 1, 1]);
  c.place(m, 0, 5);
  let t = 0;
  for (; t < 0.5; t += 1 / 60) step(c, [m], 1 / 60, t);
  const v = T.len(m.v);
  const expect = (5 / 7) * G * Math.sin(15 * DEG) * t;
  assert.ok(Math.abs(v - expect) / expect < 0.12, `rolls at the rate of a solid sphere: ${v.toFixed(0)} vs ${expect.toFixed(0)}`);
  assert.ok(Math.abs(T.len(m.w) * m.r - v) / v < 0.15, `rolling without slip: ωr ${(T.len(m.w) * m.r).toFixed(0)} vs v ${v.toFixed(0)}`);
  assert.ok(m.contact && m.progress > 18, `on the board, ${m.progress.toFixed(0)} along`);
  console.log('slope ok');
}
{
  // materials: the same slope, steel ahead of rubber, glass ahead of wood
  const vs = {};
  for (const mat of MATERIALS) {
    const c = board(10, 300);
    const m = marble(mat.name, mat, 0.9, [1, 1, 1]);
    c.place(m, 0, 5);
    for (let t = 0; t < 1.5; t += 1 / 60) step(c, [m], 1 / 60, t);
    vs[mat.name] = T.len(m.v);
  }
  assert.ok(vs.steel > vs.rubber && vs.glass > vs.wood, JSON.stringify(vs));
  console.log('materials ok', JSON.stringify(Object.fromEntries(Object.entries(vs).map(([k, v]) => [k, Math.round(v)]))));
}
{
  // a bounce: dropped onto a level board, rubber comes back up higher than wood
  const hs = {};
  for (const mat of [MATERIALS[2], MATERIALS[3]]) {
    const c = board(0, 60);
    const m = marble(mat.name, mat, 0.9, [1, 1, 1]);
    c.place(m, 0, 5);
    m.p = [0, 100 + 20, 20];
    let top = 0, fell = false;
    for (let t = 0; t < 1.2; t += 1 / 60) {
      step(c, [m], 1 / 60, t);
      if (m.v[1] < 0 && m.p[1] < 100 + m.r + 1) fell = true;
      if (fell && m.v[1] > 0) top = Math.max(top, m.p[1]);
    }
    hs[mat.name] = top - (100 + m.r);
  }
  // (cardboard is dull: the bounces are small, but rubber's is the bigger)
  assert.ok(hs.rubber > hs.wood * 1.5 && hs.rubber > 0.6, JSON.stringify(hs));
  console.log('bounce ok');
}
{
  // a wall across the way turns a marble; a peg bounces it aside; the side walls keep it in
  const c = board(12, 120, { walls: [{ a: [40, -24], b: [60, 8], thick: 0.5 }] });
  const m = marble('steel', MATERIALS[1], 0.9, [1, 1, 1]);
  c.place(m, 0, 2); // lane 2: left of the middle
  const x0 = T.dot(T.sub(m.p, c.sections[0].boards[0].frame.p), c.sections[0].boards[0].frame.b);
  for (let t = 0; t < 2; t += 1 / 60) step(c, [m], 1 / 60, t);
  const f = c.sections[0].boards[0].frame;
  const across = T.dot(T.sub(m.p, f.p), f.b);
  assert.ok(across > x0 + 6, `turned by the wall: ${x0.toFixed(1)} → ${across.toFixed(1)}`);
  assert.ok(Math.abs(across) < WIDTH / 2, 'kept in');
  assert.equal(m.falls, 0);
  const c2 = board(12, 120, { pegs: [[40, 0, 2]] });
  const m2 = marble('glass', MATERIALS[0], 0.8, [1, 1, 1]);
  c2.place(m2, 0, 5); m2.p = T.add(m2.p, T.mul(c2.sections[0].boards[0].frame.b, -T.dot(T.sub(m2.p, c2.sections[0].boards[0].frame.p), c2.sections[0].boards[0].frame.b) + 0.6));
  for (let t = 0; t < 2; t += 1 / 60) step(c2, [m2], 1 / 60, t);
  const across2 = T.dot(T.sub(m2.p, c2.sections[0].boards[0].frame.p), c2.sections[0].boards[0].frame.b);
  assert.ok(Math.abs(across2) > 3 && m2.progress > 60, `bounced aside by the peg and on: ${across2.toFixed(1)}, ${m2.progress.toFixed(0)} along`);
  console.log('walls ok');
}
{
  // the gate: down, the field comes to rest against it, at rest and none lost off the open top;
  // lifted, they go
  const secs = buildRun(21, [0, 1, 2]);
  const c = new Course(secs, TOP);
  c.gateClosed = true;
  const ms = Array.from({ length: 12 }, (_, i) => marble(`m${i}`, MATERIALS[0], 0.8, [1, 1, 1]));
  ms.forEach((m, i) => c.place(m, 0, i));
  for (let t = 0; t < 3; t += 1 / 60) step(c, ms, 1 / 60, 0);
  const bd = secs[0].boards[0];
  const alongs = ms.map((m) => T.toLocal(bd, m.p)[0]);
  assert.ok(ms.every((m) => T.len(m.v) < 3), `at rest behind the gate: ${ms.map((m) => T.len(m.v).toFixed(1))}`);
  assert.ok(alongs.every((a) => a > 3 && a < 6), `against the gate: ${alongs.map((a) => a.toFixed(1))}`);
  assert.equal(ms.reduce((a, m) => a + m.falls + m.nudges, 0), 0, 'none lost, none nudged');
  c.gateClosed = false;
  for (let t = 0; t < 1.5; t += 1 / 60) step(c, ms, 1 / 60, t);
  assert.ok(ms.every((m) => T.toLocal(bd, m.p)[0] > 20 || m.sec > 0), 'and off when it lifts');
  console.log('gate ok');
}
{
  // a bend: the board turns, the marble follows it round and comes out heading the new way
  const secs = [section('bend', TOP, rng.seeded(5))];
  const bd = secs[0].boards[0];
  assert.ok(Math.abs(bd.turn) > 0.5, `turns: ${bd.turn}`);
  assert.ok(Math.abs(secs[0].end.yaw - TOP.yaw - bd.turn) < 1e-9, 'ends turned by its turn');
  // (the geometry round-trips: a point placed on the board is found at the same place)
  for (const [a, u, c] of [[10, 0.8, -12], [50, 0.8, 0], [80, 2, 20]]) {
    const [a2, u2, c2] = T.toLocal(bd, T.toWorld(bd, a, u, c));
    assert.ok(Math.abs(a - a2) < 1e-3 && Math.abs(u - u2) < 1e-3 && Math.abs(c - c2) < 1e-3, `round trip ${[a, u, c]} → ${[a2, u2, c2]}`);
  }
  const c = new Course(secs, TOP);
  const ms = Array.from({ length: 12 }, (_, i) => marble(`m${i}`, MATERIALS[0], 0.8, [1, 1, 1]));
  ms.forEach((m, i) => c.place(m, 0, i));
  for (let t = 0; t < 8 && ms.some((m) => m.finished < 0); t += 1 / 60) step(c, ms, 1 / 60, t);
  assert.ok(ms.every((m) => m.finished >= 0), `all round the bend: ${ms.filter((m) => m.finished >= 0).length}/12`);
  assert.equal(ms.reduce((a, m) => a + m.falls, 0), 0, 'nobody off it');
  const lead = order(ms)[0];
  const h = Math.atan2(lead.v[0], lead.v[2]);
  console.log(`bend ok (turn ${(bd.turn * 180 / Math.PI).toFixed(0)}°, out heading ${(h * 180 / Math.PI).toFixed(0)}°)`);
}
{
  // a spinner: its arm meets a marble and flings it; the marble gets past
  const c = board(10, 120, { spinners: [{ at: [40, 0], arms: 4, half: 10, rate: 0.5 }] });
  const m = marble('wood', MATERIALS[2], 1.0, [1, 1, 1]);
  c.place(m, 0, 5);
  let hit = false;
  const impacts = [];
  for (let t = 0; t < 4; t += 1 / 60) { step(c, [m], 1 / 60, t, impacts); if (Math.abs(T.dot(m.v, c.sections[0].boards[0].frame.b)) > 30) hit = true; }
  assert.ok(hit, 'flung sideways by the arm');
  assert.ok(m.progress > 90 || m.finished >= 0, `and got past: ${m.progress.toFixed(0)}`);
  console.log('spinner ok');
}
{
  // two marbles meet: the struck one leads, and they part
  const c = board(0, 80);
  const a = marble('a', MATERIALS[1], 0.9, [1, 1, 1]), b = marble('b', MATERIALS[1], 0.9, [1, 1, 1]);
  c.place(a, 0, 5); c.place(b, 0, 5);
  const f = c.sections[0].boards[0].frame;
  a.p = T.add(a.p, T.mul(f.t, 8)); a.v = T.mul(f.t, 80);
  b.p = T.add(b.p, T.mul(f.t, 20));
  for (let t = 0; t < 0.4; t += 1 / 60) step(c, [a, b], 1 / 60, t);
  assert.ok(T.dot(b.v, f.t) > 20 && T.dot(a.v, f.t) < T.dot(b.v, f.t), 'b was struck and leads');
  assert.ok(T.len(T.sub(a.p, b.p)) >= 1.8 - 1e-3, 'not inside each other');
  console.log('pair ok');
}
{
  // a whole run: twelve from the gate; most cross the line within a minute; the order is an order
  for (const [seed, ch] of [[7, [0, 1, 2, 0, 1, 2]], [21, [0, 1, 2, 0, 1, 2, 0]]]) {
    const secs = buildRun(seed, ch);
    const c = new Course(secs, TOP);
    const ms = Array.from({ length: 12 }, (_, i) => marble(`m${i}`, MATERIALS[i % 4], 0.75 + (i % 3) * 0.1, [1, 1, 1]));
    ms.forEach((m, i) => c.place(m, 0, i));
    let t = 0;
    const impacts = [];
    for (; t < 60 && ms.some((m) => m.finished < 0); t += 1 / 60) step(c, ms, 1 / 60, t, impacts);
    for (const m of ms) assert.ok(Number.isFinite(m.p[0] + m.p[1] + m.p[2]), 'finite');
    const done = ms.filter((m) => m.finished >= 0).length;
    console.log(`run ${seed} (${secs.map((s) => s.kind).join(' ')}): ${done}/12 over the line by ${t.toFixed(1)} s; falls ${ms.reduce((a, m) => a + m.falls, 0)}; impacts ${impacts.length}; first ${order(ms)[0].name}`);
    assert.ok(done >= 10, 'most cross the line');
    assert.ok(ms.reduce((a, m) => a + m.falls, 0) <= 2, 'hardly any fall off');
    const o = order(ms);
    for (let i = 1; i < o.length; i++) if (o[i - 1].finished >= 0 && o[i].finished >= 0) assert.ok(o[i - 1].finished <= o[i].finished);
  }
  console.log('run ok');
}
console.log('marbles ok');
