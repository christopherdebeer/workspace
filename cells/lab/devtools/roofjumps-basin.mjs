// The skill basin of a scene's move (after Astra: a move you can find again is a skill; one that only happens for one exact
// input is a lucky clip). The scene is run again with what a player can't hold exactly perturbed: where it starts (moved
// across the way it runs), when the stick does what it does (all of it a few frames late: decided on the state as it was,
// as a slower thumb would), and which way (the stick turned a few degrees); the timing and the angle from the moment the
// stick first turns off its line (the decision), not across the approach. Each run is reduced to its signature (the
// scene's own: Scene.signature; else the sequence of its moves) and compared with the unperturbed run's. The share that
// match is the basin; the maps show its shape (where its edges are, and what's found past them).
//
//   node cells/lab/devtools/roofjumps-basin.mjs <scene> [--fine]
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname, OUT = new URL('./out/basin/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './scenes';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { SCENES, runScene, sequence } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const args = process.argv.slice(2), key = args.find((a) => !a.startsWith('--')), fine = args.includes('--fine');
const s = SCENES.find((x) => x.key === key);
if (!s) { console.error(`no scene ${key}; one of: ${SCENES.map((x) => x.key).join(' ')}`); process.exit(1); }
const sig = (r) => (s.signature ? s.signature(r) : sequence(r));
/** the scene with its start moved `dx` across the way it runs (+x), its stick `late` frames late and turned `deg` */
const perturbed = (dx, late, deg) => {
  // (the timing and the angle only from the moment of decision: the first time the scripted stick turns well off the way
  // it was first held; the approach before that is its own skill, and the start moves it)
  const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), queue = [];
  let first = null, decided = false;
  return { ...s, course: { ...s.course, start: { x: s.course.start.x + dx, z: s.course.start.z } }, input: (t, r, mem) => {
    const inp = s.input(t, r, mem), m = Math.hypot(inp.x, inp.z);
    if (!first && m > 0.3) first = [inp.x / m, inp.z / m];
    if (first && m > 0.3 && (inp.x * first[0] + inp.z * first[1]) / m < 0.85) decided = true;
    if (!decided) { queue.length = 0; return inp; }
    const turned = { ...inp, x: inp.x * c + inp.z * sn, z: inp.z * c - inp.x * sn };
    queue.push(turned); return queue.length > late ? queue.shift() : queue[0] && late ? { ...queue[0], x: 0, z: 0 } : turned;
  } };
};
const show = args.find((a) => a.startsWith('--show='));
if (show) {
  const [dx, late, deg] = show.slice(7).split(',').map(Number), run = runScene(perturbed(dx, late, deg));
  let last = ''; for (const f of run.frames) { const k = f.state + ' ' + f.move; if (k !== last) console.log(f.t.toFixed(3), k.padEnd(14), 'x', f.x.toFixed(2), 'y', f.y.toFixed(2), 'z', f.z.toFixed(2), 'sp', f.speed.toFixed(1)); last = k; }
  console.log(sig(run), JSON.stringify(run.runner.made)); process.exit(0);
}
const unperturbed = sig(runScene(s)), base = s.move ?? unperturbed;
if (unperturbed !== base) console.log(`(the unperturbed run doesn't do the move: it does "${unperturbed}")`);
const DX = fine ? [-0.6, -0.45, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.45, 0.6] : [-0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6];
const LATE = fine ? [0, 1, 2, 3, 4, 5, 6, 8, 10, 12] : [0, 2, 4, 6, 9, 12];
const DEG = fine ? [-20, -15, -10, -6, -3, 0, 3, 6, 10, 15, 20] : [-20, -12, -6, 0, 6, 12, 20];
const grid = (rows, cols, f) => rows.map((r) => cols.map((c) => { const run = runScene(f(r, c)), g = sig(run); return { g, ok: g === base }; }));
const t0 = Date.now();
const lateMap = grid(LATE, DX, (l, dx) => perturbed(dx, l, 0)), turnMap = grid(DEG, DX, (d, dx) => perturbed(dx, 0, d));
const all = [...lateMap.flat(), ...turnMap.flat()], share = all.filter((c) => c.ok).length / all.length;
const found = {}; for (const c of all) found[c.g] = (found[c.g] ?? 0) + 1;
// (the width along each axis through the unperturbed input: how far it can be off and still come out the same)
const width = (vals, ok) => { const i0 = vals.indexOf(0); let lo = i0, hi = i0; while (lo > 0 && ok(lo - 1)) lo--; while (hi < vals.length - 1 && ok(hi + 1)) hi++; return ok(i0) ? [vals[lo], vals[hi]] : null; };
const i0x = DX.indexOf(0);
const widths = { start: width(DX, (i) => lateMap[0][i].ok), late: width(LATE, (i) => lateMap[i][i0x].ok), turn: width(DEG, (i) => turnMap[i][i0x].ok) };
const report = { scene: s.key, title: s.title, signature: base, unperturbed, share, widths, found, axes: { start: DX, late: LATE, turn: DEG }, lateMap: lateMap.map((r) => r.map((c) => c.g)), turnMap: turnMap.map((r) => r.map((c) => c.g)) };
mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + s.key + '.json', JSON.stringify(report, null, 1));
const cell = (c) => (c.ok ? '■' : '·');
console.log(`${s.key}: "${base}"\nbasin ${Math.round(share * 100)}% of ${all.length} runs (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
console.log(`  along the start (m): ${widths.start ? `${widths.start[0]} to ${widths.start[1]}` : 'none'}; late (frames): ${widths.late ? `up to ${widths.late[1]}` : 'none'}; turned (°): ${widths.turn ? `${widths.turn[0]} to ${widths.turn[1]}` : 'none'}`);
console.log(`  late ↓ × start →  (${DX.join(' ')})`); lateMap.forEach((r, i) => console.log(`  ${String(LATE[i]).padStart(3)}  ${r.map(cell).join(' ')}`));
console.log(`  turned ↓ × start →`); turnMap.forEach((r, i) => console.log(`  ${String(DEG[i]).padStart(3)}  ${r.map(cell).join(' ')}`));
console.log('  found:'); for (const [g, n] of Object.entries(found).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}  ${g}`);
