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
- **Under I3** (turn plans): v2 0.797 < v0.4 0.858 (the ladder holds under
  all three instruments). Rounds on v0.4, all reverted: evidence + Temple
  (−0.045), pacing alone (+0.0005, neutral), evidence alone again (−0.033 —
  a queueing slip: the "with pacing" proposal carried only the evidence
  edits), pacing + evidence + Temple (−0.043). The last is the real
  hypothesis: objectives now decide 11/24 games (about double), but the Enemy
  still wins 11/24 at the limit, games run 7.9 rounds instead of 4.7, and the
  judge prefers v0.4 on *every* dimension (tension 1.63 vs 0.95, fun 2.32 vs
  1.73, "plays as designed" 20 vs 8 of 24).
- Turn plans were rarely chosen (~10 planned steps per 12 games); a probe
  (devtools/choices.ts) showed Jev takes a consequence-marked option about 60 %
  of the time when one exists, at low confidence (0.1–0.3): the player is
  noisy, not blind.
- **Where this leaves AAOTE**: v0.4 is the best version this instrument can
  identify. Whether evidence-based deduction is better *with purposeful
  players* is a question these players can't answer — more rounds would tune
  the rules to the judge's and Jev's habits. Next: calibrate the instrument
  against stronger players (a few games played turn-by-turn by a deliberative
  model, or people) on v0.4 vs the paced-deduction variant
  (scratchpad prop-paced-deduction), before more design rounds.

### Addendum — harness h9: players read the whole rules (2026-10-04)

- **Found by walkthrough** (devtools/walkthrough.ts captures every Jev call of
  one game verbatim). h1–h8 gave players a rules digest of only the sections
  headed win/goal/objective/gameplay/turn/actions: AAOTE players never saw
  the map, denouncing, trading, powers or events sections — e.g. that
  entering the Forbidden Temple reveals The Enemy, or that a wrong
  denunciation forfeits your objective. In the captured game the Enemy took
  `Hidden Path → Temple [then search Shadow Key: → holding 1/3]` at 0.74 in
  round 2 and lost to a denunciation in round 3.
- **h9**: players get the whole prose up to 8000 chars (over the cap, the
  win/turn/action sections first, the rest in order). Instrument I4 = I3 + h9.
- **Under I4**: v0.4 baseline train 0.872 / test 0.850 (I3 0.858 / 0.854),
  outcome balance 0.99 (0.88), noise 0.0055 (0.019). Paced deduction, round 12:
  reverted again, train −0.057; the Enemy wins 11/24 at the limit, denunciations
  fall to 2/24, games run 8.3 rounds, critique 0.47 vs 0.59.
- **What changed in play** (24 train games of v0.4): wrong denunciations
  halved (8 → 4); games ending by denunciation unchanged (16); denunciations
  that followed the Enemy entering the Temple 8 → 7. Reading the rule barely
  stops the self-reveal: the option label still advertises the objective step
  and not its cost. Jev weighs option labels far above prose.
- Next for the instrument: the cost of a move in its label (`[reveals you]`);
  an Enemy persona (the "suspicious" persona currently tells the Enemy to hunt
  a traitor); reveal/peek events in the judge's record.

### Addendum — harness h10: costs on labels, Enemy persona, knowledge events (2026-10-04)

- **h10** (instrument I5): a move that exposes your role is labelled
  `cost: everyone learns you are X — any player can then denounce you and win`;
  accusations carry `if right: … · if wrong: …` (for the Enemy: "you are The
  Enemy, so this is wrong"); a player on the enemy team gets a traitor persona
  instead of the traitor-hunting one; the judge receives `knowledge_events`
  (public reveals and private peeks, by round and cause). The first wording,
  "REVEALS YOU as The Enemy", was still chosen (0.32): it read as an event,
  not a cost.
- **v0.4 under I5** vs I4 (24 train games): games ending by denunciation 16 →
  10, of which after a Temple self-reveal 7 → 3; Enemy wins at the limit 4 →
  7; average 4.3 → 6.7 rounds. Score 0.872 → 0.851, critique 0.587 → 0.527
  (tension 1.57 → 1.35), noise 0.0055 → 0.019. The judge now blames the players
  ("better choices were available and ignored", 0.69).
- Reading: much of v0.4's measured tension came from the Enemy giving itself
  away. With an Enemy that hides, honest players rarely find it (7 of 10
  correct denunciations had no Temple reveal before them, and 4 were wrong),
  and the game drifts to the time limit. Scores across instruments are not
  comparable; the behaviour counts are.
- Paced deduction, round 13: reverted again (−0.041; Enemy 11/24 at the limit,
  2 denunciations, 7.8 rounds). Its loss holds under I3, I4 and I5.

### Addendum — the step back: AAOTE v0.5 from the design board, score/v4 (2026-10-04)

- **Why.** The design board for AAOTE (cover 敵の代理人, twenty characters with professions
  and cities, noir items and scenes, the Nine Cuts, a mechanics sketch — Project → Stealth,
  Progress, Sabotage, Reveal, Expose, Cooperate — the verbs Kompromat / Gossip / Quid pro quo /
  Hostile takeover / Research / Corrupt / Investigate / Scoop / Blackmail, a prisoner's-dilemma
  note, and *Deception: Murder in Hong Kong*, *Coup* and *The Resistance* as references) had
  never been in the loop. The v0.3 the climb started from was a fantasy adventure produced by an
  earlier automated climb. Rounds 4–13 were parameter edits on a design whose core loop —
  evidence generated structurally, every round — did not exist: under h10 (an agent that hides)
  honest players could not find it. Four of five seats were playing solitaire. And score/v3.1
  gave 0.85 to a three-round game decided by the agent exposing itself, because 65 % of its
  weight was mechanical and v0.4 maxed every mechanical term. See devtools/aaote/DESIGN-BRIEF.md.
- **v0.5** (devtools/aaote/v0.5-RULES.md): projects on a personal table, open or in stealth;
  progress, cooperate (pays the helper), sabotage (open projects), expose (hidden ones); Gossip
  and Investigate as cards; Kompromat only in stealth and only usable by the agent; points over
  8 rounds; a correct accusation ends the game (accuser +3, others +1, agent → 0, highest score
  wins, agent wins ties); the Nine Cuts as powers. Engine: `projects` mechanic, objective
  checks on completed projects by kind, completion as a bonus, scoring denunciation,
  `peek_project`, `ties_to_role`. Harness: a move on a hidden project reaches the other players
  without its card or facts; public exposures reach the judge; the accusation label states the
  scoring outcome.
- **score/v4**: a game with a hidden enemy is scored on its deduction loop (ended .15,
  critique .20, judged .10, clean .10, deduction .20, interaction .15, tension .10) and the
  suite's balance term is the genre band from the brief (exposed 40–60 %, agent wins 30–45 %,
  wrong accusations < 20 %), weighted .25. Games without a hidden enemy keep v3.1. Not
  comparable with earlier scores; the behaviour counts are.
- **First six Jev games of v0.5** (local, h10): every one ended in round 3 with the agent
  exposed — on evidence in all six (public exposure of Kompromat in four, elimination after
  two wrong accusers revealed themselves honest in one, a peeked objective in one). The loop
  works; Expose is too cheap: three honest players turn over every hidden project within a
  round. First proposals, in order: expose only a hidden project with ≥ 2 tokens (engine
  option `expose_min_tokens`), accusations from round 4 at a cost of 3, accusations only with
  evidence.
- **v0.5 baseline** (head v15, h10, score/v4, 24 + 24): train 0.734 / test 0.703, band 0.49.
  The judge: "plays as designed" 23/24 (v0.4: 17/24), critique 0.70 (0.53), lead changes
  2.2 a game, 58 % of seats interacting; weakest "comeback potential", top fix "add
  catch-up". The band: agent exposed 92 % (83 % on evidence), agent wins 4 %, wrong
  accusations 24 %, 3.8 rounds. Noise 0.049 — short games decided by one accusation swing.
- **Rounds on v0.5.** 14, expose only at ≥ 2 tokens: +0.010, reverted (the agent pushes
  Kompromat to 2 tokens in its first turn; one run had no Expose at all and still ended in a
  round-3 accusation — a hidden project at 3 tokens is a public signal, and three honest
  players each get a shot). 15, accusations from round 4 at a cost of 3: +0.044, reverted
  under the 0.049 floor (paired SE 0.014; the floor comes from unpaired re-evals of swingy
  games — the suite moves to 48 + 24 before the next rounds; cap raised to 96). **16,
  accusations only with evidence: +0.079 train, +0.072 test, kept** — the first keep since
  v0.4 and a design change, not a parameter: the agent wins 6/24 at the limit (was 1), 13/24
  end in a correct accusation, band 0.69.
- Next, with the larger suite: exposure as a card (Leak) instead of a standing action;
  Kompromat at 2 tokens (no public signal); a wrong accusation hands the agent the game.
- **Rounds 17–20** (head v18, score/v4.1; the suite enlargement had been silently cut back to
  12 seeds per split by `set_suite` — fixed, so these ran on 24 + 24 with new test seeds;
  noise 0.028). Baseline 0.789 / 0.759, band 0.71. 17, Leak card instead of a standing
  Expose: +0.016, reverted. 18, Kompromat at 2 tokens (no public signal): +0.008, reverted —
  the agent won 8/24 but nothing else moved. 19, a wrong accusation hands the agent the game:
  train +0.072, test −0.022, reverted as overfitting — band 0.89, the agent winning 9/24,
  squarely in the target; a 24-game test split carries ±0.03 of its own, so it is re-run on
  the 48 + 24 suite before either number is believed. **20, accusations from round 4 at a
  cost of 3: +0.043 train, +0.019 test, kept** (it had missed the 0.049 floor by 0.005 in
  round 15). Head v22 = v0.5 + evidence + round 4 / cost 3: both keeps are on the
  accusation rule — the dilemma the board put at the centre.
- **Calibration ladder** (score/v4.1, h10, the same 24 + 24 suite, 2026-10-04): v1 0.517
  (judge "plays as designed" 1/24, critique 0.30) < v2 0.626 (16/24, 0.49) < v0.4 0.749
  (20/24, 0.57, tension 1.4, no lead changes, agent exposed 46 %, wins 29 %) < v0.5 head
  v22 0.805 (23/24, 0.72, tension 2.0, 2.6 lead changes a game, exposed 67 %, wins 21 %).
  The instrument, the judge and the design history agree for the first time. v0.5 as first
  written scored 0.734 — below v0.4 — because the agent never won (band 0.49) although the
  judge preferred it outright; the two keeps on the accusation rule closed that gap. The
  remaining defect is in the last column: under requires_evidence, accusations are wrong
  39–54 % of the time, because a Kompromat card seen in a hand counts and honest players
  draw Kompromat too. Next proposal: evidence is the table (face up, Gossip, Leak) or a seen
  ambition — never a hand (`denounce.evidence_from`).
- **Rounds 21–23** (head v22, the real 48 + 24 suite; baseline 0.786 / 0.765, band 0.68;
  noise 0.026 / 0.029 — doubling the suite barely moved the floor, so the variance is mostly
  the judge's and the players' stochastic choices, not game sampling; paired SEs run
  0.009–0.017, so the floor rule max(ε, noise, paired SE) is conservative by about 2×, to
  revisit). 21, a wrong accusation hands the agent the game: −0.010, reverted — with hand
  "evidence" still producing wrong accusations, the agent won 23/48 that way. **22, exposure
  as a Leak card instead of a standing action: +0.036 train, +0.058 test, kept** (head v24).
  23, Kompromat at 2 tokens: +0.025 under the 0.029 floor (paired SE 0.009), reverted.
- **Rounds 24–26** (head v24). 24, evidence from the table only (never a hand): train
  +0.043, test −0.001, reverted as overfitting — a test delta of −0.001 on 24 games is noise;
  re-run on the next head. **25, a wrong accusation hands the agent the game: +0.032 train,
  +0.024 test, kept** (head v26) — on top of Leak and round-4 accusations wrong accusations
  are rare (2/48), so the rule adds tension where in round 21 it handed the agent 23/48.
  26, Kompromat at 2 tokens on that head: −0.041, reverted — without the public token
  signal honest players guess, and under one-shot a guess is fatal (12/48 agent wins by wrong
  accusation): the two are incompatible.
- **Instrument gap found and closed**: the engine fingerprint stringified hook functions
  only, so a change to a module-level helper (`hasEvidence`) left the engine version — and
  every baseline — unchanged. Fingerprint method 3 folds a build-time hash of `engine/**`
  (devtools/hash-engine.mjs → lib/engine-src.ts) into the core hash; it must be regenerated
  before each push (devtools/README). `set_suite` was also silently cutting seed lists to 12.
- **Head v26 as evaluated** (round 25's eval, 48 train games): train 0.841 / test 0.825,
  band 0.85; the judge "plays as designed" 48/48, critique 0.71 (engagement 3.4, goals 3.7,
  dynamism 3.2, tension 2.0; weakest comeback 1.6, top fix "add catch-up"); 2.9 lead changes
  a game, 70 % of seats interacting, 5.4 rounds; agent exposed 67 % (all on evidence), agent
  wins 19 %, wrong accusations 20 %. Against v0.4 under the same instrument: 0.749, 20/24,
  0.57, tension 1.4, no lead changes.
- The day's Jev budget (300 M tokens) ran out before the re-baseline under fingerprint
  method 3 and the re-run of table-only evidence (round 24: +0.043 train, test flat). Those
  are the first two items when the budget resets, then the judge's own ask: a catch-up rule.
