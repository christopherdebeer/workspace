/* Small composable pieces shared by every experiment (styles live in static/index.html). */
import * as React from 'react';
import { onTrace, clearTrace, USD_PER_TOKEN, type CallTrace } from './lib/jev';

const { useEffect, useState } = React;

export function Panel({ title, sub, children, aside }: { title?: string; sub?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="panel">
      {title ? (
        <header className="panel-head">
          <div>
            <h2>{title}</h2>
            {sub ? <p className="sub">{sub}</p> : null}
          </div>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A probability as a bar — every Jev answer is shown with its confidence. */
export function Bar({ label, p, hint }: { label: string; p: number; hint?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
  return (
    <div className="bar" title={hint}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="bar-val">{pct}%</span>
    </div>
  );
}

/** Top-n of a distribution, as bars. */
export function Distribution({ probs, n = 5 }: { probs?: Record<string, number>; n?: number }) {
  if (!probs) return null;
  const top = Object.entries(probs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  return (
    <div className="dist">
      {top.map(([k, v]) => (
        <Bar key={k} label={k} p={v} />
      ))}
    </div>
  );
}

/** Text whose characters carry their confidence: faint = unsure. */
export function ConfidentText({ tokens }: { tokens: Array<{ text: string; p: number }> }) {
  return (
    <span className="ctext">
      {tokens.map((t, i) => (
        <span key={i} style={{ opacity: 0.25 + 0.75 * Math.max(0, Math.min(1, t.p)) }} title={`${Math.round(t.p * 100)}%`}>
          {t.text}
        </span>
      ))}
    </span>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-v">{value}</span>
      <span className="stat-l">{label}</span>
    </div>
  );
}

/** The instrument strip: every Jev call this session — latency, fan-out, cost. */
export function TraceStrip() {
  const [traces, setTraces] = useState<CallTrace[]>([]);
  useEffect(() => onTrace(setTraces), []);
  if (!traces.length) return null;
  const ok = traces.filter((t) => t.ok);
  const tokens = ok.reduce((s, t) => s + t.tokens, 0);
  const qs = ok.reduce((s, t) => s + t.questions, 0);
  const p50 = ok.length ? [...ok].sort((a, b) => a.ms - b.ms)[Math.floor(ok.length / 2)].ms : 0;
  const maxMs = Math.max(...traces.map((t) => t.ms), 1);
  return (
    <aside className="trace" aria-label="Jev calls this session">
      <div className="trace-stats">
        <Stat label="calls" value={traces.length} />
        <Stat label="judgments" value={qs} />
        <Stat label="p50 ms" value={p50} />
        <Stat label="tokens" value={tokens.toLocaleString()} />
        <Stat label="≈ usd" value={`$${(tokens * USD_PER_TOKEN).toFixed(4)}`} />
        <button className="ghost" onClick={clearTrace}>clear</button>
      </div>
      <div className="trace-spark" title="each bar is one call; height = latency, width ∝ questions asked in parallel">
        {traces.slice(-80).map((t) => (
          <span
            key={t.id}
            className={t.ok ? 'spark' : 'spark err'}
            style={{ height: `${Math.max(8, (t.ms / maxMs) * 100)}%`, flexGrow: Math.max(1, Math.min(t.questions, 24)) }}
            title={`${t.label}: ${t.ms}ms · ${t.questions}q · ${t.tokens} tok${t.error ? ` · ${t.error}` : ''}`}
          />
        ))}
      </div>
    </aside>
  );
}

export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}
