/* ---------------------------------------------------------------------------
 * Evaluate and climb — the loop from "Automating eval design and
 * hillclimbing", with a game definition as the thing being optimised:
 *
 *   eval     classify the definition once, then play every seed × player count
 *            of the suite concurrently (Jev batched per tick), judge and score
 *            each run, store runs + an eval record, bump the mechanics backlog.
 *            Train runs are fully readable; test runs are stored but only
 *            their aggregate score is ever returned (no leaking held-out
 *            transcripts into the next proposal).
 *   propose  one change per round: candidate definition → eval → keep only if
 *            train improves by ≥ epsilon AND test also improves; train up while
 *            test is flat is the overfitting signal → revert. Two or three
 *            rounds without a keep = stalled: diagnose, don't keep patching.
 * ------------------------------------------------------------------------- */
import { classify, play, judge, metrics, measuresOf, sessionFindings, HARNESS_VERSION, personaFor, type Classification, type Decide, type Finding, type Judgement, type Critique, CRITIQUE } from './runner';
import { scoreRun, scoreSuite, definitionHealth, outcomeBalance, genreBalance, targetsScore, targetsOf, measureMeans, SCORE_VERSION, type RunScore } from './score';
import type { DeductionReport } from './deduction';
import { engineFingerprint } from './fingerprint';
import * as db from './store';

const CONCURRENCY = 12;
export const STALL_ROUNDS = 3;

export interface RunDigest {
  id: string;
  split: 'train' | 'test';
  seed: number;
  players: number;
  score: number;
  parts?: RunScore['parts'];
  stopped?: string;
  endReason?: string | null;
  steps?: number;
  rounds?: number;
  verdict?: string | null;
  findings?: string[];
  critique?: Critique | null;
  persona?: string;
  /** The winner's secret role and how the game ended: 'objective' | 'time limit' | 'none'. */
  winnerRole?: string | null;
  /** Winning positions dealt this game (secret roles, else seats) — for outcome balance. */
  positions?: string[];
  winnerKey?: string | null;
  endKind?: string;
  /** v4: the deduction loop as played (hidden-role games) */
  deduction?: DeductionReport | null;
  /** v4.3: the mechanic's measures of this game (targets are set on their suite means) */
  measures?: Record<string, number> | null;
}

/** The suite balance: the genre band when the runs carry deduction reports, else outcome balance. */
export function suiteBalance(runs: RunDigest[]): { balance: number | null; genre: boolean } {
  const g = genreBalance(runs);
  return g === null ? { balance: outcomeBalance(runs), genre: false } : { balance: g, genre: true };
}

/** Train runs' critique, averaged: per dimension (0–4), and what the judge most often named. */
export interface CritiqueSummary {
  n: number;
  /** "The Trader · objective": 3 — who won, as what, and how, across the train games */
  outcomes?: Record<string, number>;
  /** mean run score and outcomes per player persona (h6) */
  byPersona?: Record<string, { n: number; score: number; outcomes: Record<string, number> }>;
  cause?: Array<[string, number]>;
  index: number | null;
  dims: Record<string, number>;
  weakest: Array<[string, number]>;
  strongest: Array<[string, number]>;
  fixes: Array<[string, number]>;
  /** v4: the deduction loop across the train games of a hidden-role game, as rates */
  deduction?: { n: number; exposed: number; exposedWithEvidence: number; enemyWon: number; wrongAccusationShare: number; accusationsPerGame: number; interaction: number; leadChanges: number };
}
export function summarizeCritique(runs: RunDigest[]): CritiqueSummary | null {
  const cs = runs.map((r) => r.critique).filter((c): c is Critique => !!c);
  if (!cs.length) return null;
  const mean = (xs: number[]) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : 0);
  const dims = Object.fromEntries(CRITIQUE.map((d) => [d.key, mean(cs.map((c) => c.dims[d.key]).filter((v): v is number => typeof v === 'number'))]));
  // Probability mass per label, summed over runs' top-3s, normalised by the number of runs.
  const tally = (pick: (c: Critique) => Array<[string, number]>) => {
    const t = new Map<string, number>();
    for (const c of cs) for (const [k, v] of pick(c)) t.set(k, (t.get(k) ?? 0) + v);
    return [...t].map(([k, v]) => [k, +(v / cs.length).toFixed(3)] as [string, number]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const byPersona: Record<string, { n: number; score: number; outcomes: Record<string, number> }> = {};
  for (const r of runs) {
    const p = r.persona ?? 'default';
    const b = (byPersona[p] ??= { n: 0, score: 0, outcomes: {} });
    b.n++;
    b.score += r.score;
    const k = r.winnerRole ? `${r.winnerRole} · ${r.endKind}` : 'no winner';
    b.outcomes[k] = (b.outcomes[k] ?? 0) + 1;
  }
  for (const b of Object.values(byPersona)) b.score = +(b.score / b.n).toFixed(4);
  const outcomes: Record<string, number> = {};
  for (const r of runs) {
    const k = r.winnerRole ? `${r.winnerRole} · ${r.endKind}` : `no winner · ${r.endKind ?? 'none'}`;
    outcomes[k] = (outcomes[k] ?? 0) + 1;
  }
  // v4: the deduction loop over the suite (hidden-role games), as rates.
  const ds = runs.map((r) => r.deduction).filter((d): d is DeductionReport => !!d && !!d.enemy);
  const rate = (f: (d: DeductionReport) => boolean) => (ds.length ? +(ds.filter(f).length / ds.length).toFixed(3) : 0);
  const accusations = ds.reduce((a, d) => a + d.accusations, 0);
  const deductionSummary = ds.length
    ? { n: ds.length, exposed: rate((d) => d.exposed), exposedWithEvidence: rate((d) => d.exposed && d.evidenceBeforeExposure === true), enemyWon: rate((d) => d.enemyWon), wrongAccusationShare: accusations ? +(ds.reduce((a, d) => a + d.wrong, 0) / accusations).toFixed(3) : 0, accusationsPerGame: +(accusations / ds.length).toFixed(2), interaction: +(ds.reduce((a, d) => a + d.interactiveShare, 0) / ds.length).toFixed(3), leadChanges: +(ds.reduce((a, d) => a + d.leadChanges, 0) / ds.length).toFixed(2) }
    : null;
  return { n: cs.length, outcomes, byPersona, cause: tally((c) => c.cause ?? []), index: mean(cs.map((c) => c.index).filter((v): v is number => typeof v === 'number')), dims, weakest: tally((c) => c.weakest), strongest: tally((c) => c.strongest), fixes: tally((c) => c.fixes), ...(deductionSummary ? { deduction: deductionSummary } : {}) };
}

export interface EvalRecord extends db.Item {
  id: string;
  game: string;
  version: number;
  defHash: string;
  engine: string;
  suite: string;
  scoreVersion: string;
  /** runner harness version (HARNESS_VERSION); evals compare only within one */
  harness?: string;
  /** runs cut off by the job deadline (their scores are not comparable; the eval is not a baseline) */
  incomplete?: number;
  definitionHealth: number;
  classificationFindings: Finding[];
  train: { score: number; balance?: number | null; runs: RunDigest[]; critique?: CritiqueSummary | null; targets?: ReturnType<typeof targetsScore> };
  test: { score: number; n: number; runs: Array<{ id: string; score: number }>; targets?: number | null };
  tokens: number;
  ms: number;
  tag: string;
  createdAt: string;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function recordBacklog(game: string, engine: string, findings: Finding[]) {
  const worth = findings.filter((f) => ['missing-implementation', 'partial-implementation', 'unhandled-effect', 'described-not-implemented', 'engine', 'unsuitable-action'].includes(f.kind));
  const seen = new Set<string>();
  for (const f of worth) {
    const k = `${f.kind}:${f.subject}`;
    if (seen.has(k)) continue;
    seen.add(k);
    try {
      await db.bumpBacklog(f.kind, f.subject, f.severity, f.detail, game, engine);
    } catch {
      /* the backlog is advisory; never fail an eval on it */
    }
  }
}

type RunSpec = { split: 'train' | 'test'; seed: number; players: number };

async function noteEngine() {
  const engine = engineFingerprint();
  // firstSeen is kept from the first eval on this engine (a plain put overwrote it every eval).
  await db
    .update('ENGINE', engine.version, 'SET #v = :v, #m = :m, #c = :c, #fm = :fm, #f = if_not_exists(#f, :now)', { ':v': engine.version, ':m': engine.mechanics, ':c': engine.core, ':fm': engine.method, ':now': new Date().toISOString() }, { '#v': 'version', '#m': 'mechanics', '#c': 'core', '#fm': 'method', '#f': 'firstSeen' })
    .catch(() => undefined);
  return engine;
}

function runSpecs(suite: db.Suite, cls: Classification): RunSpec[] {
  const out: RunSpec[] = [];
  for (const split of ['train', 'test'] as const) {
    for (const seed of suite[split].seeds) {
      for (const players of suite[split].players) {
        if (players >= cls.players.min && players <= cls.players.max) out.push({ split, seed, players });
      }
    }
  }
  return out;
}

/** Play, judge, score and store one run of an eval. */
async function playOne(o: { game: string; def: db.Definition; suite: db.Suite; cls: Classification; decide: Decide; deadlineAt: number; spec: RunSpec; engine: string }): Promise<{ digest: RunDigest; tokens: number }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(1000, o.deadlineAt - 20_000 - Date.now()));
  const persona = personaFor(o.spec.seed);
  const session = await play(o.def.rules, o.decide, { players: o.spec.players, seed: o.spec.seed, maxSteps: o.suite.maxSteps, signal: abort.signal, persona });
  clearTimeout(timer);
  let tokens = session.tokens;
  let judgement: Judgement | null = null;
  let findings: Finding[] = sessionFindings(session, metrics(session), o.cls);
  if (session.turns.length && Date.now() < o.deadlineAt - 5000) {
    try {
      const r = await judge(o.cls, session, o.decide);
      judgement = r.judgement;
      findings = r.findings;
      tokens += r.judgement.tokens;
    } catch {
      /* unjudged: the judged and critique terms score 0 */
    }
  }
  const sc = scoreRun(session, findings, judgement);
  const m = metrics(session);
  const id = db.newId();
  const digest: RunDigest = {
    id,
    split: o.spec.split,
    seed: o.spec.seed,
    players: o.spec.players,
    persona,
    score: sc.score,
    parts: sc.parts,
    deduction: sc.deduction ?? null,
    measures: measuresOf(session),
    stopped: session.stopped,
    endReason: m.endReason,
    steps: m.steps,
    rounds: m.rounds,
    verdict: judgement?.health.verdict ?? null,
    findings: findings.map((f) => `${f.severity}: ${f.subject}`),
    critique: judgement?.critique ?? null,
    winnerRole: session.winner ? (session.roles?.[session.winner] ?? null) : null,
    positions: session.roles && Object.keys(session.roles).length ? [...new Set(Object.values(session.roles))] : Array.from({ length: o.spec.players }, (_, i) => `seat ${i + 1}`),
    winnerKey: session.winner ? (session.roles?.[session.winner] ?? `seat ${Number(String(session.winner).replace(/\D/g, '')) || '?'}`) : null,
    endKind: !m.finished ? 'none' : /max[_ ]?(turns|rounds)|turn limit|round limit|timeout|time limit/i.test(m.endReason ?? '') ? 'time limit' : /wrong player/i.test(m.endReason ?? '') ? 'wrong accusation' : /denounc|accus/i.test(m.endReason ?? '') ? 'denounce' : 'objective',
  };
  const chunks = await db.putBlob(`RUN#${id}`, { session, judgement, findings });
  await db.put({ pk: `RUN#${id}`, sk: 'meta', ...digest, game: o.game, version: o.def.version, engine: o.engine, metrics: m, judgement, chunks, createdAt: new Date().toISOString() });
  await recordBacklog(o.game, o.engine, findings);
  return { digest, tokens };
}

/** Assemble and store the eval record from its runs (`missing` runs never reported). */
async function assemble(o: { game: string; def: { version: number; hash: string; rules?: string }; suite: db.Suite; cls: Classification; tag: string; engine: string; digests: RunDigest[]; missing: number; tokens: number; ms: number }): Promise<EvalRecord> {
  await recordBacklog(o.game, o.engine, o.cls.findings);
  const train = o.digests.filter((d) => d.split === 'train');
  const test = o.digests.filter((d) => d.split === 'test');
  const targets = o.def.rules ? targetsOf(o.def.rules) : null;
  const tTrain = targets ? targetsScore(measureMeans(train), targets) : null;
  const tTest = targets ? targetsScore(measureMeans(test), targets) : null;
  const rec: EvalRecord = {
    pk: '',
    sk: 'meta',
    id: db.newId(),
    game: o.game,
    version: o.def.version,
    defHash: o.def.hash,
    engine: o.engine,
    suite: db.suiteHash(o.suite),
    scoreVersion: SCORE_VERSION,
    harness: HARNESS_VERSION,
    incomplete: o.missing + o.digests.filter((d) => d.stopped === 'deadline').length,
    definitionHealth: definitionHealth(o.cls),
    classificationFindings: o.cls.findings,
    train: { score: scoreSuite(train.map((d) => d.score), o.cls, suiteBalance(train).balance, suiteBalance(train).genre, tTrain?.score ?? null), balance: suiteBalance(train).balance, runs: train, critique: summarizeCritique(train), targets: tTrain },
    test: { score: scoreSuite(test.map((d) => d.score), o.cls, suiteBalance(test).balance, suiteBalance(test).genre, tTest?.score ?? null), n: test.length, runs: test.map((d) => ({ id: d.id, score: d.score })), targets: tTest?.score ?? null },
    tokens: o.tokens,
    ms: o.ms,
    tag: o.tag,
    createdAt: new Date().toISOString(),
  };
  rec.pk = `EVAL#${rec.id}`;
  await db.put(rec);
  await db.put({ pk: `GAME#${o.game}`, sk: `EVAL#${rec.createdAt}#${rec.id}`, id: rec.id, version: rec.version, engine: rec.engine, suite: rec.suite, scoreVersion: rec.scoreVersion, train: rec.train.score, test: rec.test.score, tag: rec.tag, harness: rec.harness, incomplete: rec.incomplete, createdAt: rec.createdAt });
  return rec;
}

/** An eval inside one invocation (games concurrent, decisions batched) — local harness and small suites. */
export async function evaluate(opts: {
  game: string;
  def: db.Definition;
  suite: db.Suite;
  decide: Decide;
  deadlineAt: number;
  tag?: string;
  cls?: Classification;
}): Promise<EvalRecord> {
  const t0 = Date.now();
  const engine = (await noteEngine()).version;
  const cls = opts.cls ?? (await classify(opts.def.rules, opts.decide));
  let tokens = cls.tokens;
  const digests = await pool(runSpecs(opts.suite, cls), CONCURRENCY, async (spec) => {
    const r = await playOne({ ...opts, cls, spec, engine });
    tokens += r.tokens;
    return r.digest;
  });
  return assemble({ game: opts.game, def: opts.def, suite: opts.suite, cls, tag: opts.tag ?? 'eval', engine, digests, missing: 0, tokens, ms: Date.now() - t0 });
}

/* ── fan-out evals ──────────────────────────────────────────────────────
 * A game can take minutes (a 14-round AAOTE game is ~150 sequential Jev steps), so
 * one invocation can't play a whole suite inside its 300 s. A plan classifies once,
 * then every run is its own invocation (parallel, each with the full budget); each
 * run records its digest and bumps a counter, and the run that completes the set
 * assembles the eval and carries out what the job asked for (`then`). The job poll
 * finishes a plan whose runs went missing (a killed invocation) as incomplete.
 * PLAN#<id> meta | r<idx> (digests) · PLANCLS#<id> c<i> (the classification). */

export type PlanThen =
  | { kind: 'eval' }
  | { kind: 'noise'; baselineId: string }
  | { kind: 'propose'; baselineId: string; headVersion: number; rationale: string; author: string };

export interface Plan extends db.Item {
  id: string;
  jobId: string;
  game: string;
  version: number;
  defHash: string;
  tag: string;
  engine: string;
  suite: db.Suite;
  specs: RunSpec[];
  total: number;
  done?: number;
  tokens?: number;
  clsChunks: number;
  then: PlanThen;
  startedAt: string;
  finalized?: string;
  /** the assembled eval (set right after assembly) */
  evalId?: string;
  /** set once the job has its result */
  completed?: string;
}

/** Classify, store the plan; the caller fans out one invocation per run. */
export async function startPlan(o: { jobId: string; game: string; def: db.Definition; suite: db.Suite; decide: Decide; tag: string; then: PlanThen }): Promise<Plan> {
  const engine = (await noteEngine()).version;
  const cls = await classify(o.def.rules, o.decide);
  const id = db.newId();
  const clsChunks = await db.putBlob(`PLANCLS#${id}`, cls);
  const specs = runSpecs(o.suite, cls);
  const plan: Plan = { pk: `PLAN#${id}`, sk: 'meta', id, jobId: o.jobId, game: o.game, version: o.def.version, defHash: o.def.hash, tag: o.tag, engine, suite: o.suite, specs, total: specs.length, done: 0, tokens: cls.tokens, clsChunks, then: o.then, startedAt: new Date().toISOString() };
  await db.put(plan);
  // Index row, for the plans tool (recent fan-outs and where each one stands).
  await db.put({ pk: 'PLANS', sk: `${plan.startedAt}#${id}`, id, jobId: o.jobId, game: o.game, tag: o.tag, total: plan.total });
  return plan;
}

export async function getPlan(id: string): Promise<Plan | undefined> {
  return (await db.get(`PLAN#${id}`, 'meta')) as Plan | undefined;
}

/** One run of a plan. Returns true when this run completed the set (the caller finishes it). */
export async function runPlanned(planId: string, idx: number, decide: Decide, deadlineAt: number): Promise<boolean> {
  const plan = await getPlan(planId);
  if (!plan || plan.finalized) return false;
  const cls = (await db.getBlob<Classification>(`PLANCLS#${planId}`, plan.clsChunks))!;
  const def = (await db.get(`GAME#${plan.game}`, `DEF#${db.pad(plan.version)}`)) as db.Definition;
  const spec = plan.specs[idx];
  let digest: RunDigest;
  let tokens = 0;
  try {
    const r = await playOne({ game: plan.game, def, suite: plan.suite, cls, decide, deadlineAt, spec, engine: plan.engine });
    digest = r.digest;
    tokens = r.tokens;
  } catch (e) {
    digest = { id: `failed-${idx}`, split: spec.split, seed: spec.seed, players: spec.players, score: 0, stopped: 'deadline', endReason: `run failed: ${(e as Error).message}`.slice(0, 300), findings: [] };
  }
  await db.put({ pk: `PLAN#${planId}`, sk: `r${String(idx).padStart(3, '0')}`, digest });
  const after = await db.updateReturning(`PLAN#${planId}`, 'meta', 'ADD #d :one, #t :tok', { ':one': 1, ':tok': tokens }, { '#d': 'done', '#t': 'tokens' });
  return Number(after.done) >= plan.total;
}

/** Assemble the eval once (whoever gets here first); missing runs count as incomplete. */
export async function finishPlan(planId: string): Promise<{ plan: Plan; rec: EvalRecord } | null> {
  if (!(await db.claimOnce(`PLAN#${planId}`, 'meta', 'finalized'))) return null;
  const plan = (await getPlan(planId))!;
  const cls = (await db.getBlob<Classification>(`PLANCLS#${planId}`, plan.clsChunks))!;
  const digests = (await db.query(`PLAN#${planId}`, 'r')).map((r) => r.digest as RunDigest);
  const def = (await db.get(`GAME#${plan.game}`, `DEF#${db.pad(plan.version)}`)) as db.Definition | undefined;
  const rec = await assemble({ game: plan.game, def: { version: plan.version, hash: plan.defHash, rules: def?.rules }, suite: plan.suite, cls, tag: plan.tag, engine: plan.engine, digests, missing: plan.total - digests.length, tokens: Number(plan.tokens ?? 0), ms: Date.now() - Date.parse(plan.startedAt) });
  await db.update(`PLAN#${planId}`, 'meta', 'SET #e = :e', { ':e': rec.id }, { '#e': 'evalId' });
  return { plan: { ...plan, evalId: rec.id }, rec };
}

/** A plan whose eval was assembled but whose job never got its result (the finishing
 *  invocation died in between): hand back what's needed to complete it again. */
export async function resumePlan(planId: string): Promise<{ plan: Plan; rec: EvalRecord } | null> {
  const plan = await getPlan(planId);
  if (!plan?.evalId || plan.completed) return null;
  const rec = (await db.get(`EVAL#${plan.evalId}`, 'meta')) as EvalRecord | undefined;
  return rec ? { plan, rec } : null;
}

/** Recent plans, newest first, with where each stands. */
export async function recentPlans(limit = 10) {
  const rows = await db.query('PLANS', '', { newestFirst: true, limit });
  return Promise.all(
    rows.map(async (r) => {
      const p = await getPlan(String(r.id));
      return { id: r.id, jobId: r.jobId, game: r.game, tag: r.tag, total: p?.total, done: p?.done ?? 0, startedAt: p?.startedAt, finalized: p?.finalized ?? null, evalId: p?.evalId ?? null, completed: p?.completed ?? null };
    }),
  );
}

/** What the proposing agent may see of an eval: train in full, test as a number. */
export function publicEval(e: EvalRecord) {
  return {
    id: e.id,
    game: e.game,
    version: e.version,
    engine: e.engine,
    suite: e.suite,
    scoreVersion: e.scoreVersion,
    harness: e.harness ?? 'h1',
    incomplete: e.incomplete ?? 0,
    train: e.train,
    test: { score: e.test.score, n: e.test.n },
    definitionHealth: e.definitionHealth,
    classificationFindings: e.classificationFindings,
    tokens: e.tokens,
    usd: +(e.tokens * 0.042e-6).toFixed(4),
    ms: e.ms,
    tag: e.tag,
    createdAt: e.createdAt,
  };
}

/** An eval small enough for a job result (the gateway caps a read at 60 KB; 24 train runs
 *  with full critiques are ~70 KB): per-run scores, parts and outcomes, the train critique
 *  summary; everything else via eval_detail / run. */
export function compactEval(e: EvalRecord) {
  const p = publicEval(e);
  return {
    ...p,
    classificationFindings: p.classificationFindings.filter((f) => f.severity !== 'info').map((f) => `${f.severity}: ${f.kind} ${f.subject}`),
    train: {
      score: p.train.score,
      balance: p.train.balance ?? null,
      critique: p.train.critique ?? null,
      runs: p.train.runs.map((r) => ({ id: r.id, seed: r.seed, players: r.players, persona: r.persona, score: r.score, parts: r.parts, stopped: r.stopped, steps: r.steps, rounds: r.rounds, verdict: r.verdict, winnerRole: r.winnerRole, endKind: r.endKind, critique: r.critique?.index ?? null, deduction: r.deduction ?? null })),
    },
    detail: `read @c15r/playtest.eval_detail {id:"${e.id}"} for findings and full critiques`,
  };
}

/** Latest eval of (game, version) on this engine, suite and score version. */
export async function findEval(game: string, version: number, engine: string, suite: string): Promise<EvalRecord | null> {
  const list = await db.query(`GAME#${game}`, 'EVAL#', { newestFirst: true, limit: 50 });
  const hit = list.find((e) => e.version === version && e.engine === engine && e.suite === suite && e.scoreVersion === SCORE_VERSION && (e.harness ?? 'h1') === HARNESS_VERSION && !e.incomplete);
  return hit ? ((await db.get(`EVAL#${hit.id}`, 'meta')) as EvalRecord) : null;
}

export interface Round extends db.Item {
  round: number;
  from: number;
  to: number;
  rationale: string;
  author: string;
  baseline: { evalId: string; train: number; test: number };
  candidate: { evalId: string; train: number; test: number };
  delta: { train: number; test: number };
  epsilon: number;
  decision: 'kept' | 'reverted';
  reason: string;
  engine: string;
  createdAt: string;
  /** v4.3: each measure's train mean, baseline vs candidate, with the paired standard error of the difference */
  measures?: Record<string, { base: number; cand: number; delta: number; se: number | null }>;
  /** v4.3: the targets term, baseline vs candidate (train) */
  targets?: { base: number | null; cand: number | null };
}

/** Per-measure paired comparison of two evals' train runs (seed × players). */
export function measureDeltas(base: RunDigest[], cand: RunDigest[]): Round['measures'] {
  const key = (r: RunDigest) => `${r.seed}x${r.players}`;
  const b = new Map(base.map((r) => [key(r), r.measures ?? {}]));
  const keys = new Set([...base, ...cand].flatMap((r) => Object.keys(r.measures ?? {})));
  const out: NonNullable<Round['measures']> = {};
  for (const k of keys) {
    const pairs = cand.filter((r) => b.has(key(r)) && typeof r.measures?.[k] === 'number' && typeof b.get(key(r))?.[k] === 'number').map((r) => [b.get(key(r))![k], r.measures![k]] as [number, number]);
    if (!pairs.length) continue;
    const mb = pairs.reduce((a, [x]) => a + x, 0) / pairs.length;
    const mc = pairs.reduce((a, [, y]) => a + y, 0) / pairs.length;
    const d = pairs.map(([x, y]) => y - x);
    const md = d.reduce((a, x) => a + x, 0) / d.length;
    const se = d.length >= 3 ? Math.sqrt(d.reduce((a, x) => a + (x - md) ** 2, 0) / (d.length - 1)) / Math.sqrt(d.length) : null;
    out[k] = { base: +mb.toFixed(3), cand: +mc.toFixed(3), delta: +md.toFixed(3), se: se === null ? null : +se.toFixed(3) };
  }
  return out;
}

/** Standard error of the mean per-game difference, pairing runs by seed × players (the
 *  run score, before the suite's definition-health term), or null with < 3 pairs.
 *  `runWeight`: the runs' share of the suite score (.85 health-only, .75 with balance, .55 with targets). */
export function pairedSE(base: RunDigest[], cand: RunDigest[], runWeight = 0.85): number | null {
  const key = (r: RunDigest) => `${r.seed}x${r.players}`;
  const b = new Map(base.map((r) => [key(r), r.score]));
  const d = cand.filter((r) => b.has(key(r))).map((r) => r.score - (b.get(key(r)) as number));
  if (d.length < 3) return null;
  const mean = d.reduce((x, y) => x + y, 0) / d.length;
  const sd = Math.sqrt(d.reduce((x, y) => x + (y - mean) ** 2, 0) / (d.length - 1));
  // Suite score = runWeight × mean(run) + the rest, so the mean's SE scales by runWeight.
  return +((runWeight * sd) / Math.sqrt(d.length)).toFixed(4);
}

/** Check a proposal can be judged and store the candidate definition. */
export async function prepareProposal(o: { game: string; rules: string; rationale: string; author: string }): Promise<{ head: db.Definition; cand: db.Definition; baseline: EvalRecord; suite: db.Suite }> {
  const g = await db.getGame(o.game);
  if (!g) throw new Error(`unknown game ${o.game}`);
  const head = (await db.getDefinition(o.game)) as db.Definition;
  const suite = await db.getSuite(o.game);
  const engine = engineFingerprint().version;
  const baseline = await findEval(o.game, head.version, engine, db.suiteHash(suite));
  if (!baseline) throw new Error(`no baseline: eval ${o.game} v${head.version} on engine ${engine} (harness ${HARNESS_VERSION}) first — run the eval tool — then propose`);
  if (db.hash(o.rules) === head.hash) throw new Error('the candidate is identical to the head definition');
  const cand = await db.putDefinition(o.game, g.name, o.rules, { rationale: o.rationale, author: o.author, parent: head.version, asHead: false, status: 'candidate' });
  return { head, cand, baseline, suite };
}

/** Keep or revert a candidate against its baseline, and record the round. */
export async function decideRound(o: { game: string; headVersion: number; candVersion: number; baseline: EvalRecord; ev: EvalRecord; rationale: string; author: string; suite: db.Suite }): Promise<{ round: Round; eval: ReturnType<typeof compactEval>; stalled: boolean; diagnosis?: unknown }> {
  const { baseline, ev, suite } = o;
  // Completing a plan can be retried (watchdog): never record the same round twice.
  const prior = (await db.query(`GAME#${o.game}`, 'ROUND#')).find((r) => (r as unknown as Round).candidate?.evalId === ev.id) as Round | undefined;
  if (prior) return { round: prior, eval: compactEval(ev), stalled: false };
  const dTrain = +(ev.train.score - baseline.train.score).toFixed(4);
  const dTest = +(ev.test.score - baseline.test.score).toFixed(4);
  // Baseline and candidate play the same seeds × player counts, so the per-game
  // differences give a paired standard error: a change must also clear that.
  const se = pairedSE(baseline.train.runs, ev.train.runs, ev.train.targets ? 0.55 : ev.train.balance != null ? 0.75 : 0.85);
  const measures = measureDeltas(baseline.train.runs, ev.train.runs);
  const targets = { base: baseline.train.targets?.score ?? null, cand: ev.train.targets?.score ?? null };
  const eps = +Math.max(suite.epsilon, suite.noise ?? 0, se ?? 0).toFixed(4);
  let decision: Round['decision'] = 'reverted';
  let reason: string;
  const inconclusive = !!ev.incomplete;
  if (inconclusive) {
    reason = `inconclusive: ${ev.incomplete} run(s) hit the deadline or never reported, so the candidate's scores aren't comparable — reverted without counting toward a stall`;
  } else if (dTrain >= eps && dTest > 0) {
    decision = 'kept';
    reason = `train +${dTrain} (≥ ε ${eps}: max of epsilon ${suite.epsilon}, noise ${suite.noise ?? '—'}, paired SE ${se ?? '—'}) and test +${dTest}`;
  } else if (dTrain >= eps) reason = `train +${dTrain} but test ${dTest >= 0 ? '+' : ''}${dTest}: overfitting signal — reverted`;
  else reason = `train ${dTrain >= 0 ? '+' : ''}${dTrain} is below ε ${eps} (max of epsilon ${suite.epsilon}, noise ${suite.noise ?? '—'}, paired SE ${se ?? '—'}) — no real improvement`;

  const fresh = (await db.getGame(o.game)) as db.GameIndex;
  const climb = fresh.climb ?? { rounds: 0, stall: 0, status: 'idle' as const };
  climb.rounds += 1;
  climb.stall = decision === 'kept' ? 0 : inconclusive ? climb.stall : climb.stall + 1;
  climb.status = climb.stall >= STALL_ROUNDS ? 'stalled' : 'climbing';
  if (decision === 'kept') {
    await db.setDefinitionStatus(o.game, o.headVersion, 'kept');
    await db.setDefinitionStatus(o.game, o.candVersion, 'head');
    fresh.head = o.candVersion;
    fresh.best = o.candVersion;
  } else await db.setDefinitionStatus(o.game, o.candVersion, 'reverted');
  fresh.climb = climb;
  await db.setGame(fresh);

  const round: Round = {
    pk: `GAME#${o.game}`,
    sk: `ROUND#${db.pad(climb.rounds)}`,
    round: climb.rounds,
    from: o.headVersion,
    to: o.candVersion,
    rationale: o.rationale,
    author: o.author,
    baseline: { evalId: baseline.id, train: baseline.train.score, test: baseline.test.score },
    candidate: { evalId: ev.id, train: ev.train.score, test: ev.test.score },
    measures,
    targets,
    delta: { train: dTrain, test: dTest },
    epsilon: eps,
    decision,
    reason,
    engine: ev.engine,
    createdAt: new Date().toISOString(),
  };
  await db.put(round);
  const stalled = climb.status === 'stalled';
  return { round, eval: compactEval(ev), stalled, ...(stalled ? { diagnosis: diagnose(ev) } : {}) };
}

/** A whole round inside one invocation (local harness). */
export async function proposeRound(opts: { game: string; rules: string; rationale: string; author: string; decide: Decide; deadlineAt: number }) {
  const p = await prepareProposal(opts);
  const ev = await evaluate({ game: opts.game, def: p.cand, suite: p.suite, decide: opts.decide, deadlineAt: opts.deadlineAt, tag: 'propose' });
  return decideRound({ game: opts.game, headVersion: p.head.version, candVersion: p.cand.version, baseline: p.baseline, ev, rationale: opts.rationale, author: opts.author, suite: p.suite });
}

/** At a stall: where the train runs lose points, and what keeps showing up. */
export function diagnose(ev: EvalRecord) {
  const runs = ev.train.runs.filter((r) => r.parts);
  const keys = ['ended', 'variety', 'agency', 'pace', 'clean', 'judged', 'critique'] as const;
  const weakest = keys
    .map((k) => ({ part: k, mean: +(runs.reduce((a, r) => a + (r.parts?.[k] ?? 0), 0) / (runs.length || 1)).toFixed(3) }))
    .sort((a, b) => a.mean - b.mean);
  const counts = new Map<string, number>();
  for (const r of runs) for (const f of r.findings ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  return {
    note: 'Stalled: stop patching and diagnose. Weakest score parts first; recurring findings next — some are engine or mechanic gaps no definition edit can fix (see the backlog tool).',
    weakest,
    critique: ev.train.critique
      ? { weakestDimensions: Object.entries(ev.train.critique.dims).sort((a, b) => a[1] - b[1]).slice(0, 5), namedWeakest: ev.train.critique.weakest, suggestedFixes: ev.train.critique.fixes, cause: ev.train.critique.cause, outcomes: ev.train.critique.outcomes }
      : null,
    recurring: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10),
    classification: ev.classificationFindings.map((f) => `${f.severity}: ${f.kind} ${f.subject}`),
  };
}
