/**
 * The pen scene (`?scene=pen`): one Autograph stroke carried through the Splats brush, and one Bamboo bank edge drawn by
 * a hand and that pen. The question is whether a mark keeps the character of how it was made when it's laid in space.
 *
 * **word**: Autograph's hand writes "stone" with the broad pen (hands/v34.ts, `<broad>`), its timestamps and pen state
 * kept. It goes on a board and wrapped round a culm, each twice:
 * - by the pen (pen.ts: a nib-aligned Gaussian at every step, Autograph's speed, press, voice and ink);
 * - beneath it, as the Splats brush draws a path today (a round width with a prescribed pressure profile).
 * Autograph's own rendering of the same writing can be laid over the screen (`reference`).
 *
 * **bank**: one of Bamboo's bank rims (seed 1), chosen by Bamboo's own drawing (strokes.ts, the `rim` tap): the run
 * where the trail's bench is cut deepest, broken into the dashes Bamboo broke it into, each with its weight. It's drawn
 * twice, side by side:
 * - left, as the Splats brush draws it today: each dash a stroke, its width and strength from Bamboo's weight;
 * - right, moved by a hand (Autograph's timing and body, a looser hand than writing) and drawn by the pen, each dash its
 *   own stroke with the pen lifted between, its press from Bamboo's weight, the ink running down and dipped at the
 *   pauses.
 * The trail's edge along the foot of the cut is drawn faintly in both, for context; the ground is the occluder.
 */
import { add, deposit, mul, norm, stroke, toSplats, type Dep, type Element, type V } from './brush';
import { cylinderMap, groundMap, hand, penDeposit, planeMap, staticStrokes, type TimedStroke } from './pen';
import { write } from '../autograph/hands/v34';
import { World } from '../bamboo/world';
import { strokes as bambooStrokes } from '../bamboo/strokes';
import type { PenAt } from '../autograph/ink';

const INKC: V = [36, 31, 27];
export interface PenScene { drawing: ReturnType<typeof toSplats>; occluder: Float32Array; centres: Record<string, { target: V; yaw: number; pitch: number; dist: number }>; sig: number[][]; bank: { dashes: number; length: number; chunk: string } }

export function penScene(): PenScene {
  const deps: Dep[] = [], tris: number[] = [], extra: Element[] = [];
  // ─── the word: Autograph's writing, normalised to start at the page's origin ───
  const sig = write('<broad>stone</broad>', 5) as TimedStroke[];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of sig) for (let i = 0; i < s.length; i += 3) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]); }
  const page = sig.map((s) => { const o = s.map((v, i) => (i % 3 === 0 ? v - x0 : i % 3 === 1 ? v - y0 : v)) as TimedStroke; if (s.pen) o.pen = s.pen; return o; });
  const W = x1 - x0, H = y1 - y0, k = 0.1 / 220, below = H + 260;
  const shifted = (dy: number) => page.map((s) => { const o = s.map((v, i) => (i % 3 === 1 ? v + dy : v)) as TimedStroke; if (s.pen) o.pen = s.pen; return o; });
  // (the board: tilted back a little, left of middle)
  const up = norm([0, 1, -0.25]), right: V = [1, 0, 0], bo: V = [-0.95 - (W * k) / 2, 0.95, 0.05];
  const board = planeMap(bo, right, up, k);
  deps.push(...penDeposit(page, board, { pen: 30, k, voice: 1, dip: true, union: true, colour: INKC, element: 1 }).deps);
  extra.push(...staticStrokes(shifted(below), board, { pen: 30, k, voice: 1, dip: false, union: true, colour: INKC, element: 2 }, 'word/static/board'));
  { const n = norm(add(mul(right, 0), [0, 0.25, 1])), c = add(bo, add(mul(right, (W * k) / 2), mul(up, -((H + below) * k) / 2))), hw = (W * k) / 2 + 0.06, hh = ((H + below) * k) / 2 + 0.08, back = mul(n, -0.004);
    const q = (a: number, b: number): V => add(add(c, back), add(mul(right, a * hw), mul(up, b * hh))); tris.push(...q(-1, -1), ...q(1, -1), ...q(1, 1), ...q(-1, -1), ...q(1, 1), ...q(-1, 1)); }
  // (the culm: the word wrapped round it, its middle toward the camera)
  const r = 0.14, cc: V = [0.55, 1.0, 0], a0 = -((W * k) / 2) / r;
  const culm = cylinderMap(cc, r, a0, k);
  deps.push(...penDeposit(page, culm, { pen: 30, k, voice: 1, dip: true, union: true, colour: INKC, element: 3 }).deps);
  extra.push(...staticStrokes(shifted(below), culm, { pen: 30, k, voice: 1, dip: false, union: true, colour: INKC, element: 4 }, 'word/static/culm'));
  for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, b = ((i + 1) / 28) * Math.PI * 2, rr = r * 0.985, A: V = [cc[0] + rr * Math.sin(a), 0, cc[2] + rr * Math.cos(a)], B: V = [cc[0] + rr * Math.sin(b), 0, cc[2] + rr * Math.cos(b)]; tris.push(...A, ...B, B[0], 1.6, B[2], ...A, B[0], 1.6, B[2], A[0], 1.6, A[2]); }
  // (the culm's silhouette, faint, so the wrap reads)
  for (const s of [-1, 1]) for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, n1: V = [Math.sin(a), 0, Math.cos(a)], n2: V = [Math.sin(a + 0.26), 0, Math.cos(a + 0.26)]; if (s > 0) extra.push(stroke({ pts: [[cc[0] + r * n1[0], 0.05, cc[2] + r * n1[2]], [cc[0] + r * n1[0], 1.55, cc[2] + r * n1[2]]], normals: [n1, n1] }, { width: 0.004, taper: [0.02, 0.02] }, { key: `culm/edge${i}`, mark: 4, profile: n2, alpha: 0.5, colour: [120, 110, 98] })); }

  // ─── the bank: Bamboo's deepest-cut rim near its start, as Bamboo chose and broke it ───
  const world = new World(1);
  type Run = { line: V[]; depth: number[]; edge: V[]; dashes: Array<{ pts: V[]; weight: number }>; chunk: string };
  const runs: Run[] = [];
  for (let ci = -2; ci <= 2; ci++) for (let cj = -2; cj <= 2; cj++) bambooStrokes(world, world.chunk(ci, cj), { rim: (line, depth, edge, dashes) => runs.push({ line: line as V[], depth, edge: edge as V[], dashes: dashes as Run['dashes'], chunk: `${ci},${cj}` }) });
  runs.sort((p, q) => q.line.length * Math.max(...q.depth) - p.line.length * Math.max(...p.depth));
  const run = runs[0], dashes = run.dashes.slice(0, 4);
  const pts = dashes.flatMap((d) => d.pts), cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let span = 0; for (const p of pts) span = Math.max(span, Math.abs(p[0] - cx), Math.abs(p[2] - cz));
  const S = 0.9 / Math.max(1, span), gap = 2.2;
  // (well away from the word, so neither framing sees the other)
  const toScene = (off: number) => (p: V): V => [(p[0] - cx) * S + off + 14, (p[1] - cy) * S + 0.05, (p[2] - cz) * S];
  const ground = (x: number, z: number) => world.ground(x, z) + 0.04;
  const kw = 0.003, origin: [number, number] = [cx, cz];
  for (const [side, off] of [['left', -gap / 2], ['right', gap / 2]] as const) {
    const T = toScene(off);
    // (the ground round it: the occluder)
    const g = 1.5, R = span + 3;
    for (let x = cx - R; x < cx + R; x += g) for (let z = cz - R; z < cz + R; z += g) { const P = (a: number, b: number) => T([a, world.ground(a, b), b]); tris.push(...P(x, z), ...P(x + g, z), ...P(x + g, z + g), ...P(x, z), ...P(x + g, z + g), ...P(x, z + g)); }
    // (the trail's edge along the foot of the cut, faint, for context)
    const e = run.edge.filter((p) => Math.hypot(p[0] - cx, p[2] - cz) < span + 1).map((p) => T([p[0], ground(p[0], p[2]), p[2]]));
    if (e.length > 1) extra.push(stroke({ pts: e, normals: e.map(() => [0, 1, 0] as V) }, { width: 0.004, taper: [0.1, 0.1], breaks: [[0.3, 0.38], [0.7, 0.76]] }, { key: `bank/${side}/edge`, alpha: 0.45, colour: [120, 110, 98] }));
    if (side === 'left') {
      // (as the Splats brush draws Bamboo's dashes today: their width and strength from Bamboo's weight)
      dashes.forEach((d, i) => { const P = d.pts.map((p) => T([p[0], ground(p[0], p[2]), p[2]])); extra.push(stroke({ pts: P, normals: P.map(() => [0, 1, 0] as V) }, { width: 0.08 * S * (0.7 + 0.6 * d.weight), taper: [0.12, 0.18] }, { key: `bank/left/${i}`, alpha: 0.5 + 0.45 * d.weight, colour: INKC })); });
    } else {
      // (moved by a hand and drawn by the pen: each dash a stroke, the pen lifted between; press from Bamboo's weight)
      const map = groundMap(ground, origin, kw, T);
      let t = 0; const timed: TimedStroke[] = [];
      for (const d of dashes) {
        const plan = d.pts.map((p) => [(p[0] - cx) / kw, (p[2] - cz) / kw] as [number, number]), press = Math.max(-1, Math.min(1, (d.weight - 0.5) / 0.15));
        const pen: [PenAt, PenAt] = [{ press, voice: 0.8 }, { press: press - 0.3, voice: 0.8 }];
        const s = hand(plan, 5, 45, t, pen); timed.push(s); t = s[s.length - 1] + 30;
      }
      deps.push(...penDeposit(timed, map, { pen: 30, k: kw * S, voice: 0.8, dip: true, union: true, colour: INKC, element: 9 }).deps);
    }
  }
  for (const e of extra) deps.push(...deposit(e));
  const length = dashes.reduce((s, d) => s + d.pts.reduce((q, p, i) => (i ? q + Math.hypot(p[0] - d.pts[i - 1][0], p[2] - d.pts[i - 1][2]) : 0), 0), 0);
  return {
    drawing: toSplats(deps), occluder: new Float32Array(tris), sig: page,
    centres: { word: { target: [-0.2, 0.85, 0], yaw: 0.1, pitch: 0.08, dist: 1.9 }, board: { target: [-0.95, 0.85, 0.05], yaw: 0.0, pitch: 0.12, dist: 1.0 }, bank: { target: [14, 0.05, 0], yaw: 0.0, pitch: 0.9, dist: 3.4 }, culm: { target: [0.55, 0.9, 0], yaw: 0.0, pitch: 0.05, dist: 1.3 } },
    bank: { dashes: dashes.length, length, chunk: run.chunk },
  };
}
