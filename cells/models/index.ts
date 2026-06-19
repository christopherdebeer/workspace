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
 *   agent {prompt, system?, grants?, maxTurns?, factKey?}   model-in-the-loop with
 *     substrate tools, always async; result + transcript land as substrate facts
 *
 * Providers: anthropic (text/vlm), openai (text + image), google (text + image).
 * Raw HTTP clients — the Lambda runtime ships no provider SDKs.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';

const lambda = new LambdaClient({});
const events = new EventBridgeClient({});

// removeUndefinedValues: job results may carry undefined fields; without
// this, saving such a job throws and the marshaller's error masks the result.
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const TABLE = process.env.TABLE_NAME ?? '';
const OWNER = process.env.CELL_OWNER ?? 'c15r';
const SUBSTRATE = process.env.SUBSTRATE_TABLE ?? '';
const BUS = process.env.EVENT_BUS_NAME ?? '';
const SELF_SOURCE = process.env.SERVICE_NAME ?? ''; // = cell-models-<hash>, the IAM-pinned source

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

/* ── agent: model-in-the-loop over the substrate ──────────────────
 * An anthropic tool-use loop whose tools are the substrate itself:
 * substrate_query / substrate_read (the cell's IAM-scoped reads of the
 * owner's slice) and substrate_emit (the organ path — Source-pinned, so
 * provenance is machine-attested as @owner/models, never forgeable).
 *
 * Authority model (v0, the same honesty as @c15r/run): the ceiling is the
 * CELL's standing — the owner's slice. Per-run `grants` only NARROW within
 * it (read defaults on, write defaults OFF; either may be a prefix list).
 * Per-caller scoping rides the grants-to-principals design, deferred.
 *
 * Always async (a loop cannot fit the ~30s edge cap), and the outcome is
 * facts by construction: the result lands at `factKey` (type agent-run)
 * and the full turn record beside it (type transcript). */

interface AgentGrants {
  /** Read access: true (whole slice, default), false, or allowed key prefixes. */
  read?: boolean | string[];
  /** Write access: true, false (default), or allowed key prefixes. */
  write?: boolean | string[];
}

interface AgentInput {
  prompt: string;
  system?: string;
  /** Pin one provider (skips fallback). Default: walk the enabled agent-capable chain. */
  provider?: 'anthropic' | 'openai';
  model?: string;
  maxTurns?: number;
  maxTokens?: number;
  grants?: AgentGrants;
  /** Where the result fact lands (default agent/<jobId>). */
  factKey?: string;
  tags?: string[];
}

function grantAllows(grant: boolean | string[] | undefined, key: string, dflt: boolean): boolean {
  if (grant === undefined) return dflt;
  if (typeof grant === 'boolean') return grant;
  return grant.some((p) => key.startsWith(p));
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…[truncated ${s.length - n} chars]` : s);

/** A neutral tool definition — each provider adapter maps it to its native shape. */
interface AgentToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** The tool surface offered to the model — emit only exists when write is granted. */
function buildAgentTools(grants: AgentGrants): AgentToolDef[] {
  const tools: AgentToolDef[] = [];
  if (grants.read !== false) {
    tools.push(
      {
        name: 'substrate_query',
        description: 'List live facts in the workspace by key prefix. Returns {entries: [{key, value}], count}.',
        schema: {
          type: 'object',
          properties: {
            prefix: { type: 'string', description: 'Key prefix to match (empty = all granted keys)' },
            limit: { type: 'number', description: 'Max entries (default 25, cap 50)' },
          },
        },
      },
      {
        name: 'substrate_read',
        description: 'Read one fact by exact key. Returns {key, value} or {key, value: null} when absent.',
        schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      },
    );
  }
  if (grants.write === true || Array.isArray(grants.write)) {
    tools.push({
      name: 'substrate_emit',
      description: 'Write a fact to the workspace (provenance is attested to this executor). Use only when the task asks for a write.',
      schema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { description: 'Any JSON value' },
          type: { type: 'string', description: 'Optional fact type' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['key', 'value'],
      },
    });
  }
  return tools;
}

/** Emit a fact through the organ path (Source IAM-pinned to this cell). */
async function emitFact(key: string, value: unknown, type?: string, tags?: string[]): Promise<void> {
  if (!BUS) throw new Error('event bus unavailable');
  await events.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS,
      Source: SELF_SOURCE,
      DetailType: 'substrate.write.requested',
      Detail: JSON.stringify({ key, value, via: 'agent', type, tags }),
    }],
  }));
}

async function agentToolExec(name: string, args: Record<string, unknown>, grants: AgentGrants): Promise<unknown> {
  if (name === 'substrate_read') {
    const key = String(args.key ?? '');
    if (!grantAllows(grants.read, key, true)) return { error: `read not granted for "${key}"` };
    const res = await ddb.send(new GetCommand({ TableName: SUBSTRATE, Key: { pk: `STATE#${OWNER}`, sk: `KEY#${key}` } }));
    const item = res.Item as { value?: unknown; superseded?: boolean } | undefined;
    return { key, value: item && !item.superseded ? item.value : null };
  }
  if (name === 'substrate_query') {
    const prefix = String(args.prefix ?? '');
    const limit = Math.min(Number(args.limit) || 25, 50);
    const res = await ddb.send(new QueryCommand({
      TableName: SUBSTRATE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':sk': `KEY#${prefix}` },
      Limit: limit,
    }));
    const entries = ((res.Items ?? []) as Array<Record<string, unknown>>)
      .filter((i) => !i.superseded)
      .map((i) => ({ key: String(i.sk).slice('KEY#'.length), value: i.value }))
      // the grant filter applies per-key, so a broad prefix cannot widen a narrow grant
      .filter((e) => grantAllows(grants.read, e.key, true));
    return { entries, count: entries.length };
  }
  if (name === 'substrate_emit') {
    const key = String(args.key ?? '');
    if (!key) return { error: 'key is required' };
    if (key.startsWith('_')) return { error: 'agents may not write `_` system namespaces' };
    if (!grantAllows(grants.write, key, false)) return { error: `write not granted for "${key}"` };
    await emitFact(key, args.value, typeof args.type === 'string' ? args.type : undefined, Array.isArray(args.tags) ? (args.tags as string[]) : undefined);
    return { ok: true, key, note: 'write requested via the organ path (applies asynchronously)' };
  }
  return { error: `unknown tool "${name}"` };
}

/* The agent loop is provider-agnostic: an adapter owns its provider's native
 * message format and exposes call()/feed(). Fallback policy mirrors canvas's
 * runWithFallback, with one agent-specific sharpening: an enabled key can
 * still be a dead org (seen live — anthropic out of credits), so a failure on
 * the FIRST model call, before any tool has executed, falls through to the
 * next enabled provider; a failure after effects fails honestly instead of
 * switching models mid-conversation. */

interface AgentToolUse {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
interface AgentTurn {
  text: string;
  toolUses: AgentToolUse[];
}
interface AgentAdapter {
  provider: string;
  model: string;
  call(): Promise<AgentTurn>;
  feed(results: Array<{ id: string; content: string }>): void;
}

/** Thrown when the first model call fails — no effects yet, safe to fall back. */
class FirstCallFailure extends Error {}

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function anthropicAdapter(rec: ProviderRec, input: AgentInput, system: string, tools: AgentToolDef[]): AgentAdapter {
  const model = input.model ?? rec.textModel ?? DEFAULTS.anthropic.text ?? '';
  const messages: unknown[] = [{ role: 'user', content: input.prompt }];
  const aTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
  return {
    provider: 'anthropic',
    model,
    async call(): Promise<AgentTurn> {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': rec.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: input.maxTokens ?? 4096,
          system,
          messages,
          ...(aTools.length ? { tools: aTools } : {}),
        }),
      });
      const j = (await res.json()) as { content?: AnthropicBlock[]; stop_reason?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(`anthropic: ${j.error?.message ?? res.status}`);
      const blocks = j.content ?? [];
      messages.push({ role: 'assistant', content: blocks });
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      const toolUses =
        j.stop_reason === 'tool_use'
          ? blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id ?? '', name: b.name ?? '', args: b.input ?? {} }))
          : [];
      return { text, toolUses };
    },
    feed(results): void {
      messages.push({
        role: 'user',
        content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })),
      });
    },
  };
}

interface OpenAIToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

function openaiAdapter(rec: ProviderRec, input: AgentInput, system: string, tools: AgentToolDef[]): AgentAdapter {
  const model = input.model ?? rec.textModel ?? DEFAULTS.openai.text ?? '';
  const messages: unknown[] = [
    { role: 'system', content: system },
    { role: 'user', content: input.prompt },
  ];
  const oTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
  return {
    provider: 'openai',
    model,
    async call(): Promise<AgentTurn> {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${rec.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          max_completion_tokens: input.maxTokens ?? 4096,
          messages,
          ...(oTools.length ? { tools: oTools } : {}),
        }),
      });
      const j = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAIToolCall[] } }>;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(`openai: ${j.error?.message ?? res.status}`);
      const msg = j.choices?.[0]?.message ?? {};
      messages.push(msg);
      const toolUses = (msg.tool_calls ?? []).map((c) => {
        let args: Record<string, unknown> = {};
        try {
          args = c.function?.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {};
        } catch {
          /* malformed arguments surface as an empty call, which the tool will refuse legibly */
        }
        return { id: c.id ?? '', name: c.function?.name ?? '', args };
      });
      return { text: msg.content ?? '', toolUses };
    },
    feed(results): void {
      for (const r of results) messages.push({ role: 'tool', tool_call_id: r.id, content: r.content });
    },
  };
}

/** Agent-capable providers in fallback order. Google's tool-calling is a third format — deferred. */
const AGENT_PROVIDERS = ['anthropic', 'openai'] as const;

async function runAgent(jobId: string, input: AgentInput): Promise<void> {
  const grants = input.grants ?? {};
  const tools = buildAgentTools(grants);
  const factKey = input.factKey ?? `agent/${jobId}`;
  const system =
    `You are an agent operating over the parc.land substrate — the workspace of facts owned by "${OWNER}". ` +
    `Use the substrate tools to ground your answer in actual facts; finish with a plain-text answer.` +
    (input.system ? `\n\n${input.system}` : '');

  const wanted: string[] = input.provider ? [input.provider] : [...AGENT_PROVIDERS];
  const candidates: Array<{ provider: string; rec: ProviderRec }> = [];
  for (const p of wanted) {
    if (!(AGENT_PROVIDERS as readonly string[]).includes(p)) throw new Error(`agent: provider "${p}" not supported (anthropic/openai)`);
    const rec = await getProvider(p);
    if (rec) candidates.push({ provider: p, rec });
  }
  if (!candidates.length) throw new Error(`agent: no agent-capable provider enabled — paste a key at /@${OWNER}/models/secrets`);

  const fallbacks: Array<{ provider: string; error: string }> = [];
  for (const { provider, rec } of candidates) {
    const adapter = provider === 'anthropic' ? anthropicAdapter(rec, input, system, tools) : openaiAdapter(rec, input, system, tools);
    try {
      await runAgentLoop(jobId, input, adapter, grants, factKey, fallbacks);
      return;
    } catch (err) {
      if (err instanceof FirstCallFailure) {
        fallbacks.push({ provider, error: err.message });
        continue;
      }
      throw err;
    }
  }
  throw new Error(`agent: every provider failed — ${fallbacks.map((f) => `${f.provider}: ${f.error}`).join(' | ')}`);
}

async function runAgentLoop(
  jobId: string,
  input: AgentInput,
  adapter: AgentAdapter,
  grants: AgentGrants,
  factKey: string,
  fallbacks: Array<{ provider: string; error: string }>,
): Promise<void> {
  const maxTurns = Math.min(Math.max(input.maxTurns ?? 8, 1), 16);
  const transcript: Array<Record<string, unknown>> = [
    { role: 'user', text: clip(input.prompt, 4000) },
    ...fallbacks.map((f) => ({ role: 'system', note: `provider ${f.provider} failed before any effect (${clip(f.error, 200)}) — fell back` })),
  ];
  let finalText = '';
  let toolCalls = 0;
  let turns = 0;

  for (; turns < maxTurns; turns++) {
    let turn: AgentTurn;
    try {
      turn = await adapter.call();
    } catch (err) {
      if (turns === 0) throw new FirstCallFailure((err as Error).message);
      throw err; // effects may exist — fail honestly rather than replay on another model
    }
    if (turn.text) finalText = turn.text;
    transcript.push({
      role: 'assistant',
      provider: adapter.provider,
      ...(turn.text ? { text: clip(turn.text, 4000) } : {}),
      ...(turn.toolUses.length ? { tools: turn.toolUses.map((t) => t.name) } : {}),
    });
    if (!turn.toolUses.length) break;

    const results: Array<{ id: string; content: string }> = [];
    for (const use of turn.toolUses) {
      toolCalls++;
      let out: unknown;
      try {
        out = await agentToolExec(use.name, use.args, grants);
      } catch (err) {
        out = { error: (err as Error).message };
      }
      const s = JSON.stringify(out);
      results.push({ id: use.id, content: clip(s, 16000) });
      transcript.push({ role: 'tool', tool: use.name, input: use.args, result: clip(s, 2000) });
    }
    adapter.feed(results);
  }
  if (!finalText) finalText = `[no final text — stopped after ${turns} turn(s)]`;

  // The outcome is facts: the run record, and the turn-by-turn transcript
  // beside it — queryable, linkable, placeable like anything else.
  const at = new Date().toISOString();
  await emitFact(
    factKey,
    {
      prompt: clip(input.prompt, 4000),
      result: finalText,
      provider: adapter.provider,
      model: adapter.model,
      ...(fallbacks.length ? { fallbacks } : {}),
      turns: turns + 1,
      toolCalls,
      transcriptKey: `${factKey}/transcript`,
      jobId,
      at,
    },
    'agent-run',
    ['agent', ...(input.tags ?? [])],
  );
  await emitFact(`${factKey}/transcript`, { jobId, at, turns: transcript }, 'transcript', ['agent', ...(input.tags ?? [])]);
  await putJob(jobId, { status: 'done', kind: 'agent', text: finalText, factKey, provider: adapter.provider, turns: turns + 1, toolCalls });
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
  const item = job.Item as { input?: RunInput; kind?: string } | undefined;
  const input = item?.input;
  if (!input) return;
  if (item?.kind === 'agent') {
    try {
      await runAgent(jobId, input as unknown as AgentInput);
    } catch (err) {
      await putJob(jobId, { status: 'error', kind: 'agent', input, error: (err as Error).message });
    }
    return;
  }
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
    name: 'agent',
    description:
      'Agentic model invocation: a tool-use loop with the substrate as its toolbox — substrate_query/substrate_read (the owner’s slice) and substrate_emit (organ-path write, provenance attested to this cell). Walks the enabled provider chain (anthropic → openai) and falls back when a provider fails before any effect; pin one with `provider`. Per-run `grants` NARROW within the cell’s standing: read defaults true, write defaults false; either may be a list of allowed key prefixes. Always async: returns {jobId, factKey}; the result lands as a substrate fact at factKey (type agent-run, recording provider/model/fallbacks) with the full transcript at factKey/transcript (type transcript). Poll fetch for {status, text, provider, turns, toolCalls}.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'The task' },
        system: { type: 'string', description: 'Appended to the substrate-agent system frame' },
        provider: { type: 'string', enum: ['anthropic', 'openai'], description: 'Pin one provider (default: enabled chain with first-call fallback)' },
        model: { type: 'string', description: 'Override the pinned/first provider’s configured text model' },
        maxTurns: { type: 'number', description: 'Model-call budget (default 8, cap 16)' },
        maxTokens: { type: 'number', description: 'Per-call output cap (default 4096)' },
        grants: {
          type: 'object',
          description: 'Scoped authority for this run, a subset of the cell’s standing: { read?: boolean|prefixes[] (default true), write?: boolean|prefixes[] (default false) }',
          properties: {
            read: { description: 'true, false, or allowed key prefixes' },
            write: { description: 'true, false, or allowed key prefixes' },
          },
          additionalProperties: false,
        },
        factKey: { type: 'string', description: 'Where the result fact lands (default agent/<jobId>)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Extra tags on the result + transcript facts' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch',
    description: 'Poll an async run: {status: pending|done|error, text?, imageB64?, mime?, error?}; agent jobs add {factKey, turns, toolCalls}.',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'decide',
    description:
      'Resolve a machine run\'s agent rail: read machine-run/<run> + its rails, choose one branch with the model, and write the decision back — a claim (the certificate of reasoning) + the run advance, which re-triggers the deterministic rails. When no provider is configured (or {defer:true}), instead expose the decision as a claimable `task/<run>.<node>` fact for any substrate agent (a human via the decide-<node> action, or an autonomous loop) to complete. Idempotent per node. Typically fired by a reactive machine\'s subscription, not called by hand.',
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'run id → machine-run/<run>' },
        defer: { type: 'boolean', description: 'force the claimable-task path even when a provider exists' },
      },
      required: ['run'],
      additionalProperties: false,
    },
  },
];

/* ── decide: resolve an agent rail ────────────────────────────────
 * The autonomous half of a machine's agent rail. Read the run + its rails,
 * and EITHER (a model is available) choose a branch and write the decision
 * back — a claim (the certificate of reasoning) + the run advance, which
 * re-triggers the deterministic rails — OR (no provider, or {defer:true})
 * expose the decision as a claimable `task/<run>.<node>` fact that any agent
 * over the substrate can pick up and complete. Idempotent per node. */

interface MachineArrow { from: string; to: string; arrow?: string; label?: string }
interface MachineNode { name: string; title?: string; kind?: string }

async function readFact<T = unknown>(key: string): Promise<T | null> {
  const res = await ddb.send(new GetCommand({ TableName: SUBSTRATE, Key: { pk: `STATE#${OWNER}`, sk: `KEY#${key}` } }));
  const item = res.Item as { value?: T; superseded?: boolean } | undefined;
  return item && !item.superseded ? (item.value as T) : null;
}

function extractJson(text: string): Record<string, unknown> | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

async function firstAgentProvider(): Promise<{ provider: 'anthropic' | 'openai'; rec: ProviderRec } | null> {
  for (const provider of ['anthropic', 'openai'] as const) {
    const rec = await getProvider(provider);
    if (rec) return { provider, rec };
  }
  return null;
}

async function openDecisionTask(run: string, machineName: string, node: string, title: string, branches: string[], reason: string, extra?: Record<string, unknown>): Promise<unknown> {
  if (await readFact(`task/${run}.${node}`)) return { task: true, status: 'already-open', run, node };
  await emitFact(
    `task/${run}.${node}`,
    { kind: 'decision', run, machine: machineName, node, title, branches, status: 'open', reason, createdAt: new Date().toISOString(), ...extra },
    'task',
    ['task', 'machine', `machine:${machineName}`],
  );
  return { task: true, run, node, branches, reason };
}

async function decide(args: Record<string, unknown>): Promise<unknown> {
  const run = String(args.run ?? '');
  if (!run) throw new Error('run is required');
  const defer = args.defer === true;

  const runFact = await readFact<{ machine?: string; node?: string; status?: string }>(`machine-run/${run}`);
  if (!runFact?.machine || !runFact.node) return { skipped: 'no-active-run', run };
  if (runFact.status === 'done') return { skipped: 'run-done', run };
  const node = runFact.node;
  const machineName = runFact.machine;

  // Idempotency: never decide a node twice (the run also advances past it, but a
  // race could double-deliver before the advance lands).
  if (await readFact(`claims/${run}.${node}`)) return { skipped: 'already-decided', run, node };

  const machine = await readFact<{ arrows?: MachineArrow[]; nodes?: MachineNode[]; title?: string }>(`machine/${machineName}`);
  if (!machine?.arrows) return { skipped: 'no-machine', machine: machineName };
  const branches = machine.arrows.filter((a) => a.from === node && a.arrow === '=>').map((a) => a.to);
  if (!branches.length) return { skipped: 'not-an-agent-node', node };

  const titleOf = (n: string) => machine.nodes?.find((x) => x.name === n)?.title ?? n;

  const found = defer ? null : await firstAgentProvider();
  if (!found) return openDecisionTask(run, machineName, node, titleOf(node), branches, defer ? 'deferred' : 'no-provider');

  const system =
    'You are resolving a decision point of a process running on the parc.land substrate. ' +
    'Choose exactly ONE branch. Respond with ONLY a JSON object: ' +
    '{"to": "<branch node name>", "statement": "<one sentence justification>", "confidence": <number 0..1>}.';
  const prompt =
    `Process: ${machine.title ?? machineName}\n` +
    `Current node: ${node} (${titleOf(node)})\n` +
    `Run state: ${JSON.stringify(runFact)}\n\n` +
    `Branches:\n${branches.map((b) => `- ${b}: ${titleOf(b)}`).join('\n')}\n\n` +
    'Pick the best branch by node name.';
  const out = found.provider === 'anthropic'
    ? await runAnthropic(found.rec, { prompt, system, mode: 'text', maxTokens: 512 })
    : await runOpenAI(found.rec, { prompt, system, mode: 'text', maxTokens: 512 });
  const parsed = extractJson(out.text ?? '');
  const to = parsed && typeof parsed.to === 'string' ? parsed.to : '';
  // Model didn't return a usable branch — leave a claimable task rather than guess.
  if (!branches.includes(to)) return openDecisionTask(run, machineName, node, titleOf(node), branches, 'model-uncertain', { modelText: out.text });

  const statement = parsed && typeof parsed.statement === 'string' ? parsed.statement : `Chose ${to}`;
  const confidence = parsed && typeof parsed.confidence === 'number' ? parsed.confidence : null;
  await emitFact(`claims/${run}.${node}`, { statement, chose: to, at: node, machine: machineName, confidence, by: `@${OWNER}/models` }, 'claim', ['claim', 'machine', `machine:${machineName}`]);
  await emitFact(`machine-run/${run}`, { node: to, at: new Date().toISOString(), machine: machineName, status: 'running', via: `${node}=>decide` }, 'machine-run', ['machine', `machine:${machineName}`]);
  return { decided: true, run, from: node, to, confidence, statement };
}

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
    const agent = item as { factKey?: string; turns?: number; toolCalls?: number };
    return {
      status: item.status,
      text: item.text,
      imageB64: item.imageB64,
      mime: item.mime,
      error: item.error,
      factKey: agent.factKey,
      turns: agent.turns,
      toolCalls: agent.toolCalls,
    };
  }
  if (name === 'decide') {
    return decide(args);
  }
  if (name === 'agent') {
    const input = args as unknown as AgentInput;
    if (!input.prompt) throw new Error('prompt is required');
    if (!SELF_FUNCTION) throw new Error('async unavailable: function name unknown');
    const jobId = randomUUID().slice(0, 13);
    const factKey = input.factKey ?? `agent/${jobId}`;
    await putJob(jobId, { status: 'pending', kind: 'agent', input: { ...input, factKey } });
    await lambda.send(new InvokeCommand({
      FunctionName: SELF_FUNCTION,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ __job: jobId })),
    }));
    return { jobId, status: 'pending', factKey, note: 'poll fetch for status; result + transcript land as substrate facts at factKey' };
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
