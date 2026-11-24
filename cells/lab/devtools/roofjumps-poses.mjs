// Every pose, for every character (poses.ts, character.ts): each move held at five points through it, drawn and checked
// for large misses: a foot off or through the ground in a pose that stands on it, any block below the ground, the head
// below the hips where nothing turns it over, a hand short of what it's meant to be holding. With --film, each
// character's sheet drawn on the page and laid out as a contact sheet (a row a move, a column
// a character) with the misses marked: devtools/out/poses/report.html.
//
//   node cells/lab/devtools/roofjumps-poses.mjs [--film]
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname, OUT = new URL('./out/poses/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './poses'; export * from './character'; export * from './rig'; export * from './m4';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { POSE_MOVES, heldBody, CHARACTERS, bodyOf, Rig, point } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const film = process.argv.includes('--film'), MUS = [0.05, 0.28, 0.5, 0.72, 0.95];
const STANDS = new Set(['stand', 'run', 'dash', 'ledge', 'land']);
// (each pose measured: how far the feet are into or off the ground, the lowest block, whether the head's below the hips,
// how far each hand is from its hold)
const measure = (c, move, mu) => {
  const b = bodyOf(c.proportions), body = heldBody({ x: 0, y: 0, z: 0 }, move, mu, 1, 1, b.reachScale), rig = new Rig(c);
  rig.update(1, body); const bones = rig.bones(body);
  const corners = (o) => { const ps = []; for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) { const w = j ? o.w1 : o.w0, d = j ? o.d1 : o.d0; ps.push(point(o.m, (o.x ?? 0) + (i ? 0.5 : -0.5) * w, j ? o.y1 : o.y0, o.zc + (k ? 0.5 : -0.5) * d)); } return ps; };
  // (what hangs loose (a skirt's panels, a ponytail's links) hangs by gravity, and a held pose has nothing real under it: not
  // counted for the lowest block)
  const low = Math.min(...bones.filter((o) => !o.loose).flatMap((o) => corners(o).map((p) => p[1])));
  const feet = Math.min(...bones.filter((o) => o.name.startsWith('foot')).flatMap((o) => corners(o).map((p) => p[1])));
  const pel = bones.find((o) => o.name === 'pelvis').m, head = bones.find((o) => o.name === 'head').m;
  const hands = {};
  for (const [key, s2] of [['hl', 'L'], ['hr', 'R']]) { const t = body.reach[key]; if (!t) continue; const f = bones.find((o) => o.name === 'foreArm' + s2), h = point(f.m, 0, f.y1, 0); hands[s2] = Math.hypot(h[0] - t[0], h[1] - t[1], h[2] - t[2]); }
  return { feet, low, headBelow: head[13] < pel[13], hands };
};
// (the runner's own poses were tuned by eye: they're the reference. A character misses where it's clearly worse than the
// runner in the same pose; the runner's own absolute faults are the held pose's, listed apart)
if (process.env.SHOW) { for (const c of CHARACTERS) console.log(c.name, JSON.stringify(measure(c, ...process.env.SHOW.split('@').map((v, i) => (i ? +v : v))))); process.exit(0); }
const report = [], held = [];
const ref = Object.fromEntries(POSE_MOVES.flatMap((m) => MUS.map((mu) => [`${m}@${mu}`, measure(CHARACTERS[0], m, mu)])));
for (const [k, r] of Object.entries(ref)) {
  const [move] = k.split('@'), f = [];
  if (STANDS.has(move) && r.feet < -0.06) f.push(`feet ${(-r.feet * 100).toFixed(0)} cm into the ground`);
  if (r.low < -0.12 && move !== 'roll') f.push(`a block ${(-r.low * 100).toFixed(0)} cm below the ground`);
  for (const [s2, d] of Object.entries(r.hands)) if (d > 0.12) f.push(`the ${s2 === 'L' ? 'left' : 'right'} hand ${(d * 100).toFixed(0)} cm short`);
  if (f.length) held.push({ pose: k, faults: f });
}
for (const c of CHARACTERS.slice(1)) for (const move of POSE_MOVES) for (const mu of MUS) {
  // (the runner's heights scaled to this body's legs: a smaller body's flight is lower, and should be)
  const ls = bodyOf(c.proportions).legScale, r = measure(c, move, mu), o0 = ref[`${move}@${mu}`], o = { ...o0, feet: o0.feet * ls, low: o0.low * ls }, misses = [];
  if (STANDS.has(move) && r.feet < o.feet - 0.04) misses.push(`feet ${((o.feet - r.feet) * 100).toFixed(0)} cm further into the ground than the runner's`);
  if (STANDS.has(move) && r.feet > o.feet + (move === 'stand' ? 0.04 : 0.1)) misses.push(`feet ${((r.feet - o.feet) * 100).toFixed(0)} cm further off the ground than the runner's`);
  if (r.low < Math.min(o.low, 0) - 0.06 && move !== 'roll') misses.push(`a block ${((Math.min(o.low, 0) - r.low) * 100).toFixed(0)} cm further below the ground`);
  if (r.headBelow && !o.headBelow && !['flip', 'sideflip', 'roll', 'dive'].includes(move)) misses.push('the head below the hips (the runner\'s isn\'t)');
  // (only where the runner's hand is on its hold: elsewhere in the move the hold isn't meant to be held)
  for (const [s2, d] of Object.entries(r.hands)) if ((o.hands[s2] ?? 0) < 0.15 && d > (o.hands[s2] ?? 0) + 0.08) misses.push(`the ${s2 === 'L' ? 'left' : 'right'} hand ${((d - (o.hands[s2] ?? 0)) * 100).toFixed(0)} cm further from its hold than the runner's`);
  report.push({ character: c.name, move, mu, misses });
}
mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + 'report.json', JSON.stringify({ report, held }, null, 1));
const bad = report.filter((r) => r.misses.length);
console.log(`${report.length} poses (${CHARACTERS.length - 1} characters against the runner × ${POSE_MOVES.length} moves × ${MUS.length}); ${bad.length} with a miss`);
console.log(`the held poses' own faults (the runner's, so every character's): ${held.length}`); for (const h of held) console.log(`  ${h.pose}: ${h.faults.join('; ')}`);
const byKey = {}; for (const r of bad) for (const m of r.misses) { const k = `${r.character} ${r.move}: ${m.replace(/\d+ cm/, 'n cm')}`; (byKey[k] ??= []).push(r.mu); }
for (const [k, mus] of Object.entries(byKey)) console.log(`  ${k} (at ${mus.join(', ')})`);

if (film) {
  process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
  const { withWood } = await import('./harness.mjs');
  const rowH = 150, W = 5 * 150;
  await withWood(async (lab) => {
    for (const c of CHARACTERS) {
      const p = await lab.open(`sheet=${POSE_MOVES.join(',')}&side=70&zoom=1.5&look=clay&character=${c.name}`, { width: W, height: rowH * POSE_MOVES.length, dpr: 1 });
      await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}sheet-${c.name}.png` }); await p.close();
      console.log(`filmed ${c.name}`);
    }
  });
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const missOf = (cn, mv) => report.filter((r) => r.character === cn && r.move === mv && r.misses.length);
  const rows = POSE_MOVES.map((mv) => `<tr><th scope="row">${mv}</th>${CHARACTERS.map((c) => { const m = missOf(c.name, mv); return `<td class="${m.length ? 'miss' : ''}"><div class="cell" role="img" aria-label="${esc(c.title)}, ${mv}, at five points through it" style="background-image:url(sheet-${c.name}.png);background-position:0 -${POSE_MOVES.indexOf(mv) * 60}px"></div>${m.length ? `<p>${esc([...new Set(m.flatMap((r) => r.misses.map((x) => x.replace(/\d+ cm/, '…'))))].join('; '))} (${m.map((r) => r.mu).join(', ')})</p>` : ''}</td>`; }).join('')}</tr>`).join('\n');
  const html = `<title>Roof Jumps Poses</title>
<style>
:root { --bg: #eef0f1; --panel: #f8f9f9; --ink: #1d2124; --muted: #5d666c; --rule: #d3d8db; --fail: #c4521f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #16191b; --panel: #1e2225; --ink: #e4e8ea; --muted: #9aa4aa; --rule: #30363a; --fail: #ef7a45; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #16191b; --panel: #1e2225; --ink: #e4e8ea; --muted: #9aa4aa; --rule: #30363a; --fail: #ef7a45; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; padding: 24px max(16px, env(safe-area-inset-left)); }
h1 { font-size: 1.5rem; margin: 0 0 4px; } .lede { color: var(--muted); max-width: 75ch; margin: 0 0 16px; }
.wrap { overflow-x: auto; border: 1px solid var(--rule); border-radius: 6px; background: var(--panel); }
table { border-collapse: collapse; } th, td { border-bottom: 1px solid var(--rule); padding: 6px; vertical-align: top; text-align: left; }
thead th { position: sticky; top: 0; background: var(--panel); font-weight: 600; } tbody th { font-family: ui-monospace, monospace; font-weight: 500; white-space: nowrap; }
td .cell { width: 300px; height: 60px; background-size: 300px auto; background-repeat: no-repeat; border-radius: 3px; } td.miss { outline: 2px solid var(--fail); outline-offset: -2px; } td p { margin: 4px 0 0; color: var(--fail); font-size: 0.8rem; max-width: 300px; }
</style>
<h1>Roof Jumps poses, every character</h1>
<p class="lede">Each move held at five points through it, for each character, in clay, from the side: a first pass for large misses. The runner's poses were tuned by eye and are the reference: an outlined cell is a character clearly worse than the runner in that pose (feet further into or off the ground where it stands, a block further below it, the head below the hips where the runner's isn't, a hand further from its hold). ${report.length} poses checked; ${bad.length} with a miss. The held poses' own faults, the same for everyone: ${held.length ? esc(held.map((h) => h.pose).join(', ')) : 'none'}. Re-run with <code>node cells/lab/devtools/roofjumps-poses.mjs --film</code>.</p>
<div class="wrap"><table><thead><tr><th scope="col">move</th>${CHARACTERS.map((c) => `<th scope="col">${esc(c.title)}<br><small>${c.proportions.stature} m</small></th>`).join('')}</tr></thead><tbody>
${rows}
</tbody></table></div>`;
  writeFileSync(OUT + 'report.html', html);
  console.log(`→ ${OUT}report.html`);
}
