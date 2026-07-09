/* ---------------------------------------------------------------------------
 * @c15r/consolidate — the consolidation organ (ADR-0073, C8).
 *
 * The closed self-maintenance loop: OBSERVE the substrate's measured debt
 * (workspace.attention — structural; workspace.contested — semantic), ACT on a
 * bounded, safe slice of it through EXISTING verbs (ratify high-confidence
 * kinship; unlink dangling edges; contradictions are never auto-resolved), and
 * SCORE the cycle on the backlog delta it moved — writing `consolidation/latest`
 * and feeding ADR-0070 `reward` onto the facts whose repair *stuck* (survived to
 * the next cycle). A run that reports the same backlog twice is, by its own
 * score, a failure.
 *
 * Reads/acts go through the /mcp gateway as a SCOPED principal — the caller
 * hands `run` a bearer (a minted, narrowed token: the ADR-0022/0024 delegation
 * pattern), so the organ's reach is the token's scope, not ambient IAM. The one
 * ambient-IAM read is the tokenless `latest` tool (the owner's audit fact).
 *
 * The planning core (`planCycle`) is PURE and exported — the jest gate drives
 * it with fixtures (convergence, caps, escalation-only for contradictions).
 * ------------------------------------------------------------------------- */
import { createCellReader, createDynamoStateStore } from '@parc/runtime/cell';
import { randomUUID } from 'node:crypto';
// Materialized at push from cells/kernel/static/ (cell-sync vendor overlay, ADR-0076).
// eslint-disable-next-line import/no-unresolved
import { gwCall, gwCallMany, gwWhoami, GatewayError } from './vendor/gateway-client.js';
// eslint-disable-next-line import/no-unresolved
import { cellJobs } from './vendor/cell-jobs.js';

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';
const GATEWAY_MCP = process.env.GATEWAY_MCP_URL || 'https://parc.land/mcp';

const AUDIT_KEY = 'consolidation/latest';

/* A full cycle (Stage B model calls included) outruns the edge's ~30s sync cap
 * — so the organ eats its own cooking: the vendored cell-jobs choreography
 * (ADR-0076) makes `run {async:true}` submit-and-poll. Jobs live in the cell's
 * OWN table (never the substrate). The AWS SDK loads lazily (platform
 * convention: never at import time — the jest gate imports this module's pure
 * core without any SDK installed; the Lambda runtime provides it). */
const JOBS_TABLE = process.env.TABLE_NAME || '';
let SELF_FUNCTION = '';

interface AwsClients {
  ddb: { send(cmd: unknown): Promise<{ Item?: Record<string, unknown> }> };
  PutCommand: new (input: unknown) => unknown;
  GetCommand: new (input: unknown) => unknown;
  lambda: { send(cmd: unknown): Promise<unknown> };
  InvokeCommand: new (input: unknown) => unknown;
}
let awsClients: AwsClients | null = null;
async function aws(): Promise<AwsClients> {
  if (!awsClients) {
    const [dynamo, lib, lam] = await Promise.all([
      import('@aws-sdk/client-dynamodb'),
      import('@aws-sdk/lib-dynamodb'),
      import('@aws-sdk/client-lambda'),
    ]);
    awsClients = {
      ddb: lib.DynamoDBDocumentClient.from(new dynamo.DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      }) as unknown as AwsClients['ddb'],
      PutCommand: lib.PutCommand as unknown as AwsClients['PutCommand'],
      GetCommand: lib.GetCommand as unknown as AwsClients['GetCommand'],
      lambda: new lam.LambdaClient({}) as unknown as AwsClients['lambda'],
      InvokeCommand: lam.InvokeCommand as unknown as AwsClients['InvokeCommand'],
    };
  }
  return awsClients;
}

const jobs = cellJobs({
  put: async (item: Record<string, unknown>) => {
    const a = await aws();
    await a.ddb.send(new a.PutCommand({ TableName: JOBS_TABLE, Item: item }));
  },
  get: async (key: { pk: string; sk: string }) => {
    const a = await aws();
    return (await a.ddb.send(new a.GetCommand({ TableName: JOBS_TABLE, Key: key }))).Item;
  },
  invokeSelf: async (payload: unknown) => {
    const a = await aws();
    await a.lambda.send(new a.InvokeCommand({ FunctionName: SELF_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
  },
});

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/* ── the pure planning core (exported for the gate) ─────────────────────── */

export interface AttentionObs {
  staleTotal: number;
  unlinkedTotal: number;
  danglingTotal: number;
  dangling: Array<{ from: string; rel: string; to: string; reason?: string }>;
}
export interface Suggestion {
  from: string;
  to: string;
  score: number | null;
}
export interface PrevAudit {
  backlog?: { total?: number };
  actions?: Array<{ kind: string; from?: string; rel?: string; to?: string }>;
}
export interface Observations {
  attention: AttentionObs;
  contestedTotal: number;
  suggestions: Suggestion[];
  prev: PrevAudit | null;
  /** Keys whose previous-cycle repair still holds (edge present on re-check) —
   *  verified by the shell (it needs reads); the core only rewards them. */
  survivors: string[];
  /** Inc 2 (ADR-0077): untyped facts whose key matches exactly one declared
   *  type's keyPattern — the typing-backfill repair class. Shell-matched
   *  (`matchTypeByKey`); the core only caps + plans. */
  untyped?: Array<{ key: string; type: string; version?: string }>;
}
export interface CyclePlan {
  ratify: Array<{ from: string; to: string; rel: string; score: number }>;
  unlink: Array<{ from: string; rel: string; to: string }>;
  rewards: Array<{ key: string; reward: number }>;
  /** Inc 2: give an untyped fact its declared type (CAS re-write, adds only). */
  retype: Array<{ key: string; type: string; version?: string }>;
  backlog: { stale: number; unlinked: number; dangling: number; contested: number; total: number };
  /** prevTotal − total; positive = progress. Null on the first cycle. */
  delta: number | null;
  escalations: { contested: number };
}

export const CAPS = {
  ratify: 5,
  unlink: 5,
  rewards: 6,
  ratifyScoreFloor: 0.8,
  rewardValue: 0.5,
  // Inc 2 (ADR-0077):
  retype: 10,
  stageBPairs: 5,
  stageBFloor: 0.9,
} as const;

/* ── Inc 2 pure helpers (ADR-0077) — exported for the gate ────────────────── */

/** A declared `keyPattern` ('task/{goal}/{id}') as an anchored regex. Interior
 *  `{x}` captures match one segment (no `/`); a TRAILING capture is greedy —
 *  substrate keys nest (`el:inbox/arch-…`, a placement's `{el}` is itself a
 *  fact key), so the last capture swallows the rest. */
export function keyPatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^$()[\]\\|]/g, '\\$&');
  const trailing = /\{[^}]+\}$/.test(escaped);
  const body = trailing
    ? escaped.replace(/\{[^}]+\}$/, '§TAIL§').replace(/\{[^}]+\}/g, '[^/]+').replace('§TAIL§', '.+')
    : escaped.replace(/\{[^}]+\}/g, '[^/]+');
  return new RegExp(`^${body}$`);
}

/** The single declared type whose keyPattern matches `key` — null when none or
 *  ambiguous (backfill only acts on an unambiguous match). */
export function matchTypeByKey(key: string, types: Record<string, { keyPattern?: string } | undefined>): string | null {
  const hits: string[] = [];
  for (const [name, decl] of Object.entries(types)) {
    const pattern = decl?.keyPattern;
    if (typeof pattern === 'string' && pattern && keyPatternToRegex(pattern).test(key)) hits.push(name);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** The Stage-B rubric (ADR-0077): a strict, JSON-only adjudication prompt over
 *  one contested pair — the CONTESTED_HINT verdict vocabulary, verbatim. */
export function buildAdjudicationPrompt(
  a: { key: string; type: string | null; value: unknown },
  b: { key: string; type: string | null; value: unknown },
): string {
  const show = (f: typeof a) =>
    `key: ${f.key}\ntype: ${f.type ?? '(untyped)'}\nvalue: ${JSON.stringify(f.value).slice(0, 1500)}`;
  return (
    'Two knowledge-base facts are semantically near but structurally unconnected. Adjudicate the pair.\n\n' +
    `FACT A —\n${show(a)}\n\nFACT B —\n${show(b)}\n\n` +
    'Verdicts (choose exactly one):\n' +
    '- "duplicate": the same claim/content twice — one should supersede the other.\n' +
    '- "contradict": both stand, but they assert incompatible things.\n' +
    '- "subsumes": one is a strict refinement/superset of the other.\n' +
    '- "independent": near in wording, but genuinely different claims — no action.\n' +
    '- "uncertain": you cannot tell from the content alone.\n\n' +
    'Answer with ONLY a JSON object, no prose: {"verdict": "...", "confidence": 0.0-1.0, "why": "one sentence"}'
  );
}

export interface StageBVerdict {
  verdict: 'duplicate' | 'contradict' | 'subsumes' | 'independent' | 'uncertain';
  confidence: number;
  why?: string;
}

/** Parse + validate a model's adjudication. Null on anything malformed — a
 *  verdict the organ can't validate is a verdict it doesn't have. */
export function parseVerdict(text: unknown): StageBVerdict | null {
  if (typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const v = parsed as { verdict?: unknown; confidence?: unknown; why?: unknown };
  const verdicts = new Set(['duplicate', 'contradict', 'subsumes', 'independent', 'uncertain']);
  if (typeof v.verdict !== 'string' || !verdicts.has(v.verdict)) return null;
  const confidence = typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1 ? v.confidence : null;
  if (confidence === null) return null;
  return { verdict: v.verdict as StageBVerdict['verdict'], confidence, ...(typeof v.why === 'string' ? { why: v.why } : {}) };
}

/** One bounded cycle, as data. Contradictions are NEVER planned as actions —
 *  they surface only in `escalations` (the ADR-0073 autonomy ladder). */
export function planCycle(obs: Observations, caps = CAPS): CyclePlan {
  const prevPairs = new Set(
    (obs.prev?.actions ?? [])
      .filter((a) => a.kind === 'ratify' && a.from && a.to)
      .map((a) => `${a.from}→${a.to}`),
  );
  const ratify = obs.suggestions
    .filter((s) => (s.score ?? 0) >= caps.ratifyScoreFloor)
    .filter((s) => !prevPairs.has(`${s.from}→${s.to}`) && !prevPairs.has(`${s.to}→${s.from}`))
    .slice(0, caps.ratify)
    .map((s) => ({ from: s.from, to: s.to, rel: 'relatesTo', score: s.score ?? 0 }));

  // Dangling edges are repair-by-removal: an endpoint is gone/retired, so the
  // edge asserts a connection to nothing. Bounded; the rest waits its turn.
  const unlink = obs.attention.dangling
    .slice(0, caps.unlink)
    .map((d) => ({ from: d.from, rel: d.rel, to: d.to }));

  const rewards = [...new Set(obs.survivors)].slice(0, caps.rewards).map((key) => ({ key, reward: caps.rewardValue }));

  // Inc 2 (ADR-0077): typing backfill — an untyped fact matching exactly one
  // declared keyPattern gains its type (adds only, CAS-guarded at apply).
  const retype = (obs.untyped ?? []).slice(0, caps.retype).map((u) => ({ key: u.key, type: u.type, version: u.version }));

  const backlog = {
    stale: obs.attention.staleTotal,
    unlinked: obs.attention.unlinkedTotal,
    dangling: obs.attention.danglingTotal,
    contested: obs.contestedTotal,
    total: obs.attention.staleTotal + obs.attention.unlinkedTotal + obs.attention.danglingTotal + obs.contestedTotal,
  };
  const prevTotal = obs.prev?.backlog?.total;
  const delta = typeof prevTotal === 'number' ? prevTotal - backlog.total : null;

  return { ratify, unlink, rewards, retype, backlog, delta, escalations: { contested: obs.contestedTotal } };
}

/* ── the gateway client — the vendored kernel-SDK module (ADR-0076) ────────
 * This cell was copy #3 of the hand-rolled /mcp caller; it now consumes
 * @c15r/kernel/gateway-client (materialized at push as vendor/, one source).
 * Same throwing contract as the old gw(); classification self-heals instead
 * of relying on a private verb table. */

async function gw(token: string, target: string, input?: unknown): Promise<unknown> {
  return gwCall(token, target, input, { url: GATEWAY_MCP });
}

/* ── the cycle shell ─────────────────────────────────────────────────────── */

interface RunInput {
  token?: string;
  /** Plan only — observe + score, apply nothing. */
  dryRun?: boolean;
  /** Submit-and-poll (ADR-0076 cell-jobs): a full cycle outruns the ~30s edge
   *  cap once Stage B calls models — async returns {jobId} immediately. */
  async?: boolean;
}

/* ── bootstrap (ADR-0077, owner steer): the organ ensures its OWN goal fact ──
 * The cell-owned-facts precedent (a cell's types.json bootstraps its `_types/*`
 * at deploy; machine.bootstrap ensures its rails): the organ files
 * `goal/consolidation` — the @c15r/tasks goal shape — links it to its decision
 * fact (≥1 authored edge), and ADOPTS it onto whatever token it runs as
 * (auth.adoptGoal self-targets the calling token). Idempotent; failures are
 * notes, never fatal — a cycle without posture is Inc 1, not an error. */
const GOAL_KEY = 'goal/consolidation';

async function bootstrap(token: string): Promise<string[]> {
  const notes: string[] = [];
  try {
    const existing = (await gw(token, 'workspace.peek', { key: GOAL_KEY })) as { value?: unknown } | null;
    if (!existing?.value) {
      await gw(token, 'workspace.remember', {
        key: GOAL_KEY,
        type: 'goal',
        tags: ['goal', 'status:active'],
        via: 'consolidate.bootstrap',
        value: {
          id: 'consolidation',
          title: 'Consolidate the substrate',
          detail: 'Repair structure (ratify, unlink, retype), verify the previous cycle’s survivors, escalate contradictions, and score the backlog delta.',
          status: 'active',
          createdAt: new Date().toISOString(),
        },
      });
      await gw(token, 'workspace.link', { from: GOAL_KEY, rel: 'addresses', to: 'kb/consolidation-organ' });
      notes.push(`bootstrapped ${GOAL_KEY}`);
    }
    const who = (await gwWhoami(token, { url: GATEWAY_MCP })) as { posture?: { goal?: string } };
    if (who?.posture?.goal !== GOAL_KEY) {
      await gw(token, 'auth.adoptGoal', { goal: GOAL_KEY });
      notes.push(`adopted ${GOAL_KEY} onto this principal`);
    }
  } catch (e) {
    notes.push(`bootstrap incomplete: ${(e as Error).message}`);
  }
  return notes;
}

async function observe(token: string): Promise<Observations & { contestedCandidates: ContestedCandidateObs[] }> {
  // Inc 2 (ADR-0077): the base reads go out together (gwCallMany — the
  // ADR-0073 wall-clock finding, fixed at the vendored seam), and the
  // survivor re-check is ONE edges call over all previous ratifications
  // instead of a serial per-pair loop.
  const [att0, con0, sug0, prev0, types0] = await gwCallMany(
    token,
    [
      { target: 'workspace.attention', input: { limit: 25 }, kind: 'read' },
      { target: 'workspace.contested', input: { limit: 10 }, kind: 'read' },
      { target: 'workspace.suggestions', input: { limit: 25 }, kind: 'read' },
      { target: 'workspace.peek', input: { key: AUDIT_KEY }, kind: 'read' },
      { target: '$types', kind: 'read' },
    ],
    { url: GATEWAY_MCP },
  );
  const failed = (v: unknown): boolean => !!v && typeof v === 'object' && 'error' in (v as Record<string, unknown>) && Object.keys(v as object).length === 1;
  const att = (failed(att0) ? {} : (att0 ?? {})) as Partial<AttentionObs> & { unlinked?: string[] };
  const con = (failed(con0) ? {} : (con0 ?? {})) as { total?: number; candidates?: ContestedCandidateObs[] };
  const sug = (failed(sug0) ? {} : (sug0 ?? {})) as { suggestions?: Suggestion[] };
  const prev = (failed(prev0) ? null : ((prev0 as { value?: PrevAudit } | null)?.value ?? null)) as PrevAudit | null;
  const types = (failed(types0) ? {} : ((types0 as { types?: Record<string, { keyPattern?: string }> })?.types ?? {})) as Record<string, { keyPattern?: string }>;

  const survivors: string[] = [];
  const prevRatified = (prev?.actions ?? []).filter((a) => a.kind === 'ratify' && a.from && a.to).slice(0, CAPS.rewards);
  if (prevRatified.length) {
    try {
      const links = (await gw(token, 'workspace.links', {
        keys: [...new Set(prevRatified.map((a) => a.from!))],
        limit: 200,
      })) as { edges?: Array<{ from: string; to: string; rel: string }> };
      for (const a of prevRatified) {
        if (links.edges?.some((e) => e.from === a.from && e.to === a.to && e.rel === (a.rel ?? 'relatesTo'))) {
          survivors.push(a.from!, a.to!);
        }
      }
    } catch {
      /* a failed check is not a survival */
    }
  }

  // Typing backfill candidates (ADR-0077): query each patterned type's key
  // PREFIX directly (the pattern up to its first capture) — complete coverage
  // of the family, unlike sampling attention's alphabetical unlinked page
  // (which never reaches past the plumbing prefixes). Untyped entries matching
  // exactly one declared keyPattern gain that type.
  let untyped: Observations['untyped'] = [];
  const patterned = Object.entries(types).filter(
    (e): e is [string, { keyPattern: string }] => typeof e[1]?.keyPattern === 'string' && !e[1].keyPattern.startsWith('{'),
  );
  if (patterned.length) {
    const pages = await gwCallMany(
      token,
      patterned.map(([, d]) => ({
        target: 'workspace.query',
        input: { prefix: d.keyPattern.split('{')[0], limit: 50, includeSuperseded: false },
        kind: 'read' as const,
      })),
      { url: GATEWAY_MCP },
    );
    const seen = new Set<string>();
    for (const page of pages) {
      if (failed(page)) continue;
      const entries = ((page as { entries?: Array<{ key: string; _meta?: { type?: string | null; version?: string } }> }).entries ?? []);
      for (const e of entries) {
        if (e._meta?.type || seen.has(e.key)) continue;
        const type = matchTypeByKey(e.key, types);
        if (type) {
          seen.add(e.key);
          untyped.push({ key: e.key, type, version: e._meta?.version });
        }
      }
    }
  }

  return {
    attention: {
      staleTotal: att.staleTotal ?? 0,
      unlinkedTotal: att.unlinkedTotal ?? 0,
      danglingTotal: att.danglingTotal ?? 0,
      dangling: Array.isArray(att.dangling) ? att.dangling : [],
    },
    contestedTotal: con.total ?? 0,
    suggestions: Array.isArray(sug.suggestions) ? sug.suggestions : [],
    prev,
    survivors,
    untyped,
    contestedCandidates: Array.isArray(con.candidates) ? con.candidates : [],
  };
}

/* ── Stage B, the easy tier (ADR-0077): in-cycle adjudication via models ────
 * A strict-rubric model call per contested pair (capped), acting ONLY on
 * high-confidence duplicate/independent/contradict verdicts — subsumes and
 * uncertainty escalate to the session exactly as before. `contradict` writes
 * the C4 middle verdict (a contradicts edge, confidence = strength) plus the
 * C7 marker convention (`contested/<hash>` + `checked/<hash>`); a pair the
 * organ does NOT adjudicate gets NO marker, so it stays visible. Requires the
 * models capability on the runner token — a scope denial skips the stage
 * gracefully (capability-gated autonomy). */
interface ContestedCandidateObs {
  a: string;
  b: string;
  hash: string;
  versions: { a: string; b: string };
  aType?: string | null;
  bType?: string | null;
}

async function adjudicate(token: string, candidates: ContestedCandidateObs[]): Promise<{ acted: string[]; escalated: number; note?: string }> {
  const acted: string[] = [];
  const pairs = candidates.slice(0, CAPS.stageBPairs);
  let escalated = candidates.length - pairs.length;
  let firstFailure: string | undefined;
  for (const c of pairs) {
    try {
      const [ea, eb] = await gwCallMany(
        token,
        [
          { target: 'workspace.peek', input: { key: c.a }, kind: 'read' as const },
          { target: 'workspace.peek', input: { key: c.b }, kind: 'read' as const },
        ],
        { url: GATEWAY_MCP },
      );
      const fa = ea as { value?: unknown; _meta?: { type?: string | null; createdAt?: string } } | null;
      const fb = eb as { value?: unknown; _meta?: { type?: string | null; createdAt?: string } } | null;
      if (!fa?.value || !fb?.value) {
        escalated++;
        continue;
      }
      const prompt = buildAdjudicationPrompt(
        { key: c.a, type: fa._meta?.type ?? null, value: fa.value },
        { key: c.b, type: fb._meta?.type ?? null, value: fb.value },
      );
      const res = (await gw(token, '@c15r/models.run', { prompt, maxTokens: 300 })) as { text?: string };
      const verdict = parseVerdict(res?.text);
      if (!verdict || verdict.confidence < CAPS.stageBFloor) {
        if (!verdict && !firstFailure) firstFailure = `unparseable verdict for ${c.a}↔${c.b}: ${String(res?.text).slice(0, 120)}`;
        escalated++;
        continue;
      }
      const marker = { a: c.a, b: c.b, verdict: verdict.verdict, confidence: verdict.confidence, versions: c.versions, via: 'consolidate.stageB' };
      if (verdict.verdict === 'independent') {
        await gw(token, 'workspace.remember', { key: `checked/${c.hash}`, value: marker, type: 'checked', via: 'consolidate.stageB' });
        acted.push(`independent ${c.a} ↔ ${c.b} (${verdict.confidence})`);
      } else if (verdict.verdict === 'contradict') {
        await gw(token, 'workspace.remember', {
          key: `contested/${c.hash}`,
          value: { a: c.a, b: c.b, verdict: 'contradict', why: verdict.why, confidence: verdict.confidence },
          type: 'contested',
          via: 'consolidate.stageB',
        });
        await gw(token, 'workspace.link', { from: c.a, rel: 'contradicts', to: c.b, strength: verdict.confidence });
        await gw(token, 'workspace.remember', { key: `checked/${c.hash}`, value: marker, type: 'checked', via: 'consolidate.stageB' });
        acted.push(`contradict ${c.a} --contradicts--> ${c.b} (${verdict.confidence})`);
      } else if (verdict.verdict === 'duplicate') {
        // The older fact is canonical; the newer duplicate retires into it.
        const aAt = fa._meta?.createdAt ?? '';
        const bAt = fb._meta?.createdAt ?? '';
        const [keep, retire] = aAt <= bAt ? [c.a, c.b] : [c.b, c.a];
        await gw(token, 'workspace.supersede', { key: retire, by: keep, migrateLinks: true });
        await gw(token, 'workspace.remember', { key: `checked/${c.hash}`, value: marker, type: 'checked', via: 'consolidate.stageB' });
        acted.push(`duplicate ${retire} superseded by ${keep} (${verdict.confidence})`);
      } else {
        escalated++; // subsumes / uncertain — a judgement call, the session's
      }
    } catch (e) {
      if (e instanceof GatewayError && /scope/i.test(e.message)) {
        return { acted, escalated: escalated + (pairs.length - pairs.indexOf(c)), note: `stage B unavailable: ${e.message}` };
      }
      if (!firstFailure) firstFailure = `${c.a}↔${c.b}: ${(e as Error).message.slice(0, 160)}`;
      escalated++;
    }
  }
  return { acted, escalated, ...(firstFailure ? { note: firstFailure } : {}) };
}

async function apply(token: string, plan: CyclePlan): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const r of plan.ratify) {
    try {
      await gw(token, 'workspace.ratify', { from: r.from, to: r.to, rel: r.rel });
      applied.push(`ratify ${r.from} --${r.rel}--> ${r.to}`);
    } catch (e) {
      skipped.push(`ratify ${r.from}→${r.to}: ${(e as Error).message}`);
    }
  }
  for (const u of plan.unlink) {
    try {
      await gw(token, 'workspace.unlink', { from: u.from, rel: u.rel, to: u.to });
      applied.push(`unlink ${u.from} --${u.rel}--> ${u.to}`);
    } catch (e) {
      skipped.push(`unlink ${u.from}→${u.to}: ${(e as Error).message}`);
    }
  }
  for (const t of plan.retype) {
    try {
      // Adds only: re-write the same value with its declared type under CAS.
      const cur = (await gw(token, 'workspace.peek', { key: t.key })) as { value?: unknown; _meta?: { version?: string; type?: string | null } } | null;
      if (!cur || cur.value === undefined || cur._meta?.type) {
        skipped.push(`retype ${t.key}: gone or already typed`);
        continue;
      }
      await gw(token, 'workspace.remember', {
        key: t.key,
        value: cur.value,
        type: t.type,
        ifVersion: cur._meta?.version ?? t.version,
        via: 'consolidate.retype',
      });
      applied.push(`retype ${t.key} → ${t.type}`);
    } catch (e) {
      skipped.push(`retype ${t.key}: ${(e as Error).message}`);
    }
  }
  for (const w of plan.rewards) {
    try {
      // Reward rides a write (ADR-0070): re-write the same value under CAS so a
      // concurrent edit loses nothing, with the earned term attached.
      const cur = (await gw(token, 'workspace.peek', { key: w.key })) as { value?: unknown; _meta?: { version?: string } } | null;
      if (!cur || cur.value === undefined) {
        skipped.push(`reward ${w.key}: gone`);
        continue;
      }
      await gw(token, 'workspace.remember', {
        key: w.key,
        value: cur.value,
        ifVersion: cur._meta?.version,
        reward: w.reward,
        via: 'consolidate.reward',
      });
      applied.push(`reward ${w.key} = ${w.reward}`);
    } catch (e) {
      skipped.push(`reward ${w.key}: ${(e as Error).message}`);
    }
  }
  return { applied, skipped };
}

async function runCycle(input: RunInput): Promise<unknown> {
  const token = input.token;
  if (!token) throw new Error('token is required: the organ acts as a scoped principal (mint one via auth.mintToken)');
  const at = new Date().toISOString();
  // Inc 2 (ADR-0077): ensure the organ's own goal fact + posture first — every
  // read below then resolves through the adopted goal (ADR-0074), for free.
  const bootstrapNotes = input.dryRun ? [] : await bootstrap(token);
  const obs = await observe(token);
  const plan = planCycle(obs);
  const actions = [
    ...plan.ratify.map((r) => ({ kind: 'ratify', from: r.from, rel: r.rel, to: r.to, score: r.score })),
    ...plan.unlink.map((u) => ({ kind: 'unlink', ...u })),
    ...plan.retype.map((t) => ({ kind: 'retype', from: t.key, to: t.type })),
  ];
  let applied: string[] = [];
  let skipped: string[] = [];
  let stageB: { acted: string[]; escalated: number; note?: string } = { acted: [], escalated: obs.contestedCandidates.length };
  if (!input.dryRun) {
    const res = await apply(token, plan);
    applied = res.applied;
    skipped = res.skipped;
    // Stage B rides after the safe tier: model-adjudicated easy verdicts,
    // capped + floored; everything else escalates exactly as Inc 1 did.
    stageB = await adjudicate(token, obs.contestedCandidates);
  }
  const audit = {
    at,
    dryRun: !!input.dryRun,
    backlog: plan.backlog,
    delta: plan.delta,
    actions,
    rewarded: plan.rewards.map((r) => r.key),
    escalations: plan.escalations,
    applied,
    skipped,
    ...(bootstrapNotes.length ? { bootstrap: bootstrapNotes } : {}),
    stageB: { acted: stageB.acted, escalated: stageB.escalated, ...(stageB.note ? { note: stageB.note } : {}) },
    // Inc 2 observability: what the backfill actually saw (an empty retype
    // with unlinkedSampled > 0 usually means undeclared keyPatterns — the
    // ADR-0073 `el:` finding — not a broken pass).
    observed: {
      unlinkedSampled: obs.attention.unlinkedTotal ? Math.min(25, obs.attention.unlinkedTotal) : 0,
      untypedMatched: (obs.untyped ?? []).length,
      contestedCandidates: obs.contestedCandidates.length,
    },
  };
  if (!input.dryRun) {
    await gw(token, 'workspace.remember', { key: AUDIT_KEY, value: audit, type: 'consolidation', via: 'consolidate.run' });
    await gw(token, 'workspace.remember', { key: `consolidation/run/${at}`, value: audit, type: 'consolidation', via: 'consolidate.run' });
  }
  return audit;
}

/* ── the cell surface ────────────────────────────────────────────────────── */

const TOOLS = [
  {
    name: 'run',
    description:
      'Run one bounded consolidation cycle (ADR-0073, Inc 2 per ADR-0077): BOOTSTRAP the organ’s own goal fact (goal/consolidation) + adopt it as the running principal’s posture (ADR-0074), OBSERVE attention + contested + suggestions in parallel (vendored gwCallMany), ACT the safe tier (ratify kinship ≥ 0.8, unlink dangling, RETYPE untyped facts matching a declared keyPattern — all capped), adjudicate the contested EASY tier in-cycle via @c15r/models.run under a strict rubric (duplicate/independent/contradict at confidence ≥ 0.9; contradict writes the ADR-0075 contradicts edge; subsumes/uncertain escalate; needs the models capability on the token, else the stage skips gracefully), reward last cycle’s surviving repairs (ADR-0070), and SCORE the backlog delta into `consolidation/latest`. Pass `token` and optionally `dryRun: true` (plans only — no bootstrap, no model calls).',
    kind: 'act',
    scope: null,
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Bearer the organ acts as (mint via auth.mintToken; read:workspace + write:workspace suffice; Stage B additionally needs the models capability)' },
        dryRun: { type: 'boolean', description: 'Observe and score only; apply nothing (also skips bootstrap + Stage B)' },
        async: { type: 'boolean', description: 'Submit-and-poll: returns {jobId} immediately (a full cycle outruns the ~30s edge cap); poll fetch' },
      },
      required: ['token'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    description: 'Poll an async run: {status: pending|done|error, out?: the audit, error?}.',
    kind: 'read',
    scope: null,
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
  },
  {
    name: 'latest',
    description: 'The most recent consolidation audit (`consolidation/latest`): backlog, delta, actions, rewards, escalations.',
    kind: 'read',
    scope: null,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const handler = async (
  event: { requestContext?: { http?: { method?: string } }; rawPath?: string; body?: string; __job?: string },
  context?: { functionName?: string },
) => {
  SELF_FUNCTION = context?.functionName ?? SELF_FUNCTION;
  // Self-invoked job (the vendored cell-jobs envelope): run the cycle off the
  // request path, park the audit on the JOB# row for fetch.
  if (event.__job) {
    const job = await jobs.getJob(event.__job);
    const input = (job as { input?: RunInput } | undefined)?.input;
    if (!input) return;
    try {
      const audit = await runCycle(input);
      await jobs.putJob(event.__job, { status: 'done', out: audit });
    } catch (e) {
      await jobs.putJob(event.__job, { status: 'error', error: (e as Error).message });
    }
    return;
  }
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'POST' && path === '/_tools/run') {
    try {
      const args = (event.body ? JSON.parse(event.body) : {}) as RunInput;
      if (args.async) {
        if (!SELF_FUNCTION) return json(400, { error: 'async unavailable: function name unknown' });
        if (!args.token) return json(400, { error: 'token is required' });
        const jobId = randomUUID().slice(0, 13);
        const { async: _a, ...rest } = args;
        await jobs.submit(jobId, { input: rest });
        return json(200, { jobId, status: 'pending', hint: 'poll fetch {jobId}; the audit also lands at consolidation/latest' });
      }
      return json(200, await runCycle(args));
    } catch (e) {
      return json(400, { error: (e as Error).message });
    }
  }
  if (method === 'POST' && path === '/_tools/fetch') {
    const args = (event.body ? JSON.parse(event.body) : {}) as { jobId?: string };
    const item = (await jobs.getJob(String(args.jobId ?? ''))) as { status?: string; out?: unknown; error?: string } | undefined;
    if (!item) return json(400, { error: `unknown job "${args.jobId}"` });
    return json(200, { status: item.status, out: item.out, error: item.error });
  }
  if (method === 'POST' && path === '/_tools/latest') {
    const rec = await createCellReader(createDynamoStateStore(TABLE), OWNER).peek(AUDIT_KEY);
    return json(200, rec ? { value: rec.value } : { value: null, hint: 'no cycle has run yet' });
  }
  return json(404, { error: `no route for ${method} ${path}` });
};
