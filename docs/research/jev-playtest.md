# Jev × playtest — where System One fits

> Read of `christopherdebeer/playtest` (main @ `8388ef4`, 2026-02-15: README,
> CLAUDE.md, `.claude/agents/{gamemaster,player,personas/*}`, the two review
> docs, `docs/proposals/DISTRIBUTED_AGENT_CLI.md`, `MECHANICS_GENERATION.md`,
> `games/aaote`, the jsonl logs) plus the substrate's `kb/53e459679d6d4e` and
> `kb/playtest-ancestor-cli-membrane`, measured against TypeSafe's docs and the
> stem-question sweeps in `docs/research/stems/`.

## What playtest spends intelligence on today

| decision site | today | shape of the decision |
|---|---|---|
| player turn | Haiku subagent per player, a tool loop per turn | pick one of the engine's **enumerated** legal actions (`player:turn` returns `actions[]` with ready-made `examples`) + closed-set args (card in hand, target player, target node) |
| contest filing | the same agent, persona-driven | "did the last action break a rule?" |
| contest / victory adjudication | Sonnet gamemaster | allow / reject, with a reason |
| post-game analysis | Sonnet writes markdown | balance, key moments, strategies, recommendations |
| rules → mechanics | authored YAML + a 209-mechanic doc catalogue, 162 implemented | which mechanics does this game use; which card effects map to which handler |
| findings triage | humans + Claude sessions (118 issues on 2026-02-09) | severity, root area |

The reviews say where it hurts: on 2026-02-07 **no game of 18 finished** (agent
turn-limit exhaustion; two games made zero moves), and on 2026-02-09 two of 18
were lost to 429s. The engine was fine; the agents were the cost and the
fragility.

## Where Jev fits — and where it doesn't

**1. System One players (best fit).** The engine already turns every turn
into a closed choice: enabled actions with examples. That is exactly a Jev
`choice` (≤255 options) — the function-calling cookbook's "closed-set
arguments" and the skill-suggestion cookbook's two-stage pick. Persona becomes
`instructions`. Speculative fan-out: one call carries the action choice plus a
`score` per candidate ("how much does this advance your win condition?") so code
can blend them. A decision is ~2–3k input tokens ≈ $0.0001 at ~0.1–0.5 s, so a
40-turn, 3-player game is ≈ 120 decisions ≈ **1–2 cents and under a minute**,
no tool loop, no turn-limit exhaustion. Low confidence escalates that one turn
to the Haiku agent (confidence-gated cascade).

What that buys is **volume**: thousands of games per dollar, i.e. Monte-Carlo
balance testing — first-player advantage, dominant actions, runaway leaders,
games that never end — which the few-games-that-stall approach can't reach.
What it doesn't buy is depth: Jev is intuitive, one-ply. Treat Jev players as
the "casual" persona made cheap, and keep LLM agents for strategic, social and
exploit-hunting play.

**2. Rule-clause checks on every action (the rule-lawyer, for free).** Each
rule clause in `RULES.md` becomes a `noul` ("did this action violate: *hand
limit 7 — cannot draw at limit*?"), all clauses asked of every logged action in
one call. That is a standing rules audit: a hit files a contest or a finding;
the gamemaster only sees the flagged ones. It also measures **rule
ambiguity**: a clause whose nouls sit near 0.5 across many actions is a clause
the text doesn't settle.

**3. Adjudication as a first pass, not a replacement.** `allow | reject` as a
`choice` with confidence, auto-applied above a high bar, Sonnet below it. The
logged AAOTE contest is the canonical boundary case: "Place 5 location cards"
— at least or exactly? Jev reads literally (its documented jaggedness) and
can't count the six locations. So the engine must supply the counts, and
"at least vs exactly" should be written into the rule (the jaggedness doc's own
advice), or it stays with the gamemaster.

**4. Post-game analysis as scores, prose only when it matters.** Jev can't write
the markdown, but it can score every game log on atomic dimensions (decisive?
kingmaking? runaway leader? did the win come from the stated win condition?
tedium?) — composite scoring. Aggregated over hundreds of cheap games that is
the balance dashboard; an LLM writes prose only for the outliers.

**5. The mechanic catalogue is a ready-made question hierarchy.** 17
categories → 209 mechanics is exactly the hierarchical-classification cookbook's
shape (beam search over `choice` distributions). Two uses:

- **Rules → mechanics:** classify a `RULES.md` body into mechanics (the
  "unknown mechanics" validation warnings and the INVALID games in the Feb
  review are this problem).
- **Card effects → handlers:** a `choice` per card effect over the effect
  handler types, with `other` meaning "needs a handler". Critical issue #3 in
  the Feb findings (card effects defined but never dispatched in 8+ games) is
  what the `other` bucket would have shown before play.

This is also the most concrete instance of the stem-question idea: a game's
declared mechanics *gate* which question packs apply. Each mechanic
contributes its own checks (sealed-bid: "was any bid visible before all were
submitted?" — critical issue #5, the simultaneous-selection leak), and new
games add packs, not code.

**6. Findings triage.** Severity and root-area `choice` over the 118-issue
style reports; cheap and boring, but it closes the loop from play → issue.

## Limits to respect

- **No counting, arithmetic or dates** — scores, AP budgets, hand sizes,
  location counts must be computed by the engine and handed to Jev as state.
- **One-ply only** — no lookahead, no multi-turn plans; bluffing, negotiation,
  storytelling and trading (free-text offers) stay generative.
- **Hidden information is the engine's job** — assemble a role-filtered view
  before the call. (Correction after reading the source: the engine does *not*
  do this today — see below.) Jev doesn't treat input as hostile, so a cheater
  persona's text should never be the state an adjudicating question reads
  unfiltered.
- **Literal reading** — ambiguous rules produce split probabilities. That is a
  signal to fix the rule, not a Jev bug.

## Source read (main @ `8388ef4`)

Findings from reading `src/` (≈44k lines: `src/core` + `src/cli` ≈ 10k,
143 mechanic modules ≈ 34k). Claims marked ✔ were re-checked by hand.

**The pieces a Jev player needs already exist, in-process.**
`tests/harness.ts` (`GameTestHarness`) drives `initGame → startGame →
getAvailableActions → validateAction → executeAction` directly, no CLI and no
agents, and seeds all ~44 `Math.random` sites with mulberry32
(`create(game, n, {seed})`, `step`, `replay`, `fromLog`). There is no bot,
random or simulation player anywhere. A Jev playout loop belongs next to this
harness, not behind the CLI's blocking waits (`fs.watch` + 100 ms polls, lock
busy-waits, a full `game.json` rewrite per save).

**The action space is closed for most mechanics, but only partly advertised.**
`AvailableAction` carries `cards[]` and `targets[]` (machine-readable) plus
prose `required` fields and a few `examples`. Of the 97 modules that
advertise actions, roughly:

| bucket | ≈ modules | examples | Jev fit |
|---|---:|---|---|
| enumerable | 65 | worker placement, drafting, moves, votes, cooperate/defect, roll/bank, trick-taking, route claims | `choice` over expanded candidates |
| numeric argument | 20 | every auction, bribery, loans, market quantities, force commitment | only if the engine buckets amounts (betting-and-bluffing already does: call / min-raise / check / fold) |
| free text / combinatorial | 12 | storytelling, acting, clues, negotiation terms, trade bundles | not as a player; `score`/`noul` as a judge |

Expansion needs care: `examples` shows only the first two cards
(`cards.ts:324`), `trading` advertises only the first target and card,
`simultaneous-action-selection` advertises an open `selectedAction: {}`, and
`negotiation`/`communication-limits` advertise `pass` placeholders instead of
their real actions. `ActionSchema.enum` is used by only 8–11 mechanics.

**Everything that decides a win is already deterministic.** All 13 win
conditions read structured state (`onCheckWin`); the free-text
`win_condition` string is never executed. NL rule text (`rulesMarkdown`) is
never parsed; it only reaches the agents. So the gamemaster's real job is the
three binary rulings (`adjudicateContest`, `adjudicateResignation`,
`adjudicateVictory`), with a 60 s auto-allow if nobody answers.

**Bugs found on the way (worth fixing before any automated play):**

1. ✔ **Contests can't be filed.** `recordAction` (`game.ts:1407`) is never
   called, so `contestState.lastAction` is never set and `fileContest`
   always fails.
2. ✔ **Player views aren't filtered.** `getPlayerView` returns
   `shared: state.shared` whole — deck order, discard pile, contest history,
   every mechanic's shared data. `registry.getVisibleState` and the
   `visibility.ts` redaction helpers exist but nothing calls them; seven
   hidden-information mechanics implement `getVisibleState` for nothing.
   Also: no access control on the CLI, so any caller can run `gm:state`.
3. ✔ **A rejected victory claim skips a player.** The declaring `pass`
   advances the turn, then `adjudicateVictory` advances it again
   (`game.ts:2001`).
4. ✔ **Free-text answers score unconditionally.** `induction.guess_rule`
   always awards `points_correct_guess`; `questions-and-answers.final_answer`
   likewise; `acting` never scores guesses.
5. ✔ **Unknown card effects vanish silently.** The effect dispatcher (the
   Feb review's fix, now on main) handles `draw/score/reverse/bonus_worker`
   directly and routes the rest to `applyEffect` (3 implementers). An
   unhandled effect with no `duration` is dropped with no warning. 16
   validated effect types (`peek_hand`, `teleport_adjacent`, `steal_item`,
   `secret_move`, …) have no runtime handler, while `score`, `bonus_worker`
   and `move_forward/backward` are handled but fail validation as unknown.

**Where Jev plugs in, concretely:**

| seam | call | notes |
|---|---|---|
| player decision (harness loop) | `choice` over expanded candidates (≤255) + per-candidate `score`, persona as instructions | invalid picks are free to retry: `validateAction` returns errors |
| engine-precomputed facts | — | Jev can't count: hand size, costs vs. resources, AP left, score gaps, turns left, a boolean per `win_*` condition — as named literal facts |
| contest filing / pre-judging | `noul` per rule clause on the last action | needs bug 1 fixed; confident rulings apply, the rest escalate to the Sonnet GM |
| victory claims | engine `checkAllWinConditions` first | Jev only for prose-only objectives |
| free-text answer checking | `noul` ("does guess X describe rule Y?") | fixes bug 4 |
| authoring: card prose → effect handler | `choice` over handler types + `unsupported` | fixes bug 5 before play |
| authoring: RULES.md → mechanics | two-stage `choice` (17 categories → 164 slugs) | the stems/hierarchy pattern |
| bot judge / voter | `score` rubric | storytelling, acting, player-judge |

## Suggested first increment

1. Fix bugs 1–3 (small; they block any automated play from being honest).
2. `jev-play.ts` beside `tests/harness.ts`: seeded game → each turn, redact
   the view (drop `shared.deck`, `contestState`, other players' hidden data),
   compute the named facts, expand enabled actions into ≤255 candidates, one
   Jev call (choice + scores), `validateAction`, `executeAction`; fall back to
   a random legal action (and log it) if Jev's pick is invalid twice.
3. Run the ~12 high-enumerability games (uno, markovs-chains, parallel-race,
   road-rally, treasure-hunters, draft-duel, fortune-seekers, engine-masters,
   alliance, battle-forge, and the vote/dilemma half of council-of-whispers)
   100 seeds each at 2–4 players. At ~120 decisions × ~2.5k tokens per game,
   that is ≈ $15 for 1,200 games. Report completion rate, turns to finish,
   seat win rates, action-type mix, stalls, and effects that were dropped.
4. Add a random-legal-action baseline on the same seeds: the gap between
   random and Jev players is itself a measure of how much skill a game
   rewards.

## Aside

System One tagged the `stillwater` cell's deploy facts `project:playtest`
because their commit subjects start with "playtest:" (used as a verb). Stillwater
is a separate project (a numeracy pond game). That's a fair `label` for
`system1.calibrate`.
