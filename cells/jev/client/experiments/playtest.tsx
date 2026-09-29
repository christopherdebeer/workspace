/* Experiment 10 — Playtest: a game definition in → the real playtest engine,
 * played by Jev, judged by Jev → findings about the definition and the engine. */
import * as React from 'react';
import { decide, signIn, JevError } from '../lib/jev';
import { PRESETS } from '../playtest/engine/presets';
import VENDOR from '../playtest/engine/vendor-info';
import {
  classify,
  play,
  judge,
  metrics,
  sessionFindings,
  type Classification,
  type Decide,
  type Finding,
  type Judgement,
  type Session,
  type TurnRecord,
} from '../playtest/runner';
import { Panel, Bar, Distribution, Stat, ErrorLine } from '../ui';

const { useEffect, useRef, useState } = React;

const STORE = 'jev-lab:playtest:v1';
const PERSONAS = ['', 'careful', 'aggressive', 'casual', 'rule-lawyer'];
const FEATURED = ['markovs-chains', 'uno', 'fortune-seekers', 'draft-duel', 'parallel-race', 'road-rally', 'treasure-hunters', 'alliance'];

interface Settings {
  preset: string;
  rules: string;
  players: number;
  seed: number;
  maxSteps: number;
  persona: string;
}
interface RunSummary {
  at: number;
  game: string;
  seed: number;
  players: number;
  verdict: string | null;
  steps: number;
  finished: boolean;
  findings: number;
  errors: number;
}
interface Saved {
  settings: Settings;
  history: RunSummary[];
}

const read = (): Saved | null => {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};
const write = (s: Saved) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* storage unavailable — the lab still runs */
  }
};

const jevDecide: Decide = (state, questions, label) => decide(state, questions, label);
const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export default function Playtest() {
  const saved = useRef(read()).current;
  const [settings, setSettings] = useState<Settings>(
    saved?.settings ?? { preset: 'markovs-chains', rules: PRESETS['markovs-chains'] ?? '', players: 2, seed: 1, maxSteps: 120, persona: '' },
  );
  const [history, setHistory] = useState<RunSummary[]>(saved?.history ?? []);
  const [phase, setPhase] = useState<'idle' | 'classifying' | 'playing' | 'judging'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [cls, setCls] = useState<Classification | null>(null);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [judgement, setJudgement] = useState<Judgement | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => write({ settings, history }), [settings, history]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  const guard = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      setError(null);
      return await fn();
    } catch (e) {
      if (e instanceof JevError && e.status === 401) {
        if (await signIn()) return guard(fn);
      }
      setError((e as Error).message);
      return null;
    }
  };

  const runClassify = () =>
    guard(async () => {
      setPhase('classifying');
      try {
        const c = await classify(settings.rules, jevDecide);
        setCls(c);
        setFindings(c.findings);
        return c;
      } finally {
        setPhase('idle');
      }
    });

  const runPlaytest = () =>
    guard(async () => {
      setSession(null);
      setJudgement(null);
      setTurns([]);
      const c = (await runClassify()) ?? null;
      if (!c) return;
      abort.current = new AbortController();
      setPhase('playing');
      try {
        const buf: TurnRecord[] = [];
        const s = await play(settings.rules, jevDecide, {
          players: settings.players,
          seed: settings.seed,
          maxSteps: settings.maxSteps,
          persona: settings.persona || undefined,
          signal: abort.current.signal,
          onTurn: (t) => {
            buf.push(t);
            setTurns([...buf]);
          },
        });
        setSession(s);
        setPhase('judging');
        let j: Judgement | null = null;
        let f: Finding[] = sessionFindings(s, metrics(s), c);
        if (s.turns.length) {
          const r = await judge(c, s, jevDecide);
          j = r.judgement;
          f = r.findings;
        }
        setJudgement(j);
        const all = [...c.findings, ...f];
        setFindings(all);
        setHistory((h) =>
          [
            {
              at: Date.now(),
              game: c.name,
              seed: s.seed,
              players: s.players,
              verdict: j?.health.verdict ?? null,
              steps: s.turns.length,
              finished: metrics(s).finished,
              findings: all.length,
              errors: all.filter((x) => x.severity === 'error').length,
            },
            ...h,
          ].slice(0, 12),
        );
      } finally {
        setPhase('idle');
        abort.current = null;
      }
    });

  const download = () => {
    const blob = new Blob([JSON.stringify({ vendor: VENDOR, settings, classification: cls, session, judgement, findings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `playtest-${(cls?.name ?? 'game').replace(/\W+/g, '-').toLowerCase()}-seed${settings.seed}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const busy = phase !== 'idle';
  const m = session ? metrics(session) : null;

  return (
    <>
      <Panel
        title="Playtest"
        sub={`A game definition in; the real playtest engine (${VENDOR.commit.slice(0, 7)}, ${VENDOR.files} files, no agents) plays it with Jev choosing every move, then Jev judges the session. Output: the game log, per-turn metadata, session judgements, and what the engine is missing.`}
      >
        <div className="chips">
          {FEATURED.filter((g) => PRESETS[g]).map((g) => (
            <button key={g} className={`chip ${settings.preset === g ? 'primary' : ''}`} disabled={busy} onClick={() => setSettings((s) => ({ ...s, preset: g, rules: PRESETS[g] }))}>
              {g}
            </button>
          ))}
          <select value={PRESETS[settings.preset] === settings.rules ? settings.preset : ''} disabled={busy} onChange={(e) => e.target.value && setSettings((s) => ({ ...s, preset: e.target.value, rules: PRESETS[e.target.value] }))} aria-label="all presets" style={{ width: 'auto' }}>
            <option value="">{PRESETS[settings.preset] === settings.rules ? 'all presets…' : 'edited definition'}</option>
            {Object.keys(PRESETS).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <label className="field">
          <span>RULES.md — YAML frontmatter (what the engine executes) + prose (what Jev reads). Edit and re-run to iterate.</span>
          <textarea rows={12} className="mono small" value={settings.rules} disabled={busy} onChange={(e) => set('rules', e.target.value)} spellCheck={false} />
        </label>
        <div className="knobs">
          <label>
            players
            <input type="number" min={1} max={8} value={settings.players} disabled={busy} onChange={(e) => set('players', Number(e.target.value) || 2)} />
          </label>
          <label>
            seed (deck, dice)
            <input type="number" value={settings.seed} disabled={busy} onChange={(e) => set('seed', Number(e.target.value) || 0)} />
          </label>
          <label>
            max moves
            <input type="number" min={5} max={600} value={settings.maxSteps} disabled={busy} onChange={(e) => set('maxSteps', Number(e.target.value) || 120)} />
          </label>
          <label>
            persona
            <select value={settings.persona} disabled={busy} onChange={(e) => set('persona', e.target.value)}>
              {PERSONAS.map((p) => (
                <option key={p} value={p}>
                  {p || 'none'}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button className="primary" disabled={busy || !settings.rules.trim()} onClick={runPlaytest}>
            {phase === 'playing' ? `playing… move ${turns.length}` : phase === 'judging' ? 'judging…' : phase === 'classifying' ? 'classifying…' : 'Playtest'}
          </button>
          <button disabled={busy || !settings.rules.trim()} onClick={runClassify}>
            Classify only
          </button>
          {phase === 'playing' ? (
            <button className="ghost" onClick={() => abort.current?.abort()}>
              stop
            </button>
          ) : null}
          {session ? (
            <button className="ghost" onClick={download}>
              download session JSON
            </button>
          ) : null}
        </div>
        <ErrorLine error={error} />
      </Panel>

      {findings.length ? <FindingsPanel findings={findings} /> : null}
      {cls ? <MechanicsPanel c={cls} /> : null}
      {session || turns.length ? <SessionPanel session={session} turns={turns} judgement={judgement} m={m} /> : null}
      {turns.length ? <TurnsPanel turns={turns} /> : null}
      {session?.log.length ? <LogPanel log={session.log} /> : null}
      {history.length ? <HistoryPanel history={history} onClear={() => setHistory([])} /> : null}
    </>
  );
}

const SEV_ORDER = { error: 0, warn: 1, info: 2 } as const;

function FindingsPanel({ findings }: { findings: Finding[] }) {
  const sorted = [...findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const count = (s: Finding['severity']) => findings.filter((f) => f.severity === s).length;
  return (
    <Panel title="Findings" sub={`${count('error')} errors · ${count('warn')} warnings · ${count('info')} notes — about the definition, the engine, and what System One can't play yet.`}>
      <ul className="items">
        {sorted.map((f, i) => (
          <li key={i}>
            <span className={`tag ${f.severity === 'error' ? 'live' : ''}`}>{f.severity}</span>
            <span className="tag">{f.kind}</span>
            <b className="item-name">{f.subject}</b>
            <span className="sub" style={{ flexBasis: '100%', margin: 0 }}>
              {f.detail}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function MechanicsPanel({ c }: { c: Classification }) {
  return (
    <Panel title="Mechanics" sub={`${c.name} · ${c.players.min}–${c.players.max} players · win: ${c.winCondition || '—'} · ${c.enabled.length} engine mechanics enabled`}>
      <h3 className="w-heading">Declared in the frontmatter</h3>
      <div className="chips">
        {c.declared.map((d) => (
          <span key={d.slug} className={`tag ${d.status === 'implemented' ? 'live' : ''}`} title={d.status}>
            {d.slug} · {d.status.replace('_', ' ')}
          </span>
        ))}
      </div>
      {c.effects.length ? (
        <>
          <h3 className="w-heading">Card effects</h3>
          <div className="chips">
            {c.effects.map((e) => (
              <span key={e.type} className={`tag ${e.handled ? 'live' : ''}`} title={e.cards.join(', ')}>
                {e.type} · {e.handled ? 'handled' : 'no handler'}
              </span>
            ))}
          </div>
        </>
      ) : null}
      {Object.keys(c.ruleChecks).length ? (
        <>
          <h3 className="w-heading">Rules Jev read off the prose</h3>
          {Object.entries(c.ruleChecks).map(([k, p]) => (
            <Bar key={k} label={k} p={p} />
          ))}
        </>
      ) : null}
      {c.prose.length ? (
        <details>
          <summary>What the prose describes — Jev over the 209-mechanic catalogue (one call, {c.tokens.toLocaleString()} tokens)</summary>
          {c.prose.slice(0, 16).map((m) => (
            <Bar key={m.slug} label={`${m.slug}${m.implemented ? '' : ' ✗impl'}${m.configured ? ' ✓cfg' : ''}`} p={m.p} />
          ))}
        </details>
      ) : null}
      {c.schema.warnings.length ? (
        <details>
          <summary>{c.schema.warnings.length} engine validation warnings</summary>
          <ul className="changes">
            {c.schema.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

function SessionPanel({ session, turns, judgement, m }: { session: Session | null; turns: TurnRecord[]; judgement: Judgement | null; m: ReturnType<typeof metrics> | null }) {
  const last = turns.at(-1);
  return (
    <Panel title="Session" sub={session ? `seed ${session.seed} · ${session.players} players · ${(session.ms / 1000).toFixed(1)} s` : 'playing…'}>
      <div className="stats">
        <Stat label="moves" value={m?.steps ?? turns.length} />
        <Stat label="rounds" value={m?.rounds ?? last?.round ?? 0} />
        <Stat label="ended" value={m ? (m.finished ? 'yes' : m.stopped) : '…'} />
        <Stat label="winner" value={m?.winner ?? '—'} />
        <Stat label="forced moves" value={pct(m?.forcedShare)} />
        <Stat label="mean confidence" value={pct(m?.meanConfidence)} />
        <Stat label="≈ usd" value={m ? `$${m.usd.toFixed(4)}` : '…'} />
      </div>
      {m?.endReason ? <p className="said">end: {m.endReason}</p> : null}
      {m ? (
        <>
          <h3 className="w-heading">Move mix</h3>
          {Object.entries(m.actionMix)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <Bar key={k} label={k} p={v / (m.steps || 1)} />
            ))}
        </>
      ) : null}
      {judgement ? (
        <>
          <h3 className="w-heading">Jev's judgement of the session</h3>
          <Distribution probs={judgement.health.probabilities} n={5} />
          <Bar label="decisive (0–3)" p={(judgement.decisive ?? 0) / 3} />
          <Bar label="player agency (0–3)" p={(judgement.agency ?? 0) / 3} />
          <Bar label="length: short → long (0–4)" p={(judgement.pacing ?? 0) / 4} />
          <Bar label="ended by its win condition" p={judgement.endedByRule ?? 0} />
          <Bar label="runaway leader" p={judgement.runaway ?? 0} />
        </>
      ) : null}
    </Panel>
  );
}

function TurnsPanel({ turns }: { turns: TurnRecord[] }) {
  const shown = turns.slice(-150);
  return (
    <Panel title="Turns" sub={`Per move: legal moves offered after the engine's own validation, Jev's pick and confidence, its runner-up, and whether it thought it was ahead.${turns.length > 150 ? ` Last 150 of ${turns.length}.` : ''}`}>
      <div style={{ overflowX: 'auto' }}>
        <table className="rounds">
          <thead>
            <tr>
              <th>#</th>
              <th>r·t</th>
              <th>player</th>
              <th>legal</th>
              <th>move</th>
              <th>conf</th>
              <th>runner-up</th>
              <th>ahead?</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.step} title={t.fallback ?? ''}>
                <td>{t.step}</td>
                <td className="mono">
                  {t.round}·{t.turn}
                </td>
                <td>{t.player.replace('player-', 'p')}</td>
                <td>{t.forced ? '1 (forced)' : t.valid}</td>
                <td className="mono">{t.label}</td>
                <td>{t.forced ? '—' : pct(t.confidence)}</td>
                <td className="mono">{t.top[1] ? `${t.top[1][0].slice(0, 40)} ${pct(t.top[1][1])}` : ''}</td>
                <td>{pct(t.ahead)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function LogPanel({ log }: { log: Array<Record<string, unknown>> }) {
  return (
    <Panel title="Game log" sub={`${log.length} events, exactly as the engine wrote them (the same jsonl the playtest site replays).`}>
      <details>
        <summary>show events</summary>
        <pre className="small mono">{log.map((e) => JSON.stringify(e)).join('\n')}</pre>
      </details>
    </Panel>
  );
}

function HistoryPanel({ history, onClear }: { history: RunSummary[]; onClear: () => void }) {
  return (
    <Panel title="Runs" sub="Recent playtests on this device — for comparing iterations of a definition." aside={<button className="ghost" onClick={onClear}>clear</button>}>
      <table className="rounds">
        <thead>
          <tr>
            <th>game</th>
            <th>seed</th>
            <th>moves</th>
            <th>ended</th>
            <th>verdict</th>
            <th>findings</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.at}>
              <td>{h.game}</td>
              <td>{h.seed}</td>
              <td>{h.steps}</td>
              <td>{h.finished ? 'yes' : 'no'}</td>
              <td>{h.verdict ?? '—'}</td>
              <td>
                {h.findings} ({h.errors} err)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
