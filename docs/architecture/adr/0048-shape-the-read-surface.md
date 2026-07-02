# ADR-0048 — Reads answer at the caller's altitude

- **Status:** shipped 2026-07-02 (workspace commands + first-party adoption: home graph/palette/
  dashboard/SSR).
- **Date:** 2026-07-02
- **Depends on:** ADR-0033 (progressive disclosure — recall's overview is the pattern this
  generalises), ADR-0044 L4 (structure over knobs — one tier vocabulary, not per-command flags),
  ADR-0029 R1 (inline affordances ride along unchanged).

## The audit (live defaults, 2026-07-02)

The read surface was measured as an agent/surface consumes it. The defaults were an order of
magnitude past what any caller renders:

| target (default call)              | payload | what callers actually needed            |
| ---------------------------------- | ------: | --------------------------------------- |
| `workspace.graph` / `$graph`       | 1.94 MB | home draws 257 edges among 109 nodes    |
| `workspace.links`                  | 1.47 MB | a count (dashboard stat) or ~10 facts' edges |
| `workspace.query {limit:140}`      |  423 KB | titles + type + score for graph nodes   |
| `workspace.changes` (bare)         |  371 KB | the newest ~200 events                  |
| `workspace.neighbors {key}`        |   36 KB | chip icons + titles                     |
| `workspace.recall` (bare)          |   21 KB | ✓ already shaped (ADR-0033)             |
| `workspace.recall {view:"full"}`   | **500** | the unshaped full view exceeded the response ceiling |

`recall` was the model citizen — shaped by default, expressivity one argument away. Everything
else returned whole value bodies unconditionally. The failure mode compounds: every list surface
re-downloads every fact body it will never show, agents burn context on elided-in-practice
payloads, and the substrate's own full view had already outgrown its own ceiling.

## Decision

**Shaping is presentation, never authority** — it narrows what is SENT, not what may be read.
Three uniform mechanisms, advertised in `$catalog`:

1. **One entry tier — `shape: "refs" | "card" | "full"`** on every collection read (`query`,
   `search`, `neighbors`, `members`, `recall {view:"full"}`).
   - `refs` — key + `_meta` essentials (type, tags, score, updatedAt, superseded). No value.
   - `card` — the presentable row: value with long strings truncated (240 chars, `…`), structure
     summarised past depth 2, lists/fields capped with explicit `… n more` markers. Label paths
     (`value.title`, a content first-line) survive, bodies don't. `_meta` whole + `shaped:"card"`.
   - `full` — everything, exactly as stored.
2. **Caller-declared scope on edge reads** — `graph` and `links` take `keys` (only edges touching
   those facts — "the edges around X", not the projection), `rels`, and `limit`, and always report
   `total` (matches before the cap). `{limit: 0}` is the idiomatic count.
3. **A bounded change feed** — `changes` gains `last: n` (the NEWEST n, still ascending — the
   "recent activity" read, folding the old head-then-window two-step into one call). A **bare**
   `changes()` now defaults to `last: 200`; explicit `sinceSeq` tailing and `limit` forward-paging
   are byte-for-byte unchanged.

### Defaults: compatible except where the default was already broken

`query`/`search`/`neighbors`/`members` default to `full` — existing cell backends (machine, run)
read whole values through them, and L2's spirit applies: don't change data under a standing
reader. Two defaults DID change, deliberately:

- `recall {view:"full"}` now returns **card** entries (`expand:[keys]` returns those named keys
  whole — the existing "this one, whole" gesture; `shape:"full"` restores everything). The old
  default was a 500 error; nobody could have been depending on it.
- bare `changes()` returns the newest 200 instead of the whole TTL-bounded trajectory.

### First-party adoption (the proof)

- **home graph**: nodes via `query {shape:"card"}`; edges via `graph {keys: visible}` at mount and
  `graph {keys: newSatellites}` per one-hop expand (replacing the cached whole projection).
- **home palette**: neighbour chips via `neighbors {shape:"card"}` (the content preview already
  comes from a full `peek`).
- **home dashboard**: `links {limit:0}` for the edge-count stat; `changes {last:1000}` for the
  activity chart (one call, was two).
- **WorkspaceWindow**: `links {keys: <the 10 visible facts>}` replaces the whole-slice edge read.
- **home SSR** (`ssr.json`): the links read is count-only; changes is the last-1000 window — the
  server-side render stops hauling ~1.8 MB per page it never painted.

## What was deliberately NOT built

- Per-field projection (`fields: [...]`) — GraphQL-shaped knob sprawl; the three tiers cover the
  render floor (L4). Revisit only with a concrete consumer the tiers can't serve.
- Server-side plumbing filters on `query` (home filters `_`-keys client-side) — what counts as
  plumbing is a presentation policy, not a substrate truth.
- Shaping `peek` — a single named fact is the "give me the whole thing" gesture by definition.

## Follow-ups

- `attention`/`suggestions`/`view` results could take the same tier if they grow.
- Consider `card` as the DEFAULT for `neighbors` after a deprecation window (no known full-tier
  consumer; lit/canvas render titles).
- The gateway could stamp response sizes into the trajectory so the next audit is a query, not a
  measurement session.
