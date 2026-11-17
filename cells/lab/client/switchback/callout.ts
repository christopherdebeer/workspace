/**
 * The callouts painted in (`ink`): a trick, a checkpoint, a wipe-out, lettered in brushed capitals into the speed layer's
 * canvas, so it's in the picture (and in a video of it), not set in type over it. The capitals are drawn after the game's
 * own title (a heavy grotesque, set tight): broad letters, strokes about a fifth of their height, the round ones round,
 * each letter a few strokes laid in the order a painter lays them, and each stroke the painter's own brush stamp bent
 * along it, so a bowl or an S is one unbroken stroke, its bristles following the curve. Only a little slanted, each
 * letter a touch off its line, so it's laid in by hand. Written on stroke by stroke in about half a second, held,
 * then taken up again stroke by stroke as it was laid; cream over an orange stroke a little offset (the type's own orange shadow).
 */
import { Brush2D } from './paint';

/** a stroke: its points (cap height 1, y up, over the letter's inked width), and whether it's a curve (rounded through
 * its points) or straight runs with corners */
type St = { p: number[][]; c?: boolean };
type Cap = { w: number; s: St[] };
const L_ = (...p: number[][]): St => ({ p }), C_ = (...p: number[][]): St => ({ p, c: true });
// (the bowls and rounds, shared)
const RING = (w: number): St => C_([w * 0.52, 1], [w * 0.14, 0.88], [0, 0.5], [w * 0.14, 0.11], [w * 0.5, 0], [w * 0.86, 0.11], [w, 0.5], [w * 0.86, 0.89], [w * 0.5, 1], [w * 0.3, 0.97]);
const BOWL = (w: number, y0: number, y1: number): St => C_([0, y1], [w * 0.62, y1], [w * 0.92, y1 - (y1 - y0) * 0.18], [w, (y0 + y1) / 2], [w * 0.92, y0 + (y1 - y0) * 0.18], [w * 0.62, y0], [0, y0]);
const CAPS: Record<string, Cap> = {
  A: { w: 0.76, s: [L_([0, 0], [0.38, 1]), L_([0.38, 1], [0.76, 0]), L_([0.16, 0.3], [0.6, 0.3])] },
  B: { w: 0.7, s: [L_([0, 0], [0, 1]), C_([0, 1], [0.42, 1], [0.62, 0.9], [0.64, 0.74], [0.5, 0.56], [0.06, 0.53], [0.56, 0.5], [0.7, 0.34], [0.68, 0.12], [0.46, 0], [0, 0])] },
  C: { w: 0.72, s: [C_([0.7, 0.8], [0.52, 0.99], [0.24, 0.96], [0.03, 0.72], [0.01, 0.32], [0.2, 0.04], [0.5, 0], [0.71, 0.2])] },
  D: { w: 0.72, s: [L_([0, 0], [0, 1]), BOWL(0.72, 0, 1)] },
  E: { w: 0.62, s: [L_([0, 0], [0, 1]), L_([0, 1], [0.6, 1]), L_([0, 0.5], [0.52, 0.5]), L_([0, 0], [0.62, 0])] },
  F: { w: 0.58, s: [L_([0, 0], [0, 1]), L_([0, 1], [0.58, 1]), L_([0, 0.48], [0.5, 0.48])] },
  G: { w: 0.76, s: [C_([0.72, 0.8], [0.54, 0.99], [0.24, 0.96], [0.03, 0.72], [0.01, 0.32], [0.2, 0.04], [0.5, 0], [0.7, 0.1], [0.76, 0.3], [0.76, 0.44]), L_([0.76, 0.44], [0.42, 0.44])] },
  H: { w: 0.72, s: [L_([0, 0], [0, 1]), L_([0.72, 0], [0.72, 1]), L_([0, 0.5], [0.72, 0.5])] },
  I: { w: 0.26, s: [L_([0.13, 0], [0.13, 1])] },
  J: { w: 0.58, s: [C_([0.58, 1], [0.58, 0.32], [0.48, 0.06], [0.28, 0], [0.06, 0.08], [0, 0.28])] },
  K: { w: 0.74, s: [L_([0, 0], [0, 1]), L_([0.72, 1], [0.04, 0.38]), L_([0.26, 0.58], [0.74, 0])] },
  L: { w: 0.58, s: [L_([0, 1], [0, 0], [0.58, 0])] },
  M: { w: 0.92, s: [L_([0, 0], [0.02, 1], [0.46, 0.3], [0.9, 1], [0.92, 0])] },
  N: { w: 0.72, s: [L_([0, 0], [0, 1], [0.72, 0], [0.72, 1])] },
  O: { w: 0.8, s: [RING(0.8)] },
  P: { w: 0.66, s: [L_([0, 0], [0, 1]), BOWL(0.66, 0.44, 1)] },
  Q: { w: 0.8, s: [RING(0.8), L_([0.46, 0.28], [0.82, -0.06])] },
  R: { w: 0.7, s: [L_([0, 0], [0, 1]), BOWL(0.66, 0.46, 1), L_([0.32, 0.46], [0.7, 0])] },
  S: { w: 0.68, s: [C_([0.66, 0.84], [0.5, 0.99], [0.2, 0.98], [0.03, 0.8], [0.1, 0.6], [0.5, 0.47], [0.67, 0.28], [0.56, 0.04], [0.26, 0], [0, 0.16])] },
  T: { w: 0.66, s: [L_([0, 1], [0.66, 1]), L_([0.33, 1], [0.33, 0])] },
  U: { w: 0.72, s: [C_([0, 1], [0, 0.34], [0.1, 0.08], [0.36, 0], [0.62, 0.08], [0.72, 0.34], [0.72, 1])] },
  V: { w: 0.74, s: [L_([0, 1], [0.37, 0], [0.74, 1])] },
  W: { w: 1.02, s: [L_([0, 1], [0.24, 0], [0.51, 0.74], [0.78, 0], [1.02, 1])] },
  X: { w: 0.72, s: [L_([0, 1], [0.72, 0]), L_([0.72, 1], [0, 0])] },
  Y: { w: 0.74, s: [L_([0, 1], [0.37, 0.48], [0.74, 1]), L_([0.37, 0.48], [0.37, 0])] },
  Z: { w: 0.66, s: [L_([0, 1], [0.64, 1], [0, 0], [0.66, 0])] },
  '0': { w: 0.64, s: [RING(0.64)] },
  '1': { w: 0.4, s: [L_([0, 0.78], [0.28, 1], [0.28, 0])] },
  '2': { w: 0.64, s: [C_([0.02, 0.76], [0.18, 0.97], [0.44, 1], [0.62, 0.84], [0.58, 0.56], [0.3, 0.3], [0, 0.02]), L_([0, 0], [0.64, 0])] },
  '3': { w: 0.64, s: [C_([0.04, 0.86], [0.26, 1], [0.52, 0.97], [0.6, 0.78], [0.44, 0.56], [0.22, 0.54], [0.48, 0.5], [0.64, 0.32], [0.58, 0.08], [0.32, 0], [0.03, 0.1])] },
  '4': { w: 0.68, s: [L_([0.5, 0], [0.5, 1], [0, 0.3], [0.68, 0.3])] },
  '5': { w: 0.64, s: [L_([0.6, 1], [0.1, 1], [0.06, 0.56]), C_([0.06, 0.56], [0.36, 0.64], [0.6, 0.5], [0.64, 0.24], [0.48, 0.02], [0.24, 0], [0.02, 0.12])] },
  '6': { w: 0.64, s: [C_([0.58, 0.94], [0.34, 1], [0.1, 0.84], [0.01, 0.42], [0.12, 0.06], [0.36, 0], [0.6, 0.12], [0.64, 0.38], [0.46, 0.58], [0.2, 0.58], [0.03, 0.4])] },
  '7': { w: 0.64, s: [L_([0, 1], [0.64, 1], [0.24, 0])] },
  '8': { w: 0.64, s: [C_([0.32, 0.55], [0.08, 0.68], [0.1, 0.92], [0.32, 1], [0.54, 0.92], [0.56, 0.68], [0.32, 0.55], [0.04, 0.4], [0.04, 0.12], [0.32, 0], [0.6, 0.12], [0.6, 0.4], [0.32, 0.55])] },
  '9': { w: 0.64, s: [C_([0.61, 0.6], [0.44, 0.42], [0.18, 0.42], [0.01, 0.6], [0.04, 0.88], [0.3, 1], [0.54, 0.94], [0.63, 0.58], [0.52, 0.16], [0.28, 0], [0.06, 0.06])] },
  '!': { w: 0.26, s: [L_([0.13, 1], [0.13, 0.32]), L_([0.13, 0.09], [0.13, 0])] },
  '-': { w: 0.44, s: [L_([0, 0.44], [0.44, 0.44])] },
  '×': { w: 0.5, s: [L_([0, 0.16], [0.5, 0.7]), L_([0.5, 0.16], [0, 0.7])] },
  '.': { w: 0.24, s: [L_([0.12, 0.09], [0.12, 0])] },
  "'": { w: 0.22, s: [L_([0.11, 1], [0.09, 0.7])] },
};
// (the title's weight and setting: a stroke about a fifth of the cap height, letters close, barely slanted)
// (the flats: loaded, their bristles along them. Under each, a solid core a little narrower, so the letter's shape is as
// crisp as the title's and the bristles are the paint on it, not its outline)
const STAMPS = [0, 1, 0, 7];
const WEIGHT = 0.19, SLANT = 0.09, GAP = 0.06, SPACE = 0.3;

type Laid = { pts: number[][]; len: number; stamp: number; at: number; dur: number; cream: string; orange: string };
type Item = { strokes: Laid[]; end: number; w: number; t0: number };
// (the colours as the scenery's strokes have them: no two alike, the snow's creams and the fence's oranges, a few a
// step darker, as a painter's strokes vary)
const CREAMS = ['#f6f0e8', '#efe7dd', '#fbf7f0', '#e6dcd2', '#f3ece4'], ORANGES = ['#ff7a2e', '#e85a0d', '#f0661a', '#d4500c'];

export class Callouts {
  private item: Item | null = null; private brush = new Brush2D(); private n = 0;
  /** a callout, lettered from game time t (s) */
  say(text: string, t: number) {
    let seed = 7 + this.n++ * 131;
    const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const strokes: Laid[] = []; let x = 0, li = 0;
    for (const ch of text.toUpperCase()) {
      const g = CAPS[ch];
      if (!g) { x += SPACE; continue; }
      // (the letters all at once, each a touch after the one before; in a letter its strokes one after another, quickly)
      let at = li++ * 0.022 + R() * 0.03;
      // (the skeleton inset by half a stroke, so the ink stays in the letter's box; each letter a touch off its line)
      const lift = (R() - 0.5) * 0.04, turn = (R() - 0.5) * 0.05, h = WEIGHT / 2, kx = (g.w - WEIGHT) / Math.max(0.01, g.w), ky = 1 - WEIGHT, cx = g.w / 2;
      for (const st of g.s) {
        const raw = st.p.map(([u, v]) => {
          const iu = h + u * kx + (R() - 0.5) * 0.02, iv = h + v * ky + (R() - 0.5) * 0.02;
          const ru = (iu - cx) * Math.cos(turn) - (iv - 0.5) * Math.sin(turn) + cx, rv = (iu - cx) * Math.sin(turn) + (iv - 0.5) * Math.cos(turn) + 0.5;
          return [x + ru + rv * SLANT, rv + lift];
        });
        const pts = st.c ? smooth(raw) : raw;
        let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const dur = 0.07 + len * 0.075;
        strokes.push({ pts, len, stamp: STAMPS[Math.floor(R() * STAMPS.length)], at, dur, cream: CREAMS[Math.floor(R() * CREAMS.length)], orange: ORANGES[Math.floor(R() * ORANGES.length)] });
        at += dur * 0.7;
      }
      x += g.w + GAP;
    }
    if (!strokes.length) return;
    this.item = { strokes, end: strokes.reduce((a, s) => Math.max(a, s.at + s.dur), 0), w: x - GAP + SLANT, t0: t };
  }
  /** drawn over the canvas (its size W × H in CSS pixels, at dpr), at game time t */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, t: number) {
    const it = this.item; if (!it) return;
    // (laid in, held, then taken up again the way it was laid: each stroke's start drawn along after it to its end, the
    // letters a touch apart as they came)
    const age = t - it.t0, hold = it.end + 0.95;
    if (age > hold + it.end) { this.item = null; return; }
    // (a cap height of about a fifteenth of the picture, smaller if the words are long)
    const k = Math.min((W * 0.8) / it.w, H * 0.065), ox = W / 2 - (it.w * k) / 2, oy = H * 0.3 + k / 2;
    // (the stamp's own bristles cover about four fifths of it across: drawn that much broader than the stroke)
    const Wd = WEIGHT * k * 1.45, at = (p: number[], dx: number, dy: number) => [ox + p[0] * k + dx, oy - p[1] * k + dy];
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const [layer, dx, dy, wk] of [[0, Wd * 0.1, Wd * 0.18, 1.06], [1, 0, 0, 1]] as [number, number, number, number][]) {
      for (const s of it.strokes) {
        const f = Math.max(0, Math.min(1, (age - s.at) / s.dur)), g = Math.max(0, Math.min(1, (age - hold - s.at) / s.dur)); if (f <= 0 || g >= 1) continue;
        const col = layer ? s.cream : s.orange;
        const pts = s.pts.map((p) => at(p, dx, dy)), run = cutTo(pts, f, g);
        if (run.length > 1) { ctx.strokeStyle = col; ctx.lineWidth = WEIGHT * k * wk * 0.5; ctx.lineCap = 'butt'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(run[0][0], run[0][1]); for (const q of run.slice(1)) ctx.lineTo(q[0], q[1]); ctx.stroke(); }
        this.brush.along(ctx, pts, Wd * wk, col, s.stamp, f, g);
      }
    }
    ctx.restore();
  }
}

/** a run of points rounded through them (Catmull-Rom, several points a span) */
function smooth(p: number[][]) {
  if (p.length < 3) return p;
  const out: number[][] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)], b = p[i], c = p[i + 1], d = p[Math.min(p.length - 1, i + 2)];
    for (let j = 1; j <= 8; j++) {
      const u = j / 8, u2 = u * u, u3 = u2 * u;
      out.push([0, 1].map((k) => 0.5 * (2 * b[k] + (-a[k] + c[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * u2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * u3)));
    }
  }
  return out;
}

/** a run between fractions g and f of its length */
function cutTo(p: number[][], f: number, g = 0) {
  if (f >= 1 && g <= 0) return p;
  const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const T = cum[cum.length - 1], a = T * g, b = T * f;
  const pt = (d: number) => { let i = 1; while (i < cum.length - 1 && cum[i] < d) i++; const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t]; };
  const out = [pt(a)]; for (let i = 1; i < p.length - 1; i++) if (cum[i] > a && cum[i] < b) out.push(p[i]); out.push(pt(b));
  return out;
}
