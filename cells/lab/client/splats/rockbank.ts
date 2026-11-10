/**
 * One real Bamboo passage through the Splats tools (`?scene=pen&part=rock`): a block of Bamboo's rock (rock.ts) and the
 * bank rim beside it (strokes.ts, the `rim` tap), each as Bamboo made it, drawn by the shared brush:
 * - the block's edges, as Bamboo inks them (its crest, sides, joints and foot), by the hand and pen, the crest and foot
 *   heaviest;
 * - its shadowed faces, from the block's own triangles and normals, as pooled washes anchored on their top edges;
 * - the bank's rim, broken into the dashes Bamboo broke it into, by the pen, press from Bamboo's weight;
 * - the bank's slope (between the rim and the trail's edge below it) as one pooled wash anchored on the rim.
 * The block's mesh and the ground are the occluder. Nothing here is drawn by hand-placed marks: only the brush.
 */
import { add, cross, deposit, dot, len, mul, norm, stroke, sub, wash, type Dep, type Element, type Region, type V } from './brush';
import { LIGHT } from './stone';
import { World } from '../bamboo/world';
import { strokes as bambooStrokes } from '../bamboo/strokes';
import type { Block } from '../bamboo/rock';

type Run = { line: V[]; depth: number[]; edge: V[]; dashes: Array<{ pts: V[]; weight: number }>; chunk: string };
const INKC: V = [36, 31, 27];

/** the passage, its centre at (off, 0, 0) in the scene */
export function rockBank(world: World, off: number): { deps: Dep[]; tris: number[]; centre: { target: V; yaw: number; pitch: number; dist: number }; info: { block: string; faces: number; edges: number; dashes: number; gap: number } } {
  // ─── find a block standing near a bank rim: the nearest pair, not overlapping ───
  const runs: Run[] = [], blocks: Block[] = [], all: Block[] = [];
  for (let ci = -3; ci <= 3; ci++) for (let cj = -3; cj <= 3; cj++) {
    bambooStrokes(world, world.chunk(ci, cj), { rim: (line, depth, edge, dashes) => runs.push({ line: line as V[], depth, edge: edge as V[], dashes: dashes as Run['dashes'], chunk: `${ci},${cj}` }) });
    for (const b of world.rocks(ci, cj)) { all.push(b); if (b.role === 'outcrop' && b.kind !== 'fragment' && b.h[0] > 0.6) blocks.push(b); }
  }
  // (the biggest outcrop on the slope with a rim within a few metres of it, so the passage is a rock and a bank, not a
  // pebble by a line; an escarpment's blocks read only as their formation, so they're left to the cliff)
  let best: { b: Block; r: Run; d: number; p: V; score: number } | null = null;
  for (const b of blocks) for (const r of runs) for (const p of r.line) {
    const d = Math.hypot(p[0] - b.c[0], p[2] - b.c[2]) - b.r, score = b.r - 0.4 * d;
    if (d > 0.3 && d < 5 && (!best || score > best.score)) best = { b, r, d, p, score };
  }
  if (!best) return { deps: [], tris: [], centre: { target: [off, 0, 0], yaw: 0, pitch: 0.5, dist: 3 }, info: { block: 'none', faces: 0, edges: 0, dashes: 0, gap: 0 } };
  const { b: B0, r: run } = best;
  // (framed between the block and the rim, the block's size setting the scale)
  const cx = (B0.c[0] + best.p[0]) / 2, cz = (B0.c[2] + best.p[2]) / 2, gy = world.ground(cx, cz);
  const span = Math.max(B0.r + best.d, 2), S = 1.1 / span;
  const T = (p: V): V => [(p[0] - cx) * S + off, (p[1] - gy) * S, (p[2] - cz) * S];
  const W = (p: V): V => [(p[0] - off) / S + cx, p[1] / S + gy, p[2] / S + cz];
  const ground = (x: number, z: number) => world.ground(x, z) + 0.03;
  const groundN = (x: number, z: number): V => { const e = 0.2; return norm([ground(x - e, z) - ground(x + e, z), 2 * e, ground(x, z - e) - ground(x, z + e)]); };
  const near = (p: V) => Math.hypot(p[0] - cx, p[2] - cz) < span * 1.6;
  const els: Element[] = [], tris: number[] = [];

  // ─── each block in the passage (the outcrop and its neighbours, fragments too): its faces grouped by plane, the
  // shadowed ones washed; its edges, as Bamboo inks them, by the hand and the pen ───
  const W_EDGE = { crest: 0.009, foot: 0.008, side: 0.006, joint: 0.005 } as const;
  const drawn = all.filter((b) => Math.hypot(b.c[0] - cx, b.c[2] - cz) < span * 1.3 + b.r * 0.5);
  let washed = 0, edgesN = 0;
  drawn.forEach((B, bi) => {
  type Face = { n: V; t: V[][]; worn: boolean };
  const faces: Face[] = [];
  for (let ti = 0; ti < B.tris.length / 9; ti++) {
    const n: V = [B.tn[ti * 3], B.tn[ti * 3 + 1], B.tn[ti * 3 + 2]], tri = [0, 1, 2].map((k) => T([B.tris[ti * 9 + k * 3], B.tris[ti * 9 + k * 3 + 1], B.tris[ti * 9 + k * 3 + 2]]));
    const h = dot(n, tri[0]), f = faces.find((q) => dot(q.n, n) > 0.999 && Math.abs(dot(q.n, q.t[0][0]) - h) < 0.01);
    if (f) f.t.push(tri); else faces.push({ n, t: [tri], worn: !!B.worn[ti] });
  }
  faces.forEach((f, fi) => {
    const lit = dot(f.n, LIGHT);
    if (f.worn || lit > 0.25 || f.n[1] < -0.6) return;
    const pts = f.t.flat(), c = mul(pts.reduce((a, p) => add(a, p), [0, 0, 0] as V), 1 / pts.length), ext = Math.max(...pts.map((p) => len(sub(p, c))));
    const inTri = (p: V, [a, b2, d]: V[]) => { const v0 = sub(d, a), v1 = sub(b2, a), v2 = sub(p, a), d00 = dot(v0, v0), d01 = dot(v0, v1), d02 = dot(v0, v2), d11 = dot(v1, v1), d12 = dot(v1, v2), iv = 1 / (d00 * d11 - d01 * d01), u = (d11 * d02 - d01 * d12) * iv, v = (d00 * d12 - d01 * d02) * iv; return u >= -1e-3 && v >= -1e-3 && u + v <= 1.001; };
    const proj = (p: V): V => sub(p, mul(f.n, dot(sub(p, c), f.n)));
    const on = (p: V) => { const q = proj(p); return f.t.some((t) => inTri(q, t)); };
    const e1 = norm(Math.abs(f.n[1]) < 0.9 ? cross(f.n, [0, 1, 0]) : cross(f.n, [1, 0, 0])), e2 = cross(f.n, e1);
    let area = 0; for (const [a, b2, d] of f.t) area += len(cross(sub(b2, a), sub(d, a))) / 2;
    const region: Region = {
      area,
      sample: (rnd) => { for (let k = 0; k < 2000; k++) { const p = add(c, add(mul(e1, (rnd() * 2 - 1) * ext), mul(e2, (rnd() * 2 - 1) * ext))); if (on(p)) return { p, n: f.n }; } return { p: c, n: f.n }; },
      on, project: (p) => (on(p) ? { p: proj(p), n: f.n } : null),
    };
    // (its anchor: its top edge, where the light turns off it: the boundary edge of its triangles highest on it)
    const edges = new Map<string, [V, V, number]>();
    const key = (p: V) => p.map((v) => v.toFixed(4)).join(',');
    for (const t of f.t) for (let k = 0; k < 3; k++) { const a = t[k], b2 = t[(k + 1) % 3], kk = [key(a), key(b2)].sort().join('|'); const e = edges.get(kk); if (e) e[2]++; else edges.set(kk, [a, b2, 1]); }
    const rim = [...edges.values()].filter((e) => e[2] === 1 && len(sub(e[0], e[1])) > ext * 0.3).sort((p, q) => q[0][1] + q[1][1] - p[0][1] - p[1][1])[0];
    if (!rim || area < 0.004) return;
    const anchor = Array.from({ length: 8 }, (_, k) => add(rim[0], mul(sub(rim[1], rim[0]), k / 7)));
    els.push(wash(region, anchor, { key: `rock/${bi}/face${fi}`, reach: ext * 1.1, material: 'wash', depth: Math.min(1, 0.55 + 0.9 * (0.25 - lit)), uneven: 0.15 }));
    washed++;
  });
  // (the block's shape: the occluder, shrunk a little toward its middle so marks on its faces stand in front)
  const bc = T(B.c);
  for (const f of faces) for (const t of f.t) for (const p of t) tris.push(...add(bc, mul(sub(p, bc), 0.99)));

  // ─── the block's edges, as Bamboo inks them, by the hand and the pen ───
  edgesN += B.E.length;
  B.E.forEach((e, i) => {
    const a = T(e.a), b2 = T(e.b), m = mul(add(a, b2), 0.5), out = norm(sub(m, bc)), n = norm(add(out, e.kind === 'crest' || e.kind === 'side' ? [0, 1, 0] : [0, 0, 0]));
    const pts = Array.from({ length: 10 }, (_, k) => add(add(a, mul(sub(b2, a), k / 9)), mul(n, 0.003)));
    const s = stroke({ pts, normals: pts.map(() => n) }, { width: W_EDGE[e.kind], taper: [0.08, 0.12], breaks: e.kind === 'joint' ? [[0.45, 0.55]] : undefined }, { key: `rock/${bi}/edge${i}`, material: 'pen', colour: INKC, alpha: e.kind === 'side' ? 0.75 : 0.92 });
    s.pen = { voice: e.kind === 'crest' ? 0.7 : 0.3, pace: 7, press: e.kind === 'foot' ? 0.5 : e.kind === 'joint' ? -0.4 : 0 };
    els.push(s);
  });
  });

  // ─── the bank: its rim's dashes by the pen; its slope one pooled wash ───
  const onGround = (p: V): V => { const w = W(p); return T([w[0], ground(w[0], w[2]), w[2]]); };
  let dashes = 0;
  run.dashes.forEach((d, i) => {
    if (!d.pts.some(near)) return;
    const pts = d.pts.map((p) => T([p[0], ground(p[0], p[2]), p[2]])), normals = d.pts.map((p) => groundN(p[0], p[2]));
    const s = stroke({ pts, normals }, { width: 0.004 + 0.008 * d.weight, taper: [0.12, 0.2] }, { key: `bank/dash${i}`, material: 'pen', colour: INKC, alpha: 0.6 + 0.35 * d.weight });
    s.pen = { voice: 0.8, pace: 5, press: Math.max(-1, Math.min(1, (d.weight - 0.5) / 0.15)) };
    els.push(s); dashes++;
  });
  const line = run.line.filter(near), edge = run.edge.filter(near);
  if (line.length > 2 && edge.length > 1) {
    // (the slope: between the rim and the trail's edge below it, a polygon on the ground)
    const poly = [...line, ...[...edge].reverse()].map((p) => T(p));
    const inPoly = (x: number, z: number) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, , zi] = poly[i], [xj, , zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[2]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    let hit = 0; for (let k = 0; k < 2000; k++) if (inPoly(x0 + ((k * 0.618) % 1) * (x1 - x0), z0 + ((k * 0.382) % 1) * (z1 - z0))) hit++;
    const at = (x: number, z: number) => { const w = W([x, 0, z]); return { p: onGround([x, 0, z]), n: groundN(w[0], w[2]) }; };
    const region: Region = {
      area: (hit / 2000) * (x1 - x0) * (z1 - z0),
      sample: (rnd) => { for (let k = 0; k < 2000; k++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (inPoly(x, z)) return at(x, z); } return at(poly[0][0], poly[0][2]); },
      on: (p) => inPoly(p[0], p[2]), project: (p) => (inPoly(p[0], p[2]) ? at(p[0], p[2]) : null),
    };
    const width = Math.max(...line.map((p) => Math.min(...edge.map((q) => Math.hypot(p[0] - q[0], p[2] - q[2]))))) * S;
    els.push(wash(region, line.map((p) => T([p[0], ground(p[0], p[2]), p[2]])), { key: 'bank/slope', reach: Math.max(0.05, width), material: 'wash', depth: 0.55, uneven: 0.12 }));
  }

  // ─── the ground round it: the occluder ───
  // (finer than the land's own cells near the bank's cut, and set a little below it, so the slope's wash isn't cut
  // into by the occluder's flat triangles across the cut's curve)
  const g = 0.35, R = span * 1.8;
  for (let x = cx - R; x < cx + R; x += g) for (let z = cz - R; z < cz + R; z += g) { const P = (a: number, b2: number) => T([a, world.ground(a, b2) - 0.1, b2]); tris.push(...P(x, z), ...P(x + g, z), ...P(x + g, z + g), ...P(x, z), ...P(x + g, z + g), ...P(x, z + g)); }

  const deps = els.flatMap((e) => deposit(e));
  return { deps, tris, centre: { target: add(mul(add(T(B0.c), T(best.p)), 0.5), [0, 0.15, 0]), yaw: 0.5, pitch: 0.45, dist: 3.2 }, info: { block: `${B0.kind} ${B0.role} ${B0.h.map((v) => v.toFixed(1)).join('×')} and ${drawn.length - 1} more`, faces: washed, edges: edgesN, dashes, gap: +best.d.toFixed(2) } };
}
