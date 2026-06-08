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
export { identityFromHeaders, requireUser, requireScope, hasScope, ServiceAuthError } from './auth';
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
  CommandResult,
  FunctionUrlEvent,
  FunctionUrlResponse,
  HttpRoute,
  HttpHandler,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from './types';
export type { ServiceManifest, ServiceRegistry, ManifestEvents } from '../manifest';
export { createObservedState, createMemoryStateStore, computeScore } from './state';
export type {
  ObservedState,
  StateStore,
  StateRecord,
  TrajectoryEvent,
  Entry,
  EntryMeta,
  Tier,
  ReadResult,
  ShapingSummary,
  ReadOptions,
  WriteInput,
  SalienceOptions,
} from './state';
