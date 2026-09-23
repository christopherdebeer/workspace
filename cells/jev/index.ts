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
 *
 * Secrets live in this cell's own DynamoDB table (IAM-scoped). There is no
 * readback path for the key.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_MODEL = 'jev-latest';

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
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
      out[name] = {
        type: 'score',
        instructions: strOpt(qq.instructions),
        criteria: qq.criteria as string[] | Record<string, string | null> | undefined,
      };
    }
  }
  return out;
}

async function systemOne(
  state: unknown,
  questions: Record<string, Question>,
  model = DEFAULT_MODEL,
): Promise<SystemOneResponse> {
  const apiKey = await getKey();
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
      const result = await systemOne(
        state,
        { answer: { type: 'score', instructions, criteria: criteria as string[] | Record<string, string | null> } },
        model,
      );
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

    default:
      return { statusCode: 404, body: { error: `unknown tool ${name}` } };
  }
}

/* ── tool catalog ────────────────────────────────────────────────── */

const TOOLS = [
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
          description: 'Model id (default jev-latest; pin e.g. jev-1.13.0 for stable thresholds)',
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

  if (method === 'GET' && (path === '/' || path === '')) {
    return json(200, {
      cell: '@c15r/jev',
      description: 'TypeSafe Jev (System One) — typed decisions as MCP tools',
      tools: TOOLS.map((t) => t.name),
      docs: 'https://docs.typesafe.ai',
    });
  }

  return json(404, { error: `no route for ${method} ${path}` });
};
