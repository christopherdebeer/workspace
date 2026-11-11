/**
 * A sheet: one fractured, ornamented thing hanging across the way, as the game knows it (no picture here).
 *
 * It is a Voronoi figure: a scatter of sites, each site's nearest ground a shard, so every shard is a flat-sided,
 * convex piece that fits its neighbours. The figure is drawn by where the sites are put. Sites set evenly round a
 * circle make a ring of shards, each a segment of the ring (straight-sided: faceted); rings inside rings make a
 * rosette, its petals the shards of a ring of sites on the petals' axes, the gaps between them the shards of sites
 * left out; half a rosette is a fan, and fans in a row a frieze; a ring of sites left out inside a ring of shards is
 * a hole with a rim. Round the motifs, a jittered grid of plain sites is the body, broken into irregular shards like
 * any fired thing, with patches of another clay. Sites left out (`hole`) still divide the ground: their shards are
 * just not there, so a hole's edge is as faceted as everything else. Past the sides of the way the sheet runs on as a
 * frame the ball can't reach, its outer edge ragged: a piece broken off something larger.
 *
 * What each shard is made of: the body (plain), another clay (fired), a soft glaze (glossy, breaks like the body),
 * or a hard glaze (takes two blows, and always turns the ball). Which colours those are is the picture's business:
 * every sheet of a firing (FIRING sheets) shares a palette.
 */
import { seeded, hash, type Rand } from '../kit/rng';

export const H = 10;
/** a sheet's thickness, the spacing of sheets, where the first is */
export const SHEET_T = 0.75, GAP = 13, FIRST = 14;
/** about how far apart the body's shards are; how much of itself a shard gives up to the joint round it */
export const GRAIN = 0.92, JOINT = 0.03;
/** how far a sheet runs on past the sides of the way (as a share of the way's width and height): its frame */
export const FRAME = 0.5;
/** sheets to a firing: each firing its own glazes, and its start a checkpoint */
export const FIRING = 6;
export const firingOf = (i: number) => Math.floor(i / FIRING);

/** what a shard is made of */
export const PLAIN = 0, FIRED = 1, HARD = 2, SOFT = 3;
/** (the names they had before) */
export const RED = FIRED, GLAZED = HARD;
export interface Shard {
  /** its outline: x, y pairs, counter-clockwise, convex */
  poly: number[];
  cx: number; cy: number;
  /** the furthest its outline gets from (cx, cy) */
  r: number;
  hp: number;
  kind: number;
  /** beyond the sides of the way: the ball can't reach it, and it isn't counted */
  frame: boolean;
  /** the shards it shares an edge with */
  nb: number[];
}
export interface Sheet { i: number; z: number; shards: Shard[]; left: number; total: number; /** goes up whenever a shard of it changes */ ver: number }

export const sheetZ = (seed: number, i: number) => FIRST + GAP * i - (i >= 3 && i % FIRING !== 0 && hash(seed, i, 5) % 4 === 0 ? GAP - 2.6 : 0);
const unit = (...n: number[]) => hash(...n) / 4294967296;
const TAU = Math.PI * 2;

/** a site: where, and what its shard is (-1: left out) */
interface Site { x: number; y: number; k: number }

/** The sites of sheet `i`: its motifs, and the body round them. */
function design(seed: number, i: number, W: number, ex: number, ey: number) {
  const rand: Rand = seeded(hash(seed, i, 31)), sites: Site[] = [];
  /** where the motifs are, kept clear of the body: a disc, or (a fan's) the half of one on its side of the line it stands on */
  const discs: { x: number; y: number; r: number; dx?: number; dy?: number }[] = [];
  const inside = (d: (typeof discs)[number], x: number, y: number) => Math.hypot(d.x - x, d.y - y) < d.r && (d.dx === undefined || (x - d.x) * d.dx + (y - d.y) * d.dy! > -0.3);
  const deep = Math.min(1, i / 30), m = Math.min(W, H);
  // (a glaze for a band: the hard one more often the further in)
  const band = () => (rand() < 0.3 + 0.35 * deep ? HARD : rand() < 0.6 ? SOFT : FIRED);
  const ring = (cx: number, cy: number, r: number, step: number, kind: (k: number, n: number) => number, a0 = 0, a1 = TAU, turn = 0) => {
    const whole = a1 - a0 >= TAU - 1e-6, n = Math.max(whole ? 3 : 2, Math.round(((a1 - a0) * r) / step));
    for (let k = 0; k < n; k++) {
      const a = whole ? a0 + turn + (k / n) * TAU : a0 + ((k + 0.5) / n) * (a1 - a0);
      sites.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, k: kind(k, n) });
    }
  };
  /** a rosette (or, with an arc, a fan): hub, a band, petals, a rim, and a collar of body to close it. The petals
   * are as many as keep each about a tile and a half across at their middle, in as many rows as keep their tiles
   * about square. */
  const rosette = (cx: number, cy: number, R: number, a0 = 0, a1 = TAU) => {
    const whole = a1 - a0 >= TAU - 1e-6, arc = a1 - a0;
    const petals = Math.max(whole ? 6 : 3, Math.min(whole ? 18 : 10, Math.round((arc * R * 0.58) / 1.45))), open = rand() < 0.65;
    const rows = Math.max(2, Math.round((R * 0.44) / 0.62)), step = Math.max(0.5, Math.min(0.8, R * 0.2));
    const b1 = band(), b2 = rand() < 0.5 ? band() : FIRED, alt = rand() < 0.45, hub = rand() < 0.5 ? PLAIN : SOFT, petal = rand() < 0.7 ? PLAIN : FIRED, turn = whole ? rand() * TAU : 0;
    sites.push({ x: cx, y: cy, k: hub });
    if (R > 2.6) ring(cx, cy, R * 0.15, step * 0.8, () => hub, a0, a1, turn);
    ring(cx, cy, R * 0.27, step * 0.85, () => b1, a0, a1, turn);
    // (the petals: a site on each petal's axis, and one between; open, the petals are holes between spokes)
    const span = arc / petals;
    for (let j = 0; j < rows; j++) {
      const f = 0.4 + (0.36 * (j + 0.5)) / rows;
      for (let k = 0; k < petals; k++) {
        const axis = a0 + turn + (k + 0.5) * span, gap = axis + span / 2;
        sites.push({ x: cx + Math.cos(axis) * R * f, y: cy + Math.sin(axis) * R * f, k: open ? -1 : petal });
        if (whole || k < petals - 1) sites.push({ x: cx + Math.cos(gap) * R * f, y: cy + Math.sin(gap) * R * f, k: open ? petal : -1 });
      }
    }
    ring(cx, cy, R * 0.87, step, (k) => (alt && k % 2 ? (b2 === FIRED ? SOFT : FIRED) : b2), a0, a1, turn);
    ring(cx, cy, R * 0.87 + 0.75, GRAIN * 0.8, () => PLAIN, a0, a1, turn);
    const mid = (a0 + a1) / 2;
    discs.push({ x: cx, y: cy, r: R * 0.87 + 0.75 + GRAIN * 0.35, ...(whole ? {} : { dx: Math.cos(mid), dy: Math.sin(mid) }) });
  };
  /** a round hole with a rim of glaze round it */
  const ringed = (cx: number, cy: number, r: number) => {
    const rim = band(), alt = rand() < 0.3;
    sites.push({ x: cx, y: cy, k: -1 });
    if (r > 1.3) ring(cx, cy, r * 0.5, 0.7, () => -1);
    ring(cx, cy, Math.max(0.25, r - 0.33), 0.62, () => -1);
    ring(cx, cy, r + 0.36, 0.62, (k) => (alt && k % 3 === 2 ? PLAIN : rim));
    ring(cx, cy, r + 1.02, GRAIN * 0.8, () => PLAIN);
    discs.push({ x: cx, y: cy, r: r + 1.02 + GRAIN * 0.35 });
  };
  const free = (x: number, y: number, r: number) => discs.every((d) => Math.hypot(d.x - x, d.y - y) > d.r + r * 0.92 || (d.dx !== undefined && (x - d.x) * d.dx + (y - d.y) * d.dy! < -r - 0.3));
  const place = (r: number, tries: number, make: (x: number, y: number) => void, spread = 1) => {
    for (let t = 0; t < tries; t++) {
      const x = (rand() - 0.5) * 2 * (W / 2 + r * 0.25) * spread, y = (rand() - 0.5) * 2 * (H / 2 - r * 0.2) * spread;
      if (free(x, y, r + 1)) { make(x, y); return true; }
    }
    return false;
  };

  const first = i % FIRING === 0, layout = first ? 0 : 1 + Math.floor(rand() * 4);
  if (layout === 0) {
    // (a firing's door: one great rosette across the whole way)
    rosette(0, (rand() - 0.5) * H * 0.1, Math.min(W * 0.62, H * 0.42, 4.2));
  } else if (layout === 1) {
    // (a rosette, and holes round it)
    const R = Math.min(3.6, m * (0.55 + rand() * 0.25));
    rosette((rand() - 0.5) * W * 0.4, (rand() - 0.5) * H * 0.35, R);
    for (let k = 0; k < 4; k++) { const r = 0.55 + rand() * 0.8; place(r + 1, 30, (x, y) => ringed(x, y, r)); }
  } else if (layout === 2) {
    // (a frieze of fans, a row or two, up or down)
    const rows = H / W > 1.6 ? 2 : 1 + (rand() < 0.5 ? 1 : 0), R = Math.min(W / 2.1, H / (rows * 1.5) / 1.1, 3.2);
    for (let a = 0; a < rows; a++) {
      const up = rows === 2 ? a === 0 : rand() < 0.6, y0 = rows === 2 ? (a === 0 ? -H * 0.16 : H * 0.16) : (rand() - 0.5) * H * 0.4 - (up ? H * 0.1 : -H * 0.1);
      const n = Math.max(1, Math.ceil(W / (2 * R * 1.07)) + 1), off = (rand() - 0.5) * R;
      for (let k = 0; k < n; k++) rosette(-((n - 1) * R * 1.07) + k * 2 * R * 1.07 + off, y0, R, up ? 0 : Math.PI, up ? Math.PI : TAU);
    }
    for (let k = 0; k < 3; k++) { const r = 0.5 + rand() * 0.6; place(r + 1, 25, (x, y) => ringed(x, y, r)); }
  } else if (layout === 3) {
    // (holes, a few of them big)
    for (let k = 0; k < 7; k++) { const r = k < 2 ? 1.1 + rand() * 0.9 : 0.5 + rand() * 0.7; place(r + 1, 30, (x, y) => ringed(x, y, r)); }
  } else {
    // (two rosettes, one half off the edge)
    const R = Math.min(3.2, m * (0.5 + rand() * 0.2)), side = rand() < 0.5 ? -1 : 1;
    rosette(side * W * 0.45, (rand() - 0.5) * H * 0.3 - H * 0.15, R * 1.2);
    place(R, 40, (x, y) => rosette(x, y, R));
    for (let k = 0; k < 2; k++) { const r = 0.5 + rand() * 0.6; place(r + 1, 25, (x, y) => ringed(x, y, r)); }
  }

  // the body: a staggered grid, each site shaken, kept clear of the motifs; patches of the other clay
  const nx = Math.max(2, Math.round((2 * ex) / GRAIN)), ny = Math.max(2, Math.round((2 * ey) / (GRAIN * 0.9))), gx = (2 * ex) / nx, gy = (2 * ey) / ny;
  const patch = seeded(hash(seed, i, 77))() * 100, fired = 0.12 + 0.2 * unit(seed, i, 78);
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const x = -ex + (c + 0.5 + (r % 2 ? 0.25 : -0.25)) * gx + (unit(seed, i, r, c, 1) - 0.5) * gx * 0.8, y = -ey + (r + 0.5) * gy + (unit(seed, i, r, c, 2) - 0.5) * gy * 0.8;
    if (discs.some((d) => inside(d, x, y))) continue;
    const p = 0.5 + 0.5 * Math.sin(x * 0.9 + patch) * Math.sin(y * 0.7 + patch * 1.3) + (unit(seed, i, r, c, 3) - 0.5) * 0.3;
    sites.push({ x, y, k: p < fired ? FIRED : PLAIN });
  }
  return sites;
}

/** Sheet `i` of this seed's way. */
export function makeSheet(seed: number, i: number, W: number): Sheet {
  const ex = W * (0.5 + FRAME), ey = H * (0.5 + FRAME), sites = design(seed, i, W, ex, ey);
  // (the frame's own edge is ragged: a sheet is a broken-off piece, not a board)
  const ragged = (x: number, y: number) => { const a = Math.atan2(y / ey, x / ex), d = Math.hypot(x / ex, y / ey); return d > 0.8 + 0.14 * Math.sin(a * 3 + i * 1.7 + seed) + 0.1 * Math.sin(a * 7 + i * 2.9); };
  // (a bucket grid of the sites, to find the ones near each)
  const B = GRAIN, bx = Math.ceil((2 * ex) / B) + 1, by = Math.ceil((2 * ey) / B) + 1, buckets: number[][] = Array.from({ length: bx * by }, () => []);
  const cell = (x: number, y: number) => [Math.max(0, Math.min(bx - 1, Math.floor((x + ex) / B))), Math.max(0, Math.min(by - 1, Math.floor((y + ey) / B)))];
  sites.forEach((s, k) => { if (Math.abs(s.x) <= ex && Math.abs(s.y) <= ey) { const [a, b] = cell(s.x, s.y); buckets[b * bx + a].push(k); } });
  const shards: Shard[] = [], index = new Int32Array(sites.length).fill(-1), raw: number[][] = [];
  sites.forEach((s, a) => {
    if (Math.abs(s.x) > ex || Math.abs(s.y) > ey) return;
    const frame = Math.abs(s.x) > W / 2 || Math.abs(s.y) > H / 2;
    if (s.k < 0 || (frame && ragged(s.x, s.y))) return;
    // its cell: the sheet's whole rectangle, cut by the line halfway to each other site, nearest first
    const [ca, cb] = cell(s.x, s.y), near: number[] = [];
    for (let v = Math.max(0, cb - 3); v <= Math.min(by - 1, cb + 3); v++) for (let u = Math.max(0, ca - 3); u <= Math.min(bx - 1, ca + 3); u++) for (const b of buckets[v * bx + u]) if (b !== a) near.push(b);
    near.sort((p, q) => (sites[p].x - s.x) ** 2 + (sites[p].y - s.y) ** 2 - (sites[q].x - s.x) ** 2 - (sites[q].y - s.y) ** 2);
    let poly = [-ex, -ey, ex, -ey, ex, ey, -ex, ey];
    const cut: number[] = [];
    for (const b of near) {
      const dx = sites[b].x - s.x, dy = sites[b].y - s.y, d2 = dx * dx + dy * dy;
      if (d2 < 1e-8) continue;
      let far = 0;
      for (let k = 0; k < poly.length; k += 2) far = Math.max(far, (poly[k] - s.x) ** 2 + (poly[k + 1] - s.y) ** 2);
      if (d2 > 4 * far) break; // (too far to cut it, and so is every one after)
      const mx = s.x + dx / 2, my = s.y + dy / 2, out: number[] = [];
      let did = false;
      for (let k = 0; k < poly.length; k += 2) {
        const x0 = poly[k], y0 = poly[k + 1], x1 = poly[(k + 2) % poly.length], y1 = poly[(k + 3) % poly.length];
        const s0 = (x0 - mx) * dx + (y0 - my) * dy, s1 = (x1 - mx) * dx + (y1 - my) * dy;
        if (s0 <= 0) out.push(x0, y0); else did = true;
        if (s0 <= 0 !== s1 <= 0) { const t = s0 / (s0 - s1); out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); }
      }
      if (did) cut.push(b);
      poly = out;
      if (poly.length < 6) break;
    }
    // (drop the slivers: corners closer than a hair)
    const clean: number[] = [];
    for (let k = 0; k < poly.length; k += 2) { const px = clean.length ? clean[clean.length - 2] : NaN, py = clean.length ? clean[clean.length - 1] : NaN; if (!(Math.hypot(poly[k] - px, poly[k + 1] - py) < 0.02)) clean.push(poly[k], poly[k + 1]); }
    if (clean.length >= 8 && Math.hypot(clean[0] - clean[clean.length - 2], clean[1] - clean[clean.length - 1]) < 0.02) clean.length -= 2;
    poly = clean;
    if (poly.length < 6) return;
    let cx = 0, cy = 0;
    for (let k = 0; k < poly.length; k += 2) { cx += poly[k]; cy += poly[k + 1]; }
    cx /= poly.length / 2; cy /= poly.length / 2;
    let r = 0;
    for (let k = 0; k < poly.length; k += 2) { poly[k] = cx + (poly[k] - cx) * (1 - JOINT); poly[k + 1] = cy + (poly[k + 1] - cy) * (1 - JOINT); r = Math.max(r, Math.hypot(poly[k] - cx, poly[k + 1] - cy)); }
    if (r < 0.08) return;
    const kind = frame && s.k === HARD ? SOFT : s.k;
    index[a] = shards.length; raw.push(cut);
    shards.push({ poly, cx, cy, r, hp: kind === HARD ? 2 : 1, kind, frame, nb: [] });
  });
  shards.forEach((d, k) => { d.nb = raw[k].map((b) => index[b]).filter((b) => b >= 0); });
  let left = shards.reduce((c, d) => c + (d.frame ? 0 : 1), 0);
  if (!left && shards.length) { const d = shards.reduce((a, b) => (Math.hypot(b.cx, b.cy) < Math.hypot(a.cx, a.cy) ? b : a)); d.frame = false; left = 1; }
  return { i, z: sheetZ(seed, i), shards, left, total: left, ver: 0 };
}
