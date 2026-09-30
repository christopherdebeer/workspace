import * as React from 'react';
import { useApi, Loading, Panel, Stat, Status, A, Bar, f3, when, go } from '../ui';
import type { EvalView, Parts, Finding } from '../lib/types';
import { CritiquePanel } from './Critique';

const WEIGHTS_V1: Partial<Record<keyof Parts, number>> = { ended: 0.3, judged: 0.2, variety: 0.15, agency: 0.15, length: 0.1, clean: 0.1 };
const WEIGHTS_V2: Partial<Record<keyof Parts, number>> = { ended: 0.25, critique: 0.2, judged: 0.15, variety: 0.1, agency: 0.1, length: 0.1, clean: 0.1 };

export function FindingList({ items }: { items: Finding[] }) {
  if (!items.length) return <p className="muted small">None.</p>;
  const order = { error: 0, warn: 1, info: 2 };
  return (
    <ul className="timeline">
      {[...items].sort((a, b) => order[a.severity] - order[b.severity]).map((f, i) => (
        <li key={i} style={{ gridTemplateColumns: '5.2rem 1fr' }}>
          <span>
            <Status s={f.severity} />
          </span>
          <div className="small">
            <span className="mono">{f.kind}</span> · <strong>{f.subject}</strong>
            <div className="muted">{f.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Eval({ id }: { id: string }) {
  const { data, error } = useApi<EvalView>(`eval/${encodeURIComponent(id)}`);
  if (!data) return <Loading error={error} />;
  const runs = data.train.runs;
  const WEIGHTS = data.scoreVersion === 'score/v1' ? WEIGHTS_V1 : WEIGHTS_V2;
  const mean = (k: keyof Parts) => (runs.length ? runs.reduce((a, r) => a + (r.parts?.[k] ?? 0), 0) / runs.length : 0);
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        <A to="/games">Games</A> / <A to={`/g/${data.game}`}>{data.game}</A> / eval <span className="mono">{data.id}</span>
      </p>
      <h1>
        {data.game} v{data.version} <span className="tag">{data.tag}</span>
      </h1>
      <p className="muted small">
        {when(data.createdAt)} · engine <span className="mono">{data.engine}</span> · suite <span className="mono">{data.suite}</span> · {data.scoreVersion}
      </p>
      <Panel>
        <div className="stats">
          <Stat v={f3(data.train.score)} l="train score" />
          <Stat v={f3(data.test.score)} l="held-out test score" />
          <Stat v={runs.length} l="train games" />
          <Stat v={data.test.n} l="test games (hidden)" />
          <Stat v={f3(data.definitionHealth)} l="definition health" />
          {data.train.balance !== undefined && data.train.balance !== null && <Stat v={f3(data.train.balance)} l="outcome balance (train)" title="Normalised entropy of who won, by secret role (or seat): 1 = every role wins equally often" />}
          <Stat v={`${Math.round(data.ms / 1000)}s`} l="took" />
          <Stat v={`$${data.usd.toFixed(3)}`} l="Jev cost" title={`${data.tokens.toLocaleString()} input tokens`} />
        </div>
      </Panel>
      <Panel title="Where the train points come from" sub="Average of each score part across train games (0–1), with its weight.">
        {(Object.keys(WEIGHTS) as Array<keyof Parts>).map((k) => (
          <Bar key={k} label={`${k} ×${WEIGHTS[k]}`} value={mean(k)} />
        ))}
      </Panel>
      {data.train.critique?.outcomes && (
        <Panel title="Who won, as what" sub="Train games by the winner's secret role and how the game ended — the first place a balance problem shows.">
          {Object.entries(data.train.critique.outcomes)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <Bar key={k} label={k} value={v} max={data.train.runs.length} text={`${v} of ${data.train.runs.length}`} />
            ))}
        </Panel>
      )}
      {data.train.critique?.byPersona && Object.keys(data.train.critique.byPersona).length > 1 && (
        <Panel title="By player persona" sub="Odd seeds are played by trusting players, even seeds by suspicious ones. A rule change that helps only one kind of player is fitting the players, not improving the game.">
          <div className="scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>persona</th>
                  <th className="num">games</th>
                  <th className="num">mean run score</th>
                  <th>who won</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.train.critique.byPersona).map(([p, b]) => (
                  <tr key={p}>
                    <td>{p}</td>
                    <td className="num">{b.n}</td>
                    <td className="num">{f3(b.score)}</td>
                    <td className="small">{Object.entries(b.outcomes).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {data.train.critique && <CritiquePanel c={data.train.critique} title="Critique (train games)" sub="Jev's qualitative review, averaged over the train games; the named weakness / strength / change are probability shares across games." />}
      <Panel title="Train games" sub="Held-out test games are played and scored but never shown — that is what keeps the test honest.">
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>seed × players</th>
                <th className="num">score</th>
                <th>how it ended</th>
                <th className="num">steps</th>
                <th className="num">rounds</th>
                <th>winner (role)</th>
                <th>Jev's verdict</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="link" onClick={() => go(`/run/${r.id}`)}>
                  <td className="mono">
                    <A to={`/run/${r.id}`}>
                      {r.seed} × {r.players}p
                    </A>
                  </td>
                  <td className="num">{f3(r.score)}</td>
                  <td className="small">{r.endReason ?? r.stopped ?? '—'}</td>
                  <td className="num">{r.steps ?? '—'}</td>
                  <td className="num">{r.rounds ?? '—'}</td>
                  <td className="small">{r.winnerRole ? `${r.winnerRole} · ${r.endKind}` : '—'}</td>
                  <td className="small">{r.verdict ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="What the classifier found in the rules" sub="Declared vs implemented mechanics, prose the settings don't configure, card effects nothing handles.">
        <FindingList items={data.classificationFindings} />
      </Panel>
    </>
  );
}
