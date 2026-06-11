/**
 * Substrate client — the canvas speaks `read`/`act` to /mcp exactly as an
 * agent does (one vocabulary, two modalities). Ported from home's console.
 */
import { authFetch } from './auth.ts';

export interface McpOutcome {
  ok: boolean;
  value: unknown;
}

export async function mcp(verb: 'read' | 'act', target: string, input?: unknown): Promise<McpOutcome> {
  const res = await authFetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: verb, arguments: input === undefined ? { target } : { target, input } },
    }),
  });
  if (!res.ok) return { ok: false, value: `HTTP ${res.status}` };
  const rpc = (await res.json()) as {
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
    error?: { message?: string };
  };
  if (rpc.error) return { ok: false, value: rpc.error.message ?? 'error' };
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value: unknown = text;
  try {
    value = JSON.parse(text);
  } catch { /* not JSON — keep the raw text */ }
  return { ok: !rpc.result?.isError, value };
}

/** `read` a capability; throws on a tool error. */
export async function read<T = unknown>(target: string, input?: unknown): Promise<T> {
  const r = await mcp('read', target, input);
  if (!r.ok) throw new Error(typeof r.value === 'string' ? r.value : JSON.stringify(r.value));
  return r.value as T;
}

/** `act` on a capability; throws on a tool error. */
export async function act<T = unknown>(target: string, input?: unknown): Promise<T> {
  const r = await mcp('act', target, input);
  if (!r.ok) throw new Error(typeof r.value === 'string' ? r.value : JSON.stringify(r.value));
  return r.value as T;
}
