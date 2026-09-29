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
import { classify, play, judge, metrics, sessionFindings, type Classification, type Decide, type Finding, type Judgement } from './runner';
import { scoreRun, scoreSuite, definitionHealth, SCORE_VERSION, type RunScore } from './score';
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
}

export interface EvalRecord extends db.Item {
  id: string;
  game: string;
  version: number;
  defHash: string;
  engine: string;
  suite: string;
  scoreVersion: string;
  definitionHealth: number;
  classificationFindings: Finding[];
  train: { score: number; runs: RunDigest[] };
  test: { score: number; n: number; runs: Array<{ id: string; score: number }> };
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
  const engine = engineFingerprint();
  await db.put({ pk: 'ENGINE', sk: engine.version, version: engine.version, mechanics: engine.mechanics, core: engine.core, firstSeen: new Date().toISOString() }).catch(() => undefined);
  const cls = opts.cls ?? (await classify(opts.def.rules, opts.decide));
  const jobs: Array<{ split: 'train' | 'test'; seed: number; players: number }> = [];
  for (const split of ['train', 'test'] as const) {
    for (const seed of opts.suite[split].seeds) {
      for (const players of opts.suite[split].players) {
        if (players >= cls.players.min && players <= cls.players.max) jobs.push({ split, seed, players });
      }
    }
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), Math.max(1000, opts.deadlineAt - Date.now()));
  let tokens = cls.tokens;
  const digests = await pool(jobs, CONCURRENCY, async (j) => {
    const session = await play(opts.def.rules, opts.decide, { players: j.players, seed: j.seed, maxSteps: opts.suite.maxSteps, signal: abort.signal });
    let judgement: Judgement | null = null;
    let findings: Finding[] = sessionFindings(session, metrics(session), cls);
    if (session.turns.length && Date.now() < opts.deadlineAt - 5000) {
      try {
        const r = await judge(cls, session, opts.decide);
        judgement = r.judgement;
        findings = r.findings;
        tokens += r.judgement.tokens;
      } catch {
        /* unjudged: the judged term scores 0 */
      }
    }
    tokens += session.tokens;
    const sc = scoreRun(session, findings, judgement);
    const m = metrics(session);
    const id = db.newId();
    const digest: RunDigest = {
      id,
      split: j.split,
      seed: j.seed,
      players: j.players,
      score: sc.score,
      parts: sc.parts,
      stopped: session.stopped,
      endReason: m.endReason,
      steps: m.steps,
      rounds: m.rounds,
      verdict: judgement?.health.verdict ?? null,
      findings: findings.map((f) => `${f.severity}: ${f.subject}`),
    };
    const chunks = await db.putBlob(`RUN#${id}`, { session, judgement, findings });
    await db.put({ pk: `RUN#${id}`, sk: 'meta', ...digest, game: opts.game, version: opts.def.version, engine: engine.version, metrics: m, judgement, chunks, createdAt: new Date().toISOString() });
    await recordBacklog(opts.game, engine.version, findings);
    return digest;
  });
  clearTimeout(timer);
  await recordBacklog(opts.game, engine.version, cls.findings);

  const train = digests.filter((d) => d.split === 'train');
  const test = digests.filter((d) => d.split === 'test');
  const rec: EvalRecord = {
    pk: '',
    sk: 'meta',
    id: db.newId(),
    game: opts.game,
    version: opts.def.version,
    defHash: opts.def.hash,
    engine: engine.version,
    suite: db.suiteHash(opts.suite),
    scoreVersion: SCORE_VERSION,
    definitionHealth: definitionHealth(cls),
    classificationFindings: cls.findings,
    train: { score: scoreSuite(train.map((d) => d.score), cls), runs: train },
    test: { score: scoreSuite(test.map((d) => d.score), cls), n: test.length, runs: test.map((d) => ({ id: d.id, score: d.score })) },
    tokens,
    ms: Date.now() - t0,
    tag: opts.tag ?? 'eval',
    createdAt: new Date().toISOString(),
  };
  rec.pk = `EVAL#${rec.id}`;
  await db.put(rec);
  await db.put({ pk: `GAME#${opts.game}`, sk: `EVAL#${rec.createdAt}#${rec.id}`, id: rec.id, version: rec.version, engine: rec.engine, suite: rec.suite, scoreVersion: rec.scoreVersion, train: rec.train.score, test: rec.test.score, tag: rec.tag, createdAt: rec.createdAt });
  return rec;
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

/** Latest eval of (game, version) on this engine, suite and score version. */
export async function findEval(game: string, version: number, engine: string, suite: string): Promise<EvalRecord | null> {
  const list = await db.query(`GAME#${game}`, 'EVAL#', { newestFirst: true, limit: 50 });
  const hit = list.find((e) => e.version === version && e.engine === engine && e.suite === suite && e.scoreVersion === SCORE_VERSION);
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
}

export async function proposeRound(opts: {
  game: string;
  rules: string;
  rationale: string;
  author: string;
  decide: Decide;
  deadlineAt: number;
}): Promise<{ round: Round; eval: ReturnType<typeof publicEval>; stalled: boolean; diagnosis?: unknown }> {
  const g = await db.getGame(opts.game);
  if (!g) throw new Error(`unknown game ${opts.game}`);
  const head = (await db.getDefinition(opts.game)) as db.Definition;
  const suite = await db.getSuite(opts.game);
  const engine = engineFingerprint().version;
  const baseline = await findEval(opts.game, head.version, engine, db.suiteHash(suite));
  if (!baseline) throw new Error(`no baseline: eval ${opts.game} v${head.version} on engine ${engine} first (run the eval tool), then propose`);
  if (db.hash(opts.rules) === head.hash) throw new Error('the candidate is identical to the head definition');

  const cand = await db.putDefinition(opts.game, g.name, opts.rules, { rationale: opts.rationale, author: opts.author, parent: head.version, asHead: false, status: 'candidate' });
  const ev = await evaluate({ game: opts.game, def: cand, suite, decide: opts.decide, deadlineAt: opts.deadlineAt, tag: 'propose' });
  const eps = Math.max(suite.epsilon, suite.noise ?? 0);
  const dTrain = +(ev.train.score - baseline.train.score).toFixed(4);
  const dTest = +(ev.test.score - baseline.test.score).toFixed(4);
  let decision: Round['decision'] = 'reverted';
  let reason: string;
  if (dTrain >= eps && dTest > 0) {
    decision = 'kept';
    reason = `train +${dTrain} (≥ ε ${eps}) and test +${dTest}`;
  } else if (dTrain >= eps) reason = `train +${dTrain} but test ${dTest >= 0 ? '+' : ''}${dTest}: overfitting signal — reverted`;
  else reason = `train ${dTrain >= 0 ? '+' : ''}${dTrain} is below ε ${eps} — no real improvement`;

  const fresh = (await db.getGame(opts.game)) as db.GameIndex;
  const climb = fresh.climb ?? { rounds: 0, stall: 0, status: 'idle' as const };
  climb.rounds += 1;
  climb.stall = decision === 'kept' ? 0 : climb.stall + 1;
  climb.status = climb.stall >= STALL_ROUNDS ? 'stalled' : 'climbing';
  if (decision === 'kept') {
    await db.setDefinitionStatus(opts.game, head.version, 'kept');
    await db.setDefinitionStatus(opts.game, cand.version, 'head');
    fresh.head = cand.version;
    fresh.best = cand.version;
  } else await db.setDefinitionStatus(opts.game, cand.version, 'reverted');
  fresh.climb = climb;
  await db.setGame(fresh);

  const round: Round = {
    pk: `GAME#${opts.game}`,
    sk: `ROUND#${db.pad(climb.rounds)}`,
    round: climb.rounds,
    from: head.version,
    to: cand.version,
    rationale: opts.rationale,
    author: opts.author,
    baseline: { evalId: baseline.id, train: baseline.train.score, test: baseline.test.score },
    candidate: { evalId: ev.id, train: ev.train.score, test: ev.test.score },
    delta: { train: dTrain, test: dTest },
    epsilon: eps,
    decision,
    reason,
    engine,
    createdAt: new Date().toISOString(),
  };
  await db.put(round);
  const stalled = climb.status === 'stalled';
  return { round, eval: publicEval(ev), stalled, ...(stalled ? { diagnosis: diagnose(ev) } : {}) };
}

/** At a stall: where the train runs lose points, and what keeps showing up. */
export function diagnose(ev: EvalRecord) {
  const runs = ev.train.runs.filter((r) => r.parts);
  const keys = ['ended', 'variety', 'agency', 'length', 'clean', 'judged'] as const;
  const weakest = keys
    .map((k) => ({ part: k, mean: +(runs.reduce((a, r) => a + (r.parts?.[k] ?? 0), 0) / (runs.length || 1)).toFixed(3) }))
    .sort((a, b) => a.mean - b.mean);
  const counts = new Map<string, number>();
  for (const r of runs) for (const f of r.findings ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
  return {
    note: 'Stalled: stop patching and diagnose. Weakest score parts first; recurring findings next — some are engine or mechanic gaps no definition edit can fix (see the backlog tool).',
    weakest,
    recurring: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10),
    classification: ev.classificationFindings.map((f) => `${f.severity}: ${f.kind} ${f.subject}`),
  };
}
