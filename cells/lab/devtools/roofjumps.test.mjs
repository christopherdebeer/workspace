// Roof Jumps' geometry and runner, on their own: a chunk is the same whenever and in whatever order it's made; every
// box is on the lattice, inside its chunk, and buildings are whole storeys; the mesh is five faces a box; and a runner
// holding a direction (any of sixteen, in several cities) crosses the city in it: it keeps its pace, leaps, climbs,
// never stops for long, never leaves the surface it's standing on. (node cells/lab/devtools/roofjumps.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './city'; export * from './runner'; export * from './rig'; export * from './mesh'; export * from './plan'; export * from './tune';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { plan, foresee, TUNE, HOUSE, DIALS, City, Runner, Rig, CHUNK, STOREY, TAG, VERTEX, chunkMesh, figureMesh, FIGURE } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// the same chunk, whatever was made before it
{
  const a = new City(3), b = new City(3);
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) a.chunk(i, j);
  assert.deepEqual(b.chunk(1, -2).boxes, a.chunk(1, -2).boxes);
  assert.notDeepEqual(new City(4).chunk(1, -2).boxes, a.chunk(1, -2).boxes);
}
// on the lattice, in the chunk, whole storeys; and a street between chunks
{
  const c = new City(1); let n = 0;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const ch = c.chunk(i, j);
    assert.ok(ch.boxes.length > 4, 'a chunk has buildings');
    for (const b of ch.boxes) {
      n++;
      for (const v of [b.x0, b.x1, b.z0, b.z1, b.y0, b.y1]) assert.equal(v, Math.round(v));
      assert.ok(b.x0 < b.x1 && b.z0 < b.z1 && b.y0 < b.y1);
      assert.ok(b.x0 >= i * CHUNK + 1 && b.x1 <= (i + 1) * CHUNK - 1 && b.z0 >= j * CHUNK + 1 && b.z1 <= (j + 1) * CHUNK - 1);
      if (b.tag === TAG.BUILDING) { assert.equal(b.y0, 0); assert.equal(b.y1 % STOREY, 0); }
    }
    assert.equal(chunkMesh(ch).length, (ch.boxes.length * 5 + 1) * 6 * VERTEX);
    assert.equal(c.heightAt(i * CHUNK + 0.5, j * CHUNK + 20), 0);
  }
  console.log(`${n} boxes in 49 chunks (${(n / 49).toFixed(0)} a chunk, ${(n * 10 / 49).toFixed(0)} triangles)`);
}
// A runner carries pace over open routes and can stop at a tall facade.
{
  const DT = 1 / 120, SECONDS = 60;
  let worst = Infinity, leaps = 0, climbs = 0; const moves = {};
  for (const seed of [1, 2, 7, 31]) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI + 0.1, dx = Math.sin(a), dz = Math.cos(a);
    const city = new City(seed), r = new Runner(city), rig = new Rig();
    let stopped = 0, longest = 0, active = 0, travelled = 0;
    for (let i = 0; i < SECONDS / DT; i++) {
      const before = r.dist;
      r.step(DT, { x: dx, z: dz, jump: false }); rig.update(DT, r);
      // A tall wall is a legitimate end to a held line. Retain the stall and
      // pace checks on open ground and verify holding into a wall never climbs.
      const blocked = [0.2, 0.5, 0.9].some(d => city.heightAt(r.x + dx * d, r.z + dz * d) > r.y + 0.6);
      if (!blocked) { active += DT; travelled += r.dist - before; }
      assert.ok(Number.isFinite(r.x + r.y + r.z + r.heading), 'finite');
      const h = city.heightAt(r.x, r.z);
      if (r.state === 'ground') assert.ok(Math.abs(r.y - h) < 1e-6, `stands on the surface (seed ${seed}, dir ${k}, t ${(i * DT).toFixed(2)}: y ${r.y}, surface ${h})`);
      if (r.state === 'air') assert.ok(r.y > h - 0.7, `never inside a building (seed ${seed}, dir ${k}, t ${(i * DT).toFixed(2)}: y ${r.y}, surface ${h})`);
      stopped = !blocked && r.state === 'ground' && r.speed < 1 ? stopped + DT : 0; longest = Math.max(longest, stopped);
      if (i % 600 === 0) city.evict(Math.floor(r.x / CHUNK), Math.floor(r.z / CHUNK), 3);
    }

    assert.ok(longest < 0.5, `never stops for long (seed ${seed}, dir ${k}: ${longest.toFixed(2)}s)`);
    if (active > 1) worst = Math.min(worst, travelled / active);
    assert.equal(r.climbs, 0); leaps += r.leaps; climbs += r.climbs; for (const [m, n] of Object.entries(r.made)) moves[m] = (moves[m] ?? 0) + n;
    const bones = rig.bones(r), o = new Float32Array(FIGURE);
    assert.equal(bones.length, 13); assert.equal(figureMesh(bones, o) * VERTEX, FIGURE);
    assert.ok(o.every(Number.isFinite));
  }
  assert.ok(worst > 5, `makes its way at a run (slowest open-line pace ${worst.toFixed(1)} m/s)`);
  console.log(`64 runs of ${SECONDS}s: slowest open-line pace ${worst.toFixed(1)} m/s; ${leaps} leaps, ${climbs} walls run up`);
  console.log('  moves: ' + Object.entries(moves).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(', '));
  for (const m of ['vault', 'bound', 'flip', 'spring', 'dive', 'glide', 'roll', 'dash', 'wallrun']) assert.ok(moves[m] > 20, `it ${m}s`);
}
// the holds: the same whenever made; each a line on its box (an edge along a top, a sill on a face at a storey, a pipe up
// a face, a rail down the middle of something narrow); the boxes the same with or without them; and what the hands reach
// for is on one of them: up a wall, a sill, a pipe or the top edge, in arm's reach; over a unit, its edge
{
  const a = new City(5), b = new City(5); b.chunk(2, 2); b.chunk(-1, 0);
  assert.deepEqual(a.chunk(0, 1).holds, b.chunk(0, 1).holds);
  const kinds = {};
  for (const h of a.chunk(0, 1).holds) {
    kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
    const mx = (h.ax + h.bx) / 2, mz = (h.az + h.bz) / 2;
    assert.ok(h.hand && h.foot, 'each says what it is for, by hand and by foot');
    if (h.kind === 'pipe') { assert.ok(h.ax === h.bx && h.az === h.bz && h.ay === 0 && h.by > 0); continue; }
    if (h.kind === 'face') { assert.ok(h.by - h.ay >= 2 && a.heightAt(mx - h.nx * 0.01, mz - h.nz * 0.01) >= h.by); continue; }
    assert.equal(h.ay, h.by);
    // (just inside what it's on: the surface there is at least as high as it)
    assert.ok(a.heightAt(mx - h.nx * 0.01, mz - h.nz * 0.01) >= h.ay, `${h.kind} is on something`);
    if (h.kind === 'sill') assert.equal(h.ay % STOREY, 0);
  }
  for (const k of ['edge', 'sill', 'pipe', 'rail', 'face']) assert.ok(kinds[k] > 0, `a chunk has ${k}s`);
  console.log(`holds in a chunk: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}s`).join(', ')}`);
  let vaults = 0, planted = 0, strides = 0, footed = 0; const under = {};
  for (const seed of [1, 7]) for (const ang of [0.3, 2.1, 4.4]) {
    const city = new City(seed), r = new Runner(city), dx = Math.sin(ang), dz = Math.cos(ang);
    for (let i = 0; i < 120 * 60; i++) {
      r.step(1 / 120, { x: dx, z: dz, jump: false });
      const hands = [r.reach.hl, r.reach.hr].filter(Boolean);
      assert.notEqual(r.state, 'climb');
      if (r.move === 'vault') { vaults++; if (hands.length) planted++; }
      // (a foot that's down is on something: the roof it's running on, or a hold: and says which)
      if (r.state === 'ground' && r.speed > 3 && r.move !== 'roll') { strides++; if (r.reach.fl || r.reach.fr) footed++; }
      for (const p of [r.reach.fl, r.reach.fr].filter(Boolean)) {
        const g = city.gripAt(p[0], p[1], p[2], 0.05), k = g ? g.hold.kind : 'roof';
        if (!g) assert.ok(Math.abs(city.heightAt(p[0], p[2]) - p[1]) < 1e-6, `a foot's on the roof or a hold (${r.move})`);
        under[`${r.state === 'ground' ? 'running' : r.state === 'wall' ? 'along a wall' : 'up a wall'}: ${k}`] = (under[`${r.state === 'ground' ? 'running' : r.state === 'wall' ? 'along a wall' : 'up a wall'}: ${k}`] ?? 0) + 1;
      }
      if (r.move !== 'vault') continue;
      for (const p of hands) {
        assert.ok(city.gripAt(p[0], p[1], p[2], 0.05), `a hand's on a hold (${r.move})`);
      }
    }
  }
  assert.ok(vaults > 0 && planted > vaults * 0.4, `vault hands find holds on ${planted} of ${vaults} steps`);
  assert.ok(footed > strides * 0.25, 'feet are placed');
  console.log('  feet down on: ' + Object.entries(under).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
  console.log(`over things, ${(100 * planted / vaults).toFixed(0)}%`);
}
// along a wall: left to itself it sinks; leant into, it gains height, and pays for it in how long it lasts; and a wall
// is only run straight up when it's met square
{
  const run = (lean) => {
    const city = new City(1, true), r = new Runner(city);
    // Enter along the practice face, then compare identical approaches.
    r.x = 36.5; r.y = 13; r.z = 5; r.state = 'air'; r.airT = 0.15; r.vz = 11;
    r.step(1 / 120, { x: 0.35, z: 0.93, jump: false });
    assert.equal(r.state, 'wall');
    const y0 = r.y, [wx, wz, tx, tz] = [r.wx, r.wz, r.tx, r.tz]; let top = y0, t = 0;
    while (r.state === 'wall' && t < 5) { r.step(1 / 120, { x: tx + wx * lean, z: tz + wz * lean, jump: false }); top = Math.max(top, r.y); t += 1 / 120; }
    return { gain: top - y0, t, then: r.state };
  };
  const level = run(0), leant = run(1.2);
  assert.ok(leant.gain > level.gain + 0.5 && (leant.then === 'ground' || leant.gain > level.gain + 1.5), `leaning in gains height, to the top if it's near (${level.gain.toFixed(1)} m level, ${leant.gain.toFixed(1)} m leant in, then ${leant.then})`);
  assert.ok(leant.then !== 'climb' || leant.t > 0.5, 'without turning into a climb until the run is spent');
  console.log(`along a wall: ${level.gain.toFixed(1)} m gained level over ${level.t.toFixed(2)}s, ${leant.gain.toFixed(1)} m leaning in over ${leant.t.toFixed(2)}s (then: ${leant.then})`);
}
// the plan is what happens: a route foreseen is the route run, for as long as the heading holds; the fan has the way
// asked in the middle and a best either side; and a dial turned changes what's foreseen
{
  for (const d of DIALS) assert.ok(d.house >= d.min && d.house <= d.max, `${d.key} within its range`);
  const STEPS = Math.round(TUNE.horizon * 120);
  for (const seed of [1, 7]) for (const a of [0.3, 2.1, 4.4]) {
    const r = new Runner(new City(seed)), dx = Math.sin(a), dz = Math.cos(a);
    for (let i = 0; i < 400; i++) r.step(1 / 120, { x: dx, z: dz, jump: false });
    const route = foresee(r, dx, dz), p = plan(r, dx, dz), before = [r.x, r.y, r.z, r.leaps];
    assert.deepEqual([r.x, r.y, r.z, r.leaps], before, 'thinking moves nothing');
    assert.equal(p.all.length, 2 * TUNE.fan + 1); assert.equal(p.primary.off, 0);
    assert.ok(p.left.off < 0 && p.right.off > 0 && p.best.score >= p.primary.score);
    assert.deepEqual(p.primary.pts, route.pts);
    for (let i = 0; i < STEPS; i++) r.step(1 / 120, { x: dx, z: dz, jump: false });
    const n = route.pts.length;
    assert.ok(Math.hypot(r.x - route.pts[n - 3], r.y - route.pts[n - 2], r.z - route.pts[n - 1]) < 1e-9, 'the route foreseen is the route run');
    assert.equal(route.pts.length, 3 * (1 + Math.floor(STEPS / 3)), 'forecasts the full horizon even at a wall');
  }
  const r = new Runner(new City(1, true)); for (let i = 0; i < 128; i++) r.step(1 / 120, { x: 0, z: 1, jump: false });
  const a = foresee(r, 0, 1); TUNE.gravity = 9; const b = foresee(r, 0, 1); TUNE.gravity = HOUSE.gravity;
  assert.notDeepEqual(a.pts, b.pts, 'a dial turned is felt');
}



// The four-roof transfer line exercises a complete support, flight and recovery sequence.
{
  assert.equal(new Set(DIALS.map(d => d.key)).size, DIALS.length);
  const runner = new Runner(new City(1, true)), seen = [];
  let corrected = false, loaded = false, rollPace = 0;
  for (let i = 0; i < 480; i++) {
    const before = runner.move, speed = runner.speed, state = runner.state;
    loaded ||= runner.load > 0;
    if (!corrected && runner.planned && runner.move === 'bound') {
      const copy = runner.clone();
      copy.step(1 / 120, { x: 0.26, z: 0.966, jump: false });
      assert.ok(copy.vx > runner.vx, 'a shallow correction acts on the first tick');
      corrected = true;
    }
    runner.step(1 / 120, { x: 0, z: 1, jump: false });
    if (state === 'ground' && runner.state === 'air') {
      assert.ok(Math.abs(runner.speed - speed) <= 1.5 + TUNE.accel / 120 + 1e-8, 'takeoff carries approach speed');
    }
    if (runner.move === 'roll') {
      if (before === 'roll') assert.ok(runner.speed <= rollPace + 1e-8, 'no dash inside the tuck');
      rollPace = runner.speed;
    }
    if (runner.move !== before) seen.push(runner.move);
  }
  assert.ok(loaded && corrected);
  assert.match(seen.join(' '), /bound .*dive roll (run )?dash/);
}

// Compare intentions on identical geometry using the normal fixed-step input.
{
  const forward = { x: 0, z: 1, jump: false }, neutral = { x: 0, z: 0, jump: false };
  const approach = new Runner(new City(1, true));
  while (approach.z < 13.6) approach.step(1 / 120, forward);
  const carry = approach.clone(), spring = approach.clone(), stop = approach.clone();
  let low = 12, high = 12;
  for (let i = 0; i < 125; i++) {
    carry.step(1 / 120, forward);
    spring.step(1 / 120, { ...forward, jump: i === 0 });
    stop.step(1 / 120, neutral);
    if (!i) assert.ok(spring.state === 'ground' && spring.load > 0, 'the tap loads the plant immediately');
    low = Math.max(low, carry.y); high = Math.max(high, spring.y);
  }
  assert.ok(stop.leaps === 0 && stop.z < 16 && stop.speed === 0);
  assert.ok(carry.made.bound && spring.made.spring && high > low + 1.5);

  const stand = new Runner(new City(1, true)), rig = new Rig();
  let contact = -1, bottom = -1, deepest = 0, hipAtContact = 0, lowestHip = Infinity;
  for (let i = 0; i < 180; i++) {
    const state = stand.state;
    stand.step(1 / 120, { ...neutral, jump: i === 0 }); rig.update(1 / 120, stand);
    const hip = rig.bones(stand)[0].m[13];
    if (state === 'air' && stand.state === 'ground') {
      contact = i; hipAtContact = hip; assert.equal(stand.land, 0);
    }
    if (contact >= 0) lowestHip = Math.min(lowestHip, hip);
    if (stand.land > deepest) { deepest = stand.land; bottom = i; }
  }
  assert.ok(contact > 0 && bottom > contact + 3 && bottom < contact + 24);
  assert.ok(lowestHip < hipAtContact - 0.06 && stand.land < 0.02, 'the rendered pelvis sinks after contact and recovers');

  for (const mode of ['brace', 'catch', 'release', 'skim']) {
    const r = new Runner(new City(1, true));
    if (mode === 'skim') { r.x = 36.6; r.y = 13; r.state = 'air'; r.vx = 2; r.vz = 10; }
    let tapped = false, foot = false, hands = false, topped = false;
    for (let i = 0; i < 180; i++) {
      const jump = ['catch', 'release'].includes(mode) && !tapped && r.x > 34;
      tapped ||= jump;
      const into = mode === 'release' && r.wallSteps ? 0 : 1;
      r.step(1 / 120, { x: mode === 'skim' ? 0.12 : into, z: mode === 'skim' ? 1 : 0, jump });
      foot ||= !!(r.wallPlant && (r.reach.fl || r.reach.fr));
      if (r.state === 'climb') {
        for (const hand of [r.reach.hl, r.reach.hr].filter(Boolean)) {
          assert.equal(r.city.gripAt(...hand, 0.05)?.hold.kind, 'edge');
          hands = true;
        }
      }
      topped ||= r.state === 'ground' && r.y === 17;
    }
    assert.equal(r.wallSteps, Number(tapped));
    assert.equal(r.climbs, Number(mode === 'catch'));
    assert.equal(topped, mode === 'catch'); assert.equal(hands, mode === 'catch');
    if (tapped) assert.ok(foot);
    if (mode === 'skim') assert.ok(r.z > 15 && r.walls === 0 && r.braces > 0);
  }
}
console.log('roofjumps: ok');