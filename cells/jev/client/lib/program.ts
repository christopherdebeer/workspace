/* ---------------------------------------------------------------------------
 * program — free text → a working, iterable program, with Jev as the only
 * "model" in the loop (pure; no DOM, no network — `decide` is injected).
 *
 * A program here is typed data (AppSpec) plus a pure reducer (apply) over typed
 * state. Jev never writes code or markup; at every step CODE enumerates only
 * type-valid candidates from what exists so far, and JEV picks among them in
 * parallel (nouls / ≤255-way choices). The program is therefore well-typed by
 * construction, at synthesis, at runtime and across edits:
 *
 *   synthesize   request → spec, two parallel passes: (A) which item noun, which
 *                typed fields from a library, which global scalars, title, mood;
 *                (B) only for what A chose: category options, ranges, goals,
 *                and which stats/actions — candidates GENERATED from the types
 *                (a sum needs a numeric field, "clear done" needs a bool …)
 *   command      a sentence → one typed Op, one call: op kind, target item (a
 *                choice over the LIVE items), scalar, enum values, all
 *                superposed; code validates before the reducer applies it
 *   edit         a sentence → one typed spec Edit, one call, same pattern;
 *                existing state migrates (unknown fields are simply ignored)
 *   smart add    new items get their enum fields (category, priority…)
 *                classified by Jev in the same call that parsed the command
 * ------------------------------------------------------------------------- */
import { choiceOf, type Answers, type Questions } from './types';

export type Decide = (state: unknown, questions: Questions, label: string) => Promise<Answers>;

/* ── the model ─────────────────────────────────────────────────────────── */

export type FieldType = 'text' | 'number' | 'money' | 'minutes' | 'bool' | 'enum' | 'date' | 'rating';
export interface FieldDef {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** Jev classifies it when an item is added (enum fields only). */
  smart?: boolean;
  unit?: string;
}
export type ScalarKind = 'counter' | 'timer' | 'budget';
export interface ScalarDef {
  id: string;
  label: string;
  kind: ScalarKind;
  /** counter goal / budget amount / timer minutes. */
  target: number;
}
export type StatOp = 'count' | 'countTrue' | 'sum' | 'avg' | 'remaining' | 'progress';
export interface StatDef {
  id: string;
  label: string;
  op: StatOp;
  field?: string;
  scalar?: string;
}
export type GlobalAction = 'clearDone' | 'sortBy' | 'markAllDone';
export interface ActionDef {
  id: string;
  label: string;
  op: GlobalAction;
  field?: string;
}
export interface AppSpec {
  title: string;
  mood: string;
  /** singular item noun; empty = no collection. */
  noun: string;
  fields: FieldDef[];
  scalars: ScalarDef[];
  stats: StatDef[];
  actions: ActionDef[];
}

export interface Item {
  id: string;
  name: string;
  [field: string]: string | number | boolean | undefined;
}
export interface AppState {
  items: Item[];
  scalars: Record<string, number>;
  timers: Record<string, { remaining: number; running: boolean; cycles: number }>;
}

/* ── libraries (the closed vocabulary Jev chooses from) ────────────────── */

export const FIELD_LIB: Array<FieldDef & { desc: string }> = [
  { id: 'done', label: 'Done', type: 'bool', desc: 'a checkbox marking the item done/complete' },
  { id: 'priority', label: 'Priority', type: 'enum', options: ['low', 'medium', 'high'], smart: true, desc: 'a priority level' },
  { id: 'category', label: 'Category', type: 'enum', smart: true, desc: 'a category or type the item belongs to' },
  { id: 'status', label: 'Status', type: 'enum', options: ['todo', 'doing', 'done'], desc: 'a workflow status (todo / doing / done)' },
  { id: 'due', label: 'Due', type: 'date', desc: 'a due or scheduled date' },
  { id: 'amount', label: 'Amount', type: 'money', desc: 'an amount of money (price, cost, spend)' },
  { id: 'quantity', label: 'Quantity', type: 'number', desc: 'a count or quantity of something' },
  { id: 'duration', label: 'Minutes', type: 'minutes', desc: 'a duration in minutes' },
  { id: 'rating', label: 'Rating', type: 'rating', desc: 'a 1–5 star rating' },
  { id: 'calories', label: 'Calories', type: 'number', unit: 'kcal', desc: 'calories' },
  { id: 'distance', label: 'Distance', type: 'number', unit: 'km', desc: 'a distance in kilometres' },
  { id: 'who', label: 'Who', type: 'text', desc: 'a person responsible or involved' },
  { id: 'notes', label: 'Notes', type: 'text', desc: 'free-text notes' },
];

export const SCALAR_LIB: Array<{ kind: ScalarKind; desc: string }> = [
  { kind: 'timer', desc: 'a countdown timer (e.g. focus sessions, cooking, workouts)' },
  { kind: 'counter', desc: 'a running tally counted up and down toward a daily goal (e.g. glasses of water, reps)' },
  { kind: 'budget', desc: 'a spending budget that item amounts are subtracted from' },
];

export const NOUNS = 'task item expense entry meal workout book habit contact note song movie recipe ingredient guest order shift session drink run chore idea bill purchase project'.split(' ');

export const CATEGORY_BANK = (
  'food groceries transport rent bills health fun shopping travel work home personal errands family friends fitness learning ' +
  'urgent someday breakfast lunch dinner snack cardio strength stretching fiction nonfiction reading music chores finance admin'
).split(' ');

export const MOODS: Record<string, string> = {
  calm: 'calm, quiet, focused',
  playful: 'playful, bright, casual',
  serious: 'serious, precise, professional',
  urgent: 'urgent, alerting, high-contrast',
};

export const RANGE = ['1', '2', '3', '5', '8', '10', '12', '15', '20', '25', '30', '40', '45', '50', '60', '90', '100', '120', '150', '200', '250', '300', '500', '1000', '2000', '5000'];

const STOP = new Set(
  'a an the and or but of to in on at by for with from as is are be it this that i me my we our you your want need make build create give show app interface ui page tool please something some let can could would should just like track keep list manage simple little'.split(' '),
);
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Prompt n-grams (content only), longest first — the request's own words as candidates. */
export function phrases(text: string, cap = 60): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = 3; n >= 1; n--)
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n);
      if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue;
      const p = g.join(' ');
      if (!out.includes(p) && out.length < cap) out.push(p);
    }
  return out;
}

const singular = (w: string) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('ses') ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/* ── synthesis ─────────────────────────────────────────────────────────── */

/**
 * The app's overall shape, decided JOINTLY (eval: independent "needs a list?" /
 * "needs a counter?" nouls over-include — a water tally grew a list of
 * glasses). The shape is authoritative for structure; field nouls refine it.
 */
export const SHAPES: Record<string, { desc: string; list: boolean; scalars: ScalarKind[] }> = {
  list: { desc: 'a list of things the user adds and manages', list: true, scalars: [] },
  counter: { desc: 'a single running tally counted up toward a goal (no list)', list: false, scalars: ['counter'] },
  timer: { desc: 'a single timer (no list)', list: false, scalars: ['timer'] },
  'list+timer': { desc: 'a list of things plus a timer', list: true, scalars: ['timer'] },
  'list+budget': { desc: 'a list of expenses or costs against a budget', list: true, scalars: ['budget'] },
  'list+counter': { desc: 'a list of things plus a separate running tally', list: true, scalars: ['counter'] },
};

export function stageA(request: string): Questions {
  const own = phrases(request).filter((p) => !p.includes(' ')).map(singular);
  const nouns = [...new Set([...own, ...NOUNS])].slice(0, 200);
  const titles = [...new Set([...phrases(request).map(title), 'Tracker', 'Planner', 'Log', 'Timer', 'List'])].slice(0, 200);
  const qs: Questions = {
    shape: { type: 'choice', instructions: 'What is the overall shape of this app?', criteria: Object.fromEntries(Object.entries(SHAPES).map(([k, v]) => [k, v.desc])) },
    noun: choiceOf('If it keeps a list, what is ONE item in that list called (singular noun)?', nouns),
    title: choiceOf('Which phrase is the best short title for this app?', titles),
    mood: { type: 'choice', instructions: 'Which visual mood suits it?', criteria: { ...MOODS } },
  };
  for (const f of FIELD_LIB) qs[`f:${f.id}`] = { type: 'noul', instructions: `Would each item in this app need ${f.desc}? Only if clearly useful for this request.` };
  return qs;
}

export interface Draft {
  title: string;
  mood: string;
  noun: string;
  fields: FieldDef[];
  scalars: ScalarKind[];
}

const yes = (a: Answers, k: string, th = 0.5) => (a[k]?.noul ?? 0) >= th;

export function draftFrom(a: Answers): Draft {
  const shape = SHAPES[a.shape?.choice ?? 'list'] ?? SHAPES.list;
  const list = shape.list;
  const fields = list ? FIELD_LIB.filter((f) => yes(a, `f:${f.id}`)).map(({ desc: _d, ...f }) => ({ ...f })) : [];
  // Exclusive pairs: status subsumes done.
  const hasStatus = fields.some((f) => f.id === 'status');
  return {
    title: a.title?.choice ?? 'Untitled',
    mood: a.mood?.choice ?? 'calm',
    noun: list ? a.noun?.choice ?? 'item' : '',
    fields: hasStatus ? fields.filter((f) => f.id !== 'done') : fields,
    scalars: [...shape.scalars],
  };
}

/** Stats and actions that the draft's TYPES make possible — the only ones Jev may pick. */
export function possibleStats(d: Draft): StatDef[] {
  const out: StatDef[] = [];
  if (d.noun) out.push({ id: 'count', label: `${title(d.noun)}s`, op: 'count' });
  for (const f of d.fields) {
    if (f.type === 'bool') out.push({ id: `true:${f.id}`, label: f.label, op: 'countTrue', field: f.id });
    if (f.type === 'money' || f.type === 'number' || f.type === 'minutes') out.push({ id: `sum:${f.id}`, label: `Total ${f.label.toLowerCase()}`, op: 'sum', field: f.id });
    if (f.type === 'rating' || f.type === 'number' || f.type === 'money' || f.type === 'minutes') out.push({ id: `avg:${f.id}`, label: `Average ${f.label.toLowerCase()}`, op: 'avg', field: f.id });
  }
  if (d.fields.some((f) => f.type === 'bool')) out.push({ id: 'progress:done', label: 'Completion', op: 'progress', field: d.fields.find((f) => f.type === 'bool')!.id });
  for (const s of d.scalars) {
    if (s === 'budget' && d.fields.some((f) => f.type === 'money')) out.push({ id: 'remaining', label: 'Left in budget', op: 'remaining', scalar: 'budget', field: d.fields.find((f) => f.type === 'money')!.id });
    if (s === 'counter') out.push({ id: 'progress:counter', label: 'Toward goal', op: 'progress', scalar: 'counter' });
  }
  return out;
}

export function possibleActions(d: Draft): ActionDef[] {
  const out: ActionDef[] = [];
  const bool = d.fields.find((f) => f.type === 'bool');
  if (bool) {
    out.push({ id: 'clearDone', label: `Clear ${bool.label.toLowerCase()}`, op: 'clearDone', field: bool.id });
    out.push({ id: 'markAllDone', label: 'Mark all done', op: 'markAllDone', field: bool.id });
  }
  for (const f of d.fields) if (['enum', 'number', 'money', 'minutes', 'rating', 'date'].includes(f.type)) out.push({ id: `sort:${f.id}`, label: `Sort by ${f.label.toLowerCase()}`, op: 'sortBy', field: f.id });
  return out;
}

export function stageB(request: string, d: Draft): Questions {
  const qs: Questions = {};
  const cat = d.fields.find((f) => f.id === 'category');
  if (cat) {
    for (const [i, opt] of [...new Set([...phrases(request).filter((p) => !p.includes(' ')), ...CATEGORY_BANK])].slice(0, 48).entries()) {
      qs[`cat${i}`] = { type: 'noul', instructions: `Is "${opt}" a good category for items in this app?` };
      (qs[`cat${i}`] as { meta?: string }).meta = opt; // stripped before sending (see clean)
    }
  }
  for (const s of d.scalars) {
    const what = s === 'timer' ? 'How many minutes should the timer run?' : s === 'counter' ? 'What is a sensible daily goal for the counter?' : 'What is a sensible budget amount?';
    qs[`t:${s}`] = choiceOf(what, RANGE);
    qs[`l:${s}`] = choiceOf(`Which phrase best labels the ${s}?`, [...new Set([...phrases(request).map(title), title(s)])].slice(0, 200));
  }
  possibleStats(d).forEach((st) => (qs[`st:${st.id}`] = { type: 'noul', instructions: `Should the app show "${st.label}" as a summary number? Only if genuinely useful.` }));
  possibleActions(d).forEach((ac) => (qs[`ac:${ac.id}`] = { type: 'noul', instructions: `Should the app have a "${ac.label}" button? Only if genuinely useful.` }));
  return qs;
}

/** Strip client-only annotations before a question set goes on the wire. */
export function clean(qs: Questions): { questions: Questions; meta: Record<string, string> } {
  const meta: Record<string, string> = {};
  const questions: Questions = {};
  for (const [k, q] of Object.entries(qs)) {
    const { meta: m, ...rest } = q as typeof q & { meta?: string };
    if (m) meta[k] = m;
    questions[k] = rest as typeof q;
  }
  return { questions, meta };
}

export function specFrom(d: Draft, b: Answers, meta: Record<string, string>): AppSpec {
  const fields = d.fields.map((f) => {
    if (f.id !== 'category') return f;
    const opts = Object.entries(meta)
      .filter(([k]) => k.startsWith('cat'))
      .map(([k, opt]) => ({ opt, p: b[k]?.noul ?? 0 }))
      .filter((x) => x.p >= 0.5)
      .sort((x, y) => y.p - x.p)
      .slice(0, 6)
      .map((x) => x.opt);
    return { ...f, options: opts.length >= 2 ? opts : ['general', 'other'] };
  });
  const num = (k: string, dflt: number) => {
    const n = Number(b[k]?.choice);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const scalars: ScalarDef[] = d.scalars.map((s) => ({
    id: s,
    kind: s,
    label: b[`l:${s}`]?.choice ?? title(s),
    target: num(`t:${s}`, s === 'timer' ? 25 : s === 'counter' ? 8 : 500),
  }));
  const draft = { ...d, fields };
  return {
    title: d.title,
    mood: d.mood,
    noun: d.noun,
    fields,
    scalars,
    stats: possibleStats(draft).filter((st) => (b[`st:${st.id}`]?.noul ?? 0) >= 0.5),
    actions: possibleActions(draft).filter((ac) => (b[`ac:${ac.id}`]?.noul ?? 0) >= 0.5),
  };
}

export async function synthesize(request: string, decide: Decide): Promise<AppSpec> {
  const a = await decide({ request }, stageA(request), 'program:A');
  const d = draftFrom(a);
  const { questions, meta } = clean(stageB(request, d));
  const b = Object.keys(questions).length ? await decide({ request, noun: d.noun, fields: d.fields.map((f) => f.label), scalars: d.scalars }, questions, 'program:B') : {};
  return validate(specFrom(d, b, meta));
}

/** Drop anything that no longer type-checks against the spec (after edits too). */
export function validate(s: AppSpec): AppSpec {
  const fid = new Set(s.fields.map((f) => f.id));
  const sid = new Set(s.scalars.map((x) => x.id));
  return {
    ...s,
    stats: s.stats.filter((st) => (!st.field || fid.has(st.field)) && (!st.scalar || sid.has(st.scalar)) && (st.op !== 'count' || !!s.noun)),
    actions: s.actions.filter((ac) => !ac.field || fid.has(ac.field)),
  };
}

/* ── runtime: the pure reducer ─────────────────────────────────────────── */

export type Op =
  | { op: 'add'; name: string; values: Record<string, string | number | boolean> }
  | { op: 'remove'; id: string }
  | { op: 'set'; id: string; field: string; value: string | number | boolean }
  | { op: 'toggle'; id: string; field: string }
  | { op: 'inc'; scalar: string; by: number }
  | { op: 'resetScalar'; scalar: string }
  | { op: 'timer'; scalar: string; action: 'start' | 'pause' | 'reset' | 'tick' }
  | { op: 'clearDone'; field: string }
  | { op: 'markAllDone'; field: string }
  | { op: 'sortBy'; field: string };

export function initialState(spec: AppSpec): AppState {
  return {
    items: [],
    scalars: Object.fromEntries(spec.scalars.filter((s) => s.kind === 'counter').map((s) => [s.id, 0])),
    timers: Object.fromEntries(spec.scalars.filter((s) => s.kind === 'timer').map((s) => [s.id, { remaining: s.target * 60, running: false, cycles: 0 }])),
  };
}

let uid = 0;
const newId = () => `i${Date.now().toString(36)}${(uid++).toString(36)}`;

export function defaultFor(f: FieldDef): string | number | boolean {
  switch (f.type) {
    case 'bool':
      return false;
    case 'enum':
      return f.options?.[0] ?? '';
    case 'number':
    case 'money':
    case 'minutes':
      return 0;
    case 'rating':
      return 3;
    default:
      return '';
  }
}

/** Coerce a value to a field's type; null if it cannot be. The runtime's type gate. */
export function coerce(f: FieldDef, v: unknown): string | number | boolean | null {
  switch (f.type) {
    case 'bool':
      return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;
    case 'enum':
      return typeof v === 'string' && f.options?.includes(v) ? v : null;
    case 'number':
    case 'money':
    case 'minutes': {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'rating': {
      const n = Math.round(Number(v));
      return n >= 1 && n <= 5 ? n : null;
    }
    default:
      return typeof v === 'string' ? v : v === undefined ? null : String(v);
  }
}

export function apply(spec: AppSpec, s: AppState, o: Op): AppState {
  const field = (id: string) => spec.fields.find((f) => f.id === id);
  switch (o.op) {
    case 'add': {
      if (!spec.noun || !o.name.trim()) return s;
      const item: Item = { id: newId(), name: o.name.trim() };
      for (const f of spec.fields) {
        const v = o.values[f.id] !== undefined ? coerce(f, o.values[f.id]) : null;
        item[f.id] = v ?? defaultFor(f);
      }
      return { ...s, items: [...s.items, item] };
    }
    case 'remove':
      return { ...s, items: s.items.filter((i) => i.id !== o.id) };
    case 'set': {
      const f = field(o.field);
      const v = f ? coerce(f, o.value) : o.field === 'name' && typeof o.value === 'string' ? o.value : null;
      if (v === null) return s;
      return { ...s, items: s.items.map((i) => (i.id === o.id ? { ...i, [o.field]: v } : i)) };
    }
    case 'toggle':
      if (field(o.field)?.type !== 'bool') return s;
      return { ...s, items: s.items.map((i) => (i.id === o.id ? { ...i, [o.field]: !i[o.field] } : i)) };
    case 'inc':
      if (!(o.scalar in s.scalars)) return s;
      return { ...s, scalars: { ...s.scalars, [o.scalar]: Math.max(0, (s.scalars[o.scalar] ?? 0) + o.by) } };
    case 'resetScalar':
      if (o.scalar in s.timers) return apply(spec, s, { op: 'timer', scalar: o.scalar, action: 'reset' });
      return o.scalar in s.scalars ? { ...s, scalars: { ...s.scalars, [o.scalar]: 0 } } : s;
    case 'timer': {
      const t = s.timers[o.scalar];
      const def = spec.scalars.find((x) => x.id === o.scalar);
      if (!t || !def) return s;
      const full = def.target * 60;
      const next =
        o.action === 'start'
          ? { ...t, running: !t.running || t.remaining === 0, remaining: t.remaining === 0 ? full : t.remaining }
          : o.action === 'pause'
            ? { ...t, running: false }
            : o.action === 'reset'
              ? { ...t, running: false, remaining: full }
              : t.running
                ? t.remaining <= 1
                  ? { ...t, running: false, remaining: 0, cycles: t.cycles + 1 }
                  : { ...t, remaining: t.remaining - 1 }
                : t;
      return { ...s, timers: { ...s.timers, [o.scalar]: next } };
    }
    case 'clearDone':
      return { ...s, items: s.items.filter((i) => !i[o.field]) };
    case 'markAllDone':
      return field(o.field)?.type === 'bool' ? { ...s, items: s.items.map((i) => ({ ...i, [o.field]: true })) } : s;
    case 'sortBy': {
      const f = field(o.field);
      if (!f) return s;
      const key = (i: Item) => (f.type === 'enum' ? f.options?.indexOf(String(i[f.id])) ?? 0 : Number(i[f.id]) || String(i[f.id] ?? ''));
      return { ...s, items: [...s.items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)) };
    }
  }
}

export function statValue(spec: AppSpec, s: AppState, st: StatDef): { value: number; of?: number } {
  const nums = (f: string) => s.items.map((i) => Number(i[f]) || 0);
  switch (st.op) {
    case 'count':
      return { value: s.items.length };
    case 'countTrue':
      return { value: s.items.filter((i) => i[st.field!]).length, of: s.items.length };
    case 'sum':
      return { value: nums(st.field!).reduce((a, b) => a + b, 0) };
    case 'avg': {
      const xs = nums(st.field!);
      return { value: xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0 };
    }
    case 'remaining': {
      const budget = spec.scalars.find((x) => x.id === st.scalar)?.target ?? 0;
      return { value: budget - nums(st.field!).reduce((a, b) => a + b, 0), of: budget };
    }
    case 'progress':
      if (st.scalar) return { value: s.scalars[st.scalar] ?? 0, of: spec.scalars.find((x) => x.id === st.scalar)?.target ?? 0 };
      return { value: s.items.filter((i) => i[st.field!]).length, of: s.items.length };
  }
}

/* ── command: a sentence → one typed Op ────────────────────────────────── */

export const COMMANDS: Record<string, string> = {
  add: 'add a new item',
  complete: 'mark an existing item done / complete (or not done)',
  remove: 'delete an existing item',
  set: 'change a property of an existing item (category, priority, status…)',
  inc: 'increase the counter',
  dec: 'decrease the counter',
  reset: 'reset the counter or timer',
  start: 'start or resume the timer',
  pause: 'pause the timer',
  clear: 'clear finished items',
  sort: 'sort the list',
  none: 'none of these',
};

/**
 * What "done" means in this spec: a bool field, else an enum whose options end
 * in a terminal state (status: todo/doing/done → "done").
 */
export function completion(spec: AppSpec): { field: FieldDef; value: string | boolean } | null {
  const bool = spec.fields.find((f) => f.type === 'bool');
  if (bool) return { field: bool, value: true };
  const terminal = /^(done|complete|completed|finished|closed|resolved|paid)$/i;
  const en = spec.fields.find((f) => f.type === 'enum' && f.options?.some((o) => terminal.test(o)));
  return en ? { field: en, value: en.options!.find((o) => terminal.test(o))! } : null;
}

/** Numbers written in the text, in order (the only way numbers enter the state — parsed by code, not guessed). */
export const numbersIn = (text: string): number[] => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

export function commandQuestions(spec: AppSpec, s: AppState): Questions {
  const qs: Questions = {
    op: { type: 'choice', instructions: 'What does the user want to do with this command?', criteria: { ...COMMANDS } },
  };
  if (s.items.length) qs.item = choiceOf('Which existing item does the command refer to?', [...s.items.slice(-250).map((i) => `${i.id}: ${i.name}`), '(new or none)']);
  for (const f of spec.fields) {
    if (f.type === 'enum') qs[`e:${f.id}`] = choiceOf(`Which ${f.label.toLowerCase()} fits the item the command is about?`, f.options ?? []);
    if (f.type === 'bool') qs[`b:${f.id}`] = { type: 'noul', instructions: `Should "${f.label}" be set to true (checked) for the item the command is about?` };
  }
  if (spec.fields.some((f) => ['money', 'number', 'minutes', 'rating'].includes(f.type)) && spec.noun)
    qs.numfield = choiceOf('If the command contains a number, which property is it?', [...spec.fields.filter((f) => ['money', 'number', 'minutes', 'rating'].includes(f.type)).map((f) => f.id), '(count or none)']);
  const sortable = spec.fields.filter((f) => ['enum', 'number', 'money', 'minutes', 'rating', 'date'].includes(f.type));
  if (sortable.length) qs.sortBy = choiceOf('If sorting, by which property?', sortable.map((f) => f.id));
  return qs;
}

/** The item's display name from an "add …" sentence: code strips verbs and numbers. */
export function nameFrom(text: string, noun: string): string {
  return text
    .replace(/^\s*(please\s+)?(add|new|create|log|record|put|track)\s+(an?\s+|the\s+)?/i, '')
    .replace(new RegExp(`^${noun}s?\\s*[:\\-]?\\s*`, 'i'), '')
    .replace(/\s*(for|at|costing|of)?\s*[$£€]?\s*-?\d+(?:\.\d+)?\s*(k?cal|km|min(ute)?s?|dollars?|pounds?|euros?)?/gi, ' ')
    .replace(/\s+(to|on|in)\s+(the\s+)?(list|tasks?|todo)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Planned {
  op: Op | null;
  why: string;
  p: number;
}

/** The command kinds this spec + state can actually execute — the type mask. */
export function validCommands(spec: AppSpec, s: AppState): Set<string> {
  const v = new Set<string>(['none']);
  const has = s.items.length > 0;
  if (spec.noun) v.add('add');
  if (has && completion(spec)) v.add('complete');
  if (has) v.add('remove');
  if (has && spec.fields.some((f) => ['enum', 'number', 'money', 'minutes', 'rating', 'text', 'date'].includes(f.type))) v.add('set');
  if (spec.scalars.some((x) => x.kind === 'counter')) ['inc', 'dec', 'reset'].forEach((k) => v.add(k));
  if (spec.scalars.some((x) => x.kind === 'timer')) ['start', 'pause', 'reset'].forEach((k) => v.add(k));
  if (has && spec.fields.some((f) => f.type === 'bool')) v.add('clear');
  if (has && spec.fields.some((f) => ['enum', 'number', 'money', 'minutes', 'rating', 'date'].includes(f.type))) v.add('sort');
  return v;
}

/**
 * Type-masked decoding: the argmax of Jev's op distribution RESTRICTED to the
 * ops this app can execute. "add 2 glasses" in a counter app: add is masked
 * (no list), inc wins. The model proposes; the types dispose.
 */
export function maskedChoice(a: Answers['x'], allowed: Set<string>): { choice: string; p: number } {
  const probs = Object.entries(a?.probabilities ?? (a?.choice ? { [a.choice]: a.confidence ?? 1 } : {})).filter(([k]) => allowed.has(k));
  const mass = probs.reduce((t, [, p]) => t + p, 0) || 1;
  const [choice, p] = probs.sort((x, y) => y[1] - x[1])[0] ?? ['none', 0];
  return { choice, p: p / mass };
}

/** Turn one call's answers into a validated Op (or null with a reason). */
export function planCommand(spec: AppSpec, s: AppState, text: string, a: Answers): Planned {
  const { choice: kind, p } = maskedChoice(a.op, validCommands(spec, s));
  const itemId = a.item?.choice?.split(':')[0];
  const item = s.items.find((i) => i.id === itemId);
  const nums = numbersIn(text);
  const counter = spec.scalars.find((x) => x.kind === 'counter');
  const timer = spec.scalars.find((x) => x.kind === 'timer');
  const bool = spec.fields.find((f) => f.type === 'bool');
  const need = (cond: unknown, why: string): Planned | null => (cond ? null : { op: null, why, p });
  switch (kind) {
    case 'add': {
      const bad = need(spec.noun, 'this app has no list to add to');
      if (bad) return bad;
      const name = nameFrom(text, spec.noun);
      if (!name) return { op: null, why: 'no item name found', p };
      const values: Record<string, string | number | boolean> = {};
      for (const f of spec.fields) {
        if (f.type === 'enum' && f.smart && a[`e:${f.id}`]?.choice) values[f.id] = a[`e:${f.id}`]!.choice!;
      }
      const nf = a.numfield?.choice;
      if (nums.length && nf && spec.fields.some((f) => f.id === nf)) values[nf] = nums[0];
      return { op: { op: 'add', name, values }, why: `add “${name}”`, p };
    }
    case 'complete': {
      const c = completion(spec);
      const bad = need(item, 'which item?') ?? need(c, 'nothing marks items done');
      if (bad) return bad;
      const value = c!.field.type === 'bool' ? (a[`b:${c!.field.id}`]?.noul ?? 1) >= 0.5 : c!.value;
      return { op: { op: 'set', id: item!.id, field: c!.field.id, value }, why: `${item!.name} → ${c!.field.label} ${String(value)}`, p };
    }
    case 'remove':
      return need(item, 'which item?') ?? { op: { op: 'remove', id: item!.id }, why: `remove ${item!.name}`, p };
    case 'set': {
      const bad = need(item, 'which item?');
      if (bad) return bad;
      // The enum field whose chosen value differs most confidently from the item's current one.
      const cand = spec.fields
        .filter((f) => f.type === 'enum')
        .map((f) => ({ f, v: a[`e:${f.id}`]?.choice, conf: a[`e:${f.id}`]?.confidence ?? 0 }))
        .filter((x) => x.v && x.v !== item![x.f.id])
        .sort((x, y) => y.conf - x.conf)[0];
      if (cand) return { op: { op: 'set', id: item!.id, field: cand.f.id, value: cand.v! }, why: `${item!.name}: ${cand.f.label} → ${cand.v}`, p };
      const nf = a.numfield?.choice;
      if (nums.length && nf && spec.fields.some((f) => f.id === nf)) return { op: { op: 'set', id: item!.id, field: nf, value: nums[0] }, why: `${item!.name}: ${nf} → ${nums[0]}`, p };
      return { op: null, why: 'nothing to change', p };
    }
    case 'inc':
    case 'dec':
      return need(counter, 'no counter') ?? { op: { op: 'inc', scalar: counter!.id, by: (kind === 'dec' ? -1 : 1) * (nums[0] ?? 1) }, why: `${counter!.label} ${kind === 'dec' ? '−' : '+'}${nums[0] ?? 1}`, p };
    case 'reset': {
      const sc = timer && /timer|clock|pomodoro|countdown/i.test(text) ? timer : counter ?? timer;
      return need(sc, 'nothing to reset') ?? { op: { op: 'resetScalar', scalar: sc!.id }, why: `reset ${sc!.label}`, p };
    }
    case 'start':
    case 'pause':
      return need(timer, 'no timer') ?? { op: { op: 'timer', scalar: timer!.id, action: kind }, why: `${kind} ${timer!.label}`, p };
    case 'clear':
      return need(bool, 'nothing marks items done') ?? { op: { op: 'clearDone', field: bool!.id }, why: 'clear done', p };
    case 'sort': {
      const f = a.sortBy?.choice;
      return need(f, 'nothing to sort by') ?? { op: { op: 'sortBy', field: f! }, why: `sort by ${f}`, p };
    }
    default:
      return { op: null, why: 'not understood', p };
  }
}

/* ── edit: a sentence → one typed change to the program itself ─────────── */

export const EDITS: Record<string, string> = {
  addField: 'add a new property to every item',
  removeField: 'remove a property from items',
  addScalar: 'add a timer, counter or budget',
  removeScalar: 'remove a timer, counter or budget',
  setTarget: 'change a timer length, counter goal or budget amount',
  addStat: 'show a new summary number',
  addAction: 'add a button',
  retitle: 'rename the app',
  none: 'none of these',
};

export function editQuestions(spec: AppSpec, text: string): Questions {
  const have = new Set(spec.fields.map((f) => f.id));
  const draft: Draft = { title: spec.title, mood: spec.mood, noun: spec.noun || 'item', fields: spec.fields, scalars: spec.scalars.map((s) => s.kind) };
  const qs: Questions = { edit: { type: 'choice', instructions: 'What change to the app does the user ask for?', criteria: { ...EDITS } } };
  const addable = FIELD_LIB.filter((f) => !have.has(f.id));
  if (addable.length) qs.addField = { type: 'choice', instructions: 'If adding a property, which one?', criteria: Object.fromEntries(addable.map((f) => [f.id, f.desc])) };
  if (spec.fields.length) qs.removeField = choiceOf('If removing a property, which one?', spec.fields.map((f) => f.id));
  const scalarKinds = SCALAR_LIB.map((s) => s.kind);
  qs.scalar = choiceOf('Which timer / counter / budget is meant?', scalarKinds);
  qs.target = choiceOf('If a new length, goal or amount is given, what is it?', RANGE);
  const stats = possibleStats(draft).filter((st) => !spec.stats.some((x) => x.id === st.id));
  if (stats.length) qs.addStat = choiceOf('If adding a summary number, which one?', stats.map((st) => st.id));
  const acts = possibleActions(draft).filter((ac) => !spec.actions.some((x) => x.id === ac.id));
  if (acts.length) qs.addAction = choiceOf('If adding a button, which one?', acts.map((ac) => ac.id));
  qs.retitle = choiceOf('If renaming, what should the new title be?', [...new Set([...phrases(text).map(title), spec.title])].slice(0, 200));
  return qs;
}

export function applyEdit(spec: AppSpec, text: string, a: Answers): { spec: AppSpec; why: string } {
  const kind = a.edit?.choice ?? 'none';
  const nums = numbersIn(text);
  const draft: Draft = { title: spec.title, mood: spec.mood, noun: spec.noun || 'item', fields: spec.fields, scalars: spec.scalars.map((s) => s.kind) };
  switch (kind) {
    case 'addField': {
      const lib = FIELD_LIB.find((f) => f.id === a.addField?.choice);
      if (!lib) return { spec, why: 'no such property' };
      const { desc: _d, ...f } = lib;
      const field: FieldDef = f.id === 'category' ? { ...f, options: ['general', 'other'] } : { ...f };
      return { spec: validate({ ...spec, noun: spec.noun || 'item', fields: [...spec.fields, field] }), why: `added ${field.label}` };
    }
    case 'removeField': {
      const id = a.removeField?.choice;
      return { spec: validate({ ...spec, fields: spec.fields.filter((f) => f.id !== id) }), why: `removed ${id}` };
    }
    case 'addScalar': {
      const k = a.scalar?.choice as ScalarKind | undefined;
      if (!k || spec.scalars.some((s) => s.id === k)) return { spec, why: 'already there' };
      // Numbers enter the spec only when the user wrote them; otherwise the kind's default.
      const target = nums[0] ?? (k === 'timer' ? 25 : k === 'counter' ? 8 : 500);
      return { spec: validate({ ...spec, scalars: [...spec.scalars, { id: k, kind: k, label: title(k), target }] }), why: `added ${k}` };
    }
    case 'removeScalar': {
      const k = a.scalar?.choice;
      return { spec: validate({ ...spec, scalars: spec.scalars.filter((s) => s.id !== k) }), why: `removed ${k}` };
    }
    case 'setTarget': {
      const k = a.scalar?.choice;
      const target = nums[0] ?? Number(a.target?.choice);
      if (!spec.scalars.some((s) => s.id === k) || !Number.isFinite(target)) return { spec, why: 'nothing to change' };
      return { spec: { ...spec, scalars: spec.scalars.map((s) => (s.id === k ? { ...s, target } : s)) }, why: `${k} → ${target}` };
    }
    case 'addStat': {
      const st = possibleStats(draft).find((x) => x.id === a.addStat?.choice);
      return st ? { spec: validate({ ...spec, stats: [...spec.stats, st] }), why: `showing ${st.label}` } : { spec, why: 'no such summary' };
    }
    case 'addAction': {
      const ac = possibleActions(draft).find((x) => x.id === a.addAction?.choice);
      return ac ? { spec: validate({ ...spec, actions: [...spec.actions, ac] }), why: `added ${ac.label}` } : { spec, why: 'no such button' };
    }
    case 'retitle':
      return a.retitle?.choice ? { spec: { ...spec, title: a.retitle.choice }, why: `renamed to ${a.retitle.choice}` } : { spec, why: 'no title' };
    default:
      return { spec, why: 'not understood' };
  }
}

/** Keep state valid across an edit: new counters/timers appear, removed ones go. */
export function migrate(spec: AppSpec, s: AppState): AppState {
  const init = initialState(spec);
  return {
    items: s.items,
    scalars: Object.fromEntries(Object.keys(init.scalars).map((k) => [k, s.scalars[k] ?? 0])),
    timers: Object.fromEntries(Object.entries(init.timers).map(([k, t]) => [k, s.timers[k] && !(s.timers[k].remaining > (spec.scalars.find((x) => x.id === k)?.target ?? 0) * 60) ? s.timers[k] : t])),
  };
}

/* ── smart fields: classify a new item's enum fields in one call ────────── */

export function smartQuestions(spec: AppSpec): Questions {
  const qs: Questions = {};
  for (const f of spec.fields) if (f.type === 'enum' && f.smart && f.options?.length) qs[f.id] = choiceOf(`Which ${f.label.toLowerCase()} fits this ${spec.noun || 'item'}?`, f.options);
  return qs;
}
export function smartValues(spec: AppSpec, a: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) if (f.type === 'enum' && f.smart && a[f.id]?.choice && f.options?.includes(a[f.id]!.choice!)) out[f.id] = a[f.id]!.choice!;
  return out;
}
