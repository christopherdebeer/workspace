# Markovs Chains — proposal backlog and resume runbook

The climb on the playtest cell (`@c15r/playtest`, game `markovs-chains`) paused on
2026-10-06 when Jev, the model service that plays and judges every eval, began returning
HTTP 402 (payment required). This file is the state to resume from in a new session. The
history and reasoning behind each round are in `cells/lab/static/markovs.md`; the live record
is the cell's `climb_log`.

## Where things stand

- **Head:** definition #20, rules v4.2 — the court game: Kings dealt one each and placed on the
  rim off the edge middles, then one landscape action and one movement a turn in either order.
  `cells/lab/static/markovs-rules.md` is the same text, and the lab's table and print set play it.
- **Targets** (the head's frontmatter): rolls 10–24, offTurnWin 0.25–0.6, draw ≤ 0.1,
  leadChanges 3–6, heldLead ≤ 0.6, contenders 1.5–3, **prepPayoff ≥ 0.4, jackWin ≤ 0.2**. The
  last two were added after the stall because every version met the other six; the head misses
  both (prepPayoff ≈ 0.33, jackWin ≈ 0.33).
- **Harness h22, score v4.3.** Every eval plays 24 judged games (seeds 1–6 train, 101–106 test,
  three and four players) and 60 bot games; the questionnaire runs on every second judged
  decision. A judged game that comes back unjudged counts as incomplete.
- **No baseline on #20 yet.** The first step on resume is a baseline (see below).
- **Climb status:** stalled after rounds 6–8 (three reverts); a kept round clears it.

## Resume runbook

1. Check Jev is back: `act @c15r/playtest.eval {game:"markovs-chains", version:20, tag:"baseline #20"}`,
   then poll `read @c15r/playtest.job {id}`. An error mentioning `HTTP 402` means it is still out.
2. When the baseline is done: `act @c15r/playtest.noise {game:"markovs-chains"}` and poll.
3. Propose the first ready item: the payload is a JSON file in `markovs-proposals/`; pass its
   `game`, `rationale` and `edits` to `act @c15r/playtest.propose`. Poll the job (about two minutes).
4. Read the round's `meta` (which measures moved beyond 2 SE, which were silent or pinned, which
   target bands both sides already meet) before deciding the next round. A round that is blind on
   every band needs a band tightened, not another rule.
5. On a keep: update `cells/lab/static/markovs-rules.md` to the new head, the lab's table
   (`client/markovs/table.ts`) and rules text (`client/markovs/text.ts`) if the rule is physical,
   add a paragraph to `static/markovs.md`, then deploy the lab
   (`node scripts/cell-sync.mjs push lab --deploy --message "…"`) and reprint
   (`node cells/lab/devtools/markovs-print.mjs <dir>`).

Free checks that need no Jev, to screen a rule before paying for a round:

    node cells/playtest/devtools/out/pt-build.mjs cells/playtest/devtools/screen-file.ts /tmp/screen.mjs
    node /tmp/screen.mjs <rules.md> 30     # 60 bot games through the real engine; measures ± SE, targets

The engine flags a candidate needs must be deployed to the playtest cell first
(`node scripts/cell-sync.mjs push playtest --deploy`); a new flag changes the engine fingerprint,
so re-baseline after any deploy.

## Ready

### P1 — a Jack never enters a King  (`markovs-proposals/P1-jack-no-king.json`)
- **Why:** a third of wins are cashed in with a Jack; a player next to their King with a Jack in
  hand wins whatever the table says. The reviewer's distinction — "I manoeuvred into position"
  versus "the counter happened to come near while I held a Jack" — is lost.
- **Rule:** a Jack may not walk the counter onto a King. Engine flag `jack_no_king` (deployed).
- **Free screen** (63–75 bot games each): jackWin 35% → 0; lead changes 4.3 → 5.4; movement turns
  13.9 → 16.0; draws 5% → 13% (the cost, over the 10% band); prepPayoff unchanged (~0.31).
- **Expect:** jackWin band met, draw band missed; likely a small net gain on targets. If it
  reverts on draws, pair it with P3.
- **Already ruled out:** a Jack limited to the card's own printed exits (`jack_on_exits`) changed
  nothing in the screen (jackWin 37% either way).

## Next, needs design or a screen first

### P2 — preparation that pays
- **Why:** only about a third of race lays are ever reached by the counter (prepPayoff ≈ 0.33);
  the target asks for 0.4. Nothing tried so far moves it more than a few points.
- **Ideas to screen:** a card laid further than two steps from the counter cannot be covered
  until the counter has been next to it; or covering costs discarding a second card; or a Queen
  may only swap cards the counter has not yet entered. Screen each with the free screen against
  prepPayoff and draw before proposing.
- **Ruled out:** forbidding covers of the card under the counter (round 6): prepPayoff +4 points,
  but games moved to being decided on someone else's roll (37% → 62%) and the judged score fell.

### P3 — one fewer stay face per card
- **Why:** the lab's transition sweep found stay faces are the draw lever (two fewer stays: draws
  20% → 3% with the same median length). Useful alone if draws climb, and the natural partner
  for P1, which raises draws.
- **Work:** rewrite the `exits:` strings in the deck (one stay face moved to each card's largest
  exit; spades keep their character), regenerate the card art (`client/markovs/deck.ts` SHAPES),
  screen, then propose.

### P4 — the concealed court, retired for now
- Kings placed face down, one free reveal a turn, entry turns a King up (engine flag `concealed`,
  deployed). Proposed twice (rounds 7 and 8), reverted both times: players used it (≈ 3 reveals a
  game, half their own King), named hindering an opponent as an intention for the first time, and
  raised far fewer false alarms — but saw fewer real threats, and draws doubled because nobody can
  steer at a King they cannot name.
- **Revisit if:** entering a face-down King becomes worth aiming for (e.g. turning one up yourself
  costs your landscape action, or face-down Kings are only the undealt ones).

## Instrument backlog

- **A fresh milestone suite** that no round has touched: the held-out test seeds have been part of
  every keep decision, so they are no longer fully held out. Add one with `set_suite` and use it
  only for milestone checks.
- **Two-player seeds in the bot split** (`set_suite` `bot.players: [2, 3, 4]`): two players change
  the game (two Kings reset the counter; repeated discoveries narrow the opponent's secret) and the
  suite has never covered them.
- **Definitions declaring their own measures and questionnaires:** targets already live in the
  frontmatter; derived measures from the engine's audit counters and a `questionnaire:` block
  with game-specific questions would let each game iterate its own instrument.
- **The stand-in for new actions:** a rule that adds an action needs the greedy stand-in to value
  it before the bot split can measure it (the concealed court was measured as if absent until h21).

## Art and print

- **The stay loop on the dials** (Eddy, Switch): it reaches toward the western port and reads as an
  exit. Being redrawn in the lab's **Seals** experiment (`client/seals/`): stays as a closed
  loop off the hub, never reaching the rim; port `sealCard` into `cardSvg` once the styles settle.
- **Box art** (`static/markovs/box-*.jpg`): the supplied art with its lettering erased; every
  word on the box (title, tagline, player count, card count from the deck) is set in `BOX` in
  `client/markovs/page.ts`, so a rules change only needs that text edited.
