// The root again, from the second teachers (node cells/lab/devtools/splats-root2.mjs [--iters=24]).
//
// The second restyles were made from the solid room's geometry as wireframes, so where a limb's ink goes is the
// teacher's choice (in the first it was the underdrawing's). The pool cut from them (splats-pool.mjs, .py) reads
// differently: the teacher's ink lies between a limb's two edges, and what it does there goes by how wide the limb
// is on the screen: narrow, one loaded stroke filling it; wide, a line along each edge and a pale dry body between.
// Since the teacher's ink now sits on the geometry, a limb's profile across (in the limb's own frame, the median
// along each stroke, turned so up is up) can be pooled over strokes: the mean profile of the narrow strokes (half-width
// under 15 px of the restyle), of the middling, and of the wide (over 25 px).
//
// Two ways of laying a limb are drawn from each stroke's view and pooled the same way:
// - **one band as seen**: the limb as the room drew it (conservatory.ts `asSeen`, the style fitted to the first pool);
// - **in parts, by its width on the screen** (`limbParts`): far off one loaded stroke; close to, a graded dry stroke and
//   a line along each edge; the first handing over to the others between the two widths.
// The parts' style is fitted to the pooled profiles of the strokes from the three views taught from, by drawing again
// with each number moved a little; both ways are then scored on those and on the strokes from the five reserved views.
// Writes devtools/out/pool/root2.json, root2-profiles.json (the curves), and static/splats/root-parts.json.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const ITERS = Number(arg('iters', 24));
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts'), { layout, axes } = M;
const dir = new URL('./out/pool/', import.meta.url).pathname;
const FOV = (55 * Math.PI) / 180, VN = 61, VR = 2.5, TEACH = ['tunnel', 'pool', 'canopy'], LO = 10, HI = VN - 11;   // (|v| <= 1.67)
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const plain = C.conservatory({}), V1 = JSON.parse(readFileSync(new URL('../static/splats/root-style.json', import.meta.url))).style;
const cams = Object.fromEntries(Object.entries(plain.views).map(([name, v]) => { const p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm([v.at[0] - E[0], v.at[1] - E[1], v.at[2] - E[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f); return [name.replace(/ /g, '-'), { E, f, r, u }]; }));
const bin = new Float32Array(readFileSync(`${dir}pool.bin`).buffer.slice(0)), meta = JSON.parse(readFileSync(`${dir}pool.json`));
function strip(m, S) {
  const n0 = m.length, o = m.at, st = Math.round(1 / S), n = Math.floor(n0 / st), g = (row, k) => bin[o + row * n0 + k], x = new Float32Array(n), y = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), hw = new Float32Array(n), T = new Float32Array(n * VN);
  for (let k = 0; k < n; k++) { const a = k * st + Math.floor(st / 2); x[k] = g(0, a) * S; y[k] = g(1, a) * S; nx[k] = g(2, a); ny[k] = g(3, a); hw[k] = g(4, a) * S; for (let v = 0; v < VN; v++) { let s = 0; for (let j = 0; j < st; j++) s += bin[o + 5 * n0 + (k * st + j) * VN + v]; T[k * VN + v] = s / st; } }
  return { ...m, n, x, y, nx, ny, hw, T, flip: g(0, n0 - 1) > g(0, 0), teach: TEACH.includes(m.view), S, cls: m.hw < 15 ? 'narrow' : m.hw > 25 ? 'wide' : 'middling' };
}
function footprint(d, cam, fy, W, H, ax = axes(d)) {
  const q0 = [d.p[0] - cam.E[0], d.p[1] - cam.E[1], d.p[2] - cam.E[2]], q = [dot(q0, cam.r), dot(q0, cam.u), dot(q0, cam.f)], z = q[2]; if (z < 0.05) return null;
  const sx = W / 2 + (fy * q[0]) / z, sy = H / 2 - (fy * q[1]) / z, img = (a, s) => { const ar = dot(a, cam.r), au = dot(a, cam.u), af = dot(a, cam.f); return [s * (fy / z) * (ar - (q[0] * af) / z), s * (-fy / z) * (au - (q[1] * af) / z)]; };
  const e1 = img(ax[0], d.s1), e2 = img(ax[1], d.s2), e3 = img(ax[2], d.thin), A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], Cc = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3, det = A * Cc - B * B;
  const nx = dot(d.n, cam.r), ny = dot(d.n, cam.u), nz = dot(d.n, cam.f);
  return [sx, sy, Cc / det, -B / det, A / det, 3 * Math.sqrt(Math.max(A, Cc)), Math.sqrt(Math.max(0, ((A - 0.3) * (Cc - 0.3) - B * B) / det)), z, nx, ny, nz, nx * q[0] + ny * q[1] + nz * q[2]];
}
/** a limb's marks drawn from a stroke's view at its scale (the limb's tube hiding its far side; each mark shown by the
 * hand-over it has), straightened along the stroke's stations */
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
  for (const mark of marks) for (const d of layout(mark)) {
    let a = M.inkOf(d, cam.E); if (a < 0.004) continue;
    const e = footprint(d, cam, fy, W, H); if (!e) continue; const [sx, sy, ia, ib, ic, R, comp, z] = e; if (sx + R < x0 || sx - R > x1 || sy + R < y0 || sy - R > y1) continue;
    if (mark.lod) a *= Math.max(0, Math.min(1, (Math.log2(fy / (z * H)) - mark.lod[0]) / (mark.lod[1] - mark.lod[0])));
    const al = a * comp; if (al < 1 / 255) continue;
    for (let y = Math.max(y0, Math.floor(sy - R)); y <= Math.min(y1, Math.ceil(sy + R)); y++) for (let x = Math.max(x0, Math.floor(sx - R)); x <= Math.min(x1, Math.ceil(sx + R)); x++) {
      const dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.011 || al * G < 1 / 255) continue;
      const p = (y - y0) * cw + (x - x0);
      if (zb[p] !== Infinity) { const dn = e[8] * ((x + 0.5 - W / 2) / fy) - e[9] * ((y + 0.5 - H / 2) / fy) + e[10]; if ((Math.abs(dn) > 0.05 ? Math.max(z - 0.5, Math.min(z + 0.5, e[11] / dn)) : z) > zb[p]) continue; }
      logT[p] += Math.log(1 - Math.min(0.99, al * G));
    }
  }
  const out = new Float32Array(st.n * VN), at = (i, j) => (i >= 0 && i < cw && j >= 0 && j < ch ? 1 - Math.exp(logT[j * cw + i]) : 0);
  for (let k = 0; k < st.n; k++) for (let v = 0; v < VN; v++) { const t = (v / (VN - 1)) * 2 * VR - VR, X = st.x[k] + st.nx[k] * t * st.hw[k] - 0.5 - x0, Y = st.y[k] + st.ny[k] * t * st.hw[k] - 0.5 - y0, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy2 = Y - j; out[k * VN + v] = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy2) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy2; }
  return out;
}
/** a strip's profile across (the median along it), turned so +v is up; then, for pooling, turned again so its loaded
 * side (the half with more ink) is +v: which side a stroke is loaded on is the teacher's choice stroke by stroke
 * (pooled as they fall, the two sides cancel into a pale even band); `up` says which side it was */
function profile(st, A) {
  const P = new Float32Array(VN), col = new Float32Array(st.n); for (let v = 0; v < VN; v++) { for (let k = 0; k < st.n; k++) col[k] = A[k * VN + v]; const b = col.slice().sort(); P[st.flip ? VN - 1 - v : v] = b[b.length >> 1]; }
  let lo = 0, hi = 0; for (let v = LO; v <= HI; v++) { if (v < VN >> 1) lo += P[v]; else if (v > VN >> 1) hi += P[v]; }
  const up = hi >= lo; if (!up) P.reverse(); P.up = up; return P;
}
const CLS = ['narrow', 'middling', 'wide'];
/** the mean profile of each class of strokes */
const pooled = (items) => Object.fromEntries(CLS.map((c) => { const ps = items.filter((x) => x.st.cls === c).map((x) => x.P), m = new Float32Array(VN); for (const p of ps) for (let v = 0; v < VN; v++) m[v] += p[v] / ps.length; return [c, ps.length ? m : null]; }));
const apart = (a, b) => { let s = 0, n = 0; for (const c of CLS) if (a[c] && b[c]) { for (let v = LO; v <= HI; v++) s += (a[c][v] - b[c][v]) ** 2; n += HI - LO + 1; } return (s / Math.max(1, n)) * 1000; };

// ─── the two ways ───
const limbOf = (key) => plain.marks.find((m) => m.key === key), fresh = (m) => ({ ...m, params: m.params.slice(), resid: m.resid.slice(), view: m.view.slice() });
const ways = {
  'one band as seen': (key) => [C.asSeen(fresh(limbOf(key)), V1)],
  parts: (key, R) => C.limbParts(fresh(limbOf(key)), R),
};
const FIXED = { along: -0.3, spread: -0.3, bristle: 0.4, vink: 0.3, vwide: 0.1, voff: 0.1 };
const make = (p) => ({ far: { ink: p.farInk, dry: 0.2, arc: p.farArc, fall: p.farFall, ...FIXED }, near: { ink: p.nearInk, dry: p.nearDry, arc: p.nearArc, fall: p.nearFall, ...FIXED }, sweep: { ink: p.sweepInk, dry: p.sweepDry, arc: p.sweepArc, fall: p.sweepFall, ...FIXED }, edges: { ink: p.edgeInk, dry: 0.3, arc: p.edgeArc, fall: p.edgeFall, spread: -0.3, along: -0.3 }, hand: [-6.1, -5.36], up: true });
const P0 = { farInk: 1.8, farArc: 0.5, farFall: 0.6, nearInk: 1.5, nearArc: -0.5, nearFall: 1, nearDry: 0.4, sweepInk: -0.4, sweepArc: 0.55, sweepFall: 0.4, sweepDry: 1.0, edgeInk: 1, edgeArc: 0, edgeFall: 1 };
const RANGE = { farInk: [-2, 4], farArc: [-1.4, 0.8], farFall: [-1, 3], nearInk: [-3, 3], nearArc: [-1.4, 0.8], nearFall: [-1.5, 3], nearDry: [0, 2.5], sweepInk: [-3, 3], sweepArc: [-1.4, 0.8], sweepFall: [-1.5, 3], sweepDry: [0, 2.5], edgeInk: [-3, 4], edgeArc: [-1.4, 0.8], edgeFall: [-0.5, 3] };
const EPS = { farInk: 0.2, farArc: 0.1, farFall: 0.2, nearInk: 0.2, nearArc: 0.1, nearFall: 0.2, nearDry: 0.15, sweepInk: 0.2, sweepArc: 0.1, sweepFall: 0.2, sweepDry: 0.15, edgeInk: 0.2, edgeArc: 0.12, edgeFall: 0.2 };

const HALF = meta.map((m) => strip(m, 0.5)), train = HALF.filter((s) => s.teach), WANT = pooled(train.map((st) => ({ st, P: profile(st, st.T) })));
{ const ups = HALF.map((st) => profile(st, st.T).up); console.log(`the teacher loads the upper side of ${ups.filter(Boolean).length} of ${ups.length} strokes (${CLS.map((c) => `${HALF.filter((s, i) => s.cls === c && ups[i]).length} of ${HALF.filter((s) => s.cls === c).length} ${c}`).join(', ')})`); }
console.log(`${meta.length} strokes of ${new Set(meta.map((m) => m.key)).size} limbs; ${train.length} from the views taught from (${CLS.map((c) => `${train.filter((s) => s.cls === c).length} ${c}`).join(', ')}), ${HALF.length - train.length} from the reserved`);
const p = { ...P0 }, total = () => apart(pooled(train.map((st) => ({ st, P: profile(st, drawn(ways.parts(st.key, make(p)), st)) }))), WANT);
{ const adam = {}, t0 = Date.now(); let best = { f: Infinity, p: null };
  for (let it = 0; it < ITERS; it++) {
    const f0 = total(); if (f0 < best.f) best = { f: f0, p: { ...p } };
    for (const k of Object.keys(p)) { const was = p[k]; p[k] = was + EPS[k]; const g = (total() - f0) / EPS[k]; p[k] = was; const A = (adam[k] ??= { m: 0, v: 0, t: 0 }); A.t++; A.m = 0.8 * A.m + 0.2 * g; A.v = 0.99 * A.v + 0.01 * g * g; p[k] = Math.max(RANGE[k][0], Math.min(RANGE[k][1], was - (EPS[k] * 0.8 * (1 - 0.5 * (it / ITERS)) * (A.m / (1 - 0.8 ** A.t))) / (Math.sqrt(A.v / (1 - 0.99 ** A.t)) + 1e-9))); }
    if (it % 4 === 0 || it === ITERS - 1) console.log(`  parts ${it}: ${f0.toFixed(2)}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const f = total(); if (f > best.f) Object.assign(p, best.p); }
const PARTS = make(p);
// ─── scored at the restyles' own size ───
const FULL = meta.map((m) => strip(m, 1)), report = { strokes: meta.length, ways: {}, style: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(3)])) }, curves = {};
const theirs = { taught: pooled(FULL.filter((s) => s.teach).map((st) => ({ st, P: profile(st, st.T) }))), reserved: pooled(FULL.filter((s) => !s.teach).map((st) => ({ st, P: profile(st, st.T) }))) };
curves.teacher = theirs;
for (const [name, fn] of Object.entries({ 'one band as seen': (k) => ways['one band as seen'](k), 'in parts, by its width on the screen': (k) => ways.parts(k, PARTS) })) {
  const rows = FULL.map((st) => { const mk = fn(st.key); return { st, P: profile(st, drawn(mk, st)), dep: M.marksToSplats(mk).n }; });
  const ours = { taught: pooled(rows.filter((x) => x.st.teach)), reserved: pooled(rows.filter((x) => !x.st.teach)) }; curves[name] = ours;
  const per = (set) => Object.fromEntries(CLS.map((c) => [c, ours[set][c] && theirs[set][c] ? +apart({ [c]: ours[set][c] }, { [c]: theirs[set][c] }).toFixed(1) : null]));
  report.ways[name] = { deposits: Math.round(rows.reduce((a, x) => a + x.dep, 0) / rows.length), taught: +apart(ours.taught, theirs.taught).toFixed(2), reserved: +apart(ours.reserved, theirs.reserved).toFixed(2), byClass: { taught: per('taught'), reserved: per('reserved') } };
  console.log(`${name.padEnd(38)} ${String(report.ways[name].deposits).padStart(5)} deposits drawn a limb | profile apart, taught from: ${report.ways[name].taught} ${JSON.stringify(per('taught'))} | reserved: ${report.ways[name].reserved} ${JSON.stringify(per('reserved'))}`);
}
writeFileSync(`${dir}root2.json`, JSON.stringify(report, null, 1));
writeFileSync(`${dir}root2-profiles.json`, JSON.stringify(Object.fromEntries(Object.entries(curves).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([s, cs]) => [s, Object.fromEntries(Object.entries(cs).map(([c, a]) => [c, a ? Array.from(a, (x) => +x.toFixed(3)) : null]))]))]))));
writeFileSync(new URL('../static/splats/root-parts.json', import.meta.url), JSON.stringify({ note: 'A limb by how large it looks: far off one loaded stroke, close to a graded dry stroke and a line along each edge; fitted to the pooled profiles of the teacher\'s strokes drawn from the room\'s geometry (devtools/splats-root2.mjs).', parts: PARTS }));
