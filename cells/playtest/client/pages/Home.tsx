import * as React from 'react';
import { useApi, Loading, Panel, Stat, A, LoopDiagram, pct } from '../ui';
import type { Overview, ToolInfo } from '../lib/types';
import { ChangeList } from './Changelog';
import { GameCards } from './Games';

export function Home() {
  const { data, error } = useApi<Overview>('overview');
  const tools = useApi<ToolInfo[]>('tools');
  return (
    <>
      <header>
        <h1>Game design, tested by playing it over and over</h1>
        <p className="lede">
          Write a board or card game's rules as a text file. This service turns the rules into a playable engine, has a fast AI play dozens of games with them,
          scores how well the game actually played, and then helps you (or an AI agent) improve the rules one change at a time — keeping a change only if it
          measurably helps on games it has never seen.
        </p>
        <div className="row">
          <a className="btn primary" href="#/games">
            Browse games
          </a>
          <a className="btn" href="#/mechanics">
            What the engine can do
          </a>
          <button onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>How it works ↓</button>
        </div>
      </header>

      <Panel title="Right now" sub={data ? `engine ${data.engine.version} · ${data.engine.mechanics} mechanics implemented · scored with ${data.scoreVersion}` : undefined}>
        {!data ? (
          <Loading error={error} />
        ) : (
          <>
            <div className="stats">
              <Stat v={data.totals.games} l="games" />
              <Stat v={data.totals.evals} l="evaluations" />
              <Stat v={data.totals.runs} l="games played" />
              <Stat v={data.totals.rounds} l="climb rounds" />
              <Stat v={`${data.totals.kept}/${data.totals.kept + data.totals.reverted}`} l="changes kept" title="Proposed rule changes that improved both train and held-out scores" />
              <Stat v={`$${data.totals.usd.toFixed(2)}`} l="spent on Jev" title={`${data.totals.jevTokens.toLocaleString()} input tokens at $0.042 / million`} />
            </div>
            {data.games.length > 0 && <GameCards games={data.games} />}
          </>
        )}
      </Panel>

      <div id="how" />
      <Panel title="Three names you'll see">
        <div className="grid three">
          <div>
            <h3>parc.land</h3>
            <p className="small">
              A personal workspace platform. Its apps are called <em>cells</em>: small programs, each with its own storage, that people and AI agents use through the
              same set of tools (the <a href="https://modelcontextprotocol.io">Model Context Protocol</a>, MCP). This page is one cell.
            </p>
          </div>
          <div>
            <h3>playtest</h3>
            <p className="small">
              A game engine that reads a <span className="mono">RULES.md</span> file — settings at the top, plain-English rules below — and assembles the game out of a
              library of reusable <A to="/mechanics">mechanics</A> (dice, decks, hands, auctions, area control…). Anything the rules ask for that the library lacks is
              reported, not guessed.
            </p>
          </div>
          <div>
            <h3>Jev</h3>
            <p className="small">
              A “System One” AI model from typesafe.ai. It doesn't write text; it only answers typed questions — yes/no, pick one of up to 255 options, or a score —
              with a probability, in milliseconds, for a fraction of a cent. Here it is every player, and the judge.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="How one playtest works">
        <ol className="steps">
          <li>
            <div>
              <strong>Read the rules.</strong> The engine parses the settings and switches on the mechanics they name. A classifier compares what the prose describes
              with what is actually configured and implemented, and lists the gaps.
            </div>
          </li>
          <li>
            <div>
              <strong>Deal a seeded game.</strong> Every game has a seed and a player count, so it can be replayed exactly.
            </div>
          </li>
          <li>
            <div>
              <strong>Play every move.</strong> On each turn the code lists every concrete move (every card, every target), the engine's own validator removes the
              illegal ones, and Jev picks one with a confidence. If only one move is legal, Jev isn't asked.
            </div>
          </li>
          <li>
            <div>
              <strong>Judge the session.</strong> Once the game ends (or runs out of steps), Jev reads the rules and the whole
              record, round by round, and answers as a designer would: did it play as designed or break? Then a critique on sixteen dimensions — fun,
              engagement, dynamism, tension, meaningful decisions, depth, diversity, interaction, pace, balance, theme, coherence, goal clarity, comeback,
              replayability, elegance — and which weakness, strength and kind of change stand out.
            </div>
          </li>
          <li>
            <div>
              <strong>Score it.</strong> Mostly measured, partly judged — see below. Anything the engine couldn't do goes on the <A to="/mechanics">mechanics backlog</A>.
            </div>
          </li>
        </ol>
      </Panel>

      <Panel title="How a game gets better: hill-climbing" sub="After Anthropic's “Automating eval design and hill-climbing” — measure noise first, change one thing, keep it only if held-out results agree.">
        <LoopDiagram />
        <ul className="small">
          <li>
            Each game has a <strong>suite</strong>: <em>train</em> seeds (whose games anyone may read in full) and <em>held-out test</em> seeds (only their score is ever
            shown — so a proposer can't tune to them).
          </li>
          <li>
            The first evaluation of the current rules is the <strong>baseline</strong>. Re-running it measures <strong>noise</strong>; a change must beat both noise and
            a minimum step (ε).
          </li>
          <li>
            A <strong>proposal</strong> is one edit plus the reason for it. It's evaluated on the same suite and <strong>kept only if train improves by at least ε and
            test also improves</strong>. Train up, test flat is overfitting: reverted.
          </li>
          <li>
            Three rounds without a keep and the climb is <strong>stalled</strong>: the system says where the points are being lost instead of inviting more patching.
          </li>
          <li>
            Some faults aren't in the rules at all but in the engine. Those land on the backlog; when a mechanic is added or fixed, the engine's fingerprint changes
            and every game can be re-evaluated against it.
          </li>
        </ul>
      </Panel>

      <Panel title="What the score means" sub="score/v3 — each played game gets 0–1; a suite is 75% the average game, 15% how clean the definition is, and 10% outcome balance: how evenly wins spread across the secret roles (or seats).">
        <div className="scroll">
          <table className="t">
            <thead>
              <tr>
                <th>part</th>
                <th className="num">weight</th>
                <th>measured how</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['ended', 0.25, 'the game finished by its own rules: 1 · finished only by a turn/round limit: 0.3 (1 if the rules say who wins at the limit) · never finished: 0'],
                ['critique', 0.2, "Jev's qualitative review on 16 dimensions — fun, engagement, dynamism, tension, meaningful decisions, strategic depth, diversity, interaction, pace, balance, theme, rules coherence, goal clarity, comeback potential, replayability, elegance (mean of five-step scales)"],
                ['judged', 0.15, "Jev's probability that the session “plays as designed”"],
                ['variety', 0.1, 'full marks unless one kind of move is over half of all moves; 0 if it is every move'],
                ['agency', 0.1, 'how many legal moves players typically had (4+ is full) × share of turns that were not forced'],
                ['length', 0.1, 'rounds played, up to 3 (a game over in one round scores low); 0.5 if it never finished'],
                ['clean', 0.1, 'no error-level findings during play'],
              ].map(([k, w, d]) => (
                <tr key={String(k)}>
                  <td className="mono">{k}</td>
                  <td className="num">{pct(Number(w))}</td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">A game that crashes or gets stuck scores 0 outright. Definition health is 1 / (1 + 0.25 × error-level classification findings).</p>
        <p className="small muted">
          Honest caveat: the score measures the game <em>as played by a quick, one-move-ahead player</em>. A rule that needs planning to shine can score worse here
          than it would with people — the change log keeps those cases visible.
        </p>
      </Panel>

      <Panel title="Recent changes" right={<A to="/changes">full log →</A>}>
        {data ? <ChangeList items={data.recent} /> : <Loading error={error} />}
      </Panel>

      <Panel title="For agents: the MCP tools" sub="Everything on this page is also a tool. Connect an MCP client to https://parc.land/mcp and call @c15r/playtest.<tool> via read or act.">
        <details>
          <summary>{tools.data ? `${tools.data.length} tools` : 'tools'}</summary>
          {tools.data ? (
            <dl className="kv" style={{ marginTop: '.6rem' }}>
              {tools.data.map((t) => (
                <React.Fragment key={t.name}>
                  <dt className="mono">
                    {t.name} <span className="muted small">{t.kind}</span>
                  </dt>
                  <dd className="small">{t.description}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : (
            <Loading error={tools.error} />
          )}
        </details>
        <p className="small muted">
          Typical loop: <span className="mono">put_definition → eval → noise → propose … → climb_log</span>, reading only train runs; <span className="mono">backlog</span>{' '}
          is the engine worklist; <span className="mono">regress</span> re-scores every game after an engine change.
        </p>
      </Panel>
    </>
  );
}
