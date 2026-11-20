// Roof Jumps' scenes (client/roofjumps/scenes.ts): each authored course run with its scripted stick, its checks judged,
// and (with --film) filmed from the chase eye and from the side into devtools/out/scenes/, with a report (report.json,
// and report.html: a contact sheet of every scene, what it asks, what it should do and whether it did).
//
//   node cells/lab/devtools/roofjumps-scenes.mjs [keys…] [--film] [--look=gouache] [--eye=painter]
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const OUT = new URL(`./out/scenes${process.argv.find((a) => a.startsWith('--look=')) ? '-' + process.argv.find((a) => a.startsWith('--look=')).slice(7) : ''}/`, import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './scenes';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { SCENES, runScene, judge, sequence } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const args = process.argv.slice(2), keys = args.filter((a) => !a.startsWith('--')), film = args.includes('--film');
// (`--look=<name>`: filmed in that look (looks.ts), into devtools/out/scenes-<name>/, the checks and report as ever)
const look = args.find((a) => a.startsWith('--look='))?.slice(7) ?? '';
// (`--eye=painter`: the chase film through the painter's camera (main.ts CAMERAS): high, a long lens)
const EYES = { painter: '&fov=30&eyeDist=10&eyePitch=34&rush=2&side=20' }, eye = EYES[args.find((a) => a.startsWith('--eye='))?.slice(6)] ?? '';
const chosen = keys.length ? SCENES.filter((s) => keys.includes(s.key)) : SCENES;
mkdirSync(OUT, { recursive: true });
const report = [];
for (const s of chosen) {
  const run = runScene(s), checks = judge(s, run), r = run.runner;
  report.push({ key: s.key, title: s.title, eye: s.eye ?? null, asks: s.asks, watch: s.watch, gap: s.gap ?? '', seconds: s.seconds, sequence: sequence(run), checks, end: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), z: +r.z.toFixed(2), state: r.state, move: r.move }, takeoffs: run.ups.map((u) => ({ t: +u.t.toFixed(2), foot: u.foot, move: u.move, by: u.by })), landings: run.lands.map((l) => ({ t: +l.t.toFixed(2), v: +l.v.toFixed(1), from: l.from, save: l.save })) });
  const passed = checks.filter((c) => c.ok).length;
  console.log(`\n${s.key.padEnd(16)} ${passed}/${checks.length}  ${sequence(run) || 'run'}`);
  for (const c of checks) console.log(`   ${c.ok ? '✓' : '✗'} ${c.says} — ${c.saw}`);
}
writeFileSync(OUT + 'report.json', JSON.stringify(report, null, 1));
if (film) {
  process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
  const { withWood } = await import('./harness.mjs');
  await withWood(async (lab) => {
    for (const s of chosen) for (const [view, extra] of [['chase', eye], ['side', '&side=90&zoom=1.1'], ...(s.eye ? [['room', '&fixed']] : [])]) {
      // (close round its first takeoff, if it asks: a flight is a third of a second; else across the whole run)
      const run0 = s.close ? runScene(s) : null, t0 = run0 ? (typeof s.close === 'function' ? s.close(run0) : run0.ups[0] ? Math.max(0, run0.ups[0].t - 0.25) : 0) : 0;
      const n = 16, every = s.close ? 1 / 30 : s.seconds / n;
      const p = await lab.open(`scene=${s.key}&strip=${t0.toFixed(4)}&frames=${n}&every=${every.toFixed(4)}&cols=8&holds=0${extra}${look ? `&look=${look}` : ''}`, { width: 1600, height: 560, dpr: 1 });
      for (let k = 0; k < 80 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
      await p.waitForTimeout(800); await p.screenshot({ path: `${OUT}${s.key}-${view}.png` }); await p.close();
      console.log(`filmed ${s.key} (${view})`);
    }
  });
}
// (the contact sheet: every scene, what it asks, what it should do and whether it did, its two strips, and the dated notes
// from the last viewing (devtools/scene-notes.json), with the gaps they found first)
{
  let notes = { summary: [], seen: {}, date: '', build: '' }; try { notes = JSON.parse(readFileSync(new URL('./scene-notes.json', import.meta.url), 'utf8')); } catch { /* none yet */ }
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // (a basin measured for it (devtools/roofjumps-basin.mjs): how far its move survives the input being off)
  const basinOf = (key) => { try { const b = JSON.parse(readFileSync(new URL(`./out/basin/${key}.json`, import.meta.url), 'utf8')), w = b.widths; return `<dt>Basin</dt><dd>${Math.round(b.share * 100)}% of ${b.lateMap.flat().length + b.turnMap.flat().length} perturbed runs do <code>${esc(b.signature)}</code>: the start ${w.start ? `${w.start[0]} to ${w.start[1]} m` : 'not off at all'} across, the stick ${w.late ? `up to ${w.late[1]} frames` : 'not at all'} late, ${w.turn ? `${w.turn[0]}° to ${w.turn[1]}°` : 'not'} turned</dd>`; } catch { return ''; } };
  const held = report.reduce((n, s) => n + s.checks.filter((c) => c.ok).length, 0), all = report.reduce((n, s) => n + s.checks.length, 0);
  const title = (k) => report.find((r) => r.key === k)?.title ?? k;
  const item = (g) => `<li><a href="#${g.scene}">${esc(title(g.scene))}</a><p>${esc(g.gap.replace(/^Fixed: /, ''))}</p></li>`, here = notes.summary.filter((g) => report.some((r) => r.key === g.scene));
  // (what a pass fixed (a note starting 'Fixed:') listed after what's still missing)
  const fixed = here.filter((g) => g.gap.startsWith('Fixed:')).map(item).join('');
  const gaps = here.filter((g) => !g.gap.startsWith('Fixed:')).map((g) => `<li><a href="#${g.scene}">${esc(title(g.scene))}</a><p>${esc(g.gap)}</p></li>`).join('');
  const cards = report.map((r) => {
    const okN = r.checks.filter((c) => c.ok).length;
    const checks = r.checks.map((c) => `<li class="${c.ok ? 'held' : 'failed'}"><span class="mark">${c.ok ? 'holds' : 'fails'}</span><span class="says">${esc(c.says)}</span><span class="saw">${esc(c.saw)}</span></li>`).join('');
    return `<article class="scene" id="${r.key}">
  <header><h2>${esc(r.title)}</h2><p class="meta"><code>?scene=${r.key}</code> · ${r.seconds} s · <b>${okN}/${r.checks.length}</b> hold</p></header>
  <div class="body">
    <div class="words">
      <p class="asks">${esc(r.asks)}</p>
      <dl><dt>Watch</dt><dd>${esc(r.watch)}</dd>${r.gap ? `<dt>Suspected gap</dt><dd>${esc(r.gap)}</dd>` : ''}${notes.seen[r.key] ? `<dt>Seen on film</dt><dd>${esc(notes.seen[r.key])}</dd>` : ''}<dt>What it did</dt><dd><code>${esc(r.sequence || 'ran')}</code></dd>${basinOf(r.key)}</dl>
      <ul class="checks">${checks}</ul>
    </div>
    <figure><img src="${r.key}-chase.png" alt="${esc(r.title)}, from the chase eye, frame by frame" loading="lazy"><figcaption>Chase eye</figcaption></figure>
    <figure><img src="${r.key}-side.png" alt="${esc(r.title)}, from the side, frame by frame" loading="lazy"><figcaption>From the side</figcaption></figure>${r.eye ? `
    <figure><img src="${r.key}-room.png" alt="${esc(r.title)}, from a still eye on the room, frame by frame" loading="lazy"><figcaption>From a still eye on the room</figcaption></figure>` : ''}
  </div>
</article>`; }).join('\n');
  const html = `<title>${look ? `Roof Jumps in ${look[0].toUpperCase() + look.slice(1)}` : 'Roof Jumps Scenes'}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* a study sheet: the grey of the grey-box city, one signal colour for what fails, everything else quiet */
:root { --bg: #eef0f1; --panel: #f8f9f9; --ink: #1d2124; --muted: #5d666c; --rule: #d3d8db; --fail: #c4521f; --hold: #3d7a5f; --code: #e3e7e9;
  --sans: "IBM Plex Sans", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #16191b; --panel: #1e2225; --ink: #e4e8ea; --muted: #9aa4aa; --rule: #30363a; --fail: #ef7a45; --hold: #74b896; --code: #262b2e; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #16191b; --panel: #1e2225; --ink: #e4e8ea; --muted: #9aa4aa; --rule: #30363a; --fail: #ef7a45; --hold: #74b896; --code: #262b2e; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 var(--sans); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 28px 64px; }
main { max-width: 1240px; margin: 0 auto; display: grid; gap: 28px; }
h1 { font-weight: 600; font-size: 1.7rem; margin: 0; text-wrap: balance; letter-spacing: -0.01em; }
h2 { font-weight: 600; font-size: 1.2rem; margin: 0; text-wrap: balance; }
.lede { color: var(--muted); max-width: 70ch; margin: 6px 0 0; }
.tally { font-family: var(--mono); font-size: 0.85rem; color: var(--muted); margin-top: 10px; }
code { font-family: var(--mono); font-size: 0.85em; background: var(--code); padding: 1px 5px; border-radius: 3px; }
.gaps { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; padding: 18px 20px; }
.gaps h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 500; }
.gaps ol { margin: 12px 0 0; padding-left: 1.4em; display: grid; gap: 10px; }
.gaps li a { color: var(--ink); font-weight: 600; text-decoration-color: var(--rule); }
.gaps li p { margin: 2px 0 0; color: var(--muted); max-width: 90ch; }
.scene { background: var(--panel); border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
.scene header { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px; padding: 16px 20px 0; }
.meta { margin: 0; color: var(--muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.body { display: grid; gap: 16px; padding: 12px 20px 20px; }
.words { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; }
.asks { margin: 0; grid-column: 1 / -1; max-width: 85ch; }
dl { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; font-size: 0.92rem; align-content: start; }
dt { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; padding-top: 3px; }
dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 0.9rem; align-content: start; }
.checks li { display: grid; grid-template-columns: 3.4rem minmax(0, 1fr); gap: 0 10px; }
.mark { font-family: var(--mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 2px; }
.held .mark { color: var(--hold); } .failed .mark { color: var(--fail); font-weight: 500; }
.says { min-width: 0; } .saw { grid-column: 2; color: var(--muted); font-family: var(--mono); font-size: 0.78rem; overflow-wrap: anywhere; }
figure { margin: 0; display: grid; gap: 4px; }
figure img { width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--rule); background: #c9cdcf; }
figcaption { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
a:focus-visible { outline: 2px solid var(--fail); outline-offset: 2px; }
@media (max-width: 760px) { .words { grid-template-columns: minmax(0, 1fr); } dl { grid-template-columns: minmax(0, 1fr); } dt { padding-top: 6px; } }
</style>
<main>
  <section>
    <h1>${look ? `Roof Jumps scenes, in ${esc(look)}` : 'Roof Jumps scenes'}</h1>
    <p class="lede">Authored courses, each run with a scripted stick, the same every time, to film and judge. Each asks what the athlete should do, including things it can't yet. The checks that fail are the critique. Re-run with <code>node cells/lab/devtools/roofjumps-scenes.mjs --film</code>; open one on the page with <code>?scene=&lt;key&gt;</code>.</p>
    <p class="tally">${held}/${all} checks hold across ${report.length} scenes${notes.date ? ` · notes from the viewing of ${esc(notes.date)} (${esc(notes.build)})` : ''}</p>
  </section>
  ${gaps ? `<section class="gaps"><h2>What it can't or doesn't do yet</h2><ol>${gaps}</ol></section>` : ''}
  ${fixed ? `<section class="gaps"><h2>Fixed in the last pass</h2><ol>${fixed}</ol></section>` : ''}
  ${cards}
</main>`;
  writeFileSync(OUT + 'report.html', html);
}
console.log(`\n${report.reduce((n, s) => n + s.checks.filter((c) => c.ok).length, 0)}/${report.reduce((n, s) => n + s.checks.length, 0)} checks hold → ${OUT}report.json`);
