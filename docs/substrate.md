# The Substrate — what this platform is becoming

This is a foundations document. It is not a feature plan and not a port plan. It
names the **mental model** the platform should be built around, drawn from two
systems that already embody it — [`workspace`](https://www.val.town/x/c15r/workspace)
("self-organizing accretive workspace with salience") and
[`sync`](https://sync.parc.land) ("coordination substrate for multi-agent
systems") — and it argues that this model belongs in the platform's **core**, not
in a cell bolted on beside the others.

It builds on [`dynamic-cells.md`](./dynamic-cells.md) (the two-tier reflexive
model: `forge`, dynamic cells, the `/mcp` gateway, the permission boundary) and
[`serverless-platform.md`](./serverless-platform.md) (`defineService` /
`defineMcpService`, `HttpServiceCell`, the event bus, the `auth` cell). The
companion [`sync-as-cells.md`](./sync-as-cells.md) does the detailed
primitive-extraction; this document says *why*, and what it changes about the
foundations.

## The thesis

The platform so far is a **reflexive deployment platform**: `forge` lets an agent
create an isolated cell (a Lambda + table + role) at runtime and call it over the
same MCP connection. That is the right substrate for *running* code. But
`workspace` and `sync` show what that substrate is *for* — and it is more than
"run code on demand."

> **The platform is a living substrate where capability and knowledge accrete at
> runtime, carry their own provenance and salience, are addressed through a
> declared vocabulary rather than mutated directly, and are projected equally to
> agents (MCP) and to people (UI) from one declaration.**

`workspace` and `sync` are not two apps to host. They are the same idea seen from
two angles, and that idea is foundational.

## The model, distilled

Four properties recur across both systems. Each is a statement about the
*substrate*, not about any one app.

### 1. State carries provenance and salience — it is observed, not just stored

In `sync` every entry is wrapped: `{ value, _meta }`, where `_meta` is
`{ revision, updated_at, writer, via, seq, score, velocity, writers, first_at,
elided }`. In `workspace`, salience is **computed from the trajectory** — a `log`
of every read and write — and nothing is deleted; entries are *superseded*.

The substrate observes its own use. Reads are *shaped* by salience: high-score
data comes back in full, low-score data is elided to a hint. State is not an inert
key→value bag; it is a self-describing, ranked, accreting record of what has
mattered.

### 2. Capability is declared vocabulary, not direct mutation

`sync`'s core rule: *"two operations — read context, invoke actions. No direct
state writes. The declaration is the commitment. The vocabulary is the
protocol."* You do not set state; you **declare** an action (a write capability)
or a view (a read capability), and those declarations — registered at runtime, as
data — become the interface everyone speaks.

This is the same reflexive instinct as `forge`, one level up. `forge` makes *code*
a runtime artifact; this makes *vocabulary and state* runtime artifacts. It is
the "declarative cells" already gestured at in
[`dynamic-cells.md`](./dynamic-cells.md) as future work — and it is the natural
completion of the platform's reflexivity.

### 3. One declaration, two projections: MCP and UI are duals

The platform's tenets already ask for both **MCP-native** and **mobile-first,
composable UI**. `sync` shows they are the same surface: a declared *view* carries
render hints and becomes a dashboard; a declared *action* becomes both an MCP tool
(`sync_invoke_action`) and a UI control. Agents and humans act on the *same*
vocabulary through different renderers.

This is the answer to "the home page has no real UI for any of this": the UI is
not a separate build, it is the **human projection of the same declared
vocabulary** the gateway already exposes to agents. `platform/ui` and
`defineMcpService` should be two renderers of one model.

### 4. The system self-organizes and self-describes

`workspace` *tends* itself on a schedule: surfacing what is stale, what is
salient, what should be reviewed. `sync` ships a `_shaping` summary describing how
it shaped every response. The self-model is alive — ranked, accreting,
maintained — and it is the first thing both an agent and a person read.

The platform already has the seed of this: the registry (`forge`'s self-model) and
`/_catalog` (now merging static + the caller's dynamic cells). The substrate model
says that self-model should grow up into wrapped, salience-shaped, tended state —
the catalog as a living map, not a flat list.

## What this changes about the foundations

The point of naming the model is that it redirects the *core*, not just the
backlog. Concretely:

| Foundation today | Under the substrate model |
| --- | --- |
| Reflexivity = create a **cell (code)** at runtime (`forge.createCell`) | Reflexivity also = register **vocabulary + state** at runtime (declarative cells; actions/views as data) |
| Cell state = a per-cell DynamoDB key/value table | A **state model with provenance + salience** (`{ value, _meta }`, trajectory-ranked, supersede-not-delete) available to cells and to the platform's own self-model |
| Self-model = the registry + a flat `/_catalog` list | A **living self-model**: wrapped, salience-shaped, *tended* — read by agents and the UI alike |
| Two tenets (MCP-native; composable UI) met separately | **Dual projection**: one declared vocabulary renders to both an MCP tool surface and a UI surface |
| Identity = scoped bearer tokens (now with real refresh + revocation) | Same root of trust, extended with a **resource scope grammar** and **scope elevation** so capability can be requested in-flow (already half-present; see token work below) |

None of this discards what exists. `forge`, the `/mcp` gateway, the permission
boundary, the event bus, the `auth` cell — all stay. The substrate model says
*what to build on top of the runtime's core*, and it reorders priorities so the
**model leads and the apps validate it**, rather than the apps arriving as
features and the model being inferred later.

## Why `workspace` and `sync` are the proof cases, not the deliverables

They are the two honest tests of the model:

- **`workspace`** exercises properties 1 and 4 (provenance/salience, accretion,
  tending) with the least surface — ~6 files, two tables, a scheduled tend. It is
  the smallest thing that proves "state that observes itself."
- **`sync`** exercises properties 2 and 3 (vocabulary-as-protocol, dual
  projection) plus multi-tenant coordination. It is the fuller expression.

So they should be **ported as validations of the foundation**, in the model's
terms — not relocated verbatim as two more cells. If porting either one requires
working *against* the platform's grain (re-hosting `sync`'s own auth stack,
treating wrapped state as app-private trivia), that is a signal the foundation is
missing something, and the fix belongs in the core.

## The enablers (in service of the model)

The detailed mechanics — relational/SQLite persistence reachable by cells, a
condition-wait/realtime primitive, a sandboxed CEL evaluation capability,
multi-tenant shared state, and `auth`-cell token maturity — are catalogued in
[`sync-as-cells.md`](./sync-as-cells.md). Read them as **enablers of the four
properties**, not as the goal:

- relational persistence + the `{ value, _meta }` model → property 1 (observed
  state);
- a vocabulary registry (actions/views as data) + CEL for views/conditions →
  property 2 (declared capability);
- view render hints + `platform/ui` → property 3 (dual projection);
- salience computation + scheduled tending + a living catalog → property 4
  (self-organization);
- token scope grammar + scope elevation (root of trust) underpins all four.

## Sequencing: model before features

The implication for order of work:

1. **Root of trust first** — identity that supports long-lived agent connections
   *and* short human sessions, with real revocation. *(Done: refresh-token
   lifetime decoupled, RFC 7009 revocation — `services/auth`.)*
2. **The human projection** — a first-party signed-in UI, so the substrate is
   driven by people as well as agents (property 3's UI half). This is the next
   concrete step and it is foundational, not cosmetic.
3. **The state model** — `{ value, _meta }` with provenance + salience as a
   reusable shape (property 1), proven first by the smallest case (`workspace`).
4. **Declared vocabulary** — actions/views as runtime data + CEL (property 2),
   and the living, tended self-model (property 4), proven by `sync`.

Each step is judged by whether it makes the *model* real, with `workspace` and
`sync` as the cases that keep it honest.

## Open questions

- **How much of the state model belongs in the runtime vs. a cell?** `{ value,
  _meta }` + salience could be a `platform/runtime` primitive every cell inherits,
  or a `state` cell others build on. The former makes it foundational (the intent
  here); the latter is easier to iterate. Decide deliberately.
- **Dual projection mechanics.** What is the single declaration that yields both
  an MCP tool and a UI surface? `sync`'s view+render-hint is one answer; we should
  define ours against `platform/ui` before building cells that assume it.
- **Salience cost.** Trajectory-driven scoring is read/write-amplifying; bound it
  (sampling, async recompute) before it sits under every read.
- **Does the self-model unify with the registry?** The living catalog and
  `forge`'s registry may be the same thing seen twice; converging them is
  attractive but couples two cells — weigh it.
</content>
