// The labyrinth in the browser, as a hand uses it (node cells/lab/devtools/labyrinth-smoke.mjs): the brief's first
// test, with no instruction but the gestures. A small raised platform (taps); a wall traced from it across the stone; a
// terrace higher up; a trace from the platform's top along the wall and up to the terrace (steps and landings); a
// passage cut beneath the walkway (hold, then carve: an arch carries what's over it). And undo, a turn from the
// background, print, what's built kept across a reload, and nothing thrown.
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'labyrinth';
process.env.READY = '__labyrinth';
const c = checks();
await withWood(async (lab) => {
  const p = await lab.open('zoom=0.55');
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload(); await p.waitForFunction(() => window.__labyrinth);
  await p.waitForTimeout(500);
  const probe = () => p.evaluate(() => window.__labyrinth.probe());
  const W = (f, ...a) => p.evaluate(([src, args]) => new Function('w', 'a', `return (${src})(w, ...a)`)(window.__labyrinth.world, args), [f.toString(), a]);
  const at = (i, j, y) => p.evaluate(([a, b, d]) => window.__labyrinth.screenOf(a, b, d), [i, j, y]);
  const tapAt = async (i, j, y) => { await p.waitForTimeout(900); const s = await at(i, j, y); await p.mouse.click(s[0], s[1]); await p.waitForTimeout(200); };
  const drag = async (pts, hold = 0) => {
    await p.waitForTimeout(1500);
    const s = await Promise.all(pts.map(([i, j, y]) => at(i, j, y)));
    await p.mouse.move(s[0][0], s[0][1]); await p.mouse.down();
    if (hold) await p.waitForTimeout(hold);
    for (let q = 1; q < s.length; q++) for (let t = 1; t <= 6; t++) { await p.mouse.move(s[q - 1][0] + ((s[q][0] - s[q - 1][0]) * t) / 6, s[q - 1][1] + ((s[q][1] - s[q - 1][1]) * t) / 6); await p.waitForTimeout(25); }
    await p.mouse.up(); await p.waitForTimeout(300);
  };
  c.ok('opens on a bare stone, saying what a hand can do', (await probe()).ops === 0 && (await p.textContent('#hint')).includes('trace'));
  // (a small raised platform: the stone tapped, its top tapped)
  await tapAt(3, 7, 0); await tapAt(3, 7, 1);
  c.ok('tap: the stone raises a plinth, its top another course', await W((w) => w.stone(0, 3, 7) && w.stone(1, 3, 7)), await probe());
  // (a wall traced across the stone, from beside it)
  await drag([[4, 7, 0], [6, 7, 0], [8, 7, 0]]);
  { const wall = await W((w) => [4, 5, 6, 7, 8].every((i) => w.stone(0, i, 7))), pr = await probe(); c.ok('trace on the stone: a wall along it', wall && pr.whys[pr.whys.length - 1] === 'wall', { wall, pr }); }
  // (a terrace higher up: tapped up three courses)
  for (const y of [0, 1, 2]) await tapAt(9, 4, y);
  c.ok('tap, tap, tap: a terrace three high', await W((w) => w.topFrom(0, 9, 4) === 3));
  // (from the platform's top, along the wall's top, up to the terrace)
  await drag([[3, 7, 2], [5, 7, 2], [7, 7, 2], [8, 6, 2.4], [9, 4, 3]]);
  const pr = await probe();
  c.ok('trace from a top up to a higher top: steps and landings', pr.whys.at(-1) === 'stairs' && pr.stairs >= 1, pr);
  c.ok('and the landings along the wall rest on it', await W((w) => w.stone(1, 5, 7) && w.stone(1, 6, 7)));
  // (hold on the wall under the walkway, then carve)
  await drag([[6, 7, 0.5], [6, 7, 0.5]], 600);
  c.ok('hold, then carve: the wall cut through beneath the walkway', await W((w) => !w.stone(0, 6, 7) && w.stone(1, 6, 7)), await probe());
  c.ok('and what\'s over the cut stands on an arch', await W((w) => !!w.span(1, 6, 7)), await probe());
  const n = (await probe()).ops;
  await p.click('#undo'); await p.waitForTimeout(200);
  { const pr = await probe(), back = await W((w) => w.stone(0, 6, 7)); c.ok('undo takes the carving back', pr.ops === n - 1 && back, { n, pr, back }); }
  // (a drag from the background turns it)
  const az0 = await p.evaluate(() => window.__labyrinth.view.az);
  await p.mouse.move(40, 140); await p.mouse.down();
  for (let k = 1; k <= 10; k++) { await p.mouse.move(40 + 18 * k, 140); await p.waitForTimeout(30); }
  await p.mouse.up(); await p.waitForTimeout(600);
  await p.waitForFunction(() => { const a = window.__labyrinth.view.az, q = (a - Math.PI / 4) / (Math.PI / 2); return Math.abs(q - Math.round(q)) < 1e-3; }, null, { timeout: 8000 }).catch(() => {});
  const az = await p.evaluate(() => window.__labyrinth.view.az), q = (az - Math.PI / 4) / (Math.PI / 2);
  c.ok('a drag from the background turns it, and it settles on a corner', Math.abs(az - az0) > 1 && Math.abs(q - Math.round(q)) < 1e-3, { az0, az });
  c.ok('and builds nothing', (await probe()).ops === n - 1);
  await p.click('#print'); await p.waitForTimeout(300);
  c.ok('print draws it as a print', await p.evaluate(() => window.__labyrinth.R.print));
  const kept = await p.evaluate(() => window.__labyrinth.world.encode());
  await p.reload(); await p.waitForFunction(() => window.__labyrinth); await p.waitForTimeout(500);
  c.ok('what\'s built is kept across a reload', (await p.evaluate(() => window.__labyrinth.world.encode())) === kept && (await probe()).ops === n - 1);
  p.on('dialog', (d) => d.accept());
  await p.click('#again'); await p.waitForTimeout(300);
  c.ok('clear clears the stone', (await probe()).ops === 0);
  c.ok('nothing thrown', !p.errors.length, p.errors);
  await p.close();
});
c.done?.();
