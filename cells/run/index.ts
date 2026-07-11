/**
 * @c15r/run — the code executor (transformers, code kind).
 *
 * Server-side JavaScript with SUBSTRATE-NATIVE access: code runs in this
 * cell's Lambda with a `parc` binding — read/query the owner's slice
 * (the cell's IAM-scoped substrate read) and emit facts (the organ path,
 * source-pinned → machine-attested provenance). Outputs are facts by
 * construction: parc.emit writes them, linked produces by the caller.
 *
 * v0 is JavaScript (the Lambda runtime); polyglot (python/etc) is a
 * container-image provisioning path, deferred. Long runs use the async
 * submit → self-invoke → fetch pattern (the edge caps sync at ~30s).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';
// Materialized at push from cells/kernel/static/ (cell-sync vendor overlay, ADR-0076).
// eslint-disable-next-line import/no-unresolved
import { gwCall } from './vendor/gateway-client.js';
// eslint-disable-next-line import/no-unresolved
import { cellJobs } from './vendor/cell-jobs.js';

// removeUndefinedValues: a job result legitimately carries undefined fields
// (`error` on success, `result` on failure) — without this, saving a
// *successful* async run throws and the job reports the marshaller's error.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const events = new EventBridgeClient({});
const lambda = new LambdaClient({});

const TABLE = process.env.TABLE_NAME ?? '';
const SUBSTRATE = process.env.SUBSTRATE_TABLE ?? '';
const BUS = process.env.EVENT_BUS_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const SELF_SOURCE = process.env.SERVICE_NAME ?? ''; // = cell-run-<hash>, the IAM-pinned source
const GATEWAY_MCP = process.env.GATEWAY_MCP_URL ?? 'https://parc.land/mcp';
let SELF_FUNCTION = '';

/* ── gateway tool proxy (ADR-0028) — the vendored kernel-SDK client ────────
 * The direct parc.read/query/emit bindings touch only the owner's slice via the
 * cell's ambient IAM. `parc.call` instead proxies to the /mcp gateway as a SCOPED
 * principal (a per-run token), so code reaches the FULL read/act surface under
 * the gateway PEP. The choreography lives in @c15r/kernel/gateway-client
 * (ADR-0076 — this cell was copy #1 of three); `parc.call`'s contract stays
 * `{error}` objects (user code inspects results, it doesn't catch). */
async function callGatewayTool(token: string, target: string, input?: unknown): Promise<unknown> {
  try {
    return await gwCall(token, target, input, { url: GATEWAY_MCP });
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/* ── the substrate binding handed to user code ──────────────────── */

function makeParc(emitted: Array<{ key: string; value: unknown }>, token?: string) {
  return {
    /** Read one fact from the owner's slice (live value). */
    async read(key: string): Promise<unknown> {
      if (!SUBSTRATE) throw new Error('substrate unavailable');
      const res = await ddb.send(new GetCommand({ TableName: SUBSTRATE, Key: { pk: `STATE#${OWNER}`, sk: `KEY#${key}` } }));
      const item = res.Item as { value?: unknown; superseded?: boolean } | undefined;
      return item && !item.superseded ? item.value : null;
    },
    /**
     * Query the owner's slice by key prefix (bounded). Returns the same
     * `{ entries, count }` envelope as workspace.query, so code moved between
     * the repl and the gateway does not re-learn the shape.
     */
    async query(opts: { prefix?: string; limit?: number } = {}): Promise<{ entries: Array<{ key: string; value: unknown }>; count: number }> {
      if (!SUBSTRATE) throw new Error('substrate unavailable');
      const res = await ddb.send(new QueryCommand({
        TableName: SUBSTRATE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':sk': `KEY#${opts.prefix ?? ''}` },
        Limit: Math.min(opts.limit ?? 50, 200),
      }));
      const entries = (res.Items ?? [])
        .filter((i) => !i.superseded)
        .map((i) => ({ key: String(i.sk).slice('KEY#'.length), value: i.value }));
      return { entries, count: entries.length };
    },
    /** Emit a fact to the owner's slice (organ path — provenance attested). */
    async emit(key: string, value: unknown, opts: { type?: string; tags?: string[] } = {}): Promise<void> {
      if (!BUS) throw new Error('event bus unavailable');
      await events.send(new PutEventsCommand({
        Entries: [{
          EventBusName: BUS,
          Source: SELF_SOURCE,
          DetailType: 'substrate.write.requested',
          Detail: JSON.stringify({ key, value, via: 'run', type: opts.type, tags: opts.tags }),
        }],
      }));
      emitted.push({ key, value });
    },
    /**
     * Call ANY MCP capability through the gateway as the run's scoped principal
     * (ADR-0028) — `read` and `act` are auto-routed by the target verb. Needs a
     * per-run `token` passed to exec; without one this throws (the direct
     * read/query/emit above stay available for the owner-slice fast path). The
     * token's scope is the ceiling — a machine work-code rail mints it narrowed.
     */
    async call(target: string, input?: unknown): Promise<unknown> {
      if (!token) throw new Error('parc.call needs a scoped token — pass `token` to exec (the full /mcp surface is gated by it)');
      if (typeof target !== 'string' || !target) throw new Error('parc.call(target, input): target is required');
      return callGatewayTool(token, target, input);
    },
  };
}

/* ── execution ──────────────────────────────────────────────────── */

interface ExecInput {
  code: string;
  lang?: string;
  /** Inputs available to the code as `input`. */
  input?: unknown;
  async?: boolean;
  /** Per-run scoped bearer (ADR-0028): enables `parc.call` over the /mcp gateway.
   *  Omitted = only the direct owner-slice read/query/emit are available. */
  token?: string;
}

async function execJs(input: ExecInput): Promise<unknown> {
  const logs: string[] = [];
  const emitted: Array<{ key: string; value: unknown }> = [];
  const sandboxConsole = {
    log: (...a: unknown[]) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    error: (...a: unknown[]) => logs.push('ERROR: ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    warn: (...a: unknown[]) => logs.push('WARN: ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
  };
  const parc = makeParc(emitted, input.token);
  // The code is an async function body; `return` yields the result.
  const fn = new Function('parc', 'input', 'console', 'fetch', `return (async () => { ${input.code}\n })()`);
  let result: unknown;
  let error: string | undefined;
  try {
    result = await fn(parc, input.input, sandboxConsole, fetch);
  } catch (err) {
    error = (err as Error).stack ?? (err as Error).message;
  }
  return { result, logs, emitted: emitted.map((e) => e.key), error };
}

async function exec(input: ExecInput): Promise<unknown> {
  const lang = (input.lang ?? 'js').toLowerCase();
  if (lang === 'js' || lang === 'javascript' || lang === 'ts' || lang === 'typescript') {
    return execJs(input);
  }
  // Polyglot (python, etc.) needs a multi-runtime container image — a known
  // next increment, not a silent failure.
  throw new Error(`lang "${lang}" not yet supported server-side (only js/ts; polyglot needs a container runtime — see docs)`);
}

/* ── async jobs — the vendored kernel-SDK choreography (ADR-0076) ─────────
 * The JOB# row shape, TTL, and {__job} self-invoke protocol live in
 * @c15r/kernel/cell-jobs; this cell provides three thin ops over its own
 * clients. SELF_FUNCTION is read at call time (set per invocation below). */
const jobs = cellJobs({
  put: async (item) => {
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  },
  get: async (key) =>
    (await ddb.send(new GetCommand({ TableName: TABLE, Key: key }))).Item as Record<string, unknown> | undefined,
  invokeSelf: async (payload) => {
    await lambda.send(new InvokeCommand({ FunctionName: SELF_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
  },
});
const putJob = jobs.putJob;

/**
 * Dual-write a lean `run-job` observability fact (ADR-0026 Inc B) via the organ
 * path, alongside the authoritative `JOB#` row above. This makes a run queryable,
 * linkable, and salient (`query type=run-job`) WITHOUT moving the async-poll source
 * of truth onto the eventually-consistent organ path — `fetch` still reads `JOB#`
 * (strongly consistent). The fact is a projection: status + shape, never the full
 * (possibly large/arbitrary) result. Best-effort — never fails the run.
 */
async function emitJobFact(jobId: string, value: Record<string, unknown>): Promise<void> {
  if (!BUS) return;
  try {
    await events.send(new PutEventsCommand({
      Entries: [{
        EventBusName: BUS,
        Source: SELF_SOURCE,
        DetailType: 'substrate.write.requested',
        Detail: JSON.stringify({ key: `run-job/${jobId}`, value: { jobId, ...value }, via: 'run', type: 'run-job', tags: ['run', 'run-job'] }),
      }],
    }));
  } catch { /* observability only — a dropped projection must not fail the job */ }
}

async function runJob(jobId: string): Promise<void> {
  const job = await jobs.getJob(jobId);
  const input = (job as { input?: ExecInput } | undefined)?.input;
  if (!input) return;
  let out: { result?: unknown; logs?: string[]; emitted?: string[]; error?: string };
  try {
    out = (await exec(input)) as typeof out;
  } catch (err) {
    await putJob(jobId, { status: 'error', input, error: (err as Error).message });
    await emitJobFact(jobId, { status: 'error', at: new Date().toISOString(), error: (err as Error).message });
    return;
  }
  try {
    await putJob(jobId, { status: 'done', input, out });
    await emitJobFact(jobId, { status: 'done', at: new Date().toISOString(), emitted: out.emitted ?? [], logs: out.logs?.length ?? 0, error: out.error });
  } catch (err) {
    // A save failure must not impersonate the user's code: the marshaller's
    // advice ("Pass options.removeUndefinedValues…") is meaningless to someone
    // who wrote Fibonacci. Name the failing stage instead.
    await putJob(jobId, { status: 'error', input, error: `failed to persist result: ${(err as Error).message}` });
    await emitJobFact(jobId, { status: 'error', at: new Date().toISOString(), error: `failed to persist result: ${(err as Error).message}` });
  }
}

/* ── tools ──────────────────────────────────────────────────────── */

const TOOLS = [
  {
    name: 'exec',
    description:
      'Run code server-side with substrate-native access. The code is a JS async function body; `return` yields the result. Bindings: parc.read(key) / parc.query({prefix,limit}) → {entries:[{key,value}],count} (same envelope as workspace.query) / parc.emit(key,value,{type,tags}) (organ-path write to your slice) / parc.call(target,input) (ADR-0028: call ANY /mcp capability — workspace.*, @owner/cell.tool, whoami — as the run\'s scoped principal; requires `token`), console (captured), input, fetch. Returns {result, logs, emitted, error}. async:true for long runs → {jobId}, poll fetch. v0 is js/ts.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        lang: { type: 'string', description: 'js | ts (more via container runtime — deferred)' },
        input: { description: 'Any JSON value, available as `input`' },
        async: { type: 'boolean' },
        token: { type: 'string', description: 'Per-run scoped bearer — enables parc.call over the /mcp gateway (the full read/act surface, bounded by this token\'s scope). Omit for owner-slice read/query/emit only.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    description: 'Poll an async exec: {status: pending|done|error, out?, error?}.',
    kind: 'read',
    inputSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'], additionalProperties: false },
  },
];

async function toolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'fetch') {
    const jobId = String(args.jobId ?? '');
    const item = (await jobs.getJob(jobId)) as { status?: string; out?: unknown; error?: string } | undefined;
    if (!item) throw new Error(`unknown job "${jobId}"`);
    return { status: item.status, out: item.out, error: item.error };
  }
  if (name === 'exec') {
    const input = args as unknown as ExecInput;
    if (typeof input.code !== 'string' || !input.code.trim()) throw new Error('code is required');
    if (input.async) {
      if (!SELF_FUNCTION) throw new Error('async unavailable: function name unknown');
      const jobId = randomUUID().slice(0, 13);
      const { async: _a, ...rest } = input;
      await emitJobFact(jobId, { status: 'pending', at: new Date().toISOString(), lang: (rest.lang ?? 'js'), codeBytes: rest.code.length });
      await jobs.submit(jobId, { input: rest });
      return { jobId, status: 'pending' };
    }
    return exec(input);
  }
  throw new Error(`unknown tool "${name}"`);
}

/* ── http ───────────────────────────────────────────────────────── */

const json = (code: number, v: unknown) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });

export const handler = async (
  event: { rawPath?: string; requestContext?: { http?: { method?: string } }; body?: string; __job?: string },
  context?: { functionName?: string },
) => {
  SELF_FUNCTION = context?.functionName ?? SELF_FUNCTION;
  if (event.__job) {
    await runJob(event.__job);
    return { statusCode: 200, body: 'ok' };
  }
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'POST' && path.startsWith('/_tools/')) {
    const name = path.slice('/_tools/'.length);
    let args: Record<string, unknown> = {};
    try { args = event.body ? JSON.parse(event.body) : {}; } catch { return json(400, { error: 'invalid JSON body' }); }
    try { return json(200, await toolCall(name, args)); } catch (err) { return json(400, { error: (err as Error).message }); }
  }
  return json(200, { cell: '@c15r/run', note: 'the code executor — exec/fetch tools; substrate-native via parc' });
};
