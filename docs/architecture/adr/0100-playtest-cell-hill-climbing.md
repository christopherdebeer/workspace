# ADR-0100 — @c15r/playtest: game development by hill-climbing Jev playtests

- **Status:** Accepted 2026-09-29 — built and deployed (`cells/playtest`, cell
  `playtest-06b8e262`); first live climb run on fortune-seekers.
- **Depends on:** ADR-0097/0098 (Jev as typed judgment), ADR-0076 (kernel
  vendor overlay: `cell-jobs`, `gateway-client`), the jev · lab Playtest
  experiment (experiment 10), and "Automating eval design and hillclimbing"
  (claude.dev blog) for the loop's rules.

## Context

The jev · lab Playtest experiment showed that the playtest engine
(`christopherdebeer/playtest`) runs unchanged without agents, that Jev can
choose every move once code enumerates the legal ones and the engine's own
validator masks them, and that a played session plus Jev's judgement exposes
real faults: turns that never end, card effects nothing applies, declared
mechanics nothing reads. It ran in a browser page, one game at a time, with
nothing kept.

Game development wants the opposite: many seeded games per change, results
kept and compared, and a loop an agent can drive — propose one change to a
game definition, measure it on seeds it has seen and seeds it hasn't, keep or
revert — while the mechanics the engine lacks are added over time.

## Decision

A tier-2 cell, `@c15r/playtest`, that owns:

1. **The engine** (`engine/`, vendored at `8388ef4` by
   `scripts/vendor-playtest.mjs` with an in-memory fs). This copy is now the
   git truth — mechanics are added and fixed here, not upstream. Every run
   records an **engine fingerprint** computed from the deployed code itself
   (per-mechanic hashes of hook functions and static declarations, plus core
   entry points), so an engine change needs no manual version bump and
   `engines` can say which mechanics changed between two evals.
2. **Versioned definitions** (`GAME#<slug>/DEF#0001…`): RULES.md, parent,
   rationale, author, status (head / kept / reverted / candidate). Edits are
   exact find/replace pairs against the head.
3. **Suites**: train and held-out test seeds × player counts, `maxSteps`,
   `epsilon`, measured `noise`. Hashed canonically (sorted keys) — a
   key-order-dependent hash orphaned the first live baseline.
4. **Evals** under `score/v1` (`lib/score.ts`): per run, mostly computed
   (ended by its own win condition .30, move variety .15, agency .15,
   length .10, no error findings .10) plus Jev's P("plays as designed") .20;
   per suite 0.85 × mean run + 0.15 × definition health (error-level
   classification findings). Train runs are fully readable; **test runs are
   stored but only their aggregate score is ever returned** — the post's
   "never paste held-out failures into the prompt".
5. **Climb rounds** (`propose`): one change with a rationale → eval → keep
   only if train improves by ≥ max(epsilon, noise) **and** test improves;
   train-up/test-flat is the overfitting signal → revert. Three rounds
   without a keep = `stalled`, with a diagnosis (weakest score parts,
   recurring findings) instead of more patching. `noise` re-evaluates the
   head first, as the post prescribes.
6. **A mechanics backlog** (`BACKLOG/<kind>:<subject>`): every eval bumps
   missing / partial mechanics, card effects with no handler, engine faults
   and moves System One can't play, ranked by hits × games. That is the
   worklist for engine work; `regress` re-evaluates every game's head after
   an engine change.

Mechanics: long work runs as one async self-invoke (≤300 s, never chained),
polled with `job`. Jev is reached through the /mcp gateway (cells have no
service identity) with an owner token stored write-only (`set_token`,
`SECRET#jev`); games in an eval run concurrently, each with its own fs slot
and seeded RNG swapped in around synchronous engine calls, and their
decisions are batched into one `decide_many` per tick. Large run detail is
gzipped and chunked into the cell's table (no private blob store exists for
cell code).

## Consequences

- An agent can develop a game end to end over MCP: `put_definition` →
  `eval` → `noise` → `propose` … → `climb_log`, reading only train
  transcripts. Measured: a 12-game eval takes ~55 s and ~$0.02.
- The score measures the game **as played by a one-ply Jev player**. The
  first live round (bust threshold 1 → 2 on fortune-seekers) was reverted
  at train −0.099: players kept rolling into more busts and two games hit
  the round limit. Some "game" faults are player faults; richer per-move
  facts (odds, distance to goal) are the next lever on that side.
- The engine now diverges from upstream playtest by design. Re-vendoring
  over `cells/playtest/engine` is refused without `--force`.
- The fingerprint hashes the *bundled* source, and the bundler renames colliding
  identifiers with digit suffixes (`readFileSync2`) that shift whenever any
  module is added to the cell: the landing-page deploy moved the engine version
  with no engine change and orphaned the baseline. Digit suffixes are now
  stripped before hashing (verified: the bundles before and after that deploy
  fingerprint identically). An engine version where every mechanic hash changes
  at once is labelled a re-fingerprint in the change log, not 164 edits.
- A public landing page (`GET /`, client/ + static/) explains the cell to
  newcomers and shows games, climb progress, evals, runs (held-out: score only),
  the mechanics catalogue with status/usage/history, the backlog and a merged
  change log (deploy facts, engine versions, definitions, rounds, evals) from a
  read-only `GET /api/*`; writes go through the MCP tools as the signed-in caller.
- The jev · lab experiment keeps its own engine copy for the in-browser demo;
  it should eventually call this cell's tools instead of bundling the engine.
- The Jev token the cell holds is `read:workspace` (the narrowest scope a
  session can mint that the gateway admits for the owner's own cell), one
  year; `cell:c15r/jev:*` would be tighter but is not mintable from a
  session today.

## Addendum 2026-09-30 — climbing AAOTE: what the harness needed

AAOTE (social deduction on an expanding tile map) was the first game whose
playtests were mostly engine gaps, and it reshaped the harness:

- **Judging is a critique now** (score/v2). Jev reads the rules, the whole
  game round by round and the classifier's known gaps, and rates 16 design
  dimensions (fun, engagement, dynamism, tension, meaningful decisions, depth,
  diversity, interaction, pace, balance, theme, coherence, goal clarity,
  comeback, replayability, elegance) on five-step scales, then names the
  biggest weakness, strength, the kind of change that would help most, and
  whether repetitive play came from the rules or the players. The index
  (mean/4) is 20 % of a run's score. Evals tally who won *as what* (winner's
  secret role · objective or time limit): the first place balance shows.
- **Jev plays one-ply, so the harness shows consequences** (harness h2+):
  every option is simulated on a throwaway state and labelled with what
  visibly changes for the mover (objective progress, score, a win) unless
  the simulation touched hidden information. Before this, players shuttled
  between two tiles for whole games. The harness version is part of an
  eval's identity, like engine, suite and score version.
- **Evals fan out**: one invocation per run, the last to finish assembles
  and carries out the job (eval / noise / propose decision); the job poll
  finishes plans whose runs vanished. A 12-game AAOTE eval had reached the
  270 s budget, cut a game off, and measured noise 0.20 — too noisy for any
  proposal to be kept. Suites can now grow (12 + 12) without the wall clock.
  Incomplete evals are never baselines; rounds judged on one are
  inconclusive and don't count toward a stall.
- **Engine work AAOTE forced** (all generic options): objectives dealt once
  with a guaranteed Enemy and machine-checkable `check`s evaluated after
  every action; a tile map with links, entry `requires`, enemy_only,
  Roadblocks, discovery on first visit; open trade offers (no reading hidden
  hands), off-turn replies, no repeats after a decline; targeted event
  effects (peek, steal, block, sabotage, teleport, secret move, Evasion);
  AP discounts; `timeout_winner` alias; `players: 3-5` parsing; denounce.
- Round 1 (checks on every objective, Rope/Lantern requirements) was kept:
  train 0.503 → 0.730, test 0.528 → 0.748 on the 6 + 6 suite.

### Later the same night — measurement fixes

- **Noise needs context and more than one sample.** `set_suite` had carried a
  0.20 noise (from a 6+6 suite with a deadline-truncated run) into a new
  suite, and noise only ratcheted up, so no proposal could pass. Noise is now
  stored per (engine, harness, suite) and a round must also clear the *paired*
  standard error of its train games (same seeds × player counts on both
  sides). On 24+24 games: noise 0.009–0.011, paired SE ≈ 0.009 — a round's
  reason states all three.
- **The 60 KB gateway read cap bit job results**: a 24+24 eval's job result
  was 72 KB, the job read returned the gateway's "too large" string, and
  pollers never saw `done` although the work had finished. Job and round
  results now carry a compact eval; `plans` shows each fan-out's state, and
  the job poll re-completes a plan that was assembled but never completed.
- **score/v3.1** — a time-limit win counts as ended when the rules name the
  timeout winner (AAOTE's Enemy wins that way by design; v2 paid 0.3 for it
  and so rewarded quick Trader wins), and the suite score includes outcome
  balance (normalised entropy of who won, by secret role else seat) at 10 %.
  v3's first deploy silently never recorded positions (an edit matched
  nothing), hence v3.1.
- **Harness h4–h5**: a two-step lookahead within a turn labels moves that
  open progress ("then …"), the move question states the player's objective,
  and option labels are compact. The registry's enabled-mechanics lookup is
  cached (it was ~60 % of engine CPU; simulation cost per decision fell from
  ~0.57 s to ~0.04 s).
- **`screen`** plays a design with a free greedy stand-in (no Jev) to preview
  its structure — outcome spread, length, move mix, errors — before paying for
  an eval.
- Round 2 (Trader 4 → 6 trades) was reverted (train −0.003, test −0.030); the
  Trader then won 16 of 24: the lever is how cheap and unconditional open
  offers are, not the threshold. `trade.max_offers_per_turn` and
  `trade.counts_for` now exist for the rules to use.
- Jev spend: ~12 M input tokens per 48-game eval (~$0.50). The jev cell's
  daily cap was raised 60 M → 300 M tokens (≈ $12.60/day) for the climb; the
  TypeSafe account then returned HTTP 402 (payment required), pausing Jev work.
- **Screening before spending.** With Jev unavailable (402), candidate rule
  changes were screened free (greedy stand-in, the 24 train games): trade
  limits alone barely moved balance (0.48 → 0.57), counting trades only for
  the offerer alone 0.59, both together 0.84 with games 4.4 → 6 rounds — so
  that pair goes to Jev as one round ("trading becomes deliberate"). Queued
  after it: denounce, public powers, Collector 5 items, discovery. A small
  driver runs the queue (baseline + noise when missing, one proposal per
  round, noise re-measured after a keep) whenever Jev answers.

## Addendum — design pass first; the instrument frozen (I1)

A meta-review found the AAOTE climb had mostly been rebuilding its own
instrument (four score versions, six harness versions, three suite sizes —
each orphaning every baseline) while the game itself had changed once, by a
fidelity fix. The one real design round made it worse. Structural problems
(no deduction verb, a passive Enemy, a frictionless Trader goal, uneven
pacing) are not reachable by one-edit rounds scored by a one-ply player, so
the order is now: **design pass → faithful engine support → test the redesign
as one declared round → tune by climbing.**

- **Instrument I1, frozen**: score/v3.1, harness h6 (h5 + player personas:
  odd seeds trusting, even seeds suspicious; evals report scores and outcomes
  per persona), suite 24 + 24 (seeds 1–12 / 101–112 × 3–4 players, 300
  steps). A later change to any part is its own declared step that re-scores
  the prior heads, so the history stays continuous.
- **AAOTE v0.4** (design pass): the Forbidden Items lie on the map (Ruins,
  Hidden Cave behind a Lantern, the Enemy-only Temple) and are taken with
  `search` — the Enemy has an active win and honest players can deny it;
  denounce from round 3 (right: win; wrong: exposed and forfeit); the Trader
  needs 4 trades with 3 different partners, one offer per turn; Collector 5
  items; discovery on first visit; a 10-round clock; the player cards dealt
  as working powers. Engine support added: location `holds` + `search`, the
  `trade_partners` goal metric, denounce `from_round` / `forfeit`, and the
  validator accepts count-0 cards (defined, never drawn).
- **Judge check** before trusting further climbing: the quality ladder
  (v1 unwinnable → v2 → v0.4) must be ordered by the critique, and its 16
  dimensions checked for redundancy.
- **Rounds on v0.4** (I1): *Temple needs the other two items* reverted
  (−0.012); *a correct denunciation only exposes* reverted (−0.039: 12/24
  games with no winner); *evidence to denounce + Temple* reverted (−0.060: the
  Enemy won 16/24 at the limit). The v0.4 gain was partly a denunciation
  lottery (most games ended by a round-3 guess, which the outcome table
  hid — now reported as 'denounce'), and with the lottery gone the Jev players'
  aimless movement (≈60 % of moves) leaves objectives unfinished. The judge
  blames the players (74 %). The balance term also rewards the lottery (a
  denunciation win counts as a win for the denouncer's role) — noted, not
  yet changed.
- **Instrument I2 (declared)**: harness h7 — moves that touch hidden
  information say *that* they do, not what ("+1 card", "learn player-2
  objective"); discovery and evidence-gathering had been invisible to the
  one-ply player. Heads v2 and v4 are re-scored under I2 before any round.
- **Under I2**: v2 0.790 → v0.4 0.863 (train; test 0.772 → 0.865, critique
  0.43 → 0.55) — the ladder v1 < v2 < v0.4 holds across both instruments.
  The deduction round was reverted again (−0.035; the Enemy won 12/24 at the
  limit). h7 did not cure aimless movement (move still ≈ 55 % of actions).
  Conclusion: AAOTE's remaining flaw (denouncing is a lottery unless it needs
  evidence, and with evidence the Enemy's default win dominates because
  honest players don't finish in time) sits in the player, not the rules
  the climb can reach: a one-ply chooser neither pursues an objective over
  several turns nor gathers evidence. Next lever: a planning player (choose
  a turn intent — explore, gather evidence on X, fetch an item — then act on
  it), as instrument I3, before further design rounds.
- **Instrument I3 (declared)**: harness h8 — turn plans. Before a decision the
  runner searches the player's own next actions (to the end of the turn,
  depth ≤ 3, beam 10) on throwaway states and offers the best multi-step
  plans next to single actions ("plan: place B → move B [→ 3/6 visited]");
  a chosen plan's later steps run without asking again, each re-validated. A
  plan never continues past a step that touched hidden information, and a
  plan is offered only if no single action reaches the same outcome. Heads v2
  and v4 re-scored under I3 before the deduction round is retried.
