import { defineService } from '../platform/runtime/define-service';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

function httpEvent(method: string, path: string, body?: unknown): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers: { host: 'svc.example.com' },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

describe('defineService raw HTTP routes', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'thing';
    delete process.env.PUBLIC_BASE_URL;
  });

  const handler = defineService({
    name: 'thing',
    commands: {
      ping: () => ({ pong: true }),
    },
    http: [
      { method: 'GET', path: '/.well-known/info', handler: () => ({ body: { ok: true } }) },
      { method: 'GET', path: '/page', handler: () => ({ headers: { 'content-type': 'text/html' }, body: '<h1>hi</h1>' }) },
      {
        method: 'POST',
        path: '/oauth/*',
        handler: (req) => ({ body: { matched: req.path, url: req.url, sent: req.json() } }),
      },
    ],
  });

  it('dispatches an exact GET route returning JSON', async () => {
    const res = (await handler(httpEvent('GET', '/.well-known/info'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('returns string bodies verbatim with the given content-type', async () => {
    const res = (await handler(httpEvent('GET', '/page'))) as FunctionUrlResponse;
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body).toBe('<h1>hi</h1>');
  });

  it('matches prefix routes and parses the body + url', async () => {
    const res = (await handler(httpEvent('POST', '/oauth/token', { grant_type: 'x' }))) as FunctionUrlResponse;
    const body = JSON.parse(res.body);
    expect(body.matched).toBe('/oauth/token');
    expect(body.url).toBe('https://svc.example.com/oauth/token');
    expect(body.sent).toEqual({ grant_type: 'x' });
  });

  it('prefers PUBLIC_BASE_URL when set', async () => {
    process.env.PUBLIC_BASE_URL = 'https://auth.parc.land';
    const res = (await handler(httpEvent('POST', '/oauth/token', {}))) as FunctionUrlResponse;
    expect(JSON.parse(res.body).url).toBe('https://auth.parc.land/oauth/token');
  });

  it('falls through to command dispatch when no route matches', async () => {
    const res = (await handler(httpEvent('POST', '/thing/ping', {}))) as FunctionUrlResponse;
    expect(JSON.parse(res.body)).toEqual({ ok: true, result: { pong: true } });
  });

  it('includes http prefixes in the manifest', () => {
    expect(handler.manifest.routes).toEqual(
      expect.arrayContaining(['/thing/*', '/.well-known/info', '/page', '/oauth/*']),
    );
  });
});
