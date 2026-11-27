// Piste's jacket, fitted as a tailor fits one (node cells/lab/devtools/piste-jacket.mjs [rounds]): drafted flat from the
// athlete's measurements (client/piste/look/draft.ts), sewn round the body in guard and let settle (look/settle.ts),
// measured, altered, and again. Each round reports, per quarter and sleeve and up the body: how stretched the cloth is
// across and along (above 2 % it's tight), how far it stands off the body (the ease), and how far apart the seams still
// are; then the alterations it makes (let out where tight, take in where loose, lengthen a sleeve that's pulled). Writes
// the final pattern to client/piste/look/jacket-pattern.json and pictures to devtools/out/jacket.png.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/draft'; export * from './look/settle'; export * from './look/body'; export * from './fencer'; export * from './weapons';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
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
// (fitted on the undressed body (look/body.ts), its distance sampled once over a box round it; CAPSULES=1: on the
// capsules, as before)
let field = null, fieldTrunk = null;
if (!process.env.CAPSULES) {
  const t0 = Date.now(), bare = M.bareBody(f), lo = [F.o[0] - 0.6, 0.4, -0.6], hi = [F.o[0] + 0.6, 1.75, 0.6];
  const trunkOnly = { parts: bare.parts.filter((p) => p.name === 'trunk' || p.name.startsWith('thigh')) };
  // (the box only as big as the jacket can reach: hips to above the shoulders, out past the hands)
  field = M.bodyField(bare, lo, hi, 0.012); fieldTrunk = M.bodyField(trunkOnly, [F.o[0] - 0.4, 0.45, -0.4], [F.o[0] + 0.4, 1.7, 0.4], 0.012);
  B.dist = (p) => fieldTrunk.at(p).d; B.distAll = (p) => field.at(p).d;
  console.log(`the body's distance field: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const P = M.draftJacket(B);
if (process.env.OVERSIZE) { const k = Number(process.env.OVERSIZE); for (const qq of M.QUARTERS) P.widths[qq] = P.widths[qq].map((w) => w * k); for (const sd of ['W', 'R']) { P.sleeves[sd].round = P.sleeves[sd].round.map((x) => x * k); P.sleeves[sd].length *= 1.05; } for (const qq of M.QUARTERS) P.lengths[qq] += 0.08; P.shoulderW *= 1.1; }
console.log('measured girths (cm), hem to shoulder:', P.stations.map((h) => (M.slice(B, B.pelvis[1] - 0.1 + h).girth * 100).toFixed(0)).join(' '));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const pct = (x) => `${(x * 100).toFixed(1)}%`, cm = (x) => `${(x * 100).toFixed(1)}`;
const EASE = { body: [0.008, 0.03], sleeve: [0.01, 0.035] };

// (the loop kept honest: each alteration damped, no number further than 25 % from the draft, and a round that makes the
// fit worse undone, the damping halved)
const DRAFT = structuredClone(P);
const PER_ROUND = 3, tried = new Set();
let lastKeys = [];
let G, S, damp = 0.6, best = { score: Infinity, P: structuredClone(P), G: null, S: null };
const limit = () => {
  for (const qq of M.QUARTERS) P.widths[qq] = P.widths[qq].map((w, k) => Math.max(DRAFT.widths[qq][k] * 0.75, Math.min(DRAFT.widths[qq][k] * 1.25, w)));
  for (const qq of M.QUARTERS) P.lengths[qq] = Math.min(DRAFT.lengths[qq] * 1.2, P.lengths[qq]);
  for (const sd of ['W', 'R']) { P.sleeves[sd].round = P.sleeves[sd].round.map((x, k) => Math.max(DRAFT.sleeves[sd].round[k] * 0.75, Math.min(DRAFT.sleeves[sd].round[k] * 1.25, x))); P.sleeves[sd].length = Math.min(DRAFT.sleeves[sd].length * 1.1, P.sleeves[sd].length); }
  for (const sd of ['W', 'R']) P.sleeves[sd].bend = Math.min(0.24, P.sleeves[sd].bend ?? 0);
};
for (let round = 1; round <= ROUNDS; round++) {
  const t0 = Date.now();
  G = M.meshJacket(P, B);
  // (long enough to finish: shorter, the solver's unfinished business reads as tightness)
  S = M.settle(G, B.bodyCaps, { seconds: 8, sleeveCaps: B.sleeveCaps, passes: 16, body: field ?? undefined, trunkBody: fieldTrunk ?? undefined });
  const X = (i) => [S.x[i * 3], S.x[i * 3 + 1], S.x[i * 3 + 2]];
  const strain = S.edges.map((e) => Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])) / e.rest - 1);
  const isSl = (i) => G.pieces.some((pc) => pc.kind !== 'body' && i >= pc.base && i < pc.base + pc.rows * pc.cols);
  const off = Array.from({ length: G.n }, (_, i) => field ? (isSl(i) ? field : fieldTrunk).at(X(i)).d : M.clearance(X(i), isSl(i) ? B.sleeveCaps : B.bodyCaps));
  const gaps = G.stitches.map((s) => Math.hypot(...[0, 1, 2].map((k) => S.x[s.p * 3 + k] - (S.x[s.q * 3 + k] * (1 - s.t) + S.x[s.q2 * 3 + k] * s.t))));
  // (the score: stretch, seams, and a hem riding up (a jacket that rides up doesn't fit), each in comparable terms)
  const hemRise = G.pieces.filter((pc) => pc.kind === 'body').map((pc) => Array.from({ length: pc.cols }, (_, cc) => S.x[(pc.base + cc) * 3 + 1] - G.at[pc.base + cc][1]).reduce((a2, b2) => a2 + b2) / pc.cols);
  const score = q(strain.filter((_, k) => S.edges[k].dir === 'across' || S.edges[k].dir === 'along'), 0.9) + 0.5 * q(gaps, 0.9) + 0.3 * Math.max(0, ...hemRise);
  if (score > best.score) {
    console.log(`\n── round ${round}: worse (${pct(score)} against ${pct(best.score)}: stretch p90 ${pct(q(strain, 0.9))}, seams p90 ${cm(q(gaps, 0.9))} cm, worst ${cm(Math.max(...gaps))} cm); undone, alterations halved`);
    // (undone: those alterations aren't tried again; the next worst are)
    Object.assign(P, structuredClone(best.P)); G = best.G; S = best.S;
    for (const k2 of lastKeys) tried.add(k2);
    console.log(`  not again: ${lastKeys.join(', ')}`);
    continue;
  }
  best = { score, P: structuredClone(P), G, S };
  console.log(`\n── round ${round} (${((Date.now() - t0) / 1000).toFixed(1)} s) ──  stretch p50 ${pct(q(strain, 0.5))} p90 ${pct(q(strain, 0.9))} p99 ${pct(q(strain, 0.99))} · seams: worst gap ${cm(Math.max(...gaps))} cm, p90 ${cm(q(gaps, 0.9))} · inside the body: ${off.filter((d) => d < -0.002).length} points`);
  // by piece and band: across and along stretch, and the ease
  const moves = [], upper = [], candidates = [];
  const propose = (sev, family, key, apply) => candidates.push({ sev, family, key, apply });
  G.pieces.forEach((pc, pi) => {
    if (pc.kind === 'gusset' || pc.kind === 'collar') return;   // (cut to its edges: nothing of its own to alter)
    const bands = pc.kind === 'body' ? P.stations.length : P.sleeves[pc.side].stations.length;
    const rows = [];
    for (let b = 0; b < bands; b++) {
      const frac = pc.kind === 'body' ? P.stations[b] / P.length : P.sleeves[pc.side].stations[b];
      const r0 = Math.round(pc.kind === 'body' ? M.rowAt(P, frac * P.length) : frac * (pc.rows - 1)), near = (r) => Math.abs(r - r0) <= 2;
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
        if (frac > 0.85 && along > 0.02) { const qn = pc.quarter; propose(along, `${qn} length`, `${qn} top`, () => { const k = Math.min(0.15, along * 0.8) * damp; P.lengths[qn] += (P.lengths[qn] - P.armhole) * k; return `${qn} lengthened over the shoulder to ${cm(P.lengths[qn])} cm (pulled ${pct(along)})`; }); }
        // (above the underarm, tight across: the armhole scooped too far in; widen the shoulder toward its point)
        if (frac * P.length > P.armhole + 0.02) { if (across > 0.02 && frac < 0.95) upper.push(across); continue; }
        const qn = pc.quarter, bb = b, at2 = `${(frac * 100).toFixed(0)}%`;
        if (across > 0.02) propose(across, `${qn} width`, `${qn} width ${bb}`, () => { const k = Math.min(0.12, across * 0.9) * damp; W[bb] *= 1 + k; return `${qn} let out ${cm(W[bb] * k / (1 + k))} cm at ${at2} (tight ${pct(across)})`; });
        else if (e50 > hi && across < 0.005) propose((e50 - hi) * 0.3, `${qn} width`, `${qn} width ${bb}`, () => { const d = Math.min(0.02, (e50 - (lo + hi) / 2) * (Math.PI / 2)) * damp; W[bb] -= d; return `${qn} taken in ${cm(d)} cm at ${at2} (ease ${cm(e50)} cm)`; });
      } else {
        const Sv = P.sleeves[pc.side];
        if (b === 0) continue;   // (the cap's round is the armhole's: a tight one is a small armhole)
        const sd = pc.side, bb = b, at2 = `${(frac * 100).toFixed(0)}%`;
        if (across > 0.02) propose(across, `sleeve ${sd} round`, `sleeve ${sd} round ${bb}`, () => { const k = Math.min(0.12, across * 0.9) * damp; Sv.round[bb] *= 1 + k; return `sleeve ${sd} let out ${cm(Sv.round[bb] * k / (1 + k))} cm round at ${at2} (tight ${pct(across)})`; });
        else if (e50 > hi && across < 0.005) propose((e50 - hi) * 0.3, `sleeve ${sd} round`, `sleeve ${sd} round ${bb}`, () => { const d = Math.min(0.03, (e50 - (lo + hi) / 2) * Math.PI * 2) * damp; Sv.round[bb] -= d; return `sleeve ${sd} taken in ${cm(d)} cm round at ${at2} (ease ${cm(e50)} cm)`; });
      }
    }
    if (pc.kind === 'sleeve') {
      // (pulled along its outside, from the shoulder to below the elbow: cut it bent, more length there)
      const colOf = (i) => (i - pc.base) % pc.cols, rowOf2 = (i) => Math.floor((i - pc.base) / pc.cols);
      const outer = S.edges.map((e, k) => (e.piece === pi && e.dir === 'along' && Math.abs(colOf(e.a) - (pc.cols - 1) / 2) < pc.cols / 4 && rowOf2(e.a) < pc.rows * 0.75 ? strain[k] : null)).filter((v) => v !== null);
      const along = q(outer, 0.75), Sv = P.sleeves[pc.side];
      // (pulled along all round, from the elbow to the cuff: the sleeve's too short for the arm it's on; lengthen it)
      const lower = S.edges.map((e, k) => (e.piece === pi && e.dir === 'along' && rowOf2(e.a) >= pc.rows * 0.5 ? strain[k] : null)).filter((v) => v !== null), pulled = q(lower, 0.5);
      if (pulled > 0.03) { const sd = pc.side; propose(pulled, `sleeve ${sd} length`, `sleeve ${sd} length`, () => { const add = Math.min(0.03, pulled * Sv.length * 0.25) * damp; Sv.length += add; return `sleeve ${sd} lengthened ${cm(add)} cm to ${cm(Sv.length)} cm (pulled ${pct(pulled)} below the elbow)`; }); }
      if (along > 0.02) { const sd = pc.side; propose(along, `sleeve ${sd} bend`, `sleeve ${sd} bend`, () => { const add = Math.min(0.04, along * Sv.length * 0.6) * damp; Sv.bend = (Sv.bend ?? 0) + add; return `sleeve ${sd} cut more bent: ${cm(Sv.bend)} cm more along its outside (pulled ${pct(along)})`; }); }
    }
    if (pc.kind === 'body' && pc.quarter[1] === 'W' && pc.quarter[0] === 'F') {
      // (both weapon-side quarters pulled up at the underarm (their outer columns, round the armhole's foot): deepen it)
      const near = (pi2) => { const p2 = G.pieces[pi2], armRow = M.ARM_ROW; return S.edges.map((e, k) => (e.piece === pi2 && e.dir === 'along' && (e.a - p2.base) % p2.cols >= p2.cols - 3 && Math.abs(Math.floor((e.a - p2.base) / p2.cols) - armRow) <= 3 ? strain[k] : null)).filter((v) => v !== null); };
      const both = [...near(pi), ...near(G.pieces.findIndex((p2) => p2.quarter === 'BW'))], pull = q(both, 0.75);
      if (pull > 0.03 && P.armhole > DRAFT.armhole - 0.07) propose(pull, 'armhole', 'armhole', () => { const d = Math.min(0.02, pull * 0.2) * damp; P.armhole -= d; return `armhole deepened ${cm(d)} cm (the side pulled up at the underarm, ${pct(pull)})`; });
    }
    // (a hem that's ridden up: the quarter hangs from the shoulder too short to reach it; more length over the shoulder)
    let rise = NaN;
    if (pc.kind === 'body') {
      rise = Array.from({ length: pc.cols }, (_, cc) => S.x[(pc.base + cc) * 3 + 1] - G.at[pc.base + cc][1]).reduce((a, b) => a + b) / pc.cols;
      if (rise > 0.03) { const qn = pc.quarter, r2 = rise; propose(rise * 0.5, `${qn} length`, `${qn} hem`, () => { P.lengths[qn] += r2 * damp; return `${qn} lengthened ${cm(r2 * damp)} cm (its hem rode up ${cm(r2)} cm)`; }); }
    }
    console.log(`  ${pc.name}${Number.isNaN(rise) ? '' : `  (hem ${rise > 0 ? 'up' : 'down'} ${cm(Math.abs(rise))} cm)`}`); for (const r of rows) console.log(`    ${r}`);
  });
  // the worst few, one to each part of the garment, not one tried and undone before
  const chosen = [], families = new Set();
  for (const cnd of candidates.sort((a2, b2) => b2.sev - a2.sev)) { if (chosen.length >= PER_ROUND) break; if (families.has(cnd.family) || tried.has(cnd.key)) continue; families.add(cnd.family); chosen.push(cnd); }
  if (!chosen.length) { console.log('  fits: nothing more to alter'); break; }
  for (const cnd of chosen) moves.push(cnd.apply());
  lastKeys = chosen.map((cnd) => cnd.key);
  limit();
  if (round < ROUNDS) { console.log(`  alterations (the worst ${chosen.length} of ${candidates.length}):`); for (const m of moves) console.log(`    ${m}`); P.moves.push(...moves.map((m) => `round ${round}: ${m}`)); }
}

// the pattern, and pictures: the settled jacket from in front and the weapon side, coloured by stretch (red tight,
// blue slack), and the pattern's pieces flat
Object.assign(P, best.P); G = best.G; S = best.S;
console.log(`\nbest: ${pct(best.score)} (stretch p90 and half the seams' p90 gap)`);
writeFileSync(new URL('../client/piste/look/jacket-pattern.json', import.meta.url), JSON.stringify(P, null, 1));
// the settled jacket, for the game to dress the fencers in (the default; `?jacket=loft` for the old one): its points in the fencer's frame (this one
// stands at the origin facing +x, so its frame is the world's), its triangles, its weave's coordinates (the paper), and
// each point's distance on the paper to its piece's edge (where the seams are)
{
  const r3 = (v) => Math.round(v * 1000) / 1000, tris = [], uv = [], seam = [];
  // (each piece's triangles wound to face out, away from the body: the quarters are mirror images on the paper, so the
  // same order on every grid turns two of them inside out. Each piece votes, triangle by triangle, on which way its
  // normal points against the nearest axis of the body under it)
  const Xs = (i) => [S.x[i * 3], S.x[i * 3 + 1], S.x[i * 3 + 2]];
  const axisNear = (p, caps) => { let best = null, bd = Infinity; for (const c of caps) { const ab = c.b.map((v, k) => v - c.a[k]), t = Math.max(0, Math.min(1, ab.reduce((s2, v, k) => s2 + v * (p[k] - c.a[k]), 0) / Math.max(1e-12, ab.reduce((s2, v) => s2 + v * v, 0)))), q2 = c.a.map((v, k) => v + ab[k] * t), d = Math.hypot(...p.map((v, k) => v - q2[k])) - (c.ra + (c.rb - c.ra) * t); if (d < bd) { bd = d; best = q2; } } return best; };
  const flipped = [];
  G.pieces.forEach((pc) => {
    let vote = 0;
    for (let r = 0; r < pc.rows - 1; r++) for (let cc = 0; cc < pc.cols - 1; cc++) {
      const a = pc.base + r * pc.cols + cc, A = Xs(a), Bp = Xs(a + 1), C = Xs(a + pc.cols + 1), u = Bp.map((v, k) => v - A[k]), w = C.map((v, k) => v - A[k]);
      const nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], mid = A.map((v, k) => (v + Bp[k] + C[k]) / 3), ax = axisNear(mid, pc.kind !== 'body' ? B.sleeveCaps : B.bodyCaps);
      vote += Math.sign(nrm.reduce((s2, v, k) => s2 + v * (mid[k] - ax[k]), 0));
    }
    const out = vote >= 0; if (!out) flipped.push(pc.name);
    for (let r = 0; r < pc.rows - 1; r++) for (let cc = 0; cc < pc.cols - 1; cc++) { const a = pc.base + r * pc.cols + cc; if (out) tris.push(a, a + 1, a + pc.cols + 1, a, a + pc.cols + 1, a + pc.cols); else tris.push(a, a + pc.cols + 1, a + 1, a, a + pc.cols, a + pc.cols + 1); }
    for (let r = 0; r < pc.rows; r++) for (let cc = 0; cc < pc.cols; cc++) {
      const i = pc.base + r * pc.cols + cc, p = G.flat[i]; uv.push(r3(Math.abs(p[0])), r3(p[1]));
      const ed = (j) => Math.hypot(p[0] - G.flat[j][0], p[1] - G.flat[j][1]);
      seam.push(r3(Math.min(ed(pc.base + r * pc.cols), ed(pc.base + r * pc.cols + pc.cols - 1), ed(pc.base + cc), ed(pc.base + (pc.rows - 1) * pc.cols + cc))));
    }
  });
  // (and to simulate it: its pieces (grids on their paper), each point's place on the paper, what's sewn to what)
  const pieces = G.pieces.map((pc) => ({ name: pc.name, kind: pc.kind !== 'sleeve' ? 'jacket' : pc.side === 'W' ? 'sleeveW' : 'sleeveR', base: pc.base, rows: pc.rows, cols: pc.cols }));
  const flat = G.flat.flatMap((p) => [r3(p[0]), r3(p[1])]);
  const seams = G.stitches.map((st) => [st.p, st.t < 0.5 ? st.q : st.q2]);
  // (welded: each point sewn to another piece follows the points it's sewn between, and they follow none themselves.
  // A point sewn to one that's sewn on again (where three pieces meet) follows that one's own leaders; at most two)
  const sewnTo = new Map(); for (const st of G.stitches) if (!sewnTo.has(st.p)) sewnTo.set(st.p, st);
  const roots = (i, depth = 0) => {
    const st = sewnTo.get(i); if (!st || depth > 8) return new Map([[i, 1]]);
    const m = new Map(); for (const [j, w] of [[st.q, 1 - st.t], [st.q2, st.t]]) if (w > 0) for (const [k, v] of roots(j, depth + 1)) if (k !== i) m.set(k, (m.get(k) ?? 0) + v * w);
    return m.size ? m : new Map([[i, 1]]);
  };
  const stitches = [];
  for (const p of sewnTo.keys()) {
    const top = [...roots(p)].sort((a, b) => b[1] - a[1]).slice(0, 2); if (top[0][0] === p) continue;
    const [qa, wa] = top[0], [qb, wb] = top[1] ?? [qa, 0];
    stitches.push([p, qa, qb, Math.round((wb / (wa + wb)) * 1000) / 1000]);
  }
  console.log('turned right way out:', flipped.join(', ') || 'none');
  // Export the same closed seams that the live cloth shader draws. This also
  // gives the posed fallback and the solver's initial anchors a sewn bind pose.
  const sewnX = S.x.slice();
  for (const [p, a, b, t] of stitches) for (let k = 0; k < 3; k++) {
    sewnX[3 * p + k] = S.x[3 * a + k] * (1 - t) + S.x[3 * b + k] * t;
  }
  writeFileSync(new URL('../static/piste/jacket-draft.json', import.meta.url), JSON.stringify({ x: Array.from(sewnX, r3), tris, uv, seam, pieces, flat, seams, stitches }));
}
const strain = S.edges.map((e) => Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])) / e.rest - 1);
const pointStrain = new Float64Array(G.n); S.edges.forEach((e, k) => { if (e.dir === 'across' || e.dir === 'along') { pointStrain[e.a] = Math.max(pointStrain[e.a], strain[k]); pointStrain[e.b] = Math.max(pointStrain[e.b], strain[k]); } });
const tris = [];
G.pieces.forEach((pc) => { for (let r = 0; r < pc.rows - 1; r++) for (let cc = 0; cc < pc.cols - 1; cc++) { const a = pc.base + r * pc.cols + cc; tris.push([a, a + 1, a + pc.cols + 1], [a, a + pc.cols + 1, a + pc.cols]); } });
const view = (fwd, right, ox, label) => {
  const up = [0, 1, 0], sc = 520, pts = Array.from({ length: G.n }, (_, i) => { const p = [S.x[i * 3] - B.pelvis[0], S.x[i * 3 + 1] - B.pelvis[1], S.x[i * 3 + 2] - B.pelvis[2]]; return [p[0] * right[0] + p[2] * right[2], p[1], p[0] * fwd[0] + p[2] * fwd[2]]; });
  // (fitted to the frame: 440 × 560 px)
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k2 = Math.min(420 / (x1 - x0), 560 / (y1 - y0)); for (const p of pts) { p[0] = (p[0] - (x0 + x1) / 2) * k2 / sc; p[1] = (p[1] - y1) * k2 / sc - 0.1; }
  const order = tris.map((t) => [t, (pts[t[0]][2] + pts[t[1]][2] + pts[t[2]][2]) / 3]).sort((a, b) => a[1] - b[1]);
  let g = `<text x="${ox + 10}" y="20" font-size="13">${label}</text>`;
  for (const [t] of order) {
    const [A, Bq, C] = t.map((i) => pts[i]), nz = (Bq[0] - A[0]) * (C[1] - A[1]) - (Bq[1] - A[1]) * (C[0] - A[0]);
    const s = (pointStrain[t[0]] + pointStrain[t[1]] + pointStrain[t[2]]) / 3, shade = 0.55 + 0.4 * Math.min(1, Math.abs(nz) * 400);
    const rC = s > 0.02 ? Math.min(255, 200 + s * 1500) : 200, bC = s < -0.01 ? Math.min(255, 200 - s * 1500) : 200;
    const col = `rgb(${Math.round(rC * shade)},${Math.round(200 * shade)},${Math.round(bC * shade)})`;
    g += `<polygon points="${t.map((i) => `${(ox + 230 + pts[i][0] * sc).toFixed(1)},${(-pts[i][1] * sc).toFixed(1)}`).join(' ')}" fill="${col}" stroke="${col}" stroke-width="0.4"/>`;
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
