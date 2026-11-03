/**
 * A hand that writes: Switchback's built-in autographs (the title's, and the PAR runs'), written the way a signature is,
 * not set in a font.
 *
 * Each letter is a few points the pen passes through, in a quick cursive (x-height 1, baseline 0, up is up). A word is
 * one stroke wherever its letters join. The pen lifts for figures and marks, and the dots and crossings come after the
 * word, as a hand does them. The whole is slanted, its baseline left to drift and its letters to vary a little, and it's
 * timed as a hand moves (slow round the turns, quick down the straights). The result is the same strokes the pad keeps,
 * so it inks and writes itself out exactly as a player's signature does.
 */
import type { Sig } from './sign';

/** a letter: how far it moves the pen on; the points of its main stroke (x, y pairs); whether that stroke joins its
 * neighbours, and how many of its first points are the stroke coming in from one (left off when it starts a word, or
 * when the pen `lift`s before it: a c joined into reads as an e); and its marks (strokes of their own: `now` straight after it, else after the word) */
type Glyph = { w: number; p: number[]; join?: boolean; lead?: number; lift?: boolean; marks?: { p: number[]; now?: boolean }[] };

const G: Record<string, Glyph> = {
  a: { w: 0.86, join: true, p: [0, 0.12, 0.35, 0.75, 0.6, 0.95, 0.38, 1, 0.12, 0.75, 0.06, 0.3, 0.22, 0.02, 0.45, 0.15, 0.6, 0.55, 0.64, 0.98, 0.6, 0.35, 0.64, 0.04, 0.86, 0.16] },
  c: { w: 0.64, join: true, lead: 2, lift: true, p: [0, 0.14, 0.42, 0.8, 0.5, 0.95, 0.36, 1, 0.12, 0.82, 0, 0.42, 0.1, 0.08, 0.34, 0, 0.64, 0.18] },
  d: { w: 0.9, join: true, p: [0, 0.12, 0.35, 0.75, 0.6, 0.95, 0.38, 1, 0.12, 0.75, 0.06, 0.3, 0.22, 0.02, 0.45, 0.15, 0.6, 0.55, 0.74, 1.9, 0.66, 0.4, 0.68, 0.04, 0.9, 0.16] },
  e: { w: 0.66, join: true, p: [0, 0.12, 0.36, 0.42, 0.5, 0.72, 0.36, 0.92, 0.14, 0.7, 0.08, 0.3, 0.24, 0.02, 0.66, 0.16] },
  l: { w: 0.55, join: true, p: [0, 0.12, 0.32, 0.9, 0.46, 1.6, 0.42, 1.95, 0.3, 1.85, 0.22, 1.2, 0.18, 0.4, 0.26, 0.03, 0.55, 0.16] },
  n: { w: 0.95, join: true, p: [0, 0.1, 0.12, 0.75, 0.16, 1, 0.12, 0.4, 0.1, 0, 0.18, 0.55, 0.4, 0.98, 0.58, 0.85, 0.6, 0.3, 0.66, 0.02, 0.95, 0.16] },
  p: { w: 0.88, join: true, p: [0, 0.1, 0.18, 0.95, 0.14, 0.2, 0.1, -0.95, 0.12, -0.3, 0.2, 0.55, 0.42, 0.98, 0.66, 0.75, 0.6, 0.2, 0.35, 0, 0.22, 0.1, 0.5, 0.05, 0.88, 0.18] },
  r: { w: 0.74, join: true, p: [0, 0.1, 0.18, 0.85, 0.24, 1.08, 0.3, 0.78, 0.52, 0.88, 0.5, 0.5, 0.48, 0.02, 0.74, 0.16] },
  u: { w: 0.9, join: true, p: [0, 0.1, 0.12, 1, 0.1, 0.3, 0.26, 0, 0.5, 0.35, 0.6, 1, 0.56, 0.3, 0.64, 0.02, 0.9, 0.16] },
  C: { w: 1.1, join: true, p: [0.9, 1.55, 0.98, 1.8, 0.78, 1.98, 0.42, 1.88, 0.1, 1.35, 0, 0.6, 0.22, 0.06, 0.62, 0, 0.9, 0.2] },
  '1': { w: 0.5, p: [0.06, 1.42, 0.3, 1.72, 0.26, 0.85, 0.22, 0] },
  '5': { w: 0.82, p: [0.22, 1.72, 0.16, 1, 0.4, 1.12, 0.62, 0.92, 0.66, 0.42, 0.48, 0.04, 0.22, 0.02, 0.06, 0.2], marks: [{ p: [0.24, 1.74, 0.74, 1.8], now: true }] },
  '@': { w: 1.2, p: [0.68, 0.62, 0.5, 0.78, 0.3, 0.62, 0.3, 0.32, 0.5, 0.24, 0.66, 0.5, 0.7, 0.7, 0.66, 0.36, 0.76, 0.22, 0.98, 0.42, 1, 0.9, 0.72, 1.22, 0.28, 1.2, 0.02, 0.86, -0.02, 0.3, 0.25, -0.1, 0.65, -0.18, 0.95, -0.05] },
  '.': { w: 0.42, p: [0.12, 0.06, 0.18, 0] },
  ' ': { w: 0.45, p: [] },
};

/** how a hand writes: its slant, the baseline's drift (rise per x-height across), how much its letters vary, how wide it
 * spaces them, how fast it goes (x-heights a second, down a straight), and a seed for its own wobbles */
export type Style = { slant: number; drift: number; vary: number; track: number; pace: number; seed: number };

const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** a centripetal Catmull-Rom through the points (a curve that passes through each, without overshooting into loops it
 * wasn't asked for), so many samples to a unit of length */
function spline(P: [number, number][], per = 14): [number, number][] {
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

/** the text written in the style, and any flourish after it (points in the same x-height units, given the width the
 * writing came to, joined to the last stroke if `join`). Strokes of x, y points, in writing order */
function strokes(text: string, st: Style, flourish?: (w: number) => { p: number[]; join?: boolean }) {
  const r = rnd(st.seed), out: [number, number][][] = [];
  let x = 0, word: [number, number][] | null = null, later: [number, number][][] = [];
  const place = (p: number[], dx: number, k: number) => {
    const q: [number, number][] = [];
    for (let i = 0; i < p.length; i += 2) q.push([dx + p[i] * k + (r() - 0.5) * st.vary * 0.15, p[i + 1] * k + (r() - 0.5) * st.vary * 0.12]);
    return q;
  };
  const end = () => { if (word) out.push(word); word = null; out.push(...later); later = []; };
  for (const ch of text) {
    const g = G[ch] ?? G[' '];
    if (!g.p.length) { end(); x += g.w * st.track; continue; }
    if (g.lift && word) { out.push(word); word = null; }
    const k = 1 + (r() - 0.5) * st.vary * 0.3, pts = place(word || !g.lead ? g.p : g.p.slice(g.lead * 2), x, k);
    if (g.join) { if (word) word.push(...pts); else word = pts; }
    else { if (word) { out.push(word); word = null; } out.push(pts); }
    for (const m of g.marks ?? []) (m.now ? out : later).push(place(m.p, x, k));
    x += g.w * k * st.track;
  }
  if (flourish) {
    const f = flourish(x), pts = place(f.p, 0, 1);
    if (f.join && word) (word as [number, number][]).push(...pts); else { end(); out.push(pts); }
  }
  end();
  return out.filter((s) => s.length);
}

/** written out: the strokes splined, slanted, the baseline drifting, then timed by the pace (slower through the turns,
 * a moment between strokes), into a signature's units (x-height `size` thousandths of the pad) */
export function write(text: string, st: Style, flourish?: (w: number) => { p: number[]; join?: boolean }, size = 240): Sig {
  const sig: Sig = [];
  let t = 0;
  for (const s of strokes(text, st, flourish)) {
    const pts = spline(s).map(([x, y]) => [x + st.slant * y, y + st.drift * x] as [number, number]);
    const out: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[Math.min(pts.length - 1, i + 1)];
        const turn = Math.abs(Math.atan2((bx - ax) * (cy - by) - (by - ay) * (cx - bx), (bx - ax) * (cx - bx) + (by - ay) * (cy - by)));
        const v = st.pace * (0.3 + 0.7 * Math.max(0, 1 - turn / 0.9));
        t += Math.hypot(bx - ax, by - ay) / v;
      }
      out.push(Math.round(120 + pts[i][0] * size), Math.round(700 - pts[i][1] * size), Math.round(t * 100));
    }
    sig.push(out);
    t += 0.1;
  }
  return sig;
}

/** the title's: c15r, of parc.land, quick and joined, a line struck under it */
export const C15R = write('c15r @ parc.land', { slant: 0.3, drift: 0.035, vary: 0.6, track: 1, pace: 24, seed: 15 }, (w) => ({ p: [w * 0.38, -0.55, w * 0.62, -0.62, w * 0.9, -0.5, w + 0.15, -0.2] }));

/** Claude's, for the PAR runs: the e's tail carried round and back under the name */
export const CLAUDE = write('Claude', { slant: 0.24, drift: 0.02, vary: 0.4, track: 1, pace: 20, seed: 7 }, (w) => ({ join: true, p: [w + 0.3, 0.22, w + 0.38, -0.05, w + 0.05, -0.32, w * 0.5, -0.44, 0.05, -0.3] }));
