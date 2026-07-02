/**
 * Runtime layer public API.
 *
 * Service authors import from here; they should never need to touch the AWS
 * SDK directly. The infrastructure layer lives in `platform/infra`.
 */
export { defineService, UnknownCommandError } from './define-service';
export { defineMcpService } from './define-mcp-service';
export type { McpServiceDefinition, McpToolDefinition } from './define-mcp-service';
export { createLogger } from './logger';
export type { Logger, LogLevel, LogRecord, LogContext } from './logger';
export { loadConfig, getString, getOptional } from './config';
export type { PlatformConfig } from './config';
export {
  identityFromHeaders,
  requireUser,
  requireScope,
  hasScope,
  hasGrantScope,
  holdsUnder,
  grantScopesOf,
  matchesScope,
  intersectScopePatterns,
  intersectScopes,
  ServiceAuthError,
} from './auth';
export type { Identity } from './auth';
export { createEvents, __setEventBridge } from './events';
export type { Events } from './events';
export {
  createServiceClient,
  ServiceInvokeError,
  __setLambda,
} from './service-client';
export type { ServiceHandle, CommandEnvelope, ServiceClientOptions } from './service-client';
export type {
  ServiceContext,
  ServiceDefinition,
  CommandHandler,
  RegisteredCommand,
  EventBridgeHandler,
  CommandResult,
  FunctionUrlEvent,
  FunctionUrlResponse,
  HttpRoute,
  HttpHandler,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from './types';
export type { ServiceManifest, ServiceRegistry, ManifestEvents } from '../manifest';
export {
  createObservedState,
  createMemoryStateStore,
  computeScore,
  extractTypeRules,
  deriveBackboneEdges,
  recordContains,
  StatePreconditionError,
  isTimerLive,
  actorClassOf,
  touchKey,
  bumpTouches,
  bumpWindow,
  touchSignals,
  INTENT_PRESET,
  SALIENCE_CONFIG_KEY,
} from './state';
// The DynamoDB-backed StateStore — surfaced in the barrel (ADR-0042 Inc 0) so a
// cell's own SSR Lambda can run the SAME read pipeline the gateway does
// (`createObservedState(createDynamoStateStore(table))`) against its IAM-scoped
// partition, instead of hand-rolling raw `STATE#<owner>`/`KEY#`/`gsi-*` queries.
// The workspace + vector-indexer services already import it by deep path; six
// cells re-implemented it because it wasn't discoverable here.
// ADR-0044 Inc 1: the v2 (aws-sdk) store is DELETED — the v3 store (shared
// state-store-codec, lazy @aws-sdk/* requires) is the one DynamoDB StateStore.
export { createDynamoStateStoreV3 as createDynamoStateStore } from './dynamo-state-store-v3';
export { buildTypeVocabulary } from './type-vocabulary';
// The canonical cell-SSR reader (ADR-0042 Inc 1): the observed-state read
// pipeline bound to one cell's scope, so a cell reads its slice the way the
// gateway does (salience, edges, membership) instead of hand-rolling raw DDB.
export { createCellReader } from './cell-reader';
export type { CellReader, CellReaderDefaults } from './cell-reader';
export { layer } from './resolution';
export { matchesSelector } from './selector';
export type { Selector, Selectable } from './selector';
export { resolvePresent, resolveLabel } from './present';
export type { Affordance, Presentable } from './present';
export { parseTypeSchema, missingRequired, schemaHints, mergeTypeDecl, resolveType } from './type-schema';
export type { FieldSpec, FieldType, Type, KeyEdge } from './type-schema';
export {
  PUBLIC_INDEX,
  indexForScope,
  embeddableText,
  metadataForFact,
  isTextLikeContentType,
  BLOB_INLINE_MAX_BYTES,
  SIMILAR_REL,
  SIMILAR_WRITER,
  selectNeighbors,
  similarConfig,
  normalize,
  cosineSimilarity,
  HashingEmbedder,
  MemoryVectorStore,
} from './vectors';
export type { Vector, VectorMetadata, VectorRecord, VectorFilter, VectorMatch, VectorStore, Embedder, SimilarConfig } from './vectors';
export { refreshSimilarEdges, dropSimilarEdges, authoredPairs, pairKey, suggestionCandidates, dropSimilarPair, RATIFY_LINK_TYPES } from './similar-edges';
export type { EdgeIO, SuggestionCandidate, RatifyLinkType } from './similar-edges';
export { createDeclarationRegistry } from './declarations';
export type { DeclarationKind, DeclarationRegistry, RegisterOptions } from './declarations';
export type {
  ObservedState,
  StateStore,
  StateRecord,
  EdgeRecord,
  LinkResult,
  TrajectoryEvent,
  Entry,
  EntryMeta,
  ScoreExplain,
  Tier,
  ReadResult,
  ElidedStub,
  ShapingSummary,
  ReadOptions,
  WriteInput,
  PutGuard,
  FactTimer,
  QueryOptions,
  QueryResult,
  NeighborsOptions,
  NeighborsResult,
  MembersResult,
  MemberEntry,
  ChangesResult,
  AttentionOptions,
  AttentionResult,
  SupersedeOptions,
  SalienceOptions,
  SalienceLens,
  TypeRules,
  RefRule,
  KeyEdgeRule,
  AnnotatedEdge,
  ActorClass,
  TouchCounters,
  TouchWindow,
} from './state';
