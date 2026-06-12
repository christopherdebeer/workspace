/**
 * @c15r/models — the generative executor (transformers, generative kind).
 *
 * Provider CLIENT CODE and provider SECRETS are collocated by design: a
 * secret that leaves the cell that spends it isn't in custody. Keys live in
 * this cell's own DynamoDB table (IAM-scoped to this cell's role alone),
 * written by the owner via the /secrets page or the setProvider tool —
 * there is NO readback path.
 *
 * Tools (served at /_tools, surfaced on /mcp as @c15r/models.*):
 *   setProvider {provider, apiKey, model?}   owner-only, write-only
 *   listProviders {}                         which providers are enabled (no secrets)
 *   run {provider, mode?, prompt, system?, context?, model?, imageB64?, maxTokens?}
 *
 * Providers: anthropic (text/vlm), openai (text + image), google (text + image).
 * Raw HTTP clients — the Lambda runtime ships no provider SDKs.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';

const lambda = new LambdaClient({});

// removeUndefinedValues: job results may carry undefined fields; without
// this, saving such a job throws and the marshaller's error masks the result.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';

const DEFAULTS: Record<string, { text?: string; image?: string }> = {
  anthropic: { text: 'claude-opus-4-8' },
  openai: { text: 'gpt-5.1', image: 'gpt-image-1' },
  google: { text: 'gemini-2.5-flash', image: 'gemini-2.5-flash-image' },
};

interface ProviderRec {
  apiKey: string;
  textModel?: string;
  imageModel?: string;
}

async function getProvider(provider: string): Promise<ProviderRec | null> {
  const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `SECRET#${provider}`, sk: 'v1' } }));
  return (res.Item as ProviderRec | undefined) ?? null;
}

/* ── provider clients (raw HTTP) ────────────────────────────────── */

interface RunInput {
  provider?: string;
  mode?: 'text' | 'image';
  prompt: string;
  system?: string;
  /** Extra context (e.g. linked facts' content) prepended to the prompt. */
  context?: string;
  model?: string;
  /** For VLM: a base64 image (anthropic/google) with its media type. */
  imageB64?: string;
  imageMediaType?: string;
  maxTokens?: number;
  /** Target dimensions (e.g. the canvas node's box) — providers map to
   *  their nearest supported size / aspect ratio. */
  width?: number;
  height?: number;
}

/** openai sizes: square, landscape, portrait. */
function openaiSize(w?: number, h?: number): string {
  if (!w || !h) return '1024x1024';
  const r = w / h;
  if (r > 1.2) return '1536x1024';
  if (r < 0.83) return '1024x1536';
  return '1024x1024';
}

/** google imageConfig aspect ratios. */
function googleAspect(w?: number, h?: number): string {
  if (!w || !h) return '1:1';
  const r = w / h;
  const options: Array<[string, number]> = [['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9], ['9:16', 9 / 16]];
  options.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r));
  return options[0][0];
}

type RunOutput = { text: string } | { imageB64: string; mime: string };

async function runAnthropic(rec: ProviderRec, input: RunInput): Promise<RunOutput> {
  if (input.mode === 'image') throw new Error('anthropic: no image generation — use openai or google');
  const content: unknown[] = [];
  if (input.imageB64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: input.imageMediaType ?? 'image/png', data: input.imageB64 } });
  }
  content.push({ type: 'text', text: (input.context ? `<context>\n${input.context}\n</context>\n\n` : '') + input.prompt });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': rec.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model ?? rec.textModel ?? DEFAULTS.anthropic.text,
      max_tokens: input.maxTokens ?? 4096,
      ...(input.system ? { system: input.system } : {}),
      messages: [{ role: 'user', content }],
    }),
  });
  const j = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(`anthropic: ${j.error?.message ?? res.status}`);
  if (j.stop_reason === 'refusal') throw new Error('anthropic: request refused');
  const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  return { text };
}

async function runOpenAI(rec: ProviderRec, input: RunInput): Promise<RunOutput> {
  if (input.mode === 'image') {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${rec.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.model ?? rec.imageModel ?? DEFAULTS.openai.image,
        prompt: input.prompt,
        size: openaiSize(input.width, input.height),
        quality: 'medium', // the edge caps a sync round trip at ~30s — speed over polish
        output_format: 'webp',
      }),
    });
    const j = (await res.json()) as { data?: Array<{ b64_json?: string }>; error?: { message?: string } };
    if (!res.ok) throw new Error(`openai: ${j.error?.message ?? res.status}`);
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error('openai: no image returned');
    return { imageB64: b64, mime: 'image/webp' };
  }
  const messages: unknown[] = [];
  if (input.system) messages.push({ role: 'system', content: input.system });
  const userContent: unknown[] = [];
  if (input.imageB64) {
    userContent.push({ type: 'image_url', image_url: { url: `data:${input.imageMediaType ?? 'image/png'};base64,${input.imageB64}` } });
  }
  userContent.push({ type: 'text', text: (input.context ? `<context>\n${input.context}\n</context>\n\n` : '') + input.prompt });
  messages.push({ role: 'user', content: userContent });
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${rec.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: input.model ?? rec.textModel ?? DEFAULTS.openai.text, max_completion_tokens: input.maxTokens ?? 4096, messages }),
  });
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!res.ok) throw new Error(`openai: ${j.error?.message ?? res.status}`);
  return { text: j.choices?.[0]?.message?.content ?? '' };
}

async function runGoogle(rec: ProviderRec, input: RunInput): Promise<RunOutput> {
  const model = input.model ?? (input.mode === 'image' ? rec.imageModel ?? DEFAULTS.google.image : rec.textModel ?? DEFAULTS.google.text);
  const parts: unknown[] = [];
  if (input.imageB64) parts.push({ inline_data: { mime_type: input.imageMediaType ?? 'image/png', data: input.imageB64 } });
  parts.push({ text: (input.context ? `<context>\n${input.context}\n</context>\n\n` : '') + input.prompt });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': rec.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
      ...(input.mode === 'image'
        ? { generationConfig: { imageConfig: { aspectRatio: googleAspect(input.width, input.height) } } }
        : {}),
    }),
  });
  const j = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }> } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`google: ${j.error?.message ?? res.status}`);
  const outParts = j.candidates?.[0]?.content?.parts ?? [];
  const img = outParts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (input.mode === 'image') {
    if (!img) throw new Error('google: no image returned');
    return { imageB64: (img.inlineData?.data ?? img.inline_data?.data)!, mime: img.inlineData?.mimeType ?? img.inline_data?.mime_type ?? 'image/png' };
  }
  return { text: outParts.map((p) => p.text ?? '').join('') };
}

/* ── async jobs: submit fast, self-invoke for the long work, poll fetch ──
 * The edge caps synchronous round trips at ~30s; async Lambda invocations
 * have no such cap — the cell re-invokes ITSELF with the job and the
 * caller polls `fetch`. Results chunk across items (DDB's 400KB ceiling). */

const CHUNK = 300 * 1024; // b64 chars per item — safely under the item cap

async function putJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  await ddb.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: `JOB#${jobId}`, sk: 'v1', ttl: Math.floor(Date.now() / 1000) + 3600, ...patch },
  }));
}

async function runJob(jobId: string): Promise<void> {
  const job = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `JOB#${jobId}`, sk: 'v1' } }));
  const input = (job.Item as { input?: RunInput } | undefined)?.input;
  if (!input) return;
  try {
    const out = (await toolCall('run', input as unknown as Record<string, unknown>, OWNER)) as
      | { text?: string }
      | { imageB64?: string; mime?: string };
    const imageB64 = (out as { imageB64?: string }).imageB64;
    if (imageB64 && imageB64.length > CHUNK) {
      const chunks = Math.ceil(imageB64.length / CHUNK);
      for (let i = 0; i < chunks; i++) {
        await ddb.send(new PutCommand({
          TableName: TABLE,
          Item: { pk: `JOB#${jobId}`, sk: `c${i}`, ttl: Math.floor(Date.now() / 1000) + 3600, data: imageB64.slice(i * CHUNK, (i + 1) * CHUNK) },
        }));
      }
      await putJob(jobId, { status: 'done', input, mime: (out as { mime?: string }).mime, chunks });
    } else {
      await putJob(jobId, { status: 'done', input, ...out });
    }
  } catch (err) {
    await putJob(jobId, { status: 'error', input, error: (err as Error).message });
  }
}

/* ── tools ──────────────────────────────────────────────────────── */

const TOOLS = [
  {
    name: 'setProvider',
    description: 'Enable a model provider by storing its API key in this cell’s own table (write-only — no readback exists). Owner only.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['anthropic', 'openai', 'google'] },
        apiKey: { type: 'string' },
        textModel: { type: 'string', description: 'Override the default text model' },
        imageModel: { type: 'string', description: 'Override the default image model' },
      },
      required: ['provider', 'apiKey'],
      additionalProperties: false,
    },
  },
  {
    name: 'listProviders',
    description: 'Which providers are enabled, and their configured models. Never returns keys.',
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'run',
    description:
      'Run a generative model: mode "text" (default; anthropic/openai/google, vlm via imageB64) or "image" (openai/google). Returns {text} or {imageB64, mime}. The caller writes any output FACT (outputs are proposals, via transform:*).',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['anthropic', 'openai', 'google'] },
        mode: { type: 'string', enum: ['text', 'image'] },
        prompt: { type: 'string' },
        system: { type: 'string' },
        context: { type: 'string', description: 'Extra context (e.g. linked facts) prepended to the prompt' },
        model: { type: 'string' },
        imageB64: { type: 'string', description: 'Base64 image input for VLM modes' },
        imageMediaType: { type: 'string' },
        maxTokens: { type: 'number' },
        async: { type: 'boolean', description: 'Return {jobId} immediately; poll fetch — required for work beyond the ~30s edge cap (image gen)' },
        width: { type: 'number', description: 'Target width — image providers map to nearest supported size/aspect' },
        height: { type: 'number' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    description: 'Poll an async run: {status: pending|done|error, text?, imageB64?, mime?, error?}.',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
];

/** Set per-invocation so toolCall can self-invoke for async jobs. */
let SELF_FUNCTION = '';

async function toolCall(name: string, args: Record<string, unknown>, caller: string): Promise<unknown> {
  if (name === 'setProvider') {
    if (caller !== OWNER) throw new Error('only the owner may set provider keys');
    const provider = String(args.provider ?? '');
    if (!DEFAULTS[provider]) throw new Error(`unknown provider "${provider}"`);
    if (typeof args.apiKey !== 'string' || args.apiKey.length < 8) throw new Error('apiKey required');
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: `SECRET#${provider}`,
          sk: 'v1',
          apiKey: args.apiKey,
          textModel: args.textModel ?? DEFAULTS[provider].text,
          imageModel: args.imageModel ?? DEFAULTS[provider].image,
          updatedAt: new Date().toISOString(),
        },
      }),
    );
    return { ok: true, provider, note: 'stored — write-only, no readback path exists' };
  }
  if (name === 'listProviders') {
    const out: Record<string, unknown> = {};
    for (const p of Object.keys(DEFAULTS)) {
      const rec = await getProvider(p);
      out[p] = rec ? { enabled: true, textModel: rec.textModel, imageModel: rec.imageModel } : { enabled: false };
    }
    return { providers: out };
  }
  if (name === 'fetch') {
    const jobId = String(args.jobId ?? '');
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `JOB#${jobId}`, sk: 'v1' } }));
    const item = res.Item as { status?: string; text?: string; imageB64?: string; mime?: string; error?: string; chunks?: number } | undefined;
    if (!item) throw new Error(`unknown job "${jobId}"`);
    if (item.chunks) {
      let b64 = '';
      for (let i = 0; i < item.chunks; i++) {
        const c = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `JOB#${jobId}`, sk: `c${i}` } }));
        b64 += (c.Item as { data?: string } | undefined)?.data ?? '';
      }
      return { status: item.status, imageB64: b64, mime: item.mime };
    }
    return { status: item.status, text: item.text, imageB64: item.imageB64, mime: item.mime, error: item.error };
  }
  if (name === 'run') {
    const input = args as unknown as RunInput & { async?: boolean };
    if (!input.prompt) throw new Error('prompt is required');
    if (input.async) {
      if (!SELF_FUNCTION) throw new Error('async unavailable: function name unknown');
      const jobId = randomUUID().slice(0, 13);
      const { async: _a, ...rest } = input;
      await putJob(jobId, { status: 'pending', input: rest });
      await lambda.send(new InvokeCommand({
        FunctionName: SELF_FUNCTION,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ __job: jobId })),
      }));
      return { jobId, status: 'pending' };
    }
    const provider = input.provider ?? 'anthropic';
    const rec = await getProvider(provider);
    if (!rec) throw new Error(`provider "${provider}" not enabled — paste a key at /@${OWNER}/models/secrets`);
    if (provider === 'anthropic') return runAnthropic(rec, input);
    if (provider === 'openai') return runOpenAI(rec, input);
    if (provider === 'google') return runGoogle(rec, input);
    throw new Error(`unknown provider "${provider}"`);
  }
  throw new Error(`unknown tool "${name}"`);
}

/* ── http ───────────────────────────────────────────────────────── */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const respond = (statusCode: number, contentType: string, body: string) => ({
  statusCode,
  headers: { 'content-type': contentType },
  body,
});
const json = (code: number, v: unknown) => respond(code, 'application/json', JSON.stringify(v));

export const handler = async (
  event: {
    rawPath?: string;
    requestContext?: { http?: { method?: string } };
    headers?: Record<string, string>;
    body?: string;
    __job?: string;
  },
  context?: { functionName?: string },
) => {
  SELF_FUNCTION = context?.functionName ?? SELF_FUNCTION;
  if (event.__job) {
    // The async self-invocation: do the long work, write the job result.
    await runJob(event.__job);
    return { statusCode: 200, body: 'ok' };
  }
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const caller = event.headers?.['x-cell-caller'] ?? 'anonymous';

  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'POST' && path.startsWith('/_tools/')) {
    const name = path.slice('/_tools/'.length);
    let args: Record<string, unknown> = {};
    try {
      args = event.body ? (JSON.parse(event.body) as Record<string, unknown>) : {};
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
    try {
      return json(200, await toolCall(name, args, caller));
    } catch (err) {
      return json(400, { error: (err as Error).message });
    }
  }
  if (method === 'GET' && (path === '/secrets' || path === '/secrets/')) {
    return respond(200, 'text/html; charset=utf-8', readFileSync(join(__dirname, 'static/secrets.html'), 'utf8'));
  }
  if (method === 'GET') {
    return respond(
      200,
      'text/html; charset=utf-8',
      '<!doctype html><meta charset="utf-8"><title>models</title><pre>@c15r/models — the generative executor\n\ntools: setProvider · listProviders · run\nkeys:  /@c15r/models/secrets (owner)\n\nsecrets are collocated with the client code that spends them;\nno readback path exists.</pre>',
    );
  }
  return json(404, { error: `no route for ${method} ${path}` });
};
