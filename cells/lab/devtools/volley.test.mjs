// Volley's game on its own, then its page. (node cells/lab/devtools/volley.test.mjs; SIM=1 for the game only)
// The game: a seed is the same game; the ball stays in the tunnel; each kind of hand returns it, the way and as hard
// as it should; the ball falls back down the shaft, bends with spin, goes through a brick when thrown hard; no hand, and it's one of five gone, five and it's over; the glass halts before standing bricks and goes on
// when a slab falls; the stand-in gets down the tunnel with every kind of hand; the tunnel never runs out.
// The page: it draws without error, a touch sends the ball, a finger where it comes back returns it, the hand changes.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const S = await load('../client/volley/sim.ts');
const { create, advance, serve, grab, release, restart, makeSlab, crossing, speed, cellX, cellY, MODES, H, R, HAND_R, FULL, STAND, BRICK_T, ROWS, POWER_MAX, G } = S;

{
  const run = (seed, secs, mode = 'pad') => { const s = create(seed, 0.46, mode); for (let i = 0; i < secs * 60; i++) advance(s, 1 / 60, true); return s; };
  const a = run(7, 40), b = run(7, 40), c = run(8, 40);
  assert.deepEqual([a.z, a.broken, a.ball], [b.z, b.broken, b.ball], 'a seed is the same game');
  assert.notDeepEqual(a.ball, c.ball, 'another seed is another');
  console.log('ok   a seed is the same game');
}
for (const mode of MODES) for (const aspect of [0.46, 1.6]) {
  const s = create(3, aspect, mode);
  for (let i = 0; i < 150 * 60; i++) {
    advance(s, 1 / 60, true);
    const b = s.ball;
    assert.ok(Math.abs(b.x) <= s.W / 2 - R + 1e-6 && Math.abs(b.y) <= H / 2 - R + 1e-6 && b.z > s.z - 3 && b.z < s.z + 60, `in the tunnel (${mode}): ${JSON.stringify(b)}`);
    assert.ok(speed(b) <= POWER_MAX * 1.3 && Number.isFinite(speed(b)), 'never faster than it was thrown, give or take a fall');
    const near = s.slabs.find((k) => k.left > 0);
    assert.ok(!near || s.z <= near.z - BRICK_T / 2 - STAND + 0.05, 'the glass halts short of standing bricks');
    assert.ok(s.slabs[s.slabs.length - 1].z > s.z + 80, 'there is always more tunnel');
  }
  assert.ok(s.passed >= 6 && s.integrity === FULL, `the stand-in gets down the tunnel (${mode}, ${aspect}): ${s.passed} slabs, ${s.z.toFixed(0)} m`);
  console.log(`ok   ${mode} ${aspect}: ${s.z.toFixed(0)} m, ${s.passed} slabs, ${s.broken} broken, ${s.returns} returns`);
}
{
  // (a ball coming straight back at the middle of the glass, and a hand: how it leaves)
  const back = (mode, hand) => { const s = create(1, 0.46, mode); s.phase = 'play'; s.slabs.length = 0; Object.assign(s.ball, { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: -16 }); for (let i = 0; i < 40 && s.ball.vz < 0 && s.phase === 'play'; i++) { s.hands = hand ? [hand] : []; advance(s, 1 / 240); } return s; };
  let s = back('pad', { id: 1, x: 0, y: -0.02, vx: 0, vy: 0 });
  assert.ok(s.ball.vz > 0 && Math.abs(s.ball.vx) < 1e-9 && s.returns === 1 && speed(s.ball) >= 16.5, 'pad, centred: straight back, and briskly');
  const still = speed(s.ball);
  s = back('pad', { id: 1, x: -HAND_R / 2, y: 0, vx: 0, vy: 0 });
  assert.ok(s.ball.vx > 0.2 * speed(s.ball) && s.ball.vz > 0, 'pad, taken off-centre: away from the pad\'s middle');
  s = back('pad', { id: 1, x: 0, y: 0, vx: 0, vy: 20 });
  assert.ok(speed(s.ball) > still + 5 && s.ball.vy > 0 && s.ball.sy > 0, 'pad, struck with a moving finger: harder, that way, and spinning');
  s = back('pad', { id: 1, x: HAND_R * 2, y: 0, vx: 0, vy: 0 });
  assert.ok(s.ball.vz < 0 || s.phase === 'ready', 'pad, not there: through');
  s = back('swipe', { id: 1, x: 0.3, y: 0, vx: 0, vy: 0 });
  assert.ok(s.ball.vz < 0 || s.phase === 'ready', 'swipe, a still finger: through');
  s = back('swipe', { id: 1, x: 0.3, y: 0, vx: 0, vy: 10 });
  const soft = speed(s.ball);
  assert.ok(s.ball.vz > 0 && s.ball.vy > 0 && Math.abs(s.ball.vx) < 1e-9, 'swipe, upward: it leaves upward');
  s = back('swipe', { id: 1, x: 0.3, y: 0, vx: 0, vy: 30 });
  assert.ok(speed(s.ball) > soft + 10, 'swipe: the harder the swipe, the harder the ball');
  s = back('catch', { id: 1, x: 0.2, y: 0.1, vx: 0, vy: 0 });
  assert.equal(s.phase, 'held', 'catch: held');
  s.hands = [{ id: 1, x: 1, y: 1, vx: 0, vy: 0 }]; advance(s, 1 / 60);
  assert.ok(Math.abs(s.ball.x - 1) < 1e-9 && Math.abs(s.ball.y - 1) < 1e-9, 'held: it goes where the finger goes');
  release(s, 1, -24, 0); assert.ok(s.phase === 'play' && s.ball.vx < 0 && s.ball.vz > 0 && s.ball.sx < 0 && speed(s.ball) > 25, 'let go moving left, fast: thrown left, hard, spinning left');
  s = create(1, 0.46, 'catch'); grab(s, 4); assert.equal(s.phase, 'held'); release(s, 4, 0, 0);
  assert.ok(Math.abs(speed(s.ball) - 8) < 1e-6, 'let go of a still finger: a lob');
  // (the ball itself: thrown up the shaft it slows, stops as high as its speed takes it, and comes back down as fast)
  s = create(1, 0.46, 'pad'); s.phase = 'play'; s.z = s.slabs[0].z - BRICK_T / 2 - STAND; s.hands = [{ id: 1, x: 0, y: 0, vx: 0, vy: 0 }]; Object.assign(s.ball, { x: 0, y: 0, z: s.z + 1, vx: 0, vy: 0, vz: 8 });
  let top = 0, fell = 0; for (let i = 0; i < 240 * 2 && s.returns === 0; i++) { advance(s, 1 / 240); top = Math.max(top, s.ball.z - s.z); fell = Math.min(fell, s.ball.vz); }
  assert.ok(Math.abs(top - (1 + 64 / (2 * G))) < 0.05 && fell < -8 && s.returns === 1 && Math.abs(s.ball.y) < 1e-9, `it rises as far as its speed takes it, and falls back: ${top}, ${fell}`);
  s = create(1, 0.46, 'pad'); s.phase = 'play'; s.slabs.length = 0; Object.assign(s.ball, { x: 0, y: 0, z: 2, vx: 0, vy: 0, vz: 10, sx: 8, sy: 0 });
  for (let i = 0; i < 100; i++) advance(s, 1 / 240);
  assert.ok(s.ball.x > 0.3 && s.ball.sx < 8, 'spin bends it, and wears off');
  // (a brick: a hard ball goes through it and on; a softer one comes off it, and comes back at a fair pace)
  const at = (vz, ticks = 20) => { const s = create(1, 0.46, 'pad'); s.phase = 'play'; s.z = 13; const sl = s.slabs[0], i = sl.cells.findIndex((v) => v === 1); Object.assign(s.ball, { x: cellX(s, i % s.cols), y: cellY(Math.floor(i / s.cols)), z: sl.z - 1.2, vx: 0, vy: 0, vz }); const n = sl.left; for (let k = 0; k < ticks; k++) advance(s, 1 / 240); return { s, broke: n - sl.left }; };
  let r = at(30); assert.ok(r.broke === 1 && r.s.ball.vz > 20, 'thrown hard: through the brick');
  r = at(12); assert.ok(r.broke === 1 && r.s.ball.vz < 0, 'thrown softly: off it, and back down');
  r = at(3, 80); assert.ok(r.broke === 0 && r.s.ball.vz < 0, 'thrown too softly: it never gets there');
  // (nobody there: five, and it's over; then again)
  s = create(1, 0.46, 'pad');
  for (let n = FULL; n > 0; n--) { assert.equal(s.phase, 'ready'); serve(s); s.slabs.length = 0; s.ball.vz = -16; for (let i = 0; i < 600 && s.phase === 'play'; i++) advance(s, 1 / 60); assert.equal(s.integrity, n - 1); }
  assert.equal(s.phase, 'over'); restart(s); assert.deepEqual([s.phase, s.integrity, s.z, s.broken], ['ready', FULL, 0, 0]);
  // (where it'll come back, off the walls and the floor)
  s = create(1, 0.46, 'pad'); s.phase = 'play'; s.z = s.slabs[0].z - BRICK_T / 2 - STAND; Object.assign(s.ball, { x: 1, y: 2, z: s.z + 3, vx: 9, vy: 3, vz: -5, sx: 3, sy: 0 });
  const c = crossing(s); for (let i = 0; i < 2000 && s.ball.z - R > s.z; i++) advance(s, 1 / 240);
  assert.ok(Math.hypot(s.ball.x - c.x, s.ball.y - c.y) < 0.4, `crossing ${JSON.stringify(c)} v ${JSON.stringify(s.ball)}`);
  for (let i = 0; i < 60; i++) for (const cols of [4, 13]) { const sl = makeSlab(5, i, cols); assert.ok(sl.left > 0 && sl.left === sl.total && sl.cells.length === cols * ROWS && (i === 0 || sl.z > makeSlab(5, i - 1, cols).z), `slab ${i}`); }
  console.log('ok   each hand and how hard, the ball\'s rise and fall, its spin, through a brick, nobody there, the crossing, the slabs');
}
if (process.env.SIM) process.exit(0);

process.env.EXPERIMENT = 'volley'; process.env.READY = '__volley';
const { withWood, checks } = await import('./harness.mjs');
const { ok, done } = checks();
await withWood(async (lab) => {
  const p = await lab.open('seed=1');
  await p.waitForTimeout(800);
  const probe = () => p.evaluate(() => window.__volley.probe());
  let s = await probe();
  ok('waiting, drawn', s.phase === 'ready' && s.frames > 2 && s.error === 0 && s.boxes > 100, s);
  ok('says how', (await p.textContent('#sub')).includes('tap to send it'));
  await p.mouse.click(195, 422); await p.waitForTimeout(300);
  s = await probe();
  ok('a touch sends it', s.phase === 'play' && s.ball.z > s.z + 1, s);
  // (a hand kept where it will come back, by the page's own reckoning, for a few returns)
  for (let i = 0; i < 400 && s.returns < 3 && s.phase === 'play'; i++) {
    const at = await p.evaluate(() => { const v = window.__volley, b = v.sim.ball; return v.onScreen(b.x, b.y); });
    await p.mouse.move(at.x, at.y); await p.waitForTimeout(30); s = await probe();
  }
  ok('a hand where it comes back returns it', s.returns >= 3 && s.integrity === 5, s);
  ok('a ring under the hand', await p.isVisible('#glass i'));
  await p.click('#toHand');
  ok('the hand changes, and the address with it', (await probe()).mode === 'swipe' && p.url().includes('hand=swipe') && (await p.textContent('#toHand')).includes('swipe'));
  ok('no errors', !p.errors.length, p.errors.slice(0, 3));
  await p.close();
  const q = await lab.open('preview&seed=1&t=30');
  await q.waitForTimeout(1500);
  s = await q.evaluate(() => window.__volley.probe());
  ok('the preview plays itself, with no words', s.broken > 0 && s.t > 30 && !(await q.isVisible('#bar')) && !(await q.isVisible('#top')), s);
  ok('no errors in the preview', !q.errors.length && s.error === 0, q.errors.slice(0, 3));
  await q.close();
}, { width: 390, height: 844 });
done();
