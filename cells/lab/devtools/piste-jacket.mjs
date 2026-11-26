// Piste's jacket, fitted as a tailor fits one (node cells/lab/devtools/piste-jacket.mjs [rounds]): drafted flat from the
// athlete's measurements (client/piste/look/draft.ts), sewn round the body in guard and let settle (look/settle.ts),
// measured, altered, and again. Each round reports, per quarter and sleeve and up the body: how stretched the cloth is
// across and along (above 2 % it's tight), how far it stands off the body (the ease), and how far apart the seams still
// are; then the alterations it makes (let out where tight, take in where loose, lengthen a sleeve that's pulled). Writes
// the final pattern to client/piste/look/jacket-pattern.json and pictures to devtools/out/jacket.png.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/draft'; export * from './look/settle'; export * from './fencer'; export * from './weapons';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const ROUNDS = Number(process.argv[2] ?? 4);

// the body, in guard
const f = new M.Fencer(M.EPEE, 0, 1); f.pose();
const c = f.capsules, F = f.frame;
const B = {
  caps: c.filter((_, i) => i !== 2 && i !== 6), trunk: [c[0], c[1], c[3], c[15], c[16]],
  bodyCaps: [c[0], c[1], c[3], c[15], c[16], c[9], c[11]], sleeveCaps: c.filter((_, i) => i !== 2 && i !== 6), pelvis: c[0].a, f: F.f, r: F.r, up: [0, 1, 0],
  shoulder: f.shoulder, rearShoulder: c[7].a, armW: [f.shoulder, f.elbow, f.hand.map((v, k) => v + (f.elbow[k] - f.hand[k]) * 0.3)], armR: [c[7].a, c[7].b, c[8].b],
};
const P = M.draftJacket(B);
if (process.env.OVERSIZE) { const k = Number(process.env.OVERSIZE); for (const qq of M.QUARTERS) P.widths[qq] = P.widths[qq].map((w) => w * k); for (const sd of ['W', 'R']) { P.sleeves[sd].round = P.sleeves[sd].round.map((x) => x * k); P.sleeves[sd].length *= 1.05; } for (const qq of M.QUARTERS) P.lengths[qq] += 0.08; P.shoulderW *= 1.1; }
console.log('measured girths (cm), hem to shoulder:', P.stations.map((h) => (M.slice(B, B.pelvis[1] - 0.1 + h).girth * 100).toFixed(0)).join(' '));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pct = (x) => `${(x * 100).toFixed(1)}%`, cm = (x) => `${(x * 100).toFixed(1)}`;
const EASE = { body: [0.008, 0.03], sleeve: [0.01, 0.035] };

// (the loop kept honest: each alteration damped, no number further than 25 % from the draft, and a round that makes the
// fit worse undone, the damping halved)
const DRAFT = structuredClone(P);
let G, S, damp = 0.6, best = { score: Infinity, P: structuredClone(P), G: null, S: null };
const limit = () => {
  for (const qq of M.QUARTERS) P.widths[qq] = P.widths[qq].map((w, k) => Math.max(DRAFT.widths[qq][k] * 0.75, Math.min(DRAFT.widths[qq][k] * 1.25, w)));
  for (const qq of M.QUARTERS) P.lengths[qq] = Math.min(DRAFT.lengths[qq] * 1.2, P.lengths[qq]);
  for (const sd of ['W', 'R']) { P.sleeves[sd].round = P.sleeves[sd].round.map((x, k) => Math.max(DRAFT.sleeves[sd].round[k] * 0.75, Math.min(DRAFT.sleeves[sd].round[k] * 1.25, x))); P.sleeves[sd].length = Math.min(DRAFT.sleeves[sd].length * 1.1, P.sleeves[sd].length); }
  P.shoulderW = Math.min(DRAFT.shoulderW * 1.25, P.shoulderW);
};
for (let round = 1; round <= ROUNDS; round++) {
  const t0 = Date.now();
  G = M.meshJacket(P, B);
  S = M.settle(G, B.bodyCaps, { seconds: 5, sleeveCaps: B.sleeveCaps });
  const X = (i) => [S.x[i * 3], S.x[i * 3 + 1], S.x[i * 3 + 2]];
  const strain = S.edges.map((e) => Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])) / e.rest - 1);
  const isSl = (i) => G.pieces.some((pc) => pc.kind === 'sleeve' && i >= pc.base && i < pc.base + pc.rows * pc.cols);
  const off = Array.from({ length: G.n }, (_, i) => M.clearance(X(i), isSl(i) ? B.sleeveCaps : B.bodyCaps));
  const gaps = G.stitches.map((s) => Math.hypot(...[0, 1, 2].map((k) => S.x[s.p * 3 + k] - (S.x[s.q * 3 + k] * (1 - s.t) + S.x[s.q2 * 3 + k] * s.t))));
  const score = q(strain.filter((_, k) => S.edges[k].dir === 'across' || S.edges[k].dir === 'along'), 0.9) + 0.5 * q(gaps, 0.9);
  if (score > best.score) {
    console.log(`\n── round ${round}: worse (${pct(score)} against ${pct(best.score)}); undone, alterations halved`);
    Object.assign(P, structuredClone(best.P)); damp *= 0.5; G = best.G; S = best.S;
    if (damp < 0.1) break; continue;
  }
  best = { score, P: structuredClone(P), G, S };
  console.log(`\n── round ${round}` (${((Date.now() - t0) / 1000).toFixed(1)} s) ──  stretch p50 ${pct(q(strain, 0.5))} p90 ${pct(q(strain, 0.9))} p99 ${pct(q(strain, 0.99))} · seams: worst gap ${cm(Math.max(...gaps))} cm, p90 ${cm(q(gaps, 0.9))} · inside the body: ${off.filter((d) => d < -0.002).length} points`);
  // by piece and band: across and along stretch, and the ease
  const moves = [], upper = [];
  G.pieces.forEach((pc, pi) => {
    const bands = pc.kind === 'body' ? P.stations.length : P.sleeves[pc.side].stations.length;
    const rows = [];
    for (let b = 0; b < bands; b++) {
      const frac = pc.kind === 'body' ? P.stations[b] / P.length : P.sleeves[pc.side].stations[b];
      const r0 = Math.round(frac * (pc.rows - 1)), near = (r) => Math.abs(r - r0) <= 2;
      const rowOf = (i) => Math.floor((i - pc.base) / pc.cols);
      const sAcross = [], sAlong = [], ease = [];
      S.edges.forEach((e, k) => { if (e.piece !== pi || !near(rowOf(e.a))) return; if (e.dir === 'across') sAcross.push(strain[k]); if (e.dir === 'along') sAlong.push(strain[k]); });
      for (let i = pc.base; i < pc.base + pc.rows * pc.cols; i++) if (near(rowOf(i))) ease.push(off[i]);
      const across = q(sAcross, 0.75), along = q(sAlong, 0.75), e50 = q(ease, 0.5);
      rows.push(`${(frac * 100).toFixed(0).padStart(3)}%  across ${pct(across).padStart(6)}  along ${pct(along).padStart(6)}  ease ${cm(e50).padStart(5)} cm`);
      // the alterations
      const [lo, hi] = EASE[pc.kind];
      if (pc.kind === 'body') {
        const W = P.widths[pc.quarter];
        if (frac > 0.85 && along > 0.02) { const k = Math.min(0.15, along * 0.8) * damp; P.lengths[pc.quarter] += (P.lengths[pc.quarter] - P.armhole) * k; moves.push(`${pc.quarter} lengthened over the shoulder to ${cm(P.lengths[pc.quarter])} cm (pulled ${pct(along)})`); }
        // (above the underarm, tight across: the armhole scooped too far in; widen the shoulder toward its point)
        if (frac * P.length > P.armhole + 0.02) { if (across > 0.02 && frac < 0.95) upper.push(across); continue; }
        if (across > 0.02) { const k = Math.min(0.12, across * 0.9) * damp; W[b] *= 1 + k; moves.push(`${pc.quarter} let out ${cm(W[b] * k / (1 + k))} cm at ${(frac * 100).toFixed(0)}% (tight ${pct(across)})`); }
        else if (e50 > hi && across < 0.005) { const d = Math.min(0.02, (e50 - (lo + hi) / 2) * (Math.PI / 2)) * damp; W[b] -= d; moves.push(`${pc.quarter} taken in ${cm(d)} cm at ${(frac * 100).toFixed(0)}% (ease ${cm(e50)} cm)`); }
      } else {
        const Sv = P.sleeves[pc.side];
        if (b === 0) continue;   // (the cap's round is the armhole's)
        if (across > 0.02) { const k = Math.min(0.12, across * 0.9) * damp; Sv.round[b] *= 1 + k; moves.push(`sleeve ${pc.side} let out ${cm(Sv.round[b] * k / (1 + k))} cm round at ${(frac * 100).toFixed(0)}%`); }
        else if (e50 > hi && across < 0.005) { const d = Math.min(0.03, (e50 - (lo + hi) / 2) * Math.PI * 2) * damp; Sv.round[b] -= d; moves.push(`sleeve ${pc.side} taken in ${cm(d)} cm round at ${(frac * 100).toFixed(0)}% (ease ${cm(e50)} cm)`); }
      }
    }
    if (pc.kind === 'sleeve') {
      const along = q(S.edges.map((e, k) => (e.piece === pi && e.dir === 'along' ? strain[k] : null)).filter((v) => v !== null), 0.75);
      if (along > 0.02) { P.sleeves[pc.side].length *= 1 + Math.min(0.08, along) * damp; moves.push(`sleeve ${pc.side} lengthened to ${cm(P.sleeves[pc.side].length)} cm (pulled ${pct(along)})`); }
    }
    console.log(`  ${pc.name}`); for (const r of rows) console.log(`    ${r}`);
  });
  if (upper.length) { const k = Math.min(0.1, Math.max(...upper) * 0.5) * damp; P.shoulderW *= 1 + k; moves.push(`shoulder widened to ${cm(P.shoulderW)} cm from the centre (tight across the upper chest and back, ${pct(Math.max(...upper))})`); }
  if (!moves.length) { console.log('  fits: nothing to alter'); break; }
  limit();
  if (round < ROUNDS) { console.log('  alterations:'); for (const m of moves) console.log(`    ${m}`); P.moves.push(...moves.map((m) => `round ${round}: ${m}`)); }
}

// the pattern, and pictures: the settled jacket from in front and the weapon side, coloured by stretch (red tight,
// blue slack), and the pattern's pieces flat
Object.assign(P, best.P); G = best.G; S = best.S;
console.log(`\nbest: ${pct(best.score)} (stretch p90 and half the seams' p90 gap)`);
writeFileSync(new URL('../client/piste/look/jacket-pattern.json', import.meta.url), JSON.stringify(P, null, 1));
const strain = S.edges.map((e) => Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])) / e.rest - 1);
const pointStrain = new Float64Array(G.n); S.edges.forEach((e, k) => { if (e.dir === 'across' || e.dir === 'along') { pointStrain[e.a] = Math.max(pointStrain[e.a], strain[k]); pointStrain[e.b] = Math.max(pointStrain[e.b], strain[k]); } });
const tris = [];
G.pieces.forEach((pc) => { for (let r = 0; r < pc.rows - 1; r++) for (let cc = 0; cc < pc.cols - 1; cc++) { const a = pc.base + r * pc.cols + cc; tris.push([a, a + 1, a + pc.cols + 1], [a, a + pc.cols + 1, a + pc.cols]); } });
const view = (fwd, right, ox, label) => {
  const up = [0, 1, 0], sc = 520, pts = Array.from({ length: G.n }, (_, i) => { const p = [S.x[i * 3] - B.pelvis[0], S.x[i * 3 + 1] - B.pelvis[1], S.x[i * 3 + 2] - B.pelvis[2]]; return [p[0] * right[0] + p[2] * right[2], p[1], p[0] * fwd[0] + p[2] * fwd[2]]; });
  const order = tris.map((t) => [t, (pts[t[0]][2] + pts[t[1]][2] + pts[t[2]][2]) / 3]).sort((a, b) => a[1] - b[1]);
  let g = `<text x="${ox + 10}" y="20" font-size="13">${label}</text>`;
  for (const [t] of order) {
    const [A, Bq, C] = t.map((i) => pts[i]), nz = (Bq[0] - A[0]) * (C[1] - A[1]) - (Bq[1] - A[1]) * (C[0] - A[0]);
    const s = (pointStrain[t[0]] + pointStrain[t[1]] + pointStrain[t[2]]) / 3, shade = 0.55 + 0.4 * Math.min(1, Math.abs(nz) * 400);
    const rC = s > 0.02 ? Math.min(255, 200 + s * 1500) : 200, bC = s < -0.01 ? Math.min(255, 200 - s * 1500) : 200;
    const col = `rgb(${Math.round(rC * shade)},${Math.round(200 * shade)},${Math.round(bC * shade)})`;
    g += `<polygon points="${t.map((i) => `${(ox + 230 + pts[i][0] * sc).toFixed(1)},${(470 - pts[i][1] * sc).toFixed(1)}`).join(' ')}" fill="${col}" stroke="${col}" stroke-width="0.4"/>`;
  }
  return g;
};
const neg = (v) => v.map((x) => -x);
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1380" height="620" font-family="sans-serif"><rect width="100%" height="100%" fill="#f7f6f2"/>`;
svg += view(B.r, B.f, 0, 'from in front (the chest)') + view(neg(B.f), B.r, 460, 'from the weapon side');
// the pieces flat
let ox = 940, oy = 40;
svg += `<text x="${ox}" y="20" font-size="13">the pattern</text>`;
for (const pc of G.pieces) {
  const xs = pc.flat.map((p) => p[0]), ys = pc.flat.map((p) => p[1]), w = Math.max(...xs) * 250, hgt = Math.max(...ys) * 250;
  const outline = [...Array(pc.rows).keys()].map((r) => pc.flat[r * pc.cols]).concat([...Array(pc.cols).keys()].map((cc) => pc.flat[(pc.rows - 1) * pc.cols + cc]), [...Array(pc.rows).keys()].reverse().map((r) => pc.flat[r * pc.cols + pc.cols - 1]), [...Array(pc.cols).keys()].reverse().map((cc) => pc.flat[cc]));
  if (ox + w > 1370) { ox = 940; oy += 200; }
  svg += `<polygon points="${outline.map((p) => `${(ox + p[0] * 250).toFixed(1)},${(oy + 180 - p[1] * 250).toFixed(1)}`).join(' ')}" fill="#efe6d2" stroke="#6b5a3a"/><text x="${ox}" y="${oy + 195}" font-size="10">${pc.name}</text>`;
  ox += w + 14;
}
svg += '</svg>';
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const path = new URL('./out/jacket.svg', import.meta.url).pathname;
writeFileSync(path, svg);
const { chromium } = await import('playwright');
const br = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }), pg = await br.newPage({ viewport: { width: 1380, height: 620 } });
await pg.setContent(svg); await pg.screenshot({ path: path.replace(/svg$/, 'png') }); await br.close();
console.log('\n' + path.replace(/svg$/, 'png'));
