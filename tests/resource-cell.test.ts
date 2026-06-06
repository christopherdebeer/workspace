/**
 * Resource cell — MCP server + runtime bearer-identity integration.
 *
 * Drives the real `resource` handler (built with `defineMcpService`) through the
 * runtime's HTTP path with the auth cell's `validateToken` invoke stubbed,
 * asserting: the MCP JSON-RPC surface (initialize / tools/list / tools/call),
 * 401 + WWW-Authenticate when unauthenticated, and that forged `x-auth-*`
 * headers are NOT trusted (the spoof fix).
 */
import { handler as resource } from '../services/resource/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

interface ValidatedToken {
  userId: string;
  scope: string;
  clientId: string | null;
}

function httpEvent(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers: opts.headers ?? {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
  };
}

function stubAuth(tokens: Record<string, ValidatedToken>): void {
  __setLambda({
    invoke: (params: Record<string, unknown>) => {
      const envelope = JSON.parse(params.Payload as string) as { __command: string; payload: { token: string } };
      const result = envelope.__command === 'validateToken' ? (tokens[envelope.payload.token] ?? null) : null;
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setLambda>[0]);
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const rpc = (method: string, params?: unknown, id: number = 1) => ({ jsonrpc: '2.0', id, method, params });

describe('resource cell (MCP server)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'resource';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn' });
    process.env.PUBLIC_BASE_URL = 'https://parc.land';
    stubAuth({ good: { userId: 'alice', scope: 'workspace:read workspace:write', clientId: 'c1' } });
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('POST /mcp initialize returns serverInfo + tools capability', async () => {
    const res = (await resource(httpEvent('POST', '/mcp', { headers: bearer('good'), body: rpc('initialize', { protocolVersion: '2025-06-18' }) }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.result.serverInfo).toEqual({ name: 'workspace-resource', version: '1.0.0' });
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('POST /mcp tools/list advertises whoami + echo with schemas', async () => {
    const res = (await resource(httpEvent('POST', '/mcp', { headers: bearer('good'), body: rpc('tools/list') }))) as FunctionUrlResponse;
    const tools = JSON.parse(res.body).result.tools as Array<{ name: string; inputSchema: unknown }>;
    expect(tools.map((t) => t.name).sort()).toEqual(['echo', 'whoami']);
    expect(tools.find((t) => t.name === 'echo')!.inputSchema).toMatchObject({ required: ['text'] });
  });

  it('POST /mcp tools/call whoami returns the identity as content', async () => {
    const res = (await resource(httpEvent('POST', '/mcp', { headers: bearer('good'), body: rpc('tools/call', { name: 'whoami', arguments: {} }) }))) as FunctionUrlResponse;
    const result = JSON.parse(res.body).result;
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ user: 'alice', scopes: ['workspace:read', 'workspace:write'] });
  });

  it('POST /mcp tools/call echo round-trips its argument', async () => {
    const res = (await resource(httpEvent('POST', '/mcp', { headers: bearer('good'), body: rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } }) }))) as FunctionUrlResponse;
    const result = JSON.parse(res.body).result;
    expect(JSON.parse(result.content[0].text)).toEqual({ text: 'hi' });
  });

  it('POST /mcp tools/call on an unknown tool is a JSON-RPC error', async () => {
    const res = (await resource(httpEvent('POST', '/mcp', { headers: bearer('good'), body: rpc('tools/call', { name: 'nope' }) }))) as FunctionUrlResponse;
    expect(JSON.parse(res.body).error.code).toBe(-32602);
  });

  it('POST /mcp without a bearer answers 401 + WWW-Authenticate', async () => {
    const res = (await resource(httpEvent('POST', '/mcp', { body: rpc('initialize') }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata="https://parc.land/.well-known/oauth-protected-resource"');
  });

  it('GET /mcp/whoami: 401 with no token, 200 with a valid one', async () => {
    const anon = (await resource(httpEvent('GET', '/mcp/whoami'))) as FunctionUrlResponse;
    expect(anon.statusCode).toBe(401);
    const ok = (await resource(httpEvent('GET', '/mcp/whoami', { headers: bearer('good') }))) as FunctionUrlResponse;
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ user: 'alice', scopes: ['workspace:read', 'workspace:write'] });
  });

  it('does NOT trust forged x-auth-* headers (spoof fix)', async () => {
    const res = (await resource(
      httpEvent('GET', '/mcp/whoami', { headers: { 'x-auth-user': 'attacker', 'x-auth-scopes': 'workspace:admin' } }),
    )) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
  });

  it('serves unauthenticated discovery at GET /mcp', async () => {
    const res = (await resource(httpEvent('GET', '/mcp'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ resource: 'https://parc.land/mcp', transport: 'streamable-http' });
  });
});
