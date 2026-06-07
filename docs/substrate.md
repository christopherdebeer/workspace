# The Substrate — what this platform is becoming

This is a foundations document. It is not a feature plan and not a port plan. It
records a **mental model** — drawn from a body of design work behind
[`workspace`](https://www.val.town/x/c15r/workspace) and
[`sync`](https://sync.parc.land) — and argues that this model belongs in the
platform's **core**, not in a cell bolted on beside the others.

It is grounded in the source documents, not a second-hand summary. The thesis and
its mechanics come from sync's own design corpus — read them directly:

- *The Substrate Thesis* (`docs/the-substrate-thesis.md`, `docs/SUBSTRATE.md`)
- *What Becomes True* (`docs/what-becomes-true.md`)
- *Σ-Calculus* (`docs/sigma-calculus.md`)
- *Adaptive Salience* (`docs/adaptive-salience.md`)
- *Agency and Identity* (`docs/agency-and-identity.md`)
- *The Self-Assembling Harness* (`docs/the-self-assembling-harness.md`)
- *Frontend Unification* (`docs/frontend-unify.md`)

It builds on this repo's [`dynamic-cells.md`](./dynamic-cells.md) and
[`serverless-platform.md`](./serverless-platform.md). The companion
[`sync-as-cells.md`](./sync-as-cells.md) is the detailed enabler catalogue; this
document is the *why*.

## The thesis (faithfully)

> **Software is a shared substrate of truth observed by self-activating
> components.** State is the substrate; *surfaces* observe it; *actions* are
> transitions with scoped authority; and agents and humans are equivalent
> participants, distinguished only by the modality of their observation.

Several consequences follow, and each one bears on this platform's foundations:

- **State is primary reality; the UI is a projection of it.** Not the other way
  round. Truth lives in the substrate; interfaces *perceive* it.
- **Facts over events.** "The projection is reality; the log is implementation."
  What is currently true matters; how it became true is an implementation detail
  (reversed CQRS).
- **The UI and the API converge.** "A button for a human and a JSON affordance
  for an agent are the same surface expressed through different modalities." This
  is the bridge between the platform's two tenets — *MCP-native* and *mobile-first
  composable UI* — not as two builds but as **two renderers of one declaration**.
- **Vocabulary is the protocol.** You do not mutate state directly; you *declare*
  an action (a write capability) or a view (a read capability), registered at
  runtime as data, and those declarations become the interface everyone speaks.
  "Vocabulary construction is the only unilateral act."
- **No orchestrator.** Components self-activate when their predicate over shared
  state holds (the blackboard model, 1986, meeting language models). Coordination
  is stigmergic — emerge, don't script. "You design conditions under which
  journeys can arise," not the journeys.
- **The boundary between using and building dissolves.** ctxl's "stupid loop":
  you need tools you can't build because building needs programming. A live,
  declarable substrate breaks it. *You are the component.*

## The minimal core (Σ-calculus)

`sigma-calculus.md` distils the model to five term forms and two reduction rules
— and that minimality is what makes it a *foundation* rather than a feature:

| Primitive | Meaning | Platform reading |
| --- | --- | --- |
| `fact(scope, key, value)` | a situated datum | a state entry, authority-scoped |
| `write(φ, scope, W)` | a **guarded write** — when predicate `φ` holds, apply writes within `scope` | an **action** (declared capability) |
| `observe(φ, scope, R)` | a **guarded observation**, side-effect-free | a **surface** — a UI element *or* an agent affordance |
| `e ∥ e` | parallel composition, order-independent | cells/components coexist without orchestration |
| `scope(s, e)` | an authority boundary | the unit of capability + isolation |

Two laws matter most here. **Monotonic writes commute** (accumulating facts needs
no coordination — the CALM result), and **non-monotonic writes need
serialization** — handled in bounded "**organs**" (localized state machines) that
emit monotonic facts back to the substrate.

This last point is the key bridge to what we already have:

> **A `forge` dynamic cell is an organ.** It is exactly the platform's "still CDK,
> but at runtime" execution unit: a bounded, isolated, serialized computation
> (Lambda + table + scoped role) surrounded by a looser substrate. We have built
> an excellent way to spin up *organs*. **What we have not built is the monotonic
> substrate they live in** — the shared state, the declared vocabulary, the
> self-activating surfaces. Today the platform is all organs and no reef.

## Where the platform stands against the model

| Substrate property | In the platform today | Gap |
| --- | --- | --- |
| Execution organs (isolated, scoped, serialized) | ✅ `forge` cells: Lambda + table + permission boundary | — |
| Authority / scope | ✅ `auth` cell: scoped bearer tokens, now with real refresh + revocation | scope *grammar* for resources; observe-vs-embody; scope elevation |
| Loose coupling | ✅ EventBridge bus (fire-and-forget) | no **observe** — no "tell me when φ holds" |
| Self-model | ◑ `forge` registry + `/_catalog` (static + caller's cells) | flat list, not salience-shaped or *tended* |
| State as substrate | ❌ each cell gets a private DynamoDB key/value table | no `{ value, _meta }`, no provenance, no facts-over-events |
| Declared vocabulary (actions/views as data) | ❌ capability = deployed *code* only | the reflexive step `forge` half-makes: declare, don't deploy |
| Surfaces (one declaration → MCP **and** UI) | ◑ `defineMcpService` (agent side); `platform/ui` (human side) | the two are separate; not dual projections of one surface |
| Salience / self-organization | ❌ | attention, evaporation, vocabulary health |
| Identity: users vs agents vs drivers | ◑ users + tokens | no agent-as-state, no observe/embody, no sessions-as-state |

The platform has the **organ** half of the model and the **authority** half. The
**substrate** half — observed state, declared vocabulary, self-activating
surfaces, salience — is the foundational work, and it is what makes the organs
worth having.

## What changes in the foundations

This redirects the core, not just the backlog:

1. **Reflexivity deepens.** `forge.createCell` makes *code* a runtime artifact.
   The substrate makes *vocabulary and state* runtime artifacts — declare an
   action/view, not just deploy a Lambda. This is the "declarative cells" already
   named as future work in `dynamic-cells.md`, and it is the self-assembling
   harness made real: the harness assembles itself through use, rather than being
   engineered in advance.

2. **Cell state grows up.** From a private key/value table to `{ value, _meta }`
   facts with server-stamped provenance (`writer`, `revision`, `seq`, …),
   supersede-not-delete, and reads shaped by salience. Provenance is derived from
   `auth`-validated identity, *never* client-supplied — the same discipline the
   runtime already applies to bearer identity.

3. **Surfaces unify MCP and UI.** One declared surface renders to an MCP tool
   *and* a `platform/ui` component (sync's `frontend-unify` shows the concrete
   mechanic: SSR + hydration, the server is the router). This is the real answer
   to "the home page has no UI for any of this" — the UI is the human projection
   of the same vocabulary the gateway exposes to agents.

4. **The self-model becomes alive.** The registry + `/_catalog` grow into
   salience-ranked, accreting, *tended* state — read first by both agents and the
   UI. `workspace`'s tending and sync's `_shaping` are the model.

5. **Identity gains structure.** Users (meta-entities / agent-factories) vs agents
   (room-internal, *manifested as state*) vs drivers (sessions). **Observe** (read
   without presence) vs **embody** (commit to presence). Scope as ceiling, tools
   as arbiter, with progressive scope elevation. The token-hardening already
   landed is the root of trust this builds on.

Nothing here discards `forge`, the `/mcp` gateway, the permission boundary, the
event bus, or the `auth` cell. The organs and the authority model stay. The
substrate is what they have been missing.

## `workspace` and `sync` are the proof cases, not the deliverables

They are the two honest tests of the model, and they should be ported **in the
model's terms** — as validations that the foundation is real — not relocated
verbatim as two more organs:

- **`workspace`** is the smallest test of *observed state*: entries + a trajectory
  `log` + salience computed from it + supersede + a scheduled *tend*. If the
  substrate's state primitive is right, `workspace` is nearly a config of it.
- **`sync`** is the fuller test of *declared vocabulary* and *dual projection*:
  rooms of `{ value, _meta }` state, actions/views as data, CEL predicates,
  condition-wait, observe/embody identity, and one surface rendered to both agents
  and humans.

If porting either one requires working *against* the platform's grain — re-hosting
sync's own auth, treating `{ value, _meta }` as cell-private trivia, scripting
coordination — that is the signal that the foundation is missing something, and
the fix belongs in the core.

## Sequencing: model before features

1. **Root of trust** — identity for long-lived agents *and* short human sessions,
   with real revocation. *(Done: refresh-lifetime decoupled + RFC 7009 —
   `services/auth`.)*
2. **The human projection** — a first-party signed-in UI, so the substrate is
   driven by people as well as agents (the UI half of surface duality).
   *(Done: the home SPA is a public OAuth/PKCE client — passkey sign-in, session
   bearer, transparent refresh, sign-out revoke — `services/home/client/auth.ts`.
   The "Your dynamic cells" card now loads from the signed-in session via the same
   `/_catalog` an agent reads.)*
3. **Observed state** — `{ value, _meta }` + provenance + salience as a reusable
   core shape, proven by the smallest case (`workspace`). *(In progress: the
   runtime semantics are built — `platform/runtime/state.ts`: wrapped entries,
   server-stamped provenance, supersede-not-delete, trajectory-driven salience,
   shaped reads, with an in-memory store. Next: a DynamoDB-backed `StateStore`
   and wiring it into a cell.)*
4. **Declared vocabulary + surfaces** — actions/views as runtime data, CEL
   predicates, one surface → MCP + UI; and the living, tended self-model. Proven
   by `sync`.
5. **Coordination** — observe/`wait`-on-predicate (the missing realtime
   primitive), observe/embody identity, scope elevation.

The enablers each step needs (relational persistence reachable by cells, a
condition-wait primitive, a sandboxed CEL capability, the rooms substrate, auth
scope-grammar maturity) are catalogued in [`sync-as-cells.md`](./sync-as-cells.md)
— as *means to these properties*, not as the goal.

## Open questions

- **Runtime primitive vs cell.** Does `{ value, _meta }` + salience live in
  `platform/runtime` (every cell inherits the substrate — the foundational
  reading) or in a `state`/`rooms` cell others build on (easier to iterate)?
  Decide deliberately; the thesis points at the former.
- **What is the single surface declaration** that yields both an MCP tool and a
  `platform/ui` component? Define it against `platform/ui` before building cells
  that assume it (sync's view + render-hint is one answer).
- **Organs vs reef.** Which work is a serialized `forge` organ and which is
  monotonic substrate? The Σ-calculus draws the line at non-monotonicity; we need
  our own discipline for it.
- **Salience cost.** Trajectory-driven scoring is read/write-amplifying; bound it
  (sampling, async recompute) before it sits under every read. And — the open
  problem sync itself flags — can the self-model develop an *opinion* about the
  quality of its own accreting vocabulary, rather than just accumulating?
- **Does the living self-model unify with the registry?** They may be the same
  thing seen twice; converging them is attractive but couples cells.
</content>
