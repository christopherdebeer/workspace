/* Experiment 01 — Free text from a model that only answers typed questions. */
import * as React from 'react';
import { decide, JevError, signIn } from '../lib/jev';
import {
  END,
  SPELL,
  PROBES,
  acceptLookahead,
  appendWord,
  charQuestion,
  collapse,
  decodeState,
  glyph,
  lookaheadQuestions,
  superposeQuestions,
  wordQuestion,
  type Tok,
} from '../lib/decode';
import type { Answers } from '../lib/types';
import { Panel, Bar, Distribution, ConfidentText, ErrorLine } from '../ui';

const { useRef, useState } = React;

type Mode = 'probe' | 'spell' | 'lookahead' | 'words' | 'superpose';
const MODES: Record<Mode, { name: string; blurb: string }> = {
  probe: { name: 'probe', blurb: 'No text at all — one call, a dozen features of an answer that is never written.' },
  spell: { name: 'spell', blurb: 'One character per call, autoregressive. The honest baseline: correct-ish, slow.' },
  lookahead: { name: 'lookahead', blurb: 'k characters per call, asked in parallel; keep the prefix that clears θ. Speculative decoding with no draft model.' },
  words: { name: 'words', blurb: 'A word per call from a 253-word vocabulary; ✎ escapes to spelling for anything outside it.' },
  superpose: { name: 'superpose', blurb: 'ONE call asks every typed decoder at once (yes/no, digits, year…) plus "what kind of answer?", then collapses.' },
};

interface Round {
  n: number;
  ms: number;
  q: number;
  got: string;
}

const EXAMPLES = ['What is the capital of Australia?', 'How many legs does a spider have?', 'In what year did the Berlin Wall fall?', 'Is the sun a star?', 'Who wrote Hamlet?'];

export default function FreeText() {
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [mode, setMode] = useState<Mode>('lookahead');
  const [k, setK] = useState(6);
  const [theta, setTheta] = useState(0.6);
  const [maxLen, setMaxLen] = useState(48);
  const [out, setOut] = useState<Array<{ text: string; p: number }>>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [probe, setProbe] = useState<Answers | null>(null);
  const [superposed, setSuperposed] = useState<Answers | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const reset = () => {
    setOut([]);
    setRounds([]);
    setProbe(null);
    setSuperposed(null);
    setError(null);
  };

  async function run() {
    reset();
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    const pushTokens = (toks: Tok[]) => setOut((o) => [...o, ...toks.map((t) => ({ text: glyph(t.tok), p: t.p }))]);
    const log = (r: Round) => setRounds((rs) => [...rs, r]);
    let prefix = '';
    try {
      if (!(await signIn())) throw new JevError('sign in to run experiments', 401);

      if (mode === 'probe') {
        const r = await decide({ question }, PROBES, 'probe', ac.signal);
        setProbe(r.answers);
        log({ n: 1, ms: r.ms, q: Object.keys(PROBES).length, got: '(features)' });
        return;
      }

      let n = 0;
      if (mode === 'superpose') {
        const qs = superposeQuestions();
        const r = await decide({ question }, qs, 'superpose', ac.signal);
        setSuperposed(r.answers);
        const c = collapse(r.answers);
        log({ n: ++n, ms: r.ms, q: Object.keys(qs).length, got: c.text ?? `(${c.kind} → spelling)` });
        if (c.text !== null) {
          setOut([{ text: c.text, p: c.kindP }]);
          return;
        }
        // word/phrase: superposition can't hold it — fall through to lookahead.
      }

      if (mode === 'words') {
        let spelling = false;
        while (prefix.length < maxLen && !ac.signal.aborted) {
          if (!spelling) {
            const r = await decide(decodeState(question, prefix), { w: wordQuestion() }, 'word', ac.signal);
            const a = r.answers.w;
            const w = a?.choice ?? END;
            const p = a?.confidence ?? 0;
            log({ n: ++n, ms: r.ms, q: 1, got: w });
            if (w === END) break;
            if (w === SPELL) {
              spelling = true;
              if (prefix) {
                prefix += ' ';
                setOut((o) => [...o, { text: ' ', p }]);
              }
              continue;
            }
            const next = appendWord(prefix, w);
            setOut((o) => [...o, { text: next.slice(prefix.length), p }]);
            prefix = next;
          } else {
            const r = await decide(decodeState(question, prefix), { c0: charQuestion(0) }, 'spell', ac.signal);
            const t = { tok: r.answers.c0?.choice ?? END, p: r.answers.c0?.confidence ?? 0 };
            log({ n: ++n, ms: r.ms, q: 1, got: t.tok });
            if (t.tok === END) break;
            if (glyph(t.tok) === ' ') {
              spelling = false;
              prefix = prefix.trimEnd();
              continue;
            }
            prefix += glyph(t.tok);
            pushTokens([t]);
          }
        }
        return;
      }

      // spell (k=1) and lookahead (k>1) share one loop.
      const kk = mode === 'spell' ? 1 : k;
      const qs = lookaheadQuestions(kk);
      while (prefix.length < maxLen && !ac.signal.aborted) {
        const r = await decide(decodeState(question, prefix), qs, mode, ac.signal);
        const { tokens, done } = acceptLookahead(r.answers, kk, theta);
        const text = tokens.map((t) => glyph(t.tok)).join('');
        log({ n: ++n, ms: r.ms, q: kk, got: text || '∅' });
        pushTokens(tokens.filter((t) => t.tok !== END));
        prefix += text;
        if (done || !tokens.length) break;
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  const totalMs = rounds.reduce((s, r) => s + r.ms, 0);
  const chars = out.reduce((s, t) => s + t.text.length, 0);

  return (
    <>
      <Panel title="Free text" sub="Jev never writes prose. Each decoder below extracts a string anyway — trading round trips for parallel questions.">
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
        <div className="seg" role="tablist" aria-label="decoder">
          {(Object.keys(MODES) as Mode[]).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {MODES[m].name}
            </button>
          ))}
        </div>
        <p className="sub">{MODES[mode].blurb}</p>
        {mode === 'lookahead' || mode === 'superpose' ? (
          <div className="knobs">
            <label>
              k = {k}
              <input type="range" min={2} max={12} value={k} onChange={(e) => setK(Number(e.target.value))} />
            </label>
            <label>
              θ = {theta.toFixed(2)}
              <input type="range" min={0.2} max={0.95} step={0.05} value={theta} onChange={(e) => setTheta(Number(e.target.value))} />
            </label>
          </div>
        ) : null}
        {mode !== 'probe' && mode !== 'superpose' ? (
          <div className="knobs">
            <label>
              max length = {maxLen}
              <input type="range" min={8} max={120} step={4} value={maxLen} onChange={(e) => setMaxLen(Number(e.target.value))} />
            </label>
          </div>
        ) : null}
        <div className="row">
          <button className="primary" disabled={busy || !question.trim()} onClick={() => void run()}>
            {busy ? 'decoding…' : 'decode'}
          </button>
          {busy ? (
            <button className="ghost" onClick={() => abort.current?.abort()}>
              stop
            </button>
          ) : null}
        </div>
        <ErrorLine error={error} />
      </Panel>

      {out.length || rounds.length ? (
        <Panel title="Output" sub={rounds.length ? `${chars} chars · ${rounds.length} round trips · ${totalMs} ms · ${chars ? Math.round(totalMs / chars) : 0} ms/char` : undefined}>
          <p className="decoded">
            <ConfidentText tokens={out} />
            {busy ? <span className="caret">▍</span> : null}
          </p>
          <details>
            <summary>rounds</summary>
            <table className="rounds">
              <thead>
                <tr>
                  <th>#</th>
                  <th>ms</th>
                  <th>q</th>
                  <th>got</th>
                </tr>
              </thead>
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td>{r.ms}</td>
                    <td>{r.q}</td>
                    <td className="mono">{r.got}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Panel>
      ) : null}

      {superposed ? (
        <Panel title="Superposition" sub="Every decoder's answer, from the same single call — only the winning kind is read.">
          <Distribution probs={superposed.kind?.probabilities} />
          <div className="grid2">
            <Bar label="yes" p={superposed.yes?.noul ?? 0} />
            <Bar label="negative" p={superposed.negative?.noul ?? 0} />
          </div>
          <p className="mono small">
            digits {superposed.ndigits?.choice}: {[0, 1, 2, 3, 4, 5, 6].map((i) => superposed[`d${i}`]?.choice ?? '·').join('')} · year{' '}
            {[0, 1, 2, 3].map((i) => superposed[`y${i}`]?.choice ?? '·').join('')} {superposed.ce?.choice} · first {superposed.first?.choice}
          </p>
        </Panel>
      ) : null}

      {probe ? (
        <Panel title="Fingerprint" sub="What Jev believes about an answer it never wrote.">
          {Object.entries(PROBES).map(([name, q]) => {
            const a = probe[name];
            if (q.type === 'noul') return <Bar key={name} label={name} p={a?.noul ?? 0} />;
            return (
              <div key={name} className="probe-dist">
                <span className="bar-label">{name}</span>
                <Distribution probs={a?.probabilities} n={3} />
              </div>
            );
          })}
        </Panel>
      ) : null}
    </>
  );
}
