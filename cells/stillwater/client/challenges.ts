/**
 * Relationships, asked with dew. A challenge is one question; a skill is the
 * relationship it practises; a level is a step of the syllabus.
 *
 * The levels follow England's national curriculum and the DfE's "ready to
 * progress" criteria (Mathematics guidance: key stages 1 and 2, 2020), in the
 * order a child meets them — facts within 10, within 20, the 2/5/10 tables,
 * across tens, the 3/4/8 tables, all tables to 12, then connections. A grown-up
 * sets the school year (a starting point); the river moves on from there only on
 * evidence gathered on more than one day, and steps back when a level is not yet
 * holding.
 *
 * The dew stays the thing being reasoned about:
 *  - `sum` questions gather one collection of drops (every unknown is ≤ 20);
 *  - `groups` questions gather equal groups — leaves that match, as many as
 *    there are groups — so 3 × 4 is three leaves of four (or four of three),
 *    never "60 + □" or a remainder dressed up as multiplication.
 *
 * Within a level the question grows with the child: first the unknown where it
 * is easiest (a + b = ?, the part at the end), then in either place, then the
 * equation turned round (? = a + b); the numbers widen as clean answers come.
 * No speed grading, no timers.
 */
export type Skill = 'bond' | 'subtract' | 'double' | 'bridge' | 'balance' | 'groups' | 'factor' | 'divide' | 'pairs' | 'derive';
export type Mode = 'sum' | 'groups';
export type Expr = number | { slot: number } | { op: '+' | '−' | '×' | '÷'; a: Expr; b: Expr };

export interface Challenge {
  skill: Skill;
  level: number;
  mode: Mode;
  left: Expr;
  right: Expr;
  /** The unknowns (for `pairs`, one factor pair that works). */
  answers: number[];
  /** The fact inside it: a + b = total, or a × b = total (a groups of b). */
  a: number;
  b: number;
  total: number;
  mult: boolean;
  /** How much picture to draw under the equation, 0..1 (fades as this skill is learned). */
  support: number;
  /** 0 simplest form … 2 the equation turned round. */
  form: number;
}

export interface Level {
  name: string;
  year: string;
  skills: Skill[];
}

export const LEVELS: readonly Level[] = [
  { name: 'Counting', year: 'Reception', skills: [] },
  { name: 'Facts within 10', year: 'Year 1', skills: ['bond', 'subtract', 'double'] },
  { name: 'Facts within 20', year: 'Year 1–2', skills: ['bond', 'subtract', 'bridge'] },
  { name: 'Twos, fives and tens', year: 'Year 2', skills: ['groups', 'factor', 'divide'] },
  { name: 'Tens and ones', year: 'Year 2–3', skills: ['bond', 'subtract', 'balance'] },
  { name: 'Threes, fours and eights', year: 'Year 3', skills: ['groups', 'factor', 'divide'] },
  { name: 'Tables to 12', year: 'Year 4', skills: ['groups', 'factor', 'divide', 'pairs'] },
  { name: 'Connections', year: 'Year 4–5', skills: ['balance', 'derive', 'pairs', 'divide'] },
];
export const TOP = LEVELS.length - 1;

/** School years a grown-up can choose, and the level each starts at. */
export const YEARS: ReadonlyArray<readonly [string, number]> = [
  ['Reception', 0],
  ['Year 1', 1],
  ['Year 2', 2],
  ['Year 3', 4],
  ['Year 4', 5],
  ['Year 5 +', 6],
];

const MULT: readonly Skill[] = ['groups', 'factor', 'divide', 'pairs', 'derive'];
/** Tables each multiplicative level draws on. */
const TABLES: Record<number, number[]> = { 3: [2, 5, 10], 5: [3, 4, 8], 6: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 7: [3, 4, 6, 7, 8, 9, 12] };
/** Group sizes and counts the dew can show as leaves (≤ 6 drops a leaf, ≤ 6 leaves). */
const SIZES: Record<number, number[]> = { 3: [2, 5], 5: [3, 4], 6: [2, 3, 4, 5, 6], 7: [2, 3, 4, 5, 6] };

export const slot = (n = 0): Expr => ({ slot: n });
export const op = (o: '+' | '−' | '×' | '÷', a: Expr, b: Expr): Expr => ({ op: o, a, b });

export function evaluate(e: Expr, values: readonly number[]): number {
  if (typeof e === 'number') return e;
  if ('slot' in e) return values[e.slot];
  const a = evaluate(e.a, values);
  const b = evaluate(e.b, values);
  return e.op === '+' ? a + b : e.op === '−' ? a - b : e.op === '×' ? a * b : a / b;
}

export function expression(e: Expr, values?: readonly number[]): string {
  if (typeof e === 'number') return String(e);
  if ('slot' in e) return values?.[e.slot] ? String(values[e.slot]) : '?';
  return `${expression(e.a, values)} ${e.op} ${expression(e.b, values)}`;
}

export const equation = (c: Challenge, v?: readonly number[]) => `${expression(c.left, v)} = ${expression(c.right, v)}`;

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function words(n: number): string {
  if (n < 20) return WORDS[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + WORDS[n % 10] : '');
  return String(n);
}
function spoken(e: Expr): string {
  if (typeof e === 'number') return words(e);
  if ('slot' in e) return 'what';
  const o = { '+': 'plus', '−': 'take away', '×': 'times', '÷': 'divided by' }[e.op];
  return `${spoken(e.a)} ${o} ${spoken(e.b)}`;
}
/** The question read aloud (help for a child who does not read yet). */
export const say = (c: Challenge) => `${spoken(c.left)} equals ${spoken(c.right)}?`;
/** The answer read aloud, as a sentence about the fact. */
export function sayAnswer(c: Challenge): string {
  if (c.mult) return `${words(c.a)} lots of ${words(c.b)} make ${words(c.total)}.`;
  return `${words(c.a)} and ${words(c.b)} make ${words(c.total)}.`;
}

// ─── what the dew says ───────────────────────────────────────────────────────

/**
 * The gathering, as numbers: `sum` → [drops]; `groups` → [leaves, drops a leaf]
 * (the leaves already match — the page refuses a leaf that does not).
 */
export type Gathered = readonly number[];

/** The numbers to show in the equation's blanks for what has been gathered. */
export function shown(c: Challenge, g: Gathered): number[] {
  if (c.mode === 'sum') return [g[0] ?? 0];
  const [leaves = 0, per = 0] = g;
  if (c.skill === 'pairs') return [leaves, leaves ? per : 0];
  return [leaves * per];
}

/** Is the relationship true with what has been gathered? */
export function accepts(c: Challenge, g: Gathered): boolean {
  if (c.mode === 'sum') {
    const v = [g[0] ?? 0];
    return Number.isInteger(v[0]) && v[0] > 0 && evaluate(c.left, v) === evaluate(c.right, v);
  }
  const [leaves = 0, per = 0] = g;
  if (leaves < 1 || per < 1 || leaves * per !== c.total) return false;
  if (c.skill === 'pairs') return leaves >= 2 && per >= 2;
  // a groups of b, or b groups of a: the same product either way round
  return (leaves === c.a && per === c.b) || (leaves === c.b && per === c.a);
}

/** More than the relationship can take: this gathering cannot become right by adding. */
export function overfull(c: Challenge, g: Gathered): boolean {
  if (c.mode === 'sum') return (g[0] ?? 0) > c.answers[0];
  const [leaves = 0, per = 0] = g;
  if (!leaves) return false;
  if (c.skill === 'pairs') return c.total % per !== 0 || leaves * per > c.total || per > c.total / 2;
  const other = per === c.a ? c.b : per === c.b ? c.a : 0;
  return !other || leaves > other;
}

/** For `groups`: equal leaves the dew should offer (size, how many). */
export function groupsNeed(c: Challenge): { size: number; count: number } {
  if (c.skill === 'pairs') return { size: c.answers[1], count: c.answers[0] };
  // show the groups the question names first when they fit on a leaf
  return c.b <= 6 ? { size: c.b, count: c.a } : { size: c.a, count: c.b };
}

// ─── making questions ────────────────────────────────────────────────────────

const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/**
 * One question. `form` (0..2) is how far the child has come in this skill: 0 the
 * unknown where it is easiest, 1 anywhere, 2 turned round too. `reach` (0..1)
 * widens the numbers within the level. `fact` asks a particular fact (a due one).
 */
export function makeChallenge(level: number, skill: Skill, r: () => number, form = 0, reach = 1, fact?: { a: number; b: number }): Challenge {
  const mult = MULT.includes(skill);
  const k = 0.45 + 0.55 * Math.max(0, Math.min(1, reach));
  const upto = (lo: number, hi: number) => Math.max(lo, Math.round(lo + (hi - lo) * k));
  let a = 0;
  let b = 0;
  let left: Expr = 0;
  let right: Expr = 0;
  let answers: number[] = [];
  let mode: Mode = 'sum';
  let flip = form >= 2 && r() < 0.4;
  const any = form >= 1 && r() < 0.5;

  switch (skill) {
    case 'bond': {
      // a + ? = t (a part missing from a whole)
      if (level <= 1) {
        const t = int(r, 3, upto(5, 10));
        a = int(r, 1, t - 1);
        b = t - a;
      } else if (level === 2) {
        const t = int(r, 11, upto(14, 20));
        a = int(r, Math.max(2, t - 12), Math.min(t - 2, 12));
        b = t - a;
      } else {
        // tens and ones: a two-digit number and a part to the next whole (the part ≤ 12)
        a = int(r, 11, upto(40, 87));
        b = int(r, 2, 12);
      }
      if (fact && fact.a + fact.b <= 20) [a, b] = [fact.a, fact.b];
      const t = a + b;
      left = any ? op('+', slot(), a) : op('+', a, slot());
      right = t;
      answers = [b];
      break;
    }
    case 'subtract': {
      if (level <= 1) {
        const t = int(r, 3, upto(5, 10));
        a = int(r, 1, t - 1);
        b = t - a;
      } else if (level === 2) {
        const t = int(r, 11, upto(14, 20));
        a = int(r, Math.max(2, t - 12), Math.min(t - 2, 12));
        b = t - a;
      } else {
        // difference by counting on: 43 − 35 = ?
        b = int(r, 2, 12);
        a = int(r, 11, upto(40, 87));
      }
      const t = a + b;
      if (level >= 4) {
        left = any ? op('−', t, slot()) : op('−', t, a);
        right = any ? a : slot();
        answers = [b];
      } else if (!any) {
        left = op('−', t, a);
        right = slot();
        answers = [b];
      } else if (r() < 0.5) {
        left = op('−', t, slot());
        right = b;
        answers = [a];
      } else {
        left = op('−', slot(), a);
        right = b;
        answers = [t];
      }
      break;
    }
    case 'double':
      a = b = int(r, 1, upto(3, 5));
      left = op('+', a, a);
      right = slot();
      answers = [a + a];
      break;
    case 'bridge': {
      // crossing ten: 8 + ? = 13 (make ten, then the rest)
      a = int(r, 6, 9);
      b = int(r, 11 - a, 9);
      left = any ? op('+', slot(), a) : op('+', a, slot());
      right = a + b;
      answers = [b];
      break;
    }
    case 'balance': {
      if (level >= 7) {
        // the same product two ways: 4 × 6 = 8 × ?
        const pairs: Array<[number, number, number, number]> = [];
        for (let x = 2; x <= 12; x++) for (let y = 2; y <= 12; y++) for (let z = 2; z <= 12; z++) {
          const w = (x * y) / z;
          if (z !== x && z !== y && Number.isInteger(w) && w >= 2 && w <= 12) pairs.push([x, y, z, w]);
        }
        const [x, y, z, w] = pick(r, pairs);
        a = x;
        b = y;
        left = op('×', x, y);
        right = op('×', z, slot());
        answers = [w];
        flip = false;
        return { skill, level, mode, left, right, answers, a, b, total: x * y, mult: true, support: 0, form };
      }
      // partitioning: 34 + ? = 30 + 12
      a = int(r, 11, upto(40, 79));
      b = int(r, 2, 12);
      const t = a + b;
      const tens = Math.floor(a / 10) * 10;
      left = op('+', a, slot());
      right = op('+', tens, t - tens);
      answers = [b];
      flip = form >= 2 && r() < 0.5;
      break;
    }
    case 'groups': {
      // equal groups made with the leaves: a groups of b
      const sizes = SIZES[level] ?? [2, 3, 4, 5];
      b = pick(r, sizes);
      a = int(r, 2, upto(level === 3 ? 3 : 4, level === 3 ? 5 : 6));
      if (fact && fact.a <= 6 && fact.b <= 6) [a, b] = [fact.a, fact.b];
      mode = 'groups';
      left = op('×', a, b);
      right = slot();
      answers = [a * b];
      break;
    }
    case 'factor': {
      // a × ? = t: how many in each group (the unknown is a group size ≤ 12, gathered as drops)
      a = pick(r, TABLES[level] ?? [2, 5, 10]);
      b = int(r, 2, upto(level === 3 ? 5 : 6, level === 6 ? 12 : 10));
      if (fact && fact.b <= 12) [a, b] = [fact.a, fact.b];
      left = any && r() < 0.5 ? op('×', slot(), a) : op('×', a, slot());
      right = a * b;
      answers = [b];
      break;
    }
    case 'divide': {
      // t ÷ a = ? (how many in each group, or how many groups): the quotient is gathered
      a = pick(r, TABLES[level] ?? [2, 5, 10]);
      b = int(r, 2, upto(level === 3 ? 5 : 6, level >= 6 ? 12 : 10));
      left = op('÷', a * b, a);
      right = slot();
      answers = [b];
      break;
    }
    case 'pairs': {
      // ? × ? = t: any equal groups of the leaves that make t
      const g = int(r, 2, 6);
      const s = int(r, 2, 6);
      a = g;
      b = s;
      mode = 'groups';
      left = op('×', slot(0), slot(1));
      right = g * s;
      answers = [g, s];
      break;
    }
    case 'derive': {
      // one group more: 6 × 7 = 5 × 7 + ?
      a = int(r, 3, 9);
      b = int(r, 3, 12);
      left = op('×', a, b);
      right = op('+', op('×', a - 1, b), slot());
      answers = [b];
      flip = false;
      break;
    }
  }
  // Equality is a relationship, not an instruction to put an answer on the right.
  if (flip) [left, right] = [right, left];
  const total = mult ? a * b : a + b;
  return { skill, level, mode, left, right, answers, a, b, total, mult, support: 0, form };
}

// ─── the child's record ──────────────────────────────────────────────────────

export interface Evidence {
  seen: number;
  clean: number;
  streak: number;
  last: number;
  next: number;
  /** Days (YYYY-MM-DD) with a clean answer, latest few. */
  days: string[];
}

export interface CurriculumData {
  v: 2;
  level: number;
  /** Where a grown-up placed the child (the floor a step back does not go below, less one). */
  placement: number;
  /** The school year a grown-up chose (index into YEARS), if any. */
  year?: number;
  counting: number;
  skills: Record<string, Evidence>;
  recent: string[];
  serial: number;
  /** Clean or not, for the questions at this level since arriving. */
  outcomes: boolean[];
}

/** Pre-revision saves stored a `band` 0..5 on a different scale. */
const FROM_BAND = [0, 2, 4, 3, 6, 7];

export class Curriculum {
  data: CurriculumData;

  constructor(saved: Partial<CurriculumData> & { band?: number } | null = null, legacy = 0) {
    let level: number;
    if (saved && saved.v === 2 && Number.isFinite(saved.level)) level = saved.level!;
    else if (saved && Number.isFinite(saved.band)) level = FROM_BAND[Math.max(0, Math.min(5, Math.trunc(saved.band!)))];
    else level = legacy >= 0.65 ? 3 : legacy >= 0.35 ? 2 : legacy >= 0.12 ? 1 : 0;
    level = Math.max(0, Math.min(TOP, Math.trunc(level)));
    const v2 = saved?.v === 2;
    this.data = {
      v: 2,
      level,
      placement: v2 && Number.isFinite(saved!.placement) ? saved!.placement! : level,
      year: v2 ? saved!.year : undefined,
      counting: saved?.counting ?? 0,
      skills: v2 ? saved!.skills ?? {} : {},
      recent: v2 ? saved!.recent ?? [] : [],
      serial: saved?.serial ?? 0,
      outcomes: v2 ? saved!.outcomes ?? [] : [],
    };
  }

  get level(): Level {
    return LEVELS[this.data.level];
  }

  /** A grown-up's choice of school year: the starting level, and the floor under it. */
  setYear(i: number) {
    const y = YEARS[Math.max(0, Math.min(YEARS.length - 1, Math.trunc(i)))];
    this.data.year = YEARS.indexOf(y);
    this.setLevel(y[1]);
    this.data.placement = y[1];
  }

  setLevel(l: number) {
    this.data.level = Math.max(0, Math.min(TOP, Math.trunc(l)));
    this.data.outcomes = [];
    if (this.data.level === 0) this.data.counting = 0;
  }

  /** A counting answer (level 0): three clean ones and the relationships begin. */
  counted(clean: boolean) {
    if (clean && ++this.data.counting >= 3 && this.data.level === 0) this.setLevel(1);
  }

  private evidence(level: number, skill: Skill): Evidence | undefined {
    return this.data.skills[`${level}:${skill}`];
  }

  /**
   * The next question. `phase` is the stretch's: a warm-up asks what is most
   * secure, a reach what is least, relief reviews the level before. `due` is a
   * fact the memory wants back (asked if a skill here can carry it).
   */
  next(rand: () => number, opts: { phase?: string; due?: { a: number; b: number; mult: boolean } | null } = {}): Challenge {
    const d = this.data;
    const here = Math.max(1, d.level);
    const review = here > 1 && (opts.phase === 'relief' || d.serial % 6 === 5);
    const level = review ? here - 1 : here;
    const pool = LEVELS[level].skills;
    const previous = d.recent[d.recent.length - 1]?.split('|')[0];
    const ranked = pool
      .map((skill, i) => {
        const e = this.evidence(level, skill);
        // unseen first, in teaching order (a level lists its skills in the order they build),
        // then due, then least secure — or, warming up, most secure
        let score = !e ? 100 - i * 5 : e.next <= d.serial ? 30 - e.streak : 10 - e.streak;
        if (opts.phase === 'warm' && e) score = 20 + e.streak;
        if (skill === previous) score -= 12;
        return { skill, score: score + rand() * 0.5 };
      })
      .sort((x, y) => y.score - x.score);
    let skill = ranked[0].skill;
    let fact: { a: number; b: number } | undefined;
    if (opts.due && !review) {
      const fit = ranked.find((s) => MULT.includes(s.skill) === opts.due!.mult && (s.skill === 'bond' || s.skill === 'groups' || s.skill === 'factor'));
      if (fit) {
        skill = fit.skill;
        fact = { a: opts.due.a, b: opts.due.b };
      }
    }
    const e = this.evidence(level, skill);
    const clean = e?.clean ?? 0;
    const form = clean < 2 ? 0 : clean < 5 ? 1 : 2;
    const reach = Math.min(1, clean / 6);
    let c: Challenge;
    let tries = 0;
    do c = makeChallenge(level, skill, rand, form, reach, tries ? undefined : fact);
    while (d.recent.includes(c.skill + '|' + equation(c)) && ++tries < 16);
    // the picture under the equation: full while the skill is new, gone once it is known
    const small = c.mode === 'groups' ? c.total <= 36 : c.total <= 20;
    c.support = small ? Math.max(0, 1 - clean / 5) : 0;
    d.recent = [...d.recent, c.skill + '|' + equation(c)].slice(-12);
    return c;
  }

  /**
   * An answer. `clean`: first time, no help. `day`: the calendar day (a level is
   * only left behind on evidence from more than one day). Returns what changed.
   */
  record(c: Challenge, clean: boolean, day: string): 'up' | 'down' | null {
    const d = this.data;
    d.serial++;
    const key = `${c.level}:${c.skill}`;
    const e = d.skills[key] ?? { seen: 0, clean: 0, streak: 0, last: 0, next: 0, days: [] };
    e.seen++;
    if (clean) {
      e.clean++;
      if (!e.days.includes(day)) e.days = [...e.days, day].slice(-5);
    }
    e.streak = clean ? e.streak + 1 : 0;
    e.last = d.serial;
    e.next = d.serial + (clean ? Math.min(12, 2 ** Math.min(3, e.streak)) : 1);
    d.skills[key] = e;
    if (c.level !== d.level) return null; // a review question does not move the level
    d.outcomes = [...d.outcomes, clean].slice(-8);
    // up: every skill here answered cleanly three times running, on more than one day
    const ready = LEVELS[d.level].skills.every((s) => {
      const x = this.evidence(d.level, s);
      return !!x && x.streak >= 3 && x.days.length >= 2;
    });
    if (ready && d.level < TOP) {
      this.setLevel(d.level + 1);
      return 'up';
    }
    // down: this level is not holding yet (six or more tries, two or fewer clean)
    const floor = Math.max(0, d.placement - 1);
    if (d.outcomes.length >= 6 && d.outcomes.filter(Boolean).length <= 2 && d.level > Math.max(1, floor)) {
      this.setLevel(d.level - 1);
      return 'down';
    }
    return null;
  }
}

// ─── the dew a question needs ────────────────────────────────────────────────

/**
 * One collection of leaves (indices) whose drops make `amount`, or null.
 * Dynamic programming over reachable sums: O(leaves × amount).
 */
export function padWitness(counts: readonly number[], amount: number): number[] | null {
  if (!Number.isInteger(amount) || amount < 0 || amount > 20) return null;
  const paths = new Map<number, number[]>([[0, []]]);
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i];
    if (n <= 0 || !Number.isInteger(n)) continue;
    for (const [sum, p] of [...paths]) {
      const s = sum + n;
      if (s <= amount && !paths.has(s)) paths.set(s, [...p, i]);
    }
  }
  return paths.get(amount) ?? null;
}

/**
 * Can this question be finished from the leaves on offer, given what is already
 * gathered? For `sum`: the rest of the drops. For `groups`: enough more leaves of
 * the gathered size (or, if nothing is gathered, of any size that works).
 */
export function completable(c: Challenge, g: Gathered, counts: readonly number[]): boolean {
  if (c.mode === 'sum') {
    const rest = c.answers[0] - (g[0] ?? 0);
    return rest === 0 || (rest > 0 && !!padWitness(counts, rest));
  }
  const [leaves = 0, per = 0] = g;
  const options: Array<[number, number]> = [];
  if (c.skill === 'pairs') {
    for (let s = 2; s <= 12; s++) if (c.total % s === 0 && c.total / s >= 2) options.push([c.total / s, s]);
  } else options.push([c.a, c.b], [c.b, c.a]);
  return options.some(([count, size]) => {
    if (leaves && size !== per) return false;
    const need = count - leaves;
    return need >= 0 && counts.filter((n) => n === size).length >= need;
  });
}
