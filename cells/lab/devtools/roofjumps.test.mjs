// Roof Jumps' geometry and runner, on their own: a chunk is the same whenever and in whatever order it's made; every
// box is on the lattice, inside its chunk, and buildings are whole storeys; the mesh is five faces a box; and a runner
// holding a direction (any of sixteen, in several cities) crosses the city in it: it keeps its pace, leaps, climbs,
// never stops for long, never leaves the surface it's standing on. (node cells/lab/devtools/roofjumps.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './city'; export * from './runner'; export * from './rig'; export * from './mesh'; export * from './plan'; export * from './tune'; export * from './brush';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { plan, foresee, TUNE, HOUSE, DIALS, City, Runner, Rig, CHUNK, STOREY, TAG, VERTEX, chunkMesh, figureMesh, FIGURE, brushInput, BRUSH_SECONDS } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

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
    assert.equal(chunkMesh(ch).length, ((ch.boxes.length + ch.props.length) * 5 + 1) * 6 * VERTEX);
    assert.equal(c.heightAt(i * CHUNK + 0.5, j * CHUNK + 20), 0);
  }
  console.log(`${n} boxes in 49 chunks (${(n / 49).toFixed(0)} a chunk, ${(n * 10 / 49).toFixed(0)} triangles)`);
}
// A runner carries pace over open routes and can stop at a tall facade.
{
  const DT = 1 / 120, SECONDS = 60;
  let worst = Infinity, leaps = 0, climbs = 0, fromGround = 0, misses = 0; const moves = {};
  for (const seed of [1, 2, 7, 31]) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI + 0.1, dx = Math.sin(a), dz = Math.cos(a);
    const city = new City(seed), r = new Runner(city), rig = new Rig();
    let stopped = 0, longest = 0, active = 0, travelled = 0;
    for (let i = 0; i < SECONDS / DT; i++) {
      const before = r.dist, was = r.state;
      r.step(DT, { x: dx, z: dz, jump: false }); rig.update(DT, r);
      if (was === 'ground' && r.state === 'wall') fromGround++;
      // A tall wall out of reach is a legitimate end to a held line (one in reach is gone for: climbed). Retain the
      // stall and pace checks on open ground.
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
    leaps += r.leaps; misses += r.misses; climbs += r.climbs; for (const [m, n] of Object.entries(r.made)) moves[m] = (moves[m] ?? 0) + n;
    const bones = rig.bones(r), o = new Float32Array(FIGURE);
    assert.equal(bones.length, 13); assert.equal(figureMesh(bones, o) * VERTEX, FIGURE);
    assert.ok(o.every(Number.isFinite));
  }
  // (the slowest is a held line pressed into a dead end too wide to chimney and too tall to climb (seed 1, dir 10): it runs
  // the walls and kicks back and forth; it never stops, but makes little way)
  assert.ok(worst > 4.5, `makes its way at a run (slowest open-line pace ${worst.toFixed(1)} m/s)`);
  console.log(`64 runs of ${SECONDS}s: slowest open-line pace ${worst.toFixed(1)} m/s; ${leaps} leaps, ${climbs} walls run up`);
  console.log('  moves: ' + Object.entries(moves).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(', '));
  for (const m of ['vault', 'bound', 'flip', 'spring', 'dive', 'fall', 'roll', 'dash', 'wallrun', 'climb']) // (each still happens: how often is the director's eval's business (devtools/roofjumps-direct.mjs), not a count to chase)
    assert.ok((m === 'flip' ? moves.flip + (moves.sideflip ?? 0) : moves[m]) > 0, `it ${m}s`);
  // (a glide is the held jump's, never the runner's own)
  assert.ok(!moves.glide, 'no glide unasked');
  // (a wall run straight off the ground, met at a slant; and up a face from hold to hold)
  assert.ok(fromGround > 100, `wall runs from a ground start (${fromGround})`);
  assert.ok(moves.hang > 20, `chains up a face (${moves.hang} holds hung from)`);
  assert.ok(moves.chimney > 50, `up narrow alleys wall to wall (${moves.chimney})`);
  // (a contact for every jump: few leaps off the ground miss their landing and fall; leaving a wall into the air isn't one)
  assert.ok(misses < leaps * 0.1, `few leaps miss (${misses} of ${leaps})`);
  console.log(`  ${misses} of ${leaps} leaps missed their landing`);
  console.log(`  ${fromGround} wall runs straight off the ground`);
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
    assert.ok(h.hand && (h.foot || h.kind === 'bar'), 'each says what it is for, by hand and by foot (a bar, by hand only)');
    if (h.kind === 'pipe') { assert.ok(h.ax === h.bx && h.az === h.bz && h.ay === 0 && h.by > 0); continue; }
    if (h.kind === 'face') { assert.ok(h.by - h.ay >= 2 && a.heightAt(mx - h.nx * 0.01, mz - h.nz * 0.01) >= h.by); continue; }
    // (a bar: across a gap, a little above the roofs at either end)
    if (h.kind === 'bar') { assert.ok(a.heightAt(mx, mz) < h.ay - 1 && Math.abs(a.heightAt(h.ax, h.az) - (h.ay - 1.3)) < 1e-6 && Math.abs(a.heightAt(h.bx, h.bz) - (h.ay - 1.3)) < 1e-6, 'a bar spans a gap between two roofs'); continue; }
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
      // (up a face, a hand is on a hold: the lip it's pulling over, or the sill or pipe it hangs from)
      if (r.state === 'climb') for (const p of hands) assert.ok(city.gripAt(p[0], p[1], p[2], 0.2, (h) => ['edge', 'sill', 'pipe'].includes(h.kind)), `climbing, a hand is on a hold (${r.move})`);
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
  assert.ok(vaults === 0 || planted > vaults * 0.4, `vault hands find holds on ${planted} of ${vaults} steps`);
  assert.ok(footed > strides * 0.25, 'feet are placed');
  console.log('  feet down on: ' + Object.entries(under).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
  console.log(`over things, ${vaults ? (100 * planted / vaults).toFixed(0) : "-"}%`);
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
    // (the whole runner, before and after thinking: not just where it is)
    const state = () => JSON.stringify(Object.entries(r).filter(([k]) => k !== 'city'));
    const before = state(), route = foresee(r, dx, dz), p = plan(r, dx, dz);
    assert.equal(state(), before, 'thinking moves nothing');
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
  console.log(`intent: stop ${stop.leaps} ${stop.z.toFixed(2)} ${stop.speed.toFixed(2)}; carry ${low.toFixed(2)} spring ${high.toFixed(2)}`);
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

  // (pressed into the practice wall, it goes for its lip by itself; tapped, at once; tapped and let go of, not at all)
  for (const mode of ['press', 'catch', 'release', 'skim']) {
    const r = new Runner(new City(1, true));
    if (mode === 'skim') { r.x = 36.6; r.y = 13; r.state = 'air'; r.vx = 2; r.vz = 10; }
    let tapped = false, foot = false, hands = false, topped = false, grazed = false;
    for (let i = 0; i < 360; i++) {
      const jump = ['catch', 'release'].includes(mode) && !tapped && r.x > 34;
      tapped ||= jump;
      const into = mode === 'release' && r.wallSteps ? 0 : 1;
      r.step(1 / 120, { x: mode === 'skim' ? 0.12 : into, z: mode === 'skim' ? 1 : 0, jump });
      foot ||= !!(r.wallPlant && (r.reach.fl || r.reach.fr)); grazed ||= r.contact.t === 0;
      if (r.state === 'climb') {
        for (const hand of [r.reach.hl, r.reach.hr].filter(Boolean)) {
          assert.equal(r.city.gripAt(...hand, 0.05)?.hold.kind, 'edge');
          hands = true;
        }
      }
      topped ||= r.state === 'ground' && r.y === 17;
    }
    const up = mode === 'catch' || mode === 'press';
    assert.equal(r.wallSteps, Number(tapped || mode === 'press'), `${mode}: a foot planted on the wall`);
    assert.equal(r.climbs, Number(up), `${mode}: climbed`);
    assert.equal(topped, up, `${mode}: on top`); assert.equal(hands, up, `${mode}: hands on its lip`);
    if (tapped || mode === 'press') assert.ok(foot);
    if (mode === 'skim') assert.ok(r.z > 15 && r.walls === 0 && (r.braces > 0 || grazed), 'grazing the face, it keeps on along it');
  }
}
console.log('roofjumps: ok');
// A glide is the held jump's: off a roof with it held, it glides (and comes down slower); without, it falls.
{
  const off = (hold) => {
    const r = new Runner(new City(1, true)); let glided = false, t = 0;
    while (r.z < 13.6) r.step(1 / 120, { x: 0, z: 1, jump: false });
    while (t < 3 && !(r.state === 'ground' && t > 0.3)) { r.step(1 / 120, { x: 0, z: 1, jump: false, hold }); glided ||= r.move === 'glide'; t += 1 / 120; }
    return { glided, made: { ...r.made } };
  };
  const held = off(true), not = off(false);
  assert.ok(held.glided && !not.glided && !not.made.glide, 'it glides only with the jump held');
  console.log('glide: only held');
}

// Held at the top (apexHold): the pose held while the body goes on across at its pace, so where it goes is the same with
// or without the hold, step for step; only the drawing's timing changes.
{
  const run = (hold) => {
    TUNE.apexHold = hold; const r = new Runner(new City(1, true)); let held = 0; const path = [];
    for (let i = 0; i < 480; i++) { const mu = r.mu, x = r.x, z = r.z, st = r.state; r.step(1 / 120, { x: 0, z: 1, jump: false }); path.push(r.x, r.y, r.z); if (st === 'air' && r.state === 'air' && r.mu === mu && (r.x !== x || r.z !== z)) held++; }
    TUNE.apexHold = HOUSE.apexHold; return { made: { ...r.made }, held, path };
  };
  const plain = run(0), held = run(0.15);
  assert.ok(held.held > plain.held + 10 && held.made.bound && !held.made.fall, `the pose held while it goes on (${held.held} steps)`);
  assert.deepEqual(held.path, plain.path, 'the same flight, held or not');
  console.log(`apex hold: the pose held ${held.held} steps, the flight the same`);
}

// The city's stairs and bars: stairs a storey a step up a building's side, each step narrow (a rail along it); bars across
// alleys, drawn but not stood on. And let go with room ahead it settles through a walk; at an edge it stops short.
{
  let stairs = 0, bars = 0, steps = 0;
  for (const seed of [1, 2, 7]) { const c = new City(seed); for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const ch = c.chunk(i, j); steps += ch.boxes.filter((b) => b.tag === TAG.STAIR).length; stairs += ch.boxes.filter((b) => b.tag === TAG.STAIR && b.y1 === STOREY).length; bars += ch.holds.filter((h) => h.kind === 'bar').length; for (const b of ch.props) assert.ok(c.heightAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2) <= b.y0 + 1e-6 || b.y1 - b.y0 > 1, 'a prop is not stood on'); } }
  assert.ok(stairs > 10 && steps > stairs * 2 && bars > 10, `stairs (${stairs}, ${steps} steps) and bars (${bars})`);
  console.log(`city: ${stairs} stairs (${steps} steps), ${bars} bars across alleys`);
  let under = 0;
  for (const seed of [1, 2, 7, 31]) for (let k = 0; k < 16; k++) { const r = new Runner(new City(seed)), a = (k / 16) * 2 * Math.PI + 0.1; for (let i = 0; i < 120 * 30; i++) r.step(1 / 120, { x: Math.sin(a), z: Math.cos(a), jump: false }); under += r.made.underbar ?? 0; }
  assert.ok(under > 3, `under bars (${under})`);
  console.log(`  ${under} underbars in 64 half-minute runs`);
  const open = new Runner(new City(1)); let t = 0;
  for (let i = 0; i < 240; i++) open.step(1 / 120, { x: 0, z: 1, jump: false });
  const v0 = open.speed; while (open.speed > 0.05 && t < 3) { open.step(1 / 120, { x: 0, z: 0, jump: false }); t += 1 / 120; }
  console.log(`  settles from ${v0.toFixed(1)} m/s in ${t.toFixed(2)} s`);
}

// Pace and weight: landings graded; a knock to the balance damps out; the emphasis holds but doesn't change where a leap
// lands; big efforts spend effort and easy running gives it back.
{
  const grades = { flow: 0, heavy: 0, off: 0 };
  for (const seed of [1, 7]) for (const a of [0.3, 2.1, 4.4]) { const r = new Runner(new City(seed)); for (let i = 0; i < 120 * 40; i++) r.step(1 / 120, { x: Math.sin(a), z: Math.cos(a), jump: false }); for (const k of Object.keys(grades)) grades[k] += r.landings[k]; }
  assert.ok(grades.flow > 0 && grades.heavy > 0 && grades.off > 0, `landings graded (${JSON.stringify(grades)})`);
  const still = new Runner(new City(1, true)); still.balanceV = 3; let most = 0;
  for (let i = 0; i < 120; i++) { still.step(1 / 120, { x: 0, z: 0, jump: false }); most = Math.max(most, Math.abs(still.balance)); }
  assert.ok(most > 0.05 && Math.abs(still.balance) < 0.02, `a knock damps out (${most.toFixed(2)} at most, ${still.balance.toFixed(3)} after a second)`);
  TUNE.emphasis = 1; const r = new Runner(new City(1, true)); let falls = 0, frozen = 0;
  for (let i = 0; i < 600; i++) { const x = r.x, y = r.y, z = r.z; r.step(1 / 120, { x: 0, z: 1, jump: false }); if (r.move === 'fall') falls++; if (r.x === x && r.y === y && r.z === z && r.speed > 1) frozen++; }
  TUNE.emphasis = HOUSE.emphasis;
  assert.ok(r.made.bound && !falls && frozen > 3, `emphasis holds (${frozen} steps) and lands as aimed`);
  const tired = new Runner(new City(1, true)); let low = 1;
  for (let i = 0; i < 120 * 6; i++) { tired.step(1 / 120, { x: 0, z: 0, jump: i % 150 === 0 }); low = Math.min(low, tired.stamina); }
  const back = tired.stamina; for (let i = 0; i < 120 * 4; i++) tired.step(1 / 120, { x: 0, z: 0, jump: false });
  assert.ok(low < 0.8 && tired.stamina > back && tired.stamina > 0.95, `effort spent (${low.toFixed(2)}) and given back (${tired.stamina.toFixed(2)})`);
  console.log(`landings ${JSON.stringify(grades)}; balance ${most.toFixed(2)} then ${Math.abs(still.balance).toFixed(3)}; emphasis ${frozen} held steps; effort down to ${low.toFixed(2)}, back to ${tired.stamina.toFixed(2)}`);
}

// A lip caught is a beat, then a decision: left alone it hangs; pressed away it drops; pressed on it pulls over.
{
  const reach = (after) => {
    const r = new Runner(new City(1, true)); let tapped = false, t = 0;
    while (r.state !== 'climb' && t < 3) { const jump = !tapped && r.x > 34; tapped ||= jump; r.step(1 / 120, { x: 1, z: 0, jump }); t += 1 / 120; }
    assert.equal(r.move, 'hang', 'a catch is a hang first');
    for (let i = 0; i < 150; i++) r.step(1 / 120, after);
    return r;
  };
  const left = reach({ x: 0, z: 0, jump: false }), away = reach({ x: -1, z: 0, jump: false }), on = reach({ x: 1, z: 0, jump: false });
  assert.ok(left.state === 'climb' && left.move === 'hang', 'left alone, it hangs');
  assert.ok(away.state !== 'climb' && away.climbs === 0, 'pressed away, it drops');
  assert.ok(on.climbs === 1, 'pressed on, it pulls over');
  console.log('a catch: hangs, drops, or pulls over, as asked');
}

// The body has breadth (a 0.35 m circle): it stays out of walls in every state; met hard, a wall knocks it; braced, its
// hands are on the face.
{
  const by = {};
  for (const seed of [1, 7]) for (let k = 0; k < 8; k++) {
    const city = new City(seed), r = new Runner(city), a = (k / 8) * 2 * Math.PI + 0.1;
    for (let i = 0; i < 120 * 30; i++) {
      r.step(1 / 120, { x: Math.sin(a), z: Math.cos(a), jump: false });
      if (r.state !== 'ground' && r.state !== 'air') continue;
      let inside = false;
      for (let j = 0; j < 12 && !inside; j++) { const t = (j / 12) * 2 * Math.PI; inside = city.heightAt(r.x + Math.cos(t) * 0.22, r.z + Math.sin(t) * 0.22) > r.y + 1; }
      by[r.state] ??= [0, 0]; by[r.state][0]++; if (inside) by[r.state][1]++;
    }
  }
  for (const [s, [n, k]] of Object.entries(by)) assert.ok(k < n * 0.01, `${s}: the body out of walls (${k} of ${n} frames in one)`);
  const hit = new Runner(new City(1, true)); let knocked = 0, slowest = 99;
  for (let i = 0; i < 240; i++) { hit.step(1 / 120, { x: 1, z: 0, jump: false }); knocked = Math.max(knocked, Math.abs(hit.balance)); if (hit.bumps) slowest = Math.min(slowest, hit.speed); }
  assert.ok(hit.bumps > 0 && knocked > 0.03, `a wall met hard knocks it (${hit.bumps} hits, balance ${knocked.toFixed(2)})`);
  const brace = new Runner(new City(1, true)); let on = false;
  for (let i = 0; i < 160; i++) { brace.step(1 / 120, { x: 1, z: 0, jump: false }); if (brace.reach.hl && brace.reach.hr && brace.state === 'ground') on ||= Math.abs(brace.reach.hl[0] - 37) < 0.06 && Math.abs(brace.reach.hr[0] - 37) < 0.06; }
  assert.ok(on, 'braced, both hands on the face');
  console.log(`breadth: ${Object.entries(by).map(([s, [n, k]]) => `${s} ${k}/${n} in a wall`).join(', ')}; a hard hit knocks it (${knocked.toFixed(2)}); braced hands on the face`);
}

// Imperfection and the save: the clean diagonal bound lands clean; turned late, or corrected in flight, it lands off its
// line and the save's foot goes the way the hips were carrying, as far as the error asks. Across held runs the save's foot
// always goes toward the error and further for a bigger one, and most landings stay quiet. A lip caught takes the near
// hand first.
{
  const study = (k) => {
    const r = new Runner(new City(1, true)); let first = null;
    for (let i = 0; i < 230; i++) {
      let inp = { x: 0.3, z: 0.95, jump: false };
      if (k === 'late' && r.z > 13.4 && r.state === 'ground' && r.z < 16) inp = { x: 0.55, z: 0.83, jump: false };
      if (k === 'correct' && r.state === 'air') inp = { x: -0.2, z: 0.98, jump: false };
      const s0 = r.saves; r.step(1 / 120, inp); if (r.saves > s0 && !first) first = { ...r.lastSave };
    }
    return first;
  };
  const clean = study('clean'), late = study('late'), corr = study('correct');
  assert.ok(!clean, 'the clean bound lands clean');
  for (const [k, s] of [['late', late], ['correct', corr]]) assert.ok(s && s.kind === 'wide' && Math.sign(s.foot) === Math.sign(s.err) && Math.abs(s.foot) > 0.3, `${k}: the save's foot goes the way the hips carried (${JSON.stringify(s)})`);
  const all = []; let landings = 0;
  for (const seed of [1, 7]) for (let k = 0; k < 8; k++) {
    const r = new Runner(new City(seed)), a = (k / 8) * 2 * Math.PI + 0.1; let s0 = 0;
    for (let i = 0; i < 120 * 40; i++) { const st = r.state; r.step(1 / 120, { x: Math.sin(a), z: Math.cos(a), jump: false }); if (st === 'air' && r.state === 'ground') landings++; if (r.saves > s0) { s0 = r.saves; all.push({ ...r.lastSave }); } }
  }
  const wide = all.filter((s) => s.kind === 'wide');
  assert.ok(wide.every((s) => Math.sign(s.foot) === Math.sign(s.err)), 'every wide save steps toward its error');
  const big = wide.filter((s) => Math.abs(s.err) > 0.35), small = wide.filter((s) => Math.abs(s.err) <= 0.35), mean = (xs) => xs.reduce((t, s) => t + Math.abs(s.foot), 0) / (xs.length || 1);
  // (a bigger error, a wider step: measured where there's room for it, on the study's two compromised runs)
  assert.ok(Math.abs(corr.err) > Math.abs(late.err) && Math.abs(corr.foot) > Math.abs(late.foot), `a bigger error, a wider step (${late.err.toFixed(2)}→${late.foot.toFixed(2)}, ${corr.err.toFixed(2)}→${corr.foot.toFixed(2)})`);
  assert.ok(all.length < landings * 0.2, `most landings quiet (${all.length} saves of ${landings})`);
  const c = new Runner(new City(1, true)); let tapped = false, one = false, both = false;
  for (let i = 0; i < 260; i++) { const jump = !tapped && c.x > 34; tapped ||= jump; c.step(1 / 120, { x: 1, z: 0.25, jump }); if (c.move === 'hang') { const n = [c.reach.hl, c.reach.hr].filter(Boolean).length; if (n === 1 && !both) one = true; if (n === 2) both = true; } }
  assert.ok(one && both, 'a lip caught: the near hand first, then both');
  console.log(`saves: late ${late.foot.toFixed(2)} for ${late.err.toFixed(2)}, corrected ${corr.foot.toFixed(2)} for ${corr.err.toFixed(2)}; ${all.length} of ${landings} landings saved; near hand first`);
}

// Ground detail: roofs carry debris, clutter and skylights (on bare roof only); the feet are never put on them, the stride
// fitted round them (a shorter or longer step; shortened before an edge, a stutter).
{
  const kinds = {}; let onIt = 0, footfalls = 0, adjusted = 0, stutters = 0;
  const c0 = new City(3); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const g of c0.chunk(i, j).regions) kinds[g.kind] = (kinds[g.kind] ?? 0) + 1;
  assert.ok(kinds.debris > 10 && kinds.clutter > 5 && kinds.nogo > 0, `ground detail (${JSON.stringify(kinds)})`);
  for (const seed of [1, 7]) for (let k = 0; k < 8; k++) {
    const city = new City(seed), r = new Runner(city), a = (k / 8) * 2 * Math.PI + 0.1; let was = [null, null];
    for (let i = 0; i < 120 * 30; i++) {
      r.step(1 / 120, { x: Math.sin(a), z: Math.cos(a), jump: false });
      const now = [r.reach.fl, r.reach.fr];
      for (let f = 0; f < 2; f++) if (now[f] && r.state === 'ground' && (!was[f] || now[f][0] !== was[f][0] || now[f][2] !== was[f][2])) { footfalls++; if (city.regionAt(now[f][0], now[f][1], now[f][2])) onIt++; }
      was = now;
    }
    adjusted += r.adjusted; stutters += r.stutters;
  }
  assert.ok(onIt < footfalls * 0.01 && adjusted > 10, `feet kept off ground detail (${onIt} of ${footfalls} footfalls on it; ${adjusted} adjusted, ${stutters} stutters)`);
  console.log(`ground detail ${JSON.stringify(kinds)}; ${onIt} of ${footfalls} footfalls on it; ${adjusted} steps adjusted, ${stutters} stutters`);
}

// The stride, on a flat roof at 10.5 m/s: a sprinter's step and cadence; the foot down 0.2-0.4 m ahead of the body and up (its ball)
// at least 0.3 m behind it, on its toe; and while it's down, it stays where it was put (no drag: the ball of the foot
// still, the heel lifting about it).
{
  const flat = { heightAt: () => 10, topAt: () => null, gripAt: () => null, holdsNear: () => [], boxesNear: () => [], regionsNear: () => [], regionAt: () => null, start: () => ({ x: 0, y: 10, z: 0 }) };
  TUNE.sprint = 10.5; const r = new Runner(flat), rig = new Rig(); rig.update(1, r);
  const falls = [], td = [], off = []; let prevOn = false, last = 0, slid = 0, held = 0, was = null;
  for (let i = 0; i < 120 * 8; i++) {
    r.step(1 / 120, { x: 0, z: 1, jump: false }); rig.update(1 / 120, r); if (i < 120 * 4) continue;
    const on = !!r.reach.fl, fm = rig.bones(r).find((b) => b.name === 'footL').m, foot = [...fm]; foot[12] += fm[8] * 0.13; foot[14] += fm[10] * 0.13; // (the ball of the foot: what stays put while the heel lifts)
    if (on && !prevOn) { falls.push(r.reach.fl[2]); td.push(r.reach.fl[2] - r.z); held = 0; }
    if (on && !rig.soles.L.lost) { if (++held > 4 && was) slid += Math.hypot(foot[12] - was[0], foot[14] - was[1]); last = foot[14] - r.z; }
    if (!on && prevOn) off.push(last);
    was = [foot[12], foot[14]]; prevOn = on;
  }
  TUNE.sprint = HOUSE.sprint;
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, step = mean(falls.slice(1).map((z, i) => z - falls[i])) / 2, cadence = r.speed / step;
  assert.ok(step > 2.1 && step < 2.5 && cadence > 4.2 && cadence < 4.9, `a sprinter's step (${step.toFixed(2)} m, ${cadence.toFixed(1)} a second)`);
  assert.ok(mean(td) > 0.18 && mean(td) < 0.4 && mean(off) < -0.3, `down ahead, up behind (${mean(td).toFixed(2)}, ${mean(off).toFixed(2)})`);
  assert.ok(slid < 0.02 * falls.length, `a planted foot stays put (${slid.toFixed(3)} m slid over ${falls.length} footfalls)`);
  console.log(`stride: ${step.toFixed(2)} m a step, ${cadence.toFixed(1)}/s; down ${mean(td).toFixed(2)} ahead, up ${mean(off).toFixed(2)}; slid ${slid.toFixed(3)} m`);
}

// The run-up: a takeoff is a footfall. Wherever the gap falls in the stride, the steps to it are fitted so the takeoff
// foot comes down just short of the lip and the jump goes off it; the strides open into it (lengthened, not chopped);
// and a landing close to the next lip goes again off the foot it came down on.
{
  const gaps = (E, G, K, G2) => ({ heightAt: (x, z) => (z >= E && z < E + G) || (z >= E + G + K && z < E + G + K + G2) ? 0 : 10, topAt: () => null, gripAt: () => null, holdsNear: () => [], boxesNear: () => [], regionsNear: () => [], regionAt: () => null, start: () => ({ x: 0, y: 10, z: 0 }) });
  const short = [], stepsR = [], again = []; let fromFoot = 0, takeoffs = 0;
  for (let E = 30; E < 32.4; E += 0.2) {
    const K = 1.6 + (E - 30), r = new Runner(gaps(E, 3, K, 2.5)); let falls = [], was = [null, null], prev = [null, null], landed = -1, landFalls = 0;
    for (let i = 0; i < 120 * 7; i++) {
      const s0 = r.state, sp0 = r.speed; r.step(1 / 120, { x: 0, z: 1, jump: false });
      if (s0 === 'ground' && r.state === 'air' && r.vy > 0) {
        const on = [prev[0], prev[1]].filter(Boolean), lip = r.z < E ? E : E + 3 + K;
        if (r.z < E) { takeoffs++; if (on.length) { fromFoot++; short.push(lip - Math.max(...on.map((p) => p[2]))); }
          const L = 0.55 + 0.17 * sp0, st = falls.slice(-3).map((z, k, a) => k ? z - a[k - 1] : null).filter((x) => x !== null); for (const x of st) stepsR.push(x / L); }
        else if (landed >= 0) again.push({ contacts: landFalls, room: lip - landed });
      }
      if (s0 === 'air' && r.state === 'ground') { landed = r.z; landFalls = 0; }
      const now = [r.reach.fl, r.reach.fr];
      for (let k = 0; k < 2; k++) if (now[k] && r.state === 'ground' && (!was[k] || now[k][2] !== was[k][2])) { falls.push(now[k][2]); if (landed >= 0) landFalls++; }
      prev = now; was = now;
      if (r.z > E + 3 + K + 6) break;
    }
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(fromFoot === takeoffs && Math.max(...short) < 2 && Math.min(...short) > 0, `off a planted foot, short of the lip (${fromFoot}/${takeoffs}; ${Math.min(...short).toFixed(2)}–${Math.max(...short).toFixed(2)} m)`);
  assert.ok(mean(stepsR) >= 1 && Math.min(...stepsR) > 0.75, `the last strides opened, not chopped (${mean(stepsR).toFixed(2)} of a stride, least ${Math.min(...stepsR).toFixed(2)})`);
  const quick = again.filter((a) => a.room < 1.6);
  assert.ok(quick.length && quick.every((a) => a.contacts <= 1), `a lip close after a landing taken off the landing foot (${JSON.stringify(quick)})`);
  console.log(`run-up: ${fromFoot}/${takeoffs} off a planted foot ${mean(short).toFixed(2)} m short of the lip; last strides ${mean(stepsR).toFixed(2)} of a stride (least ${Math.min(...stepsR).toFixed(2)}); ${quick.length} quick lips each off one contact`);
}

// Standing and small moves (brush.ts): from a stand, light pushes every way and a turn round. Both feet are down at a stand;
// a foot down stays where it was put (the body turning over it, the foot pivoting on its ball, stepped when it's left too
// far); a foot stepping is lifted clear, not dragged; a light push walks, it doesn't sprint.
{
  const flat = { heightAt: () => 10, topAt: () => null, gripAt: () => null, holdsNear: () => [], boxesNear: () => [], regionsNear: () => [], regionAt: () => null, start: () => ({ x: 0, y: 10, z: 0 }) };
  const r = new Runner(flat), rig = new Rig(); rig.update(1, r); const h0 = r.heading, prev = { L: null, R: null };
  let onF = 0, slid = 0, dragF = 0, standF = 0, bothDown = 0, steps = 0, top = 0, still = 0; const was = [null, null];
  for (let i = 0; i < BRUSH_SECONDS * 120; i++) {
    const inp = brushInput(i / 120, h0); r.step(1 / 120, inp); rig.update(1 / 120, r); top = Math.max(top, r.speed);
    const b = rig.bones(r);
    for (const [s, key] of [['L', 'fl'], ['R', 'fr']]) {
      const fm = b.find((o) => o.name === 'foot' + s).m, ball = [fm[12] + fm[8] * 0.13, fm[13], fm[14] + fm[10] * 0.13], v = prev[s] ? Math.hypot(ball[0] - prev[s][0], ball[2] - prev[s][2]) * 120 : 0;
      if (r.reach[key]) { onF++; if (v > 0.3) slid++; } else if (fm[13] - 10 < 0.085 && v > 0.4) dragF++;
      prev[s] = ball;
    }
    // (settled: a stand over half a second old, its one or two settling steps taken)
    still = r.speed < 0.05 && !inp.x && !inp.z ? still + 1 / 120 : 0; if (still > 0.6) { standF++; if (r.reach.fl && r.reach.fr) bothDown++; }
    const now = [r.reach.fl, r.reach.fr]; for (let k = 0; k < 2; k++) if (now[k] && (!was[k] || now[k][0] !== was[k][0] || now[k][2] !== was[k][2])) steps++; was[0] = now[0]; was[1] = now[1];
  }
  assert.ok(bothDown > standF * 0.9, `both feet down at a settled stand (${bothDown}/${standF})`);
  assert.ok(slid < onF * 0.05, `a foot down stays put (${slid} of ${onF} frames moving)`);
  assert.ok(dragF < 60, `a stepping foot lifted, not dragged (${dragF} frames)`);
  assert.ok(steps >= 12 && top < 4.5, `small moves stepped, at a walk (${steps} footfalls; fastest ${top.toFixed(1)} m/s)`);
  console.log(`standing and small moves: both feet down ${(100 * bothDown / standF).toFixed(0)}% of a stand; a foot down moving ${(100 * slid / onF).toFixed(1)}% of frames; ${dragF} frames dragged; ${steps} footfalls; fastest ${top.toFixed(1)} m/s`);
}

// A hang, left alone and then pressed at a slant: caught on the practice line's wall, the legs swing in free, then both
// feet are set on the wall and stay (no walking it), the arms near straight; a press toward the wall at a slant (not
// straight at it) pulls over.
{
  const c = new Runner(new City(1, true)), rig = new Rig(); rig.update(1, c); let tapped = false, hangAt = -1, wall = null, moved = 0, setF = 0, still = 0, maxBend = 0, climbed = false;
  const prev = { L: null, R: null };
  for (let i = 0; i < 120 * 6; i++) {
    const t = i / 120; let inp = { x: 1, z: 0.25, jump: false };
    if (hangAt < 0) { const jump = !tapped && c.x > 34; tapped ||= jump; inp.jump = jump; }
    else if (t - hangAt < 2) inp = { x: 0, z: 0, jump: false };
    else { const tx = -wall[1], tz = wall[0], a = 0.35; inp = { x: wall[0] * a + tx * 0.94, z: wall[1] * a + tz * 0.94, jump: false }; }
    c.step(1 / 120, inp); rig.update(1 / 120, c);
    if (c.move === 'hang' && hangAt < 0) { hangAt = t; wall = [c.wx, c.wz]; }
    if (c.move === 'climb' && hangAt >= 0) climbed = true;
    if (hangAt >= 0 && t - hangAt > 0.6 && t - hangAt < 2 && c.move === 'hang') {
      still++; if (c.reach.fl && c.reach.fr) setF++;
      const b = rig.bones(c);
      for (const s of ['L', 'R']) { const fm = b.find((o) => o.name === 'foot' + s).m, p = [fm[12], fm[13], fm[14]]; if (prev[s]) moved = Math.max(moved, Math.hypot(p[0] - prev[s][0], p[1] - prev[s][1], p[2] - prev[s][2])); prev[s] = p; }
      const up = b.find((o) => o.name === 'upperArmL').m, fo = b.find((o) => o.name === 'foreArmL').m, ua = [-up[4], -up[5], -up[6]], fa = [-fo[4], -fo[5], -fo[6]];
      maxBend = Math.max(maxBend, Math.acos(Math.max(-1, Math.min(1, ua[0] * fa[0] + ua[1] * fa[1] + ua[2] * fa[2]))) * 180 / Math.PI);
    }
  }
  assert.ok(hangAt >= 0 && still > 100 && setF === still && moved < 0.01, `a still hang: both feet set on the wall and kept (${setF}/${still}; moved ${moved.toFixed(3)} m a frame)`);
  assert.ok(maxBend < 25, `the arms near straight (${maxBend.toFixed(0)}°)`);
  assert.ok(climbed, 'a press toward the wall at a slant pulls over');
  console.log(`a still hang: feet set ${setF}/${still}, moved ${moved.toFixed(3)} m a frame, elbows ${maxBend.toFixed(0)}°; a slanted press pulls over`);
}

// Thinking moves nothing, mid-step too, and is foreseen at the press held: a forecast made while a standing step is under
// way leaves it where it was; a light press on the practice line is foreseen staying on the roof it's on, as it does.
{
  const flat = { heightAt: () => 10, topAt: () => null, gripAt: () => null, holdsNear: () => [], boxesNear: () => [], regionsNear: () => [], regionAt: () => null, start: () => ({ x: 0, y: 10, z: 0 }) };
  const r = new Runner(flat), h0 = r.heading; let checked = false;
  for (let i = 0; i < 120 * 8 && !checked; i++) { r.step(1 / 120, brushInput(i / 120, h0)); if (r.standStep && r.standStep.t === 0) { const was = JSON.stringify(Object.entries(r).filter(([k]) => k !== 'city')); plan(r, 0, 1); assert.equal(JSON.stringify(Object.entries(r).filter(([k]) => k !== 'city')), was, 'a forecast mid-step moves nothing'); checked = true; } }
  assert.ok(checked, 'a standing step to think during');
  const c = new Runner(new City(1, true)), h = c.heading, dx = Math.sin(h), dz = Math.cos(h);
  for (let i = 0; i < 30; i++) c.step(1 / 120, { x: dx * 0.35, z: dz * 0.35, jump: false });
  const light = foresee(c, dx * 0.35, dz * 0.35), g = c.clone(); for (let i = 0; i < Math.round(TUNE.horizon * 120); i++) g.step(1 / 120, { x: dx * 0.35, z: dz * 0.35, jump: false });
  const n = light.pts.length; assert.ok(Math.hypot(g.x - light.pts[n - 3], g.y - light.pts[n - 2], g.z - light.pts[n - 1]) < 1e-9, 'a light press foreseen as it runs');
  console.log(`thinking: moves nothing mid-step; a light press foreseen to z ${light.pts[n - 1].toFixed(1)} (on its own roof), as it runs`);
}

// From the street: started on the ground in an alley and held hard every way, it finds its way up (a wall within reach,
// an alley narrow enough to chimney), and the drawn body never jumps: the hips go no further in a frame than the body's
// own motion and a step's worth (corrections in where the body is put are drawn out of, not snapped to).
{
  const DT = 1 / 120; let frames = 0, jumps = 0, up = 0, runs = 0;
  for (const seed of [1, 2]) {
    const city = new City(seed), c0 = city.start(), spots = [];
    for (let a = 0; a < 40 && spots.length < 2; a++) { const ang = a * 2.39, d = 8 + a * 1.3, x = c0.x + Math.cos(ang) * d, z = c0.z + Math.sin(ang) * d; if (city.heightAt(x, z) < 0.5 && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([u, v]) => city.heightAt(x + u, z + v) < 0.5)) spots.push([x, z]); }
    for (const [sx, sz] of spots) for (let k = 0; k < 4; k++) {
      const a = (k / 4) * 2 * Math.PI + 0.3, r = new Runner(city), rig = new Rig(); r.x = sx; r.z = sz; r.y = city.heightAt(sx, sz); rig.update(1, r); runs++; let prev = null;
      for (let i = 0; i < 15 / DT; i++) {
        const vy0 = r.vy, sp0 = r.speed; r.step(DT, { x: Math.sin(a), z: Math.cos(a), jump: false }); rig.update(DT, r); frames++; if (r.y > 0.5) up++;
        const pm = rig.bones(r).find((o) => o.name === 'pelvis').m, pv = [pm[12], pm[13], pm[14]];
        if (prev && Math.hypot(pv[0] - prev[0], pv[1] - prev[1], pv[2] - prev[2]) > Math.max(0.15, (Math.max(sp0, r.speed) + Math.abs(vy0) + Math.abs(r.vy)) * DT + 0.12)) jumps++;
        prev = pv;
      }
    }
  }
  assert.ok(up > frames * 0.4, `from the street it gets up (${(100 * up / frames).toFixed(0)}% of the time off it)`);
  assert.ok(jumps < frames * 0.0005, `the drawn body doesn't jump (${jumps} frames in ${frames})`);
  console.log(`from the street: ${runs} runs, off it ${(100 * up / frames).toFixed(0)}% of the time; drawn hips jumped in ${jumps} of ${frames} frames`);
}
