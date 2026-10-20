/**
 * What grows, given its shape: each plant's trunk and crown worked out from the resolved world (model.ts `PLANT`),
 * never kept, seeded so the same build always grows the same tree. A crown is clumps of leaves round where its trunk
 * branches; it leans away from tall stone beside it (toward the light, the open side), and a clump that would sit in
 * stone (a wall built up into it, a terrace over it) isn't there: a crown pruned round what's built, as one grown
 * against a wall is, so architecture shapes it without a rule saying how.
 */
import { hash } from '../kit/rng';
import { CENTER, DIRS, PLANT, unkey, type World } from './model';

export interface Clump { x: number; y: number; z: number; r: number }
export interface Growth {
  kind: number;
  /** the trunk, as points from its foot up (a leaning line, a fork at the top for the trees) */
  trunk: Array<[number, number, number]>; girth: number;
  /** the crown's clumps (none for a shrub or a hedge: those are their own shapes) */
  crown: Clump[];
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
  if (kind === PLANT.olive) {
    // (a short gnarled trunk, twisting, forking at head height; a round crown of clumps over it)
    const lean = 0.18 + 0.12 * r(2), top: [number, number, number] = [cx + lx * lean, k + 1.15, cz + lz * lean];
    const trunk: Array<[number, number, number]> = [[cx, k, cz], [cx + lx * lean * 0.3 + (r(3) - 0.5) * 0.1, k + 0.5, cz + lz * lean * 0.3 + (r(4) - 0.5) * 0.1], top];
    const crown: Clump[] = [];
    for (let n = 0; n < 11; n++) {
      const a = (n / 11) * Math.PI * 2 + r(10 + n) * 0.6, d = n === 0 ? 0 : 0.45 + 0.45 * r(30 + n);
      crown.push({ x: top[0] + Math.cos(a) * d, y: top[1] + 0.35 + 0.35 * r(50 + n) - d * 0.25, z: top[2] + Math.sin(a) * d, r: 0.32 + 0.16 * r(70 + n) });
    }
    return { kind, trunk, girth: 0.09, crown: crown.filter((c) => !inStone(w, c.x, c.y, c.z)) };
  }
  if (kind === PLANT.pine) {
    // (a tall trunk leaning toward the light, bare to high over walls; an umbrella crown, flat beneath, domed above)
    const lean = 0.5 + 0.35 * r(2), H = 3.1 + 0.4 * r(3), top: [number, number, number] = [cx + lx * lean, k + H, cz + lz * lean];
    const trunk: Array<[number, number, number]> = [[cx, k, cz], [cx + lx * lean * 0.25, k + H * 0.4, cz + lz * lean * 0.25], [cx + lx * lean * 0.7, k + H * 0.8, cz + lz * lean * 0.7], top];
    const crown: Clump[] = [];
    for (let n = 0; n < 22; n++) {
      const a = (n / 22) * Math.PI * 2 * 2.618 + r(10 + n), d = Math.sqrt((n + 0.5) / 22) * 1.55;
      crown.push({ x: top[0] + Math.cos(a) * d, y: top[1] + 0.12 + 0.28 * (1 - d / 1.6) + 0.1 * r(50 + n), z: top[2] + Math.sin(a) * d, r: 0.38 + 0.14 * r(70 + n) });
    }
    return { kind, trunk, girth: 0.12, crown: crown.filter((c) => !inStone(w, c.x, c.y, c.z)) };
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
