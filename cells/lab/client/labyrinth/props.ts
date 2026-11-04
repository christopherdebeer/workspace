/**
 * What a building's use leaves outside it (uses.ts), so it can be seen from the street what goes on inside: worked out
 * from what's built, never kept, drawn by mesh.ts. Each at the door its use goes in and out by (plans.ts: its exits on to
 * the ground, a way or a court), standing against the wall beside it, never in front of it, and only where the ground's
 * clear (no stone, stair, water or tree there).
 *
 * - **A workshop**, by its craft (ladder.ts): a kiln's beehive oven and its fired tiles stacked to cool; a carpenter's
 *   timber stacked and a sawhorse; a mason's blocks and one on the banker being dressed; a glassworks' furnace, its
 *   mouth glowing, and crates.
 * - **A shop**: goods out on a trestle in front of its shopfront (two at most), and a sign over it.
 * - **A store**: barrels and sacks by its door; over it, if it's two storeys or more, a hoist beam with a sack on its
 *   rope.
 * - **A dwelling** (a court house too), at two of its doors at most: a bench and a pot or two, or a pot alone; now and
 *   then washing on a line.
 * - **A lookout** (with a room in it, not a stair tower alone): a flag on its top. **A gatehouse**: a lamp on the wall either side of each mouth of its passage.
 *
 * Places are in squares (fractional, as the grid's own: mesh.ts draws each whole round its point, at a cell's size on
 * the half grid); `d` is the way the wall it stands against faces.
 */
import { hash } from '../kit/rng';
import { DIRS, type World } from './model';
import { buildings } from './buildings';
import { facades } from './facades';
import { reckoned } from './ladder';

export type PropKind = 'kiln' | 'tiles' | 'timber' | 'sawhorse' | 'blocks' | 'banker' | 'furnace' | 'crates' | 'goods' | 'sign' | 'barrels' | 'sacks' | 'hoist' | 'bench' | 'pots' | 'washing' | 'flag' | 'lamp';
export interface Prop { kind: PropKind; x: number; z: number; y: number; d: number; b: number; born: number; n: number }

const cache = new WeakMap<World, { v: number; p: Prop[] }>();
/** everything the world's uses leave outside (worked out once for each state of it) */
export function props(w: World): Prop[] {
  const c = cache.get(w);
  if (c && c.v === w.version) return c.p;
  const p = find(w);
  cache.set(w, { v: w.version, p });
  return p;
}

function find(w: World): Prop[] {
  const out: Prop[] = [], B = w.bay, bs = buildings(w), bays = facades(w), r = reckoned(w), taken: Array<[number, number]> = [];
  // (a door's middle, on the face it's in: on the half grid, its bay's (the leading face and its partner))
  const middle = (k: number, i: number, j: number, d: number): [number, number] => {
    const [a, c] = DIRS[d], pk = bs.pairs.get(`${k}.${i}.${j}.${d}`);
    let x = i + 0.5 + a * 0.5, z = j + 0.5 + c * 0.5;
    if (pk) { const [, pi, pj] = pk.split('.').map(Number); x += (pi - i) / 2; z += (pj - j) / 2; }
    return [x, z];
  };
  // (the ground beside a door, on either side (s), out from its wall: clear, level with the door's sill, and half a cell
  // from anything put down already (a door round a corner from another))
  const spot = (k: number, x: number, z: number, d: number, s: number, out = 0.06): [number, number] | null => {
    const [a, c] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4], px = x + (ta * s * 0.36 + a * out) * B, pz = z + (tb * s * 0.36 + c * out) * B;
    const i = Math.floor(px), j = Math.floor(pz);
    if (taken.some(([x0, z0]) => Math.hypot(x0 - px, z0 - pz) < 0.5 * B) || w.occupied(k, i, j) || w.ground(i, j) !== k || w.pool(i, j) || w.tree(k, i, j) || w.stair(k - 1, i, j) >= 0 || w.decor.some((e) => e.i === i && e.j === j)) return null;
    taken.push([px, pz]);
    return [px, pz];
  };
  for (const u of r.settlement.buildings) {
    const p = u.plan, b = p.b, born = Math.max(...b.cols.map(([i, j]) => w.born(Math.min(...b.base), i, j)));
    const put = (kind: PropKind, at: [number, number] | null, y: number, d: number, n = 0) => { if (at) out.push({ kind, x: at[0], z: at[1], y, d, b: b.id, born, n: n || hash(w.seed, b.id, out.length, 61) }); return !!at; };
    // (its doors at the ground (or a way on it, or a court), one to a bay, the workshop's room's first)
    const seen = new Set<string>();
    const doors = p.exits.filter((e) => (e.to === 'ground' || e.to === 'way' || e.to === 'court') && e.k === w.ground(e.i + DIRS[e.d][0], e.j + DIRS[e.d][1])).map((e) => {
      const lead = bs.partners.get(`${e.k}.${e.i}.${e.j}.${e.d}`);
      const [, li, lj] = lead ? lead.split('.').map(Number) : [0, e.i, e.j];
      return { ...e, i: li, j: lj };
    }).filter((e) => { const s = `${e.k}.${e.i}.${e.j}.${e.d}`; if (seen.has(s)) return false; seen.add(s); return true; });
    const wr = p.storeys[0]?.rooms.find((q) => q.area >= 18 && q.lit < 0.5 && doors.some((e) => e.room === q.id));
    if (wr) doors.sort((e, f) => +(f.room === wr.id) - +(e.room === wr.id));
    // (each door's two sides, given out by use: the work first, then the household's)
    const sides = doors.map((e) => ({ e, at: middle(e.k, e.i, e.j, e.d), used: 0 }));
    const craft = r.crafts.get(b.id);
    if (u.uses.includes('workshop') && craft && sides.length) {
      const { e, at } = sides[0], [L, R] = { kiln: ['kiln', 'tiles'], carpenter: ['timber', 'sawhorse'], mason: ['blocks', 'banker'], glassworks: ['furnace', 'crates'] }[craft] as [PropKind, PropKind];
      put(L, spot(e.k, at[0], at[1], e.d, -1, L === 'kiln' || L === 'furnace' ? 0.36 : 0.06), e.k, e.d);
      put(R, spot(e.k, at[0], at[1], e.d, 1), e.k, e.d);
      sides[0].used = 2;
    }
    if (u.uses.includes('store')) {
      const s = sides.find((q) => q.used < 2);
      if (s) { put(hash(w.seed, b.id, 62) % 2 ? 'barrels' : 'sacks', spot(s.e.k, s.at[0], s.at[1], s.e.d, s.used ? 1 : -1), s.e.k, s.e.d); s.used++; }
      // (a hoist over a door, on a building of two storeys or more, under its eaves)
      const h = sides[0];
      if (h && b.h - h.e.k >= 2) out.push({ kind: 'hoist', x: h.at[0], z: h.at[1], y: b.h - 0.12, d: h.e.d, b: b.id, born, n: hash(w.seed, b.id, 63) });
    }
    if (u.uses.includes('dwelling') || u.uses.includes('court house')) {
      // (at two of its doors at most: a bench and a pot, a bench and the washing, or a pot alone)
      for (const s of sides.filter((q) => q.used < 2).slice(0, 2)) {
        const pick = [0, 0, 1, 2][hash(w.seed, b.id, s.e.i, s.e.j, 64) % 4];
        if (s.used === 0 && pick < 2) put('bench', spot(s.e.k, s.at[0], s.at[1], s.e.d, -1), s.e.k, s.e.d);
        put(pick === 1 ? 'washing' : 'pots', spot(s.e.k, s.at[0], s.at[1], s.e.d, 1, 0.06), s.e.k, s.e.d);
        s.used = 2;
      }
    }
    if (u.uses.includes('lookout') && p.area > 0) {
      // (its flag on the top, at the corner furthest from where the way arrives (its highest column's, last))
      const top = b.cols.filter(([i, j]) => w.stone(b.h - 1, i, j) && !w.occupied(b.h, i, j)).sort(([a, c], [e, f]) => e + f - (a + c))[0];
      if (top) out.push({ kind: 'flag', x: top[0] + 0.5, z: top[1] + 0.5, y: b.h, d: 0, b: b.id, born, n: hash(w.seed, b.id, 65) });
    }
    if (u.uses.includes('gatehouse')) {
      // (at each mouth of its passage, a lamp on the wall either side of the arch)
      const thru = new Set(b.through.map(([i, j]) => `${i}.${j}`));
      for (const [i, j, a] of b.through) for (const sg of [-1, 1]) {
        const d = DIRS.findIndex(([x, z]) => (a === 0 ? x === sg && z === 0 : x === 0 && z === sg));
        const [da, db] = DIRS[d];
        if (thru.has(`${i + da}.${j + db}`)) continue;
        const k = w.ground(i, j);
        for (const s of [-1, 1]) {
          const [ta, tb] = DIRS[(d + 1) % 4];
          let q = 1; while (thru.has(`${i + ta * s * q}.${j + tb * s * q}`)) q++;
          const si = i + ta * s * q, sj = j + tb * s * q;
          if (!b.cols.some(([x, z]) => x === si && z === sj) || !w.stone(k, si, sj)) continue;
          const x = si + 0.5 + da * 0.5 - ta * s * 0.15, z = sj + 0.5 + db * 0.5 - tb * s * 0.15;
          if (!out.some((o) => o.kind === 'lamp' && Math.abs(o.x - x) + Math.abs(o.z - z) < 0.01)) out.push({ kind: 'lamp', x, z, y: k + 0.62, d, b: b.id, born, n: 0 });
        }
      }
    }
  }
  // (a shop's goods out in front of each shopfront at its foot, a sign over the first)
  const signed = new Set<number>(), shown = new Map<number, number>();
  for (const [kk, by] of bays) {
    if (by.role !== 'shop') continue;
    const [k, i, j, d] = kk.split('.').map(Number);
    if (k !== w.ground(i + DIRS[d][0], j + DIRS[d][1]) || bs.partners.has(kk)) continue;
    const [x, z] = middle(k, i, j, d), [a, c] = DIRS[d], ox = Math.floor(x + a * 0.4 * B), oz = Math.floor(z + c * 0.4 * B);
    const born = w.born(k, i, j);
    const many = shown.get(by.b.id) ?? 0;
    if (many < 2 && !w.occupied(k, ox, oz) && w.ground(ox, oz) === k && !w.pool(ox, oz) && !w.tree(k, ox, oz) && !taken.some(([x0, z0]) => Math.hypot(x0 - x - a * 0.34 * B, z0 - z - c * 0.34 * B) < 0.9 * B) && taken.push([x + a * 0.34 * B, z + c * 0.34 * B]) && shown.set(by.b.id, many + 1)) out.push({ kind: 'goods', x: x + a * 0.34 * B, z: z + c * 0.34 * B, y: k, d, b: by.b.id, born, n: hash(w.seed, i, j, 66) });
    if (!signed.has(by.b.id)) { signed.add(by.b.id); out.push({ kind: 'sign', x, z, y: k + 0.86, d, b: by.b.id, born, n: hash(w.seed, by.b.id, 67) }); }
  }
  return out;
}
