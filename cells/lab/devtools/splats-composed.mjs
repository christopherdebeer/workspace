// The composed scene's boards (node cells/lab/devtools/splats-composed.mjs [wash|dry]): a stone, three culms and an
// architectural corner together, drawn with the shared brushes.
// - composed-states-<look>.png: sparse, intermediate, resolved, with the relationships (importance, one ground, the
//   halo) and without (each object drawn as if alone), from the hero view;
// - composed-orbit-<look>.png: a full turn at resolved, eight views;
// - composed-close-<look>.png: close inspection: the culm in front of the stone and the corner behind it, halo off and
//   on; the stone close; the grove.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const look = process.argv[2] ?? 'wash';
await withWood(async (wood) => {
  const page = await wood.open(`scene=composed&res=1&clean&look=${look}`);
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

  // ─── a full turn ───
  await C('setCompose', true); await S('frame', null); await S('setDetail', 1);
  const o = [], ol = [];
  for (let k = 0; k < 8; k++) { const yaw = 0.6 + (k / 8) * Math.PI * 2; await S('at', yaw, 0.3); o.push(await shot(`composed-${look}-orbit-${k}`)); ol.push(`turn ${k * 45}°`); }
  await wood.montage(o, `composed-orbit-${look}`, { height: 360, labels: ol, columns: 4 });

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
