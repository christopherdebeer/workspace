/**
 * Runtime contracts shared across the service handler, commands, and clients.
 */
import type { Logger } from './logger';
import type { Events } from './events';
import type { ServiceHandle } from './service-client';
import type { PlatformConfig } from './config';
import type { Identity } from './auth';

/**
 * Per-invocation context handed to every command. Bundles the platform
 * capabilities (logging, events, peer invocation, config) plus request
 * metadata so handlers never reach for globals.
 */
export interface ServiceContext {
  logger: Logger;
  events: Events;
  /** Resolve a peer service for synchronous command invocation. */
  serviceClient: (name: string) => ServiceHandle;
  config: PlatformConfig;
  identity: Identity;
  correlationId: string;
  traceId: string;
}

export type CommandHandler<Input = unknown, Output = unknown> = (
  input: Input,
  ctx: ServiceContext,
) => Promise<Output> | Output;

/**
 * Registry-side command type. Using `never` for the input lets authors register
 * handlers with their own concrete input types (which are contravariantly
 * assignable here) without resorting to `any`. The runtime narrows the parsed
 * input back to the handler when dispatching.
 */
export type RegisteredCommand = CommandHandler<never, unknown>;

export interface ServiceDefinition {
  /** Must match the manifest/infra name. */
  name: string;
  /** Service contract version; defaults to "1.0.0". */
  version?: string;
  /** Synchronous commands, callable over HTTP and via direct invoke. */
  commands: Record<string, RegisteredCommand>;
  events?: { emits?: string[] };
}

/** Lambda Function URL request (payload format 2.0), trimmed to what we use. */
export interface FunctionUrlEvent {
  version?: string;
  rawPath?: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string; path?: string } };
}

export interface FunctionUrlResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Result shape returned from a direct (service-to-service) invoke. */
export interface CommandResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}
