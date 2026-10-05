/* ---------------------------------------------------------------------------
 * Reads are anonymous GETs against this cell's public API (/api/*). Writes go
 * through the /mcp gateway as the signed-in caller — the same tools an agent
 * uses — so the page can do nothing an MCP client couldn't.
 * ------------------------------------------------------------------------- */
import { ensureAuth, isAuthed, mcp } from './auth';

const BASE = '/@c15r/playtest';
const TARGET = '@c15r/playtest';

export async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}/api/${path}`, { headers: { accept: 'application/json' } });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  return body as T;
}

export const authed = (): boolean => {
  try {
    return isAuthed();
  } catch {
    return false;
  }
};

/** Identity-only sign-in: the page calls this cell's tools and nothing else. */
export async function signIn(): Promise<boolean> {
  await ensureAuth({ identity: true });
  return authed();
}

async function call(kind: 'read' | 'act', tool: string, input: Record<string, unknown>): Promise<any> {
  const r = await mcp(kind, `${TARGET}.${tool}`, input);
  if (!r.ok) {
    const raw = typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
    const status = Number(raw.match(/HTTP (\d{3})/)?.[1] ?? 0);
    throw new Error(status === 401 ? 'sign in first' : status === 403 || /not (granted|authori[sz]ed)|forbidden/i.test(raw) ? 'this account is not granted @c15r/playtest' : raw);
  }
  const v = r.value as { error?: string } | undefined;
  if (v && typeof v === 'object' && 'error' in v && v.error) throw new Error(v.error);
  return r.value;
}
export const act = (tool: string, input: Record<string, unknown>) => call('act', tool, input);
export const read = (tool: string, input: Record<string, unknown>) => call('read', tool, input);

export interface JobState {
  status: 'pending' | 'running' | 'done' | 'error';
  out?: any;
  error?: string;
  tool?: string;
}

/** Start a tool that may answer inline or with {job}; poll the job to the end. */
export async function runJob(tool: string, input: Record<string, unknown>, onState: (s: JobState & { id?: string; elapsed: number }) => void): Promise<any> {
  const t0 = Date.now();
  const first = await act(tool, input);
  if (!first || typeof first !== 'object' || !('job' in first)) {
    onState({ status: 'done', out: first, elapsed: Date.now() - t0 });
    return first;
  }
  const id = String(first.job);
  onState({ status: 'pending', id, elapsed: 0 });
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = (await read('job', { id })) as JobState;
    onState({ ...s, id, elapsed: Date.now() - t0 });
    if (s.status === 'done') return s.out;
    if (s.status === 'error') throw new Error(s.error ?? 'job failed');
  }
}
