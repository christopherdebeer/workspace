# ADR-0086 — Embodied participants: the participant key, presence, and work leases

- **Status:** Accepted 2026-07-16 — **Inc 0–4 built + ALL validated live**
  (deploys #356–358 for Inc 0–3; Inc 4 + presence/lease hardening #359–365,
  same day). Inc 4 (per-participant posture) landed substrate-native rather
  than as an auth surface: a participant adopts its posture by remembering
  **`_posture/<participant>`** `{goal?, lens?, salience?}` — a plain fact,
  sibling of `_presence/<participant>`, optionally timer-expiring — and every
  composed read carrying that participant's `as` resolves through it,
  overriding the token posture (the finer key wins; `auth.adoptGoal` stays the
  token-level layer and the fallback). Chosen over extending `adoptGoal`
  because posture-at-participant-grain is per-dispatch state the workspace read
  path already owns, and a fact is visible, editable, and expirable the way
  presence already is — no auth store change, no extra validate-token payload.
  **End-to-end live proof — membrane probe wave 4** (`membrane-probes/wave-4`):
  FOUR embodied drivers (`driver/weave`·`fix`·`improve`·`consolidate`) ran
  concurrently, each with its own `as`, presence row, run lease, and
  `_posture/*` — captured mid-flight as five simultaneous distinct
  `_presence/*` rows, five non-colliding leases, and four driven machine runs
  (including `machine/improve`'s first-ever run) driven to `done`. The whole
  design closed the loop it was written for: the wave-2 CI double-ratify (one
  undifferentiated actor) became four distinguishable ones that leased without
  contending and found each other on the board. Work leases also hardened
  under fire: pair-lease domain aliasing (`lease/pair/` ≡ `lease/suggestion/`),
  a `ttlSeconds` alias with an echoed `grantedMinutes`, and self-renewal
  (re-leasing your own item refreshes the timer instead of self-contending). Inc 2 (presence): participant-keyed dispatches
  refresh throttled `_presence/*` lease facts; `whoami` echoes the ambient
  frame — live proof: two validator participants visible with actor/lastTarget/
  until after their lease calls. Inc 3 (work leases): `workspace.lease`/`release`
  (ifAbsent+timer; release = expire-now); suggestions annotates in-flight pairs
  (leasedBy/leasedUntil) and carries `pairHash` so a judge can lease without
  re-deriving the server hash — live proof: acquire→contend(holder named)→
  cooperative release(noted)→re-acquire, full cycle. Only Inc 4
  (per-participant posture) remains open. Inc 0: the claim/lease terminology amendments. Inc 1:
  `read`/`act` accept `as`; the gateway validates it loudly (W3f) and threads it
  via a derived context (`withIdentity` — identity patched AND the
  serviceClient rebuilt) into the identity envelope beside actor/posture/act;
  `state.put` stamps `_meta.as` beside `via`; the `capability.invoked` event
  carries `participant`. Live proof: a dispatch with `as:"validation/inc1"`
  landed `writer:c15r · via:… · as:validation/inc1`; a malformed key errored
  with a teaching message. Presence (Inc 2), work leases (Inc 3), and
  per-participant posture (Inc 4) remain open. This ADR extends the membrane
  (doc:docs/the-coupled-workspace) from *one* coupling to *many*: several
  internal workspaces coupled to one external workspace, distinguishable at
  the boundary, aware of each other the only way the blackboard tradition says
  specialists ever are — through the board.
- **Depends on:** ADR-0022 (mediation — the auth layer stamps `identity.actor`),
  ADR-0024 (RFC 8693 delegation chains — `exchangeToken` with `actor` +
  narrowed scope), ADR-0074 (adopted posture, already **per-token**:
  `dropGoal {tokenId}`), ADR-0050 (actor-classed attention counters),
  ADR-0084 (the embodiment section — "a node is a role; whoever resolves it is
  an actor" — plus two of its open increments this ADR absorbs: the run-lease
  and the ambient frame), ADR-0085 (capability salience — per-participant
  usage needs a participant to attribute to), and the fact-timer physics
  (`ifAbsent` + `timer`: atomic, expiring exclusivity — already tested as
  "lease / reveal").
- **Ancestor:** sync's `agency-and-identity.md` — "is Hamlet the agent, or the
  actor playing Hamlet?" Identity is declared at embodiment; a role and its
  actor are distinct records. And sync's rooms carried their participants in
  `/context` — presence was part of every observer's perceptual frame.
- **Grounded in live evidence (2026-07-16):** membrane probe wave 2
  (`membrane-probes/wave-2`). All six wave probes rode ONE MCP connection —
  one token, one principal, one posture — so at the membrane they were the
  same actor. Cost, measured twice: (a) the two parallel CI probes
  **double-adjudicated the same suggestion** — the second's `ratify` returned
  `dropped:0`, which it faithfully reported as a contract violation, because
  its invisible sibling had ratified the pair minutes earlier; (b) the
  substrate-side telemetry (ADR-0085's `_caps` counters) cannot distinguish
  the waves' verb usage from the owner's own. In-flight work leaves no fact
  until it commits, so stigmergy — the substrate's only awareness channel —
  arrives exactly one commit too late to prevent contention.

---

## Context

The identity stack already has three layers, two of them built this week:

1. **Principal** — the verified token subject, stamped as `writer` on every
   fact. Authority-grade; never negotiable.
2. **Delegation actor** — ADR-0024's exchange chains: a child token with
   narrowed scope and a distinct actor stamp (`client:claude`,
   `agent:<machine>.<node>` — ADR-0084's self-attenuation pattern).
   Security-grade embodiment **between connections**.
3. **Posture** — ADR-0074's adopted goal, attached per-token.

The gap is *within* a connection. An MCP connection carries one token, so every
subagent a client fans out — probe waves, parallel specialists, a fleet of
drivers — collapses into one undifferentiated actor: same writer, same actor
class, same posture, same capability-attention row. Layers 2 and 3 are
structurally out of reach without opening a new connection per participant,
which no client does.

And even fully distinguished participants would be mutually blind. The
substrate's awareness channel is stigmergy — you see other actors through
their committed writes. Wave 2 showed both faces: the round-trip reader found
its predecessor's findings unaided (stigmergy working), and the CI race showed
its latency (stigmergy is awareness *after* commit; contention happens
*before*). Sync's rooms did not have this hole: participants were in the
context frame.

### The terminology ruling (recorded as part of this decision)

The word **claim** is already load-bearing and epistemic across three layers of
the substrate: a machine run's `…/claim/<node>` is an assertion with statement
+ confidence (ADR-0084); the `claim` type (Elicit-lineage research vocabulary)
is a proposition carrying `support` refs the graph derives edges from; the
contested view adjudicates claims as things that can be *contradicted*. All
three agree: **a claim asserts what is true.**

Exclusive acquisition of work is a different concept and gets the substrate's
own existing word: **lease** — time-bounded, auto-expiring, non-assertive
(you believe nothing by holding one, and it evaporates if you die). The
`ifAbsent`+`timer` write has always been a lease; the tests call it that;
ADR-0084's open increment is already named "run-lease."

Ruling: **claim = epistemic assertion, always; lease = temporal exclusivity,
always.** The three texts that mix the senses ("an atomic, lease-bound claim"
in the `registerAction` descriptor, the machine cell's hand-off comment,
`substrate-storage.md`'s task-queue line) are amended alongside this ADR —
vocabulary is the interface, and an overloaded term is a membrane defect of
exactly the class the probe waves keep finding: the wrong meaning ignites.
One live vocabulary item remains: the machine cell's declared action
`_actions/task.claim` (a lease in everything but name) renames to
`task.lease` with Increment 3, when the lease convention lands — an action id
is substrate vocabulary agents may reference, so it moves with a deprecation
alias, not a comment sweep.

## Decision

**Embodiment becomes two-tier and explicit; awareness and exclusivity become
substrate-native facts.** Four parts:

### 1. The participant key — provenance, never authority

`read`/`act` gain an optional `as` (participant) argument: a short,
self-declared name for the embodied actor within this connection
(`membrane-probe/CI-d1`, `steward/weave`, `wave-3/IP-2`). The gateway threads
it through, and it lands exactly where `via` lands today — as **provenance
decoration**:

- writes record it beside `via` (`writer: c15r · via: client:claude · as:
  membrane-probe/CI-d1`);
- the ADR-0085 capability touch carries it, so per-participant verb usage
  becomes substrate-side telemetry;
- posture resolution may be keyed by it (Increment 4).

The invariant that keeps it from being brittle: **the participant key never
touches authority.** `writer` stays the verified principal; scopes stay the
token's; no read filter, grant, or guard may condition on `as`. Its threat
model is `via`'s: within one authenticated connection, the only party who can
spoof it is yourself — that is a provenance annotation, and the substrate has
recorded `via` un-verified since the beginning without regret. Real
delegation — another person's agent, an unattended steward, a machine driver
with narrowed grants — keeps using child tokens (layer 2), which remain the
security-grade answer *between* connections.

### 2. Presence — lease-expiring facts in the ambient frame

`_presence/<participant>` facts: written on activity (by the gateway or the
participant), carrying the participant key, actor class, adopted
posture/goal, and optionally what it is currently holding; expiring by fact
timer (a short lease — no reaper needed, absence IS the signal). Surfaced
through the **ambient frame** — ADR-0084 Open #4, absorbed here: `whoami` and
recall's overview echo the live participants the way they will echo the
resolved posture and open driven yields. `whoami` stops answering only "who
am I" and starts answering "who is here, holding what."

This is deliberately *not* peer-to-peer: participants see each other on the
board, per the blackboard/GWT lineage (specialists never see each other; they
see the broadcast). Presence is just a fact with a short lease.

### 3. Work leases — exclusivity for contended items

The `ifAbsent`+`timer` atomic write, applied as a convention (and a helper)
to contended work: `lease/<domain>/<item>` — e.g.
`lease/suggestion/<pairHash>` before adjudicating, `lease/run/<runId>` for
drivers (ADR-0084's run-lease, absorbed here). Holding a lease asserts
nothing; it expires on its own; a second participant seeing a live lease
skips the item. The CI double-ratify class closes: CI-d2 would have seen
CI-d1's lease on the pair and moved to the next candidate. Adjudication
verdicts (the `checked/*` markers) remain what they are — epistemic records —
and now sit cleanly beside, not confused with, the lease that serialized
writing them.

### 4. Per-participant posture

`adoptGoal`/`dropGoal` accept the participant key, so a fanned-out specialist
can adopt its task goal — biasing *its* reads — without hijacking the
session's standing posture. ADR-0074's mechanism, keyed one level finer.
(Requires Increment 1; lands last.)

## Costs & honesty

- **A self-declared key can lie, cheaply.** Accepted: it is provenance, not
  authority, and its value survives dishonesty the same way `via` does — the
  record of *what claimed to act* is still evidence. The failure mode to
  guard in review is scope creep: the day something authorizes against `as`,
  this ADR is violated.
- **Presence is heartbeat traffic.** Each active participant writes a small
  fact per lease-window. Bounded by participant count and window; the
  counters path (ADR-0050) showed the substrate absorbs this class of write
  cheaply. Idle sessions cost nothing (the lease lapses).
- **Leases add a read-modify hop to contended paths** and can orphan work for
  one lease-window when a holder dies. Both are the standard price; the
  timer keeps it bounded, and the reaper lesson (ADR-0084 §6) applies: the
  window must exceed any honest work duration.
- **Two embodiment tiers is real complexity.** The alternative — child tokens
  for everything — is cleaner on paper and unusable in practice (no client
  opens a connection per subagent). The tiering matches trust reality:
  verified where authority flows, declared where only attribution does.
- **The ambient frame grows.** whoami/recall gain rows; the membrane lesson
  cuts both ways — presence must arrive as a few refs-tier lines, not a
  roster dump.

## Increments (dependency order)

0. **Terminology amendment** (with this ADR): the three mixed-sense texts;
   claim/lease senses recorded in `$types`-adjacent docs.
1. **Participant key**: gateway threads `as` → write provenance + the
   ADR-0085 capability-touch event. Ships alone; wave 3 probes adopt it and
   become distinguishable in substrate telemetry immediately.
2. **Presence**: `_presence/*` lease facts + ambient-frame echo in
   whoami/recall overview.
3. **Work leases**: the helper + convention; first consumer is suggestion
   adjudication (`lease/suggestion/<pairHash>`), second is the ADR-0084
   run-lease.
4. **Per-participant posture**: adoptGoal keyed by participant.

Validation is already designed: the membrane probe battery
(`protocol/membrane-probes`) re-runs with participant keys — the CI replicas
should stop colliding (leases), find each other in the ambient frame
(presence), and appear as distinct rows in the `_caps` usage telemetry
(participant key). The wave that found the gap becomes the wave that proves
it closed.
