/* ---------------------------------------------------------------------------
 * machine — the SSR+hydrate React SPA (isomorphic), graph-first.
 *
 * A machine is DECOMPOSED (ADR-0003/0016): an identity fact `machine/<name>` +
 * `machine-node/*` + `machine-rail/*` facts, all under `machine/<name>/`. This UI
 * ASSEMBLES that into a graph and makes the graph the hero — the machine drawn as
 * a diagram, and a run drawn as the SAME diagram with its taken path overlaid +
 * an ordered step timeline (from the run's `trace`). Loading is always indicated
 * (skeletons + a "rendering…" diagram state), never a long blank.
 *
 * The kernel is reached ONLY through ./bridge (no static kernel import) so the
 * server bundle stays kernel-free. Drill-ins load client-side via mcpCall.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { authFetch, isAuthed, login, completeLoginIfReturning } from './bridge';

const { useState, useEffect, useCallback } = React;

/* ── types ──────────────────────────────────────────────────────────────── */

export interface Session { user: string | null }
export interface Entry { key: string; value: Record<string, unknown> }
export interface Boot { session: Session; machines: Entry[]; nodes: Entry[]; rails: Entry[]; runs: Entry[] }

interface Rail { from: string; to: string; mode: string; when?: string; condition?: string; prompt?: string; tools?: string[]; sections?: Array<{ to: string; when?: string }>; branch?: string; samples?: number }
interface Node { name: string; kind?: string; title?: string }
interface MachineVal { title?: string; entry?: string; nodes?: Node[]; rails?: Rail[]; context?: string[] }
interface TraceStep { node: string; via?: string; at?: string }
interface RunVal { machine?: string; node?: string; status?: string; via?: string; at?: string; trace?: TraceStep[]; reason?: string }

/* ── theme ──────────────────────────────────────────────────────────────── */

const C = {
  bg: '#f3edde', panel: '#fbfbf8', ink: '#1c1c1a', mut: '#8a8a82', line: '#e4e4dc',
  green: '#2f6f4f', amber: '#b07a1a', red: '#7a1f1f', blue: '#2f5f8f',
  mono: 'ui-monospace,SFMono-Regular,Menlo,monospace',
};
const statusColor = (s?: string): string =>
  s === 'done' ? C.green : s === 'running' || s === 'sectioning' || s === 'voting' ? C.blue
    : s === 'awaiting-decision' ? C.amber : s === 'blocked' ? C.red : C.mut;

/* ── gateway calls (read/act over /mcp, the way the agent does) ───────────── */

async function mcpCall(verb: 'read' | 'act', target: string, input?: unknown): Promise<{ ok: boolean; value: unknown }> {
  const res = await authFetch('/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
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
const valueOf = <T,>(v: unknown): T | null => (v && typeof v === 'object' && 'value' in (v as object) ? ((v as { value?: T }).value ?? null) : (v as T)) ?? null;

/* ── decomposed-machine helpers ───────────────────────────────────────────
 * Keys nest under machine/<name>/ : identity `machine/<name>`, nodes
 * `…/node/<n>`, rails `…/rail/<from>~<to>`, runs `…/run/<run>` (children `…§X`/`…#i`). */

const idName = (key: string): string => key.slice('machine/'.length);                     // identity key → name
const SEP = /[§#]/;
const runMachine = (key: string): string => /^machine\/([^/]+)\/run\//.exec(key)?.[1] ?? '';
const runIdOf = (key: string): string => key.split('/run/')[1] ?? key;                     // "1" or "1§X"
const baseRunId = (rid: string): string => rid.split(SEP)[0];
const childSuffix = (rid: string): string | null => { const i = rid.search(SEP); return i < 0 ? null : rid.slice(i + 1); };
const parentRunKey = (key: string): string => `machine/${runMachine(key)}/run/${baseRunId(runIdOf(key))}`;
const runKeyOf = (machine: string, run: string): string => `machine/${machine}/run/${run}`;

/** Assemble a machine's {title, entry, nodes, rails} from its decomposed facts. */
function assemble(identity: Entry | undefined, allNodes: Entry[], allRails: Entry[]): MachineVal | null {
  if (!identity) return null;
  const name = idName(identity.key);
  const v = identity.value as MachineVal;
  const nodes = allNodes.filter((f) => (f.value as { machine?: string }).machine === name).map((f) => f.value as Node);
  const rails = allRails.filter((f) => (f.value as { machine?: string }).machine === name).map((f) => f.value as Rail);
  return { title: v.title, entry: v.entry, context: v.context, nodes, rails };
}

interface RunGroup { key: string; id: string; parent?: Entry; children: Entry[] }
/** Unify run facts into parent+children groups, keyed by the parent run KEY. */
function groupRuns(entries: Entry[]): RunGroup[] {
  const order: string[] = [];
  const map = new Map<string, RunGroup>();
  for (const e of entries) {
    const pk = parentRunKey(e.key);
    let g = map.get(pk);
    if (!g) { g = { key: pk, id: baseRunId(runIdOf(e.key)), children: [] }; map.set(pk, g); order.push(pk); }
    if (childSuffix(runIdOf(e.key))) g.children.push(e); else g.parent = e;
  }
  for (const g of map.values()) g.children.sort((a, b) => (childSuffix(runIdOf(a.key)) ?? '').localeCompare(childSuffix(runIdOf(b.key)) ?? ''));
  return order.map((id) => map.get(id)!);
}
function groupStatus(g: RunGroup): string {
  const p = g.parent?.value as RunVal | undefined;
  if (p?.status) return p.status;
  if (g.children.length && g.children.every((c) => (c.value as RunVal).status === 'done')) return 'done';
  return g.children.length ? 'running' : '—';
}
const useHash = (): string => {
  const [h, setH] = useState<string>(typeof location !== 'undefined' ? location.hash : '');
  useEffect(() => { const on = (): void => setH(location.hash); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return h;
};

/* ── small UI atoms ─────────────────────────────────────────────────────── */

function Badge({ text, color }: { text: string; color: string }): React.ReactElement {
  return <span style={{ background: color, color: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>;
}
function Card({ children, onClick }: { children: React.ReactNode; onClick?: () => void }): React.ReactElement {
  return <div onClick={onClick} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px', cursor: onClick ? 'pointer' : 'default', display: 'grid', gap: 8 }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <div style={{ display: 'grid', gap: 4 }}><span style={{ color: C.mut, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span><div>{children}</div></div>;
}
/** A shimmering placeholder — shown wherever data is loading, so a view is never a long blank. */
function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }): React.ReactElement {
  return <div style={{ height: h, width: w, borderRadius: 7, background: `linear-gradient(90deg, ${C.line} 25%, #eee 50%, ${C.line} 75%)`, backgroundSize: '400% 100%', animation: 'msk 1.2s ease-in-out infinite' }} />;
}
const SKELETON_CSS = '@keyframes msk{0%{background-position:100% 0}100%{background-position:0 0}}';
const railArrow: Record<string, string> = { auto: '→', agent: '⇒', task: '⤳', work: '⇶', section: '⛓', vote: '🗳' };
const railColor = (m: string): string => (m === 'agent' || m === 'work' ? C.green : m === 'task' ? C.amber : m === 'section' || m === 'vote' ? C.blue : C.mut);

function RunGroupRow({ group, showMachine }: { group: RunGroup; showMachine?: boolean }): React.ReactElement {
  const p = group.parent?.value as RunVal | undefined;
  const status = groupStatus(group);
  return (
    <div onClick={() => { location.hash = `#/r/${encodeURIComponent(group.key)}`; }}
      style={{ display: 'grid', gap: 6, padding: '8px 12px', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, cursor: 'pointer' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Badge text={status} color={statusColor(status)} />
        {showMachine && p?.machine && <span style={{ fontWeight: 600 }}>{p.machine}</span>}
        {p && <span style={{ color: C.mut }}>· {p.node}</span>}
        {group.children.length > 0 && <span style={{ color: C.mut, fontSize: 11 }}>· {group.children.length} branch{group.children.length === 1 ? '' : 'es'}</span>}
        <code style={{ marginLeft: 'auto', color: C.mut, fontSize: 11, fontFamily: C.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '42%' }}>{group.id}</code>
      </div>
      {group.children.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 2 }}>
          {group.children.map((c) => {
            const cv = c.value as RunVal; const sfx = childSuffix(runIdOf(c.key)) ?? '';
            return (
              <span key={c.key} title={`${sfx} @ ${cv.node} (${cv.status})`} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 11, color: C.mut, border: `1px solid ${C.line}`, borderRadius: 7, padding: '2px 7px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor(cv.status), flex: 'none' }} />
                <strong style={{ color: C.ink }}>{sfx}</strong> {cv.node}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── mermaid (the machine drawn as a diagram, run overlaid) ──────────────── */

const sid = (s: string): string => String(s || 'n').replace(/[^A-Za-z0-9_]/g, '_');
interface Highlight { active?: string; visited?: string[]; done?: boolean; taken?: Set<string> }
function toMermaid(m: MachineVal, hl?: Highlight): string {
  const esc = (s: string): string => String(s).replace(/["|]/g, "'").replace(/\n/g, ' ');
  const lines = ['graph TD'];
  for (const n of m.nodes ?? []) lines.push(`  ${sid(n.name)}["${esc(n.title || n.name)}"]`);
  const edges = (m.rails ?? []).map((r) => ({ from: r.from, to: r.to, label: r.mode }));
  edges.forEach((e) => lines.push(`  ${sid(e.from)} -->|${esc(e.label)}| ${sid(e.to)}`));
  if (hl) {
    lines.push(`  classDef active fill:${C.blue},stroke:${C.ink},color:#fff,stroke-width:2px;`);
    lines.push(`  classDef done fill:${C.green},stroke:${C.ink},color:#fff,stroke-width:2px;`);
    lines.push('  classDef visited fill:#e3ece3,stroke:#9bbf9b,color:#1c1c1a;');
    const active = hl.active ? sid(hl.active) : null;
    for (const v of hl.visited ?? []) if (sid(v) !== active) lines.push(`  class ${sid(v)} visited;`);
    if (active) lines.push(`  class ${active} ${hl.done ? 'done' : 'active'};`);
    // Colour the TAKEN edges (the path the run actually walked — DyGram-style live rails).
    if (hl.taken) edges.forEach((e, i) => { if (hl.taken!.has(`${e.from}->${e.to}`)) lines.push(`  linkStyle ${i} stroke:${C.green},stroke-width:3px;`); });
  }
  return lines.join('\n');
}

// Variable specifier ⇒ runtime import (mermaid is client-only, never server-bundled).
let mermaidP: Promise<{ render: (id: string, src: string) => Promise<{ svg: string }> }> | null = null;
function loadMermaid(): Promise<{ render: (id: string, src: string) => Promise<{ svg: string }> }> {
  if (!mermaidP) {
    const url = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaidP = import(/* @vite-ignore */ url).then((mod: { default: { initialize: (o: unknown) => void } }) => {
      mod.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
      return mod.default as unknown as { render: (id: string, src: string) => Promise<{ svg: string }> };
    });
  }
  return mermaidP;
}

let mmSeq = 0;
function Mermaid({ source, mini }: { source: string; mini?: boolean }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading');
  useEffect(() => {
    let alive = true; setState('loading');
    loadMermaid().then((mer) => mer.render('mm' + (++mmSeq), source))
      .then((r) => { if (alive && ref.current) { ref.current.innerHTML = r.svg; setState('ok'); } })
      .catch(() => { if (alive) setState('err'); });
    return () => { alive = false; };
  }, [source]);
  if (state === 'err') return <pre style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: 10, overflow: 'auto', fontSize: 12 }}>{source}</pre>;
  return (
    <div style={{ position: 'relative', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: mini ? 6 : 12, overflow: 'auto', minHeight: mini ? 60 : 90, textAlign: 'center' }}>
      <div ref={ref} suppressHydrationWarning style={{ opacity: state === 'ok' ? 1 : 0, transition: 'opacity .2s' }} />
      {state === 'loading' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.mut, fontSize: 12 }}>rendering diagram…</div>}
    </div>
  );
}

/* ── views ──────────────────────────────────────────────────────────────── */

function SignInCard(): React.ReactElement {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, display: 'grid', gap: 10, justifyItems: 'start' }}>
      <div style={{ color: C.mut }}>Sign in to see your machines, their runs, and to drive one.</div>
      <button onClick={() => void login()} style={{ border: `1px solid ${C.green}`, background: C.green, color: '#fff', borderRadius: 8, padding: '9px 18px', font: '600 14px inherit', cursor: 'pointer' }}>Sign in</button>
    </div>
  );
}

function ListView({ machines, nodes, rails, runs, authed, ready }: { machines: Entry[]; nodes: Entry[]; rails: Entry[]; runs: Entry[]; authed: boolean; ready: boolean }): React.ReactElement {
  const runsByMachine = new Map<string, Entry[]>();
  for (const r of runs) { const m = (r.value as RunVal).machine ?? ''; (runsByMachine.get(m) ?? runsByMachine.set(m, []).get(m)!).push(r); }
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section style={{ display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, font: '600 15px/1 Georgia,serif', color: C.mut }}>Machines</h2>
        {!ready && machines.length === 0 && authed && <div style={{ display: 'grid', gap: 8 }}><Skeleton h={70} /><Skeleton h={70} /></div>}
        {ready && machines.length === 0 && (authed ? <p style={{ color: C.mut }}>No machines defined yet.</p> : <SignInCard />)}
        {machines.map((m) => {
          const name = idName(m.key);
          const mv = assemble(m, nodes, rails)!;
          const groups = groupRuns(runsByMachine.get(name) ?? []);
          const last = groups[0];
          return (
            <Card key={m.key} onClick={() => { location.hash = `#/m/${name}`; }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <strong style={{ font: '600 16px Georgia,serif', flex: 1 }}>{mv.title ?? name}</strong>
                {last && <Badge text={groupStatus(last)} color={statusColor(groupStatus(last))} />}
              </div>
              {(mv.nodes ?? []).length > 0 && <Mermaid source={toMermaid(mv, last ? { active: (last.parent?.value as RunVal | undefined)?.node, done: groupStatus(last) === 'done' } : undefined)} mini />}
              <div style={{ color: C.mut, fontSize: 12 }}>
                <code style={{ fontFamily: C.mono }}>{name}</code> · {(mv.nodes ?? []).length} nodes · {(mv.rails ?? []).length} rails · {groups.length} run{groups.length === 1 ? '' : 's'}
              </div>
            </Card>
          );
        })}
      </section>
      {runs.length > 0 && <section style={{ display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, font: '600 15px/1 Georgia,serif', color: C.mut }}>Recent runs</h2>
        {groupRuns(runs).slice(0, 24).map((g) => <RunGroupRow key={g.key} group={g} showMachine />)}
      </section>}
    </div>
  );
}

function MachineView({ name, boot }: { name: string; boot: Boot }): React.ReactElement {
  const seed = assemble(boot.machines.find((m) => idName(m.key) === name), boot.nodes, boot.rails);
  const [m, setM] = useState<MachineVal | null>(seed);
  const [runs, setRuns] = useState<Entry[]>(boot.runs.filter((r) => (r.value as RunVal).machine === name));
  const [loading, setLoading] = useState(!seed);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [idf, nf, rf, rv] = await Promise.all([
      mcpCall('read', 'workspace.peek', { key: `machine/${name}` }),
      mcpCall('read', 'workspace.query', { prefix: `machine/${name}/node/`, limit: 100 }),
      mcpCall('read', 'workspace.query', { prefix: `machine/${name}/rail/`, limit: 200 }),
      mcpCall('read', 'workspace.query', { type: 'machine-run', rankBy: 'recency', limit: 60 }),
    ]);
    const id = idf.ok && idf.value ? ({ key: `machine/${name}`, value: valueOf<Record<string, unknown>>(idf.value) ?? {} } as Entry) : undefined;
    setM(assemble(id, nf.ok ? entriesOf(nf.value) : [], rf.ok ? entriesOf(rf.value) : []));
    if (rv.ok) setRuns(entriesOf(rv.value).filter((r) => (r.value as RunVal).machine === name));
    setLoading(false);
  }, [name]);
  useEffect(() => { void refresh(); }, [refresh]);

  const trigger = async (): Promise<void> => {
    const run = new Date().toISOString().replace(/[:.]/g, '-');
    setBusy(true);
    const r = await mcpCall('act', 'workspace.invoke', { action: `machine.${name}.start`, params: { run } });
    setBusy(false);
    if (r.ok) location.hash = `#/r/${encodeURIComponent(runKeyOf(name, run))}`;
    else alert(`Trigger failed: ${typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}`);
  };

  if (loading && !m) return <div style={{ display: 'grid', gap: 12 }}><a href="#/" style={{ color: C.mut, textDecoration: 'none' }}>‹ machines</a><Skeleton h={28} w="40%" /><Skeleton h={140} /></div>;
  if (!m) return <p style={{ color: C.mut }}>Machine “{name}” not found. <a href="#/">Back</a></p>;
  const latest = runs[0]?.value as RunVal | undefined;
  const groups = groupRuns(runs);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <a href="#/" style={{ color: C.mut, textDecoration: 'none' }}>‹ machines</a>
        <strong style={{ font: '600 19px Georgia,serif', flex: 1 }}>{m.title ?? name}</strong>
        {isAuthed()
          ? <button onClick={() => void trigger()} disabled={busy} style={{ border: `1px solid ${C.green}`, background: C.green, color: '#fff', borderRadius: 8, padding: '7px 14px', font: 'inherit', cursor: 'pointer' }}>{busy ? 'Starting…' : '▶ Run'}</button>
          : <button onClick={() => void login()} style={{ border: `1px solid ${C.green}`, background: 'transparent', color: C.green, borderRadius: 8, padding: '7px 14px', font: 'inherit', cursor: 'pointer' }}>Sign in to run</button>}
      </div>

      <Mermaid source={toMermaid(m, latest ? { active: latest.node, done: latest.status === 'done' } : undefined)} />
      {latest && <div style={{ color: C.mut, fontSize: 11, marginTop: -8 }}>latest run at <strong>{latest.node}</strong> ({latest.status})</div>}

      <details>
        <summary style={{ color: C.mut, cursor: 'pointer', fontSize: 13 }}>Rails &amp; nodes ({(m.rails ?? []).length} rails, {(m.nodes ?? []).length} nodes)</summary>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {(m.rails ?? []).map((r, i) => (
            <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, padding: '8px 10px', display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{r.from}</strong><span title={r.mode} style={{ color: C.mut }}>{railArrow[r.mode] ?? '→'}</span><strong>{r.to}</strong>
                <Badge text={r.mode} color={railColor(r.mode)} />
                {r.mode === 'section' && Array.isArray(r.sections) && <span style={{ color: C.mut, fontSize: 11 }}>∥ {r.sections.map((s) => s.to).join(', ')}</span>}
                {r.mode === 'vote' && <span style={{ color: C.mut, fontSize: 11 }}>{r.samples ?? 3}× {r.branch}</span>}
              </div>
              {r.when && <div style={{ color: C.mut, fontSize: 12, fontStyle: 'italic' }}>when: {r.when}</div>}
              {r.condition && <div style={{ color: C.mut, fontSize: 12 }}>if <code style={{ fontFamily: C.mono }}>{r.condition}</code></div>}
              {r.prompt && <div style={{ color: C.mut, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 72, overflow: 'auto' }}>{r.prompt}</div>}
            </div>
          ))}
        </div>
      </details>

      <Field label={`Runs (${groups.length})`}>
        <div style={{ display: 'grid', gap: 6 }}>
          {loading && groups.length === 0 && <Skeleton h={36} />}
          {!loading && groups.length === 0 && <span style={{ color: C.mut }}>No runs yet.</span>}
          {groups.map((g) => <RunGroupRow key={g.key} group={g} />)}
        </div>
      </Field>
    </div>
  );
}

function RunView({ runKey }: { runKey: string }): React.ReactElement {
  const machine = runMachine(runKey);
  const runId = runIdOf(runKey);
  const [fact, setFact] = useState<RunVal | null>(null);
  const [mv, setMv] = useState<MachineVal | null>(null);
  const [claims, setClaims] = useState<Entry[]>([]);
  const [children, setChildren] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [stepping, setStepping] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const rf = await mcpCall('read', 'workspace.peek', { key: runKey });
    const val = valueOf<RunVal>(rf.value);
    setFact(val);
    const mName = val?.machine ?? machine;
    const [cl, kids, idf, nf, rrf] = await Promise.all([
      mcpCall('read', 'workspace.query', { prefix: `${runKey}/claim/`, limit: 40 }),
      mcpCall('read', 'workspace.query', { prefix: `${runKey}`, limit: 40 }),
      mcpCall('read', 'workspace.peek', { key: `machine/${mName}` }),
      mcpCall('read', 'workspace.query', { prefix: `machine/${mName}/node/`, limit: 100 }),
      mcpCall('read', 'workspace.query', { prefix: `machine/${mName}/rail/`, limit: 200 }),
    ]);
    setClaims(cl.ok ? entriesOf(cl.value) : []);
    setChildren(kids.ok ? entriesOf(kids.value).filter((e) => childSuffix(runIdOf(e.key)) && parentRunKey(e.key) === runKey) : []);
    const id = idf.ok && idf.value ? ({ key: `machine/${mName}`, value: valueOf<Record<string, unknown>>(idf.value) ?? {} } as Entry) : undefined;
    setMv(assemble(id, nf.ok ? entriesOf(nf.value) : [], rrf.ok ? entriesOf(rrf.value) : []));
    setLoading(false);
  }, [runKey, machine]);
  useEffect(() => { void refresh(); }, [refresh]);

  const doStep = async (): Promise<void> => {
    setStepping(true);
    await mcpCall('act', `@c15r/machine.step`, { machine, run: runId });
    setStepping(false);
    await refresh();
  };

  const trace = fact?.trace ?? [];
  const taken = new Set<string>();
  for (let i = 1; i < trace.length; i++) taken.add(`${trace[i - 1].node}->${trace[i].node}`);
  const visited = [...trace.map((t) => t.node), ...claims.map((c) => (c.value as { at?: string }).at), ...children.map((c) => (c.value as RunVal).node)].filter((x): x is string => !!x);
  const child = childSuffix(runId);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
        <a href={machine ? `#/m/${machine}` : '#/'} style={{ color: C.mut, textDecoration: 'none' }}>‹ {machine || 'back'}</a>
        <strong style={{ font: '600 17px Georgia,serif', flex: 1 }}>Run <code style={{ fontFamily: C.mono, fontSize: 14 }}>{runId}</code></strong>
        {isAuthed() && fact && fact.status !== 'done' && <button onClick={() => void doStep()} disabled={stepping} style={{ border: `1px solid ${C.blue}`, background: C.blue, color: '#fff', borderRadius: 8, padding: '6px 12px', font: 'inherit', cursor: 'pointer' }}>{stepping ? 'Stepping…' : '⏭ Step'}</button>}
        <button onClick={() => void refresh()} style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: 8, padding: '6px 12px', font: 'inherit', cursor: 'pointer' }}>↻</button>
      </div>
      {child && <div style={{ color: C.mut, fontSize: 12 }}>a <strong>{child}</strong> branch of <a href={`#/r/${encodeURIComponent(parentRunKey(runKey))}`} style={{ color: C.blue }}><code style={{ fontFamily: C.mono }}>{baseRunId(runId)}</code></a></div>}

      {loading && !fact && <div style={{ display: 'grid', gap: 10 }}><Skeleton h={20} w="60%" /><Skeleton h={140} /></div>}
      {fact && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <Field label="machine"><strong>{fact.machine}</strong></Field>
          <Field label="node"><strong>{fact.node}</strong></Field>
          <Field label="status"><Badge text={fact.status ?? '—'} color={statusColor(fact.status)} /></Field>
          {fact.via && <Field label="via"><code style={{ fontFamily: C.mono, fontSize: 12 }}>{fact.via}</code></Field>}
        </div>
      )}

      {mv && (mv.nodes ?? []).length > 0 && (
        <Field label="Execution (the taken path overlaid)">
          <Mermaid source={toMermaid(mv, { active: fact?.node, visited, done: fact?.status === 'done', taken })} />
        </Field>
      )}

      {trace.length > 0 && (
        <Field label="Step timeline">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {trace.map((t, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: C.mut }} title={t.via}>→</span>}
                <span style={{ border: `1px solid ${C.line}`, borderRadius: 7, padding: '3px 8px', fontSize: 12, background: i === trace.length - 1 ? '#e3ece3' : C.panel }}><strong>{t.node}</strong></span>
              </React.Fragment>
            ))}
          </div>
        </Field>
      )}

      {children.length > 0 && (
        <Field label={`Parallel branches (${children.length})`}>
          <div style={{ display: 'grid', gap: 6 }}>
            {children.map((c) => {
              const cv = c.value as RunVal; const sfx = childSuffix(runIdOf(c.key)) ?? '';
              return (
                <div key={c.key} onClick={() => { location.hash = `#/r/${encodeURIComponent(c.key)}`; }} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 10px', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 9, cursor: 'pointer' }}>
                  <Badge text={cv.status ?? '—'} color={statusColor(cv.status)} /><strong>{sfx}</strong><span style={{ color: C.mut }}>· {cv.node}</span>
                  {cv.via && <code style={{ marginLeft: 'auto', color: C.mut, fontSize: 11, fontFamily: C.mono }}>{cv.via}</code>}
                </div>
              );
            })}
          </div>
        </Field>
      )}

      <Field label="Decisions (claims — the certificate of reasoning)">
        <div style={{ display: 'grid', gap: 6 }}>
          {claims.length === 0 && <span style={{ color: C.mut }}>No decisions recorded.</span>}
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
  const boot: Boot = initial ?? { session: { user: null }, machines: [], nodes: [], rails: [], runs: [] };
  const hash = useHash();
  const [authed, setAuthed] = useState<boolean>(!!boot.session.user);
  const [user] = useState<string | null>(boot.session.user);
  const [data, setData] = useState<Boot>(boot);
  const [ready, setReady] = useState<boolean>(boot.machines.length > 0);

  const loadData = useCallback(async () => {
    const [mv, nv, rv, runv] = await Promise.all([
      mcpCall('read', 'workspace.query', { type: 'machine', limit: 100 }),
      mcpCall('read', 'workspace.query', { type: 'machine-node', limit: 500 }),
      mcpCall('read', 'workspace.query', { type: 'machine-rail', limit: 500 }),
      mcpCall('read', 'workspace.query', { type: 'machine-run', rankBy: 'recency', limit: 60 }),
    ]);
    setData((d) => ({
      session: d.session,
      machines: mv.ok ? entriesOf(mv.value).filter((e) => idName(e.key).indexOf('/') < 0) : d.machines,
      nodes: nv.ok ? entriesOf(nv.value) : d.nodes,
      rails: rv.ok ? entriesOf(rv.value) : d.rails,
      runs: runv.ok ? entriesOf(runv.value) : d.runs,
    }));
    setReady(true);
  }, []);

  useEffect(() => {
    void (async () => {
      let ok = isAuthed();
      try { ok = await completeLoginIfReturning(); } catch { /* keep isAuthed() */ }
      setAuthed(ok);
      if (ok) await loadData();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let body: React.ReactElement;
  const mMatch = /^#\/m\/(.+)$/.exec(hash);
  const rMatch = /^#\/r\/(.+)$/.exec(hash);
  if (mMatch) body = <MachineView name={decodeURIComponent(mMatch[1])} boot={data} />;
  else if (rMatch) body = <RunView runKey={decodeURIComponent(rMatch[1])} />;
  else body = <ListView machines={data.machines} nodes={data.nodes} rails={data.rails} runs={data.runs} authed={authed} ready={ready} />;

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink }}>
      <style>{SKELETON_CSS}</style>
      <header style={{ padding: '14px 16px', borderBottom: `1px solid ${C.line}`, display: 'flex', gap: 10, alignItems: 'center' }}>
        <a href="#/" style={{ textDecoration: 'none', color: C.ink }}><strong style={{ font: '700 18px Georgia,serif' }}>🔄 machines</strong></a>
        <span style={{ color: C.mut, fontSize: 12 }}>@c15r/machine</span>
        {authed
          ? <span style={{ marginLeft: 'auto', color: C.mut, fontSize: 12 }}>{user ?? 'signed in'}</span>
          : <button onClick={() => void login()} style={{ marginLeft: 'auto', border: `1px solid ${C.green}`, background: C.green, color: '#fff', borderRadius: 8, padding: '6px 14px', font: '600 13px inherit', cursor: 'pointer' }}>Sign in</button>}
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '16px 14px 48px' }}>{body}</main>
    </div>
  );
}
