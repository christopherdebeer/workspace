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
import { planDecomposition, staleKeys, diffEdges, type EdgeRef } from './decompose';

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
    name: 'bootstrap',
    kind: 'act',
    description: "Seed this cell's required facts. Idempotent: re-writes _subscriptions/lit-decompose-markdown (ADR-0081, the markdown-write reaction). Cell-required infrastructure — versioned with the cell, distinct from organic knowledge.",
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

/** Idempotent: an organ-path write with the same key just bumps a revision. */
async function ensureBootstrap(): Promise<void> {
  await emit({
    key: `_subscriptions/${LIT_SUBSCRIPTION.id}`,
    value: LIT_SUBSCRIPTION,
    type: 'subscription',
    tags: ['cell-required', 'lit'],
    via: 'lit.bootstrap',
  });
}

interface QueryEntry { key: string; value?: unknown }
interface NeighborsResult { outbound?: Array<{ to: string; rel: string }> }

async function decomposeMarkdown(args: { path?: unknown; content?: unknown; token?: unknown }): Promise<{ docKey: string; blocks: number; edgesAdded: number; edgesRemoved: number; blocksRetired: number }> {
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
  const orderPrefix = `_doc/${plan.slug}/`;

  // Existing membership decorations for this slug — the stale-block signal.
  const existingOrder = (await gw(token, 'workspace.query', { prefix: orderPrefix, limit: 100 }) as { entries?: QueryEntry[] })?.entries ?? [];
  const existingBlockKeys = existingOrder.map((e) => e.key.slice(orderPrefix.length));
  const wantedBlockKeys = plan.blocks.map((b) => b.key);
  const retiredKeys = staleKeys(existingBlockKeys, wantedBlockKeys);

  // Facts: the doc meta, every block, every order decoration — one bulk ingest.
  const facts = [
    { key: plan.docKey, type: 'doc', tags: ['doc'], via: 'lit.decomposeMarkdown', value: { title: plan.title, summary: plan.summary } },
    ...plan.blocks.map((b) => ({ key: b.key, type: 'doc-block', tags: [plan.docKey], via: 'lit.decomposeMarkdown', value: { content: b.content } })),
    // `doc`/`block` ride along explicitly (not just encoded in the key) —
    // deriveBackboneEdges' key-encoded rule falls back to these when the key's
    // own `[^/]+`-per-segment regex can't bind a nested slug (2026-07-12).
    ...plan.blocks.map((b) => ({ key: `${orderPrefix}${b.key}`, type: 'doc-order', tags: [plan.docKey], via: 'lit.decomposeMarkdown', value: { seq: b.seq, doc: plan.slug, block: b.key } })),
  ];
  // workspace.ingest caps at 100 facts/call — a doc with ~34+ blocks produces
  // doc(1) + blocks(n) + orders(n) = 2n+1 facts and can exceed that on its
  // own (confirmed live 2026-07-12: 5 large docs failed decompose entirely
  // with "ingest is capped at 100 facts per call", never writing ANYTHING —
  // not even a partial result). Chunk; edges only need to ride the FIRST
  // batch (workspace.ingest's edges aren't per-fact-batched, one pass over
  // plan.edges is enough regardless of how many fact batches it takes).
  const INGEST_CHUNK = 100;
  for (let i = 0; i < facts.length; i += INGEST_CHUNK) {
    const batch = facts.slice(i, i + INGEST_CHUNK);
    await gw(token, 'workspace.ingest', { via: 'lit.decomposeMarkdown', facts: batch, ...(i === 0 ? { edges: plan.edges } : {}) });
  }

  // Retire blocks/order-decorations this version no longer produces, in
  // parallel — a live run hit the cell's 10s Lambda timeout doing this (and
  // the edge reconciliation below) sequentially even for a 2-block doc, since
  // `workspace.ingest`'s own per-fact writes already spend most of that
  // budget. Both loops below are independent per-key, so Promise.all is safe.
  await Promise.all(retiredKeys.flatMap((key) => [
    gw(token, 'workspace.supersede', { key }).catch(() => undefined),
    gw(token, 'workspace.supersede', { key: `${orderPrefix}${key}` }).catch(() => undefined),
  ]));

  // Reconcile edges per block (mirrors syncCellLinks, client/main.tsx): unlink
  // whatever a prior decomposition authored that this version no longer
  // wants. Skipped entirely on a FRESH decompose (no pre-existing order
  // decorations) — there is nothing to reconcile against, so the read+diff
  // round trips would be pure overhead (and budget the ingest step already
  // spent most of the timeout on).
  let edgesAdded = 0, edgesRemoved = 0;
  if (existingOrder.length > 0) {
    const results = await Promise.all(plan.blocks.map(async (b) => {
      const wanted: EdgeRef[] = plan.edges.filter((e) => e.from === b.key).map((e) => ({ to: e.to, rel: e.rel }));
      const nb = (await gw(token, 'workspace.neighbors', { key: b.key }).catch(() => null)) as NeighborsResult | null;
      const existing = (nb?.outbound ?? []).filter((e) => e.rel === 'related' || e.rel === 'references');
      const { toAdd, toRemove } = diffEdges(existing, wanted);
      await Promise.all(toRemove.map((e) => gw(token, 'workspace.unlink', { from: b.key, to: e.to, rel: e.rel }).catch(() => undefined)));
      return { added: toAdd.length, removed: toRemove.length };
    }));
    edgesAdded = results.reduce((n, r) => n + r.added, 0);
    edgesRemoved = results.reduce((n, r) => n + r.removed, 0);
  }

  return { docKey: plan.docKey, blocks: plan.blocks.length, edgesAdded, edgesRemoved, blocksRetired: retiredKeys.length };
}

export async function toolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'decomposeMarkdown') return decomposeMarkdown(args);
  if (name === 'bootstrap') {
    await ensureBootstrap();
    return { bootstrapped: true, subscriptions: [`_subscriptions/${LIT_SUBSCRIPTION.id}`] };
  }
  throw new Error(`unknown tool "${name}"`);
}
