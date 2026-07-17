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

let lastCall: { fn: string; command: string; payload: unknown; participant?: string } | undefined;
/** Live `_presence/*` entries the workspace mock serves (ADR-0086 Inc 2). */
let presenceEntries: Array<{ key: string; value?: unknown; _meta?: unknown }> = [];
/** Dynamic-cell tools forge advertises via describeCellTools (per-test). */
let cellTools: Array<Record<string, unknown>> = [];
/** `_types/<type>` facts workspace.query returns for the per-user `$types` overrides (per-test). */
let typeFacts: Array<{ key: string; value: unknown }> = [];
/** Global type vocabulary cells.describeTypes returns for the `$types` read (per-test). */
let globalTypes: Record<string, unknown> = {};

function stub(tokens: Record<string, ValidatedToken>): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown>; participant?: string };
      const fn = params.FunctionName;
      let result: unknown = null;
      if (fn === 'auth-fn' && env.__command === 'validateToken') {
        result = tokens[env.payload.token as string] ?? null;
      } else if (fn === 'workspace-fn') {
        if (env.__command === 'describeTools') result = { tools: WORKSPACE_TOOLS };
        else if (env.__command === 'query' && (env.payload as { prefix?: string }).prefix === '_types/') {
          result = { entries: typeFacts };
        } else if (env.__command === 'query' && (env.payload as { prefix?: string }).prefix === '_presence/') {
          result = { entries: presenceEntries };
        } else {
          lastCall = { fn: 'workspace', command: env.__command, payload: env.payload, ...(env.participant ? { participant: env.participant } : {}) };
          result = { echoed: env.payload };
        }
      } else if (fn === 'cells-fn') {
        if (env.__command === 'describeTools') result = { tools: CELLS_TOOLS };
        else if (env.__command === 'describeCellTools') result = { tools: cellTools };
        else if (env.__command === 'describeTypes') result = { types: globalTypes };
        else if (env.__command === 'call') {
          // ADR-0039 provider hop: the gateway fetches a cell-authored renderer asset
          // via cells.call (GET). Echo the request so the test can assert the routing,
          // and return a renderer-script HTTP response.
          lastCall = { fn: 'cells', command: 'call', payload: env.payload };
          result = {
            statusCode: 200,
            headers: { 'content-type': 'application/javascript; charset=utf-8' },
            body: "window.__parcRender['machine-run']=function(){};",
            isBase64Encoded: false,
          };
        } else {
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
    presenceEntries = [];
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

  it('read("$catalog", {detail:"full"}) aggregates tier-1 + dynamic capabilities, scope-filtered', async () => {
    cellTools = [
      { name: 'x__echo', address: '@alice/tools-demo', description: 'Echo.', inputSchema: { type: 'object' }, scope: null, kind: 'act', cellId: 'tools-demo-1', tool: 'echo' },
    ];
    const cat = await callTool('creator', 'read', { target: '$catalog', input: { detail: 'full' } });
    const targets = ((cat.parsed as { capabilities: Array<{ target: string }> }).capabilities).map((c) => c.target).sort();
    expect(targets).toEqual(['@alice/tools-demo.echo', 'cells.create', 'cells.list', 'workspace.recall', 'workspace.remember']);

    // bob lacks platform:cells:create, so forge.createCell is filtered out.
    const bobCat = await callTool('plain', 'read', { target: '$catalog', input: { detail: 'full' } });
    const bobTargets = ((bobCat.parsed as { capabilities: Array<{ target: string }> }).capabilities).map((c) => c.target);
    expect(bobTargets).not.toContain('cells.create');
    expect(bobTargets).toContain('workspace.recall');
  });

  it('read("$catalog") defaults to the grouped summary; omitting target does too (ADR-0033)', async () => {
    const cat = await callTool('creator', 'read', { target: '$catalog' });
    expect((cat.parsed as { cells: unknown[] }).cells.length).toBeGreaterThan(0);
    expect((cat.parsed as { capabilities?: unknown }).capabilities).toBeUndefined(); // not the heavy form by default
    const bare = await callTool('creator', 'read', {});
    expect((bare.parsed as { cells: unknown[] }).cells.length).toBeGreaterThan(0);
  });

  it('read("$catalog", {resolve}) returns ONE capability; unknown targets and options fail loudly (W3d/W3f)', async () => {
    // The narrow read between the skim (grouped menu) and the dump (detail:"full").
    const one = await callTool('creator', 'read', { target: '$catalog', input: { resolve: 'workspace.recall' } });
    const cap = (one.parsed as { capability: { target: string; inputSchema?: unknown } }).capability;
    expect(cap.target).toBe('workspace.recall');
    expect(cap.inputSchema).toBeDefined(); // the full contract, not a summary line
    // A failed narrow read ERRORS — it must never silently widen to the whole menu.
    const missing = await callTool('creator', 'read', { target: '$catalog', input: { resolve: 'workspace.nope' } });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/unknown target/i);
    // An option the catalog doesn't understand is rejected with the valid ones named.
    const junk = await callTool('creator', 'read', { target: '$catalog', input: { fetch: 'workspace.recall' } });
    expect(junk.isError).toBe(true);
    expect(junk.text).toMatch(/does not understand/);
    expect(junk.text).toMatch(/resolve/);
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
      const cat = await callTool('creator', 'read', { target: '$catalog', input: { detail: 'full' } });
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

  it('initialize declares the MCP-Apps ui extension (nested) + resources (ADR-0034)', async () => {
    const init = await mcp('creator', 'initialize', { protocolVersion: '2025-06-18' });
    const caps = (init.result as { capabilities: Record<string, { mimeTypes?: string[] } & Record<string, unknown>> }).capabilities;
    expect(caps.tools).toBeDefined();
    expect(caps.resources).toBeDefined();
    // Spec 2026-01-26: nested under capabilities.extensions with mimeTypes.
    const ext = (caps.extensions as Record<string, { mimeTypes?: string[] }>)['io.modelcontextprotocol/ui'];
    expect(ext?.mimeTypes).toContain('text/html;profile=mcp-app');
  });

  it('tools advertise the MCP-Apps widget on the tool definition (_meta.ui), and results carry structuredContent (ADR-0034 Inc 0/1)', async () => {
    // The tool→UI binding is STATIC on the tool def (host preloads it) — not on the result.
    const list = await mcp('creator', 'tools/list');
    const tools = list.result!.tools as Array<{ name: string; _meta?: { ui?: { resourceUri: string; visibility?: string[] } } }>;
    const whoami = tools.find((t) => t.name === 'whoami')!;
    expect(whoami._meta?.ui?.resourceUri).toBe('ui://parc/card');
    expect(whoami._meta?.ui?.visibility).toContain('app');
    expect(tools.find((t) => t.name === 'read')!._meta?.ui?.resourceUri).toBe('ui://parc/card');
    // ADR-0039 Inc 2: act is widget-bound too, so an act result's renderer (the
    // `_render` stamp) actually has a shell to render in.
    expect(tools.find((t) => t.name === 'act')!._meta?.ui?.resourceUri).toBe('ui://parc/card');

    // Inc 0: an object result is mirrored as structuredContent (the widget's data channel)…
    const res = await mcp('creator', 'tools/call', { name: 'read', arguments: { target: '$catalog' } });
    const result = res.result as { structuredContent?: { cells?: unknown[] }; _meta?: unknown; content: Array<{ text: string }> };
    expect(result.structuredContent?.cells).toBeDefined();
    // …the text channel still carries it for the model; the result no longer carries the ui binding.
    expect(result.content[0].text).toContain('cells');
    expect(result._meta).toBeUndefined();
  });

  it('resources/list + resources/read serve the ui:// widget (ADR-0034 Inc 1)', async () => {
    const list = await mcp('creator', 'resources/list');
    const resources = (list.result as { resources: Array<{ uri: string; mimeType: string }> }).resources;
    expect(resources.some((r) => r.uri === 'ui://parc/card')).toBe(true);

    const read = await mcp('creator', 'resources/read', { uri: 'ui://parc/card' });
    const contents = (read.result as { contents: Array<{ uri: string; mimeType: string; text: string }> }).contents;
    expect(contents[0].uri).toBe('ui://parc/card');
    expect(contents[0].mimeType).toContain('text/html');
    expect(contents[0].text).toContain('<!doctype html>');
    // Unmistakably-ours marker (renders immediately) + the required init handshake.
    expect(contents[0].text).toContain('parc.land');
    expect(contents[0].text).toContain('ui/initialize');
    expect(contents[0].text).toContain('ui/notifications/initialized');

    const missing = await mcp('creator', 'resources/read', { uri: 'ui://parc/nope' });
    expect(missing.error?.code).toBe(-32602);
  });

  it('resources/read federates a cell-authored renderer (ui://@owner/name/<path>) via cells.call (ADR-0039)', async () => {
    const read = await mcp('creator', 'resources/read', {
      uri: 'ui://@c15r/machine/renderers/machine-run.js',
    });
    const contents = (read.result as { contents: Array<{ uri: string; mimeType: string; text: string }> }).contents;
    expect(contents[0].uri).toBe('ui://@c15r/machine/renderers/machine-run.js');
    expect(contents[0].mimeType).toContain('javascript');
    expect(contents[0].text).toContain("__parcRender['machine-run']");
    // The gateway resolved it by fetching the OWNING cell's served asset (GET) —
    // the provider hop, not a platform-bundled renderer.
    expect(lastCall).toEqual({
      fn: 'cells',
      command: 'call',
      payload: { owner: 'c15r', name: 'machine', method: 'GET', path: '/renderers/machine-run.js' },
    });
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
    expect(who.parsed).toEqual({ user: 'carol', scopes: [], grant: ['platform:cells:create'], actor: 'human' });
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

  it('stamps a cell tool\'s declared renderer onto its result as _render (ADR-0039 Inc 2)', async () => {
    cellTools = [
      {
        name: 'machine-1__define_machine', address: '@c15r/machine', description: 'Define.', inputSchema: { type: 'object' },
        scope: null, kind: 'act', cellId: 'machine-1', tool: 'define_machine',
        ui: { renderer: 'ui://@c15r/machine/renderers/define-plan.js', as: 'machine.define_machine' },
      },
    ];
    const res = await callTool('creator', 'act', { target: '@c15r/machine.define_machine', input: { name: 'm', dryRun: true } });
    expect(res.isError).toBeUndefined();
    const out = res.parsed as { echoed?: unknown; _render?: { renderer: string; as: string } };
    // The gateway forwarded the call AND stamped the tool's renderer directive.
    expect(out._render).toEqual({ renderer: 'ui://@c15r/machine/renderers/define-plan.js', as: 'machine.define_machine' });
    expect(out.echoed).toEqual({ owner: 'c15r', name: 'machine', tool: 'define_machine', args: { name: 'm', dryRun: true } });

    // A tool WITHOUT a ui declaration gets no _render (no accidental stamping).
    cellTools = [
      { name: 'tools-demo-1__echo', address: '@alice/tools-demo', description: 'Echo.', inputSchema: { type: 'object' }, scope: null, kind: 'act', cellId: 'tools-demo-1', tool: 'echo' },
    ];
    const plain = await callTool('creator', 'act', { target: '@alice/tools-demo.echo', input: { x: 1 } });
    expect((plain.parsed as { _render?: unknown })._render).toBeUndefined();
  });

  it('surfaces a cell tool\'s declared argument form on the $catalog entry, but not its renderer (ADR-0041 Inc 3)', async () => {
    cellTools = [
      {
        name: 'machine-1__define_machine', address: '@c15r/machine', description: 'Define.', inputSchema: { type: 'object' },
        scope: null, kind: 'act', cellId: 'machine-1', tool: 'define_machine',
        ui: { renderer: 'ui://@c15r/machine/renderers/define-plan.js', as: 'machine.define_machine', form: 'ui://@c15r/machine/forms/define_machine.js' },
      },
      { name: 'tools-demo-1__echo', address: '@alice/tools-demo', description: 'Echo.', inputSchema: { type: 'object' }, scope: null, kind: 'act', cellId: 'tools-demo-1', tool: 'echo' },
    ];
    const cat = await callTool('creator', 'read', { target: '$catalog', input: { detail: 'full' } });
    const caps = (cat.parsed as { capabilities: Array<{ target: string; ui?: { form?: string; renderer?: string } }> }).capabilities;
    const def = caps.find((c) => c.target === '@c15r/machine.define_machine');
    expect(def?.ui).toEqual({ form: 'ui://@c15r/machine/forms/define_machine.js' });
    // The output renderer is post-invocation (_render on the result); the catalog
    // (a pre-invocation surface) carries only what a caller needs to decide HOW to
    // call — the form, not the renderer.
    expect(def?.ui?.renderer).toBeUndefined();
    const echo = caps.find((c) => c.target === '@alice/tools-demo.echo');
    expect(echo?.ui).toBeUndefined();
  });

  it('unknown target is a tool error, not a transport error', async () => {
    const res = await callTool('creator', 'act', { target: 'workspace.nope' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/unknown capability/i);
  });

  it('whoami echoes the ambient frame: live participants from _presence leases (ADR-0086 Inc 2)', async () => {
    presenceEntries = [
      {
        key: '_presence/steward/weave',
        value: { participant: 'steward/weave', actor: 'agent', lastTarget: '@c15r/machine.step' },
        _meta: { updatedAt: '2026-07-16T15:00:00Z', timer: { expiresAt: '2026-07-16T15:15:00Z' } },
      },
    ];
    const res = await callTool('creator', 'whoami', {});
    const parsed = res.parsed as { participants?: Array<Record<string, unknown>> };
    expect(parsed.participants).toHaveLength(1);
    expect(parsed.participants![0]).toEqual({
      participant: 'steward/weave',
      actor: 'agent',
      lastTarget: '@c15r/machine.step',
      lastSeen: '2026-07-16T15:00:00Z',
      until: '2026-07-16T15:15:00Z',
    });
    // Alone → the field is absent, not an empty roster (the frame stays thin).
    presenceEntries = [];
    const alone = await callTool('creator', 'whoami', {});
    expect((alone.parsed as { participants?: unknown }).participants).toBeUndefined();
  });

  it('act with `as` threads the participant key into the downstream envelope; invalid keys error loudly (ADR-0086)', async () => {
    const ok = await callTool('creator', 'act', { target: 'workspace.remember', input: { key: 'k', value: 1 }, as: 'probe/IP-1' });
    expect(ok.isError).toBeFalsy();
    expect(lastCall?.participant).toBe('probe/IP-1'); // rode the envelope beside actor/posture
    // Without `as`, nothing rides — the stamp is per-dispatch, never sticky.
    await callTool('creator', 'act', { target: 'workspace.remember', input: { key: 'k2', value: 2 } });
    expect(lastCall?.participant).toBeUndefined();
    // Malformed keys error LOUDLY (membrane principle W3f) instead of being dropped.
    const bad = await callTool('creator', 'act', { target: 'workspace.remember', input: { key: 'k3', value: 3 }, as: 'has spaces!' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/Invalid participant key/);
    // FALLBACK SLOT (wave 3, W3g): a stale-schema connection can't express the
    // top-level `as`, so `input.as` is honored too — and ALWAYS stripped from
    // the forwarded capability args (the key is membrane metadata).
    const nested = await callTool('creator', 'act', { target: 'workspace.remember', input: { key: 'k4', value: 4, as: 'probe/nested' } });
    expect(nested.isError).toBeFalsy();
    expect(lastCall?.participant).toBe('probe/nested'); // threaded from the fallback slot
    expect((lastCall?.payload as Record<string, unknown>).as).toBeUndefined(); // stripped before forward
    // Malformed nested keys error just as loudly.
    const nestedBad = await callTool('creator', 'act', { target: 'workspace.remember', input: { key: 'k5', value: 5, as: 'nope nope!' } });
    expect(nestedBad.isError).toBe(true);
    expect(nestedBad.text).toMatch(/Invalid participant key/);
  });

  it('whoami returns the identity (built-in tool)', async () => {
    const res = await callTool('creator', 'whoami', {});
    // `grant` is surfaced only when it DIFFERS from scopes (a narrowed session);
    // here they're identical, so it's omitted rather than echoed.
    expect(res.parsed).toEqual({ user: 'alice', scopes: ['platform:cells:create'], actor: 'human' });
  });

  it('resolves identity from x-forwarded-authorization (edge preserves bearer past OAC)', async () => {
    const res = (await gateway(
      httpEvent('POST', '/mcp', {
        headers: { 'x-forwarded-authorization': 'Bearer creator' },
        body: rpc('tools/call', { name: 'whoami', arguments: {} }),
      }),
    )) as FunctionUrlResponse;
    const content = (JSON.parse(res.body).result.content as Array<{ text: string }>)[0];
    expect(JSON.parse(content.text)).toEqual({ user: 'alice', scopes: ['platform:cells:create'], actor: 'human' });
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
