/**
 * Membrane teaching surfaces (wave-7) — the generalization of the W5-2 class.
 *
 * The retired-alias guard in `workspace.test.ts` asserts the old verbs are GONE
 * from the membrane. That is only half the invariant: a verb can be gone and
 * still be *taught*. Live probes found `workspace.recall`'s own `hints` — the
 * most-read teaching surface in the system, returned by every bare `recall()` —
 * instructing agents to call `search({ text })` and `neighbors({ key })`, both
 * retired since ADR-0069/0071. Following the hints produced `capability_retired`.
 *
 * The invariant here: NOTHING THE MEMBRANE SAYS MAY NAME A VERB THE MEMBRANE NO
 * LONGER ACCEPTS. Prose drifts; a derived list cannot.
 */
import { OVERVIEW_HINTS, liveHints } from '../services/workspace/commands-read';
import { TOOL_DESCRIPTORS } from '../services/workspace/descriptors';
import { handler as gateway } from '../services/gateway/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

const LIVE = new Set(TOOL_DESCRIPTORS.map((d) => d.name));

/** The gateway's tombstoned names (services/gateway/service.ts RETIRED). */
const RETIRED = [
  'search', 'neighbors', 'links', 'graph', 'members',
  'registerAction', 'invoke', 'registerView', 'view', 'registerSubscription',
];

describe('recall hints never teach a retired verb', () => {
  it('every hint names only verbs the workspace still declares', () => {
    for (const hint of OVERVIEW_HINTS) {
      for (const verb of hint.verbs) {
        // Fail LOUD in CI when a verb is retired without its hint being rewritten.
        // (In prod `liveHints()` drops the hint instead — a missing hint is safe,
        // a wrong one is not.)
        expect({ verb, hint: hint.text, live: LIVE.has(verb) }).toEqual({ verb, hint: hint.text, live: true });
      }
    }
  });

  it('no hint TEXT mentions a retired verb name in a call position', () => {
    for (const { text } of OVERVIEW_HINTS) {
      for (const dead of RETIRED) {
        // `dead(` or `dead({` — the shape a hint uses to teach a call. This is
        // what the live defect looked like: "search({ text })", "neighbors({ key })".
        expect(text).not.toMatch(new RegExp(`\\b${dead}\\s*\\(`));
      }
    }
  });

  it('the shipped hints are the live ones (nothing dropped today)', () => {
    expect(liveHints()).toHaveLength(OVERVIEW_HINTS.length);
  });

  it('drops a hint whose verb is not live, rather than shipping it', () => {
    const withDead = [
      { verbs: ['query'], text: 'live one' },
      { verbs: ['neighbors'], text: 'its links: neighbors({ key })' },
      { verbs: ['peek', 'neighbors'], text: 'partly dead' },
    ];
    expect(liveHints(undefined, withDead)).toEqual(['live one']);
  });

  it('teaches the ADR-0069/0071 successors', () => {
    const all = liveHints().join('\n');
    expect(all).toMatch(/query\(\{ text \}\)/); // was search({ text })
    expect(all).toMatch(/edges\(\{ around: key \}\)/); // was neighbors({ key })
  });
});

/**
 * A tool's ADVERTISEMENT must describe what its handler actually returns.
 *
 * `whoami` shipped the description "Return the authenticated principal and
 * granted scopes" for the entire life of ADR-0074 (which added `posture`) and
 * ADR-0086 (which added the ambient frame). Two accretions were invisible to any
 * caller that read the advertisement instead of the source — and live probes did
 * exactly that: 2/2 natural replicas opened with `whoami`, got what looked like
 * nothing, and paid a wasted call (wave-7 W7-2).
 *
 * The generic invariant: every key the handler can return is DECLARED in the
 * advertised outputSchema. Adding a field without advertising it fails here.
 */
function stubAuth(validated: Record<string, unknown>, presence: unknown[] = []): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      const fn = params.FunctionName;
      let result: unknown = null;
      if (fn === 'auth-fn' && env.__command === 'validateToken') result = validated;
      else if (fn === 'workspace-fn') {
        if (env.__command === 'describeTools') result = { tools: [] };
        else if (env.__command === 'query') result = { entries: presence };
        else result = { entries: [] };
      } else if (fn === 'cells-fn') result = { tools: [] };
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setLambda>[0]);
}

const ev = (body: unknown): FunctionUrlEvent => ({
  rawPath: '/mcp',
  requestContext: { http: { method: 'POST', path: '/mcp' } },
  headers: { authorization: 'Bearer t' },
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = (await gateway(ev({ jsonrpc: '2.0', id: 1, method, params }))) as FunctionUrlResponse;
  return (JSON.parse(res.body) as { result: Record<string, unknown> }).result;
}

describe('whoami advertises what it returns', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'gateway';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', cells: 'cells-fn', workspace: 'workspace-fn' });
    process.env.PUBLIC_BASE_URL = 'https://parc.land';
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('every key the handler returns is declared in the advertised outputSchema', async () => {
    // A maximal identity: narrowed session (grant ≠ scopes), agent actor,
    // adopted posture, and a live peer — so the handler emits every optional key.
    stubAuth(
      {
        userId: 'alice',
        // Ceiling vs narrowed focus, so `grant` is not a byte-identical echo.
        scope: 'read:workspace write:workspace',
        effectiveScope: 'read:workspace',
        clientId: 'cli',
        posture: { goal: 'goal/consolidation', adoptedAt: '2026-07-24T00:00:00Z' },
      },
      [{ key: '_presence/steward/weave', value: { participant: 'steward/weave', actor: 'agent', lastTarget: 'workspace.query' } }],
    );
    const list = (await rpc('tools/list')).tools as Array<{ name: string; outputSchema?: { properties?: Record<string, unknown> } }>;
    const declared = new Set(Object.keys(list.find((t) => t.name === 'whoami')!.outputSchema!.properties!));

    const called = await rpc('tools/call', { name: 'whoami', arguments: {} });
    const body = JSON.parse((called.content as Array<{ text: string }>)[0].text) as Record<string, unknown>;

    const undeclared = Object.keys(body).filter((k) => !declared.has(k));
    expect({ undeclared, returned: Object.keys(body).sort() }).toEqual({ undeclared: [], returned: Object.keys(body).sort() });
    // And the maximal identity really did exercise the accreted fields.
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['posture', 'participants', 'actor', 'grant']));
  });

  it('the description names the accretions, not just identity', async () => {
    stubAuth({ userId: 'alice', scope: 'read:workspace', clientId: null });
    const list = (await rpc('tools/list')).tools as Array<{ name: string; description: string }>;
    const d = list.find((t) => t.name === 'whoami')!.description.toLowerCase();
    expect(d).toContain('posture'); // ADR-0074
    expect(d).toMatch(/who else is here|ambient frame/); // ADR-0086
  });
});

describe('the server instructions teach ONE ordered opener', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'gateway';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', cells: 'cells-fn', workspace: 'workspace-fn' });
    process.env.PUBLIC_BASE_URL = 'https://parc.land';
    stubAuth({ userId: 'alice', scope: 'read:workspace', clientId: null });
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
    delete process.env.PUBLIC_BASE_URL;
  });

  it('names an explicit order and puts the intent-read before browsing', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const text = init.instructions as string;
    expect(text).toMatch(/ORIENT IN THIS ORDER/);
    // The measured asymmetry: intent-first beat catalog browsing 3-vs-8 calls
    // (wave-7) and 9-vs-12 (wave-5). The cheaper route must be named first.
    expect(text.indexOf('workspace.query')).toBeLessThan(text.indexOf('$catalog'));
    expect(text).toContain('whoami');
  });
});
