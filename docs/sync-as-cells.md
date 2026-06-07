# `sync` as Cells — Primitive Extraction (companion to `substrate.md`)

> **Read [`substrate.md`](./substrate.md) first.** That document names the
> foundational *model* `workspace` and `sync` embody and argues it belongs in the
> platform's core. This document is the detailed **enabler catalogue**: the
> concrete primitives required to make that model real, derived by working
> through `sync`. Treat these as means to the four substrate properties, not as a
> port checklist — the goal is the model, not relocating `sync`.

This document is a **primitive-extraction** exercise. It asks what it would take
to land [`sync`](https://sync.parc.land) — a "coordination substrate for
multi-agent systems" (v9, ~41 files on Val Town, Deno + `std/sqlite`) — on this
platform's two-tier dynamic-cell architecture, and it concludes that `sync` is
not one cell to port but a **small platform of its own**. The useful output is
therefore the set of **new tier-1 primitives** `sync` forces, not a line-by-line
translation.

It is a design document. Nothing here is built. It builds on
[`dynamic-cells.md`](./dynamic-cells.md) (the two-tier model, `forge`, the
permission boundary, the runtime-multiplexing primitive table) and
[`serverless-platform.md`](./serverless-platform.md) (`defineService` /
`defineMcpService`, `HttpServiceCell`, DynamoDB and Turso/libSQL persistence,
the EventBridge bus, the `ServiceRouter`, the `auth` cell), and reuses their
primitives unchanged wherever possible.

## Thesis

`sync` is a *parallel platform*, not a single service. It ships its own auth
stack (passkeys, OAuth 2.1 + PKCE + DCR, device flow, a scope grammar, token
CRUD), its own relational store (`std/sqlite`), its own expression engine (CEL),
its own realtime layer (condition-wait long-poll), and its own multi-tenant
state model (rooms with provenance and salience shaping) — exposed across ~40
HTTP endpoints plus an 18-tool `/mcp` surface and a management UI.

Our platform already has counterparts for **some** of that — the `auth` cell is
a near-peer of `sync`'s auth stack; `/mcp` is our aggregating MCP gateway; the
EventBridge bus is our loose-coupling channel; dynamic cells give us isolated,
user-owned, promotable userland. So the exercise is **decomposition**: route
each `sync` concern to an existing primitive where one fits, and **name the new
tier-1 primitives** where none does. `sync`'s own thesis — *"two operations:
read context, invoke actions; no direct state writes; the declaration is the
commitment, the vocabulary is the protocol"* — survives the move intact, because
it is a userland data model, not infrastructure. What does **not** survive
unchanged is the substrate underneath it.

## The mapping

Each `sync` concern, and where it lands here:

| `sync` concern | Lands as | Status today |
| --- | --- | --- |
| Passkeys, OAuth 2.1 + PKCE + DCR, device flow | the tier-1 `auth` cell | exists; near-parity (see token gaps below) |
| Scope grammar (`rooms:*`, `rooms:<id>:read\|write`, `rooms:<id>:agent:<name>`, `create_rooms`), token CRUD, scope elevation, effective-access narrowing | the tier-1 `auth` cell, extended | **new** — auth-cell maturation |
| `/mcp` JSON-RPC, 18 tools (`sync_read_context`, `sync_invoke_action`, …) | the existing `/mcp` gateway (`resource` cell), aggregating a `rooms` cell's `describeTools` | gateway exists; tools are new |
| Rooms = multi-tenant shared state with `{ value, _meta }` provenance | a dedicated **`rooms` cell** (tier-1, or promotable tier-2) | **new cell** |
| Relational store (`std/sqlite`) for entries, actions, views, audit trail | **Turso/libSQL exposed to a (dynamic) cell** | **new primitive** — only the static `documents` cell uses `turso:true` today |
| Actions / views as declared capabilities; `_register_action`, `_register_view` | commands + rows inside the `rooms` cell | new (cell-internal) |
| CEL engine (`salient()`, `written_by()`, `top_n()`, `/eval`, registration-time validation) | a **CEL evaluation primitive** (shared runtime helper or sidecar cell) | **new primitive** |
| Salience shaping (Focus / Peripheral / Elided, thresholds, elision/expand) | logic inside the `rooms` cell, on top of CEL + the store | new (cell-internal) |
| Condition-wait (`/rooms/:id/wait?condition=<CEL>`), `/poll` dashboards | a **condition-wait / realtime primitive** (long-poll / SSE / blocking-on-CEL) | **new primitive** — bus is fire-and-forget only |
| Conflict detection (`contested` in `_meta`, later-registration warning) | logic inside the `rooms` cell at action-registration time | new (cell-internal) |
| Temporal: `history`, `samples`/sparklines, salience map, room `replay` | queries over the audit trail in the `rooms` cell's relational store | new (cell-internal) |
| Agent lifecycle (embody / disembody / join / invite; `agents.ts`) | commands in the `rooms` cell, authorised against `auth` scopes | new (cell-internal) |
| Management UI / frontend | a React SPA owned by the `rooms` cell, using `platform/ui` | new (cell-internal) |
| Built-in messaging (`_send_message`) | a `rooms` command; optionally mirrored to the event bus | new (cell-internal) |

The pattern: **most** of `sync` is cell-internal logic that rides on a handful
of missing substrate primitives. Extract those primitives and the rest is an
ordinary (if large) cell.

## New tier-1 primitives `sync` forces

These are the parts the platform genuinely lacks today. Each is justified by a
concrete `sync` requirement and shaped to fit the existing runtime.

### 1. Relational (Turso/libSQL) persistence for dynamic cells

`sync` is relational at its core: entries, actions, views, agents, an audit
trail joined by `(scope, key)` and ordered by a monotonic `seq`, with history
and replay reconstructed from that trail. DynamoDB's single-table `pk`/`sk`
model (the only store a dynamic cell gets today) can encode this, but the audit
queries, salience aggregations, and `top_n()` ranking want SQL.

The platform already *has* the relational primitive — `persistence: { turso:
true }` on `HttpServiceCell`, surfaced on `ctx.config.turso` — but it is **only
reachable from static tier-1 cells**; the dynamic-cell template
(`services/forge/cell-template.ts`) provisions a DynamoDB table and nothing
else. The new primitive is **relational persistence exposed to cells generally,
including dynamic ones**:

- Tier-1 use: the `rooms` cell declares `persistence: { turso: true }` exactly as
  `documents` does — no new mechanism, just adoption.
- Dynamic use (the actual gap): a way for a runtime-provisioned cell to obtain a
  libSQL database. Because Turso is an external service the platform does not
  provision (per `serverless-platform.md`), this is a **credential-injection +
  provisioning-policy** problem, not a CDK-resource problem. Options: (a)
  `forge` provisions a per-cell Turso database via the Turso API at `createCell`
  and injects `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` into the cell's
  environment, mirroring the DynamoDB table it already creates; (b) a shared
  libSQL instance with per-cell databases and tokens scoped to that database.
  Either way the permission-boundary story stays clean: the credential reaches
  only that one cell's environment, exactly as its DynamoDB table ARN does today.

For v1, `rooms` is a tier-1 cell, so option (a)/(b) is *future* work; the
immediate requirement is only "a tier-1 cell may use Turso," which already
exists. The primitive is named here because `sync`-style cells are the reason to
generalise it to userland later.

### 2. A condition-wait / realtime primitive

`sync`'s `GET /rooms/:id/wait?condition=<CEL>` **blocks until a CEL condition
becomes true**, and `/poll` backs live dashboards. This is a first-class
coordination primitive — agents synchronise by waiting on shared state — and the
platform has no equivalent. The EventBridge bus
([`serverless-platform.md`](./serverless-platform.md), Mode 2) is
**fire-and-forget**: emit and move on, no blocking, no "tell me when X holds."

The new primitive is **a way to block (or stream) until a predicate over cell
state holds**. Design constraints and options:

- **Long-poll on Lambda** is viable but bounded by the Lambda timeout (max 15
  min, and a Function URL / CloudFront hop has its own, shorter ceiling). A
  bounded long-poll (e.g. wait up to ~25–60 s, then return "not yet, re-poll"
  with the current revision) is the safe default and matches how `/poll`
  dashboards already behave.
- **SSE / streaming** over the Function URL gives push semantics within one
  connection, again bounded by timeouts; the client reconnects.
- **Evaluation trigger:** a waiter must be re-evaluated when relevant state
  changes. The natural fit is the existing bus — a `rooms` write emits an event;
  a waiter (or a small dispatcher) re-evaluates registered conditions on that
  event. This makes the realtime primitive a *composition* of the bus + CEL +
  the store, rather than wholly new infrastructure, but it needs a documented
  contract (timeout behaviour, at-least-once re-eval, idempotent client retry).

The honest risk is **blocking semantics on a request-scoped, billed-by-duration
runtime** — see Open questions. The recommendation is bounded long-poll for v1,
SSE as a fast-follow, never an unbounded block.

### 3. A CEL evaluation capability (sandboxed)

CEL is pervasive in `sync`: views, action conditions, the `/eval` endpoint, and
the wait predicate are all CEL, with domain helpers (`salient()`, `elided()`,
`written_by()`, `focus()`, `velocity_above()`, `contested()`, `top_n()`,
`val()`, `meta()`) and **registration-time validation with structured
feedback**. The platform has nothing comparable.

The new primitive is **a sandboxed expression-evaluation capability** — a
shared runtime helper (alongside `events`, `serviceClient`, `logger` on
`ServiceContext`) and/or a small dedicated cell:

- **As a runtime helper** (`ctx.cel` or a `platform/runtime/cel.ts` module): the
  `rooms` cell imports it to validate-at-registration and evaluate-at-read. The
  domain helpers are injected as the CEL environment by the *caller* (`rooms`),
  keeping CEL generic and the salience vocabulary owned by the cell that defines
  it.
- **As a sidecar cell** (`cel` provider, no public route, reached via
  `serviceClient`): better isolation if evaluation is ever fed fully untrusted
  expressions, at the cost of a per-eval invoke hop.

CEL is attractive precisely because it is **non-Turing-complete and
total-by-design**, which contains the sandbox-safety blast radius far better than
evaluating arbitrary JS would. The chosen implementation must still cap
evaluation cost (expression depth, collection sizes for `top_n()`) — see Open
questions. Registration-time validation (reject bad expressions with structured
errors, as `sync` does) is part of the primitive, not an afterthought.

### 4. Multi-tenant shared state with provenance + salience (the rooms substrate)

This is the heart of `sync` and it earns **its own cell**. A room is multi-tenant
shared state where every entry is `{ value, _meta }` and `_meta` carries
provenance and dynamics: `{ revision, updated_at, writer, via, seq, score,
velocity, writers, first_at, elided }`, with actions additionally tracking `{
invocations, last_invoked_at, last_invoked_by, contested }`. On top of that sit
salience shaping (Focus / Peripheral / Elided), the action/view declaration
model, conflict detection, temporal queries, and agent lifecycle.

This does not map onto any existing cell — it is a new bounded context. It
**consumes** the three primitives above (relational store, condition-wait, CEL)
and the existing ones (`auth` for identity/scopes, `/mcp` for the agent-facing
surface, the bus for change notification). It is the canonical *consumer* that
justifies extracting 1–3 as reusable primitives rather than burying them inside
one cell.

### 5. Token-model maturity in the `auth` cell

`sync` runs a rich token model the current `auth` cell does not fully match:

- a **scope grammar** (`rooms:*`, `rooms:<id>`, `rooms:<id>:read|write`,
  `rooms:<id>:agent:<name>`, `create_rooms`) — our `auth` already does scoped
  tokens and `requireScope(identity, 'rooms:my-room:write')` with wildcards
  ([`serverless-platform.md`](./serverless-platform.md)), so the grammar is
  *expressible* today; what is missing is the room-scoped namespace being a
  defined, first-class vocabulary;
- **token CRUD** — `POST/GET/PATCH/DELETE /tokens`, `/tokens/refresh`;
- a **stateless scope-elevation URL** issued on `scope_denied`, so an agent that
  hits a missing scope gets a link to request it;
- **effective-access narrowing** — `effective = min(token.scope, user role)`;
  *"a token can only narrow, never widen."*

All of this is auth's job, so it **folds into the tier-1 `auth` cell** rather
than spawning a primitive. It also dovetails with the dynamic-cell scope grammar
already planned in [`dynamic-cells.md`](./dynamic-cells.md) (`platform:*`,
`cell:<owner>:<name>:<verb>`): `rooms:<id>:…` is the same shape applied to a
specific cell's resources. The `min(token, role)` rule and admin-gated grant
list (`AUTH_ADMIN_USERNAMES`, the consent-screen scope picker) are already
present in spirit; this is hardening and surface-completion, not green-field.

## Decomposition proposal

```
                         /mcp gateway (resource cell)
                         aggregates describeTools, scope-filters, forwards
                                        │
                                        ▼
   ┌──────────────────────────────  rooms cell  ──────────────────────────────┐
   │  owns: rooms, entries {value,_meta}, actions, views, agents, audit trail  │
   │  surface: HTTP routes (/rooms/*) + MCP tools (sync_*) + React SPA         │
   │  uses:                                                                     │
   │    • Turso/libSQL  (relational store — primitive #1)                       │
   │    • CEL helper    (views/conditions/eval/validation — primitive #3)       │
   │    • condition-wait (blocking/SSE on CEL over state — primitive #2)        │
   │    • auth cell      (identity + room scope grammar — primitive #5)         │
   │    • event bus      (emit on write → wakes waiters; loose subscribers)     │
   └───────────────────────────────────────────────────────────────────────────┘
```

**The `rooms` cell** owns the entire `sync` data model and its agent-facing
tools. It is a `defineMcpService` so the `/mcp` gateway can aggregate its
`sync_*` tools (`sync_read_context`, `sync_invoke_action`, `sync_wait`,
`sync_register_action`, `sync_register_view`, `sync_send_message`,
`sync_eval_cel`, …) with no gateway change — exactly the property
[`dynamic-cells.md`](./dynamic-cells.md) relies on for new cells. Its tools are
also plain commands, so peers can invoke them via `serviceClient`. Auth,
identity, and scopes come from the `auth` cell (`rooms` lists `auth` in
`allow[]`); change notifications go to the bus with `source = rooms`.

**Tier-1 cell or promotable tier-2 cell?** Both are defensible, and the
two-tier model is exactly what lets us choose late:

- **Build it as a tier-2 dynamic cell first.** A dynamic cell is authored with
  the same `defineMcpService` runtime as a tier-1 cell, is isolated by Lambda +
  IAM, and its tools surface through `/mcp` automatically. We can iterate on the
  `sync` data model live, scoped to one owner, then **promote** it to tier-1 via
  `forge.promote` (a copy, not a rewrite) once it stabilises. This is the
  intended *private-and-dynamic → reviewed-and-universal* path.
- **The blocker** is that a dynamic cell gets only a DynamoDB table today
  (primitive #1's userland half is unbuilt) and there is no condition-wait
  primitive (#2) yet. So in practice: prototype the data model in a dynamic cell
  on DynamoDB, but **build `rooms` as a tier-1 cell for v1** to get `turso:true`
  and a sanctioned realtime primitive, and keep the dynamic path open for later
  generalisation.

**Out of scope for v1:**

- the userland half of primitive #1 (per-dynamic-cell Turso provisioning) — only
  needed once `rooms`-style cells are authored in tier 2;
- SSE push (bounded long-poll first);
- a sidecar `cel` cell (start with the runtime helper);
- room `replay` to an arbitrary `seq` and sparkline `samples` (temporal niceties,
  not core coordination) — land after read/invoke/wait work;
- `sync`'s legacy token prefixes and any val.town-specific compatibility.

## Phased path

1. **Auth-cell maturation (primitive #5).** Define the `rooms:<id>:…` scope
   grammar, add token CRUD endpoints, the stateless scope-elevation URL, and the
   explicit `min(token, role)` narrowing rule. No dependency on the others;
   unblocks everything.
2. **CEL helper (primitive #3).** A `platform/runtime/cel.ts` with
   registration-time validation and an injectable environment. Standalone,
   unit-testable in isolation. Depends on nothing.
3. **`rooms` cell, core slice.** Tier-1 `defineMcpService` with `turso:true`
   (primitive #1, tier-1 half — already available): the `{ value, _meta }` entry
   model, the audit trail, `read_context` (views via CEL), `invoke_action`
   (declared write capabilities, conflict/`contested` detection), agent
   lifecycle, and the `sync_*` MCP tools surfacing through `/mcp`. Depends on 1 +
   2.
4. **Salience shaping.** Focus / Peripheral / Elided tiers, thresholds, elision +
   expand, on top of the store and CEL. Depends on 3.
5. **Condition-wait (primitive #2).** Bounded long-poll `wait?condition=<CEL>`
   plus `/poll`, woken by bus events on writes. Depends on 2 (CEL) + 3 (state +
   emit). SSE is a fast-follow.
6. **Temporal + UI.** `history`, `samples`, salience map, `replay`; the React SPA
   on `platform/ui`. Depends on 3.
7. **(Later) Userland generalisation.** Per-dynamic-cell Turso provisioning in
   `forge` (primitive #1, tier-2 half), then re-home or re-author `rooms`-style
   cells as promotable tier-2 cells.

Dependency spine: **#5 and #3 are leaves**; the `rooms` core (3) needs both;
salience (4), realtime (5), and temporal/UI (6) hang off the core; userland Turso
(7) is independent and last.

## Open questions and risks

- **Blocking waits vs. Lambda economics.** A request-scoped, duration-billed
  runtime is a poor host for true blocking. Bounded long-poll caps cost and
  timeout exposure but pushes re-poll logic to clients and can miss edge-state
  between polls. SSE helps but does not remove the timeout ceiling. Is a
  separate, longer-lived wait mechanism (Step Functions wait state, a WebSocket
  API, DynamoDB Streams → push) warranted, or is bounded long-poll genuinely
  good enough for agent coordination? Decide before building primitive #2.
- **CEL sandbox safety and cost.** CEL being total/non-Turing-complete bounds the
  *control-flow* risk, but `top_n()` over large collections, deep expressions,
  and pathological inputs still cost CPU and memory. We need evaluation limits
  (depth, collection size, time budget) and a decision on helper-vs-sidecar
  isolation. Which CEL implementation (a maintained JS/TS CEL library vs. a port
  of `sync`'s own engine) — and does it run safely in the Lambda runtime?
- **SQLite tenancy: per-room vs per-cell.** `sync` is one SQLite database holding
  all rooms. On this platform, do all rooms share one Turso database inside the
  `rooms` cell (simple, but tenancy is enforced only in app logic), or does each
  room get its own database (stronger isolation, harder cross-room queries and
  more provisioning)? This interacts directly with primitive #1's userland half
  and with the scope grammar in primitive #5.
- **Provenance authority.** `_meta.writer` / `via` / `writers` must be derived
  from `auth`-validated identity, never client-supplied — the same discipline as
  the runtime ignoring forged `x-auth-*` headers
  ([`serverless-platform.md`](./serverless-platform.md)). Confirm every write
  path stamps provenance server-side from `ctx.identity`.
- **`/mcp` tool budget.** `sync` exposes 18 MCP tools; aggregated behind our
  single gateway alongside `forge`'s tools and others, the combined `tools/list`
  may grow large. Scope-filtering per caller (already how the gateway works)
  mitigates this, but confirm the surface stays legible to strict clients.
- **Auth overlap, not duplication.** `sync` ships a *complete* parallel auth
  stack. The whole point of mapping it here is to **reuse** the `auth` cell, not
  re-host `sync`'s. Confirm there is no requirement in `sync` that the `auth`
  cell cannot express (e.g. the device flow and DCR both already exist in
  `auth`), so primitive #5 stays "extend `auth`," never "fork it."
- **Tier choice timing.** If `rooms` ships as tier-1 for v1, when (if ever) do we
  generalise primitive #1 to userland so `sync`-style cells can be authored in
  tier 2? Premature generalisation costs `forge` complexity; deferring it forgoes
  the cheap-experimentation benefit of tier 2 for exactly the kind of cell that
  benefits most from it.
