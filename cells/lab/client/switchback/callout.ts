/**
 * The callouts painted in (`ink`): a trick, a checkpoint, a wipe-out, lettered in brushed capitals into the speed layer's
 * canvas, so it's in the picture (and in a video of it), not set in type over it. Sign-painter capitals: each letter a
 * few strokes laid in the order a painter lays them, each stroke one of the painter's own brush stamps (loaded, its
 * bristles in it) pulled along it and running dry at its end; slanted forward, each letter a little off its line and
 * turned, so it's laid in by hand at speed. Written on stroke by stroke in about half a second, held, faded; cream over
 * an orange stroke a little offset (the type's own orange shadow).
 */
import { Brush2D } from './paint';

/** a capital: its width (cap height 1, y up) and its strokes, each a run of points, in the order they're laid */
type Cap = { w: number; s: number[][][] };
const O = [[0.35, 1], [0.08, 0.86], [0, 0.5], [0.1, 0.12], [0.36, 0], [0.62, 0.12], [0.7, 0.5], [0.6, 0.88], [0.35, 1], [0.24, 0.96]];
const P = [[0, 1], [0.42, 1], [0.6, 0.85], [0.58, 0.6], [0.4, 0.47], [0.02, 0.47]];
const CAPS: Record<string, Cap> = {
  A: { w: 0.72, s: [[[0, 0], [0.36, 1]], [[0.36, 1], [0.72, 0]], [[0.15, 0.38], [0.58, 0.38]]] },
  B: { w: 0.64, s: [[[0, 0], [0, 1]], [[0, 1], [0.42, 1], [0.56, 0.86], [0.5, 0.6], [0.05, 0.53]], [[0.05, 0.53], [0.48, 0.5], [0.64, 0.3], [0.55, 0.06], [0, 0]]] },
  C: { w: 0.66, s: [[[0.64, 0.84], [0.45, 1], [0.18, 0.95], [0.02, 0.62], [0.04, 0.25], [0.25, 0], [0.5, 0.02], [0.66, 0.16]]] },
  D: { w: 0.66, s: [[[0, 0], [0, 1]], [[0, 1], [0.38, 0.98], [0.64, 0.7], [0.64, 0.3], [0.4, 0.02], [0, 0]]] },
  E: { w: 0.58, s: [[[0, 0], [0, 1]], [[0, 1], [0.56, 1]], [[0, 0.52], [0.46, 0.52]], [[0, 0], [0.58, 0]]] },
  F: { w: 0.56, s: [[[0, 0], [0, 1]], [[0, 1], [0.56, 1]], [[0, 0.5], [0.46, 0.5]]] },
  G: { w: 0.7, s: [[[0.64, 0.84], [0.45, 1], [0.18, 0.95], [0.02, 0.62], [0.04, 0.25], [0.25, 0], [0.52, 0.02], [0.68, 0.2], [0.68, 0.45], [0.38, 0.45]]] },
  H: { w: 0.66, s: [[[0, 0], [0, 1]], [[0.64, 0], [0.64, 1]], [[0, 0.5], [0.64, 0.5]]] },
  I: { w: 0.22, s: [[[0.08, 0], [0.08, 1]]] },
  J: { w: 0.52, s: [[[0.48, 1], [0.48, 0.22], [0.32, 0], [0.08, 0.04], [0, 0.22]]] },
  K: { w: 0.64, s: [[[0, 0], [0, 1]], [[0.6, 1], [0.02, 0.42]], [[0.2, 0.6], [0.66, 0]]] },
  L: { w: 0.54, s: [[[0, 1], [0, 0], [0.56, 0]]] },
  M: { w: 0.8, s: [[[0, 0], [0.05, 1], [0.4, 0.34], [0.74, 1], [0.8, 0]]] },
  N: { w: 0.66, s: [[[0, 0], [0, 1], [0.64, 0], [0.64, 1]]] },
  O: { w: 0.72, s: [O] },
  P: { w: 0.6, s: [[[0, 0], [0, 1]], P] },
  Q: { w: 0.74, s: [O, [[0.42, 0.26], [0.76, -0.08]]] },
  R: { w: 0.64, s: [[[0, 0], [0, 1]], P, [[0.3, 0.47], [0.66, 0]]] },
  S: { w: 0.62, s: [[[0.6, 0.86], [0.45, 1], [0.15, 0.97], [0.03, 0.78], [0.12, 0.58], [0.5, 0.45], [0.64, 0.25], [0.52, 0.04], [0.22, 0], [0, 0.15]]] },
  T: { w: 0.66, s: [[[0, 1], [0.66, 1]], [[0.33, 1], [0.33, 0]]] },
  U: { w: 0.66, s: [[[0, 1], [0, 0.3], [0.12, 0.04], [0.32, 0], [0.52, 0.06], [0.64, 0.3], [0.64, 1]]] },
  V: { w: 0.68, s: [[[0, 1], [0.34, 0], [0.68, 1]]] },
  W: { w: 0.9, s: [[[0, 1], [0.2, 0], [0.45, 0.72], [0.68, 0], [0.9, 1]]] },
  X: { w: 0.64, s: [[[0, 1], [0.64, 0]], [[0.64, 1], [0, 0]]] },
  Y: { w: 0.66, s: [[[0, 1], [0.33, 0.5], [0.66, 1]], [[0.33, 0.5], [0.33, 0]]] },
  Z: { w: 0.62, s: [[[0, 1], [0.6, 1], [0, 0], [0.64, 0]]] },
  '0': { w: 0.62, s: [[[0.31, 1], [0.07, 0.86], [0, 0.5], [0.08, 0.12], [0.31, 0], [0.54, 0.12], [0.62, 0.5], [0.54, 0.88], [0.31, 1], [0.2, 0.96]]] },
  '1': { w: 0.34, s: [[[0.04, 0.8], [0.26, 1], [0.26, 0]]] },
  '2': { w: 0.62, s: [[[0.03, 0.8], [0.2, 0.98], [0.45, 0.98], [0.6, 0.78], [0.5, 0.5], [0, 0], [0.62, 0]]] },
  '3': { w: 0.62, s: [[[0.05, 0.88], [0.25, 1], [0.5, 0.97], [0.58, 0.78], [0.42, 0.56], [0.22, 0.54]], [[0.42, 0.56], [0.62, 0.38], [0.58, 0.1], [0.32, 0], [0.05, 0.1]]] },
  '4': { w: 0.66, s: [[[0.48, 0], [0.48, 1], [0, 0.32], [0.66, 0.32]]] },
  '5': { w: 0.62, s: [[[0.58, 1], [0.1, 1], [0.06, 0.55], [0.4, 0.6], [0.62, 0.4], [0.56, 0.1], [0.3, 0], [0.02, 0.1]]] },
  '6': { w: 0.62, s: [[[0.55, 0.95], [0.3, 1], [0.08, 0.78], [0.02, 0.35], [0.15, 0.05], [0.4, 0], [0.6, 0.18], [0.58, 0.45], [0.35, 0.58], [0.04, 0.4]]] },
  '7': { w: 0.62, s: [[[0, 1], [0.62, 1], [0.22, 0]]] },
  '8': { w: 0.62, s: [[[0.32, 0.55], [0.08, 0.72], [0.15, 0.95], [0.45, 0.98], [0.56, 0.75], [0.32, 0.55], [0.05, 0.35], [0.08, 0.08], [0.35, 0], [0.6, 0.12], [0.6, 0.38], [0.32, 0.55]]] },
  '9': { w: 0.62, s: [[[0.58, 0.6], [0.3, 0.45], [0.05, 0.6], [0.08, 0.9], [0.35, 1], [0.58, 0.85], [0.6, 0.4], [0.45, 0.08], [0.15, 0.02]]] },
  '!': { w: 0.24, s: [[[0.12, 1], [0.1, 0.3]], [[0.1, 0.1], [0.09, -0.02]]] },
  '-': { w: 0.42, s: [[[0, 0.45], [0.42, 0.47]]] },
  '×': { w: 0.46, s: [[[0, 0.22], [0.44, 0.72]], [[0.44, 0.22], [0, 0.72]]] },
  '.': { w: 0.2, s: [[[0.08, 0.1], [0.07, -0.02]]] },
  "'": { w: 0.18, s: [[[0.1, 1], [0.06, 0.72]]] },
};
const SLANT = 0.2, GAP = 0.16, SPACE = 0.36;

type Laid = { pts: number[][]; len: number; stamp: number };
type Item = { strokes: Laid[]; total: number; w: number; t0: number };

export class Callouts {
  private item: Item | null = null; private brush = new Brush2D(); private n = 0;
  /** a callout, lettered from game time t (s) */
  say(text: string, t: number) {
    let seed = 7 + this.n++ * 131;
    const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const strokes: Laid[] = []; let x = 0;
    for (const ch of text.toUpperCase()) {
      const g = CAPS[ch];
      if (!g) { x += SPACE; continue; }
      // (each letter a little off its line and turned, as a hand lays them in)
      const lift = (R() - 0.5) * 0.06, turn = (R() - 0.5) * 0.08, cx = g.w / 2;
      for (const st of g.s) {
        const pts = st.map(([u, v]) => {
          const ju = u + (R() - 0.5) * 0.03, jv = v + (R() - 0.5) * 0.03, ru = (ju - cx) * Math.cos(turn) - (jv - 0.5) * Math.sin(turn) + cx, rv = (ju - cx) * Math.sin(turn) + (jv - 0.5) * Math.cos(turn) + 0.5;
          return [x + ru + rv * SLANT, rv + lift];
        });
        let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        strokes.push({ pts: smooth(pts), len, stamp: [9, 0, 1, 9, 13][Math.floor(R() * 5)] });
      }
      x += g.w + GAP;
    }
    if (!strokes.length) return;
    this.item = { strokes, total: strokes.reduce((a, s) => a + s.len + 0.25, 0), w: x - GAP + SLANT, t0: t };
  }
  /** drawn over the canvas (its size W × H in CSS pixels, at dpr), at game time t */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, t: number) {
    const it = this.item; if (!it) return;
    const write = 0.5, age = t - it.t0, hold = write + 0.95, fade = 0.4;
    if (age > hold + fade) { this.item = null; return; }
    const alpha = age < hold ? 1 : 1 - (age - hold) / fade, done = Math.min(1, age / write) * it.total;
    // (as big as fits: a cap height of about a tenth of the picture, narrower if the words are long)
    const k = Math.min((W * 0.86) / it.w, H * 0.1), ox = W / 2 - (it.w * k) / 2, oy = H * 0.3 + k / 2, wd = k * 0.095;
    const at = (p: number[], dx: number, dy: number) => [ox + p[0] * k + dx, oy - p[1] * k + dy];
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = Math.max(0, alpha);
    for (const [col, dx, dy, wk] of [['#e85a0d', wd * 0.35, wd * 0.6, 1.15], ['#fbf3e6', 0, 0, 1]] as [string, number, number, number][]) {
      let left = done;
      for (const s of it.strokes) {
        if (left <= 0) break;
        const f = Math.min(1, left / s.len); left -= s.len + 0.25;
        // (pulled along its run in pieces a few brush-widths long, the last running dry; drawn as far as it's got)
        const run = cut(s.pts, f * s.len), piece = 0.4;
        const segs = split(run, piece);
        segs.forEach(([a, b], i) => this.brush.wedge(ctx, at(a, dx, dy), at(b, dx, dy), wd * wk * (i === segs.length - 1 && f === 1 ? 0.8 : 1), col, i === segs.length - 1 && f === 1 && segs.length > 1 ? 5 : s.stamp));
      }
    }
    ctx.restore();
  }
}

/** a run of points rounded at its turns (Catmull-Rom, a few points a span), straight runs left straight */
function smooth(p: number[][]) {
  if (p.length < 3) return p;
  const out: number[][] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], d = p[Math.min(p.length - 1, i + 2)];
    for (let j = 1; j <= 4; j++) {
      const u = j / 4, u2 = u * u, u3 = u2 * u;
      out.push([0, 1].map((k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u3)));
    }
  }
  return out;
}
/** the first `len` of a run */
function cut(p: number[][], len: number) {
  const out = [p[0]];
  for (let i = 1; i < p.length && len > 0; i++) {
    const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (L >= len) { const f = len / L; out.push([p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f]); break; }
    out.push(p[i]); len -= L;
  }
  return out;
}
/** a run cut into straight pieces about `piece` long (chords of it) */
function split(p: number[][], piece: number) {
  const segs: number[][][] = []; let a = p[0], acc = 0;
  for (let i = 1; i < p.length; i++) {
    acc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc >= piece || i === p.length - 1) { segs.push([a, p[i]]); a = p[i]; acc = 0; }
  }
  return segs;
}
