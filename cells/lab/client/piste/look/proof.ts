/**
 * Proving a garment's construction before it's put on the body (devtools/piste-jacket.mjs): as a tailor checks a pattern
 * on the paper and sews it up before a fitting, so a fault in the making isn't mistaken for a fault in the fit.
 *
 * - On the paper: each seam's two edges, along the stitches that join them, the same length (a seam drawn closed on
 *   edges of different lengths stretches one or gathers the other); a sleeve's cap its armhole's length and its ease;
 *   every row of every piece of positive width.
 * - Sewn in the air (no body, no gravity): every seam closes to nothing; the cloth keeps its paper lengths; and across
 *   each seam the two pieces face the same way (a piece sewn in twisted, or inside out, faces the other way at the seam).
 */
import type { V } from '../v3';
import { type Garment, ARM_ROW } from './draft';
import { settle } from './settle';
import type { Capsule } from '../fencer';

/** how stretched an edge is, for judging: its fraction over its paper length; but a very short edge (a cell squeezed at a
 * corner of the paper) is judged by how far it's stretched in millimetres, 2 mm counting as 1 % */
const judged = (l: number, rest: number) => (rest < 0.02 ? Math.max(0, l - rest) / 0.2 : l / rest - 1);

export interface Check { what: string; ok: boolean; detail: string }

const flatDist = (G: Garment, a: number, b: number) => Math.hypot(G.flat[a][0] - G.flat[b][0], G.flat[a][1] - G.flat[b][1]);

/** the checks on the paper */
export function paperChecks(G: Garment, o: { capEase: number }): Check[] {
  const out: Check[] = [];
  const seams = new Map<string, typeof G.stitches>();
  for (const s of G.stitches) { const k = s.seam ?? '?'; seams.set(k, [...(seams.get(k) ?? []), s]); }
  for (const [name, st] of seams) {
    // (each side's length along the stitches, in order; the cap's other side is the armhole's points it's sewn between)
    let a = 0, b = 0;
    for (let k = 1; k < st.length; k++) {
      a += flatDist(G, st[k - 1].p, st[k].p);
      const q0 = st[k - 1], q1 = st[k], pa = [G.flat[q0.q][0] * (1 - q0.t) + G.flat[q0.q2][0] * q0.t, G.flat[q0.q][1] * (1 - q0.t) + G.flat[q0.q2][1] * q0.t];
      const pb = [G.flat[q1.q][0] * (1 - q1.t) + G.flat[q1.q2][0] * q1.t, G.flat[q1.q][1] * (1 - q1.t) + G.flat[q1.q2][1] * q1.t];
      // (across two pieces of paper the armhole's points are on different sheets: their distance is only meaningful within one)
      const samePiece = G.pieces.find((p) => q0.q >= p.base && q0.q < p.base + p.rows * p.cols)?.name === G.pieces.find((p) => q1.q >= p.base && q1.q < p.base + p.rows * p.cols)?.name;
      b += samePiece ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) : 0;
    }
    if (name.startsWith('sleeve cap')) {
      // (the whole cap row against the whole armhole: its points, in the order sewn, each step measured on its own piece's
      // paper; across the shoulder point, where the front's piece meets the back's, nothing: they're one point there)
      const sl = G.pieces.find((pc) => st[0].p >= pc.base && st[0].p < pc.base + pc.rows * pc.cols)!;
      a = 0; for (let c = 1; c < sl.cols; c++) a += flatDist(G, sl.base + c - 1, sl.base + c);
      const loop: number[] = []; for (const x of st) for (const q of [x.q, x.q2]) if (loop[loop.length - 1] !== q && !loop.includes(q)) loop.push(q);
      loop.sort((i, j) => i - j);
      const pieceOfQ = (i: number) => G.pieces.findIndex((pc) => i >= pc.base && i < pc.base + pc.rows * pc.cols);
      b = 0; for (let k = 1; k < loop.length; k++) if (pieceOfQ(loop[k]) === pieceOfQ(loop[k - 1])) b += flatDist(G, loop[k - 1], loop[k]);
      // (and each half into its own half: the crown at the shoulder seam)
      const sl2 = G.pieces.find((pc) => st[0].p >= pc.base && st[0].p < pc.base + pc.rows * pc.cols)!, mid = Math.round((sl2.cols - 1) / 2);
      const crown = st.find((x) => x.p === sl2.base + mid) ?? st[mid], crownQ = crown.t < 0.5 ? crown.q : crown.q2;
      const pieceOf2 = (i: number) => G.pieces.find((pc) => i >= pc.base && i < pc.base + pc.rows * pc.cols)!, pq = pieceOf2(crownQ);
      const atTop = Math.floor((crownQ - pq.base) / pq.cols) >= pq.rows - 2;
      out.push({ what: `${name}: the crown at the shoulder seam`, ok: atTop, detail: `the crown sewn to ${pq.name} row ${Math.floor((crownQ - pq.base) / pq.cols)} of ${pq.rows}` });
      const ratio = a / Math.max(1e-9, b) - 1;
      out.push({ what: `${name}: the cap is the armhole's length and its ease (${(o.capEase * 100).toFixed(0)} %)`, ok: Math.abs(ratio - o.capEase) < 0.03, detail: `cap ${(a * 100).toFixed(1)} cm, armhole ${(b * 100).toFixed(1)} cm (${(ratio * 100).toFixed(1)} %)` });
    } else {
      const d = Math.abs(a - b);
      out.push({ what: `${name}: both edges the same length`, ok: d < 0.005, detail: `${(a * 100).toFixed(1)} and ${(b * 100).toFixed(1)} cm (${(d * 1000).toFixed(0)} mm apart)` });
    }
  }
  for (const pc of G.pieces) {
    // (all one way: a piece cut mirrored runs right to left, every row of it)
    let bad = 0; const dir = Math.sign(G.flat[pc.base + 1][0] - G.flat[pc.base][0]) || 1;
    for (let r = 0; r < pc.rows; r++) for (let c = 0; c < pc.cols - 1; c++) if ((G.flat[pc.base + r * pc.cols + c + 1][0] - G.flat[pc.base + r * pc.cols + c][0]) * dir <= 0) bad++;
    out.push({ what: `${pc.name}: every row of positive width`, ok: bad === 0, detail: bad ? `${bad} cells folded back` : 'yes' });
  }
  return out;
}

/** sewn up in the air: no body, no gravity */
/** a piece's centre on its paper */
function centreOf(G: Garment, pc: Garment['pieces'][number]): [number, number] {
  let x = 0, y = 0; const n = pc.rows * pc.cols; for (let i = pc.base; i < pc.base + n; i++) { x += G.flat[i][0] / n; y += G.flat[i][1] / n; } return [x, y];
}
/** +1 if a piece's paper, as drawn, is seen from its right side (the side out, as it's laid round the body), −1 if from the
 * wrong side: its grid's facing against the way out from the middle of its ring (the body's rings, or a sleeve's own) */
function facingOf(G: Garment, pc: Garment['pieces'][number]): number {
  const A = (i: number) => G.at[i], body = G.pieces.filter((p) => p.kind === 'body');
  let sum = 0;
  for (let r = 1; r < pc.rows - 1; r++) {
    // (a gusset: out from the trunk's middle at the underarm)
    const ring = pc.kind === 'gusset' ? body.flatMap((p) => Array.from({ length: p.cols }, (_, c) => p.base + ARM_ROW * p.cols + c)) : pc.kind === 'body' ? body.flatMap((p) => Array.from({ length: p.cols }, (_, c) => p.base + r * p.cols + c)) : Array.from({ length: pc.cols - 1 }, (_, c) => pc.base + r * pc.cols + c);
    const m = ring.reduce((acc, i) => acc.map((v, k) => v + A(i)[k] / ring.length), [0, 0, 0]);
    for (let c = 1; c < pc.cols - 1; c++) {
      const i = pc.base + r * pc.cols + c, u = A(i + 1).map((v, k) => v - A(i - 1)[k]), w = A(i + pc.cols).map((v, k) => v - A(i - pc.cols)[k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], out = A(i).map((v, k) => v - m[k]);
      sum += Math.sign(n[0] * out[0] + n[1] * out[1] + n[2] * out[2]);
    }
  }
  return Math.sign(sum) || 1;
}

export function airChecks(G: Garment): { checks: Check[]; x: Float64Array } {
  const faces = new Map(G.pieces.map((pc) => [pc, facingOf(G, pc)])), centres = new Map(G.pieces.map((pc) => [pc, centreOf(G, pc)]));
  const facing = (pc: Garment['pieces'][number]) => faces.get(pc)!, centre = (pc: Garment['pieces'][number]) => centres.get(pc)!;
  // (long and hard: no hurry, and short of it the solver's unfinished business reads as stretch)
  const S = settle(G, [], { seconds: 10, gravity: 0, free: true, passes: 20 });
  const X = (i: number) => [S.x[i * 3], S.x[i * 3 + 1], S.x[i * 3 + 2]];
  const out: Check[] = [];
  const seams = new Map<string, typeof G.stitches>();
  for (const s of G.stitches) { const k = s.seam ?? '?'; seams.set(k, [...(seams.get(k) ?? []), s]); }
  for (const [name, st] of seams) {
    const gaps = st.map((s) => { const p = X(s.p), q = X(s.q), q2 = X(s.q2); return Math.hypot(...p.map((v, k) => v - (q[k] * (1 - s.t) + q2[k] * s.t))); });
    out.push({ what: `${name}: closes`, ok: Math.max(...gaps) < 0.005, detail: `widest gap ${(Math.max(...gaps) * 1000).toFixed(1)} mm` });
    // (sewn the right way: every piece has a right side, the side facing out as it's laid round the body (decided once
    // for the whole piece); seen from their right sides, a seam's two edges run opposite ways round their pieces. An
    // edge running the same way is a piece sewn on inside out, or twisted)
    let along = 0, against = 0;
    const pieceOf = (i: number) => G.pieces.find((pc) => i >= pc.base && i < pc.base + pc.rows * pc.cols)!;
    const way = (pc: (typeof G.pieces)[number], i0: number, i1: number) => {
      const c = centre(pc), d = [G.flat[i1][0] - G.flat[i0][0], G.flat[i1][1] - G.flat[i0][1]], toC = [c[0] - G.flat[i0][0], c[1] - G.flat[i0][1]];
      return Math.sign(d[0] * toC[1] - d[1] * toC[0]) * facing(pc);
    };
    for (let k = 1; k < st.length; k++) {
      const P1 = pieceOf(st[k].p), Q1 = pieceOf(st[k].q);
      if (P1 !== pieceOf(st[k - 1].p) || Q1 !== pieceOf(st[k - 1].q)) continue;
      const qa = st[k - 1].t < 0.5 ? st[k - 1].q : st[k - 1].q2, qb = st[k].t < 0.5 ? st[k].q : st[k].q2;
      if (qa === qb) continue;
      if (way(P1, st[k - 1].p, st[k].p) * way(Q1, qa, qb) < 0) along++; else against++;
    }
    out.push({ what: `${name}: sewn right side out (its edges run opposite ways round their pieces)`, ok: against === 0 && along > 0, detail: `${along} steps right, ${against} wrong` });
  }
  const capRows = (i: number) => G.pieces.some((pc) => pc.kind === 'sleeve' && i >= pc.base && i < pc.base + 3 * pc.cols);
  // (the armhole's foot: where the side seam ends and the front, the back and the sleeve meet at a point, a junction a
  // tailor eases or gussets; judged on its own, against a looser limit)
  const foot = (i: number) => G.pieces.some((pc) => { if (i < pc.base || i >= pc.base + pc.rows * pc.cols) return false; const r = Math.floor((i - pc.base) / pc.cols), c = (i - pc.base) % pc.cols; return pc.kind === 'body' ? r >= 17 && r <= 23 && c >= pc.cols - 3 : r <= 6 && (c <= 2 || c >= pc.cols - 3); });
  const footStrain = S.edges.filter((e) => (e.dir === 'across' || e.dir === 'along') && foot(e.a)).map((e) => Math.max(0, judged(Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])), e.rest))).sort((a, b) => a - b);
  const footP95 = footStrain[Math.floor(footStrain.length * 0.95)];
  out.push({ what: 'sewn up, the armholes\' feet (front, back and sleeve meeting) stretched no more than a junction may be (95 % under 4 %)', ok: footP95 < 0.04, detail: `95th percentile ${(footP95 * 100).toFixed(1)} %` });
  const strains = S.edges.filter((e) => (e.dir === 'across' || e.dir === 'along') && !capRows(e.a) && !foot(e.a)).map((e) => judged(Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])), e.rest)).map((v) => Math.max(0, v)).sort((a, b) => a - b);
  const p99 = strains[Math.floor(strains.length * 0.99)];
  const where = new Map<string, number>();
  for (const e of S.edges) { if ((e.dir !== 'across' && e.dir !== 'along') || capRows(e.a) || foot(e.a)) continue; const sv = judged(Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])), e.rest); if (sv < p99) continue;
    const pc = G.pieces[e.piece], r = Math.floor((e.a - pc.base) / pc.cols), c = (e.a - pc.base) % pc.cols, key = `${pc.name} ${e.dir} row ${r} col ${c}`; where.set(key, sv); }
  const worst = [...where].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join('; ');
  // (stretch only: sewn up with nothing inside it, cloth buckles where it's shaped to a body (a sleeve head to a shoulder),
  // and buckling is free; a fault in the making stretches it)
  // (a sanity check, not a measure of looking right: worn cloth strains a few per cent at an elbow or across the back
  // and looks it. What's caught here is a fault: a seam sewn to the wrong place, a piece drafted far too small)
  out.push({ what: 'sewn up, nothing else badly stretched (99 % of the cloth under 4 %; not the cap, eased in on purpose, nor the feet)', ok: p99 < 0.04, detail: `99th percentile ${(p99 * 100).toFixed(2)} %; worst: ${worst}` });
  return { checks: out, x: S.x };
}

/**
 * Sewn up on a dress form: the trunk, the shoulders and the neck, no arms, no gravity, nothing pinned. Where sewing up in
 * the air left the cloth stretched, a form filling it tells shaping (a sleeve head cut to cup a shoulder: filled, it eases)
 * from a fault in the making (still stretched).
 */
export function formChecks(G: Garment, form: Capsule[], regions: { name: string; at: (piece: string, r: number, c: number) => boolean }[], body?: { at: (p: V) => { d: number; n: V } }): Check[] {
  const S = settle(G, form, { seconds: Number(process.env.FORM_S ?? 10), gravity: 0, free: true, sleeveCaps: form, passes: Number(process.env.FORM_P ?? 20), body });
  const out: Check[] = [];
  const stretch = (e: (typeof S.edges)[number]) => judged(Math.hypot(...[0, 1, 2].map((k) => S.x[e.a * 3 + k] - S.x[e.b * 3 + k])), e.rest);
  const edges = S.edges.filter((e) => e.dir === 'across' || e.dir === 'along');
  for (const rg of regions) {
    const vals = edges.filter((e) => { const pc = G.pieces[e.piece]; return rg.at(pc.name, Math.floor((e.a - pc.base) / pc.cols), (e.a - pc.base) % pc.cols); }).map(stretch).map((v) => Math.max(0, v)).sort((a, b) => a - b);
    const p95 = vals[Math.floor(vals.length * 0.95)] ?? 0, mx = vals[vals.length - 1] ?? 0;
    // (2 %: a fault in the making stretches far more; softer cloth, easing less into a shaped head, a little more than
    // the 1.5 % this was first set at)
    out.push({ what: `on the form, ${rg.name}: not stretched (95 % under 2 %)`, ok: p95 < 0.02, detail: `95th percentile ${(p95 * 100).toFixed(1)} %, most ${(mx * 100).toFixed(1)} % (${vals.length} edges)` });
  }
  // (not the whole: on the form the jacket's snug on the trunk, which is fit, not making)
  return out;
}
