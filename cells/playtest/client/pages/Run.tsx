import * as React from 'react';
import { useApi, Loading, Panel, Stat, A, Bar, f3, pct, when } from '../ui';
import type { RunView, Turn, Finding } from '../lib/types';
import { FindingList } from './Eval';
import { CritiquePanel } from './Critique';

const { useState } = React;

/** Jev's score answers are expected levels on these ordered scales (lowest = 0). */
const SCALES: Array<['decisive' | 'agency' | 'pacing', string[]]> = [
  ['decisive', ['no clear result', 'narrow', 'clear', 'crushing']],
  ['agency', ['almost none', 'a little', 'some', 'a lot']],
  ['pacing', ['far too short', 'short', 'about right', 'long', 'far too long']],
];

export function Run({ id }: { id: string }) {
  const { data, error } = useApi<RunView>(`run/${encodeURIComponent(id)}/turns/0`);
  if (!data) return <Loading error={error} />;
  if (data.heldOut)
    return (
      <Panel title="Held-out game">
        <p>
          This game is part of a held-out test split. Its score is <strong>{f3(data.score)}</strong>; the moves are deliberately not shown, so nobody tuning the rules can
          tune to it.
        </p>
      </Panel>
    );
  const m = data.metrics ?? {};
  const j = data.judgement;
  const findings = (data.findings ?? []).filter((f): f is Finding => typeof f === 'object');
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        <A to="/games">Games</A>
        {data.game ? (
          <>
            {' '}
            / <A to={`/g/${data.game}`}>{data.game}</A>
          </>
        ) : null}{' '}
        / run <span className="mono">{data.id}</span>
      </p>
      <h1>
        {data.game ?? 'Ad-hoc game'}
        {data.version ? ` v${data.version}` : ''} · seed {data.seed}, {data.players} players
      </h1>
      <p className="muted small">
        {data.createdAt ? when(data.createdAt) : ''} · {data.split} · engine <span className="mono">{data.engine}</span>
      </p>
      <Panel>
        <div className="stats">
          <Stat v={f3(data.score)} l="score" />
          <Stat v={data.steps ?? '—'} l="moves" />
          <Stat v={data.rounds ?? '—'} l="rounds" />
          <Stat v={m.winner ?? '—'} l="winner" />
          <Stat v={pct(m.forcedShare)} l="forced moves" />
          <Stat v={m.meanValid !== undefined ? Number(m.meanValid).toFixed(1) : '—'} l="legal moves / turn" />
          <Stat v={pct(m.meanConfidence)} l="Jev confidence" />
        </div>
        <p className="small">
          Ended: <strong>{data.endReason ?? data.stopped ?? '—'}</strong>
        </p>
      </Panel>
      <div className="grid two">
        <Panel title="Score parts">
          {data.parts ? Object.entries(data.parts).map(([k, v]) => <Bar key={k} label={k} value={v} />) : <p className="muted small">—</p>}
        </Panel>
        <Panel title="Jev's judgement" sub="Probabilities over five verdicts, then where the session sits on a few ordered scales.">
          {j ? (
            <>
              {Object.entries(j.health.probabilities)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Bar key={k} label={k} value={v} text={pct(v)} />
                ))}
              <h3>Aspects</h3>
              {SCALES.map(([k, levels]) =>
                j[k] !== null && j[k] !== undefined ? <Bar key={k} label={k} value={j[k] as number} max={levels.length - 1} text={levels[Math.round(j[k] as number)] ?? f3(j[k])} /> : null,
              )}
              {j.endedByRule !== null && <Bar label="ended by its win rule" value={j.endedByRule} text={pct(j.endedByRule)} />}
              {j.runaway !== null && <Bar label="runaway leader" value={j.runaway} text={pct(j.runaway)} />}
            </>
          ) : (
            <p className="muted small">Not judged (no moves were played).</p>
          )}
        </Panel>
      </div>
      {j?.critique && <CritiquePanel c={j.critique} title="Critique" sub="Jev reviews the whole game as a designer would: the rules, the move-by-move record and the outcome." />}
      {m.actionMix && (
        <Panel title="Move mix" sub="Share of moves by kind — a single dominant kind costs variety.">
          {Object.entries(m.actionMix as Record<string, number>)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <Bar key={k} label={k} value={v / (m.steps || 1)} text={`${v} · ${pct(v / (m.steps || 1))}`} />
            ))}
        </Panel>
      )}
      <Panel title="Findings" sub="What the engine or Jev flagged in this session.">
        <FindingList items={findings} />
      </Panel>
      <Turns id={data.id} first={data.turns ?? []} total={data.totalTurns ?? 0} />
    </>
  );
}

function Turns({ id, first, total }: { id: string; first: Turn[]; total: number }) {
  const [turns, setTurns] = useState(first);
  const [busy, setBusy] = useState(false);
  const more = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/@c15r/playtest/api/run/${encodeURIComponent(id)}/turns/${turns.length}`).then((x) => x.json());
      setTurns((t) => [...t, ...((r.turns ?? []) as Turn[])]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Every move" sub="Legal = moves left after the engine's validator; confidence = Jev's probability for the move it chose; forced moves skip Jev.">
      <div className="scroll">
        <table className="t">
          <thead>
            <tr>
              <th className="num">#</th>
              <th className="num">round</th>
              <th>player</th>
              <th>move</th>
              <th className="num">legal</th>
              <th className="num">conf.</th>
              <th>runner-up</th>
            </tr>
          </thead>
          <tbody>
            {turns.map((t) => (
              <tr key={t.step}>
                <td className="num">{t.step}</td>
                <td className="num">{t.round}</td>
                <td className="mono small">{t.player}</td>
                <td className="small">
                  {t.move}
                  {t.fallback ? <span className="tag warn"> fallback</span> : null}
                </td>
                <td className="num">{t.valid}</td>
                <td className="num">{t.forced ? 'forced' : pct(t.confidence)}</td>
                <td className="small muted">{t.runnerUp ? `${t.runnerUp[0]} (${pct(t.runnerUp[1])})` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {turns.length < total && (
        <button onClick={more} disabled={busy}>
          {busy ? 'loading…' : `more (${turns.length} of ${total})`}
        </button>
      )}
    </Panel>
  );
}
