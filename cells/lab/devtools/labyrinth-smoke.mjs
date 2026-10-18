// The labyrinth in the browser, as a person uses it (node cells/lab/devtools/labyrinth-smoke.mjs): with auto in hand, a
// touch on the stone puts a block there, on a block's top another, on its side a stair up onto it, and between two
// towers' sides a bridge; each piece in the palette goes where it's touched; undo and take away; a drag turns it and it
// settles on a corner; print; what's built is kept across a reload; and nothing's thrown.
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
  const kindAt = (k, i, j) => p.evaluate(([a, b, d]) => window.__labyrinth.model.kindAt(a, b, d), [k, i, j]);
  /** touch a point of the room: cell (i, j) (fractions toward its sides), at height y */
  const tap = async (i, j, y) => { const s = await p.evaluate(([a, b, d]) => window.__labyrinth.screenOf(a, b, d), [i, j, y]); await p.mouse.click(s[0], s[1]); await p.waitForTimeout(250); };
  c.ok('opens on a bare stone', (await probe()).pieces === 0);
  c.ok('says to touch it', (await p.textContent('#hint')).includes('touch the stone'));
  await tap(5, 6, 0);
  c.ok('auto: a touch on the stone puts a block there', (await kindAt(0, 5, 6)) === 'block', await probe());
  // (its side toward +x, low down: a stair up onto it, from the stone)
  await tap(5.55, 6, 0.3);
  c.ok('auto: on its side, a stair up onto it', (await kindAt(0, 6, 6)) === 'stair' && (await p.evaluate(() => window.__labyrinth.model.at(0, 6, 6).p.a)) === 2, await probe());
  await tap(5, 6, 1);
  c.ok('auto: on a block\'s top, another', (await kindAt(1, 5, 6)) === 'block', await probe());
  // (a second tower three cells off, and a bridge between them at the second level)
  for (const k of [0, 1]) await p.evaluate(([kk]) => window.__labyrinth.model.place('block', kk, 5, 2), [k]);
  await tap(5, 2.55, 1.5);
  const br = await p.evaluate(() => window.__labyrinth.model.pieces.find((q) => q.kind === 'bridge'));
  c.ok('auto: on a tower\'s side over a gap to another, a bridge across', br && br.k === 1 && br.n === 3, br);
  for (const [hand, at, want] of [['arch', [8, 8, 0], 'arch'], ['cypress', [9, 3, 0], 'cypress'], ['pool', [3, 9, 0], 'pool']]) {
    await p.evaluate((h) => window.__labyrinth.setHand(h), hand);
    await tap(...at);
    const got = await p.evaluate(([i, j]) => window.__labyrinth.model.pieceAt(0, i, j)?.kind, at);
    c.ok(`${hand}: goes where it's touched`, got === want, got);
  }
  const n = (await probe()).pieces;
  await p.click('#undo'); await p.waitForTimeout(200);
  c.ok('undo takes the last back', (await probe()).pieces === n - 1);
  await p.evaluate(() => window.__labyrinth.setHand('erase'));
  await tap(8, 8, 1);
  c.ok('take: a piece with nothing on it goes', (await kindAt(0, 8, 8)) === null, await probe());
  await tap(5, 2, 2);
  c.ok('take: a piece something rests on (a bridge\'s end) stays', (await kindAt(1, 5, 2)) === 'block');
  const az0 = await p.evaluate(() => window.__labyrinth.view.az);
  await p.mouse.move(300, 300); await p.mouse.down();
  for (let k = 1; k <= 10; k++) { await p.mouse.move(300 - 18 * k, 300); await p.waitForTimeout(30); }
  await p.mouse.up(); await p.waitForTimeout(600);
  await p.waitForFunction(() => { const a = window.__labyrinth.view.az, q = (a - Math.PI / 4) / (Math.PI / 2); return Math.abs(q - Math.round(q)) < 1e-3; }, null, { timeout: 8000 }).catch(() => {});
  const az = await p.evaluate(() => window.__labyrinth.view.az), q = (az - Math.PI / 4) / (Math.PI / 2);
  c.ok('a drag turns it, and it settles on a corner', Math.abs(az - az0) > 1 && Math.abs(q - Math.round(q)) < 1e-3, { az0, az });
  await p.click('#print'); await p.waitForTimeout(300);
  c.ok('print draws it as a print', await p.evaluate(() => window.__labyrinth.R.print));
  const kept = (await probe()).encoded;
  await p.reload(); await p.waitForFunction(() => window.__labyrinth); await p.waitForTimeout(500);
  c.ok('what\'s built is kept across a reload', (await probe()).encoded === kept && kept.length > 0);
  p.on('dialog', (d) => d.accept());
  await p.click('#again'); await p.waitForTimeout(300);
  c.ok('again clears the stone', (await probe()).pieces === 0);
  c.ok('nothing thrown', !p.errors.length, p.errors);
  await p.close();
});
c.done?.();
