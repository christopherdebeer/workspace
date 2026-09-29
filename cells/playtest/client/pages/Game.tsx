import * as React from 'react';
import { useApi, Loading, Panel, Stat, Status, A, ScoreChart, JobButton, SignIn, f3, signed, when, ago, go, useAuthed, type ChartPoint } from '../ui';
import type { GameView, MechanicsView, Version, Declared } from '../lib/types';
import { diffLines } from '../lib/diff';

const { useState, useMemo, useEffect } = React;

export function Game({ slug }: { slug: string }) {
  const { data, error, reload } = useApi<GameView>(`game/${encodeURIComponent(slug)}`);
  if (!data) return <Loading error={error} />;
  const { game, evals, rounds, suite } = data;
  const noise = suite.noise ?? null;
  const threshold = Math.max(suite.epsilon, noise ?? 0);
  const baseline = [...evals].reverse().find((e) => e.version === game.head && e.engine === data.engine && e.suite === suite.hash);
  const points: ChartPoint[] = evals.map((e, i) => ({ key: e.id, label: `#${i + 1}`, train: e.train, test: e.test, note: `v${e.version} ${e.tag}${e.engine !== data.engine ? ' · older engine' : ''}`, href: `/eval/${e.id}` }));
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        <A to="/games">Games</A> / <span className="mono">{game.slug}</span>
      </p>
      <h1>{game.name}</h1>
      <div className="row">
        <Status s={game.climb?.status ?? 'idle'} label={`climb: ${game.climb?.status ?? 'idle'}`} />
        <span className="tag">head v{game.head}</span>
        {game.best ? <span className="tag">best v{game.best}</span> : null}
        <span className="tag">engine {data.engine}</span>
      </div>

      <Panel title="Where it stands">
        <div className="stats">
          <Stat v={f3(baseline?.train)} l="baseline train" title="Eval of the head on the current engine and suite — the number a proposal must beat" />
          <Stat v={f3(baseline?.test)} l="baseline test" />
          <Stat v={evals.length} l="evals" />
          <Stat v={`${rounds.filter((r) => r.decision === 'kept').length}/${rounds.length}`} l="rounds kept" />
          <Stat v={`${game.climb?.stall ?? 0}/3`} l="rounds since a keep" />
          <Stat v={f3(threshold)} l="must beat (ε or noise)" title={`epsilon ${suite.epsilon}${noise !== null ? `, measured noise ${noise}` : ', noise not measured yet'}`} />
        </div>
        {!baseline && <p className="small muted">No baseline for the current head on this engine and suite yet — run an evaluation.</p>}
        {baseline && noise === null && <p className="small muted">Noise hasn't been measured — do that once before climbing, so chance improvements aren't kept.</p>}
      </Panel>

      <Panel title="Score over time" sub="Every evaluation of this game, in order. Click a point to open it.">
        <ScoreChart points={points} title={`${game.name} evaluations`} />
      </Panel>

      <Actions data={data} onChange={reload} />

      <Panel title="Climb rounds" sub="Each round is one proposed change, evaluated against the baseline.">
        {!rounds.length ? (
          <p className="muted small">No rounds yet.</p>
        ) : (
          <div className="scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>#</th>
                  <th>change</th>
                  <th className="num">Δ train</th>
                  <th className="num">Δ test</th>
                  <th>decision</th>
                </tr>
              </thead>
              <tbody>
                {[...rounds].reverse().map((r) => (
                  <tr key={r.round}>
                    <td className="mono">{r.round}</td>
                    <td>
                      <div>
                        v{r.from} → v{r.to} <span className="muted small">{ago(r.createdAt)}</span>
                      </div>
                      <div className="small">{r.rationale}</div>
                      <div className="small muted">
                        <A to={`/eval/${r.baseline.evalId}`}>baseline {f3(r.baseline.train)}/{f3(r.baseline.test)}</A> → <A to={`/eval/${r.candidate.evalId}`}>candidate {f3(r.candidate.train)}/{f3(r.candidate.test)}</A>
                      </div>
                    </td>
                    <td className="num">{signed(r.delta.train)}</td>
                    <td className="num">{signed(r.delta.test)}</td>
                    <td>
                      <Status s={r.decision} />
                      <div className="small muted">{r.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Definition data={data} onChange={reload} />

      <Panel title="Evaluation suite" sub="Train games are readable in full; held-out test games only ever show a score.">
        <dl className="kv">
          <dt>train</dt>
          <dd className="mono">
            seeds {suite.train.seeds.join(', ')} × players {suite.train.players.join(', ')}
          </dd>
          <dt>test (held out)</dt>
          <dd className="mono">
            seeds {suite.test.seeds.join(', ')} × players {suite.test.players.join(', ')}
          </dd>
          <dt>step limit</dt>
          <dd className="mono">{suite.maxSteps}</dd>
          <dt>ε (min change)</dt>
          <dd className="mono">{suite.epsilon}</dd>
          <dt>noise</dt>
          <dd className="mono">{noise ?? 'not measured'}</dd>
          <dt>suite hash</dt>
          <dd className="mono">{suite.hash}</dd>
        </dl>
        <p className="small muted">Player counts outside the game's own range are skipped. Changing the suite (owner only, via set_suite) invalidates baselines.</p>
      </Panel>

      <Panel title="All evaluations">
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>when</th>
                <th>version</th>
                <th>tag</th>
                <th className="num">train</th>
                <th className="num">test</th>
                <th>engine</th>
              </tr>
            </thead>
            <tbody>
              {[...evals].reverse().map((e) => (
                <tr key={e.id} className="link" onClick={() => go(`/eval/${e.id}`)}>
                  <td className="small">{when(e.createdAt)}</td>
                  <td>v{e.version}</td>
                  <td>
                    <span className="tag">{e.tag}</span>
                  </td>
                  <td className="num">{f3(e.train)}</td>
                  <td className="num">{f3(e.test)}</td>
                  <td className="mono small">
                    {e.engine}
                    {e.engine !== data.engine ? <span className="muted"> (older)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

/* ── run things ─────────────────────────────────────────────────────── */

function Actions({ data, onChange }: { data: GameView; onChange: () => void }) {
  const slug = data.game.slug;
  const [seed, setSeed] = useState('1');
  const [players, setPlayers] = useState('2');
  const [last, setLast] = useState<string | null>(null);
  return (
    <Panel title="Evaluate & play" sub="Each evaluation plays the whole suite with Jev (about a minute, ~$0.02). Signed-in accounts with access to this cell can run these.">
      <SignIn why="to run evaluations and playtests." />
      <div className="row">
        <JobButton tool="eval" label={`Evaluate head (v${data.game.head})`} primary input={() => ({ game: slug })} onDone={(o) => { onChange(); setLast(o?.eval ? `train ${f3(o.eval.train.score)} · test ${f3(o.eval.test.score)}` : null); }} />
        <JobButton tool="noise" label="Measure noise" input={() => ({ game: slug })} onDone={(o) => { onChange(); setLast(o ? `noise ${o.noise} → proposals must beat ${o.effectiveThreshold}` : null); }} />
      </div>
      {last && <p className="small">{last}</p>}
      <h3>Play one game</h3>
      <div className="row">
        <label className="field" style={{ width: '6rem', margin: 0 }}>
          seed
          <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </label>
        <label className="field" style={{ width: '6rem', margin: 0 }}>
          players
          <input inputMode="numeric" value={players} onChange={(e) => setPlayers(e.target.value)} />
        </label>
        <div style={{ alignSelf: 'flex-end' }}>
          <JobButton tool="playtest" label="Play" input={() => ({ game: slug, seed: Number(seed) || 1, players: Number(players) || 2 })} onDone={(o) => o?.run && go(`/run/${o.run}`)} />
        </div>
      </div>
      <p className="small muted">A single game isn't part of any eval — it's for watching how the rules play. It opens the full record when done.</p>
    </Panel>
  );
}

/* ── the rules: view, diff, edit, propose ───────────────────────────── */

function useMechanicStatus(): Map<string, string> | null {
  const { data } = useApi<MechanicsView>('mechanics');
  return useMemo(() => (data ? new Map(data.mechanics.map((m) => [m.slug, m.status])) : null), [data]);
}

function DeclaredTags({ d }: { d: Declared }) {
  const status = useMechanicStatus();
  if (d.error) return <p className="error">⚠ the rules don't parse: {d.error}</p>;
  return (
    <div className="tags" style={{ margin: '.4rem 0' }}>
      {d.mechanics.map((m) => (
        <a key={m} href={`#/mechanics?q=${encodeURIComponent(m)}`} style={{ textDecoration: 'none' }}>
          <Status s={status?.get(m) ?? ''} label={m} />
        </a>
      ))}
      {d.unhandledEffects.map((e) => (
        <Status key={e} s="unhandled" label={`card effect ${e}`} />
      ))}
    </div>
  );
}

function Definition({ data, onChange }: { data: GameView; onChange: () => void }) {
  const slug = data.game.slug;
  const [v, setV] = useState<number>(data.game.head);
  const [mode, setMode] = useState<'read' | 'diff' | 'edit'>('read');
  const shown = useApi<{ version: number; rules: string; parent: number | null; rationale: string; status: string; author: string; createdAt: string; declared: Declared }>(`game/${encodeURIComponent(slug)}/v/${v}`);
  const parentV = shown.data?.parent ?? null;
  const parent = useApi<{ rules: string }>(parentV ? `game/${encodeURIComponent(slug)}/v/${parentV}` : null, [parentV]);
  const [draft, setDraft] = useState('');
  const [rationale, setRationale] = useState('');
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [ok] = useAuthed();
  useEffect(() => {
    if (mode === 'edit' && data.head) setDraft(data.head.rules);
  }, [mode]);
  const version = data.versions.find((x) => x.version === v);
  return (
    <Panel title="Rules" sub="Every version is kept with who made it and why. The head is what evaluations and proposals start from.">
      <div className="row">
        <select value={v} onChange={(e) => { setV(Number(e.target.value)); setMode('read'); }} style={{ width: 'auto' }} aria-label="version">
          {[...data.versions].reverse().map((x: Version) => (
            <option key={x.version} value={x.version}>
              v{x.version} · {x.version === data.game.head ? 'head' : x.status}
            </option>
          ))}
        </select>
        <div role="tablist" className="row" style={{ margin: 0 }}>
          <button role="tab" aria-selected={mode === 'read'} className={mode === 'read' ? 'primary' : ''} onClick={() => setMode('read')}>
            Read
          </button>
          <button role="tab" aria-selected={mode === 'diff'} className={mode === 'diff' ? 'primary' : ''} onClick={() => setMode('diff')} disabled={!parentV}>
            Changes vs v{parentV ?? '–'}
          </button>
          <button role="tab" aria-selected={mode === 'edit'} className={mode === 'edit' ? 'primary' : ''} onClick={() => { setV(data.game.head); setMode('edit'); }}>
            Edit head
          </button>
        </div>
      </div>
      {version && mode !== 'edit' && (
        <p className="small">
          <Status s={version.status} /> <span className="muted">{when(version.createdAt)} by {version.author}</span> — {version.rationale}
        </p>
      )}
      {mode === 'read' && (shown.data ? <><DeclaredTags d={shown.data.declared} /><pre className="code">{shown.data.rules}</pre></> : <Loading error={shown.error} />)}
      {mode === 'diff' && (shown.data && parent.data ? <Diff a={parent.data.rules} b={shown.data.rules} /> : <Loading error={shown.error ?? parent.error} />)}
      {mode === 'edit' && (
        <>
          <SignIn why="to save or propose changes." />
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="RULES.md" spellCheck={false} />
          <label className="field">
            why — the problem this change fixes (required to propose; seen in the change log)
            <input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="e.g. two of three train games hit the round limit: nobody can reach 10 points" />
          </label>
          {data.head && draft !== data.head.rules && (
            <details>
              <summary>preview changes</summary>
              <Diff a={data.head.rules} b={draft} />
            </details>
          )}
          <div className="row">
            <JobButton
              tool="propose"
              label="Propose as a climb round"
              primary
              disabled={!ok}
              input={() => {
                if (!rationale.trim()) return setMsg(<span className="error">say why first</span>), null;
                if (draft === data.head?.rules) return setMsg(<span className="error">nothing changed</span>), null;
                setMsg(null);
                return { game: slug, rules: draft, rationale };
              }}
              onDone={(o) => {
                onChange();
                setMode('read');
                setMsg(o?.round ? <><Status s={o.round.decision} /> {o.round.reason}{o.stalled ? ' — the climb is now stalled; see the diagnosis in the eval.' : ''}</> : null);
              }}
            />
            <JobButton
              tool="put_definition"
              label="Save as new head (no eval)"
              confirm="Save directly as the new head? This skips the keep/revert test; you'll need to evaluate again for a new baseline."
              disabled={!ok}
              input={() => (draft === data.head?.rules ? (setMsg(<span className="error">nothing changed</span>), null) : { game: slug, rules: draft, rationale: rationale || 'manual edit' })}
              onDone={() => {
                onChange();
                setMode('read');
                setMsg('saved as the new head — evaluate it for a baseline');
              }}
            />
          </div>
          <p className="small muted">
            A proposal is evaluated on the full suite (a minute or so) and kept only if train improves by at least {f3(Math.max(data.suite.epsilon, data.suite.noise ?? 0))} and the held-out
            test improves too. A direct save is for fixing a definition outside the climb.
          </p>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </Panel>
  );
}

function Diff({ a, b }: { a: string; b: string }) {
  const lines = useMemo(() => diffLines(a, b), [a, b]);
  const changed = lines.filter((l) => l.op !== ' ').length;
  if (!changed) return <p className="muted small">No differences.</p>;
  // Show changed lines with two lines of context; fold the rest.
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (l.op !== ' ') for (let k = i - 2; k <= i + 2; k++) keep.add(k);
  });
  const out: React.ReactNode[] = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (!keep.has(i)) {
      if (!gap) out.push(<div key={`g${i}`} className="muted">⋯</div>);
      gap = true;
      return;
    }
    gap = false;
    out.push(
      <div key={i} style={{ background: l.op === '+' ? 'color-mix(in srgb, var(--good) 14%, transparent)' : l.op === '-' ? 'color-mix(in srgb, var(--bad) 14%, transparent)' : undefined }}>
        <span aria-label={l.op === '+' ? 'added' : l.op === '-' ? 'removed' : undefined}>{l.op}</span> {l.text}
      </div>,
    );
  });
  return <pre className="code">{out}</pre>;
}
