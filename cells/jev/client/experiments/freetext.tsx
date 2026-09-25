/* Experiment 01 — Free text: answers from a model that only discriminates. */
import * as React from 'react';
import { decide, decideMany, signIn, JevError } from '../lib/jev';
import { LEXICON_URL, LEXICON2_URL, parseLexicon } from '../lib/decode';
import { answer, type AnswerEvent, type Candidate, type Deps, type Kind } from '../lib/answer';
import { EVALSET } from '../lib/evalset';
import { Panel, Bar, ErrorLine } from '../ui';

const { useRef, useState } = React;

let lexiconCache: Promise<string[]> | null = null;
/** The 20k lexicon, fetched once from the CDN and kept for the session. */
function loadLexicon(): Promise<string[]> {
  lexiconCache ??= fetch(LEXICON_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`lexicon fetch failed: HTTP ${r.status}`);
      return r.text();
    })
    .then(parseLexicon)
    .catch((err) => {
      lexiconCache = null;
      throw err;
    });
  return lexiconCache;
}

let lexicon2Cache: Promise<string[]> | null = null;
/** Tier 2 (~30k rarer words), fetched only when an answer needs repair. */
function loadLexicon2(): Promise<string[]> {
  lexicon2Cache ??= Promise.all([loadLexicon(), fetch(LEXICON2_URL).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`tier-2 lexicon: HTTP ${r.status}`))))])
    .then(([one, txt]) => {
      const seen = new Set(one);
      return parseLexicon(txt).filter((w) => !seen.has(w));
    })
    .catch((err) => {
      lexicon2Cache = null;
      throw err;
    });
  return lexicon2Cache;
}

const depsFor = (signal?: AbortSignal): Deps => ({
  lexicon: loadLexicon,
  lexicon2: loadLexicon2,
  decide: async (state, questions, label) => (await decide(state, questions, label, signal)).answers,
  decideMany: (items, label) => decideMany(items, label),
  signal,
});

/** Display form: names and places title-cased; numbers and yes/no as-is. */
const display = (text: string, kind: Kind) => (kind === 'word' ? text.replace(/\b\w/g, (c) => c.toUpperCase()) : kind === 'yesno' ? text[0]?.toUpperCase() + text.slice(1) : text);

interface Phase {
  name: string;
  detail: string;
  top?: Candidate[];
  ms: number;
}

const EXAMPLES = ['Who invented the telephone?', 'What gas do plants absorb from the air?', 'In what year did the Berlin Wall fall?', 'Who painted the Mona Lisa?', 'Is a whale a fish?'];

export default function FreeText() {
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ answer: Candidate; alternatives: Candidate[]; kind: Kind; ms: number } | null>(null);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setPhases([]);
    const ac = new AbortController();
    abort.current = ac;
    const t0 = performance.now();
    try {
      if (!(await signIn())) throw new JevError('sign in to run experiments', 401);
      const onEvent = (e: AnswerEvent) => {
        if (e.type === 'phase') setPhases((ps) => [...ps, { name: e.name, detail: e.detail, top: e.top, ms: Math.round(performance.now() - t0) }]);
      };
      const r = await answer(question, depsFor(ac.signal), { onEvent });
      setResult({ ...r, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <>
      <Panel title="Free text" sub="Ask anything with a short answer. Jev can't write a word — it only judges — so code builds candidate answers and Jev recognises the right one, hundreds at a time.">
        <label className="field">
          <span>question</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && void run()} />
        </label>
        <div className="chips">
          {EXAMPLES.map((q) => (
            <button key={q} className="chip" onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !question.trim()} onClick={() => void run()}>
            {busy ? 'thinking…' : 'answer'}
          </button>
          {busy ? (
            <button className="ghost" onClick={() => abort.current?.abort()}>
              stop
            </button>
          ) : null}
        </div>
        <ErrorLine error={error} />
      </Panel>

      {result || busy ? (
        <section className="panel answer-card" aria-live="polite">
          {result ? (
            <>
              <p className="answer-label">answer</p>
              <p className="answer-text">{result.answer.text ? display(result.answer.text, result.kind) : '—'}</p>
              <Bar label="verified" p={result.answer.verified ?? 0} hint="Jev: is this EXACTLY right — every word correct?" />
              <p className="sub">
                {result.kind} · {(result.ms / 1000).toFixed(1)} s
              </p>
              {result.alternatives.length ? (
                <div className="alts">
                  {result.alternatives.map((a) => (
                    <span key={a.text} className="tag" title="verified">
                      {a.text} · {Math.round((a.verified ?? 0) * 100)}%
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="answer-text pending">…</p>
          )}
        </section>
      ) : null}

      {phases.length ? (
        <Panel title="How it got there" sub="Each stage is one round trip; everything inside a stage runs in parallel.">
          <ol className="phases">
            {phases.map((ph, i) => (
              <li key={i}>
                <b>{ph.name}</b> <span className="sub">{ph.detail} · {ph.ms} ms</span>
                {ph.top?.length ? (
                  <div className="alts">
                    {ph.top.map((c) => (
                      <span key={c.text} className="tag">
                        {c.text}
                        {c.verified !== undefined ? ` ${Math.round(c.verified * 100)}%` : ` ${Math.round(c.score * 100)}`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      <EvalPanel />
    </>
  );
}

/* ── the eval: every question at once ─────────────────────────────────── */

interface Row {
  q: string;
  got?: string;
  ok?: boolean;
  v?: number;
  ms?: number;
  err?: string;
}

function EvalPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [wall, setWall] = useState(0);

  async function runEval() {
    setBusy(true);
    setRows(EVALSET.map(([q]) => ({ q })));
    const t0 = performance.now();
    try {
      if (!(await signIn())) throw new JevError('sign in to run experiments', 401);
      await loadLexicon();
      await Promise.all(
        EVALSET.map(async ([q, expect], i) => {
          const s0 = performance.now();
          let row: Row;
          try {
            const r = await answer(q, depsFor());
            row = { q, got: r.answer.text, ok: expect.includes(r.answer.text), v: r.answer.verified, ms: Math.round(performance.now() - s0) };
          } catch (err) {
            row = { q, err: (err as Error).message, ms: Math.round(performance.now() - s0) };
          }
          setRows((rs) => rs.map((x, j) => (j === i ? row : x)));
        }),
      );
    } finally {
      setWall(Math.round(performance.now() - t0));
      setBusy(false);
    }
  }

  const done = rows.filter((r) => r.got !== undefined || r.err);
  const ok = rows.filter((r) => r.ok).length;
  return (
    <Panel title="Eval" sub={`${EVALSET.length} questions of mixed kinds, all concurrently. Accuracy, per-question latency and wall time.`}>
      <div className="row">
        <button disabled={busy} onClick={() => void runEval()}>
          {busy ? `running… ${done.length}/${EVALSET.length}` : 'run eval'}
        </button>
        {rows.length && !busy ? (
          <span className="sub">
            {ok}/{rows.length} correct · wall {(wall / 1000).toFixed(1)} s
          </span>
        ) : null}
      </div>
      {rows.length ? (
        <table className="rounds">
          <tbody>
            {rows.map((r) => (
              <tr key={r.q}>
                <td>{r.ok === undefined ? (r.err ? '!' : '…') : r.ok ? '✓' : '✗'}</td>
                <td>{r.q}</td>
                <td className="mono">{r.err ?? r.got ?? ''}</td>
                <td className="mono">{r.v !== undefined ? `${Math.round(r.v * 100)}%` : ''}</td>
                <td className="mono">{r.ms ? `${(r.ms / 1000).toFixed(1)}s` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Panel>
  );
}
