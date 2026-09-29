/**
 * The rules that move the boat. Pure: no DOM, no GL, no clock — the world hands
 * in the drop counts of the pads that are in view and a random source, and gets
 * back a target, a verdict on a selection, or a repair.
 *
 * One rule set runs from counting to multiplication as an overlapping
 * capability field rather than a ladder. Proficiency only biases what the pond
 * is likely to ask; earlier forms remain present as later relationships emerge.
 *
 * "groups" is repeated addition made visible (the target is drawn as an array
 * of dots, one row per leaf); "times" drops the array and leaves the product.
 * Any factorisation the pond offers is accepted: 18 is three leaves of six or
 * six leaves of three, whichever the water happens to hold.
 *
 * Solvability comes from the pond, not from a layout table: the next ask is
 * drawn from dew already visible in a stable stretch ahead. Repair remains only
 * as a continuity fallback once a child has begun an answer.
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
  /** Rough latent difficulty, 0..1, used only to calibrate proficiency. */
  difficulty: number;
}

export const STAGES: readonly Stage[] = [
  { id: 'gather', rule: 'sum', display: 'line', maxDrops: 3, minDrops: 1, min: 2, max: 5, maxParts: 3, difficulty: 0.05 },
  { id: 'add', rule: 'sum', display: 'frames', maxDrops: 5, minDrops: 1, min: 5, max: 10, maxParts: 3, difficulty: 0.25 },
  { id: 'more', rule: 'sum', display: 'frames', maxDrops: 7, minDrops: 2, min: 9, max: 20, maxParts: 4, difficulty: 0.48 },
  { id: 'groups', rule: 'groups', display: 'array', maxDrops: 5, minDrops: 2, min: 4, max: 20, maxParts: 4, difficulty: 0.68 },
  { id: 'times', rule: 'groups', display: 'numeral', maxDrops: 6, minDrops: 2, min: 6, max: 36, maxParts: 6, difficulty: 0.88 },
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

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};
const bell = (x: number, centre: number, width: number) => {
  const z = (x - centre) / width;
  return Math.exp(-1.6 * z * z);
};

export function stageForId(id: string | null | undefined): Stage | null {
  return STAGES.find((s) => s.id === id) ?? null;
}

/** Overlapping curriculum field: new forms emerge smoothly; earlier forms persist forever. */
export function stageWeight(stage: Stage, mastery0: number): number {
  const m = clamp01(mastery0);
  switch (stage.id) {
    case 'gather':
      return 0.18 + 1.4 * (1 - smooth01(0.08, 0.62, m));
    case 'add':
      return 0.11 + 1.12 * bell(m, 0.28, 0.24);
    case 'more':
      return 0.09 * smooth01(0.08, 0.28, m) + 1.08 * bell(m, 0.50, 0.25) * smooth01(0.10, 0.35, m);
    case 'groups':
      return 0.08 * smooth01(0.18, 0.42, m) + 1.05 * bell(m, 0.70, 0.24) * smooth01(0.24, 0.58, m);
    case 'times':
      return 0.06 * smooth01(0.38, 0.62, m) + 1.15 * smooth01(0.48, 0.92, m);
  }
}

export function pickStage(mastery: number, rand: Rand): Stage {
  const weights = STAGES.map((s) => stageWeight(s, mastery));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < STAGES.length; i++) {
    r -= weights[i];
    if (r <= 0) return STAGES[i];
  }
  return STAGES[0];
}

function weightedStageOrder(mastery: number, rand: Rand): Stage[] {
  const pool = STAGES.map((stage) => ({ stage, w: stageWeight(stage, mastery) })).filter((p) => p.w > 0.005);
  const out: Stage[] = [];
  while (pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    if (total <= 0) {
      out.push(...pool.splice(0).map((p) => p.stage));
      break;
    }
    let r = rand() * total;
    let at = 0;
    for (; at < pool.length - 1; at++) {
      r -= pool[at].w;
      if (r <= 0) break;
    }
    out.push(pool.splice(at, 1)[0].stage);
  }
  return out;
}

/** Dew follows proficiency, not the current ask, so the ecology stays continuous. */
export function dewForMastery(mastery0: number, rand: Rand): number {
  const m = clamp01(mastery0);
  const dryChance = 0.70 - 0.08 * smooth01(0.25, 0.82, m);
  if (rand() < dryChance) return 0;
  const max = Math.max(3, Math.min(6, Math.round(3 + 3 * smooth01(0.08, 0.92, m))));
  if (rand() < 0.30 * smooth01(0.25, 0.72, m)) return pickInt(rand, 2, Math.min(4, max));
  const min = rand() < 0.45 * smooth01(0.35, 0.80, m) ? 2 : 1;
  return pickInt(rand, min, max);
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
 * Choose the next relationship from what the landscape already contains.
 * Proficiency biases the capability order; physical availability has final say.
 */
export function chooseActivity(mastery: number, counts: readonly number[], rand: Rand, avoid?: number): { stage: Stage; target: Target } | null {
  for (const stage of weightedStageOrder(mastery, rand)) {
    const target = chooseTarget(stage, counts, rand, avoid);
    if (target) return { stage, target };
  }
  return null;
}

/**
 * Tiny Elo-like update. friction counts gentle over/mismatch moments before a
 * solve. There is no failure state; hesitation simply carries less evidence.
 */
export function learn(mastery0: number, stage: Stage, target: Target, friction: number): number {
  const mastery = clamp01(mastery0);
  const span = Math.max(1, stage.max - stage.min);
  const within = (target.value - stage.min) / span;
  const difficulty = clamp01(stage.difficulty + (within - 0.5) * 0.12);
  const expected = 1 / (1 + Math.exp((difficulty - mastery) * 5.5));
  const quality = 1 / (1 + Math.max(0, friction) * 0.38);
  const k = 0.052 * (0.72 + 0.28 * (1 - mastery));
  return clamp01(mastery + k * (quality - expected));
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
      return first ? `touch leaves with dew · gather ${w} drops` : `gather ${w} drops`;
    case 'add':
    case 'more':
      return `gather ${w} drops`;
    case 'groups':
      return first ? `${w} · from leaves that match` : `${w} in matching leaves`;
    case 'times':
      return `${w}`;
  }
}
