/* ---------------------------------------------------------------------------
 * @c15r/system1 — System One, always on (ADR-0098).
 *
 * The substrate's fast perception + default actuator. Typed judgments from
 * @c15r/jev (noul / choice / score — calibrated probabilities, no prose) are
 * turned into STRUCTURE the existing machinery already consumes:
 *
 *   perceive           judge facts (project, kind, actionable, durability,
 *                      serves-goal, type-if-untyped) → a judgment fact per
 *                      subject + (act mode) tags, `belongsTo` project edge,
 *                      `serves` goal edge, type on untyped facts
 *   sweep_suggestions  judge pending `similarTo` suggestions → ratify with a
 *                      typed rel (inferred tier, strength 0.6) or DECLINE
 *                      (drop the inferred edge) — drained both ways
 *   revert             undo a whole run (or one subject) from its run log
 *   calibrate          the learner: survival of past acts → per-question
 *                      thresholds (`system1/calibration`), read by every run
 *   label              System Two's audit verdict on one act (a label)
 *   latest / fetch     the last run summary / poll an async job
 *
 * Autonomy is by REVERSIBILITY CLASS (ADR-0098 §2): additive inferred-tier
 * acts (A) and queue resolution (B) proceed above a learned threshold;
 * contradictions are only ever marked (a `contradicts` edge), never resolved;
 * authority is never judged. Every act lands in `system1/run/<id>` so one call
 * reverts it; every materialized tag/edge is traceable to its judgment fact.
 *
 * Like @c15r/consolidate, the organ acts as a SCOPED PRINCIPAL: the caller
 * passes a bearer (`token`), so its reach is that token's scope. The planning
 * core is PURE and exported — tests/system1.test.ts drives it with fixtures.
 * ------------------------------------------------------------------------- */
import { createCellReader, createDynamoStateStore } from '@parc/runtime/cell';
import { createHash, randomUUID } from 'node:crypto';
// Materialized from cells/kernel/static/ (ADR-0076 vendor overlay).
// eslint-disable-next-line import/no-unresolved
import { gwCall, gwCallMany } from './vendor/gateway-client.js';
// eslint-disable-next-line import/no-unresolved
import { cellJobs } from './vendor/cell-jobs.js';

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';
const GATEWAY_MCP = process.env.GATEWAY_MCP_URL || 'https://parc.land/mcp';
const JOBS_TABLE = process.env.TABLE_NAME || '';
let SELF_FUNCTION = '';

/** The declaration version every judgment + act is stamped with. Bump when the
 *  questions or the materialization mapping change (re-perception supersedes). */
export const DECL = 'perceive/v1';
export const RELATE_DECL = 'relate/v1';
export const MODEL = 'jev-1.13.0';
export const PERCEIVED_TAG = 's1:perceive-v1';
export const INFERRED_STRENGTH = 0.6;
export const LATEST_KEY = 'system1/latest';
export const CALIBRATION_KEY = 'system1/calibration';

/* ── thresholds: defaults, overridden by the learner's calibration fact ───── */

export interface Thresholds {
  project: number;
  actionable: number;
  durable: number;
  serves: number;
  type: number;
  noise: number;
  relate: number;
  decline: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = {
  project: 0.7,
  actionable: 0.8,
  durable: 0.7,
  serves: 0.75,
  type: 0.8,
  noise: 0.85,
  relate: 0.7,
  decline: 0.8,
};
/** The learner never lowers a gate below these (or raises it past 0.99). */
export const THRESHOLD_FLOOR: Partial<Thresholds> = { relate: 0.6, decline: 0.7, project: 0.6 };

/** Facts System One never perceives: plumbing, its own output, raw files
 *  (their `doc` is perceived instead), decomposition parts. */
export const SKIP_TYPES = new Set([
  'doc-block', 'doc-order', 'decompose-status', 'canvas-placement', 'canvas-element', 'machine-run',
  'machine-trigger', 'capability', 'checked', 'consolidation', 'judgment', 'system1-run', 'reaction-error',
  'markdown', 'public-share', 'tending', 'contested', 'cell', 'visual-assertion', 'lease', 'posture',
]);
export const SKIP_PREFIXES = ['_', 'system1/', 'judgment/', 'checked/', 'contested/', 'consolidation/', 'machine/', 'lease/', 'tending/', 'cells/', 'file/', 'doc-block:', '_doc'];

export function perceivable(key: string, type: string | null | undefined): boolean {
  if (SKIP_PREFIXES.some((p) => key.startsWith(p))) return false;
  if (type && SKIP_TYPES.has(type)) return false;
  return true;
}

/* ── the pure core ────────────────────────────────────────────────────────── */

export interface Project { key: string; slug: string; label: string }
export interface Goal { key: string; id: string; title: string; detail?: string }
export interface Subject {
  key: string;
  type: string | null;
  tags: string[];
  value: unknown;
  version?: string;
  updatedAt?: string;
}

export const KIND_OPTIONS: Record<string, string> = {
  work: 'a concrete plan, task, bug or change someone could carry out',
  knowledge: 'a durable explanation, decision, finding or design rationale',
  reference: 'a pointer to an external source (link, paper, repo) with little of its own content',
  log: 'a status report, progress note or record of what happened',
  noise: 'accidental, empty or content-free',
};

export function projectSlug(key: string): string {
  const tail = key.split('/').pop() ?? key;
  return tail.replace(/^proj_/, '').replace(/_/g, '-').toLowerCase();
}

/** The subject's text as Jev state: bounded, explicit, no whole-doc bundles. */
export function subjectText(value: unknown, max = 1800): string {
  let s: string;
  if (typeof value === 'string') s = value;
  else if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const parts = [v.title, v.summary, v.content, v.detail, v.text, v.statement, v.note]
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    s = parts.length ? parts.join('\n') : JSON.stringify(value);
  } else s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function subjectState(s: Subject): Record<string, unknown> {
  return {
    key: s.key,
    type: s.type ?? '(untyped)',
    tags: s.tags.filter((t) => !t.startsWith('s1:') && !t.startsWith('project:')),
    text: subjectText(s.value),
  };
}

/** The perceive question set (ADR-0098 §1). All share one state → one call. */
export function perceiveQuestions(
  subject: Subject,
  ctx: { projects: Project[]; goals: Goal[]; types: string[] },
): Record<string, unknown> {
  const q: Record<string, unknown> = {
    kind: { type: 'choice', instructions: 'What kind of workspace fact is this?', criteria: KIND_OPTIONS },
    actionable: { type: 'noul', instructions: 'Does this fact contain concrete work the owner could act on now (a plan, a to-do, a bug to fix, a change to make)?' },
    durability: { type: 'score', instructions: 'How long will this remain useful to the owner?', criteria: ['hours', 'days', 'months', 'years'] },
  };
  if (ctx.projects.length) {
    const criteria: Record<string, string | null> = {};
    for (const p of ctx.projects.slice(0, 250)) criteria[p.slug] = p.label || null;
    criteria.none = 'none of these projects — general, platform-wide, or unrelated';
    q.project = { type: 'choice', instructions: 'Which of the owner\'s projects is this fact primarily about?', criteria };
  }
  for (const g of ctx.goals.slice(0, 8)) {
    q[`serves:${g.id}`] = {
      type: 'noul',
      instructions: `Does this fact directly advance or inform the goal "${g.title}"${g.detail ? ` (${g.detail.slice(0, 200)})` : ''}?`,
    };
  }
  if (!subject.type && ctx.types.length) {
    const criteria: Record<string, string | null> = {};
    for (const t of ctx.types.slice(0, 250)) criteria[t] = null;
    q.type = { type: 'choice', instructions: 'Which declared fact type best describes this fact?', criteria };
  }
  return q;
}

interface ChoiceAns { choice?: string; confidence?: number; probabilities?: Record<string, number> }
interface NoulAns { noul?: number }
interface ScoreAns { score?: number; probabilities?: Record<string, number> }

export interface PerceivePlan {
  key: string;
  addTags: string[];
  type?: string;
  edges: Array<{ rel: string; to: string; p: number }>;
  noise?: number;
  judgment: Record<string, unknown>;
}

/** Answers → materialization, gated per question by θ. Pure. */
export function planPerceive(
  subject: Subject,
  answers: Record<string, unknown>,
  ctx: { projects: Project[]; goals: Goal[] },
  th: Thresholds = DEFAULT_THRESHOLDS,
): PerceivePlan {
  const addTags: string[] = [];
  const edges: PerceivePlan['edges'] = [];
  const compact: Record<string, unknown> = {};
  const has = new Set(subject.tags);

  const proj = answers.project as ChoiceAns | undefined;
  if (proj?.choice) {
    const p = proj.probabilities?.[proj.choice] ?? 0;
    compact.project = { choice: proj.choice, p };
    const target = ctx.projects.find((x) => x.slug === proj.choice);
    if (target && p >= th.project) {
      const tag = `project:${target.slug}`;
      if (!has.has(tag)) addTags.push(tag);
      if (subject.key !== target.key) edges.push({ rel: 'belongsTo', to: target.key, p });
    }
  }

  const kind = answers.kind as ChoiceAns | undefined;
  let noise: number | undefined;
  if (kind?.choice) {
    compact.kind = { choice: kind.choice, p: kind.probabilities?.[kind.choice] ?? 0 };
    noise = kind.probabilities?.noise;
  }

  const act = answers.actionable as NoulAns | undefined;
  if (typeof act?.noul === 'number') {
    compact.actionable = act.noul;
    if (act.noul >= th.actionable && !has.has('actionable')) addTags.push('actionable');
  }

  const dur = answers.durability as ScoreAns | undefined;
  if (dur?.probabilities) {
    const pYears = dur.probabilities['3'] ?? 0;
    const pMonthsPlus = pYears + (dur.probabilities['2'] ?? 0);
    compact.durability = { score: dur.score, pMonthsPlus };
    if (pMonthsPlus >= th.durable && !has.has('durable')) addTags.push('durable');
    if ((dur.probabilities['0'] ?? 0) >= th.durable && !has.has('ephemeral')) addTags.push('ephemeral');
  }

  for (const g of ctx.goals) {
    const a = answers[`serves:${g.id}`] as NoulAns | undefined;
    if (typeof a?.noul !== 'number') continue;
    compact[`serves:${g.id}`] = a.noul;
    if (a.noul >= th.serves && subject.key !== g.key) edges.push({ rel: 'serves', to: g.key, p: a.noul });
  }

  let type: string | undefined;
  const ty = answers.type as ChoiceAns | undefined;
  if (ty?.choice && !subject.type) {
    const p = ty.probabilities?.[ty.choice] ?? 0;
    compact.type = { choice: ty.choice, p };
    if (p >= th.type) type = ty.choice;
  }

  if (typeof noise === 'number' && noise >= th.noise && !has.has('s1:noise')) addTags.push('s1:noise');
  if (!has.has(PERCEIVED_TAG)) addTags.push(PERCEIVED_TAG);

  return { key: subject.key, addTags, type, edges, noise, judgment: compact };
}

/* relate: one pair, one choice. */
export const RELATION_OPTIONS: Record<string, string> = {
  elaborates: 'B extends, details or builds on A',
  refines: 'B is a more precise or corrected version of the same idea as A',
  grounds: 'B provides evidence, source or justification for A',
  duplicates: 'A and B say essentially the same thing',
  contradicts: 'A and B assert incompatible things',
  relatesTo: 'same topic or project, but none of the above',
  unrelated: 'no meaningful connection; the similarity is superficial (shared boilerplate, format or template)',
};

/** A pair where one fact names the other's key is already structurally related
 *  (an asset and the capture that points at it) — two roles, not a duplicate.
 *  Judging it would only re-derive what the reference says; hold it. */
export function referencesEachOther(a: Subject, b: Subject): boolean {
  const mentions = (x: Subject, key: string) => {
    const tail = key.split('/').pop() ?? key;
    const text = typeof x.value === 'string' ? x.value : JSON.stringify(x.value ?? '');
    return text.includes(key) || (tail.length >= 12 && text.includes(tail));
  };
  return mentions(a, b.key) || mentions(b, a.key);
}

export type RelateDecision =
  | { action: 'ratify'; rel: string; p: number }
  | { action: 'decline'; p: number }
  | { action: 'hold'; rel: string; p: number };

export function planRelate(answer: ChoiceAns | undefined, th: Thresholds = DEFAULT_THRESHOLDS): RelateDecision {
  const probs = answer?.probabilities ?? {};
  let best = 'relatesTo';
  let bp = -1;
  for (const [k, v] of Object.entries(probs)) if (v > bp) [best, bp] = [k, v];
  if (bp < 0) return { action: 'hold', rel: 'unknown', p: 0 };
  if (best === 'unrelated') return bp >= th.decline ? { action: 'decline', p: bp } : { action: 'hold', rel: best, p: bp };
  // "related at all" mass: a pair split between elaborates/relatesTo is still clearly related.
  const related = 1 - (probs.unrelated ?? 0);
  if (bp >= th.relate) return { action: 'ratify', rel: best, p: bp };
  if (related >= Math.max(th.relate, 0.85) && best !== 'contradicts' && best !== 'duplicates') {
    return { action: 'ratify', rel: 'relatesTo', p: related };
  }
  return { action: 'hold', rel: best, p: bp };
}

/* ── the learner (pure) ─────────────────────────────────────────────────────
 * Labels: an act that still holds at check time (edge present / tag present)
 * is a weak positive; one that is gone (reverted, unlinked, retagged) is a
 * negative; System Two audit labels are strong and weigh 3×. Per question we
 * find the lowest θ whose acts above it meet the class's target precision. */
export interface LabelledAct { q: keyof Thresholds; p: number; ok: boolean; weight?: number }
export const TARGET_PRECISION: Record<keyof Thresholds, number> = {
  project: 0.85, actionable: 0.85, durable: 0.85, serves: 0.85, type: 0.9, noise: 0.95, relate: 0.9, decline: 0.9,
};
export const MIN_LABELS = 20;

export function calibrate(labels: LabelledAct[], current: Thresholds = DEFAULT_THRESHOLDS): { thresholds: Thresholds; report: Record<string, unknown> } {
  const next = { ...current };
  const report: Record<string, unknown> = {};
  for (const q of Object.keys(current) as Array<keyof Thresholds>) {
    const ls = labels.filter((l) => l.q === q).sort((a, b) => a.p - b.p);
    const n = ls.reduce((s, l) => s + (l.weight ?? 1), 0);
    if (n < MIN_LABELS) {
      report[q] = { n, kept: current[q], why: 'too few labels' };
      continue;
    }
    // Scan candidate cut points (the observed probabilities); pick the lowest
    // θ whose above-θ weighted precision meets the target with ≥ MIN_LABELS/2 support.
    // Cuts are DISTINCT probabilities: a threshold can't split tied values, so
    // "above θ" is always every label with p ≥ θ.
    let chosen: number | null = null;
    for (const cut of [...new Set(ls.map((l) => l.p))]) {
      const above = ls.filter((l) => l.p >= cut);
      const w = above.reduce((s, l) => s + (l.weight ?? 1), 0);
      if (w < MIN_LABELS / 2) break;
      const good = above.reduce((s, l) => s + (l.ok ? l.weight ?? 1 : 0), 0);
      if (good / w >= TARGET_PRECISION[q]) {
        chosen = cut;
        break;
      }
    }
    const floor = THRESHOLD_FLOOR[q] ?? 0.5;
    const precisionAll = ls.reduce((s, l) => s + (l.ok ? l.weight ?? 1 : 0), 0) / n;
    if (chosen === null) {
      // Cannot meet target anywhere with support → tighten (autonomy falls back).
      next[q] = Math.min(0.99, Math.max(current[q] + 0.05, floor));
      report[q] = { n, precisionAll: +precisionAll.toFixed(3), from: current[q], to: next[q], why: 'target unmet — tightened' };
    } else {
      // Move at most 0.05 per cycle toward the chosen cut (no lurching).
      const target = Math.min(0.99, Math.max(chosen, floor));
      const step = Math.max(-0.05, Math.min(0.05, target - current[q]));
      next[q] = +(current[q] + step).toFixed(3);
      report[q] = { n, precisionAll: +precisionAll.toFixed(3), cut: chosen, from: current[q], to: next[q] };
    }
  }
  return { thresholds: next, report };
}

export function hashOf(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

/* ── the shell: gateway reads/acts under the caller's token ──────────────── */

type Tok = string;
const gw = (token: Tok, target: string, input?: unknown, kind?: 'read' | 'act') =>
  gwCall(token, target, input, { url: GATEWAY_MCP, ...(kind ? { kind } : {}) });
const isErr = (v: unknown): v is { error: string } =>
  !!v && typeof v === 'object' && 'error' in (v as object) && Object.keys(v as object).length === 1;

async function loadThresholds(token: Tok): Promise<Thresholds> {
  try {
    const cal = (await gw(token, 'workspace.peek', { key: CALIBRATION_KEY }, 'read')) as { value?: { thresholds?: Partial<Thresholds> } } | null;
    return { ...DEFAULT_THRESHOLDS, ...(cal?.value?.thresholds ?? {}) };
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }
}

async function loadContext(token: Tok): Promise<{ projects: Project[]; goals: Goal[]; types: string[] }> {
  const [proj, goals, types] = await gwCallMany(
    token,
    [
      { target: 'workspace.query', input: { type: 'project', shape: 'card', limit: 100 }, kind: 'read' },
      { target: '@c15r/tasks.list_goals', input: { status: 'active' }, kind: 'read' },
      { target: '$types', kind: 'read' },
    ],
    { url: GATEWAY_MCP, concurrency: 3 },
  );
  const projects: Project[] = isErr(proj)
    ? []
    : ((proj as { entries?: Array<{ key: string; value?: unknown; _meta?: { tags?: string[]; superseded?: boolean } }> }).entries ?? [])
        .filter((e) => !e._meta?.superseded)
        .map((e) => {
          const tags = (e._meta?.tags ?? []).filter((t) => t !== 'project').slice(0, 6).join(', ');
          const text = subjectText(e.value, 140).replace(/\s+/g, ' ');
          return { key: e.key, slug: projectSlug(e.key), label: [tags, text].filter(Boolean).join(' — ').slice(0, 200) };
        });
  const gl: Goal[] = isErr(goals)
    ? []
    : ((goals as { goals?: Array<{ id: string; title: string; detail?: string }> }).goals ?? []).map((g) => ({
        key: `goal/${g.id}`,
        id: g.id,
        title: g.title,
        detail: g.detail,
      }));
  const typeMap = isErr(types) ? {} : (((types as { types?: Record<string, { manager?: string }> }).types ?? {}) as Record<string, { manager?: string }>);
  const typeNames = Object.keys(typeMap).filter((t) => !SKIP_TYPES.has(t) && !t.startsWith('_')).sort();
  return { projects, goals: gl, types: typeNames };
}

interface RunAct {
  kind: 'tag' | 'type' | 'link' | 'ratify' | 'decline';
  key?: string;
  added?: string[];
  type?: string;
  from?: string;
  rel?: string;
  to?: string;
  q?: keyof Thresholds;
  p?: number;
}

interface RunLog {
  id: string;
  tool: string;
  mode: 'shadow' | 'act';
  at: string;
  thresholds: Thresholds;
  counts: Record<string, number>;
  acts: RunAct[];
  errors: string[];
  usage: { input_tokens: number };
  /** Wall-clock per phase (ms) — the sweep is bounded by the edge, so measure it. */
  timings?: Record<string, number>;
  next?: unknown;
}

function timer(): (label: string) => Record<string, number> {
  const t0 = Date.now();
  let last = t0;
  const out: Record<string, number> = {};
  return (label) => {
    const now = Date.now();
    out[label] = now - last;
    out.total = now - t0;
    last = now;
    return out;
  };
}

async function writeRun(token: Tok, log: RunLog): Promise<void> {
  const summary = { ...log, acts: undefined, actCount: log.acts.length };
  await gwCallMany(
    token,
    [
      { target: 'workspace.remember', input: { key: `system1/run/${log.id}`, value: log, type: 'system1-run', tags: ['system1', `mode:${log.mode}`, `tool:${log.tool}`], via: `system1.${log.tool}` }, kind: 'act' },
      { target: 'workspace.remember', input: { key: LATEST_KEY, value: summary, type: 'system1-run', tags: ['system1'], via: `system1.${log.tool}` }, kind: 'act' },
    ],
    { url: GATEWAY_MCP, concurrency: 2 },
  );
}

const newRunId = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 4)}`;

/* perceive ───────────────────────────────────────────────────────────────── */

interface PerceiveInput {
  token?: string;
  keys?: string[];
  prefix?: string;
  type?: string;
  cursor?: string;
  limit?: number;
  mode?: 'shadow' | 'act';
  force?: boolean;
}

async function loadSubjects(token: Tok, input: PerceiveInput): Promise<{ subjects: Subject[]; next?: string; scanned: number }> {
  type Entry = { key: string; value?: unknown; _meta?: { type?: string | null; tags?: string[]; version?: string; updatedAt?: string; superseded?: boolean } };
  let entries: Entry[] = [];
  let next: string | undefined;
  if (input.keys?.length) {
    const got = await gwCallMany(token, input.keys.slice(0, 100).map((key) => ({ target: 'workspace.peek', input: { key }, kind: 'read' as const })), { url: GATEWAY_MCP, concurrency: 8 });
    entries = got.map((g, i) => (isErr(g) || !g ? null : ({ key: input.keys![i], ...(g as object) } as Entry))).filter((e): e is Entry => !!e);
  } else {
    const page = (await gw(token, 'workspace.query', {
      ...(input.prefix ? { prefix: input.prefix } : {}),
      ...(input.type ? { type: input.type } : {}),
      shape: 'full',
      rankBy: 'recency',
      limit: Math.min(input.limit ?? 40, 100),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    }, 'read')) as { entries?: Entry[]; nextCursor?: string };
    entries = page.entries ?? [];
    next = page.nextCursor;
  }
  const subjects = entries
    .filter((e) => !e._meta?.superseded && e.value !== undefined && perceivable(e.key, e._meta?.type ?? null))
    .filter((e) => input.force || !(e._meta?.tags ?? []).includes(PERCEIVED_TAG))
    .map((e) => ({ key: e.key, type: e._meta?.type ?? null, tags: e._meta?.tags ?? [], value: e.value, version: e._meta?.version, updatedAt: e._meta?.updatedAt }));
  return { subjects, next, scanned: entries.length };
}

async function perceive(input: PerceiveInput): Promise<RunLog> {
  const token = input.token;
  if (!token) throw new Error('token is required (a bearer with read:workspace write:workspace + @c15r/jev access)');
  const mode = input.mode === 'act' ? 'act' : 'shadow';
  const tick = timer();
  const [th, ctx, loaded] = await Promise.all([loadThresholds(token), loadContext(token), loadSubjects(token, input)]);
  tick('load');
  const log: RunLog = { id: newRunId(), tool: 'perceive', mode, at: new Date().toISOString(), thresholds: th, counts: { scanned: loaded.scanned, subjects: loaded.subjects.length }, acts: [], errors: [], usage: { input_tokens: 0 }, next: loaded.next };
  if (!loaded.subjects.length) {
    await writeRun(token, log);
    return log;
  }

  const judged = (await gw(token, '@c15r/jev.decide_many', {
    model: MODEL,
    items: loaded.subjects.map((s) => ({ id: s.key, state: subjectState(s), questions: perceiveQuestions(s, ctx) })),
  }, 'act')) as { results?: Array<{ id: string; answers?: Record<string, unknown>; error?: string }>; usage?: { input_tokens?: number } };
  log.usage.input_tokens = judged.usage?.input_tokens ?? 0;
  tick('judge');

  const plans: Array<{ s: Subject; plan: PerceivePlan }> = [];
  for (const r of judged.results ?? []) {
    const s = loaded.subjects.find((x) => x.key === r.id);
    if (!s) continue;
    if (!r.answers) {
      log.errors.push(`${r.id}: ${r.error ?? 'no answers'}`);
      continue;
    }
    plans.push({ s, plan: planPerceive(s, r.answers, ctx, th) });
  }

  // Judgment facts: one per subject, in one ingest (write-load: one call).
  const facts = plans.map(({ s, plan }) => ({
    key: `judgment/${DECL}/${hashOf(s.key)}`,
    type: 'judgment',
    tags: ['judgment', DECL],
    value: { subject: s.key, subjectVersion: s.version, decl: DECL, model: MODEL, run: log.id, at: log.at, answers: plan.judgment, planned: { tags: plan.addTags, type: plan.type, edges: plan.edges } },
  }));
  for (let i = 0; i < facts.length; i += 100) {
    try {
      await gw(token, 'workspace.ingest', { via: 'system1.perceive', facts: facts.slice(i, i + 100) }, 'act');
    } catch (e) {
      log.errors.push(`ingest judgments: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  log.counts.judged = plans.length;
  tick('ingest');

  if (mode === 'act') {
    // Tags/type: CAS re-write of the same value, preserving recency (a tag is not new content).
    const writes = plans
      .filter(({ plan }) => plan.addTags.length || plan.type)
      .map(({ s, plan }) => ({
        target: 'workspace.remember',
        input: {
          key: s.key,
          value: s.value,
          ...(plan.type || s.type ? { type: plan.type ?? s.type } : {}),
          tags: [...s.tags, ...plan.addTags],
          ...(s.version ? { ifVersion: s.version } : {}),
          ...(s.updatedAt ? { import: { updatedAt: s.updatedAt } } : {}),
          via: 'system1.perceive',
        },
        kind: 'act' as const,
      }));
    const wr = await gwCallMany(token, writes, { url: GATEWAY_MCP, concurrency: 6 });
    wr.forEach((r, i) => {
      const key = (writes[i].input as { key: string }).key;
      const plan = plans.find((p) => p.s.key === key)!.plan;
      if (isErr(r)) log.errors.push(`tag ${key}: ${r.error.slice(0, 160)}`);
      else {
        const real = plan.addTags.filter((t) => t !== PERCEIVED_TAG);
        if (real.length) log.acts.push({ kind: 'tag', key, added: plan.addTags });
        else log.acts.push({ kind: 'tag', key, added: [PERCEIVED_TAG] });
        if (plan.type) log.acts.push({ kind: 'type', key, type: plan.type, q: 'type', p: (plan.judgment.type as { p: number }).p });
      }
    });
    const links = plans.flatMap(({ s, plan }) => plan.edges.map((e) => ({ from: s.key, rel: e.rel, to: e.to, p: e.p })));
    const lr = await gwCallMany(
      token,
      links.map((l) => ({ target: 'workspace.link', input: { from: l.from, rel: l.rel, to: l.to, strength: INFERRED_STRENGTH }, kind: 'act' as const })),
      { url: GATEWAY_MCP, concurrency: 6 },
    );
    lr.forEach((r, i) => {
      const l = links[i];
      if (isErr(r)) log.errors.push(`link ${l.from}→${l.to}: ${r.error.slice(0, 160)}`);
      else log.acts.push({ kind: 'link', from: l.from, rel: l.rel, to: l.to, q: l.rel === 'serves' ? 'serves' : 'project', p: l.p });
    });
  }
  log.timings = tick('act');
  const tally = (pred: (p: PerceivePlan) => boolean) => plans.filter(({ plan }) => pred(plan)).length;
  Object.assign(log.counts, {
    projectTagged: tally((p) => p.addTags.some((t) => t.startsWith('project:'))),
    actionable: tally((p) => p.addTags.includes('actionable')),
    durable: tally((p) => p.addTags.includes('durable')),
    serves: tally((p) => p.edges.some((e) => e.rel === 'serves')),
    typed: tally((p) => !!p.type),
    noise: tally((p) => p.addTags.includes('s1:noise')),
  });
  await writeRun(token, log);
  return log;
}

/* sweep_suggestions ─────────────────────────────────────────────────────── */

interface SweepInput { token?: string; limit?: number; mode?: 'shadow' | 'act'; offset?: number }

async function sweepSuggestions(input: SweepInput): Promise<RunLog> {
  const token = input.token;
  if (!token) throw new Error('token is required');
  const mode = input.mode === 'act' ? 'act' : 'shadow';
  const tick = timer();
  const th = await loadThresholds(token);
  const limit = Math.min(input.limit ?? 60, 150);
  const sug = (await gw(token, 'workspace.suggestions', { limit, ...(input.offset ? { offset: input.offset } : {}) }, 'read')) as {
    suggestions?: Array<{ from: string; to: string; score?: number; pairHash?: string }>;
    total?: number;
  };
  const pairs = sug.suggestions ?? [];
  const log: RunLog = { id: newRunId(), tool: 'sweep_suggestions', mode, at: new Date().toISOString(), thresholds: th, counts: { pending: sug.total ?? 0, pairs: pairs.length }, acts: [], errors: [], usage: { input_tokens: 0 } };
  if (!pairs.length) {
    await writeRun(token, log);
    return log;
  }
  const keys = [...new Set(pairs.flatMap((p) => [p.from, p.to]))];
  const got = await gwCallMany(token, keys.map((key) => ({ target: 'workspace.peek', input: { key }, kind: 'read' as const })), { url: GATEWAY_MCP, concurrency: 8 });
  const facts = new Map<string, Subject>();
  got.forEach((g, i) => {
    if (isErr(g) || !g) return;
    const f = g as { value?: unknown; _meta?: { type?: string | null; tags?: string[]; superseded?: boolean } };
    if (f.value === undefined || f._meta?.superseded) return;
    facts.set(keys[i], { key: keys[i], type: f._meta?.type ?? null, tags: f._meta?.tags ?? [], value: f.value });
  });
  const present = pairs.filter((p) => facts.has(p.from) && facts.has(p.to));
  const live = present.filter((p) => !referencesEachOther(facts.get(p.from)!, facts.get(p.to)!));
  log.counts.live = live.length;
  log.counts.structural = present.length - live.length;
  tick('load');
  const judged = (await gw(token, '@c15r/jev.decide_many', {
    model: MODEL,
    questions: {
      relation: {
        type: 'choice',
        instructions: 'Two facts from one person\'s workspace were flagged as similar by embeddings. How does B relate to A?',
        criteria: RELATION_OPTIONS,
      },
    },
    items: live.map((p, i) => ({
      id: String(i),
      state: { A: subjectState(facts.get(p.from)!), B: subjectState(facts.get(p.to)!) },
    })),
  }, 'act')) as { results?: Array<{ id: string; answers?: { relation?: ChoiceAns }; error?: string }>; usage?: { input_tokens?: number } };
  log.usage.input_tokens = judged.usage?.input_tokens ?? 0;
  tick('judge');

  const decisions = (judged.results ?? []).map((r) => {
    const pair = live[Number(r.id)];
    return { pair, r, d: r.answers ? planRelate(r.answers.relation, th) : null };
  });
  const tallies: Record<string, number> = { ratify: 0, decline: 0, hold: 0, error: 0 };
  const judgmentFacts: unknown[] = [];
  for (const { pair, r, d } of decisions) {
    if (!d) {
      tallies.error++;
      log.errors.push(`${pair.from}↔${pair.to}: ${r.error ?? 'no answer'}`);
      continue;
    }
    tallies[d.action]++;
    judgmentFacts.push({
      key: `judgment/${RELATE_DECL}/${hashOf(pair.from, pair.to)}`,
      type: 'judgment',
      tags: ['judgment', RELATE_DECL],
      value: { a: pair.from, b: pair.to, cosine: pair.score, decl: RELATE_DECL, model: MODEL, run: log.id, at: log.at, probabilities: r.answers?.relation?.probabilities, decision: d },
    });
  }
  for (let i = 0; i < judgmentFacts.length; i += 100) {
    try {
      await gw(token, 'workspace.ingest', { via: 'system1.sweep', facts: judgmentFacts.slice(i, i + 100) }, 'act');
    } catch (e) {
      log.errors.push(`ingest judgments: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  Object.assign(log.counts, tallies);
  tick('ingest');

  if (mode === 'act') {
    const calls: Array<{ target: string; input: unknown; kind: 'act'; act: RunAct }> = [];
    for (const { pair, d } of decisions) {
      if (!d) continue;
      if (d.action === 'ratify') {
        calls.push({ target: 'workspace.ratify', input: { from: pair.from, to: pair.to, rel: d.rel, strength: INFERRED_STRENGTH }, kind: 'act', act: { kind: 'ratify', from: pair.from, rel: d.rel, to: pair.to, q: 'relate', p: d.p } });
      } else if (d.action === 'decline') {
        calls.push({ target: 'workspace.unlink', input: { from: pair.from, rel: 'similarTo', to: pair.to }, kind: 'act', act: { kind: 'decline', from: pair.from, rel: 'similarTo', to: pair.to, q: 'decline', p: d.p } });
      }
    }
    const res = await gwCallMany(token, calls.map(({ target, input, kind }) => ({ target, input, kind })), { url: GATEWAY_MCP, concurrency: 6 });
    res.forEach((r, i) => {
      if (isErr(r)) log.errors.push(`${calls[i].act.kind} ${calls[i].act.from}→${calls[i].act.to}: ${r.error.slice(0, 160)}`);
      else log.acts.push(calls[i].act);
    });
  }
  log.timings = tick('act');
  await writeRun(token, log);
  return log;
}

/* revert ────────────────────────────────────────────────────────────────── */

async function revert(input: { token?: string; run?: string; key?: string }): Promise<Record<string, unknown>> {
  const token = input.token;
  if (!token || !input.run) throw new Error('token and run are required');
  const rec = (await gw(token, 'workspace.peek', { key: `system1/run/${input.run}` }, 'read')) as { value?: RunLog } | null;
  const log = rec?.value;
  if (!log) throw new Error(`no run log system1/run/${input.run}`);
  const acts = (log.acts ?? []).filter((a) => !input.key || a.key === input.key || a.from === input.key);
  const undone: string[] = [];
  const failed: string[] = [];
  for (const a of acts) {
    try {
      if (a.kind === 'link' || a.kind === 'ratify') {
        await gw(token, 'workspace.unlink', { from: a.from, rel: a.rel, to: a.to }, 'act');
        undone.push(`${a.kind} ${a.from} --${a.rel}--> ${a.to}`);
      } else if (a.kind === 'tag' && a.key) {
        const cur = (await gw(token, 'workspace.peek', { key: a.key }, 'read')) as { value?: unknown; _meta?: { tags?: string[]; type?: string | null; version?: string; updatedAt?: string } } | null;
        if (!cur || cur.value === undefined) continue;
        const drop = new Set(a.added ?? []);
        const typed = acts.find((x) => x.kind === 'type' && x.key === a.key);
        await gw(token, 'workspace.remember', {
          key: a.key,
          value: cur.value,
          tags: (cur._meta?.tags ?? []).filter((t) => !drop.has(t)),
          ...(typed ? {} : cur._meta?.type ? { type: cur._meta.type } : {}),
          ifVersion: cur._meta?.version,
          ...(cur._meta?.updatedAt ? { import: { updatedAt: cur._meta.updatedAt } } : {}),
          via: 'system1.revert',
        }, 'act');
        undone.push(`tags ${a.key} −[${[...drop].join(',')}]${typed ? ' (type cleared)' : ''}`);
      } else if (a.kind === 'decline') {
        undone.push(`decline ${a.from}↔${a.to}: not restorable (the vector index re-proposes it on reindex)`);
      }
    } catch (e) {
      failed.push(`${a.kind} ${a.key ?? a.from}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  await gw(token, 'workspace.remember', {
    key: `system1/revert/${input.run}${input.key ? `/${hashOf(input.key)}` : ''}`,
    value: { run: input.run, key: input.key ?? null, at: new Date().toISOString(), undone, failed },
    type: 'system1-run',
    tags: ['system1', 'revert'],
    via: 'system1.revert',
  }, 'act');
  return { run: input.run, undone: undone.length, failed, detail: undone.slice(0, 50) };
}

/* label + calibrate (the learner) ───────────────────────────────────────── */

async function label(input: { token?: string; run?: string; index?: number; ok?: boolean; note?: string }): Promise<unknown> {
  const token = input.token;
  if (!token || !input.run || typeof input.index !== 'number' || typeof input.ok !== 'boolean') throw new Error('token, run, index and ok are required');
  const rec = (await gw(token, 'workspace.peek', { key: `system1/run/${input.run}` }, 'read')) as { value?: RunLog } | null;
  const act = rec?.value?.acts?.[input.index];
  if (!act) throw new Error('no such act');
  const key = `system1/label/${input.run}/${input.index}`;
  await gw(token, 'workspace.remember', { key, value: { run: input.run, index: input.index, act, ok: input.ok, note: input.note ?? null, at: new Date().toISOString() }, type: 'system1-label', tags: ['system1', 'label', input.ok ? 'label:ok' : 'label:wrong'], via: 'system1.label' }, 'act');
  return { key, act, ok: input.ok };
}

async function runCalibrate(input: { token?: string; runs?: number; apply?: boolean }): Promise<unknown> {
  const token = input.token;
  if (!token) throw new Error('token is required');
  const page = (await gw(token, 'workspace.query', { prefix: 'system1/run/', shape: 'full', rankBy: 'recency', limit: Math.min(input.runs ?? 20, 50) }, 'read')) as { entries?: Array<{ value?: RunLog }> };
  const acts = (page.entries ?? []).flatMap((e) => (e.value?.mode === 'act' ? (e.value.acts ?? []).map((a, i) => ({ run: e.value!.id, i, a })) : []));
  const labels: LabelledAct[] = [];
  // Survival check: edges by source key (one edges call per distinct source), tags by peek.
  const linkActs = acts.filter((x) => (x.a.kind === 'link' || x.a.kind === 'ratify') && x.a.q && typeof x.a.p === 'number');
  const sources = [...new Set(linkActs.map((x) => x.a.from!))].slice(0, 200);
  const edgeRes = await gwCallMany(token, sources.map((k) => ({ target: 'workspace.edges', input: { around: k, derived: false, limit: 200 }, kind: 'read' as const })), { url: GATEWAY_MCP, concurrency: 8 });
  const present = new Set<string>();
  edgeRes.forEach((r) => {
    if (isErr(r)) return;
    for (const e of (r as { edges?: Array<{ from: string; rel: string; to: string }> }).edges ?? []) present.add(`${e.from}|${e.rel}|${e.to}`);
  });
  for (const x of linkActs) {
    if (!sources.includes(x.a.from!)) continue;
    labels.push({ q: x.a.q!, p: x.a.p!, ok: present.has(`${x.a.from}|${x.a.rel}|${x.a.to}`) });
  }
  // Audit labels (strong, 3×).
  const lab = (await gw(token, 'workspace.query', { prefix: 'system1/label/', shape: 'full', limit: 100 }, 'read').catch(() => ({ entries: [] }))) as { entries?: Array<{ value?: { act?: RunAct; ok?: boolean } }> };
  for (const e of lab.entries ?? []) {
    const a = e.value?.act;
    if (a?.q && typeof a.p === 'number' && typeof e.value?.ok === 'boolean') labels.push({ q: a.q, p: a.p, ok: e.value.ok, weight: 3 });
  }
  const current = await loadThresholds(token);
  const { thresholds, report } = calibrate(labels, current);
  const out = { at: new Date().toISOString(), labels: labels.length, thresholds, previous: current, report };
  if (input.apply !== false) {
    await gw(token, 'workspace.remember', { key: CALIBRATION_KEY, value: out, type: 'system1-run', tags: ['system1', 'calibration'], via: 'system1.calibrate' }, 'act');
  }
  return out;
}

/* ── async jobs (a sweep can outrun the ~30s edge cap) ───────────────────── */

let awsClients: null | { ddb: { send(c: unknown): Promise<{ Item?: Record<string, unknown> }> }; Put: new (i: unknown) => unknown; Get: new (i: unknown) => unknown; lambda: { send(c: unknown): Promise<unknown> }; Invoke: new (i: unknown) => unknown } = null;
async function aws() {
  if (!awsClients) {
    const [dynamo, lib, lam] = await Promise.all([import('@aws-sdk/client-dynamodb'), import('@aws-sdk/lib-dynamodb'), import('@aws-sdk/client-lambda')]);
    awsClients = {
      ddb: lib.DynamoDBDocumentClient.from(new dynamo.DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } }) as never,
      Put: lib.PutCommand as never,
      Get: lib.GetCommand as never,
      lambda: new lam.LambdaClient({}) as never,
      Invoke: lam.InvokeCommand as never,
    };
  }
  return awsClients!;
}
const jobs = cellJobs({
  put: async (item: Record<string, unknown>) => {
    const a = await aws();
    await a.ddb.send(new a.Put({ TableName: JOBS_TABLE, Item: item }));
  },
  get: async (key: { pk: string; sk: string }) => {
    const a = await aws();
    return (await a.ddb.send(new a.Get({ TableName: JOBS_TABLE, Key: key }))).Item;
  },
  invokeSelf: async (payload: unknown) => {
    const a = await aws();
    await a.lambda.send(new a.Invoke({ FunctionName: SELF_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
  },
});

const RUNNERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  perceive: (a) => perceive(a as PerceiveInput),
  sweep_suggestions: (a) => sweepSuggestions(a as SweepInput),
  revert: (a) => revert(a as { token?: string; run?: string; key?: string }),
  calibrate: (a) => runCalibrate(a as { token?: string; runs?: number; apply?: boolean }),
  label: (a) => label(a as { token?: string; run?: string; index?: number; ok?: boolean; note?: string }),
};

/* ── the cell surface ────────────────────────────────────────────────────── */

const tokenProp = { type: 'string', description: 'Bearer the organ acts as (read:workspace write:workspace, plus @c15r/jev access)' };
const modeProp = { type: 'string', enum: ['shadow', 'act'], description: 'shadow (default): write judgment facts only; act: also materialize tags/type/edges' };
const asyncProp = { type: 'boolean', description: 'Submit-and-poll (returns {jobId}; poll fetch) — for runs that outrun the ~30s edge cap' };

const TOOLS = [
  {
    name: 'perceive',
    kind: 'act',
    description:
      'System One perception (ADR-0098 §1): judge facts with @c15r/jev in one parallel pass — project (choice over live kb/proj_* facts), kind, actionable, durability, serves:<active goal>, type-if-untyped — write one judgment fact per subject, and in act mode materialize: tags (project:<slug>, actionable, durable, s1:perceive-v1), type on untyped facts, `belongsTo` project and `serves` goal edges (inferred tier, strength 0.6). Tag rewrites are CAS-guarded and preserve the fact\'s recency. Select by keys[], or a query page (prefix/type/cursor, recency-ranked); already-perceived facts are skipped unless force. Every act lands in system1/run/<id> (revertible).',
    inputSchema: {
      type: 'object',
      properties: {
        token: tokenProp,
        keys: { type: 'array', items: { type: 'string' }, description: 'Explicit subjects (≤100)' },
        prefix: { type: 'string' },
        type: { type: 'string' },
        cursor: { type: 'string', description: 'Continue a query page (the previous run\'s `next`)' },
        limit: { type: 'number', description: 'Query page size (default 40, max 100)' },
        mode: modeProp,
        force: { type: 'boolean', description: 'Re-perceive facts already carrying s1:perceive-v1' },
        async: asyncProp,
      },
      required: ['token'],
    },
  },
  {
    name: 'sweep_suggestions',
    kind: 'act',
    description:
      'Drain the similarTo suggestion queue both ways (ADR-0098 §3): judge each pair with one Jev choice over {elaborates, refines, grounds, duplicates, contradicts, relatesTo, unrelated}; above θ ratify with that rel at inferred strength 0.6 (contradicts is a mark, never a resolution); unrelated above θ DECLINES (drops the inferred edge). Judgment facts always; acts only in act mode.',
    inputSchema: {
      type: 'object',
      properties: { token: tokenProp, limit: { type: 'number', description: 'Pairs per sweep (default 60, max 150)' }, offset: { type: 'number' }, mode: modeProp, async: asyncProp },
      required: ['token'],
    },
  },
  {
    name: 'revert',
    kind: 'act',
    description: 'Undo a System One run from its log (system1/run/<run>): unlink its edges/ratifications, strip the tags it added (CAS, recency preserved). Optionally only one subject key. Declines cannot be restored (the index re-proposes them).',
    inputSchema: { type: 'object', properties: { token: tokenProp, run: { type: 'string' }, key: { type: 'string' } }, required: ['token', 'run'] },
  },
  {
    name: 'label',
    kind: 'act',
    description: 'System Two audit: record whether act #index of run was right (ok) — a strong (3×) label for calibrate.',
    inputSchema: { type: 'object', properties: { token: tokenProp, run: { type: 'string' }, index: { type: 'number' }, ok: { type: 'boolean' }, note: { type: 'string' } }, required: ['token', 'run', 'index', 'ok'] },
  },
  {
    name: 'calibrate',
    kind: 'act',
    description: 'The learner (ADR-0098 §4): label recent act-mode runs by survival (edge still present = weak positive; gone = negative) plus audit labels (3×), then move each question\'s threshold toward the lowest θ meeting its target precision (≤0.05/cycle, floored). Writes system1/calibration, which every run reads.',
    inputSchema: { type: 'object', properties: { token: tokenProp, runs: { type: 'number' }, apply: { type: 'boolean' }, async: asyncProp }, required: ['token'] },
  },
  {
    name: 'fetch',
    kind: 'read',
    description: 'Poll an async job: {status: pending|done|error, out?, error?}.',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'latest',
    kind: 'read',
    description: 'The most recent System One run summary (system1/latest) and the current calibration.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const handler = async (
  event: { requestContext?: { http?: { method?: string } }; rawPath?: string; body?: string; __job?: string },
  context?: { functionName?: string },
) => {
  SELF_FUNCTION = context?.functionName ?? SELF_FUNCTION;
  if (event.__job) {
    const job = (await jobs.getJob(event.__job)) as { input?: { tool: string; args: Record<string, unknown> } } | undefined;
    if (!job?.input) return;
    try {
      const out = await RUNNERS[job.input.tool](job.input.args);
      await jobs.putJob(event.__job, { status: 'done', out });
    } catch (e) {
      await jobs.putJob(event.__job, { status: 'error', error: (e as Error).message });
    }
    return;
  }
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'GET' && (path === '/' || path === '')) return json(200, { cell: '@c15r/system1', adr: 'ADR-0098', tools: TOOLS.map((t) => t.name) });
  if (method !== 'POST' || !path.startsWith('/_tools/')) return json(404, { error: `no route for ${method} ${path}` });
  const name = path.slice('/_tools/'.length);
  let args: Record<string, unknown> = {};
  try {
    args = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }
  try {
    if (name === 'fetch') {
      const item = (await jobs.getJob(String(args.jobId ?? ''))) as { status?: string; out?: unknown; error?: string } | undefined;
      return item ? json(200, { status: item.status, out: item.out, error: item.error }) : json(400, { error: `unknown job "${args.jobId}"` });
    }
    if (name === 'latest') {
      const reader = createCellReader(createDynamoStateStore(TABLE), OWNER);
      const [latest, cal] = await Promise.all([reader.peek(LATEST_KEY), reader.peek(CALIBRATION_KEY)]);
      return json(200, { latest: latest?.value ?? null, calibration: cal?.value ?? null });
    }
    const run = RUNNERS[name];
    if (!run) return json(404, { error: `unknown tool ${name}` });
    if (args.async) {
      if (!SELF_FUNCTION) return json(400, { error: 'async unavailable: function name unknown' });
      if (!args.token) return json(400, { error: 'token is required' });
      const jobId = randomUUID().slice(0, 13);
      const { async: _a, ...rest } = args;
      await jobs.submit(jobId, { input: { tool: name, args: rest } });
      return json(200, { jobId, status: 'pending', hint: 'poll fetch {jobId}; the run also lands at system1/latest' });
    }
    return json(200, await run(args));
  } catch (e) {
    return json(400, { error: (e as Error).message });
  }
};
