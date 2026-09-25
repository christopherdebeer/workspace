/* Experiment 02 — Interface 00a: free text → a live interface, by judgment only. */
import * as React from 'react';
import { decide, JevError, signIn } from '../lib/jev';
import { assemble, candidates, slotsFrom, stage1Questions, stage2Questions, type UiSpec, type Widget } from '../lib/ui-spec';
import { Panel, ErrorLine } from '../ui';

const { useEffect, useRef, useState } = React;

const EXAMPLES = [
  'a pomodoro timer with a task list',
  'book a table: party size, date, time and dietary needs',
  'a mixing desk for three audio channels with mute switches',
  'track how many glasses of water I drink today toward a goal of 8',
];

export default function Interface00a() {
  const [request, setRequest] = useState(EXAMPLES[0]);
  const [spec, setSpec] = useState<UiSpec | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);

  async function build() {
    setError(null);
    setSpec(null);
    try {
      if (!(await signIn())) throw new JevError('sign in to run experiments', 401);
      const cands = candidates(request);
      setStage('stage 1 · what does it need?');
      const s1 = await decide({ request }, stage1Questions(cands), 'ui:stage1');
      const slots = slotsFrom(s1.answers);
      if (!slots.length) {
        setSpec({ ...assemble(s1.answers, [], {}), widgets: [] });
        return;
      }
      setStage(`stage 2 · ${slots.length} components: labels, ranges, actions`);
      const s2 = await decide({ request, components: slots.map((s) => s.id) }, stage2Questions(slots, cands), 'ui:stage2');
      setSpec(assemble(s1.answers, slots, s2.answers));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage(null);
    }
  }

  return (
    <>
      <Panel title="Interface 00a" sub="Describe an interface. Two parallel judgment passes pick components, labels, ranges and wiring from a closed vocabulary — nothing is generated.">
        <label className="field">
          <span>request</span>
          <textarea rows={2} value={request} onChange={(e) => setRequest(e.target.value)} />
        </label>
        <div className="chips">
          {EXAMPLES.map((q) => (
            <button key={q} className="chip" onClick={() => setRequest(q)}>
              {q}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="primary" disabled={!!stage || !request.trim()} onClick={() => void build()}>
            {stage ? 'judging…' : 'render'}
          </button>
          {spec ? (
            <button className="ghost" onClick={() => setShowSpec((s) => !s)}>
              {showSpec ? 'hide spec' : 'show spec'}
            </button>
          ) : null}
        </div>
        {stage ? <p className="sub">{stage}</p> : null}
        <ErrorLine error={error} />
      </Panel>
      {spec ? <Rendered spec={spec} /> : null}
      {spec && showSpec ? (
        <Panel title="Spec">
          <pre className="mono small">{JSON.stringify(spec, null, 2)}</pre>
        </Panel>
      ) : null}
    </>
  );
}

/* ── the renderer: a spec becomes a working interface ──────────────────── */

type Values = Record<string, unknown>;

function Rendered({ spec }: { spec: UiSpec }) {
  const initial = (): Values => Object.fromEntries(spec.widgets.map((w) => [w.id, initialOf(w)]));
  const [vals, setVals] = useState<Values>(initial);
  const [summary, setSummary] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    setVals(initial());
    setSummary(null);
    setRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  const set = (id: string, v: unknown) => setVals((s) => ({ ...s, [id]: v }));
  const firstOf = (kind: Widget['kind']) => spec.widgets.find((w) => w.kind === kind);

  const act = (action: string | undefined) => {
    const counter = firstOf('counter');
    const list = firstOf('list');
    const input = firstOf('textInput');
    switch (action) {
      case 'increment':
        if (counter) set(counter.id, Number(vals[counter.id] ?? 0) + 1);
        break;
      case 'decrement':
        if (counter) set(counter.id, Number(vals[counter.id] ?? 0) - 1);
        break;
      case 'start':
        setRunning((r) => !r);
        break;
      case 'add':
        if (list && input && String(vals[input.id] ?? '').trim()) {
          set(list.id, [...((vals[list.id] as string[]) ?? []), String(vals[input.id])]);
          set(input.id, '');
        }
        break;
      case 'clear':
        if (list) set(list.id, []);
        break;
      case 'reset':
        setVals(initial());
        setSummary(null);
        setRunning(false);
        break;
      case 'submit':
        setSummary(
          spec.widgets
            .filter((w) => !['button', 'heading', 'text', 'timer', 'progress'].includes(w.kind))
            .map((w) => `${w.label}: ${fmt(vals[w.id])}`)
            .join(' · ') || 'nothing to submit',
        );
        break;
    }
  };

  const layoutClass = spec.layout === 'split' ? 'ui-split' : spec.layout === 'card' ? 'ui-card' : 'ui-stack';
  return (
    <section className={`panel rendered mood-${spec.mood}`}>
      <header className="panel-head">
        <div>
          <h2>{spec.title}</h2>
          <p className="sub">
            {spec.layout} · {spec.mood} · {spec.widgets.length} components
          </p>
        </div>
      </header>
      {spec.widgets.length === 0 ? <p className="sub">Jev judged that this needs no components.</p> : null}
      <div className={layoutClass}>
        {spec.widgets.map((w) => (
          <WidgetView key={w.id} w={w} value={vals[w.id]} onChange={(v) => set(w.id, v)} onAct={act} running={running} />
        ))}
      </div>
      {summary ? <p className="summary">{summary}</p> : null}
    </section>
  );
}

function initialOf(w: Widget): unknown {
  switch (w.kind) {
    case 'slider':
    case 'numberInput':
      return w.min ?? 0;
    case 'progress':
    case 'counter':
      return 0;
    case 'toggle':
      return false;
    case 'select':
      return w.options?.[0] ?? '';
    case 'checklist':
    case 'list':
      return [];
    case 'timer':
      return (w.max ?? 25) * 60;
    default:
      return '';
  }
}

const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v ?? '—'));

/** Label confidence rides every widget: a faint dot when Jev was unsure. */
const Conf = ({ p }: { p: number }) => <span className="conf" style={{ opacity: 0.2 + 0.8 * p }} title={`label confidence ${Math.round(p * 100)}%`} />;

function WidgetView({ w, value, onChange, onAct, running }: { w: Widget; value: unknown; onChange: (v: unknown) => void; onAct: (a?: string) => void; running: boolean }) {
  const label = (
    <span className="w-label">
      {w.label}
      <Conf p={w.p} />
    </span>
  );
  switch (w.kind) {
    case 'heading':
      return <h3 className="w-heading">{w.label}</h3>;
    case 'text':
      return <p className="w-text">{w.label}</p>;
    case 'textInput':
      return (
        <label className="field">
          {label}
          <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case 'numberInput':
      return (
        <label className="field">
          {label}
          <input type="number" min={w.min} max={w.max} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
        </label>
      );
    case 'slider':
      return (
        <label className="field">
          <span className="w-label">
            {w.label} <b>{String(value)}</b>
            <Conf p={w.p} />
          </span>
          <input type="range" min={w.min} max={w.max} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
        </label>
      );
    case 'toggle':
      return (
        <label className="w-toggle">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      );
    case 'select':
      return (
        <label className="field">
          {label}
          <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {(w.options ?? []).map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
      );
    case 'checklist': {
      const ticked = (value as string[]) ?? [];
      return (
        <fieldset className="w-check">
          <legend>{label}</legend>
          {(w.options ?? []).map((o) => (
            <label key={o}>
              <input type="checkbox" checked={ticked.includes(o)} onChange={(e) => onChange(e.target.checked ? [...ticked, o] : ticked.filter((t) => t !== o))} />
              {o}
            </label>
          ))}
        </fieldset>
      );
    }
    case 'counter':
      return (
        <div className="w-counter">
          {label}
          <div className="row">
            <button onClick={() => onChange(Number(value ?? 0) - 1)} aria-label="decrease">−</button>
            <b>{String(value ?? 0)}</b>
            <button onClick={() => onChange(Number(value ?? 0) + 1)} aria-label="increase">+</button>
          </div>
        </div>
      );
    case 'timer':
      return <TimerView w={w} seconds={Number(value ?? 0)} onChange={onChange} running={running} onToggle={() => onAct('start')} />;
    case 'progress': {
      const max = w.max ?? 100;
      const v = Number(value ?? 0);
      return (
        <div className="field">
          <span className="w-label">
            {w.label} <b>{v}/{max}</b>
            <Conf p={w.p} />
          </span>
          <progress max={max} value={v} onClick={() => onChange(Math.min(max, v + Math.max(1, Math.round(max / 10))))} />
        </div>
      );
    }
    case 'list': {
      const items = (value as string[]) ?? [];
      return (
        <div className="w-list">
          {label}
          {items.length ? (
            <ul>
              {items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          ) : (
            <p className="sub">empty</p>
          )}
        </div>
      );
    }
    case 'button':
      return (
        <button className="w-button" onClick={() => onAct(w.action)} title={`action: ${w.action}`}>
          {w.label}
          <Conf p={w.p} />
        </button>
      );
  }
}

function TimerView({ w, seconds, onChange, running, onToggle }: { w: Widget; seconds: number; onChange: (v: unknown) => void; running: boolean; onToggle: () => void }) {
  const ref = useRef(seconds);
  ref.current = seconds;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => onChange(Math.max(0, ref.current - 1)), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return (
    <div className="w-timer">
      <span className="w-label">{w.label}</span>
      <b className="mono">
        {mm}:{ss}
      </b>
      <div className="row">
        <button onClick={onToggle}>{running ? 'pause' : 'start'}</button>
        <button className="ghost" onClick={() => onChange((w.max ?? 25) * 60)}>
          reset
        </button>
      </div>
    </div>
  );
}
