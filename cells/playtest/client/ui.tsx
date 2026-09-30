/* ---------------------------------------------------------------------------
 * Small shared pieces: data hook, links, panels, stats, status tags, bars, the
 * train/test score chart, the loop diagram and the job runner.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { get, runJob, signIn, authed, type JobState } from './lib/api';

const { useEffect, useRef, useState, useCallback } = React;

/* ── data ───────────────────────────────────────────────────────────── */

export function useApi<T>(path: string | null, deps: unknown[] = []): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setError(null);
    get<T>(path)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [path, n, ...deps]);
  return { data, error, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function Loading({ error, what = 'loading…' }: { error?: string | null; what?: string }) {
  return error ? <p className="error">⚠ {error}</p> : <p className="muted">{what}</p>;
}

/* ── formatting ─────────────────────────────────────────────────────── */

export const f3 = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(3));
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(Number(n) * 100)}%`);
export const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(3)}`;
export function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* ── links ──────────────────────────────────────────────────────────── */

export function go(hash: string) {
  location.hash = hash;
}
export const A = ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
  <a href={`#${to}`} className={className}>
    {children}
  </a>
);

/* ── layout ─────────────────────────────────────────────────────────── */

export function Panel({ title, sub, right, children, id }: { title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="panel" id={id}>
      {(title || right) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const Stat = ({ v, l, title }: { v: React.ReactNode; l: string; title?: string }) => (
  <div className="stat" title={title}>
    <span className="stat-v">{v}</span>
    <span className="stat-l">{l}</span>
  </div>
);

/* ── status: always icon + label, never colour alone ────────────────── */

const STATUS: Record<string, [string, string]> = {
  implemented: ['good', '✓'],
  partial: ['warn', '◐'],
  'engine-flag': ['info', '⚑'],
  'not-implemented': ['bad', '✕'],
  kept: ['good', '✓'],
  head: ['good', '●'],
  reverted: ['bad', '↩'],
  candidate: ['info', '…'],
  draft: ['info', '✎'],
  climbing: ['info', '↗'],
  stalled: ['warn', '■'],
  idle: ['', '○'],
  error: ['bad', '✕'],
  warn: ['warn', '!'],
  info: ['info', 'i'],
  done: ['good', '✓'],
  running: ['info', '…'],
  pending: ['info', '…'],
  handled: ['good', '✓'],
  unhandled: ['bad', '✕'],
  deploy: ['info', '⇪'],
  engine: ['warn', '⚙'],
  definition: ['', '✎'],
  round: ['info', '↻'],
  eval: ['', '▸'],
};
export function Status({ s, label }: { s: string; label?: string }) {
  const [cls, icon] = STATUS[s] ?? ['', '·'];
  return (
    <span className={`tag ${cls}`}>
      <span aria-hidden="true">{icon}</span>
      {label ?? s}
    </span>
  );
}
export const Tag = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => <span className={`tag ${className}`}>{children}</span>;

export function Bar({ label, value, max = 1, text }: { label: React.ReactNode; value: number; max?: number; text?: string }) {
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="bar">
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${w * 100}%` }} />
      </span>
      <span className="bar-val">{text ?? f3(value)}</span>
    </div>
  );
}

/* ── train / test score chart ───────────────────────────────────────── */

export interface ChartPoint {
  key: string;
  label: string;
  train: number;
  test: number;
  note?: string;
  href?: string;
}

/** Two series on one axis (both are score/v1 on 0–1): train = series-1, test = series-2. */
export function ScoreChart({ points, title }: { points: ChartPoint[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  if (!points.length) return <p className="muted small">No evals yet.</p>;
  const W = 640;
  const H = 220;
  const pad = { l: 38, r: 58, t: 12, b: 26 };
  const vals = points.flatMap((p) => [p.train, p.test]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const span = Math.max(0.1, hi - lo);
  lo = Math.max(0, Math.floor((lo - span * 0.25) * 20) / 20);
  hi = Math.min(1, Math.ceil((hi + span * 0.25) * 20) / 20);
  if (hi - lo < 0.1) hi = Math.min(1, lo + 0.1);
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const path = (k: 'train' | 'test') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const last = points.length - 1;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };
  // Direct end labels, nudged apart if they would collide.
  let yTr = y(points[last].train);
  let yTe = y(points[last].test);
  if (Math.abs(yTr - yTe) < 13) {
    const mid = (yTr + yTe) / 2;
    const up = yTr <= yTe;
    yTr = mid + (up ? -7 : 7);
    yTe = mid + (up ? 7 : -7);
  }
  const hp = hover !== null ? points[hover] : null;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
        <div className="legend" aria-hidden="true">
          <span>
            <i style={{ background: 'var(--series-1)' }} />
            train (seen seeds)
          </span>
          <span>
            <i style={{ background: 'var(--series-2)' }} />
            test (held-out seeds)
          </span>
        </div>
        <button className="ghost small" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? 'chart' : 'table'}
        </button>
      </div>
      {table ? (
        <div className="scroll">
          <table className="t">
            <caption className="sr">{title}</caption>
            <thead>
              <tr>
                <th>eval</th>
                <th className="num">train</th>
                <th className="num">test</th>
                <th>note</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className={p.href ? 'link' : ''} onClick={() => p.href && go(p.href)}>
                  <td>{p.label}</td>
                  <td className="num">{f3(p.train)}</td>
                  <td className="num">{f3(p.test)}</td>
                  <td className="muted">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" ref={wrap}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${points.length} evals, latest train ${f3(points[last].train)}, test ${f3(points[last].test)}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={() => hp?.href && go(hp.href)} style={{ cursor: hp?.href ? 'pointer' : 'default', touchAction: 'pan-y' }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)" fontFamily="var(--mono)">
                  {t.toFixed(2)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              points.length <= 12 || i % Math.ceil(points.length / 12) === 0 || i === last ? (
                <text key={p.key} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--faint)" fontFamily="var(--mono)">
                  {p.label}
                </text>
              ) : null,
            )}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted)" strokeDasharray="3 3" />}
            <path d={path('train')} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
            <path d={path('test')} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" />
            {points.map((p, i) => (
              <g key={p.key}>
                <circle cx={x(i)} cy={y(p.train)} r={hover === i ? 5.5 : 4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
                <circle cx={x(i)} cy={y(p.test)} r={hover === i ? 5.5 : 4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            ))}
            <text x={x(last) + 8} y={yTr + 4} fontSize="11.5" fill="var(--muted)">
              train {f3(points[last].train)}
            </text>
            <text x={x(last) + 8} y={yTe + 4} fontSize="11.5" fill="var(--muted)">
              test {f3(points[last].test)}
            </text>
          </svg>
          {hp && hover !== null && (
            <div className="chart-tip" style={{ left: `${Math.min(70, (x(hover) / W) * 100)}%`, top: 0 }}>
              <strong>{hp.label}</strong>
              {hp.note ? <span className="muted"> · {hp.note}</span> : null}
              <div>
                <i style={{ display: 'inline-block', width: 10, height: 3, background: 'var(--series-1)', verticalAlign: 'middle', marginRight: 4 }} />
                train {f3(hp.train)}
              </div>
              <div>
                <i style={{ display: 'inline-block', width: 10, height: 3, background: 'var(--series-2)', verticalAlign: 'middle', marginRight: 4 }} />
                test {f3(hp.test)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── the loop, drawn ────────────────────────────────────────────────── */

export function LoopDiagram() {
  const box = (x: number, y: number, w: number, t: string, s: string, hl = false) => (
    <g>
      <rect className={`box${hl ? ' hl' : ''}`} x={x} y={y} width={w} height={54} rx={10} />
      <text x={x + w / 2} y={y + 23} textAnchor="middle" fontWeight={600}>
        {t}
      </text>
      <text className="muted-t" x={x + w / 2} y={y + 41} textAnchor="middle">
        {s}
      </text>
    </g>
  );
  return (
    <div className="diagram">
      <svg className="wide" viewBox="0 0 640 250" role="img" aria-label="The loop: a rules file is read by the engine, played many times by Jev, scored, and a proposed change is kept only if both train and held-out scores improve.">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {box(10, 20, 140, 'RULES.md', 'the game, as text')}
        {box(180, 20, 130, 'engine', 'mechanics → moves')}
        {box(340, 20, 130, 'Jev plays', 'picks every move')}
        {box(500, 20, 130, 'score', 'train · test', true)}
        {box(340, 160, 130, 'keep / revert', 'both must improve', true)}
        {box(10, 160, 140, 'propose', 'one change + why')}
        {box(180, 160, 130, 'backlog', 'what the engine lacks')}
        <path className="arrow" d="M150,47 H176" markerEnd="url(#arr)" />
        <path className="arrow" d="M310,47 H336" markerEnd="url(#arr)" />
        <path className="arrow" d="M470,47 H496" markerEnd="url(#arr)" />
        <path className="arrow" d="M565,74 V187 H474" markerEnd="url(#arr)" />
        <path className="arrow" d="M340,187 H314" markerEnd="url(#arr)" strokeDasharray="4 3" />
        <path className="arrow" d="M340,200 C260,240 120,240 80,218" markerEnd="url(#arr)" />
        <path className="arrow" d="M80,160 V78" markerEnd="url(#arr)" />
        <text className="muted-t" x={255} y={243} textAnchor="middle">
          next round
        </text>
        <text className="muted-t" x={327} y={180} textAnchor="middle">
          gaps
        </text>
      </svg>
      <svg className="narrow" viewBox="0 0 360 470" aria-hidden="true">
        <defs>
          <marker id="arr-n" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
          </marker>
        </defs>
        {box(40, 6, 200, 'RULES.md', 'the game, as text')}
        {box(40, 86, 200, 'engine', 'mechanics → moves')}
        {box(40, 166, 200, 'Jev plays', 'picks every move')}
        {box(40, 246, 200, 'score', 'train · test', true)}
        {box(40, 326, 200, 'keep / revert', 'both must improve', true)}
        {box(40, 406, 200, 'propose', 'one change + why')}
        <path className="arrow" d="M140,60 V82" markerEnd="url(#arr-n)" />
        <path className="arrow" d="M140,140 V162" markerEnd="url(#arr-n)" />
        <path className="arrow" d="M140,220 V242" markerEnd="url(#arr-n)" />
        <path className="arrow" d="M140,300 V322" markerEnd="url(#arr-n)" />
        <path className="arrow" d="M140,380 V402" markerEnd="url(#arr-n)" />
        <path className="arrow" d="M240,433 H300 V33 H244" markerEnd="url(#arr-n)" />
        <text className="muted-t" x={306} y={240} transform="rotate(90 306 240)" textAnchor="middle">
          next round
        </text>
      </svg>
    </div>
  );
}

/* ── sign-in + job runner ───────────────────────────────────────────── */

export function useAuthed(): [boolean, () => Promise<void>] {
  const [ok, setOk] = useState(authed());
  const go = async () => setOk(await signIn());
  return [ok, go];
}

export function SignIn({ why }: { why: string }) {
  const [ok, sign] = useAuthed();
  if (ok) return null;
  return (
    <p className="signin muted">
      <button onClick={() => sign()}>Sign in</button> {why}
    </p>
  );
}

/** A button that starts a tool (async or inline) and shows the job to completion. */
export function JobButton({ tool, input, label, primary, confirm, onDone, disabled }: { tool: string; input: () => Record<string, unknown> | null; label: string; primary?: boolean; confirm?: string; onDone?: (out: any) => void; disabled?: boolean }) {
  const [state, setState] = useState<(JobState & { elapsed: number }) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const busy = state !== null && (state.status === 'pending' || state.status === 'running');
  const start = async () => {
    const args = input();
    if (!args) return;
    if (confirm && !window.confirm(confirm)) return;
    setErr(null);
    try {
      if (!authed() && !(await signIn())) throw new Error('sign in first');
      setState({ status: 'pending', elapsed: 0 });
      const out = await runJob(tool, args, (s) => setState(s));
      onDone?.(out);
    } catch (e) {
      setErr((e as Error).message);
      setState(null);
    }
  };
  return (
    <span className="job">
      <button className={primary ? 'primary' : ''} onClick={start} disabled={busy || disabled}>
        {busy ? `${label}… ${Math.round((state?.elapsed ?? 0) / 1000)}s` : label}
      </button>{' '}
      {state?.status === 'done' && <Status s="done" />}
      {err && <span className="error">⚠ {err}</span>}
    </span>
  );
}
