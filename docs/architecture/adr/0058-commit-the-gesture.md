# ADR-0058 — Commit the gesture, not the frames

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
- **Depends on:** ADR-0053 (the outbox is where this lands), ADR-0046/0054
  (placements are the facts in question), ADR-0050 (touch/velocity honesty).

## Context (grounded — observed in prod during ADR-0055 verification)

Tailing the scoped feed live showed one placement
(`_canvas/parcland/model/velocity`) written **6 times in 11 seconds** during
a single drag — revision 11 by the end of one interaction. The outbox's
400 ms flush delay coalesces keystrokes-scale bursts, but a continuous
gesture (drag, resize, rotate, pinch) re-stages the same key faster than the
flush window closes, so every ~1.5 s a frame of the gesture becomes a
substrate write. Costs, each real:

- **Write amplification** — the G9 thread again, gentler but structural:
  N writes per gesture × gestures per session, each paying DynamoDB, seq
  allocation, and a trajectory event with a TTL row.
- **Feed noise** — every open surface (and now every *scoped* consumer, ADR-
  0055) receives the intermediate frames; the canvas echo-skips its own, but
  agents and other boards see a stutter of near-identical placements.
- **History pollution** — revision 11 after one drag means "what changed?"
  is unanswerable from revisions; the interesting delta (where it started →
  where it ended) is smeared across frames.
- **Salience distortion** — velocity/attention counters bump per write
  (ADR-0050), so dragging a card "earns" activity signal. Placements are
  `_`-prefixed (tending-excluded) which contains the damage, but the
  principle leaks wherever gesture-rate writes touch scored facts (e.g.
  live text editing on `el:*` bodies — same failure, member-visible).

The fix is a policy the outbox can hold: **the unit of persistence is the
gesture, not the frame.**

## Decision

The kernel outbox (ADR-0053) gains a **hold** — a named, re-entrant gate
that defers flushing for keys staged while it is open:

```ts
outbox.beginHold('gesture');   // pointer-down on an element / resize start
outbox.stage(key, value);      // stage as usual — latest value wins per key
outbox.endHold('gesture');     // pointer-up → one flush of the FINAL values
```

- **Canvas wires it to the gesture FSM**: drag/resize/rotate/pinch states
  open the hold on entry and close it on exit; a gesture therefore commits
  exactly one write per touched key — its end state. Tap/type paths are
  untouched (the 400 ms debounce already fits them).
- **Safety valve**: a hold older than `maxHoldMs` (default 10 s) flushes
  anyway and re-opens — a long slow drag checkpoints rather than riding an
  unbounded buffer; a crash mid-gesture loses at most the last partial
  gesture, never the board.
- **Text editing joins the policy** at the same seam: content edits stage
  through the outbox with a longer effective window (flush on blur/idle,
  checkpoint at `maxHoldMs`) — ending the per-keystroke-burst revisions on
  `el:*` facts, which DO carry member-visible salience.
- **No server-side amend.** Revisions stay append-only and honest; we write
  less, we do not rewrite history. (An amend/squash primitive was considered
  and rejected: it complicates CAS, trajectory, and the audit story for a
  problem the client can solve by writing the right thing once.)
- Priming and holds compose: the existing priming buffer already queues
  stage() calls; a hold is the same mechanism with an owner and a timeout,
  so the implementation is a generalization, not a second buffer.

## Increments

1. Kernel outbox: `beginHold/endHold(name, {maxHoldMs})` + tests in the
   headless stub; canvas gesture FSM opens/closes it around move/resize/
   rotate/pinch. Measure: one drag = one placement write.
2. Text/content edits flush on blur or 10 s checkpoint; measure `el:*`
   revision growth per editing session before/after.
3. Flight-recorder counter: writes-per-gesture, so regressions surface as a
   number instead of a DynamoDB bill.

## Costs & open questions

- Remote viewers stop seeing mid-drag motion (they saw ~1.5 s stutter, not
  smoothness — nothing of value is lost today). If live co-presence ever
  matters, that's a push/ephemeral channel (ADR-0055 Inc 4 territory), not
  more facts.
- A crash mid-gesture loses the tail of that gesture (bounded by
  `maxHoldMs`). Acceptable: the pre-gesture state is durable.
- Open: should `endHold` flush immediately or fall back into the 400 ms
  debounce? Leaning immediate — gesture end is a natural commit point and
  the user's mental "it's placed" moment.
- Open: does the hold surface in `parc:save-state` (the save dot)? Proposed:
  yes — "unsaved" while held, so the indicator stays honest during a drag.
