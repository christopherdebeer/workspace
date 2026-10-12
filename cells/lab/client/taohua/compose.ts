/**
 * Taohua: the composition. Before any tree is grown, the way up the hill is given its places:
 * stations at intervals along the path, each a space beside it kept open on the paper, the way
 * the prints keep paper clear for the verse. A station holds a couplet, written on the hillside
 * there (the walker passes it as they climb), or is kept for something to come from Changes; the
 * hillside is grown around them, the trees standing back from their edges, so each reads as a
 * shape in the picture and not as a gap.
 *
 * A station's space is an ellipse on the ground, across the hill (x) and up it (z). Trees stand
 * back further on its downhill side than its uphill: the eye looks up the hill from above, so a
 * crown hides the ground a little uphill of where it stands.
 */
import { hash, seeded } from '../kit/rng';
import { Path, WIDTH, type V3 } from './path';

export type StationKind = 'verse' | 'changes';
export interface Station {
  i: number; kind: StationKind;
  /** where along the path it's beside, and which side (+1 right of the way on) */
  s: number; side: number;
  /** its middle on the ground, and its half-sizes across the hill and up it */
  c: V3; rx: number; rz: number;
}

/** how far apart stations come along the path (m), on the whole */
const EVERY = 34;
/** a station's space: for a couplet, two columns of eight or so characters as the camera sees them */
const RX = 2.6, RZ = 6.2;

const memo = new Map<string, Station>();
/** Station i: placed along the path from the seed, clear of the temples, on the side with more hill. */
export function station(path: Path, seed: number, i: number): Station {
  const key = `${seed}:${i}`;
  const got = memo.get(key);
  if (got) return got;
  const r = seeded(hash(seed, i, 0x57a7));
  const prev = i > 0 ? station(path, seed, i - 1) : null;
  let s = Math.max(14 + i * EVERY + (r() - 0.5) * 10, prev ? prev.s + 12 : 0);
  // (not where a temple is: on along the path until clear of it)
  for (let k = 0; k < 6; k++) {
    const p = path.at(s).p;
    path.extend(p[2] + 30);
    const near = path.flights.some((f) => f.temple && Math.abs(f.b[2] - p[2]) < 15);
    if (!near) break;
    s += 8;
  }
  // (the side away from where the path has wandered, so it falls on the hill; but the space must be
  // clear of the path all round, where it bends back: else the other side, else on a little)
  const place = (sAt: number, side: number): V3 | null => {
    const at = path.at(sAt);
    const off = WIDTH / 2 + 1.1 + RX;
    const c: V3 = [at.p[0] + at.dir[1] * side * off, at.p[1], at.p[2] - at.dir[0] * side * off];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (path.nearest(c[0] + Math.cos(a) * RX * 1.05, c[2] + Math.sin(a) * RZ * 1.05).d < WIDTH / 2 + 0.4) return null;
    }
    if (path.nearest(c[0], c[2]).d < WIDTH / 2 + 0.4) return null;
    // (nor over the last station's space)
    if (prev && Math.hypot((c[0] - prev.c[0]) / (RX * 2.3), (c[2] - prev.c[2]) / (RZ * 2.3)) < 1) return null;
    return c;
  };
  let side = 1, c: V3 | null = null;
  for (let k = 0; k < 14 && !c; k++, s += k % 2 ? 0 : 5) {
    const at = path.at(s);
    const pref = at.p[0] > 2.5 ? -1 : at.p[0] < -2.5 ? 1 : (hash(seed, i, k) & 1 ? 1 : -1);
    side = k % 2 ? -pref : pref;
    c = place(s, side);
  }
  if (!c) { const at = path.at(s); c = [at.p[0] + side * 6, at.p[1], at.p[2]]; }
  // (every third keeps its space for Changes)
  const st: Station = { i, kind: i % 3 === 2 ? 'changes' : 'verse', s, side, c, rx: RX, rz: RZ };
  memo.set(key, st);
  return st;
}

/** The stations whose spaces reach between z0 and z1. */
export function stationsNear(path: Path, seed: number, z0: number, z1: number): Station[] {
  const out: Station[] = [];
  const i0 = Math.max(0, Math.floor((z0 - 30) / EVERY) - 1), i1 = Math.ceil((z1 + 30) / EVERY) + 1;
  for (let i = i0; i <= i1; i++) {
    const st = station(path, seed, i);
    if (st.c[2] + st.rz + 8 > z0 && st.c[2] - st.rz - 8 < z1) out.push(st);
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
