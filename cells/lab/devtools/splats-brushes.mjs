// The Brushes board (node cells/lab/devtools/splats-brushes.mjs [wash|dry]): the same three brushes (a stroke along a
// path, a wash in a region, a group that simplifies together) on a stone, an architectural corner and a bamboo culm,
// each in the three composed states; and one written gesture drawn in open space and wrapped over a wall, from two
// sides. Writes devtools/out/brushes-<look>.png and brushes-gesture.png.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const look = process.argv[2] ?? 'wash';
await withWood(async (wood) => {
  const page = await wood.open(`scene=brushes&res=1&clean&look=${look}`);
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'brushes' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
  const shot = async (name) => { await page.waitForTimeout(1800); return wood.shot(page, name); };
  const shots = [], labels = [];
  await S('frame', null); await S('setDetail', 1);
  shots.push(await shot(`brushes-${look}-all`)); labels.push(`${look} · all · resolved`);
  await S('setDetail', 0.25); shots.push(await shot(`brushes-${look}-all-sparse`)); labels.push(`${look} · all · sparse`);
  await S('setDetail', 0.55); shots.push(await shot(`brushes-${look}-all-mid`)); labels.push(`${look} · all · intermediate`);
  for (const subj of ['stone', 'corner', 'culm']) for (const [nm, d] of [['sparse', 0.25], ['intermediate', 0.55], ['resolved', 1]]) {
    await S('frame', subj); await S('setDetail', d);
    shots.push(await shot(`brushes-${look}-${subj}-${nm}`)); labels.push(`${look} · ${subj} · ${nm}`);
  }
  await wood.montage(shots, `brushes-${look}`, { height: 440, labels, columns: 3 });
  // (the gesture: free in space and wrapped on the wall, from the front and from the side)
  const g = [], gl = [];
  await S('setDetail', 1);
  for (const [yaw, nm] of [[0.25, 'front'], [1.2, 'side']]) {
    await S('frame', 'gesture'); await S('at', yaw, 0.15); g.push(await shot(`brushes-gesture-free-${nm}`)); gl.push(`free · ${nm}`);
    await S('frame', 'corner'); await S('at', yaw + 0.2, 0.12); g.push(await shot(`brushes-gesture-wrapped-${nm}`)); gl.push(`wrapped on the wall · ${nm}`);
  }
  await wood.montage(g, 'brushes-gesture', { height: 440, labels: gl, columns: 2 });
  if (page.errors.length) console.log('errors', page.errors);
}, { width: 390, height: 520 });
