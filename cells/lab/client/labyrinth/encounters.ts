/**
 * Encounters: what the hand's pieces make of meeting (static/labyrinth-encounters.md). After the hand's operations are
 * laid and resolved (model.ts `rebuild`), each rule here looks for where two of the hand's things meet in its way (two
 * raised ways ending corner to corner, a cell apart...) and says what that meeting could become, as a ladder:
 *
 * - **0, the smallest sufficient**: a good joint, nothing more (a corner slab between them);
 * - **1, the obvious**: what a hand would expect of it (a small terrace where they meet);
 * - **2, the surprising**: what it could become (a corner bay on its own pier, a lantern on it).
 *
 * Which rung: the hand's choice if it made one (`Op.choose`, kept); otherwise the smallest, a rung higher for each later
 * gesture that touches the meeting again (insisting on it develops it), and never past what the rule offers. Then the
 * highest candidate at or below that rung that keeps every claim (`World.claim`: passages, stairs' ways, trees, water)
 * and doesn't fall where another meeting's resolution already lies. What it comes to is laid as operations of its own
 * (`Op.derived`, never kept), so everything downstream (the supports, the mesh, the walk, buildings) treats it as it
 * treats the hand's; and the meetings found, with what each could be, are kept on the world (`World.meetings`), for
 * the hand to choose among (select.ts).
 *
 * A rule is small: where its meetings are, and for each, its candidates as operations, built from the verbs below. A
 * new kind of encounter is a new rule; the ladder, the claims, the choosing and the checking (devtools/
 * labyrinth-connectors.mjs runs every rule's scene through the same checks) come with it.
 */
import { DIRS, DRESS, PLANT, RULE, inGrid, key, type Cell, type Op, type World } from './model';

/** the verbs: how architecture behaves touched by other architecture (static/labyrinth-encounters.md) */
export type Verb = 'merge' | 'open' | 'carry' | 'wrap' | 'step' | 'shelter' | 'frame' | 'yield' | 'separate';
export type Level = 0 | 1 | 2;
export interface Candidate { level: Level; label: string; verbs: Verb[]; op: Op }
export interface Meeting {
  /** which rule found it, and what it's called; and how a stroke that makes it says where (by default "where it meets") */
  rule: string; name: string; where?: string;
  /** where it's anchored (a choice is kept against this cell), and the cells it acts on (for selecting it) */
  anchor: Cell; cells: Cell[];
  /** the hand's operations that made it (their places in `ops`) */
  by: number[];
  candidates: Candidate[];
  /** the rung wanted (chosen, or by insistence), and the one laid (-1 if none would keep every claim), and where */
  wanted: number; laid: number; chosen: boolean; at: Cell[];
}
export interface Rule { id: string; find(w: World): Found[] }
/** a meeting as a rule finds it; `insists` says which later gestures count as making it again (by default any that
 * touches where it acts) */
export type Found = Omit<Meeting, 'wanted' | 'laid' | 'chosen' | 'at'> & { insists?: (op: Op) => boolean };

// ─── the verbs, as operations ───

/** a floor where there's none: stone under the level walked at (on the ground, paving) */
export const floor = (w: World, [k, i, j]: Cell, born: number): Op => (k > w.ground(i, j) ? { add: [[k - 1, i, j, born]] } : { pave: [[i, j]] });
/** what's carried asked to stand on its own pier, down to the ground */
export const pier = ([k, i, j]: Cell): Op => ({ rule: [[k - 1, i, j, RULE.pier]] });
/** a lantern on a top */
export const lantern = ([k, i, j]: Cell): Op => ({ dress: [[k - 1, i, j, DRESS.lantern, 1]] });
/** operations made one */
export const join = (...ops: Op[]): Op => {
  const out: Op = {};
  for (const o of ops) for (const f of ['add', 'stairs', 'cut', 'arches', 'walls', 'rule', 'dress', 'pave'] as const) if (o[f]) (out[f] as unknown[]) = [...((out[f] as unknown[]) ?? []), ...(o[f] as unknown[])];
  return out;
};

// ─── the rules ───

/** the places a level can be stood at: a floor under it (the ground, or stone), nothing in it but a way through */
const place = (w: World, [k, i, j]: Cell) => inGrid(i, j) && (k === w.ground(i, j) ? !w.pool(i, j) : w.stone(k - 1, i, j)) && (!w.occupied(k, i, j) || w.archway(k, i, j) >= 0);
/** a cell a floor could be laid in, to walk at `k`: nothing there, nothing under it to the floor's level but air */
const open = (w: World, [k, i, j]: Cell) => inGrid(i, j) && k > w.ground(i, j) && !w.occupied(k, i, j) && !w.occupied(k - 1, i, j) && !w.tree(k, i, j);

/**
 * Two raised ways of the hand's meeting: one's end beside the other, corner to corner (they'd touch only at a point,
 * and can't be walked between), or a cell short of it in line, or a cell short of a top at its height (a stair a step
 * short of a gate, a walkway a cell short of a terrace). The ladder: the gap closed (a corner slab); a small terrace
 * where they meet; that terrace on its own pier, a lantern at it.
 */
const waysMeet: Rule = {
  id: 'ways-meet',
  find(w) {
    const out: ReturnType<Rule['find']> = [];
    const walked = new Map<number, number>();
    const walks = w.ops.map((op) => w.walks.get(op) ?? []);
    walks.forEach((cs, n) => { for (const c of cs) if (!walked.has(key(...c))) walked.set(key(...c), n); });
    const by = (c: Cell) => walked.get(key(...c)) ?? -1;
    const seen = new Set<number>();
    walks.forEach((cs, a) => {
      if (cs.length < 2) return;
      for (const e of [cs[0], cs[cs.length - 1]]) {
        const [k, i, j] = e;
        if (k <= w.ground(i, j)) continue;
        // (corner to corner: another's walk diagonal to this end, neither corner walked)
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const d: Cell = [k, i + dx, j + dz], b = by(d);
          if (b < 0 || b === a) continue;
          const c1: Cell = [k, i + dx, j], c2: Cell = [k, i, j + dz];
          if (place(w, c1) || place(w, c2)) continue;
          const corners = [c1, c2].filter((c) => open(w, c)).sort((p, q) => key(...p) - key(...q));
          if (!corners.length) continue;
          // (one meeting however it's come at: from either way's end, or a way made again over the same course)
          const anchor = corners[0];
          if (corners.some((c) => seen.has(key(...c)))) continue;
          for (const c of corners) seen.add(key(...c));
          const born = Math.max(w.ops[a].born ?? 0, w.ops[b].born ?? 0);
          const one = floor(w, corners[0], born), both = join(...corners.map((c) => floor(w, c, born)));
          out.push({
            rule: this.id, name: 'two ways meeting corner to corner', anchor, cells: [e, d, ...corners], by: [a, b], insists: ways,
            candidates: [
              { level: 0, label: 'a corner slab joining them', verbs: ['merge'], op: one },
              ...(corners.length > 1 ? [{ level: 1 as Level, label: 'a small terrace where they meet', verbs: ['merge', 'step'] as Verb[], op: both }] : []),
              { level: 2, label: 'a corner bay on its own pier, a lantern at it', verbs: ['merge', 'carry', 'frame'], op: join(corners.length > 1 ? both : one, pier(anchor), lantern(anchor)) },
            ],
          });
        }
        // (in line, a cell short: of another's walk, or of a top at its height)
        for (const [dx, dz] of DIRS) {
          const m: Cell = [k, i + dx, j + dz], t: Cell = [k, i + 2 * dx, j + 2 * dz], b = by(t);
          if (b === a || !open(w, m) || place(w, m) || !(b >= 0 || place(w, t)) || seen.has(key(...m))) continue;
          if (cs.some((c) => c[1] === m[1] && c[2] === m[2])) continue;
          seen.add(key(...m));
          const born = w.ops[a].born ?? 0, sides = [[dz, dx], [-dz, -dx]].map(([p, q]) => [k, m[1] + p, m[2] + q] as Cell).filter((c) => open(w, c));
          const gap = floor(w, m, born), wide = join(gap, ...sides.map((c) => floor(w, c, born)));
          out.push({
            rule: this.id, name: b >= 0 ? 'two ways a cell apart' : 'a way a cell short of a top', anchor: m, cells: [e, m, t], by: b >= 0 ? [a, b] : [a], insists: ways,
            candidates: [
              { level: 0, label: 'the gap closed', verbs: ['merge'], op: gap },
              ...(sides.length ? [{ level: 1 as Level, label: 'a landing where they meet', verbs: ['merge', 'step'] as Verb[], op: wide }] : []),
              { level: 2, label: 'a landing on its own pier, a lantern at it', verbs: ['merge', 'carry', 'frame'], op: join(sides.length ? wide : gap, pier(m), lantern(m)) },
            ],
          });
        }
      }
    });
    return out;
  },
};

/**
 * Two of the hand's ways side by side a level apart, a cell between them where a step would go (one's walk at k beside
 * that cell, the other's at k + 1 beyond it, in line). The ladder: left as they are, two ways at two levels (often the
 * best answer: the layering's legible); a step between them; the step, a lantern at its head.
 */
const levelApart: Rule = {
  id: 'ways-a-level-apart',
  find(w) {
    const out: Found[] = [], upper = new Map<number, number>(), seen = new Set<number>(), pairs = new Set<string>();
    const walks = w.ops.map((op) => w.walks.get(op) ?? []);
    walks.forEach((cs, n) => { for (const c of cs) if (!upper.has(key(...c))) upper.set(key(...c), n); });
    walks.forEach((cs, a) => {
      for (const lo of cs) {
        const [k, i, j] = lo;
        for (const [d, [dx, dz]] of DIRS.entries()) {
          const s: Cell = [k, i + dx, j + dz], u: Cell = [k + 1, i + 2 * dx, j + 2 * dz], b = upper.get(key(...u)) ?? -1;
          // (one step between any two ways: the first place along them it would go)
          if (b < 0 || b === a || seen.has(key(...s)) || pairs.has(`${a}.${b}`)) continue;
          // (room for a step: nothing there or over it, and something it can stand on, or air over open ground to lay it on)
          if (!inGrid(s[1], s[2]) || w.occupied(...s) || w.occupied(k + 1, s[1], s[2]) || w.claim(...s) || w.claim(k + 1, s[1], s[2]) || (k > w.ground(s[1], s[2]) && w.occupied(k - 1, s[1], s[2]) && !w.stone(k - 1, s[1], s[2]))) continue;
          seen.add(key(...s)); pairs.add(`${a}.${b}`);
          const born = Math.max(w.ops[a].born ?? 0, w.ops[b].born ?? 0);
          const step = join(k > w.ground(s[1], s[2]) && !w.stone(k - 1, s[1], s[2]) ? floor(w, s, born) : {}, { stairs: [[k, s[1], s[2], d, born]] });
          out.push({
            rule: this.id, name: 'two ways side by side, a level apart', anchor: s, cells: [lo, s, u], by: [a, b], insists: ways,
            candidates: [
              { level: 0, label: 'two ways at two levels, left as they are', verbs: ['separate'], op: {} },
              { level: 1, label: 'a step between them', verbs: ['step'], op: step },
              { level: 2, label: 'a step between them, a lantern at its head', verbs: ['step', 'frame'], op: join(step, lantern(u)) },
            ],
          });
        }
      }
    });
    return out;
  },
};

/**
 * A raised way of the hand's that ends in the air: its stroke's last cell on stone, nothing at its height beyond it or
 * beside it to step on to, and nothing near (that's a meeting of two ways, not an end). The ladder: a parapet across
 * its end (a figure comes to a rail, not a drop); a small terrace there, railed (a belvedere); the terrace on its own
 * pier, a lantern at it.
 */
const wayEnds: Rule = {
  id: 'way-ends',
  find(w) {
    const out: Found[] = [], walks = w.ops.map((op) => w.walks.get(op) ?? []), walked = new Map<number, number>();
    walks.forEach((cs, n) => { for (const c of cs) if (!walked.has(key(...c))) walked.set(key(...c), n); });
    walks.forEach((cs, a) => {
      if (cs.length < 2 || w.ops[a].derived) return;
      const e = cs[cs.length - 1], p = cs[cs.length - 2], [k, i, j] = e, dx = i - p[1], dz = j - p[2];
      if (k <= w.ground(i, j) || !w.stone(k - 1, i, j) || p[0] !== k || Math.abs(dx) + Math.abs(dz) !== 1) return;
      // (nothing it arrives at: beyond it or beside it, a place or a stair, or anything at its height within two cells
      // that another way walks or that could be stood on)
      for (const [x, z] of [[dx, dz], [dz, dx], [-dz, -dx]]) if (place(w, [k, i + x, j + z]) || w.occupied(k, i + x, j + z) || w.stair(k - 1, i + x, j + z) >= 0) return;
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
        const c: Cell = [k, i + x, j + z], b = walked.get(key(...c)) ?? -1;
        if ((b >= 0 && b !== a) || (b < 0 && place(w, c) && Math.abs(x) + Math.abs(z) > 1)) return;
      }
      const m: Cell = [k, i + dx, j + dz], born = w.ops[a].born ?? 0;
      if (!open(w, m)) return;
      const sides = [[dz, dx], [-dz, -dx]].map(([x, z]) => [k, m[1] + x, m[2] + z] as Cell).filter((c) => open(w, c));
      const rail = (c: Cell, kind: number = DRESS.parapet): Op => ({ dress: [[c[0] - 1, c[1], c[2], kind, 1]] });
      const terrace = join(...[m, ...sides].map((c) => join(floor(w, c, born), rail(c, DRESS.balustrade))));
      out.push({
        rule: this.id, name: 'a way ending in the air', where: 'at its end', anchor: m, cells: [m, e], by: [a], insists: ways,
        candidates: [
          { level: 0, label: 'a parapet across its end', verbs: ['frame'], op: rail(e) },
          { level: 1, label: 'a small terrace at its end, railed: a belvedere', verbs: ['merge', 'frame'], op: terrace },
          { level: 2, label: 'the belvedere on its own pier, a lantern at it', verbs: ['merge', 'carry', 'frame'], op: join(terrace, pier(m), lantern(m)) },
        ],
      });
    });
    return out;
  },
};

/**
 * Two of the hand's ways crossing at different heights, two to four levels apart (a bridge over a lane, a walkway over
 * a way): one's walk over the other's, square across it. The ladder: left as they are, one over the other (a way over a
 * way is often the point); a straight flight from the lower, up beside it, to the upper's deck (its foot by the lower
 * way, its head on the upper's walk); the flight, a lantern at its head.
 */
const waysCross: Rule = {
  id: 'ways-cross',
  find(w) {
    const out: Found[] = [], walks = w.ops.map((op) => w.walks.get(op) ?? []), at = new Map<number, number>(), pairs = new Set<string>();
    walks.forEach((cs, n) => { for (const c of cs) if (!at.has(key(...c))) at.set(key(...c), n); });
    /** which way a way runs at a cell of its walk (by its neighbours along it), or -1 */
    const axis = (cs: Cell[], q: number) => { const n = cs[q + 1] ?? cs[q - 1]; return n ? (n[1] !== cs[q][1] ? 0 : 1) : -1; };
    walks.forEach((cs, b) => cs.forEach((u, qu) => {
      const [k2, i, j] = u, aU = axis(cs, qu);
      for (let k = k2 - 2; k >= Math.max(0, k2 - 4); k--) {
        const a = at.get(key(k, i, j)) ?? -1;
        if (a < 0 || a === b || pairs.has(`${a}.${b}`)) continue;
        const lower = walks[a], aL = axis(lower, lower.findIndex((c) => c[0] === k && c[1] === i && c[2] === j));
        if (aU < 0 || aL < 0 || aU === aL) continue;
        const H = k2 - k, [ux, uz] = DIRS[aU], born = Math.max(w.ops[a].born ?? 0, w.ops[b].born ?? 0);
        // (the flight: beside the lower way, on the side the upper's walk goes on, climbing toward it, and the first of
        // the four that has room)
        for (const [s, t] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const d = t > 0 ? aL : aL + 2, [lx, lz] = DIRS[d], C: Cell = [k2, i + s * ux, j + s * uz];
          if (at.get(key(...C)) !== b) continue;
          const foot: Cell = [k, C[1] - (H + 1) * lx, C[2] - (H + 1) * lz];
          if (!place(w, foot) || at.get(key(k, i - (H + 1) * lx, j - (H + 1) * lz)) !== a) continue;
          const flight: Op[] = [];
          for (let q = 0; q < H; q++) {
            const c: Cell = [k + q, C[1] - (H - q) * lx, C[2] - (H - q) * lz];
            flight.push(join(c[0] > w.ground(c[1], c[2]) && !w.stone(c[0] - 1, c[1], c[2]) ? floor(w, c, born) : {}, { stairs: [[c[0], c[1], c[2], d, born]] }));
          }
          const stair = join(...flight), cand: Candidate = { level: 1, label: '', verbs: [], op: stair };
          if (!keeps(w, cand, new Set())) continue;
          pairs.add(`${a}.${b}`);
          out.push({
            rule: this.id, name: 'two ways crossing, one over the other', where: 'where they cross', anchor: [k, i, j], cells: [[k, i, j], u, foot, C], by: [a, b].sort((p, q) => p - q), insists: ways,
            candidates: [
              { level: 0, label: 'one over the other, left as they are', verbs: ['separate'], op: {} },
              { level: 1, label: 'a flight from the lower up to the upper', verbs: ['step'], op: stair },
              { level: 2, label: 'the flight, a lantern at its head', verbs: ['step', 'frame'], op: join(stair, lantern(C)) },
            ],
          });
          break;
        }
      }
    }));
    return out;
  },
};

/**
 * A flight of the hand's whose head lands against a wall: the landing it arrives on, and the hand's stone straight ahead
 * of it at that height, rising past it. A stair is climbed to go somewhere: aimed at a wall, the wall opens. Where
 * there's somewhere to stand beyond a wall a cell thick, an arch through it, the way going on; else (a building's own
 * door aside, buildings.ts) a blind door in its face, where it's met. The ladder: the arch; framed, a lantern each side
 * of it; a pergola over the landing, a threshold.
 */
const flightMeetsWall: Rule = {
  id: 'flight-meets-wall',
  find(w) {
    const out: Found[] = [], at = new Map<number, number>(), seen = new Set<number>();
    // (the hand's operation each stair is of: a connection's steps (what it laid), or stairs laid as they are)
    w.ops.forEach((op, n) => { for (const c of [...(w.reached.get(op)?.cells ?? []), ...(op.stairs ?? []).map((s) => [s[0], s[1], s[2]] as Cell)]) if (!at.has(key(...c))) at.set(key(...c), n); });
    for (const f of w.flights) {
      const [a, b] = DIRS[f.d], [kt, it, jt] = f.cells[f.cells.length - 1], H: Cell = [kt + 1, it + a, jt + b], B: Cell = [kt + 1, H[1] + a, H[2] + b], C: Cell = [kt + 1, B[1] + a, B[2] + b];
      // (the hand's flight (laid by a way or a stair of its own), landing on a place, a plain block of the hand's ahead)
      const by = at.get(key(...f.cells[f.cells.length - 1])) ?? at.get(key(...f.cells[0])) ?? -1;
      if (by < 0 || w.ops[by].derived || !place(w, H) || w.occupied(...H) || !w.block(...B) || seen.has(key(...B))) continue;
      // (through it, a cell thick, to somewhere to stand: an arch, the way going on)
      if (!place(w, C) || w.occupied(...C)) continue;
      seen.add(key(...B));
      const born = w.ops[by].born ?? 0, arch: Op = { arches: [[...B, f.d % 2, born]] };
      out.push({
        rule: this.id, name: 'a flight aimed at a wall', where: 'at its head', anchor: B, cells: [H, B, C], by: [by], insists: (o) => !!o.connect || !!o.stairs?.length,
        candidates: [
          { level: 0, label: 'an arch through the wall at its head', verbs: ['open'], op: arch },
          { level: 1, label: 'the arch, a lantern each side of it', verbs: ['open', 'frame'], op: join(arch, lantern(H), lantern(C)) },
          { level: 2, label: 'the arch, a pergola over its landing', verbs: ['open', 'shelter'], op: join(arch, lantern(C), { dress: [[...H, DRESS.pergola, 1]] }) },
        ],
      });
    }
    return out;
  },
};

/** what counts as making two ways' meeting again: another way (not the stone round it) */
const ways = (op: Op) => !!op.connect || !!op.pave?.length;

/**
 * A way of the hand's passing beside a shade tree the hand planted (an olive, a stone pine) on the ground: the tree
 * claims its cell, so the way goes by it. The ladder: left so, the way passing it (the restrained answer); a ring of
 * paving round it, the way opening into a small place in its shade; the ring with a low stone seat round its trunk.
 */
const wayMeetsTree: Rule = {
  id: 'way-meets-tree',
  find(w) {
    const out: Found[] = [], seen = new Set<number>();
    w.ops.forEach((op, p) => {
      if (op.derived) return;
      for (const [k, i, j, kind] of op.plants ?? []) {
        const T: Cell = [k, i, j];
        if ((kind !== PLANT.olive && kind !== PLANT.pine) || k !== w.ground(i, j) || w.plant(k, i, j) !== kind || seen.has(key(...T))) continue;
        // (the first of the hand's ways that walks beside it, at its foot)
        let a = -1, by: Cell | null = null;
        for (let q = 0; q < w.ops.length && a < 0; q++) {
          if (w.ops[q].derived) continue;
          const c = (w.walks.get(w.ops[q]) ?? []).find(([ck, ci, cj]) => ck === k && Math.abs(ci - i) + Math.abs(cj - j) === 1);
          if (c) { a = q; by = c; }
        }
        if (a < 0 || !by) continue;
        seen.add(key(...T));
        // (the ring: the ground round it, level with its foot, free, not already paved or a passage)
        const ring: Array<[number, number]> = [];
        for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const ci = i + x, cj = j + z;
          if (inGrid(ci, cj) && w.ground(ci, cj) === k && !w.occupied(k, ci, cj) && !w.tree(k, ci, cj) && !w.pool(ci, cj) && !w.paved(ci, cj) && w.passage(k, ci, cj) < 0 && !w.way(k, ci, cj)) ring.push([ci, cj]);
        }
        const paved: Op = ring.length ? { pave: ring } : {};
        out.push({
          rule: this.id, name: 'a way passing a tree', where: 'by the tree', anchor: T, cells: [T, by], by: [a, p].sort((x, y) => x - y), insists: ways,
          candidates: [
            { level: 0, label: 'the way passing it', verbs: ['yield'], op: {} },
            ...(ring.length ? [{ level: 1 as const, label: 'a ring of paving round it, a place in its shade', verbs: ['wrap'] as Verb[], op: paved }] : []),
            { level: 2, label: `${ring.length ? 'the ring, and ' : ''}a low stone seat round its trunk`, verbs: ['wrap', 'shelter'], op: join(paved, { dress: [[k, i, j, DRESS.seat, 1]] }) },
          ],
        });
      }
    });
    return out;
  },
};

/**
 * A flight of the hand's, and a terrace of its stone laid beside it, level with one of its steps along the way (not its
 * last: that's arriving): the terrace stops at the flight (it can't be laid in its steps). The ladder: notched round
 * it, the two apart (the restrained answer); the flight opened at that step, stepped off on to the terrace; and a
 * lantern there.
 */
const flightMeetsTerrace: Rule = {
  id: 'flight-meets-terrace',
  find(w) {
    const out: Found[] = [], at = new Map<number, number>(), seen = new Set<number>();
    w.ops.forEach((op, n) => { for (const c of [...(w.reached.get(op)?.cells ?? []), ...(op.stairs ?? []).map((s) => [s[0], s[1], s[2]] as Cell)]) if (!at.has(key(...c))) at.set(key(...c), n); });
    for (const f of w.flights) {
      const by = at.get(key(...f.cells[f.cells.length - 1])) ?? at.get(key(...f.cells[0])) ?? -1;
      if (by < 0 || w.ops[by].derived) continue;
      for (let q = 0; q < f.cells.length - 1; q++) {
        const S = f.cells[q], [k, i, j] = S;
        for (const s of [(f.d + 1) % 4, (f.d + 3) % 4]) {
          const [sa, sb] = DIRS[s], X: Cell = [k + 1, i + sa, j + sb];
          // (a terrace: the hand's stone level with the step's top, two cells deep from the flight, somewhere to stand)
          if (!w.block(k, X[1], X[2]) || !w.block(k, X[1] + sa, X[2] + sb) || !place(w, X) || w.occupied(...X) || seen.has(key(...X))) continue;
          const terrace = w.ops.findIndex((o, n) => n !== by && !o.derived && (o.add ?? []).some((c) => c[0] === k && c[1] === X[1] && c[2] === X[2]));
          if (terrace < 0) continue;
          seen.add(key(...X));
          const gap: Op = { dress: [[k, i, j, DRESS.gap, 1]] };
          out.push({
            rule: this.id, name: 'a terrace beside a flight', where: 'by the terrace', anchor: X, cells: [S, X], by: [by, terrace].sort((p, r) => p - r), insists: (o) => !!o.connect || !!o.add?.length,
            candidates: [
              { level: 0, label: 'the terrace notched round the flight, the two apart', verbs: ['yield', 'separate'], op: {} },
              { level: 1, label: 'the flight opened at that step, stepped off on to the terrace', verbs: ['open', 'step'], op: gap },
              { level: 2, label: 'stepped off on to the terrace, a lantern there', verbs: ['open', 'step', 'frame'], op: join(gap, lantern([X[0], X[1] + sa, X[2] + sb])) },
            ],
          });
        }
      }
    }
    return out;
  },
};

/** every rule, in the order they're resolved (a later one never lays where an earlier one has) */
export const RULES: Rule[] = [waysMeet, levelApart, waysCross, wayEnds, flightMeetsWall, wayMeetsTree, flightMeetsTerrace];

// ─── resolving them ───

/** the cells an operation lays something in */
export const lays = (op: Op): Cell[] => [...(op.add ?? []), ...(op.walls ?? []), ...(op.arches ?? []), ...(op.stairs ?? [])].map((c) => [c[0], c[1], c[2]] as Cell);
/** whether a candidate keeps every claim (a passage, a stair's way, a tree, water: nothing a meeting lays goes in
 * any of them), and stays out of what other meetings have laid */
function keeps(w: World, c: Candidate, taken: Set<number>): boolean {
  // (an arch opened in the hand's plain stone (the verb open) lays nothing new: it's let through what's there)
  const opens = new Set((c.op.arches ?? []).filter(([k, i, j]) => w.block(k, i, j)).map(([k, i, j]) => key(k, i, j)));
  for (const cell of lays(c.op)) if (taken.has(key(...cell)) || (!opens.has(key(...cell)) && (w.occupied(...cell) || w.claim(...cell)))) return false;
  // (and a stair it lays has its own way clear: its foot, the room over it, its head and the room over that)
  for (const [k, i, j, d] of c.op.stairs ?? []) {
    const [a, b] = DIRS[d], way: Cell[] = [[k, i - a, j - b], [k + 1, i, j], [k + 1, i + a, j + b], [k + 2, i + a, j + b]];
    if (way.some((q) => w.occupied(...q) || taken.has(key(...q)))) return false;
  }
  for (const [i, j] of c.op.pave ?? []) if (taken.has(key(w.ground(i, j), i, j)) || w.claim(w.ground(i, j), i, j) === 'water') return false;
  return true;
}
/** how many of the hand's gestures, after those that made it, touched a meeting again (each a rung higher) */
function insistence(w: World, m: Found): number {
  const after = Math.max(...m.by), near = (i: number, j: number) => m.cells.some((c) => Math.max(Math.abs(c[1] - i), Math.abs(c[2] - j)) <= 1);
  let n = 0;
  for (let q = after + 1; q < w.ops.length; q++) {
    const o = w.ops[q];
    if (o.derived || (m.insists && !m.insists(o))) continue;
    // (where it acts: what it lays and walks, and the course it was drawn along (made again where it's already built, a
    // way lays nothing new, but it's been drawn there again))
    const course: Array<[number, number]> = o.connect ? [...o.connect.path, ...(o.connect.to ? [[o.connect.to[1], o.connect.to[2]] as [number, number]] : [])] : [];
    const foot = [...lays(o), ...(w.walks.get(o) ?? [])].map((c) => [c[1], c[2]] as [number, number]).concat(o.pave ?? [], course);
    if (foot.some(([i, j]) => near(i, j))) n++;
  }
  return n;
}

/** the meetings in what's been built, each resolved; what they come to, as operations (model.ts lays them) */
export function meet(w: World): Op[] {
  const out: Op[] = [], taken = new Set<number>(), found: Meeting[] = [];
  for (const rule of RULES) for (const m of rule.find(w) as Found[]) {
    const choice = w.choices.get(key(...m.anchor)), top = Math.max(...m.candidates.map((c) => c.level));
    const wanted = choice ?? Math.min(top, insistence(w, m));
    const fit = m.candidates.filter((c) => c.level <= wanted && keeps(w, c, taken)).sort((p, q) => q.level - p.level)[0];
    found.push({ ...m, wanted, laid: fit ? fit.level : -1, chosen: choice !== undefined, at: fit ? [...lays(fit.op), ...(fit.op.pave ?? []).map(([i, j]) => [w.ground(i, j), i, j] as Cell)] : [] });
    if (!fit || !Object.keys(fit.op).length) continue;
    for (const c of lays(fit.op)) taken.add(key(...c));
    for (const [i, j] of fit.op.pave ?? []) taken.add(key(w.ground(i, j), i, j));
    out.push({ ...fit.op, derived: true, why: 'meeting', note: fit.label, born: Math.max(...m.by.map((q) => w.ops[q].born ?? 0)) });
  }
  w.meetings = found;
  return out;
}

/** the meeting whose resolution a cell is (a slab or landing it laid), if any */
export const meetingAt = (w: World, [k, i, j]: Cell): Meeting | null => w.meetings.find((m) => (m.at.length ? m.at : [m.anchor]).some((c) => c[0] === k && c[1] === i && c[2] === j)) ?? null;
/** a meeting's readings, as the hand chooses among them: each rung's operation is the choice, kept */
export const readingsOf = (m: Meeting): Array<{ label: string; op: Op }> => m.candidates.map((c) => ({ label: c.label, op: { choose: [[...m.anchor, c.level]], why: 'reading', note: c.label } }));
