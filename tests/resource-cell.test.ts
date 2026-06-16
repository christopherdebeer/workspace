/**
 * resource cell — the platform MCP **gateway** at `/mcp`, read/act surface.
 *
 * Drives the real gateway handler through the runtime HTTP path with peer-invoke
 * stubbed for `auth.validateToken` and for the providers (`workspace`, `forge`).
 * Asserts the stable three-tool surface (whoami/read/act); that `read("$catalog")`
 * aggregates + scope-filters the capability menu; that `read`/`act` forward to the
 * owning cell, enforce per-target scope, and refuse to cross the read/act boundary;
 * and that dynamic-cell tools dispatch through `forge.callCellTool`.
 */
import { handler as gateway } from '../services/gateway/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

interface ValidatedToken {
  userId: string;
  scope: string;
  effectiveScope?: string | null;
  tokenId?: string;
  clientId: string | null;
}

interface StubTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  scope: string | null;
  kind: 'read' | 'act';
}

const WORKSPACE_TOOLS: StubTool[] = [
  { name: 'recall', description: 'Your view.', inputSchema: { type: 'object' }, scope: null, kind: 'read' },
  { name: 'remember', description: 'Write a fact.', inputSchema: { type: 'object' }, scope: null, kind: 'act' },
];
const CELLS_TOOLS = [
  { name: 'create', description: 'Provision a cell.', inputSchema: { type: 'object' }, scope: 'platform:cells:create', kind: 'act' },
  { name: 'list', description: 'List your cells.', inputSchema: { type: 'object' }, scope: null, kind: 'read' },
];

let lastCall: { fn: string; command: string; payload: unknown } | undefined;
/** Dynamic-cell tools forge advertises via describeCellTools (per-test). */
let cellTools: Array<Record<string, unknown>> = [];
/** `_types/<type>` facts workspace.query returns for the per-user `$types` overrides (per-test). */
let typeFacts: Array<{ key: string; value: unknown }> = [];
/** Global type vocabulary cells.describeTypes returns for the `$types` read (per-test). */
let globalTypes: Record<string, unknown> = {};

function stub(tokens: Record<string, ValidatedToken>): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      const fn = params.FunctionName;
      let result: unknown = null;
      if (fn === 'auth-fn' && env.__command === 'validateToken') {
        result = tokens[env.payload.token as string] ?? null;
      } else if (fn === 'workspace-fn') {
        if (env.__command === 'describeTools') result = { tools: WORKSPACE_TOOLS };
        else if (env.__command === 'query' && (env.payload as { prefix?: string }).prefix === '_types/') {
          result = { entries: typeFacts };
        } else {
          lastCall = { fn: 'workspace', command: env.__command, payload: env.payload };
          result = { echoed: env.payload };
        }
      } else if (fn === 'cells-fn') {
        if (env.__command === 'describeTools') result = { tools: CELLS_TOOLS };
        else if (env.__command === 'describeCellTools') result = { tools: cellTools };
        else if (env.__command === 'describeTypes') result = { types: globalTypes };
        else {
          lastCall = { fn: 'cells', command: env.__command, payload: env.payload };
          result = { echoed: env.payload };
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

/** Run a tool and return its parsed JSON content (or the raw result for errors). */
async function callTool(token: string, name: string, args: unknown): Promise<{ isError?: boolean; parsed?: unknown; text: string }> {
  const res = await mcp(token, 'tools/call', { name, arguments: args });
  const text = (res.result!.content as Array<{ text: string }>)[0].text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { isError: res.result!.isError as boolean | undefined, parsed, text };
}

describe('resource cell (MCP gateway, read/act)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'gateway';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', cells: 'cells-fn', workspace: 'workspace-fn' });
    process.env.PUBLIC_BASE_URL = 'https://parc.land';
    lastCall = undefined;
    cellTools = [];
    typeFacts = [];
    globalTypes = {};
    stub({
      creator: { userId: 'alice', scope: 'platform:cells:create', clientId: null },
      plain: { userId: 'bob', scope: 'workspace:read', clientId: null },
      // A session whose grant includes cell creation but whose effective focus has
      // been narrowed to nothing (incremental authorization).
      reduced: { userId: 'carol', scope: 'platform:cells:create', effectiveScope: '', tokenId: 't1', clientId: null },
    });
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('exposes a stable three-tool surface: whoami, read, act', async () => {
    const list = await mcp('creator', 'tools/list');
    const names = (list.result!.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(['act', 'read', 'whoami']);
  });

  it('read("$catalog") aggregates tier-1 + dynamic capabilities, scope-filtered', async () => {
    cellTools = [
      { name: 'x__echo', address: '@alice/tools-demo', description: 'Echo.', inputSchema: { type: 'object' }, scope: null, kind: 'act', cellId: 'tools-demo-1', tool: 'echo' },
    ];
    const cat = await callTool('creator', 'read', { target: '$catalog' });
    const targets = ((cat.parsed as { capabilities: Array<{ target: string }> }).capabilities).map((c) => c.target).sort();
    expect(targets).toEqual(['@alice/tools-demo.echo', 'cells.create', 'cells.list', 'workspace.recall', 'workspace.remember']);

    // bob lacks platform:cells:create, so forge.createCell is filtered out.
    const bobCat = await callTool('plain', 'read', { target: '$catalog' });
    const bobTargets = ((bobCat.parsed as { capabilities: Array<{ target: string }> }).capabilities).map((c) => c.target);
    expect(bobTargets).not.toContain('cells.create');
    expect(bobTargets).toContain('workspace.recall');
  });

  it('read omitting target also returns the catalog', async () => {
    const cat = await callTool('creator', 'read', {});
    expect((cat.parsed as { capabilities: unknown[] }).capabilities.length).toBeGreaterThan(0);
  });

  it('read("$types") returns the global cell-registry vocabulary keyed by bare type name', async () => {
    globalTypes = {
      doc: { manager: '@c15r/lit', handlers: { open: [{ surface: '/@c15r/lit?doc=${match}' }] } },
      capture: { manager: '@c15r/input', icon: '📥' },
    };
    const res = await callTool('creator', 'read', { target: '$types' });
    const out = res.parsed as { types: Record<string, { manager?: string }>; hint: string };
    expect(Object.keys(out.types).sort()).toEqual(['capture', 'doc']);
    expect(out.types.doc.manager).toBe('@c15r/lit');
    expect(out.hint).toMatch(/handlers\[intent\]/);
  });

  it('read("$types") merges per-user _types/ overrides over the global registry', async () => {
    globalTypes = {
      doc: { manager: '@c15r/lit', icon: '📄' },
      capture: { manager: '@c15r/input', icon: '📥' },
    };
    typeFacts = [
      { key: '_types/doc', value: { manager: '@alice/custom-doc', icon: '✏️' } },
      { key: '_types/note', value: { manager: '@alice/notes', icon: '🗒️' } },
    ];
    const res = await callTool('creator', 'read', { target: '$types' });
    const out = res.parsed as { types: Record<string, { manager?: string }> };
    expect(Object.keys(out.types).sort()).toEqual(['capture', 'doc', 'note']);
    // user override wins over the global declaration for the same type
    expect(out.types.doc.manager).toBe('@alice/custom-doc');
    // untouched global type survives
    expect(out.types.capture.manager).toBe('@c15r/input');
    // user-only type appears
    expect(out.types.note.manager).toBe('@alice/notes');
  });

  it('read("$catalog", {detail:"summary"}) groups one-line capabilities by cell, schema-free', async () => {
    cellTools = [
      { name: 'x__echo', address: '@alice/tools-demo', description: 'Echo. With a second sentence.', inputSchema: { type: 'object' }, scope: null, kind: 'act', cellId: 'tools-demo-1', tool: 'echo' },
    ];
    const res = await callTool('creator', 'read', { target: '$catalog', input: { detail: 'summary' } });
    const summary = res.parsed as {
      cells: Array<{ cell: string; count: number; capabilities: Array<Record<string, unknown>> }>;
      hint: string;
    };
    const cellNames = summary.cells.map((c) => c.cell).sort();
    expect(cellNames).toEqual(['@alice/tools-demo', 'cells', 'workspace']);
    const ws = summary.cells.find((c) => c.cell === 'workspace')!;
    expect(ws.count).toBe(2);
    expect(ws.capabilities[0]).toEqual({ target: expect.stringMatching(/^workspace\./), kind: expect.any(String), summary: expect.any(String) });
    // one line each: the echo entry keeps only its first sentence, and no schemas anywhere
    const echo = summary.cells.find((c) => c.cell === '@alice/tools-demo')!.capabilities[0];
    expect(echo.summary).toBe('Echo.');
    expect(JSON.stringify(summary)).not.toContain('inputSchema');
    expect(summary.hint).toContain('$catalog');
  });

  it('catalog passes a provider resultSchema through when declared', async () => {
    WORKSPACE_TOOLS[0].resultSchema = { type: 'object', properties: { entries: { type: 'object' } } };
    try {
      const cat = await callTool('creator', 'read', { target: '$catalog' });
      const caps = (cat.parsed as { capabilities: Array<{ target: string; resultSchema?: unknown }> }).capabilities;
      expect(caps.find((c) => c.target === 'workspace.recall')?.resultSchema).toEqual(WORKSPACE_TOOLS[0].resultSchema);
      expect(caps.find((c) => c.target === 'workspace.remember')?.resultSchema).toBeUndefined();
    } finally {
      delete WORKSPACE_TOOLS[0].resultSchema;
    }
  });

  it('initialize introduces the server: name, title, and instructions', async () => {
    const init = await mcp('creator', 'initialize', { protocolVersion: '2025-06-18' });
    const result = init.result as { serverInfo: { name: string; title?: string }; instructions?: string };
    expect(result.serverInfo.name).toBe('parc-substrate');
    expect(result.serverInfo.title).toBe('parc.land substrate');
    expect(result.instructions).toContain('read("$catalog"');
  });

  it('tools/list carries spec annotations and titles for the three verbs', async () => {
    const list = await mcp('creator', 'tools/list');
    const tools = list.result!.tools as Array<{ name: string; title?: string; annotations?: { readOnlyHint?: boolean } }>;
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.read.annotations?.readOnlyHint).toBe(true);
    expect(byName.whoami.annotations?.readOnlyHint).toBe(true);
    expect(byName.act.annotations?.readOnlyHint).toBe(false);
    expect(byName.read.title).toBeDefined();
  });

  it('read forwards a read-kind capability to its cell', async () => {
    const res = await callTool('creator', 'read', { target: 'workspace.recall', input: { elision: 'none' } });
    expect(res.isError).toBeUndefined();
    expect(lastCall).toEqual({ fn: 'workspace', command: 'recall', payload: { elision: 'none' } });
  });

  it('act forwards an act-kind capability to its cell', async () => {
    const res = await callTool('creator', 'act', { target: 'workspace.remember', input: { key: 'k', value: 1 } });
    expect(res.isError).toBeUndefined();
    expect(lastCall).toEqual({ fn: 'workspace', command: 'remember', payload: { key: 'k', value: 1 } });
  });

  it('act enforces the per-target scope (createCell needs platform:cells:create)', async () => {
    const ok = await callTool('creator', 'act', { target: 'cells.create', input: { name: 'n', code: 'c' } });
    expect(ok.isError).toBeUndefined();
    expect(lastCall).toEqual({ fn: 'cells', command: 'create', payload: { name: 'n', code: 'c' } });

    lastCall = undefined;
    const denied = await callTool('plain', 'act', { target: 'cells.create', input: { name: 'n', code: 'c' } });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/scope/i);
    expect(lastCall).toBeUndefined(); // never forwarded
  });

  it('incremental auth: within-grant-but-out-of-focus → scope_offer (self-serve widen); out-of-grant → scope_denied', async () => {
    // `reduced` has platform:cells:create in its GRANT but its session focus is
    // empty — so the gateway offers a self-serve widen rather than a hard denial.
    const offer = await callTool('reduced', 'act', { target: 'cells.create', input: { name: 'n', code: 'c' } });
    expect(offer.isError).toBe(true);
    expect(offer.text).toMatch(/scope_offer/);
    expect(offer.text).toMatch(/auth\.requestScope/);
    expect(lastCall).toBeUndefined(); // not forwarded until widened

    // `plain` lacks the scope in its grant entirely → hard scope_denied (re-consent).
    const denied = await callTool('plain', 'act', { target: 'cells.create', input: { name: 'n', code: 'c' } });
    expect(denied.text).toMatch(/scope_denied/);

    // whoami reflects the split: effective focus is empty, grant still carries it.
    const who = await callTool('reduced', 'whoami', {});
    expect(who.parsed).toEqual({ user: 'carol', scopes: [], grant: ['platform:cells:create'] });
  });

  it('refuses to cross the read/act boundary', async () => {
    const readAct = await callTool('creator', 'read', { target: 'workspace.remember' });
    expect(readAct.isError).toBe(true);
    expect(readAct.text).toMatch(/act/i);
    expect(lastCall).toBeUndefined();

    const actRead = await callTool('creator', 'act', { target: 'workspace.recall' });
    expect(actRead.isError).toBe(true);
    expect(actRead.text).toMatch(/read/i);
    expect(lastCall).toBeUndefined();
  });

  it('act dispatches a dynamic-cell tool through forge.callCellTool', async () => {
    cellTools = [
      { name: 'x__echo', address: '@alice/tools-demo', description: 'Echo.', inputSchema: { type: 'object' }, scope: null, kind: 'act', cellId: 'tools-demo-1', tool: 'echo' },
    ];
    const res = await callTool('creator', 'act', { target: '@alice/tools-demo.echo', input: { message: 'hi' } });
    expect(res.isError).toBeUndefined();
    expect(lastCall).toEqual({
      fn: 'cells',
      command: 'callCellTool',
      payload: { owner: 'alice', name: 'tools-demo', tool: 'echo', args: { message: 'hi' } },
    });
  });

  it('unknown target is a tool error, not a transport error', async () => {
    const res = await callTool('creator', 'act', { target: 'workspace.nope' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/unknown capability/i);
  });

  it('whoami returns the identity (built-in tool)', async () => {
    const res = await callTool('creator', 'whoami', {});
    // grant == scopes until a session narrows its effective focus (incremental auth).
    expect(res.parsed).toEqual({ user: 'alice', scopes: ['platform:cells:create'], grant: ['platform:cells:create'] });
  });

  it('resolves identity from x-forwarded-authorization (edge preserves bearer past OAC)', async () => {
    const res = (await gateway(
      httpEvent('POST', '/mcp', {
        headers: { 'x-forwarded-authorization': 'Bearer creator' },
        body: rpc('tools/call', { name: 'whoami', arguments: {} }),
      }),
    )) as FunctionUrlResponse;
    const content = (JSON.parse(res.body).result.content as Array<{ text: string }>)[0];
    expect(JSON.parse(content.text)).toEqual({ user: 'alice', scopes: ['platform:cells:create'], grant: ['platform:cells:create'] });
  });

  it('POST /mcp without a bearer answers 401 + WWW-Authenticate', async () => {
    const res = (await gateway(httpEvent('POST', '/mcp', { body: rpc('tools/list') }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata="https://parc.land/.well-known/oauth-protected-resource/mcp"');
  });

  describe('CORS for host-isolated cell origins', () => {
    afterEach(() => delete process.env.MCP_CORS_ORIGIN_SUFFIX);

    it('answers the OPTIONS preflight and reflects an allowed cell origin', async () => {
      process.env.MCP_CORS_ORIGIN_SUFFIX = '.on.parc.land';
      const res = (await gateway(
        httpEvent('OPTIONS', '/mcp', { headers: { origin: 'https://c15r-lit.on.parc.land' } }),
      )) as FunctionUrlResponse;
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://c15r-lit.on.parc.land');
      expect(res.headers['access-control-allow-headers']).toContain('authorization');
    });

    it('sets CORS on a real POST from an allowed cell origin', async () => {
      process.env.MCP_CORS_ORIGIN_SUFFIX = '.on.parc.land';
      const res = (await gateway(
        httpEvent('POST', '/mcp', {
          headers: { 'x-forwarded-authorization': 'Bearer creator', origin: 'https://c15r-lit.on.parc.land' },
          body: rpc('tools/call', { name: 'whoami', arguments: {} }),
        }),
      )) as FunctionUrlResponse;
      expect(res.headers['access-control-allow-origin']).toBe('https://c15r-lit.on.parc.land');
      expect(res.headers['vary']).toBe('Origin');
    });

    it('does NOT reflect a non-cell origin (and 401 still carries no ACAO)', async () => {
      process.env.MCP_CORS_ORIGIN_SUFFIX = '.on.parc.land';
      const evil = (await gateway(
        httpEvent('OPTIONS', '/mcp', { headers: { origin: 'https://evil.example.com' } }),
      )) as FunctionUrlResponse;
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
      const noBearer = (await gateway(
        httpEvent('POST', '/mcp', { headers: { origin: 'https://evil.example.com' }, body: rpc('tools/list') }),
      )) as FunctionUrlResponse;
      expect(noBearer.statusCode).toBe(401);
      expect(noBearer.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('emits no CORS at all when the suffix is unconfigured', async () => {
      const res = (await gateway(
        httpEvent('OPTIONS', '/mcp', { headers: { origin: 'https://c15r-lit.on.parc.land' } }),
      )) as FunctionUrlResponse;
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
