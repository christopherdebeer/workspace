// One Stone's boards (node cells/lab/devtools/splats-stone.mjs [views|detail|occluder|brush|all]):
// - views: both looks (dry, wash) from the hero, grazing and reverse views (stone-views.png)
// - detail: the detail scrubbed down, by rank against evenly, at the same number of marks (stone-detail.png)
// - occluder: the far side's marks with and without the stone's depth (stone-occluder.png)
// - pairs [look]: within one look, the three cameras crossed with sparse and resolved detail, the camera and the marks
//   fixed (stone-pairs-<look>.png): the board for judging the drawing against the reference
// - brush: the drawing spare, one patch brushed back, then seen from round the side (stone-brush.png)
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const which = process.argv[2] ?? 'all';
await withWood(async (wood) => {
  const page = await wood.open('scene=stone&res=1&clean');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'stone' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
  const settle = () => page.waitForTimeout(1800);
  const shot = async (name) => { await settle(); return wood.shot(page, name); };
  const stats = () => page.evaluate(() => document.getElementById('stats').textContent);
  if (which === 'all' || which === 'views') {
    const shots = [], labels = [];
    for (const look of ['dry', 'wash']) { await S('setLook', look); for (const v of ['hero', 'grazing', 'reverse']) { await S('setView', v); shots.push(await shot(`stone-${look}-${v}`)); labels.push(`${look} · ${v}`); } }
    console.log('views', await stats());
    await wood.montage(shots, 'stone-views', { height: 560, labels });
  }
  if (which === 'all' || which === 'detail') {
    const shots = [], labels = [];
    await S('setLook', 'dry'); await S('setView', 'hero');
    for (const d of [1, 0.7, 0.45, 0.2]) for (const th of [0, 1]) { await S('setDetail', d); await S('setThin', th); shots.push(await shot(`stone-detail-${d}-${th}`)); labels.push(`${Math.round(d * 100)}% · ${th ? 'even' : 'by rank'} · ${(await stats()).split(' ·')[0]}`); }
    await S('setDetail', 1); await S('setThin', 0);
    await wood.montage(shots, 'stone-detail', { height: 460, labels });
  }
  if (which === 'all' || which === 'pairs') {
    for (const look of process.argv[3] ? [process.argv[3]] : ['wash', 'dry']) {
      const shots = [], labels = [];
      await S('setLook', look); await S('setThin', 0);
      for (const d of [1, 0.3]) for (const v of ['hero', 'grazing', 'reverse']) { await S('setView', v); await S('setDetail', d); shots.push(await shot(`stone-pair-${look}-${v}-${d}`)); labels.push(`${look} · ${v} · ${d === 1 ? 'resolved' : 'sparse'} · ${(await stats()).split(' ·')[0]}`); }
      await S('setDetail', 1);
      await wood.montage(shots, `stone-pairs-${look}`, { height: 520, labels, columns: 3 });
    }
  }
  if (which === 'all' || which === 'occluder') {
    const shots = [], labels = [];
    await S('setLook', 'dry'); await S('setView', 'reverse');
    for (const o of [true, false]) { await S('setOccluder', o); shots.push(await shot(`stone-occ-${o}`)); labels.push(o ? 'reverse · occluder on' : 'reverse · occluder off'); }
    await S('setView', 'grazing');
    for (const o of [true, false]) { await S('setOccluder', o); shots.push(await shot(`stone-occg-${o}`)); labels.push(o ? 'grazing · occluder on' : 'grazing · occluder off'); }
    await S('setOccluder', true);
    await wood.montage(shots, 'stone-occluder', { height: 560, labels });
  }
  if (which === 'all' || which === 'brush') {
    const shots = [], labels = [];
    await S('setLook', 'wash'); await S('setView', 'hero'); await S('setDetail', 0.15);
    shots.push(await shot('stone-brush-0')); labels.push('spare (15%)');
    // (a stroke across the stone's shadowed side, on the screen)
    const box = await page.evaluate(() => { const r = document.getElementById('view').getBoundingClientRect(); return [r.width, r.height]; });
    for (let k = 0; k <= 12; k++) await S('paint', box[0] * (0.5 + k * 0.03), box[1] * (0.5 + k * 0.006));
    console.log('brushed', await stats());
    shots.push(await shot('stone-brush-1')); labels.push('a patch brushed back');
    await S('at', 1.6, 0.3); shots.push(await shot('stone-brush-2')); labels.push('turned: the patch stays on the stone');
    await wood.montage(shots, 'stone-brush', { height: 560, labels });
  }
  if (page.errors.length) console.log('errors', page.errors);
}, { width: 390, height: 640 });
