import * as React from 'react';
import { useApi, Loading, Panel, Status, Stat, f3, ago, JobButton, SignIn, go } from '../ui';
import type { GameRow, Preset } from '../lib/types';

const { useState } = React;

export function Games() {
  const { data, error } = useApi<GameRow[]>('games');
  return (
    <>
      <h1>Games</h1>
      <p className="lede">Each game is a versioned rules file with an evaluation suite and a climb history. Open one to see its scores, rounds and rules.</p>
      <Panel>
        {!data ? (
          <Loading error={error} />
        ) : !data.length ? (
          <p className="muted">No games yet — create one below.</p>
        ) : (
          <GameCards games={data} />
        )}
      </Panel>
      <CreateGame />
    </>
  );
}

export function GameCards({ games }: { games: GameRow[] }) {
  return (
          <div className="grid two">
            {games.map((g) => (
              <a key={g.slug} href={`#/g/${g.slug}`} className="card-link" style={{ textDecoration: 'none', display: 'block', border: '1px solid var(--line)', borderRadius: 10, padding: '.7rem .8rem' }}>
                <div className="row" style={{ margin: 0, justifyContent: 'space-between' }}>
                  <strong>{g.name}</strong>
                  <Status s={g.climb?.status ?? 'idle'} />
                </div>
                <div className="muted small mono">
                  {g.slug} · head v{g.head} of {g.versions} · {g.evals} evals · updated {ago(g.updatedAt)}
                </div>
                <div className="stats" style={{ marginBottom: 0 }}>
                  <Stat v={f3(g.latest?.train)} l="latest train" />
                  <Stat v={f3(g.latest?.test)} l="latest test" />
                  <Stat v={g.bestTrain ? f3(g.bestTrain.train) : '—'} l={g.bestTrain ? `best train (v${g.bestTrain.version})` : 'best train'} />
                  <Stat v={`${g.kept}/${g.climb?.rounds ?? 0}`} l="rounds kept" />
                </div>
              </a>
            ))}
          </div>
  );
}

function CreateGame() {
  const presets = useApi<Preset[]>('presets');
  const [mode, setMode] = useState<'preset' | 'paste'>('preset');
  const [preset, setPreset] = useState('');
  const [slug, setSlug] = useState('');
  const [rules, setRules] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const chosen = presets.data?.find((p) => p.slug === preset);
  return (
    <Panel title="Create a game" sub="Start from one of the engine's catalogue games, or paste a RULES.md of your own. Creating needs sign-in; nothing is played until you evaluate.">
      <SignIn why="to create and evaluate games (reading is open to everyone)." />
      <div className="row" role="tablist">
        <button role="tab" aria-selected={mode === 'preset'} className={mode === 'preset' ? 'primary' : ''} onClick={() => setMode('preset')}>
          From a preset
        </button>
        <button role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'primary' : ''} onClick={() => setMode('paste')}>
          Paste RULES.md
        </button>
      </div>
      {mode === 'preset' ? (
        <>
          <label className="field">
            preset
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="">choose…</option>
              {(presets.data ?? []).map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name || p.slug} — {p.mechanics.length} mechanics
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <div className="tags" style={{ margin: '.3rem 0 .6rem' }}>
              {chosen.mechanics.map((m) => (
                <span className="tag" key={m}>
                  {m}
                </span>
              ))}
              {chosen.unhandledEffects.map((e) => (
                <Status key={e} s="unhandled" label={`effect ${e}`} />
              ))}
            </div>
          )}
        </>
      ) : (
        <label className="field">
          RULES.md (YAML settings between --- lines, then the rules in prose)
          <textarea value={rules} onChange={(e) => setRules(e.target.value)} placeholder={'---\nname: "My Game"\nplayers: 2-4\nmechanics: [dice-rolling, ...]\n---\n\n# My Game\n...'} />
        </label>
      )}
      <label className="field">
        game id (optional — derived from the name)
        <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-game" />
      </label>
      <div className="row">
        <JobButton
          tool="put_definition"
          label="Create"
          primary
          input={() => {
            setErr(null);
            if (mode === 'preset' && !preset) return setErr('choose a preset'), null;
            if (mode === 'paste' && !rules.trim()) return setErr('paste the rules'), null;
            return { ...(slug ? { game: slug } : {}), ...(mode === 'preset' ? { preset } : { rules }), rationale: 'initial' };
          }}
          onDone={(out) => out?.game && go(`/g/${out.game}`)}
        />
        {err && <span className="error">{err}</span>}
      </div>
    </Panel>
  );
}
