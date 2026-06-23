/* ---------------------------------------------------------------------------
 * machine — the SSR+hydrate React SPA (isomorphic).
 *
 * Rendered on BOTH sides: server-side via renderToString (the machine list,
 * seeded from ssr.json reads) and client-side via hydrateRoot. The kernel is
 * reached ONLY through ./bridge (no static kernel import) so the server bundle
 * stays kernel-free — the same discipline as cells/home. Drill-ins (machine
 * definition, runs, a run's trajectory + transcript) and triggering a run load
 * client-side via mcpCall (read/act over POST /mcp), exactly as an agent would.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { authFetch, isAuthed, login, completeLoginIfReturning } from './bridge';

const { useState, useEffect, useCallback } = React;

/* ── types ──────────────────────────────────────────────────────────────── */

export interface Session { user: string | null }
export interface Entry { key: string; value: Record<string, unknown> }
export interface Boot {
  session: Session;
  machines: Entry[];
  runs: Entry[];
}

interface Rail { from: string; to: string; mode: string; condition?: string; prompt?: string; tools?: string[]; scope?: unknown; grants?: unknown; maxTurns?: number }
interface Node { name: string; kind?: string; title?: string }
interface MachineVal { title?: string; nodes?: Node[]; arrows?: Array<{ from: string; arrow: string; to: string }>; rails?: Rail[]; context?: string[] }
interface RunVal { machine?: string; node?: string; status?: string; via?: string; at?: string; startedAt?: string; reason?: string }

/* ── theme ──────────────────────────────────────────────────────────────── */

const C = {
  bg: '#f3edde', panel: '#fbfbf8', ink: '#1c1c1a', mut: '#8a8a82', line: '#e4e4dc',
  green: '#2f6f4f', amber: '#b07a1a', red: '#7a1f1f', blue: '#2f5f8f',
  mono: 'ui-monospace,SFMono-Regular,Menlo,monospace',
};
const statusColor = (s?: string): string =>
  s === 'done' ? C.green : s === 'running' ? C.blue : s === 'awaiting-decision' ? C.amber : C.mut;

/* ── gateway calls (read/act over /mcp, the way the agent does) ───────────── */

async function mcpCall(verb: 'read' | 'act', target: string, input?: unknown): Promise<{ ok: boolean; value: unknown }> {
  const res = await authFetch('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: verb, arguments: input === undefined ? { target } : { target, input } } }),
  });
  if (!res.ok) return { ok: false, value: `HTTP ${res.status}` };
  const rpc = (await res.json()) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } };
  if (rpc.error) return { ok: false, value: rpc.error.message ?? 'error' };
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value: unknown = text;
  try { value = JSON.parse(text); } catch { /* keep raw */ }
  return { ok: !rpc.result?.isError, value };
}
const entriesOf = (v: unknown): Entry[] => ((v as { entries?: Entry[] } | undefined)?.entries ?? []);

/* ── helpers ────────────────────────────────────────────────────────────── */

const mName = (key: string): string => key.replace(/^machine\//, '');
const rId = (key: string): string => key.replace(/^machine-run\//, '');
const useHash = (): string => {
  const [h, setH] = useState<string>(typeof location !== 'undefined' ? location.hash : '');
  useEffect(() => {
    const on = (): void => setH(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
};

/* ── small UI atoms ─────────────────────────────────────────────────────── */

function Badge({ text, color }: { text: string; color: string }): React.ReactElement {
  return <span style={{ background: color, color: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>;
}
function Card({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): React.ReactElement {
  return (
    <div onClick={onClick}
      style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', cursor: onClick ? 'pointer' : 'default', display: 'grid', gap: 6 }}>
      {children}
    </div>
  );
}
const railArrow: Record<string, string> = { auto: '→', agent: '⇒', task: '⤳', work: '⇶' };

/* ── views ──────────────────────────────────────────────────────────────── */

function SignInCard(): React.ReactElement {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '16px', display: 'grid', gap: 10, justifyItems: 'start' }}>
      <div style={{ color: C.mut }}>Sign in to see your machines, their runs, and to trigger one.</div>
      <button onClick={() => void login()}
        style={{ border: `1px solid ${C.green}`, background: C.green, color: '#fff', borderRadius: 8, padding: '9px 18px', font: '600 14px inherit', cursor: 'pointer' }}>
        Sign in
      </button>
    </div>
  );
}

function ListView({ machines, runs, authed }: { machines: Entry[]; runs: Entry[]; authed: boolean }): React.ReactElement {
  const runsByMachine = new Map<string, Entry[]>();
  for (const r of runs) {
    const m = (r.value as RunVal).machine ?? '';
    (runsByMachine.get(m) ?? runsByMachine.set(m, []).get(m)!).push(r);
  }
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, font: '600 15px/1 Georgia,serif', color: C.mut }}>Machines</h2>
        {machines.length === 0 && (authed ? <p style={{ color: C.mut }}>No machines defined yet.</p> : <SignInCard />)}
        {machines.map((m) => {
          const v = m.value as MachineVal;
          const runs = runsByMachine.get(mName(m.key)) ?? [];
          const last = runs[0]?.value as RunVal | undefined;
          return (
            <Card key={m.key} onClick={() => { location.hash = `#/m/${mName(m.key)}`; }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ font: '600 16px Georgia,serif', flex: 1 }}>{v.title ?? mName(m.key)}</strong>
                {last && <Badge text={last.status ?? '—'} color={statusColor(last.status)} />}
              </div>
              <div style={{ color: C.mut, fontSize: 12 }}>
                <code style={{ fontFamily: C.mono }}>{m.key}</code> · {(v.nodes ?? []).length} nodes · {(v.rails ?? []).length} rails · {runs.length} run{runs.length === 1 ? '' : 's'}
              </div>
            </Card>
          );
        })}
      </section>
      {runs.length > 0 && <section style={{ display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, font: '600 15px/1 Georgia,serif', color: C.mut }}>Recent runs</h2>
        {runs.slice(0, 24).map((r) => {
          const v = r.value as RunVal;
          return (
            <div key={r.key} onClick={() => { location.hash = `#/r/${encodeURIComponent(rId(r.key))}`; }}
              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, cursor: 'pointer' }}>
              <Badge text={v.status ?? '—'} color={statusColor(v.status)} />
              <span style={{ fontWeight: 600 }}>{v.machine}</span>
              <span style={{ color: C.mut }}>· {v.node}</span>
              <code style={{ marginLeft: 'auto', color: C.mut, fontSize: 11, fontFamily: C.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40%' }}>{rId(r.key)}</code>
            </div>
          );
        })}
      </section>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <div style={{ display: 'grid', gap: 2 }}><span style={{ color: C.mut, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span><div>{children}</div></div>;
}

function MachineView({ name, machines, seedRuns }: { name: string; machines: Entry[]; seedRuns: Entry[] }): React.ReactElement {
  const seed = machines.find((m) => mName(m.key) === name);
  const [m, setM] = useState<MachineVal | undefined>(seed?.value as MachineVal | undefined);
  const [runs, setRuns] = useState<Entry[]>(seedRuns.filter((r) => (r.value as RunVal).machine === name));
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [mv, rv] = await Promise.all([
      mcpCall('read', 'workspace.peek', { key: `machine/${name}` }),
      mcpCall('read', 'workspace.query', { type: 'machine-run', rankBy: 'recency', limit: 60 }),
    ]);
    if (mv.ok && mv.value) setM((mv.value as { value?: MachineVal }).value ?? (mv.value as MachineVal));
    if (rv.ok) setRuns(entriesOf(rv.value).filter((r) => (r.value as RunVal).machine === name));
  }, [name]);
  useEffect(() => { void refresh(); }, [refresh]);

  const trigger = async (): Promise<void> => {
    const run = `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    setBusy(run);
    const r = await mcpCall('act', 'workspace.invoke', { action: `machine.${name}.start`, params: { run } });
    setBusy(null);
    if (r.ok) location.hash = `#/r/${encodeURIComponent(run)}`;
    else alert(`Trigger failed: ${typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}`);
  };

  if (!m) return <p style={{ color: C.mut }}>Machine “{name}” not found. <a href="#/">Back</a></p>;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <a href="#/" style={{ color: C.mut, textDecoration: 'none' }}>‹ machines</a>
        <strong style={{ font: '600 19px Georgia,serif', flex: 1 }}>{m.title ?? name}</strong>
        {isAuthed()
          ? <button onClick={() => void trigger()} disabled={!!busy}
              style={{ border: `1px solid ${C.green}`, background: C.green, color: '#fff', borderRadius: 8, padding: '7px 14px', font: 'inherit', cursor: 'pointer' }}>
              {busy ? 'Starting…' : '▶ Trigger run'}</button>
          : <button onClick={() => void login()} style={{ border: `1px solid ${C.green}`, background: 'transparent', color: C.green, borderRadius: 8, padding: '7px 14px', font: 'inherit', cursor: 'pointer' }}>Sign in to trigger</button>}
      </div>

      <Field label="Rails (the executable transitions)">
        <div style={{ display: 'grid', gap: 6 }}>
          {(m.rails ?? []).map((r, i) => (
            <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{r.from}</strong>
                <span title={r.mode} style={{ color: C.mut }}>{railArrow[r.mode] ?? '→'}</span>
                <strong>{r.to}</strong>
                <Badge text={r.mode} color={r.mode === 'agent' || r.mode === 'work' ? C.green : r.mode === 'task' ? C.amber : C.mut} />
                {Array.isArray(r.tools) && r.tools.length > 0 && <span style={{ color: C.mut, fontSize: 11 }}>tools: {r.tools.join(', ')}</span>}
              </div>
              {r.prompt && <div style={{ color: C.mut, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'auto' }}>{r.prompt}</div>}
            </div>
          ))}
        </div>
      </Field>

      <Field label="Nodes">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(m.nodes ?? []).map((n) => (
            <span key={n.name} title={n.title} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: '4px 9px', fontSize: 12 }}>
              <strong>{n.name}</strong>{n.kind ? <span style={{ color: C.mut }}> · {n.kind}</span> : null}
            </span>
          ))}
        </div>
      </Field>

      <Field label={`Runs (${runs.length})`}>
        <div style={{ display: 'grid', gap: 6 }}>
          {runs.length === 0 && <span style={{ color: C.mut }}>No runs yet.</span>}
          {runs.map((r) => {
            const v = r.value as RunVal;
            return (
              <div key={r.key} onClick={() => { location.hash = `#/r/${encodeURIComponent(rId(r.key))}`; }}
                style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, cursor: 'pointer' }}>
                <Badge text={v.status ?? '—'} color={statusColor(v.status)} />
                <span>{v.node}</span>
                <code style={{ marginLeft: 'auto', color: C.mut, fontSize: 11, fontFamily: C.mono }}>{rId(r.key)}</code>
              </div>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

function RunView({ run }: { run: string }): React.ReactElement {
  const [fact, setFact] = useState<RunVal | null>(null);
  const [claims, setClaims] = useState<Entry[]>([]);
  const [transcript, setTranscript] = useState<Array<Record<string, unknown>> | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const rf = await mcpCall('read', 'workspace.peek', { key: `machine-run/${run}` });
    const val = rf.ok ? ((rf.value as { value?: RunVal } | null)?.value ?? null) : null;
    setFact(val);
    const cl = await mcpCall('read', 'workspace.query', { prefix: `claims/${run}.`, limit: 20 });
    setClaims(cl.ok ? entriesOf(cl.value) : []);
    if (val?.machine) {
      const t = await mcpCall('read', 'workspace.peek', { key: `machine-work/${val.machine}.${run}/transcript` });
      const tv = t.ok ? ((t.value as { value?: { turns?: Array<Record<string, unknown>> } } | null)?.value?.turns ?? null) : null;
      setTranscript(tv);
    }
    setLoading(false);
  }, [run]);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <a href={fact?.machine ? `#/m/${fact.machine}` : '#/'} style={{ color: C.mut, textDecoration: 'none' }}>‹ back</a>
        <strong style={{ font: '600 17px Georgia,serif', flex: 1 }}>Run <code style={{ fontFamily: C.mono, fontSize: 14 }}>{run}</code></strong>
        <button onClick={() => void refresh()} style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: 8, padding: '6px 12px', font: 'inherit', cursor: 'pointer' }}>↻</button>
      </div>
      {loading && !fact && <p style={{ color: C.mut }}>Loading…</p>}
      {fact && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Field label="machine"><strong>{fact.machine}</strong></Field>
          <Field label="node"><strong>{fact.node}</strong></Field>
          <Field label="status"><Badge text={fact.status ?? '—'} color={statusColor(fact.status)} /></Field>
          {fact.via && <Field label="via"><code style={{ fontFamily: C.mono, fontSize: 12 }}>{fact.via}</code></Field>}
        </div>
      )}

      <Field label="Trajectory (claims — the certificate of reasoning)">
        <div style={{ display: 'grid', gap: 6 }}>
          {claims.length === 0 && <span style={{ color: C.mut }}>No decisions recorded yet.</span>}
          {claims.map((c) => {
            const v = c.value as { at?: string; chose?: string; statement?: string; confidence?: number };
            return (
              <div key={c.key} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', display: 'grid', gap: 3 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong>{v.at}</strong><span style={{ color: C.mut }}>⇒</span><strong>{v.chose}</strong>
                  {typeof v.confidence === 'number' && <span style={{ marginLeft: 'auto', color: C.mut, fontSize: 12 }}>conf {v.confidence.toFixed(2)}</span>}
                </div>
                {v.statement && <div style={{ color: C.ink, fontSize: 13 }}>{v.statement}</div>}
              </div>
            );
          })}
        </div>
      </Field>

      {transcript && transcript.length > 0 && (
        <Field label="Agent transcript (logs)">
          <div style={{ display: 'grid', gap: 4 }}>
            {transcript.map((t, i) => {
              const tool = t.tool as string | undefined;
              const label = tool ? `tool:${tool}` : String(t.role ?? (t.note ? 'system' : 'turn'));
              const raw = typeof t.text === 'string' ? t.text
                : typeof t.note === 'string' ? t.note
                : typeof t.result === 'string' ? t.result
                : Array.isArray(t.tools) ? `tools: ${(t.tools as string[]).join(', ')}`
                : '';
              return (
                <div key={i} style={{ borderLeft: `2px solid ${tool ? C.blue : C.line}`, padding: '2px 8px', fontSize: 12 }}>
                  <span style={{ color: C.mut, fontFamily: C.mono }}>{label}</span>
                  <div style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>{raw}</div>
                </div>
              );
            })}
          </div>
        </Field>
      )}

      {fact && (
        <details>
          <summary style={{ color: C.mut, cursor: 'pointer' }}>raw run fact</summary>
          <pre style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: 10, overflow: 'auto', fontSize: 12 }}>{JSON.stringify(fact, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/* ── root ───────────────────────────────────────────────────────────────── */

export function App({ initial }: { initial?: Boot }): React.ReactElement {
  const boot: Boot = initial ?? { session: { user: null }, machines: [], runs: [] };
  const hash = useHash();
  // Initialise from the SSR seed so the first client render matches the server
  // (no hydration mismatch); the effect below reconciles with the real session.
  const [authed, setAuthed] = useState<boolean>(!!boot.session.user);
  const [user] = useState<string | null>(boot.session.user);
  const [machines, setMachines] = useState<Entry[]>(boot.machines);
  const [runs, setRuns] = useState<Entry[]>(boot.runs);

  const loadData = useCallback(async () => {
    const [mv, rv] = await Promise.all([
      mcpCall('read', 'workspace.query', { type: 'machine', limit: 100 }),
      mcpCall('read', 'workspace.query', { type: 'machine-run', rankBy: 'recency', limit: 60 }),
    ]);
    if (mv.ok) setMachines(entriesOf(mv.value).filter((e) => !String(e.key).startsWith('_')));
    if (rv.ok) setRuns(entriesOf(rv.value));
  }, []);

  useEffect(() => {
    // The cell subdomain is its own origin — the session cookie lands here only
    // after a sign-in completes on this host. Finish a returning OAuth redirect,
    // reflect auth, and (when the SSR seed was the anonymous shell) load the data.
    void (async () => {
      let ok = isAuthed();
      try { ok = await completeLoginIfReturning(); } catch { /* keep isAuthed() */ }
      setAuthed(ok);
      if (ok && machines.length === 0) await loadData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body: React.ReactElement;
  const mMatch = /^#\/m\/(.+)$/.exec(hash);
  const rMatch = /^#\/r\/(.+)$/.exec(hash);
  if (mMatch) body = <MachineView name={decodeURIComponent(mMatch[1])} machines={machines} seedRuns={runs} />;
  else if (rMatch) body = <RunView run={decodeURIComponent(rMatch[1])} />;
  else body = <ListView machines={machines} runs={runs} authed={authed} />;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink }}>
      <header style={{ padding: '14px 16px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 10, alignItems: 'center' }}>
        <a href="#/" style={{ textDecoration: 'none', color: C.ink }}><strong style={{ font: '700 18px Georgia,serif' }}>🔄 machines</strong></a>
        <span style={{ color: C.mut, fontSize: 12 }}>@c15r/machine</span>
        {authed
          ? <span style={{ marginLeft: 'auto', color: C.mut, fontSize: 12 }}>{user ?? 'signed in'}</span>
          : <button onClick={() => void login()}
              style={{ marginLeft: 'auto', border: `1px solid ${C.green}`, background: C.green, color: '#fff', borderRadius: 8, padding: '6px 14px', font: '600 13px inherit', cursor: 'pointer' }}>
              Sign in</button>}
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '16px 14px 48px' }}>{body}</main>
    </div>
  );
}
