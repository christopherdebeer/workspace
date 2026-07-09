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

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';
const GATEWAY_MCP = process.env.GATEWAY_MCP_URL || 'https://parc.land/mcp';

const AUDIT_KEY = 'consolidation/latest';

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
}
export interface CyclePlan {
  ratify: Array<{ from: string; to: string; rel: string; score: number }>;
  unlink: Array<{ from: string; rel: string; to: string }>;
  rewards: Array<{ key: string; reward: number }>;
  backlog: { stale: number; unlinked: number; dangling: number; contested: number; total: number };
  /** prevTotal − total; positive = progress. Null on the first cycle. */
  delta: number | null;
  escalations: { contested: number };
}

export const CAPS = { ratify: 5, unlink: 5, rewards: 6, ratifyScoreFloor: 0.8, rewardValue: 0.5 } as const;

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

  const backlog = {
    stale: obs.attention.staleTotal,
    unlinked: obs.attention.unlinkedTotal,
    dangling: obs.attention.danglingTotal,
    contested: obs.contestedTotal,
    total: obs.attention.staleTotal + obs.attention.unlinkedTotal + obs.attention.danglingTotal + obs.contestedTotal,
  };
  const prevTotal = obs.prev?.backlog?.total;
  const delta = typeof prevTotal === 'number' ? prevTotal - backlog.total : null;

  return { ratify, unlink, rewards, backlog, delta, escalations: { contested: obs.contestedTotal } };
}

/* ── the gateway client (scoped-principal calls; own verb table) ─────────── */

const READ_TOOLS = new Set(['attention', 'contested', 'suggestions', 'peek', 'links', 'edges']);

async function gw(token: string, target: string, input?: unknown): Promise<unknown> {
  const verb = READ_TOOLS.has(target.split('.').pop() ?? '') ? 'read' : 'act';
  const res = await fetch(GATEWAY_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: verb, arguments: input === undefined ? { target } : { target, input } },
    }),
  });
  if (!res.ok) throw new Error(`gateway HTTP ${res.status} for ${target}`);
  const rpc = (await res.json()) as { error?: unknown; result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  const text = rpc?.result?.content?.[0]?.text ?? '';
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* raw text */
  }
  if (rpc?.error || rpc?.result?.isError) throw new Error(`${target}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return value;
}

/* ── the cycle shell ─────────────────────────────────────────────────────── */

interface RunInput {
  token?: string;
  /** Plan only — observe + score, apply nothing. */
  dryRun?: boolean;
}

async function observe(token: string): Promise<Observations> {
  const [att, con, sug, prevEntry] = await Promise.all([
    gw(token, 'workspace.attention', { limit: 25 }) as Promise<Partial<AttentionObs>>,
    gw(token, 'workspace.contested', { limit: 10 }) as Promise<{ total?: number }>,
    gw(token, 'workspace.suggestions', { limit: 25 }) as Promise<{ suggestions?: Suggestion[] }>,
    gw(token, 'workspace.peek', { key: AUDIT_KEY }) as Promise<{ value?: PrevAudit } | null>,
  ]);
  const prev = prevEntry?.value ?? null;

  // Which previous ratifications stuck? An authored edge that survived to this
  // cycle is a repair the corpus kept — those facts earned their reward.
  const survivors: string[] = [];
  const prevRatified = (prev?.actions ?? []).filter((a) => a.kind === 'ratify' && a.from && a.to).slice(0, CAPS.rewards);
  for (const a of prevRatified) {
    try {
      const links = (await gw(token, 'workspace.links', { keys: [a.from], rels: [a.rel ?? 'relatesTo'], limit: 50 })) as {
        edges?: Array<{ from: string; to: string; rel: string }>;
      };
      if (links.edges?.some((e) => e.from === a.from && e.to === a.to)) survivors.push(a.from!, a.to!);
    } catch {
      /* a failed check is not a survival */
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
  };
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
  const obs = await observe(token);
  const plan = planCycle(obs);
  const actions = [
    ...plan.ratify.map((r) => ({ kind: 'ratify', from: r.from, rel: r.rel, to: r.to, score: r.score })),
    ...plan.unlink.map((u) => ({ kind: 'unlink', ...u })),
  ];
  let applied: string[] = [];
  let skipped: string[] = [];
  if (!input.dryRun) {
    const res = await apply(token, plan);
    applied = res.applied;
    skipped = res.skipped;
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
      'Run one bounded consolidation cycle (ADR-0073): OBSERVE attention + contested + suggestions, ACT the safe tier (ratify kinship ≥ 0.8, unlink dangling edges — capped; contradictions only ever escalate), reward last cycle’s surviving repairs (ADR-0070), and SCORE the backlog delta into `consolidation/latest`. Pass `token` (a minted, narrowed bearer — the organ acts as that principal) and optionally `dryRun: true` to plan without applying.',
    kind: 'act',
    scope: null,
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Bearer the organ acts as (mint via auth.mintToken; read:workspace + write:workspace suffice)' },
        dryRun: { type: 'boolean', description: 'Observe and score only; apply nothing' },
      },
      required: ['token'],
      additionalProperties: false,
    },
  },
  {
    name: 'latest',
    description: 'The most recent consolidation audit (`consolidation/latest`): backlog, delta, actions, rewards, escalations.',
    kind: 'read',
    scope: null,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export const handler = async (event: { requestContext?: { http?: { method?: string } }; rawPath?: string; body?: string }) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'POST' && path === '/_tools/run') {
    try {
      const args = (event.body ? JSON.parse(event.body) : {}) as RunInput;
      return json(200, await runCycle(args));
    } catch (e) {
      return json(400, { error: (e as Error).message });
    }
  }
  if (method === 'POST' && path === '/_tools/latest') {
    const rec = await createCellReader(createDynamoStateStore(TABLE), OWNER).peek(AUDIT_KEY);
    return json(200, rec ? { value: rec.value } : { value: null, hint: 'no cycle has run yet' });
  }
  return json(404, { error: `no route for ${method} ${path}` });
};
