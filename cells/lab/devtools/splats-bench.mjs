// The Bench board (node cells/lab/devtools/splats-bench.mjs). Two parts:
// 1. Dependable deposition: the same stroke and wash on a plane, a cylinder and in open space, at density 0.5, 1 and 2
//    (the tone should hold), and from three sides.
// 2. One editable stroke: the culm's stroke selected, bent (one control point dragged), made dry, given a swell, then
//    undone three times, which should restore the original drawing exactly. Each step reports what was deposited again.
// Writes devtools/out/bench-deposit.png and bench-edit.png, and prints the edit log.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
await withWood(async (wood) => {
  const page = await wood.open('scene=bench&res=1&clean');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'bench' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const B = (f, ...a) => page.evaluate(([f, a]) => window.__splats.bench[f](...a), [f, a]);
  const st = () => page.evaluate(() => window.__splats.bench.state);
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
  const shot = async (name) => { await page.waitForTimeout(1600); return wood.shot(page, name); };

  // ─── 1. deposition: density and sides ───
  const shots = [], labels = [];
  for (const d of [0.5, 1, 2]) { await B('density', d); const s = await st(); shots.push(await shot(`bench-density-${d}`)); labels.push(`density ${d} · ${s.total.toLocaleString()} marks`); }
  await B('density', 1);
  for (const [yaw, nm] of [[-0.5, 'from the left'], [1.6, 'from the right'], [0.6 + Math.PI, 'from behind']]) { await S('at', yaw, 0.25); shots.push(await shot(`bench-side-${nm.replace(/ /g, '-')}`)); labels.push(nm); }
  await wood.montage(shots, 'bench-deposit', { height: 360, labels, columns: 3 });

  // ─── 2. one editable stroke, by real input: a tap on it selects it, a handle dragged bends it ───
  await S('setView', 'hero');
  await page.evaluate(() => { const c = window.__splats.cam; c.target = [0.05, 0.62, 0]; c.dist = 2.1; });
  const e = [], el = [], log = [];
  const fingerprint = () => page.evaluate(() => { const st = window.__splats.bench.state; return JSON.stringify(st.items.map((i) => [i.ctrl, i.material, i.pressure, i.weight, i.marks])); });
  const original = await fingerprint();
  e.push(await shot('bench-edit-0')); el.push('as made');
  // (tap the culm's stroke: the middle of its marks on the screen)
  const tap = await page.evaluate(() => { const b = window.__splats.bench, it = b.state.items[1]; const c = it.ctrl[1]; return b.screen(c); });
  await page.mouse.click(tap[0], tap[1]);
  await page.waitForTimeout(300);
  log.push(`tap at ${tap.map((v) => v.toFixed(0))}: selected ${(await st()).selected}`);
  e.push(await shot('bench-edit-1')); el.push(`a tap selects it (selected: ${(await st()).selected === 1 ? 'culm' : 'none'})`);
  // (drag its second handle round the culm: the finger's point is taken onto the surface)
  const box = await page.evaluate(() => { const h = document.querySelectorAll('#handles div')[1].getBoundingClientRect(); return [h.left + h.width / 2, h.top + h.height / 2]; });
  const to = await page.evaluate(() => window.__splats.bench.screen([Math.cos(0.5) * 0.2, 0.55, Math.sin(0.5) * 0.2]));
  await page.mouse.move(box[0], box[1]); await page.mouse.down();
  for (let k = 1; k <= 8; k++) { await page.mouse.move(box[0] + ((to[0] - box[0]) * k) / 8, box[1] + ((to[1] - box[1]) * k) / 8); await page.waitForTimeout(60); }
  await page.mouse.up(); await page.waitForTimeout(200);
  log.push(`bend (dragged a handle): ${(await st()).msg}`); e.push(await shot('bench-edit-2')); el.push('a handle dragged round the culm: bent');
  await page.evaluate(() => [...document.querySelectorAll('#b-materials button')].find((b) => b.textContent === 'dry').click());
  log.push(`dry: ${(await st()).msg}`); e.push(await shot('bench-edit-3')); el.push('material: dry');
  await page.evaluate(() => [...document.querySelectorAll('#b-pressures button')].find((b) => b.textContent === 'swell').click());
  await B('weight', 1.8); log.push(`swell + weight: ${(await st()).msg}`); e.push(await shot('bench-edit-4')); el.push('pressure: swell, weight 1.8×');
  const undos = (await st()).undo;
  for (let k = 0; k < undos; k++) await B('undo');
  const restored = (await fingerprint()) === original;
  log.push(`undo ×${undos} restores the original: ${restored}`);
  await B('select', -1); e.push(await shot('bench-edit-5')); el.push(`undone ×${undos} (identical: ${restored})`);
  await wood.montage(e, 'bench-edit', { height: 360, labels: el, columns: 3 });
  console.log(log.join('\n'));
  if (page.errors.length) console.log('errors', page.errors);
}, { width: 390, height: 520 });
