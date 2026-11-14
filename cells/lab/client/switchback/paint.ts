/**
 * Switchback painted (`paint=1`): the mountain, and everything on it, laid in brush strokes, with nothing under them.
 *
 * The facets stay underneath as the underpainting (so nothing is ever a hole), and the strokes go over them, each one a
 * mark with a reason: planted on a face of the ground where the chunk is built, running the way that ground runs (along
 * the road on the road, across the slope on the snow, down the face on rock, level on the far ranges), coloured from the
 * same four bands the facets use, its bristles mixing toward the band next to it so the colour breaks up as paint does.
 * The strokes are small and close by the road and grow and thin away from it, so where you ride is drawn finely and the
 * mountain round it in a few big marks; and thin further off still, out to the ranges. The rider, the fence, the posts,
 * the pines and the kickers aren't painted: they stay crisp, so what you have to read reads.
 *
 * A stroke is built on the screen where it's drawn: its length laid along its way as the eye sees it (never shorter than
 * a third of itself, however end-on), its width never thinner than a few pixels; and stretched along its own motion on
 * the screen since the last frame, so the speed is in the marks themselves, as far as they move and no further.
 *
 * The marks come from an atlas of brush stamps made here when the page loads (no images): each a brush of bristles,
 * every bristle carrying its own load of paint, starting and lifting a little apart from the rest, running dry along
 * the stroke, leaving a groove between it and the next, and piling paint where it lifts. A stamp's red is where paint
 * is, its green the paint's relief (the ridges catch the light), its blue which of the stroke's two colours.
 */
import type { Course } from './course';
import { M, rangeProfiles, foothillProfiles, riverLine } from './mesh';
import { ground } from './ground';
import { lines, plain, trackY } from './ruts';

// ─── the stamps ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The stamps, each a kind of brush (and two of some, loaded differently):
 * 0-1 flat · 2 round · 3 dab · 4 round · 5-6 dry flat (running out) · 7 long flat (for the far off) · 8 flick (heavy at the
 * start, whipped thin, curving) · 9 impasto (few thick bristles, deep ridges, ragged edges) · 10 scumble (broken, dragged
 * dry over the tooth) · 11 wash (soft-edged, smooth, little relief) · 12 fan (bristles splayed apart along it) · 13 knife
 * (a palette knife: flat, hard-edged, cut off on a slant, paint ridged at its sides) · 14 rake (a few distinct lines) ·
 * 15 flick, the other way. */
const KINDS = ['flat', 'flat', 'round', 'dab', 'round', 'dry', 'dry', 'long', 'flick', 'impasto', 'scumble', 'wash', 'fan', 'knife', 'rake', 'flick'] as const;
export const STAMP = { W: 256, H: 64, COLS: 4, ROWS: 4 } as const;

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x9e3779b9) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 16), 0x21f0aaad); t = Math.imul(t ^ (t >>> 15), 0x735a2d97); return ((t ^ (t >>> 15)) >>> 0) / 4294967296; }; }
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** each kind's brush: bristles (lanes), how distinct (groove: 0 none … 1 deep), how they run dry, how ragged, how wavy */
const BRUSHES: Record<(typeof KINDS)[number], { lanes: [number, number]; groove: number; dry: number; rag: number; wav: number; soft: number; relief: number }> = {
  flat: { lanes: [8, 13], groove: 0.12, dry: 0.18, rag: 0.3, wav: 0.07, soft: 0.18, relief: 0.7 },
  round: { lanes: [8, 12], groove: 0.12, dry: 0.2, rag: 0.3, wav: 0.07, soft: 0.2, relief: 0.7 },
  dab: { lanes: [6, 8], groove: 0.15, dry: 0.1, rag: 0.35, wav: 0.05, soft: 0.2, relief: 0.8 },
  dry: { lanes: [10, 15], groove: 0.25, dry: 0.65, rag: 0.55, wav: 0.07, soft: 0.15, relief: 0.6 },
  long: { lanes: [10, 14], groove: 0.1, dry: 0.15, rag: 0.25, wav: 0.03, soft: 0.2, relief: 0.5 },
  flick: { lanes: [9, 12], groove: 0.15, dry: 0.3, rag: 0.35, wav: 0.16, soft: 0.2, relief: 0.75 },
  impasto: { lanes: [5, 7], groove: 0.55, dry: 0.08, rag: 0.6, wav: 0.06, soft: 0.1, relief: 1.3 },
  scumble: { lanes: [12, 18], groove: 0.2, dry: 0.45, rag: 0.95, wav: 0.08, soft: 0.25, relief: 0.4 },
  wash: { lanes: [26, 34], groove: 0.02, dry: 0.1, rag: 0.12, wav: 0.04, soft: 0.45, relief: 0.15 },
  fan: { lanes: [6, 8], groove: 0.9, dry: 0.35, rag: 0.4, wav: 0.1, soft: 0.1, relief: 0.6 },
  knife: { lanes: [30, 40], groove: 0.03, dry: 0.05, rag: 0.15, wav: 0.0, soft: 0.04, relief: 0.5 },
  rake: { lanes: [4, 6], groove: 1, dry: 0.3, rag: 0.4, wav: 0.08, soft: 0.1, relief: 0.6 },
};

/** The atlas: STAMP.COLS × STAMP.ROWS stamps, RGBA bytes. */
export function stampAtlas(): { data: Uint8Array; w: number; h: number } {
  const { W: CW, H: CH, COLS, ROWS } = STAMP, w = CW * COLS, h = CH * ROWS, data = new Uint8Array(w * h * 4);
  KINDS.forEach((kind, idx) => {
    const B = BRUSHES[kind], R = rng(idx * 7717 + 31), lanes = B.lanes[0] + Math.floor(R() * (B.lanes[1] - B.lanes[0] + 1));
    // (each bristle: its load, where it touches down and lifts, how fast it runs dry, its share of the second colour)
    const lane = Array.from({ length: lanes }, () => ({
      load: 0.62 + R() * 0.45, start: R() * (kind === 'dab' ? 0.08 : kind === 'knife' ? 0.02 : 0.13), end: 1 - R() * (0.12 + B.dry * 0.3),
      rate: B.dry * (0.6 + R() * 0.8), tone: R(),
    }));
    // (bristles clump: each band its own width, a few broad, most narrow)
    const bounds = [0];
    for (let j = 0; j < lanes; j++) bounds.push(bounds[j] + 0.35 + 1.9 * Math.pow(R(), 1.6));
    for (let j = 0; j <= lanes; j++) bounds[j] /= bounds[lanes];
    // (neighbouring bristles were loaded together: their colours are near)
    for (let p = 0; p < 2; p++) for (let j = 1; j < lanes - 1; j++) lane[j].tone = (lane[j - 1].tone + lane[j].tone * 2 + lane[j + 1].tone) / 4;
    const wav = R() * 6.28, flip = idx === 15;
    const noise = (x: number, s: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = rng(i * 131 + s)(), b = rng((i + 1) * 131 + s)(); return a + (b - a) * u; };
    const ox = (idx % COLS) * CW, oy = Math.floor(idx / COLS) * CH;
    for (let py = 0; py < CH; py++) for (let px = 0; px < CW; px++) {
      let u = (px - 6) / (CW - 12); const v = ((py - 4) / (CH - 8)) * 2 - 1;
      if (flip) u = 1 - u;
      let cov = 0, rel = 0, tone = 0.5;
      if (u > 0 && u < 1 && v > -1 && v < 1) {
        // (the brush's outline along the stroke)
        const lift = Math.pow(1 - ss(0.72, 1, u), 0.6);
        let e: number;
        switch (kind) {
          case 'round': e = Math.pow(Math.sin(Math.PI * u), 0.55); break;
          case 'dab': e = Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 2)); break;
          case 'long': e = Math.min(1, u / 0.05) ** 0.5 * (1 - 0.45 * u) * lift; break;
          case 'flick': e = Math.min(1, u / 0.04) ** 0.4 * Math.pow(1 - u, 0.75); break;
          case 'wash': e = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.4); break;
          case 'fan': e = (0.45 + 0.55 * u) * Math.min(1, u / 0.05) ** 0.5 * (0.4 + 0.6 * lift); break;
          case 'knife': e = Math.min(1, u / 0.015); break;
          default: e = Math.min(1, u / 0.08) ** 0.6 * (0.35 + 0.65 * lift);
        }
        // (a flick bends as it goes; the rest wave a little)
        const v2 = e > 0.02 ? v / e + B.wav * Math.sin(u * 7 + wav) + (kind === 'flick' ? 0.5 * u * u : 0) : 9;
        // (a knife is cut off on a slant)
        const cut = kind === 'knife' ? u < 1 - 0.25 * (v + 1) : true;
        const edge = 1 - B.rag * 0.25 * noise(u * 30 + v * 3, idx * 53);
        if (Math.abs(v2) < edge && cut) {
          const at = (v2 + 1) / 2 + 0.9 * (noise(u * 3 + v * 2, idx * 71) - 0.5) / lanes;
          let j = 0; while (j < lanes - 1 && bounds[j + 1] < at) j++;
          const fj = Math.max(0, Math.min(1, (at - bounds[j]) / (bounds[j + 1] - bounds[j]))), L = lane[j];
          const gw = 0.5 - 0.35 * B.groove, groove = ss(0, gw, fj) * (1 - ss(1 - gw, 1, fj));
          let paint = L.load - L.rate * Math.max(0, u - L.start) ** 1.3 + (noise(u * 38 + j * 13.1, idx * 17 + j) - 0.5) * (0.2 + B.rag * 0.4);
          paint += (noise(u * 9 + j * 3.3, idx * 29) - 0.5) * 0.2;
          // (a scumble drags dry over the paper's tooth: broken in both directions)
          if (kind === 'scumble') paint -= 0.55 * noise(u * 70 + v * 23, idx * 61) * noise(u * 17 - v * 9, idx * 67);
          cov = ss(0.18, 0.36, paint) * ss(L.start, L.start + 0.03, u) * (1 - ss(L.end - 0.035, L.end, u));
          cov *= 1 - B.groove + B.groove * groove;
          cov *= 1 - ss(1 - B.soft * 1.6 - 0.05, 1, Math.abs(v2) / edge);
          // (the relief: the bristles' ridges, the paint piled where each lifts, a knife's paint pushed to its sides)
          rel = cov * B.relief * ((0.55 + 0.45 * groove) * (0.45 + 0.5 * L.load) + 0.55 * Math.exp(-(((L.end - 0.025 - u) / 0.035) ** 2)));
          if (kind === 'knife') rel = cov * (0.25 + 0.75 * ss(0.7, 0.95, Math.abs(v2)));
          tone = Math.max(0, Math.min(1, 0.5 + (L.tone - 0.5) * (kind === 'knife' ? 0.5 : 0.9) + (noise(u * 3 + v2 * 1.5, idx * 41 + 3) - 0.5) * 0.55));
        }
      }
      const o = ((oy + py) * w + ox + px) * 4;
      data[o] = Math.round(Math.min(1, cov) * 255); data[o + 1] = Math.round(Math.min(1, rel) * 255); data[o + 2] = Math.round(tone * 255); data[o + 3] = 255;
    }
  });
  return { data, w, h };
}

// ─── the strokes ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** floats per stroke: where (3), material + tone; its way (3), length; its face's normal (3), width; seed, stamp, bend,
 * kind (0 ground, culled from behind; 1 sky; 2 sky, paler; 3 both sides: things, the rider); the station it's laid at
 * (or NEVER: always laid, the backdrop and what moves), its pass (0 the masses, 1 the detail), and two spare */
export const STROKE = 20;
export const NEVER = -1e9;
const ROAD = new Set<number>([M.TRACK, M.RUT]), GROUND = new Set<number>([M.SNOW, M.SHADOW]), ROCKY = new Set<number>([M.ROCK, M.UMBER, M.GOUGE]);
const RANGE = new Set<number>([M.MTN, M.MTNSNOW, M.FAR, M.FARSNOW, M.RIDGE]);
const BACKDROP = new Set<number>([M.MTN, M.MTNSNOW, M.FAR, M.FARSNOW, M.RIDGE, M.FOREST, M.VALLEY]);
const hash2 = (a: number, b: number) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); return (h ^ (h >>> 13)) >>> 0; };

/** A line to measure against: the road's middle, a point every couple of metres: where, its way, its station. */
export function lineOf(c: Course, s0: number, s1: number) {
  const pts: number[] = [];
  for (let s = Math.max(0, s0); s <= s1; s += 2) { const p = c.point(s, 0), q = c.point(s + 1, 0), dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1; pts.push(p.x, p.y ?? 0, p.z, dx / l, dz / l, s); }
  return pts;
}

/**
 * Strokes over a mesh's faces (its vertices, four floats each: three to a triangle), enough to cover it with no
 * underpainting. Each face's strokes are its own (seeded by the face, or by its place: `place`), so a mesh built afresh
 * each frame (the rider, the ruts) keeps its strokes where they were on it.
 *
 * - the ground (the road, the snow, the rock): two passes, the masses (big, broad, laid first as the front comes) and
 *   the detail over them; sized by the road (`line`: fine by it, broad away), each laid at its station so the front
 *   lays it; running the way the ground runs (along the road and the snow by it, across the slope further off, down
 *   the face on rock);
 * - the backdrop (the ranges, the valley): big level marks, one pass, always laid;
 * - things (the fence, the posts, the pines, the kickers, the rider, a flag): small, sized by their faces, along each
 *   face's longest edge, painted on both sides; what lies flat on the ground (`flat`: your track, a shadow) is laid as
 *   the ground is.
 */
export function strokesOver(verts: Float32Array, seed: number, line: number[] | null, cap = 26000, moving = false, place = 0, flat = false): Float32Array {
  const out: number[] = [];
  const n = verts.length / 12;
  for (let t = 0; t < n && out.length / STROKE < cap; t++) {
    // (each face's strokes seeded by the face: by its place in the mesh, or, for a mesh that's a window sliding along the
    // way (`place`, the size it's known to), by where it is, so the same face keeps the same strokes as the window moves)
    const R = place > 0 ? rng(hash2(seed, hash2(Math.round((verts[t * 12] + verts[t * 12 + 4] + verts[t * 12 + 8]) / (3 * place)), Math.round((verts[t * 12 + 2] + verts[t * 12 + 6] + verts[t * 12 + 10]) / (3 * place))) ^ Math.round((verts[t * 12 + 1] + verts[t * 12 + 5] + verts[t * 12 + 9]) / (3 * place))) + 7) : rng(hash2(seed, t) + 7);
    const o = t * 12, mt = verts[o + 3], m = Math.floor(mt);
    const ax = verts[o], ay = verts[o + 1], az = verts[o + 2], bx = verts[o + 4], by = verts[o + 5], bz = verts[o + 6], cx = verts[o + 8], cy = verts[o + 9], cz = verts[o + 10];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz), area = nl / 2;
    if (area < 1e-5) continue;
    nx /= nl; ny /= nl; nz /= nl;
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    const backdrop = BACKDROP.has(m) || (!line && !moving), ground = !moving && (ROAD.has(m) || GROUND.has(m) || ROCKY.has(m)), thing = !backdrop && !ground;
    // (the road's middle nearest the face: how far off it is, the road's way there, its station)
    let d = 0, lx = 0, lz = 1, px = mx, pz = mz, st = NEVER;
    if (line && !moving) {
      let best = Infinity;
      for (let k = 0; k < line.length; k += 6) { const dd = (line[k] - mx) ** 2 + (line[k + 2] - mz) ** 2; if (dd < best) { best = dd; px = line[k]; pz = line[k + 2]; lx = line[k + 3]; lz = line[k + 4]; st = line[k + 5]; } }
      d = Math.sqrt(best);
    }
    const emit = (tx: number, ty: number, tz: number, Ls: number, Ws: number, cover: number, pass: number, stamps: number[], jit: number, bendA: number, kind: number) => {
      // (never more than a few hundred to a face: the valley's floor is a few faces kilometres across, and uncapped asked for
      // hundreds of thousands, leaving nothing for the ridges after it)
      const want = Math.min(backdrop ? 260 : 1e9, (area * cover) / (Ls * Ws));
      let k = Math.floor(want) + (R() < want - Math.floor(want) ? 1 : 0);
      while (k-- > 0) {
        let a = R(), b = R(); if (a + b > 1) { a = 1 - a; b = 1 - b; }
        const x = ax + ux * a + vx * b, y = ay + uy * a + vy * b, z = az + uz * a + vz * b;
        const j = (R() - 0.5) * jit, cj = Math.cos(j), sj = Math.sin(j);
        const bxx = ny * tz - nz * ty, byy = nz * tx - nx * tz, bzz = nx * ty - ny * tx;
        out.push(x, y, z, mt, tx * cj + bxx * sj, ty * cj + byy * sj, tz * cj + bzz * sj, Ls * (0.75 + R() * 0.5), nx, ny, nz, Ws * (0.8 + R() * 0.4), R(), stamps[Math.floor(R() * stamps.length)], (R() - 0.5) * bendA, kind,
          st, pass, moving ? 1 : 0, backdrop ? 1 : 0);
      }
    };
    if (thing) {
      // (a thing: along its face's longest edge, sized by the face; both sides)
      const e = [[ux, uy, uz], [vx, vy, vz], [cx - bx, cy - by, cz - bz]].sort((p, q) => Math.hypot(q[0], q[1], q[2]) - Math.hypot(p[0], p[1], p[2]))[0], el = Math.hypot(e[0], e[1], e[2]) || 1;
      const Ls = Math.max(0.07, Math.min(moving ? (flat ? 1.2 : 0.5) : 1.4, Math.sqrt(area) * 1.1));
      // (a flat thing lying on the ground (your track, a shadow) is laid as the ground is: flat on it, one side; a
      // standing thing, both sides, turning to the eye)
      if (flat && ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      emit(e[0] / el, e[1] / el, e[2] / el, Ls, Ls * (flat ? 0.35 : 0.5), flat ? 2.2 : 3.2, 1, flat ? [0, 1, 11] : [0, 1, 2, 4, 8, 15], 0.35, flat ? 0.2 : 0.4, flat ? 0 : 3);
      continue;
    }
    // (the face's normal: up, or (a steep face) toward the road it's seen from)
    // (its outward side: the ground's a height field, so up, steep faces included; a cliff facing the valley faces the
    // valley, and is culled when the eye's on the other side of it)
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // (the way down the face, and across it, and along the road)
    const fx = nx * ny, fy = ny * ny - 1, fz = nz * ny, fl = Math.hypot(fx, fy, fz);
    const across = () => { const a = ny * fz - nz * fy, b = nz * fx - nx * fz, c = nx * fy - ny * fx, l = Math.hypot(a, b, c) || 1; return [a / l, b / l, c / l]; };
    const along = () => { const dp = lx * nx + lz * nz; const x = lx - nx * dp, y = -ny * dp, z = lz - nz * dp; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    if (backdrop && RANGE.has(m)) {
      // (its outward side: toward the eye at the middle of the ring, not up; a face turned from there is the far side of a
      // spur, and isn't painted (the ranges are painted by order, not depth, so it would paint over the side you see))
      if (nx * mx + ny * (ay + by + cy) / 3 + nz * mz > 0) { nx = -nx; ny = -ny; nz = -nz; }
      // (a range's face as the studies paint it: strokes set off from the face's upper edge (its crest, where it has one)
      // and pulled down its fall, so the ridge and the skyline are cut clean by the strokes' heads, and the two sides of a
      // spur, falling opposite ways, meet in a chevron. The face is cut into columns down its fall; each stroke's head is
      // at its column's top, or a way below it, most near the top; and they're long)
      const steep = fl > 0.12; let [tx, ty, tz] = steep ? [fx / fl, fy / fl, fz / fl] : along();
      // (leaned toward the way the face's upper edge runs down, as much as that edge falls: so on a peak's flanks the strokes
      // run with the ridges, fanning from the summit, as the study has them; on a level crest, straight down)
      {
        const V = [[ax, ay, az], [bx, by, bz], [cx, cy, cz]].sort((p, q) => q[1] - p[1]);
        let ex = V[1][0] - V[0][0], ey = V[1][1] - V[0][1], ez = V[1][2] - V[0][2]; const el = Math.hypot(ex, ey, ez) || 1;
        ex /= el; ey /= el; ez /= el;
        const lean = Math.min(0.72, Math.abs(ey) * 2.5);
        const x = tx * (1 - lean) + ex * lean, y = ty * (1 - lean) + ey * lean, z = tz * (1 - lean) + ez * lean, l = Math.hypot(x, y, z) || 1;
        if (steep) [tx, ty, tz] = [x / l, y / l, z / l];
      }
      const qx = ny * tz - nz * ty, qy = nz * tx - nx * tz, qz = nx * ty - ny * tx;
      // (the face in its own plane: s down the fall, c across it)
      const P = [[0, 0], [ux * tx + uy * ty + uz * tz, ux * qx + uy * qy + uz * qz], [vx * tx + vy * ty + vz * tz, vx * qx + vy * qy + vz * qz]];
      const c0 = Math.min(P[0][1], P[1][1], P[2][1]), c1 = Math.max(P[0][1], P[1][1], P[2][1]), wide = c1 - c0;
      const column = (c: number) => {
        let lo = Infinity, hi = -Infinity;
        for (let e = 0; e < 3; e++) {
          const A = P[e], B = P[(e + 1) % 3];
          if ((c - A[1]) * (c - B[1]) > 0 || A[1] === B[1]) continue;
          const sv = A[0] + ((c - A[1]) / (B[1] - A[1])) * (B[0] - A[0]); lo = Math.min(lo, sv); hi = Math.max(hi, sv);
        }
        return [lo, hi];
      };
      const snowy = m === M.MTNSNOW || m === M.FARSNOW;
      const tall = (area * 2) / Math.max(1, wide), Lm = Math.max(90, Math.min(900, tall * 1.1)), Wm = Math.max(45, Math.min(110, Lm * 0.14));
      let k = Math.min(260, Math.ceil((area * 4) / (Lm * Wm)));
      while (k-- > 0) {
        const c = c0 + wide * R(), [lo, hi] = column(c);
        if (!(hi > lo)) continue;
        // (a stroke may run on past its face's foot, over the faces below, which are painted after it)
        const col = hi - lo, L = Math.max(col, Lm * 0.6) * (0.8 + R() * 0.35) + 12, sc = lo + Math.max(0, col - L) * R() + L * 0.47;
        const j = (R() - 0.5) * 0.1, cj = Math.cos(j), sj = Math.sin(j);
        const dx = tx * cj + qx * sj, dy = ty * cj + qy * sj, dz = tz * cj + qz * sj;
        out.push(ax + tx * sc + qx * c, ay + ty * sc + qy * c, az + tz * sc + qz * c, mt, dx, dy, dz, L, nx, ny, nz, Wm * (0.8 + R() * 0.4), R(), snowy ? [0, 7, 0, 11][Math.floor(R() * 4)] : [0, 7, 0, 5][Math.floor(R() * 4)], (R() - 0.5) * 0.1, 0, NEVER, 0, 0, 1);
      }
      continue;
    }
    if (backdrop) {
      // (the far off as the reference has it: a few large calm planes, level, laid edge to edge so no paper shows through)
      // (a peak's faces brushed down their fall, as a painter cuts a mountain's planes, snow and rock alike; only what's
      // nearly level (the valley floor) laid level. Sized to the face, so a tall thin facet gets a long narrow stroke that
      // fills it rather than level dabs that leave paper between them)
      const steep = fl > 0.25, [tx, ty, tz] = steep ? [fx / fl, fy / fl, fz / fl] : along();
      const e = Math.max(Math.hypot(ux, uy, uz), Math.hypot(vx, vy, vz), Math.hypot(cx - bx, cy - by, cz - bz)), Ls = Math.max(20, Math.min(420, steep ? e * 0.55 : Math.sqrt(area) * 1.1));
      const snow = m === M.MTNSNOW || m === M.FARSNOW;
      emit(tx, ty, tz, Ls, Ls * (steep ? 0.32 : 0.5), 8, 0, steep ? (snow ? [11, 0, 7] : [0, 5, 7, 13]) : [11, 7, 11], steep ? 0.35 : 0.15, 0.15, 0);
      continue;
    }
    let tx: number, ty: number, tz: number;
    if (ROAD.has(m) || fl < 0.12 || (GROUND.has(m) && d < 18)) [tx, ty, tz] = along();
    else if (GROUND.has(m) && d < 40) { const A = along(), C = across(), f = (d - 18) / 22; const x = A[0] * (1 - f) + C[0] * f, y = A[1] * (1 - f) + C[1] * f, z = A[2] * (1 - f) + C[2] * f, l = Math.hypot(x, y, z) || 1; [tx, ty, tz] = [x / l, y / l, z / l]; }
    else if (ROCKY.has(m)) [tx, ty, tz] = [fx / fl, fy / fl, fz / fl];
    else [tx, ty, tz] = across();
    const road = ROAD.has(m), Ls = Math.min(22, 2.3 * (1 + d / 22)) * (road ? 1.7 : 1);
    // (the masses: big and broad, laid first; then the detail over them)
    emit(tx, ty, tz, Ls * 2.2, Ls * 2.2 * (road ? 0.3 : 0.42), ROCKY.has(m) ? 3.4 : 2.6, 0, road ? [0, 1, 7, 13] : ROCKY.has(m) ? [9, 13, 0, 5] : [11, 7, 0, 10], 0.3, 0.25, 0);
    emit(tx, ty, tz, Ls, Ls * (road ? 0.16 : 0.34), 1.3, 1, road ? [0, 1, 13] : ROCKY.has(m) ? [5, 6, 9, 13, 14] : [2, 3, 4, 1, 10, 12, 8, 15], road ? 0.25 : 0.5, 0.9, 0);
  }
  return new Float32Array(out);
}

/** A layer of the backdrop painted by its form, not its faces: its crest simplified to the segments that matter (a summit,
 * a shoulder, a long saddle), and each segment painted in rows under it, every stroke sized by its segment (a long flat
 * saddle a few long level strokes, a steep flank many short ones down along the ridge), the rows turning down the fall
 * as they go lower on a steep flank. Snow in streaks along the ridges and down the gullies above the snow line. Haze in
 * its colour (toward the horizon) by the layer's distance. A forested layer has a dark band along its foot, its top
 * ragged with treetops. Strokes from low to high, so the crest's lie on top. */
type Layer = { k: number; R: number; floor: number; body: number; snow: number; snowline: number; haze: number; forest: boolean; from: number; to: number; crest: (a: number) => number };
/** (a planned stroke: `band` 0-3 its colour picked outright, or 4 lit by the far-off's light; `haze` 0-1) */
const plan = (list: number[][], x: number, y: number, z: number, mt: number, haze: number, t: number[], L: number, n: number[], W: number, seed: number, stamp: number, bend: number, band: number) =>
  list.push([x, y, z, mt + Math.min(0.9, haze * 0.9), t[0], t[1], t[2], L, n[0], n[1], n[2], W, seed, stamp, bend, 0, NEVER, 1 + band, 0, 1]);
const dp = (p: number[][], tol: number, i = 0, j = p.length - 1, keep = new Set<number>([0, p.length - 1])): Set<number> => {
  let best = -1, bd = tol;
  const [x0, y0] = p[i], [x1, y1] = p[j], L = Math.hypot(x1 - x0, y1 - y0) || 1;
  for (let k = i + 1; k < j; k++) { const d = Math.abs((p[k][0] - x0) * (y1 - y0) - (p[k][1] - y0) * (x1 - x0)) / L; if (d > bd) { bd = d; best = k; } }
  if (best >= 0) { keep.add(best); dp(p, tol, i, best, keep); dp(p, tol, best, j, keep); }
  return keep;
};
function layerStrokes(g: Layer, seed: number, out: number[]) {
  const R0 = rng(seed * 131 + g.k * 17), list: number[][] = [], W0 = g.R * 0.011, L0 = g.R * 0.06, span = g.to - g.from;
  const at = (a: number, y: number) => [Math.sin(a) * g.R, y, Math.cos(a) * g.R];
  const N = Math.ceil((span * g.R) / (W0 * 0.5)), pts: number[][] = [];
  for (let i = 0; i <= N; i++) { const a = g.from + (span * i) / N; pts.push([a * g.R, g.crest(a)]); }
  const keep = [...dp(pts, W0 * 0.9)].sort((p, q) => p - q);
  // (the spurs: from each summit a main spur runs down toward you to the foot, wandering a little, and branches leave it
  // down and outward, so the mountain's planes split at every scale; a shoulder sends a shorter one. Each a line in
  // metres round and up)
  const spurs: number[][][] = [];
  for (let q = 1; q < keep.length - 1; q++) {
    const [xp, hp] = pts[keep[q - 1]], [xs, hs] = pts[keep[q]], [xn, hn] = pts[keep[q + 1]];
    const prom = hs - Math.max(hp, hn), top = hs - g.floor;
    if (top < W0 * 6) continue;
    const summit = prom > W0 * 4, shoulder = !summit && Math.abs((hn - hs) / (xn - xs + 1e-6) - (hs - hp) / (xs - xp + 1e-6)) > 0.35;
    if (!summit && !shoulder) continue;
    const reach = summit ? 1 : 0.45, line: number[][] = [[xs, hs]];
    let x = xs, y = hs, wob = (R0() - 0.5) * 0.5;
    const step = W0 * 2.5, end = hs - top * reach;
    while (y > end) { y -= step; wob += (R0() - 0.5) * 0.35; wob *= 0.85; x += step * wob; line.push([x, y]); }
    spurs.push(line);
    // (its branches: two or three, leaving it partway down, alternately each way, down and out)
    if (summit) for (let b = 0; b < 1 + Math.floor(R0() * 2); b++) {
      const at = Math.floor(line.length * (0.2 + 0.55 * R0())), [bx0, by0] = line[at], dir = (b % 2 ? 1 : -1) * (0.7 + R0() * 0.6), len = (by0 - g.floor) * (0.35 + R0() * 0.3);
      const br: number[][] = [[bx0, by0]];
      for (let yy = by0, xx = bx0, k = 0; yy > by0 - len; k++) { yy -= step; xx += step * dir * (1 - k * 0.04); br.push([xx, yy]); }
      spurs.push(br);
    }
  }
  // (the nearest spur at a point: its x at that height, and how far off it is round; Infinity where none reaches)
  const nearSpur = (x: number, y: number) => {
    let best = Infinity, sx = 0;
    for (const ln of spurs) {
      if (y > ln[0][1] || y < ln[ln.length - 1][1]) continue;
      for (let i = 0; i < ln.length - 1; i++) {
        const [x0, y0] = ln[i], [x1, y1] = ln[i + 1];
        if (y <= y0 && y >= y1) { const t = (y0 - y) / Math.max(1e-6, y0 - y1), xx = x0 + (x1 - x0) * t; if (Math.abs(x - xx) < best) { best = Math.abs(x - xx); sx = xx; } break; }
      }
    }
    return [best, sx];
  };
  const streak = (a: number) => Math.sin(a * 41 + g.k * 3) * 0.55 + Math.sin(a * 97 + g.k) * 0.3 + Math.sin(a * 13 + g.k * 5) * 0.4;
  for (let q = 0; q < keep.length - 1; q++) {
    const [x0, h0] = pts[keep[q]], [x1, h1] = pts[keep[q + 1]], dxm = x1 - x0, dh = h1 - h0, Ls = Math.hypot(dxm, dh);
    if (Ls < 1 || (h0 <= g.floor + 2 && h1 <= g.floor + 2)) continue;
    // (down along the ridge, round and up; toward +round is to the left on the picture)
    let ur = dxm / Ls, uy = dh / Ls; if (uy > 0) { ur = -ur; uy = -uy; }
    const slope = -uy, side = ur > 0 ? 1 : -1, slopeF = Math.min(1, slope * 3);
    const tall = (h0 + h1) / 2 - g.floor, rowH = W0 * 0.72, rows = Math.ceil(tall / rowH) + 1;
    for (let r = 0; r < rows; r++) {
      const depth = r * rowH, df = Math.min(1, depth / Math.max(1, tall));
      // (lower on a steep flank, turning down its fall; on a flat saddle staying level)
      const L = Math.max(L0 * 0.4, Math.min(L0 * 1.4, Ls * 0.55)) * (1 + df * 0.3), n = Math.max(1, Math.round(Ls / (L * 0.6)));
      // (only once a row's far enough under the crest that turning won't lift its head over it)
      const st = depth > L * 0.55 ? Math.min(1, df * 1.5) * (slope > 0.12 ? 0.5 : 0.1) : 0;
      let dr = ur * (1 - st) + side * 0.35 * st, dy = uy * (1 - st) - st; { const l = Math.hypot(dr, dy); dr /= l; dy /= l; }
      for (let j = 0; j < n; j++) {
        const t = (j + 0.15 + R0() * 0.7) / n, xm = x0 + dxm * t, a = xm / g.R, cy = h0 + dh * t;
        const y = cy - depth - W0 * (0.42 + R0() * 0.3);
        if (y < g.floor - W0 * 0.5) continue;
        // (its tail kept above the layer's foot, where it would paint over what's in front)
        const Lr = Math.min(L, (2 * (y - g.floor)) / Math.max(0.2, -dy) + W0);
        const ca = Math.cos(a), sa = Math.sin(a), rx = sa, rz = ca, tx = ca, tz = -sa;
        // (under the crest, the nearest spur decides the plane, where it's nearer than the crest: the side of it the point
        // is on faces that way, lit on the left, shaded on the right, its strokes running down and away from the spur)
        let pside = side, pslope = slopeF, pdr = dr, pdy = dy, Lu = Lr, onSpur = false;
        const [ds, sx] = nearSpur(xm, y), dc = cy - y;
        if (ds < dc * 0.9 && ds < W0 * 14) {
          const sd = xm > sx ? 1 : -1, k2 = 0.55 + 0.35 * Math.min(1, ds / (W0 * 8));
          let qdr = sd * k2, qdy = -1; const l2 = Math.hypot(qdr, qdy); qdr /= l2; qdy /= l2;
          // (turned down the spur's plane only where its head stays under the crest)
          const Lq = Math.min(L0 * 1.1, (2 * (y - g.floor)) / Math.max(0.2, -qdy) + W0, Math.max(W0, (2 * (dc - W0 * 0.5)) / Math.max(0.2, -qdy)));
          if (Lq > W0 * 1.5) { pside = sd; pslope = 1; pdr = qdr; pdy = qdy; Lu = Lq; onSpur = ds < W0 * 2.5; }
        }
        const T = [tx * pdr, pdy, tz * pdr]; { const l = Math.hypot(T[0], T[1], T[2]); T[0] /= l; T[1] /= l; T[2] /= l; }
        const nn = [-rx * 0.75 + tx * pside * 0.55 * pslope, 0.5 - df * 0.5, -rz * 0.75 + tz * pside * 0.55 * pslope]; { const l = Math.hypot(nn[0], nn[1], nn[2]); nn[0] /= l; nn[1] /= l; nn[2] /= l; }
        // (snow: above the snow line, in streaks along the ridge and down the gullies)
        const s = streak(a), snowAt = g.snowline + 110 * s - (cy - g.snowline) * 0.35 * (0.5 + 0.5 * s);
        // (and down the spurs' crests, a way below the line)
        const snowy = (y > snowAt && (depth < tall * 0.55 || s < -0.35)) || (onSpur && y > g.snowline - 160 - 60 * s);
        const p = at(a, y);
        plan(list, p[0], p[1], p[2], snowy ? g.snow : g.body, g.haze, T, Lu * (0.75 + R0() * 0.5), nn, W0 * (0.85 + R0() * 0.4), R0(), [0, 7, 0, 1][Math.floor(R0() * 4)], (R0() - 0.5) * 0.1, 4);
      }
    }
  }
  if (g.forest) {
    // (a forest along the foot: a dark band, its top ragged with treetops)
    const M2 = Math.ceil((span * g.R) / (W0 * 0.45));
    for (let i = 0; i <= M2; i++) {
      const a = g.from + (span * i) / M2, c = g.crest(a), h = c - g.floor;
      if (h < 6) continue;
      const top = g.floor + h * (0.3 + 0.18 * Math.sin(a * 19 + g.k) + 0.1 * Math.sin(a * 53)), ca = Math.cos(a), sa = Math.sin(a), nn = [-sa, 0.2, -ca];
      // (a tree: a short upright stroke standing above the band)
      const tH = W0 * (1.6 + R0() * 1.6), p = at(a, top + tH * 0.3);
      plan(list, p[0], p[1], p[2], M.FOREST, g.haze, [0, -1, 0], tH, nn, W0 * 0.6, R0(), [0, 1][Math.floor(R0() * 2)], 0, 1 + Math.floor(R0() * 2));
      // (and the band under it, in level strokes)
      for (let y = top - W0 * 0.5; y > g.floor - W0; y -= W0 * 0.8) {
        if (R0() < 0.55) continue;
        const q = at(a, y);
        plan(list, q[0], q[1], q[2], M.FOREST, g.haze, [ca, 0, -sa], L0 * (0.6 + R0() * 0.6), nn, W0 * 0.9, R0(), [0, 7][Math.floor(R0() * 2)], 0, 1 + Math.floor(R0() * 3));
      }
    }
  }
  list.sort((p, q) => p[1] - q[1]);
  for (const st of list) out.push(...st);
}
export function rangeStrokes(seed: number): Float32Array {
  const out: number[] = [];
  for (const g of rangeProfiles(seed)) layerStrokes(g, seed, out);
  return new Float32Array(out);
}
export function foothillStrokes(seed: number): Float32Array {
  const out: number[] = [];
  for (const g of foothillProfiles(seed)) layerStrokes(g, seed, out);
  return new Float32Array(out);
}
/** The valley's floor: fields in patches, ochre, lavender and blues, laid level round the eye, broader further off and
 * hazier; and the river over it, a thin pale line in long strokes along it. */
export function valleyStrokes(seed: number): Float32Array {
  const R0 = rng(seed * 53 + 9), list: number[][] = [], F = -260, up = [0, 1, 0];
  const field = (x: number, z: number) => Math.sin(x / 430 + seed) * Math.sin(z / 350 - seed) + 0.6 * Math.sin((x + z) / 210 + seed * 2) * Math.sin((x - z) / 290);
  for (let i = 0; i < 26000; i++) {
    const r = 250 * Math.pow(3550 / 250, R0()), a = R0() * Math.PI * 2, x = Math.sin(a) * r, z = Math.cos(a) * r, v = field(x, z) + (R0() - 0.5) * 0.25;
    const band = v > 0.5 ? 0 : v > 0.05 ? 1 : v > -0.45 ? 2 : 3, j = (R0() - 0.5) * 0.3;
    const tx = Math.cos(a + j), tz = -Math.sin(a + j);
    plan(list, x, F + 0.5, z, M.FIELD, Math.min(0.55, r / 5500), [tx, 0, tz], r * (0.09 + R0() * 0.06), up, r * (0.022 + R0() * 0.01), R0(), [0, 7, 1][Math.floor(R0() * 3)], (R0() - 0.5) * 0.15, band);
  }
  list.sort((p, q) => Math.hypot(q[0], q[2]) - Math.hypot(p[0], p[2]));
  const rv = riverLine(seed);
  for (let k = 0; k < rv.length - 1; k++) {
    const p = rv[k], q = rv[k + 1], dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz), d = Math.hypot((p[0] + q[0]) / 2, (p[2] + q[2]) / 2);
    for (let m = 0; m < 3; m++) {
      const t = (m + R0()) / 3, x = p[0] + dx * t, z = p[2] + dz * t;
      plan(list, x, F + 1.5, z, M.WHITE, Math.min(0.45, d / 6000), [dx / L, 0, dz / L], L * 0.75, up, 11 + R0() * 5, R0(), [0, 7][Math.floor(R0() * 2)], (R0() - 0.5) * 0.1, m === 0 ? 0 : 1);
    }
  }
  const out: number[] = [];
  for (const st of list) out.push(...st);
  return new Float32Array(out);
}

/** The sky's strokes: level marks round the eye from the horizon up past the top, close enough to cover it, darkening as
 * they rise, a few paler. */
export function skyStrokes(seed: number): Float32Array {
  // (as the references have it: deep at the top, paling to the horizon, the strokes long and calm, all on one slant, a
  // little smaller toward the horizon; and a few clouds, each a cluster of pale strokes, lit above, shaded under)
  const R = rng(seed * 97 + 3), out: number[] = [], RAD = 3200, SLANT = 0.22;
  const put = (a: number, el: number, len: number, wid: number, shade: number, kind: number, slant: number) => {
    const y = RAD * Math.tan(Math.min(1.45, el)) - 120, x = Math.sin(a) * RAD, z = Math.cos(a) * RAD, cs = Math.cos(slant), sn = Math.sin(slant);
    out.push(x, y, z, shade, Math.cos(a) * cs, sn, -Math.sin(a) * cs, len, -Math.sin(a), 0, -Math.cos(a), wid, R(), [0, 7, 0, 1][Math.floor(R() * 4)], (R() - 0.5) * 0.12 + 0.06, kind, NEVER, 0, 0, 0);
  };
  for (let i = 0; i < 12000; i++) {
    const a = R() * Math.PI * 2, el = -0.02 + Math.pow(R(), 1.15) * 1.46;
    const len = RAD * (0.11 + R() * 0.12) * (1 + el * 0.6), wid = len * (0.18 + R() * 0.06);
    put(a, el, len, wid, Math.max(0, Math.min(0.8, (el / 0.42 + (R() - 0.5) * 0.14) * 0.8)), R() < 0.07 ? 2 : 1, SLANT + (R() - 0.5) * 0.06);
  }
  for (let c = 0; c < 9; c++) {
    const ac = R() * Math.PI * 2, ec = 0.1 + R() * 0.32, w = 0.12 + R() * 0.16, n = 14 + Math.floor(R() * 14);
    for (let i = 0; i < n; i++) {
      const u = (R() - 0.5) * 2, v = (R() - 0.5) * 2 * (1 - Math.abs(u) * 0.6);
      const len = RAD * (0.08 + R() * 0.1), wid = len * (0.16 + R() * 0.06);
      put(ac + u * w, ec + v * 0.035, len, wid, 2 + Math.max(0, Math.min(1, 0.5 - v * 0.6 + (R() - 0.5) * 0.3)), 1, SLANT * 0.6 + (R() - 0.5) * 0.08);
    }
  }
  return new Float32Array(out);
}

// ─── drawing them ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SEG = 8;
const VS = `#version 300 es
layout(location=0) in vec2 aQ; layout(location=1) in vec4 a0; layout(location=2) in vec4 a1; layout(location=3) in vec4 a2; layout(location=4) in vec4 a3; layout(location=5) in vec4 a4;
uniform mat4 uVP, uPrev; uniform vec3 uOff, uEye, uSun; uniform vec3 uPal[88]; uniform float uFog, uK, uMinW, uStretch, uDens, uGrow, uReveal; uniform vec2 uRes, uFront;
uniform vec3 uSkyLo, uSkyHi, uSkyPale, uSmear;
out vec2 vUv; out vec3 vA; out vec3 vB; flat out float vStamp; out float vFresh; flat out float vTex;
float h(float s, float k){ return fract(sin(s*k)*43758.5453); }
void main(){
  vec3 w = a0.xyz + uOff, n = a2.xyz, T = normalize(a1.xyz); float seed = a3.x, kind = a3.w; bool sky = kind > .5 && kind < 2.5, both = kind > 2.5;
  vec3 V = uEye - w; float dist = length(V); V /= max(dist, 1e-4);
  // (the paint front: a stroke at its station is laid, tail to head, as the front for its pass comes past; the backdrop
  // and what moves are laid as the page opens)
  float g = 1., fresh = 0.;
  if (a4.x > -1e8) { float fr = a4.y < .5 ? uFront.x : uFront.y; g = clamp((fr - a4.x)/uGrow, 0., 1.); fresh = 1. - clamp((fr - a4.x - uGrow)/25., 0., 1.); }
  else g = clamp((uReveal*1.5 - h(seed, 7.77)*.9 - (sky ? 0. : .2))/.35, 0., 1.);
  bool far = a4.w > .5;
  // (thinned with distance, but never the backdrop: thinned, it went to blotches on paper)
  float keep = sky || both || far ? 1. : uDens*mix(1., .5, smoothstep(80., 900., dist));
  // (a stroke on a face turned away from the eye isn't laid (a thing, thin, is painted on both sides): it shrinks away as its
  // face turns from the eye, rather than going at once; so nothing lifted toward the eye shows through from behind an edge)
  // (not the backdrop's: seen far off and edge on, a peak's flanks turned (by their normal) from the eye were left bare
  // paper; what's behind a range is hidden by its depth anyway)
  if (!sky && !both && !far) g *= smoothstep(-.02, .12, dot(n, V));
  int mt0 = int(a0.w);
  if (far && (mt0 == 6 || mt0 == 7 || mt0 == 12 || mt0 == 13 || mt0 == 14) && dot(n, V) < 0.) g = 0.;
  if (!sky && dot(n, V) < 0.) n = -n;
  // (thinned with distance: a stroke past its turn shrinks away over a little more distance, rather than going at once)
  g *= clamp((keep - h(seed, 12.9898))/.12 + 1., 0., 1.);
  vec4 c = uVP*vec4(w, 1.);
  if (g <= 0. || c.w < .3) { gl_Position = vec4(2., 2., 2., 1.); return; }
  // The stroke is laid in the world, on its face, along its own way: nothing about how it lies comes from the screen, so
  // it can't swing as the eye moves. Across it, its width turns from lying on the face toward facing the eye as it gets
  // further off, so it never thins to a sliver (after Brush Rush).
  // (the speed, only near the eye (full within 14 m, gone by 30; further off the subject alone lays it): at pace the stroke turns, on its own face, toward the way the eye is going (one way for every stroke, the
  // eye's smoothed motion in the world, so it holds steady), and draws out by as far as the eye's gone in a moment: the
  // ground and the rock fall into line with the motion, and stream past)
  float smearL = 0.;
  float nearE = 1. - smoothstep(14., 30., dist);
  if (!sky && a4.z < .5 && nearE > 0. && dot(uSmear, uSmear) > 1e-3) {
    vec3 sd = (uSmear - n*dot(uSmear, n))*nearE; float sl = length(sd);
    if (sl > 1e-3) { sd /= sl; if (dot(sd, T) < 0.) sd = -sd; T = normalize(mix(T, sd, clamp(sl/2.4, 0., 1.)*.9)); smearL = sl; }
  }
  vec3 Bn = normalize(cross(n, T)), Be = cross(T, V); float bl = length(Be); Be = bl > .001 ? Be/bl : Bn; if (dot(Be, Bn) < 0.) Be = -Be;
  float face = sky ? 1. : both ? .35 + .5*smoothstep(4., 40., dist) : .15 + .75*smoothstep(5., 70., dist);
  vec3 Wd = normalize(mix(Bn, Be, face));
  // its size: thinned out, the ones kept are bigger; never thinner on the picture than a few pixels, never more than a part of it
  float grow = inversesqrt(max(keep, .3)), k = uK*uRes.y*.5/c.w;
  float len = a1.w*grow, wid = a2.w*grow;
  wid = clamp(wid, uMinW/k, uRes.y*.19/k); len = clamp(len, wid*1.6, uRes.y*.5/k) + min(smearL, uRes.y*.3/k);
  float u = aQ.x*g, c2 = 2.*u - 1., s = (u - .5)*len, bend = a3.z*len*(1. - c2*c2)*.25;
  vec3 p = w + T*s + Wd*(aQ.y*wid*.5 + bend);
  vec4 cq = uVP*vec4(p, 1.);
  // its depth lifted toward the eye, along the line to the eye so it doesn't move on the picture: on the ground a little,
  // more the further (after Brush Rush), on a thing by half its own size; so it clears its own face, never cutting into it
  float lift = sky ? 0. : both ? .02 + max(len, wid)*.5 : .25 + dist*.02 + wid*.5;
  vec4 cl = uVP*vec4(p + V*min(lift, dist*.5), 1.);
  gl_Position = vec4(cq.xy, cl.z/cl.w*cq.w, cq.w);
  vUv = vec2(u, aQ.y*.5 + .5); vStamp = a3.y; vFresh = fresh; vTex = sky || far ? 1. : 0.;
  if (sky) {
    vec3 col;
    if (a0.w > 1.9) col = mix(vec3(.96, .94, .96), vec3(.62, .68, .93), clamp(a0.w - 2., 0., 1.));
    else { col = mix(uSkyLo, uSkyHi, smoothstep(0., .8, a0.w)); if (kind > 1.5) col = mix(col, uSkyPale, .35); }
    vA = col*(.96 + h(seed, 3.7)*.08); vB = col*(1.04 + h(seed, 5.1)*.08);
    return;
  }
  // (its colour: the face's band, as the facets pick it, a little jittered stroke by stroke; and the band next to it)
  int mt = int(a0.w); float tone = fract(a0.w);
  float l = dot(n, uSun) + (tone/.9 - .5)*.42 + (far ? 0. : (h(seed, 78.233) - .5)*.12);
  int b = l > .62 ? 0 : l > .3 ? 1 : l > -.05 ? 2 : 3;
  int b2 = clamp(b + (h(seed, 3.1) > .5 ? 1 : -1), 0, 3);
  // (the far off in two tones, as the study has it: a face is lit or in shade, so a range reads as a few planes; a stroke
  // now and then of the other side's colour streaked through)
  // (lit as a painter lights the far off, not by the sun: from the left of the way you look at it, high and a little from
  // in front, so a peak shows a lit face and a shaded one whichever way you look, as the study has it)
  vec3 rr = normalize(vec3(w.x - uEye.x, 0., w.z - uEye.z)), Lf = normalize(vec3(rr.z, 0., -rr.x)*.75 + vec3(0., .55, 0.) - rr*.3);
  int code = int(a4.y + .5) - 1;
  if (far && code >= 0 && code < 4) { b = code; b2 = clamp(b + (h(seed, 3.1) > .5 ? 1 : -1), 0, 3); }
  else if (far) { bool lit = dot(n, Lf) > .3; float r = h(seed, 3.1); b = lit ? (r > .5 ? 0 : 1) : 3; b2 = lit ? (r > .75 ? 2 : 1) : (r > .7 ? 2 : 3); }
  vec3 A = uPal[mt*4 + b], B = mix(A, uPal[mt*4 + b2], far ? .35 : .45);
  float fd = length((w - uEye).xz), f = floor(clamp((fd - 80.)/520., 0., 1.)*4.)/4.;
  vec3 fogs[4] = vec3[4](vec3(.62, .66, .9), vec3(.33, .45, .88), vec3(.14, .33, .84), vec3(.09, .26, .78));
  float fk = min(1., f*1.1)*uFog;
  // (no two strokes alike: a little lighter or darker, a little warmer or cooler)
  vec3 tint = mix(vec3(.95, .98, 1.06), vec3(1.05, 1., .93), h(seed, 4.7))*(1. + (h(seed, 9.13) - .5)*.12);
  float tk = far ? .15 : .7;
  A *= mix(vec3(1.), tint, tk); B *= mix(vec3(1.), tint, tk);
  vA = mix(A, fogs[b], fk); vB = mix(B, fogs[b2], fk);
  // (a planned stroke of the far off: hazed toward the horizon by its distance)
  if (far && code >= 0) { float hz = fract(a0.w)/.9; vA = mix(vA, uSkyLo, hz); vB = mix(vB, uSkyLo, hz); }
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vA; in vec3 vB; flat in float vStamp; in float vFresh; flat in float vTex; uniform sampler2D uAtlas; out vec4 o;
void main(){
  vec2 cell = vec2(mod(vStamp, ${STAMP.COLS}.), floor(vStamp/${STAMP.COLS}.));
  vec4 s = texture(uAtlas, (cell + vUv)/vec2(${STAMP.COLS}., ${STAMP.ROWS}.));
  if (s.r < .05) discard;
  // (the bristles' ridges and grooves: on the far off and the sky hard, as loaded paint dragged in one long pull)
  vec3 c = mix(vA, vB, s.b)*mix(.9 + .2*s.g, .72 + .5*s.g, vTex);
  // (fresh paint, just laid: a little lighter, wet)
  c = mix(c, c*1.1 + .04, vFresh*.3);
  // (premultiplied, blended in a fixed order: no dithered coverage to crawl as the strokes shift)
  float a = smoothstep(.05, .5, s.r);
  o = vec4(c*a, a);
}`;

/** a buffer of strokes, drawn instanced (`set` again for what moves) */
export class Strokes {
  vao: WebGLVertexArrayObject; buf: WebGLBuffer; n = 0;
  constructor(private gl: WebGL2RenderingContext, quad: WebGLBuffer, data: Float32Array, dynamic = false) {
    this.vao = gl.createVertexArray()!; this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    for (let i = 0; i < 5; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, STROKE * 4, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
    gl.bindVertexArray(null);
    this.n = data.length / STROKE;
  }
  set(data: Float32Array) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); this.n = data.length / STROKE; }
  free() { this.gl.deleteBuffer(this.buf); this.gl.deleteVertexArray(this.vao); }
}

/** the painter: the stamps, the program, and how a buffer of strokes is drawn */
export class Painter {
  prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> = {}; quad: WebGLBuffer; atlas: WebGLTexture;
  /** how much the strokes stretch along their motion (`stretch=` 0…2); how many are kept (0…1) */
  stretch = 1; dens = 1;
  /** the paint front: how far ahead of the rider the masses and the detail are laid, how long a stroke takes to lay (m) */
  lead: [number, number] = [700, 110]; grow = 22;
  private front: [number, number] | null = null; private born = performance.now(); private last = performance.now();
  constructor(private gl: WebGL2RenderingContext, palette: Float32Array, sun: number[]) {
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const k of ['uSmear', 'uVP', 'uPrev', 'uOff', 'uEye', 'uSun', 'uPal', 'uFog', 'uK', 'uMinW', 'uStretch', 'uDens', 'uRes', 'uAtlas', 'uSkyLo', 'uSkyHi', 'uSkyPale', 'uFront', 'uGrow', 'uReveal']) this.u[k] = gl.getUniformLocation(p, k);
    gl.useProgram(p);
    gl.uniform3fv(this.u.uPal, palette); gl.uniform3fv(this.u.uSun, new Float32Array(sun));
    gl.uniform3f(this.u.uSkyLo, 0.55, 0.67, 0.96); gl.uniform3f(this.u.uSkyHi, 0.05, 0.2, 0.8); gl.uniform3f(this.u.uSkyPale, 0.62, 0.72, 0.98);
    // (the quad: a strip along the stroke, SEG pieces, so a bent stroke bends smoothly)
    const q: number[] = [];
    for (let i = 0; i <= SEG; i++) q.push(i / SEG, -1, i / SEG, 1);
    this.quad = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.STATIC_DRAW);
    const a = stampAtlas();
    this.atlas = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, a.w, a.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, a.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  make(data: Float32Array, dynamic = false) { return new Strokes(this.gl, this.quad, data, dynamic); }
  /** where the rider is: the front only ever goes on (put back at a checkpoint, what's laid stays laid) */
  advance(s: number) {
    // (it sets out from where you are as the page opens, and runs on ahead to its lead, easing up to it and keeping it)
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (!this.front) this.front = [s - 4, s - 4];
    for (const i of [0, 1]) { const want = s + this.lead[i], f = this.front[i]; if (want > f) this.front[i] = f + Math.max((want - f) * Math.min(1, dt * 1.6), Math.min(want - f, 20 * dt)); }
  }
  /** set up for a frame: the eye, its matrices (now and the last frame's), the canvas */
  begin(vp: Float32Array, prev: Float32Array, eye: number[], projY: number, w: number, h: number, dpr: number, smear: number[] = [0, 0, 0]) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform3f(this.u.uSmear, smear[0] * this.stretch, smear[1] * this.stretch, smear[2] * this.stretch);
    gl.uniformMatrix4fv(this.u.uVP, false, vp); gl.uniformMatrix4fv(this.u.uPrev, false, prev);
    gl.uniform3fv(this.u.uEye, new Float32Array(eye)); gl.uniform1f(this.u.uK, projY); gl.uniform2f(this.u.uRes, w, h);
    gl.uniform1f(this.u.uMinW, 2.4 * dpr); gl.uniform1f(this.u.uStretch, this.stretch); gl.uniform1f(this.u.uDens, this.dens);
    const fr = this.front ?? [-1e9, -1e9]; gl.uniform2f(this.u.uFront, fr[0], fr[1]); gl.uniform1f(this.u.uGrow, this.grow);
    gl.uniform1f(this.u.uReveal, Math.min(1, (performance.now() - this.born) / 1600));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(this.u.uAtlas, 0);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false);
  }
  draw(s: Strokes, off: number[], fog: boolean) {
    const gl = this.gl;
    if (!s.n) return;
    gl.uniform3f(this.u.uOff, off[0], off[1], off[2]); gl.uniform1f(this.u.uFog, fog ? 1 : 0);
    gl.bindVertexArray(s.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2, s.n);
  }
  end() { const gl = this.gl; gl.disable(gl.BLEND); gl.depthMask(true); gl.bindVertexArray(null); }
}

// ─── the speed layer's brush ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The same stamps, for the 2D speed layer (shards, smears, the air off the rider, debris), when the picture's painted:
 * a wedge (thick at its base, to its point) becomes a long brush stroke tapering the same way; a chip of debris a dab.
 * Each colour's stamps are tinted once and kept.
 */
export class Brush2D {
  private atlas: { data: Uint8Array; w: number; h: number };
  private tinted = new Map<string, HTMLCanvasElement>();
  constructor() { this.atlas = stampAtlas(); }
  private sheet(col: string) {
    let c = this.tinted.get(col);
    if (c) return c;
    const { data, w, h } = this.atlas, r = parseInt(col.slice(1, 3), 16), g = parseInt(col.slice(3, 5), 16), b = parseInt(col.slice(5, 7), 16);
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d')!, img = x.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const cov = data[i * 4] / 255, rel = data[i * 4 + 1] / 255, tone = data[i * 4 + 2] / 255, k = 0.84 + 0.3 * rel + (tone - 0.5) * 0.12;
      img.data[i * 4] = Math.min(255, r * k); img.data[i * 4 + 1] = Math.min(255, g * k); img.data[i * 4 + 2] = Math.min(255, b * k);
      img.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (cov - 0.05) / 0.45)));
    }
    x.putImageData(img, 0, 0);
    this.tinted.set(col, c);
    return c;
  }
  /** a stroke from its base at `a` (half-width w) to its point at `b`, in stamp `st` */
  wedge(ctx: CanvasRenderingContext2D, a: number[], b: number[], w: number, col: string, st = 0) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1) return;
    const W = Math.max(2, w * 3), cell = [(st % STAMP.COLS) * STAMP.W, Math.floor(st / STAMP.COLS) * STAMP.H];
    ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(Math.atan2(dy, dx));
    ctx.drawImage(this.sheet(col), cell[0], cell[1], STAMP.W, STAMP.H, -L * 0.03, -W / 2, L * 1.06, W);
    ctx.restore();
  }
  /** a dab, `s` across, turned by `a` */
  dab(ctx: CanvasRenderingContext2D, p: number[], s: number, a: number, col: string) {
    const st = 3, cell = [(st % STAMP.COLS) * STAMP.W, Math.floor(st / STAMP.COLS) * STAMP.H];
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
    ctx.drawImage(this.sheet(col), cell[0], cell[1], STAMP.W, STAMP.H, -s * 1.3, -s * 0.6, s * 2.6, s * 1.2);
    ctx.restore();
  }
}

// ─── strokes the course calls for ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Strokes laid deliberately from the course itself, not scattered over faces: what says where the way goes.
 * - the road's two edges: long strokes following the course, a band darker than the road, broken now and then;
 * - the drop's lip (where the ground breaks away beside the road): a lit edge of snow;
 * - the ruts: the worn lines down the road (ruts.ts's own), a step darker than the road.
 * Each lies on the surface, its normal the surface's own there.
 * Each is laid at its station, by the detail's front.
 */
export function courseStrokes(c: Course, s0: number, s1: number): Float32Array {
  const out: number[] = [], R = rng(c.seed * 977 + s0 * 13);
  /** a stroke laid on the surface from (sa, ua) to (sb, ub), its normal the surface's own there (so it lies along it, not
   * standing out of a slope) */
  const lay = (sa: number, ua: number, sb: number, ub: number, y: (s: number, u: number) => number, m: number, tone: number, len: number, wid: number, stamps: number[]) => {
    const p = c.point(sa, ua), q = c.point(sb, ub);
    if (p.y == null || q.y == null) return;
    const ya = y(sa, ua), yb = y(sb, ub), tx = q.x - p.x, ty = yb - ya, tz = q.z - p.z, tl = Math.hypot(tx, ty, tz) || 1;
    // (across the surface: a step in u)
    const r = c.point(sa, ua + 0.5), cx = r.x - p.x, cy = y(sa, ua + 0.5) - ya, cz = r.z - p.z;
    let nx = ty * cz - tz * cy, ny = tz * cx - tx * cz, nz = tx * cy - ty * cx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    out.push(p.x, ya + 0.03, p.z, m + tone * 0.9, tx / tl, ty / tl, tz / tl, len * (0.75 + R() * 0.5), nx, ny, nz, wid * (0.8 + R() * 0.4), R(), stamps[Math.floor(R() * stamps.length)], (R() - 0.5) * 0.2, 0, sa, 1, 0, 0);
  };
  const open = (s: number) => { const a = c.at(s), b = c.at(s + 1); return !(a.feature === 'gap' || b.feature === 'gap' || a.feature === 'ramp' || a.feature === 'deck'); };
  const jag = (s: number, k: number) => (hash3(c.seed, Math.round(s), k) - 0.5) * 0.5;
  const road = (s: number, u: number) => trackY(c, s, u), g = (s: number, u: number) => ground(c, s, u);
  for (let s = s0; s < s1; s += 1.6 * (0.8 + R() * 0.4)) {
    if (!open(s)) continue;
    const h = c.at(s).width / 2;
    // (the road's edges)
    if (R() > 0.12) lay(s, -h + 0.25 + jag(s, 1), s + 1, -h + 0.25 + jag(s + 1, 1), road, M.RUT, 0, 2.8, 0.26, [13, 0, 1]);
    if (R() > 0.12) lay(s, h - 0.25 + jag(s, 2), s + 1, h - 0.25 + jag(s + 1, 2), road, M.RUT, 0, 2.8, 0.26, [13, 0, 1]);
  }
  // (the drop's lip, lit)
  for (let s = s0; s < s1; s += 2.2 * (0.8 + R() * 0.4)) {
    if (!open(s) || R() < 0.2) continue;
    const h = c.at(s).width / 2, h1 = c.at(s + 1).width / 2;
    lay(s, h + 2.3 + jag(s, 3), s + 1, h1 + 2.3 + jag(s + 1, 3), g, M.SNOW, 0.95, 3.6, 0.4, [8, 15, 7]);
  }
  // (the ruts: the worn lines down the road, as ruts.ts has them, a step darker than the road, broken now and then)
  for (let s = Math.ceil(s0); s < s1; s += 1.5) {
    if (!plain(c, Math.round(s)) || !plain(c, Math.round(s + 1.5)) || !open(s)) continue;
    const A = lines(c, Math.round(s)), B = lines(c, Math.round(s + 1.5));
    for (let k = 0; k < 3; k++) {
      if (!A[k].own || R() < 0.2) continue;
      lay(s, A[k].u, s + 1.5, B[k].u, road, M.RUT, 0.4, 2.2, 0.3, [0, 1, 13]);
    }
  }
  return new Float32Array(out);
}
function hash3(a: number, b: number, k: number) { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; }
