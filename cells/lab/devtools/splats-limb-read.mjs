// One limb, four renderers, read (node cells/lab/devtools/splats-limb-read.mjs, after splats-limb-shots.mjs with CAMS=1).
//
// The limb drawn by the real renderer from the five views the teacher drew it in (devtools/out/limb/r-<way>-<view>.bin),
// each way judged twice against the teacher's own drawings of this limb:
// - **where its ink is**: the squared error against the teacher's darkness, within the limb's width of its line on
//   the picture (×1000 a pixel; bare paper's error beside it). The two views the fitted deposits and the painted
//   surface were made from, and the three they weren't;
// - **how its stroke runs**: the readings along the stroke (splats-limb.mjs) of each way's strip against the teacher's
//   strips of this limb, and the distance between them.
// And what each costs to fill, from the scene's camera far, medium and close (960 × 640): for deposits, the pixels
// their quads cover (each one's ±3σ box, those the renderer draws at all); for the surface, the limb's pixels
// (each shaded once). A count, not a time: the time is the phone's to give.
// Writes devtools/out/limb/read.json.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pool, read, pooled, apart, WHAT, fmt, sampled } from './splats-limb-lib.mjs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts'), LB = await load('../client/splats/limb.ts');
const dir = new URL('./out/limb/', import.meta.url).pathname, J = (f) => JSON.parse(readFileSync(new URL(`../static/splats/${f}`, import.meta.url), 'utf8'));
const W = 1536, H = 1024, FOV = (55 * Math.PI) / 180, fy = H / (2 * Math.tan(FOV / 2)), KEY = 'tunnel/arch 2', FIT = ['tunnel', 'back-along-the-tunnel'], CHECK = ['canopy', 'between-canopy-and-tunnel', 'sideways-from-the-stones'];
const WAYS = [['sweep', 'the sweep, as deposits'], ['shader', 'the sweep, on a surface'], ['fitted', 'deposits, fitted'], ['baked', 'the teacher\'s ink on the surface']].filter(([w]) => existsSync(`${dir}r-${w}-tunnel.bin`));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); }, sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const room = C.conservatory({}), parts = J('root-parts.json').parts, style = J('limb-sweep.json'), fitted = existsSync(new URL('../static/splats/limb-fitted.json', import.meta.url)) ? J('limb-fitted.json') : null;
const sw = LB.limbMarks('sweep', parts, style)[0], S = M.spine(sw), w0 = sw.width, res = { where: {}, runs: {}, fill: {} };
// ─── where its ink is ───
const img = (f) => new Uint8Array(readFileSync(`${dir}${f}.bin`));
const masks = Object.fromEntries([...FIT, ...CHECK].map((name) => {
  const v = room.views[name.replace(/-/g, ' ')], p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm(sub(v.at, E)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), mask = new Uint8Array(W * H); let n = 0;
  for (const P of S.pts) { const q0 = sub(P, E), z = dot(q0, f); if (z < 0.3) continue; const x = W / 2 + (fy * dot(q0, r)) / z, y = H / 2 - (fy * dot(q0, u)) / z, rad = ((0.5 * w0 * fy) / z) * 1.15 + 1; for (let j = Math.max(0, Math.floor(y - rad)); j <= Math.min(H - 1, Math.ceil(y + rad)); j++) for (let i = Math.max(0, Math.floor(x - rad)); i <= Math.min(W - 1, Math.ceil(x + rad)); i++) if (!mask[j * W + i] && Math.hypot(i + 0.5 - x, j + 0.5 - y) <= rad) { mask[j * W + i] = 1; n++; } }
  return [name, { mask, n }];
}));
const err = (a, T, m) => { let e = 0; for (let p = 0; p < a.length; p++) if (m.mask[p]) e += ((a ? a[p] : 0) / 255 - T[p] / 255) ** 2; return (1000 * e) / m.n; };
const over = (f) => ({ fit: FIT.reduce((s, v) => s + f(v), 0) / FIT.length, check: CHECK.reduce((s, v) => s + f(v), 0) / CHECK.length });
const T = Object.fromEntries([...FIT, ...CHECK].map((v) => [v, img(`teacher-${v}`)])), zero = new Uint8Array(W * H);
res.where['bare paper'] = over((v) => err(zero, T[v], masks[v]));
for (const [w, label] of WAYS) res.where[label] = over((v) => err(img(`r-${w}-${v}`), T[v], masks[v]));
console.log(`where its ink is (squared error against the teacher's drawings of this limb, ×1000 a pixel within the limb's width):\n${''.padEnd(34)}the two views fitted to   the three not`);
for (const [k, v] of Object.entries(res.where)) console.log(`${k.padEnd(34)}${v.fit.toFixed(1).padStart(12)}${v.check.toFixed(1).padStart(22)}`);
// ─── how its stroke runs ───
const { meta, strip } = pool(new URL('./out/pool/', import.meta.url).pathname), strokes = meta.filter((m) => m.key === KEY).map((m) => strip(m, 1));
const theirs = pooled(strokes.map((st) => read(st, st.T))); res.runs.teacher = theirs;
console.log(`\nhow its stroke runs (${strokes.length} strips of this limb, from ${[...new Set(strokes.map((s) => s.view))].join(', ')}):\n${'the teacher'.padEnd(34)}${fmt(theirs)}`);
for (const [w, label] of WAYS) { const o = pooled(strokes.map((st) => read(st, sampled(img(`r-${w}-${st.view}`), W, H, st)))); res.runs[label] = { ...o, apart: +apart(o, theirs).toFixed(1) }; console.log(`${label.padEnd(34)}${fmt(o)}  (apart ${res.runs[label].apart})`); }
// ─── what each costs to fill ───
{ const w = 960, h = 640, f2 = h / (2 * Math.tan(LB.LIMB.fov / 2)), marksOf = { 'the sweep, as deposits': [sw] }; if (fitted) marksOf['deposits, fitted'] = LB.limbMarks('fitted', parts, style, undefined, 0, fitted).slice(0, 1);
  const tris = C.occluder({ marks: [sw], solids: [] });
  console.log(`\nwhat each fills, in pixels of a ${w} × ${h} frame (thousands): far, medium, close`);
  for (const [d, name] of [[13, 'far'], [5.5, 'medium'], [2.6, 'close']]) {
    const { eye: E, at } = LB.limbEye(d), f = norm(sub(at, E)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), row = {};
    for (const [label, marks] of Object.entries(marksOf)) { let px = 0, n = 0; for (const dep of marks.flatMap((m) => M.layout(m))) { if (M.inkOf(dep, E) < 0.01) continue; const q0 = sub(dep.p, E), q = [dot(q0, r), dot(q0, u), dot(q0, f)], z = q[2]; if (z < 0.05) continue; const sx = w / 2 + (f2 * q[0]) / z, sy = h / 2 - (f2 * q[1]) / z; if (Math.abs(sx - w / 2) > 0.6 * w * 1.2 || Math.abs(sy - h / 2) > 0.6 * h * 1.2) continue; const im = (a, s) => { const ar = dot(a, r), au = dot(a, u), af = dot(a, f); return [s * (f2 / z) * (ar - (q[0] * af) / z), s * (-f2 / z) * (au - (q[1] * af) / z)]; }, ax = M.axes(dep), e1 = im(ax[0], dep.s1), e2 = im(ax[1], dep.s2), e3 = im(ax[2], dep.thin), A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], Cc = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3;
        // (its quad: ±3σ each way; what of it falls on the screen, by its box)
        const area = 36 * Math.sqrt(Math.max(0, A * Cc - B * B)), bx = 3 * Math.sqrt(A), by = 3 * Math.sqrt(Cc), on = (Math.max(0, Math.min(w, sx + bx) - Math.max(0, sx - bx)) * Math.max(0, Math.min(h, sy + by) - Math.max(0, sy - by))) / Math.max(1e-6, 4 * bx * by); px += area * on; n++; }
      row[label] = { px: Math.round(px), drawn: n }; }
    // (the surface: the limb's own pixels, each shaded once)
    { const seen = new Uint8Array(w * h); let px = 0; const toCam = (i) => { const q0 = [tris[i] - E[0], tris[i + 1] - E[1], tris[i + 2] - E[2]]; return [dot(q0, r), dot(q0, u), dot(q0, f)]; };
      for (let t = 0; t < tris.length; t += 9) { const q = [toCam(t), toCam(t + 3), toCam(t + 6)]; if (q.some((c) => c[2] < 0.05)) continue; const s = q.map((c) => [w / 2 + (f2 * c[0]) / c[2], h / 2 - (f2 * c[1]) / c[2]]), a0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), a1 = Math.min(w - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), b0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), b1 = Math.min(h - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1]))), den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
        for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) { const X = x + 0.5, Y = y + 0.5, a = ((s[1][1] - s[2][1]) * (X - s[2][0]) + (s[2][0] - s[1][0]) * (Y - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (X - s[2][0]) + (s[0][0] - s[2][0]) * (Y - s[2][1])) / den; if (a >= 0 && b >= 0 && a + b <= 1 && !seen[y * w + x]) { seen[y * w + x] = 1; px++; } } }
      row['on a surface'] = { px, drawn: 0 }; }
    res.fill[name] = row; console.log(`  ${name.padEnd(8)}${Object.entries(row).map(([k, v]) => `${k}: ${(v.px / 1000).toFixed(0)}k${v.drawn ? ` (${v.drawn} deposits drawn)` : ''}`).join('   ')}`);
  } }
writeFileSync(`${dir}read.json`, JSON.stringify(res, null, 1));
