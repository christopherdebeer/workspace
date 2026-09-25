/* ---------------------------------------------------------------------------
 * The one seam every experiment calls: decide(state, questions) → answers,
 * plus a trace of every call (latency, questions, tokens) for the instrument
 * strip. Transport: a same-origin POST to this cell's own /_tools/decide via
 * dispatch, carrying the kernel session — one hop fewer than the /mcp gateway.
 * Dispatch refuses anonymous POSTs and cells.call admits only the owner or a
 * granted caller, so a public page never spends the budget for strangers.
 * ------------------------------------------------------------------------- */
import { authFetch, ensureAuth, isAuthed } from './auth';
import type { Answers, Questions } from './types';

export const CELL_BASE = '/@c15r/jev';
/** ~$0.042 per million input tokens (TypeSafe list price). */
export const USD_PER_TOKEN = 0.042e-6;

export interface CallTrace {
  id: number;
  label: string;
  questions: number;
  ms: number;
  tokens: number;
  ok: boolean;
  error?: string;
  at: number;
}

type Listener = (traces: CallTrace[]) => void;
let traces: CallTrace[] = [];
const listeners = new Set<Listener>();
let seq = 0;

export function onTrace(fn: Listener): () => void {
  listeners.add(fn);
  fn(traces);
  return () => listeners.delete(fn);
}
export function clearTrace(): void {
  traces = [];
  listeners.forEach((l) => l(traces));
}
function record(t: CallTrace): void {
  traces = [...traces.slice(-199), t];
  listeners.forEach((l) => l(traces));
}

export class JevError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function signIn(): Promise<boolean> {
  await ensureAuth();
  return isAuthed();
}

export interface Decided {
  answers: Answers;
  ms: number;
  tokens: number;
}

/** One Jev pass: every question in `questions` is answered in parallel. */
export async function decide(state: unknown, questions: Questions, label = 'decide', signal?: AbortSignal): Promise<Decided> {
  const id = ++seq;
  const n = Object.keys(questions).length;
  const t0 = performance.now();
  try {
    const res = await authFetch(`${CELL_BASE}/_tools/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state, questions }),
      signal,
    });
    const body = (await res.json().catch(() => ({}))) as { answers?: Answers; usage?: { input_tokens?: number }; error?: string };
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      const msg =
        res.status === 401 ? 'sign in to run experiments' : res.status === 403 ? 'this account is not granted @c15r/jev' : body.error ?? `HTTP ${res.status}`;
      record({ id, label, questions: n, ms, tokens: 0, ok: false, error: msg, at: Date.now() });
      throw new JevError(msg, res.status);
    }
    const tokens = body.usage?.input_tokens ?? 0;
    record({ id, label, questions: n, ms, tokens, ok: true, at: Date.now() });
    return { answers: body.answers ?? {}, ms, tokens };
  } catch (err) {
    if (err instanceof JevError) throw err;
    const ms = Math.round(performance.now() - t0);
    const msg = (err as Error).name === 'AbortError' ? 'stopped' : (err as Error).message;
    record({ id, label, questions: n, ms, tokens: 0, ok: false, error: msg, at: Date.now() });
    throw new JevError(msg, 0);
  }
}
