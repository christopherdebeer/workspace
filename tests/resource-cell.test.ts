/**
 * resource cell — the platform MCP **gateway** at `/mcp`.
 *
 * Drives the real gateway handler through the runtime HTTP path with the
 * peer-invoke Lambda stubbed for `auth.validateToken` (identity + scopes) and
 * for `forge.describeTools` / `forge.createCell` (the aggregated provider).
 * Asserts: `tools/list` aggregates forge's tools and the built-in `whoami`,
 * filtered by the caller's scopes; `tools/call` enforces the tool scope and
 * forwards to forge; and unauthenticated calls get 401 + WWW-Authenticate.
 */
import { handler as gateway } from '../services/resource/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

interface ValidatedToken {
  userId: string;
  scope: string;
  clientId: string | null;
}

const FORGE_TOOLS = [
  {
    name: 'createCell',
    description: 'Provision a dynamic cell.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    scope: 'platform:cells:create',
  },
  {
    name: 'listCells',
    description: 'List your cells.',
    inputSchema: { type: 'object', properties: {} },
    scope: null,
  },
];

let lastForgeCall: { command: string; payload: unknown } | undefined;
/** Dynamic-cell tools forge advertises via describeCellTools (per-test). */
let cellTools: Array<Record<string, unknown>> = [];

function stub(tokens: Record<string, ValidatedToken>): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      let result: unknown = null;
      if (params.FunctionName === 'auth-fn' && env.__command === 'validateToken') {
        result = tokens[env.payload.token as string] ?? null;
      } else if (params.FunctionName === 'forge-fn') {
        if (env.__command === 'describeTools') {
          result = { tools: FORGE_TOOLS };
        } else if (env.__command === 'describeCellTools') {
          // Registry-driven dynamic-cell tools; empty unless a test sets them.
          result = { tools: cellTools };
        } else {
          lastForgeCall = { command: env.__command, payload: env.payload };
          result = { cellId: 'notes-abc12345', address: '/@alice/notes', status: 'CREATING' };
        }
      }
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setLambda>[0]);
}

function httpEvent(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers: opts.headers ?? {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
  };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const rpc = (method: string, params?: unknown, id = 1) => ({ jsonrpc: '2.0', id, method, params });

async function mcp(token: string | null, method: string, params?: unknown): Promise<{ result?: Record<string, unknown>; error?: { code: number } }> {
  const headers = token ? bearer(token) : {};
  const res = (await gateway(httpEvent('POST', '/mcp', { headers, body: rpc(method, params) }))) as FunctionUrlResponse;
  return JSON.parse(res.body);
}

describe('resource cell (MCP gateway)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'resource';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', forge: 'forge-fn' });
    process.env.PUBLIC_BASE_URL = 'https://parc.land';
    lastForgeCall = undefined;
    cellTools = [];
    stub({
      creator: { userId: 'alice', scope: 'platform:cells:create', clientId: null },
      plain: { userId: 'bob', scope: 'workspace:read', clientId: null },
    });
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('tools/list aggregates forge tools + whoami, scoped to the caller', async () => {
    const withScope = await mcp('creator', 'tools/list');
    const names = (withScope.result!.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(['createCell', 'listCells', 'whoami']);
  });

  it('hides scoped tools the caller lacks (createCell needs platform:cells:create)', async () => {
    const noScope = await mcp('plain', 'tools/list');
    const names = (noScope.result!.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(['listCells', 'whoami']);
    expect(names).not.toContain('createCell');
  });

  it('tools/call createCell enforces the scope and forwards to forge', async () => {
    const ok = await mcp('creator', 'tools/call', { name: 'createCell', arguments: { name: 'notes', code: 'x' } });
    expect(ok.result!.isError).toBeUndefined();
    expect(lastForgeCall?.command).toBe('createCell');
    expect(lastForgeCall?.payload).toEqual({ name: 'notes', code: 'x' });
    const content = (ok.result!.content as Array<{ text: string }>)[0];
    expect(JSON.parse(content.text)).toMatchObject({ address: '/@alice/notes', status: 'CREATING' });
  });

  it('tools/call createCell without the scope is a tool error, and does not reach forge', async () => {
    const denied = await mcp('plain', 'tools/call', { name: 'createCell', arguments: { name: 'x', code: 'y' } });
    expect(denied.result!.isError).toBe(true);
    expect((denied.result!.content as Array<{ text: string }>)[0].text).toMatch(/scope/i);
    expect(lastForgeCall).toBeUndefined();
  });

  it('tools/call whoami returns the identity (built-in tool)', async () => {
    const res = await mcp('creator', 'tools/call', { name: 'whoami', arguments: {} });
    const content = (res.result!.content as Array<{ text: string }>)[0];
    expect(JSON.parse(content.text)).toEqual({ user: 'alice', scopes: ['platform:cells:create'] });
  });

  it('resolves identity from x-forwarded-authorization (edge preserves bearer past OAC)', async () => {
    // CloudFront OAC overwrites Authorization with its SigV4 signature; the edge
    // copies the viewer bearer into x-forwarded-authorization for the origin.
    const res = (await gateway(
      httpEvent('POST', '/mcp', {
        headers: { 'x-forwarded-authorization': 'Bearer creator' },
        body: rpc('tools/call', { name: 'whoami', arguments: {} }),
      }),
    )) as FunctionUrlResponse;
    const content = (JSON.parse(res.body).result.content as Array<{ text: string }>)[0];
    expect(JSON.parse(content.text)).toEqual({ user: 'alice', scopes: ['platform:cells:create'] });
  });

  it('tools/list folds in dynamic-cell tools discovered from the registry', async () => {
    cellTools = [
      {
        name: 'notes-abc12345__add',
        description: 'Add a note.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        scope: null,
        cellId: 'notes-abc12345',
        tool: 'add',
      },
    ];
    const list = await mcp('creator', 'tools/list');
    const names = (list.result!.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toContain('notes-abc12345__add');
    // kernel tools remain present
    expect(names).toContain('createCell');
  });

  it('tools/call on a dynamic-cell tool forwards through forge.callCellTool', async () => {
    cellTools = [
      {
        name: 'notes-abc12345__add',
        description: 'Add a note.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        scope: null,
        cellId: 'notes-abc12345',
        tool: 'add',
      },
    ];
    const res = await mcp('creator', 'tools/call', { name: 'notes-abc12345__add', arguments: { text: 'hi' } });
    expect(res.result!.isError).toBeUndefined();
    expect(lastForgeCall?.command).toBe('callCellTool');
    expect(lastForgeCall?.payload).toEqual({ cellId: 'notes-abc12345', tool: 'add', args: { text: 'hi' } });
  });

  it('POST /mcp without a bearer answers 401 + WWW-Authenticate', async () => {
    const res = (await gateway(httpEvent('POST', '/mcp', { body: rpc('tools/list') }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata="https://parc.land/.well-known/oauth-protected-resource/mcp"');
  });
});
