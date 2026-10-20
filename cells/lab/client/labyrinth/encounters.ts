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
import { DIRS, DRESS, RULE, inGrid, key, type Cell, type Op, type World } from './model';

/** the verbs: how architecture behaves touched by other architecture (static/labyrinth-encounters.md) */
export type Verb = 'merge' | 'open' | 'carry' | 'wrap' | 'step' | 'shelter' | 'frame' | 'yield' | 'separate';
export type Level = 0 | 1 | 2;
export interface Candidate { level: Level; label: string; verbs: Verb[]; op: Op }
export interface Meeting {
  /** which rule found it, and what it's called */
  rule: string; name: string;
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

/** what counts as making two ways' meeting again: another way (not the stone round it) */
const ways = (op: Op) => !!op.connect || !!op.pave?.length;

/** every rule, in the order they're resolved (a later one never lays where an earlier one has) */
export const RULES: Rule[] = [waysMeet];

// ─── resolving them ───

/** the cells an operation lays something in */
const lays = (op: Op): Cell[] => [...(op.add ?? []), ...(op.walls ?? []), ...(op.arches ?? []), ...(op.stairs ?? [])].map((c) => [c[0], c[1], c[2]] as Cell);
/** whether a candidate keeps every claim (a passage, a stair's way, a tree, water: nothing a meeting lays goes in
 * any of them), and stays out of what other meetings have laid */
function keeps(w: World, c: Candidate, taken: Set<number>): boolean {
  for (const cell of lays(c.op)) if (taken.has(key(...cell)) || w.occupied(...cell) || w.claim(...cell)) return false;
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
    const foot = [...lays(o), ...(w.walks.get(o) ?? [])].map((c) => [c[1], c[2]] as [number, number]).concat(o.pave ?? []);
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
    if (!fit) continue;
    for (const c of lays(fit.op)) taken.add(key(...c));
    for (const [i, j] of fit.op.pave ?? []) taken.add(key(w.ground(i, j), i, j));
    out.push({ ...fit.op, derived: true, why: 'meeting', note: fit.label, born: Math.max(...m.by.map((q) => w.ops[q].born ?? 0)) });
  }
  w.meetings = found;
  return out;
}

/** the meeting whose resolution a cell is (a slab or landing it laid), if any */
export const meetingAt = (w: World, [k, i, j]: Cell): Meeting | null => w.meetings.find((m) => m.at.some((c) => c[0] === k && c[1] === i && c[2] === j)) ?? null;
/** a meeting's readings, as the hand chooses among them: each rung's operation is the choice, kept */
export const readingsOf = (m: Meeting): Array<{ label: string; op: Op }> => m.candidates.map((c) => ({ label: c.label, op: { choose: [[...m.anchor, c.level]], why: 'reading', note: c.label } }));
