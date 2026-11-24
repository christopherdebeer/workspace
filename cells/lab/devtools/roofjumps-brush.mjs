// The brushwork looks judged on one replay (scenes.ts `paint-alley`; strokes.ts): the same moments, the same eyes, in
// the deployed gouache (the comparison), stroke gouache and sumi. The moments are taken from the run itself (the
// approach, the takeoff, the correction in the air, the hand going to the lip, the hang, the pull up); the eyes are the
// chase, a closer side view, the scene's still eye on the room, an orbit round one moment (the paint should stay
// planted as the eye swings), and a phone-sized chase, where each pass is timed and the paint's fragments a pixel
// counted. Writes devtools/out/brush/report.html.
//
//   node cells/lab/devtools/roofjumps-brush.mjs [--looks=gouache,stroke-gouache,sumi]
import { build } from 'esbuild';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname, OUT = new URL('./out/brush/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './scenes';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { sceneByKey, runScene } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
// (--reuse: keep pictures already filmed, for a look whose code hasn't changed)
const reuse = process.argv.includes('--reuse');
const LOOKS = (process.argv.find((a) => a.startsWith('--looks='))?.slice(8) ?? 'gouache,stroke-gouache,sumi').split(',');
const scene = sceneByKey('paint-alley'), run = runScene(scene, 1);
const up = run.ups[0]?.t ?? 1, hang = run.moves.find((m) => m.move === 'hang')?.t ?? up + 0.5, climb = run.moves.find((m) => m.move === 'climb')?.t ?? hang + 1.3;
const MOMENTS = [['approach', up - 0.55], ['takeoff', up], ['correction', up + 0.14], ['reaching', hang - 0.1], ['caught', hang + 0.25], ['pulling up', climb + 0.15]].map(([name, t]) => ({ name, t: Math.max(0, +t) }));
const T0 = MOMENTS[0].t, EVERY = 0.36;
console.log('moments:', MOMENTS.map((m) => `${m.name} ${m.t.toFixed(2)} s`).join(', '));
mkdirSync(OUT, { recursive: true });
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
const { withWood } = await import('./harness.mjs');
const settle = async (p) => { for (let k = 0; k < 120 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250); await p.waitForTimeout(500); };
const shots = [], costs = {};
await withWood(async (w) => {
  for (const look of LOOKS) {
    // (each moment: chase and side, a frame each; the room's still eye; an orbit at the correction)
    // (each view as one strip: the six moments, evenly from the approach to the hang, three across)
    for (const [view, extra] of [['chase', ''], ['side', '&side=90&zoom=1.35'], ['room', '&fixed']]) {
      const file = `${look}-${view}.png`;
      if (reuse && existsSync(OUT + file)) { shots.push({ look, view, file }); continue; }
      const p = await w.open(`scene=paint-alley&strip=${T0.toFixed(4)}&frames=6&every=${EVERY}&cols=3&holds=0&look=${look}${extra}`, { width: 1500, height: 640, dpr: 1 });
      await settle(p); await p.screenshot({ path: OUT + file, timeout: 300000 }); await p.close();
      shots.push({ look, view, file });
      console.log(`filmed ${look} ${view}`);
    }
    for (const deg of [-50, 0, 50]) {
      const file = `${look}-orbit-${deg}.png`;
      if (reuse && existsSync(OUT + file)) { shots.push({ look, view: 'orbit', moment: `${deg}°`, file }); continue; }
      const p = await w.open(`scene=paint-alley&strip=${(up + 0.14).toFixed(4)}&frames=1&cols=1&holds=0&look=${look}&side=${deg}`, { width: 600, height: 400, dpr: 1 });
      await settle(p); await p.screenshot({ path: OUT + file, timeout: 300000 }); await p.close(); shots.push({ look, view: 'orbit', moment: `${deg}°`, file });
    }
    // (the phone: the live page, the scene playing, each pass timed (the GPU waited on between, so coarse; the same on a
    // phone), and the paint's fragments a pixel counted at the caught moment, close under the far wall)
    // (the deployed gouache isn't timed by pass: a still of it at phone size, for comparison)
    if (!w.base || look === 'gouache') {
      const file = `${look}-phone.png`;
      if (!(reuse && existsSync(OUT + file))) { const p = await w.open(`scene=paint-alley&strip=${hang.toFixed(4)}&frames=1&cols=1&holds=0&look=${look}`, { width: 390, height: 844, dpr: 2 }); await settle(p); await p.screenshot({ path: OUT + file, timeout: 300000 }); await p.close(); }
      shots.push({ look, view: 'phone', moment: 'playing', file });
    } else {
      const p = await w.open(`scene=paint-alley&look=${look}&cost&holds=0`, { width: 390, height: 844, dpr: 2 });
      await settle(p);
      const samples = [];
      for (let i = 0; i < 24; i++) { await p.waitForTimeout(120); samples.push(await p.evaluate(() => window.__roofjumps.cost())); }
      await p.screenshot({ path: OUT + `${look}-phone.png`, timeout: 300000 }); shots.push({ look, view: 'phone', moment: 'playing', file: `${look}-phone.png` });
      await p.evaluate(() => window.__roofjumps.count(true)); await p.waitForTimeout(4000);
      const od = await p.evaluate(() => window.__roofjumps.overdraw()); await p.evaluate(() => window.__roofjumps.count(false));
      const avg = (k) => samples.reduce((n, s) => n + (s[k] ?? 0), 0) / samples.length;
      costs[look] = { depth: avg('depth'), city: avg('city'), shadow: avg('shadow'), figure: avg('figure'), stamps: Math.round(avg('stamps')), chunks: samples.at(-1).chunks, overdraw: od };
      await p.close();
      console.log(look, JSON.stringify(costs[look]));
    }
  }
});
writeFileSync(OUT + 'report.json', JSON.stringify({ moments: MOMENTS, shots, costs }, null, 1));
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const img = (f, alt) => `<img src="${f}" alt="${esc(alt)}" loading="lazy">`;
const by = (look, view, moment) => shots.find((s) => s.look === look && s.view === view && s.moment === moment);
const by2 = (look, view) => shots.find((s) => s.look === look && s.view === view);
const views = ['chase', 'side', 'room'].map((v) => `<h2>${v === 'room' ? 'The room, from a still eye' : v === 'side' ? 'Closer, from the side' : 'The chase'}</h2>
${LOOKS.map((l) => `<figure class="strip">${img(by2(l, v).file, `${l}, ${v}: six moments from ${T0.toFixed(2)} s, every ${EVERY} s`)}<figcaption><b>${l}</b> · ${Array.from({ length: 6 }, (_, i) => (T0 + i * EVERY).toFixed(2) + ' s').join(', ')}</figcaption></figure>`).join('\n')}`).join('\n');
const orbit = `<h2>The eye swung round one moment (the correction in the air)</h2>${LOOKS.map((l) => `<div class="row"><b>${l}</b>${[-50, 0, 50].map((d) => `<figure>${img(by(l, 'orbit', `${d}°`).file, `${l}, ${d}°`)}<figcaption>${d}°</figcaption></figure>`).join('')}</div>`).join('')}`;
const f1 = (x) => (x ?? 0).toFixed(1);
const cost = `<h2>Cost, at phone size (390 × 844 at 2×), the scene playing</h2>
<table><thead><tr><th>look</th><th>depth ms</th><th>city paint ms</th><th>runner's shadow ms</th><th>runner ms</th><th>stamps drawn</th><th>paint fragments a pixel (mean / most)</th></tr></thead><tbody>
${LOOKS.map((l) => { const c = costs[l]; if (!c) return ''; const od = c.overdraw ?? {}, tot = Object.values(od).reduce((n, o) => n + o.mean, 0), most = Math.max(0, ...Object.values(od).map((o) => o.max)); return `<tr><th>${l}</th><td>${f1(c.depth)}</td><td>${f1(c.city)}</td><td>${f1(c.shadow)}</td><td>${f1(c.figure)}</td><td>${c.stamps || '—'}</td><td>${tot ? `${tot.toFixed(2)} / ${most} <small>(${Object.entries(od).map(([k, o]) => `${k} ${o.mean.toFixed(2)}`).join(', ')})</small>` : '—'}</td></tr>`; }).join('')}
</tbody></table>
<p class="note">Times are with the GPU waited on after each pass, in a software-rendered headless browser: their proportions, not their sizes, carry over. On a phone, open the page with <code>?cost</code> and ask <code>__roofjumps.cost()</code>; the deployed gouache isn't timed by pass (it's one shaded pass and the paint filter).</p>
<div class="row">${LOOKS.map((l) => by(l, 'phone', 'playing') ? `<figure>${img(by(l, 'phone', 'playing').file, `${l} at phone size`)}<figcaption>${l}</figcaption></figure>` : '').join('')}</div>`;
writeFileSync(OUT + 'report.html', `<title>Roof Jumps Brushwork</title>
<style>
:root { --bg: #f1efe9; --panel: #faf9f6; --ink: #1f1d1a; --muted: #6a645c; --rule: #d9d4ca; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #171614; --panel: #201e1b; --ink: #ebe7df; --muted: #a39b8f; --rule: #37332e; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #171614; --panel: #201e1b; --ink: #ebe7df; --muted: #a39b8f; --rule: #37332e; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 24px 16px 48px; max-width: 1500px; margin-inline: auto; }
h1 { font-size: 1.6rem; margin: 0 0 6px; } h2 { font-size: 1.1rem; margin: 32px 0 10px; } .lede, .note { color: var(--muted); max-width: 80ch; }
.grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 8px; } .grid > b { font-family: ui-monospace, monospace; font-weight: 600; }
.row { display: flex; gap: 8px; align-items: flex-start; overflow-x: auto; margin-bottom: 8px; } .row > b { font-family: ui-monospace, monospace; min-width: 9ch; padding-top: 4px; }
figure { margin: 0; } img { width: 100%; display: block; border-radius: 4px; background: var(--panel); } .row img { width: 300px; } .strip { margin-bottom: 14px; } .row figure:has(img[alt*="phone"]) img { width: 180px; }
figcaption { color: var(--muted); font-size: 0.8rem; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
@media (max-width: 700px) { .grid { grid-template-columns: 1fr; } .grid > b { display: none; } }
</style>
<h1>Roof Jumps brushwork, on one replay</h1>
<p class="lede">The painted alley (<code>?scene=paint-alley</code>): a roof approach, the stick swung left in the air and back, a lip caught short across an alley to a higher roof, a hang and a pull up. Each moment from the same eye and at the same time in each look: the deployed gouache (shaded faces and a paint filter), stroke gouache and sumi (every visible mark a brush stroke laid on the solid world, no filter). Re-run with <code>node cells/lab/devtools/roofjumps-brush.mjs</code>.</p>
${views}
${orbit}
${cost}`);
console.log(`→ ${OUT}report.html`);
