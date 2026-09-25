/* ---------------------------------------------------------------------------
 * The one seam every experiment calls: decide(state, questions) → answers,
 * plus a trace of every call (latency, questions, tokens) for the instrument
 * strip. Transport: the kernel's /mcp client → `act @c15r/jev.decide`.
 *
 * Not a direct POST to /@c15r/jev/_tools/decide: browsers are redirected to
 * the cell's own origin (c15r-jev.on.parc.land, docs/cell-origin-isolation.md),
 * where the kernel sends API calls to the apex cross-origin — and only /mcp
 * answers CORS there. The direct POST was preflight-blocked ("Load failed" in
 * Safari). The gateway admits only the owner or a granted caller, so a public
 * page never spends the budget for strangers.
 * ------------------------------------------------------------------------- */
import { ensureAuth, isAuthed, mcp } from './auth';
import type { Answers, Questions } from './types';

export const CELL_TARGET = '@c15r/jev';
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

/** Identity-only sign-in (`cell:c15r/jev:*`, docs/auth-in-page.md): the lab calls
 *  Jev and nothing else, so it never asks for workspace authority. */
export async function signIn(): Promise<boolean> {
  await ensureAuth({ identity: true });
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
    if (signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    const r = await mcp('act', `${CELL_TARGET}.decide`, { state, questions });
    const ms = Math.round(performance.now() - t0);
    const body = (r.ok && r.value && typeof r.value === 'object' ? r.value : {}) as { answers?: Answers; usage?: { input_tokens?: number } };
    if (!r.ok || !body.answers) {
      const raw = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
      const status = Number(raw.match(/HTTP (\d{3})/)?.[1] ?? 0);
      const msg =
        status === 401 ? 'sign in to run experiments' : status === 403 || /not (granted|authori[sz]ed)|forbidden/i.test(raw) ? 'this account is not granted @c15r/jev' : raw || 'no answers';
      record({ id, label, questions: n, ms, tokens: 0, ok: false, error: msg, at: Date.now() });
      throw new JevError(msg, status);
    }
    const tokens = body.usage?.input_tokens ?? 0;
    record({ id, label, questions: n, ms, tokens, ok: true, at: Date.now() });
    return { answers: body.answers ?? {}, ms, tokens };
  } catch (err) {
    if (err instanceof JevError) throw err;
    const ms = Math.round(performance.now() - t0);
    const e = err as Error;
    const msg = e.name === 'AbortError' ? 'stopped' : /load failed|failed to fetch|networkerror/i.test(e.message) ? `network error reaching Jev (${e.message})` : e.message;
    record({ id, label, questions: n, ms, tokens: 0, ok: false, error: msg, at: Date.now() });
    throw new JevError(msg, 0);
  }
}
