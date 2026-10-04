/**
 * The pasture's grass, at the scale of a pat's fungi: a forest.
 *
 * Grazed, the sward is short (a few centimetres), its blades bitten off — the tips torn square
 * and browning. But cattle won't graze near their own dung, so round each pat the grass grows
 * on, rank, taller and darker: long blades that arch over and lean in. Where a pat lies the
 * grass under it is smothered; on an old pat it comes back through. Dead leaves lie in the
 * thatch at its feet. Before dawn the blades bead with dew, which is gone by mid-morning.
 *
 * Every blade comes from the field's seed and its cell, so the grass is the same wherever you
 * look from; it's drawn only near the camera (finer nearer), and never between the camera and
 * what it's looking at.
 */
import { hash, seeded } from '../kit/rng';
import type { V3 } from './genome';
import { blade, ribbon, MAT_PLANT, type Limbs } from './critters';

/** the cells the field's grass is generated in (mm) */
const CELL = 10;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** What the grass needs to know of the pats: how much rank grass here (0..1: none, a ring), and
 *  whether a pat smothers it (and how far the grass is back over it: 0 smothered, 1 back). */
export interface Field {
  groundY: (x: number, z: number) => number;
  rank: (x: number, z: number) => number;
  under: (x: number, z: number) => number;
}

interface Blade {
  x: number;
  z: number;
  h: number;
  w: number;
  az: number;
  lean: number;
  droop: number;
  col: V3;
  torn: number;
  brown: number;
  seed: number;
}

/** A cell's blades (and its thatch), from the seed. */
function cell(world: number, ix: number, iz: number, f: Field) {
  const r = seeded(hash(world, 0x6a55, ix + 100000, iz + 100000));
  const blades: Blade[] = [];
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const x = (ix + r()) * CELL;
    const z = (iz + r()) * CELL;
    const back = f.under(x, z);
    if (r() > back) continue;
    const rank = f.rank(x, z);
    // grazed: short, torn; rank: long, arching, darker; a few going over, yellowing
    const tall = r() < rank;
    const h = tall ? lerp(70, 170, r()) : lerp(18, 48, r()) * (0.4 + 0.6 * back);
    const old = r() < 0.12;
    const green: V3 = tall ? [lerp(0.16, 0.22, r()), lerp(0.36, 0.46, r()), lerp(0.08, 0.12, r())] : [lerp(0.22, 0.32, r()), lerp(0.42, 0.52, r()), lerp(0.1, 0.16, r())];
    blades.push({
      x,
      z,
      h,
      w: lerp(2, tall ? 5 : 3.8, r()),
      az: r() * Math.PI * 2,
      lean: lerp(0.05, tall ? 0.45 : 0.3, r()),
      droop: tall ? lerp(0.6, 1.8, r()) : lerp(0.05, 0.35, r()),
      col: old ? [0.5, 0.48, 0.24] : green,
      torn: tall ? 0 : 1,
      brown: old ? 0.8 : tall ? r() * 0.3 : lerp(0.2, 0.6, r()),
      seed: r() * 100,
    });
  }
  // the thatch: last year's leaves, flat, bleached, lying every way
  const thatch: Array<{ pts: Array<[number, number]>; w: number; col: V3; seed: number }> = [];
  if (r() < 0.6 && f.under((ix + 0.5) * CELL, (iz + 0.5) * CELL) > 0.95) {
    const a = r() * Math.PI * 2;
    const L = lerp(10, 45, r());
    const x0 = (ix + r()) * CELL;
    const z0 = (iz + r()) * CELL;
    const bend = (r() - 0.5) * 0.5;
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < 7; k++) {
      const aa = a + bend * (k / 6);
      const q: [number, number] = [x0 + Math.cos(aa) * (L * k) / 6, z0 + Math.sin(aa) * (L * k) / 6];
      // (it lies in the grass, not over a pat: it stops at the edge)
      if (f.under(q[0], q[1]) < 0.95) break;
      pts.push(q);
    }
    const m = lerp(0.8, 1.2, r());
    if (pts.length >= 3) thatch.push({ pts, w: lerp(1, 2.4, r()), col: [0.42 * m, 0.38 * m, 0.24 * m], seed: r() * 100 });
  }
  return { blades, thatch };
}

/** The grass near the camera, into the frame's limbs (and its dew into the droplets). */
/** (cells, kept a while: what the pats do to the grass changes over hours, not frames) */
const cache = new Map<string, { epoch: number; c: ReturnType<typeof cell> }>();
function cached(world: number, ix: number, iz: number, f: Field, epoch: number) {
  const key = `${world}:${ix}:${iz}`;
  const hit = cache.get(key);
  if (hit && hit.epoch === epoch) return hit.c;
  if (cache.size > 4000) cache.clear();
  const c = cell(world, ix, iz, f);
  cache.set(key, { epoch, c });
  return c;
}
/** The line from the eye to what it's looking at, and a cone round it (the lens's view, a little
 *  narrowed) kept clear up to near the subject: does something this wide at (x, z) stand in it? */
export function sightline(eye: V3, look: V3) {
  const ex = eye[0];
  const ez = eye[2];
  const lx = look[0] - ex;
  const lz = look[2] - ez;
  const ll = Math.hypot(lx, lz) || 1;
  return (x: number, z: number, w: number) => {
    const t = ((x - ex) * lx + (z - ez) * lz) / (ll * ll);
    if (t < -0.05 || t > 0.86) return false;
    const d = Math.abs((x - ex) * lz - (z - ez) * lx) / ll;
    // (and right round the lens, as if it had pushed in through the grass)
    if (Math.hypot(x - ex, z - ez) < 30 + w) return true;
    return d < 5 + w + Math.max(0, t) * ll * 0.2;
  };
}
/** The view from `eye` to `look`: where a point is in it (across and up as tangents, and how far
 * in front), and whether a plant drawn along `pts` comes between the lens and what it's on (seen
 * in 3D: a tall one beside the line of sight can arch over into it). */
export function viewOf(eye: V3, look: V3) {
  const fw = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
  const fl = Math.hypot(fw[0], fw[1], fw[2]) || 1;
  const fd = [fw[0] / fl, fw[1] / fl, fw[2] / fl];
  const rh = Math.hypot(fd[0], fd[2]) || 1;
  const rt = [-fd[2] / rh, 0, fd[0] / rh];
  const up = [rt[1] * fd[2] - rt[2] * fd[1], rt[2] * fd[0] - rt[0] * fd[2], rt[0] * fd[1] - rt[1] * fd[0]];
  // where a point is in the view: across and up (as tangents), and how far in front of the lens
  const inView = (q: V3) => {
    const d = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]];
    const zz = d[0] * fd[0] + d[1] * fd[1] + d[2] * fd[2];
    return { zz, x: (d[0] * rt[0] + d[2] * rt[2]) / Math.max(zz, 1e-3), y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / Math.max(zz, 1e-3) };
  };
  /** whether a blade, drawn along `pts`, comes between the lens and what it's on (seen in 3D: a
   * tall one beside the line of sight can arch over into it) */
  const inTheWay = (pts: V3[], w: number) => {
    for (const q of pts) {
      const v = inView(q);
      if (v.zz < 0.3 || v.zz > fl * 0.88) continue;
      const m = w / 2 / v.zz;
      if (Math.abs(v.x) < 0.22 + m && Math.abs(v.y) < 0.3 + m) return true;
    }
    return false;
  };
  return { inTheWay, inView };
}
/** A tall blade about `r` from (x, z) — a point a third of the way up it (for the lens). */
export function bladeNear(world: number, f: Field, x: number, z: number, r: number, epoch: number): V3 | null {
  for (let k = 0; k < 24; k++) {
    const a = k * 2.4;
    const ix = Math.floor((x + Math.cos(a) * r) / CELL);
    const iz = Math.floor((z + Math.sin(a) * r) / CELL);
    for (const b of cached(world, ix, iz, f, epoch).blades) {
      if (b.h < 60 || b.brown > 0.5) continue;
      const s = 0.35 * b.h;
      return [b.x + Math.cos(b.az) * Math.sin(b.lean) * s, f.groundY(b.x, b.z) + Math.cos(b.lean) * s, b.z + Math.sin(b.az) * Math.sin(b.lean) * s];
    }
  }
  return null;
}
export function drawGrass(world: number, f: Field, look: V3, eye: V3, time: number, hour: number, epoch: number, out: Limbs, dew: number[]) {
  const R = 130;
  // (dew: from the small hours to mid-morning)
  const ss = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  const wet = ss(1.5, 5, hour) * (1 - ss(8.5, 10.5, hour));
  const blocks = sightline(eye, look);
  const { inTheWay, inView } = viewOf(eye, look);
  /** whether it stays in the bottom of the frame (below a quarter of the way up), all of it in
   * front of the lens */
  const along = (pts: V3[]) => pts.every((q) => {
    const v = inView(q);
    return v.zz > 4 && v.y < -0.16;
  });
  for (let ix = Math.floor((look[0] - R) / CELL); ix <= Math.floor((look[0] + R) / CELL); ix++) {
    for (let iz = Math.floor((look[2] - R) / CELL); iz <= Math.floor((look[2] + R) / CELL); iz++) {
      const cx = (ix + 0.5) * CELL - look[0];
      const cz = (iz + 0.5) * CELL - look[2];
      const dl = Math.hypot(cx, cz);
      if (dl > R) continue;
      const c = cached(world, ix, iz, f, epoch);
      for (const b of c.blades) {
        // (thinner further out)
        if (dl > 80 && (b.seed % 1) * 2 > (R - dl) / (R - 80) + 0.4) continue;
        // (one whose root is in the way, or a tall one arching into it, isn't drawn)
        const fore = (b.seed * 7.13) % 1 < 0.3 && Math.hypot(b.x - eye[0], b.z - eye[2]) < 45;
        if (!fore) {
          if (blocks(b.x, b.z, b.w)) continue;
          const reach = b.h * Math.sin(Math.min(1.5, b.lean + b.droop * 0.5));
          let blocked = false;
          for (const k of [0.25, 0.5, 0.75, 1]) if (blocks(b.x + Math.cos(b.az) * reach * k, b.z + Math.sin(b.az) * reach * k, b.w)) blocked = true;
          if (blocked) continue;
        }
        const de = Math.hypot(b.x - eye[0], b.z - eye[2], eye[1]);
        const near = de < 70;
        const N = near ? 10 : 6;
        const y0 = f.groundY(b.x, b.z);
        const dir: V3 = [Math.cos(b.az), 0, Math.sin(b.az)];
        const across: V3 = [-dir[2], 0, dir[0]];
        const sway = Math.sin(time * 1.1 + b.x * 0.05 + b.z * 0.03) * 0.06 + Math.sin(time * 2.7 + b.seed) * 0.015;
        const pts: V3[] = [];
        const rad: number[] = [];
        let p: V3 = [b.x, y0 - 1, b.z];
        const ds = b.h / (N - 1);
        // (dew weighs it down: a tall blade bows further under its beads)
        const droop = b.droop + wet * 0.35 * Math.min(1, b.h / 70);
        let lying = false;
        for (let k = 0; k < N; k++) {
          const s = k / (N - 1);
          if (k > 0) {
            // (bowed over to the ground, it lies along it: never into it)
            const th = lying ? Math.PI / 2 : b.lean + droop * s * s + sway * s;
            p = [p[0] + dir[0] * Math.sin(th) * ds, p[1] + Math.cos(th) * ds, p[2] + dir[2] * Math.sin(th) * ds];
            const floor = f.groundY(p[0], p[2]) + b.w * 0.1;
            if (p[1] < floor) {
              p[1] = floor;
              lying = true;
            }
          }
          pts.push(p);
          const taper = b.torn ? 1 - 0.15 * s : s < 0.55 ? 1 : 1 - Math.pow((s - 0.55) / 0.45, 1.3) * 0.95;
          rad.push((b.w / 2) * taper * (k === 0 ? 0.8 : 1));
        }
        // (and nothing comes across the view, but a few just by the lens: soft, out of focus along
        // the bottom of the frame, the camera in among them)
        if (fore ? !along(pts) && (blocks(b.x, b.z, b.w) || inTheWay(pts, b.w)) : inTheWay(pts, b.w)) continue;
        blade(near ? out.bladeHi : out.bladeLo, pts, rad, b.col, b.seed, across, b.torn, b.brown);
        // dew: beads along it, on its upper side, the more for a lower, wetter blade
        if (wet > 0.05 && near) {
          const nd = Math.floor(wet * (3 + (b.seed % 6)));
          for (let k = 0; k < nd; k++) {
            const s = 0.15 + 0.75 * ((b.seed * (k + 1) * 7.31) % 1);
            const i = Math.min(N - 2, Math.floor(s * (N - 1)));
            const fr = s * (N - 1) - i;
            const q: V3 = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * fr, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * fr, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * fr];
            const off = (((b.seed * (k + 3) * 3.7) % 1) - 0.5) * b.w * 0.7;
            const rr = (0.35 + 1.1 * Math.pow((b.seed * (k + 5) * 1.93) % 1, 2)) * wet * Math.min(1, b.w / 3);
            dew.push(q[0] + across[0] * off, q[1] + rr * 0.75, q[2] + across[2] * off, rr, rr * 0.88, rr, 1, 1, 1, 1);
          }
          // (and one hanging at its tip, heavy)
          const tip = pts[N - 1];
          const rt = (0.8 + 1.2 * ((b.seed * 9.7) % 1)) * wet * Math.min(1, b.w / 3);
          dew.push(tip[0], tip[1] - rt * 0.8, tip[2], rt, rt * 1.1, rt, 1, 1, 1, 1);
        }
      }
      for (const t of c.thatch) {
        if (dl > 90) continue;
        const pts: V3[] = t.pts.map(([x, z]) => [x, f.groundY(x, z) + t.w * 0.08, z]);
        ribbon(dl < 40 ? out.mid : out.lo, pts, pts.map(() => t.w / 2), t.col, MAT_PLANT, t.seed);
      }
    }
  }
}
