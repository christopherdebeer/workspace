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
