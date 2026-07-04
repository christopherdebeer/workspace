# ADR-0055 — Scoped change feeds: a surface pays for its slice, not the workspace

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
- **Depends on:** ADR-0053 (the projection consumes this), ADR-0048 (shaped
  reads), ADR-0050 (seq/trajectory discipline).

## Context (grounded)

`workspace.changes { sinceSeq }` returns the WHOLE workspace's event stream.
The canvas's live-sync tails it every 6–30 s and filters client-side to
`el:*` + `_canvas/<cid>/*` (`storage.ts startLiveSync`). Observed costs:

- Every open surface downloads every agent's activity forever. The tending
  machine alone emits runs/rails/claims/audits on a schedule; each event ships
  to every open board, is parsed, and is discarded.
- Read events ride the same feed (by design — the trajectory is honest), so a
  busy agent *reading* generates client traffic for every viewer. The canvas
  now op-filters client-side, but the bytes still crossed the wire.
- Each relevant key then costs a follow-up `workspace.query {prefix:key}`
  round-trip. A burst of N remote writes = N+1 requests per open surface.
- Bare `link`/`unlink` ops carry no key, so they cannot be scoped at all by
  the client — pre-G9 this ran a 2-request edge rebuild per tick, per board.

The feed is the substrate's nervous system; surfaces need a synapse, not the
whole spinal cord.

## Decision

`workspace.changes` accepts an optional **scope** and an optional **shape**:

```ts
changes({
  sinceSeq,
  scope?: { prefixes?: string[]; tags?: string[]; ops?: string[] },
  include?: 'events' | 'entries'   // 'entries' inlines the post-write fact
})
```

- **Server-side filtering** on `prefixes` (key prefixes, e.g.
  `["el:", "_canvas/parcland/"]`) and `ops` (`["write","supersede"]`). Events
  outside scope don't ship. `seq` still advances monotonically; the response's
  head `seq` is global, so cursors stay simple.
- **`include: 'entries'`** returns the current entry (card-shaped, ADR-0048)
  alongside each write event — eliminating the N follow-up fetches. Superseded
  keys return the tombstone marker. Grants are checked at read time exactly as
  `query` does.
- **Link events gain their endpoints** (`from`, `rel`, `to`) so a scoped
  consumer can decide relevance without a rebuild query. (They already carry
  op + seq; the omission of endpoints is what forced the canvas to refetch
  the whole link set.)
- The unscoped call remains valid (agents/tooling tail everything).

Consumer: ADR-0053's projection passes its scope; the canvas's tick becomes
one request returning only actionable entries — usually empty.

## Increments

1. Gateway/workspace service: `scope.prefixes` + `scope.ops` filtering, link
   endpoints on events. (Filtering is post-read of the trajectory page —
   compute-cheap; paging semantics unchanged: a fully-filtered page returns
   `events: [], seq: pageEnd`.)
2. `include:'entries'` (card shape) — removes the fetch-per-key pattern.
3. Canvas live-sync passes scope; drop client-side op filtering; measure the
   idle board at ~0 bytes/tick.
4. Later: tag scopes (needs the store's tag index on the read path) and, if
   polling ever hurts, a push channel — out of scope here.

## Costs & open questions

- Filtered pages can be empty while `seq` advances — clients must treat
  `events: []` + advanced `seq` as progress, not silence (the canvas already
  does).
- `include:'entries'` re-reads N facts per page server-side; bounded by page
  size and cheaper than N client round-trips, but it moves load to the
  service — watch the hot-partition budget from G9.
- Open: should scope filtering count as a *read touch* for salience? Proposed:
  no — same rule as `query` (rendering must not inflate salience, ADR-0050).
