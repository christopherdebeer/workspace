/**
 * The grove's marks with a reason to be there (after Labyrinth's strokes.ts): not patterns a surface's shader works out
 * from its slope or its height, but strokes the mountain's own features call for, laid as ribbons in the world, so each
 * stays where it is as you run, and the mountain still reads when its colour's gone.
 *
 * Features, and what they call for:
 * - **trail**: its **edge**s, broken, firmer where the bank's cut deep; where it climbs a flight, the flight's **string**s
 *   along each side, and a stone's front edge (**nosing**) now and then;
 * - **bank** (where the trail's bench is cut into the hill): its **rim** along the top of the cut, firmer the deeper;
 *   **hachure**s down the cut, in small groups;
 * - **cliff** (where the land breaks steep and no rock's built): its **rim** along the top, and **face** strokes down its
 *   fall, broken;
 * - **rock** (rock.ts's blocks, from their own corners): a column's **crest** (its top front edge, the firmest), a lower
 *   tier's **lip** (a ledge's edge), its top's sides lighter, its **joints** (the front's vertical edges, from the ground
 *   up), and its **contact** with the soil along its foot. The same edges the eye reads in colour, so the paper keeps the
 *   same rock;
 * - **slope**: a few **contour**s along the hillside, broken, so the lie of the land holds on the paper;
 * - **stone**: its **contact** with the ground, on its downhill side;
 * - **root** (across a trail): its line, along its far side as the eye sees it, thinning to its ends.
 *
 * Each mark carries its family and weight, how much of it holds over the picture while the picture's in colour (a rim
 * does; a contour's only for the paper), its pick (so where the drawing thins, whole marks are left out, never faded)
 * and its anchor, the point it asks how far it's drawn at, so it's drawn one way whole.
 */
import { hash } from '../kit/rng';
import { type Chunk, type World, CHUNK, CN, CELL, HALF, BANK } from './world';
import type { Block } from './rock';

export const FAM = { edge: 0, rim: 1, hachure: 2, face: 3, contour: 4, string: 5, nosing: 6, contact: 7, root: 8, debris: 9, tread: 10 } as const;
/** a mark's vertex: point (3), the way it runs (3), half-width and taper, side (-1, 1) and along (0..1), family + weight, how
 * much it holds over colour, pick, anchor (3) */
export const STROKE_STRIDE = 16;
type V3 = [number, number, number];

const rng = (...n: number[]) => { let s = hash(...n) >>> 0; return () => { s = hash(s, 0x51ed) >>> 0; return s / 4294967296; }; };

/** a ribbon through the points, tapering to a hair at both ends, swelling a little past its middle; \`span\`: where it lies
 * along the whole line it's a run of (its along, which the renderer lays it in by), and that line's middle */
function ribbon(out: number[], pts: V3[], w: number, fam: number, weight: number, persist: number, pick: number, span?: { t0: number; t1: number; mid: V3 }) {
  if (pts.length < 2) return;
  const L: number[] = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const total = L[L.length - 1] || 1, m = span?.mid ?? pts[Math.floor(pts.length / 2)];
  const V = (i: number, s: number) => {
    const t = L[i] / total, a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    // (the way it runs here: the renderer turns it across that, to the eye, so it's never lost lying flat on the ground)
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
    // (and its pressure varying along it, as a brush's does: swelling and thinning a little, never a ruled line)
    const taper = Math.max(0.12, Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.7)) * (0.72 + 0.28 * Math.sin(L[i] * 1.7 + pick * 40) + 0.12 * Math.sin(L[i] * 4.3 + pick * 17)), p = pts[i];
    const along = span ? span.t0 + (span.t1 - span.t0) * t : t;
    return [p[0], p[1], p[2], dx / l, dy / l, dz / l, w / 2, taper, s, along, fam + Math.min(0.99, weight), persist, pick, m[0], m[1], m[2]];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = V(i, -1), b = V(i, 1), c = V(i + 1, 1), d = V(i + 1, -1);
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
}
/** a line broken into strokes: runs of `on` metres (give or take), gaps of `off`; one line still, its one pick, its runs
 * laid in order along it (from its middle out), so as its ink comes and goes it's one stroke with breaks in it, never a
 * scatter of dashes */
function broken(out: number[], pts: V3[], r: () => number, on: [number, number], off: [number, number], w: number, fam: number, weight: (i: number) => number, persist: number) {
  const L: number[] = [0];
  for (let k = 1; k < pts.length; k++) L.push(L[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][2] - pts[k - 1][2]));
  const total = L[L.length - 1] || 1, mid = pts[Math.floor(pts.length / 2)], pick = r();
  let i = 0;
  while (i < pts.length - 1) {
    const i0 = i, run: V3[] = [pts[i]]; let len = 0, want = on[0] + r() * (on[1] - on[0]);
    while (i < pts.length - 1 && len < want) { i++; len += Math.hypot(pts[i][0] - run[run.length - 1][0], pts[i][2] - run[run.length - 1][2]); run.push(pts[i]); }
    if (run.length >= 2) ribbon(out, run, w * (0.8 + r() * 0.4), fam, weight(i), persist, pick, { t0: L[i0] / total, t1: L[i] / total, mid });
    let gap = 0; want = off[0] + r() * (off[1] - off[0]);
    while (i < pts.length - 1 && gap < want) { i++; gap += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]); }
  }
}

/** the iso-lines of a field over the chunk's grid (marching squares), chained into polylines */
function iso(F: Float32Array, at: (fi: number, fj: number) => V3, level: number): V3[][] {
  const segs: [number[], number[]][] = [];
  const P = (i: number, j: number, i2: number, j2: number) => { const a = F[i + j * CN] - level, b = F[i2 + j2 * CN] - level, t = a / (a - b); return [i + (i2 - i) * t, j + (j2 - j) * t]; };
  for (let j = 0; j < CN - 1; j++) for (let i = 0; i < CN - 1; i++) {
    const c = [F[i + j * CN], F[i + 1 + j * CN], F[i + 1 + (j + 1) * CN], F[i + (j + 1) * CN]].map((v) => (v > level ? 1 : 0));
    const e: number[][] = [];
    if (c[0] !== c[1]) e.push(P(i, j, i + 1, j));
    if (c[1] !== c[2]) e.push(P(i + 1, j, i + 1, j + 1));
    if (c[2] !== c[3]) e.push(P(i + 1, j + 1, i, j + 1));
    if (c[3] !== c[0]) e.push(P(i, j + 1, i, j));
    if (e.length === 2) segs.push([e[0], e[1]]);
    else if (e.length === 4) { segs.push([e[0], e[1]]); segs.push([e[2], e[3]]); }
  }
  // (chained end to end)
  const key = (p: number[]) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, k) => { for (const p of s) { const q = key(p); (ends.get(q) ?? ends.set(q, []).get(q)!).push(k); } });
  const used = new Uint8Array(segs.length), lines: V3[][] = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1; const line = [segs[k][0], segs[k][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir > 0 ? line[line.length - 1] : line[0], next = (ends.get(key(tip)) ?? []).find((n) => !used[n]);
        if (next === undefined) break;
        used[next] = 1; const s = segs[next], far = key(s[0]) === key(tip) ? s[1] : s[0];
        if (dir > 0) line.push(far); else line.unshift(far);
      }
    }
    lines.push(line.map((p) => at(p[0], p[1])));
  }
  return lines;
}

/** the marks of a chunk */
export function strokes(world: World, c: Chunk): Float32Array {
  const out: number[] = [], s = world.seed, G = c.ground, x0 = c.x0, z0 = c.z0;
  // (the ground as its mesh lays it, triangle by triangle (render.ts's index order), so a mark lies on it, not under it)
  const gAt = (fi: number, fj: number) => {
    const i = Math.min(CN - 2, Math.max(0, Math.floor(fi))), j = Math.min(CN - 2, Math.max(0, Math.floor(fj))), u = fi - i, v = fj - j, k = i + j * CN;
    return u + v <= 1 ? G[k] + u * (G[k + 1] - G[k]) + v * (G[k + CN] - G[k]) : G[k + CN + 1] + (1 - u) * (G[k + CN] - G[k + CN + 1]) + (1 - v) * (G[k + 1] - G[k + CN + 1]);
  };
  const yAt = (x: number, z: number) => {
    const fi = (x - x0) / CELL, fj = (z - z0) / CELL;
    return fi >= 0 && fi <= CN - 1 && fj >= 0 && fj <= CN - 1 ? gAt(fi, fj) : world.ground(x, z);
  };
  const at = (fi: number, fj: number): V3 => [x0 + fi * CELL, gAt(fi, fj) + 0.03, z0 + fj * CELL];
  const inside = (x: number, z: number) => x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK;

  // ─── the trails: edges, bank rims and hachures, a flight's strings and nosings ───
  for (const t of world.trailsAround(x0, z0)) {
    const n = t.x.length;
    // (this chunk's stretches of it)
    let i = 0;
    while (i < n) {
      while (i < n && !inside(t.x[i], t.z[i])) i++;
      if (i >= n) break;
      const a = Math.max(0, i - 1); let b = i; while (b < n - 1 && inside(t.x[b], t.z[b])) b++;
      const r = rng(s, Math.round(t.x[a] * 10), Math.round(t.z[a] * 10), 71);
      for (const side of [-1, 1]) {
        const edge: V3[] = [], rim: V3[] = [], depth: number[] = [], climb: boolean[] = [];
        for (let k = a; k <= b; k++) {
          const k0 = Math.max(0, k - 1), k1 = Math.min(n - 1, k + 1), dx = t.x[k1] - t.x[k0], dz = t.z[k1] - t.z[k0], l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * side, nz = (dx / l) * side, yp = t.y[k] - 0.06;
          const ex = t.x[k] + nx * HALF, ez = t.z[k] + nz * HALF;
          edge.push([ex, yAt(ex, ez) + 0.03, ez]); climb.push(!!t.stair[k]);
          // (the bank: how high the land stands over the bench here, on this side)
          const far = HALF + BANK, fx = t.x[k] + nx * far, fz = t.z[k] + nz * far, dh = world.base(fx, fz) - yp;
          const ro = HALF + (BANK + Math.abs(dh) * 0.25) * 0.8, rx = t.x[k] + nx * ro, rz = t.z[k] + nz * ro;
          rim.push([rx, yAt(rx, rz) + 0.04, rz]); depth.push(dh);
        }
        // (the edge, broken, where it's not a flight; the flight's string, whole, where it is)
        const plain = edge.map((p, k) => (climb[k] ? null : p));
        let run: V3[] = [];
        const flush = (fam: number) => { if (run.length >= 2) { if (fam === FAM.edge) broken(out, run, r, [1.5, 4.5], [0.6, 2.2], 0.07, FAM.edge, (k) => 0.45 + Math.min(0.4, Math.max(0, depth[Math.min(depth.length - 1, k)]) * 0.2), 0.75); else ribbon(out, run, 0.06, FAM.string, 0.75, 0.9, r() * 0.3); } run = []; };
        plain.forEach((p) => { if (p) run.push(p); else flush(FAM.edge); }); flush(FAM.edge);
        edge.forEach((p, k) => { if (climb[k]) run.push(p); else flush(FAM.string); }); flush(FAM.string);
        // (the rim along the top of the cut, where it's cut at all, firmer the deeper; hachures down the cut below it)
        run = [];
        const cut: V3[][] = [];
        rim.forEach((p, k) => { if (depth[k] > 0.3) run.push(p); else { if (run.length >= 3) cut.push(run); run = []; } });
        if (run.length >= 3) cut.push(run);
        for (const line of cut) {
          const k0 = rim.indexOf(line[0]);
          broken(out, line, r, [2.5, 7], [0.4, 1.4], 0.08, FAM.rim, (k) => 0.4 + Math.min(0.55, depth[Math.min(depth.length - 1, k0 + k)] * 0.18), 0.9);
          // (in small groups, down the cut from the rim toward the trail's edge)
          for (let k = 1; k < line.length - 1; k += 3 + Math.floor(r() * 3)) {
            if (r() > 0.75) continue;
            const group = 2 + Math.floor(r() * 3);
            for (let g = 0; g < group && k + g < line.length; g++) {
              const top = line[k + g], foot = edge[Math.min(edge.length - 1, k0 + k + g)], f = 0.45 + r() * 0.35;
              const pts: V3[] = [];
              for (let q = 0; q <= 4; q++) { const u = (q / 4) * f, x = top[0] + (foot[0] - top[0]) * u, z = top[2] + (foot[2] - top[2]) * u; pts.push([x, yAt(x, z) + 0.04, z]); }
              ribbon(out, pts, 0.05, FAM.hachure, 0.5 + r() * 0.2, 0.25, r());
            }
          }
        }
      }
      // (the bed itself, where it's not a flight: worn lines where feet have gone, broken and faint; and what lies on it, a
      // twig now and then, fallen leaves as small curved commas, thicker toward the edges where they're not trodden)
      {
        const tread: V3[][] = [[], []];
        for (let k = a; k <= b; k++) {
          const k0 = Math.max(0, k - 1), k1 = Math.min(n - 1, k + 1), dx = t.x[k1] - t.x[k0], dz = t.z[k1] - t.z[k0], l = Math.hypot(dx, dz) || 1;
          const tx = dx / l, tz = dz / l, nx = -tz, nz = tx;
          for (const [w, side] of [[0, -1], [1, 1]] as const) {
            const off = side * HALF * 0.38, x = t.x[k] + nx * off, z = t.z[k] + nz * off;
            if (t.stair[k]) { if (tread[w].length >= 2) broken(out, tread[w], r, [0.8, 2.4], [1.2, 3.5], 0.035, FAM.tread, () => 0.3, 0.2); tread[w] = []; }
            else tread[w].push([x, yAt(x, z) + 0.03, z]);
          }
          if (t.stair[k] || !inside(t.x[k], t.z[k])) continue;
          // (the samples are about half a metre apart: a few marks each)
          for (let m = 0; m < 3; m++) {
            const u = (r() * 2 - 1), edgeward = Math.abs(u), off = u * HALF * 0.9;
            if (r() > 0.25 + 0.55 * edgeward) continue;
            const along = (r() - 0.5) * 0.5, x = t.x[k] + nx * off + tx * along, z = t.z[k] + nz * off + tz * along;
            const twig = r() < 0.18, len = twig ? 0.25 + r() * 0.4 : 0.09 + r() * 0.1, ang = r() * Math.PI * 2, bend = (r() - 0.5) * (twig ? 0.25 : 0.9);
            const pts: V3[] = [];
            for (let q = 0; q <= (twig ? 3 : 2); q++) {
              const f = q / (twig ? 3 : 2) - 0.5, an = ang + bend * f * 2, px = x + Math.cos(an) * len * f, pz = z + Math.sin(an) * len * f;
              pts.push([px, yAt(px, pz) + 0.035, pz]);
            }
            ribbon(out, pts, twig ? 0.035 : 0.045, FAM.debris, twig ? 0.55 : 0.3 + r() * 0.2, 0.35, r());
          }
        }
        for (const line of tread) if (line.length >= 2) broken(out, line, r, [0.8, 2.4], [1.2, 3.5], 0.035, FAM.tread, () => 0.3, 0.2);
      }
      // (now and then a stone's front edge on a flight, most at its foot and head)
      i = b + 1;
    }
    for (const st of t.steps) {
      if (!inside(st.x, st.z)) continue;
      const r = rng(s, Math.round(st.x * 10), Math.round(st.z * 10), 73);
      if (r() > 0.45) continue;
      const lx = -st.dz, lz = st.dx, w = st.width * (0.3 + r() * 0.15), y = st.y + 0.02;
      ribbon(out, [[st.x - lx * w, y, st.z - lz * w], [st.x, y, st.z], [st.x + lx * w, y, st.z + lz * w]], 0.05, FAM.nosing, 0.6, 0.6, r());
    }
  }

  // ─── what gathers where things meet the ground: fallen leaves caught round a stone's foot (most below it) and round a
  // giant culm's, as small curved commas ───
  {
    const r = rng(s, c.ci, c.cj, 97);
    const comma = (x: number, z: number) => {
      const len = 0.08 + r() * 0.1, ang = r() * Math.PI * 2, bend = (r() - 0.5) * 0.9, pts: V3[] = [];
      for (let q = 0; q <= 2; q++) { const f = q / 2 - 0.5, an = ang + bend * f * 2, px = x + Math.cos(an) * len * f, pz = z + Math.sin(an) * len * f; pts.push([px, yAt(px, pz) + 0.035, pz]); }
      ribbon(out, pts, 0.045, FAM.debris, 0.35 + r() * 0.2, 0.4, r());
    };
    for (const st of c.stones) {
      if (st.r < 0.3 || !inside(st.x, st.z)) continue;
      const fx = yAt(st.x + 0.5, st.z) - yAt(st.x - 0.5, st.z), fz = yAt(st.x, st.z + 0.5) - yAt(st.x, st.z - 0.5), fl = Math.hypot(fx, fz) || 1;
      for (let m = 0, n = 4 + Math.floor(st.r * 6); m < n; m++) {
        const a = r() * Math.PI * 2, d = st.r * (0.95 + r() * 0.45), down = r() < 0.6 ? 0.5 : 0;
        comma(st.x + Math.cos(a) * d - (fx / fl) * st.r * down, st.z + Math.sin(a) * d - (fz / fl) * st.r * down);
      }
    }
    for (let k = 0; k < c.tall; k++) {
      const q = c.culms[k];
      if (q.r < 0.105 || !inside(q.x, q.z)) continue;
      for (let m = 0; m < 6; m++) { const a = r() * Math.PI * 2, d = q.r + 0.12 + r() * 0.45; comma(q.x + Math.cos(a) * d, q.z + Math.sin(a) * d); }
    }
  }
  // ─── cliffs: where the land breaks steep, its rim along the top, strokes down its face ───
  {
    const S = new Float32Array(CN * CN);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const gx = (G[Math.min(CN - 1, i + 1) + j * CN] - G[Math.max(0, i - 1) + j * CN]) / ((Math.min(CN - 1, i + 1) - Math.max(0, i - 1)) * CELL);
      const gz = (G[i + Math.min(CN - 1, j + 1) * CN] - G[i + Math.max(0, j - 1) * CN]) / ((Math.min(CN - 1, j + 1) - Math.max(0, j - 1)) * CELL);
      // (off the trail's own bed)
      S[i + j * CN] = c.near[i + j * CN] < HALF + 0.6 ? 0 : Math.hypot(gx, gz);
    }
    const r = rng(s, c.ci, c.cj, 75);
    for (const line of iso(S, at, 0.95)) {
      // (the top of it, not its foot: the steep side's below; where rock's built, its own edges say it instead)
      const m = line[Math.floor(line.length / 2)], fi = (m[0] - x0) / CELL, fj = (m[2] - z0) / CELL;
      if (world.underRockAt(m[0], m[2])) continue;
      const gx = gAt(fi + 0.5, fj) - gAt(fi - 0.5, fj), gz = gAt(fi, fj + 0.5) - gAt(fi, fj - 0.5), gl = Math.hypot(gx, gz) || 1;
      const down = [-gx / gl, -gz / gl], below = S[Math.round(Math.min(CN - 1, Math.max(0, fi + down[0] * 1.5))) + Math.round(Math.min(CN - 1, Math.max(0, fj + down[1] * 1.5))) * CN];
      const top = below > 0.95;
      if (line.length < 3) continue;
      broken(out, line.map((p) => [p[0], p[1] + 0.03, p[2]] as V3), r, top ? [3, 8] : [1.5, 4], top ? [0.4, 1.2] : [1, 3], top ? 0.1 : 0.06, top ? FAM.rim : FAM.contact, () => (top ? 0.85 : 0.45), top ? 0.95 : 0.5);
    }
    // (down the face: from points on it, down its fall, broken)
    for (let j = 1; j < CN - 1; j++) for (let i = 1; i < CN - 1; i++) {
      if (S[i + j * CN] < 1.0 || r() > 0.4) continue;
      let fi = i + (r() - 0.5), fj = j + (r() - 0.5);
      if (world.underRockAt(x0 + fi * CELL, z0 + fj * CELL)) continue;
      const pts: V3[] = [], len = 3 + Math.floor(r() * 4);
      for (let q = 0; q < len; q++) {
        pts.push(at(fi, fj));
        const gx = gAt(fi + 0.3, fj) - gAt(fi - 0.3, fj), gz = gAt(fi, fj + 0.3) - gAt(fi, fj - 0.3), gl = Math.hypot(gx, gz) || 1;
        fi -= (gx / gl) * 0.45; fj -= (gz / gl) * 0.45;
        if (fi < 0 || fj < 0 || fi > CN - 1 || fj > CN - 1) break;
      }
      // (lifted off the face a little, toward the eye's side of it being unknown: up)
      ribbon(out, pts.map((p) => [p[0], p[1] + 0.05, p[2]] as V3), 0.05, FAM.face, 0.55 + r() * 0.3, 0.35, r());
    }
  }

  // ─── rock: each block's own edges ───
  if (c.rocks) {
    const r = rng(s, c.ci, c.cj, 79);
    const lift = (p: number[], b: Block, out_ = 0.03): V3 => [p[0] + b.ax[2][0] * out_, p[1] + 0.025, p[2] + b.ax[2][2] * out_];
    const along = (a: number[], b: number[], n: number): V3[] => Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n] as V3);
    for (const b of c.rocks) {
      const K = b.K, crest = b.role === 'crest' || b.role === 'outcrop' || b.role === 'back', frag = b.kind === 'fragment';
      // (the top's front edge: a crest firm and held over the colour; a ledge's lip a little less; a fragment's light)
      const tf = along(K[6], K[7], 6).map((p) => lift(p, b));
      broken(out, tf, r, crest ? [2.5, 6] : [1.5, 4], [0.15, 0.5], frag ? 0.05 : crest ? 0.1 : 0.085, FAM.rim, () => (frag ? 0.45 : crest ? 0.88 : 0.75), frag ? 0.5 : crest ? 0.95 : 0.85);
      if (frag) { const fb = along(K[4], K[5], 5).map((p) => [p[0], Math.max(p[1], world.ground(p[0], p[2])) + 0.02, p[2]] as V3); broken(out, fb, r, [0.6, 1.6], [0.2, 0.6], 0.05, FAM.contact, () => 0.55, 0.6); continue; }
      // (the top's sides, lighter)
      for (const [a, z] of [[2, 6], [3, 7]]) broken(out, along(K[a], K[z], 5).map((p) => lift(p, b, 0)), r, [1, 2.5], [0.3, 0.9], 0.055, FAM.rim, () => 0.45, 0.45);
      // (the joints: the front's vertical edges, from where the ground meets them up to the top)
      for (const [lo, hi] of [[4, 6], [5, 7]]) {
        const g = world.ground(K[lo][0], K[lo][2]), y0 = Math.max(K[lo][1], g + 0.03);
        if (K[hi][1] - y0 < 0.3) continue;
        const pts = along([K[lo][0], y0, K[lo][2]], K[hi], 5).map((p) => lift(p, b));
        ribbon(out, pts, 0.055, FAM.face, 0.55 + r() * 0.2, 0.6, r());
      }
      // (its foot: where its front meets the soil)
      const foot = along(K[4], K[5], 7).map((p) => { const g = world.ground(p[0], p[2]); return [p[0] + b.ax[2][0] * 0.04, Math.min(Math.max(p[1], g), b.top) + 0.03, p[2] + b.ax[2][2] * 0.04] as V3; });
      broken(out, foot, r, [1.2, 3], [0.3, 0.8], 0.07, FAM.contact, () => 0.65, 0.7);
    }
  }

  // ─── the lie of the land: a few contours, broken, where it's sloping but not a face ───
  {
    const r = rng(s, c.ci, c.cj, 77), H = 1.0;
    let lo = Infinity, hi = -Infinity;
    for (const v of G) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let lv = Math.ceil(lo / H) * H; lv < hi; lv += H) {
      for (const line of iso(G, at, lv)) {
        // (along the hillside only: off the trails, off the faces)
        const ok = (p: V3) => { const fi = Math.round((p[0] - x0) / CELL), fj = Math.round((p[2] - z0) / CELL), k = Math.min(CN - 1, Math.max(0, fi)) + Math.min(CN - 1, Math.max(0, fj)) * CN; return c.near[k] > HALF + 0.6 && c.rock[k] < 0.5; };
        // (only the stretches that qualify are drawn: a contour stops where it meets a trail or a face)
        let run: V3[] = [];
        const flush = () => { if (run.length >= 4 && r() < 0.75) broken(out, run.map((p) => [p[0], p[1] + 0.02, p[2]] as V3), r, [2.5, 8], [1.2, 4], 0.05, FAM.contour, () => 0.55 + r() * 0.25, 0); run = []; };
        for (const p of line) { if (ok(p)) run.push(p); else flush(); }
        flush();
      }
    }
    // (and down the fall where it's steep enough to show it: short strokes in small groups, as a brush textures a slope)
    for (let n = 0; n < 90; n++) {
      const fi = 1 + r() * (CN - 3), fj = 1 + r() * (CN - 3), k = Math.round(fi) + Math.round(fj) * CN;
      const gx = gAt(fi + 0.5, fj) - gAt(fi - 0.5, fj), gz = gAt(fi, fj + 0.5) - gAt(fi, fj - 0.5), sl = Math.hypot(gx, gz);
      if (sl < 0.25 || sl > 1.1 || c.near[k] < HALF + 0.6 || r() > (sl - 0.15) * 1.6) continue;
      const dx = -gx / sl, dz = -gz / sl, group = 2 + Math.floor(r() * 3), len = 0.7 + r() * 0.9;
      for (let g = 0; g < group; g++) {
        const ox = fi + -dz * g * 0.32 + dx * (r() - 0.5) * 0.3, oz = fj + dx * g * 0.32 + dz * (r() - 0.5) * 0.3, pts: V3[] = [];
        for (let q = 0; q <= 3; q++) { const u = (q / 3) * len * (0.75 + r() * 0.3); pts.push(at(ox + dx * u, oz + dz * u)); }
        ribbon(out, pts, 0.05, FAM.hachure, 0.55 + r() * 0.2, 0.1, r());
      }
    }
  }

  // ─── stones: where each meets the ground, on its downhill side ───
  for (const st of c.stones) {
    const r = rng(s, Math.round(st.x * 10), Math.round(st.z * 10), 79);
    const gx = yAt(st.x + 1, st.z) - yAt(st.x - 1, st.z), gz = yAt(st.x, st.z + 1) - yAt(st.x, st.z - 1), a0 = Math.atan2(-gz, -gx);
    const pts: V3[] = [], R = st.r * 0.95, span = 1.6 + r() * 1.2;
    for (let q = 0; q <= 8; q++) { const a = a0 - span / 2 + (span * q) / 8, x = st.x + Math.cos(a) * R, z = st.z + Math.sin(a) * R * st.flat * 1.2; pts.push([x, yAt(x, z) + 0.04, z]); }
    ribbon(out, pts, 0.07, FAM.contact, 0.6 + r() * 0.3, 0.7, r() * 0.6);
  }
  // ─── roots: a line along each, at its top, thinning into the earth at its ends ───
  for (const q of c.roots) {
    const r = rng(s, Math.round(q.x * 10), Math.round(q.z * 10), 81), ca = Math.cos(q.yaw), sa = Math.sin(q.yaw), pts: V3[] = [];
    for (let k = 0; k <= 6; k++) {
      const u = k / 6 * 2 - 1, along = u * q.len * 0.5, bow = Math.sin(u * 2.4 + q.moss * 0.37 * 9) * 0.12;
      const lx = along, lz = bow, x = q.x + ca * lx + sa * lz, z = q.z - sa * lx + ca * lz;
      pts.push([x, q.y + q.r * (0.75 * (1 - u * u * 0.6) + (1 - u * u) * 0.4), z]);
    }
    ribbon(out, pts, 0.05, FAM.root, 0.6 + r() * 0.2, 0.55, r() * 0.5);
  }
  return new Float32Array(out);
}
