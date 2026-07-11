import { defineService } from '../platform/runtime/define-service';
import { createLogger } from '../platform/runtime/logger';
import { createServiceClient, __setLambda } from '../platform/runtime/service-client';
import { createEvents, __setEventBridge } from '../platform/runtime/events';
import { identityFromHeaders } from '../platform/runtime/auth';
import type { ServiceContext, FunctionUrlEvent, FunctionUrlResponse, CommandResult } from '../platform/runtime/types';

function httpEvent(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

describe('logger', () => {
  it('emits a single structured JSON line', () => {
    const lines: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });
    const logger = createLogger({ service: 'svc', correlationId: 'c1', traceId: 't1' });
    logger.info('hello', { extra: 1 });
    spy.mockRestore();

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({
      service: 'svc',
      correlationId: 'c1',
      traceId: 't1',
      level: 'info',
      message: 'hello',
      extra: 1,
    });
    expect(typeof record.time).toBe('string');
  });

  it('suppresses below-threshold levels', () => {
    process.env.LOG_LEVEL = 'warn';
    const writes: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
      writes.push(String(c));
      return true;
    });
    const logger = createLogger({ service: 'svc' });
    logger.info('skip me');
    logger.warn('keep me');
    spy.mockRestore();
    delete process.env.LOG_LEVEL;

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).message).toBe('keep me');
  });
});

describe('auth', () => {
  it('parses normalised edge headers', () => {
    const id = identityFromHeaders({ 'x-auth-user': 'alice', 'x-auth-scopes': 'read, write' });
    expect(id.user).toBe('alice');
    expect(id.scopes).toEqual(['read', 'write']);
  });

  it('is anonymous when no user header present', () => {
    expect(identityFromHeaders({}).user).toBeUndefined();
  });
});

describe('serviceClient', () => {
  afterEach(() => __setLambda(undefined));

  it('builds a command envelope and unwraps the result', async () => {
    const calls: Array<Record<string, unknown>> = [];
    __setLambda({
      invoke: (params: Record<string, unknown>) => {
        calls.push(params);
        return {
          promise: async () => ({ Payload: JSON.stringify({ ok: true, result: { value: 42 } }) }),
        };
      },
    } as never);

    const client = createServiceClient({ registry: { render: 'render-fn' }, correlationId: 'c9' });
    const result = await client('render').command<{ value: number }>('generatePreview', { body: 'hi' });

    expect(result).toEqual({ value: 42 });
    expect(calls[0].FunctionName).toBe('render-fn');
    const envelope = JSON.parse(calls[0].Payload as string);
    expect(envelope).toMatchObject({ __command: 'generatePreview', payload: { body: 'hi' }, correlationId: 'c9' });
  });

  it('throws when the target is not in the registry', () => {
    const client = createServiceClient({ registry: {} });
    expect(() => client('missing')).toThrow(/not in the registry/);
  });

  it('surfaces remote command errors', async () => {
    __setLambda({
      invoke: () => ({ promise: async () => ({ Payload: JSON.stringify({ ok: false, error: 'boom' }) }) }),
    } as never);
    const client = createServiceClient({ registry: { render: 'render-fn' } });
    await expect(client('render').command('x', {})).rejects.toThrow(/boom/);
  });
});

describe('events', () => {
  afterEach(() => __setEventBridge(undefined));

  it('publishes to the configured bus', async () => {
    const calls: Array<Record<string, unknown>> = [];
    __setEventBridge({
      putEvents: (params: Record<string, unknown>) => {
        calls.push(params);
        return { promise: async () => ({}) };
      },
    } as never);

    const events = createEvents({ source: 'documents', busName: 'platform-bus', correlationId: 'c1' });
    await events.emit('document.created', { id: 'd1' });

    const entry = (calls[0].Entries as Array<Record<string, unknown>>)[0];
    expect(entry.EventBusName).toBe('platform-bus');
    expect(entry.Source).toBe('documents');
    expect(entry.DetailType).toBe('document.created');
    expect(JSON.parse(entry.Detail as string)).toMatchObject({ id: 'd1', correlationId: 'c1' });
  });

  it('is a no-op without a configured bus', async () => {
    const spy = jest.fn();
    __setEventBridge({ putEvents: spy } as never);
    const events = createEvents({ source: 'documents' });
    await events.emit('document.created', { id: 'd1' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('cookie session identity (dispatch tier, safe methods only)', () => {
  const TOKEN = 'sess-tok';
  beforeEach(() => {
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn' });
    process.env.AUTH_SERVICE_NAME = 'auth';
    __setLambda({
      invoke: (params: { FunctionName: string; Payload: string }) => {
        const env = JSON.parse(params.Payload) as { __command: string; payload: { token?: string } };
        let result: unknown = null;
        if (params.FunctionName === 'auth-fn' && env.__command === 'validateToken') {
          result = env.payload.token === TOKEN ? { userId: 'c15r', scope: 'workspace:read', clientId: null } : null;
        }
        return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
      },
    } as never);
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.AUTH_SERVICE_NAME;
    delete process.env.SERVICE_NAME;
  });

  const whoami = (name: string) =>
    defineService({
      name,
      commands: {},
      http: [
        { method: 'GET', path: '/@*', handler: (_req, ctx) => ({ statusCode: 200, body: { user: ctx.identity.user ?? null } }) },
        { method: 'POST', path: '/@*', handler: (_req, ctx) => ({ statusCode: 200, body: { user: ctx.identity.user ?? null } }) },
      ],
    });
  // A genuine top-level navigation carries `Sec-Fetch-Dest: document`; only those
  // are honoured. `nav` = navigation cookie; `sub` = a cell's fetch()/iframe.
  const nav = (t: string) => ({ cookie: `parc_session=${t}`, 'sec-fetch-dest': 'document' });
  const sub = (t: string, dest = 'empty') => ({ cookie: `parc_session=${t}`, 'sec-fetch-dest': dest });
  const userOf = (res: FunctionUrlResponse) => JSON.parse(res.body).user;

  it('dispatch GET resolves identity from the parc_session cookie on a top-level navigation', async () => {
    process.env.SERVICE_NAME = 'dispatch';
    const res = (await whoami('dispatch')(httpEvent('GET', '/@c15r/lit', undefined, nav(TOKEN)))) as FunctionUrlResponse;
    expect(userOf(res)).toBe('c15r');
  });

  it('does NOT honor the cookie on a cell fetch()/iframe (Sec-Fetch-Dest not document) — no ambient read', async () => {
    process.env.SERVICE_NAME = 'dispatch';
    const asFetch = (await whoami('dispatch')(httpEvent('GET', '/@c15r/lit', undefined, sub(TOKEN, 'empty')))) as FunctionUrlResponse;
    expect(userOf(asFetch)).toBeNull();
    const asIframe = (await whoami('dispatch')(httpEvent('GET', '/@c15r/lit', undefined, sub(TOKEN, 'iframe')))) as FunctionUrlResponse;
    expect(userOf(asIframe)).toBeNull();
    // Absent Sec-Fetch (curl / old client) is treated as non-navigation.
    const noHint = (await whoami('dispatch')(httpEvent('GET', '/@c15r/lit', undefined, { cookie: `parc_session=${TOKEN}` }))) as FunctionUrlResponse;
    expect(userOf(noHint)).toBeNull();
  });

  it('does NOT honor the cookie on a mutating method (no cookie-CSRF)', async () => {
    process.env.SERVICE_NAME = 'dispatch';
    const res = (await whoami('dispatch')(httpEvent('POST', '/@c15r/lit', {}, nav(TOKEN)))) as FunctionUrlResponse;
    expect(userOf(res)).toBeNull();
  });

  it('does NOT honor the cookie for the gateway tier (/mcp stays bearer-only)', async () => {
    process.env.SERVICE_NAME = 'gateway';
    const res = (await whoami('gateway')(httpEvent('GET', '/@x/y', undefined, nav(TOKEN)))) as FunctionUrlResponse;
    expect(userOf(res)).toBeNull();
  });

  it('an invalid cookie token resolves anonymous', async () => {
    process.env.SERVICE_NAME = 'dispatch';
    const res = (await whoami('dispatch')(httpEvent('GET', '/@c15r/lit', undefined, nav('bogus')))) as FunctionUrlResponse;
    expect(userOf(res)).toBeNull();
    // A clean "no" from auth is NOT degraded — the credential really is invalid.
    const flags = defineService({
      name: 'dispatch',
      commands: {},
      http: [{ method: 'GET', path: '/@*', handler: (_req, ctx) => ({ statusCode: 200, body: { user: ctx.identity.user ?? null, degraded: ctx.identity.degraded ?? false } }) }],
    });
    const clean = (await flags(httpEvent('GET', '/@c15r/lit', undefined, nav('bogus')))) as FunctionUrlResponse;
    expect(JSON.parse(clean.body)).toEqual({ user: null, degraded: false });
  });

  it('an auth-service ERROR resolves anonymous but degraded — the credential was never checked', async () => {
    process.env.SERVICE_NAME = 'gateway';
    __setLambda({
      invoke: () => ({
        promise: async () => {
          throw new Error('Lambda throttled');
        },
      }),
    } as never);
    const flags = defineService({
      name: 'gateway',
      commands: {},
      http: [{ method: 'GET', path: '/@*', handler: (_req, ctx) => ({ statusCode: 200, body: { user: ctx.identity.user ?? null, degraded: ctx.identity.degraded ?? false } }) }],
    });
    const res = (await flags(httpEvent('GET', '/@x/y', undefined, { 'x-forwarded-authorization': `Bearer ${TOKEN}` }))) as FunctionUrlResponse;
    expect(JSON.parse(res.body)).toEqual({ user: null, degraded: true });
  });

  it('a bearer still wins and works on any tier (cookie path is additive)', async () => {
    process.env.SERVICE_NAME = 'gateway';
    const res = (await whoami('gateway')(
      httpEvent('GET', '/@x/y', undefined, { 'x-forwarded-authorization': `Bearer ${TOKEN}` }),
    )) as FunctionUrlResponse;
    expect(userOf(res)).toBe('c15r');
  });
});

describe('defineService dispatch', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'echo';
    delete process.env.EVENT_BUS_NAME;
    delete process.env.SERVICE_REGISTRY;
    delete process.env.TABLE_NAME;
  });

  const handler = defineService({
    name: 'echo',
    commands: {
      ping: (input: unknown, ctx: ServiceContext) => {
        ctx.logger.debug('ping');
        return { echoed: input };
      },
      boom: () => {
        throw new Error('kaboom');
      },
    },
    events: { emits: ['echo.pinged'] },
  });

  it('exposes the generated manifest', () => {
    expect(handler.manifest).toMatchObject({
      name: 'echo',
      routes: ['/echo/*'],
      commands: ['ping', 'boom'],
      events: { emits: ['echo.pinged'] },
    });
  });

  it('dispatches an EventBridge event to its events.handles handler', async () => {
    const seen: Array<{ detail: Record<string, unknown>; source: string; detailType: string }> = [];
    const eventful = defineService({
      name: 'echo',
      commands: {},
      events: {
        emits: [],
        handles: {
          'thing.happened': (detail, _ctx, meta) => {
            seen.push({ detail, source: meta.source, detailType: meta.detailType });
          },
        },
      },
    });
    await eventful({
      'detail-type': 'thing.happened',
      source: 'cell-abc',
      detail: { key: 'k', value: 1 },
    } as unknown as Parameters<typeof eventful>[0]);
    expect(seen).toEqual([
      { detail: { key: 'k', value: 1 }, source: 'cell-abc', detailType: 'thing.happened' },
    ]);
    // An unhandled detail-type is swallowed (logged), not an error.
    await expect(
      eventful({ 'detail-type': 'other.event', source: 's', detail: {} } as unknown as Parameters<typeof eventful>[0]),
    ).resolves.toBeUndefined();
  });

  it('dispatches an HTTP command and returns ok:true', async () => {
    const res = (await handler(httpEvent('POST', '/echo/ping', { a: 1 }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-correlation-id']).toBeDefined();
    expect(JSON.parse(res.body)).toEqual({ ok: true, result: { echoed: { a: 1 } } });
  });

  it('serves the manifest over HTTP', async () => {
    const res = (await handler(httpEvent('GET', '/echo/_manifest'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe('echo');
  });

  it('returns 404 for an unknown HTTP command', async () => {
    const res = (await handler(httpEvent('POST', '/echo/nope', {}))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).ok).toBe(false);
  });

  it('returns 400 for invalid JSON', async () => {
    const evt = httpEvent('POST', '/echo/ping');
    evt.body = '{not json';
    const res = (await handler(evt)) as FunctionUrlResponse;
    expect(res.statusCode).toBe(400);
  });

  it('maps command errors to 500', async () => {
    const res = (await handler(httpEvent('POST', '/echo/boom', {}))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(500);
  });

  it('handles a direct command-envelope invoke', async () => {
    const res = (await handler({ __command: 'ping', payload: { b: 2 }, correlationId: 'c1' })) as CommandResult;
    expect(res).toEqual({ ok: true, result: { echoed: { b: 2 } } });
  });

  it('returns ok:false for a failing direct invoke', async () => {
    const res = (await handler({ __command: 'boom', payload: {} })) as CommandResult;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/kaboom/);
  });
});
