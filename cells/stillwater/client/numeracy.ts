/**
 * The rules that move the boat. Pure: no DOM, no GL, no clock — the world hands
 * in the drop counts of the pads that are in view and a random source, and gets
 * back a target, a verdict on a selection, or a repair.
 *
 * One rule set from counting to multiplication, as a ladder of stages:
 *
 *   gather   2–5    any leaves whose drops sum to the target      · • • •
 *   add      5–10   same, bigger                                  ten-frame
 *   more     9–20   same, bigger again                            ten-frames
 *   groups   4–20   leaves that all hold the same number of drops  rows × cols
 *   times    6–36   same, shown only as a numeral                  18
 *
 * "groups" is repeated addition made visible (the target is drawn as an array
 * of dots, one row per leaf); "times" drops the array and leaves the product.
 * Any factorisation the pond offers is accepted: 18 is three leaves of six or
 * six leaves of three, whichever the water happens to hold.
 *
 * Solvability comes from the pond, not from a layout table: a target is only
 * ever drawn from counts that are in view, and when drift carries a needed leaf
 * away, `repair` names an empty leaf in view for dew to condense on.
 */

export type Rule = 'sum' | 'groups';
export type Display = 'line' | 'frames' | 'array' | 'numeral';

export interface Stage {
  id: 'gather' | 'add' | 'more' | 'groups' | 'times';
  rule: Rule;
  display: Display;
  /** Most drops dew will put on one leaf at this stage. */
  maxDrops: number;
  /** Least drops dew will put on one leaf (a 1 in "groups" is a trivial group). */
  minDrops: number;
  min: number;
  max: number;
  /** Most leaves a solution may need (keeps sums of many ones out). */
  maxParts: number;
  /** Solves before the next stage opens. */
  solves: number;
}

export const STAGES: readonly Stage[] = [
  { id: 'gather', rule: 'sum', display: 'line', maxDrops: 3, minDrops: 1, min: 2, max: 5, maxParts: 3, solves: 4 },
  { id: 'add', rule: 'sum', display: 'frames', maxDrops: 5, minDrops: 1, min: 5, max: 10, maxParts: 3, solves: 5 },
  { id: 'more', rule: 'sum', display: 'frames', maxDrops: 7, minDrops: 2, min: 9, max: 20, maxParts: 4, solves: 6 },
  { id: 'groups', rule: 'groups', display: 'array', maxDrops: 5, minDrops: 2, min: 4, max: 20, maxParts: 4, solves: 6 },
  { id: 'times', rule: 'groups', display: 'numeral', maxDrops: 6, minDrops: 2, min: 6, max: 36, maxParts: 6, solves: Infinity },
];

export interface Target {
  value: number;
  /** For "groups"/"times": the grouping the target was drawn from (a hint for the display, not a constraint). */
  rows?: number;
  cols?: number;
}

export type Rand = () => number;

const pickInt = (rand: Rand, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

function shuffle<T>(xs: T[], rand: Rand): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Drops for a fresh leaf at this stage: most leaves stay dry, so the dewy ones can be counted at a glance. */
export function dewFor(stage: Stage, rand: Rand): number {
  if (rand() < 0.68) return 0;
  return pickInt(rand, stage.minDrops, stage.maxDrops);
}

/** Can `target` be made from at most `maxParts` of these counts (each used once)? */
export function canSum(counts: readonly number[], target: number, maxParts: number): boolean {
  // reach[s] = fewest leaves that make s
  const reach = new Array<number>(target + 1).fill(Infinity);
  reach[0] = 0;
  for (const c of counts) {
    if (c <= 0) continue;
    for (let s = target; s >= c; s--) if (reach[s - c] + 1 < reach[s]) reach[s] = reach[s - c] + 1;
  }
  return reach[target] <= maxParts;
}

/** Ways to make `target` from equal leaves: [cols (drops per leaf), rows (leaves)] pairs the counts support. */
export function groupings(counts: readonly number[], target: number, maxParts: number): Array<[number, number]> {
  const hist = histogram(counts);
  const out: Array<[number, number]> = [];
  for (const [k, n] of hist) {
    if (k < 2 || target % k) continue;
    const m = target / k;
    if (m >= 2 && m <= maxParts && m <= n) out.push([k, m]);
  }
  return out;
}

function histogram(counts: readonly number[]): Map<number, number> {
  const h = new Map<number, number>();
  for (const c of counts) if (c > 0) h.set(c, (h.get(c) ?? 0) + 1);
  return h;
}

export function solvable(stage: Stage, counts: readonly number[], target: number): boolean {
  return stage.rule === 'sum' ? canSum(counts, target, stage.maxParts) : groupings(counts, target, stage.maxParts).length > 0;
}

/**
 * A target the leaves in view can make, or null if they can make nothing in
 * range (the caller then condenses dew — see `repair`). `avoid` is the last
 * target, so the pond doesn't ask the same thing twice running.
 */
export function chooseTarget(stage: Stage, counts: readonly number[], rand: Rand, avoid?: number): Target | null {
  if (stage.rule === 'groups') {
    const options: Target[] = [];
    for (const [k, n] of histogram(counts)) {
      if (k < 2) continue;
      for (let m = 2; m <= Math.min(n, stage.maxParts); m++) {
        const value = k * m;
        if (value >= stage.min && value <= stage.max) options.push({ value, rows: m, cols: k });
      }
    }
    const fresh = options.filter((o) => o.value !== avoid);
    const pool = fresh.length ? fresh : options;
    return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
  }
  const lit = counts.filter((c) => c > 0);
  const found: number[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    const parts = pickInt(rand, stage.id === 'gather' ? 1 : 2, stage.maxParts);
    const pick = shuffle(lit, rand).slice(0, parts);
    if (pick.length < Math.min(parts, 2) && stage.id !== 'gather') continue;
    const value = pick.reduce((s, c) => s + c, 0);
    if (value >= stage.min && value <= stage.max) {
      if (value !== avoid) return { value };
      found.push(value);
    }
  }
  return found.length ? { value: found[0] } : null;
}

/**
 * Dew to condense so `target` becomes makeable again: returns the drop count to
 * give each of the named empty leaves (indices into `counts`), or null if there
 * are not enough empty leaves in view. Uses as few leaves as it can.
 */
export function repair(stage: Stage, counts: readonly number[], target: number): Map<number, number> | null {
  const empty = counts.map((c, i) => (c > 0 ? -1 : i)).filter((i) => i >= 0);
  const out = new Map<number, number>();
  if (stage.rule === 'groups') {
    // Prefer a grouping the in-view leaves already half-make: fill in the missing leaves.
    const hist = histogram(counts);
    let best: { k: number; need: number } | null = null;
    for (let k = Math.max(2, stage.minDrops); k <= stage.maxDrops; k++) {
      if (target % k) continue;
      const m = target / k;
      if (m < 2 || m > stage.maxParts) continue;
      const need = Math.max(0, m - (hist.get(k) ?? 0));
      if (!best || need < best.need) best = { k, need };
    }
    if (!best || best.need > empty.length) return null;
    for (let i = 0; i < best.need; i++) out.set(empty[i], best.k);
    return out;
  }
  // Sum: keep the largest in-view part that leaves a remainder dew can supply.
  if (!empty.length) return null;
  const lit = counts.filter((c) => c > 0).sort((a, b) => b - a);
  let rest = target;
  let used = 0;
  for (const c of lit) {
    if (used >= stage.maxParts - 1) break;
    if (rest - c >= 1) {
      rest -= c;
      used++;
    }
  }
  let slot = 0;
  while (rest > 0) {
    if (slot >= empty.length || used >= stage.maxParts) return null;
    const give = Math.min(stage.maxDrops, rest);
    out.set(empty[slot++], give);
    rest -= give;
    used++;
  }
  return out;
}

export type Verdict =
  | { kind: 'partial'; gathered: number }
  | { kind: 'solved'; gathered: number }
  | { kind: 'over'; gathered: number }
  /** "groups": the newest leaf doesn't match the others; the selection restarts from it. */
  | { kind: 'mismatch'; gathered: number };

/** Judge a selection (drop counts of the chosen leaves, in the order chosen). */
export function judge(stage: Stage, target: number, chosen: readonly number[]): Verdict {
  const gathered = chosen.reduce((s, c) => s + c, 0);
  if (stage.rule === 'groups' && chosen.length > 1 && chosen[chosen.length - 1] !== chosen[0]) {
    return { kind: 'mismatch', gathered: chosen[chosen.length - 1] };
  }
  if (gathered === target && (stage.rule === 'sum' || chosen.length >= 2)) return { kind: 'solved', gathered };
  if (gathered >= target) return { kind: 'over', gathered };
  return { kind: 'partial', gathered };
}

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];

export function numberWord(n: number): string {
  if (n <= 20) return WORDS[n] ?? String(n);
  const t = Math.floor(n / 10);
  const u = n % 10;
  return TENS[t] ? TENS[t] + (u ? '-' + WORDS[u] : '') : String(n);
}

/** The quiet line under the pond when a target is set. */
export function hintFor(stage: Stage, target: Target, first: boolean): string {
  const w = numberWord(target.value);
  switch (stage.id) {
    case 'gather':
      return first ? `touch the leaves · gather ${w} drops` : `gather ${w} drops`;
    case 'add':
    case 'more':
      return `gather ${w} drops`;
    case 'groups':
      return first ? `${w} · from leaves that match` : `${w} in matching leaves`;
    case 'times':
      return `${w}`;
  }
}
