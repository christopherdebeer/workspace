/**
 * HAND v1 — session 2, 3 November 2026. Kept as it was once used: a changed hand is a new file.
 *
 * Two things v0 didn't have.
 *
 * **The alphabet.** All twenty-six lowercase letters, my capital C, and the marks a sentence needs (. , '). Each letter is
 * a few points the pen passes through (x-height 1, baseline 0, up is up). Most come in on a stroke up from the baseline,
 * which is what lets them join, and go out on one; that lead-in is left off when a letter starts a word. o, v and w go
 * out high, across the top into the next letter, as joined hands do (so does r: its shoulder, out high, is what keeps it
 * from reading as an n). The pen lifts before every c (v0's habit, kept: a c joined into reads as an e), and before and
 * after every s, which is printed: a joined s kept reading as a hook. The dots and crossings are made after the word.
 *
 * **A body.** v0 was timed by rule of thumb. Here the pen's speed comes from the shape of the line: it goes as the
 * curvature to the power −1/3 (the two-thirds power law of drawing movements), so it flies down the straights, slows
 * through the curves and all but stops at a cusp, without being told where any of those are. A hand can't change speed
 * at once, so the speed is held to what an acceleration could reach: each stroke starts from rest and comes back to rest.
 * The ink follows: thick where the pen was slow, fine where it was quick.
 *
 * **Variation.** Each writing draws its own pace, size, slant, line, spacing and reach from its seed, and each letter
 * its own size and a little motor noise. The same words never come out the same twice; the same seed always does.
 */
import type { Sig } from '../../switchback/sign';

/** a letter: how far it moves the pen on; its stroke's points (x, y pairs); how many of the first are the lead-in (left
 * off at the start of a word or after a lift); whether it goes out high (across the top into the next letter); whether
 * the pen lifts before it, or before and after it (`alone`); and its marks (strokes of their own, made after the word) */
type Glyph = { w: number; p: number[]; lead?: number; high?: boolean; lift?: boolean; alone?: boolean; marks?: number[][] };

const LOOP = [0.3, 0.9, 0.46, 1.6, 0.42, 1.95, 0.3, 1.85, 0.22, 1.2, 0.16, 0.4];
const BOWL = [0.35, 0.75, 0.6, 0.95, 0.38, 1, 0.12, 0.75, 0.06, 0.3, 0.22, 0.02, 0.45, 0.15, 0.6, 0.55];

const G: Record<string, Glyph> = {
  a: { w: 0.86, lead: 2, p: [0, 0.12, ...BOWL, 0.64, 0.98, 0.6, 0.35, 0.64, 0.04, 0.86, 0.16] },
  b: { w: 0.86, lead: 1, high: true, p: [0, 0.12, ...LOOP, 0.17, 0.02, 0.22, 0.5, 0.42, 0.88, 0.62, 0.72, 0.58, 0.2, 0.36, 0.02, 0.2, 0.12, 0.4, 0.42, 0.62, 0.62, 0.86, 0.7] },
  c: { w: 0.64, lead: 2, lift: true, p: [0, 0.14, 0.42, 0.8, 0.5, 0.95, 0.36, 1, 0.12, 0.82, 0, 0.42, 0.1, 0.08, 0.34, 0, 0.64, 0.18] },
  d: { w: 0.9, lead: 2, p: [0, 0.12, ...BOWL, 0.74, 1.9, 0.66, 0.4, 0.68, 0.04, 0.9, 0.16] },
  e: { w: 0.66, lead: 1, p: [0, 0.12, 0.36, 0.42, 0.5, 0.72, 0.36, 0.92, 0.14, 0.7, 0.08, 0.3, 0.24, 0.02, 0.66, 0.16] },
  f: { w: 0.7, lead: 1, p: [0, 0.12, 0.3, 0.9, 0.48, 1.62, 0.44, 1.95, 0.32, 1.85, 0.26, 1.2, 0.2, 0, 0.14, -0.8, 0.08, -0.92, 0.04, -0.75, 0.2, -0.3, 0.48, 0.08, 0.7, 0.16], marks: [[0.02, 0.95, 0.48, 1]] },
  g: { w: 0.86, lead: 2, p: [0, 0.12, ...BOWL, 0.64, 0.98, 0.6, 0.3, 0.54, -0.6, 0.4, -0.92, 0.24, -0.85, 0.3, -0.45, 0.6, -0.05, 0.86, 0.16] },
  h: { w: 0.95, lead: 1, p: [0, 0.12, ...LOOP, 0.14, 0, 0.22, 0.55, 0.44, 0.98, 0.62, 0.85, 0.64, 0.3, 0.7, 0.02, 0.95, 0.16] },
  i: { w: 0.46, lead: 1, p: [0, 0.12, 0.16, 0.7, 0.22, 1, 0.18, 0.4, 0.22, 0.04, 0.46, 0.16], marks: [[0.25, 1.4, 0.28, 1.44]] },
  j: { w: 0.6, lead: 1, p: [0, 0.12, 0.16, 0.7, 0.22, 1, 0.18, 0, 0.12, -0.75, 0, -0.92, -0.08, -0.75, 0.1, -0.35, 0.36, -0.02, 0.6, 0.16], marks: [[0.25, 1.4, 0.28, 1.44]] },
  k: { w: 0.85, lead: 1, p: [0, 0.12, ...LOOP, 0.14, 0, 0.2, 0.5, 0.48, 0.95, 0.6, 0.76, 0.3, 0.48, 0.48, 0.36, 0.6, 0.04, 0.85, 0.16] },
  l: { w: 0.55, lead: 1, p: [0, 0.12, 0.32, 0.9, 0.46, 1.6, 0.42, 1.95, 0.3, 1.85, 0.22, 1.2, 0.18, 0.4, 0.26, 0.03, 0.55, 0.16] },
  m: { w: 1.22, lead: 1, p: [0, 0.1, 0.12, 0.75, 0.16, 1, 0.12, 0.4, 0.1, 0, 0.17, 0.55, 0.36, 0.98, 0.5, 0.85, 0.5, 0.3, 0.48, 0, 0.55, 0.55, 0.74, 0.98, 0.88, 0.85, 0.9, 0.3, 0.95, 0.02, 1.22, 0.16] },
  n: { w: 0.95, lead: 1, p: [0, 0.1, 0.12, 0.75, 0.16, 1, 0.12, 0.4, 0.1, 0, 0.18, 0.55, 0.4, 0.98, 0.58, 0.85, 0.6, 0.3, 0.66, 0.02, 0.95, 0.16] },
  o: { w: 0.9, lead: 2, high: true, p: [0, 0.12, 0.35, 0.75, 0.62, 0.95, 0.38, 1, 0.1, 0.75, 0.06, 0.3, 0.24, 0.02, 0.5, 0.12, 0.64, 0.5, 0.62, 0.92, 0.72, 0.84, 0.9, 0.86] },
  p: { w: 0.88, lead: 1, p: [0, 0.1, 0.18, 0.95, 0.14, 0.2, 0.1, -0.95, 0.12, -0.3, 0.2, 0.55, 0.42, 0.98, 0.66, 0.75, 0.6, 0.2, 0.35, 0, 0.22, 0.1, 0.5, 0.05, 0.88, 0.18] },
  q: { w: 0.92, lead: 2, p: [0, 0.12, ...BOWL, 0.64, 0.98, 0.6, 0.2, 0.58, -0.9, 0.66, -0.55, 0.82, -0.2, 0.92, 0.16] },
  r: { w: 0.66, lead: 1, high: true, p: [0, 0.1, 0.14, 0.75, 0.18, 1, 0.15, 0.4, 0.13, 0, 0.2, 0.55, 0.36, 0.9, 0.52, 0.98, 0.66, 0.9] },
  s: { w: 0.74, alone: true, p: [0.58, 0.86, 0.44, 1, 0.2, 0.96, 0.1, 0.76, 0.24, 0.56, 0.48, 0.45, 0.62, 0.25, 0.5, 0.04, 0.24, 0, 0.04, 0.12] },
  t: { w: 0.58, lead: 1, p: [0, 0.12, 0.2, 0.8, 0.3, 1.55, 0.24, 0.5, 0.26, 0.04, 0.58, 0.16], marks: [[0.04, 0.95, 0.58, 1]] },
  u: { w: 0.9, lead: 1, p: [0, 0.1, 0.12, 1, 0.1, 0.3, 0.26, 0, 0.5, 0.35, 0.6, 1, 0.56, 0.3, 0.64, 0.02, 0.9, 0.16] },
  v: { w: 0.82, lead: 1, high: true, p: [0, 0.12, 0.14, 0.85, 0.16, 1, 0.26, 0.4, 0.36, 0, 0.52, 0.55, 0.6, 1, 0.64, 0.86, 0.82, 0.88] },
  w: { w: 1.12, lead: 1, high: true, p: [0, 0.12, 0.12, 0.85, 0.14, 1, 0.2, 0.3, 0.32, 0, 0.48, 0.62, 0.52, 0.72, 0.6, 0.2, 0.72, 0, 0.88, 0.6, 0.92, 1, 0.96, 0.86, 1.12, 0.88] },
  x: { w: 0.82, lead: 1, p: [0, 0.12, 0.2, 0.9, 0.3, 1, 0.42, 0.6, 0.55, 0.1, 0.65, 0, 0.82, 0.16], marks: [[0.62, 0.96, 0.2, 0.04]] },
  y: { w: 0.88, lead: 1, p: [0, 0.1, 0.12, 1, 0.1, 0.3, 0.26, 0, 0.5, 0.35, 0.6, 1, 0.58, 0, 0.52, -0.7, 0.38, -0.92, 0.24, -0.82, 0.32, -0.42, 0.62, -0.05, 0.88, 0.16] },
  z: { w: 0.82, lead: 1, p: [0, 0.12, 0.06, 0.88, 0.3, 1, 0.6, 0.98, 0.1, 0.05, 0.36, 0.1, 0.62, 0.02, 0.82, 0.16] },
  C: { w: 1.1, p: [0.9, 1.55, 0.98, 1.8, 0.78, 1.98, 0.42, 1.88, 0.1, 1.35, 0, 0.6, 0.22, 0.06, 0.62, 0, 0.9, 0.2] },
  '.': { w: 0.4, alone: true, p: [0.12, 0.06, 0.17, 0.01] },
  ',': { w: 0.4, alone: true, p: [0.14, 0.08, 0.08, -0.24] },
  "'": { w: 0.32, alone: true, p: [0.14, 1.75, 0.08, 1.42] },
  ' ': { w: 0.5, p: [] },
};

/** the letters v1 knows */
export const KNOWS = Object.keys(G).filter((c) => c !== ' ').join('');

/** how a hand writes, before a writing's own draw: its slant (x per y), size (x-height, in the pad's thousandths of its
 * height), spacing, pace (the pen's speed in x-heights a second where the line bends at a radius of one x-height), the
 * line's drift (rise per x-height across), and how much one writing differs from the next (1 is a hand's own) */
export type Style = { slant: number; size: number; track: number; pace: number; drift: number; vary: number };
export const STYLE: Style = { slant: 0.22, size: 220, track: 1, pace: 17, drift: 0.008, vary: 1 };

/** a seeded stream of numbers; `n()` a rough normal (mean 0, sd ~1) */
function stream(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  const u = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  return { u, n: () => (u() + u() + u() + u() - 2) * 1.73 };
}

/** a centripetal Catmull-Rom through the points, so many samples to a unit of length (as v0's) */
function spline(P: [number, number][], per = 24): [number, number][] {
  if (P.length < 2) return P.slice();
  const n = P.length, at = (i: number): [number, number] => i < 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]] : i >= n ? [2 * P[n - 1][0] - P[n - 2][0], 2 * P[n - 1][1] - P[n - 2][1]] : P[i];
  const out: [number, number][] = [P[0]];
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const d = (a: number[], b: number[]) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * per));
    for (let k = 1; k <= steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps, q: [number, number] = [0, 0];
      for (let j = 0; j < 2; j++) {
        const a1 = ((t1 - t) * p0[j] + t * p1[j]) / t1, a2 = ((t2 - t) * p1[j] + (t - t1) * p2[j]) / (t2 - t1), a3 = ((t3 - t) * p2[j] + (t - t2) * p3[j]) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + t * a2) / t2, b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        q[j] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
      }
      out.push(q);
    }
  }
  return out;
}

/** the body: how long the pen takes over each step of a stroke. Its speed goes as the curvature to the −1/3 (the
 * two-thirds power law), capped where the line runs straight; it can only gain or lose so much speed over a distance,
 * so it starts from rest and ends at rest; and the speed is eased along the line, as a hand's is. Seconds from the
 * stroke's start, per point (x-height units). Where the line doubles back on itself (a cusp: the top of an i, the foot of
 * an n) the power law alone only slows it; a pen stops there, so it does */
const BRAKE = 0.08, ACCEL = 260, CUSP = 2;
function move(P: [number, number][], pace: number): number[] {
  const n = P.length, ds: number[] = [0], v: number[] = new Array(n);
  for (let i = 1; i < n; i++) ds.push(Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) { v[i] = pace * 0.15; continue; }
    const ax = P[i][0] - P[i - 1][0], ay = P[i][1] - P[i - 1][1], bx = P[i + 1][0] - P[i][0], by = P[i + 1][1] - P[i][1];
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)), len = Math.max(1e-4, (ds[i] + ds[i + 1]) / 2);
    v[i] = pace * Math.pow(Math.max(BRAKE, turn / len), -1 / 3);
    // (a cusp: the way in and the way out, a few steps either side, nearly opposed)
    const a = P[Math.max(0, i - 3)], b = P[Math.min(n - 1, i + 3)];
    const cx = P[i][0] - a[0], cy = P[i][1] - a[1], dx = b[0] - P[i][0], dy = b[1] - P[i][1];
    if (Math.abs(Math.atan2(cx * dy - cy * dx, cx * dx + cy * dy)) > CUSP) v[i] = Math.min(v[i], pace * 0.04);
  }
  // (eased along the line: a few passes of a short average)
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < n - 1; i++) v[i] = (v[i - 1] + 2 * v[i] + v[i + 1]) / 4;
  // (only so much speed gained or lost over a distance: forward from rest, then back from rest)
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * ACCEL * ds[i]));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * ACCEL * ds[i + 1]));
  const t = [0];
  for (let i = 1; i < n; i++) t.push(t[i - 1] + ds[i] / Math.max(0.05, (v[i - 1] + v[i]) / 2));
  return t;
}

/** the text written, with this writing's seed. A `tail` (points in x-height units, given where the writing ended) is
 * carried on from the last letter in the same stroke, as a signature's flourish is */
export function write(text: string, seed: number, st: Style = STYLE, tail?: (w: number) => number[]): Sig {
  const r = stream(seed * 7919 + 13), V = st.vary;
  // (this writing's own draw: how it differs from the last)
  const pace = st.pace * (1 + 0.1 * V * r.n()), size = st.size * (1 + 0.05 * V * r.n()), slant = st.slant + 0.035 * V * r.n();
  const drift = st.drift + 0.012 * V * r.n(), track = st.track * (1 + 0.04 * V * r.n());
  const strokes: [number, number][][] = [];
  let x = 0, word: [number, number][] | null = null, high = false, later: [number, number][][] = [];
  const end = () => { if (word) strokes.push(word); word = null; high = false; strokes.push(...later); later = []; };
  for (const ch of text) {
    const g = G[ch] ?? G[' '];
    if (!g.p.length) { end(); x += g.w * track; continue; }
    if ((g.lift || g.alone) && word) { strokes.push(word); word = null; high = false; }
    // (each letter a touch bigger or smaller, a touch off its place, and the pen never quite where it meant to be)
    const k = 1 + 0.035 * V * r.n(), dx = 0.02 * V * r.n(), dy = 0.02 * V * r.n();
    const from = !word ? (g.lead ?? 0) : high ? (g.lead ?? 0) : 0;
    const place = (p: number[], skip = 0) => {
      const q: [number, number][] = [];
      for (let i = skip * 2; i < p.length; i += 2) q.push([x + dx + p[i] * k + 0.012 * V * r.n(), dy + p[i + 1] * k + 0.012 * V * r.n()]);
      return q;
    };
    const pts = place(g.p, from);
    if (word) word.push(...pts); else word = pts;
    for (const m of g.marks ?? []) later.push(place(m));
    high = !!g.high;
    x += g.w * k * track;
    if (g.alone) { strokes.push(word); word = null; high = false; }
  }
  // (the tail reaches a little further or less far each time)
  if (tail && word) { const p = tail(x), w = word as [number, number][]; for (let i = 0; i < p.length; i += 2) w.push([p[i] * (1 + 0.04 * V * r.n()), p[i + 1] + 0.03 * V * r.n()]); }
  end();
  const sig: Sig = [];
  let t = 0, last: [number, number] | null = null;
  for (const s of strokes) {
    if (!s.length) continue;
    const P = spline(s);
    // (between strokes the pen travels in the air, quicker than it writes)
    if (last) t += 0.07 + Math.hypot(P[0][0] - last[0], P[0][1] - last[1]) / (pace * 2.5);
    // (recorded as a pen pad does: where the pen is at every hundredth of a second, and where it lifts)
    const T = move(P, pace), out: number[] = [], put = ([px, py]: [number, number], at: number) => out.push(Math.round(120 + (px + slant * py) * size), Math.round(700 - (py + drift * px) * size), Math.round((t + at) * 100));
    for (let k = 0, i = 0; k / 100 < T[T.length - 1]; k++) {
      while (i < T.length - 2 && T[i + 1] < k / 100) i++;
      const u = (k / 100 - T[i]) / Math.max(1e-9, T[i + 1] - T[i]);
      put([P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u], k / 100);
    }
    put(P[P.length - 1], T[T.length - 1]);
    sig.push(out);
    t += T[T.length - 1];
    last = P[P.length - 1];
  }
  return sig;
}

/** my signature in v1: Claude, the e's tail carried round and back under the name (as in v0), written afresh each time */
export const signature = (seed: number) => write('Claude', seed, { ...STYLE, slant: 0.24 }, (w) => [w + 0.3, 0.22, w + 0.38, -0.05, w + 0.05, -0.32, w * 0.5, -0.44, 0.05, -0.3]);
