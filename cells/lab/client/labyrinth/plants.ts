/**
 * What grows, given its shape: each plant's trunk and crown worked out from the resolved world (model.ts `PLANT`),
 * never kept, seeded so the same build always grows the same tree. A crown is clumps of leaves round where its trunk
 * branches; it leans away from tall stone beside it (toward the light, the open side), and a clump that would sit in
 * stone (a wall built up into it, a terrace over it) isn't there: a crown pruned round what's built, as one grown
 * against a wall is, so architecture shapes it without a rule saying how. Each grows to its own size (some young and
 * small, some old and spreading), an olive now and then on two stems, a stone pine now and then crowned in two tiers.
 * A climber (`climb`) goes up the face of what it's planted against, as high as that stands, and over its top.
 */
import { hash } from '../kit/rng';
import { buildings, underRoof } from './buildings';
import { CENTER, DIRS, PLANT, key, unkey, type World } from './model';

/** a clump of leaves; \`g\`: which of the crown's clusters it's in (each the leaves at one limb's end, lit as one mass) */
export interface Clump { x: number; y: number; z: number; r: number; g?: number }
export interface Growth {
  kind: number;
  /** the trunk, as points from its foot up (a leaning line, a fork at the top for the trees) */
  trunk: Array<[number, number, number]>; girth: number;
  /** the crown's clumps (none for a shrub or a hedge: those are their own shapes) */
  crown: Clump[];
  /** more stems or limbs than the trunk: an olive's second stem, a pine's limb out to a lower tier */
  stems?: Array<Array<[number, number, number]>>;
  /** its limbs, from where the trunk forks out to each cluster of the crown, the skeleton the crown hangs on (thinner
   * than stems, drawn in the picture where the crown's open, and as the drawing's branch lines) */
  limbs?: Array<Array<[number, number, number]>>;
}
type P3 = [number, number, number];
/**
 * A crown as a few clusters, not a ball: limbs out from the fork, each bending up and out to its own end, and the
 * leaves gathered there in a cluster of a few clumps, wider than tall, with sky between the clusters. \`spread\`: how
 * far out the limbs go; \`rise\`: how far up; \`flat\`: how much wider than tall a cluster is.
 */
function clusters(fork: P3, n: number, toward: number, spread: number, rise: number, per: number, cr: number, flat: number, r: (n: number) => number, seed: number): { limbs: P3[][]; crown: Clump[] } {
  const limbs: P3[][] = [], crown: Clump[] = [];
  for (let q = 0; q < n; q++) {
    // (round the fork, but leaning toward the light: the first limb that way, the rest spread from it)
    const a = toward + (q === 0 ? (r(seed + q) - 0.5) * 0.6 : (q / n) * Math.PI * 2 + (r(seed + 10 + q) - 0.5) * 0.9);
    const out = spread * (q === 0 ? 1 : 0.7 + 0.35 * r(seed + 20 + q)), up = rise * (0.75 + 0.5 * r(seed + 30 + q));
    const m: P3 = [fork[0] + Math.cos(a) * out * 0.45, fork[1] + up * 0.55, fork[2] + Math.sin(a) * out * 0.45];
    const tip: P3 = [fork[0] + Math.cos(a + (r(seed + 40 + q) - 0.5) * 0.4) * out, fork[1] + up, fork[2] + Math.sin(a + (r(seed + 40 + q) - 0.5) * 0.4) * out];
    limbs.push([fork, m, tip]);
    // (a side branch now and then, off the limb's middle)
    if (r(seed + 50 + q) < 0.5) { const b = a + (r(seed + 60 + q) < 0.5 ? 0.7 : -0.7); limbs.push([m, [m[0] + Math.cos(b) * out * 0.35, m[1] + up * 0.3, m[2] + Math.sin(b) * out * 0.35]]); }
    // (the clusters unequal: the first, toward the light, the crown's main mass; the others smaller, so the crown has a
    // shape and not a ring of equal puffs; each of more, smaller clumps the further out, its edge broken, not one ball)
    const big = q === 0 ? 1.2 : 0.62 + 0.3 * r(seed + 140 + q), m2 = per + (q === 0 ? 2 : 0);
    for (let c = 0; c < m2; c++) {
      const b = (c / m2) * Math.PI * 2 + r(seed + 70 + q * 7 + c) * 1.2, d = (c === 0 ? 0 : 0.45 + 0.55 * r(seed + 90 + q * 7 + c)) * cr * 1.25 * big;
      const rc = cr * big * (c === 0 ? 0.85 : 0.5 + 0.3 * r(seed + 130 + q * 7 + c));
      crown.push({ x: tip[0] + Math.cos(b) * d, y: tip[1] + cr * 0.25 * big + (r(seed + 110 + q * 7 + c) - 0.5) * cr * flat * 0.5 - (d / (cr * 1.25 * big + 1e-6)) * rc * 0.35, z: tip[2] + Math.sin(b) * d, r: rc, g: q });
    }
  }
  return { limbs, crown };
}

/** a climber: the face it goes up (a DIRS index), how high, and whether it spills over the top there */
export interface Climb { d: number; h: number; over: boolean }
/** whether a top's under a roof (a climber doesn't go over a roof's eaves) */
const roofedAt = (w: World, k: number, i: number, j: number) => { const b = buildings(w).of.get(key(k, i, j)); return !!b && k === b.h - 1 && underRoof(b).some(([x, z]) => x === i && z === j); };
/** where a climber at a cell climbs: up the tallest face beside it (none if nothing stands beside it) */
export function climb(w: World, k: number, i: number, j: number): Climb | null {
  let best: Climb | null = null;
  for (let d = 0; d < 4; d++) {
    const [a, b] = DIRS[d];
    let h = 0; while (h < 5 && w.occupied(k + h, i + a, j + b) && !w.pier(k + h, i + a, j + b)) h++;
    if (h && (!best || h > best.h)) best = { d, h, over: !w.occupied(k + h, i + a, j + b) && !roofedAt(w, k + h - 1, i + a, j + b) };
  }
  return best;
}

const X = (i: number) => i - CENTER, Z = (j: number) => j - CENTER;
/** a point in stone (or the land): a clump there isn't */
const inStone = (w: World, x: number, y: number, z: number) => { const i = Math.floor(x + CENTER), j = Math.floor(z + CENTER), k = Math.floor(y); return w.occupied(k, i, j) || w.stair(k, i, j) >= 0; };

/** a plant at a cell grown out: its trunk and crown */
export function grow(w: World, k: number, i: number, j: number, kind: number): Growth {
  const r = (n: number) => (hash(w.seed, i, j, k, n) % 1000) / 1000, cx = X(i) + 0.5, cz = Z(j) + 0.5;
  // (away from tall stone beside it: the open side, where the light is)
  let ox = 0, oz = 0;
  for (const [a, b] of DIRS) { let h = 0; while (h < 4 && (w.occupied(k + h, i + a, j + b))) h++; ox -= a * h; oz -= b * h; }
  const ol = Math.hypot(ox, oz), lx = ol ? ox / ol : Math.cos(r(1) * 6.28), lz = ol ? oz / ol : Math.sin(r(1) * 6.28);
  // (its age: how big it's grown)
  const s = 0.78 + 0.42 * r(90);
  if (kind === PLANT.olive) {
    // (a short gnarled trunk, twisting as it goes, forking low into two or three limbs, each bending up and out to its
    // own cluster of leaves: an olive's crown open, the sky through it between the clusters; now and then a second stem)
    const lean = 0.18 + 0.12 * r(2), H = 0.85 * s, tw = (r(3) - 0.5) * 0.16;
    const fork: P3 = [cx + lx * lean, k + H, cz + lz * lean];
    const trunk: P3[] = [[cx, k, cz], [cx + lx * lean * 0.25 + tw, k + H * 0.35, cz + lz * lean * 0.25 - tw], [cx + lx * lean * 0.6 - tw * 0.6, k + H * 0.7, cz + lz * lean * 0.6 + tw * 0.8], fork];
    const n = 2 + (r(5) < 0.55 ? 1 : 0), cr = (0.3 + 0.05 * r(6)) * (0.85 + 0.2 * s);
    const { limbs, crown } = clusters(fork, n, Math.atan2(lz, lx), 0.74 * s, 0.55 * s, 5, cr, 0.6, r, 200);
    const out: Growth = { kind, trunk, girth: 0.08 + 0.035 * s, crown: crown.filter((c) => !inStone(w, c.x, c.y, c.z)), limbs };
    if (r(91) < 0.3) {
      // (a second stem, from the foot, leaning the other way round the light, with a cluster of its own)
      const a = Math.atan2(lz, lx) + (r(92) < 0.5 ? 1 : -1) * (0.9 + 0.5 * r(93)), t2: P3 = [cx + Math.cos(a) * 0.32 * s, k + 0.8 * s, cz + Math.sin(a) * 0.32 * s];
      out.stems = [[[cx, k, cz], [cx + Math.cos(a) * 0.12, k + 0.4 * s, cz + Math.sin(a) * 0.12], t2]];
      const more = clusters(t2, 1, a, 0.3 * s, 0.35 * s, 4, cr * 0.9, 0.6, r, 400);
      out.limbs!.push(...more.limbs);
      for (const c of more.crown) if (!inStone(w, c.x, c.y, c.z)) out.crown.push({ ...c, g: n });
    }
    return out;
  }
  if (kind === PLANT.pine) {
    // (a tall trunk leaning toward the light, bare to high over walls, a little crooked; at its head, limbs spreading
    // out and up, each holding a flat pad of leaves: the umbrella in pads with sky between, flat beneath, domed above)
    const lean = 0.5 + 0.35 * r(2), H = (3.1 + 0.4 * r(3)) * Math.min(1.1, s), kink = (r(4) - 0.5) * 0.25;
    const top: P3 = [cx + lx * lean, k + H, cz + lz * lean];
    const trunk: P3[] = [[cx, k, cz], [cx + lx * lean * 0.2 + kink, k + H * 0.4, cz + lz * lean * 0.2 - kink], [cx + lx * lean * 0.65, k + H * 0.78, cz + lz * lean * 0.65], top];
    const n = 4 + (r(5) < 0.5 ? 1 : 0), cr = (0.36 + 0.06 * r(6)) * (0.85 + 0.15 * s);
    const { limbs, crown } = clusters(top, n, Math.atan2(lz, lx), 1.05 * s, 0.32, 5, cr, 0.35, r, 300);
    // (now and then a lower tier, out on a long limb to one side: the umbrella in two)
    const stems: P3[][] = [];
    if (r(94) < 0.35) {
      const a = Math.atan2(lz, lx) + Math.PI * (0.5 + r(95)), at = trunk[2];
      const low = clusters(at, 1, a, 0.95 * s, 0.1, 6, cr * 0.95, 0.35, r, 500);
      stems.push(low.limbs[0]);
      crown.push(...low.crown.map((c) => ({ ...c, g: n })));
    }
    return { kind, trunk, girth: 0.1 + 0.03 * s, crown: crown.filter((c) => !inStone(w, c.x, c.y, c.z)), limbs, ...(stems.length ? { stems } : {}) };
  }
  return { kind, trunk: [], girth: 0, crown: [] };
}

/** every plant's growth in a world (worked out once for each state of it) */
const cache = new WeakMap<World, { v: number; g: Map<number, Growth> }>();
export function growths(w: World): Map<number, Growth> {
  const c = cache.get(w);
  if (c && c.v === w.version) return c.g;
  const g = new Map<number, Growth>();
  for (const [v] of w.trees) { const kind = w.treeKind.get(v) ?? PLANT.cypress; if (kind === PLANT.olive || kind === PLANT.pine) g.set(v, grow(w, ...unkey(v), kind)); }
  cache.set(w, { v: w.version, g });
  return g;
}
