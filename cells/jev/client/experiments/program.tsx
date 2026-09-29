/* Experiment 02 — Interface 00a → Program: free text → a working, iterable app. */
import * as React from 'react';
import { decide, signIn, JevError } from '../lib/jev';
import {
  apply,
  applyEdit,
  commandQuestions,
  completion,
  editQuestions,
  initialState,
  migrate,
  planCommand,
  smartQuestions,
  smartValues,
  statValue,
  synthesize,
  type AppSpec,
  type AppState,
  type FieldDef,
  type Item,
  type Op,
} from '../lib/program';
import { Panel, ErrorLine } from '../ui';

const { useEffect, useReducer, useRef, useState } = React;

const EXAMPLES = [
  'a pomodoro timer with a task list',
  'track my spending against a monthly budget of 500',
  'count how many glasses of water I drink toward 8 a day',
  'a reading list of books with ratings',
  'a workout log with distance and minutes',
];

const STORE = 'jev-lab:program:v1';
interface Saved {
  request: string;
  spec: AppSpec;
  state: AppState;
  changes: string[];
}
const load = (): Saved | null => {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};
const save = (s: Saved | null) => {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    /* storage unavailable — the app still runs, it just won't persist */
  }
};

const d = (state: unknown, questions: Parameters<typeof decide>[1], label: string) => decide(state, questions, label).then((r) => r.answers);

export default function Program() {
  const saved = useRef(load()).current;
  const [request, setRequest] = useState(saved?.request ?? EXAMPLES[0]);
  const [spec, setSpec] = useState<AppSpec | null>(saved?.spec ?? null);
  const [changes, setChanges] = useState<string[]>(saved?.changes ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);

  // State + undo history, driven only through the pure reducer.
  const [hist, dispatchHist] = useReducer(
    (h: { past: AppState[]; now: AppState }, a: { type: 'op'; spec: AppSpec; op: Op; record?: boolean } | { type: 'reset'; state: AppState } | { type: 'undo' }) => {
      if (a.type === 'reset') return { past: [], now: a.state };
      if (a.type === 'undo') return h.past.length ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1] } : h;
      const next = apply(a.spec, h.now, a.op);
      return next === h.now ? h : { past: a.record === false ? h.past : [...h.past.slice(-30), h.now], now: next };
    },
    { past: [], now: saved?.state ?? { items: [], scalars: {}, timers: {} } },
  );
  const state = hist.now;
  const run = (op: Op, record = true) => spec && dispatchHist({ type: 'op', spec, op, record });

  useEffect(() => save(spec ? { request, spec, state, changes } : null), [request, spec, state, changes]);

  // Running timers tick through the same reducer (not recorded in undo history).
  const anyRunning = Object.values(state.timers).some((t) => t.running);
  useEffect(() => {
    if (!anyRunning || !spec) return;
    const t = setInterval(() => {
      for (const [id, tm] of Object.entries(state.timers)) if (tm.running) run({ op: 'timer', scalar: id, action: 'tick' }, false);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyRunning, spec, state.timers]);

  async function build() {
    setError(null);
    setBusy('designing the program…');
    try {
      if (!(await signIn())) throw new JevError('sign in to run experiments', 401);
      const t0 = performance.now();
      const s = await synthesize(request, d);
      setSpec(s);
      setChanges([`built in ${((performance.now() - t0) / 1000).toFixed(1)} s from “${request}”`]);
      dispatchHist({ type: 'reset', state: initialState(s) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function edit(text: string) {
    if (!spec) return;
    setBusy('changing the program…');
    try {
      const a = await d({ request: text, app: { title: spec.title, fields: spec.fields.map((f) => f.id), scalars: spec.scalars.map((x) => x.id) } }, editQuestions(spec, text), 'program:edit');
      const r = applyEdit(spec, text, a);
      setSpec(r.spec);
      dispatchHist({ type: 'reset', state: migrate(r.spec, state) });
      setChanges((c) => [...c, `“${text}” → ${r.why}`]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Panel title="Program" sub="Describe an app. Jev designs it by choosing from typed building blocks (never writing code), then runs inside it: every sentence you type becomes one typed operation.">
        <label className="field">
          <span>describe an app</span>
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
          <button className="primary" disabled={!!busy || !request.trim()} onClick={() => void build()}>
            {busy === 'designing the program…' ? 'designing…' : spec ? 'rebuild' : 'build'}
          </button>
          {spec ? (
            <button className="ghost" onClick={() => setShowSpec((v) => !v)}>
              {showSpec ? 'hide spec' : 'spec'}
            </button>
          ) : null}
        </div>
        {busy ? <p className="sub">{busy}</p> : null}
        <ErrorLine error={error} />
      </Panel>

      {spec ? <App spec={spec} state={state} run={run} undo={() => dispatchHist({ type: 'undo' })} canUndo={hist.past.length > 0} onEdit={edit} busy={!!busy} changes={changes} /> : null}

      {spec && showSpec ? (
        <Panel title="Spec" sub="The whole program — typed data a pure reducer runs. Every value in it was chosen by Jev from candidates code generated.">
          <pre className="mono small">{JSON.stringify(spec, null, 2)}</pre>
        </Panel>
      ) : null}
    </>
  );
}

/* ── the running app ───────────────────────────────────────────────────── */

function App(props: { spec: AppSpec; state: AppState; run: (op: Op) => void; undo: () => void; canUndo: boolean; onEdit: (t: string) => Promise<void>; busy: boolean; changes: string[] }) {
  const { spec, state, run } = props;
  const [cmd, setCmd] = useState('');
  const [said, setSaid] = useState<{ text: string; why: string; p: number; ok: boolean } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [editText, setEditText] = useState('');

  async function command() {
    const text = cmd.trim();
    if (!text) return;
    setThinking(true);
    try {
      const t0 = performance.now();
      const a = await d({ command: text, app: { title: spec.title, noun: spec.noun }, items: state.items.map((i) => i.name) }, commandQuestions(spec, state), 'program:command');
      const pl = planCommand(spec, state, text, a);
      if (pl.op) run(pl.op);
      setSaid({ text, why: `${pl.why} · ${Math.round(performance.now() - t0)} ms`, p: pl.p, ok: !!pl.op });
      if (pl.op) setCmd('');
    } catch (err) {
      setSaid({ text, why: (err as Error).message, p: 0, ok: false });
    } finally {
      setThinking(false);
    }
  }

  return (
    <section className={`panel rendered mood-${spec.mood}`}>
      <header className="panel-head">
        <div>
          <h2>{spec.title}</h2>
          <p className="sub">{[spec.noun && `${spec.noun}s`, ...spec.scalars.map((s) => s.kind)].filter(Boolean).join(' · ')}</p>
        </div>
        <button className="ghost" disabled={!props.canUndo} onClick={props.undo} aria-label="undo">
          ↶ undo
        </button>
      </header>

      <div className="cmdbar">
        <input
          value={cmd}
          placeholder={spec.noun ? `tell it what to do — “add …”, “mark … done”…` : 'tell it what to do…'}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !thinking && void command()}
        />
        <button className="primary" disabled={thinking || !cmd.trim()} onClick={() => void command()}>
          {thinking ? '…' : 'go'}
        </button>
      </div>
      {said ? (
        <p className={said.ok ? 'said' : 'said miss'}>
          “{said.text}” → {said.why}
          {said.p ? ` · ${Math.round(said.p * 100)}%` : ''}
        </p>
      ) : null}

      {spec.stats.length ? (
        <div className="stats">
          {spec.stats.map((st) => {
            const v = statValue(spec, state, st);
            return (
              <div key={st.id} className="stat">
                <span className="stat-v">
                  {fmtNum(v.value, st.field ? spec.fields.find((f) => f.id === st.field)?.type : undefined)}
                  {v.of !== undefined ? <small> / {fmtNum(v.of, st.field ? spec.fields.find((f) => f.id === st.field)?.type : undefined)}</small> : null}
                </span>
                <span className="stat-l">{st.label}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {spec.scalars.map((sc) =>
        sc.kind === 'counter' ? (
          <div key={sc.id} className="w-counter">
            <span className="w-label">{sc.label}</span>
            <div className="row">
              <button onClick={() => run({ op: 'inc', scalar: sc.id, by: -1 })} aria-label="decrease">
                −
              </button>
              <b>{state.scalars[sc.id] ?? 0}</b>
              <button onClick={() => run({ op: 'inc', scalar: sc.id, by: 1 })} aria-label="increase">
                +
              </button>
              <span className="sub">goal {sc.target}</span>
            </div>
            <progress max={sc.target} value={Math.min(sc.target, state.scalars[sc.id] ?? 0)} />
          </div>
        ) : sc.kind === 'timer' ? (
          <Timer key={sc.id} label={sc.label} t={state.timers[sc.id]} minutes={sc.target} onAct={(action) => run({ op: 'timer', scalar: sc.id, action })} />
        ) : (
          <p key={sc.id} className="sub">
            {sc.label}: {fmtNum(sc.target, 'money')}
          </p>
        ),
      )}

      {spec.noun ? <ItemList spec={spec} items={state.items} run={run} /> : null}

      {spec.actions.length && state.items.length ? (
        <div className="row">
          {spec.actions.map((ac) => (
            <button key={ac.id} className="ghost" onClick={() => run(ac.op === 'sortBy' ? { op: 'sortBy', field: ac.field! } : ac.op === 'clearDone' ? { op: 'clearDone', field: ac.field! } : { op: 'markAllDone', field: ac.field! })}>
              {ac.label}
            </button>
          ))}
        </div>
      ) : null}

      <details className="evolve">
        <summary>change the program</summary>
        <div className="cmdbar">
          <input
            value={editText}
            placeholder="“add a priority”, “make the timer 50 minutes”, “show the average”…"
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !props.busy && editText.trim() && void props.onEdit(editText.trim()).then(() => setEditText(''))}
          />
          <button disabled={props.busy || !editText.trim()} onClick={() => void props.onEdit(editText.trim()).then(() => setEditText(''))}>
            change
          </button>
        </div>
        <ol className="changes">
          {props.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}

const fmtNum = (n: number, type?: string) => (type === 'money' ? n.toFixed(2) : type === 'minutes' ? `${n} min` : String(n));

function Timer({ label, t, minutes, onAct }: { label: string; t?: { remaining: number; running: boolean; cycles: number }; minutes: number; onAct: (a: 'start' | 'pause' | 'reset') => void }) {
  const rem = t?.remaining ?? minutes * 60;
  return (
    <div className="w-timer">
      <span className="w-label">
        {label}
        {t?.cycles ? ` · ${t.cycles} done` : ''}
      </span>
      <b className="mono">
        {String(Math.floor(rem / 60)).padStart(2, '0')}:{String(rem % 60).padStart(2, '0')}
      </b>
      <div className="row">
        <button onClick={() => onAct(t?.running ? 'pause' : 'start')}>{t?.running ? 'pause' : 'start'}</button>
        <button className="ghost" onClick={() => onAct('reset')}>
          reset
        </button>
      </div>
    </div>
  );
}

/* ── the list: direct manipulation through the same typed ops ──────────── */

function ItemList({ spec, items, run }: { spec: AppSpec; items: Item[]; run: (op: Op) => void }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const done = completion(spec);

  async function add() {
    const n = name.trim();
    if (!n) return;
    setAdding(true);
    try {
      // Smart fields (category, priority…) classified by Jev in one call.
      const qs = smartQuestions(spec);
      const values = Object.keys(qs).length ? smartValues(spec, await d({ item: n, app: spec.title }, qs, 'program:smart')) : {};
      run({ op: 'add', name: n, values });
      setName('');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="w-list">
      <div className="cmdbar">
        <input value={name} placeholder={`new ${spec.noun}`} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !adding && void add()} />
        <button disabled={adding || !name.trim()} onClick={() => void add()}>
          {adding ? '…' : 'add'}
        </button>
      </div>
      {items.length ? (
        <ul className="items">
          {items.map((it) => {
            const isDone = done ? it[done.field.id] === done.value : false;
            return (
              <li key={it.id} className={isDone ? 'done' : ''}>
                {done?.field.type === 'bool' ? <input type="checkbox" checked={!!it[done.field.id]} onChange={() => run({ op: 'toggle', id: it.id, field: done.field.id })} aria-label="done" /> : null}
                <span className="item-name">{it.name}</span>
                <span className="item-fields">
                  {spec.fields
                    .filter((f) => f.type !== 'bool')
                    .map((f) => (
                      <FieldInput key={f.id} f={f} v={it[f.id]} onSet={(value) => run({ op: 'set', id: it.id, field: f.id, value })} />
                    ))}
                </span>
                <button className="ghost x" onClick={() => run({ op: 'remove', id: it.id })} aria-label={`remove ${it.name}`}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="sub">No {spec.noun}s yet — add one, or type “add …” above.</p>
      )}
    </div>
  );
}

function FieldInput({ f, v, onSet }: { f: FieldDef; v: Item[string]; onSet: (v: string | number | boolean) => void }) {
  switch (f.type) {
    case 'enum':
      return (
        <select value={String(v ?? '')} onChange={(e) => onSet(e.target.value)} aria-label={f.label}>
          {(f.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'rating':
      return (
        <span className="stars" aria-label={`${f.label} ${v}`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={Number(v) >= n ? 'star on' : 'star'} onClick={() => onSet(n)} aria-label={`${n} stars`}>
              ★
            </button>
          ))}
        </span>
      );
    case 'number':
    case 'money':
    case 'minutes':
      return <input className="num" type="number" value={Number(v ?? 0)} onChange={(e) => onSet(Number(e.target.value))} aria-label={f.label} title={f.label} />;
    case 'date':
      return <input type="date" value={String(v ?? '')} onChange={(e) => onSet(e.target.value)} aria-label={f.label} />;
    default:
      return <input value={String(v ?? '')} placeholder={f.label.toLowerCase()} onChange={(e) => onSet(e.target.value)} aria-label={f.label} />;
  }
}
