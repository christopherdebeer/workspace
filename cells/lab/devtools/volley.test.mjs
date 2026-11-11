// Volley's game on its own, then its page. (node cells/lab/devtools/volley.test.mjs; SIM=1 for the game only)
// The game: a seed is the same game; the ball stays in the court; where it meets the paddle sets how it leaves; a
// ball let past costs one and three end it; the stand-in clears the first court; every court has bricks.
// The page: it draws without error, a tap serves, a drag moves the paddle (and the eye with it), the plan shows.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const S = await load('../client/volley/sim.ts');
const { create, advance, serve, next, layout, crossing, W, D, R, COLS, ROWS, PADDLE_HALF } = S;

{
  const run = (seed, secs) => { const s = create(seed); for (let i = 0; i < secs * 60; i++) advance(s, 1 / 60, true); return s; };
  const a = run(7, 30), b = run(7, 30), c = run(8, 30);
  assert.deepEqual([a.score, a.ball, a.paddle, [...a.bricks]], [b.score, b.ball, b.paddle, [...b.bricks]], 'a seed is the same game');
  assert.notDeepEqual(a.ball, c.ball, 'another seed is another');
  console.log('ok   a seed is the same game');
}
{
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = create(seed);
    let cleared = false, rows = new Set();
    for (let i = 0; i < 240 * 60 && !cleared; i++) {
      advance(s, 1 / 60, true);
      for (const e of s.events) { if (e.kind === 'brick') rows.add(e.row); if (e.kind === 'clear') cleared = true; }
      assert.ok(Math.abs(s.ball.x) <= W / 2 - R + 1e-6 && s.ball.z <= D - R + 1e-6 && s.ball.z > -2, `in the court (seed ${seed}): ${JSON.stringify(s.ball)}`);
      if (s.phase === 'play') assert.ok(Math.abs(Math.hypot(s.ball.vx, s.ball.vz) - s.speed) < 1e-6 && Math.abs(s.ball.vz) >= 0.27 * s.speed, 'its speed is its speed, and never all sideways');
    }
    assert.ok(cleared, `the stand-in clears the first court (seed ${seed}; ${s.left} left at ${s.t.toFixed(0)}s)`);
    assert.equal(rows.size, ROWS);
    console.log(`ok   seed ${seed}: cleared in ${s.t.toFixed(0)}s, ${s.score} points, ${s.lives} left`);
  }
}
{
  // (the paddle: straight back off its middle, out to the side off its end)
  const leave = (off) => { const s = create(1); s.phase = 'play'; s.ball.x = off * PADDLE_HALF; s.ball.z = 2; s.ball.vx = 0; s.ball.vz = -s.speed; for (let i = 0; i < 60 && s.ball.vz < 0; i++) advance(s, 1 / 60); return Math.atan2(s.ball.vx, s.ball.vz) * 180 / Math.PI; };
  assert.ok(Math.abs(leave(0)) < 1e-6); assert.ok(leave(0.5) > 20 && leave(0.5) < 40); assert.ok(leave(-1) < -50);
  // (let past: one fewer, back on the paddle; three, and it's over; then a new game)
  const s = create(1); s.want = s.paddle = 0;
  for (let n = 3; n > 0; n--) {
    assert.equal(s.phase, 'serve'); serve(s); s.ball.x = 3; s.ball.vx = 0; s.ball.vz = -s.speed;
    for (let i = 0; i < 600 && s.phase === 'play'; i++) advance(s, 1 / 60);
    assert.equal(s.lives, n - 1);
  }
  assert.equal(s.phase, 'over'); next(s); assert.deepEqual([s.phase, s.lives, s.score, s.level], ['serve', 3, 0, 1]);
  // (where it'll cross, off a wall)
  const k = create(1); k.phase = 'play'; k.ball = { x: 3, z: 5, vx: 6, vz: -6 };
  const x = crossing(k); for (let i = 0; i < 600 && k.ball.z > 1; i++) advance(k, 1 / 240);
  assert.ok(Math.abs(k.ball.x - x) < 0.3, `crossing ${x} v ${k.ball.x}`);
  for (let l = 1; l <= 12; l++) { const b = layout(l, 3); assert.ok(b.some((v) => v) && b.length === ROWS * COLS, `court ${l} has bricks`); if (l > 4) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) assert.equal(b[r * COLS + c], b[r * COLS + COLS - 1 - c]); }
  console.log('ok   the paddle\'s angle, a ball let past, three and over, the crossing, the courts');
}
if (process.env.SIM) process.exit(0);

process.env.EXPERIMENT = 'volley'; process.env.READY = '__volley';
const { withWood, checks } = await import('./harness.mjs');
const { ok, done } = checks();
await withWood(async (lab) => {
  const p = await lab.open('seed=1&plan');
  await p.waitForTimeout(800);
  const probe = () => p.evaluate(() => window.__volley.probe());
  let s = await probe();
  ok('waiting to serve, drawn', s.phase === 'serve' && s.frames > 2 && s.error === 0 && s.boxes > 40, s);
  ok('says so', (await p.textContent('#sub')).includes('tap to serve'));
  ok('the plan shows', await p.isVisible('#plan'));
  await p.mouse.move(195, 500); await p.mouse.down();
  for (let i = 1; i <= 10; i++) { await p.mouse.move(195 + i * 12, 500); await p.waitForTimeout(20); }
  await p.mouse.up(); await p.waitForTimeout(400);
  s = await probe();
  ok('a drag moves the paddle, and does not serve', s.paddle > 1 && s.phase === 'serve', s);
  await p.mouse.click(195, 500); await p.waitForTimeout(600);
  s = await probe();
  ok('a tap serves', s.phase === 'play' && s.ball.z > 1, s);
  await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(500); await p.keyboard.up('ArrowLeft');
  ok('the keys move it', (await probe()).paddle < s.paddle);
  await p.click('#toPlan'); ok('the plan hides', !(await p.isVisible('#plan')));
  ok('no errors', !p.errors.length, p.errors.slice(0, 3));
  await p.close();
  const q = await lab.open('preview&seed=1&t=30');
  await q.waitForTimeout(1500);
  s = await q.evaluate(() => window.__volley.probe());
  ok('the preview plays itself, with no words', s.score > 0 && s.t > 30 && !(await q.isVisible('#bar')) && !(await q.isVisible('#top')), s);
  ok('no errors in the preview', !q.errors.length && s.error === 0, q.errors.slice(0, 3));
  await q.close();
});
done();
