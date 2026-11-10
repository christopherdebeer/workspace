// Marks fitted to a teacher's marks (node cells/lab/devtools/splats-marks-fit.mjs [--only=<name>] [--iters=400]).
//
// The teacher's marks are cut from the sparse conservatory studies (splats-marks-targets.py): a root stroke, a spray of
// leaf dabs on its strand, a canopy wash, a veil. Each is fitted three ways with the same number of deposits, through
// the renderer's own forward model (render.ts, kind 12; checked against the browser by splats-marks-browser.mjs):
// - **independent**: every deposit free (its place, two sizes, turn and ink): a fitted field, in small;
// - **organised**: the mark's own parameters and the points its spine runs through (client/splats/marks.ts): how its
//   ink, width and dryness run along it, where it starts and stops. Its deposits can't move on their own;
// - **organised, then its deposits**: the same, then each deposit's small residuals set free within bounds.
// (The existing brush is drawn and scored in the browser: splats-marks-browser.mjs.)
//
// And the test a field can't take: **the style learnt from one mark put on another's spine**. A held-out teacher mark
// (another root, another spray, another wash) is drawn with the parameters learnt from the first; only its pose is
// fitted (the points of its spine, and one number each for its ink, its width and its two ends). Beside it: the same
// pose-only fit with no style learnt (a plain stroke), and the held-out mark fitted from scratch each way.
//
// The loss: squared error in darkness, a pixel at a time and blurred (so a spine a few pixels off still feels which
// way to go), counted double where ink lands on paper the teacher left bare.
// The gradient: exact, per pixel, in each deposit's ellipse on the screen and its ink; carried to the deposit's own
// numbers (two sizes, turn, place) through the projection's slope, taken numerically; and from there to the mark's
// parameters through layout()'s slope, taken numerically too (one layout per parameter).
//
// Writes devtools/out/marks/fit.json (the scores), devtools/out/marks/render-<name>-<way>.png (the pictures), and
// static/splats/marks-bench.json (the marks, for ?scene=marks).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const ONLY = arg('only', ''), ITERS = Number(arg('iters', 400)), STYLE = Number(arg('style', 40));
const M = await load('../client/splats/marks.ts'), { layout, axes, strokeMark, washMark, spine, SP, KN, STROKE, WASH, RESID } = M;
const dir = new URL('./out/marks/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const TARGETS = JSON.parse(readFileSync(`${dir}targets.json`));
const PAPER = [0.937, 0.906, 0.847], INK = [36, 31, 27];
/** how dark a colour reads at full cover (the most any channel is darkened from the paper) */
const kappa = (c) => Math.max(...[0, 1, 2].map((k) => (PAPER[k] - c[k] / 255) / (PAPER[k] - 0.12)));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ─── a teacher mark's sheet: its picture, its camera (looking square on at the plane z = 0) ───
const FOV = 0.5;
function sheet(t) {
  const W = t.w, H = t.h, fy = H / (2 * Math.tan(FOV / 2)), Z = fy / t.unit;
  const at = (px, py) => [(px - W / 2) / t.unit, -(py - H / 2) / t.unit, 0];
  return { t, W, H, fy, Z, at, T: Float32Array.from(t.D), roi: Float32Array.from(t.roi), cam: { E: [0, 0, Z], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, -1], fy, W, H } };
}
/** the marks a teacher mark is drawn with, on its spine or outline, unfitted */
function marksFor(S, idBase) {
  const t = S.t, pts = t.pts.map(([x, y]) => S.at(x, y));
  return t.marks.map((m, k) => {
    if (t.kind === 'wash') { const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, 0], [0, 0, 0]); return Object.assign(washMark(idBase + k, pts.map((p, i) => [c, p, pts[(i + 1) % pts.length]]), [0, 0, 1], m.count, `${t.name}/${m.role}`), { role: m.role }); }
    const s = strokeMark(idBase + k, pts, [0, 0, 1], m.width / t.unit, m.count, m.rows, `${t.name}/${m.role}`); s.role = m.role;
    const ink = { root: 1.5, strand: 0.3, dabs: 1.2, veil: -1.6 }[m.role] ?? 1; for (let i = 0; i < 6; i++) s.params[SP.ink + i] = ink;
    if (m.role === 'root') { for (let i = 0; i < KN.dry; i++) s.params[SP.dry + i] = 0.3; s.params[SP.crisp] = 2.2; }
    if (m.role === 'dabs') { s.params[SP.along] = -0.3; s.params[SP.splay] = 0.45; s.params[SP.step] = 0.9; s.colour = t.colour; }
    if (m.role === 'veil') for (let i = 0; i < KN.dry; i++) s.params[SP.dry + i] = 0.2;
    return s;
  });
}

// ─── the forward model: a deposit's ellipse on the screen (as render.ts lays a fitted mark's), and the picture ───
function footprint(d, cam) {
  const [a1, a2, a3] = axes(d), q0 = [d.p[0] - cam.E[0], d.p[1] - cam.E[1], d.p[2] - cam.E[2]], q = [dot(q0, cam.r), dot(q0, cam.u), dot(q0, cam.f)], z = q[2];
  const sx = cam.W / 2 + (cam.fy * q[0]) / z, sy = cam.H / 2 - (cam.fy * q[1]) / z;
  const img = (a, s) => { const ar = dot(a, cam.r), au = dot(a, cam.u), af = dot(a, cam.f); return [s * (cam.fy / z) * (ar - (q[0] * af) / z), s * (-cam.fy / z) * (au - (q[1] * af) / z)]; };
  const e1 = img(a1, d.s1), e2 = img(a2, d.s2), e3 = img(a3, d.thin);
  const A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], C = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3, det = A * C - B * B;
  return [sx, sy, C / det, -B / det, A / det, 3 * Math.sqrt(Math.max(A, C)), Math.sqrt(Math.max(0, ((A - 0.3) * (C - 0.3) - B * B) / det))];
}
/** deposits drawn: darkness a pixel; with `want`, the loss's slope in each deposit's own numbers (ink logit, log
 * length, log width, turn, a step along its long axis, a step across: scene units) */
function draw(S, deps, want) {
  const { W, H, cam } = S, logT = new Float32Array(W * H), fps = deps.map((d) => ({ d, e: footprint(d, cam), a: 1 / (1 + Math.exp(-d.logit)) }));
  for (const f of fps) {
    const [sx, sy, ia, ib, ic, R, comp] = f.e, x0 = Math.max(0, Math.floor(sx - R)), x1 = Math.min(W - 1, Math.ceil(sx + R)), y0 = Math.max(0, Math.floor(sy - R)), y1 = Math.min(H - 1, Math.ceil(sy + R)), al = f.a * comp * f.d.k;
    f.box = [x0, x1, y0, y1];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy));
      if (G < 0.011 || al * G < 1 / 255) continue;
      logT[y * W + x] += Math.log(1 - Math.min(0.99, al * G));
    }
  }
  const D = new Float32Array(W * H); for (let p = 0; p < W * H; p++) D[p] = 1 - Math.exp(logT[p]);
  if (!want) return { D };
  // (the error, doubled where ink lands on bare paper; and its blur added, so the slope reaches a few pixels)
  const e = new Float32Array(W * H); let loss = 0;
  for (let p = 0; p < W * H; p++) { const v = D[p] - S.T[p]; e[p] = v * (S.T[p] < 0.02 && v > 0 ? 2 : 1); loss += e[p] * v; }
  const b1 = blur(blur(e, W, H, 3), W, H, 3), b2 = blur(blur(e, W, H, 8), W, H, 8); for (let p = 0; p < W * H; p++) e[p] += 2 * b1[p] + 2 * b2[p];
  const g = new Float32Array(deps.length * 6);
  fps.forEach((f, i) => {
    const [sx, sy, ia, ib, ic, , comp] = f.e, [x0, x1, y0, y1] = f.box, a = f.a, al = a * comp * f.d.k;
    let ga = 0, gsx = 0, gsy = 0, gia = 0, gib = 0, gic = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x, dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.011 || al * G < 1 / 255) continue;
      const k = (2 * e[p] * Math.exp(logT[p])) / (1 - Math.min(0.99, al * G)), gG = k * al * G;
      ga += k * G; gsx += gG * (ia * dx + ib * dy); gsy += gG * (ib * dx + ic * dy); gia += gG * -0.5 * dx * dx; gib += gG * -dx * dy; gic += gG * -0.5 * dy * dy;
    }
    g[i * 6] = ga * comp * f.d.k * a * (1 - a);
    const gcomp = ga * a * f.d.k;
    for (let j = 0; j < 5; j++) { const eps = j < 3 ? 1e-3 : 1e-5, e1 = footprint(nudge(f.d, j, eps), cam); g[i * 6 + 1 + j] = ((e1[0] - sx) * gsx + (e1[1] - sy) * gsy + (e1[2] - ia) * gia + (e1[3] - ib) * gib + (e1[4] - ic) * gic + (e1[6] - comp) * gcomp) / eps; }
  });
  return { D, loss: loss / (W * H), g };
}
/** a deposit with one of its own numbers moved a little (0 log length, 1 log width, 2 turn, 3 a step along, 4 across) */
function nudge(d, j, eps) {
  if (j === 0) return { ...d, s1: d.s1 * Math.exp(eps) };
  if (j === 1) return { ...d, s2: d.s2 * Math.exp(eps), thin: d.thin > 0.002 ? d.thin * Math.exp(eps) : d.thin };
  if (j === 2) return { ...d, turn: d.turn + eps };
  const a = axes(d)[j - 3]; return { ...d, p: [d.p[0] + a[0] * eps, d.p[1] + a[1] * eps, d.p[2] + a[2] * eps] };
}
/** how a deposit differs from another, in its own numbers (as draw()'s slope is given) */
function differ(d, e) {
  const [x, y, n] = axes(d), x2 = axes(e)[0], dp = [e.p[0] - d.p[0], e.p[1] - d.p[1], e.p[2] - d.p[2]];
  const c = [x[1] * x2[2] - x[2] * x2[1], x[2] * x2[0] - x[0] * x2[2], x[0] * x2[1] - x[1] * x2[0]];
  return [e.logit - d.logit, Math.log(e.s1 / d.s1), Math.log(e.s2 / d.s2), Math.atan2(dot(c, n), dot(x, x2)), dot(dp, x), dot(dp, y)];
}
function blur(a, W, H, r) {
  const o = new Float32Array(W * H), t = new Float32Array(W * H), k = []; let ks = 0; for (let i = -Math.ceil(r * 2.5); i <= Math.ceil(r * 2.5); i++) { const w = Math.exp(-0.5 * (i / r) ** 2); k.push([i, w]); ks += w; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (const [i, w] of k) s += a[y * W + Math.max(0, Math.min(W - 1, x + i))] * w; t[y * W + x] = s / ks; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (const [i, w] of k) s += t[Math.max(0, Math.min(H - 1, y + i)) * W + x] * w; o[y * W + x] = s / ks; }
  return o;
}
const adam = (n) => ({ m: new Float64Array(n), v: new Float64Array(n), t: 0 });
function step(A, p, g, lr, lo, hi) { A.t++; for (let j = 0; j < p.length; j++) { A.m[j] = 0.9 * A.m[j] + 0.1 * g[j]; A.v[j] = 0.999 * A.v[j] + 0.001 * g[j] * g[j]; p[j] -= (lr * (A.m[j] / (1 - 0.9 ** A.t))) / (Math.sqrt(A.v[j] / (1 - 0.999 ** A.t)) + 1e-8); if (lo) p[j] = Math.max(lo(j), Math.min(hi(j), p[j])); } }

/** a parameter's range */
function boundsOf(m, j) {
  if (m.kind !== 'stroke') return j < 9 ? [-7, 3] : [-0.6, 0.9];
  if (j < SP.width) return [-7, 5]; if (j < SP.u0) return [-1.6, 1.2];
  if (j === SP.u0) return [-0.1, 0.6]; if (j === SP.u1) return [0.4, 1.1]; if (j === SP.sharp0 || j === SP.sharp1) return [-2.5, 2]; if (j === SP.along) return [-1.5, 1];
  if (j < SP.dry) return [-1.5, 1.5]; if (j < SP.drySide) return [0, 2.5]; if (j === SP.drySide) return [-1, 1]; if (j === SP.spread) return [-0.8, 0.8]; if (j === SP.splay) return [-1.2, 1.2]; if (j === SP.crisp) return [0, 3];
  return [-3, 3];
}

// ─── a stroke in its own frame: its picture unwrapped along its spine, and what's measured there ───
const UN = 96, VN = 21;
/** a picture sampled along a spine (points in pixels) and across it (± band): UN × VN */
function unwrap(S, D, pts) {
  const { W, H } = S, band = S.t.band, cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1], out = new Float32Array(UN * VN); let k = 0;
  for (let a = 0; a < UN; a++) {
    const s = ((a + 0.5) / UN) * L; while (k < pts.length - 2 && cum[k + 1] < s) k++;
    const f = (s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]), x = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, y = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f, tx = pts[k + 1][0] - pts[k][0], ty = pts[k + 1][1] - pts[k][1], l = Math.hypot(tx, ty) || 1;
    for (let b = 0; b < VN; b++) {
      const q = ((b + 0.5) / VN - 0.5) * 2 * band, X = x + (-ty / l) * q - 0.5, Y = y + (tx / l) * q - 0.5, x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0;
      const at = (i, j) => (i >= 0 && i < W && j >= 0 && j < H ? D[j * W + i] : 0);
      out[a * VN + b] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return out;
}
/** a mark's spine in a sheet's pixels */
const spinePx = (S, m) => spine(m).pts.map((p) => [p[0] * S.t.unit + S.W / 2, -p[1] * S.t.unit + S.H / 2]);
const teacherSpine = (S) => spinePx(S, { ctrl: S.t.pts.map(([x, y]) => S.at(x, y)) });
/**
 * What a stroke's style is measured by, in its own frame (so where exactly a streak falls doesn't matter):
 * - `shape` (12 × 7): its mean ink, coarsely, along and across;
 * - `dry` (6 along × 3 across: one edge, the body, the other edge): how much of each part is left bare, against how
 *   dark that part gets;
 * - `rough` (3 across × 2): how fast its ink changes along it, and across it (streaks run along: little change along,
 *   much across).
 */
function styleOf(U) {
  const shape = new Float32Array(84), dry = new Float32Array(18), rough = new Float32Array(6), cnt = new Float32Array(84);
  for (let a = 0; a < UN; a++) for (let b = 0; b < VN; b++) { const i = Math.floor((a * 12) / UN) * 7 + Math.floor((b * 7) / VN); shape[i] += U[a * VN + b]; cnt[i]++; }
  for (let i = 0; i < 84; i++) shape[i] /= cnt[i];
  for (let ua = 0; ua < 6; ua++) for (let vb = 0; vb < 3; vb++) {
    const cells = []; for (let a = ua * 16; a < ua * 16 + 16; a++) for (let b = vb * 7; b < vb * 7 + 7; b++) cells.push(U[a * VN + b]);
    const top = cells.slice().sort((x, y) => x - y)[Math.floor(cells.length * 0.9)];
    // (bare: under half of how dark this part gets; nothing to be bare of where it's all paper)
    dry[ua * 3 + vb] = top < 0.08 ? 0 : cells.reduce((s, x) => s + 1 / (1 + Math.exp((x - 0.5 * top) / 0.06)), 0) / cells.length;
  }
  const n = new Float32Array(3);
  for (let a = 0; a < UN - 1; a++) for (let b = 0; b < VN - 1; b++) { const vb = Math.floor(b / 7), x = U[a * VN + b]; rough[vb * 2] += Math.abs(U[(a + 1) * VN + b] - x); rough[vb * 2 + 1] += Math.abs(U[a * VN + b + 1] - x); n[vb]++; }
  for (let v = 0; v < 3; v++) { rough[v * 2] /= n[v]; rough[v * 2 + 1] /= n[v]; }
  return { shape, dry, rough };
}
const styleGap = (a, b) => { let s = 0, d = 0, r = 0; for (let i = 0; i < 84; i++) s += (a.shape[i] - b.shape[i]) ** 2 / 84; for (let i = 0; i < 18; i++) d += (a.dry[i] - b.dry[i]) ** 2 / 18; for (let i = 0; i < 6; i++) r += (a.rough[i] - b.rough[i]) ** 2 / 6; return { shape: s, dry: d, rough: r, all: s + 0.5 * d + 6 * r }; };
/**
 * A stroke's style fitted to the teacher's by what's measured in its own frame: its parameters only (not its spine),
 * each one's slope taken by drawing the stroke again with it moved a little. A mark's few numbers are few enough for
 * that, whatever is measured; a field's thousands aren't.
 */
function fitStyle(S, marks, iters) {
  const want = styleOf(unwrap(S, S.T, teacherSpine(S))), strokes = marks.filter((m) => m.kind === 'stroke'); if (!strokes.length) return;
  // (with the picture's tone kept in the balance, so the style isn't bought with the shape)
  const Tb = [1, 2.5, 5].map((r) => blur(S.T, S.W, S.H, r));
  const lead = strokes[0], score = () => { const D = draw(S, allDeps(marks)).D; let tone = 0; [1, 2.5, 5].forEach((r, k) => { const a = blur(D, S.W, S.H, r); let q = 0; for (let p = 0; p < a.length; p++) q += (a[p] - Tb[k][p]) ** 2; tone += q / a.length / 3; }); return styleGap(styleOf(unwrap(S, D, spinePx(S, lead))), want).all + 10 * tone; };
  const free = strokes.flatMap((m) => [...Array(STROKE).keys()].filter((j) => m.role === 'dabs' || (j !== SP.splay && j !== SP.step)).map((j) => [m, j])), A = adam(free.length);
  for (let it = 0; it < iters; it++) {
    const f0 = score(), g = free.map(([m, j]) => { const eps = 0.04; m.params[j] += eps; const f1 = score(); m.params[j] -= eps; return (f1 - f0) / eps; });
    const p = free.map(([m, j]) => m.params[j]);
    step(A, p, g, 0.05 * (1 - 0.6 * (it / iters)), (k) => boundsOf(free[k][0], free[k][1])[0], (k) => boundsOf(free[k][0], free[k][1])[1]);
    free.forEach(([m, j], k) => (m.params[j] = p[k]));
    if (process.env.TRACE && it % 10 === 0) console.log(`    style ${it}: ${(f0 * 1000).toFixed(3)}`);
  }
}

// ─── the three ways ───
const withK = (m) => layout(m).map((d) => ({ ...d, k: kappa(m.colour ?? INK) }));
const allDeps = (marks) => marks.flatMap(withK);
/**
 * Organised: fit the marks' parameters and their spines' points (`what`: 'all', or 'pose': the points, and one number
 * each for ink, width and the two ends), then (`resid` iterations) each deposit's residuals, bounded.
 */
function fitOrganised(S, marks, iters, what = 'all', resid = 0) {
  const state = marks.map((m) => {
    const np = m.kind === 'stroke' ? STROKE : WASH, nc = m.kind === 'stroke' ? m.ctrl.length * 2 : 0;
    // (pose only: four numbers stand for the whole: ink, width, start, stop)
    // (only a spray's dabs are splayed off their spine)
    const free = what === 'all' ? [...Array(np).keys()].filter((j) => m.kind !== 'stroke' || m.role === 'dabs' || (j !== SP.splay && j !== SP.step)).map((j) => [j]) : m.kind === 'stroke' ? [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11], [SP.u0], [SP.u1]] : [[0, 1, 2, 3, 4, 5, 6, 7, 8], [9]];
    return { m, free, nc, A: adam(free.length), C: adam(nc), R: adam(m.count * RESID) };
  });
  // (a wash's outline isn't moved here; strokes sharing a spine (a strand and its dabs) move together)
  const bounds = boundsOf;
  let last = 0;
  for (let it = 0; it < iters + resid; it++) {
    const base = marks.map(withK), deps = base.flat(), { loss, g } = draw(S, deps, true); last = loss;
    if (process.env.TRACE && it % 20 === 0) console.log(`    ${it}: loss ${(loss * 1000).toFixed(2)}  ${marks.map((m) => m.params.map((v) => v.toFixed(2)).join(' ')).join(' | ')}`);
    let off = 0; const resPhase = it >= iters, pace = resPhase ? 1 : 1 - 0.75 * (it / Math.max(1, iters));
    // (strokes on one spine share its points: their slopes in the points are added)
    const shared = new Map();
    state.forEach((st, mi) => {
      const m = st.m, n = base[mi].length, gm = g.subarray(off * 6, (off + n) * 6); off += n;
      const slope = (mut, undo, eps) => { mut(); const d2 = layout(m); undo(); let s = 0; for (let i = 0; i < n; i++) { const df = differ(base[mi][i], d2[i]); for (let k = 0; k < 6; k++) s += gm[i * 6 + k] * df[k]; } return s / eps; };
      if (!resPhase) {
        const gp = st.free.map((js) => slope(() => js.forEach((j) => (m.params[j] += 1e-3)), () => js.forEach((j) => (m.params[j] -= 1e-3)), 1e-3));
        const p = st.free.map((js) => m.params[js[0]]), before = p.slice();
        step(st.A, p, gp, 0.04 * pace, (j) => bounds(m, st.free[j][0])[0], (j) => bounds(m, st.free[j][0])[1]);
        st.free.forEach((js, k) => js.forEach((j) => (m.params[j] = Math.max(bounds(m, j)[0], Math.min(bounds(m, j)[1], m.params[j] + p[k] - before[k])))));
        if (st.nc) {
          const gc = []; for (let c = 0; c < m.ctrl.length; c++) for (let a = 0; a < 2; a++) gc.push(slope(() => (m.ctrl[c][a] += 1e-4), () => (m.ctrl[c][a] -= 1e-4), 1e-4));
          const key = JSON.stringify(m.ctrl); const sh = shared.get(key) ?? shared.set(key, { g: new Float64Array(st.nc), ms: [] }).get(key); gc.forEach((v, j) => (sh.g[j] += v)); sh.ms.push(st);
        }
      } else {
        const gr = new Float64Array(n * RESID);
        for (let k = 0; k < RESID; k++) { for (let i = 0; i < n; i++) m.resid[i * RESID + k] += 1e-3; const d2 = layout(m); for (let i = 0; i < n; i++) m.resid[i * RESID + k] -= 1e-3; for (let i = 0; i < n; i++) { const df = differ(base[mi][i], d2[i]); let s = 0; for (let q = 0; q < 6; q++) s += gm[i * 6 + q] * df[q]; gr[i * RESID + k] = s / 1e-3 + 2e-4 * m.resid[i * RESID + k]; } }
        const B = [2.5, 0.5, 0.5, 0.5, 0.6, 0.45];
        step(st.R, m.resid, gr, 0.03, (j) => -B[j % RESID], (j) => B[j % RESID]);
      }
    });
    for (const sh of shared.values()) {
      const st = sh.ms[0], c = st.m.ctrl.flatMap((p) => [p[0], p[1]]); step(st.C, c, sh.g, (0.6 * pace) / S.t.unit);
      for (const o of sh.ms) o.m.ctrl.forEach((p, i) => { p[0] = c[i * 2]; p[1] = c[i * 2 + 1]; });
    }
  }
  return last;
}
/** Independent: the same deposits as the marks lay unfitted, every one set free */
function fitIndependent(S, marks, iters) {
  const deps = allDeps(marks), n = deps.length, A = adam(n * 6), half = [S.W / 2 / S.t.unit, S.H / 2 / S.t.unit];
  for (let it = 0; it < iters; it++) {
    const { g } = draw(S, deps, true), p = new Float64Array(n * 6), before = new Float64Array(n * 6);
    step(A, p, g, 1);
    deps.forEach((d, i) => {
      // (each number's own pace: ink 0.08, sizes 0.03, turn 0.03, place about a third of a pixel)
      const [x, y] = axes(d), mv = 0.35 / S.t.unit, da = p[i * 6 + 4] * mv, db = p[i * 6 + 5] * mv;
      d.logit = Math.max(-8, Math.min(6, d.logit + p[i * 6] * 0.08)); d.s1 *= Math.exp(p[i * 6 + 1] * 0.03); d.s2 *= Math.exp(p[i * 6 + 2] * 0.03);
      d.s1 = Math.max(0.6 / S.t.unit, Math.min(40 / S.t.unit, d.s1)); d.s2 = Math.max(0.6 / S.t.unit, Math.min(40 / S.t.unit, d.s2)); d.turn += p[i * 6 + 3] * 0.03;
      d.p = [Math.max(-half[0], Math.min(half[0], d.p[0] + x[0] * da + y[0] * db)), Math.max(-half[1], Math.min(half[1], d.p[1] + x[1] * da + y[1] * db)), d.p[2]];
    });
    void before;
  }
  return deps;
}

// ─── the measures: of a picture against the teacher's ───
function measure(S, D, spineOurs) {
  const { W, H, T } = S, n = W * H; let px = 0; for (let p = 0; p < n; p++) px += (D[p] - T[p]) ** 2;
  let tone = 0; for (const r of [1, 2.5, 5]) { const a = blur(D, W, H, r), b = blur(T, W, H, r); let s = 0; for (let p = 0; p < n; p++) s += (a[p] - b[p]) ** 2; tone += s / n / 3; }
  // (ink on paper the teacher left bare)
  const tb = blur(T, W, H, 1.5); let bare = 0, nb = 0; for (let p = 0; p < n; p++) if (tb[p] < 0.02) { bare += D[p]; nb++; }
  const out = { pixel: (px / n) * 1000, tone: tone * 1000, bare: nb ? (bare / nb) * 1000 : 0, ink: D.reduce((a, v) => a + v, 0) / T.reduce((a, v) => a + v, 1e-9) };
  if (S.t.kind === 'stroke') {
    // (along the teacher's spine: the ink across the stroke at each step; how far ours is from the teacher's, and how
    // much of the teacher's stroke ours leaves broken: under four tenths of its ink there)
    const P = S.t.pts, band = S.t.band, steps = 60, prof = (A) => { const o = []; for (let s = 0; s < steps; s++) { const u = ((s + 0.5) / steps) * (P.length - 1), i = Math.min(P.length - 2, Math.floor(u)), f = u - i, x = P[i][0] + (P[i + 1][0] - P[i][0]) * f, y = P[i][1] + (P[i + 1][1] - P[i][1]) * f, tx = P[i + 1][0] - P[i][0], ty = P[i + 1][1] - P[i][1], l = Math.hypot(tx, ty) || 1; let m = 0, c = 0; for (let q = -band; q <= band; q++) { const X = Math.round(x + (-ty / l) * q), Y = Math.round(y + (tx / l) * q); if (X >= 0 && X < W && Y >= 0 && Y < H) { m += A[Y * W + X]; c++; } } o.push(m / Math.max(1, c)); } return o; };
    const pt = prof(T), pd = prof(D), top = Math.max(...pt); let err = 0, br = 0, on = 0;
    for (let s = 0; s < steps; s++) { err += Math.abs(pd[s] - pt[s]); if (pt[s] > 0.25 * top) { on++; if (pd[s] < 0.4 * pt[s]) br++; } }
    out.along = (err / steps) * 1000; out.broken = on ? br / on : 0;
    // (its style, in its own frame: against the teacher's along the teacher's spine)
    const g = styleGap(styleOf(unwrap(S, D, spineOurs ?? teacherSpine(S))), styleOf(unwrap(S, T, teacherSpine(S)))); out.dry = g.dry * 1000; out.rough = g.rough * 1e5;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +v.toFixed(3)]));
}
function png(S, D, name) {
  const { W, H } = S, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const d = Math.max(0, Math.min(1, D[y * W + x])); for (let k = 0; k < 3; k++) raw[y * (W * 3 + 1) + 1 + x * 3 + k] = Math.round(255 * (PAPER[k] - (PAPER[k] - 0.12) * d)); } }
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); let c = ~0; for (let i = 4; i < 8 + d.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } b.writeUInt32BE(~c >>> 0, 8 + d.length); return b; };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(W, 0); hd.writeUInt32BE(H, 4); hd[8] = 8; hd[9] = 2;
  writeFileSync(`${dir}render-${name}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const strip = (m) => ({ id: m.id, kind: m.kind, name: m.name, role: m.role, ctrl: m.ctrl?.map((p) => p.map((v) => +v.toFixed(5))), normal: m.normal, width: m.width, rows: m.rows, face: m.face, count: m.count, colour: m.colour, params: m.params.map((v) => +v.toFixed(4)), resid: m.resid.map((v) => +v.toFixed(3)), view: m.view });
const stripDeps = (deps) => deps.map((d) => [...d.p.map((v) => +v.toFixed(5)), +d.s1.toFixed(5), +d.s2.toFixed(5), +d.turn.toFixed(3), +d.logit.toFixed(3), d.t[0], d.t[1], d.t[2]]);

// ─── the run ───
const report = {}, bench = { about: 'Marks fitted to teacher marks cut from the sparse conservatory studies (devtools/splats-marks-fit.mjs).', sheets: [] }, fitted = {};
let id = 1;
const clone = (ms) => ms.map((m) => ({ ...m, ctrl: m.ctrl?.map((p) => [...p]), params: m.params.slice(), resid: m.resid.slice(), view: m.view.slice() }));
for (const t of TARGETS) {
  if (ONLY && !ONLY.split(',').includes(t.name) && !(t.of && ONLY.split(',').includes(t.of))) continue;
  const S = sheet(t), plain = marksFor(S, id); id += plain.length;
  const t0 = Date.now(), R = (report[t.name] = { deposits: plain.reduce((a, m) => a + m.count, 0), of: t.of ?? null, ways: {} }), out = { name: t.name, study: t.study, kind: t.kind, of: t.of ?? null, w: t.w, h: t.h, unit: t.unit, z: S.Z, fov: FOV, ways: {} };
  const keep = (way, D, marks, deps) => { R.ways[way] = measure(S, D, marks && marks[0].kind === 'stroke' && way !== 'unfitted' ? spinePx(S, marks[0]) : null); png(S, D, `${t.name}-${way}`); out.ways[way] = marks ? { marks: marks.map(strip) } : { deps: stripDeps(deps), k: deps.map((d) => +d.k.toFixed(3)) }; };
  png(S, S.T, `${t.name}-teacher`);
  keep('unfitted', draw(S, allDeps(plain)).D, plain);
  // (independent: every deposit free)
  const ind = fitIndependent(S, clone(plain), ITERS); keep('independent', draw(S, ind).D, null, ind);
  // (organised: parameters and spine; then its deposits)
  // (organised: its parameters and spine by the picture; then its style by what's measured in its own frame; then,
  // separately, its deposits' own residuals by the picture again)
  const org = clone(plain); fitOrganised(S, org, Math.round(ITERS * 0.6), 'all'); keep('organised, by the picture', draw(S, allDeps(org)).D, clone(org));
  fitStyle(S, org, STYLE); keep('organised', draw(S, allDeps(org)).D, org);
  const orgR = clone(org); fitOrganised(S, orgR, 0, 'all', Math.round(ITERS * 0.4)); keep('organised+deposits', draw(S, allDeps(orgR)).D, orgR);
  fitted[t.name] = org;
  if (t.of && fitted[t.of]) {
    // (the style learnt from the other mark, on this spine: only the pose fitted; and a plain stroke posed the same way)
    const styled = clone(plain); styled.forEach((m, k) => M.restyle(m, fitted[t.of][k])); fitOrganised(S, styled, Math.round(ITERS / 3), 'pose'); keep('style of ' + t.of, draw(S, allDeps(styled)).D, styled);
    const posed = clone(plain); fitOrganised(S, posed, Math.round(ITERS / 3), 'pose'); keep('plain posed', draw(S, allDeps(posed)).D, posed);
  }
  bench.sheets.push(out);
  console.log(`${t.name} (${R.deposits} deposits, ${Math.round((Date.now() - t0) / 1000)} s)`);
  for (const [w, m] of Object.entries(R.ways)) console.log(`  ${w.padEnd(20)} tone ${String(m.tone).padStart(7)}  bare paper ${String(m.bare).padStart(7)}  ink ×${m.ink}${'along' in m ? `  along ${m.along}  broken ${m.broken}  dry ${m.dry}  rough ${m.rough}` : ''}`);
}
writeFileSync(`${dir}fit${ONLY ? `-${ONLY.replace(/,/g, '+')}` : ''}.json`, JSON.stringify(report, null, 1));
if (!ONLY) writeFileSync(new URL('../static/splats/marks-bench.json', import.meta.url), JSON.stringify(bench));
