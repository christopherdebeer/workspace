import * as React from 'react';
import { useApi, Loading, Panel, Status, when } from '../ui';
import type { Change } from '../lib/types';

const { useState } = React;

const KINDS: Array<[Change['kind'], string]> = [
  ['deploy', 'deploys'],
  ['engine', 'engine versions'],
  ['definition', 'rule versions'],
  ['round', 'climb rounds'],
  ['eval', 'evaluations'],
];

function refHref(c: Change): string | null {
  if (!c.ref) return null;
  if (c.kind === 'eval') return `#/eval/${c.ref}`;
  if (c.kind === 'engine') return '#/mechanics';
  if (c.game) return `#/g/${c.game}`;
  return null;
}

export function ChangeList({ items }: { items: Change[] }) {
  if (!items.length) return <p className="muted small">Nothing yet.</p>;
  return (
    <ul className="timeline">
      {items.map((c, i) => {
        const href = refHref(c);
        return (
          <li key={`${c.at}-${i}`}>
            <span className="when">{when(c.at)}</span>
            <div>
              <div>
                <Status s={c.kind} />{' '}
                {href ? <a href={href}>{c.title}</a> : <span>{c.title}</span>}
                {c.outcome && (
                  <>
                    {' '}
                    {/^kept/.test(c.outcome) ? <Status s="kept" label={c.outcome} /> : /^reverted/.test(c.outcome) ? <Status s="reverted" label={c.outcome} /> : <span className="tag">{c.outcome}</span>}
                  </>
                )}
              </div>
              {c.detail && <div className="small muted">{c.detail}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Changelog() {
  const { data, error } = useApi<Change[]>('changelog');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [game, setGame] = useState('');
  const games = [...new Set((data ?? []).map((c) => c.game).filter(Boolean) as string[])].sort();
  const shown = (data ?? []).filter((c) => !off.has(c.kind) && (!game || c.game === game || !c.game));
  return (
    <>
      <h1>Change log</h1>
      <p className="lede">
        Everything that changed, newest first: code deploys of this cell, new engine versions (with the mechanics whose code changed), new rule versions, climb
        rounds and their keep/revert decisions, and evaluations.
      </p>
      <Panel>
        <div className="row" role="group" aria-label="filter by kind">
          {KINDS.map(([k, label]) => (
            <button key={k} className={off.has(k) ? 'ghost' : ''} aria-pressed={!off.has(k)} onClick={() => setOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}>
              <Status s={k} label={label} />
            </button>
          ))}
          {games.length > 1 && (
            <select value={game} onChange={(e) => setGame(e.target.value)} style={{ width: 'auto' }} aria-label="game">
              <option value="">all games</option>
              {games.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          )}
        </div>
        {data ? <ChangeList items={shown} /> : <Loading error={error} />}
      </Panel>
    </>
  );
}
