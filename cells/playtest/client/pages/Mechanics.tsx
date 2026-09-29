import * as React from 'react';
import { useApi, Loading, Panel, Stat, Status, A, when } from '../ui';
import type { MechanicsView, Mechanic } from '../lib/types';

const { useState, useMemo } = React;

const STATUSES: Array<[Mechanic['status'], string, string]> = [
  ['implemented', 'implemented', 'code in the engine runs it'],
  ['partial', 'partial', 'registered, but only part of it works'],
  ['engine-flag', 'engine setting', 'not a module, but a setting the core engine reads'],
  ['not-implemented', 'not implemented', 'in the catalogue; a game that asks for it gets a finding'],
];

export function Mechanics() {
  const { data, error } = useApi<MechanicsView>('mechanics');
  const initialQ = decodeURIComponent(location.hash.match(/[?&]q=([^&]+)/)?.[1] ?? '');
  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState<string>('');
  const [cat, setCat] = useState('');
  const [used, setUsed] = useState(false);
  const [open, setOpen] = useState<string | null>(initialQ || null);
  const rows = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.mechanics.filter(
      (m) =>
        (!status || m.status === status) &&
        (!cat || m.category === cat) &&
        (!used || m.games.length + m.presets.length > 0) &&
        (!s || m.slug.includes(s) || m.name.toLowerCase().includes(s) || (m.description ?? '').toLowerCase().includes(s)),
    );
  }, [data, q, status, cat, used]);
  if (!data) return <Loading error={error} />;
  const usedRows = data.mechanics.filter((m) => m.games.length + m.presets.length > 0);
  const usedImpl = usedRows.filter((m) => m.status === 'implemented' || m.status === 'engine-flag').length;
  return (
    <>
      <h1>Mechanics</h1>
      <p className="lede">
        The building blocks a rules file can ask for, and whether the engine really implements each one. Games' evaluations feed a backlog of what's missing or broken;
        fixing a mechanic changes the engine's fingerprint, and the change log records which mechanics changed.
      </p>
      <Panel sub={`engine ${data.engine.version} · vendored from ${String(data.engine.vendoredFrom.source ?? '').replace('https://github.com/', '')} @ ${String(data.engine.vendoredFrom.commit ?? '').slice(0, 7)}, developed here since`}>
        <div className="stats">
          {STATUSES.map(([s, label, why]) => (
            <Stat key={s} v={data.counts[s] ?? 0} l={label} title={why} />
          ))}
          <Stat v={`${usedImpl}/${usedRows.length}`} l="used ones that work" title="Mechanics declared by a stored game or a catalogue preset that are implemented or read by the core" />
          <Stat v={data.backlog.length} l="backlog items" />
        </div>
        <dl className="kv small">
          {STATUSES.map(([s, label, why]) => (
            <React.Fragment key={s}>
              <dt>
                <Status s={s} label={label} />
              </dt>
              <dd>{why}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Panel>

      <Panel title="Backlog" sub="What evaluations keep running into, ranked by hits × games. This is the engine's worklist.">
        {!data.backlog.length ? (
          <p className="muted small">Empty.</p>
        ) : (
          <div className="scroll">
            <table className="t">
              <thead>
                <tr>
                  <th>kind</th>
                  <th>subject</th>
                  <th className="num">hits</th>
                  <th>games</th>
                  <th>last seen</th>
                </tr>
              </thead>
              <tbody>
                {data.backlog.slice(0, 25).map((b) => (
                  <tr key={`${b.kind}:${b.subject}`}>
                    <td>
                      <Status s={b.severity} label={b.kind} />
                    </td>
                    <td>
                      <strong className="small">{b.subject}</strong>
                      <div className="small muted">{b.detail}</div>
                    </td>
                    <td className="num">{b.hits}</td>
                    <td className="small">
                      {(b.games ?? []).map((g) => (
                        <A key={g} to={`/g/${g}`}>
                          {g}{' '}
                        </A>
                      ))}
                    </td>
                    <td className="small muted">{b.lastSeen ? when(b.lastSeen) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Catalogue" sub={`${rows.length} of ${data.mechanics.length} shown. Tap a row for details.`}>
        <div className="row">
          <input type="search" placeholder="search mechanics…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="search" style={{ flex: '1 1 12rem', width: 'auto' }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }} aria-label="status">
            <option value="">any status</option>
            {STATUSES.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 'auto' }} aria-label="category">
            <option value="">any category</option>
            {data.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label className="small" style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center' }}>
            <input type="checkbox" checked={used} onChange={(e) => setUsed(e.target.checked)} style={{ width: 'auto' }} /> used by a game
          </label>
        </div>
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>mechanic</th>
                <th>status</th>
                <th className="num">games</th>
                <th className="num">presets</th>
                <th className="num">changes</th>
                <th className="num">backlog</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <React.Fragment key={m.slug}>
                  <tr className="link" onClick={() => setOpen(open === m.slug ? null : m.slug)} aria-expanded={open === m.slug}>
                    <td>
                      {m.name}
                      <div className="small muted mono">
                        {m.slug} · {m.category}
                      </div>
                    </td>
                    <td>
                      <Status s={m.status} label={STATUSES.find((s) => s[0] === m.status)?.[1]} />
                    </td>
                    <td className="num">{m.games.length || ''}</td>
                    <td className="num">{m.presets.length || ''}</td>
                    <td className="num">{m.changedIn.length || ''}</td>
                    <td className="num">{m.backlog.reduce((a, b) => a + (Number(b.hits) || 0), 0) || ''}</td>
                  </tr>
                  {open === m.slug && (
                    <tr>
                      <td colSpan={6}>
                        <Detail m={m} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Card effects" sub="Effects cards in catalogue games declare, and whether the engine applies them. An unhandled effect is silently skipped in play — so it's reported.">
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>effect</th>
                <th>status</th>
                <th>used by presets</th>
              </tr>
            </thead>
            <tbody>
              {data.effects.map((e) => (
                <tr key={e.type}>
                  <td className="mono">{e.type}</td>
                  <td>
                    <Status s={e.handled ? 'handled' : 'unhandled'} />
                  </td>
                  <td className="small muted">{e.presets.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Detail({ m }: { m: Mechanic }) {
  return (
    <div style={{ padding: '.3rem 0 .6rem' }}>
      {m.description && <p className="small">{m.description}</p>}
      <dl className="kv small">
        {m.configKey && (
          <>
            <dt>setting</dt>
            <dd className="mono">{m.configKey}</dd>
          </>
        )}
        {m.requires.length > 0 && (
          <>
            <dt>requires</dt>
            <dd className="mono">{m.requires.join(', ')}</dd>
          </>
        )}
        {m.hooks.length > 0 && (
          <>
            <dt>engine hooks</dt>
            <dd className="mono">{m.hooks.join(', ')}</dd>
          </>
        )}
        {m.hash && (
          <>
            <dt>code hash</dt>
            <dd className="mono">{m.hash}</dd>
          </>
        )}
        <dt>source</dt>
        <dd>{m.source === 'boardgamegeek' ? 'BoardGameGeek mechanic catalogue' : 'engine'}</dd>
        <dt>games</dt>
        <dd>
          {m.games.length
            ? m.games.map((g) => (
                <A key={g} to={`/g/${g}`}>
                  {g}{' '}
                </A>
              ))
            : '—'}
        </dd>
        <dt>presets</dt>
        <dd>{m.presets.join(', ') || '—'}</dd>
        <dt>code changes</dt>
        <dd>{m.changedIn.length ? m.changedIn.map((c) => `${c.engine} (${when(c.at)})`).join(' · ') : 'none since first seen'}</dd>
      </dl>
      {m.backlog.length > 0 && (
        <>
          <h3>On the backlog</h3>
          <ul className="small">
            {m.backlog.map((b, i) => (
              <li key={i}>
                <Status s={b.severity} label={b.kind} /> ×{b.hits} — {b.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
