/**
 * Workspace command group (ADR-0044 Inc 5): write/remember/supersede —
 * remember, ingest, supersede, plus the write-through grant guard.
 */
import { requireUser, schemaHints, mergeTypeDecl, resolveType, type FactTimer } from '../../platform/runtime';
import { RENDERERS_PREFIX } from '../../platform/runtime/state';
import { ACTIONS_PREFIX } from './actions';
import { VIEWS_PREFIX } from './views';
import { grantCovers, GROUPS_NS, PUBLIC_NS, type GrantStore } from './grants';
import { GRANTS_NS } from './grant-requests';
import { type DepsBuilder, typeDeclsFor, enforceTypeWrite } from './shared';
import type { WorkspaceCommands } from './handlers';

export interface RememberInput {
  key: string;
  value: unknown;
  /** Write-through: the slice owner to write into (requires their write grant). */
  owner?: string;
  /** Optional label for how the write happened (e.g. an action name). */
  via?: string;
  /** Optional indexable fact type (e.g. "decision", "todo"). */
  type?: string;
  /** Optional tags. */
  tags?: string[];
  /** CAS: require the stored revision to equal this (0 = must not exist). */
  ifRevision?: number;
  /** CAS (proof-of-read, ADR-0066): require the stored content hash (`_meta.version`)
   *  to equal this. `""` = create-only. Unforgeable without having read the value. */
  ifVersion?: string;
  /** CAS: require the key not to exist. */
  ifAbsent?: boolean;
  /** Lease/reveal timer, evaluated at read (no scheduler). */
  timer?: FactTimer;
  /** Import-only: preserve a migrated fact's timestamps + cumulative read/write
   *  counts (folded into `standing`). See WriteInput.import. */
  import?: { createdAt?: string; updatedAt?: string; seedReads?: number; seedWrites?: number };
  /** Earned salience (ADR-0070): set this fact's persisted reward in [0,1]
   *  (clamped; omit to preserve). Normally written by the consolidation pass.
   *  Inert unless `rewardWeight` is configured (default 0). */
  reward?: number;
}

/** Bulk intake — imports and capture backfills land in one round trip. */
export interface IngestInput {
  facts: RememberInput[];
  /** Default `via` for facts that do not set their own. */
  via?: string;
  /** Optional edges to write after the facts (bulk graph import). */
  edges?: Array<{ from: string; rel: string; to: string; strength?: number }>;
}

export interface IngestResult {
  ingested: number;
  /** Per-fact failures (the rest were written — intake is best-effort). */
  errors: Array<{ key: string; error: string }>;
}

export interface SupersedeInput {
  key: string;
  /** Successor key, or omitted to simply retire the fact. */
  by?: string;
  /** Re-point the fact's edges at the successor (requires `by`). */
  migrateLinks?: boolean;
}

/** ADR-0086 Inc 3: a WORK LEASE — time-bounded exclusivity over a contended
 *  item. A lease asserts nothing (that would be a claim — the epistemic word);
 *  it expires on its own, so a crashed holder releases it by silence. */
export interface LeaseInput {
  /** The contention domain, e.g. `suggestion`, `run`. */
  domain: string;
  /** The item within it, e.g. a pair hash or run id. */
  item: string;
  /** Lease duration in minutes (default 5, clamped 1–120). Must exceed honest
   *  work duration — the reaper lesson (ADR-0084 §6). */
  minutes?: number;
  /** Optional free-text note (what the holder intends). */
  note?: string;
}
export interface LeaseResult {
  held: boolean;
  key: string;
  /** Who holds it — the caller's participant key (ADR-0086) or principal when
   *  `held`; the CURRENT holder when not. */
  holder: string | null;
  expiresAt: string | null;
}
export interface ReleaseInput {
  domain: string;
  item: string;
}

/**
 * Write-through guard: a caller may write into another owner's slice only
 * under a `write` grant covering the key — and never into the reserved
 * vocabulary/grants namespaces (the same rule the organ path applies). The
 * denial teaches the escalation path (docs/scope-grants.md §5).
 */
async function requireWriteThrough(
  grants: GrantStore,
  caller: string,
  owner: string,
  key: string,
): Promise<void> {
  // `_renderers/` is EXECUTABLE content: lit/canvas run a renderer fact's source
  // in the owner's own session-bearing page (plugins-as-content). That is safe
  // exactly and only as "your slice, your code" — so a granted writer must never
  // plant one (ADR-0044 Inc 4; ADR-0046 records the trust rule). Foreign-authored
  // renderers have a sandboxed path: ui:// federation.
  if (key.startsWith(ACTIONS_PREFIX) || key.startsWith(VIEWS_PREFIX) || key.startsWith(RENDERERS_PREFIX) || key.startsWith(GRANTS_NS) || key.startsWith(GROUPS_NS) || key.startsWith(PUBLIC_NS)) {
    throw new Error(`write-through may not touch the reserved namespace ("${key}")`);
  }
  const held = await grants.listForGrantee(caller);
  const ok = held.some((g) => g.owner === owner && g.mode === 'write' && grantCovers(g.key, key));
  if (!ok) {
    throw new Error(
      `grant_denied: no write grant from "${owner}" covers "${key}". ` +
        `Request one: act("workspace.requestGrant", { resource: "workspace:${owner}:${key}:write" })`,
    );
  }
}

/** The write/remember/supersede command handlers (ADR-0044 Inc 5). */
export function createWriteCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'remember' | 'ingest' | 'supersede' | 'lease' | 'release'> {
  return {
    async remember(input, ctx) {
      const caller = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state, grants } = build(ctx);
      const scope = input.owner && input.owner !== caller ? input.owner : caller;
      if (scope !== caller) await requireWriteThrough(grants, caller, scope, input.key);
      enforceTypeWrite(ctx.identity, input.type, input.key); // granular type-scope (§B); inert for coarse tokens
      const entry = await state.put(
        {
          scope,
          key: input.key,
          value: input.value,
          via: input.via,
          type: input.type,
          tags: input.tags,
          ifRevision: input.ifRevision,
          ifVersion: input.ifVersion,
          ifAbsent: input.ifAbsent,
          timer: input.timer,
          import: input.import,
          reward: input.reward,
        },
        ctx.identity,
      );
      await ctx.events.emit('workspace.fact.written', { scope, key: input.key, revision: entry._meta.revision });
      ctx.logger.info('workspace fact written', { scope, key: input.key, revision: entry._meta.revision, writer: caller });
      // Advisory only: the write already happened. Nudge missing recommended
      // fields (per the type's schema), or that a typed-but-schemaless type could
      // declare one. Never for system facts (`_…` plumbing) or untyped values.
      if (input.type && !input.key.startsWith('_')) {
        // Resolve the type's declaration exactly as `$types` does: the canonical
        // cell vocabulary, overridden by the writer's own `_types/<type>` fact
        // (where seeded/slice-local schemas like `claim` live).
        const canonical = (await typeDeclsFor(ctx))[input.type];
        const override = (await state.get(scope, `_types/${input.type}`, ctx.identity))?.value;
        const type = resolveType(mergeTypeDecl(canonical, override), input.type); // one resolve → facets
        const hints = schemaHints({ type: input.type, value: input.value, fields: type.shape.fields, declared: type.declared });
        if (hints.length) return { ...entry, hints };
      }
      return entry;
    },

    async ingest(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!Array.isArray(input?.facts) || input.facts.length === 0) throw new Error('facts (non-empty array) is required');
      if (input.facts.length > 100) throw new Error('ingest is capped at 100 facts per call');
      // Vocabulary stays deliberate: bulk intake may not write declarations.
      for (const f of input.facts) {
        if (!f?.key || typeof f.key !== 'string') throw new Error('every fact requires a string `key`');
        if (f.key.startsWith(ACTIONS_PREFIX) || f.key.startsWith(VIEWS_PREFIX)) {
          throw new Error(`ingest may not write the declared vocabulary ("${f.key}")`);
        }
        enforceTypeWrite(ctx.identity, f.type, f.key); // granular type-scope (§B); inert for coarse tokens
      }
      const { state } = build(ctx);
      const errors: IngestResult['errors'] = [];
      let ingested = 0;
      for (const f of input.facts) {
        try {
          await state.put(
            {
              scope,
              key: f.key,
              value: f.value,
              via: f.via ?? input.via,
              type: f.type,
              tags: f.tags,
              ifAbsent: f.ifAbsent,
              timer: f.timer,
              import: f.import,
              reward: f.reward,
            },
            ctx.identity,
          );
          ingested++;
        } catch (err) {
          errors.push({ key: f.key, error: (err as Error).message });
        }
      }
      // Bulk edges (graph import) after the facts; dangling edges are allowed.
      for (const e of input.edges ?? []) {
        try {
          if (e?.from && e?.rel && e?.to) await state.link(scope, e.from, e.rel, e.to, e.strength ?? null, ctx.identity);
        } catch (err) {
          errors.push({ key: `${e?.from}-[${e?.rel}]->${e?.to}`, error: (err as Error).message });
        }
      }
      // One announcement for the batch — intake should not storm the bus.
      await ctx.events.emit('workspace.ingested', { scope, count: ingested, errors: errors.length });
      ctx.logger.info('workspace facts ingested', { scope, count: ingested, errors: errors.length });
      return { ingested, errors };
    },

    async supersede(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      return state.supersede(scope, input.key, input.by ?? null, ctx.identity, { migrateLinks: input.migrateLinks });
    },

    // ── ADR-0086 Inc 3: work leases ─────────────────────────────────
    async lease(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.domain || !input?.item) throw new Error('domain and item are required');
      const { state } = build(ctx);
      const minutes = Math.min(Math.max(input.minutes ?? 5, 1), 120);
      const key = `lease/${input.domain}/${input.item}`;
      const holder = ctx.identity?.participant ?? scope;
      try {
        // The ifAbsent+timer atomic write IS the lease (an expired-delete fact
        // reads as absent, so a crashed holder's lease self-releases). One call,
        // crash-safe, no scheduler — sync's canonical hand-off.
        const e = await state.put(
          {
            scope,
            key,
            value: { holder, domain: input.domain, item: input.item, ...(input.note ? { note: input.note } : {}) },
            via: 'workspace.lease',
            type: 'lease',
            tags: ['lease'],
            ifAbsent: true,
            timer: { ms: minutes * 60_000, effect: 'delete' },
          },
          ctx.identity,
        );
        return { held: true, key, holder, expiresAt: e._meta.timer?.expiresAt ?? null };
      } catch (err) {
        if ((err as { name?: string }).name !== 'StatePreconditionError') throw err;
        // Contended: report the live holder so the caller can move on. (If the
        // lease lapsed between the failed write and this read, holder comes
        // back null — retry the lease.)
        const existing = await state.get(scope, key, ctx.identity);
        return {
          held: false,
          key,
          holder: (existing?.value as { holder?: string } | null)?.holder ?? existing?._meta.as ?? null,
          expiresAt: existing?._meta.timer?.expiresAt ?? null,
        };
      }
    },

    async release(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.domain || !input?.item) throw new Error('domain and item are required');
      const { state } = build(ctx);
      const key = `lease/${input.domain}/${input.item}`;
      const existing = await state.get(scope, key, ctx.identity);
      if (!existing) return { released: false, key, reason: 'no live lease' };
      const holder = (existing.value as { holder?: string } | null)?.holder ?? null;
      const me = ctx.identity?.participant ?? scope;
      // Release = EXPIRE NOW, not supersede: acquisition's ifAbsent already
      // reads a lapsed-delete timer as absent, so an expired lease is exactly
      // "released" in the vocabulary acquirers understand — and the key keeps
      // its revision continuity for the next lease. Releasing another
      // participant's lease is permitted but NOTED — the participant key never
      // carries authority (ADR-0086); the provenance trail is the accountability.
      await state.put(
        {
          scope,
          key,
          value: { ...(existing.value as Record<string, unknown>), released: true, releasedBy: me },
          via: 'workspace.release',
          type: 'lease',
          tags: ['lease'],
          timer: { at: new Date(Date.now() - 1000).toISOString(), effect: 'delete' },
        },
        ctx.identity,
      );
      return { released: true, key, ...(holder && holder !== me ? { note: `released a lease held by ${holder}` } : {}) };
    },
  };
}
