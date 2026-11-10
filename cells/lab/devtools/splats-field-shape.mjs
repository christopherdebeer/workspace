// A drawing fitted as a field, its marks' shapes fitted too (node cells/lab/devtools/splats-field-shape.mjs
// --teach=<style>[,<style>…] [--holdout=<view>] [--res=384] [--iters=200] [--reg=0.1] [--noshape]).
//
// splats-field-fit.mjs fits only each disc's ink as a function of the view; its discs stay round and the one size, so
// a brush stroke, long, thin and tapered, can only be approximated by many overlapping greys, and a sumi drawing's
// decisive strokes come out as speckled smears. Here each disc also has a shape of its own, fitted with its ink: two
// sizes in its surface's plane, a turn in that plane, and a small shift along it. So a disc can become a short dab
// along a stroke, as a 3D Gaussian splat becomes whatever the picture needs.
//
// The gradient: exact per pixel with respect to each disc's ellipse on the screen and its centre (the Gaussian's own
// derivatives), carried to the five shape numbers through the projection's Jacobian, taken numerically per disc per
// view (five small extra projections). The teachers are the restyled wireframe views (splats-field-sheets.py, at this
// resolution); --holdout leaves a view out to test on; --noshape fits the ink alone at the same resolution, to compare.
//
// Writes static/splats/field-composed-<style>-shape.bin (21 bytes a disc: place, normal, two sizes and a turn, nine
// view terms, a constant) for ?scene=field&field=composed-<style>-shape.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const TEACH = arg('teach', 'sumi').split(','), HOLD = arg('holdout', '') || null, RES = Number(arg('res', 384)), ITERS = Number(arg('iters', 200)), REG = Number(arg('reg', 0.1)), SHAPE = !process.argv.includes('--noshape'), TERMS = Number(arg('terms', 9)), DUMP = process.argv.includes('--dump');
const W = RES, H = (RES * 2) / 3;
let rs = 3; const rnd = () => ((rs = (rs * 48271) % 2147483647) / 2147483647);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// ─── the discs: as splats-field-fit.mjs lays them for the composed scene (the same seed, so the same discs) ───
const SU = await load('../client/splats/subjects.ts'), sc = SU.composedScene('wash', true), O = sc.occluder, ob = sc.objects;
const tri = [], mid = new Map();
for (let t = 0; t < O.length / 9; t++) { const m = mid.get(ob[t]) ?? [0, 0, 0, 0]; for (let k = 0; k < 3; k++) { m[0] += O[t * 9 + k * 3]; m[1] += O[t * 9 + k * 3 + 1]; m[2] += O[t * 9 + k * 3 + 2]; m[3]++; } mid.set(ob[t], m); }
for (let t = 0; t < O.length / 9; t++) {
  const A = [...O.slice(t * 9, t * 9 + 3)], B = [...O.slice(t * 9 + 3, t * 9 + 6)], C = [...O.slice(t * 9 + 6, t * 9 + 9)], m = mid.get(ob[t]), M = [m[0] / m[3], m[1] / m[3], m[2] / m[3]];
  let n = cross(sub(B, A), sub(C, A)); const area = Math.hypot(...n) / 2; if (area < 1e-9) continue; n = norm(n);
  const c = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3], out = Math.abs(n[1]) < 0.5 ? [c[0] - M[0], 0, c[2] - M[2]] : sub(c, M);
  if (dot(n, out) < 0) n = n.map((v) => -v);
  tri.push({ A, B, C, n, area });
}
const total = tri.reduce((s, t) => s + t.area, 0), GAP = 0.02, SIG = 0.013, GROUND_GAP = 0.045;
const cum = []; { let a = 0; for (const t of tri) { a += t.area; cum.push(a); } }
const pick = (r) => { let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; } return tri[lo]; };
const discs = [], cellMap = new Map();
const place = (p, n, gap, s) => {
  const [a, b, c] = p.map((v) => Math.floor(v / 0.03));
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const o of cellMap.get(`${a + x},${b + y},${c + z}`) ?? []) if (Math.hypot(o[0] - p[0], o[1] - p[1], o[2] - p[2]) < gap) return;
  const k = `${a},${b},${c}`; (cellMap.get(k) ?? cellMap.set(k, []).get(k)).push(p);
  const t1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), t2 = cross(n, t1);
  discs.push({ p: p.map((v, i) => v + n[i] * 0.003), n, s, t1, t2, gap });
};
for (let k = 0; k < (total / (GAP * GAP)) * 6; k++) {
  const t = pick(rnd() * total); let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
  const p = [0, 1, 2].map((i) => t.A[i] + (t.B[i] - t.A[i]) * u + (t.C[i] - t.A[i]) * v); if (p[1] < 0.004) continue;
  place(p, t.n, GAP, SIG);
}
for (let k = 0; k < 80000; k++) { const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 3.4; place([-0.15 + Math.cos(a) * rr, 0.0015, 0.1 + Math.sin(a) * rr], [0, 1, 0], GROUND_GAP, SIG * 1.6); }
const N = discs.length;

// ─── the views: the teachers, each with its camera; which discs each sees ───
const NB = 9, basis = (d) => [1, d[0], d[1], d[2], d[0] * d[1], d[1] * d[2], d[0] * d[2], d[0] * d[0] - d[1] * d[1], 3 * d[2] * d[2] - 1];
const views = [];
for (const st of TEACH) for (const view of ['ref', 'left', 'right', 'far-left', 'far-right', 'high']) {
  const R = JSON.parse(readFileSync(new URL(`./out/field/ref-${st}-${view}${RES === 192 ? '' : `@${RES}`}.json`, import.meta.url)));
  if (R.w !== W) throw new Error(`teacher ${st}/${view} is ${R.w} wide, not ${W}`);
  const E = R.camera.eye, f = norm(sub(R.camera.target, E)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), fy = H / (2 * Math.tan(R.camera.fov / 2));
  const cam = { E, f, r, u, fy };
  // (the occluders' depth from here, to decide once which discs are seen)
  const toCam = (P) => { const d = sub(P, E); return [dot(d, r), dot(d, u), dot(d, f)]; }, toPx = (q) => [W / 2 + (fy * q[0]) / q[2], H / 2 - (fy * q[1]) / q[2]];
  const zb = new Float32Array(W * H).fill(Infinity);
  for (const t of tri) {
    const q = [t.A, t.B, t.C].map(toCam); if (q.some((x) => x[2] < 0.05)) continue;
    const s = q.map(toPx), x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const px = x + 0.5, py = y + 0.5, a = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, g = 1 - a - b; if (a < 0 || b < 0 || g < 0) continue; const z = a * q[0][2] + b * q[1][2] + g * q[2][2]; if (z < zb[y * W + x]) zb[y * W + x] = z; }
  }
  const seen = [], Y = [];
  for (let i = 0; i < N; i++) { const q = toCam(discs[i].p); if (q[2] < 0.1) continue; const [sx, sy] = toPx(q); if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue; const ix = Math.min(W - 1, Math.max(0, Math.floor(sx))), iy = Math.min(H - 1, Math.max(0, Math.floor(sy))); if (q[2] > zb[iy * W + ix] + 0.02) continue; seen.push(i); Y.push(basis(norm(sub(E, discs[i].p)))); }
  views.push({ style: st, view, split: view === HOLD ? 'test' : 'train', cam, seen, Y, Tgt: Float32Array.from(R.D) });
}
console.log(`${N} discs; ${views.length} views at ${W}×${H} (${views.filter((v) => v.split === 'train').length} to fit${HOLD ? `, ${HOLD} held out` : ''}); shapes ${SHAPE ? 'fitted' : 'fixed'}`);

// ─── a disc's ellipse on the screen, for its shape (log sizes ×2, turn, shift ×2) ───
const NS = 5;
function ellipse(i, sh, cam) {
  const D = discs[i], s1 = D.s * Math.exp(sh[0]), s2 = D.s * Math.exp(sh[1]), ct = Math.cos(sh[2]), st = Math.sin(sh[2]);
  const a1 = [0, 1, 2].map((k) => ct * D.t1[k] + st * D.t2[k]), a2 = [0, 1, 2].map((k) => -st * D.t1[k] + ct * D.t2[k]);
  const P = [0, 1, 2].map((k) => D.p[k] + (sh[3] * D.t1[k] + sh[4] * D.t2[k]) * D.gap);
  const d = sub(P, cam.E), q = [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)], z = q[2];
  const sx = W / 2 + (cam.fy * q[0]) / z, sy = H / 2 - (cam.fy * q[1]) / z;
  // (each axis's screen image: J W a; the covariance the sum of their outer products, scaled)
  const img = (a, s) => { const ar = dot(a, cam.r), au = dot(a, cam.u), af = dot(a, cam.f); return [s * (cam.fy / z) * (ar - (q[0] * af) / z), s * (-cam.fy / z) * (au - (q[1] * af) / z)]; };
  const e1 = img(a1, s1), e2 = img(a2, s2), e3 = img(D.n, 0.0008);
  const A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], C = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3;
  const det = A * C - B * B;
  return [sx, sy, C / det, -B / det, A / det, 3 * Math.sqrt(Math.max(A, C))];
}

// ─── fitting ───
const c = new Float32Array(N * NB), sh = new Float32Array(N * NS);
for (let i = 0; i < N; i++) c[i * NB] = -4;
const Adam = (n) => ({ m1: new Float32Array(n), m2: new Float32Array(n) });
const ac = Adam(N * NB), as = Adam(N * NS), gc = new Float32Array(N * NB), gs = new Float32Array(N * NS);
const logT = new Float32Array(W * H), cov = new Float32Array(W * H);
function pass(v, grad) {
  logT.fill(0);
  const fps = v.seen.map((i, k) => { const e = ellipse(i, sh.subarray(i * NS, i * NS + NS), v.cam); let zz = 0; for (let b = 0; b < TERMS; b++) zz += c[i * NB + b] * v.Y[k][b]; return { i, k, e, a: 1 / (1 + Math.exp(-zz)) }; });
  for (const f of fps) {
    const [sx, sy, ia, ib, ic, R] = f.e, x0 = Math.max(0, Math.floor(sx - R)), x1 = Math.min(W - 1, Math.ceil(sx + R)), y0 = Math.max(0, Math.floor(sy - R)), y1 = Math.min(H - 1, Math.ceil(sy + R));
    f.box = [x0, x1, y0, y1];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.01) continue; logT[y * W + x] += Math.log(1 - Math.min(0.99, f.a * G)); }
  }
  let loss = 0;
  for (let p = 0; p < W * H; p++) { const e = 1 - Math.exp(logT[p]) - v.Tgt[p]; cov[p] = e; loss += e * e; }
  if (grad) for (const f of fps) {
    const [sx, sy, ia, ib, ic] = f.e, [x0, x1, y0, y1] = f.box, a = f.a;
    let ga = 0, gsx = 0, gsy = 0, gia = 0, gib = 0, gic = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.01) continue;
      const aG = Math.min(0.99, a * G), p = y * W + x, k = (2 * cov[p] * Math.exp(logT[p])) / (1 - aG);
      ga += k * G; const gG = k * a;
      gsx += gG * G * (ia * dx + ib * dy); gsy += gG * G * (ib * dx + ic * dy);
      gia += gG * G * -0.5 * dx * dx; gib += gG * G * -dx * dy; gic += gG * G * -0.5 * dy * dy;
    }
    ga *= a * (1 - a);
    for (let b = 0; b < TERMS; b++) gc[f.i * NB + b] += ga * v.Y[f.k][b];
    if (SHAPE && (gsx || gsy || gia || gib || gic)) {
      const s0 = Array.from(sh.subarray(f.i * NS, f.i * NS + NS));
      for (let j = 0; j < NS; j++) { const s1 = s0.slice(); s1[j] += 1e-3; const e1 = ellipse(f.i, s1, v.cam); gs[f.i * NS + j] += ((e1[0] - sx) * gsx + (e1[1] - sy) * gsy + (e1[2] - ia) * gia + (e1[3] - ib) * gib + (e1[4] - ic) * gic) / 1e-3; }
    }
  }
  return loss / (W * H);
}
const train = views.filter((v) => v.split === 'train'), test = views.filter((v) => v.split === 'test');
const step = (p, g, A, it, lr, reg, lo, hi, skip) => { for (let j = 0; j < p.length; j++) { if (skip?.(j)) continue; const gj = g[j] / train.length + reg(j) * p[j]; A.m1[j] = 0.9 * A.m1[j] + 0.1 * gj; A.m2[j] = 0.999 * A.m2[j] + 0.001 * gj * gj; p[j] -= (lr * (A.m1[j] / (1 - 0.9 ** it))) / (Math.sqrt(A.m2[j] / (1 - 0.999 ** it)) + 1e-7); p[j] = Math.max(lo(j), Math.min(hi(j), p[j])); } };
const t0 = Date.now();
for (let it = 1; it <= ITERS; it++) {
  gc.fill(0); gs.fill(0); let L = 0;
  for (const v of train) L += pass(v, true);
  step(c, gc, ac, it, 0.08, (j) => (j % NB ? REG : 0), () => -12, () => 12);
  // (shapes: sizes from a third to three times, any turn, a shift up to half the spacing; held a little toward round)
  if (SHAPE && it > 10) step(sh, gs, as, it - 10, 0.02, (j) => (j % NS < 2 ? 0.002 : 0), (j) => (j % NS < 2 ? -1.1 : j % NS === 2 ? -10 : -0.5), (j) => (j % NS < 2 ? 1.1 : j % NS === 2 ? 10 : 0.5));
  if (it % 20 === 0 || it === 1) console.log(`${it}: train ${((L / train.length) * 1000).toFixed(2)}  (${Math.round((Date.now() - t0) / 1000)} s)`);
}
const err = (set) => (set.reduce((s, v) => s + pass(v, false), 0) / Math.max(1, set.length)) * 1000;
const res = { teach: TEACH, holdout: HOLD, res: RES, shape: SHAPE, discs: N, iters: ITERS, reg: REG, train: +err(train).toFixed(3), test: test.length ? +err(test).toFixed(3) : null, seconds: Math.round((Date.now() - t0) / 1000) };
console.log(res);
const tag = `${TEACH.length > 1 ? `${TEACH[0]}-pooled` : TEACH[0]}${SHAPE ? '-shape' : '-fixed'}@${RES}`;
writeFileSync(new URL(`./out/field/fit-${tag}${HOLD ? `-minus-${HOLD}` : ''}.json`, import.meta.url), JSON.stringify(res, null, 1));
// (--dump: what the field draws of each held-out view, as darkness, for measures other than pixel error
// (splats-field-score.py))
if (DUMP) for (const v of test) { pass(v, false); const C = Array.from(logT, (l) => +(1 - Math.exp(l)).toFixed(3)); writeFileSync(new URL(`./out/field/dump-${tag}${TERMS < 9 ? `-terms${TERMS}` : ''}-${v.style}-${v.view}.json`, import.meta.url), JSON.stringify({ w: W, h: H, style: v.style, view: v.view, C })); }
// (--keep: a held-out run's field written too, as `…-minus-<view>`, to draw it in the browser from the view it never saw)
if (HOLD && !process.argv.includes('--keep')) process.exit(0);

// ─── the field, packed 21 bytes a disc: place (3 × int16 over ±4, the shift folded in), normal (octahedral), two sizes
// (× 0.0002), the turn (over 0…π), nine view terms and a constant (over −12…12) ───
const SPAN = 4, Bf = Buffer.alloc(N * 21), qb = (v) => Math.round(((Math.max(-12, Math.min(12, v)) + 12) / 24) * 255);
const oct = (n) => { const l = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]); let x = n[0] / l, y = n[1] / l; if (n[2] < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); } return [Math.round((x * 0.5 + 0.5) * 255), Math.round((y * 0.5 + 0.5) * 255)]; };
discs.forEach((D, i) => {
  const s = sh.subarray(i * NS, i * NS + NS), o = i * 21, P = [0, 1, 2].map((k) => D.p[k] + (s[3] * D.t1[k] + s[4] * D.t2[k]) * D.gap);
  P.forEach((v, k) => Bf.writeInt16LE(Math.round((v / SPAN) * 32767), o + k * 2));
  const [ox, oy] = oct(D.n); Bf[o + 6] = ox; Bf[o + 7] = oy;
  Bf[o + 8] = Math.min(255, Math.round((D.s * Math.exp(s[0])) / 0.0002)); Bf[o + 9] = Math.min(255, Math.round((D.s * Math.exp(s[1])) / 0.0002));
  Bf[o + 10] = Math.round((((s[2] % Math.PI) + Math.PI) % Math.PI) / Math.PI * 255);
  for (let b = 0; b < NB; b++) Bf[o + 11 + b] = qb(c[i * NB + b]); Bf[o + 20] = qb(c[i * NB]);
});
const head = Buffer.alloc(12); head.writeUInt32LE(N, 0); head.writeUInt32LE(21, 4); head.writeFloatLE(SPAN, 8);
const fname = `composed-${TEACH.length > 1 ? `${TEACH[0]}-pooled` : TEACH[0]}-${SHAPE ? 'shape' : 'fixed'}${HOLD ? `-minus-${HOLD}` : ''}`;
writeFileSync(new URL(`../static/splats/field-${fname}.bin`, import.meta.url), Buffer.concat([head, Bf]));
writeFileSync(new URL(`../static/splats/field-${fname}.json`, import.meta.url), JSON.stringify({ about: `The composed scene fitted as a field to the ${TEACH.join(', ')} restyle${TEACH.length > 1 ? 's' : ''} of its six wireframe views at ${W}×${H}, ${SHAPE ? 'each disc\'s shape fitted with its ink' : 'its discs\' shapes fixed'} (devtools/splats-field-shape.mjs).`, ...res }));
console.log(`wrote static/splats/field-${fname}.bin`);
