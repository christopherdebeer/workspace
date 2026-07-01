/**
 * Workspace shared plumbing (ADR-0044 Inc 5): the injectable deps builders, the
 * cached type-vocabulary lookups, inline type affordances, and the granular
 * type-scope guards used across the command-group modules.
 */
import {
  ServiceContext,
  hasScope,
  ServiceAuthError,
  type Identity,
  createObservedState,
  type ObservedState,
  resolveType,
  extractTypeRules,
  type TypeRules,
  type VectorStore,
  type Embedder,
  type StateStore,
} from '../../platform/runtime';
import { createDynamoStateStoreV3 as createDynamoStateStore } from '../../platform/runtime/dynamo-state-store-v3';
import { vectorsFromEnv } from '../../platform/runtime/s3-vectors-store';
import { createDynamoGrantStore, type GrantStore } from './grants';

export interface WorkspaceDeps {
  state: ObservedState;
  grants: GrantStore;
  /** Semantic-search backend (ADR-0030). Optional: absent → `search` reports that
   *  semantic search isn't configured (the substrate degrades to `query`/`contains`). */
  vectors?: { store: VectorStore; embedder: Embedder };
  /** Raw state store — used by `reindex` to write inferred `similarTo` edges directly
   *  (ADR-0031, the edge-write seam). Absent in lighter test builders → edge pass skipped. */
  store?: StateStore;
}
export type DepsBuilder = (ctx: ServiceContext) => WorkspaceDeps;

function tableName(ctx: ServiceContext): string {
  // The shared substrate table is the home of facts + grants; the cell's own
  // table remains only as a fallback (tests/local). See docs/substrate-storage.md.
  const table = ctx.config.substrateTableName ?? ctx.config.tableName;
  if (!table) throw new Error('workspace requires the substrate table (SUBSTRATE_TABLE)');
  return table;
}

/** Production deps: observed state + grants over the shared substrate table, plus the
 *  semantic-search backend when `VECTOR_BUCKET` is configured (ADR-0030 — else `search`
 *  degrades to a hint). `vectorsFromEnv` keeps the v3 SDK lazy (loaded on first use). */
export const dynamoDeps: DepsBuilder = (ctx) => {
  const table = tableName(ctx);
  const store = createDynamoStateStore(table);
  return { state: createObservedState(store), grants: createDynamoGrantStore(table), vectors: vectorsFromEnv(), store };
};

/**
 * The canonical type vocabulary (`cells.describeTypes`): `{ <type>: decl }` with
 * `manager`, render hints, and any declared `schema`/`fields`. Global (not
 * per-user) and changes only on cell deploy, so a short process-wide cache keeps
 * it off the hot path; a fetch failure degrades to `{}` (the backbone still links
 * facts to their types, schema hints simply go quiet).
 */
const TYPE_DECLS_TTL_MS = 60_000;
let typeDeclsCache: { at: number; decls: Record<string, Record<string, unknown>> } | null = null;
/** Test seam: drop the process-wide type-vocabulary cache (consistent with the
 *  runtime's `__setLambda`/`__setEventBridge` injection seams). */
export function __resetTypeDeclsCache(): void {
  typeDeclsCache = null;
}
export async function typeDeclsFor(ctx: ServiceContext): Promise<Record<string, Record<string, unknown>>> {
  if (typeDeclsCache && Date.now() - typeDeclsCache.at < TYPE_DECLS_TTL_MS) return typeDeclsCache.decls;
  let decls: Record<string, Record<string, unknown>> = {};
  try {
    const res = await ctx.serviceClient('cells').command<{ types?: Record<string, Record<string, unknown>> }>('describeTypes', {});
    decls = res?.types ?? {};
    typeDeclsCache = { at: Date.now(), decls };
  } catch (err) {
    ctx.logger.warn('type vocabulary unavailable — backbone cell links + schema hints skipped', { error: (err as Error).message });
  }
  return decls;
}

/** Per-type Reference rules (ADR-0003), resolved from the cached vocabulary: the
 *  manager (`managedBy`), the `ref` fields (embedded edges), and key-encoded edges.
 *  One `resolveType` per declared type. */
export async function typeRulesFor(ctx: ServiceContext): Promise<Record<string, TypeRules>> {
  const decls = await typeDeclsFor(ctx);
  const rules: Record<string, TypeRules> = {};
  for (const [type, decl] of Object.entries(decls)) {
    const r = extractTypeRules(resolveType(decl, type));
    if (r.manager || r.refs || r.keyPattern) rules[type] = r;
  }
  return rules;
}

/**
 * The per-type **affordance** a read inlines for the types present in its result
 * (ADR-0029 R1). Handed a fact, an agent answers "what can I DO with this, and
 * where?" from the *same* response — `types[fact._meta.type].handlers[intent]`
 * (an act target / surface / renderer) and `.manager` (the owning cell) — instead
 * of a second `read("$types")` + manual correlation. `label` is the type's label
 * *path* (e.g. `value.title`), matching `$types`' `present.label`.
 */
export interface TypeAffordance {
  icon?: string;
  label?: string;
  render?: unknown;
  handlers?: Record<string, unknown>;
  manager?: string;
}

/** Build the inline `types` map for the type names present in a read result
 *  (ADR-0029 R1). One `resolveType` per *distinct type* (not per entry → no
 *  per-fact bloat), from the already-cached canonical vocabulary; an undeclared
 *  type (empty affordance) is omitted, and `_`-prefixed plumbing types are
 *  skipped. Slice-local `_types/<T>` overrides are NOT folded in here (rare —
 *  `read("$types")` still returns the fully-merged view). */
export function affordancesForTypes(
  typeNames: Iterable<string | null | undefined>,
  decls: Record<string, Record<string, unknown>>,
): Record<string, TypeAffordance> {
  const present = new Set<string>();
  for (const t of typeNames) if (typeof t === 'string' && t && !t.startsWith('_')) present.add(t);
  const out: Record<string, TypeAffordance> = {};
  for (const t of present) {
    const rt = resolveType(decls[t], t);
    const aff: TypeAffordance = {};
    if (rt.present.icon !== undefined) aff.icon = rt.present.icon;
    if (rt.present.label !== undefined) aff.label = rt.present.label;
    if (rt.present.render !== undefined) aff.render = rt.present.render;
    if (rt.handlers !== undefined) aff.handlers = rt.handlers;
    if (rt.manager !== undefined) aff.manager = rt.manager;
    if (Object.keys(aff).length) out[t] = aff;
  }
  return out;
}

/** The `_meta.type` of every entry in a read container (entry array or key→Entry
 *  map), plus any standalone type strings (e.g. elided stubs). For `affordancesForTypes`. */
export function typesOf(
  container: Array<{ _meta?: { type?: string | null } }> | Record<string, { _meta?: { type?: string | null } }> | undefined,
  ...extra: Array<string | null | undefined>
): Array<string | null | undefined> {
  const list = container ? (Array.isArray(container) ? container : Object.values(container)) : [];
  return [...list.map((e) => e?._meta?.type), ...extra];
}

/**
 * Granular type-scope enforcement (docs/auth-consent-plan.md §B). A token scoped to
 * specific fact types (`write:type:<T>`) — but NOT the coarse `write:workspace` —
 * may write ONLY facts of those types. Inert for everything that exists today:
 *  - internal/trusted callers carry no scopes → allowed (Mode-1 bypasses the PEP);
 *  - coarse/admin/platform tokens hold `write:workspace` → allowed;
 * so only a *granular-only* external token is constrained, refined per the exact
 * fact type. The gateway's `scopeFamily: 'write:type:*'` gate lets such a token
 * reach this handler; this is where the concrete type is actually checked. A
 * type-scoped token may not write system vocabulary (`_…`) or untyped facts.
 */
export function enforceTypeWrite(identity: Identity, type: string | undefined, key: string): void {
  if (!identity.scopes?.length) return; // internal/trusted Mode-1 caller (no PEP)
  if (hasScope(identity, 'write:workspace')) return; // coarse / admin / platform:*
  const t = type && !key.startsWith('_') ? type : null;
  if (t && hasScope(identity, `write:type:${t}`)) return;
  throw new ServiceAuthError(
    t
      ? `scope_denied: writing type "${t}" requires "write:type:${t}" or "write:workspace"; your token holds neither.`
      : `scope_denied: a type-scoped token may only write typed, non-system facts (key "${key}"${type ? '' : ', untyped'}); needs "write:workspace".`,
  );
}

/**
 * Granular type-scope enforcement for the READ side (docs/auth-consent-plan.md §B) —
 * the symmetric sibling of `enforceTypeWrite`. A token scoped to specific fact types
 * (`read:type:<T>`) but NOT the coarse `read:workspace` may observe ONLY facts of
 * those types. Inert for everything that exists today: internal callers carry no
 * scopes; coarse/admin/platform tokens hold `read:workspace`.
 *
 * Unlike a write (which always names exactly one type), a read can fan out across
 * many types at once — `recall`/`neighbors`/`members`/… return whole shaped views.
 * Rather than silently *elide* facts a granular token may not see (which would make
 * a partial view look complete), this **denies** any read that is not pinned to a
 * single held type: a type-scoped reader must `peek` a fact of a held type or
 * `query` with an explicit held `type`. Pass `type=undefined` to mean "whole-view /
 * untyped read" — always denied for a granular-only token.
 */
export function enforceTypeRead(identity: Identity, type: string | undefined, key: string): void {
  if (!identity.scopes?.length) return; // internal/trusted Mode-1 caller (no PEP)
  if (hasScope(identity, 'read:workspace')) return; // coarse / admin / platform:*
  const t = type && !key.startsWith('_') ? type : null;
  if (t && hasScope(identity, `read:type:${t}`)) return;
  throw new ServiceAuthError(
    t
      ? `scope_denied: reading type "${t}" requires "read:type:${t}" or "read:workspace"; your token holds neither.`
      : `scope_denied: a type-scoped read token must target a single held fact type — peek a typed fact or query with an explicit \`type\`; a whole-view/untyped read needs "read:workspace".`,
  );
}
