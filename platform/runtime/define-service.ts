/**
 * `defineService` — the single runtime entry point for a service cell.
 *
 * It wraps a set of command handlers into one Lambda handler that understands
 * two invocation styles:
 *
 *   1. HTTP (Function URL behind CloudFront): `POST /<service>/<command>` with
 *      a JSON body dispatches to the matching command; `GET /<service>/_manifest`
 *      returns the service manifest for discovery.
 *   2. Direct invoke (service-to-service): a `CommandEnvelope` payload routes
 *      straight to a command and returns a `CommandResult`.
 *
 * Cross-cutting concerns — correlation/trace propagation, structured logging,
 * auth normalisation, event/peer wiring — are assembled once per request and
 * passed to handlers via `ServiceContext`.
 */
import { randomUUID } from 'crypto';
import { createLogger } from './logger';
import { createEvents } from './events';
import { createServiceClient, CommandEnvelope } from './service-client';
import { loadConfig } from './config';
import { identityFromHeaders, ServiceAuthError, Identity } from './auth';
import type { ServiceManifest } from '../manifest';
import type {
  ServiceDefinition,
  ServiceContext,
  FunctionUrlEvent,
  FunctionUrlResponse,
  CommandResult,
} from './types';

function isCommandEnvelope(event: unknown): event is CommandEnvelope {
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as CommandEnvelope).__command === 'string'
  );
}

function headerOf(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  const key = Object.keys(headers).find((k) => k.toLowerCase() === lower);
  return key ? headers[key] : undefined;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

export function defineService(definition: ServiceDefinition) {
  const version = definition.version ?? '1.0.0';
  const manifest: ServiceManifest = {
    name: definition.name,
    version,
    routes: [`/${definition.name}/*`],
    commands: Object.keys(definition.commands),
    events: { emits: definition.events?.emits ?? [] },
  };

  function buildContext(opts: {
    correlationId: string;
    traceId: string;
    identity: Identity;
  }): ServiceContext {
    const config = loadConfig();
    const logger = createLogger({
      service: definition.name,
      correlationId: opts.correlationId,
      traceId: opts.traceId,
    });
    const events = createEvents({
      source: definition.name,
      busName: config.eventBusName,
      correlationId: opts.correlationId,
    });
    const serviceClient = createServiceClient({
      registry: config.registry,
      correlationId: opts.correlationId,
      user: opts.identity.user,
    });
    return {
      logger,
      events,
      serviceClient,
      config,
      identity: opts.identity,
      correlationId: opts.correlationId,
      traceId: opts.traceId,
    };
  }

  async function runCommand(name: string, input: unknown, ctx: ServiceContext): Promise<unknown> {
    const handler = definition.commands[name];
    if (!handler) {
      throw new UnknownCommandError(name);
    }
    // The registry stores handlers with a `never` input; narrow back to the
    // parsed payload at the single dispatch site.
    return (handler as (i: unknown, c: ServiceContext) => Promise<unknown> | unknown)(input, ctx);
  }

  async function handler(
    event: FunctionUrlEvent | CommandEnvelope,
  ): Promise<FunctionUrlResponse | CommandResult> {
    // ---- Direct service-to-service invoke -------------------------------
    if (isCommandEnvelope(event)) {
      const correlationId = event.correlationId ?? randomUUID();
      const ctx = buildContext({
        correlationId,
        traceId: correlationId,
        identity: { user: event.user, scopes: [] },
      });
      try {
        const result = await runCommand(event.__command, event.payload, ctx);
        return { ok: true, result } satisfies CommandResult;
      } catch (err) {
        ctx.logger.error('command failed', {
          command: event.__command,
          error: (err as Error).message,
        });
        return { ok: false, error: (err as Error).message } satisfies CommandResult;
      }
    }

    // ---- HTTP via Function URL / CloudFront ------------------------------
    const httpEvent = event as FunctionUrlEvent;
    const method = httpEvent.requestContext?.http?.method ?? 'GET';
    const path = httpEvent.rawPath ?? httpEvent.requestContext?.http?.path ?? '/';
    const correlationId = headerOf(httpEvent.headers, 'x-correlation-id') ?? randomUUID();
    const traceId = headerOf(httpEvent.headers, 'x-amzn-trace-id') ?? correlationId;
    const identity = identityFromHeaders(httpEvent.headers);
    const ctx = buildContext({ correlationId, traceId, identity });

    const prefix = `/${definition.name}/`;
    const tail = path.startsWith(prefix) ? path.slice(prefix.length) : '';

    if (method === 'GET' && tail === '_manifest') {
      return json(200, manifest, correlationId);
    }

    if (method === 'OPTIONS') {
      return json(204, {}, correlationId);
    }

    if (method !== 'POST' || !tail) {
      ctx.logger.warn('unroutable request', { method, path });
      return json(404, { ok: false, error: 'Not found' }, correlationId);
    }

    let input: unknown = {};
    if (httpEvent.body) {
      const raw = httpEvent.isBase64Encoded
        ? Buffer.from(httpEvent.body, 'base64').toString('utf8')
        : httpEvent.body;
      try {
        input = JSON.parse(raw);
      } catch {
        return json(400, { ok: false, error: 'Invalid JSON body' }, correlationId);
      }
    }

    try {
      const result = await runCommand(tail, input, ctx);
      ctx.logger.info('command handled', { command: tail });
      return json(200, { ok: true, result }, correlationId);
    } catch (err) {
      if (err instanceof UnknownCommandError) {
        return json(404, { ok: false, error: err.message }, correlationId);
      }
      if (err instanceof ServiceAuthError) {
        return json(401, { ok: false, error: err.message }, correlationId);
      }
      ctx.logger.error('command failed', { command: tail, error: (err as Error).message });
      return json(500, { ok: false, error: 'Internal error' }, correlationId);
    }
  }

  // Expose the manifest for tests and infra synthesis.
  (handler as { manifest?: ServiceManifest }).manifest = manifest;
  return handler as typeof handler & { manifest: ServiceManifest };
}

function json(statusCode: number, body: unknown, correlationId: string): FunctionUrlResponse {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, 'x-correlation-id': correlationId },
    body: JSON.stringify(body),
  };
}

export class UnknownCommandError extends Error {
  readonly statusCode = 404;
  constructor(command: string) {
    super(`Unknown command: ${command}`);
    this.name = 'UnknownCommandError';
  }
}
