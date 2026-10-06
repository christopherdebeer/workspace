/* ---------------------------------------------------------------------------
 * @c15r/playtest — game development by hill-climbing Jev playtests.
 *
 * Owns the playtest engine (engine/, vendored from christopherdebeer/playtest
 * and evolved HERE: mechanics are added and fixed in this cell, and every run
 * records the engine fingerprint so an improvement shows up as an eval delta).
 *
 *   definitions  versioned RULES.md per game (frontmatter = what the engine
 *                runs, prose = what Jev reads); edits by exact find/replace
 *   playtest     one game, Jev choosing every move (code enumerates, the
 *                engine's validator masks, Jev picks), judged and scored
 *   eval         a definition over its suite: train seeds (readable) and
 *                held-out test seeds (score only) — score/v2
 *   propose      one hill-climb round: candidate → eval → keep only if train
 *                improves ≥ ε AND test improves; else revert; stall after 3
 *   backlog      what evals keep hitting: missing / partial mechanics, card
 *                effects nothing handles, engine faults — the mechanic worklist
 *
 * Long work (eval, propose, playtest, regress) runs as ONE async self-invoke
 * (≤300 s) and is polled with `job`; never chained. Jev is reached through the
 * /mcp gateway with the owner's scoped token (set_token), batched per tick.
 * ------------------------------------------------------------------------- */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
// eslint-disable-next-line import/no-unresolved
import { cellJobs } from './vendor/cell-jobs.js';
import { PRESETS } from './engine/presets';
import VENDOR from './engine/vendor-info';
import { classify, play, judge, metrics, sessionFindings, CRITIQUE, CRITIQUE_FIXES, HARNESS_VERSION } from './lib/runner';
import { scoreRun, SCORE_VERSION, WEIGHTS, WEIGHTS_HIDDEN_ROLE } from './lib/score';
import { engineFingerprint, changedMechanics } from './lib/fingerprint';
import { jevClient } from './lib/jev';
import { evaluate, proposeRound, prepareProposal, decideRound, startPlan, runPlanned, finishPlan, getPlan, resumePlan, recentPlans, publicEval, compactEval, findEval, diagnose, STALL_ROUNDS, type EvalRecord, type RunDigest, type Plan } from './lib/evaluate';
import * as db from './lib/store';
import { screen } from './lib/screen';
import * as pub from './lib/public';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = process.env.CELL_OWNER ?? 'c15r';
const JOB_BUDGET_MS = 270_000; // Lambda timeout 300 s; leave room to write the result
const PLAN_WATCHDOG_MS = 330_000; // every run has its own ≤300 s invocation; past this, missing runs are dead
let SELF_FUNCTION = '';
const lambda = new LambdaClient({});

const jobs = cellJobs({
  put: (item: db.Item) => db.put(item),
  get: (key: { pk: string; sk: string }) => db.get(key.pk, key.sk),
  invokeSelf: async (payload: unknown) => {
    await lambda.send(new InvokeCommand({ FunctionName: SELF_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
  },
});

type Args = Record<string, any>;
class ToolError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const need = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new ToolError(`${name} is required`);
  return v.trim();
};
const num = (v: unknown, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : d));

async function decider() {
  const token = await db.getJevToken();
  if (!token) throw new ToolError('no Jev token configured — the owner calls set_token with a token scoped to @c15r/jev', 503);
  return jevClient(token);
}

/** Apply exact find/replace edits to a definition (each `find` must occur exactly once). */
function applyEdits(rules: string, edits: Array<{ find: string; replace: string }>): string {
  let out = rules;
  for (const [i, e] of edits.entries()) {
    if (typeof e?.find !== 'string' || typeof e?.replace !== 'string') throw new ToolError(`edits[${i}] needs find and replace strings`);
    const n = out.split(e.find).length - 1;
    if (n !== 1) throw new ToolError(`edits[${i}].find occurs ${n} times in the definition (must be exactly once)`);
    out = out.replace(e.find, () => e.replace);
  }
  return out;
}

async function resolveRules(a: Args, game?: string): Promise<{ rules: string; base?: db.Definition }> {
  if (typeof a.rules === 'string' && a.rules.trim()) return { rules: a.rules };
  if (Array.isArray(a.edits)) {
    if (!game) throw new ToolError('edits need an existing game');
    const base = await db.getDefinition(game, a.base !== undefined ? Number(a.base) : undefined);
    if (!base) throw new ToolError(`no definition for ${game}${a.base !== undefined ? ` v${a.base}` : ''}`);
    return { rules: applyEdits(base.rules, a.edits), base };
  }
  throw new ToolError('give rules (a full RULES.md) or edits ([{find, replace}] against the head)');
}

async function gameOrThrow(slug: string) {
  const g = await db.getGame(slug);
  if (!g) throw new ToolError(`unknown game "${slug}" — create it with put_definition`, 404);
  return g;
}

/* ── long work (runs inside the job invocation) ─────────────────────── */

/** Returned by a job that planned a fan-out: the handler records the plan on the job,
 *  then starts the runs; the job stays running until the plan finishes. */
type Planned = { __plan: Plan };
const planned = (plan: Plan): Planned => ({ __plan: plan });
const isPlanned = (x: unknown): x is Planned => !!x && typeof x === 'object' && '__plan' in (x as object);

/** Start one invocation per run of a plan. */
async function fanOut(plan: Plan) {
  await Promise.all(plan.specs.map((_, idx) => lambda.send(new InvokeCommand({ FunctionName: SELF_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ __run: { plan: plan.id, idx } })) }))));
}

/** What a finished plan's job asked for: the eval, a noise measurement, or a climb decision. */
async function completePlan(plan: Plan, rec: EvalRecord): Promise<unknown> {
  const t = plan.then;
  if (t.kind === 'noise') {
    const base = (await db.get(`EVAL#${t.baselineId}`, 'meta')) as EvalRecord;
    const suite = await db.getSuite(plan.game);
    const noise = +Math.max(Math.abs(rec.train.score - base.train.score), Math.abs(rec.test.score - base.test.score)).toFixed(4);
    // Noise is a property of (engine, harness, suite): within one context the largest rerun
    // gap stands; a new context replaces it. An incomplete rerun measures the deadline, not
    // chance: report it, don't store it.
    const context = `${plan.engine}/${HARNESS_VERSION}/${db.suiteHash(suite)}`;
    const stored = suite.noiseContext === context ? Math.max(noise, suite.noise ?? 0) : noise;
    if (!rec.incomplete) await db.setSuite(plan.game, { ...suite, noise: stored, noiseContext: context });
    return { noise, stored: rec.incomplete ? null : stored, context, previousNoise: suite.noise ?? null, epsilon: suite.epsilon, effectiveThreshold: Math.max(suite.epsilon, rec.incomplete ? suite.noise ?? 0 : stored), baseline: { train: base.train.score, test: base.test.score }, rerun: { id: rec.id, train: rec.train.score, test: rec.test.score, incomplete: rec.incomplete } };
  }
  if (t.kind === 'propose') {
    const base = (await db.get(`EVAL#${t.baselineId}`, 'meta')) as EvalRecord;
    return decideRound({ game: plan.game, headVersion: t.headVersion, candVersion: plan.version, baseline: base, ev: rec, rationale: t.rationale, author: t.author, suite: plan.suite });
  }
  return { eval: compactEval(rec) };
}

async function finishAndComplete(planId: string, resume = false) {
  const done = resume ? await resumePlan(planId) : await finishPlan(planId);
  if (!done) return;
  const job = (await jobs.getJob(done.plan.jobId)) as Record<string, unknown> | undefined;
  try {
    const out = await completePlan(done.plan, done.rec);
    await jobs.putJob(done.plan.jobId, { tool: job?.tool, startedAt: job?.startedAt, plan: planId, status: 'done', out, finishedAt: new Date().toISOString() });
    await db.update(`PLAN#${planId}`, 'meta', 'SET #c = :c', { ':c': new Date().toISOString() }, { '#c': 'completed' });
  } catch (e) {
    console.error('completing plan failed', planId, (e as Error).message);
    await jobs.putJob(done.plan.jobId, { tool: job?.tool, startedAt: job?.startedAt, plan: planId, status: 'error', error: (e as Error).message, finishedAt: new Date().toISOString() });
  }
}

const LONG: Record<string, (a: Args, caller: string, deadlineAt: number, jobId?: string) => Promise<unknown>> = {
  async eval(a, _caller, deadlineAt, jobId) {
    const game = need(a.game, 'game');
    await gameOrThrow(game);
    const def = await db.getDefinition(game, a.version !== undefined ? Number(a.version) : undefined);
    if (!def) throw new ToolError(`no version ${a.version} of ${game}`);
    const suite = await db.getSuite(game);
    const { decide, meter } = await decider();
    if (jobId) {
      return planned(await startPlan({ jobId, game, def, suite, decide, tag: String(a.tag ?? 'eval'), then: { kind: 'eval' } }));
    }
    const ev = await evaluate({ game, def, suite, decide, deadlineAt, tag: String(a.tag ?? 'eval') });
    return { eval: compactEval(ev), jev: meter };
  },

  async propose(a, caller, deadlineAt, jobId) {
    const game = need(a.game, 'game');
    await gameOrThrow(game);
    const { rules } = await resolveRules(a, game);
    const { decide, meter } = await decider();
    if (jobId) {
      const rationale = need(a.rationale, 'rationale');
      const p = await prepareProposal({ game, rules, rationale, author: caller });
      return planned(await startPlan({ jobId, game, def: p.cand, suite: p.suite, decide, tag: 'propose', then: { kind: 'propose', baselineId: p.baseline.id, headVersion: p.head.version, rationale, author: caller } }));
    }
    const out = await proposeRound({ game, rules, rationale: need(a.rationale, 'rationale'), author: caller, decide, deadlineAt });
    return { ...out, jev: meter };
  },

  /** The post's first step: how far does the score move by chance alone? Re-evaluates the head
   *  and compares with the baseline on the same engine + suite; the larger delta becomes the
   *  suite's noise floor (proposals must beat max(epsilon, noise)). */
  async noise(a, _caller, deadlineAt, jobId) {
    const game = need(a.game, 'game');
    const g = await gameOrThrow(game);
    const suite = await db.getSuite(game);
    const base = await findEval(game, g.head, engineFingerprint().version, db.suiteHash(suite));
    if (!base) throw new ToolError('no baseline yet — run eval first');
    const def = (await db.getDefinition(game)) as db.Definition;
    const { decide, meter } = await decider();
    if (jobId) {
      return planned(await startPlan({ jobId, game, def, suite, decide, tag: 'noise', then: { kind: 'noise', baselineId: base.id } }));
    }
    const again = await evaluate({ game, def, suite, decide, deadlineAt, tag: 'noise' });
    const noise = +Math.max(Math.abs(again.train.score - base.train.score), Math.abs(again.test.score - base.test.score)).toFixed(4);
    await db.setSuite(game, { ...suite, noise: Math.max(noise, suite.noise ?? 0) });
    return { noise, previousNoise: suite.noise ?? null, epsilon: suite.epsilon, effectiveThreshold: Math.max(suite.epsilon, noise, suite.noise ?? 0), baseline: { train: base.train.score, test: base.test.score }, rerun: { train: again.train.score, test: again.test.score }, jev: meter };
  },

  async playtest(a, _caller, deadlineAt) {
    let rules: string;
    let version: number | null = null;
    if (a.game && !a.rules) {
      const def = await db.getDefinition(need(a.game, 'game'), a.version !== undefined ? Number(a.version) : undefined);
      if (!def) throw new ToolError(`no definition for ${a.game}`);
      rules = def.rules;
      version = def.version;
    } else rules = a.preset ? PRESETS[String(a.preset)] ?? '' : String(a.rules ?? '');
    if (!rules.trim()) throw new ToolError('give game (+version), rules, or preset');
    const { decide, meter } = await decider();
    const cls = await classify(rules, decide);
    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), Math.max(1000, deadlineAt - Date.now()));
    const s = await play(rules, decide, { players: num(a.players, cls.players.min, 1, 8), seed: num(a.seed, 1, 0, 1e9), maxSteps: num(a.maxSteps, 150, 5, 400), persona: a.persona ? String(a.persona) : undefined, signal: abort.signal });
    clearTimeout(t);
    const j = s.turns.length ? await judge(cls, s, decide) : { judgement: null, findings: sessionFindings(s, metrics(s), cls) };
    const sc = scoreRun(s, j.findings, j.judgement);
    const id = db.newId();
    const chunks = await db.putBlob(`RUN#${id}`, { session: s, judgement: j.judgement, findings: j.findings, classification: cls });
    const m = metrics(s);
    await db.put({ pk: `RUN#${id}`, sk: 'meta', id, split: 'adhoc', game: a.game ?? null, version, seed: s.seed, players: s.players, score: sc.score, parts: sc.parts, stopped: s.stopped, endReason: m.endReason, steps: m.steps, rounds: m.rounds, engine: engineFingerprint().version, metrics: m, judgement: j.judgement, chunks, createdAt: new Date().toISOString() });
    return { run: id, score: sc, metrics: m, judgement: j.judgement, findings: [...cls.findings, ...j.findings], jev: meter, turns: s.turns.slice(0, 400).map((t) => `${t.step} r${t.round} ${t.player} [${t.valid}] ${t.label}${t.confidence != null ? ` (${Math.round(t.confidence * 100)}%)` : ''}`) };
  },
};

/* ── tools ──────────────────────────────────────────────────────────── */

async function tool(name: string, a: Args, caller: string): Promise<unknown> {
  const owner = caller === OWNER;
  switch (name) {
    case 'status': {
      const fp = engineFingerprint();
      return {
        cell: '@c15r/playtest',
        engine: { version: fp.version, mechanics: Object.keys(fp.mechanics).length, vendoredFrom: VENDOR },
        scoreVersion: SCORE_VERSION,
        jevToken: !!(await db.getJevToken()),
        presets: Object.keys(PRESETS),
        stallRounds: STALL_ROUNDS,
        loop: 'put_definition → eval (baseline) → propose (one change per round, rationale required) → … until stalled → diagnose; backlog lists the engine/mechanic gaps no definition edit can fix',
      };
    }
    case 'set_token': {
      if (!owner) throw new ToolError('set_token is owner-only', 403);
      await db.putJevToken(need(a.token, 'token'));
      return { ok: true };
    }
    case 'games':
      return (await db.listGames()).map(({ pk: _p, sk: _s, ...g }) => g);
    case 'definition': {
      const game = need(a.game, 'game');
      const g = await gameOrThrow(game);
      const d = await db.getDefinition(game, a.version !== undefined ? Number(a.version) : undefined);
      if (!d) throw new ToolError(`no version ${a.version}`, 404);
      const versions = (await db.query(`GAME#${game}`, 'DEF#')).map((v) => ({ version: v.version, status: v.status, parent: v.parent, rationale: v.rationale, hash: v.hash, createdAt: v.createdAt }));
      return { game: g, definition: { version: d.version, status: d.status, rules: d.rules, rationale: d.rationale, parent: d.parent, hash: d.hash }, versions };
    }
    case 'put_definition': {
      let game = a.game ? db.slugify(String(a.game)) : '';
      let rules: string;
      if (a.preset) {
        rules = PRESETS[String(a.preset)] ?? '';
        if (!rules) throw new ToolError(`unknown preset ${a.preset}; see status.presets`);
        game ||= db.slugify(String(a.preset));
      } else ({ rules } = await resolveRules(a, game || undefined));
      const name = /^name:\s*"?([^"\n]+)"?/m.exec(rules)?.[1]?.trim() ?? game;
      game ||= db.slugify(name);
      const existing = await db.getGame(game);
      const head = existing ? await db.getDefinition(game) : undefined;
      if (head && head.hash === db.hash(rules)) return { game, version: head.version, unchanged: true };
      // A direct put is a deliberate reset of the head (outside a climb); proposals go through propose.
      const def = await db.putDefinition(game, name, rules, { rationale: String(a.rationale ?? (existing ? 'manual edit' : 'initial')), author: caller, parent: head?.version ?? null, asHead: true, status: 'head' });
      if (head) await db.setDefinitionStatus(game, head.version, 'kept');
      return { game, version: def.version, hash: def.hash, note: existing ? 'new head (direct edit — the climb baseline must be re-evaluated)' : 'created — set_suite (optional), then eval for a baseline' };
    }
    case 'classify': {
      const rules = a.game ? (await db.getDefinition(need(a.game, 'game'), a.version !== undefined ? Number(a.version) : undefined))?.rules : a.preset ? PRESETS[String(a.preset)] : a.rules;
      if (!rules) throw new ToolError('give game (+version), rules, or preset');
      const { decide, meter } = await decider();
      const c = await classify(String(rules), decide);
      return { ...c, prose: c.prose.slice(0, 20), jev: meter };
    }
    case 'suite': {
      const game = need(a.game, 'game');
      await gameOrThrow(game);
      const s = await db.getSuite(game);
      return { ...s, hash: db.suiteHash(s) };
    }
    case 'set_suite': {
      if (!owner) throw new ToolError('set_suite is owner-only (it moves the goalposts)', 403);
      const game = need(a.game, 'game');
      await gameOrThrow(game);
      const cur = await db.getSuite(game);
      const ints = (v: unknown, d: number[]) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite).slice(0, 48) : d);
      const s: db.Suite = {
        train: { seeds: ints(a.train?.seeds, cur.train.seeds), players: ints(a.train?.players, cur.train.players) },
        test: { seeds: ints(a.test?.seeds, cur.test.seeds), players: ints(a.test?.players, cur.test.players) },
        maxSteps: num(a.maxSteps, cur.maxSteps, 10, 300),
        epsilon: num(a.epsilon, cur.epsilon, 0, 0.5),
      };
      // Noise belongs to the suite it was measured on: a new suite starts unmeasured.
      if (db.suiteHash(s) === db.suiteHash(cur)) Object.assign(s, { noise: cur.noise, noiseContext: cur.noiseContext });
      if (s.train.seeds.some((x) => s.test.seeds.includes(x))) throw new ToolError('train and test seeds must not overlap');
      const games = (s.train.seeds.length * s.train.players.length + s.test.seeds.length * s.test.players.length);
      if (games > 96) throw new ToolError(`${games} games per eval is too many (≤ 96; each is its own invocation)`);
      await db.setSuite(game, s);
      return { ...s, hash: db.suiteHash(s), note: 'a new suite hash — previous evals no longer count as baselines' };
    }
    case 'evals': {
      const game = need(a.game, 'game');
      return (await db.query(`GAME#${game}`, 'EVAL#', { newestFirst: true, limit: num(a.limit, 20, 1, 100) })).map(({ pk: _p, sk: _s, ...e }) => e);
    }
    case 'eval_detail': {
      const e = (await db.get(`EVAL#${need(a.id, 'id')}`, 'meta')) as EvalRecord | undefined;
      if (!e) throw new ToolError('unknown eval', 404);
      return { ...publicEval(e), ...(a.diagnose ? { diagnosis: diagnose(e) } : {}) };
    }
    case 'run': {
      const id = need(a.id, 'id');
      const meta = (await db.get(`RUN#${id}`, 'meta')) as (RunDigest & { chunks: number }) | undefined;
      if (!meta) throw new ToolError('unknown run', 404);
      if (meta.split === 'test') return { id, split: 'test', score: meta.score, note: 'held-out run: only its score is visible (see the post — never paste held-out failures into a proposal)' };
      const view = String(a.view ?? 'summary');
      const { chunks: _c, pk: _p, sk: _s, ...summary } = meta as unknown as Record<string, unknown>;
      if (view === 'summary') return summary;
      const blob = await db.getBlob<{ session: { turns: Array<Record<string, any>>; log: unknown[] }; judgement: unknown; findings: unknown; classification?: unknown }>(`RUN#${id}`, meta.chunks);
      if (!blob) throw new ToolError('run detail missing', 404);
      if (view === 'turns') {
        const from = num(a.from, 0, 0, 1e6);
        return { ...summary, turns: blob.session.turns.slice(from, from + num(a.limit, 200, 1, 400)).map((t) => ({ step: t.step, round: t.round, turn: t.turn, player: t.player, valid: t.valid, move: t.label, confidence: t.confidence, runnerUp: t.top?.[1] ?? null, ahead: t.ahead, fallback: t.fallback })) };
      }
      if (view === 'log') return { ...summary, log: blob.session.log.slice(num(a.from, 0, 0, 1e6), num(a.from, 0, 0, 1e6) + num(a.limit, 300, 1, 1000)) };
      return { ...summary, findings: blob.findings, judgement: blob.judgement };
    }
    case 'climb_log': {
      const game = need(a.game, 'game');
      const g = await gameOrThrow(game);
      const rounds = (await db.query(`GAME#${game}`, 'ROUND#')).map(({ pk: _p, sk: _s, ...r }) => r);
      return { game, head: g.head, best: g.best, climb: g.climb, rounds };
    }
    case 'backlog': {
      const items = (await db.query('BACKLOG')).map(({ pk: _p, sk: _s, games, ...b }) => ({ ...b, games: games instanceof Set ? [...games] : games }) as Record<string, any>);
      const kind = a.kind ? String(a.kind) : null;
      return items
        .filter((b) => !kind || b.kind === kind)
        .sort((x, y) => (Number(y.hits) || 0) * ((y.games as string[])?.length ?? 1) - (Number(x.hits) || 0) * ((x.games as string[])?.length ?? 1))
        .slice(0, num(a.limit, 50, 1, 200));
    }
    case 'engines': {
      const list = (await db.query('ENGINE')).sort((x, y) => String(x.firstSeen).localeCompare(String(y.firstSeen)));
      return list.map((e, i) => ({ version: e.version, firstSeen: e.firstSeen, mechanics: Object.keys((e.mechanics as object) ?? {}).length, changedFromPrevious: i ? changedMechanics((list[i - 1].mechanics as Record<string, string>) ?? {}, (e.mechanics as Record<string, string>) ?? {}) : null }));
    }
    case 'screen': {
      // Free structural preview of a design (no Jev): rules, preset, or a stored version.
      const rules = a.rules ? String(a.rules) : a.preset ? PRESETS[String(a.preset)] : a.edits ? (await resolveRules(a, need(a.game, 'game'))).rules : a.game ? (await db.getDefinition(need(a.game, 'game'), a.version !== undefined ? Number(a.version) : undefined))?.rules : undefined;
      if (!rules) throw new ToolError('give rules, preset, or game (+version / edits)');
      const suite = a.game ? await db.getSuite(String(a.game)) : null;
      const ints = (v: unknown, d: number[]) => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite).slice(0, 24) : d);
      return screen(rules, { seeds: ints(a.seeds, suite?.train.seeds ?? [1, 2, 3, 4, 5, 6]), players: ints(a.players, suite?.train.players ?? [3, 4]), maxSteps: num(a.maxSteps, suite?.maxSteps ?? 300, 10, 400), deadlineAt: Date.now() + 40_000, policy: a.policy === 'random' ? 'random' : 'greedy' });
    }
    case 'plans':
      return recentPlans(num(a.limit, 10, 1, 50));
    case 'job': {
      const id = need(a.id, 'id');
      let j = (await jobs.getJob(id)) as { status?: string; out?: unknown; error?: string; tool?: string; startedAt?: string; plan?: string } | undefined;
      if (!j) throw new ToolError('unknown job', 404);
      let progress: Record<string, unknown> | undefined;
      if (j.status === 'running' && j.plan) {
        const plan = await getPlan(j.plan);
        if (plan) {
          progress = { runs: plan.total, done: plan.done ?? 0 };
          // Watchdog: a run invocation that was killed never reports; finish without it.
          const age = Date.now() - Date.parse(plan.startedAt);
          if (!plan.finalized && age > PLAN_WATCHDOG_MS) {
            await finishAndComplete(plan.id);
            j = (await jobs.getJob(id)) as typeof j;
          } else if (plan.evalId && !plan.completed && Date.now() - Date.parse(plan.finalized ?? plan.startedAt) > 30_000) {
            // Assembled, but the job never got its result: complete it from the stored eval.
            await finishAndComplete(plan.id, true);
            j = (await jobs.getJob(id)) as typeof j;
          }
        }
      }
      return { status: j!.status, tool: j!.tool, startedAt: j!.startedAt, progress, out: j!.out, error: j!.error };
    }
    case 'regress': {
      // Re-evaluate every game's head on the current engine: one job per game.
      const games = Array.isArray(a.games) ? a.games.map(String) : (await db.listGames()).map((g) => g.slug);
      const started: Record<string, string> = {};
      for (const game of games.slice(0, 20)) {
        const id = db.newId();
        await jobs.submit(id, { tool: 'eval', args: { game, tag: 'regress' }, caller, startedAt: new Date().toISOString() });
        started[game] = id;
      }
      return { engine: engineFingerprint().version, jobs: started, note: 'poll each with job; compare with evals (grouped by engine)' };
    }
    case 'baseline': {
      const game = need(a.game, 'game');
      const g = await gameOrThrow(game);
      const suite = await db.getSuite(game);
      const e = await findEval(game, g.head, engineFingerprint().version, db.suiteHash(suite));
      return e ? publicEval(e) : { none: true, note: `no eval of v${g.head} on this engine + suite yet — run eval` };
    }
  }
  if (name in LONG) {
    if (a.async === false) {
      const out = await LONG[name](a, caller, Date.now() + 50_000);
      return out;
    }
    const id = db.newId();
    await jobs.submit(id, { tool: name, args: a, caller, startedAt: new Date().toISOString() });
    return { job: id, status: 'pending', poll: `read @c15r/playtest.job {id:"${id}"}` };
  }
  throw new ToolError(`unknown tool ${name}`, 404);
}

/* ── catalogue ──────────────────────────────────────────────────────── */

const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required });
const game = { type: 'string', description: 'game slug' };
const version = { type: 'number', description: 'definition version (default: head)' };
const edits = { type: 'array', description: 'exact edits against the head: [{find, replace}], each find occurring once', items: { type: 'object' } };
const rules = { type: 'string', description: 'a full RULES.md (YAML frontmatter + prose)' };

const TOOLS = [
  { name: 'status', kind: 'read', description: 'Engine version (code fingerprint), score version, whether the Jev token is set, presets, and the hill-climb loop in one line.', inputSchema: S({}) },
  { name: 'games', kind: 'read', description: 'Every game: head and best versions, climb state (rounds, stall, status).', inputSchema: S({}) },
  { name: 'definition', kind: 'read', description: 'A definition version (default head) with its RULES.md, and the version history with rationale and status (head/kept/reverted/candidate).', inputSchema: S({ game, version }, ['game']) },
  { name: 'put_definition', kind: 'act', description: 'Create a game or reset its head directly: from a catalogue preset, full rules, or exact edits. (Inside a climb use propose — a direct put is not evaluated.)', inputSchema: S({ game, preset: { type: 'string' }, rules, edits, rationale: { type: 'string' } }) },
  { name: 'classify', kind: 'act', description: 'What a definition asks for vs what the engine has: declared mechanics (implemented/partial/missing), Jev reading the prose against the 209-mechanic catalogue, card effects nothing handles, rule facts, schema errors. ~1 Jev call.', inputSchema: S({ game, version, preset: { type: 'string' }, rules }) },
  { name: 'playtest', kind: 'act', description: 'One game played by Jev (async job): classification, per-move record, session judgement + qualitative critique, score/v2, findings. Poll with job.', inputSchema: S({ game, version, preset: { type: 'string' }, rules, players: { type: 'number' }, seed: { type: 'number' }, maxSteps: { type: 'number' }, persona: { type: 'string' } }) },
  { name: 'suite', kind: 'read', description: 'A game\'s eval suite: train and held-out test seeds × player counts, maxSteps, epsilon (smallest change acted on), measured noise.', inputSchema: S({ game }, ['game']) },
  { name: 'set_suite', kind: 'act', description: 'Owner-only: change a game\'s suite (≤96 games per eval; train/test seeds disjoint). Invalidates baselines.', inputSchema: S({ game, train: { type: 'object' }, test: { type: 'object' }, maxSteps: { type: 'number' }, epsilon: { type: 'number' } }, ['game']) },
  { name: 'eval', kind: 'act', description: 'Evaluate a definition version over its suite (async job, ≤300 s): every run judged and scored; returns train runs in full and the held-out test split as a score only. The first eval of the head is the climb baseline.', inputSchema: S({ game, version, tag: { type: 'string' } }, ['game']) },
  { name: 'noise', kind: 'act', description: 'Measure eval noise (async job): re-evaluate the head and compare with its baseline; the larger delta becomes the suite noise floor that proposals must beat. Run once before climbing.', inputSchema: S({ game }, ['game']) },
  { name: 'propose', kind: 'act', description: 'One hill-climb round (async job): apply ONE change (rules or exact edits vs head) with a rationale, eval it, keep only if train improves by ≥ epsilon AND test improves; otherwise revert. After 3 rounds without a keep the climb is stalled and a diagnosis is returned.', inputSchema: S({ game, rules, edits, rationale: { type: 'string', description: 'the root cause this change addresses, from train runs only' } }, ['game', 'rationale']) },
  { name: 'baseline', kind: 'read', description: 'The eval of the current head on this engine + suite (the number a proposal must beat), or none.', inputSchema: S({ game }, ['game']) },
  { name: 'evals', kind: 'read', description: 'Eval history for a game (train/test scores by version and engine).', inputSchema: S({ game, limit: { type: 'number' } }, ['game']) },
  { name: 'eval_detail', kind: 'read', description: 'One eval (train runs with score parts and findings; test as a score). diagnose:true adds the stall diagnosis.', inputSchema: S({ id: { type: 'string' }, diagnose: { type: 'boolean' } }, ['id']) },
  { name: 'run', kind: 'read', description: 'One run: view summary | turns | log | findings. Held-out (test) runs show only their score.', inputSchema: S({ id: { type: 'string' }, view: { type: 'string', enum: ['summary', 'turns', 'log', 'findings'] }, from: { type: 'number' }, limit: { type: 'number' } }, ['id']) },
  { name: 'climb_log', kind: 'read', description: 'Every round of a game\'s climb: change, rationale, baseline vs candidate train/test, delta, decision and reason.', inputSchema: S({ game }, ['game']) },
  { name: 'backlog', kind: 'read', description: 'The mechanic worklist: gaps evals keep hitting (missing/partial mechanics, unhandled card effects, engine faults, moves System One cannot play), ranked by hits × games. Fix these in engine/ and the next eval shows it.', inputSchema: S({ kind: { type: 'string' }, limit: { type: 'number' } }) },
  { name: 'engines', kind: 'read', description: 'Engine versions seen (code fingerprints) and which mechanics changed between consecutive versions.', inputSchema: S({}) },
  { name: 'regress', kind: 'act', description: 'After an engine change: re-evaluate every game\'s head on the current engine (one job per game).', inputSchema: S({ games: { type: 'array', items: { type: 'string' } } }) },
  { name: 'screen', kind: 'read', description: 'Free structural preview (no Jev): N seeded games of rules / a preset / a stored version (or edits vs head) with a greedy stand-in player — outcomes by role, balance, rounds, move mix, errors. Screen a change before paying for propose.', inputSchema: S({ game, version, rules, edits, preset: { type: 'string' }, seeds: { type: 'array', items: { type: 'number' } }, players: { type: 'array', items: { type: 'number' } }, maxSteps: { type: 'number' }, policy: { type: 'string', enum: ['greedy', 'random'], description: 'Greedy with consequence labels (default) or fast seeded random structural smoke tests' } }) },
  { name: 'plans', kind: 'read', description: 'Recent fanned-out evals (plans): runs done of total, when assembled, the eval id, whether the job got its result.', inputSchema: S({ limit: { type: 'number' } }) },
  { name: 'job', kind: 'read', description: 'Poll an async job: {status: pending|running|done|error, out?, error?}.', inputSchema: S({ id: { type: 'string' } }, ['id']) },
  { name: 'set_token', kind: 'act', description: 'Owner-only, write-only: the gateway bearer this cell uses to call @c15r/jev (scope it to cell:c15r/jev:*).', inputSchema: S({ token: { type: 'string' } }, ['token']) },
];

/* ── public read API ─────────────────────────────────────────────────── */

const page = (statusCode: number, contentType: string, body: string) => ({ statusCode, headers: { 'content-type': contentType, 'cache-control': 'no-cache' }, body });

async function publicApi(parts: string[]): Promise<unknown> {
  const [head, a, b, c] = parts;
  switch (head) {
    case 'overview':
      return pub.overview();
    case 'games':
      return pub.games();
    case 'game':
      if (!a) return undefined;
      if (b === 'v' && c) return pub.definition(a, Number(c));
      return pub.game(a);
    case 'eval':
      return a ? pub.evalView(a) : undefined;
    case 'run':
      return a ? pub.runView(a, b === 'turns' ? 'turns' : 'summary', Number(c ?? 0) || 0) : undefined;
    case 'mechanics':
      return pub.mechanics();
    case 'changelog':
      return pub.changelog(200);
    case 'presets':
      return a ? (PRESETS[a] ? { slug: a, rules: PRESETS[a], declared: pub.declared(PRESETS[a]) } : null) : Object.keys(PRESETS).map((slug) => ({ slug, ...pub.declared(PRESETS[slug]) }));
    case 'scoring':
      return { version: SCORE_VERSION, weights: WEIGHTS, weightsHiddenRole: WEIGHTS_HIDDEN_ROLE, critique: CRITIQUE, fixes: CRITIQUE_FIXES };
    case 'tools':
      return TOOLS.map((t) => ({ name: t.name, kind: t.kind, description: t.description }));
  }
  return undefined;
}

/* ── handler ────────────────────────────────────────────────────────── */

export const handler = async (
  event: { rawPath?: string; requestContext?: { http?: { method?: string } }; headers?: Record<string, string | undefined>; body?: string; __job?: string; __run?: { plan: string; idx: number } },
  context?: { functionName?: string },
) => {
  SELF_FUNCTION = context?.functionName ?? SELF_FUNCTION;

  if (event.__run) {
    // One run of a fanned-out eval; the run that completes the set finishes it.
    const { plan, idx } = event.__run;
    try {
      const { decide } = await decider();
      if (await runPlanned(plan, idx, decide, Date.now() + JOB_BUDGET_MS)) await finishAndComplete(plan);
    } catch (e) {
      console.error('run failed', plan, idx, (e as Error).message);
    }
    return;
  }

  if (event.__job) {
    const id = event.__job;
    const job = (await jobs.getJob(id)) as { tool?: string; args?: Args; caller?: string; startedAt?: string } | undefined;
    if (!job?.tool) return;
    await jobs.putJob(id, { ...job, status: 'running' });
    try {
      const out = await LONG[job.tool](job.args ?? {}, job.caller ?? 'anonymous', Date.now() + JOB_BUDGET_MS, id);
      if (isPlanned(out)) {
        await jobs.putJob(id, { ...job, status: 'running', plan: out.__plan.id });
        await fanOut(out.__plan);
        return;
      }
      let body = JSON.stringify(out);
      if (body.length > 350_000) body = JSON.stringify({ truncated: true, note: 'result too large for the job row; read it back through run / eval_detail', keys: Object.keys(out as object) });
      await jobs.putJob(id, { tool: job.tool, startedAt: job.startedAt, status: 'done', out: JSON.parse(body), finishedAt: new Date().toISOString() });
    } catch (e) {
      await jobs.putJob(id, { tool: job.tool, startedAt: job.startedAt, status: 'error', error: (e as Error).message, finishedAt: new Date().toISOString() });
    }
    return;
  }

  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const caller = event.headers?.['x-cell-caller'] ?? 'anonymous';
  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'POST' && path.startsWith('/_tools/')) {
    let args: Args = {};
    try {
      args = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
    try {
      return json(200, await tool(path.slice('/_tools/'.length), args, caller));
    } catch (e) {
      return json(e instanceof ToolError ? e.status : 500, { error: (e as Error).message });
    }
  }
  // Public read-only API behind the landing page (anonymous GETs: the cell is public).
  if ((method === 'GET' || method === 'HEAD') && path.startsWith('/api/')) {
    try {
      const out = await publicApi(path.slice('/api/'.length).split('/').filter(Boolean).map(decodeURIComponent));
      return out === undefined ? json(404, { error: `no route ${path}` }) : { ...json(out === null ? 404 : 200, out ?? { error: 'not found' }), headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } };
    } catch (e) {
      return json(500, { error: (e as Error).message });
    }
  }
  if ((method === 'GET' || method === 'HEAD') && (path === '/' || path === '')) {
    try {
      return page(200, 'text/html; charset=utf-8', readFileSync(join(__dirname, 'static/index.html'), 'utf8'));
    } catch {
      /* no page bundled — fall through to the descriptor */
    }
  }
  if ((method === 'GET' || method === 'HEAD') && path === '/app.js') {
    try {
      return page(200, 'application/javascript; charset=utf-8', readFileSync(join(__dirname, 'app.js'), 'utf8'));
    } catch {
      return json(404, { error: 'no client bundle' });
    }
  }
  if (method === 'GET' && (path === '/' || path === '' || path === '/_info')) {
    return json(200, { cell: '@c15r/playtest', description: 'Game development by hill-climbing Jev playtests', tools: TOOLS.map((t) => t.name) });
  }
  return json(404, { error: `no route for ${method} ${path}` });
};
