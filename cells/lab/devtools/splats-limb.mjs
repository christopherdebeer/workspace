// One limb, three ways, read along the stroke (node cells/lab/devtools/splats-limb.mjs [--iters=0] [--rows=40]).
//
// The limb in parts (splats-root2.mjs) was fitted to profiles across a limb, pooled over strokes; that throws away
// what a stroke does along itself, and the room's limbs came out as shaded tubes. Here the teacher's strokes (the
// pool, cut from the restyles of the room's geometry) are read as whole patches, along as well as across. At each step
// along a strip the dark band is found; what's kept is how it runs:
// - **cover**: how much of the limb's length has a band at all;
// - **gap**: how long its breaks are (px of the restyle, mean);
// - **thick**, **body**: its thickness (in the limb's half-widths) and darkness, their medians; **swell**, **press**:
//   how much each varies along the stroke (the middle half's spread over the median);
// - **together**: whether thickness and darkness rise and fall together along it (their correlation);
// - **rim**: how ragged its two edges are (px, about their own drift over ~60 px);
// - **run**: over what length its thickness changes (in the limb's half-widths): a stroke that swells and thins, or lumps;
// - **streak**: how uneven the band is across itself (bristle lines with paper between, against an even band);
// - **other**: how much of its length has another line across the limb, apart from the band (its other edge drawn);
// - **release**: its thickness over the last eighth of a limb, against its median (strips that reach a limb's end).
// Three ways of laying a limb, each with about the same number of deposits, are drawn from the same views and read
// the same way:
// - **in parts**: the room's limb now (conservatory.ts `limbParts`);
// - **a sweep**: one pass of a loaded brush (`limbSweep`): its pressure along it drives its width, its coverage and
//   its load together; which side it's loaded on is each stroke's own;
// - **a sweep with accents**: the same, with stretches of a line along one edge or the other.
// The sweep's style can be fitted so its strokes read as the teacher's do (over the strokes from the three views
// taught from), by drawing again with each number moved a little; it starts from a style chosen by eye in the real
// renderer and is kept near it, because the readings alone can be met by drawings that look nothing like a stroke. All three are then read on those strokes and on the
// strokes from the other five views (used before to choose things: validation, not a test).
// Writes devtools/out/pool/limb.json and static/splats/limb-sweep.json.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { VN, VR, pool, read, pooled, apart, WHAT, fmt, med } from './splats-limb-lib.mjs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const ITERS = Number(arg('iters', 0)), ROWS = Number(arg('rows', 40)), TAG = arg('tag', '');
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts'), { layout, axes } = M;
const dir = new URL('./out/pool/', import.meta.url).pathname;
const FOV = (55 * Math.PI) / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const plain = C.conservatory({}), PARTS = JSON.parse(readFileSync(new URL('../static/splats/root-parts.json', import.meta.url))).parts;
const cams = Object.fromEntries(Object.entries(plain.views).map(([name, v]) => { const p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm([v.at[0] - E[0], v.at[1] - E[1], v.at[2] - E[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f); return [name.replace(/ /g, '-'), { E, f, r, u }]; }));
const { meta, strip } = pool(dir);
function footprint(d, cam, fy, W, H, ax = axes(d)) {
  const q0 = [d.p[0] - cam.E[0], d.p[1] - cam.E[1], d.p[2] - cam.E[2]], q = [dot(q0, cam.r), dot(q0, cam.u), dot(q0, cam.f)], z = q[2]; if (z < 0.05) return null;
  const sx = W / 2 + (fy * q[0]) / z, sy = H / 2 - (fy * q[1]) / z, img = (a, s) => { const ar = dot(a, cam.r), au = dot(a, cam.u), af = dot(a, cam.f); return [s * (fy / z) * (ar - (q[0] * af) / z), s * (-fy / z) * (au - (q[1] * af) / z)]; };
  const e1 = img(ax[0], d.s1), e2 = img(ax[1], d.s2), e3 = img(ax[2], d.thin), A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], Cc = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3, det = A * Cc - B * B;
  const nx = dot(d.n, cam.r), ny = dot(d.n, cam.u), nz = dot(d.n, cam.f);
  return [sx, sy, Cc / det, -B / det, A / det, 3 * Math.sqrt(Math.max(A, Cc)), Math.sqrt(Math.max(0, ((A - 0.3) * (Cc - 0.3) - B * B) / det)), z, nx, ny, nz, nx * q[0] + ny * q[1] + nz * q[2]];
}
/** a limb's marks drawn from a stroke's view at its scale (the limb's tube hiding its far side), straightened along
 * the stroke's stations; and how many deposits were drawn */
function drawn(marks, st) {
  const cam = cams[st.view], S = st.S, W = 1536 * S, H = 1024 * S, fy = H / (2 * Math.tan(FOV / 2));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let k = 0; k < st.n; k++) { const r = st.hw[k] * 3; x0 = Math.min(x0, st.x[k] - r); x1 = Math.max(x1, st.x[k] + r); y0 = Math.min(y0, st.y[k] - r); y1 = Math.max(y1, st.y[k] + r); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1)); const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const logT = new Float32Array(cw * ch), zb = new Float32Array(cw * ch).fill(Infinity);
  { const tris = C.occluder({ marks, solids: [] }), toCam = (i) => { const d = [tris[i] - cam.E[0], tris[i + 1] - cam.E[1], tris[i + 2] - cam.E[2]]; return [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)]; };
    for (let t = 0; t < tris.length; t += 9) {
      const q = [toCam(t), toCam(t + 3), toCam(t + 6)]; if (q[0][2] < 0.05 || q[1][2] < 0.05 || q[2][2] < 0.05) continue;
      const s = q.map((c) => [W / 2 + (fy * c[0]) / c[2] - x0, H / 2 - (fy * c[1]) / c[2] - y0]), a0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), a1 = Math.min(cw - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), b0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), b1 = Math.min(ch - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
      for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) { const px = x + 0.5, py = y + 0.5, a = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, c = 1 - a - b; if (a < 0 || b < 0 || c < 0) continue; const z = 1 / (a / q[0][2] + b / q[1][2] + c / q[2][2]); if (z < zb[y * cw + x]) zb[y * cw + x] = z; }
    } }
  let count = 0;
  for (const mark of marks) for (const d of layout(mark)) {
    let a = M.inkOf(d, cam.E); if (a < 0.004) continue;
    const e = footprint(d, cam, fy, W, H); if (!e) continue; const [sx, sy, ia, ib, ic, R, comp, z] = e; if (sx + R < x0 || sx - R > x1 || sy + R < y0 || sy - R > y1) continue;
    if (mark.lod) a *= Math.max(0, Math.min(1, (Math.log2(fy / (z * H)) - mark.lod[0]) / (mark.lod[1] - mark.lod[0])));
    const al = a * comp; if (al < 1 / 255) continue; count++;
    for (let y = Math.max(y0, Math.floor(sy - R)); y <= Math.min(y1, Math.ceil(sy + R)); y++) {
      // (this row's stretch of the footprint: where its Gaussian is over 0.011, a long thin one covering little of its box)
      const dy = y + 0.5 - sy, disc = ib * dy * (ib * dy) - ia * (ic * dy * dy - 9.02); if (disc < 0) continue;
      const sq = Math.sqrt(disc), xa = sx + (-ib * dy - sq) / ia, xb = sx + (-ib * dy + sq) / ia;
      for (let x = Math.max(x0, Math.floor(xa - 0.5)); x <= Math.min(x1, Math.ceil(xb - 0.5)); x++) {
      const dx = x + 0.5 - sx, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.011 || al * G < 1 / 255) continue;
      const p = (y - y0) * cw + (x - x0);
      if (zb[p] !== Infinity) { const dn = e[8] * ((x + 0.5 - W / 2) / fy) - e[9] * ((y + 0.5 - H / 2) / fy) + e[10]; if ((Math.abs(dn) > 0.05 ? Math.max(z - 0.5, Math.min(z + 0.5, e[11] / dn)) : z) > zb[p]) continue; }
      logT[p] += Math.log(1 - Math.min(0.99, al * G));
      }
    }
  }
  const out = new Float32Array(st.n * VN), at = (i, j) => (i >= 0 && i < cw && j >= 0 && j < ch ? 1 - Math.exp(logT[j * cw + i]) : 0);
  for (let k = 0; k < st.n; k++) for (let v = 0; v < VN; v++) { const t = (v / (VN - 1)) * 2 * VR - VR, X = st.x[k] + st.nx[k] * t * st.hw[k] - 0.5 - x0, Y = st.y[k] + st.ny[k] * t * st.hw[k] - 0.5 - y0, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy2 = Y - j; out[k * VN + v] = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy2) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy2; }
  out.count = count; return out;
}


// ─── the three ways ───
const limbOf = (key) => plain.marks.find((m) => m.key === key), fresh = (m) => ({ ...m, params: m.params.slice(), resid: m.resid.slice(), view: m.view.slice() });
const FIX = { upper: 0.7, rows: ROWS };
const laidIn = {}, budget = (key) => (laidIn[key] ??= C.limbParts(fresh(limbOf(key)), PARTS).reduce((a, m) => a + m.count, 0));
const ACCENT = { ink: 3.6, arc: -1.2, share: 0.3, there: 0.75 };
const ways = { 'in parts': (key) => C.limbParts(fresh(limbOf(key)), PARTS), 'a sweep': (key, s) => C.limbSweep(fresh(limbOf(key)), { ...FIX, ...s }, budget(key)), 'a sweep with accents': (key, s) => C.limbSweep(fresh(limbOf(key)), { ...FIX, ...s, accent: ACCENT }, budget(key)) };
// (started from a style chosen by eye in the real renderer, and kept near it: the readings alone can be met by
// drawings that look nothing like a stroke)
// (what's shipped: the fit's pressures with the eye's crispness. `--iters=0` reads it as it is; more fits on from it.
// The eye's first choice was ink 0.5, tmin 0.6, tmax 1.5, dry 0.9, decay 0.15, vary 0.7, taper 0.03, jitter 0.04,
// fall 3, along 0.5, spread -0.4, runs 2.5, ragged 0.3, wet 1.2; thirty rounds from there gave ink 1.16, tmin 0.34,
// tmax 1.2, dry 1.34, decay 0.37, vary 0.82, taper 0.11, jitter 0.07, fall 3.86, along 0.61, spread -0.15, runs 3.93,
// ragged 0.6, wet 1.6: nearer by the readings, and airbrushed to look at)
const p = { ink: 0.7, tmin: 0.34, tmax: 1.25, dry: 1.2, decay: 0.35, vary: 0.8, taper: 0.1, jitter: 0.05, fall: 3.8, along: 0.5, spread: -0.5, runs: 3.5, ragged: 0.6, wet: 1 };
const RANGE = { ink: [-0.5, 1.5], tmin: [0.3, 0.9], tmax: [1, 2], dry: [0.5, 1.6], decay: [0, 0.6], vary: [0.4, 0.85], taper: [0.005, 0.2], jitter: [0, 0.1], fall: [1.5, 4], along: [0, 1], spread: [-0.8, 0], runs: [1.5, 4], ragged: [0, 0.6], wet: [0.4, 1.6] }, EPS = { ink: 0.2, tmin: 0.06, tmax: 0.1, dry: 0.1, decay: 0.06, vary: 0.05, taper: 0.02, jitter: 0.015, fall: 0.2, along: 0.1, spread: 0.08, runs: 0.3, ragged: 0.08, wet: 0.12 };
// (`--from=<report>`: start from a style fitted before)
{ const from = arg('from', ''); if (from) Object.assign(p, JSON.parse(readFileSync(`${dir}${from}`)).style); }
const HALF = meta.map((m) => strip(m, 0.5)), train = HALF.filter((s) => s.teach), WANT = pooled(train.map((st) => read(st, st.T)));
console.log(`${meta.length} strokes of ${new Set(meta.map((m) => m.key)).size} limbs; ${train.length} from the views taught from, ${HALF.length - train.length} from the others`);
const OWN = WHAT.filter((k) => k !== 'other'), total = () => apart(pooled(train.map((st) => read(st, drawn(ways['a sweep'](st.key, p), st)))), WANT, OWN);
{ const adam = {}, t0 = Date.now(); let best = { f: Infinity, p: null };
  for (let it = 0; it < ITERS; it++) {
    const f0 = total(); if (f0 < best.f) best = { f: f0, p: { ...p } };
    for (const k of Object.keys(p)) { const was = p[k]; p[k] = was + EPS[k]; const g = (total() - f0) / EPS[k]; p[k] = was; const A = (adam[k] ??= { m: 0, v: 0, t: 0 }); A.t++; A.m = 0.8 * A.m + 0.2 * g; A.v = 0.99 * A.v + 0.01 * g * g; p[k] = Math.max(RANGE[k][0], Math.min(RANGE[k][1], was - (EPS[k] * 0.8 * (1 - 0.5 * (it / ITERS)) * (A.m / (1 - 0.8 ** A.t))) / (Math.sqrt(A.v / (1 - 0.99 ** A.t)) + 1e-9))); }
    if (it % 4 === 0 || it === ITERS - 1) console.log(`  a sweep ${it}: ${f0.toFixed(2)}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const f = total(); if (f > best.f) Object.assign(p, best.p); }
// (the accents: how much of a limb's length one runs, so that as much of the limb has a second line as the teacher's)
{ let best = Infinity; for (const share of [0.3, 0.45, 0.6, 0.75, 0.88]) { ACCENT.share = share; const o = pooled(train.map((st) => read(st, drawn(ways['a sweep with accents'](st.key, p), st)))).other, e = Math.abs(o - WANT.other); console.log(`  accents ${share} of the length: a second line over ${o.toFixed(2)} of it (the teacher's ${WANT.other.toFixed(2)})`); if (e < best) { best = e; ACCENT.best = share; } } ACCENT.share = ACCENT.best; delete ACCENT.best; }
// ─── read at the restyles' own size ───
const FULL = meta.map((m) => strip(m, 1)), report = { style: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(3)])), accent: { ...ACCENT }, ways: {} };
const theirs = { taught: pooled(FULL.filter((s) => s.teach).map((s) => read(s, s.T))), others: pooled(FULL.filter((s) => !s.teach).map((s) => read(s, s.T))) };
report.teacher = theirs; console.log(`${'the teacher'.padEnd(24)} taught from: ${fmt(theirs.taught)}\n${''.padEnd(24)} the others:  ${fmt(theirs.others)}`);
for (const name of Object.keys(ways)) {
  const rows = FULL.map((st) => { const A = drawn(ways[name](st.key, p), st); return { st, r: read(st, A), n: A.count }; });
  const o = { taught: pooled(rows.filter((x) => x.st.teach).map((x) => x.r)), others: pooled(rows.filter((x) => !x.st.teach).map((x) => x.r)) }, laid = Math.round(med([...new Set(meta.map((m) => m.key))].map((k) => ways[name](k, p).reduce((a, m) => a + m.count, 0))));
  report.ways[name] = { laid, ...o, apart: { taught: +apart(o.taught, theirs.taught).toFixed(1), others: +apart(o.others, theirs.others).toFixed(1) } };
  console.log(`${name.padEnd(24)} taught from: ${fmt(o.taught)}  (apart ${report.ways[name].apart.taught})\n${`  ${laid} deposits a limb`.padEnd(24)} the others:  ${fmt(o.others)}  (apart ${report.ways[name].apart.others})`);
}
writeFileSync(`${dir}limb${TAG}.json`, JSON.stringify(report, null, 1));
if (!TAG) writeFileSync(new URL('../static/splats/limb-sweep.json', import.meta.url), JSON.stringify({ note: 'A limb as one sweep of a loaded brush: its style chosen by eye in the real renderer and checked against how the teacher\'s strokes read along themselves (devtools/splats-limb.mjs).', sweep: { ...FIX, ...report.style }, accent: ACCENT }));
