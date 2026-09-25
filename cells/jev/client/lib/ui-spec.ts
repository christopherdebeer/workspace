/* ---------------------------------------------------------------------------
 * Interface 00a — free text → an interactive interface, by judgment only (pure).
 *
 * Jev never writes markup. It answers typed questions about a request, and
 * every answer indexes into a VOCABULARY we own:
 *
 *   stage 1 (one call)  how many of each component? which layout, which mood,
 *                       which title? — scores and choices over closed sets
 *   stage 2 (one call)  for every instance stage 1 asked for: its label, its
 *                       range, its options, what a button DOES — choices over
 *                       candidate phrases lifted from the request itself plus
 *                       a generic label vocabulary
 *   render              the spec is plain data; the React side makes it live
 *
 * The request's own words are the only "generation": n-grams of the prompt
 * become the option lists Jev chooses among.
 * ------------------------------------------------------------------------- */
import { choiceOf, type Answers, type Questions } from './types';

export type Kind =
  | 'heading'
  | 'text'
  | 'textInput'
  | 'numberInput'
  | 'slider'
  | 'toggle'
  | 'select'
  | 'checklist'
  | 'counter'
  | 'timer'
  | 'progress'
  | 'list'
  | 'button';

export const COMPONENTS: Record<Kind, string> = {
  heading: 'a section heading',
  text: 'a short explanatory line of text',
  textInput: 'a free-text input field (e.g. a name, a note, an email)',
  numberInput: 'a numeric input field',
  slider: 'a slider choosing a value within a range',
  toggle: 'an on/off switch',
  select: 'a dropdown choosing one of a few options',
  checklist: 'a set of checkboxes (tick any)',
  counter: 'a number that goes up and down with +/- controls',
  timer: 'a countdown or stopwatch',
  progress: 'a progress bar',
  list: 'a list that items get added to',
  button: 'a button that triggers an action',
};
const KIND_ORDER: Kind[] = ['heading', 'text', 'textInput', 'numberInput', 'select', 'slider', 'toggle', 'checklist', 'counter', 'timer', 'progress', 'list', 'button'];

export const LAYOUTS: Record<string, string> = {
  stack: 'one column, top to bottom',
  split: 'controls on one side, results on the other',
  card: 'a single compact card',
  steps: 'a sequence of steps, one at a time',
};
export const MOODS: Record<string, string> = {
  calm: 'calm, quiet, focused',
  playful: 'playful, bright, casual',
  serious: 'serious, precise, professional',
  urgent: 'urgent, alerting, high-contrast',
};
export const ACTIONS: Record<string, string> = {
  submit: 'submit / save what was entered and show a summary',
  reset: 'reset every control to its start',
  start: 'start (or pause) the timer',
  add: 'add the text that was entered to the list',
  increment: 'increase the counter',
  decrement: 'decrease the counter',
  clear: 'clear the list',
  none: 'no clear action',
};
const RANGE = ['0', '1', '5', '10', '12', '20', '24', '25', '30', '50', '60', '100', '120', '200', '500', '1000', '5000', '10000'];

/** Generic labels an interface commonly needs, whatever the request. */
export const LABELS = (
  'Save|Submit|Cancel|Reset|Start|Stop|Pause|Next|Back|Add|Remove|Clear|Done|Go|Send|Confirm|Search|' +
  'Name|Email|Phone|Date|Time|Amount|Quantity|Price|Total|Notes|Title|Description|Duration|Minutes|Hours|' +
  'Priority|Status|Category|Size|Colour|Volume|Speed|Level|Goal|Progress|Settings|Summary|Tasks|Items|' +
  'Low|Medium|High|Small|Large|Yes|No|On|Off|Today|Tomorrow|Morning|Evening|Weekly|Daily'
).split('|');

const STOP = new Set(
  'a an the and or but of to in on at by for with from as is are be it this that i me my we our you your want need make build create give show app interface ui page tool please something some let can could would should just like'.split(' '),
);
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Candidate phrases from the request itself: content words, bigrams, trigrams — then generic labels. Capped for a choice. */
export function candidates(request: string, cap = 250): string[] {
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  const push = (p: string) => {
    const t = title(p.trim());
    if (t && !out.includes(t) && out.length < cap) out.push(t);
  };
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (STOP.has(gram[0]) || STOP.has(gram[gram.length - 1])) continue;
      push(gram.join(' '));
    }
  }
  for (const l of LABELS) push(l);
  return out;
}

/* ── stage 1 ──────────────────────────────────────────────────────────── */

export const COUNT_LEVELS = ['0', '1', '2', '3'];

export function stage1Questions(cands: string[]): Questions {
  const qs: Questions = {
    layout: { type: 'choice', instructions: 'Which layout suits this interface best?', criteria: { ...LAYOUTS } },
    mood: { type: 'choice', instructions: 'Which visual mood suits it?', criteria: { ...MOODS } },
    title: choiceOf('Which phrase makes the best short title for this interface?', cands),
  };
  for (const k of KIND_ORDER) {
    qs[`n:${k}`] = {
      type: 'score',
      instructions: `A minimal, genuinely useful interface for this request: how many of this component does it need — ${COMPONENTS[k]}? Prefer fewer.`,
      criteria: COUNT_LEVELS,
    };
  }
  return qs;
}

export interface Slot {
  id: string;
  kind: Kind;
  index: number;
}

/** Instances stage 1 asked for, in a stable reading order, capped overall. */
export function slotsFrom(answers: Answers, cap = 12): Slot[] {
  const slots: Slot[] = [];
  for (const k of KIND_ORDER) {
    const a = answers[`n:${k}`];
    // A score's argmax level; fall back to the rounded weighted position.
    const level = a?.probabilities
      ? Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0]?.[0]
      : a?.score !== undefined
        ? COUNT_LEVELS[Math.round(a.score * (COUNT_LEVELS.length - 1))]
        : '0';
    const n = Number(level ?? '0') || 0;
    for (let i = 0; i < n && slots.length < cap; i++) slots.push({ id: `${k}${i}`, kind: k, index: i });
  }
  return slots;
}

/* ── stage 2 ──────────────────────────────────────────────────────────── */

const ordinal = (i: number) => ['first', 'second', 'third', 'fourth'][i] ?? `#${i + 1}`;

export function stage2Questions(slots: Slot[], cands: string[]): Questions {
  const qs: Questions = {};
  for (const s of slots) {
    const what = `the ${ordinal(s.index)} ${COMPONENTS[s.kind]}`;
    if (s.kind === 'text') {
      qs[`${s.id}:label`] = choiceOf(`Which phrase best fits as ${what}?`, cands);
      continue;
    }
    qs[`${s.id}:label`] = choiceOf(`Which phrase is the best label for ${what}?`, cands);
    if (s.kind === 'slider' || s.kind === 'numberInput' || s.kind === 'progress') {
      qs[`${s.id}:min`] = choiceOf(`What is the sensible MINIMUM value for ${what}?`, RANGE);
      qs[`${s.id}:max`] = choiceOf(`What is the sensible MAXIMUM value for ${what}?`, RANGE);
    }
    if (s.kind === 'timer') qs[`${s.id}:max`] = choiceOf(`How many minutes should ${what} run?`, RANGE);
    if (s.kind === 'select' || s.kind === 'checklist') {
      for (let o = 0; o < 4; o++) {
        qs[`${s.id}:opt${o}`] = choiceOf(`Option ${o + 1} of ${what} (a different one from the others)?`, cands);
      }
    }
    if (s.kind === 'button') qs[`${s.id}:action`] = { type: 'choice', instructions: `What should ${what} do?`, criteria: { ...ACTIONS } };
  }
  return qs;
}

/* ── the spec ─────────────────────────────────────────────────────────── */

export interface Widget {
  id: string;
  kind: Kind;
  label: string;
  /** Jev's confidence in the label choice — rendered, not hidden. */
  p: number;
  min?: number;
  max?: number;
  options?: string[];
  action?: string;
}
export interface UiSpec {
  title: string;
  layout: string;
  mood: string;
  widgets: Widget[];
}

export function assemble(s1: Answers, slots: Slot[], s2: Answers): UiSpec {
  const pick = (k: string, fallback: string) => s2[k]?.choice ?? fallback;
  const num = (k: string, fallback: number) => {
    const n = Number(s2[k]?.choice);
    return Number.isFinite(n) ? n : fallback;
  };
  const widgets: Widget[] = slots.map((s) => {
    const w: Widget = { id: s.id, kind: s.kind, label: pick(`${s.id}:label`, title(s.kind)), p: s2[`${s.id}:label`]?.confidence ?? 0 };
    if (s.kind === 'slider' || s.kind === 'numberInput' || s.kind === 'progress') {
      let min = num(`${s.id}:min`, 0);
      let max = num(`${s.id}:max`, 100);
      if (max <= min) [min, max] = [Math.min(min, max), Math.max(min, max, min + 10)];
      w.min = min;
      w.max = max;
    }
    if (s.kind === 'timer') w.max = num(`${s.id}:max`, 25);
    if (s.kind === 'select' || s.kind === 'checklist') {
      w.options = [0, 1, 2, 3].map((o) => s2[`${s.id}:opt${o}`]?.choice).filter((o, i, all): o is string => !!o && all.indexOf(o) === i);
    }
    if (s.kind === 'button') w.action = pick(`${s.id}:action`, 'none');
    return w;
  });
  return {
    title: s1.title?.choice ?? 'Untitled',
    layout: s1.layout?.choice ?? 'stack',
    mood: s1.mood?.choice ?? 'calm',
    widgets,
  };
}
