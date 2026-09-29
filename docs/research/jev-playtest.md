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
  before the call (the engine already does this per player). Jev doesn't treat
  input as hostile, so a cheater persona's text should never be the state an
  adjudicating question reads unfiltered.
- **Literal reading** — ambiguous rules produce split probabilities. That is a
  signal to fix the rule, not a Jev bug.

## Suggested first increment

A `jev` player mode in the engine: `player:turn` → state + enabled actions →
one Jev call (choice over action examples + a score per candidate + persona
instructions) → `player:act`; below θ fall back to the agent. Run the 18-game
catalogue 100× each with 2–4 Jev players (~$20–40 total) and report per game:
completion rate, turns to finish, first-player win rate, action-type mix, and
which rule-clause nouls fired. That turns the Feb review's "no game finished"
into a balance table.

## Aside

System One tagged the `stillwater` cell's deploy facts `project:playtest`
because their commit subjects start with "playtest:" (used as a verb). Stillwater
is a separate project (a numeracy pond game). That's a fair `label` for
`system1.calibrate`.
