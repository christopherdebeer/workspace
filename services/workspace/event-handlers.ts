/**
 * Workspace EventBridge handlers (ADR-0044 Inc 5): tending, the machine tick,
 * the organ substrate-write path, the reaction reactor, cell-lifecycle and
 * cell-data projections. (The async reindex worker lives with search/vectors
 * in commands-search.ts.)
 */
import {
  ServiceContext,
  type Identity,
  type ObservedState,
  type StateStore,
  suggestionCandidates,
} from '../../platform/runtime';
import type { EventBridgeHandler } from '../../platform/runtime';
import { createServiceClient } from '../../platform/runtime/service-client';
import { createDeclarativeActions, ACTIONS_PREFIX, ActionInvokeError, type ActionDefinition } from './actions';
import { createRegisteredViews, VIEWS_PREFIX, type ViewDefinition } from './views';
import {
  createSubscriptions,
  SUBSCRIPTIONS_PREFIX,
  matches as subscriptionMatches,
  resolveParams,
  parseCellTarget,
  type SubscriptionDefinition,
} from './subscriptions';
import { GROUPS_NS, PUBLIC_NS } from './grants';
import { type DepsBuilder } from './shared';
import { TOOL_DESCRIPTORS } from './descriptors';

/** A tending pass distilled into a written report — the audit fact. */
export interface TendReport {
  at: string;
  scope: string;
  stale: number;
  unlinked: number;
  dangling: number;
  /** Ratification candidates: inferred `similarTo` pairs no authored edge connects (ADR-0032). */
  suggestions: number;
  staleSample: Array<{ key: string; updatedAt: string; type: string | null }>;
  unlinkedSample: string[];
  danglingSample: Array<{ from: string; rel: string; to: string; reason: string }>;
  suggestionsSample: Array<{ from: string; to: string }>;
}

/**
 * One tending pass (the legacy workspace's signature loop, on this substrate):
 * read `attention()` — the just-in-time cron — and write what it surfaced as
 * a `tending/latest` audit fact, so every observer (home, boards, agents)
 * sees the substrate's health as state.
 */
export async function runTend(
  state: ObservedState,
  scope: string,
  ctx: ServiceContext,
  via: string,
  writer: { user?: string; scopes: string[] },
  store?: Pick<StateStore, 'listEdges'>,
): Promise<TendReport> {
  const att = await state.attention(scope, {});
  // ADR-0032: surface ratification candidates as part of standing health — the
  // inferred `similarTo` pairs a person/grant might want to promote to a typed edge.
  const candidates = store ? suggestionCandidates(await store.listEdges(scope)) : [];
  const report: TendReport = {
    at: new Date().toISOString(),
    scope,
    stale: att.stale.length,
    unlinked: att.unlinked.length,
    dangling: att.dangling.length,
    suggestions: candidates.length,
    staleSample: att.stale.slice(0, 5),
    unlinkedSample: att.unlinked.slice(0, 5),
    danglingSample: att.dangling.slice(0, 3),
    suggestionsSample: candidates.slice(0, 5).map((c) => ({ from: c.from, to: c.to })),
  };
  const entry = await state.put(
    { scope, key: 'tending/latest', value: report, via: `tend:${via}`, type: 'audit', tags: ['tending'] },
    writer,
  );
  // A tending pass is a fact change like any other — announce it so reactions
  // (e.g. a tending machine's trigger) fire. Without this the audit is invisible
  // to the reactor.
  await ctx.events.emit('workspace.fact.written', { scope, key: 'tending/latest', revision: entry._meta.revision });
  await ctx.events.emit('workspace.tended', {
    scope,
    stale: report.stale,
    unlinked: report.unlinked,
    dangling: report.dangling,
  });
  ctx.logger.info('workspace tended', { scope, via, stale: report.stale, unlinked: report.unlinked, dangling: report.dangling });

  // ADR-0052: the workspace's own verbs are capability facts too — reconciled
  // by the tend pass (the repair organ), so the fact floor covers tier-1 verbs
  // without a deploy-time seam. Diff-only writes: an unchanged verb costs
  // nothing (no revision churn, no re-embed). Best-effort, like suggestions.
  try {
    const capWriter: Identity = { user: 'platform/cells', scopes: [] };
    const existing = await state.query(scope, { prefix: '_caps/workspace.' }, capWriter);
    const summaries = new Map(existing.entries.map((e) => [e.key, (e.value as { summary?: string } | null)?.summary]));
    const firstSentence = (text: string): string => (text.match(/^[^.!?]*[.!?]/)?.[0] ?? text.slice(0, 240)).trim();
    for (const d of TOOL_DESCRIPTORS) {
      if (d.name === 'search') continue; // deprecated alias (ADR-0051) — not worth a fact
      const key = `_caps/workspace.${d.name}`;
      const summary = firstSentence(d.description);
      if (summaries.get(key) === summary) continue;
      await state.put(
        {
          scope,
          key,
          value: {
            target: `workspace.${d.name}`,
            name: `workspace.${d.name}`,
            kind: d.kind,
            summary,
            cell: 'workspace',
            schemaRef: `$catalog resolve: workspace.${d.name}`,
          },
          via: 'tend:capabilities',
          type: 'capability',
          tags: ['capability'],
        },
        capWriter,
      );
    }
  } catch (err) {
    ctx.logger.warn('workspace capability reconcile failed', { scope, error: (err as Error).message });
  }
  return report;
}

/** The scheduled tend: an EventBridge cron delivers `workspace.tend.requested`. */
export function createTendHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx) => {
    const scopes = Array.isArray(detail.scopes) ? (detail.scopes as string[]) : [];
    if (!scopes.length) {
      ctx.logger.warn('tend requested without scopes');
      return;
    }
    const { state, store } = build(ctx);
    for (const scope of scopes) {
      await runTend(state, scope, ctx, 'schedule', { user: 'platform/tend', scopes: [] }, store);
    }
  };
}

/**
 * The scheduled machine tick: an EventBridge cron delivers `machine.tick.requested`.
 * It resumes WAITING machine runs whose `wait`-rail deadline has passed — the
 * autonomous half of the `wait` primitive (the driven half is calling `step`). A
 * due run is bumped back to `running`, which re-fires the machine's `step`
 * subscription; the stepper then re-reads the elapsed `waitUntil`, clears it, and
 * advances past the wait. Coarse (cron-granular) by design; a per-run delayed
 * trigger (EventBridge Scheduler) is the precision upgrade.
 */
export function createMachineTickHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx) => {
    const scopes = Array.isArray(detail.scopes) ? (detail.scopes as string[]) : [];
    if (!scopes.length) {
      ctx.logger.warn('machine tick requested without scopes');
      return;
    }
    const { state } = build(ctx);
    const nowMs = Date.now();
    const identity: Identity = { user: 'platform/machine-tick', scopes: [] };
    for (const scope of scopes) {
      const { entries } = await state.query(scope, { type: 'machine-run', limit: 500 });
      for (const e of entries) {
        const v = (e.value ?? {}) as { status?: string; waitUntil?: string };
        if (e._meta.superseded || v.status !== 'waiting' || typeof v.waitUntil !== 'string') continue;
        const due = Date.parse(v.waitUntil);
        if (!Number.isFinite(due) || due > nowMs) continue; // deadline not reached yet
        await state.put({ scope, key: e.key, value: { ...v, status: 'running' }, via: 'machine.tick', type: 'machine-run', tags: e._meta.tags }, identity);
        await ctx.events.emit('workspace.fact.written', { scope, key: e.key, revision: 0 });
        ctx.logger.info('machine tick resumed waiting run', { scope, key: e.key, waitUntil: v.waitUntil });
      }
    }
  };
}

/**
 * The organ-to-reef write path: a dynamic cell emits a
 * `substrate.write.requested` event, and the workspace applies it as a fact
 * in the cell **owner's** slice with the cell as the attested writer.
 *
 * Trust model: the event's `source` is IAM-attested — each cell's role policy
 * pins `events:PutEvents` to `events:source = cell-<cellId>`, so a cell
 * cannot speak as anyone but itself. The owner is resolved through the cells
 * registry (never trusted from the event body), and the write flows through
 * the same observed-state primitive as every other write (provenance,
 * revision, trajectory). Organs may not write the declared vocabulary.
 */
export function createSubstrateWriteHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx, meta) => {
    if (!meta.source.startsWith('cell-')) {
      ctx.logger.warn('substrate write from non-cell source refused', { source: meta.source });
      return;
    }
    const cellId = meta.source.slice('cell-'.length);
    const key = detail.key;
    if (typeof key !== 'string' || !key) {
      ctx.logger.warn('substrate write without a key refused', { source: meta.source });
      return;
    }
    if (key.startsWith(GROUPS_NS) || key.startsWith(PUBLIC_NS)) {
      // Sharing/visibility authority (who-can-see) is the caller's, never an
      // organ's — these stay refused on the organ path.
      ctx.logger.warn('substrate write to sharing namespace refused', { source: meta.source, key });
      return;
    }
    const resolved = (await ctx.serviceClient('cells').command('resolveCell', { cellId })) as {
      owner?: string;
      name?: string;
    } | null;
    if (!resolved?.owner) {
      ctx.logger.warn('substrate write from unknown cell refused', { cellId });
      return;
    }
    const scope = resolved.owner;
    const writerAddress = `@${resolved.owner}/${resolved.name ?? cellId}`;
    const identity: Identity = { user: writerAddress, scopes: [] };
    const { state } = build(ctx);

    // The supersede verb on the organ path: a cell-attested agent retires an
    // ORGANIC fact in the owner's slice (history is kept — reversible, not a
    // delete). Vocabulary (`_`-prefixed) stays managed via the registries, so
    // organ supersede is refused there, the mirror of the put-path rule.
    if (detail.op === 'supersede') {
      // The no-code vocabulary a cell SEEDS via the put path (actions/views/
      // subscriptions) it may also RETIRE here, through the same registries — so a
      // re-definition can clean up the rails/branches it dropped, the symmetric
      // counterpart to seeding. Other `_`-prefixed vocabulary (_types, _renderers,
      // sharing) stays managed elsewhere, so organ supersede there is still refused.
      try {
        if (key.startsWith(ACTIONS_PREFIX)) {
          await createDeclarativeActions(state).remove(scope, key.slice(ACTIONS_PREFIX.length), identity);
        } else if (key.startsWith(SUBSCRIPTIONS_PREFIX)) {
          await createSubscriptions(state).remove(scope, key.slice(SUBSCRIPTIONS_PREFIX.length), identity);
        } else if (key.startsWith(VIEWS_PREFIX)) {
          await createRegisteredViews(state).remove(scope, key.slice(VIEWS_PREFIX.length), identity);
        } else if (key.startsWith('_')) {
          ctx.logger.warn('organ supersede of vocabulary refused', { cell: writerAddress, key });
          return;
        } else {
          await state.supersede(scope, key, null, identity, {});
        }
      } catch (err) {
        ctx.logger.warn('organ supersede refused', { cell: writerAddress, key, error: (err as Error).message });
        return;
      }
      await ctx.events.emit('workspace.fact.written', { scope, key, revision: 0 });
      ctx.logger.info('substrate supersede applied for organ', { cell: writerAddress, scope, key });
      return;
    }

    // A cell may seed its own **cell-required** vocabulary — declared actions
    // and views, the same category as the `_renderers/*` it already seeds and
    // exactly the "two kinds of seeding" discipline (cell-required vs. organic).
    // These route through the same validated registries as caller registration
    // (still type-checked and contested-detected), attributed to the cell and
    // tagged `cell-required` so they read as program — versioned with the cell,
    // refreshed on redeploy — not organic, caller-authored vocabulary.
    try {
      if (key.startsWith(ACTIONS_PREFIX)) {
        const def = { ...(detail.value as ActionDefinition), id: key.slice(ACTIONS_PREFIX.length) };
        const tags = [...new Set(['cell-required', ...(Array.isArray(detail.tags) ? (detail.tags as string[]) : [])])];
        const result = await createDeclarativeActions(state).register(scope, def, identity, { via: writerAddress, tags });
        if (result.contested.length) {
          ctx.logger.warn('organ action contests existing targets', { cell: writerAddress, action: def.id, contested: result.contested });
        }
      } else if (key.startsWith(VIEWS_PREFIX)) {
        const def = { ...(detail.value as ViewDefinition), id: key.slice(VIEWS_PREFIX.length) };
        const tags = [...new Set(['cell-required', ...(Array.isArray(detail.tags) ? (detail.tags as string[]) : [])])];
        await createRegisteredViews(state).register(scope, def, identity, { via: writerAddress, tags });
      } else if (key.startsWith(SUBSCRIPTIONS_PREFIX)) {
        const def = { ...(detail.value as SubscriptionDefinition), id: key.slice(SUBSCRIPTIONS_PREFIX.length) };
        const tags = [...new Set(['cell-required', ...(Array.isArray(detail.tags) ? (detail.tags as string[]) : [])])];
        await createSubscriptions(state).register(scope, def, identity, { via: writerAddress, tags });
      } else {
        await state.put(
          {
            scope,
            key,
            value: detail.value,
            via: typeof detail.via === 'string' ? detail.via : writerAddress,
            type: typeof detail.type === 'string' ? detail.type : undefined,
            tags: Array.isArray(detail.tags) ? (detail.tags as string[]) : undefined,
          },
          identity,
        );
      }
    } catch (err) {
      // Validation/contested failures must not crash the event consumer.
      ctx.logger.warn('organ substrate write refused', { cell: writerAddress, key, error: (err as Error).message });
      return;
    }

    const entry = await state.get(scope, key);
    const revision = entry?._meta.revision ?? 1;
    await ctx.events.emit('workspace.fact.written', { scope, key, revision });
    ctx.logger.info('substrate write applied for organ', { cell: writerAddress, scope, key, revision });
  };
}

/**
 * The reaction reactor: the generic tier-1 half of "machines react to the
 * substrate". Every fact change emits `workspace.fact.written`; this handler
 * loads the changed fact, finds the slice's matching `_subscriptions/*`, and
 * invokes each one's declared action with params templated from the event.
 *
 * Reactions invoke *declared actions*, so the action's own `if` guard decides
 * whether it actually fires (an auto-rail action whose `from` ≠ the run's node
 * fails the precondition — an expected no-op). A write that does fire re-emits
 * `workspace.fact.written`, so the next rail reacts in turn — a bounded fixpoint
 * (capped by the triggering fact's revision vs. the subscription's maxDepth).
 *
 * A subscription either `invoke`s a declared action (in-process, the bounded
 * default) or `deliver`s to a cell tool — called AS the slice owner — for
 * reactions that need a cell's capabilities (e.g. a model deciding an agent
 * rail, then writing the decision back, which re-triggers the deterministic
 * rails). Nothing here knows about machines: the same primitive lets any cell
 * react to captures, claims, tending reports, etc.
 */
export type CellDelivery = (
  target: { owner: string; name: string; tool: string },
  args: Record<string, unknown>,
  asUser: string,
  ctx: ServiceContext,
) => Promise<void>;

/** Default delivery: call cells.callCellTool as the slice owner (a trusted peer). */
const deliverViaCells: CellDelivery = async (target, args, asUser, ctx) => {
  const cells = createServiceClient({ registry: ctx.config.registry, user: asUser })('cells');
  await cells.command('callCellTool', { owner: target.owner, name: target.name, tool: target.tool, args });
};

export function createFactReactionHandler(build: DepsBuilder, deliver: CellDelivery = deliverViaCells): EventBridgeHandler {
  return async (detail, ctx) => {
    const scope = typeof detail.scope === 'string' ? detail.scope : '';
    const key = typeof detail.key === 'string' ? detail.key : '';
    const revision = typeof detail.revision === 'number' ? detail.revision : 0;
    // Never react to vocabulary/system writes (subscriptions, actions, tending…).
    if (!scope || !key || key.startsWith('_')) return;

    const { state } = build(ctx);
    const subs = await createSubscriptions(state).list(scope);
    if (!subs.length) return;

    const entry = await state.get(scope, key);
    if (!entry || entry._meta.superseded) return;
    const fact = { key, value: entry.value, type: entry._meta.type ?? undefined, meta: entry._meta };

    const hits = subs.filter((s) => subscriptionMatches(s, fact));
    if (!hits.length) return;

    const actions = createDeclarativeActions(state);
    const identity: Identity = { user: 'platform/reaction', scopes: [] };

    // Dead-letter a swallowed reaction failure as an OBSERVABLE fact, so a silently
    // broken reaction (e.g. an invoke that throws before writing) surfaces in the
    // substrate — not just a buried CloudWatch `warn`. Keyed `_reaction-errors/<id>`:
    // the `_` prefix means the reactor skips it (line above), and we write via
    // state.put without emitting `workspace.fact.written`, so there is no loop.
    // Best-effort: the error path must never throw. Latest-error-per-subscription
    // (overwrite) keeps it bounded.
    const recordReactionError = async (subId: string, kind: 'invoke' | 'deliver', target: string, err: unknown): Promise<void> => {
      try {
        await state.put(
          {
            scope,
            key: `_reaction-errors/${subId}`,
            value: { subscription: subId, kind, target, key, error: (err as Error)?.message ?? String(err), at: new Date().toISOString() },
            via: 'platform/reaction',
            type: 'reaction-error',
            tags: ['reaction-error'],
          },
          identity,
        );
      } catch {
        /* best-effort — a dead-letter write must never break the reactor */
      }
    };
    for (const sub of hits) {
      if (revision > (sub.maxDepth ?? 50)) {
        ctx.logger.warn('reaction skipped: depth cap', { scope, key, revision, subscription: sub.id });
        continue;
      }
      const params = resolveParams(sub, key, scope, entry.value);

      if (sub.deliver) {
        // Cross-cell reaction: hand the event to a cell tool as the slice owner.
        const target = parseCellTarget(sub.deliver);
        if (!target) {
          ctx.logger.warn('reaction skipped: bad deliver address', { scope, subscription: sub.id, deliver: sub.deliver });
          continue;
        }
        // Grants-to-principals (machine.md §9 Increment 3): when delivering to a
        // models agent that carries `grants` (a machine rail's tool scope), mint a
        // per-run token FOR the owner scoped to those grants and hand it to the
        // agent, so it can call REAL tools (workspace.link, @owner/cell.tool) — not
        // just the bespoke substrate_* wrappers. The agent still bounds writes to
        // the rail's key-patterns cell-side.
        let deliverParams = params;
        const grants = (params as Record<string, unknown>).grants as { read?: unknown; write?: unknown } | undefined;
        // Mint a per-run token for a models AGENT (work/decide) or a run CODE step
        // (ADR-0026 work-code rail) — both call REAL tools as the owner, scoped to
        // the rail's grants. The token rides in as `token` (models.agent / run.exec).
        if (grants && (target.name === 'models' || target.name === 'run')) {
          const scopes: string[] = [];
          if (grants.read) scopes.push('workspace:read');
          if (grants.write) scopes.push('workspace:write');
          if (scopes.length) {
            try {
              const minted = await ctx.serviceClient('auth').command<{ token?: string }>('mintTokenFor', { owner: scope, scope: scopes.join(' '), expiresInSec: 900 });
              if (minted?.token) deliverParams = { ...params, token: minted.token };
            } catch (err) {
              ctx.logger.warn('per-run agent token mint failed; agent runs substrate-only', { scope, subscription: sub.id, error: (err as Error).message });
            }
          }
        }
        try {
          await deliver(target, deliverParams, scope, ctx);
          ctx.logger.info('reaction delivered', { scope, key, subscription: sub.id, deliver: sub.deliver });
        } catch (err) {
          ctx.logger.warn('reaction deliver failed', { scope, subscription: sub.id, deliver: sub.deliver, error: (err as Error).message });
          await recordReactionError(sub.id, 'deliver', sub.deliver, err);
        }
        continue;
      }

      try {
        const result = await actions.invoke(scope, sub.invoke as string, params, identity);
        // Re-surface the writes so a downstream subscription (the next rail) reacts.
        for (const w of result.writes) {
          await ctx.events.emit('workspace.fact.written', { scope, key: w.key, revision: w._meta.revision });
        }
        ctx.logger.info('reaction fired', { scope, key, subscription: sub.id, invoke: sub.invoke, writes: result.writes.length });
      } catch (err) {
        // A failed `if`/`enabled` guard is the expected no-op (the rail whose
        // `from` ≠ the current node). Anything else is a real fault.
        if (err instanceof ActionInvokeError && (err.code === 'precondition_failed' || err.code === 'action_disabled')) continue;
        ctx.logger.warn('reaction invoke failed', { scope, subscription: sub.id, invoke: sub.invoke, error: (err as Error).message });
        await recordReactionError(sub.id, 'invoke', sub.invoke as string, err);
      }
    }
  };
}

/** The substrate pointer a cell lifecycle projects to: `cells/<cellId>`. */
interface CellPointer {
  cellId: string;
  name: string;
  address: string;
  public?: boolean;
  description?: string | null;
  status: string;
  version?: string;
  files?: string[];
  clientEntry?: string | null;
  staticFiles?: string[];
  /** Source edited since the last deploy. */
  dirty?: boolean;
}

/**
 * Platform reflected in the substrate: the cells service announces lifecycle
 * events (create / files changed / deployed / delete), and the workspace
 * projects each cell into a `cells/<cellId>` pointer fact (type `cell`) in the
 * owner's slice — so cells are queryable, linkable, and placeable on boards
 * like any other fact.
 *
 * Trust model: the rule pins `source` to the cells service (platform code),
 * which resolved `owner` from its registry — unlike `substrate.write.requested`
 * the detail is first-party, so it is taken as-is.
 */
export function createCellLifecycleHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx, meta) => {
    if (meta.source !== 'cells') {
      ctx.logger.warn('cell lifecycle event from unexpected source refused', { source: meta.source });
      return;
    }
    const cellId = typeof detail.cellId === 'string' ? detail.cellId : '';
    const owner = typeof detail.owner === 'string' ? detail.owner : '';
    if (!cellId || !owner) {
      ctx.logger.warn('cell lifecycle event missing cellId/owner refused', { detailType: meta.detailType });
      return;
    }
    const { state } = build(ctx);
    const key = `cells/${cellId}`;
    const writer: Identity = { user: 'platform/cells', scopes: [] };
    const prior = (await state.get(owner, key))?.value as CellPointer | undefined;
    const name = typeof detail.name === 'string' ? detail.name : prior?.name ?? cellId;
    const base: CellPointer = {
      ...(prior && typeof prior === 'object' ? prior : undefined),
      cellId,
      name,
      address: typeof detail.address === 'string' ? detail.address : prior?.address ?? `@${owner}/${name}`,
      status: prior?.status ?? 'ACTIVE',
    };
    if (typeof detail.public === 'boolean') base.public = detail.public;

    let value: CellPointer;
    switch (meta.detailType) {
      case 'cell.create.requested':
        value = { ...base, status: 'CREATING', description: (detail.description as string | null | undefined) ?? null };
        break;
      case 'cell.deployed':
        value = {
          ...base,
          status: 'ACTIVE',
          version: typeof detail.version === 'string' ? detail.version : undefined,
          files: Array.isArray(detail.files) ? (detail.files as string[]) : base.files,
          clientEntry: (detail.clientEntry as string | null | undefined) ?? null,
          staticFiles: Array.isArray(detail.staticFiles) ? (detail.staticFiles as string[]) : [],
          dirty: false,
        };
        break;
      case 'cell.files.changed': {
        const paths = Array.isArray(detail.paths) ? (detail.paths as string[]) : [];
        const files = new Set(base.files ?? []);
        for (const p of paths) {
          if (detail.op === 'delete') files.delete(p);
          else files.add(p);
        }
        value = { ...base, files: Array.from(files).sort(), dirty: true };
        break;
      }
      case 'cell.delete.requested':
        value = { ...base, status: 'DELETED' };
        break;
      default:
        ctx.logger.warn('unhandled cell lifecycle event', { detailType: meta.detailType });
        return;
    }

    const entry = await state.put(
      { scope: owner, key, value, via: `cells:${meta.detailType}`, type: 'cell', tags: ['cell'] },
      writer,
    );
    await ctx.events.emit('workspace.fact.written', { scope: owner, key, revision: entry._meta.revision });
    ctx.logger.info('cell lifecycle projected', { scope: owner, key, status: value.status, revision: entry._meta.revision });

    // ADR-0027 Inc 3: on deploy, project a `file`-typed SOURCE MANIFEST so a cell's
    // src/ tree is a queryable fact (`query type=file prefix="cells/"`) and linkable
    // — "any file is a fact". A listing, not per-file (those stay in S3, read on
    // demand via cells.readFile). undefined fields are stripped at the write (fix #1).
    if (meta.detailType === 'cell.deployed') {
      const manifestKey = `cells/${cellId}/source-manifest`;
      const manifest = {
        path: `cells/${cellId}/src/`,
        contentType: 'application/vnd.parc.cell-source-manifest+json',
        cell: base.address,
        files: Array.isArray(detail.files) ? (detail.files as string[]) : value.files ?? [],
        version: typeof detail.version === 'string' ? detail.version : undefined,
        clientEntry: (detail.clientEntry as string | null | undefined) ?? null,
        source: 'cells:deployed',
      };
      const m = await state.put(
        { scope: owner, key: manifestKey, value: manifest, via: 'cells:deployed', type: 'file', tags: ['file', 'cell-source'] },
        writer,
      );
      await ctx.events.emit('workspace.fact.written', { scope: owner, key: manifestKey, revision: m._meta.revision });
    }

    // ADR-0052: capabilities are facts. On deploy, project each tool the cell
    // advertises into a `_caps/@owner/name.tool` capability fact — embeddable
    // (so goal-conditioned recall can surface "what can I DO about X"), typed,
    // regenerable (superseded on undeploy/delete, rewritten each deploy). The
    // tool list comes from `cells.describeCellTools` for THIS cell, invoked as
    // the owner (the event is first-party; the owner sees all their own tools).
    // Best-effort: a discovery failure must not poison the lifecycle event.
    if (meta.detailType === 'cell.deployed' || meta.detailType === 'cell.delete.requested') {
      try {
        await projectCapabilityFacts(ctx, state, {
          cellId,
          owner,
          address: base.address,
          deleted: meta.detailType === 'cell.delete.requested',
        });
      } catch (err) {
        ctx.logger.warn('capability projection failed (cell fact already written)', { cellId, error: (err as Error).message });
      }
    }
  };
}

/** The value shape of a `capability` fact (ADR-0052). */
interface CapabilityFact {
  /** The dotted invoke address (`@owner/name.tool`) — what you pass to act/read. */
  target: string;
  /** Duplicates `target` so the embedder's text fields pick the address up. */
  name: string;
  kind: 'read' | 'act';
  /** One-line summary (the tool's description) — the embeddable meaning. */
  summary: string;
  cell: string;
  /** Where the full input schema lives — resolve the target via `$catalog`. */
  schemaRef: string;
}

/**
 * Reconcile a cell's `_caps/*` capability facts to its advertised tools
 * (ADR-0052): write one fact per tool, supersede the stale ones (a removed
 * tool, or every tool on delete). Keys are `_caps/<address>.<tool>` — system
 * namespace (excluded from tending) but explicitly embeddable (`vectors.ts`
 * carves `_caps/` out), so relevance can match a goal to a tool.
 */
async function projectCapabilityFacts(
  ctx: ServiceContext,
  state: ObservedState,
  cell: { cellId: string; owner: string; address: string; deleted: boolean },
): Promise<void> {
  const writer: Identity = { user: 'platform/cells', scopes: [] };
  const addr = cell.address.replace(/^\//, ''); // `@owner/name`
  const prefix = `_caps/${addr}.`;

  // The cell's advertised tools (empty on delete — everything supersedes).
  let tools: Array<{ tool: string; description: string; kind: 'read' | 'act' }> = [];
  if (!cell.deleted) {
    // Invoke as the OWNER: `describeCellTools` filters visibility per caller,
    // and the owner sees all of their own cell's tools. The event is
    // first-party (source pinned to the cells service), so this is not a
    // caller-supplied identity.
    const asOwner = createServiceClient({ registry: ctx.config.registry, correlationId: ctx.correlationId, user: cell.owner });
    const res = await asOwner('cells').command<{ tools?: Array<{ tool?: string; description?: string; kind?: string }> }>(
      'describeCellTools',
      { cellId: cell.cellId },
    );
    tools = (res?.tools ?? [])
      .filter((t): t is { tool: string; description?: string; kind?: string } => typeof t.tool === 'string' && !!t.tool)
      .map((t) => ({ tool: t.tool, description: t.description ?? `${addr} · ${t.tool}`, kind: t.kind === 'read' ? 'read' : 'act' as const }));
  }

  const existing = await state.query(cell.owner, { prefix }, writer);
  const wanted = new Set(tools.map((t) => `${prefix}${t.tool}`));

  for (const t of tools) {
    const key = `${prefix}${t.tool}`;
    const value: CapabilityFact = {
      target: `${addr}.${t.tool}`,
      name: `${addr}.${t.tool}`,
      kind: t.kind,
      summary: t.description,
      cell: addr,
      schemaRef: `$catalog resolve: ${addr}.${t.tool}`,
    };
    const e = await state.put(
      { scope: cell.owner, key, value, via: 'cells:capability', type: 'capability', tags: ['capability'] },
      writer,
    );
    await ctx.events.emit('workspace.fact.written', { scope: cell.owner, key, revision: e._meta.revision });
  }
  for (const stale of existing.entries) {
    if (!wanted.has(stale.key)) await state.supersede(cell.owner, stale.key, null, writer);
  }
  ctx.logger.info('capabilities projected (ADR-0052)', {
    cell: addr,
    written: tools.length,
    retired: existing.entries.filter((e) => !wanted.has(e.key)).length,
  });
}

/**
 * ADR-0027 Inc 2: mirror a cell DATA blob into a `file` fact when `cells.putData`
 * writes one (`cell.data.changed`). The fact lands in the UPLOADING user's slice
 * (their file), keyed `file/cells/<cellId>/data/<key>`, as a thin pointer (s3Key +
 * metadata, never the bytes). Makes blobs queryable/linkable/shareable. NB: presigned
 * direct-to-S3 uploads bypass the handler, so they aren't mirrored — capturing those
 * needs an S3→EventBridge rule (deferred; documented in ADR-0027).
 */
export function createDataFileMirrorHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx, meta) => {
    if (meta.source !== 'cells') {
      ctx.logger.warn('cell.data.changed from unexpected source refused', { source: meta.source });
      return;
    }
    const cellId = typeof detail.cellId === 'string' ? detail.cellId : '';
    const user = typeof detail.user === 'string' ? detail.user : '';
    const key = typeof detail.key === 'string' ? detail.key : '';
    if (!cellId || !user || !key) {
      ctx.logger.warn('cell.data.changed missing cellId/user/key refused', {});
      return;
    }
    const { state } = build(ctx);
    const writer: Identity = { user: 'platform/cells', scopes: [] };
    const factKey = `file/cells/${cellId}/data/${key}`;
    const s3Key = `cells/${cellId}/data/${user}/${key}`;
    // A delete-op retires the mirrored file fact (cells.deleteData).
    if (detail.op === 'delete') {
      const existing = await state.get(user, factKey);
      if (existing && !existing._meta.superseded) {
        await state.supersede(user, factKey, null, writer, {});
        ctx.logger.info('cell data file-fact retired', { scope: user, key: factKey });
      }
      return;
    }
    const value = {
      path: s3Key,
      s3Key,
      contentType: typeof detail.contentType === 'string' ? detail.contentType : 'application/octet-stream',
      bytes: typeof detail.bytes === 'number' ? detail.bytes : undefined,
      url: typeof detail.url === 'string' ? detail.url : undefined,
      cell: typeof detail.name === 'string' && typeof detail.owner === 'string' ? `@${detail.owner}/${detail.name}` : undefined,
      // ADR-0030 (blob text extraction): a small TEXT blob carries a bounded preview
      // on the event (putData) — inline it as `content` so the fact is full-text
      // searchable (embeddableText prefers `content`). Binary/large blobs omit it and
      // stay thin pointers (ADR-0027 §1).
      content: typeof detail.content === 'string' ? detail.content : undefined,
      source: 'cells.putData',
    };
    const entry = await state.put(
      { scope: user, key: factKey, value, via: 'cells:data', type: 'file', tags: ['file', 'cell-data'] },
      writer,
    );
    await ctx.events.emit('workspace.fact.written', { scope: user, key: factKey, revision: entry._meta.revision });
    ctx.logger.info('cell data mirrored to file fact', { scope: user, key: factKey });
  };
}

// Cell-declared types are stored canonically on the cell *registry* (global,
// see `cells.describeTypes`), not projected per-slice — so the vocabulary is
// readable by every user and the anonymous landing. A user's own `_types/<type>`
// facts still act as personal overrides (the gateway's `$types` merges them on
// top). See docs/type-vocabulary.md.
