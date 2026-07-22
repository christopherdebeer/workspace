# ADR-0089 — Single physical origin for "a fact changed": stream-derived fan-out

- **Status:** Accepted 2026-07-18 (shipped with the change).
- **Depends on:** the SubstrateTable DynamoDB stream (ADR-0013's storage
  floor; already carries the vector indexer ADR-0030 and the analytics
  archiver), the reaction reactor + `_subscriptions/*` (ADR-0011/0083),
  the revision-vs-maxDepth loop bound (`subscriptions.ts`).
- **Grounded in:** the 2026-07 platform coherence audit (write-fanout seam,
  verdict PARTIAL/high): `state.put()` did not announce, so the logical
  change event `workspace.fact.written` was hand-emitted at ~10 independent
  call sites, and a new write path that forgot the emit silently broke
  reactions/subscriptions/machines while trajectory, analytics, and the
  vector index kept working (they ride the stream). `ingest` bulk writes and
  work leases were live examples of forgotten emits: their writes never
  fired reactions at all.

---

## Context

Two propagation substrates carried "a fact changed":

1. **The DynamoDB stream** — automatic, single physical origin, driving the
   vector indexer and the analytics archiver. Cannot be forgotten.
2. **Hand-emitted EventBridge `workspace.fact.written`** — ~10 sites
   (`remember`, the reactor's own re-emit, the organ write path, cell
   lifecycle projection, machine tick, tending, data mirror, declared-action
   invoke ×2), driving the reaction reactor via `FactReactionRoute`
   (source-pinned `workspace`).

The coupled-workspace framing sharpens why this matters: a write is the
agent's externalized thought, and its announcement is what lets that thought
shape future reads. An announcement that depends on every write site
remembering to speak is a membrane that can silently go deaf.

## Decision

`workspace.fact.written` gets **one physical origin**: a third stream
consumer, `services/fact-fanout`, which reduces each stream batch to the
announcements it implies and emits them onto the platform bus (Source
`workspace` — `FactReactionRoute` is unchanged). Every hand emit is removed,
including the reactor's re-emit (a reaction's write reappears on the stream;
a hand re-emit would double-fire every downstream subscription).

The fan-out enforces the reactor's input contract at the origin (pure,
unit-tested `planFactEvents`):

- **facts only** — `sk = KEY#…`; edge/trajectory/seq rows never announce;
- **no `_`-prefixed keys** — vocabulary/system writes never react (the
  reactor's own guard, applied at the origin so its no-op invocations are
  not paid per write);
- **no REMOVEs** (a TTL reap is not a write) and **no superseded images**
  (retirement isn't an announcement; the reactor no-ops on them);
- **MODIFY announces only on a revision change** — `put` bumps `revision`
  while `recordTouch` and `supersede` do not, so touch bumps and
  retirements filter structurally rather than by field allowlist.

The chain bound is unchanged and now uniform: the reactor caps on the
triggering fact's own `revision` vs each subscription's `maxDepth` (default
50), and the revision rides the stream image — no event-carried depth.

## Consequences

- **The emit cannot be forgotten.** Whatever writes the table announces.
  Paths that never emitted before now do: `ingest` bulk writes, work
  leases, and any future writer — the audit's "silently broken reactions"
  class is closed by construction.
- **The machine tick loses its `revision: 0` bypass.** Resumed/reaped runs
  announce with their real revision, so a run past a subscription's
  `maxDepth` no longer sneaks under the loop bound on resume — the cap now
  binds every path equally. Long reactive machines should declare a larger
  `maxDepth` on their step subscription.
- **Reaction latency gains the stream hop** (typically sub-second; the
  fan-out uses no batching window). Reactions were already asynchronous.
- **Delivery stays at-least-once** — as it was with EventBridge hand emits.
  Reactions that must be exactly-once keep using the lease/CAS primitives
  (`ifAbsent` + delete-timer claims), unchanged.
- **ADR-0088 (wake-on-change) rides this seam.** External push (long-poll
  `changes`, participant delivery) should consume the same stream-derived
  origin rather than adding a fourth propagation substrate.

## Not done (deliberately)

- The other workspace domain events (`workspace.shared`, `workspace.tended`,
  `capability.invoked`, …) keep their explicit emits — they are semantic
  announcements with payloads the stream does not carry, not the raw change
  event.
- The reactor stays on EventBridge rather than consuming the stream
  directly: the bus hop preserves the source-pinned routing/attestation
  model and keeps the reactor's per-event Lambda semantics; the stream
  consumer stays a dumb translator.
