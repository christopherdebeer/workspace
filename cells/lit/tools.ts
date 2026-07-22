/* ---------------------------------------------------------------------------
 * tools.ts — @c15r/lit's callable tools (`GET /_tools` + `POST /_tools/<name>`,
 * the same convention cells/regwatch/lib/tools.ts uses; dispatch mechanics in
 * services/cells/service.ts's callCellTool).
 *
 * `decomposeMarkdown` is ADR-0081's reactive half: the substrate calls this
 * (via a `_subscriptions/*` entry matching `type: 'markdown'` writes,
 * delivered as a scoped-principal token — see services/workspace/
 * event-handlers.ts's per-run token mint) to turn a raw ingested markdown
 * source into `doc`/`doc-block`/`doc-order` facts + `related`/`references`
 * edges. Planning is pure (decompose.ts); this module is the thin executor
 * that reads current state, diffs, and writes back through the gateway as
 * the scoped principal — lit's own Lambda has no direct substrate write IAM
 * (index.ts's SSR reads are the cell's ambient-IAM read path; writes go
 * through the gateway PEP like every other tier-2 organ, ADR-0076).
 *
 * The `_subscriptions/lit-decompose-markdown` fact this reaction depends on
 * is CELL-REQUIRED, seeded via the organ path (`substrate.write.requested`,
 * the same `emit`/`emitSubscription` idiom cells/machine/index.ts already
 * uses for its own rails) — never an out-of-band operator script. It's
 * ensured on every real `decomposeMarkdown` call (self-healing, the
 * cells/consolidate/index.ts `bootstrap(token)`-on-every-run precedent) AND
 * exposed as its own idempotent `bootstrap` tool (the cells/machine/index.ts
 * `bootstrap` tool precedent) for an explicit post-deploy check.
 * ------------------------------------------------------------------------- */
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { extractWikiTargets } from '@parc/ui';
import { gwCall } from './vendor/gateway-client.js';
import { planDecomposition, factsFor, staleKeys, diffEdges, type EdgeRef } from './decompose';

const GATEWAY_MCP = process.env.GATEWAY_MCP_URL || 'https://parc.land/mcp';
async function gw(token: string, target: string, input?: unknown): Promise<unknown> {
  return gwCall(token, target, input, { url: GATEWAY_MCP });
}

const obj = (properties: Record<string, unknown>, required?: string[]) => ({
  type: 'object',
  properties,
  ...(required ? { required } : {}),
});

export const TOOLS = [
  {
    name: 'decomposeMarkdown',
    kind: 'act',
    description:
      'Decompose a raw markdown source (ADR-0081) into doc/doc-block/doc-order facts plus related/references edges, reconciling a prior decomposition of the same path. Requires a bearer token scoped to workspace:read + workspace:write.',
    inputSchema: obj(
      {
        path: { type: 'string', description: 'The source fact\'s path, e.g. docs/architecture/adr/0081-x.md' },
        content: { type: 'string', description: 'The full markdown source' },
        token: { type: 'string', description: 'Bearer the tool acts as (minted for the slice owner by the subscription delivery, or by auth.mintToken directly)' },
      },
      ['path', 'content', 'token'],
    ),
  },
  {
    name: 'decomposeChunk',
    kind: 'act',
    description:
      'ADR-0083: one bounded continuation step of an async decomposition. Ingests ONE fact chunk (or, past the last chunk, runs the finish phase: retirement + edge reconciliation), updates the _decompose/<slug> status fact, and chains the next step by writing the next decompose-run fact. Invoked by the lit-decompose-chunk subscription, never directly.',
    inputSchema: obj(
      {
        path: { type: 'string' },
        content: { type: 'string' },
        cursor: { type: 'number', description: 'Fact-list offset this step ingests from (>= total facts = the finish phase)' },
        token: { type: 'string' },
      },
      ['path', 'content', 'cursor', 'token'],
    ),
  },
  {
    name: 'bootstrap',
    kind: 'act',
    description: "Seed this cell's required facts. Idempotent: re-writes _subscriptions/lit-decompose-markdown (ADR-0081, the markdown-write reaction) and _subscriptions/lit-decompose-chunk (ADR-0083, the async continuation chain). Cell-required infrastructure — versioned with the cell, distinct from organic knowledge.",
    inputSchema: obj({}),
  },
];

/* ── the organ path (cell-required vocabulary) ─────────────────────────── */

async function emit(detail: Record<string, unknown>): Promise<void> {
  const client = new EventBridgeClient({});
  await client.send(
    new PutEventsCommand({
      Entries: [{
        EventBusName: process.env.EVENT_BUS_NAME,
        Source: process.env.SERVICE_NAME,
        DetailType: 'substrate.write.requested',
        Detail: JSON.stringify(detail),
      }],
    }),
  );
}

/** The reaction wiring a `markdown`-typed write to `decomposeMarkdown` — see
 *  services/workspace/event-handlers.ts's per-run token mint (the
 *  `target.name === 'lit'` branch) for how `grants` becomes a bearer token. */
const LIT_SUBSCRIPTION = {
  id: 'lit-decompose-markdown',
  label: 'ADR-0081: decompose a markdown source into doc/doc-block/doc-order + links',
  match: { type: 'markdown' },
  deliver: '@c15r/lit.decomposeMarkdown',
  params: {
    path: '${value.path}',
    content: '${value.content}',
    grants: { read: true, write: true },
  },
};

/** ADR-0083: the continuation chain's own reaction — each `decompose-run/*`
 *  fact write delivers ONE bounded chunk step back to this cell. Chaining
 *  happens through the substrate (chunk N writes the fact that triggers
 *  chunk N+1), so no invocation ever exceeds one chunk of work and the
 *  ~30s gateway ceiling stops mattering — the same shape workspace.reindex
 *  already uses tier-1, expressed with the cell-side primitives lit has. */
const LIT_CHUNK_SUBSCRIPTION = {
  id: 'lit-decompose-chunk',
  label: 'ADR-0083: one bounded continuation step of an async markdown decomposition',
  match: { type: 'decompose-run' },
  deliver: '@c15r/lit.decomposeChunk',
  // Fresh run facts are written per step at distinct keys (decompose-run/
  // <slug>/<cursor>), each starting at revision 1 — a doc re-synced for
  // years never walks into the depth cap the way a single rev-bumped key
  // would. 50 is then pure runaway insurance.
  maxDepth: 50,
  params: {
    path: '${value.path}',
    content: '${value.content}',
    cursor: '${value.cursor}',
    grants: { read: true, write: true },
  },
};

/** Idempotent: an organ-path write with the same key just bumps a revision. */
async function ensureBootstrap(): Promise<void> {
  await emit({
    key: `_subscriptions/${LIT_SUBSCRIPTION.id}`,
    value: LIT_SUBSCRIPTION,
    type: 'subscription',
    tags: ['cell-required', 'lit'],
    via: 'lit.bootstrap',
  });
  await emit({
    key: `_subscriptions/${LIT_CHUNK_SUBSCRIPTION.id}`,
    value: LIT_CHUNK_SUBSCRIPTION,
    type: 'subscription',
    tags: ['cell-required', 'lit'],
    via: 'lit.bootstrap',
  });
}

interface QueryEntry { key: string; value?: unknown }
interface NeighborsResult { outbound?: Array<{ to: string; rel: string }> }

// workspace.ingest caps at 100 facts/call AND every gw() call crosses the
// CloudFront-fronted /mcp gateway with its ~30s origin timeout, while
// ingest writes facts sequentially at ~0.85s each. 20/chunk (~17s) leaves
// real headroom — 30/chunk (~25.5s + overhead) ran RIGHT AT the ceiling
// and slow chunks still 504'd (2026-07-12, third live iteration on this).
const INGEST_CHUNK = 20;

/** The FINISH phase: retire whatever a prior decomposition wrote that this
 *  version no longer wants (blocks + order decorations), then reconcile each
 *  block's authored edges. Bounded work — one query, then parallel per-key
 *  calls — so it fits one invocation on its own (ADR-0083 runs it as the
 *  chain's dedicated last step). */
async function finishDecompose(token: string, plan: ReturnType<typeof planDecomposition>): Promise<{ edgesAdded: number; edgesRemoved: number; blocksRetired: number }> {
  const orderPrefix = `_doc/${plan.slug}/`;
  // Existing membership decorations for this slug — the stale-block signal.
  // The limit must exceed any real doc's decoration count INCLUDING residue
  // from prior partial runs: at 100, a doc that had accumulated 134 stale+live
  // decorations only ever showed the first 100 to the retirement diff, so the
  // tail residue survived every convergent re-run (2026-07-12, live).
  const existingOrder = (await gw(token, 'workspace.query', { prefix: orderPrefix, limit: 500 }) as { entries?: QueryEntry[] })?.entries ?? [];
  const existingBlockKeys = existingOrder.map((e) => e.key.slice(orderPrefix.length));
  const retiredKeys = staleKeys(existingBlockKeys, plan.blocks.map((b) => b.key));

  // Retire in parallel — a live run hit the cell Lambda's timeout doing this
  // sequentially. Independent per-key, so Promise.all is safe.
  await Promise.all(retiredKeys.flatMap((key) => [
    gw(token, 'workspace.supersede', { key }).catch(() => undefined),
    gw(token, 'workspace.supersede', { key: `${orderPrefix}${key}` }).catch(() => undefined),
  ]));

  // Reconcile edges per block (mirrors syncCellLinks, client/main.tsx): unlink
  // whatever a prior decomposition authored that this version no longer
  // wants. Skipped entirely on a FRESH decompose (no pre-existing order
  // decorations) — there is nothing to reconcile against.
  let edgesAdded = 0, edgesRemoved = 0;
  if (existingOrder.length > 0) {
    const results = await Promise.all(plan.blocks.map(async (b) => {
      const wanted: EdgeRef[] = plan.edges.filter((e) => e.from === b.key).map((e) => ({ to: e.to, rel: e.rel }));
      const nb = (await gw(token, 'workspace.edges', { around: b.key }).catch(() => null)) as NeighborsResult | null;
      const existing = (nb?.outbound ?? []).filter((e) => e.rel === 'related' || e.rel === 'references');
      const { toAdd, toRemove } = diffEdges(existing, wanted);
      await Promise.all(toRemove.map((e) => gw(token, 'workspace.unlink', { from: b.key, to: e.to, rel: e.rel }).catch(() => undefined)));
      return { added: toAdd.length, removed: toRemove.length };
    }));
    edgesAdded = results.reduce((n, r) => n + r.added, 0);
    edgesRemoved = results.reduce((n, r) => n + r.removed, 0);
  }
  return { edgesAdded, edgesRemoved, blocksRetired: retiredKeys.length };
}

/** Organ-path status update — `_decompose/<slug>` is `_`-prefixed, so the
 *  reactor never fires on it (no loop) and the graph never shows it. */
async function putStatus(slug: string, value: Record<string, unknown>): Promise<void> {
  await emit({ key: `_decompose/${slug}`, value, type: 'decompose-status', tags: ['lit'], via: 'lit.decompose' });
}

/** Chain the next continuation step: a FRESH `decompose-run/<slug>/<cursor>`
 *  fact per step (each starts at revision 1, so the subscription's depth cap
 *  never accumulates across a doc's lifetime of re-syncs). The reaction on
 *  `type: decompose-run` delivers it back to decomposeChunk with a scoped
 *  per-run token — chaining THROUGH the substrate, the reindex shape. */
async function emitRunStep(slug: string, path: string, content: string, cursor: number, total: number): Promise<void> {
  await emit({
    key: `decompose-run/${slug}/${cursor}`,
    value: { path, content, cursor, total },
    type: 'decompose-run',
    tags: ['lit', 'decompose-run'],
    via: 'lit.decompose',
  });
}

async function decomposeMarkdown(args: { path?: unknown; content?: unknown; token?: unknown }): Promise<Record<string, unknown>> {
  const path = typeof args.path === 'string' ? args.path : '';
  const content = typeof args.content === 'string' ? args.content : '';
  const token = typeof args.token === 'string' ? args.token : '';
  if (!path || !token) throw new Error('path and token are required');

  // Self-healing: this reaction's own subscription must exist for it to have
  // fired at all, but re-ensuring costs one cheap idempotent organ write and
  // means the wiring survives a dropped/edited subscription without an
  // out-of-band fix. Best-effort — never blocks the decomposition itself.
  await ensureBootstrap().catch(() => undefined);

  const plan = planDecomposition(path, content, extractWikiTargets);
  const facts = factsFor(plan);

  // ADR-0083: a doc that fits ONE ingest chunk (~17s) stays fully
  // synchronous — the overwhelming majority of the corpus, and callers keep
  // the simple call-and-done contract. Anything larger becomes an async
  // chain: no single invocation ever does more than one bounded chunk, so
  // the ~30s gateway ceiling that partial-failed the big docs (99/92/61
  // blocks, three separate mitigation rounds, 2026-07-12) stops mattering.
  if (facts.length <= INGEST_CHUNK) {
    await gw(token, 'workspace.ingest', { via: 'lit.decomposeMarkdown', facts, edges: plan.edges });
    const fin = await finishDecompose(token, plan);
    return { docKey: plan.docKey, blocks: plan.blocks.length, ...fin };
  }

  await putStatus(plan.slug, { status: 'running', phase: 'facts', done: 0, total: facts.length, startedAt: new Date().toISOString() });
  await emitRunStep(plan.slug, path, content, 0, facts.length);
  return { docKey: plan.docKey, blocks: plan.blocks.length, status: 'started', poll: `_decompose/${plan.slug}` };
}

async function decomposeChunk(args: { path?: unknown; content?: unknown; cursor?: unknown; token?: unknown }): Promise<Record<string, unknown>> {
  const path = typeof args.path === 'string' ? args.path : '';
  const content = typeof args.content === 'string' ? args.content : '';
  const cursor = typeof args.cursor === 'number' && Number.isFinite(args.cursor) ? args.cursor : NaN;
  const token = typeof args.token === 'string' ? args.token : '';
  if (!path || !token || Number.isNaN(cursor) || cursor < 0) throw new Error('path, token and a non-negative cursor are required');

  // Deterministic re-plan from the SAME content the dispatch saw (carried on
  // the run fact) — every step of one chain works off one consistent plan.
  const plan = planDecomposition(path, content, extractWikiTargets);
  const facts = factsFor(plan);
  const runKey = `decompose-run/${plan.slug}/${cursor}`;

  if (cursor >= facts.length) {
    // The dedicated FINISH step: retirement + edge reconciliation, then done.
    const fin = await finishDecompose(token, plan);
    await putStatus(plan.slug, { status: 'done', phase: 'done', done: facts.length, total: facts.length, ...fin, finishedAt: new Date().toISOString() });
    await emit({ op: 'supersede', key: runKey });
    return { docKey: plan.docKey, ...fin, status: 'done' };
  }

  const batch = facts.slice(cursor, cursor + INGEST_CHUNK);
  // Edges ride the FIRST chunk only, same as the old synchronous loop.
  await gw(token, 'workspace.ingest', { via: 'lit.decomposeMarkdown', facts: batch, ...(cursor === 0 ? { edges: plan.edges } : {}) });

  const next = cursor + INGEST_CHUNK;
  await putStatus(plan.slug, { status: 'running', phase: next < facts.length ? 'facts' : 'finish', done: Math.min(next, facts.length), total: facts.length });
  // Chain BEFORE retiring this step's own run fact: if the process dies
  // between the two, the worst case is a leftover (superseded-later) run
  // fact, never a dropped chain.
  await emitRunStep(plan.slug, path, content, next, facts.length);
  await emit({ op: 'supersede', key: runKey });
  return { docKey: plan.docKey, cursor, ingested: batch.length, next };
}

export async function toolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'decomposeMarkdown') return decomposeMarkdown(args);
  if (name === 'decomposeChunk') return decomposeChunk(args);
  if (name === 'bootstrap') {
    await ensureBootstrap();
    return { bootstrapped: true, subscriptions: [`_subscriptions/${LIT_SUBSCRIPTION.id}`, `_subscriptions/${LIT_CHUNK_SUBSCRIPTION.id}`] };
  }
  throw new Error(`unknown tool "${name}"`);
}
