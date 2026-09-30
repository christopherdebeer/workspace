/**
 * Numerals and signs drawn in water. In play, only where the numeral itself is
 * the question (challenges.ts `pick`: which numeral says how many, which comes
 * next) — the leaves' dew gathers into its numeral for the question and back
 * into dew after. Debug views: `?glyphs=1 | half | morph | sheet | repeat`.
 *
 * The atlas holds only each glyph's KEY SHAPE — the path a wet fingertip takes,
 * as a few strokes — and nothing of how it is drawn. Per texel it stores how far
 * the point is from that path (the strokes merged with a smooth minimum, so
 * where they meet the distance dips and water will fill the corner) and how far
 * along its stroke the nearest free end is (so the ends can bead).
 *
 * Everything else is the hand, and belongs to the leaf (PAD_FS, seeded by the
 * leaf): a lean, a slight turn and squash, a waver in the line, the water's
 * width swelling and thinning, blobs where it pooled, beaded ends, stray drops
 * shaken off nearby. So no two sevens on the river are the same, and the same
 * leaf keeps its own. The shape moves only a little (legibility); the water on
 * it is free to be messy.
 *
 * Glyph space: y up, the glyph ~1 tall and ~0.6 wide about the origin.
 */

export const GLYPHS = '0123456789+−×÷=?';
export const GLYPH_CELL = 128; // texels per cell
export const GLYPH_SPAN = 1.28; // glyph units across a cell

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

/** Smooth minimum: where two strokes meet, the distance dips and water fills the corner. */
function smin(a: number, b: number, k: number) {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

/** The drawn half-width the shader starts from (glyph units); the hand varies it. */
export const GLYPH_W0 = 0.082;
/** Distances are stored up to this far (glyph units); beyond is just "far". */
const FAR = 0.4;
/** How far along a stroke an end is still "near" (the bead fades by then). */
const END = 0.3;

/**
 * The key shape of one glyph, GLYPH_CELL² texels, y up (row 0 at the bottom):
 * per texel [distance to the path, distance along the stroke to its nearest free end].
 */
export function glyphField(ch: string): Float32Array {
  const strokes = SHAPES[ch].map((st) => {
    const pts = st.pts;
    const len: number[] = [0];
    for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = len[len.length - 1];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { pts, len, total, closed: !!st.closed, box: [x0 - FAR, y0 - FAR, x1 + FAR, y1 + FAR] };
  });
  const N = GLYPH_CELL;
  const out = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N - 0.5) * GLYPH_SPAN;
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) * GLYPH_SPAN;
      let d = FAR;
      let e = END;
      let nearest = Infinity;
      let first = true;
      for (const st of strokes) {
        const [bx0, by0, bx1, by1] = st.box;
        if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
        // distance to this stroke's path, and where along it the nearest point lies
        let ds = Infinity;
        let at = 0;
        const { pts, len } = st;
        if (pts.length === 1) ds = Math.hypot(x - pts[0][0], y - pts[0][1]);
        for (let k = 1; k < pts.length; k++) {
          const [ax, ay] = pts[k - 1];
          const dx = pts[k][0] - ax;
          const dy = pts[k][1] - ay;
          const l2 = dx * dx + dy * dy;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
          const dd = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
          if (dd < ds) {
            ds = dd;
            at = len[k - 1] + (len[k] - len[k - 1]) * t;
          }
        }
        if (ds < nearest) {
          nearest = ds;
          e = st.closed ? END : Math.min(END, at, st.total - at);
        }
        d = first ? Math.min(FAR, ds) : smin(d, Math.min(FAR, ds), 0.035);
        first = false;
      }
      const o = (j * N + i) * 2;
      out[o] = d;
      out[o + 1] = e;
    }
  }
  return out;
}

/**
 * The whole atlas, 4 × 4 cells, row 0 at v = 0, as RGBA floats (uploaded as half
 * floats, which filter linearly everywhere): R the distance to the path, G the
 * distance along the stroke to its nearest free end, both in glyph units.
 */
export function glyphAtlas(): { data: Float32Array; size: number } {
  const bake = glyphAtlasSteps();
  let r = bake.next();
  while (!r.done) r = bake.next();
  return r.value;
}

/**
 * The same atlas, a glyph a step: the page bakes it between frames (setTimeout
 * between steps) so a phone never stalls for the second it takes all at once.
 */
export function* glyphAtlasSteps(): Generator<void, { data: Float32Array; size: number }> {
  const N = GLYPH_CELL;
  const size = N * 4;
  const data = new Float32Array(size * size * 4);
  for (let g = 0; g < GLYPHS.length; g++) {
    yield;
    const field = glyphField(GLYPHS[g]);
    const cx = (g % 4) * N;
    const cy = Math.floor(g / 4) * N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const o = ((cy + j) * size + cx + i) * 4;
        data[o] = field[(j * N + i) * 2];
        data[o + 1] = field[(j * N + i) * 2 + 1];
        data[o + 3] = 1;
      }
    }
  }
  return { data, size };
}

/** Which atlas cell draws a character (−1: none). */
export const glyphIndex = (ch: string) => GLYPHS.indexOf(ch === '-' ? '−' : ch === '*' || ch === 'x' ? '×' : ch === '/' ? '÷' : ch);
