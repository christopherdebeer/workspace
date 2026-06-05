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
import { ServiceAuthError, Identity } from './auth';
import type { ServiceManifest } from '../manifest';
import type {
  ServiceDefinition,
  ServiceContext,
  FunctionUrlEvent,
  FunctionUrlResponse,
  CommandResult,
  HttpRoute,
  ServiceHttpRequest,
  ServiceHttpResponse,
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

const ANONYMOUS: Identity = { user: undefined, scopes: [] };

/** Shape returned by the auth cell's `validateToken` command. */
interface ValidatedToken {
  userId: string;
  scope: string;
  clientId: string | null;
}

/**
 * Establish the request identity for an HTTP call. Identity is derived ONLY
 * from a validated `Authorization: Bearer` token — never from client-supplied
 * `x-auth-*` headers (which would be trivially forgeable, since CloudFront
 * forwards all viewer headers). The opaque token is validated by invoking the
 * auth cell's `validateToken` command; the cell must list `auth` in `allow[]`
 * for the registry entry to exist. The auth cell itself can't self-validate, so
 * its own HTTP routes resolve anonymous (its OAuth endpoints don't need this).
 */
async function resolveHttpIdentity(
  headers: Record<string, string | undefined> | undefined,
  serviceName: string,
): Promise<Identity> {
  const authHeader = headerOf(headers, 'authorization');
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return ANONYMOUS;

  const authService = process.env.AUTH_SERVICE_NAME ?? 'auth';
  if (serviceName === authService) return ANONYMOUS;

  const config = loadConfig();
  if (!config.registry[authService]) return ANONYMOUS;

  try {
    const client = createServiceClient({ registry: config.registry });
    const validated = await client(authService).command<ValidatedToken | null>('validateToken', {
      token,
    });
    if (!validated) return ANONYMOUS;
    return {
      user: validated.userId,
      scopes: validated.scope ? validated.scope.split(/[\s,]+/).filter(Boolean) : [],
    };
  } catch {
    // A validation failure (revoked/expired/unknown token, or auth unavailable)
    // is treated as anonymous; handlers enforce auth via requireUser/requireScope.
    return ANONYMOUS;
  }
}

export function defineService(definition: ServiceDefinition) {
  const version = definition.version ?? '1.0.0';
  // Distinct route prefixes owned by raw HTTP handlers, e.g. "/oauth/*".
  const httpPrefixes = Array.from(
    new Set(
      (definition.http ?? []).map((r) =>
        r.path.endsWith('*') ? r.path : `${r.path.replace(/\/$/, '')}`,
      ),
    ),
  );
  const manifest: ServiceManifest = {
    name: definition.name,
    version,
    routes: [`/${definition.name}/*`, ...httpPrefixes],
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
    const identity = await resolveHttpIdentity(httpEvent.headers, definition.name);
    const ctx = buildContext({ correlationId, traceId, identity });

    const rawBody = httpEvent.body
      ? httpEvent.isBase64Encoded
        ? Buffer.from(httpEvent.body, 'base64').toString('utf8')
        : httpEvent.body
      : undefined;

    // ---- Raw HTTP routes (OAuth, .well-known, redirects, …) -------------
    const route = matchRoute(definition.http, method, path);
    if (route) {
      try {
        const req = buildHttpRequest(httpEvent, method, path, rawBody);
        const res = (await route.handler(req, ctx)) ?? {};
        return renderHttp(res, correlationId);
      } catch (err) {
        if (err instanceof ServiceAuthError) {
          return json(401, { error: err.message }, correlationId);
        }
        ctx.logger.error('http route failed', { method, path, error: (err as Error).message });
        return json(500, { error: 'Internal error' }, correlationId);
      }
    }

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
    if (rawBody) {
      try {
        input = JSON.parse(rawBody);
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

function matchRoute(routes: HttpRoute[] | undefined, method: string, path: string): HttpRoute | undefined {
  if (!routes) return undefined;
  return routes.find((r) => {
    if (r.method.toUpperCase() !== method.toUpperCase()) return false;
    if (r.path.endsWith('*')) return path.startsWith(r.path.slice(0, -1));
    return r.path === path;
  });
}

function buildHttpRequest(
  event: FunctionUrlEvent,
  method: string,
  path: string,
  rawBody: string | undefined,
): ServiceHttpRequest {
  const query = event.queryStringParameters ?? {};
  // Prefer an explicit public base (stable across the CloudFront/OAC hop where
  // the viewer Host is stripped); fall back to the request Host header.
  const base =
    process.env.PUBLIC_BASE_URL ??
    `https://${headerOf(event.headers, 'x-forwarded-host') ?? headerOf(event.headers, 'host') ?? 'localhost'}`;
  const qs = event.rawQueryString
    ? `?${event.rawQueryString}`
    : Object.keys(query).length
      ? `?${new URLSearchParams(query).toString()}`
      : '';
  return {
    method,
    path,
    headers: event.headers ?? {},
    query,
    rawBody,
    url: `${base.replace(/\/$/, '')}${path}${qs}`,
    json<T = unknown>(): T {
      return JSON.parse(rawBody ?? '{}') as T;
    },
    text(): string {
      return rawBody ?? '';
    },
  };
}

function renderHttp(res: ServiceHttpResponse, correlationId: string): FunctionUrlResponse {
  const isString = typeof res.body === 'string';
  const headers: Record<string, string> = {
    'x-correlation-id': correlationId,
    ...(isString ? {} : JSON_HEADERS),
    ...res.headers,
  };
  return {
    statusCode: res.statusCode ?? 200,
    headers,
    body: res.body === undefined ? '' : isString ? (res.body as string) : JSON.stringify(res.body),
  };
}

export class UnknownCommandError extends Error {
  readonly statusCode = 404;
  constructor(command: string) {
    super(`Unknown command: ${command}`);
    this.name = 'UnknownCommandError';
  }
}
