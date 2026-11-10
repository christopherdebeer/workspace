// The pen board (node cells/lab/devtools/splats-pen.mjs): one Autograph stroke carried through the Splats brush, and one
// Bamboo bank edge drawn by a hand and that pen (penscene.ts). Panels: Autograph's own rendering of the writing; the
// word on a board and round a culm (by the pen above, by today's static brush stroke below); the culm close; the bank
// (Bamboo's dashes by today's brush on the left, by the hand and pen on the right), and each half close.
// Writes devtools/out/pen.png.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
await withWood(async (wood) => {
  const page = await wood.open('scene=pen&res=1&clean');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'pen' && window.__splats.drawn > 0, null, { timeout: 180000 });
  const P = (f, ...a) => page.evaluate(([f, a]) => window.__splats.pen[f](...a), [f, a]);
  const shot = async (name) => { await page.waitForTimeout(1800); return wood.shot(page, name); };
  const sh = [], lb = [];
  await P('reference', true); sh.push(await shot('pen-reference')); lb.push('Autograph: the same writing, its own broad pen and ink');
  await P('reference', false);
  await P('frame', 'word'); sh.push(await shot('pen-word')); lb.push('on a board and round a culm: the pen (above), today\'s static stroke (below)');
  await P('frame', 'board'); sh.push(await shot('pen-board')); lb.push('on the board, close: the pen (above), today\'s static stroke (below)');
  await P('frame', 'culm'); sh.push(await shot('pen-culm')); lb.push('round the culm, close');
  await P('frame', 'bank'); sh.push(await shot('pen-bank')); lb.push('a Bamboo bank rim: today\'s brush (left), hand and pen (right)');
  const cam = (o) => page.evaluate((o) => Object.assign(window.__splats.cam, o), o);
  await cam({ target: [12.9, 0.05, 0], dist: 1.6, pitch: 0.75, yaw: 0 }); sh.push(await shot('pen-bank-left')); lb.push('bank: today\'s brush, close');
  await cam({ target: [15.1, 0.05, 0], dist: 1.6, pitch: 0.75, yaw: 0 }); sh.push(await shot('pen-bank-right')); lb.push('bank: hand and pen, close');
  console.log('bank', await page.evaluate(() => window.__splats.pen.bank));
  await wood.montage(sh, 'pen', { height: 340, labels: lb, columns: 2 });
}, { width: 768, height: 512 });
