// Train Mist's tiny lighting network (node cells/lab/devtools/splats-mist-train.mjs [--quick]), after Grassi's recipe:
// the expensive reference light (client/splats/mist.ts `reference*`) at points where a camera's rays first meet the
// mist, in five training banks under ten suns each, from three views each; the network (13 → 16 → 16 → 2: the sun's light
// and the sky's) fitted to the light itself (untransformed) from the pyramid features, squared ReLU hidden, squared
// outputs, with Adam; the analytic model's two weights fitted by least squares on the same points. Then all of them
// measured where they weren't trained: the training banks under unseen suns, and an unseen bank under unseen suns, both
// on visible points (camera hits) and on the mist's splats; and against the baked colour (the reference under one sun and
// view, frozen). And an ablation: the same features with each of the recipe's choices undone in turn, and all of them
// undone (this experiment's first recipe). Writes client/splats/mistnet.ts.
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
const o = await build({ entryPoints: [new URL('../client/splats/mist.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const QUICK = process.argv.includes('--quick');
let r = 12345; const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
const randn = () => { let u = 0; for (let k = 0; k < 6; k++) u += rnd(); return (u - 3) / 0.707; };
// (the training suns keep out of a band of azimuth and a band of elevation; the unseen suns are in them)
const inBand = (az, el) => (az > 1.1 && az < 1.9) || (el > 0.55 && el < 0.72);
const trainSun = () => { for (;;) { const az = rnd() * Math.PI * 2, el = 0.12 + rnd() * 1.1; if (!inBand(az, el)) return M.sunDir(az, el); } };
const unseenSuns = [[1.3, 0.3], [1.5, 0.9], [1.75, 0.5], [3.4, 0.62], [5.2, 0.66], [0.4, 0.6]].map(([a, e]) => M.sunDir(a, e));
const view = () => { const a = rnd() * Math.PI * 2, e = 0.05 + rnd() * 0.9; return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sample = (shape, grid, p, sun, vw, seed) => { const ref = M.referenceAt(shape, p, sun); return { f: M.features(grid, p, sun, vw), y: M.referenceParts(ref, dot(vw, sun)), p, vw, seed }; };
/** points a camera sees: per sun, nViews views, nHits first collisions of jittered rays each */
function visible(seed, suns, nHits, nViews) {
  const shape = M.mistShape(seed), grid = M.densityGrid(shape), out = [];
  for (const sun of suns) for (let v = 0; v < nViews; v++) {
    const vw = view();
    for (let k = 0, got = 0; got < nHits && k < nHits * 20; k++) { const p = M.cameraHit(shape, vw, rnd() * 2 - 1, rnd() * 2 - 1, rnd()); if (p) { out.push(sample(shape, grid, p, sun, vw, seed)); got++; } }
  }
  return out;
}
/** the mist's splats, seen from random views (this experiment's first sampling) */
function splats(seed, suns, nPts, nViews) {
  const shape = M.mistShape(seed), grid = M.densityGrid(shape), pts = M.mistPoints(shape, nPts, seed + 7), out = [];
  for (const sun of suns) for (const pt of pts) for (let v = 0; v < nViews; v++) out.push(sample(shape, grid, pt.p, sun, view(), seed));
  return out;
}
const t0 = Date.now(), secs = () => ((Date.now() - t0) / 1000).toFixed(0) + ' s';
const TRAIN = [1, 2, 3, 4, 5], TEST = 9, NS = QUICK ? 4 : 10, NP = QUICK ? 500 : 1600;
const trainSuns = TRAIN.map(() => Array.from({ length: NS }, trainSun));
const trainVis = [], trainSpl = [];
TRAIN.forEach((s, i) => { trainVis.push(...visible(s, trainSuns[i], NP, 3)); });
console.log(`training samples, visible ${trainVis.length} (${secs()})`);
TRAIN.forEach((s, i) => { trainSpl.push(...splats(s, trainSuns[i], NP, 3)); });
console.log(`training samples, splats ${trainSpl.length} (${secs()})`);
const tests = {
  trainBanksUnseenSuns: [...TRAIN.slice(0, 2).flatMap((s) => visible(s, unseenSuns, 400, 2))],
  unseenBankUnseenSuns: visible(TEST, unseenSuns, 700, 2),
  unseenBankSplats: splats(TEST, unseenSuns, 800, 2),
};
console.log(`test samples ${Object.values(tests).map((t) => t.length).join(' + ')} (${secs()})`);
const total = (d) => d.y[0] + d.y[1];

// ─── the analytic model's two weights: least squares on the light ───
let sxx = 0, sxy = 0, syy = 0, sxt = 0, syt = 0;
for (const d of trainVis) { const [a, b] = M.analyticTerms(d.f); const y = total(d); sxx += a * a; sxy += a * b; syy += b * b; sxt += a * y; syt += b * y; }
const det = sxx * syy - sxy * sxy, K = { a: (syy * sxt - sxy * syt) / det, b: (sxx * syt - sxy * sxt) / det };
console.log('analytic weights', K);

// ─── the network, with the recipe's choices as options ───
// act: 'sq' (squared ReLU) | 'relu'; out: 'sq' (squared) | 'lin'; target: 'raw' | 'log' (log1p); heads: 2 (sun, sky) | 1
const IN = M.IN, H = M.H;
function train(data, opt) {
  const OUT = opt.heads, EPOCHS = QUICK ? 10 : 30, B = 128;
  const mean = Array(IN).fill(0), std = Array(IN).fill(0);
  for (const d of data) d.f.forEach((v, i) => { mean[i] += v / data.length; });
  for (const d of data) d.f.forEach((v, i) => { std[i] += (v - mean[i]) ** 2 / data.length; });
  for (let i = 0; i < IN; i++) std[i] = Math.sqrt(std[i]) || 1;
  const tgt = (d) => { const y = OUT === 2 ? d.y : [total(d)]; return y.map((v) => (opt.target === 'log' ? Math.log1p(v) : v)); };
  const X = data.map((d) => d.f.map((v, i) => (v - mean[i]) / std[i])), Y = data.map(tgt);
  const ymean = Array.from({ length: OUT }, (_, k) => Y.reduce((s, y) => s + y[k], 0) / Y.length);
  const g1 = opt.act === 'sq' ? 0.6 : 1.4;
  const P = { w1: Array.from({ length: H * IN }, () => randn() * g1 / Math.sqrt(IN)), b1: Array(H).fill(opt.act === 'sq' ? 0.3 : 0), w2: Array.from({ length: H * H }, () => randn() * g1 / Math.sqrt(H)), b2: Array(H).fill(opt.act === 'sq' ? 0.3 : 0), w3: Array.from({ length: OUT * H }, () => randn() * 0.1 / Math.sqrt(H)), b3: ymean.map((m) => (opt.out === 'sq' ? Math.sqrt(Math.max(1e-4, m)) : m)) };
  const keys = Object.keys(P), m1 = {}, m2 = {}; for (const k of keys) { m1[k] = P[k].map(() => 0); m2[k] = P[k].map(() => 0); }
  const act = opt.act === 'sq' ? (z) => (z > 0 ? z * z : 0) : (z) => (z > 0 ? z : 0), dact = opt.act === 'sq' ? (z) => (z > 0 ? 2 * z : 0) : (z) => (z > 0 ? 1 : 0);
  let step = 0;
  for (let ep = 0; ep < EPOCHS; ep++) {
    const order = [...X.keys()].sort(() => rnd() - 0.5), lr = 2e-3 * (0.5 + 0.5 * Math.cos((Math.PI * ep) / EPOCHS));
    let loss = 0;
    for (let b0 = 0; b0 < order.length; b0 += B) {
      const G = {}; for (const k of keys) G[k] = P[k].map(() => 0);
      const n = Math.min(B, order.length - b0);
      for (let q = 0; q < n; q++) {
        const x = X[order[b0 + q]], y = Y[order[b0 + q]], z1 = Array(H), h1 = Array(H), z2 = Array(H), h2 = Array(H);
        for (let j = 0; j < H; j++) { let s = P.b1[j]; for (let i = 0; i < IN; i++) s += P.w1[j * IN + i] * x[i]; z1[j] = s; h1[j] = act(s); }
        for (let j = 0; j < H; j++) { let s = P.b2[j]; for (let i = 0; i < H; i++) s += P.w2[j * H + i] * h1[i]; z2[j] = s; h2[j] = act(s); }
        const gh2 = Array(H).fill(0);
        for (let k = 0; k < OUT; k++) {
          let s = P.b3[k]; for (let i = 0; i < H; i++) s += P.w3[k * H + i] * h2[i];
          const pred = opt.out === 'sq' ? s * s : s, e = pred - y[k]; loss += e * e;
          const go = ((2 * e) / n) * (opt.out === 'sq' ? 2 * s : 1);
          G.b3[k] += go; for (let i = 0; i < H; i++) { G.w3[k * H + i] += go * h2[i]; gh2[i] += go * P.w3[k * H + i]; }
        }
        const gh1 = Array(H).fill(0);
        for (let j = 0; j < H; j++) { const g = gh2[j] * dact(z2[j]); if (!g) continue; G.b2[j] += g; for (let i = 0; i < H; i++) { G.w2[j * H + i] += g * h1[i]; gh1[i] += g * P.w2[j * H + i]; } }
        for (let j = 0; j < H; j++) { const g = gh1[j] * dact(z1[j]); if (!g) continue; G.b1[j] += g; for (let i = 0; i < IN; i++) G.w1[j * IN + i] += g * x[i]; }
      }
      step++;
      for (const k of keys) for (let i = 0; i < P[k].length; i++) { const g = Math.max(-5, Math.min(5, G[k][i])); m1[k][i] = 0.9 * m1[k][i] + 0.1 * g; m2[k][i] = 0.999 * m2[k][i] + 0.001 * g * g; P[k][i] -= (lr * (m1[k][i] / (1 - 0.9 ** step))) / (Math.sqrt(m2[k][i] / (1 - 0.999 ** step)) + 1e-8); }
    }
    if (ep % 6 === 5 || ep === EPOCHS - 1) console.log(`  epoch ${ep + 1}: loss ${(loss / X.length).toFixed(4)}`);
  }
  const net = { ...P, mean, std };
  // (its light: the heads' sum, the target's transform undone, never negative)
  net.light = (f) => {
    const x = f.map((v, i) => (v - mean[i]) / std[i]), h1 = Array(H), h2 = Array(H);
    for (let j = 0; j < H; j++) { let s = P.b1[j]; for (let i = 0; i < IN; i++) s += P.w1[j * IN + i] * x[i]; h1[j] = act(s); }
    for (let j = 0; j < H; j++) { let s = P.b2[j]; for (let i = 0; i < H; i++) s += P.w2[j * H + i] * h1[i]; h2[j] = act(s); }
    let L = 0;
    for (let k = 0; k < OUT; k++) { let s = P.b3[k]; for (let i = 0; i < H; i++) s += P.w3[k * H + i] * h2[i]; let v = opt.out === 'sq' ? s * s : s; if (opt.target === 'log') v = Math.expm1(v); L += Math.min(M.OUT_MAX, Math.max(0, v)); }
    return L;
  };
  return net;
}

// ─── measured where it wasn't trained ───
// (baked: each point's reference under one sun (az 0.5, el 0.8) and one view, frozen)
const bakeSun = M.sunDir(0.5, 0.8), bakeView = [0.56, 0.3, 0.77];
const bakedCache = new Map();
const baked = (d) => { const k = d.seed + ':' + d.p.join(','); if (!bakedCache.has(k)) bakedCache.set(k, M.referenceLight(M.referenceAt(M.mistShape(d.seed), d.p, bakeSun), dot(bakeView, bakeSun))); return bakedCache.get(k); };
function stats(set, fn) {
  let se = 0, ae = 0, n = 0, sy = 0, sp = 0, syy = 0, spp = 0, syp = 0;
  for (const d of set) { const p = fn(d), y = total(d); se += (p - y) ** 2; ae += Math.abs(p - y); sy += y; sp += p; syy += y * y; spp += p * p; syp += y * p; n++; }
  const corr = (n * syp - sy * sp) / Math.sqrt((n * syy - sy * sy) * (n * spp - sp * sp));
  return { rmse: +Math.sqrt(se / n).toFixed(4), mae: +(ae / n).toFixed(4), corr: +corr.toFixed(3), ratio: +(sp / sy).toFixed(3) };
}

const RECIPES = {
  grassi: { act: 'sq', out: 'sq', target: 'raw', heads: 2, data: 'visible' },
  'relu hidden': { act: 'relu', out: 'sq', target: 'raw', heads: 2, data: 'visible' },
  'log1p target': { act: 'sq', out: 'sq', target: 'log', heads: 2, data: 'visible' },
  'one output': { act: 'sq', out: 'sq', target: 'raw', heads: 1, data: 'visible' },
  'splat sampling': { act: 'sq', out: 'sq', target: 'raw', heads: 2, data: 'splats' },
  'first recipe': { act: 'relu', out: 'lin', target: 'log', heads: 1, data: 'splats' },
};
const nets = {}, ablation = {};
for (const [name, opt] of Object.entries(RECIPES)) {
  if (QUICK && name !== 'grassi' && name !== 'first recipe') continue;
  console.log(`\ntraining: ${name} (${secs()})`);
  r = 777; nets[name] = train(opt.data === 'visible' ? trainVis : trainSpl, opt);
  ablation[name] = Object.fromEntries(Object.entries(tests).map(([k, set]) => [k, stats(set, (d) => nets[name].light(d.f))]));
  console.log(`  unseen bank, visible: mae ${ablation[name].unseenBankUnseenSuns.mae} corr ${ablation[name].unseenBankUnseenSuns.corr} light ratio ${ablation[name].unseenBankUnseenSuns.ratio}; splats: mae ${ablation[name].unseenBankSplats.mae}`);
}
const net = nets.grassi;
const results = {};
for (const [k, set] of Object.entries(tests)) {
  results[k] = { baked: stats(set, baked), analytic: stats(set, (d) => M.analytic(d.f, K)), neural: stats(set, (d) => M.netLight(net, d.f)) };
  const meanY = set.reduce((s, d) => s + total(d), 0) / set.length;
  results[k].meanLight = +meanY.toFixed(3);
  console.log(`\n${k} (${set.length} samples, mean light ${meanY.toFixed(3)})`);
  for (const m of ['baked', 'analytic', 'neural']) { const v = results[k][m]; console.log(`  ${m.padEnd(9)} rmse ${v.rmse}  mae ${v.mae}  correlation ${v.corr}  light ratio ${v.ratio}`); }
}
// (the exported network's light, as mist.ts works it out, agrees with the trainer's)
const chk = tests.unseenBankUnseenSuns.slice(0, 50).reduce((s, d) => s + Math.abs(M.netLight(net, d.f) - net.light(d.f)), 0);
if (chk > 1e-6) throw new Error('mist.ts netLight disagrees with the trainer: ' + chk);
const r5 = (a) => a.map((v) => +v.toFixed(5));
writeFileSync(new URL('../client/splats/mistnet.ts', import.meta.url).pathname, `/**
 * Mist's trained lighting (devtools/splats-mist-train.mjs, ${new Date().toISOString().slice(0, 10)}${QUICK ? ', quick' : ''}): the tiny network's
 * weights (13 → 16 → 16 → 2, ${M.NET_SIZE} numbers, inputs normalised by MEAN and STD), the analytic model's two fitted
 * weights, how each measured against the expensive reference where it wasn't trained, and the recipe's ablation.
 */
import type { Net } from './mist';
export const NET: Net = ${JSON.stringify({ w1: r5(net.w1), b1: r5(net.b1), w2: r5(net.w2), b2: r5(net.b2), w3: r5(net.w3), b3: r5(net.b3), mean: r5(net.mean), std: r5(net.std) })};
export const ANALYTIC = ${JSON.stringify({ a: +K.a.toFixed(5), b: +K.b.toFixed(5) })};
/** the reference under one sun and view, frozen: the baked colours */
export const BAKE = { az: 0.5, el: 0.8 };
export const RESULTS = ${JSON.stringify(results)};
export const ABLATION = ${JSON.stringify(ablation)};
`);
console.log(`\nwrote client/splats/mistnet.ts (${secs()})`);
