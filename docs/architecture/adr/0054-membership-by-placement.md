# ADR-0054 — Board membership by placement: viewing a fact must not mutate it

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
- **Depends on:** ADR-0046 (board membership as projected edge), ADR-0053 (the
  outbox carries the writes). Amends the membership half of the canvas design
  (`docs/canvas-substrate-design.md`).

## Context (grounded — the tag does four jobs and fails at three)

Today a fact is "on board X" iff its `_meta.tags` contains `canvas:X`, written
onto the member fact by `addFactToCanvas`/`queueElementWrite`. Consequences,
all observed live this cycle:

- **Mutate-on-view.** Adding an agent-owned fact (e.g. `machine/tending`) to a
  board bumps *that fact's* revision and rewrites its tag set. The board is a
  lens; looking through it should not touch the specimen.
- **Tag loss = silent eviction.** When the tag write was dropped (throttling,
  the priming gate), the fact vanished from the board on reload — the G11 bug.
  Membership rode on the least-durable write in the system.
- **Routing degeneracy.** `hrefOf`'s convention "a canvas-tagged fact opens on
  that board" made every on-board card's `open →` a self-link (fixed by
  suppression, but the cause is the tag).
- **Permission coupling.** You cannot place a fact you can read but not write.

Meanwhile ADR-0046 already introduced the board-owned placement fact
(`_canvas/<cid>/<key>`, type `canvas-placement`) and projects it as an
`onBoard` edge into the Reference graph. The placement **is** a complete
membership record — in board-space, owned by the board's author, durable
through the same outbox as everything else.

## Decision

**The placement fact is the membership record.** The `canvas:<cid>` tag on
member facts is no longer written and no longer required.

- **Load**: membership = the placement query the board already runs
  (`prefix: _canvas/<cid>/`), joined to member facts via batched reads
  (`workspace.query` with keys… or per-key peeks batched; Inc 1 measures).
  The current tag-membership query remains as a *legacy union* during
  migration: `members = placements ∪ tag-carriers`, with placements minted
  for tag-carriers on first sight (self-healing migration — no bulk rewrite).
- **Add to board**: writes ONLY board-space facts — the placement (+ the board
  identity fact). The member fact is untouched. Un-pin/remove supersedes the
  placement only.
- **Elements minted on the board** (`el:*`) keep their write path (the board
  authors those facts), but their membership also becomes the placement — one
  rule for everything.
- **Graph visibility** is unchanged: ADR-0046's key-encoded rule already
  projects `<fact> onBoard canvas:<cid>` from the placement.
- `hrefOf`'s canvas-tag convention stays for *legacy* tagged facts but is now
  reachable only for facts tagged by other means (deliberate tagging), not by
  the act of placing.

## Increments

1. Canvas loads by `placements ∪ tags` and stops WRITING tags; add-to-board
   becomes placement-only; placements self-heal for legacy members.
2. Salience/tag consumers audit: anything reading `tag: canvas:<cid>` for
   membership (SSR scene read, views) moves to the placement prefix.
3. Retire the tag union once live boards show 0 tag-only members for a week;
   optional cleanup sweep supersedes stale `canvas:*` tags via a tending task.

## Costs & open questions

- **Query shape**: membership-by-tag was ONE query; by-placement is placements
  + a member-fact fetch. The board already fetches placements; the join adds a
  keyed batch read. If the gateway lacks a batched by-keys read, Inc 1 adds one
  (`workspace.query {keys: [...]}`) — small, generally useful (ADR-0048 kin).
- **Salience**: the canvas tag fed tag-based salience queries
  (`workspace.query {tag}` in `salience.ts`). Those move to the placement
  prefix + member keys; scores ride `_meta` the same way.
- **View-backed boards** are untouched (their membership is a query, not tags).
- Open: should *deliberate* "tag this fact for the board" remain a user verb
  (tags as curation, distinct from placement)? Proposed: yes, but as an
  explicit action, never a side effect of placing.
