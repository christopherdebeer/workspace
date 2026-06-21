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
export { createObservedState, createMemoryStateStore, computeScore, extractTypeRules, StatePreconditionError, isTimerLive } from './state';
export { layer } from './resolution';
export { matchesSelector } from './selector';
export type { Selector, Selectable } from './selector';
export { resolvePresent, resolveLabel } from './present';
export type { Affordance, Presentable } from './present';
export { parseTypeSchema, missingRequired, schemaHints, mergeTypeDecl, resolveType } from './type-schema';
export type { FieldSpec, FieldType, Type, KeyEdge } from './type-schema';
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
} from './state';
