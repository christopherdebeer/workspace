/**
 * ADR-0076 (C5) — the vendored kernel-SDK modules, behaviour-preservation gate.
 *
 * gateway-client: the /mcp JSON-RPC choreography the three cells hand-copied —
 * envelope shape, error unwrap (incl. the isError check models had dropped),
 * the verb FLOOR + wrong-verb self-heal (open vocabulary: the gateway's own
 * error names the right verb), and bounded-concurrency callMany.
 *
 * cell-jobs: the JOB# row protocol — putJob/getJob shape, submit's
 * pending + {__job} self-invoke, and chunking round-trip. SDK-free by
 * construction (injected ops), exactly like substrate.js (ADR-0017).
 */
import { gwCall, gwCallMany, toolVerb, GatewayError, READ_VERB_FLOOR } from '../cells/kernel/static/gateway-client.js';
import { cellJobs, JOB_CHUNK } from '../cells/kernel/static/cell-jobs.js';

type FetchCall = { verb: string; target: string; input: unknown; auth: string };

/** Backoff is real time; a test asserting on retry counts should not pay it. */
const NO_SLEEP = async (): Promise<void> => {};

/** A stub gateway: scripted responses keyed by call order. */
function stubGateway(script: Array<(call: FetchCall) => { status?: number; error?: string; isError?: boolean; text?: string }>) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (_url: unknown, init: { body?: string; headers?: Record<string, string> }) => {
    const body = JSON.parse(init.body ?? '{}') as { params: { name: string; arguments: { target: string; input?: unknown } } };
    const call: FetchCall = {
      verb: body.params.name,
      target: body.params.arguments.target,
      input: body.params.arguments.input,
      auth: init.headers?.authorization ?? '',
    };
    calls.push(call);
    const step = script[Math.min(calls.length - 1, script.length - 1)](call);
    if (step.status && step.status !== 200) return { ok: false, status: step.status, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () =>
        step.error
          ? { result: { isError: true, content: [{ text: step.error }] } }
          : { result: { isError: step.isError ?? false, content: [{ text: step.text ?? '{}' }] } },
    };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('ADR-0076 — gateway-client', () => {
  it('classifies by the floor and carries the token + envelope', async () => {
    expect(toolVerb('workspace.query')).toBe('read');
    expect(toolVerb('workspace.remember')).toBe('act');
    expect(toolVerb('@c15r/consolidate.latest')).toBe('read');
    expect(READ_VERB_FLOOR.has('read')).toBe(true); // C2's composed read — the drift the copies had

    const gw = stubGateway([() => ({ text: JSON.stringify({ entries: [] }) })]);
    const out = await gwCall('tok_x', 'workspace.query', { type: 'note' }, { fetchImpl: gw.fetchImpl, url: 'http://gw' });
    expect(out).toEqual({ entries: [] });
    expect(gw.calls[0]).toMatchObject({ verb: 'read', target: 'workspace.query', input: { type: 'note' }, auth: 'Bearer tok_x' });
  });

  it('throws GatewayError on tool isError (the check models had dropped) and on HTTP failure', async () => {
    const gw = stubGateway([() => ({ error: 'Missing required scope: write:workspace' })]);
    await expect(gwCall('t', 'workspace.remember', { key: 'x' }, { fetchImpl: gw.fetchImpl, url: 'u' })).rejects.toThrow(
      GatewayError,
    );
    const http = stubGateway([() => ({ status: 502 })]);
    // 502 is transient — retried with backoff, so inject a no-op sleep (see gateway-client).
    await expect(gwCall('t', 'workspace.peek', { key: 'x' }, { fetchImpl: http.fetchImpl, url: 'u', sleepImpl: NO_SLEEP })).rejects.toThrow(
      /gateway HTTP 502/,
    );
  });

  it('self-heals a floor misclassification from the gateway wrong-verb error (both directions)', async () => {
    // An unknown verb classifies as act; the gateway says it is read-only → retried as read.
    const gw = stubGateway([
      () => ({ error: '"workspace.novelread" is read-only — invoke it with read, not act.' }),
      () => ({ text: '{"ok":true}' }),
    ]);
    const out = await gwCall('t', 'workspace.novelread', undefined, { fetchImpl: gw.fetchImpl, url: 'u' });
    expect(out).toEqual({ ok: true });
    expect(gw.calls.map((c) => c.verb)).toEqual(['act', 'read']);

    // A floor verb used by an act-kind tool heals the other way.
    const gw2 = stubGateway([
      () => ({ error: '"@x/y.get" may mutate — invoke it with act, not read.' }),
      () => ({ text: '"done"' }),
    ]);
    expect(await gwCall('t', '@x/y.get', { a: 1 }, { fetchImpl: gw2.fetchImpl, url: 'u' })).toBe('done');
    expect(gw2.calls.map((c) => c.verb)).toEqual(['read', 'act']);

    // Explicit kind skips both classification and healing.
    const gw3 = stubGateway([() => ({ error: '"z" is read-only — invoke it with read, not act.' })]);
    await expect(gwCall('t', 'z', undefined, { fetchImpl: gw3.fetchImpl, url: 'u', kind: 'act' })).rejects.toThrow(GatewayError);
    expect(gw3.calls).toHaveLength(1);
  });

  it('callMany keeps order, bounds concurrency, and isolates failures as {error} slots', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async (_u: unknown, init: { body?: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const body = JSON.parse(init.body ?? '{}') as { params: { arguments: { target: string } } };
      const t = body.params.arguments.target;
      return {
        ok: true,
        status: 200,
        json: async () =>
          t === 'bad.one'
            ? { result: { isError: true, content: [{ text: 'boom' }] } }
            : { result: { content: [{ text: JSON.stringify({ t }) }] } },
      };
    }) as unknown as typeof fetch;
    const calls = ['a.read', 'bad.one', 'c.read', 'd.read', 'e.read', 'f.read'].map((target) => ({ target, kind: 'read' as const }));
    const out = await gwCallMany('t', calls, { fetchImpl, url: 'u', concurrency: 2 });
    expect(out[0]).toEqual({ t: 'a.read' });
    expect(out[1]).toEqual({ error: 'boom' });
    expect(out[5]).toEqual({ t: 'f.read' });
    expect(peak).toBeLessThanOrEqual(2);
  });

  // A cell driving a MULTI-STEP CHAIN through the substrate cannot treat "busy"
  // as "failed": the tool returns an error, the reaction reactor dead-letters
  // it, the continuation baton lapses, and nothing above retries — the chain is
  // stranded permanently. Measured 2026-07-29: one DynamoDB throttling window
  // froze dozens of decompositions mid-flight (docs/architecture at 20/207,
  // docs/machine at 0/65), each recoverable only by editing its source file.
  describe('transient-fault retry', () => {
    it('rides out a DynamoDB throttle arriving as a 200 + isError, and returns the eventual value', async () => {
      const throttle = 'Throughput exceeds the current capacity of your table or index. DynamoDB is automatically scaling';
      const gw = stubGateway([
        () => ({ error: throttle }),
        () => ({ error: throttle }),
        () => ({ text: JSON.stringify({ ingested: 10 }) }),
      ]);
      expect(await gwCall('t', 'workspace.ingest', { facts: [] }, { fetchImpl: gw.fetchImpl, url: 'u', sleepImpl: NO_SLEEP })).toEqual({ ingested: 10 });
      expect(gw.calls).toHaveLength(3);
    });

    it('rides out a 5xx from the edge or gateway', async () => {
      const gw = stubGateway([() => ({ status: 504 }), () => ({ text: JSON.stringify({ ok: true }) })]);
      expect(await gwCall('t', 'workspace.query', { limit: 1 }, { fetchImpl: gw.fetchImpl, url: 'u', sleepImpl: NO_SLEEP })).toEqual({ ok: true });
      expect(gw.calls).toHaveLength(2);
    });

    it('never retries a 4xx or a validation error — a malformed call retried is still malformed', async () => {
      const gw = stubGateway([() => ({ error: 'Missing required scope: write:workspace' })]);
      await expect(gwCall('t', 'workspace.remember', { key: 'x' }, { fetchImpl: gw.fetchImpl, url: 'u' })).rejects.toThrow(GatewayError);
      expect(gw.calls).toHaveLength(1);

      const budget = stubGateway([() => ({ error: 'read("workspace.query") is too large to return whole (203KB over the 60KB read budget)' })]);
      await expect(gwCall('t', 'workspace.query', {}, { fetchImpl: budget.fetchImpl, url: 'u' })).rejects.toThrow(GatewayError);
      expect(budget.calls).toHaveLength(1);

      const client = stubGateway([() => ({ status: 400 })]);
      await expect(gwCall('t', 'workspace.remember', {}, { fetchImpl: client.fetchImpl, url: 'u' })).rejects.toThrow(GatewayError);
      expect(client.calls).toHaveLength(1);
    });

    it('gives up bounded, and surfaces the original fault verbatim', async () => {
      const gw = stubGateway([() => ({ status: 503 })]);
      await expect(gwCall('t', 'workspace.query', {}, { fetchImpl: gw.fetchImpl, url: 'u', sleepImpl: NO_SLEEP })).rejects.toThrow('gateway HTTP 503');
      // One initial attempt + a bounded number of retries — never unbounded.
      expect(gw.calls.length).toBeGreaterThan(1);
      expect(gw.calls.length).toBeLessThanOrEqual(6);
    });
  });
});

describe('ADR-0076 — cell-jobs', () => {
  function memOps() {
    const items = new Map<string, Record<string, unknown>>();
    const invocations: unknown[] = [];
    return {
      items,
      invocations,
      ops: {
        put: async (item: Record<string, unknown>) => {
          items.set(`${item.pk}|${item.sk}`, item);
        },
        get: async (key: { pk: string; sk: string }) => items.get(`${key.pk}|${key.sk}`),
        invokeSelf: async (payload: unknown) => {
          invocations.push(payload);
        },
      },
    };
  }

  it('putJob/getJob keep the JOB# row shape (pk/sk/ttl) the cells poll', async () => {
    const { ops, items } = memOps();
    const jobs = cellJobs(ops);
    await jobs.putJob('j1', { status: 'done', out: { n: 1 } });
    const row = items.get('JOB#j1|v1')!;
    expect(row).toMatchObject({ pk: 'JOB#j1', sk: 'v1', status: 'done', out: { n: 1 } });
    expect(typeof row.ttl).toBe('number');
    expect(await jobs.getJob('j1')).toBe(row);
  });

  it('submit writes pending and self-invokes the {__job} envelope', async () => {
    const { ops, items, invocations } = memOps();
    const jobs = cellJobs(ops);
    await jobs.submit('j2', { kind: 'agent', input: { prompt: 'x' } });
    expect(items.get('JOB#j2|v1')).toMatchObject({ status: 'pending', kind: 'agent' });
    expect(invocations).toEqual([{ __job: 'j2' }]);
  });

  it('chunks round-trip an oversized payload under the item cap', async () => {
    const { ops, items } = memOps();
    const jobs = cellJobs(ops);
    const big = 'x'.repeat(JOB_CHUNK + 1000);
    const count = await jobs.putChunks('j3', big);
    expect(count).toBe(2);
    expect((items.get('JOB#j3|c0')!.data as string).length).toBe(JOB_CHUNK);
    expect(await jobs.getChunks('j3', count)).toBe(big);
  });
});
