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
  /** The token's granted scope (the ceiling). */
  scope: string;
  /** The session's effective scope (≤ grant); absent ⇒ equals the grant. */
  effectiveScope?: string | null;
  /** The token id, so the session can mutate its own effective scope. */
  tokenId?: string;
  clientId: string | null;
  /** The token's adopted posture (ADR-0074); absent/null ⇒ none. */
  posture?: { goal?: string; lens?: string; salience?: Record<string, number>; adoptedAt?: string } | null;
  /** The delegation chain (ADR-0024); absent/null ⇒ a root token. */
  act?: import('./auth').ActClaim | null;
}

/** Shape returned by the auth cell's `refreshSession` command (edge silent-refresh). */
interface RefreshedSession {
  userId: string;
  scope: string;
  effectiveScope: string | null;
  tokenId: string | null;
  /** Ready-made Set-Cookie strings (auth owns the format) to re-prime the browser. */
  setCookies: string[];
}

/** The navigation cookies the auth cell sets: the short-lived access credential and
 *  the long-lived refresh credential used for edge silent-refresh. */
const SESSION_COOKIE = 'parc_session';
const REFRESH_COOKIE = 'parc_refresh';

/** Extract a named cookie's value from a Cookie header, if present. */
function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || undefined;
  }
  return undefined;
}
const sessionCookie = (cookieHeader: string | undefined): string | undefined => cookieValue(cookieHeader, SESSION_COOKIE);
const refreshCookieValue = (cookieHeader: string | undefined): string | undefined => cookieValue(cookieHeader, REFRESH_COOKIE);

/**
 * Establish the request identity for an HTTP call. Identity is derived from a
 * validated `Authorization: Bearer` token — never from client-supplied `x-auth-*`
 * headers (trivially forgeable, since CloudFront forwards all viewer headers).
 * The opaque token is validated by invoking the auth cell's `validateToken`
 * command; the cell must list `auth` in `allow[]` for the registry entry to
 * exist. The auth cell itself can't self-validate, so its own HTTP routes
 * resolve anonymous (its OAuth endpoints don't need this).
 *
 * Browser *navigations* (SSR pages, iframes) carry no bearer — only cookies. For
 * the cell-routing tier (`dispatch`) on **safe methods only**, the `parc_session`
 * cookie is accepted as the credential, so a signed-in visitor's own cells
 * render server-side. Scoped deliberately tight: the gateway (`/mcp`) stays
 * bearer-only (no cookie-CSRF), and a cookie never authorizes a mutation. The
 * credential reaches only this tier-1 hop; dynamic cells receive `x-cell-caller`,
 * never the token (see callCell).
 */
/** Identity for the request, plus any Set-Cookie strings the edge silent-refresh
 *  rotated (re-priming the browser's navigation cookies). */
interface ResolvedIdentity {
  identity: Identity;
  setCookies?: string[];
}

function identityFromValidated(validated: ValidatedToken): Identity {
  const grant = validated.scope ? validated.scope.split(/[\s,]+/).filter(Boolean) : [];
  const effective =
    validated.effectiveScope != null ? validated.effectiveScope.split(/[\s,]+/).filter(Boolean) : grant;
  return {
    user: validated.userId,
    scopes: effective,
    grantScopes: grant,
    ...(validated.tokenId ? { tokenId: validated.tokenId } : {}),
    ...(validated.posture ? { posture: validated.posture } : {}),
    ...(validated.act ? { act: validated.act } : {}),
    // Mediation (ADR-0022 × ADR-0050): a DCR-minted client token is a distinct
    // embodiment acting on-behalf-of — its attention weighs as `agent`, even
    // though its subject is the user. A first-party session (no clientId — the
    // browser/passkey path, incl. cookie silent-refresh) is the human.
    actor: validated.clientId || validated.act ? 'agent' : 'human',
  };
}

async function resolveHttpIdentity(
  headers: Record<string, string | undefined> | undefined,
  serviceName: string,
  method?: string,
): Promise<ResolvedIdentity> {
  // Prefer the standard Authorization header, but fall back to the
  // `x-forwarded-authorization` header that the edge preserves the viewer's
  // bearer in — CloudFront OAC overwrites Authorization with its SigV4 signature.
  const authHeader = headerOf(headers, 'authorization');
  const fwdHeader = headerOf(headers, 'x-forwarded-authorization');
  let token =
    authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ??
    fwdHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  // The session cookie is honoured only for a genuine top-level navigation —
  // `Sec-Fetch-Dest: document` (browser-set, unforgeable from JS). A cell's
  // `fetch()` is `empty` and an `<iframe>` is `iframe`; neither is honoured, so a
  // hostile cell can't ride your ambient cookie to read your content (a top-level
  // navigation it could trigger would unload the cell, so it can't read the
  // result either). Absent header (curl, old clients) ⇒ treat as non-navigation.
  const topLevelNav = headerOf(headers, 'sec-fetch-dest') === 'document';
  const cookieAllowed = serviceName === 'dispatch' && (method === 'GET' || method === 'HEAD') && topLevelNav;
  const cookieHeader = headerOf(headers, 'cookie');
  if (!token && cookieAllowed) token = sessionCookie(cookieHeader);
  // The long-lived refresh credential — only consulted on a safe top-level
  // navigation (cookieAllowed), and only to silently re-mint a short access token.
  const refreshTok = cookieAllowed ? refreshCookieValue(cookieHeader) : undefined;
  if (!token && !refreshTok) return { identity: ANONYMOUS };

  const authService = process.env.AUTH_SERVICE_NAME ?? 'auth';
  if (serviceName === authService) return { identity: ANONYMOUS };

  const config = loadConfig();
  if (!config.registry[authService]) return { identity: ANONYMOUS };

  try {
    const client = createServiceClient({ registry: config.registry });
    if (token) {
      const validated = await client(authService).command<ValidatedToken | null>('validateToken', { token });
      if (validated) return { identity: identityFromValidated(validated) };
      console.warn('[auth] bearer present but rejected by validateToken', { service: serviceName });
    }
    // Edge silent-refresh: the access cookie was missing or rejected (expired), but a
    // top-level navigation carries a valid refresh cookie — rotate a fresh access
    // token at the edge and re-prime both cookies, so a long-grant session survives
    // navigations/tab-closes without a passkey round-trip. Safe-method nav only.
    if (cookieAllowed && refreshTok) {
      const refreshed = await client(authService).command<RefreshedSession | null>('refreshSession', { refreshToken: refreshTok });
      if (refreshed) {
        return {
          identity: identityFromValidated({
            userId: refreshed.userId,
            scope: refreshed.scope,
            effectiveScope: refreshed.effectiveScope,
            tokenId: refreshed.tokenId ?? undefined,
            clientId: null,
          }),
          setCookies: refreshed.setCookies,
        };
      }
    }
    return { identity: ANONYMOUS };
  } catch (err) {
    // The auth service ERRORED (cold start, throttle, mid-deploy) — the
    // credential was never checked. Resolve anonymous but flag it, so HTTP
    // seams answer `auth_unavailable` (retryable) instead of `invalid_token`
    // (which reads as "your token is dead" and makes clients discard it).
    console.warn('[auth] identity resolution errored', { service: serviceName, error: (err as Error).message });
    return { identity: { ...ANONYMOUS, degraded: true } };
  }
}

/**
 * A derived context whose identity carries additional fields — e.g. the
 * ADR-0086 participant key stamped by the gateway from a dispatch's `as`
 * argument. The serviceClient must be REBUILT (not just the identity object
 * patched): its envelope options were captured at context construction, so a
 * bare identity mutation would never reach downstream services.
 */
export function withIdentity(ctx: ServiceContext, patch: Partial<Identity>): ServiceContext {
  const identity = { ...ctx.identity, ...patch } as Identity;
  return {
    ...ctx,
    identity,
    serviceClient: createServiceClient({
      registry: ctx.config.registry,
      correlationId: ctx.correlationId,
      user: identity.user,
      scopes: identity.scopes?.length ? identity.scopes : undefined,
      grantScopes: identity.grantScopes?.length ? identity.grantScopes : undefined,
      tokenId: identity.tokenId,
      actor: identity.actor,
      posture: identity.posture,
      act: identity.act,
      participant: identity.participant,
    }),
  };
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
      scopes: opts.identity.scopes.length ? opts.identity.scopes : undefined,
      grantScopes: opts.identity.grantScopes?.length ? opts.identity.grantScopes : undefined,
      tokenId: opts.identity.tokenId,
      actor: opts.identity.actor,
      posture: opts.identity.posture,
      act: opts.identity.act,
      participant: opts.identity.participant,
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
  ): Promise<FunctionUrlResponse | CommandResult | void> {
    // ---- EventBridge-delivered domain event (Mode 2, subscriber side) ----
    const eb = event as unknown as { 'detail-type'?: string; source?: string; detail?: Record<string, unknown> };
    if (
      typeof eb['detail-type'] === 'string' &&
      typeof eb.source === 'string' &&
      eb.detail !== undefined &&
      !('requestContext' in event)
    ) {
      const detailType = eb['detail-type'];
      const correlationId = (eb.detail?.correlationId as string | undefined) ?? randomUUID();
      // Bus events carry no caller identity; trust derives from the event's
      // IAM-attested `source`, which the handler receives in `meta`.
      const ctx = buildContext({ correlationId, traceId: correlationId, identity: { scopes: [] } });
      const eventHandler = definition.events?.handles?.[detailType];
      if (!eventHandler) {
        ctx.logger.warn('unhandled bus event', { detailType, source: eb.source });
        return;
      }
      // Throwing lets Lambda's async retry handle transient failures.
      await eventHandler(eb.detail ?? {}, ctx, { source: eb.source, detailType });
      ctx.logger.info('bus event handled', { detailType, source: eb.source });
      return;
    }

    // ---- Direct service-to-service invoke -------------------------------
    if (isCommandEnvelope(event)) {
      const correlationId = event.correlationId ?? randomUUID();
      const ctx = buildContext({
        correlationId,
        traceId: correlationId,
        identity: {
          user: event.user,
          scopes: event.scopes ?? [],
          ...(event.grantScopes ? { grantScopes: event.grantScopes } : {}),
          ...(event.tokenId ? { tokenId: event.tokenId } : {}),
          ...(event.actor ? { actor: event.actor } : {}),
          ...(event.posture ? { posture: event.posture } : {}),
          ...(event.act ? { act: event.act } : {}),
          ...(event.participant ? { participant: event.participant } : {}),
        },
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
    const { identity, setCookies } = await resolveHttpIdentity(httpEvent.headers, definition.name, method);
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
        // Re-prime the browser with any cookies the edge silent-refresh rotated
        // (only set on a dispatch top-level navigation). Cell/handler cookies win.
        const withCookies =
          setCookies && setCookies.length ? { ...res, cookies: [...setCookies, ...(res.cookies ?? [])] } : res;
        return renderHttp(withCookies, correlationId);
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
    ...(res.isBase64Encoded ? { isBase64Encoded: true } : {}),
    ...(res.cookies && res.cookies.length ? { cookies: res.cookies } : {}),
  };
}

export class UnknownCommandError extends Error {
  readonly statusCode = 404;
  constructor(command: string) {
    super(`Unknown command: ${command}`);
    this.name = 'UnknownCommandError';
  }
}
