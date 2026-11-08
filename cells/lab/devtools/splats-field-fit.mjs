// A drawing fitted as a field (node cells/lab/devtools/splats-field-fit.mjs [look] [iters]).
//
// The question: can a drawing be what splats are, a field fitted to pictures, rather than strokes placed by procedure?
// The teacher is the brush-drawn stone rendered by the real renderer from 36 views round it (splats-field-targets.mjs);
// 12 views between them are held out. The field is Gaussians laid evenly over the stone's surface and the ground round
// it, small flat discs, their places and shapes fixed; what's learned is each one's ink opacity as a function of the
// direction it's seen from: a logit in nine low-order terms of the view direction (constant, linear, quadratic), the
// way a radiance field's colour depends on view. So a mark can be there from one side and gone from another: a line
// that exists only where its edge is a silhouette, a wash only where its face is turned from the light toward you.
//
// Ink is composited as ink is: each mark absorbs a share of the light, so the paper's light at a pixel is the product
// of (1 − αG) over the marks there, independent of order; the coverage 1 − that product is compared with the
// teacher's darkness. The gradient of that is exact and cheap. Marks behind the stone from a view are left out of it
// (the stone's own mesh, rasterised per view, the same occluder the renderer uses).
//
// The baseline: the same discs with one constant opacity each (no view dependence). If the field's view dependence
// matters, it beats the baseline on the held-out views.
//
// Writes client/splats/fieldstone.ts (the fitted field, for ?scene=field) and devtools/out/field/fit-<look>.json.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const ST = await load('../client/splats/stone.ts');
const look = process.argv[2] ?? 'wash', ITERS = Number(process.argv[3] ?? 160);
const T = JSON.parse(readFileSync(new URL(`./out/field/targets-${look}.json`, import.meta.url)));
const W = T[0].w, H = T[0].h;
let rs = 3; const rnd = () => ((rs = (rs * 48271) % 2147483647) / 2147483647);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// ─── the discs: evenly over the stone's surface (area-weighted, kept a minimum distance apart) and the ground ───
const S = ST.stoneShape();
const tri = [];
for (let t = 0; t < S.tris.length; t += 3) {
  const A = [...S.pos.slice(S.tris[t] * 3, S.tris[t] * 3 + 3)], B = [...S.pos.slice(S.tris[t + 1] * 3, S.tris[t + 1] * 3 + 3)], C = [...S.pos.slice(S.tris[t + 2] * 3, S.tris[t + 2] * 3 + 3)];
  let n = cross(sub(B, A), sub(C, A)); const area = Math.hypot(...n) / 2; n = norm(n);
  if (dot(n, sub(A, S.centre)) < 0) n = n.map((v) => -v);
  tri.push({ A, B, C, n, area });
}
const total = tri.reduce((s, t) => s + t.area, 0), GAP = 0.016, SIG = 0.011, GROUND_GAP = 0.026;
const discs = [], cellMap = new Map();
const place = (p, n, gap, s) => {
  const key = (q) => q.map((v) => Math.floor(v / 0.03)).join(',');
  const [a, b, c] = p.map((v) => Math.floor(v / 0.03));
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const o of cellMap.get(`${a + x},${b + y},${c + z}`) ?? []) if (Math.hypot(o[0] - p[0], o[1] - p[1], o[2] - p[2]) < gap) return false;
  const k = key(p); (cellMap.get(k) ?? cellMap.set(k, []).get(k)).push(p);
  discs.push({ p: p.map((v, i) => v + n[i] * 0.003), n, s }); return true;
};
for (let k = 0; k < (total / (GAP * GAP)) * 6; k++) {
  let r = rnd() * total, t = tri[0]; for (const q of tri) { r -= q.area; if (r <= 0) { t = q; break; } }
  let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
  const p = [0, 1, 2].map((i) => t.A[i] + (t.B[i] - t.A[i]) * u + (t.C[i] - t.A[i]) * v);
  if (p[1] < 0.004) continue;
  place(p, t.n, GAP, SIG);
}
const nStone = discs.length;
for (let k = 0; k < 40000; k++) {
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 1.5, p = [Math.cos(a) * rr, 0.0015, Math.sin(a) * rr];
  const h = S.ray([0, 0.004, 0], norm([p[0], 0, p[2]])); if (h && Math.hypot(h.p[0], h.p[2]) > rr - 0.01) continue;
  place(p, [0, 1, 0], GROUND_GAP, SIG * 1.5);
}
const N = discs.length;
console.log(`${N} discs (${nStone} on the stone, ${N - nStone} on the ground); ${T.length} views at ${W}×${H}`);

// ─── per view: each disc's footprint (its projected covariance), whether it's seen, its view terms ───
const basis = (d) => [1, d[0], d[1], d[2], d[0] * d[1], d[1] * d[2], d[0] * d[2], d[0] * d[0] - d[1] * d[1], 3 * d[2] * d[2] - 1];
const NB = 9;
function camera(v) {
  const E = v.eye, f = norm(sub(v.target, E)), r = norm(cross(f, [0, v.up, 0])), u = cross(r, f), fy = H / (2 * Math.tan(v.fov / 2));
  return { E, f, r, u, fy };
}
const views = T.map((v) => {
  const c = camera(v);
  const toCam = (P) => { const d = sub(P, c.E); return [dot(d, c.r), dot(d, c.u), dot(d, c.f)]; };
  const toPx = (q) => [W / 2 + (c.fy * q[0]) / q[2], H / 2 - (c.fy * q[1]) / q[2]];
  // (the stone's depth from here)
  const zb = new Float32Array(W * H).fill(Infinity);
  for (const t of tri) {
    const q = [t.A, t.B, t.C].map(toCam); if (q.some((x) => x[2] < 0.05)) continue;
    const s = q.map(toPx), x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5, a = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, g = 1 - a - b;
      if (a < 0 || b < 0 || g < 0) continue;
      const z = a * q[0][2] + b * q[1][2] + g * q[2][2]; if (z < zb[y * W + x]) zb[y * W + x] = z;
    }
  }
  // (each disc: seen or not; its ellipse on the screen; its view terms)
  const fp = [];
  for (let i = 0; i < N; i++) {
    const D = discs[i], q = toCam(D.p); if (q[2] < 0.1) continue;
    const [sx, sy] = toPx(q); if (sx < -6 || sx > W + 6 || sy < -6 || sy > H + 6) continue;
    const ix = Math.min(W - 1, Math.max(0, Math.floor(sx))), iy = Math.min(H - 1, Math.max(0, Math.floor(sy)));
    if (q[2] > zb[iy * W + ix] + 0.02) continue;
    // (the disc's covariance: s² in its plane, ~0 along its normal; projected by the camera's Jacobian)
    const n = D.n, t1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), t2 = cross(n, t1), s2 = D.s * D.s, e2 = 0.0008 * 0.0008;
    const Sg = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Sg[a][b] = s2 * (t1[a] * t1[b] + t2[a] * t2[b]) + e2 * n[a] * n[b];
    const Wm = [c.r, c.u, c.f], J = [[c.fy / q[2], 0, (-c.fy * q[0]) / (q[2] * q[2])], [0, -c.fy / q[2], (c.fy * q[1]) / (q[2] * q[2])]];
    const M = J.map((row) => [0, 1, 2].map((k) => row[0] * Wm[0][k] + row[1] * Wm[1][k] + row[2] * Wm[2][k]));
    const cv = [[0, 0], [0, 0]];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { let s = 0; for (let k = 0; k < 3; k++) for (let l = 0; l < 3; l++) s += M[a][k] * Sg[k][l] * M[b][l]; cv[a][b] = s; }
    const A = cv[0][0] + 0.3, B = cv[0][1], C = cv[1][1] + 0.3, det = A * C - B * B, ia = C / det, ib = -B / det, ic = A / det;
    const R = 3 * Math.sqrt(Math.max(A, C));
    const dv = norm(sub(c.E, D.p));
    fp.push({ i, sx, sy, ia, ib, ic, x0: Math.max(0, Math.floor(sx - R)), x1: Math.min(W - 1, Math.ceil(sx + R)), y0: Math.max(0, Math.floor(sy - R)), y1: Math.min(H - 1, Math.ceil(sy + R)), Y: basis(dv) });
  }
  // (the teacher's darkness: 0 the paper, 1 full ink)
  const paper = 0.906, ink = 0.12, Tgt = Float32Array.from(v.L, (L) => Math.max(0, Math.min(1, (paper - L) / (paper - ink))));
  return { split: v.split, fp, Tgt, yaw: v.yaw, pitch: v.pitch };
});

// ─── fitting: Adam on each disc's view terms (or, for the baseline, its constant alone) ───
function fit(terms, iters, label) {
  const c = new Float32Array(N * NB), m1 = new Float32Array(N * NB), m2 = new Float32Array(N * NB);
  for (let i = 0; i < N; i++) c[i * NB] = -4;
  const logT = new Float32Array(W * H), cov = new Float32Array(W * H);
  const pass = (v, grad) => {
    logT.fill(0);
    const al = new Float32Array(v.fp.length);
    v.fp.forEach((f, k) => { let z = 0; for (let b = 0; b < terms; b++) z += c[f.i * NB + b] * f.Y[b]; al[k] = 1 / (1 + Math.exp(-z)); });
    v.fp.forEach((f, k) => { const a = al[k]; for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) { const dx = x + 0.5 - f.sx, dy = y + 0.5 - f.sy, G = Math.exp(-0.5 * (f.ia * dx * dx + 2 * f.ib * dx * dy + f.ic * dy * dy)); if (G < 0.01) continue; logT[y * W + x] += Math.log(1 - Math.min(0.99, a * G)); } });
    let loss = 0;
    for (let p = 0; p < W * H; p++) { const C = 1 - Math.exp(logT[p]), e = C - v.Tgt[p]; cov[p] = e; loss += e * e; }
    if (grad) v.fp.forEach((f, k) => {
      const a = al[k]; let g = 0;
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) { const dx = x + 0.5 - f.sx, dy = y + 0.5 - f.sy, G = Math.exp(-0.5 * (f.ia * dx * dx + 2 * f.ib * dx * dy + f.ic * dy * dy)); if (G < 0.01) continue; const aG = Math.min(0.99, a * G), p = y * W + x; g += 2 * cov[p] * Math.exp(logT[p]) / (1 - aG) * G; }
      g *= a * (1 - a);
      for (let b = 0; b < terms; b++) grad[f.i * NB + b] += g * f.Y[b];
    });
    return loss / (W * H);
  };
  const train = views.filter((v) => v.split === 'train'), test = views.filter((v) => v.split === 'test');
  const grad = new Float32Array(N * NB);
  for (let it = 1; it <= iters; it++) {
    grad.fill(0); let L = 0;
    for (const v of train) L += pass(v, grad);
    const lr = 0.08;
    for (let j = 0; j < N * NB; j++) { if (j % NB >= terms) continue; const g = grad[j] / train.length + 1e-4 * c[j] * (j % NB ? 1 : 0); m1[j] = 0.9 * m1[j] + 0.1 * g; m2[j] = 0.999 * m2[j] + 0.001 * g * g; c[j] -= (lr * (m1[j] / (1 - 0.9 ** it))) / (Math.sqrt(m2[j] / (1 - 0.999 ** it)) + 1e-7); c[j] = Math.max(-12, Math.min(12, c[j])); }
    if (it % 20 === 0 || it === 1) console.log(`${label} ${it}: train ${(L / train.length * 1000).toFixed(2)}`);
  }
  const err = (set) => set.reduce((s, v) => s + pass(v, null), 0) / set.length * 1000;
  const blank = (set) => set.reduce((s, v) => s + v.Tgt.reduce((q, t) => q + t * t, 0) / (W * H), 0) / set.length * 1000;
  return { c, train: +err(train).toFixed(3), test: +err(test).toFixed(3), blankTest: +blank(test).toFixed(3) };
}
const t0 = Date.now();
const flat = fit(1, ITERS, 'constant');
const field = fit(NB, ITERS, 'view-dependent');
const res = { discs: N, views: T.length, look, iters: ITERS, constant: { train: flat.train, test: flat.test }, field: { train: field.train, test: field.test }, blankTest: field.blankTest, seconds: Math.round((Date.now() - t0) / 1000) };
console.log(res);
writeFileSync(new URL(`./out/field/fit-${look}.json`, import.meta.url), JSON.stringify(res, null, 1));

// ─── the fitted field, for the renderer, packed (19 bytes a disc): place (3 × int16 over ±2.5), normal (octahedral, 2
// bytes), size (a byte, × 0.0002), nine view terms and the baseline's (a byte each over −12…12) ───
const B = Buffer.alloc(N * 19), qb = (v) => Math.round(((Math.max(-12, Math.min(12, v)) + 12) / 24) * 255);
const oct = (n) => { const l = Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]); let x = n[0] / l, y = n[1] / l; if (n[2] < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); } return [Math.round((x * 0.5 + 0.5) * 255), Math.round((y * 0.5 + 0.5) * 255)]; };
discs.forEach((d, i) => {
  const o = i * 19; d.p.forEach((v, k) => B.writeInt16LE(Math.round((v / 2.5) * 32767), o + k * 2));
  const [ox, oy] = oct(d.n); B[o + 6] = ox; B[o + 7] = oy; B[o + 8] = Math.round(d.s / 0.0002);
  for (let b = 0; b < NB; b++) B[o + 9 + b] = qb(field.c[i * NB + b]); B[o + 18] = qb(flat.c[i * NB]);
});
writeFileSync(new URL('../client/splats/fieldstone.ts', import.meta.url), `/** The stone's drawing fitted as a field (devtools/splats-field-fit.mjs, ${look}, ${N} discs, ${T.length} views; held-out error ${field.test} against ${flat.test} without view dependence, ${res.blankTest} for blank paper). Packed 19 bytes a disc: place (3 × int16 over ±2.5), normal (octahedral, 2 bytes), size (× 0.0002), nine view terms and the constant-only baseline's term (a byte each over −12…12). */\nexport const FIELD_STONE = { n: ${N}, stride: 19, look: '${look}', data: '${B.toString('base64')}' };\n`);
console.log('wrote client/splats/fieldstone.ts');
