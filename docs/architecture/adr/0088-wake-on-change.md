# ADR-0088 — Wake-on-change: external participants subscribe to the change feed

- **Status:** Proposed 2026-07-17 (drafted from the first cross-vendor
  collaboration session — two embodied clients, `claude/code` and
  `codex/work`, coordinating through the substrate for ~90 minutes).
- **Depends on:** ADR-0086 (participants — *who* wakes; presence/posture as
  the ambient frame), the `workspace.changes` seq cursor (the feed itself),
  ADR-0083's `_subscriptions/*` seam (match → deliver exists today, for
  cells only), the machine trigger endpoints + `reactive: true` dispatch
  (nascent, un-tested end-to-end — `kb/reactive-dispatch-stuck-at-agent-nodes`
  is the open evidence).
- **Grounded in:** the 2026-07-16/17 collaboration loop. A 12-cycle,
  5-minute cron drove one Claude participant; 5 of 12 cycles were pure
  no-op polls. The ChatGPT participant (`codex/work`) discovered every one
  of this side's writes the same way — polling `workspace.changes`. The
  collaboration WORKED, but both actors sampled the substrate on wall-clock
  cadence instead of waking on the events they were actually waiting for.
  Coordination latency was the poll interval, and the no-op polls minted
  presence/telemetry exhaust with no information gain.

---

## Context

The substrate can already *describe* what changed; it cannot yet *tell
anyone*. Four partial mechanisms exist, none of which reaches an external
participant:

1. **`workspace.changes`** — seq-cursored, cheap, lets an actor prove a
   negative ("nothing since seq N") in one read. Pull-only.
2. **`_subscriptions/*`** (ADR-0083) — a real match → deliver seam
   (`match: {type}`, `deliver: @owner/cell.tool`), running in production
   for lit decomposition. Delivery targets are **cell tools only**; an MCP
   client, a webhook consumer, or another vendor's agent cannot be named.
3. **Machine triggers** — `machine/<name>/trigger/<ts>` facts and
   `reactive: true` machine definitions: the inside-the-substrate version
   of "wake on event". Nascent and un-tested: reactive dispatch reaches
   agent decision nodes and stalls (open bug above), so even the internal
   consumer of this pattern is unproven.
4. **Presence** (ADR-0086) — answers *who is here now*, not *what happened
   while you were gone*. The ambient frame made the cross-vendor session
   possible; it gave no signal about when to look.

The membrane consequence, observed live: every external collaborator
re-invents a polling loop, each with its own cadence, each paying the
no-op cost, each adding operational exhaust to the very substrate it is
watching (cf. the salience-metrology finding — bookkeeping writes
out-scoring the knowledge they track).

## Decision (proposed)

Generalize the existing subscription seam so the *delivery half* can reach
external participants, in three increments ordered by cheapness:

1. **Long-poll `changes`** — `changes({since, waitSeconds})` holds the
   read open until a matching event lands or the window expires.
   Zero registration, zero egress, works over the existing MCP connection,
   and converts the 5-minute no-op cycle into "wake exactly when seq
   advances". Filters ride the existing vocabulary (`{type, prefix}`).
   This is the 90% win and touches only tier-1.
2. **Webhook delivery** — `_subscriptions/<id>` grows a second deliver
   shape: `deliver: {url, secret}` (HMAC-signed POST of the matching
   event envelope). Reuses match semantics unchanged; needs egress and
   secret hygiene, so it is an increment, not the default.
3. **Prove the internal consumer** — test the machine trigger/reactive
   path end-to-end (it is the same seam viewed from inside), clearing
   `kb/reactive-dispatch-stuck-at-agent-nodes` or scoping its remainder.
   External wake and internal wake should be one mechanism with two
   delivery shapes, not two mechanisms.

## Non-goals

- **No direct actor-to-actor messaging.** Deliberately declined: the
  cross-vendor session coordinated entirely stigmergically (facts, edges,
  leases, tasks), including bidirectional error correction, and adding a
  side-channel would drain pressure from keeping the *shared artifacts*
  legible. Wake-on-change makes stigmergy timely; it does not make it
  conversational. Intent stays in postures, leases, and task transitions —
  where every other participant can read it.
- **No guaranteed delivery / ordering beyond seq.** The feed's seq cursor
  remains the truth; a missed webhook is recovered by the same
  `changes({since})` read as today.

## Consequences

- Collaboration latency decouples from poll cadence; no-op polling (and
  its presence/telemetry exhaust) disappears for well-behaved clients.
- `_subscriptions` becomes the single subscription surface for cells AND
  external participants — one vocabulary to tend, one place to audit who
  is watching what.
- Webhook delivery introduces the substrate's first push egress: secrets,
  retries, and a dead-letter story must land with Inc 2, not after it.
