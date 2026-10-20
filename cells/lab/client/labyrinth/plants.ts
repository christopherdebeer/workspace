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

export interface Clump { x: number; y: number; z: number; r: number }
export interface Growth {
  kind: number;
  /** the trunk, as points from its foot up (a leaning line, a fork at the top for the trees) */
  trunk: Array<[number, number, number]>; girth: number;
  /** the crown's clumps (none for a shrub or a hedge: those are their own shapes) */
  crown: Clump[];
  /** more stems or limbs than the trunk: an olive's second stem, a pine's limb out to a lower tier */
  stems?: Array<Array<[number, number, number]>>;
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
    // (a short gnarled trunk, twisting, forking at head height (now and then two stems from the foot); a round crown of
    // clumps over it, as wide as it's old)
    const lean = 0.18 + 0.12 * r(2), top: [number, number, number] = [cx + lx * lean, k + 1.15 * s, cz + lz * lean];
    const trunk: Array<[number, number, number]> = [[cx, k, cz], [cx + lx * lean * 0.3 + (r(3) - 0.5) * 0.1, k + 0.5 * s, cz + lz * lean * 0.3 + (r(4) - 0.5) * 0.1], top];
    const crown: Clump[] = [], N = Math.round(8 + 6 * s);
    for (let n = 0; n < N; n++) {
      const a = (n / N) * Math.PI * 2 + r(10 + n) * 0.6, d = n === 0 ? 0 : (0.45 + 0.45 * r(30 + n)) * s;
      crown.push({ x: top[0] + Math.cos(a) * d, y: top[1] + 0.35 * s + 0.35 * r(50 + n) - d * 0.25, z: top[2] + Math.sin(a) * d, r: (0.3 + 0.16 * r(70 + n)) * (0.85 + 0.2 * s) });
    }
    const out: Growth = { kind, trunk, girth: 0.07 + 0.03 * s, crown: crown.filter((c) => !inStone(w, c.x, c.y, c.z)) };
    if (r(91) < 0.3) {
      // (a second stem, from the foot, leaning the other way round the light)
      const a = Math.atan2(lz, lx) + (r(92) < 0.5 ? 1 : -1) * (0.9 + 0.5 * r(93)), t2: [number, number, number] = [cx + Math.cos(a) * 0.32 * s, k + 0.95 * s, cz + Math.sin(a) * 0.32 * s];
      out.stems = [[[cx, k, cz], [cx + Math.cos(a) * 0.12, k + 0.45 * s, cz + Math.sin(a) * 0.12], t2]];
      for (let n = 0; n < 5; n++) { const b = (n / 5) * Math.PI * 2 + r(110 + n), d = 0.3 * s * r(120 + n); const c = { x: t2[0] + Math.cos(b) * d, y: t2[1] + 0.3 * s + 0.2 * r(130 + n), z: t2[2] + Math.sin(b) * d, r: 0.26 * (0.85 + 0.2 * s) }; if (!inStone(w, c.x, c.y, c.z)) out.crown.push(c); }
    }
    return out;
  }
  if (kind === PLANT.pine) {
    // (a tall trunk leaning toward the light, bare to high over walls; an umbrella crown, flat beneath, domed above)
    const lean = 0.5 + 0.35 * r(2), H = (3.1 + 0.4 * r(3)) * Math.min(1.1, s), top: [number, number, number] = [cx + lx * lean, k + H, cz + lz * lean];
    const trunk: Array<[number, number, number]> = [[cx, k, cz], [cx + lx * lean * 0.25, k + H * 0.4, cz + lz * lean * 0.25], [cx + lx * lean * 0.7, k + H * 0.8, cz + lz * lean * 0.7], top];
    const crown: Clump[] = [];
    for (let n = 0; n < 22; n++) {
      const a = (n / 22) * Math.PI * 2 * 2.618 + r(10 + n), d = Math.sqrt((n + 0.5) / 22) * 1.55;
      crown.push({ x: top[0] + Math.cos(a) * d * s, y: top[1] + 0.12 + 0.28 * (1 - d / 1.6) + 0.1 * r(50 + n), z: top[2] + Math.sin(a) * d * s, r: (0.38 + 0.14 * r(70 + n)) * (0.85 + 0.15 * s) });
    }
    // (now and then a lower tier, out on a limb to one side: the umbrella in two)
    const stems: Array<Array<[number, number, number]>> = [];
    if (r(94) < 0.35) {
      const a = Math.atan2(lz, lx) + Math.PI * (0.5 + r(95)), at = trunk[2], tip: [number, number, number] = [at[0] + Math.cos(a) * 0.9 * s, at[1] - 0.15, at[2] + Math.sin(a) * 0.9 * s];
      stems.push([at, [(at[0] + tip[0]) / 2, at[1] - 0.05, (at[2] + tip[2]) / 2], tip]);
      for (let n = 0; n < 9; n++) { const b = (n / 9) * Math.PI * 2 * 2.618, d = Math.sqrt((n + 0.5) / 9) * 0.85 * s; crown.push({ x: tip[0] + Math.cos(b) * d, y: tip[1] + 0.12 + 0.15 * (1 - d), z: tip[2] + Math.sin(b) * d, r: 0.32 }); }
    }
    return { kind, trunk, girth: 0.1 + 0.03 * s, crown: crown.filter((c) => !inStone(w, c.x, c.y, c.z)), ...(stems.length ? { stems } : {}) };
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
