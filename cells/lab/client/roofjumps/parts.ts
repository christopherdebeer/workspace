/**
 * The city's parts: everything a chunk is furnished with once its boxes are laid out, in one place. Each part is a row of
 * `PARTS`: what holds it makes (what a hand and a foot can do with it), what it draws (props: thin boxes, off the lattice), what
 * details it tags for the looks (`Detail`), and the one maker that makes all of them together, so what's seen and what's held
 * can't drift apart: a pipe that's drawn is a pipe that's climbed; a window row knows the sill under it; rust knows the unit it
 * runs from. Each part throws its own dice (`salt`), so adding one, or changing one, moves nothing else in the city. To add a
 * kind of thing: a row here (and its kinds in `HoldKind`/`DetailKind`, with their uses in `USES`).
 */
import { hash, seeded } from '../kit/rng';
import type { Rand } from '../kit/rng';
import { STOREY, TAG, USES } from './city';
import type { Box, Course, Detail, DetailKind, Hold, HoldKind, Region, RegionKind, Tag } from './city';

/** what a part works in: the chunk's boxes as laid out, and what's been furnished so far (in `PARTS` order) */
export interface PartCtx {
  seed: number; cx: number; cz: number; boxes: Box[];
  holds: Hold[]; props: Box[]; regions: Region[]; details: Detail[];
  /** a course's chunk (its own holds and bars, by hand); the practice line (left bare of fixtures); the rest of a course's city (empty street) */
  authored: boolean; course: Course | null; practiceLine: boolean; practice: boolean; alone: boolean;
}
/** a kind of thing the city's furnished with: what it makes, and its maker (given its own dice) */
export interface Part { name: string; salt: number; holds: HoldKind[]; details: DetailKind[]; props: string; make(ctx: PartCtx, rand: Rand): void; when?(ctx: PartCtx): boolean }

const generated = (ctx: PartCtx) => !ctx.authored && !ctx.alone && !ctx.practice;

/** a railing, drawn from its top rail (the hold): the rail, posts about every metre and a half down to what it stands on, a mid rail */
export function railingProps(h: Hold): Box[] {
  const len = Math.hypot(h.bx - h.ax, h.bz - h.az), ux = (h.bx - h.ax) / len, uz = (h.bz - h.az) / len, base = h.ay - 1, w = 0.03;
  const bar = (t0: number, t1: number, y0: number, y1: number): Box => { const xs = [h.ax + ux * t0, h.ax + ux * t1], zs = [h.az + uz * t0, h.az + uz * t1]; return { x0: Math.min(...xs) - (ux ? 0 : w), x1: Math.max(...xs) + (ux ? 0 : w), z0: Math.min(...zs) - (uz ? 0 : w), z1: Math.max(...zs) + (uz ? 0 : w), y0, y1, tag: TAG.BAR, fixture: true }; };
  const out: Box[] = [bar(0, len, h.ay - 0.05, h.ay), bar(0, len, base + 0.47, base + 0.51)], n = Math.max(1, Math.round(len / 1.5));
  for (let k = 0; k <= n; k++) { const t = Math.min(len - 0.05, (len * k) / n); out.push(bar(t, t + 0.05, base, h.ay)); }
  return out;
}

/**
 * A fire escape landing, drawn from its rail (the hold, along its front, `ay` the rail's top): the grated slab a metre deep
 * back to the wall, the rail as a top bar on posts with a mid bar, the ends railed too; and the flight down from it to the
 * landing a storey below, a run of steps along the wall, a switchback (each flight the other way from the one below).
 */
export function escapeProps(h: Hold): Box[] {
  const { nx, nz } = h, len = Math.hypot(h.bx - h.ax, h.bz - h.az), ux = (h.bx - h.ax) / len, uz = (h.bz - h.az) / len, y = h.ay - 1;
  // (a box between two points along the rail (t0..t1, from a), from o0 to o1 back toward the wall, y0..y1)
  const box = (t0: number, t1: number, o0: number, o1: number, y0: number, y1: number, tag: Tag): Box => {
    const xs = [h.ax + ux * t0 - nx * o0, h.ax + ux * t1 - nx * o0, h.ax + ux * t0 - nx * o1, h.ax + ux * t1 - nx * o1], zs = [h.az + uz * t0 - nz * o0, h.az + uz * t1 - nz * o0, h.az + uz * t0 - nz * o1, h.az + uz * t1 - nz * o1];
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0, y1, tag, fixture: true };
  };
  const out: Box[] = [box(0, len, 0, 1, y - 0.06, y, TAG.SLAB), box(0, len, 0, 0.04, h.ay - 0.04, h.ay, TAG.BAR), box(0, len, 0, 0.03, y + 0.5, y + 0.53, TAG.BAR)];
  for (let t = 0; t <= len + 1e-6; t += len / 3) out.push(box(Math.min(len - 0.04, t), Math.min(len, t + 0.04), 0, 0.04, y, h.ay, TAG.BAR));
  for (const t of [0, len - 0.04]) out.push(box(t, t + 0.04, 0, 1, h.ay - 0.04, h.ay, TAG.BAR));
  // (the flight down: from this landing's far end (by the storey, alternately) to the one below, eight steps, 0.6 m wide by the wall)
  if (y > STOREY + 0.1) {
    const odd = Math.round(y / STOREY) % 2 === 1, n = 8;
    for (let i = 0; i < n; i++) { const f = i / n, t0 = odd ? len * f : len * (1 - f) - len / n, yy = y - STOREY * (1 - f); out.push(box(Math.max(0, t0), Math.min(len, t0 + len / n), 0.4, 1, yy - 0.05, yy, TAG.STAIR)); }
  }
  return out;
}

/** what's drawn of a hold: thin boxes, off the lattice, not stood on (a pipe a column, a sill a band, a ledge a deeper one, a
 * unit a box, a sign's bracket and board, a balcony's slab and rail); nothing for what's part of a box already (an edge, a face) */
export function holdProps(h: Hold): Box[] {
  const { nx, nz } = h, len = Math.hypot(h.bx - h.ax, h.bz - h.az), ux = len ? (h.bx - h.ax) / len : -nz, uz = len ? (h.bz - h.az) / len : nx;
  // (a box from a to b along the hold, from o0 to o1 out from it (negative: back toward the wall), between y0 and y1)
  const box = (o0: number, o1: number, y0: number, y1: number, tag: Tag, w = 0): Box => {
    const xs = [h.ax + nx * o0 - ux * w, h.ax + nx * o1 - ux * w, h.bx + nx * o0 + ux * w, h.bx + nx * o1 + ux * w], zs = [h.az + nz * o0 - uz * w, h.az + nz * o1 - uz * w, h.bz + nz * o0 + uz * w, h.bz + nz * o1 + uz * w];
    return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0, y1, tag, fixture: true };
  };
  switch (h.kind) {
    case 'pipe': return [box(0.01, 0.11, h.ay, h.by, TAG.BAR, 0.05)];
    case 'sill': return [box(0, 0.12, h.ay - 0.06, h.ay, TAG.RIM)];
    case 'ledge': return [box(-0.3, 0, h.ay - 0.22, h.ay, TAG.RIM)];
    case 'ac': return [box(-0.48, 0.02, h.ay - 0.55, h.ay, TAG.UNIT)];
    case 'sign': { const sx = h.bx - h.ax, sz = h.bz - h.az, l = Math.hypot(sx, sz) || 1, px = -sz / l * 0.03, pz = sx / l * 0.03, ext = (o0: number, o1: number, y0: number, y1: number, tag: Tag): Box => { const xs = [h.ax + (sx / l) * o0 - px, h.ax + (sx / l) * o1 + px], zs = [h.az + (sz / l) * o0 - pz, h.az + (sz / l) * o1 + pz]; return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0, y1, tag, fixture: true }; };
      return [ext(-0.2, l + 0.05, h.ay - 0.05, h.ay + 0.03, TAG.BAR), ext(0.05, l, h.ay - 0.85, h.ay - 0.12, TAG.UNIT)]; }
    case 'balcony': return [box(-1, 0, h.ay - 1.15, h.ay - 1, TAG.SLAB), box(-0.05, 0, h.ay - 1, h.ay, TAG.BAR)];
    case 'escape': return escapeProps(h);
    case 'railing': return railingProps(h);
    default: return [];
  }
}

/** the structure's own holds: the edges along every top, the faces of every wall worth the name, a building's sills and drainpipes, a rail along anything narrow */
function structure(boxes: Box[], rand: Rand, plain: boolean): Hold[] {
  const out: Hold[] = [];
  const hold = (kind: HoldKind, ax: number, ay: number, az: number, bx: number, by: number, bz: number, nx: number, nz: number) => out.push({ kind, ...USES[kind], ax, ay, az, bx, by, bz, nx, nz });
  for (const b of boxes) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0, y = b.y1;
    // (its four faces: where each is, which way it looks, the line along its top)
    const faces: [number, number, number, number, number, number][] = [[b.x0, b.z0, b.x1, b.z0, 0, -1], [b.x0, b.z1, b.x1, b.z1, 0, 1], [b.x0, b.z0, b.x0, b.z1, -1, 0], [b.x1, b.z0, b.x1, b.z1, 1, 0]];
    for (const [ax, az, bx, bz, nx, nz] of faces) {
      hold('edge', ax, y, az, bx, y, bz, nx, nz);
      // (a wall worth the name: all of it, for the feet)
      if (y - b.y0 >= 2) hold('face', ax, b.y0, az, bx, y, bz, nx, nz);
      if (b.tag !== TAG.BUILDING || plain) continue;
      // (a building's face: most have a sill at each storey, set in from the corners; some a pipe, ground to roof)
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      if (rand() < 0.75) for (let sy = STOREY; sy < y; sy += STOREY) hold('sill', ax + ux * 0.5, sy, az + uz * 0.5, bx - ux * 0.5, sy, bz - uz * 0.5, nx, nz);
      if (rand() < 0.4) { const t = 0.5 + rand() * (len - 1); hold('pipe', ax + ux * t, 0, az + uz * t, ax + ux * t, y, az + uz * t, nx, nz); }
    }
    // (anything narrow: its middle, a rail)
    if (Math.min(w, d) <= 1 && Math.max(w, d) >= 2) {
      const mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
      if (w > d) hold('rail', b.x0, y, mz, b.x1, y, mz, 0, 0); else hold('rail', mx, y, b.z0, mx, y, b.z1, 0, 0);
    }
  }
  return out;
}

/** fixtures on the faces and roofs: ledges, units, signs' brackets, balconies, fire escapes; walkways' railings; roofs' railings */
function fixtures(ctx: PartCtx, boxes: Box[], rand: Rand): { holds: Hold[]; props: Box[] } {
  const holds: Hold[] = [], props: Box[] = [];
  const hold = (kind: HoldKind, ax: number, ay: number, az: number, bx: number, by: number, bz: number, nx: number, nz: number) => holds.push({ kind, ...USES[kind], ax, ay, az, bx, by, bz, nx, nz });
  const top = (x: number, z: number) => { let h = 0; for (const o of boxes) if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1) h = Math.max(h, o.y1); return h; };
  // (a box from two corners along the face, out to `out`, between y0 and y1)
  const slab = (px: number, pz: number, qx: number, qz: number, nx: number, nz: number, o0: number, o1: number, y0: number, y1: number, tag: Tag) => {
    const xs = [px + nx * o0, px + nx * o1, qx + nx * o0, qx + nx * o1], zs = [pz + nz * o0, pz + nz * o1, qz + nz * o0, qz + nz * o1];
    props.push({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0, y1, tag, fixture: true });
  };
  // (a walkway's railings: along both its long sides, a little in, a metre up)
  const walkways = boxes.filter((b) => b.tag === TAG.SLAB && b.y1 - b.y0 === 1 && Math.min(b.x1 - b.x0, b.z1 - b.z0) === 1);
  for (const w of walkways) {
    const alongX = w.x1 - w.x0 > w.z1 - w.z0, i = 0.06, H = w.y1;
    const sides: [number, number, number, number, number, number][] = alongX ? [[w.x0, w.z0 + i, w.x1, w.z0 + i, 0, -1], [w.x0, w.z1 - i, w.x1, w.z1 - i, 0, 1]] : [[w.x0 + i, w.z0, w.x0 + i, w.z1, -1, 0], [w.x1 - i, w.z0, w.x1 - i, w.z1, 1, 0]];
    for (const [ax, az, bx, bz, nx, nz] of sides) { const e: Hold = { kind: 'railing', ...USES.railing, ax, ay: H + 1, az, bx, by: H + 1, bz, nx, nz }; holds.push(e); props.push(...railingProps(e)); }
  }
  // (a railing round a roof with no parapet, now and then (by each roof's own dice, so the rest is as it was): its top rail a
  // hold a metre up, a little in from the edge, with posts and a mid rail drawn; only along an edge whose roof is bare by it)
  for (const b of boxes) {
    if (b.tag !== TAG.BUILDING || b.x1 - b.x0 < 4 || b.z1 - b.z0 < 4) continue;
    const rr = seeded(hash(ctx.seed, Math.round(b.x0 * 8), Math.round(b.z0 * 8), 78));
    if (ctx.practiceLine || rr() > 0.3 || boxes.some((o) => o.tag === TAG.RIM && o.y0 === b.y1 && o.x0 >= b.x0 && o.x1 <= b.x1 && o.z0 >= b.z0 && o.z1 <= b.z1)) continue;
    const H = b.y1, i = 0.06;
    for (const [ax, az, bx, bz, nx, nz] of [[b.x0, b.z0 + i, b.x1, b.z0 + i, 0, -1], [b.x0, b.z1 - i, b.x1, b.z1 - i, 0, 1], [b.x0 + i, b.z0, b.x0 + i, b.z1, -1, 0], [b.x1 - i, b.z0, b.x1 - i, b.z1, 1, 0]] as const) {
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      let bare = true; for (let t = 0.2; t < len && bare; t += 0.5) bare = top(ax + ux * t - nx * 0.25, az + uz * t - nz * 0.25) === H;
      // (not across where a walkway comes in: it's the way on)
      if (bare && walkways.some((w) => w.y1 === H && w.x0 <= Math.max(ax, bx) + 0.1 && w.x1 >= Math.min(ax, bx) - 0.1 && w.z0 <= Math.max(az, bz) + 0.1 && w.z1 >= Math.min(az, bz) - 0.1 && (nx ? Math.abs((nx > 0 ? w.x0 : w.x1) - (nx > 0 ? b.x1 : b.x0)) < 0.01 : Math.abs((nz > 0 ? w.z0 : w.z1) - (nz > 0 ? b.z1 : b.z0)) < 0.01))) bare = false;
      if (!bare) continue;
      const e: Hold = { kind: 'railing', ...USES.railing, ax, ay: H + 1, az, bx, by: H + 1, bz, nx, nz };
      holds.push(e); props.push(...railingProps(e));
    }
  }
  for (const b of boxes) {
    if (b.tag !== TAG.BUILDING || b.y1 - b.y0 < 2 * STOREY) continue;
    const storeys = Math.floor((b.y1 - 0.5) / STOREY);
    for (const [ax, az, bx, bz, nx, nz] of [[b.x0, b.z0, b.x1, b.z0, 0, -1], [b.x0, b.z1, b.x1, b.z1, 0, 1], [b.x0, b.z0, b.x0, b.z1, -1, 0], [b.x1, b.z0, b.x1, b.z1, 1, 0]] as const) {
      const len = Math.hypot(bx - ax, bz - az); if (len < 3) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, at = (t: number): [number, number] => [ax + ux * t, az + uz * t];
      // (room in front, at a height: nothing standing there as high)
      // (room in front, under what's fixed there: nothing standing up to its underside, along it and out to its depth)
      const open = (t0: number, t1: number, out: number, y0: number) => { for (let i = 0; i <= 4; i++) for (const o of [0.02, out / 2, out]) { const [x, z] = at(t0 + ((t1 - t0) * i) / 4); if (top(x + nx * o, z + nz * o) > y0 - 0.02) return false; } return true; };
      const k = () => 1 + Math.floor(rand() * Math.max(1, storeys - 1));
      // (a ledge: a stone band the face's length, at a storey)
      if (rand() < 0.25) { const y = k() * STOREY - 0.4; if (y < b.y1 - 1 && open(0.1, len - 0.1, 0.35, y - 0.22)) { const [p, q] = [at(0.1), at(len - 0.1)]; slab(p[0], p[1], q[0], q[1], nx, nz, 0, 0.3, y - 0.22, y, TAG.RIM); hold('ledge', p[0] + nx * 0.3, y, p[1] + nz * 0.3, q[0] + nx * 0.3, y, q[1] + nz * 0.3, nx, nz); } }
      // (units under windows: a storey's sill height, a few along)
      if (rand() < 0.35) for (let n = 1 + Math.floor(rand() * 3); n > 0; n--) {
        const t = 0.8 + rand() * (len - 1.6), y = k() * STOREY + 0.9; if (y > b.y1 - 0.8 || !open(t - 0.45, t + 0.45, 0.55, y - 0.55)) continue;
        const [p, q] = [at(t - 0.45), at(t + 0.45)]; slab(p[0], p[1], q[0], q[1], nx, nz, 0, 0.5, y - 0.55, y, TAG.UNIT); hold('ac', p[0] + nx * 0.48, y, p[1] + nz * 0.48, q[0] + nx * 0.48, y, q[1] + nz * 0.48, nx, nz);
      }
      // (a sign's bracket out from the wall, its board hung under it)
      if (rand() < 0.15) {
        const t = 1 + rand() * (len - 2), y = k() * STOREY + 1.6; const [x, z] = at(t);
        if (y < b.y1 - 0.8 && open(t - 0.05, t + 0.05, 1.1, y - 0.85)) {
          // (both thin across the face: 6 cm)
          const thin = (o0: number, o1: number, y0: number, y1: number, tag: Tag) => slab(x - ux * 0.03, z - uz * 0.03, x + ux * 0.03, z + uz * 0.03, nx, nz, o0, o1, y0, y1, tag);
          thin(0, 1.05, y - 0.05, y + 0.03, TAG.BAR); thin(0.25, 1.0, y - 0.85, y - 0.12, TAG.UNIT);
          hold('sign', x + nx * 0.2, y, z + nz * 0.2, x + nx * 1.0, y, z + nz * 1.0, nx, nz); }
      }
      // (a balcony: a slab a metre out, a rail round its front)
      if (rand() < 0.2) {
        const t = 1.6 + rand() * (len - 3.2), y = k() * STOREY; if (y > b.y1 - 1.2 || !open(t - 1.2, t + 1.2, 1.05, y - 0.15)) continue;
        const [p, q] = [at(t - 1.2), at(t + 1.2)];
        slab(p[0], p[1], q[0], q[1], nx, nz, 0, 1.0, y - 0.15, y, TAG.SLAB); slab(p[0], p[1], q[0], q[1], nx, nz, 0.95, 1.0, y, y + 1.0, TAG.BAR);
        hold('balcony', p[0] + nx * 1.0, y + 1.0, p[1] + nz * 1.0, q[0] + nx * 1.0, y + 1.0, q[1] + nz * 1.0, nx, nz);
      }
      // (a fire escape: a landing at every storey from the first up to the one below the roof, its rail a hold a storey from
      // the next, the flights between drawn; on a face long enough, with room in front of it all the way up)
      if (rand() < 0.12 && storeys >= 3 && len >= 5) {
        const t = 1 + rand() * (len - 4.6), w = 3;
        if (open(t, t + w, 1.05, STOREY - 0.2)) for (let k2 = 1; k2 * STOREY < b.y1 - 1.2; k2++) {
          const y = k2 * STOREY, [p, q] = [at(t), at(t + w)], e: Hold = { kind: 'escape', ...USES.escape, ax: p[0] + nx * 1.0, ay: y + 1.0, az: p[1] + nz * 1.0, bx: q[0] + nx * 1.0, by: y + 1.0, bz: q[1] + nz * 1.0, nx, nz };
          holds.push(e); props.push(...escapeProps(e));
        }
      }
    }
  }
  return { holds, props };
}

/** the details (see `Detail`): on the buildings' faces and roofs, and in the street by them */
function details(boxes: Box[], holds: Hold[], rand: Rand): { details: Detail[]; holds: Hold[] } {
  const out: Detail[] = [], made: Hold[] = [], seed = () => Math.floor(rand() * 1e6);
  const pipe = (a: [number, number, number], b: [number, number, number], nx: number, nz: number): Hold => ({ kind: 'pipe', ...USES.pipe, ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2], nx, nz });
  const top = (x: number, z: number) => { let h = 0; for (const o of boxes) if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1) h = Math.max(h, o.y1); return h; };
  const add = (kind: DetailKind, pts: [number, number, number][], n: [number, number], w: number, h: number, extra: Partial<Detail> = {}) => out.push({ kind, pts, n, w, h, seed: seed(), ...extra });
  for (const b of boxes) {
    if (b.tag !== TAG.BUILDING) continue;
    const H = b.y1, storeys = Math.max(1, Math.round(H / STOREY));
    for (const [ax, az, bx, bz, nx, nz] of [[b.x0, b.z0, b.x1, b.z0, 0, -1], [b.x0, b.z1, b.x1, b.z1, 0, 1], [b.x0, b.z0, b.x0, b.z1, -1, 0], [b.x1, b.z0, b.x1, b.z1, 1, 0]] as const) {
      const len = Math.hypot(bx - ax, bz - az); if (len < 2) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, at = (t: number, y: number, out0 = 0.02): [number, number, number] => [ax + ux * t + nx * out0, y, az + uz * t + nz * out0];
      // (what's in front of this face: open to the sky (a street or a wide yard) or another building close (an alley)
      const front = (out1: number) => top(ax + ux * len / 2 + nx * out1, az + uz * len / 2 + nz * out1), street = front(1.5) === 0 && front(4) === 0;
      // (the windows: a row a storey, set in from the corners, sill to head; how many lit, by the storey's dice)
      const shop = street && rand() < 0.3;
      // (a row above the ground sits on the face's sill at that storey, if it has one: the sill's the hold, the row's what's seen of it)
      const onFace = (h: Hold) => h.nx === nx && h.nz === nz && Math.abs((h.ax - ax) * nx + (h.az - az) * nz) < 0.01 && h.ax >= Math.min(ax, bx) - 0.01 && h.ax <= Math.max(ax, bx) + 0.01 && h.az >= Math.min(az, bz) - 0.01 && h.az <= Math.max(az, bz) + 0.01;
      const sills = holds.filter((h) => h.kind === 'sill' && onFace(h));
      for (let k = shop ? 1 : 0; k < storeys; k++) {
        const y = k ? k * STOREY : 0.9, n = Math.max(1, Math.floor((len - 1.2) / 1.6)); if (y + 1.4 > H) break;
        const sill = sills.find((h) => Math.abs(h.ay - y) < 0.01);
        add('windows', [at(0.6, y), at(len - 0.6, y)], [nx, nz], len - 1.2, 1.4, { count: n, lit: Math.round(n * rand() * 0.8), ...(sill ? { holds: [sill] } : {}) });
      }
      // (a shopfront at street level: an awning over it, sometimes neon above)
      if (shop) { add('awning', [at(0.4, 2.6, 0.9), at(len - 0.4, 2.6, 0.9)], [nx, nz], len - 0.8, 0.5); if (rand() < 0.45) add('neon', [at(len * 0.2, 3.2), at(len * 0.8, 3.2)], [nx, nz], len * 0.6, 0.6); }
      // (a bundle of pipes: up from the street, across a way at a storey, on up to the roof)
      if (storeys >= 2 && rand() < 0.3) {
        const t0 = 0.5 + rand() * (len - 1), y1 = STOREY * (1 + Math.floor(rand() * (storeys - 1))) + 1.5, t1 = Math.max(0.4, Math.min(len - 0.4, t0 + (rand() < 0.5 ? -1 : 1) * (1 + rand() * 2.5)));
        const pts = [at(t0, 0, 0.12), at(t0, y1, 0.12), at(t1, y1 + 0.4, 0.12), at(t1, H, 0.12)];
        // (its runs up the face are pipes to climb, on the face's line like a drainpipe: the street to the jog, the jog to the roof)
        const runs = [pipe(at(t0, 0, 0), at(t0, y1, 0), nx, nz), pipe(at(t1, y1 + 0.4, 0), at(t1, H, 0), nx, nz)];
        made.push(...runs);
        add('pipes', pts, [nx, nz], 0.35, H, { count: 2 + Math.floor(rand() * 3), holds: runs }); if (rand() < 0.6) add('rust', [at(t1, y1 + 0.3), at(t1, Math.max(0.3, y1 - 2 - rand() * 3))], [nx, nz], 0.3, 2.5, { holds: [runs[1]] });
      }
      // (a ladder up the side, from the first storey to over the roof's edge)
      // (climbed as a pipe is, hand over hand, for now: its own kind of hold when it's its own climb)
      if (storeys >= 2 && rand() < 0.08) { const t = 0.6 + rand() * (len - 1.2), run = pipe(at(t, STOREY, 0), at(t, H, 0), nx, nz); made.push(run); add('ladder', [at(t, STOREY, 0.1), at(t, H + 1, 0.1)], [nx, nz], 0.5, H + 1 - STOREY, { holds: [run] }); }
      // (a blade sign standing out from the face, a few storeys up)
      if (storeys >= 2 && rand() < 0.15) { const t = 0.5 + rand() * (len - 1), y0 = STOREY + 0.5, h = Math.min(H - y0 - 0.3, 2 + rand() * 3); if (h > 1) add('blade', [at(t, y0 + h, 0.6), at(t, y0, 0.6)], [nx, nz], 0.5, h); }
      // (at street level against the face: a vending machine, a bin)
      if (street && rand() < 0.12) { const t = 0.6 + rand() * (len - 1.2), p = at(t, 0, 0.4); if (top(p[0], p[2]) === 0) add('vending', [p], [nx, nz], 0.9, 1.8); }
      if (street && rand() < 0.15) { const t = 0.4 + rand() * (len - 0.8), p = at(t, 0, 0.35); if (top(p[0], p[2]) === 0) add('bin', [p], [nx, nz], 0.5, 1); }
      // (poles along a street face, a pole every fourteen metres or so, wires strung pole to pole with a sag, and one down to
      // the face at the first storey)
      if (street && len >= 6 && rand() < 0.5) {
        const poles: [number, number, number][] = [];
        for (let t = 2 + rand() * 4; t < len - 1; t += 12 + rand() * 4) { const p = at(t, 0, 1.3); if (top(p[0], p[2]) === 0) { poles.push(p); add('pole', [p], [0, 0], 0.25, 8); } }
        for (let i = 0; i + 1 < poles.length; i++) for (const hy of [6.6, 7.2]) { const a = poles[i], c = poles[i + 1], m: [number, number, number] = [(a[0] + c[0]) / 2, hy - 0.35, (a[2] + c[2]) / 2]; add('wire', [[a[0], hy, a[2]], m, [c[0], hy, c[2]]], [0, 0], 0.02, 0); }
        if (poles.length && H > 5) { const p = poles[0]; add('wire', [[p[0], 6.3, p[2]], [p[0] - nx * 0.65, 5.2, p[2] - nz * 0.65], [p[0] - nx * 1.28, 4.6, p[2] - nz * 1.28]], [0, 0], 0.02, 0); }
      }
    }
    // (rust down from each unit on its faces)
    for (const h of holds) { const wx = (h.ax + h.bx) / 2 - h.nx * 0.48, wz = (h.az + h.bz) / 2 - h.nz * 0.48; if (h.kind !== 'ac' || wx < b.x0 - 0.01 || wx > b.x1 + 0.01 || wz < b.z0 - 0.01 || wz > b.z1 + 0.01 || h.ay > b.y1) continue; if (rand() < 0.5) { const mx = (h.ax + h.bx) / 2 - h.nx * 0.46, mz = (h.az + h.bz) / 2 - h.nz * 0.46; add('rust', [[mx, h.ay - 0.55, mz], [mx, Math.max(0.3, h.ay - 0.55 - 1 - rand() * 2.5), mz]], [h.nx, h.nz], 0.4, 2, { holds: [h] }); } }
    // (on the roof, where it's bare: a billboard on a frame along an edge, aerials, a dish, a line of laundry)
    const w = b.x1 - b.x0, d = b.z1 - b.z0, bare = (x: number, z: number) => top(x, z) === H, onRoof = (fx: number, fz: number): [number, number, number] => [b.x0 + 0.5 + fx * (w - 1), H, b.z0 + 0.5 + fz * (d - 1)];
    if (w >= 6 && d >= 6 && rand() < 0.07) { const alongX = rand() < 0.5, e = rand() < 0.5 ? 0 : 1, a: [number, number, number] = alongX ? [b.x0 + 1, H, e ? b.z1 - 1 : b.z0 + 1] : [e ? b.x1 - 1 : b.x0 + 1, H, b.z0 + 1], c: [number, number, number] = alongX ? [b.x1 - 1, H, a[2]] : [a[0], H, b.z1 - 1]; if (bare(a[0], a[2]) && bare(c[0], c[2])) add('billboard', [a, c], alongX ? [0, e ? 1 : -1] : [e ? 1 : -1, 0], Math.hypot(c[0] - a[0], c[2] - a[2]), 3); }
    for (let n = rand() < 0.35 ? 1 + Math.floor(rand() * 2) : 0; n > 0; n--) { const p = onRoof(rand(), rand()); if (bare(p[0], p[2])) add('aerial', [p], [0, 0], 0.6, 1.5 + rand() * 1.5); }
    if (rand() < 0.15) { const p = onRoof(rand(), rand()); if (bare(p[0], p[2])) add('dish', [p], [0, 0], 0.8, 1.1); }
    if (w >= 4 && d >= 4 && rand() < 0.1) { const a = onRoof(0.2, 0.3 + 0.4 * rand()), c = onRoof(0.8, a[2] > 0 ? (a[2] - b.z0 - 0.5) / (d - 1) : 0.5); if (bare(a[0], a[2]) && bare(c[0], c[2])) add('laundry', [[a[0], H + 1.6, a[2]], [c[0], H + 1.6, c[2]]], [0, 0], Math.hypot(c[0] - a[0], c[2] - a[2]), 1.6); }
  }
  return { details: out, holds: made };
}

/** a chunk's parts, in order: each made by its own dice (`salt`) from what's there before it */
export const PARTS: Part[] = [
  { name: 'structure', salt: 91, holds: ['edge', 'face', 'sill', 'pipe', 'rail'], details: [], props: 'drainpipes (drawn by `drawn holds`)',
    make: (ctx, rand) => { ctx.holds.push(...structure(ctx.boxes, rand, ctx.authored)); } },
  { name: 'fixtures', salt: 95, holds: ['ledge', 'ac', 'sign', 'balcony', 'escape', 'railing'], details: [], props: 'each fixture drawn: ledges, units, signs, balconies, fire escapes, railings',
    when: (ctx) => !ctx.authored, make: (ctx, rand) => { const f = fixtures(ctx, ctx.boxes, rand); ctx.holds.push(...f.holds); ctx.props.push(...f.props); } },
  { name: 'course', salt: 0, holds: [], details: [], props: "a course's holds and bars, by hand", when: (ctx) => ctx.authored,
    make: (ctx) => { for (const h of ctx.course!.holds ?? []) ctx.holds.push({ ...h, ...USES[h.kind] }); } },
  { name: 'drawn holds', salt: 0, holds: [], details: [], props: "every pipe (a thing to climb should be seen), and every hold a course places by hand",
    make: (ctx) => { ctx.props.push(...ctx.holds.filter((h) => h.kind === 'pipe').flatMap((h) => holdProps(h)), ...(ctx.authored ? (ctx.course!.holds ?? []).filter((h) => h.kind !== 'pipe').flatMap((h) => holdProps({ ...h, ...USES[h.kind] })) : []));
      if (ctx.authored) for (const b of ctx.course!.bars ?? []) {
        ctx.props.push({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y0: b.y - 0.04, y1: b.y + 0.04, tag: TAG.BAR });
        const alongX = b.x1 - b.x0 >= b.z1 - b.z0, mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
        ctx.holds.push(alongX ? { kind: 'bar', ...USES.bar, ax: b.x0, ay: b.y, az: mz, bx: b.x1, by: b.y, bz: mz, nx: 0, nz: 0 } : { kind: 'bar', ...USES.bar, ax: mx, ay: b.y, az: b.z0, bx: mx, by: b.y, bz: b.z1, nx: 0, nz: 0 });
      } } },
  { name: 'alley bars', salt: 93, holds: ['bar'], details: [], props: 'a bar across some alleys, on posts',
    make: (ctx, br) => { const boxes = ctx.boxes, holds = ctx.holds, props = ctx.props, authored = ctx.authored, blds = boxes.filter((b) => b.tag === TAG.BUILDING);
    for (const a of authored ? [] : blds) for (const b of blds) {
      if (a === b || a.y1 !== b.y1 || br() > 0.3) continue;
      const y = a.y1 + 1.3;
      // (b across an alley from a, to its east or north: the gap, and how much of their faces face each other)
      for (const ax of [0, 1]) {
        const gap = ax === 0 ? b.x0 - a.x1 : b.z0 - a.z1, lo = ax === 0 ? Math.max(a.z0, b.z0) : Math.max(a.x0, b.x0), hi = ax === 0 ? Math.min(a.z1, b.z1) : Math.min(a.x1, b.x1);
        if (gap < 1 || gap > 3 || hi - lo < 3) continue;
        const m = Math.round((lo + hi) / 2) + 0.5, s0 = (ax === 0 ? a.x1 : a.z1) - 0.6, s1 = (ax === 0 ? b.x0 : b.z0) + 0.6;
        // (its ends on bare roof: not on a rim, a unit, anything stood on the roof)
        const top = (p: number) => { const x = ax === 0 ? p : m, z = ax === 0 ? m : p; let h = 0; for (const o of boxes) if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1) h = Math.max(h, o.y1); return h; };
        if (top(s0) !== a.y1 || top(s1) !== a.y1 || top((s0 + s1) / 2) > a.y1 - 1) continue;
        const bar = (p0: number, p1: number, q0: number, q1: number, y0: number, y1: number): Box => ax === 0 ? { x0: p0, x1: p1, z0: q0, z1: q1, y0, y1, tag: TAG.BAR } : { x0: q0, x1: q1, z0: p0, z1: p1, y0, y1, tag: TAG.BAR };
        props.push(bar(s0, s1, m - 0.04, m + 0.04, y - 0.04, y + 0.04), bar(s0, s0 + 0.08, m - 0.04, m + 0.04, a.y1, y), bar(s1 - 0.08, s1, m - 0.04, m + 0.04, a.y1, y));
        holds.push(ax === 0 ? { kind: 'bar', ...USES.bar, ax: s0, ay: y, az: m, bx: s1, by: y, bz: m, nx: 0, nz: 0 } : { kind: 'bar', ...USES.bar, ax: m, ay: y, az: s0, bx: m, by: y, bz: s1, nx: 0, nz: 0 });
      }
    }
    } },
  { name: 'ground detail', salt: 97, holds: [], details: [], props: 'debris, clutter, skylights on the roofs (regions the feet mind)',
    make: (ctx, gr) => { const boxes = ctx.boxes, props = ctx.props, regions = ctx.regions, authored = ctx.authored, blds = boxes.filter((b) => b.tag === TAG.BUILDING);
    // (ground detail on the roofs, by its own dice: only where the roof is bare under all of it)
    const bare = (x0: number, z0: number, x1: number, z1: number, y: number) => [[x0, z0], [x1 - 0.01, z0], [x0, z1 - 0.01], [x1 - 0.01, z1 - 0.01], [(x0 + x1) / 2, (z0 + z1) / 2]].every(([x, z]) => { let h = 0; for (const o of boxes) if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1) h = Math.max(h, o.y1); return h === y; });
    for (const b of authored ? [] : blds) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0; if (w < 4 || d < 4) continue;
      const place = (kind: RegionKind, sw: number, sd: number, tall: number, tag: Tag) => {
        for (let k = 0; k < 4; k++) {
          const x0 = b.x0 + 0.5 + gr() * (w - sw - 1), z0 = b.z0 + 0.5 + gr() * (d - sd - 1);
          if (!bare(x0, z0, x0 + sw, z0 + sd, b.y1)) continue;
          regions.push({ kind, x0, z0, x1: x0 + sw, z1: z0 + sd, y: b.y1 }); props.push({ x0, z0, x1: x0 + sw, z1: z0 + sd, y0: b.y1, y1: b.y1 + tall, tag }); return;
        }
      };
      for (let n = Math.floor(gr() * 3); n > 0; n--) { const s = 0.8 + gr() * 1.6; place('debris', s, s * (0.6 + gr() * 0.8), 0.04, TAG.DEBRIS); }
      if (gr() < 0.5) { const along = gr() < 0.5, l = 2 + gr() * Math.min(5, (along ? w : d) - 2); place('clutter', along ? l : 0.3, along ? 0.3 : l, 0.25, TAG.CLUTTER); }
      if (gr() < 0.2) place('nogo', 1, 1.5, 0.15, TAG.SKYLIGHT);
    }
    } },
  { name: 'details', salt: 99, holds: ['pipe'], details: ['windows', 'pipes', 'ladder', 'blade', 'rust', 'awning', 'neon', 'billboard', 'aerial', 'dish', 'laundry', 'pole', 'wire', 'vending', 'bin'], props: 'none yet (the looks to come)',
    when: generated, make: (ctx, rand) => { const d = details(ctx.boxes, ctx.holds, rand); ctx.details.push(...d.details); ctx.holds.push(...d.holds); } },
];

/** furnish a chunk: every part in order, each with its own dice */
export function furnish(ctx: PartCtx): void {
  for (const p of PARTS) if (!p.when || p.when(ctx)) p.make(ctx, seeded(hash(ctx.seed, ctx.cx, ctx.cz, p.salt)));
}
