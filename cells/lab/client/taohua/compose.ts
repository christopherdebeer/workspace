/**
 * Taohua: the composition. Before any tree is grown, the ways up the hill are given their places:
 * stations beside them, at forks, and at the ends of branches that end in a clearing, each a space kept open
 * on the paper, the way the prints keep paper clear for their verse. A station holds a cast from
 * Changes, from the seed and the station's number, written on the hillside there; its trigrams
 * shape the space (what stands behind it, what lies in it); the hillside is grown around them, the trees standing back from their edges, so each reads as a
 * shape in the picture and not as a gap.
 *
 * A station's space is an ellipse on the ground, across the hill (x) and up it (z). Trees stand
 * back further on its downhill side than its uphill: the eye looks up the hill from above, so a
 * crown hides the ground a little uphill of where it stands.
 */
import { hash, seeded } from '../kit/rng';
import { identify, type Line } from '../changes/model';
import { WIDTH, Ways, type Junction, type V3, type Way } from './ways';

export type StationKind = 'changes';
export interface Station {
  i: number; kind: StationKind;
  /** its cast: six lines, bottom to top, each 6 (old yin, moving), 7 (young yang), 8 (young yin) or 9 (old yang, moving) */
  lines: Line[];
  /** its trigrams' images, lower and upper: what lies in its space, and what stands behind it */
  lower: string; upper: string;
  /** the way it's beside, how far along, and which side (+1 right of its going) */
  w: Way; u: number; side: number;
  /** its middle on the ground, and its half-sizes across the hill and up it */
  c: V3; rx: number; rz: number;
}

/** a station's space: for a cast, its figure, its names and their titles, as the camera sees them */
const RX = 3.6, RZ = 6.6;

/**
 * A cast, from the seed and the station's number: six lines, each as three coins fall (two sides
 * of each worth two or three, summed), so old lines come as often as they would.
 */
export function cast(seed: number, i: number): Line[] {
  const r = seeded(hash(seed, i, 0xc4a5));
  return Array.from({ length: 6 }, () => (6 + (r() < 0.5 ? 1 : 0) + (r() < 0.5 ? 1 : 0) + (r() < 0.5 ? 1 : 0)) as Line);
}

/** whether a space about c is clear of every way */
function clearOfWays(ways: Ways, c: V3): boolean {
  if (ways.nearest(c[0], c[2]).d < WIDTH / 2 + 0.4) return false;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (ways.nearest(c[0] + Math.cos(a) * RX * 1.05, c[2] + Math.sin(a) * RZ * 1.05).d < WIDTH / 2 + 0.4) return false;
  }
  return true;
}
const make = (seed: number, i: number, w: Way, u: number, side: number, c: V3): Station => {
  const lines = cast(seed, i), hex = identify(lines);
  return { i, kind: 'changes', lines, lower: hex.lower.image, upper: hex.upper.image, w, u, side, c, rx: RX, rz: RZ };
};

const memo = new Map<string, Station | null>();
/**
 * The station at a junction, if it has one: where a branch ends in a clearing, there, just past its
 * end; where the way forks, now and then, in the space up the hill between the forks.
 */
export function stationAt(ways: Ways, seed: number, j: Junction): Station | null {
  const key = `${seed}:j${j.n}`;
  if (memo.has(key)) return memo.get(key)!;
  let st: Station | null = null;
  const r = seeded(hash(seed, j.n, 0x57a8));
  const w = j.ins[0];
  if (w && j.end === 'cast') {
    const d = ways.at(w, w.len, true).dir;
    for (const k of [RZ * 0.55, RZ * 0.8, RZ * 0.3]) {
      const c: V3 = [j.x + d[0] * k, 0, j.z + d[1] * k];
      c[1] = ways.hill(c[2]);
      if (clearOfWays(ways, c)) { st = make(seed, 200000 + j.n, w, w.len, 0, c); break; }
    }
  } else if (w && j.outs.length > 1 && !j.gate && r() < 0.4) {
    // (the forks' two first goings; between them, up the hill)
    const ds = j.outs.slice(0, 2).map((o) => ways.at(o, Math.min(6, o.len), true).dir);
    const mid = norm2([ds[0][0] + ds[1][0], ds[0][1] + ds[1][1]]);
    for (const k of [RZ * 1.3, RZ * 1.7, RZ * 2.1]) {
      const c: V3 = [j.x + mid[0] * k, 0, j.z + mid[1] * k];
      c[1] = ways.hill(c[2]);
      if (clearOfWays(ways, c) && !crowded(ways, seed, c, j.n)) { st = make(seed, 300000 + j.n, w, w.len, 0, c); break; }
    }
  }
  memo.set(key, st);
  return st;
}

/**
 * The station beside a way, if it has one: about a quarter of the ways, long enough, but not the spurs;
 * partway along, on whichever side has room clear of every way, and of other stations.
 */
export function stationOf(ways: Ways, seed: number, w: Way): Station | null {
  const key = `${seed}:${w.id}`;
  if (memo.has(key)) return memo.get(key)!;
  const r = seeded(hash(seed, w.n, 0x57a7));
  let st: Station | null = null;
  if (r() < 0.28 && w.len > 20 && !w.spur && !w.to.gate && !w.from.gate) {
    const first = r() < 0.5 ? 1 : -1;
    for (const u of [w.len * 0.5, w.len * 0.35, w.len * 0.65]) {
      for (const side of [first, -first]) {
        const at = ways.at(w, u, true);
        // (out from the way by as far as the space reaches that way, which is further where the way runs across the hill)
        const nx = at.dir[1], nz = -at.dir[0];
        const off = WIDTH / 2 + 1.1 + Math.hypot(RX * nx, RZ * nz);
        const c: V3 = [at.p[0] + nx * side * off, 0, at.p[2] + nz * side * off];
        c[1] = ways.hill(c[2]);
        let clear = clearOfWays(ways, c);
        // (nor near another station: each its own space on the print)
        if (clear) for (const o of nearOthers(ways, seed, c, w.n)) if (Math.hypot((o.c[0] - c[0]) / (RX * 5), (o.c[2] - c[2]) / (RZ * 3.4)) < 1) { clear = false; break; }
        if (!clear) continue;
        st = make(seed, w.n * 4, w, u, side, c);
        break;
      }
      if (st) break;
    }
  }
  memo.set(key, st);
  return st;
}
/** whether another junction's station (made before junction n) is near c */
function crowded(ways: Ways, seed: number, c: V3, n: number): boolean {
  for (const o of ways.junctionsNear(c[2] - 40, c[2] + 40)) {
    if (o.n >= n) continue;
    const s = stationAt(ways, seed, o);
    if (s && Math.hypot((s.c[0] - c[0]) / (RX * 5), (s.c[2] - c[2]) / (RZ * 3.4)) < 1) return true;
  }
  return false;
}
/** the stations already placed about c: at junctions, and beside the ways made before way n */
function nearOthers(ways: Ways, seed: number, c: V3, n: number): Station[] {
  const out: Station[] = [];
  for (const j of ways.junctionsNear(c[2] - 40, c[2] + 40)) { const s = stationAt(ways, seed, j); if (s) out.push(s); }
  for (const o of ways.waysNear(c[2] - 40, c[2] + 40)) if (o.n < n) { const s = stationOf(ways, seed, o); if (s) out.push(s); }
  return out;
}

/** The stations whose spaces reach between z0 and z1. */
export function stationsNear(ways: Ways, seed: number, z0: number, z1: number): Station[] {
  const out: Station[] = [];
  for (const j of ways.junctionsNear(z0 - 20, z1 + 20)) { const st = stationAt(ways, seed, j); if (st && st.c[2] + st.rz + 8 > z0 && st.c[2] - st.rz - 8 < z1) out.push(st); }
  for (const w of ways.waysNear(z0 - 16, z1 + 16)) {
    const st = stationOf(ways, seed, w);
    if (st && st.c[2] + st.rz + 8 > z0 && st.c[2] - st.rz - 8 < z1) out.push(st);
  }
  return out;
}
const norm2 = (v: [number, number]): [number, number] => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/**
 * Whether (x, z) is within a station's space, kept so much back from its edge (m): for a tree,
 * further on the downhill side, where its crown would stand over the space as the eye sees it.
 */
export function inStation(sts: Station[], x: number, z: number, margin: number, crown = 0): boolean {
  for (const st of sts) {
    const dz = z - st.c[2];
    // (a crown below the space hides it up to about its height up the hill)
    const down = dz < 0 ? crown : 0;
    const k = Math.hypot((x - st.c[0]) / (st.rx + margin), dz / (st.rz + margin + down));
    if (k < 1) return true;
  }
  return false;
}
