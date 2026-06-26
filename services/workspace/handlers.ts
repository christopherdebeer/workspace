/**
 * Workspace cell — the first flagship *room* over the observed-state substrate,
 * now with the sharing/view layer.
 *
 * There is one Substrate. A user's workspace is a *view* over it: their own
 * **slice** (`scope` = caller identity) plus the **subsets others have granted**
 * to them. The vocabulary:
 *
 *   remember  — write a fact to your slice        (put)
 *   recall    — your salience-shaped *view*        (own slice ∪ granted, shaped once)
 *   peek      — one fact by key, from your slice   (get)
 *   supersede — retire a fact                      (supersede, not delete)
 *   share     — expose a key (or your whole slice) to another user
 *   unshare   — revoke a share
 *   shared    — what you've shared, and what's shared with you
 *
 * Sharing is additive: it changes which facts `recall` assembles, not the
 * observed-state primitive. Granted facts surface under `<owner>/<key>` keys so
 * provenance is obvious and keys never collide across slices.
 *
 * Handlers are built over an injectable dependency builder so the unit tests can
 * drive them with in-memory stores, exactly as the auth cell swaps its store.
 */
import {
  ServiceContext,
  requireUser,
  grantScopesOf,
  hasScope,
  ServiceAuthError,
  type Identity,
  createObservedState,
  type ObservedState,
  type Entry,
  type EntryMeta,
  type ReadResult,
  type QueryResult,
  type NeighborsResult,
  type MembersResult,
  type ChangesResult,
  type AttentionResult,
  type EdgeRecord,
  type LinkResult,
  type FactTimer,
  type CommandHandler,
  type RegisteredCommand,
  type SalienceLens,
  type SalienceOptions,
  schemaHints,
  mergeTypeDecl,
  resolveType,
  extractTypeRules,
  type TypeRules,
  type VectorStore,
  type Embedder,
  type VectorFilter,
  type StateStore,
  indexForScope,
  embeddableText,
  metadataForFact,
  selectNeighbors,
  similarConfig,
  refreshSimilarEdges,
  authoredPairs,
  pairKey,
  SIMILAR_REL,
  SIMILAR_WRITER,
} from '../../platform/runtime';
import {
  createDeclarativeActions,
  ACTIONS_PREFIX,
  ActionInvokeError,
  type ActionDefinition,
  type RegisterResult,
  type InvokeResult,
} from './actions';
import {
  createRegisteredViews,
  VIEWS_PREFIX,
  type ViewDefinition,
  type ViewResult,
} from './views';
import {
  createSubscriptions,
  SUBSCRIPTIONS_PREFIX,
  matches as subscriptionMatches,
  resolveParams,
  parseCellTarget,
  type SubscriptionDefinition,
} from './subscriptions';
import { createServiceClient } from '../../platform/runtime/service-client';
import type { EventBridgeHandler } from '../../platform/runtime';
import { createDynamoStateStore } from '../../platform/runtime/dynamo-state-store';
import { vectorsFromEnv } from '../../platform/runtime/s3-vectors-store';
import {
  createDynamoGrantStore,
  grantCovers,
  applicableGrants,
  PUBLIC,
  GROUPS_NS,
  PUBLIC_NS,
  type GrantStore,
  type Grant,
  type GrantMode,
  WHOLE_SLICE,
} from './grants';
import {
  parseResource,
  requestKey,
  answerKey,
  GRANTS_NS,
  REQUESTS_PREFIX,
  ANSWERS_PREFIX,
  NOTE_MAX,
  type GrantRequestValue,
  type GrantAnswerValue,
} from './grant-requests';

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
async function typeDeclsFor(ctx: ServiceContext): Promise<Record<string, Record<string, unknown>>> {
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
async function typeRulesFor(ctx: ServiceContext): Promise<Record<string, TypeRules>> {
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
function affordancesForTypes(
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
function typesOf(
  container: Array<{ _meta?: { type?: string | null } }> | Record<string, { _meta?: { type?: string | null } }> | undefined,
  ...extra: Array<string | null | undefined>
): Array<string | null | undefined> {
  const list = container ? (Array.isArray(container) ? container : Object.values(container)) : [];
  return [...list.map((e) => e?._meta?.type), ...extra];
}

/** Attach the inline `types` affordance map to a single returned fact (`peek`),
 *  leaving a `null` (absent) fact untouched (ADR-0029 R1). */
function withAffordance(entry: Entry | null, decls: Record<string, Record<string, unknown>>): Entry | (Entry & { types: Record<string, TypeAffordance> }) | null {
  if (!entry) return entry;
  const types = affordancesForTypes([entry._meta.type], decls);
  return Object.keys(types).length ? { ...entry, types } : entry;
}

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
  /** CAS: require the key not to exist. */
  ifAbsent?: boolean;
  /** Lease/reveal timer, evaluated at read (no scheduler). */
  timer?: FactTimer;
  /** Import-only: preserve a migrated fact's timestamps + cumulative read/write
   *  counts (folded into `standing`). See WriteInput.import. */
  import?: { createdAt?: string; updatedAt?: string; seedReads?: number; seedWrites?: number };
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
export interface RecallInput {
  elision?: 'auto' | 'none';
  expand?: string[];
  includeSuperseded?: boolean;
  /** Bias salience via a named lens (recent/connected/durable/active). */
  lens?: SalienceLens;
  /** Precise per-call salience override (merges over the lens + defaults). */
  salience?: Partial<SalienceOptions>;
  /** Attach `_meta.explain` (signals · weights · contributions) per entry. */
  explain?: boolean;
}
export interface PeekInput {
  key: string;
  /** Read-through: the slice owner to read from (requires a grant covering the key). */
  owner?: string;
}
export interface QueryInput {
  type?: string;
  tag?: string;
  prefix?: string;
  rankBy?: 'salience' | 'recency';
  /** Bias salience via a named lens (recent/connected/durable/active). */
  lens?: SalienceLens;
  /** Precise per-call salience override (merges over the lens + defaults). */
  salience?: Partial<SalienceOptions>;
  limit?: number;
  /** Resume token from a previous page's `nextCursor`. */
  cursor?: string;
  includeSuperseded?: boolean;
  /** Find a fact by what's inside it: keep only facts whose key or value
   *  (stringified) contains this substring, case-insensitively. */
  contains?: string;
  /** Attach `_meta.explain` (signals · weights · contributions) per entry. */
  explain?: boolean;
}
export interface SearchInput {
  /** Natural-language query — embedded and matched by meaning (ADR-0030). */
  text: string;
  /** Restrict to one fact type (also the granular `read:type:<T>` pin). */
  type?: string;
  /** Restrict to facts carrying this (primary) tag. */
  tag?: string;
  /** Max results (1–50, default 10). */
  limit?: number;
}
export interface SearchHit {
  key: string;
  value: unknown;
  _meta: EntryMeta;
  /** Cosine similarity to the query (1 = closest). */
  score: number;
}
export interface SearchResult {
  entries: SearchHit[];
  count: number;
  total: number;
  /** Inline affordances (ADR-0029 R1) for the types present — present when ≥1 declared. */
  types?: Record<string, TypeAffordance>;
  /** Present when no vector backend is configured (degraded to query/contains). */
  hint?: string;
}
export interface ReindexInput {
  /** Only reindex facts of this type. */
  type?: string;
  /** Only reindex keys with this prefix. */
  prefix?: string;
  /** Cap on facts scanned (1–5000, default 2000). */
  max?: number;
}
export interface PruneSimilarInput {
  /** Cap on inferred edges deleted in one pass (default: all redundant). */
  max?: number;
}
export interface LinkInput {
  from: string;
  rel: string;
  to: string;
  strength?: number;
}
export type UnlinkInput = Omit<LinkInput, 'strength'>;
export interface NeighborsInput {
  key: string;
  dir?: 'in' | 'out' | 'both';
  rel?: string;
}
export interface ChangesInput {
  /** Events after this seq; `'head'` returns no events, just the current head to tail from. */
  sinceSeq?: number | 'head';
  limit?: number;
}
export interface LinksInput {
  /** Only edges whose `from` or `to` starts with this prefix. */
  prefix?: string;
}
export interface AttentionInput {
  /** Age (ms) beyond which a live fact counts as stale. Default 14 days. */
  staleMs?: number;
  limit?: number;
  /** Also surface `_`-prefixed system namespaces (default false). */
  includeSystem?: boolean;
}
export interface SupersedeInput {
  key: string;
  /** Successor key, or omitted to simply retire the fact. */
  by?: string;
  /** Re-point the fact's edges at the successor (requires `by`). */
  migrateLinks?: boolean;
}
export interface RegisterActionInput {
  action: ActionDefinition;
}
export interface DeleteActionInput {
  id: string;
}
export interface InvokeInput {
  action: string;
  params?: Record<string, unknown>;
}
export interface RegisterViewInput {
  view: ViewDefinition;
}
export interface ViewInput {
  id: string;
}
export type DeleteViewInput = ViewInput;
export interface RegisterSubscriptionInput {
  subscription: SubscriptionDefinition;
}
export interface DeleteSubscriptionInput {
  id: string;
}
export interface ShareInput {
  /** The user to share with. */
  to: string;
  /** A fact key, a prefix (`inbox/*`), or omitted to share your whole slice. */
  key?: string;
  /** `read` (default) or `write` — write-through lets the grantee remember into the covered keys. */
  mode?: GrantMode;
}
export type UnshareInput = Omit<ShareInput, 'mode'>;
export interface SharedResult {
  /** Grants you have made to others. */
  shared: Grant[];
  /** Grants others have made to you. */
  receiving: Grant[];
}
/**
 * The authority self-model (ADR-0007): *what the caller may see and do*, resolving
 * the three enforcement layers into one inspectable surface — beside `$catalog`
 * (capabilities), `$types` (vocabulary), and `$graph` (references). No new
 * enforcement; this names the axis that gates Fact · Reference · Declaration.
 */
export interface GrantsSelfModel {
  /** The authenticated principal this authority belongs to. */
  principal: string;
  /** Layer 1 — token scope. `active` = what is enforced now; `ceiling` = the
   *  immutable grant set at consent (`active` can be widened up to it). */
  scope: { active: string[]; ceiling: string[] };
  /** Layer 3 — partition: the caller's own slice, where they hold full authority. */
  slice: string;
  /** Layer 2 — grant: the subsets you expose (`shared`) and receive (`receiving`),
   *  plus the named audiences you belong to or define (`groups`). */
  grant: { shared: Grant[]; receiving: Grant[]; groups: GroupResult[] };
  /** The contract the three layers compose to, as prose. */
  hint: string;
}
export interface GroupValue {
  /** Principals in this audience. */
  members: string[];
  label?: string;
  note?: string;
}
export interface GroupInput {
  /** Group name (the audience handle; share to it with `to: "group:<name>"`). */
  name: string;
  /** Replace the membership wholesale. */
  members?: string[];
  /** Add these principals (additive patch). */
  add?: string[];
  /** Remove these principals (additive patch). */
  remove?: string[];
  label?: string;
  note?: string;
}
export interface GroupResult {
  name: string;
  members: string[];
  label?: string;
  note?: string;
}
export interface GroupsResult {
  groups: Array<GroupResult>;
}
export interface RequestGrantInput {
  /** Grammar resource: `workspace:<owner>:<keyPattern>:<read|write>` or `cell:<owner>/<name>:<tool|*>`. */
  resource: string;
  note?: string;
}
export interface RequestGrantResult {
  requested: true;
  owner: string;
  resource: string;
  /** The request fact key in the owner's slice. */
  key: string;
}
export interface GrantRequestsResult {
  /** Pending requests on resources you own (your inbox). */
  incoming: Array<GrantRequestValue & { key: string }>;
  /** Outcomes of requests you made (written into your slice on resolve). */
  answers: Array<GrantAnswerValue & { key: string }>;
}
export interface ApproveGrantInput {
  /** The request fact key (from `grantRequests`). */
  key: string;
}
export interface DenyGrantInput {
  key: string;
  reason?: string;
}

// Index signature so it satisfies defineService's `Record<string, RegisteredCommand>`,
// while keeping precise per-command types for the unit tests.
export interface WorkspaceCommands extends Record<string, RegisteredCommand> {
  remember: CommandHandler<RememberInput, Entry & { hints?: string[] }>;
  ingest: CommandHandler<IngestInput, IngestResult>;
  recall: CommandHandler<RecallInput | undefined, ReadResult>;
  peek: CommandHandler<PeekInput, Entry | null>;
  query: CommandHandler<QueryInput | undefined, QueryResult>;
  search: CommandHandler<SearchInput, SearchResult>;
  reindex: CommandHandler<ReindexInput | undefined, { status: string; poll?: string; hint?: string }>;
  pruneSimilar: CommandHandler<PruneSimilarInput | undefined, { status: string; scanned: number; pruned: number; remaining: number }>;
  link: CommandHandler<LinkInput, LinkResult>;
  unlink: CommandHandler<UnlinkInput, { ok: true }>;
  neighbors: CommandHandler<NeighborsInput, NeighborsResult>;
  links: CommandHandler<LinksInput | undefined, { edges: EdgeRecord[] }>;
  graph: CommandHandler<undefined, { edges: EdgeRecord[] }>;
  members: CommandHandler<{ key: string }, MembersResult>;
  changes: CommandHandler<ChangesInput | undefined, ChangesResult>;
  attention: CommandHandler<AttentionInput | undefined, AttentionResult>;
  registerAction: CommandHandler<RegisterActionInput, RegisterResult>;
  actions: CommandHandler<undefined, { actions: ActionDefinition[] }>;
  deleteAction: CommandHandler<DeleteActionInput, { ok: true }>;
  invoke: CommandHandler<InvokeInput, InvokeResult>;
  tend: CommandHandler<undefined, TendReport>;
  registerView: CommandHandler<RegisterViewInput, ViewDefinition>;
  views: CommandHandler<undefined, { views: ViewDefinition[] }>;
  deleteView: CommandHandler<DeleteViewInput, { ok: true }>;
  view: CommandHandler<ViewInput, ViewResult>;
  registerSubscription: CommandHandler<RegisterSubscriptionInput, SubscriptionDefinition>;
  subscriptions: CommandHandler<undefined, { subscriptions: SubscriptionDefinition[] }>;
  deleteSubscription: CommandHandler<DeleteSubscriptionInput, { ok: true }>;
  supersede: CommandHandler<SupersedeInput, Entry | null>;
  share: CommandHandler<ShareInput, Grant>;
  unshare: CommandHandler<UnshareInput, { ok: true }>;
  shared: CommandHandler<undefined, SharedResult>;
  grants: CommandHandler<undefined, GrantsSelfModel>;
  group: CommandHandler<GroupInput, GroupResult>;
  groups: CommandHandler<undefined, GroupsResult>;
  requestGrant: CommandHandler<RequestGrantInput, RequestGrantResult>;
  grantRequests: CommandHandler<undefined, GrantRequestsResult>;
  approveGrant: CommandHandler<ApproveGrantInput, { approved: true; resource: string; grantee: string }>;
  denyGrant: CommandHandler<DenyGrantInput, { denied: true; resource: string; grantee: string }>;
  describeTools: CommandHandler<undefined, { tools: ToolDescriptor[] }>;
}

/** How the `/mcp` gateway discovers and advertises a cell's tools. */
interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * The result envelope, declared. Self-documentation has two directions: an
   * input schema teaches the call, a result schema teaches the read — and an
   * undeclared envelope is exactly where shapes drift apart. Kept shallow.
   */
  resultSchema?: Record<string, unknown>;
  /** Scope the gateway enforces before forwarding (null = any authenticated user). */
  scope: string | null;
  /** An any-of family gate (docs/auth-consent-plan.md §B): a token holding any scope
   *  under this pattern (e.g. `write:type:*`) passes the gateway gate, and this
   *  handler then enforces the concrete fact type. Lets a type-scoped token write
   *  only its declared types while coarse `write:workspace` tokens are unaffected. */
  scopeFamily?: string;
  /** `read` = side-effect-free (observe); `act` = may mutate. Routes read/act dispatch. */
  kind: 'read' | 'act';
}

// ── shared result-schema fragments (shallow on purpose — catalog weight is an
//    ergonomic budget; see docs/trajectory/2026-06-12-mcp-agent-ergonomics-review.md) ──

const META_SCHEMA = {
  type: 'object',
  description:
    'Provenance + salience: revision, seq, writer, via, createdAt, updatedAt, writers[], superseded, supersededBy, type, tags[], timer, score, velocity, standing, centrality, elided. With a read `explain:true`, also `explain: { signals, weights, contribution, degree }` — the score breakdown for tuning.',
} as const;

/** Per-call salience lens — an ergonomic bias over the tuned defaults. */
const LENS_SCHEMA = {
  type: 'string',
  enum: ['salience', 'recent', 'connected', 'durable', 'active'],
  description:
    'Salience lens (default salience): recent=freshness, connected=graph degree, durable=earned/cumulative, active=read/written now. Recomputes the score, so it shifts BOTH ranking and focus/peripheral/elided tiers.',
} as const;

/** Import-only provenance: preserve a migrated fact's timestamps + earned counts. */
const IMPORT_SCHEMA = {
  type: 'object',
  description:
    'Import-only: { createdAt?, updatedAt? (ISO — preserve true age for recency), seedReads?, seedWrites? (cumulative legacy counts, folded into standing) }.',
  properties: {
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    seedReads: { type: 'number' },
    seedWrites: { type: 'number' },
  },
  additionalProperties: false,
} as const;

/** Raw per-call salience override (escape hatch); merges over the lens + defaults. */
const SALIENCE_OVERRIDE_SCHEMA = {
  type: 'object',
  description:
    'Precise salience override, merged over the lens + defaults: { halfLifeMs?, windowMs?, recencyWeight?, velocityWeight?, attentionWeight?, standingWeight?, centralityWeight?, standingSaturation?, centralitySaturation?, focusThreshold?, elideThreshold? }. Not auto-normalized — you own the weights.',
  additionalProperties: true,
} as const;

const ENTRY_SCHEMA = {
  type: 'object',
  properties: { value: { description: 'The stored JSON value' }, _meta: META_SCHEMA },
} as const;

const KEYED_ENTRY_SCHEMA = {
  type: 'object',
  properties: { key: { type: 'string' }, value: { description: 'The stored JSON value' }, _meta: META_SCHEMA },
} as const;

/** The inline affordance map a read carries for the types present in its result
 *  (ADR-0029 R1) — collapses `query → $types → correlate → act` into `query → act`. */
const TYPES_AFFORDANCE_SCHEMA = {
  type: 'object',
  description:
    "What you can DO with each type in this result, keyed by type name (present only when ≥1 returned type is declared). For a fact of type T: types[T].handlers[intent] (open/edit/render/create → an act target, cell surface, or renderer) and types[T].manager (the owning cell) — no separate read('$types') needed. `label` is the type's label path (e.g. value.title).",
  additionalProperties: {
    type: 'object',
    properties: {
      icon: { type: 'string' },
      label: { type: 'string', description: 'Label path (where a fact of this type gets its display label)' },
      render: { description: 'Render binding: a { hint } or { viewer } ref' },
      handlers: { type: 'object', description: 'intent → surface | act target | renderer | hint' },
      manager: { type: 'string', description: 'The cell that manages this type' },
    },
  },
} as const;

const EDGE_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    rel: { type: 'string' },
    to: { type: 'string' },
    strength: { type: ['number', 'null'] },
    createdAt: { type: 'string' },
    writer: { type: ['string', 'null'] },
    derived: { type: 'boolean', description: 'Present and true for a derived structural-backbone edge (instanceOf/managedBy/rendersWith/inView); absent for authored edges' },
  },
} as const;

/**
 * The workspace vocabulary as MCP tool descriptors. Every command operates on the
 * caller's own slice (or subsets explicitly granted to them) — ownership/slice
 * isolation is the primary boundary. On top of that, `describeTools` derives a
 * verb scope from `kind` (reads → `read:workspace`, acts → `write:workspace`) so
 * a token's read/write consent is actually enforced; `scope: null` here means
 * "no explicit scope — gate by verb". An explicit scope (e.g. `workspace:admin`)
 * overrides the verb default.
 */
const TOOL_DESCRIPTORS: ToolDescriptor[] = [
  {
    name: 'remember',
    description:
      'Write a fact to your workspace at `key`. Re-writing a key bumps its revision; nothing is lost. Optional `type`/`tags` make it queryable; `ifRevision`/`ifAbsent` make the write conditional (CAS — fails if the precondition does not hold). Pass `owner` to write into another user\'s slice under their write grant (write-through — your identity is stamped as the writer).',
    scope: null,
    scopeFamily: 'write:type:*',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key within your slice' },
        owner: { type: 'string', description: "Write-through: the slice owner to write into (requires their `write` grant covering the key)" },
        value: { description: 'Any JSON value to remember' },
        via: { type: 'string', description: 'Optional label for how this was written (e.g. an action name)' },
        type: { type: 'string', description: 'Optional indexable fact type (e.g. "decision", "todo")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags (filterable in query)' },
        ifRevision: { type: 'number', description: 'Only write if the stored revision equals this (0 = key must not exist)' },
        ifAbsent: { type: 'boolean', description: 'Only write if the key does not exist (treats an expired lease as absent)' },
        timer: {
          type: 'object',
          description:
            'Lease/reveal timer, evaluated at read: effect "delete" = live now, vanishes at expiry (a lease); "enable" = dormant until expiry.',
          properties: {
            ms: { type: 'number', description: 'Relative expiry in ms' },
            at: { type: 'string', description: 'Absolute ISO expiry (exactly one of ms/at)' },
            effect: { type: 'string', enum: ['delete', 'enable'] },
          },
          required: ['effect'],
          additionalProperties: false,
        },
        import: IMPORT_SCHEMA,
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    resultSchema: {
      ...ENTRY_SCHEMA,
      description: 'The written fact, plus optional advisory `hints` (the write always succeeds)',
      properties: {
        ...((ENTRY_SCHEMA as { properties?: Record<string, unknown> }).properties ?? {}),
        hints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Advisory notes — missing recommended fields for the type, or that the type could declare a schema. Never blocks the write.',
        },
      },
    },
  },
  {
    name: 'ingest',
    description:
      'Bulk intake: write up to 100 facts in one call (imports, capture backfills). Each fact takes the same fields as `remember` (no `ifRevision`); failures are reported per-fact, the rest are written. May not write `_actions/` or `_views/`.',
    scope: null,
    scopeFamily: 'write:type:*',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        facts: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: {},
              via: { type: 'string' },
              type: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              ifAbsent: { type: 'boolean' },
              import: IMPORT_SCHEMA,
            },
            required: ['key', 'value'],
            additionalProperties: false,
          },
        },
        via: { type: 'string', description: 'Default `via` for facts that do not set their own' },
        edges: {
          type: 'array',
          description: 'Edges to write after the facts (bulk graph import): { from, rel, to, strength? }',
          items: {
            type: 'object',
            properties: { from: { type: 'string' }, rel: { type: 'string' }, to: { type: 'string' }, strength: { type: 'number' } },
            required: ['from', 'rel', 'to'],
            additionalProperties: false,
          },
        },
      },
      required: ['facts'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        ingested: { type: 'number' },
        errors: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, error: { type: 'string' } } } },
      },
    },
  },
  {
    name: 'recall',
    description:
      'Your whole workspace view, salience-shaped: focus/peripheral facts arrive in full, everything below the elide threshold collapses to `{key, type, score}` stubs under `elided` — re-read with `expand: [keys]` (or `peek`) to pull any back in full. For a targeted subset, prefer `query`. Granted facts appear under `<owner>/<key>`. Tune your own default shaping by writing a `_config/salience` fact (e.g. `{ focusThreshold: 0.62, elideThreshold: 0.62 }` for a focused <30-item view); precedence is defaults ← that config ← `lens` ← per-call `salience`.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        elision: { type: 'string', enum: ['auto', 'none'], description: "'auto' (default) collapses low-salience entries to stubs; 'none' returns every entry in full (heavy on a large slice)" },
        expand: { type: 'array', items: { type: 'string' }, description: 'Keys to force into focus' },
        includeSuperseded: { type: 'boolean', description: 'Include retired facts' },
        lens: LENS_SCHEMA,
        salience: SALIENCE_OVERRIDE_SCHEMA,
        explain: { type: 'boolean', description: 'Attach `_meta.explain` to each entry — the salience breakdown (signals · weights · contributions · degree) so you can see *why* a fact scored, and tune accordingly' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        entries: { type: 'object', description: 'key → { value, _meta } for focus/peripheral facts', additionalProperties: ENTRY_SCHEMA },
        elided: {
          type: 'array',
          description: 'Stubs for withheld entries (score-descending)',
          items: { type: 'object', properties: { key: { type: 'string' }, type: { type: ['string', 'null'] }, score: { type: 'number' } } },
        },
        _shaping: { type: 'object', description: 'Thresholds + counts: { focus, peripheral, elided, total }' },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'peek',
    description: 'Read one fact by key from your slice (no salience shaping). Returns null when the key is absent — including a lapsed lease — so it doubles as an existence probe. Pass `owner` to read a fact another user granted you.',
    scope: null,
    scopeFamily: 'read:type:*',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key to read' },
        owner: { type: 'string', description: 'Read-through: the slice owner to read from (requires a grant covering the key)' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: { ...ENTRY_SCHEMA, properties: { ...ENTRY_SCHEMA.properties, types: TYPES_AFFORDANCE_SCHEMA }, description: 'The fact (with an inline `types` affordance map), or null when absent' },
  },
  {
    name: 'query',
    description:
      'Projection over your slice: filter facts by type, tag, and/or key prefix; rank by salience (default) or recency; limit + cursor to page. Use this instead of recall when you want a targeted subset.',
    scope: null,
    scopeFamily: 'read:type:*',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Only facts of this type' },
        tag: { type: 'string', description: 'Only facts carrying this tag' },
        prefix: { type: 'string', description: 'Only keys with this prefix' },
        contains: { type: 'string', description: 'Find a fact by what is INSIDE it: keep only facts whose key or value (stringified) contains this substring, case-insensitively — full-text search over value content, so you need not page a partition to find "the fact that mentions X"' },
        rankBy: { type: 'string', enum: ['salience', 'recency'], description: 'Ranking (default salience)' },
        lens: LENS_SCHEMA,
        salience: SALIENCE_OVERRIDE_SCHEMA,
        explain: { type: 'boolean', description: 'Attach `_meta.explain` (signals · weights · contributions · degree) to each entry, for salience tuning' },
        limit: { type: 'number', description: 'Max entries to return' },
        cursor: { type: 'string', description: "A previous page's nextCursor (best-effort resume over a fresh ranking)" },
        includeSuperseded: { type: 'boolean', description: 'Include retired facts' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        entries: { type: 'array', items: KEYED_ENTRY_SCHEMA },
        count: { type: 'number', description: 'Entries in this page' },
        total: { type: 'number', description: 'Entries matching overall' },
        nextCursor: { type: 'string', description: 'Present when more pages remain' },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'search',
    description:
      'Semantic search: find facts by MEANING, not exact words. Embeds your text and ranks facts (and file content) by similarity across your slice + everything shared with you, then re-reads each hit authoritatively (so a result is always live + permitted). Complements `query` (structured type/tag/prefix filter) and `query.contains` (exact substring) — use `search` for "facts about X" when you do not know the exact wording. Restrict with `type`/`tag`. Returns the same `{entries, types}` shape as query. If the deployment has no vector backend, returns empty with a `hint`.',
    scope: null,
    scopeFamily: 'read:type:*',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Natural-language query, matched by meaning' },
        type: { type: 'string', description: 'Only facts of this type (also the granular read:type pin)' },
        tag: { type: 'string', description: 'Only facts carrying this (primary) tag' },
        limit: { type: 'number', description: 'Max results (1–50, default 10)' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          description: 'Ranked hits — { key, value, _meta, score } where score is cosine similarity (1 = closest)',
          items: { type: 'object', properties: { key: { type: 'string' }, value: {}, _meta: META_SCHEMA, score: { type: 'number' } } },
        },
        count: { type: 'number' },
        total: { type: 'number' },
        types: TYPES_AFFORDANCE_SCHEMA,
        hint: { type: 'string', description: 'Present only when semantic search is not configured (degraded to query/contains)' },
      },
    },
  },
  {
    name: 'link',
    description:
      'Add a typed, directed edge `from --rel--> to` between two fact keys in your slice (e.g. rel: "grounds", "refines", "relates"). The result carries `fromExists`/`toExists` hints — a dangling edge is allowed, but you learn at write time, not at the next tending pass.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Source fact key' },
        rel: { type: 'string', description: 'Edge type (a verb, e.g. "grounds")' },
        to: { type: 'string', description: 'Target fact key' },
        strength: { type: 'number', description: 'Optional edge strength' },
      },
      required: ['from', 'rel', 'to'],
      additionalProperties: false,
    },
    resultSchema: {
      ...EDGE_SCHEMA,
      properties: {
        ...EDGE_SCHEMA.properties,
        fromExists: { type: 'boolean', description: 'from resolves to a live fact' },
        toExists: { type: 'boolean', description: 'to resolves to a live fact' },
      },
    },
  },
  {
    name: 'unlink',
    description: 'Remove an edge previously added with `link`.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        rel: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['from', 'rel', 'to'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'neighbors',
    description: "The edges around a fact (outbound and/or inbound, optionally one rel) plus the neighbor entries — graph traversal, one hop. Includes the derived structural backbone (edges flagged `derived:true`): a fact `instanceOf` its `_types/<type>`, a type `managedBy` its cell and `rendersWith` its renderer, and a fact `inView` any view whose query selects it — so even an unlinked fact has a direction to explore.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The fact key to look around' },
        dir: { type: 'string', enum: ['in', 'out', 'both'], description: 'Direction (default both)' },
        rel: { type: 'string', description: 'Only edges of this type' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        outbound: { type: 'array', items: EDGE_SCHEMA },
        inbound: { type: 'array', items: EDGE_SCHEMA },
        entries: { type: 'object', description: 'neighbor key → { value, _meta } for neighbors that exist', additionalProperties: ENTRY_SCHEMA },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'links',
    description: 'Every edge in your slice (optionally filtered by a from/to key prefix) — boards and graph surfaces project their edges from this.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: 'Only edges whose from or to starts with this prefix' },
      },
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { edges: { type: 'array', items: EDGE_SCHEMA } } },
  },
  {
    name: 'graph',
    description:
      "The full Reference projection (also `read(\"$graph\")`): authored edges plus the derived rule edges — the structural backbone (instanceOf/managedBy/rendersWith/inView), embedded `ref` fields (e.g. a claim's `support`), and key-encoded membership (e.g. `_doc/<doc>/<block>` → inDoc). Derived edges carry `derived:true`. The graph half of the self-model beside `$catalog` (capabilities) and `$types` (vocabulary).",
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: { type: 'object', properties: { edges: { type: 'array', items: EDGE_SCHEMA } } },
  },
  {
    name: 'members',
    description:
      "A collection's member facts (ADR-0005). **Intensional** when the fact carries a `query` (a view) — its query is evaluated (`order:\"query\"`); **extensional** otherwise — the facts with an inbound membership edge (`inView`/`inDoc`) in the Reference projection (e.g. a doc's blocks). Extensional members come back in **narrative order** when placed by an ordering decoration (a doc-order `seq` → `order:\"seq\"`), else salience-ranked (`order:\"salience\"`). One read for 'a view's facts' and 'a doc's members' alike.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'The collection fact key (a view, a doc, …)' } },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        membership: { type: 'string', enum: ['intensional', 'extensional'] },
        order: { type: 'string', enum: ['seq', 'salience', 'query'], description: 'how members are ordered: narrative seq, salience rank, or the view query' },
        members: { type: 'array', items: ENTRY_SCHEMA, description: 'member facts (key + value + _meta); extensional members also carry `placement` {seq, fold} from their ordering decoration' },
        types: TYPES_AFFORDANCE_SCHEMA,
      },
    },
  },
  {
    name: 'changes',
    description:
      'Tail your slice’s trajectory: events (write/read/supersede/link) after `sinceSeq`, plus the current head seq to resume from. Pass sinceSeq:"head" to get just the head seq and start tailing in one call. The change feed.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        sinceSeq: {
          description: 'Return events with seq greater than this number (default 0), or "head" for no events + the current head seq',
          oneOf: [{ type: 'number' }, { type: 'string', enum: ['head'] }],
        },
        limit: { type: 'number', description: 'Max events' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        events: { type: 'array', items: { type: 'object', properties: { op: { type: 'string' }, key: { type: ['string', 'null'] }, at: { type: 'string' }, seq: { type: 'number' } } } },
        seq: { type: 'number', description: 'Current head — resume from here' },
      },
    },
  },
  {
    name: 'attention',
    description:
      'What needs tending, as a derived read: stale facts, unlinked facts, and dangling edges. `_`-prefixed system namespaces (canvas elements, declared vocabulary) are excluded unless includeSystem. The just-in-time cron — read it at session start and act on what surfaces.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        staleMs: { type: 'number', description: 'Staleness threshold in ms (default 14 days)' },
        limit: { type: 'number', description: 'Max items per category (default 25)' },
        includeSystem: { type: 'boolean', description: 'Also surface `_`-prefixed system namespaces (default false)' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        stale: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, updatedAt: { type: 'string' }, type: { type: ['string', 'null'] } } } },
        unlinked: { type: 'array', items: { type: 'string' } },
        dangling: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, rel: { type: 'string' }, to: { type: 'string' }, reason: { type: 'string' } } } },
      },
    },
  },
  {
    name: 'registerAction',
    description:
      'Declare a no-code action: `{ id, if?, enabled?, writes[], params? }` stored as a fact at `_actions/<id>` and applied by the substrate when invoked. Writes are declared (bounded, auditable); competing write targets are surfaced, not blocked. Templates support ${params.x}/${self}/${now}; per-write ifAbsent + timer expresses an atomic, lease-bound claim.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          description: 'The action definition',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            if: { type: 'array', description: 'Preconditions (AND): [{ key, path?, op: exists|absent|eq|ne|gt|lt, value? }]', items: { type: 'object' } },
            enabled: { type: 'array', description: 'Availability conditions (same shape as if)', items: { type: 'object' } },
            writes: {
              type: 'array',
              description: 'Declared writes: [{ key, value?, ifAbsent?, timer?, type?, tags? }]',
              items: { type: 'object' },
            },
            params: { type: 'object', description: 'Param schema: { <name>: { type?, description?, enum?, required? } }' },
          },
          required: ['id', 'writes'],
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        action: { type: 'object', description: 'The registered definition, echoed' },
        contested: { type: 'array', description: 'Other actions declaring writes to the same keys (surfaced, not blocked)' },
      },
    },
  },
  {
    name: 'actions',
    description: 'List the declared actions in your slice (the registered no-code vocabulary).',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: { type: 'object', properties: { actions: { type: 'array', items: { type: 'object', description: 'Action definitions' } } } },
  },
  {
    name: 'deleteAction',
    description: 'Retire a declared action (supersedes its `_actions/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'invoke',
    description:
      'Invoke a declared action by id with params. Checks enabled + if conditions (a failed precondition is a 409-style error), then applies the declared writes with substitution. The substrate interprets; no code runs.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action id' },
        params: { type: 'object', description: 'Arguments for the action' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        invoked: { type: 'boolean' },
        action: { type: 'string' },
        params: { type: 'object' },
        writes: { type: 'array', description: 'The applied writes, each `{ key, value, _meta }`', items: KEYED_ENTRY_SCHEMA },
      },
    },
  },
  {
    name: 'reindex',
    description:
      'Backfill semantic search (ADR-0030/0031): scan your slice (optionally by type/prefix), embed each text-bearing fact into your vector index, then wire inferred `similarTo` edges. Runs ASYNC + CHUNKED — a full slice far exceeds the sync request budget, so this dispatches and returns immediately; poll the `_reindex/<you>` status fact for { status: running|done, phase: embed|edges, indexed, edges }. The batch replay beside the live stream indexer; use after enabling search or changing the embedding model. Admin-only.',
    scope: 'workspace:admin',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Only reindex facts of this type' },
        prefix: { type: 'string', description: 'Only reindex keys with this prefix' },
        max: { type: 'number', description: 'Optional cap on facts processed in the embed phase' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "'started' (async dispatched), or 'unconfigured'" },
        poll: { type: 'string', description: 'Status fact key to peek for progress' },
        hint: { type: 'string' },
      },
    },
  },
  {
    name: 'pruneSimilar',
    description:
      'Prune redundant inferred `similarTo` edges (ADR-0031/0032): delete every `platform/vectors`-written kinship edge whose endpoints are ALREADY connected by an authored edge (in either direction) — a real link a person/grant asserted makes the machine-inferred hint redundant, both as structure and as a salience signal. Synchronous, vector-free (pure edge scan + deletes). The live indexer/reindex now skip these on create (dedup-on-create); this is the one-time backfill for edges written before that. Admin-only.',
    scope: 'workspace:admin',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        max: { type: 'number', description: 'Cap on edges deleted in one pass (default: all redundant)' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "'pruned' or 'unconfigured'" },
        scanned: { type: 'number', description: 'Inferred similarTo edges examined' },
        pruned: { type: 'number', description: 'Redundant edges deleted' },
        remaining: { type: 'number', description: 'Redundant edges left (when capped by max)' },
      },
    },
  },
  {
    name: 'tend',
    description:
      'Run a tending pass now: attention() distilled into a `tending/latest` audit fact (stale / unlinked / dangling, with samples) — the just-in-time cron made manual. A daily schedule writes the same report.',
    scope: 'workspace:admin',
    kind: 'act',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      description: 'The tending report (also written to `tending/latest`)',
      properties: {
        at: { type: 'string' },
        scope: { type: 'string' },
        stale: { type: 'number' },
        unlinked: { type: 'number' },
        dangling: { type: 'number' },
        staleSample: { type: 'array' },
        unlinkedSample: { type: 'array' },
        danglingSample: { type: 'array' },
      },
    },
  },
  {
    name: 'registerView',
    description:
      'Register a named view: `{ id, query, reduce?, path?, render? }` stored as a fact at `_views/<id>`. A view is a stored projection (the query primitive as data) with an optional reduction (list|count|latest|sum) and a render hint — the same declaration is a dashboard surface for humans and an affordance for agents.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        view: {
          type: 'object',
          description: 'The view definition',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            query: { type: 'object', description: 'Query options: { type?, tag?, prefix?, rankBy?, limit?, includeSuperseded? }' },
            reduce: { type: 'string', enum: ['list', 'count', 'latest', 'sum'] },
            path: { type: 'string', description: 'Dot-path into each value, for sum' },
            render: { type: 'object', description: 'Render hint: { type: metric|table|feed|list|markdown, label?, ... }' },
          },
          required: ['id', 'query'],
        },
      },
      required: ['view'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: 'The registered view definition, echoed' },
  },
  {
    name: 'views',
    description: 'List the registered views in your slice.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: { type: 'object', properties: { views: { type: 'array', items: { type: 'object', description: 'View definitions' } } } },
  },
  {
    name: 'view',
    description: 'Evaluate a registered view against the current slice — returns its value, count, and render hint.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The view id' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        description: { type: 'string' },
        render: { type: ['object', 'null'], description: 'The render hint' },
        value: { description: 'The evaluated value, per the view’s reduce' },
        count: { type: 'number' },
      },
    },
  },
  {
    name: 'deleteView',
    description: 'Retire a registered view (supersedes its `_views/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'registerSubscription',
    description:
      'Register a reaction: `{ id, match:{type?,keyPrefix?,cel?}, invoke|deliver, params?, maxDepth? }` stored as a fact at `_subscriptions/<id>`. When a fact write matches `match`, the reactor fires — either `invoke` (a declared action id, in-process) or `deliver` (a cell tool "@owner/name.tool", called AS you, for reactions that need a cell, e.g. a model deciding an agent rail) — with `params` templated from the event (${key} ${keySuffix} ${scope} ${value.<path>}). The generic primitive behind reactive machines — a tier-2 cell makes a process reactive by registering subscriptions, no platform change needed.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        subscription: {
          type: 'object',
          description: 'The subscription definition',
          properties: {
            id: { type: 'string' },
            match: { type: 'object', description: 'Predicate over the changed fact: { type?, keyPrefix?, cel? }' },
            invoke: { type: 'string', description: 'Declared action id to invoke when matched (exactly one of invoke/deliver)' },
            deliver: { type: 'string', description: 'Cell tool address "@owner/name.tool" to call as the slice owner (exactly one of invoke/deliver)' },
            params: { type: 'object', description: 'Arg templates over the event: { name: "${keySuffix}" | "${value.x}" | … }' },
            maxDepth: { type: 'number', description: 'Loop bound: skip when the triggering fact revision exceeds this (default 50)' },
            label: { type: 'string' },
          },
          required: ['id', 'match'],
        },
      },
      required: ['subscription'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', description: 'The registered subscription definition, echoed' },
  },
  {
    name: 'subscriptions',
    description: 'List the reaction subscriptions in your slice.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: { type: 'object', properties: { subscriptions: { type: 'array', items: { type: 'object', description: 'Subscription definitions' } } } },
  },
  {
    name: 'deleteSubscription',
    description: 'Retire a reaction subscription (supersedes its `_subscriptions/<id>` fact).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'supersede',
    description:
      'Retire a fact (it stops surfacing in recall but is not deleted). Optionally point it at a successor key; `migrateLinks` carries its edges to the successor so the graph does not rot. Returns the retired fact, or null when the key never existed.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Fact key to retire' },
        by: { type: 'string', description: 'Optional successor key' },
        migrateLinks: { type: 'boolean', description: 'Re-point edges at the successor (requires `by`)' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: { ...ENTRY_SCHEMA, description: 'The retired fact, or null when the key never existed' },
  },
  {
    name: 'share',
    description:
      'Grant access to a fact, a key prefix (`inbox/*`), or your whole slice (omit `key`). Share `to` a user, to `public` (the universal audience — anyone, including unauthenticated readers; read-only), or to `group:<name>` (a named audience you define with `workspace.group`). mode "read" (default) makes it appear in their recall; mode "write" additionally lets them remember into the covered keys of your slice (write-through — their identity is stamped as the writer).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'A username, "public" (anyone), or "group:<name>" (a named audience)' },
        key: { type: 'string', description: 'A fact key, a prefix ending in `*` (e.g. "inbox/*"), or omit for your whole slice' },
        mode: { type: 'string', enum: ['read', 'write'], description: 'read (default) = visibility; write = write-through too (not allowed for public)' },
      },
      required: ['to'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { owner: { type: 'string' }, grantee: { type: 'string' }, key: { type: 'string', description: '"*" = whole slice' }, mode: { type: 'string' }, createdAt: { type: 'string' } },
    },
  },
  {
    name: 'unshare',
    description: 'Revoke a share previously made with `share`.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The user to revoke' },
        key: { type: 'string', description: 'The fact key, or omit for the whole-slice share' },
      },
      required: ['to'],
      additionalProperties: false,
    },
    resultSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  },
  {
    name: 'shared',
    description: 'List what you have shared with others and what others have shared with you (each grant: owner, grantee, key pattern, mode).',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        shared: { type: 'array', description: 'Grants you have made' },
        receiving: { type: 'array', description: 'Grants made to you' },
      },
    },
  },
  {
    name: 'grants',
    description:
      'The authority self-model (also `read("$grants")`): *what you may see and do*, resolving the three enforcement layers into one surface — `scope` (token: active + ceiling), `slice` (your own partition, full authority), and `grant` (the subsets you `shared`/`receiving` + the `groups` you belong to or define). The authority surface beside `$catalog` (capabilities), `$types` (vocabulary), and `$graph` (references). Inspect-only — it reports authority, it does not change it.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        principal: { type: 'string' },
        scope: { type: 'object', description: '{ active: enforced now, ceiling: the grant max }' },
        slice: { type: 'string', description: 'Your own slice — full authority' },
        grant: { type: 'object', description: '{ shared[], receiving[], groups[] }' },
        hint: { type: 'string' },
      },
    },
  },
  {
    name: 'group',
    description:
      'Define or patch a named audience (a group of principals) you can then `share` to with `to: "group:<name>"`. Pass `members` to set the membership wholesale, or `add`/`remove` to patch it. The group is stored as a `_groups/<name>` fact in your slice; recall resolves group shares for members without scanning. You are always implicitly in your own audiences.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The audience handle (bare name)' },
        members: { type: 'array', items: { type: 'string' }, description: 'Replace the membership with exactly these principals' },
        add: { type: 'array', items: { type: 'string' }, description: 'Add these principals' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Remove these principals' },
        label: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        members: { type: 'array', items: { type: 'string' } },
        label: { type: 'string' },
        note: { type: 'string' },
      },
    },
  },
  {
    name: 'groups',
    description: 'List the named audiences you have defined, each with its current membership.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: { groups: { type: 'array', description: 'Your audiences: { name, members[], label?, note? }' } },
    },
  },
  {
    name: 'requestGrant',
    description:
      'Ask a resource owner for access you were denied. The request lands as a fact in the owner\'s slice (provenance-stamped as you), surfaces in their grantRequests inbox, and the outcome is written back into your slice under `_grants/answers/`. Resources use the scope grammar: "workspace:<owner>:<keyPattern>:<read|write>" or "cell:<owner>/<name>:<tool|*>".',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        resource: { type: 'string', description: 'e.g. "workspace:alice:inbox/*:write" or "cell:alice/regwatch:save_prompt"' },
        note: { type: 'string', description: `Why you need it (≤${NOTE_MAX} chars)` },
      },
      required: ['resource'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        requested: { type: 'boolean' },
        owner: { type: 'string' },
        resource: { type: 'string' },
        key: { type: 'string', description: "The request fact key in the owner's slice" },
      },
    },
  },
  {
    name: 'grantRequests',
    description:
      'Your grant inbox: pending requests on resources you own (resolve with approveGrant/denyGrant), plus the outcomes of requests you made (answers land in your slice when the owner resolves).',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        incoming: {
          type: 'array',
          description: 'Pending requests: [{ key, requester, resource, note?, requestedAt }]',
        },
        answers: {
          type: 'array',
          description: 'Outcomes of your requests: [{ key, resource, status, by, at, reason? }]',
        },
      },
    },
  },
  {
    name: 'approveGrant',
    description:
      'Approve a pending grant request (by its fact key from grantRequests): applies the grant — workspace resources via share, cell resources via cells.grant — then resolves the request and notifies the requester.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', description: 'The request fact key' } },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { approved: { type: 'boolean' }, resource: { type: 'string' }, grantee: { type: 'string' } },
    },
  },
  {
    name: 'denyGrant',
    description: 'Deny a pending grant request (by its fact key), optionally with a reason the requester will see.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The request fact key' },
        reason: { type: 'string', description: `Optional reason (≤${NOTE_MAX} chars)` },
      },
      required: ['key'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { denied: { type: 'boolean' }, resource: { type: 'string' }, grantee: { type: 'string' } },
    },
  },
];

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
  if (key.startsWith(ACTIONS_PREFIX) || key.startsWith(VIEWS_PREFIX) || key.startsWith(GRANTS_NS) || key.startsWith(GROUPS_NS) || key.startsWith(PUBLIC_NS)) {
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

/** Load and validate a pending grant request fact from the owner's slice. */
async function pendingRequest(
  state: ObservedState,
  owner: string,
  key: string | undefined,
  identity: Identity,
): Promise<GrantRequestValue> {
  if (!key || !key.startsWith(REQUESTS_PREFIX)) {
    throw new Error(`key must be a grant-request fact key (see read("workspace.grantRequests"))`);
  }
  const entry = await state.get(owner, key, identity);
  const req = entry?.value as GrantRequestValue | undefined;
  if (!entry || entry._meta.superseded || req?.status !== 'pending') {
    throw new Error(`not_found: no pending grant request at "${key}"`);
  }
  if (parseResource(req.resource).owner !== owner) {
    throw new Error('only the resource owner can resolve this request');
  }
  return req;
}

/** Mark a request resolved and write the outcome into the requester's slice. */
async function resolveRequest(
  state: ObservedState,
  ctx: ServiceContext,
  owner: string,
  key: string,
  req: GrantRequestValue,
  status: 'approved' | 'denied',
  reason?: string,
): Promise<void> {
  const at = new Date().toISOString();
  const resolved: GrantRequestValue = { ...req, status, resolvedAt: at, ...(reason ? { reason } : {}) };
  await state.put(
    { scope: owner, key, value: resolved, via: `grants:${status}`, type: 'grant-request', tags: ['grants'] },
    ctx.identity,
  );
  // Resolved requests leave the pending inbox but stay in history.
  await state.supersede(owner, key, null, ctx.identity, {});
  const answer: GrantAnswerValue = { resource: req.resource, status, by: owner, at, ...(reason ? { reason } : {}) };
  await state.put(
    {
      scope: req.requester,
      key: answerKey(owner, req.resource),
      value: answer,
      via: `grants:${status}`,
      type: 'grant-answer',
      tags: ['grants'],
    },
    ctx.identity,
  );
  await ctx.events.emit('workspace.grant.resolved', {
    owner,
    requester: req.requester,
    resource: req.resource,
    status,
  });
  ctx.logger.info('grant request resolved', { owner, requester: req.requester, resource: req.resource, status });
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
function enforceTypeWrite(identity: Identity, type: string | undefined, key: string): void {
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
function enforceTypeRead(identity: Identity, type: string | undefined, key: string): void {
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

/** Build the workspace vocabulary over a given way of constructing its deps. */
export function createWorkspaceCommands(build: DepsBuilder): WorkspaceCommands {
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
          ifAbsent: input.ifAbsent,
          timer: input.timer,
          import: input.import,
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

    async recall(input, ctx) {
      const viewer = requireUser(ctx.identity);
      const { state, grants } = build(ctx);
      const includeSuperseded = input?.includeSuperseded;

      // Own slice, scored (under the per-call lens) but not yet shaped
      // (elision:'none' keeps values present so granted slices merge cleanly).
      const lens = input?.lens;
      const salience = input?.salience;
      const explain = input?.explain;
      // The viewer's stored salience policy (`_config/salience`) governs the whole
      // assembled view — scoring (read) and tiering (shape) alike — so granted
      // slices are scored under the viewer's policy, not each owner's. Precedence:
      // instance defaults ← viewer config ← lens ← per-call `salience` override.
      const salienceConfig = await state.salienceConfig(viewer);
      const typeRules = await typeRulesFor(ctx);
      const own = await state.read(viewer, { elision: 'none', includeSuperseded, lens, salience, explain, salienceConfig, typeRules }, ctx.identity);
      const merged: Record<string, Entry> = { ...own.entries };

      // Fold in the subsets granted to this viewer — directly, via `public`, or
      // via a group they belong to (docs/scope-grants.md). A grant key is a
      // pattern: `*` = whole slice, trailing `*` = prefix.
      for (const g of await applicableGrants(grants, viewer)) {
        if (g.owner === viewer) continue;
        if (g.key === WHOLE_SLICE || g.key.endsWith('*')) {
          const slice = await state.read(g.owner, { elision: 'none', includeSuperseded, lens, salience, explain, salienceConfig, typeRules }, ctx.identity);
          const prefix = g.key === WHOLE_SLICE ? '' : g.key.slice(0, -1);
          for (const [k, e] of Object.entries(slice.entries)) {
            if (k.startsWith(prefix)) merged[`${g.owner}/${k}`] = e;
          }
        } else {
          const e = await state.get(g.owner, g.key, ctx.identity);
          if (e && (!e._meta.superseded || includeSuperseded)) merged[`${g.owner}/${g.key}`] = e;
        }
      }

      // Shape the whole assembled view once (lens echoes into _shaping).
      const shaped = state.shape(merged, { elision: input?.elision, expand: input?.expand, lens, salience, salienceConfig });
      // R1 (ADR-0029): inline affordances — include elided stubs' types so an
      // agent can act on a withheld fact's type after `expand`.
      const decls = await typeDeclsFor(ctx);
      const types = affordancesForTypes(typesOf(shaped.entries, ...(shaped.elided ?? []).map((s) => s.type)), decls);
      return Object.keys(types).length ? { ...shaped, types } : shaped;
    },

    async peek(input, ctx) {
      const caller = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state, grants } = build(ctx);
      if (input.owner && input.owner !== caller) {
        const held = await applicableGrants(grants, caller);
        const ok = held.some((g) => g.owner === input.owner && grantCovers(g.key, input.key));
        if (!ok) {
          throw new Error(
            `grant_denied: no grant from "${input.owner}" covers "${input.key}". ` +
              `Request one: act("workspace.requestGrant", { resource: "workspace:${input.owner}:${input.key}:read" })`,
          );
        }
        const granted = await state.get(input.owner, input.key, ctx.identity);
        enforceTypeRead(ctx.identity, granted?._meta.type ?? undefined, input.key); // granular read-scope (§B); inert for coarse tokens
        return withAffordance(granted, await typeDeclsFor(ctx));
      }
      const own = await state.get(caller, input.key, ctx.identity);
      enforceTypeRead(ctx.identity, own?._meta.type ?? undefined, input.key); // granular read-scope (§B); inert for coarse tokens
      return withAffordance(own, await typeDeclsFor(ctx));
    },

    async query(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      enforceTypeRead(ctx.identity, input?.type, ''); // granular read-scope (§B): a type-scoped token must pin `type`; inert for coarse tokens
      const result = await state.query(
        scope,
        {
          type: input?.type,
          tag: input?.tag,
          prefix: input?.prefix,
          rankBy: input?.rankBy,
          lens: input?.lens,
          salience: input?.salience,
          explain: input?.explain,
          limit: input?.limit,
          cursor: input?.cursor,
          includeSuperseded: input?.includeSuperseded,
          contains: input?.contains,
          typeRules: await typeRulesFor(ctx),
        },
        ctx.identity,
      );
      // R1 (ADR-0029): inline what the agent can DO with each returned type.
      const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx));
      return Object.keys(types).length ? { ...result, types } : result;
    },

    async search(input, ctx) {
      const viewer = requireUser(ctx.identity);
      const { state, grants, vectors } = build(ctx);
      // No backend wired → degrade gracefully (the substrate still has query/contains).
      if (!vectors) {
        return {
          entries: [],
          count: 0,
          total: 0,
          hint: 'semantic search is not configured on this deployment — use workspace.query (type/tag/prefix filter) or query `contains` (substring search)',
        };
      }
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      if (!text) throw new Error('text is required');
      enforceTypeRead(ctx.identity, input?.type, ''); // granular read-scope (§B): a type-scoped token must pin `type`
      const limit = Math.min(Math.max(1, input?.limit ?? 10), 50);
      const topK = limit * 4; // over-fetch; the authoritative re-read + grant post-filter trim

      const [queryVector] = await vectors.embedder.embed([text]);
      // Filter on string metadata only (type/tag) — safest across S3 Vectors filter
      // value types. `superseded` is NOT filtered here: the authoritative re-read
      // (Decision 1) drops retired facts, so the filter is pure optimization, and a
      // boolean-filter edge case must never break the whole query.
      const filter: VectorFilter = {};
      if (input?.type) filter.type = input.type;
      if (input?.tag) filter.tag = input.tag;
      const queryOpts = Object.keys(filter).length ? { topK, filter } : { topK };

      // Candidate generation (ADR-0030 Decision 1: the index is NOT an authority).
      // The readable index set mirrors recall's fold: own slice + every applicable
      // grant's owner (direct/public/group). Each hit is re-read authoritatively below.
      type Cand = { owner: string; key: string; outKey: string; score: number };
      const cands: Cand[] = [];
      const dim = vectors.embedder.dimension;
      const ownMatches = await vectors.store.query(indexForScope(viewer, dim), queryVector, queryOpts).catch(() => []);
      for (const m of ownMatches) cands.push({ owner: viewer, key: m.key, outKey: m.key, score: m.score });
      for (const g of await applicableGrants(grants, viewer)) {
        if (g.owner === viewer) continue;
        const matches = await vectors.store.query(indexForScope(g.owner, dim), queryVector, queryOpts).catch(() => []);
        for (const m of matches) {
          if (!grantCovers(g.key, m.key)) continue; // whole-slice / prefix / exact — exactly as peek
          cands.push({ owner: g.owner, key: m.key, outKey: `${g.owner}/${m.key}`, score: m.score });
        }
      }

      // Collapse a key reachable via >1 path to its best score, then rank.
      const best = new Map<string, Cand>();
      for (const c of cands) {
        const prev = best.get(c.outKey);
        if (!prev || c.score > prev.score) best.set(c.outKey, c);
      }
      const ranked = [...best.values()].sort((a, b) => b.score - a.score);

      // Authoritative re-read (Decision 1): scope/grant/timer/supersession re-enforced
      // on the LIVE substrate with the viewer's identity. A stale or wrong vector — a
      // superseded fact still in the index, a lapsed lease — is dropped here, never leaked.
      const entries: Array<{ key: string; value: unknown; _meta: EntryMeta; score: number }> = [];
      for (const c of ranked) {
        if (entries.length >= limit) break;
        const e = await state.get(c.owner, c.key, ctx.identity);
        if (!e || e._meta.superseded) continue;
        entries.push({ key: c.outKey, value: e.value, _meta: e._meta, score: Number(c.score.toFixed(4)) });
      }

      const types = affordancesForTypes(typesOf(entries), await typeDeclsFor(ctx)); // R1 envelope
      const result = { entries, count: entries.length, total: entries.length };
      return Object.keys(types).length ? { ...result, types } : result;
    },

    async reindex(input, ctx) {
      const scope = requireUser(ctx.identity);
      // Admin-only backfill. ASYNC + CHUNKED (ADR-0030/0031): a full slice is ~hundreds
      // of Titan calls — far over the ~30s edge cap AND the 60s Lambda — so the command
      // only *dispatches*: it records a `running` status fact and emits the first
      // continuation event, returning immediately. `createReindexHandler` then processes
      // one bounded page per invocation off the stream, chaining continuation events
      // (embed all → then similarTo edges, which need the full index present). Poll the
      // status fact. The live stream indexer keeps NEW writes indexed; this is the replay.
      if (!hasScope(ctx.identity, 'workspace:admin') && !hasScope(ctx.identity, 'platform:*')) {
        throw new ServiceAuthError('reindex requires workspace:admin');
      }
      const { state, vectors } = build(ctx);
      if (!vectors) return { status: 'unconfigured', hint: 'semantic search is not configured on this deployment' };
      const statusKey = `_reindex/${scope}`;
      const value: Record<string, unknown> = { status: 'running', phase: 'embed', indexed: 0, skipped: 0, edges: 0, startedAt: new Date().toISOString() };
      if (input?.type) value.type = input.type;
      if (input?.prefix) value.prefix = input.prefix;
      if (input?.max) value.max = input.max;
      await state.put({ scope, key: statusKey, value, via: 'reindex', type: 'reindex-status' }, ctx.identity);
      await ctx.events.emit('workspace.reindex.requested', { scope, type: input?.type, prefix: input?.prefix, max: input?.max, phase: 'embed', indexed: 0, skipped: 0, edges: 0 });
      ctx.logger.info('reindex dispatched (async, chunked)', { scope, type: input?.type, prefix: input?.prefix });
      return { status: 'started', poll: statusKey, hint: `reindex runs async in chunks; poll peek("${statusKey}") for { status, phase, indexed, edges }` };
    },

    async pruneSimilar(input, ctx) {
      const scope = requireUser(ctx.identity);
      // Vector-free, synchronous edge hygiene (ADR-0031/0032): delete inferred
      // `similarTo` edges whose endpoints an authored edge already connects. A real
      // link a person/grant asserted makes the machine's kinship hint redundant — as
      // structure (it surfaces twice in neighbors/$graph) and as a salience signal
      // (centrality would double-count the same relationship). The live indexer +
      // reindex now skip these on create; this is the one-time backfill.
      if (!hasScope(ctx.identity, 'workspace:admin') && !hasScope(ctx.identity, 'platform:*')) {
        throw new ServiceAuthError('pruneSimilar requires workspace:admin');
      }
      const { store } = build(ctx);
      if (!store) return { status: 'unconfigured', scanned: 0, pruned: 0, remaining: 0 };
      const existing = await store.listEdges(scope);
      const authored = authoredPairs(existing);
      const redundant = existing.filter(
        (e) =>
          e.rel === SIMILAR_REL &&
          e.writer === SIMILAR_WRITER &&
          authored.has(pairKey(e.from, e.to)),
      );
      const cap = input?.max && input.max > 0 ? input.max : redundant.length;
      const toDelete = redundant.slice(0, cap);
      for (const e of toDelete) await store.deleteEdge(scope, e.from, e.rel, e.to);
      ctx.logger.info('pruneSimilar complete', { scope, scanned: redundant.length, pruned: toDelete.length });
      return { status: 'pruned', scanned: redundant.length, pruned: toDelete.length, remaining: redundant.length - toDelete.length };
    },

    async link(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.from || !input?.rel || !input?.to) throw new Error('from, rel, and to are required');
      const { state } = build(ctx);
      const edge = await state.link(scope, input.from, input.rel, input.to, input.strength ?? null, ctx.identity);
      ctx.logger.info('workspace edge linked', { scope, from: edge.from, rel: edge.rel, to: edge.to });
      return edge;
    },

    async unlink(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.from || !input?.rel || !input?.to) throw new Error('from, rel, and to are required');
      const { state } = build(ctx);
      return state.unlink(scope, input.from, input.rel, input.to, ctx.identity);
    },

    async neighbors(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      const result = await state.neighbors(scope, input.key, { dir: input.dir, rel: input.rel, typeRules: await typeRulesFor(ctx) }, ctx.identity);
      const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx)); // R1 (ADR-0029)
      return Object.keys(types).length ? { ...result, types } : result;
    },

    async links(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      const all = await state.edges(scope);
      const prefix = input?.prefix;
      return {
        edges: prefix ? all.filter((e) => e.from.startsWith(prefix) || e.to.startsWith(prefix)) : all,
      };
    },

    async graph(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return state.graph(scope, { typeRules: await typeRulesFor(ctx) });
    },

    async members(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      const result = await state.members(scope, input.key, { typeRules: await typeRulesFor(ctx) });
      const types = affordancesForTypes(typesOf(result.members), await typeDeclsFor(ctx)); // R1 (ADR-0029)
      return Object.keys(types).length ? { ...result, types } : result;
    },

    async changes(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      const sinceSeq = input?.sinceSeq === 'head' ? 'head' : (input?.sinceSeq ?? 0);
      return state.changes(scope, sinceSeq, input?.limit);
    },

    async attention(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return state.attention(scope, { staleMs: input?.staleMs, limit: input?.limit, includeSystem: input?.includeSystem });
    },

    async registerAction(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.action) throw new Error('action is required');
      const { state } = build(ctx);
      const result = await createDeclarativeActions(state).register(scope, input.action, ctx.identity);
      ctx.logger.info('workspace action registered', {
        scope,
        action: result.action.id,
        contested: result.contested.length,
      });
      return result;
    },

    async actions(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { actions: await createDeclarativeActions(state).list(scope) };
    },

    async deleteAction(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createDeclarativeActions(state).remove(scope, input.id, ctx.identity);
    },

    async invoke(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.action) throw new Error('action is required');
      const { state } = build(ctx);
      const result = await createDeclarativeActions(state).invoke(scope, input.action, input.params ?? {}, ctx.identity);
      await ctx.events.emit('workspace.action.invoked', { scope, action: input.action });
      // Each write is a fact change — surface it so subscriptions react to a
      // manual step exactly as they do to a reactive one.
      for (const w of result.writes) {
        await ctx.events.emit('workspace.fact.written', { scope, key: w.key, revision: w._meta.revision });
      }
      ctx.logger.info('workspace action invoked', { scope, action: input.action, writes: result.writes.length });
      return result;
    },

    async tend(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return runTend(state, scope, ctx, 'manual', ctx.identity);
    },

    async registerView(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.view) throw new Error('view is required');
      const { state } = build(ctx);
      const view = await createRegisteredViews(state).register(scope, input.view, ctx.identity);
      ctx.logger.info('workspace view registered', { scope, view: view.id });
      return view;
    },

    async views(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { views: await createRegisteredViews(state).list(scope) };
    },

    async deleteView(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createRegisteredViews(state).remove(scope, input.id, ctx.identity);
    },

    async view(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createRegisteredViews(state).evaluate(scope, input.id, ctx.identity);
    },

    async registerSubscription(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.subscription) throw new Error('subscription is required');
      const { state } = build(ctx);
      const sub = await createSubscriptions(state).register(scope, input.subscription, ctx.identity);
      ctx.logger.info('workspace subscription registered', { scope, subscription: sub.id, invoke: sub.invoke });
      return sub;
    },

    async subscriptions(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return { subscriptions: await createSubscriptions(state).list(scope) };
    },

    async deleteSubscription(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.id) throw new Error('id is required');
      const { state } = build(ctx);
      return createSubscriptions(state).remove(scope, input.id, ctx.identity);
    },

    async supersede(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state } = build(ctx);
      return state.supersede(scope, input.key, input.by ?? null, ctx.identity, { migrateLinks: input.migrateLinks });
    },

    async share(input, ctx) {
      const owner = requireUser(ctx.identity);
      if (!input?.to) throw new Error('to is required');
      if (input.to === owner) throw new Error('cannot share with yourself');
      const mode = input.mode ?? 'read';
      if (mode !== 'read' && mode !== 'write') throw new Error('mode must be "read" or "write"');
      // `public` is the universal audience (anyone, including anonymous): read-only,
      // never write — an open-write public grant would be an unbounded ingress.
      if (input.to === PUBLIC && mode !== 'read') throw new Error('public shares are read-only');
      const { grants } = build(ctx);
      const grant: Grant = {
        owner,
        grantee: input.to,
        key: input.key ?? WHOLE_SLICE,
        mode,
        createdAt: new Date().toISOString(),
      };
      await grants.put(grant);
      // Reflect public shares into the owner's slice so their own cells (which
      // read the slice under an IAM scope blind to the grant index) can serve
      // only public keys. The grant index stays the enforcement truth.
      if (input.to === PUBLIC) {
        const { state } = build(ctx);
        await state.put(
          { scope: owner, key: `${PUBLIC_NS}${grant.key}`, value: { pattern: grant.key, sharedAt: grant.createdAt }, via: 'share:public', type: 'public-share', tags: ['public'] },
          ctx.identity,
        );
      }
      await ctx.events.emit('workspace.shared', { owner, grantee: grant.grantee, key: grant.key, mode });
      ctx.logger.info('workspace shared', { owner, grantee: grant.grantee, key: grant.key, mode });
      return grant;
    },

    async unshare(input, ctx) {
      const owner = requireUser(ctx.identity);
      if (!input?.to) throw new Error('to is required');
      const { state, grants } = build(ctx);
      const key = input.key ?? WHOLE_SLICE;
      await grants.remove(owner, input.to, key);
      if (input.to === PUBLIC) await state.supersede(owner, `${PUBLIC_NS}${key}`, null, ctx.identity, {});
      return { ok: true };
    },

    async shared(_input, ctx) {
      const me = requireUser(ctx.identity);
      const { grants } = build(ctx);
      const [shared, receiving] = await Promise.all([grants.listByOwner(me), grants.listForGrantee(me)]);
      return { shared, receiving };
    },

    /**
     * The authority self-model (ADR-0007): one read that resolves the three
     * enforcement layers — token scope, the grant subsets, and the caller's own
     * partition — into "what may I see and do." Pure projection over the existing
     * machinery (identity scopes + the grant store); changes no enforcement.
     */
    async grants(_input, ctx) {
      const me = requireUser(ctx.identity);
      const { state, grants } = build(ctx);
      const [shared, receiving, groupsRes] = await Promise.all([
        grants.listByOwner(me),
        grants.listForGrantee(me),
        state.query(me, { prefix: GROUPS_NS, limit: 200 }, ctx.identity),
      ]);
      const groups = groupsRes.entries.map((e) => {
        const v = e.value as GroupValue;
        return { name: e.key.slice(GROUPS_NS.length), members: v.members ?? [], ...(v.label ? { label: v.label } : {}), ...(v.note ? { note: v.note } : {}) };
      });
      return {
        principal: me,
        scope: { active: ctx.identity.scopes ?? [], ceiling: grantScopesOf(ctx.identity) },
        slice: me,
        grant: { shared, receiving, groups },
        hint:
          'may(you, verb, resource) holds when all three gates pass: (1) scope — your active token covers the capability; (2) grant — the resource is your own slice, or a grant in `receiving` covers it (read) or grants write; (3) partition — IAM isolates each slice. Widen scope with auth.requestScope; ask for access with workspace.requestGrant.',
      };
    },

    /**
     * Define or patch a named audience (a group of principals) in your slice.
     * The group is a `_groups/<name>` fact (the record); the membership index is
     * written through so recall can resolve group grants without a slice scan.
     * Share to it with `workspace.share { to: "group:<name>" }`.
     */
    async group(input, ctx) {
      const owner = requireUser(ctx.identity);
      const name = (input?.name ?? '').trim();
      if (!name) throw new Error('name is required');
      if (name.includes('/') || name.startsWith('_')) throw new Error('group name must be a bare handle');
      const { state, grants } = build(ctx);
      const key = `${GROUPS_NS}${name}`;
      const existing = (await state.get(owner, key, ctx.identity))?.value as GroupValue | undefined;
      const before = new Set(existing?.members ?? []);
      const next = new Set(input.members !== undefined ? input.members : existing?.members ?? []);
      for (const p of input.add ?? []) next.add(p);
      for (const p of input.remove ?? []) next.delete(p);
      next.delete(owner); // the owner is implicitly in every one of their audiences
      next.delete(PUBLIC); // `public` is the reserved universal group, not a member
      const members = [...next].sort();
      // A patch (add/remove) preserves the existing label/note unless overridden.
      const label = input.label ?? existing?.label;
      const note = input.note ?? existing?.note;
      const value: GroupValue = {
        members,
        ...(label ? { label } : {}),
        ...(note ? { note } : {}),
      };
      await state.put({ scope: owner, key, value, via: 'groups:set', type: 'group', tags: ['groups'] }, ctx.identity);
      // Reconcile the membership index against the previous membership.
      await Promise.all([
        ...members.filter((p) => !before.has(p)).map((p) => grants.addMember(owner, name, p)),
        ...[...before].filter((p) => !next.has(p)).map((p) => grants.removeMember(owner, name, p)),
      ]);
      ctx.logger.info('workspace group set', { owner, group: name, members: members.length });
      return { name, ...value };
    },

    async groups(_input, ctx) {
      const owner = requireUser(ctx.identity);
      const { state } = build(ctx);
      const res = await state.query(owner, { prefix: GROUPS_NS, rankBy: 'recency', limit: 200 }, ctx.identity);
      return {
        groups: res.entries.map((e) => {
          const v = e.value as GroupValue;
          return { name: e.key.slice(GROUPS_NS.length), members: v.members ?? [], ...(v.label ? { label: v.label } : {}), ...(v.note ? { note: v.note } : {}) };
        }),
      };
    },

    async requestGrant(input, ctx) {
      const requester = requireUser(ctx.identity);
      const parsed = parseResource(input?.resource ?? '');
      if (parsed.owner === requester) {
        throw new Error('you own this resource — grant it directly (workspace.share or cells.grant)');
      }
      const note = input.note ? String(input.note).slice(0, NOTE_MAX) : undefined;
      const { state } = build(ctx);
      const key = requestKey(requester, parsed.raw);
      const value: GrantRequestValue = {
        requester,
        resource: parsed.raw,
        ...(note ? { note } : {}),
        status: 'pending',
        requestedAt: new Date().toISOString(),
      };
      // One open request per (requester, resource): a re-request bumps the
      // same fact's revision (and revives it after a deny) rather than piling up.
      await state.put(
        { scope: parsed.owner, key, value, via: 'grants:request', type: 'grant-request', tags: ['grants'] },
        ctx.identity,
      );
      await ctx.events.emit('workspace.grant.requested', { owner: parsed.owner, requester, resource: parsed.raw });
      ctx.logger.info('grant requested', { owner: parsed.owner, requester, resource: parsed.raw });
      return { requested: true, owner: parsed.owner, resource: parsed.raw, key };
    },

    async grantRequests(_input, ctx) {
      const me = requireUser(ctx.identity);
      const { state } = build(ctx);
      const [incoming, answers] = await Promise.all([
        state.query(me, { prefix: REQUESTS_PREFIX, rankBy: 'recency', limit: 100 }, ctx.identity),
        state.query(me, { prefix: ANSWERS_PREFIX, rankBy: 'recency', limit: 100 }, ctx.identity),
      ]);
      return {
        incoming: incoming.entries
          .map((e) => ({ key: e.key, ...(e.value as GrantRequestValue) }))
          .filter((r) => r.status === 'pending'),
        answers: answers.entries.map((e) => ({ key: e.key, ...(e.value as GrantAnswerValue) })),
      };
    },

    async approveGrant(input, ctx) {
      const me = requireUser(ctx.identity);
      const req = await pendingRequest(build(ctx).state, me, input?.key, ctx.identity);
      const parsed = parseResource(req.resource);
      const { state, grants } = build(ctx);
      if (parsed.family === 'workspace') {
        await grants.put({
          owner: me,
          grantee: req.requester,
          key: parsed.keyPattern as string,
          mode: parsed.mode,
          createdAt: new Date().toISOString(),
        });
      } else {
        // Cell-family resources are applied by the cells service (its registry
        // owns tool grants); workspace already holds the allow() for lifecycle.
        await ctx.serviceClient('cells').command('grant', {
          owner: me,
          name: parsed.cellName,
          principal: req.requester,
          ...(parsed.tool && parsed.tool !== '*' ? { tools: [parsed.tool] } : {}),
        });
      }
      await resolveRequest(state, ctx, me, input.key, req, 'approved');
      return { approved: true, resource: req.resource, grantee: req.requester };
    },

    async denyGrant(input, ctx) {
      const me = requireUser(ctx.identity);
      const req = await pendingRequest(build(ctx).state, me, input?.key, ctx.identity);
      const reason = input.reason ? String(input.reason).slice(0, NOTE_MAX) : undefined;
      const { state } = build(ctx);
      await resolveRequest(state, ctx, me, input.key, req, 'denied', reason);
      return { denied: true, resource: req.resource, grantee: req.requester };
    },

    // How the `/mcp` gateway discovers this cell's tools (mirrors forge.describeTools).
    // Verb scopes (docs/capability-consent.md): a tool with no explicit scope is
    // gated by its kind — reads require `read:workspace`, acts `write:workspace` —
    // so consent means what it says (a read-only token can't write). Slice
    // isolation still applies in each handler; this adds the verb gate on top.
    // Legacy coarse tokens satisfy these via impliesScope (workspace:read ⊇
    // read:*, workspace:write ⊇ write:*), so nothing that worked breaks.
    async describeTools() {
      const tools = TOOL_DESCRIPTORS.map((t) => ({
        ...t,
        scope: t.scope ?? (t.kind === 'read' ? 'read:workspace' : 'write:workspace'),
        ...(t.scopeFamily ? { scopeFamily: t.scopeFamily } : {}),
      }));
      return { tools };
    },
  };
}

/** A tending pass distilled into a written report — the audit fact. */
export interface TendReport {
  at: string;
  scope: string;
  stale: number;
  unlinked: number;
  dangling: number;
  staleSample: Array<{ key: string; updatedAt: string; type: string | null }>;
  unlinkedSample: string[];
  danglingSample: Array<{ from: string; rel: string; to: string; reason: string }>;
}

/**
 * One tending pass (the legacy workspace's signature loop, on this substrate):
 * read `attention()` — the just-in-time cron — and write what it surfaced as
 * a `tending/latest` audit fact, so every observer (home, boards, agents)
 * sees the substrate's health as state.
 */
async function runTend(
  state: ObservedState,
  scope: string,
  ctx: ServiceContext,
  via: string,
  writer: { user?: string; scopes: string[] },
): Promise<TendReport> {
  const att = await state.attention(scope, {});
  const report: TendReport = {
    at: new Date().toISOString(),
    scope,
    stale: att.stale.length,
    unlinked: att.unlinked.length,
    dangling: att.dangling.length,
    staleSample: att.stale.slice(0, 5),
    unlinkedSample: att.unlinked.slice(0, 5),
    danglingSample: att.dangling.slice(0, 3),
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
    const { state } = build(ctx);
    for (const scope of scopes) {
      await runTend(state, scope, ctx, 'schedule', { user: 'platform/tend', scopes: [] });
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
  };
}

/** The platform principal that the async reindex writes under (status fact + edges). */
const REINDEX_IDENTITY: Identity = { user: 'platform/reindex', scopes: [] };
const REINDEX_CHUNK = Number(process.env.VECTOR_REINDEX_CHUNK ?? 50);

interface ReindexParams {
  type?: string;
  prefix?: string;
  max?: number;
  phase: 'embed' | 'edges';
  cursor?: string;
  indexed: number;
  skipped: number;
  edges: number;
}

/** Process ONE bounded page of a reindex (ADR-0030/0031), returning whether the whole
 *  job is done and the next continuation params. Two phases: `embed` fills the vector
 *  index page by page; once exhausted it flips to `edges`, which (re-embedding each
 *  fact only to get its query vector — the index is already full) wires `similarTo`
 *  edges against the complete index. Each call stays well under the 60s Lambda. */
async function reindexChunk(deps: WorkspaceDeps, scope: string, p: ReindexParams): Promise<{ done: boolean; next: ReindexParams }> {
  const { state, vectors, store } = deps;
  if (!vectors) return { done: true, next: p };
  const dim = vectors.embedder.dimension;
  const index = indexForScope(scope, dim);
  let { indexed, skipped, edges } = p;

  const page = await state.query(scope, { type: p.type, prefix: p.prefix, limit: REINDEX_CHUNK, cursor: p.cursor }, REINDEX_IDENTITY);
  const embeddable = page.entries
    .map((e) => ({ key: e.key, text: embeddableText(e.key, e.value), type: e._meta.type, tags: e._meta.tags }))
    .filter((e): e is { key: string; text: string; type: string | null; tags: string[] } => !!e.text);

  if (p.phase === 'embed') {
    await vectors.store.ensureIndex(index, { dimension: dim });
    skipped += page.entries.length - embeddable.length;
    if (embeddable.length) {
      const vecs = await vectors.embedder.embed(embeddable.map((e) => e.text));
      await vectors.store.put(index, embeddable.map((e, i) => ({ key: e.key, vector: vecs[i], metadata: metadataForFact({ type: e.type ?? undefined, tags: e.tags, superseded: false }) })));
      indexed += embeddable.length;
    }
    const capped = p.max !== undefined && indexed + skipped >= p.max;
    if (page.nextCursor && !capped) return { done: false, next: { ...p, cursor: page.nextCursor, indexed, skipped, edges } };
    // Embed complete → start the edge phase from the top (the full index is now present).
    return { done: false, next: { ...p, phase: 'edges', cursor: undefined, indexed, skipped, edges } };
  }

  // phase === 'edges'
  const sim = similarConfig();
  if (sim.enabled && store && embeddable.length) {
    const now = new Date().toISOString();
    const existing = await store.listEdges(scope);
    const vecs = await vectors.embedder.embed(embeddable.map((e) => e.text)); // re-embed only to get the query vector (index already full)
    for (let i = 0; i < embeddable.length; i++) {
      const matches = await vectors.store.query(index, vecs[i], { topK: sim.k + 1 });
      const neighbors = selectNeighbors(matches, embeddable[i].key, { k: sim.k, minScore: sim.minScore });
      await refreshSimilarEdges(store, scope, embeddable[i].key, neighbors, sim.strength, existing, now);
      edges += neighbors.length;
    }
  }
  if (page.nextCursor) return { done: false, next: { ...p, cursor: page.nextCursor, indexed, skipped, edges } };
  return { done: true, next: { ...p, cursor: undefined, indexed, skipped, edges } };
}

/** The async reindex worker (`workspace.reindex.requested`): runs one chunk, writes the
 *  pollable `_reindex/<scope>` status, and either chains the next continuation event or
 *  marks the job done. A chunk failure throws → EventBridge retries it (idempotent:
 *  re-embed/re-put + refreshSimilarEdges reconcile). */
export function createReindexHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx, meta) => {
    if (meta.source !== 'workspace') {
      ctx.logger.warn('workspace.reindex.requested from unexpected source refused', { source: meta.source });
      return;
    }
    const scope = typeof detail.scope === 'string' ? detail.scope : '';
    if (!scope) return;
    const deps = build(ctx);
    const statusKey = `_reindex/${scope}`;
    const params: ReindexParams = {
      type: typeof detail.type === 'string' ? detail.type : undefined,
      prefix: typeof detail.prefix === 'string' ? detail.prefix : undefined,
      max: typeof detail.max === 'number' ? detail.max : undefined,
      phase: detail.phase === 'edges' ? 'edges' : 'embed',
      cursor: typeof detail.cursor === 'string' ? detail.cursor : undefined,
      indexed: Number(detail.indexed ?? 0),
      skipped: Number(detail.skipped ?? 0),
      edges: Number(detail.edges ?? 0),
    };
    const index = deps.vectors ? indexForScope(scope, deps.vectors.embedder.dimension) : '';
    try {
      const { done, next } = await reindexChunk(deps, scope, params);
      const base = { phase: next.phase, indexed: next.indexed, skipped: next.skipped, edges: next.edges, index };
      if (done) {
        await deps.state.put({ scope, key: statusKey, value: { status: 'done', ...base, finishedAt: new Date().toISOString() }, via: 'reindex', type: 'reindex-status' }, REINDEX_IDENTITY);
        ctx.logger.info('reindex complete', { scope, ...base });
      } else {
        await deps.state.put({ scope, key: statusKey, value: { status: 'running', ...base, cursor: next.cursor, updatedAt: new Date().toISOString() }, via: 'reindex', type: 'reindex-status' }, REINDEX_IDENTITY);
        await ctx.events.emit('workspace.reindex.requested', { scope, type: next.type, prefix: next.prefix, max: next.max, phase: next.phase, cursor: next.cursor, indexed: next.indexed, skipped: next.skipped, edges: next.edges });
      }
    } catch (err) {
      ctx.logger.error('reindex chunk failed (EventBridge will retry)', { scope, phase: params.phase, error: (err as Error).message });
      throw err;
    }
  };
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
