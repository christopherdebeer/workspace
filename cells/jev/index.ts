/**
 * @c15r/jev — TypeSafe AI's System One model (Jev) as MCP tools.
 *
 * Jev is a decision model, not an LLM: you give it a state (text/JSON) plus
 * typed questions; it returns calibrated answers (probabilities, choices,
 * scores) in one parallel pass. Never generates prose.
 *
 * Endpoint: POST https://api.typesafe.ai/v1/systemone
 * Pricing:  ~$0.042 / M input tokens; output free.
 * Latency:  typically 70–500 ms.
 *
 * Tools (surfaced as @c15r/jev.*):
 *   set_key        owner-only, write-only — store the TypeSafe API key
 *   status         whether a key is configured (never reveals the key)
 *   decide         full power: arbitrary state + questions map
 *   noul           single yes/no question → probability 0–1
 *   choice         single multi-option question → winner + distribution
 *   score          single rubric score → weighted position + distribution
 *   decide_many    one question set over many states, fanned out in parallel
 *                  (ADR-0098 Inc 0 — the System One organ's batch seam)
 *   usage          today's metered tokens/calls against the daily budget
 *
 * Web: GET / serves jev · lab (client/ + static/index.html) — an open library
 * of unusual experiments with Jev (free-text decoding, interface rendering…).
 * The page is public; every experiment runs through POST /_tools/decide under
 * the caller's own session, so only the owner or a granted caller spends.
 *
 * ADR-0098 Inc 0 hygiene: the default model is PINNED (jev-1.13.0) so a
 * caller's thresholds don't drift on an upstream alias move; Score criteria
 * given as a {level: description} object are normalised to the ordered array
 * the upstream API accepts (it 422s on the object form — ADR-0097), with the
 * descriptions folded into the instructions; every call is metered into the
 * cell's own table and refused past the daily token budget.
 *
 * Secrets live in this cell's own DynamoDB table (IAM-scoped). There is no
 * readback path for the key.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-1.13.0';
/** Daily input-token budget (ADR-0098 cost controls). ~$0.042/M → 20M ≈ $0.84/day. */
const DEFAULT_DAILY_BUDGET = 20_000_000;
const MANY_MAX = 200;
const MANY_CONCURRENCY = 12;

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const page = (statusCode: number, contentType: string, body: string) => ({
  statusCode,
  headers: { 'content-type': contentType, 'cache-control': 'no-cache' },
  body,
});

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strOpt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/* ── secret custody ──────────────────────────────────────────────── */

async function getKey(): Promise<string | null> {
  if (!TABLE) return null;
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: 'SECRET#typesafe', sk: 'v1' } }),
  );
  const item = res.Item as { apiKey?: string } | undefined;
  return item?.apiKey ?? null;
}

async function putKey(apiKey: string): Promise<void> {
  if (!TABLE) throw new Error('cell table unavailable');
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: 'SECRET#typesafe', sk: 'v1', apiKey, updatedAt: new Date().toISOString() },
    }),
  );
}

/* ── metering + budget (ADR-0098) ────────────────────────────────── */

const today = () => new Date().toISOString().slice(0, 10);

async function getBudget(): Promise<number> {
  if (!TABLE) return DEFAULT_DAILY_BUDGET;
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'CONFIG', sk: 'budget' } }));
  const n = (res.Item as { dailyTokens?: number } | undefined)?.dailyTokens;
  return typeof n === 'number' && n > 0 ? n : DEFAULT_DAILY_BUDGET;
}

async function getUsage(day = today()): Promise<{ day: string; inputTokens: number; calls: number }> {
  if (!TABLE) return { day, inputTokens: 0, calls: 0 };
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: 'USAGE', sk: day } }));
  const it = (res.Item ?? {}) as { inputTokens?: number; calls?: number };
  return { day, inputTokens: it.inputTokens ?? 0, calls: it.calls ?? 0 };
}

async function meter(inputTokens: number): Promise<void> {
  if (!TABLE) return;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: 'USAGE', sk: today() },
        UpdateExpression: 'ADD inputTokens :t, calls :one',
        ExpressionAttributeValues: { ':t': inputTokens, ':one': 1 },
      }),
    );
  } catch {
    /* metering is best-effort; never fail a judgment on it */
  }
}

let budgetCache: { at: number; ok: boolean } | null = null;
async function assertBudget(): Promise<void> {
  if (budgetCache && Date.now() - budgetCache.at < 10_000) {
    if (!budgetCache.ok) throw Object.assign(new Error('Jev daily token budget exhausted'), { statusCode: 429 });
    return;
  }
  const [u, b] = await Promise.all([getUsage(), getBudget()]);
  budgetCache = { at: Date.now(), ok: u.inputTokens < b };
  if (!budgetCache.ok) throw Object.assign(new Error(`Jev daily token budget exhausted (${u.inputTokens}/${b})`), { statusCode: 429 });
}

/* ── TypeSafe System One client ──────────────────────────────────── */

interface QuestionNoul {
  type: 'noul';
  instructions?: string;
  criteria?: Record<string, string | null>;
}
interface QuestionChoice {
  type: 'choice';
  instructions?: string;
  criteria?: Record<string, string | null>;
  options?: string[]; // accepted alias; normalised to criteria
}
interface QuestionScore {
  type: 'score';
  instructions?: string;
  criteria?: string[] | Record<string, string | null>;
}
type Question = QuestionNoul | QuestionChoice | QuestionScore;

interface SystemOneResponse {
  model: string;
  answers: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function normaliseQuestions(raw: Record<string, unknown>): Record<string, Question> {
  const out: Record<string, Question> = {};
  for (const [name, q] of Object.entries(raw)) {
    if (!q || typeof q !== 'object') continue;
    const qq = q as Record<string, unknown>;
    const type = str(qq.type);
    if (type === 'noul') {
      out[name] = {
        type: 'noul',
        instructions: strOpt(qq.instructions),
        criteria: (qq.criteria && typeof qq.criteria === 'object' ? qq.criteria : undefined) as
          | Record<string, string | null>
          | undefined,
      };
    } else if (type === 'choice') {
      let criteria = qq.criteria;
      if (!criteria && Array.isArray(qq.options)) {
        criteria = Object.fromEntries((qq.options as unknown[]).map((o) => [String(o), null]));
      }
      out[name] = {
        type: 'choice',
        instructions: strOpt(qq.instructions),
        criteria: (criteria && typeof criteria === 'object' ? criteria : undefined) as
          | Record<string, string | null>
          | undefined,
      };
    } else if (type === 'score') {
      out[name] = normaliseScore(strOpt(qq.instructions), qq.criteria);
    }
  }
  return out;
}

/** Upstream Score accepts only an ORDERED ARRAY of level labels (the object
 *  form 422s — ADR-0097). An object keeps its insertion order as the scale and
 *  its descriptions move into the instructions so no meaning is lost. */
export function normaliseScore(instructions: string | undefined, criteria: unknown): QuestionScore {
  if (Array.isArray(criteria)) {
    return { type: 'score', instructions, criteria: criteria.map((c) => String(c)) };
  }
  if (criteria && typeof criteria === 'object') {
    const entries = Object.entries(criteria as Record<string, unknown>);
    const described = entries.filter(([, d]) => typeof d === 'string' && d.trim());
    const legend = described.map(([k, d]) => `${k}: ${String(d).trim()}`).join('; ');
    return {
      type: 'score',
      instructions: [instructions, legend ? `Levels (low→high) — ${legend}.` : ''].filter(Boolean).join(' ') || undefined,
      criteria: entries.map(([k]) => k),
    };
  }
  return { type: 'score', instructions, criteria: undefined };
}

async function systemOne(
  state: unknown,
  questions: Record<string, Question>,
  model = DEFAULT_MODEL,
): Promise<SystemOneResponse> {
  const apiKey = await getKey();
  await assertBudget();
  if (!apiKey) throw Object.assign(new Error('TypeSafe API key not configured — call set_key first'), { statusCode: 503 });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, state, questions }),
  });

  const body = (await res.json()) as SystemOneResponse & { error?: { message?: string } | string };
  if (!res.ok) {
    const msg =
      typeof body.error === 'string'
        ? body.error
        : (body.error as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(`Jev: ${msg}`), { statusCode: res.status >= 500 ? 502 : res.status });
  }
  await meter(body.usage?.input_tokens ?? 0);
  return body;
}

/* ── tool implementations ────────────────────────────────────────── */

async function toolCall(name: string, args: Args, caller: string): Promise<{ statusCode: number; body: unknown }> {
  switch (name) {
    case 'set_key': {
      if (caller !== OWNER) return { statusCode: 403, body: { error: 'set_key is owner-only' } };
      const apiKey = str(args.apiKey ?? args.key);
      if (!apiKey) return { statusCode: 400, body: { error: 'apiKey is required' } };
      await putKey(apiKey);
      return { statusCode: 200, body: { ok: true, configured: true } };
    }

    case 'status': {
      const key = await getKey();
      return {
        statusCode: 200,
        body: {
          configured: !!key,
          endpoint: ENDPOINT,
          defaultModel: DEFAULT_MODEL,
          primitives: ['noul', 'choice', 'score'],
        },
      };
    }

    case 'decide': {
      const state = args.state;
      if (state === undefined || state === null) {
        return { statusCode: 400, body: { error: 'state is required (string, object, or array)' } };
      }
      const rawQ = args.questions;
      if (!rawQ || typeof rawQ !== 'object' || Array.isArray(rawQ)) {
        return { statusCode: 400, body: { error: 'questions must be an object map of named questions' } };
      }
      const questions = normaliseQuestions(rawQ as Record<string, unknown>);
      if (Object.keys(questions).length === 0) {
        return { statusCode: 400, body: { error: 'at least one valid question (noul|choice|score) is required' } };
      }
      const model = strOpt(args.model) ?? DEFAULT_MODEL;
      const result = await systemOne(state, questions, model);
      return { statusCode: 200, body: result };
    }

    case 'noul': {
      const state = args.state;
      if (state === undefined || state === null) {
        return { statusCode: 400, body: { error: 'state is required' } };
      }
      const instructions = strOpt(args.instructions) ?? strOpt(args.question) ?? 'Is this true?';
      const model = strOpt(args.model) ?? DEFAULT_MODEL;
      const result = await systemOne(
        state,
        { answer: { type: 'noul', instructions } },
        model,
      );
      const ans = result.answers?.answer as { noul?: number; type?: string } | undefined;
      return {
        statusCode: 200,
        body: {
          noul: ans?.noul ?? null,
          model: result.model,
          usage: result.usage,
          answers: result.answers,
        },
      };
    }

    case 'choice': {
      const state = args.state;
      if (state === undefined || state === null) {
        return { statusCode: 400, body: { error: 'state is required' } };
      }
      const instructions = strOpt(args.instructions) ?? strOpt(args.question) ?? 'Which option fits best?';
      let criteria: Record<string, string | null> | undefined;
      if (args.criteria && typeof args.criteria === 'object' && !Array.isArray(args.criteria)) {
        criteria = args.criteria as Record<string, string | null>;
      } else if (Array.isArray(args.options)) {
        criteria = Object.fromEntries((args.options as unknown[]).map((o) => [String(o), null]));
      }
      if (!criteria || Object.keys(criteria).length === 0) {
        return { statusCode: 400, body: { error: 'options (array) or criteria (object) is required' } };
      }
      if (Object.keys(criteria).length > 255) {
        return { statusCode: 400, body: { error: 'choice supports at most 255 options' } };
      }
      const model = strOpt(args.model) ?? DEFAULT_MODEL;
      const result = await systemOne(
        state,
        { answer: { type: 'choice', instructions, criteria } },
        model,
      );
      const ans = result.answers?.answer as {
        choice?: string;
        confidence?: number;
        probabilities?: Record<string, number>;
      } | undefined;
      return {
        statusCode: 200,
        body: {
          choice: ans?.choice ?? null,
          confidence: ans?.confidence ?? null,
          probabilities: ans?.probabilities ?? null,
          model: result.model,
          usage: result.usage,
          answers: result.answers,
        },
      };
    }

    case 'score': {
      const state = args.state;
      if (state === undefined || state === null) {
        return { statusCode: 400, body: { error: 'state is required' } };
      }
      const instructions = strOpt(args.instructions) ?? strOpt(args.question) ?? 'Score this.';
      const criteria = args.criteria;
      if (!criteria) {
        return { statusCode: 400, body: { error: 'criteria (array of labels or object) is required' } };
      }
      const model = strOpt(args.model) ?? DEFAULT_MODEL;
      const result = await systemOne(state, { answer: normaliseScore(instructions, criteria) }, model);
      const ans = result.answers?.answer as {
        score?: number;
        confidence?: number;
        probabilities?: Record<string, number>;
        legend?: Record<string, string>;
      } | undefined;
      return {
        statusCode: 200,
        body: {
          score: ans?.score ?? null,
          confidence: ans?.confidence ?? null,
          probabilities: ans?.probabilities ?? null,
          legend: ans?.legend ?? null,
          model: result.model,
          usage: result.usage,
          answers: result.answers,
        },
      };
    }

    case 'decide_many': {
      const items = args.items;
      if (!Array.isArray(items) || items.length === 0) {
        return { statusCode: 400, body: { error: 'items must be a non-empty array of {id?, state, questions?}' } };
      }
      if (items.length > MANY_MAX) {
        return { statusCode: 400, body: { error: `at most ${MANY_MAX} items per call` } };
      }
      const shared = args.questions && typeof args.questions === 'object' && !Array.isArray(args.questions)
        ? normaliseQuestions(args.questions as Record<string, unknown>)
        : {};
      const model = strOpt(args.model) ?? DEFAULT_MODEL;
      const concurrency = Math.min(Math.max(Number(args.concurrency) || MANY_CONCURRENCY, 1), 24);
      const results: Array<Record<string, unknown>> = new Array(items.length);
      let next = 0;
      let inputTokens = 0;
      const worker = async () => {
        while (next < items.length) {
          const i = next++;
          const it = (items[i] ?? {}) as Record<string, unknown>;
          const id = it.id ?? i;
          const own = it.questions && typeof it.questions === 'object' && !Array.isArray(it.questions)
            ? normaliseQuestions(it.questions as Record<string, unknown>)
            : {};
          const questions = { ...shared, ...own };
          if (it.state === undefined || it.state === null || Object.keys(questions).length === 0) {
            results[i] = { id, error: 'state and at least one question are required' };
            continue;
          }
          try {
            const r = await systemOne(it.state, questions, model);
            inputTokens += r.usage?.input_tokens ?? 0;
            results[i] = { id, answers: r.answers, usage: r.usage };
          } catch (err) {
            results[i] = { id, error: (err as Error).message };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
      return { statusCode: 200, body: { model, results, usage: { input_tokens: inputTokens } } };
    }

    case 'usage': {
      const [u, budget] = await Promise.all([getUsage(strOpt(args.day)), getBudget()]);
      return {
        statusCode: 200,
        body: { ...u, dailyBudget: budget, remaining: Math.max(budget - u.inputTokens, 0), approxUsd: +(u.inputTokens * 0.042e-6).toFixed(4) },
      };
    }

    case 'set_budget': {
      if (caller !== OWNER) return { statusCode: 403, body: { error: 'set_budget is owner-only' } };
      const n = Number(args.dailyTokens);
      if (!Number.isFinite(n) || n <= 0) return { statusCode: 400, body: { error: 'dailyTokens must be a positive number' } };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: { pk: 'CONFIG', sk: 'budget', dailyTokens: n, updatedAt: new Date().toISOString() } }));
      budgetCache = null;
      return { statusCode: 200, body: { ok: true, dailyTokens: n } };
    }

    default:
      return { statusCode: 404, body: { error: `unknown tool ${name}` } };
  }
}

/* ── tool catalog ────────────────────────────────────────────────── */

const TOOLS: Array<{ name: string; kind: string; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: 'set_key',
    kind: 'act',
    description:
      'Owner-only, write-only: store the TypeSafe API key for this cell. The key is never readable back.',
    inputSchema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', description: 'TypeSafe API key (Bearer token)' },
      },
      required: ['apiKey'],
    },
  },
  {
    name: 'status',
    kind: 'read',
    description: 'Whether a TypeSafe key is configured, plus endpoint and default model. Never reveals the key.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'decide',
    kind: 'act',
    description:
      'Full Jev call: evaluate a state against any number of named typed questions (noul / choice / score) in one parallel pass. Returns answers + usage.',
    inputSchema: {
      type: 'object',
      properties: {
        state: {
          description: 'Context to evaluate — string, JSON object, or array of text',
        },
        questions: {
          type: 'object',
          description:
            'Map of question name → { type: "noul"|"choice"|"score", instructions?, criteria? / options? }',
          additionalProperties: true,
        },
        model: {
          type: 'string',
          description: 'Model id (default jev-1.13.0, pinned; pass jev-latest to follow the alias)',
        },
      },
      required: ['state', 'questions'],
    },
  },
  {
    name: 'noul',
    kind: 'act',
    description:
      'Ask a single yes/no question about a state. Returns the probability of yes (0–1) plus usage.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { description: 'Context to evaluate' },
        instructions: { type: 'string', description: 'The yes/no question (default: "Is this true?")' },
        question: { type: 'string', description: 'Alias for instructions' },
        model: { type: 'string' },
      },
      required: ['state'],
    },
  },
  {
    name: 'choice',
    kind: 'act',
    description:
      'Ask a single multi-option question (≤255 options). Returns the winning choice, confidence, full probability distribution, and usage.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { description: 'Context to evaluate' },
        instructions: { type: 'string', description: 'What to decide' },
        question: { type: 'string', description: 'Alias for instructions' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of option labels (converted to criteria)',
        },
        criteria: {
          type: 'object',
          description: 'Map of option → description (or null). Preferred over options when descriptions help.',
          additionalProperties: true,
        },
        model: { type: 'string' },
      },
      required: ['state'],
    },
  },
  {
    name: 'score',
    kind: 'act',
    description:
      'Ask a single rubric score about a state. Returns the weighted score, confidence, probability mass per level, and usage.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { description: 'Context to evaluate' },
        instructions: { type: 'string', description: 'What to score' },
        question: { type: 'string', description: 'Alias for instructions' },
        criteria: {
          description: 'Ordered labels (array) or map of level → description',
        },
        model: { type: 'string' },
      },
      required: ['state', 'criteria'],
    },
  },
];

TOOLS.push(
  {
    name: 'decide_many',
    kind: 'act',
    description:
      'Batch Jev: one shared question set (plus optional per-item questions) over up to 200 states, fanned out in parallel under the rate limit. Returns results[] in input order ({id, answers, usage} or {id, error}) + summed usage. The System One organ\'s batch seam (ADR-0098).',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of { id?, state, questions? } — per-item questions merge over the shared set',
          items: { type: 'object' },
        },
        questions: { type: 'object', description: 'Shared question map (same shape as decide)', additionalProperties: true },
        model: { type: 'string' },
        concurrency: { type: 'number', description: 'Parallel calls (default 12, max 24)' },
      },
      required: ['items'],
    },
  },
  {
    name: 'usage',
    kind: 'read',
    description: 'Metered Jev input tokens + calls for a day (default today, UTC) against the daily budget, with approximate USD.',
    inputSchema: { type: 'object', properties: { day: { type: 'string', description: 'YYYY-MM-DD' } } },
  },
  {
    name: 'set_budget',
    kind: 'act',
    description: 'Owner-only: set the daily input-token budget (calls past it are refused with 429).',
    inputSchema: { type: 'object', properties: { dailyTokens: { type: 'number' } }, required: ['dailyTokens'] },
  },
);

/* ── handler ─────────────────────────────────────────────────────── */

export const handler = async (event: {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const caller = event.headers?.['x-cell-caller'] ?? 'anonymous';

  if (method === 'GET' && path === '/_tools') {
    return json(200, { tools: TOOLS });
  }

  if (method === 'POST' && path.startsWith('/_tools/')) {
    const name = path.slice('/_tools/'.length);
    let args: Args = {};
    try {
      args = event.body ? (JSON.parse(event.body) as Args) : {};
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
    try {
      const { statusCode, body } = await toolCall(name, args, caller);
      return json(statusCode, body);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      return json(e.statusCode ?? 500, { error: e.message });
    }
  }

  // jev · lab (client/): the experiment library. The page and its bundle are
  // static — anonymous GETs may load them (the cell is public); running an
  // experiment POSTs /_tools/decide, which dispatch + cells.call admit only
  // for the owner or a granted caller.
  if ((method === 'GET' || method === 'HEAD') && (path === '/' || path === '')) {
    try {
      return page(200, 'text/html; charset=utf-8', readFileSync(join(__dirname, 'static/index.html'), 'utf8'));
    } catch {
      /* no bundled page (tool-only deploy) — fall through to the descriptor */
    }
  }
  if ((method === 'GET' || method === 'HEAD') && path === '/app.js') {
    try {
      return page(200, 'application/javascript; charset=utf-8', readFileSync(join(__dirname, 'app.js'), 'utf8'));
    } catch {
      return json(404, { error: 'no client bundle' });
    }
  }

  if (method === 'GET' && (path === '/' || path === '' || path === '/_info')) {
    return json(200, {
      cell: '@c15r/jev',
      description: 'TypeSafe Jev (System One) — typed decisions as MCP tools',
      tools: TOOLS.map((t) => t.name),
      docs: 'https://docs.typesafe.ai',
    });
  }

  return json(404, { error: `no route for ${method} ${path}` });
};
