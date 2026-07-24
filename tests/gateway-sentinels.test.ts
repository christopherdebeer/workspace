/**
 * Self-model sentinels are BUDGETED — all of them (wave-7).
 *
 * `$catalog {detail:"full"}` grew an over-budget guard after SWARM-D/W6-A: fail
 * loud with the way to narrow, never a silent truncation, and measure the
 * DELIVERED (indent-2) bytes because the MCP layer serializes pretty-printed.
 * That guard lived inside the `$catalog` branch and was never generalized, so its
 * siblings inherited nothing — a live probe found `read("$graph")` returning
 * 208,915 delivered bytes with no bound and no advice.
 *
 * These tests pin the generalization: every sentinel carries the guard, and the
 * projection sentinel skims by default (ADR-0033) instead of dumping.
 */
import { handler as gateway } from '../services/gateway/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

/** Delivered bytes the gateway allows a self-model read to return. */
const FULL_BUDGET = 60_000;

let lastEdges: Record<string, unknown> | undefined;
/** Per-test payload the workspace `edges` stub returns. */
let edgesResult: unknown = { edges: [], total: 0 };
/** Per-test payload the cells `contracts` stub returns. */
let contractsResult: unknown = { cells: [] };

function stub(): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      const fn = params.FunctionName;
      let result: unknown = null;
      if (fn === 'auth-fn' && env.__command === 'validateToken') {
        result = { userId: 'alice', scope: 'workspace:admin', clientId: null };
      } else if (fn === 'workspace-fn') {
        if (env.__command === 'describeTools') result = { tools: [] };
        else if (env.__command === 'edges') {
          lastEdges = env.payload;
          result = edgesResult;
        } else if (env.__command === 'grants') result = { scope: {}, slice: {}, grant: {} };
        else result = { entries: [] };
      } else if (fn === 'cells-fn') {
        if (env.__command === 'describeTools') result = { tools: [] };
        else if (env.__command === 'describeTypes') result = { types: {} };
        else if (env.__command === 'contracts') result = contractsResult;
        else result = { tools: [] };
      }
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setLambda>[0]);
}

const httpEvent = (body: unknown): FunctionUrlEvent => ({
  rawPath: '/mcp',
  requestContext: { http: { method: 'POST', path: '/mcp' } },
  headers: { authorization: 'Bearer t' },
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

async function readTarget(target: string): Promise<{ isError?: boolean; text: string; parsed?: unknown }> {
  const res = (await gateway(
    httpEvent({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read', arguments: { target } } }),
  )) as FunctionUrlResponse;
  const body = JSON.parse(res.body) as { result: { isError?: boolean; content: Array<{ text: string }> } };
  const text = body.result.content[0].text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* an error string, not JSON */
  }
  return { isError: body.result.isError, text, parsed };
}

/** An edge list whose DELIVERED (indent-2) size exceeds the budget. */
function fatEdges(n: number): { edges: unknown[]; total: number } {
  const edges = Array.from({ length: n }, (_, i) => ({
    from: `doc-block:docs/architecture/adr/0087-branchable-substrate-states/${i}`,
    rel: 'similarTo',
    to: `doc-block:docs/ancestor/sync/the-substrate-thesis/${i}`,
    strength: 0.3,
    createdAt: '2026-07-22T16:29:51.401Z',
    writer: 'platform/vectors',
    derived: true,
  }));
  return { edges, total: n };
}

describe('self-model sentinels are budgeted', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'gateway';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', cells: 'cells-fn', workspace: 'workspace-fn' });
    process.env.PUBLIC_BASE_URL = 'https://parc.land';
    lastEdges = undefined;
    edgesResult = { edges: [], total: 0 };
    contractsResult = { cells: [] };
    stub();
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('$graph SKIMS by default — it never asks for the unbounded projection', async () => {
    await readTarget('$graph');
    // The live defect: `edges({})` with no limit returned the service default page
    // (1000 hydrated edges, ~200KB delivered) straight through the membrane.
    expect(lastEdges).toBeDefined();
    expect(typeof lastEdges!.limit).toBe('number');
    expect(lastEdges!.limit as number).toBeLessThanOrEqual(200);
  });

  it('$graph fails LOUD with the way to narrow when the page is still over budget', async () => {
    edgesResult = fatEdges(400);
    expect(JSON.stringify(edgesResult, null, 2).length).toBeGreaterThan(FULL_BUDGET);
    const res = await readTarget('$graph');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('too large');
    // The advice must name the finer-grained read, not just refuse (F7/W3f).
    expect(res.text).toContain('workspace.edges({ around:');
    expect(res.text).toMatch(/limit, cursor/);
  });

  it('an under-budget $graph passes through untouched', async () => {
    edgesResult = fatEdges(5);
    const res = await readTarget('$graph');
    expect(res.isError).toBeFalsy();
    expect((res.parsed as { total: number }).total).toBe(5);
  });

  it('$cells carries the same guard', async () => {
    contractsResult = { cells: fatEdges(400).edges };
    const res = await readTarget('$cells');
    expect(res.isError).toBe(true);
    expect(res.text).toContain('too large');
    expect(res.text).toContain('cells.contracts');
  });

  it('the guard reports the overage and the budget, so the caller can size the next read', async () => {
    edgesResult = fatEdges(400);
    const res = await readTarget('$graph');
    expect(res.text).toMatch(/\d+KB over the 60KB read budget/);
  });
});
