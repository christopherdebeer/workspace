# Learnings from `sync` — and how they fit our AWS-native Substrate

A deep read of **sync** (`c15r/sync` = `github.com/christopherdebeer/sync.parc.land`,
"coordination substrate for multi-agent systems," v9), to extract the primitives
and design decisions our AWS-native, MCP-first platform Substrate should consider.
Pairs with [`substrate-gaps.md`](./substrate-gaps.md) (the gap analysis vs the
legacy *knowledge* workspace `cb2166bd`). **sync and the legacy workspace are our
two ancestors and they cover complementary halves** — sync = coordination + a
queryable expression layer (no graph); legacy = knowledge graph + links + tending
(no multi-agent coordination). Our Substrate already took sync's `{ value, _meta }`
+ salience + read/act; the rest of sync's model is the menu below.

## sync in one screen

> *"Every multi-agent system reduces to two operations: read context and invoke
> actions. This is not an observation — it is a constraint, imposed deliberately."*
> (`reference/v6.md`)

- **Two axioms:** `_register_action` (declare a **write capability**) and
  `_register_view` (declare a **read capability**). These are the only unilateral
  acts. **There is no `_set_state`** — all writes go through declared actions.
  *"The declaration is the commitment. The vocabulary is the protocol."*
- **Two storage primitives:** `state` + `log`. Everything — actions, views, agents,
  messages, help — is a `{ value, _meta }` entry in a reserved scope (`_actions`,
  `_views`, `_agents`, `_messages`, `_audit`, `_help`). The substrate is uniform.
- **Actions are declarative data**, not code: `{ writes[], if, enabled, result,
  params, timer, on_invoke }`. A `write` is `{ scope, key, value | merge | increment,
  expr? }`. Invoking substitutes `${params.*}`/`${self}`/`${now}` and applies the
  writes, gated by the `if` CEL precondition.
- **Views are declarative CEL** over state, stored in `_views`, evaluated
  server-side, with an `enabled` gate and a `render` hint (the dashboard *is* a
  query over views).
- **CEL everywhere** — the one expression language for views, write guards (`if`),
  visibility (`enabled`), and wait conditions, with domain helpers (`salient()`,
  `stale()`, `contested()`, `written_by()`, `top_n()`, `focus()`, `elided()`).
- **Rooms** are shared multi-agent spaces; **agents** embody into them
  (`sync_embody`). Liveness is implicit (every read/act bumps `last_heartbeat`);
  `wait` leaks `waiting_on` to peers. Identity is self-authored state.
- **Salience shaping** (focus/peripheral/elided, `_shaping`) — the model we already
  adopted, sourced from `docs/adaptive-salience.md`.

---

## The learnings, mapped to our platform

Each: what sync does → which `substrate-gaps.md` gap it answers → how it fits
AWS-native (DynamoDB / Lambda / Streams / TTL / EventBridge) → the tension.

### A. Declarative actions/views = a "declarative cell" tier (below code-cells)

sync proves a **fully runtime-extensible vocabulary with zero code**: an agent
`_register_action({ writes, if })` and then invokes it; the substrate interprets
the write template. No Lambda, no deploy. Our platform's "act" is the opposite —
it dispatches to **code** (a cell command, or a forge dynamic-cell Lambda).

- **Fit.** Add a declarative layer to the `workspace` cell reachable through the
  existing read/act gateway: `act("register_action", {id, writes, if, …})` stores a
  template; `act("<id>", params)` interprets+applies it. This is the **"declarative
  cells"** tier `dynamic-cells.md` already anticipated — strictly lighter and safer
  than forge's code-cells (writes are *declared and bounded*, so auditable and
  permission-checkable), and it inherits the no-reconnect read/act surface.
- **Tension.** A safe interpreter for the write-template + `${}` substitution, and
  for the CEL guard (see B). Bounded by design — declarative actions can only write
  their declared `(scope,key)` targets.

### B. A CEL (expression) layer — the single highest-leverage addition

CEL is the spine that makes sync's gaps disappear at once. It serves: **query**
(views), **coordination** (`wait(condition)`), **write guards** (`if`), **conditional
visibility** (`enabled`), and **derived/maintenance views** (`_contested`,
`_unresolved`, `_context.help`, and helpers like `stale()`). Our read/act surface
today dispatches *fixed* commands; CEL turns it into a *queryable, guardable,
reactive* substrate.

- **Fit.** Answers **Gap 1 (query/projection)** as *registered CEL views* and
  **Gap 5 (tending)** as *synthetic CEL views*. Adopt a sandboxed evaluator
  (cel-js or a bounded subset) in the cell runtime; `read("<view>")` returns its
  server-evaluated value; `_register_view` stores the expr.
- **Tension (the central AWS-native one).** sync runs on **SQLite** — it loads a
  room's scopes cheaply and filters in-process; a room is small. We run on
  **DynamoDB** (key access; arbitrary filtering = scan). CEL-in-Lambda over a
  *bounded* scope (a per-user slice, a room) is fine; unbounded CEL over a large
  slice is a full scan. Mitigations: bound CEL to a queried subset; **materialize
  hot views** (recompute on write via DynamoDB Streams) instead of evaluating on
  every read; back common filters (tag/type) with **GSIs**. Decide per-view:
  evaluate-on-read (cheap/small) vs materialize-on-write (hot/expensive).

### C. Per-entry timers = the visibility-timeout / lease primitive (your DDB-TTL question)

This is the cleanest answer to "visibility timeouts (ddb ttl?)". In sync, **any
entry** (state, action, view) can carry a `timer`:

```
timer: { ms | at | ticks, tick_on?, effect: "delete" | "enable" }
```

- **wall-clock** (`ms`/`at`) or **logical-clock** (`ticks` decremented on each write
  to the `tick_on` key path);
- `effect:"delete"` → live now, **vanishes on expiry**; `effect:"enable"` → dormant
  until expiry, **then live**.
- Crucially, **liveness is computed lazily at read** (`isTimerLive()` in
  `timers.ts`), *not* by a background scheduler.

This single primitive expresses: **lease / visibility-timeout** (`{ms, effect:
delete}` — a claim that auto-disappears so the work reappears), **cooldown /
rate-limit** (`on_invoke.timer {ms, effect:enable}` — examples.md §8: 409
`action_cooldown` until it re-enables), **scheduled reveal** (`{at, effect:enable}`),
and **turn/quota expiry** (`{ticks, tick_on}`).

- **Fit.** Answers **Gap 3 (lease/visibility-timeout)** elegantly. AWS-native: store
  `timerExpiresAt` / `ticksLeft` on the item; **filter liveness at read** (a Dynamo
  filter/`FilterExpression` comparing to `now`), decrement logical ticks on the
  `put` path; use DynamoDB **TTL** only for the eventual GC of `effect:delete`
  items (TTL deletion is minutes-late, so read-time filtering is what gives
  *precise* visibility). Optional: TTL/Streams → EventBridge for reactive expiry.
- **Learning.** *Don't build a scheduler — evaluate timers at read.* That keeps
  orchestration external (your constraint) while giving real lease semantics. This
  is a better answer than the bespoke `claimedUntil` lease I sketched in
  `substrate-gaps.md` — timers generalize it (delete *and* enable, wall *and*
  logical clock) over *any* entry.

### D. Atomic claim via `if` precondition (CAS), and `if_version` proof-of-read

The canonical **task-queue** (examples.md §2): `claim_task` declares
`if: "state._tasks[k].claimed_by == null"` + a `merge` write. Two agents racing →
the second gets **409 precondition_failed**. The `if` is an atomic, server-side
**compare-and-set**. Separately, `if_version` requires the current content **hash**
to write — *structural proof you read the current value*.

- **Fit.** Answers **Gap 3's CAS**. Maps directly to DynamoDB
  **`ConditionExpression`** (we already revision-stamp entries — condition on
  `revision`/version-hash). `put(…, { if: <CEL/condition> })` and `ifVersion` are
  small, high-value additions; they make multi-writer coordination safe without
  external locks.

### E. `enabled` — conditional visibility / progressive disclosure

Any entry/action/view carries an optional `enabled` CEL; disabled = **stored but
invisible** to reads and CEL. This realizes the thesis (*"actions ARE what changes
what you can see"*) — e.g. `_resolve_vocabulary` appears only when `_contested` is
non-empty.

- **Fit.** Our gateway's `read("$catalog")` would filter targets by their `enabled`
  expr against current state — a state-dependent capability surface. Composes with
  C (timer-enable) and B (CEL). New axis beyond our salience elision: *availability*,
  not just *prominence*.

### F. Contested write-target detection

Because actions **declare** their `writes` over `(scope,key)`, sync detects when ≥2
actions target the same key and surfaces a `_contested` synthetic view + a
registration warning (`computeContestedTargets` in `actions.ts`). Conflict is made
*visible*, not resolved.

- **Fit.** Free once we adopt declarative actions (A). Relevant to multi-agent
  rooms; orthogonal to **Gap 2 (links)**, which sync does *not* have — that's the
  legacy workspace's strength, and our Substrate should take it from there.

### G. Audit / replay / history / samples = the temporal + change-feed layer

sync appends every structural event and state write to `_audit`, indexes it
(`log_index`), and exposes `history/:scope/:key`, `replay/:seq` (reconstruct room
to a sequence), and `samples/:viewId` (sparklines — a view's value over time).

- **Fit.** Answers **Gap 4 (change feed)** and adds temporal read. We already keep a
  trajectory log with monotonic `seq`; expose `changes(sinceSeq)` / `history` /
  `replay`. AWS-native: **DynamoDB Streams** → an audit table + the existing event
  bus; replay/history are queries over it.

### H. Rooms + agents + implicit liveness — a multi-agent unit vs our per-user slice

sync's **room** is a *shared* space many agents write into (with roles,
`embodiment`, presence, `waiting_on`); our `workspace` slice is **per-user**
(`scope` = caller), with sharing as read-grants. If the Substrate is to be a true
*agent-collaboration* layer (which "sync" literally is), a **room** (shared
multi-writer scope) is a distinct primitive from a per-user slice.

- **Fit / decision.** Our sharing/grants approximate read-sharing; sync's
  room+agents+embodiment is the richer collaboration unit (multiple writers,
  contested detection, directed messages, presence). **Open question for the
  Substrate:** stay per-user (workspace) or add shared **rooms**? `wait` +
  `waiting_on` + implicit heartbeat (no keepalive tool — every read/act refreshes
  liveness) come along with rooms.

### I. Help-as-state + standard library (vocabulary ships as data)

Behavioral defaults are **not** hardcoded: the "standard library" is canonical
action definitions shipped as **help content**; rooms override by writing `_help`.
sync stays *"opinionated only about infrastructure."*

- **Fit.** Ship our vocabulary/standard-library as data (slice/room-overridable),
  not baked into cell code. Complements the declarative-action tier (A).

---

## AWS-native translation table

| sync mechanism (SQLite/Deno) | AWS-native mapping | Tension / note |
| --- | --- | --- |
| CEL view over `state` | CEL-in-Lambda over a bounded scope; **materialize hot views on Streams**; GSIs for tag/type | unbounded CEL = scan; bound it or precompute |
| `if` precondition (CAS) | DynamoDB `ConditionExpression` on revision/version | direct fit |
| `timer {ms,effect:delete}` (lease) | `timerExpiresAt` attr + **read-time filter**; **TTL** for GC | TTL deletion is minutes-late → filter at read for precision |
| `timer {ticks,tick_on}` | decrement on the `put` path (conditional update) | direct fit |
| `wait(condition)` long-poll (25s) | short long-poll (APIGW ~29s) **or** Streams→EventBridge + client poll | holding Lambdas open is costly; prefer change-feed |
| `_audit` + `replay` + `samples` | **DynamoDB Streams** → audit table + event bus; replay = query | direct fit |
| Room (shared SQLite scope) | shared DynamoDB scope (room id as partition) | per-user slice today; rooms are additive |
| Help-as-state | help entries in a reserved scope | direct fit |

## How it nets out (recommended ordering)

Take **coordination + CEL + timers** from sync and **links + graph-query** from the
legacy workspace; unify both on our AWS-native, read/act substrate.

1. **CEL layer + registered views** (gaps 1+5) — the spine; unlocks query,
   guards, conditions, derived/maintenance views. Decide evaluate-on-read vs
   materialize-on-write per view.
2. **Conditional writes + timers** (gap 3) — `put(ifRevision)` (tiny, immediate),
   then per-entry `timer {effect:delete|enable}` evaluated at read = leases /
   visibility-timeouts / cooldowns, *without a scheduler*.
3. **Declarative actions** (A) — runtime, no-code, bounded write vocabulary over
   read/act; brings `enabled` (E) and contested detection (F) with it.
4. **Audit/replay/changes(sinceSeq)** (gap 4) — DynamoDB Streams.
5. **First-class links + graph query** (gap 2) — from the *legacy* side, not sync.
6. **Rooms** (H) — only if the Substrate is to be multi-agent, not per-user.

> The throughline: sync shows that **declarative vocabulary (actions/views as data)
> + one expression language (CEL) + lazy per-entry timers** turn "two verbs over
> fixed commands" into a coordination substrate — runtime-extensible, guardable,
> and time-aware — with no schedulers and no deploys. That is the shape our
> read/act gateway should grow into; the AWS-native cost is concentrated in one
> place (evaluating CEL over DynamoDB), and is manageable by bounding scopes and
> materializing the hot views.
