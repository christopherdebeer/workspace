// The composed scene's boards (node cells/lab/devtools/splats-composed.mjs [wash|dry]): a stone, three culms and an
// architectural corner together, drawn with the shared brushes.
// - composed-states-<look>.png: sparse, intermediate, resolved, with the relationships (importance, one ground, the
//   halo) and without (each object drawn as if alone), from the hero view;
// - composed-orbit-<look>.png: a full turn, eight views, at sparse (top row) and resolved (bottom row);
// - composed-edit-<look>.png: editing in the scene: the seam bent (its wedge follows), re-pressured, its wash widened,
//   the bank bent, then all undone;
// - composed-close-<look>.png: close inspection: the culm in front of the stone and the corner behind it, halo off and
//   on; the stone close; the grove.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const look = process.argv[2] ?? 'wash';
await withWood(async (wood) => {
  let page = await wood.open(`scene=composed&res=1&clean&look=${look}`);
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
  const C = (f, ...a) => page.evaluate(([f, a]) => window.__splats.composed[f](...a), [f, a]);
  const shot = async (name) => { await page.waitForTimeout(1800); return wood.shot(page, name); };
  const STATES = [['sparse', 0.25], ['intermediate', 0.55], ['resolved', 1]];

  // ─── states, with and without the relationships ───
  const a = [], al = [];
  for (const on of [true, false]) {
    await C('setCompose', on); await S('frame', null);
    for (const [nm, d] of STATES) { await S('setDetail', d); a.push(await shot(`composed-${look}-${on ? 'on' : 'off'}-${nm}`)); al.push(`${on ? 'composed' : 'each alone'} · ${nm}`); }
  }
  await wood.montage(a, `composed-states-${look}`, { height: 420, labels: al, columns: 3 });

  // ─── a full turn, sparse and resolved ───
  await C('setCompose', true); await S('frame', null);
  const o = [], ol = [];
  for (const [nm, d] of [['sparse', 0.25], ['resolved', 1]]) {
    await S('setDetail', d);
    for (let k = 0; k < 8; k++) { const yaw = 0.6 + (k / 8) * Math.PI * 2; await S('at', yaw, 0.3); o.push(await shot(`composed-${look}-orbit-${nm}-${k}`)); const g = await page.evaluate(() => window.__splats.composed.gates); ol.push(`${nm} · ${k * 45}° · stone tone ${g.vis.toFixed(2)}`); }
  }
  await wood.montage(o, `composed-orbit-${look}`, { height: 300, labels: ol, columns: 8 });

  // ─── editing in the scene (on a fresh page: a long session of uploads in software GL can exhaust headless Chrome) ───
  await page.close();
  page = await wood.open(`scene=composed&res=1&clean&look=${look}`);
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const B = (f, ...a) => page.evaluate(([f, a]) => window.__splats.bench[f](...a), [f, a]);
  const st = () => page.evaluate(() => window.__splats.bench.state);
  await S('setDetail', 1); await S('frame', 'stone'); await S('at', 0.6, 0.3);
  const fp = () => page.evaluate(() => JSON.stringify(window.__splats.bench.state.items.map((i) => [i.ctrl, i.material, i.pressure, i.weight, i.wash, i.marks])));
  const original = await fp(), ed = [], el = [], log = [];
  ed.push(await shot(`composed-${look}-edit-0`)); el.push('as composed');
  const seam = (await st()).items.findIndex((i) => i.name === 'seam');
  await B('select', seam);
  const h = (await st()).items[seam].ctrl[2];
  await B('drag', 2, [h[0] - 0.12, h[1] + 0.1, h[2] + 0.1]); log.push(`seam bent: ${(await st()).msg}`);
  ed.push(await shot(`composed-${look}-edit-1`)); el.push('the seam bent (its wedge follows)');
  await B('pressure', 'press in'); await B('weight', 1.6); log.push(`seam re-pressured: ${(await st()).msg}`);
  ed.push(await shot(`composed-${look}-edit-2`)); el.push('pressed in, heavier');
  await B('wash', 2); log.push(`wedge widened: ${(await st()).msg}`);
  ed.push(await shot(`composed-${look}-edit-3`)); el.push('its wash widened ×2');
  const bank = (await st()).items.findIndex((i) => i.name === 'bank');
  await S('frame', null); await S('at', 0.6, 0.45); await B('select', bank);
  const b = (await st()).items[bank].ctrl[2];
  await B('drag', 2, [b[0] - 0.3, b[1], b[2] + 0.35]); log.push(`bank bent: ${(await st()).msg}`);
  ed.push(await shot(`composed-${look}-edit-4`)); el.push('the bank bent (its slope follows)');
  const n = (await st()).undo; for (let k = 0; k < n; k++) await B('undo');
  await B('select', -1); const restored = (await fp()) === original; log.push(`undo ×${n} restores the scene: ${restored}`);
  ed.push(await shot(`composed-${look}-edit-5`)); el.push(`undone ×${n} (identical: ${restored})`);
  await wood.montage(ed, `composed-edit-${look}`, { height: 420, labels: el, columns: 3 });
  console.log(log.join('\n'));

  // ─── close ───
  const c = [], cl = [];
  for (const [subj, yaw, pitch, nm] of [['overlap', 0.6, 0.2, 'the culm across the stone'], ['stone', 0.1, 0.32, 'the corner behind the stone']]) {
    for (const h of [false, true]) { await C('setHalo', h); await S('frame', subj); await S('at', yaw, pitch); c.push(await shot(`composed-${look}-close-${subj}-${h ? 'halo' : 'nohalo'}`)); cl.push(`${nm} · halo ${h ? 'on' : 'off'}`); }
  }
  await C('setHalo', true);
  await S('frame', 'stone'); await S('at', 0.6 + Math.PI, 0.3); c.push(await shot(`composed-${look}-close-reverse`)); cl.push('the stone from behind, the corner beyond');
  await S('frame', 'grove'); await S('at', 1.4, 0.15); c.push(await shot(`composed-${look}-close-grove`)); cl.push('the grove, low');
  await wood.montage(c, `composed-close-${look}`, { height: 420, labels: cl, columns: 3 });
  if (page.errors.length) console.log('errors', page.errors);
}, { width: 390, height: 520 });
