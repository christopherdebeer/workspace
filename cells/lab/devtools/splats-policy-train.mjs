// Train the composed scene's drawing policy (node cells/lab/devtools/splats-policy-train.mjs [--synthetic]).
//
// The teacher is judged pairs: two treatments of the same view (which groups keep how much, how strongly), held to the
// same mark budget, and which one draws the scene better. They're made on the page (?scene=composed&judge) and exported
// as JSON into devtools/judgements/. A small model scores one group's treatment from the group's features; a drawing's
// score is the sum over its groups; each judged pair asks that the preferred drawing's sum be higher (logistic loss on
// the difference). The policy then gives each group its best-scoring treatment at the budget (client/splats/policy.ts).
//
// --synthetic: no judgements yet, so pairs labelled by a hidden utility (a stand-in teacher written here), to check the
// machinery: that the model recovers the hidden preferences on views it wasn't trained on, and that its policy beats the
// rules by that utility at the same budget. It says nothing about drawing quality: only real judgements can.
//
// Writes client/splats/policynet.ts (only from real judgements; --synthetic writes devtools/out/policy-synthetic.json).
import { build } from 'esbuild';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const SU = await load('../client/splats/subjects.ts'), P = await load('../client/splats/policy.ts');
const SYN = process.argv.includes('--synthetic');
let r = 99; const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);

// ─── the scene and its views ───
const sc = SU.composedScene('wash', true), groups = sc.infos();
const viewAt = (yaw, pitch, dist, detail) => {
  const T = SU.REF_CAM.target, eye = [T[0] + Math.sin(yaw) * Math.cos(pitch) * dist, T[1] + Math.sin(pitch) * dist, T[2] + Math.cos(yaw) * Math.cos(pitch) * dist];
  const f = T.map((v, i) => v - eye[i]), l = Math.hypot(...f);
  return { eye, fwd: f.map((v) => v / l), focalPx: 520 / (2 * Math.tan(25 * Math.PI / 180)), detail };
};
const featuresFor = (v) => { const comp = P.competitionOf(groups, v); return groups.map((g, i) => P.features(g, v, sc.proxies, comp[i], 0)); };

// ─── the hidden utility (synthetic only): a stand-in teacher ───
// (structure kept to a good length; tone as far as it faces the eye; lesser objects' detail penalised where it crowds;
// tiny detail penalised; contacts strong)
const NR = P.ROLES.length;
const hiddenU = (g, f, e, s) => {
  const facing = f[NR + 4], comp = f[NR + 6], size = f[NR + 3];
  let u = 0;
  if (g.structural) u += 1.5 * Math.min(e, 0.7) - 0.6 * Math.max(0, 0.5 - e) * 4;
  if (g.role === 'tone') u += 1.2 * e * (facing - 0.25);
  if (!g.structural) u += 0.5 * e * (g.emphasis - 0.6) - 0.8 * e * comp * (1 - g.emphasis) - 0.6 * e * Math.max(0, 0.3 - size) * 3;
  if (g.role === 'contact') u += 0.6 * (s - 1);
  u -= 0.3 * (s - 1) ** 2;
  return u;
};
const U = (F, t) => groups.reduce((a, g, i) => a + hiddenU(g, F[i], t.e[i], t.s[i]), 0);

// ─── the pairs ───
let pairs = [];
if (SYN) {
  for (let k = 0; k < 360; k++) {
    const v = viewAt(rnd() * Math.PI * 2, 0.1 + rnd() * 0.5, SU.REF_CAM.dist * (1.05 + rnd() * 0.5) * 1.5, [0.25, 0.55, 1][k % 3]);
    const F = featuresFor(v), budget = P.marksAtDetail(groups, v.detail), base = P.matchBudget(groups, P.rules(groups, F, v.detail), budget);
    const A = P.matchBudget(groups, P.jitter(groups, base, rnd), budget), B = rnd() < 0.5 ? base : P.matchBudget(groups, P.jitter(groups, base, rnd), budget);
    const d = U(F, A) - U(F, B);
    pairs.push({ F, A, B, choice: d > 0 ? 'A' : 'B', view: v, budget });
  }
} else {
  const dir = new URL('./judgements/', import.meta.url).pathname;
  if (!existsSync(dir)) { console.log('no judgements yet: make some at ?scene=composed&judge, export them into devtools/judgements/, or run --synthetic'); process.exit(0); }
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) for (const j of JSON.parse(readFileSync(dir + f, 'utf8'))) if (j.choice !== 'same' && j.F?.length === groups.length) pairs.push({ F: j.F, A: { e: j.A.e, s: j.A.s }, B: { e: j.B.e, s: j.B.s }, choice: j.choice, view: j.view, budget: j.budget });
  console.log(`${pairs.length} judged pairs (ties left out)`);
  if (pairs.length < 20) { console.log('too few to fit: judge at least 20 pairs'); process.exit(0); }
}
pairs = pairs.sort(() => rnd() - 0.5);
const nTest = Math.max(1, Math.round(pairs.length * 0.2)), test = pairs.slice(0, nTest), train = pairs.slice(nTest);

// ─── the model, fitted to the pairs ───
const IN = P.N_FEATURES + 4, H = 12;
const net = { inputs: IN, hidden: H, w1: Array.from({ length: H * IN }, () => (rnd() - 0.5) * 0.4), b1: Array(H).fill(0), w2: Array.from({ length: H * H }, () => (rnd() - 0.5) * 0.4), b2: Array(H).fill(0), w3: Array.from({ length: H }, () => (rnd() - 0.5) * 0.4), b3: 0 };
const keys = ['w1', 'b1', 'w2', 'b2', 'w3'], m1 = {}, m2 = {}; for (const k of keys) { m1[k] = net[k].map(() => 0); m2[k] = net[k].map(() => 0); }
// (one drawing's score and, if asked, its gradient times a factor added into G)
function drawingScore(F, t, G, factor) {
  let total = 0;
  for (let i = 0; i < groups.length; i++) {
    const x = P.treatmentInputs(F[i], t.e[i], t.s[i]), a1 = Array(H), h1 = Array(H), a2 = Array(H), h2 = Array(H);
    for (let j = 0; j < H; j++) { let a = net.b1[j]; for (let q = 0; q < IN; q++) a += net.w1[j * IN + q] * x[q]; a1[j] = a; h1[j] = Math.tanh(a); }
    for (let j = 0; j < H; j++) { let a = net.b2[j]; for (let q = 0; q < H; q++) a += net.w2[j * H + q] * h1[q]; a2[j] = a; h2[j] = Math.tanh(a); }
    let o = net.b3; for (let q = 0; q < H; q++) o += net.w3[q] * h2[q];
    total += o;
    if (!G) continue;
    const g2 = Array(H); for (let q = 0; q < H; q++) { G.w3[q] += factor * h2[q]; g2[q] = factor * net.w3[q] * (1 - h2[q] ** 2); }
    const g1 = Array(H).fill(0);
    for (let j = 0; j < H; j++) { G.b2[j] += g2[j]; for (let q = 0; q < H; q++) { G.w2[j * H + q] += g2[j] * h1[q]; g1[q] += g2[j] * net.w2[j * H + q]; } }
    for (let j = 0; j < H; j++) { const g = g1[j] * (1 - h1[j] ** 2); G.b1[j] += g; for (let q = 0; q < IN; q++) G.w1[j * IN + q] += g * x[q]; }
  }
  return total;
}
const agree = (set) => set.filter((p) => (drawingScore(p.F, p.A) > drawingScore(p.F, p.B)) === (p.choice === 'A')).length / set.length;
let step = 0;
const EPOCHS = SYN ? 40 : 60;
for (let ep = 0; ep < EPOCHS; ep++) {
  let loss = 0;
  for (const p of train.sort(() => rnd() - 0.5)) {
    const y = p.choice === 'A' ? 1 : -1, d = drawingScore(p.F, p.A) - drawingScore(p.F, p.B), z = y * d;
    loss += Math.log1p(Math.exp(-z));
    const coef = -y / (1 + Math.exp(z)), G = {}; for (const k of keys) G[k] = net[k].map(() => 0);
    drawingScore(p.F, p.A, G, coef); drawingScore(p.F, p.B, G, -coef);
    step++;
    for (const k of keys) for (let i = 0; i < net[k].length; i++) { const g = G[k][i] + 1e-4 * net[k][i]; m1[k][i] = 0.9 * m1[k][i] + 0.1 * g; m2[k][i] = 0.999 * m2[k][i] + 0.001 * g * g; net[k][i] -= (0.003 * (m1[k][i] / (1 - 0.9 ** step))) / (Math.sqrt(m2[k][i] / (1 - 0.999 ** step)) + 1e-8); }
  }
  if (ep % 10 === 9) console.log(`epoch ${ep + 1}: loss ${(loss / train.length).toFixed(4)}, agreement train ${(agree(train) * 100).toFixed(0)}%, held out ${(agree(test) * 100).toFixed(0)}%`);
}
const agreement = agree(test);
const out = { ...net, trainedOn: train.length, agreement: +agreement.toFixed(3) };

if (SYN) {
  // (on fresh views: the learned policy against the rules, by the hidden utility, at the same budget)
  let better = 0, n = 0, gain = 0;
  for (let k = 0; k < 30; k++) {
    const v = viewAt(rnd() * Math.PI * 2, 0.1 + rnd() * 0.5, SU.REF_CAM.dist * (1.05 + rnd() * 0.5) * 1.5, [0.25, 0.55][k % 2]), F = featuresFor(v), budget = P.marksAtDetail(groups, v.detail);
    const ru = P.matchBudget(groups, P.rules(groups, F, v.detail), budget), le = P.learned(out, groups, F, budget);
    const du = U(F, le) - U(F, ru); gain += du; if (du > 0) better++; n++;
  }
  const res = { heldOutAgreement: agreement, learnedBeatsRules: `${better} of ${n} fresh views`, meanGain: +(gain / n).toFixed(3), pairs: pairs.length };
  writeFileSync(new URL('./out/policy-synthetic.json', import.meta.url).pathname, JSON.stringify(res, null, 1));
  console.log('synthetic check:', res);
} else {
  writeFileSync(new URL('../client/splats/policynet.ts', import.meta.url).pathname, `/** The composed scene's learned drawing policy (devtools/splats-policy-train.mjs, from ${train.length} judged pairs; held-out agreement ${(agreement * 100).toFixed(0)}%). */\nimport type { PolicyNet } from './policy';\nexport const POLICY: PolicyNet | null = ${JSON.stringify({ ...out, w1: out.w1.map((v) => +v.toFixed(5)), w2: out.w2.map((v) => +v.toFixed(5)), w3: out.w3.map((v) => +v.toFixed(5)), b1: out.b1.map((v) => +v.toFixed(5)), b2: out.b2.map((v) => +v.toFixed(5)), b3: +out.b3.toFixed(5) })};\n`);
  console.log('wrote client/splats/policynet.ts');
}
