/**
 * Resource cell + runtime bearer-identity integration.
 *
 * Drives the real `resource` handler through the runtime's HTTP path with the
 * auth cell's `validateToken` invoke stubbed, asserting the end-to-end auth
 * contract: validated bearer -> identity, scope enforcement, and — critically —
 * that forged `x-auth-*` headers are NOT trusted (the spoof fix).
 */
import { handler as resource } from '../services/resource/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

interface ValidatedToken {
  userId: string;
  scope: string;
  clientId: string | null;
}

function httpEvent(method: string, path: string, headers: Record<string, string> = {}): FunctionUrlEvent {
  return { rawPath: path, requestContext: { http: { method, path } }, headers, isBase64Encoded: false };
}

/** Stub the auth cell: validateToken returns `token` if known, else null. */
function stubAuth(tokens: Record<string, ValidatedToken>): { calls: unknown[] } {
  const calls: unknown[] = [];
  __setLambda({
    invoke: (params: Record<string, unknown>) => {
      const envelope = JSON.parse(params.Payload as string) as { __command: string; payload: { token: string } };
      calls.push(envelope);
      const result = envelope.__command === 'validateToken' ? (tokens[envelope.payload.token] ?? null) : null;
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setLambda>[0]);
  return { calls };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('resource cell', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'resource';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn' });
    process.env.PUBLIC_BASE_URL = 'https://parc.land';
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('returns the identity for a valid bearer token', async () => {
    stubAuth({ good: { userId: 'alice', scope: 'workspace:read workspace:write', clientId: 'c1' } });
    const res = (await resource(httpEvent('GET', '/mcp/whoami', bearer('good')))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ user: 'alice', scopes: ['workspace:read', 'workspace:write'] });
  });

  it('challenges with 401 + WWW-Authenticate when no token is present', async () => {
    stubAuth({});
    const res = (await resource(httpEvent('GET', '/mcp/whoami'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata="https://parc.land/.well-known/oauth-protected-resource"');
  });

  it('does NOT trust forged x-auth-* headers (spoof fix)', async () => {
    const { calls } = stubAuth({});
    const res = (await resource(
      httpEvent('GET', '/mcp/whoami', { 'x-auth-user': 'attacker', 'x-auth-scopes': 'workspace:admin' }),
    )) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
    // No bearer => auth is never even consulted, and identity stays anonymous.
    expect(calls).toHaveLength(0);
  });

  it('rejects an unknown/revoked token with 401', async () => {
    stubAuth({ good: { userId: 'alice', scope: 'workspace:read', clientId: null } });
    const res = (await resource(httpEvent('GET', '/mcp/whoami', bearer('revoked')))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
  });

  it('enforces scope on /mcp/admin', async () => {
    stubAuth({
      reader: { userId: 'alice', scope: 'workspace:read', clientId: null },
      boss: { userId: 'root', scope: 'workspace:admin', clientId: null },
    });
    const denied = (await resource(httpEvent('GET', '/mcp/admin', bearer('reader')))) as FunctionUrlResponse;
    expect(denied.statusCode).toBe(403);
    expect(JSON.parse(denied.body).error).toBe('insufficient_scope');

    const allowed = (await resource(httpEvent('GET', '/mcp/admin', bearer('boss')))) as FunctionUrlResponse;
    expect(allowed.statusCode).toBe(200);
    expect(JSON.parse(allowed.body)).toMatchObject({ user: 'root', admin: true });
  });

  it('serves unauthenticated discovery at /mcp', async () => {
    stubAuth({});
    const res = (await resource(httpEvent('GET', '/mcp'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ resource: 'https://parc.land/mcp' });
  });
});
