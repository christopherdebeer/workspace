/**
 * Taohua: the composition. Before any tree is grown, the ways up the hill are given their places:
 * stations beside them, here and there, each a space kept open
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
import { WIDTH, Ways, type V3, type Way } from './ways';

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
const RX = 2.6, RZ = 6.2;

/**
 * A cast, from the seed and the station's number: six lines, each as three coins fall (two sides
 * of each worth two or three, summed), so old lines come as often as they would.
 */
export function cast(seed: number, i: number): Line[] {
  const r = seeded(hash(seed, i, 0xc4a5));
  return Array.from({ length: 6 }, () => (6 + (r() < 0.5 ? 1 : 0) + (r() < 0.5 ? 1 : 0) + (r() < 0.5 ? 1 : 0)) as Line);
}

const memo = new Map<string, Station | null>();
/**
 * The station beside a way, if it has one: about a third of the ways, long enough, away from the
 * temples; partway along, on whichever side has room clear of every way.
 */
export function stationOf(ways: Ways, seed: number, w: Way): Station | null {
  const key = `${seed}:${w.id}`;
  if (memo.has(key)) return memo.get(key)!;
  const r = seeded(hash(seed, w.row, w.from.k * 7 + w.to.k, 0x57a7));
  let st: Station | null = null;
  if (r() < 0.36 && w.len > 9 && !w.temple && !w.to.gate && !w.from.gate) {
    const first = r() < 0.5 ? 1 : -1;
    for (const u of [w.len * 0.5, w.len * 0.35, w.len * 0.65]) {
      for (const side of [first, -first]) {
        const at = ways.at(w, u, true);
        const off = WIDTH / 2 + 1.1 + RX;
        const c: V3 = [at.p[0] + at.dir[1] * side * off, 0, at.p[2] - at.dir[0] * side * off];
        c[1] = ways.hill(c[2]);
        if (Math.abs(c[0]) > 15) continue;
        let clear = ways.nearest(c[0], c[2]).d > WIDTH / 2 + 0.4;
        for (let k = 0; k < 16 && clear; k++) {
          const a = (k / 16) * Math.PI * 2;
          if (ways.nearest(c[0] + Math.cos(a) * RX * 1.05, c[2] + Math.sin(a) * RZ * 1.05).d < WIDTH / 2 + 0.4) clear = false;
        }
        // (nor near another station: each its own space on the print)
        if (clear) for (const k of [w.row - 1, w.row]) {
          if (k < 0) continue;
          for (const o of ways.waysUp(k)) {
            if (o === w) break;
            const os = stationOf(ways, seed, o);
            if (os && Math.hypot((os.c[0] - c[0]) / (RX * 3), (os.c[2] - c[2]) / (RZ * 2.2)) < 1) clear = false;
          }
        }
        if (!clear) continue;
        const i = w.row * 16 + w.from.k * 4 + w.to.k;
        const lines = cast(seed, i), hex = identify(lines);
        st = { i, kind: 'changes', lines, lower: hex.lower.image, upper: hex.upper.image, w, u, side, c, rx: RX, rz: RZ };
        break;
      }
      if (st) break;
    }
  }
  memo.set(key, st);
  return st;
}

/** The stations whose spaces reach between z0 and z1. */
export function stationsNear(ways: Ways, seed: number, z0: number, z1: number): Station[] {
  const out: Station[] = [];
  for (const w of ways.waysNear(z0 - 16, z1 + 16)) {
    const st = stationOf(ways, seed, w);
    if (st && st.c[2] + st.rz + 8 > z0 && st.c[2] - st.rz - 8 < z1) out.push(st);
  }
  return out;
}

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
