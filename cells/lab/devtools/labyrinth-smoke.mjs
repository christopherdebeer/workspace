// The labyrinth in the browser, as a person uses it (node cells/lab/devtools/labyrinth-smoke.mjs): a touch on the stone
// builds; touched again, it builds higher; a drag turns it and it settles on a corner; print and again do what they say;
// what's built is kept across a reload; and nothing's thrown.
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'labyrinth';
process.env.READY = '__labyrinth';
const c = checks();
await withWood(async (lab) => {
  const p = await lab.open('');
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload(); await p.waitForFunction(() => window.__labyrinth);
  await p.waitForTimeout(500);
  const probe = () => p.evaluate(() => window.__labyrinth.probe());
  const at = (i, j, k) => p.evaluate(([a, b, d]) => window.__labyrinth.screenOf(a, b, d), [i, j, k]);
  c.ok('opens on a bare stone', (await probe()).top === 0);
  c.ok('says to touch it', (await p.textContent('#hint')).includes('touch the stone'));
  let s = await at(8, 8, -1); await p.mouse.click(s[0], s[1]); await p.waitForTimeout(1200);
  c.ok('a touch on the stone builds a level', (await probe()).top === 1, await probe());
  s = await at(8, 8, 0); await p.mouse.click(s[0], s[1]); await p.waitForTimeout(1200);
  c.ok('touched again where it\'s built, it builds higher', (await probe()).top === 2, await probe());
  const az0 = await p.evaluate(() => window.__labyrinth.view.az);
  await p.mouse.move(300, 420); await p.mouse.down();
  for (let k = 1; k <= 10; k++) { await p.mouse.move(300 - 18 * k, 420); await p.waitForTimeout(30); }
  await p.mouse.up(); await p.waitForTimeout(1200);
  const az = await p.evaluate(() => window.__labyrinth.view.az), q = (az - Math.PI / 4) / (Math.PI / 2);
  c.ok('a drag turns it, and it settles on a corner', Math.abs(az - az0) > 1 && Math.abs(q - Math.round(q)) < 1e-3, { az0, az });
  c.ok('a drag doesn\'t build', (await probe()).taps === 2);
  await p.click('#print'); await p.waitForTimeout(300);
  c.ok('print draws it as a print', await p.evaluate(() => window.__labyrinth.R.print && document.getElementById('print').classList.contains('on')));
  await p.reload(); await p.waitForFunction(() => window.__labyrinth); await p.waitForTimeout(500);
  c.ok('what\'s built is kept across a reload', (await probe()).taps === 2 && (await probe()).top === 2, await probe());
  await p.click('#again'); await p.waitForTimeout(400);
  c.ok('again clears the stone', (await probe()).top === 0);
  c.ok('nothing thrown', !p.errors.length, p.errors);
  await p.close();
});
c.done?.();
