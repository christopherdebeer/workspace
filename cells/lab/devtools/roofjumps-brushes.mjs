// Small moves from rest, measured on the free foot: what the eye follows when little else moves. On an empty level roof,
// from a settled stand, the stick brushed as a thumb brushes it (a stick radius of 56 px: 12 px is a fifth of the way out)
// in eight directions; each reversed while its first heel is lifting; the thumb circled without letting go; and eight
// brushes in changing directions. For each: the free shoe's largest jump in one 120 Hz tick (a snap is anything past what a
// foot can move: 6 cm), the snaps, how far the body went after the thumb stopped, and whether a foot was always down.
//   node cells/lab/devtools/roofjumps-brushes.mjs [CHARACTER=<name>]
import { build } from 'esbuild';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './runner'; export * from './rig'; export * from './m4'; export * from './character';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const CH = M.characterByName(process.env.CHARACTER), DT = 1 / 120, R = 56;
const flat = { heightAt: () => 10, topAt: () => null, gripAt: () => null, holdsNear: () => [], boxesNear: () => [], regionsNear: () => [], regionAt: () => null, start: () => ({ x: 0, y: 10, z: 0 }) };
/** a stick (screen px off centre, + right, + down; the runner faces up the screen) through time: [t0, t1, px, py] spans */
const stick = (spans) => (t) => { for (const [a, b, x, y] of spans) if (t >= a && t < b) { let sx = x / R, sy = y / R; const l = Math.hypot(sx, sy); if (l > 1) { sx /= l; sy /= l; } return { x: sx, z: -sy }; } return { x: 0, z: 0 }; };
const dir = (deg, px) => [Math.sin((deg * Math.PI) / 180) * px, -Math.cos((deg * Math.PI) / 180) * px];
function run(name, input, seconds = 3.5) {
  const r = new M.Runner(flat, CH), rig = new M.Rig(CH); rig.update(1, r);
  for (let i = 0; i < 120; i++) { r.step(DT, { x: 0, z: 0 }); rig.update(DT, r); }
  const T0 = 1; let worst = 0, worstAt = 0, snaps = 0, noFoot = 0, lastInput = 0, x0 = r.x, z0 = r.z, after = 0, ax = 0, az = 0; const prev = { L: null, R: null };
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT, inp = input(t); if (inp.x || inp.z) { lastInput = t; ax = r.x; az = r.z; }
    r.step(DT, inp); rig.update(DT, r); const b = rig.bones(r);
    for (const [s, key] of [['L', 'fl'], ['R', 'fr']]) {
      const m = b.find((o) => o.name === 'foot' + s).m, p = [m[12], m[13], m[14]], down = !!r.reach[key] && rig.soles[s].w > 0.9;
      if (prev[s] && !(down && prev[s].down)) { const d = Math.hypot(p[0] - prev[s].p[0], p[1] - prev[s].p[1], p[2] - prev[s].p[2]); if (d > worst) { worst = d; worstAt = t; } if (d > 0.06) snaps++; }
      prev[s] = { p, down };
    }
    if (r.state === 'ground' && !r.reach.fl && !r.reach.fr) noFoot++;
  }
  after = Math.hypot(r.x - ax, r.z - az);
  return { name, worst, worstAt, snaps, after, noFoot, jumped: r.leaps + (r.made?.spring ?? 0) };
}
const rows = [];
for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) { const [x, y] = dir(deg, 12); rows.push(run(`brush 12px ${deg}°`, stick([[0, 0.133, x, y]]))); }
for (const deg of [0, 90, 180, 270]) { const [x, y] = dir(deg, 14), [rx, ry] = dir(deg + 180, 14); rows.push(run(`brush ${deg}° reversed`, stick([[0, 0.12, x, y], [0.12, 0.3, rx, ry]]))); }
{ const spans = []; for (let k = 0; k < 24; k++) { const [x, y] = dir(k * 15, 16); spans.push([k * 0.06, (k + 1) * 0.06, x, y]); } rows.push(run('thumb circled 16px', stick(spans), 4)); }
{ const spans = []; const ds = [0, 120, 250, 60, 200, 300, 30, 160]; ds.forEach((d, k) => { const [x, y] = dir(d, 12); spans.push([k * 0.35, k * 0.35 + 0.13, x, y]); }); rows.push(run('eight brushes', stick(spans), 5)); }
rows.push(run('filmed: 12px back, 133 ms', stick([[0, 0.133, 0, 12]])));
for (const r of rows) console.log(`${r.name.padEnd(26)} worst shoe jump ${(r.worst * 100).toFixed(1).padStart(5)} cm${r.worst > 0.06 ? ` (at ${r.worstAt.toFixed(2)} s)` : '          '}  snaps ${String(r.snaps).padStart(2)}  went on after the thumb ${(r.after * 100).toFixed(0).padStart(3)} cm  no foot down ${r.noFoot} ticks`);
console.log(`total snaps ${rows.reduce((a, r) => a + r.snaps, 0)}; worst ${(Math.max(...rows.map((r) => r.worst)) * 100).toFixed(1)} cm; most carried on ${(Math.max(...rows.map((r) => r.after)) * 100).toFixed(0)} cm`);
