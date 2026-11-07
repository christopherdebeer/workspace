// Train Mist's tiny lighting network (node cells/lab/devtools/splats-mist-train.mjs): the expensive reference light
// (client/splats/mist.ts `reference*`) at mist splats in five training banks, under ten suns each, seen from three
// directions each; the network (9 → 16 → 16 → 1) fitted to it from the cheap features with Adam; the analytic model's two
// weights fitted by least squares on the same data. Then all of them measured where they weren't trained: the training
// banks under unseen suns, and an unseen bank under unseen suns; and against the baked colour (the reference under one
// sun and view, frozen). Writes client/splats/mistnet.ts.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
const o = await build({ entryPoints: [new URL('../client/splats/mist.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
let r = 12345; const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
const randn = () => { let u = 0; for (let k = 0; k < 6; k++) u += rnd(); return (u - 3) / 0.707; };
// (the training suns keep out of a band of azimuth and a band of elevation; the unseen suns are in them)
const inBand = (az, el) => (az > 1.1 && az < 1.9) || (el > 0.55 && el < 0.72);
const trainSun = () => { for (;;) { const az = rnd() * Math.PI * 2, el = 0.12 + rnd() * 1.1; if (!inBand(az, el)) return M.sunDir(az, el); } };
const unseenSuns = [[1.3, 0.3], [1.5, 0.9], [1.75, 0.5], [3.4, 0.62], [5.2, 0.66], [0.4, 0.6]].map(([a, e]) => M.sunDir(a, e));
const view = () => { const a = rnd() * Math.PI * 2, e = 0.05 + rnd() * 0.9; return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]; };
function samples(seed, suns, nPts, nViews) {
  const shape = M.mistShape(seed), grid = M.densityGrid(shape), pts = M.mistPoints(shape, nPts, seed + 7), out = [];
  for (const sun of suns) for (const pt of pts) {
    const ref = M.referenceAt(shape, pt.p, sun);
    for (let v = 0; v < nViews; v++) { const vw = view(), c = vw[0] * sun[0] + vw[1] * sun[1] + vw[2] * sun[2]; out.push({ f: M.features(grid, pt.p, sun, vw), y: M.referenceLight(ref, c), ref, p: pt.p, seed }); }
  }
  return out;
}
const t0 = Date.now();
const TRAIN = [1, 2, 3, 4, 5], TEST = 9;
let train = [];
for (const s of TRAIN) train.push(...samples(s, Array.from({ length: 10 }, trainSun), 1600, 3));
console.log(`training samples ${train.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const unseenSunTrainBanks = []; for (const s of TRAIN.slice(0, 2)) unseenSunTrainBanks.push(...samples(s, unseenSuns, 500, 2));
const unseenBank = samples(TEST, unseenSuns, 800, 2);
console.log(`test samples ${unseenSunTrainBanks.length} + ${unseenBank.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

// ─── the analytic model's two weights: least squares ───
let sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0;
for (const d of train) { const [a, b] = M.analyticTerms(d.f); sxx += a * a; sxy += a * b; syy += b * b; sxt += a * d.y; syt += b * d.y; }
const det = sxx * syy - sxy * sxy, K = { a: (syy * sxt - sxy * syt) / det, b: (sxx * syt - sxy * sxt) / det };
console.log('analytic weights', K);

// ─── the network ───
const IN = M.IN, H = M.H;
const mean = Array(IN).fill(0), std = Array(IN).fill(0);
for (const d of train) d.f.forEach((v, i) => { mean[i] += v / train.length; });
for (const d of train) d.f.forEach((v, i) => { std[i] += (v - mean[i]) ** 2 / train.length; });
for (let i = 0; i < IN; i++) std[i] = Math.sqrt(std[i]) || 1;
const P = { w1: Array.from({ length: H * IN }, () => randn() * Math.sqrt(2 / IN)), b1: Array(H).fill(0), w2: Array.from({ length: H * H }, () => randn() * Math.sqrt(2 / H)), b2: Array(H).fill(0), w3: Array.from({ length: H }, () => randn() * Math.sqrt(1 / H)), b3: [0] };
const keys = Object.keys(P), m1 = {}, m2 = {}; for (const k of keys) { m1[k] = P[k].map(() => 0); m2[k] = P[k].map(() => 0); }
let step = 0;
const X = train.map((d) => d.f.map((v, i) => (v - mean[i]) / std[i])), Y = train.map((d) => Math.log1p(d.y));
const EPOCHS = 24, B = 128;
for (let ep = 0; ep < EPOCHS; ep++) {
  const order = [...X.keys()].sort(() => rnd() - 0.5), lr = 3e-3 * (0.5 + 0.5 * Math.cos((Math.PI * ep) / EPOCHS));
  let loss = 0;
  for (let b0 = 0; b0 < order.length; b0 += B) {
    const G = {}; for (const k of keys) G[k] = P[k].map(() => 0);
    const n = Math.min(B, order.length - b0);
    for (let q = 0; q < n; q++) {
      const x = X[order[b0 + q]], y = Y[order[b0 + q]], z1 = Array(H), h1 = Array(H), z2 = Array(H), h2 = Array(H);
      for (let j = 0; j < H; j++) { let s = P.b1[j]; for (let i = 0; i < IN; i++) s += P.w1[j * IN + i] * x[i]; z1[j] = s; h1[j] = Math.max(0, s); }
      for (let j = 0; j < H; j++) { let s = P.b2[j]; for (let i = 0; i < H; i++) s += P.w2[j * H + i] * h1[i]; z2[j] = s; h2[j] = Math.max(0, s); }
      let out = P.b3[0]; for (let i = 0; i < H; i++) out += P.w3[i] * h2[i];
      const e = out - y; loss += e * e;
      const go = (2 * e) / n; G.b3[0] += go;
      const g2 = Array(H); for (let i = 0; i < H; i++) { G.w3[i] += go * h2[i]; g2[i] = z2[i] > 0 ? go * P.w3[i] : 0; }
      const g1 = Array(H).fill(0);
      for (let j = 0; j < H; j++) { if (!g2[j]) continue; G.b2[j] += g2[j]; for (let i = 0; i < H; i++) { G.w2[j * H + i] += g2[j] * h1[i]; g1[i] += g2[j] * P.w2[j * H + i]; } }
      for (let j = 0; j < H; j++) { if (z1[j] <= 0) continue; G.b1[j] += g1[j]; for (let i = 0; i < IN; i++) G.w1[j * IN + i] += g1[j] * x[i]; }
    }
    step++;
    for (const k of keys) for (let i = 0; i < P[k].length; i++) { const g = G[k][i]; m1[k][i] = 0.9 * m1[k][i] + 0.1 * g; m2[k][i] = 0.999 * m2[k][i] + 0.001 * g * g; P[k][i] -= (lr * (m1[k][i] / (1 - 0.9 ** step))) / (Math.sqrt(m2[k][i] / (1 - 0.999 ** step)) + 1e-8); }
  }
  if (ep % 4 === 3 || ep === EPOCHS - 1) console.log(`epoch ${ep + 1}: loss ${(loss / X.length).toFixed(4)}`);
}
const net = { w1: P.w1, b1: P.b1, w2: P.w2, b2: P.b2, w3: P.w3, b3: P.b3[0], mean, std };

// ─── measured where it wasn't trained ───
// (baked: each point's reference under one sun (az 0.5, el 0.8) and one view, frozen)
const bakeSun = M.sunDir(0.5, 0.8), bakeView = [0.56, 0.3, 0.77];
const bakedCache = new Map();
const baked = (d) => { const k = d.seed + ':' + d.p.join(','); if (!bakedCache.has(k)) { const ref = M.referenceAt(M.mistShape(d.seed), d.p, bakeSun); bakedCache.set(k, M.referenceLight(ref, bakeView[0] * bakeSun[0] + bakeView[1] * bakeSun[1] + bakeView[2] * bakeSun[2])); } return bakedCache.get(k); };
function score(set, name) {
  const methods = { baked, analytic: (d) => M.analytic(d.f, K), neural: (d) => M.netLight(net, d.f) };
  const row = {};
  for (const [m, fn] of Object.entries(methods)) {
    let se = 0, ae = 0, sl = 0, n = 0, sy = 0, sp = 0, syy = 0, spp = 0, syp = 0;
    for (const d of set) { const p = fn(d), y = d.y; se += (p - y) ** 2; ae += Math.abs(p - y); sl += (Math.log1p(p) - Math.log1p(y)) ** 2; sy += y; sp += p; syy += y * y; spp += p * p; syp += y * p; n++; }
    const corr = (n * syp - sy * sp) / Math.sqrt((n * syy - sy * sy) * (n * spp - sp * sp));
    row[m] = { rmse: +Math.sqrt(se / n).toFixed(4), mae: +(ae / n).toFixed(4), logRmse: +Math.sqrt(sl / n).toFixed(4), corr: +corr.toFixed(3) };
  }
  const meanY = set.reduce((s, d) => s + d.y, 0) / set.length;
  console.log(`\n${name} (${set.length} samples, mean light ${meanY.toFixed(3)})`);
  for (const [m, v] of Object.entries(row)) console.log(`  ${m.padEnd(9)} rmse ${v.rmse}  mae ${v.mae}  log-rmse ${v.logRmse}  correlation ${v.corr}`);
  return row;
}
const results = { trainBanksUnseenSuns: score(unseenSunTrainBanks, 'training banks, unseen suns'), unseenBankUnseenSuns: score(unseenBank, 'unseen bank, unseen suns') };
const r4 = (a) => a.map((v) => +v.toFixed(5));
writeFileSync(new URL('../client/splats/mistnet.ts', import.meta.url).pathname, `/**
 * Mist's trained lighting (devtools/splats-mist-train.mjs, ${new Date().toISOString().slice(0, 10)}): the tiny network's
 * weights (9 → 16 → 16 → 1, ${H * IN + H + H * H + H + H + 1} numbers, inputs normalised by MEAN and STD), the analytic
 * model's two fitted weights, and how each measured against the expensive reference where it wasn't trained.
 */
import type { Net } from './mist';
export const NET: Net = ${JSON.stringify({ w1: r4(net.w1), b1: r4(net.b1), w2: r4(net.w2), b2: r4(net.b2), w3: r4(net.w3), b3: +net.b3.toFixed(5), mean: r4(net.mean), std: r4(net.std) })};
export const ANALYTIC = ${JSON.stringify({ a: +K.a.toFixed(5), b: +K.b.toFixed(5) })};
/** the reference under one sun and view, frozen: the baked colours */
export const BAKE = { az: 0.5, el: 0.8 };
export const RESULTS = ${JSON.stringify(results)};
`);
console.log(`\nwrote client/splats/mistnet.ts (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
