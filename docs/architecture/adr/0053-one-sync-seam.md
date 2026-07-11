# ADR-0053 — One sync seam: the kernel owns projection and the outbox

- **Status:** Accepted (Inc 1) — the outbox shipped and is live in the lit client
  (`cells/lit/client/lib/outbox.ts`) and canvas storage; later increments open.
  Status was stale (“implementing now”); reconciled by the 2026-07-09 ledger scan.
- **Depends on:** ADR-0017 (kernel as the shared client), ADR-0044 (distill the
  substrate), ADR-0048 (read shaping). Repays the bug class documented in
  `docs/canvas-cell-review.md` §3.1–3 and `docs/canvas-stocktake.md`.

## Context (grounded — one failure, five faces)

Every catastrophic canvas defect of the 2026-07 hardening cycle was the same
failure wearing different clothes: a hand-rolled, module-level shadow of
substrate state drifting from the truth.

- **Cross-board fact deletion**: `lastWritten` survived drill navigation, so the
  save sweep superseded the *previous* board's facts.
- **The boot write storm**: dedupe seeded from raw stored values instead of
  prospective write payloads — every open rewrote the board, hard enough to put
  DynamoDB into throughput throttling.
- **Two-tab revision ping-pong**: dedupe compared insertion-ordered JSON; the
  same placement serialized differently per session (revision 53 on one
  placement fact).
- **Lost membership tags**: a write-gate (`boardPriming`) *dropped* user writes;
  failed writes weren't retried; an optimistic tag cache suppressed the retry.
- **Self-echo polling**: our own flushes came back through the change feed and
  were re-fetched, one request per key, forever.

Each was fixed point-wise inside `cells/canvas/client/lib/network/storage.ts`
(~1,300 lines, most of it this machinery). Nothing prevents `lit`, `home`,
`input`, or the next cell from reinventing the same seams with the same bugs.
The substrate already has the primitives (revisions, `seq`, `workspace.changes`)
— what's missing is a client layer that owns them.

## Decision

The kernel (`cells/kernel/client/main.ts`, served as `/@c15r/kernel/app.js`)
grows a **sync seam** that every tier-2 surface uses instead of hand-rolling:

**Inc 1 — the Outbox** (write half):

```ts
createOutbox(act, opts) → {
  stage(key, value, extra?)   // queue a write; canonical-JSON deduped
  seed(key, value)            // "this is already persisted" (canonical form)
  seededJson(key)             // for self-echo comparison
  wroteRecently(key, ms?)     // change-feed echo suppression
  forget(key), keys()         // retire-sweep support
  beginPriming(), endPriming()// buffer writes during a load; REPLAY, never drop
  reset()                     // board/scope switch: clear seeds, keep pending
  flushNow()                  // concurrent flush; failures RE-QUEUE with backoff
  onState(cb)                 // 'saving' | 'saved' | 'failed' for UI dots
}
stableStringify(v)            // exported: one canonical serialization
```

Semantics are exactly the battle-tested canvas behavior, lifted verbatim:
canonical key-sorted JSON for all comparisons; priming buffers and replays
through the dedupe (render echoes no-op, user writes land); a staged write
carrying **tags** bypasses value-dedupe (membership is a tag); failures
re-queue with capped exponential backoff; successes record an echo window.

**Inc 2 — the Projection** (read half): `createProjection(read, query)` owning
"query → live local entries": initial load seeds the outbox, the change feed
(scoped per ADR-0055) applies remote writes with echo suppression and
live-revision preference (today's `fetchFact`/`applyRemote*` logic). Cells
subscribe; `canvasState.elements` becomes a view over it.

**Consumer migration**: canvas first (Inc 1 replaces `lastWritten`,
`recentlyFlushed`, `boardPriming`, `flush` in `storage.ts`); `lit`/`home`
follow when next touched. The kernel-stub in the canvas harness implements the
same factory so headless verification keeps working.

## Increments

1. **Outbox in the kernel + canvas on it** (this change). No behavior change
   intended — the canvas's current semantics ARE the spec; the harness suites
   must stay green.
2. Projection in the kernel + canvas element/placement live-sync on it.
3. `lit` and `home` migrate opportunistically; new cells start on the seam.

## Costs & open questions

- The kernel bundle grows (~3–4 KB min). Acceptable: it's the shared client.
- Kernel deploys become load-bearing for writes everywhere — a bad kernel push
  breaks all cells at once. Mitigation: the seam ships with the harness suite
  exercising it through the canvas; kernel keeps its no-breaking-exports rule.
- Multi-outbox pages (embeds): one outbox per cell instance, keyed by `via` —
  no shared globals, which is itself a fix over today's module-level maps.
- Open: should `seed()` accept prospective *payloads* (the caller's write shape)
  only, or also raw stored values? Inc 1 keeps the canvas rule: seed with what
  a save WOULD write (`elementPayloads`), because seeding raw values caused the
  boot write storm.
