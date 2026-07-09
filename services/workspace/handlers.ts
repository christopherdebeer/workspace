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
  type Entry,
  type ReadResult,
  type QueryResult,
  type NeighborsResult,
  type MembersResult,
  type AttentionResult,
  type EdgeRecord,
  type LinkResult,
  type CommandHandler,
  type RegisteredCommand,
} from '../../platform/runtime';
import { type ActionDefinition, type RegisterResult, type InvokeResult } from './actions';
import { type ViewDefinition, type ViewResult } from './views';
import { type SubscriptionDefinition } from './subscriptions';
import { type Grant } from './grants';
import { type DepsBuilder } from './shared';
import { createWriteCommands, type RememberInput, type IngestInput, type IngestResult, type SupersedeInput } from './commands-write';
import {
  createReadCommands,
  type RecallInput,
  type RecallOverview,
  type PeekInput,
  type QueryInput,
  type ChangesInput,
  type ChangesWithEntries,
  type AttentionInput,
} from './commands-read';
import { createGraphCommands, type LinkInput, type UnlinkInput, type NeighborsInput, type LinksInput, type MembersInput, type EdgesInput } from './commands-graph';
import { type EdgeScopeInput } from './shape';
import {
  createSearchCommands,
  type SearchInput,
  type SearchResult,
  type ReindexInput,
  type PruneSimilarInput,
  type SuggestionsInput,
  type SuggestionsResult,
  type RatifyInput,
  type RatifyResult,
  type ContestedInput,
  type ContestedResult,
} from './commands-search';
import {
  createDeclaredCommands,
  type RegisterActionInput,
  type DeleteActionInput,
  type InvokeInput,
  type RegisterViewInput,
  type ViewInput,
  type DeleteViewInput,
  type RegisterSubscriptionInput,
  type DeleteSubscriptionInput,
  type DeclareInput,
  type DeclarationsInput,
  type UndeclareInput,
  type EvaluateInput,
} from './commands-declared';
import {
  createSharingCommands,
  type ShareInput,
  type UnshareInput,
  type SharedResult,
  type GrantsSelfModel,
  type GroupInput,
  type GroupResult,
  type GroupsResult,
  type RequestGrantInput,
  type RequestGrantResult,
  type GrantRequestsResult,
  type ApproveGrantInput,
  type DenyGrantInput,
} from './commands-sharing';
import { type TendReport } from './event-handlers';
import { type ToolDescriptor, TOOL_DESCRIPTORS } from './descriptors';
import { createAthenaCommand, type AthenaInput, type AthenaResult } from './commands-athena';

// ADR-0044 Inc 5: handlers.ts is now the composition/re-export seam. The command
// groups live in per-group modules; every pre-split import path keeps working.
export * from './shared';
export * from './commands-write';
export * from './commands-read';
export * from './commands-graph';
export * from './commands-search';
export * from './commands-declared';
export * from './commands-sharing';
export * from './event-handlers';

// Index signature so it satisfies defineService's `Record<string, RegisteredCommand>`,
// while keeping precise per-command types for the unit tests.
export interface WorkspaceCommands extends Record<string, RegisteredCommand> {
  remember: CommandHandler<RememberInput, Entry & { hints?: string[] }>;
  ingest: CommandHandler<IngestInput, IngestResult>;
  recall: CommandHandler<RecallInput | undefined, ReadResult | RecallOverview>;
  peek: CommandHandler<PeekInput, Entry | null>;
  query: CommandHandler<QueryInput | undefined, QueryResult>;
  search: CommandHandler<SearchInput, SearchResult>;
  reindex: CommandHandler<ReindexInput | undefined, { status: string; poll?: string; hint?: string }>;
  project: CommandHandler<undefined, { status: string; count?: number; method?: string; key?: string; hint?: string }>;
  pruneSimilar: CommandHandler<PruneSimilarInput | undefined, { status: string; scanned: number; pruned: number; remaining: number }>;
  suggestions: CommandHandler<SuggestionsInput | undefined, SuggestionsResult>;
  ratify: CommandHandler<RatifyInput, RatifyResult>;
  // ADR-0072 (C7): the contradiction-candidate read (Stage A of the contested view).
  contested: CommandHandler<ContestedInput | undefined, ContestedResult>;
  link: CommandHandler<LinkInput, LinkResult>;
  unlink: CommandHandler<UnlinkInput, { ok: true }>;
  neighbors: CommandHandler<NeighborsInput, NeighborsResult>;
  links: CommandHandler<LinksInput | undefined, { edges: EdgeRecord[]; total: number }>;
  graph: CommandHandler<EdgeScopeInput | undefined, { edges: EdgeRecord[]; total: number }>;
  members: CommandHandler<MembersInput, MembersResult>;
  // ADR-0069 (C3): the one edge query (neighbors/links/graph/members are aliases).
  edges: CommandHandler<EdgesInput | undefined, NeighborsResult | MembersResult | { edges: EdgeRecord[]; total: number }>;
  changes: CommandHandler<ChangesInput | undefined, ChangesWithEntries>;
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
  // ADR-0068 (C1): the one declaration surface (legacy verbs above are aliases).
  declare: CommandHandler<DeclareInput, RegisterResult | ViewDefinition | SubscriptionDefinition>;
  declarations: CommandHandler<DeclarationsInput | undefined, { declarations: unknown[] }>;
  undeclare: CommandHandler<UndeclareInput, { ok: true }>;
  evaluate: CommandHandler<EvaluateInput, InvokeResult | ViewResult>;
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
  athena: CommandHandler<AthenaInput | undefined, AthenaResult>;
  describeTools: CommandHandler<undefined, { tools: ToolDescriptor[] }>;
}

/** Build the workspace vocabulary over a given way of constructing its deps. */
export function createWorkspaceCommands(build: DepsBuilder): WorkspaceCommands {
  return {
    ...createWriteCommands(build),
    ...createReadCommands(build),
    ...createGraphCommands(build),
    ...createSearchCommands(build),
    ...createDeclaredCommands(build),
    ...createSharingCommands(build),
    // The admin-gated Athena SQL surface over the analytics lake (platform:*).
    ...createAthenaCommand(),

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
