/**
 * Numerals and signs drawn in water (an experiment: `?glyphs=1`, `?glyphs=sheet`).
 *
 * A glyph is not a font. Each is a few strokes — the path a wet fingertip would
 * take — and each stroke is a bead of water lying on the leaf: a rivulet whose
 * cross-section is a circular cap, swelling into round terminals where it ends
 * (surface tension pulls the ends into beads), wavering a little in width
 * along its length, and filling the corners where strokes meet with a meniscus
 * (the strokes are merged with a smooth minimum, not overlapped). A few stray
 * droplets lie about it, as if shaken from the finger.
 *
 * The result is baked once into a height field (an atlas, 4 × 4 cells) that
 * the pad shader lights with the same model as the dew: the leaf magnified
 * through the water, a dark contact line on the sun side, a thin bright rim on
 * the other, the sky only at the very edge, one sharp pinpoint — which on a
 * rivulet runs along the stroke as a streak — and a small shadow.
 *
 * Glyph space: y up, the glyph ~1 tall and ~0.6 wide about the origin.
 */

export const GLYPHS = '0123456789+−×÷=?';
export const GLYPH_CELL = 128; // texels per cell
export const GLYPH_SPAN = 1.28; // glyph units across a cell
/** Height is stored as h / GLYPH_HMAX in 0..1. */
export const GLYPH_HMAX = 0.16;

type P = [number, number];
interface Stroke {
  pts: P[];
  closed?: boolean;
  /** A bead: one point, drawn as a drop of this radius. */
  dot?: number;
}

const line = (...pts: P[]): Stroke => ({ pts });
const curve = (...ctrl: P[]): Stroke => ({ pts: catmull(ctrl, false) });
const loop = (...ctrl: P[]): Stroke => ({ pts: catmull(ctrl, true), closed: true });
const ellipse = (cx: number, cy: number, rx: number, ry: number): Stroke => {
  const pts: P[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return { pts, closed: true };
};
const dot = (x: number, y: number, r = 0.1): Stroke => ({ pts: [[x, y]], dot: r });

/** Catmull-Rom through the control points (8 samples a span). */
function catmull(c: P[], closed: boolean): P[] {
  const n = c.length;
  const at = (i: number): P => (closed ? c[(i + n) % n] : c[Math.max(0, Math.min(n - 1, i))]);
  const out: P[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < 8; k++) {
      const t = k / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  if (!closed) out.push(c[n - 1]);
  return out;
}

const SHAPES: Record<string, Stroke[]> = {
  '0': [loop([0, 0.47], [-0.21, 0.35], [-0.27, 0], [-0.21, -0.35], [0, -0.47], [0.21, -0.35], [0.27, 0], [0.21, 0.35])],
  '1': [line([-0.16, 0.27], [0.03, 0.46]), line([0.03, 0.46], [0.03, -0.47])],
  '2': [curve([-0.24, 0.24], [-0.12, 0.41], [0.06, 0.46], [0.22, 0.36], [0.24, 0.17], [0.1, -0.04], [-0.26, -0.46]), line([-0.26, -0.46], [0.28, -0.46])],
  '3': [
    curve([-0.22, 0.35], [-0.05, 0.46], [0.15, 0.44], [0.24, 0.28], [0.16, 0.1], [-0.05, 0.03]),
    curve([-0.05, 0.03], [0.18, -0.03], [0.27, -0.22], [0.18, -0.4], [-0.02, -0.47], [-0.25, -0.36]),
  ],
  '4': [line([0.12, 0.47], [-0.28, -0.15]), line([-0.28, -0.15], [0.3, -0.15]), line([0.14, 0.26], [0.14, -0.47])],
  '5': [
    line([0.25, 0.46], [-0.17, 0.46]),
    line([-0.17, 0.46], [-0.21, 0.07]),
    curve([-0.21, 0.07], [0.03, 0.13], [0.22, 0.03], [0.27, -0.2], [0.16, -0.4], [-0.04, -0.47], [-0.25, -0.38]),
  ],
  '6': [curve([0.2, 0.42], [0.02, 0.47], [-0.17, 0.34], [-0.26, 0.06], [-0.25, -0.25], [-0.12, -0.44], [0.05, -0.47], [0.22, -0.36], [0.27, -0.17], [0.18, 0.0], [0.0, 0.04], [-0.18, -0.04], [-0.25, -0.18])],
  '7': [line([-0.26, 0.46], [0.27, 0.46]), curve([0.27, 0.46], [0.1, 0.08], [-0.04, -0.47])],
  '8': [ellipse(0, 0.25, 0.18, 0.2), ellipse(0, -0.21, 0.24, 0.25)],
  '9': [curve([-0.2, -0.42], [-0.02, -0.47], [0.17, -0.34], [0.26, -0.06], [0.25, 0.25], [0.12, 0.44], [-0.05, 0.47], [-0.22, 0.36], [-0.27, 0.17], [-0.18, 0.0], [0.0, -0.04], [0.18, 0.04], [0.25, 0.18])],
  '+': [line([-0.3, 0], [0.3, 0]), line([0, 0.3], [0, -0.3])],
  '−': [line([-0.3, 0], [0.3, 0])],
  '×': [line([-0.22, 0.22], [0.22, -0.22]), line([-0.22, -0.22], [0.22, 0.22])],
  '÷': [line([-0.3, 0], [0.3, 0]), dot(0, 0.26, 0.095), dot(0, -0.26, 0.095)],
  '=': [line([-0.28, 0.14], [0.28, 0.14]), line([-0.28, -0.14], [0.28, -0.14])],
  '?': [curve([-0.22, 0.28], [-0.1, 0.43], [0.08, 0.46], [0.23, 0.34], [0.2, 0.14], [0.02, 0.02], [0.0, -0.18]), dot(0, -0.42, 0.1)],
};

/** A small deterministic stream per glyph (the stray droplets, the waver). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Smooth minimum: where two strokes meet, water fills the corner. */
function smin(a: number, b: number, k: number) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

/** Half-width of a rivulet (glyph units). */
const W0 = 0.082;

interface Seg {
  ax: number; ay: number; bx: number; by: number;
  /** Half-width at a and at b. */
  wa: number; wb: number;
}

/** A stroke as width-carrying segments: beaded terminals, a gentle waver. */
function segments(st: Stroke, rand: () => number): Seg[] {
  const pts = st.pts;
  if (st.dot) return [{ ax: pts[0][0], ay: pts[0][1], bx: pts[0][0], by: pts[0][1], wa: st.dot, wb: st.dot }];
  const len: number[] = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1] || 1;
  const phase = rand() * 6.28;
  // a whole number of wavers round a closed stroke, so it meets itself without a seam
  const waves = Math.max(1, Math.round((total * (9 + rand() * 5)) / (Math.PI * 2)));
  const freq = (waves * Math.PI * 2) / total;
  const width = (s: number) => {
    const waver = 1 + 0.07 * Math.sin(s * freq + phase) + 0.04 * Math.sin(s * 2 * freq + phase * 1.7);
    // the ends gather into beads, a little fuller than the stroke
    const end = st.closed ? 0 : Math.exp(-Math.pow(s / 0.07, 2)) + Math.exp(-Math.pow((total - s) / 0.07, 2));
    return W0 * waver * (1 + 0.28 * end);
  };
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    out.push({ ax: pts[i - 1][0], ay: pts[i - 1][1], bx: pts[i][0], by: pts[i][1], wa: width(len[i - 1]), wb: width(len[i]) });
  }
  return out;
}

/** Height of a rivulet segment at a point: a round bead swept along it (0 outside). */
function segHeight(s: Seg, x: number, y: number): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0;
  const w = s.wa + (s.wb - s.wa) * t;
  const d = Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t));
  return d < w ? Math.sqrt(w * w - d * d) : 0;
}

/** Signed distance to a rivulet's outline (negative inside) and its half-width there. */
function segDist(s: Seg, x: number, y: number): [number, number] {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2)) : 0;
  const w = s.wa + (s.wb - s.wa) * t;
  return [Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t)) - w, w];
}

/**
 * The height field for one glyph, GLYPH_CELL² texels, y up (row 0 at the bottom
 * of the cell), normalised by GLYPH_HMAX.
 */
export function glyphField(ch: string): Float32Array {
  const shapes = SHAPES[ch];
  const rand = rng(0x9e3779b9 ^ (ch.charCodeAt(0) * 2654435761));
  // each stroke's own outline, merged stroke with stroke
  const strokes = shapes.map((st) => segments(st, rand));
  // stray droplets shaken off the finger: a few, small, close to the strokes
  const strays: Array<[number, number, number]> = [];
  const all = strokes.flat();
  for (let tries = 0; strays.length < 3 + Math.floor(rand() * 3) && tries < 200; tries++) {
    const s = all[Math.floor(rand() * all.length)];
    const u = rand();
    const a = rand() * Math.PI * 2;
    const off = W0 * (2.2 + rand() * 1.6);
    const x = s.ax + (s.bx - s.ax) * u + Math.cos(a) * off;
    const y = s.ay + (s.by - s.ay) * u + Math.sin(a) * off;
    const r = 0.016 + rand() * 0.03;
    // not touching any stroke, nor another stray
    let clear = Math.abs(x) < 0.55 && Math.abs(y) < 0.58;
    for (const t of all) if (clear && segDist(t, x, y)[0] < r + 0.025) clear = false;
    for (const [sx, sy, sr] of strays) if (clear && Math.hypot(sx - x, sy - y) < sr + r + 0.03) clear = false;
    if (clear) strays.push([x, y, r]);
  }

  const N = GLYPH_CELL;
  const out = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N - 0.5) * GLYPH_SPAN;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) * GLYPH_SPAN;
      // the strokes themselves: the highest bead over this point (continuous everywhere)
      let h = 0;
      for (const segs of strokes) for (const sg of segs) h = Math.max(h, segHeight(sg, x, y));
      // where strokes meet, water fills the corner: a meniscus from the smoothly merged
      // outlines, lower than the strokes, only where they come together
      if (strokes.length > 1) {
        let f = Infinity;
        for (const segs of strokes) {
          let fs = Infinity;
          for (const sg of segs) fs = Math.min(fs, segDist(sg, x, y)[0]);
          f = f === Infinity ? fs : smin(f, fs, 0.05);
        }
        const into = Math.max(0, -f);
        if (into > 0) h = Math.max(h, Math.sqrt(Math.max(0, into * (2 * W0 - into))) * 0.85);
      }
      for (const [sx, sy, sr] of strays) {
        const d = Math.hypot(x - sx, y - sy);
        if (d < sr) h = Math.max(h, Math.sqrt(sr * sr - d * d) * 0.9);
      }
      out[j * N + i] = Math.min(1, h / GLYPH_HMAX);
    }
  }
  return out;
}

/**
 * The whole atlas, 4 × 4 cells, row 0 at v = 0, as RGBA floats (uploaded as half
 * floats, which filter linearly everywhere): R the height (normalised by
 * GLYPH_HMAX), G and B its slope across and up the glyph (height per glyph unit,
 * in true units), from the float field — so the light runs smoothly along a
 * stroke rather than stepping with an 8-bit height.
 */
export function glyphAtlas(): { data: Float32Array; size: number } {
  const N = GLYPH_CELL;
  const size = N * 4;
  const data = new Float32Array(size * size * 4);
  const step = GLYPH_SPAN / N;
  [...GLYPHS].forEach((ch, g) => {
    const field = glyphField(ch);
    const at = (i: number, j: number) => field[Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))];
    const cx = (g % 4) * N;
    const cy = Math.floor(g / 4) * N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const o = ((cy + j) * size + cx + i) * 4;
        data[o] = at(i, j);
        data[o + 1] = ((at(i + 1, j) - at(i - 1, j)) * GLYPH_HMAX) / (2 * step);
        data[o + 2] = ((at(i, j + 1) - at(i, j - 1)) * GLYPH_HMAX) / (2 * step);
        data[o + 3] = 1;
      }
    }
  });
  return { data, size };
}

/** Which atlas cell draws a character (−1: none). */
export const glyphIndex = (ch: string) => GLYPHS.indexOf(ch === '-' ? '−' : ch === '*' || ch === 'x' ? '×' : ch === '/' ? '÷' : ch);
