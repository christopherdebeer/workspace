# `@c15r/machine` — design & architecture

> **Canonical, standalone design doc.** Supersedes and folds in the four earlier
> machine docs (`machine-cell.md`, `machine-agent-scopes.md`,
> `machine-dygram-contrast.md`, `machine-workflow-parallels.md`). Grounded in a
> fine-toothed read of the platform ADRs (`docs/architecture/adr/0001`–`0016`) and
> of the live cell (`cells/machine/{engine.ts,index.ts,client/app.tsx,types.json}`).
>
> `@c15r/machine` is a tier-2 cell (`cells/machine/`, git-truth, synced via
> `node scripts/cell-sync.mjs push machine --deploy`) that folds the ideas of
> **DyGram** (`christopherdebeer/machine`, deployed at `dygram.parc.land`) into the
> substrate: a *machine* is a named graph of typed nodes and typed transition
> *rails* an agent rides — deterministic rails advance instantly with no LLM; the
> model is invoked only where a genuine decision or unit of work exists.

---

## 0. TL;DR

- A **machine** is a fact (`machine/<name>`) holding nodes + arrows + **rails** (the executable transitions).
- `define_machine` **projects** the rails into substrate vocabulary: declared **actions** (`_actions/machine.<m>.*`) and reaction **subscriptions** (`_subscriptions/machine.<m>.*`). There is **no bespoke runtime** — the substrate interprets.
- A **run** is a fact (`machine-run/<run>`); its revision history is the trajectory. Execution *is* advancing that fact, by reactions firing the projected actions / delivering to model cells.
- Reasoning is spent only at **agent**/**work** rails; deterministic prefixes self-advance.
- Six rail modes: `auto` · `agent` · `task` · `work` · `section` · `vote`.
- The cell is split **functional-core / imperative-shell**: `engine.ts` is pure and unit-tested; `index.ts` is the thin I/O shell (HTTP routing + organ-path writes + SSR).

## 1. Thesis — machine introduces *no new primitive*

The platform ADRs establish a **closed, settled** primitive set (ADR-0014, "naming
is closed; future change is feature work on a settled substrate"):

- three nouns — **Fact** (ADR-0013), **Reference** (ADR-0003), **Declaration** (ADR-0001);
- two orthogonal axes — **Grant** (ADR-0007), **Cell** (ADR-0008);
- read primitives — **Resolution** (ADR-0010) + **Projection** [select/score/shape/present] (ADR-0004/0006/0012).

ADR-0015 (frames) and ADR-0016 (edges-first-class) are the template: a *feature*
that adds a capability **without minting a primitive**. **Machine is exactly that.**
Every machine concept is an application of a named primitive:

| Machine concept | Substrate primitive | ADR |
|---|---|---|
| `machine` / `machine-node` / `rail` / `machine-run` / `meta-tool` types | **Declarations** — a Type with facets (shape / present / handlers) | 0001, 0002 |
| rails → `_actions` / `_subscriptions` / `_views` | **Declaration registry** (register · list · resolve · remove) | 0001 |
| reactive advance; `invoke` (in-slice action) vs `deliver` (cell tool as owner) | **Reactivity** — a Subscription is a Collection over the change stream | 0011 |
| run / claim / finding facts | **Fact** — monotonic, supersede-not-delete, trajectory | 0013 |
| arrows; claim `support[]` | **Reference** — embedded refs | 0003 |
| open / render / `_renderers/machine` | **Present** + **Resolution** (per-facet, slice-wins) | 0012, 0010 |
| agent tool-scope (`tools` / `scope`) | **Grant axis** (scope → grant → partition) | 0007 |
| cell publish + deliver-as-owner + `ssr.json` | **Cell axis** (`describeTypes`, `ssrReads` / `callerWrites`) | 0008 |

The practical consequence: the design *references* the platform's decisions rather
than re-deriving them, and several long-standing machine "gaps" turn out to be
**already-tracked ADR items** (see §13).

## 2. Provenance — DyGram folded into the substrate

DyGram is, in its author's framing, *"the substrate thesis applied to programming
language design."* Folding it in means expressing a DyGram machine in the
substrate's own nouns and letting salience, provenance, links, and tending apply to
it for free. The mapping:

| DyGram | substrate-native form |
| --- | --- |
| **machine** (a named graph) | a fact of type `machine` |
| **node** (5 canonical kinds — task/state/context/init/tool; authoring aliases normalize to context) | a fact of type `machine-node`, `kind` in the value |
| **arrows** (relationship/rendering) | substrate **edge `rel`s** (see ARROW_RELS below) |
| **deterministic rail** (instant, no LLM) | a **declared action** (`if`/`writes[]`; fires with no model call) |
| **agent-decision rail** | invoke `@c15r/models.decide` at exactly that node — the only place tokens are spent |
| **meta-programming** (construct a tool mid-run) | a **`meta-tool` fact** (vocabulary-as-data) |
| **effects-as-data** (`step → {nextState, effects[]}`) | the run fact's `put`/revision duality + the trajectory |
| **checkpoints** | `supersede`-not-delete + revisions (ADR-0013) |

### 2.1 Honest corrections (DyGram source vs our model)

A code-grounded read of DyGram corrected three claims that drifted in early docs.
These are **deliberate substrate-only design choices**, not ports:

- **`~>` and `~>>` are NOT DyGram arrows.** They are our own rail syntax for task/work rails. DyGram has no `~`-arrows.
- **`=>` is "strong causation" *styling* in DyGram, not an agent marker.** DyGram infers auto-vs-agent dynamically from node-type / out-degree / annotations — *not* from the arrow symbol. Our explicit arrow→rail-mode mapping is our simplification.
- **DyGram has 5 canonical node kinds**, not "15+"; the rest are authoring aliases. And in DyGram the node *kind drives execution*; in ours `kind` is currently cosmetic (the rail `mode` carries behavior).

The arrow→`rel` table (`ARROW_RELS`, faithful to DyGram's *relationship* semantics):
`->` flows-to · `-->` depends-on · `=>` causes · `<|--` inherits · `*-->` composes · `o-->` aggregates · `<-->` relates.

### 2.2 Scorecard — where the substrate fold improves on / drops DyGram

DyGram is a deep **single-run interpreter for a real DSL** (Langium grammar, LSP,
Zod type system, graph validators, a pure `step` runtime an in-browser agent
drives). `@c15r/machine` is a **declarative projection into the substrate**.

- **We improve:** durable event-sourced runs (fact + revisions) vs ephemeral memory; decisions as auditable `claim` facts with confidence; two multi-actor modes (driving-agent-*uses*-machine via `task`/claim, machine-*spawns*-agent via `work`); meta-tools as vocabulary-as-data (no unsandboxed eval); full substrate composition (salience, links, tending, triggers, cross-machine reuse).
- **We dropped (candidate backlog):** no DSL/type-system (we ported only the structural validators — see §11); no multi-path concurrency *within* a single token beyond section/vote; no loop/step/timeout guard (§13); no editor/LSP.

## 3. Vocabulary

### 3.1 Rail modes (the executable transitions)

| mode | arrow default | semantics |
|---|---|---|
| `auto` | `->` | deterministic transition; advances with **no LLM** (a guarded declared action). |
| `agent` | `=>` | a decision: deliver to `@owner/models.decide`, which picks a branch and records a **claim** + advances. |
| `task` | `~>` | parks a **claimable hand-off** for a *driving* agent (the agent-*uses*-machine path). |
| `work` | `~>>` | **spawns** `@owner/models.agent` (the machine-*uses*-agent path): it does the work with scoped grants + a tool allowlist and advances the run itself. |
| `section` | — | **fan-out** N independent branches → synthesize (parallelization "sectioning"). |
| `vote` | — | sample one branch N× → consensus tally (parallelization "voting"). |

Rails carry optional facets: `when` (a Level-1 disclosure descriptor), `condition`
(CEL), `prompt`/`grants`/`tools`/`scope`/`maxTurns` (work-agent brief), and for
parallel: `sections` (`[{to, when?}]`), `branch`, `samples`, `synthesis`.

> **NB (ownership of the mapping):** making rail mode explicit *data* — and the
> arrow→mode default — is our substrate-only design choice (§2.1), not a DyGram port.

### 3.2 Types (published via `types.json` → `describeTypes` → `$types`)

`machine`, `machine-node`, `rail`, `machine-run`, `meta-tool` — each a Type
Declaration (ADR-0002) with icon, `value.*` label, render hint, and `manager:
@c15r/machine`. Handlers (ADR-0012 Present): `machine` → `open: /#/m/${match}`,
`render: _renderers/machine`; `machine-run` → `open: /#/r/${match}`.

## 4. The pure core (functional core / imperative shell)

`cells/machine/engine.ts` is **pure**: no AWS, no I/O, no `emit`, no React, no env.
It is the single, unit-tested source of truth (`tests/machine-engine.test.ts`).
`index.ts` is the **thin shell**: HTTP routing (`GET /_tools`, `POST /_tools/<name>`,
the SSR routes), organ-path writes (`emit` → `substrate.write.requested`), and SSR.

Engine exports: `ARROW_RELS`, `seg`, `railsFrom`, `voteCount`, `validateMachine`,
`projectActions`, `projectSubscriptions`, `spawnChildrenWrites`.

**Why a pure projector/reducer and not an in-memory interpreter** (e.g. XState, like
canvas' gesture machine): a run's state lives in substrate **facts** and advances
via independent, *stateless* Lambda reactions (ADR-0011) — there is no durable host
to hold an interpreter between events. Two hard constraints shape the design:

1. **A cell cannot read the substrate** (reads belong to the gateway/caller).
2. **A cell cannot call other cells.**

So model invocation must stay a `deliver` subscription (the platform reactor calls
the model cell *as the slice owner*), and the sibling-aggregating join barrier must
stay **agentic** (only an agent can query the children). The engine therefore
*projects* the substrate vocabulary and computes the deterministic writes the cell
itself emits; it does not interpret in-process. This mirrors DyGram's own
functional-core/imperative-shell split, fitted to a distributed substrate.

## 5. Projection & execution

`define_machine({ name, title?, source?, nodes[], arrows[], rails?, project?,
reactive?, trigger?, context?, tags? })` writes `machine/<name>` and (unless
`project:false`) projects vocabulary. Rails derive from arrows (`railsFrom`) unless
given explicitly. The response includes `validation` (§11).

### 5.1 Declared actions (`projectActions`) — Declarations, ADR-0001

Over a `machine-run/${params.run}` fact:

- **`machine.<m>.start`** — seed a run at the entry node (the node with no incoming rail), `ifAbsent`. Carries an optional **`text`** trigger-context body, stored on the run for the entry agent.
- **`machine.<m>.<from>-to-<to>`** — one per `auto` rail: advance when the run is at `from` (guarded by `if: node == from`), writing `done` if `to` is terminal else `running`.
- **`machine.<m>.decide-<from>`** — one per `agent`/`task` node: record the chosen branch as a **claim** (`{statement, confidence, chose}`) *and* advance. The branch menu in the description carries each branch's `when` (progressive disclosure, §8).

Execution **is** invoking these (`workspace.invoke`); each advances the run fact,
whose revision history is the trajectory (effects-as-data; checkpoints = supersede +
revisions, ADR-0013).

### 5.2 Reactivity (`projectSubscriptions`) — ADR-0011

A Subscription is `{ match, invoke|deliver, params }`. The reactor tests `match`
(type / keyPrefix / CEL) against each `fact.written`, then either `invoke`s an
in-slice action or `deliver`s to a cell tool *as the slice owner* (`cells.callCellTool`).
Reaction-writes re-emit `fact.written`, **bounded by a depth cap** keyed on the
triggering fact's revision (`maxDepth`, default 50). `reactive:true` registers:

- **auto rail** → `invoke` its transition action (the `if` guard fires only the rail whose `from` = the run's node, so the deterministic prefix self-advances).
- **agent/task node** → `deliver` to `@owner/models.decide` (or, deferred, park a claimable `task`). *Reasoning spent only here.*
- **work node** → `deliver` to `@owner/models.agent` with the rail's brief + scoped `grants` + `tools` allowlist; the agent does the work and advances the run.
- **internal trigger** (always, when projecting) → writing `machine-trigger/<name>/<run>` invokes `start` (§7).
- optional **fact-pattern trigger** → a `{type?, keyPrefix?, cel?}` pattern that starts a run (`runId` templates the run id).

> ADR-0011 names `@c15r/machine` auto-rails as its motivating example ("reactions
> fire declared Actions, so the whole reactive layer stays inspectable"). The
> `invoke`-vs-`deliver` split and the depth cap are the platform's, not ours.

### 5.3 Claims as the certificate of reasoning — ADR-0003

A decision/synthesis writes a `claim` (`{statement, confidence, support?[]}`). Per
ADR-0003, `claim.support` is an **embedded ref** (`claim —supports→ evidence`) that
the Reference projection recovers into `$graph`/`neighbors`/centrality (weighted
~0.6, ADR-0009). So *why* a machine went one way is inspectable substrate, not a
hidden chain of thought.

## 6. Parallel branching (section + vote)

Maps Anthropic's two parallelization variants (and the "harness" post's
"fan-out-and-synthesize" / "adversarial verification", §10) onto two rail modes.

- **Fan-out is a `deliver` to `spawn_children`** (a cell tool), which emits the parent's wait-state (`sectioning`/`voting`) **and one child run per branch as its OWN organ write**. Child keys encode the parent: `<parent>§<branch>` (section) / `<parent>#<i>` (vote).
- **Children are normal sub-runs** driven by the machine's own rails (a section branch is a `work` node; a vote sample is the `branch` decision node), so they appear in the runs list and the diagram.
- **The join is an agentic, eventually-consistent barrier:** each child completion re-invokes a synthesis/tally agent on the parent; it re-reads the full child set and advances the parent only once **all** are done (idempotent). An optional rail `synthesis` instruction tells the join agent how to combine the branch findings (e.g. "read `census/<parent>§*` and combine the counts").

### 6.1 Why a cell tool, not a declared action (the reliability rationale)

The first cut projected the fan as a declared action whose `writes[]` were the
parent + N children. **A single declared action's multi-write, when fired by a
reaction, does not reliably emit its secondary writes** — so children spawned
flakily and never re-triggered their `work`/`decide` `deliver`. A *directly-written*
or *single-write-reaction* fact does drive `deliver` (tending's `decide` proves the
latter). Routing the spawn through a cell tool that emits **one organ write per
child** restores the reliable path. This is a concrete instance of ADR-0011's open
item: *"at-least-once vs exactly-once delivery semantics under the depth cap"* (§13).

### 6.2 The barrier matches by KEY, not value

A child's `work`/`decide` advance **overwrites its run-fact value** (dropping
`kind`/`parent`). The join match therefore keys off the stable key separator —
`key.contains("§")` / `key.contains("#")` — not a value field. The synthesis agent
derives the parent id from the child id (everything before the separator). The UI
groups runs the same way (§12.3).

### 6.3 Validated behavior

Section fans validated end-to-end (real work agents, real synthesis combining
findings, and — critically — the barrier **correctly waits** on partial completion,
refusing to falsely advance at 2/3). Vote validated: spawn + projection + the tally
barrier produce a real consensus (e.g. *"2-1 No"*). **Open finding:**
`@c15r/models.decide` did not auto-complete *concurrent* vote-child decisions (the
decide *action* + barrier are correct — manual `decide` + the tally completed
end-to-end); a models-cell concurrency issue, not a join bug (§13).

## 7. External trigger & scheduled routines

`trigger_run({ machine, run?, text? })` is the canonical "scheduled routine / API
trigger" entry — it writes `machine-trigger/<machine>/<run>`; the machine's standing
**internal-trigger subscription** starts the run at its entry, injecting `text` as
run context. Registered even on non-reactive machines, so every projected machine is
externally fireable by writing one fact.

This mirrors **Claude Code Routines'** API trigger (an authenticated HTTPS endpoint +
bearer token + a `text` body) — the proven shape for pointing a scheduled routine at
a machine, with **durable, server-side** runs (the anti-pattern is Cowork's "only
runs while the app is open"). The remaining generalization — a *public,
token-bearer* HTTPS endpoint for principals without substrate creds — needs a
platform change (public POST + token validation) and is deferred. ⚠️ Design caveat
(from live Claude Code bugs): bind a work rail's tool set **deterministically at
spawn**, never lazily — our `tools` allowlist already does this.

## 8. Progressive disclosure — from Agent Skills

Skills load in three tiers; we mirror this for rails so an agent's context stays
small as a machine grows:

- **Level 1 (always):** an agent rail sees only branch *descriptors* — `{to, mode, when}`. Rails carry a one-line `when`, surfaced in the `decide-<from>` action's branch menu.
- **Level 2 (on entry):** a node's full body/prompt loads only when entered (the work/decide delivery carries it).
- **Level 3 (on demand):** `auto` rails / tools execute and return only their *output*.

The Level-1 menu **is the machine fact**: a driving agent reads `machine/<m>` and
sees rails carrying `when`, and the projected `decide-<from>` action descriptions
list the branch menu. (The standalone `disclose` tool was pruned as redundant with
reading the fact — see §16.)

## 9. Agent tool-scopes

A `work`/agent rail declares a **tool allowlist + scope** — *"granular scopes
specific to the tools the machine allows"*:

```jsonc
{ "from": "Tend", "to": "Done", "mode": "work",
  "tools": ["workspace.query","workspace.peek","workspace.neighbors","workspace.supersede","workspace.link"],
  "scope": { "read": true, "write": ["tending/","machine-run/","agent/"] },
  "prompt": "…", "maxTurns": 12 }
```

`tools` is a subset of `read("$catalog")`; `scope` bounds *which facts* those tools
may touch. This generalizes the point-solution (`substrate_supersede` hard-coded in
`models.agent`) onto the platform's **Grant axis** (ADR-0007: scope → grant →
partition) via `auth.mintToken`, which narrows to `intersect(requested, ceiling)` —
*narrow-only, never widen*.

**Two execution paths, one declaration** (differ only in who holds the token):

| | driving agent *uses* a machine | machine *spawns* an agent |
|---|---|---|
| token holder | the driving agent (already has one) | a server-side cell (no user token) |
| status | **works today** — narrow-only minting is exactly this | blocked on **grants-to-principals** |

- **Increment 1 (done):** `tools`/`scope` on the rail; `models.agent` filters its toolbox to the allowlist.
- **Increment 2 (done) — `protocol/machine-drive`:** a driving agent iterates a machine with existing primitives (`peek machine-run/<run>` + `peek machine/<m>` + `invoke` the projected actions, whose `if` guards make them safe/idempotent). The protocol fact is what a scheduled routine is pointed at.
- **Increment 3 (future):** grants-to-principals so a cell can mint a scoped token for the agent it spawns; the bespoke `substrate_*` tools retire in favor of the real `workspace.*` vocabulary. (Ties to ADR-0007's noted scope-granularity gap.)

## 10. Anthropic agentic-workflow parallels

Our rail modes are a **typed, auditable encoding** of Anthropic's spectrum from
"predefined code paths" (workflows) to "the model directs itself" (agents):

| Anthropic pattern | rail mode |
|---|---|
| Workflow / predefined path | `auto` |
| **Routing** (classify → 1 of N branches) | `agent` (and we record the choice as a confidence-bearing claim — Anthropic's routing is ephemeral) |
| Orchestrator–workers | `work` whose agent spawns nested rails |
| Evaluator–optimizer | `work → agent(evaluate) → loop-back` |
| Parallelization (sectioning / voting) | `section` / `vote` |
| Fully autonomous agent | `work` |
| MCP tools / resources / prompts (model/app/user-controlled) | `work`-agent tools / `auto` reads / a machine itself |
| (no analog) | **`task`** — parked claimable hand-off for a *different* driving agent |

**Discipline the reference imposes:** a substrate makes agent/work rails *cheap*, so
we enforce by convention what Anthropic enforces by friction — **default a rail to
`auto`; promote to `agent` only at a real decision; promote to `work` only when
subtasks can't be predetermined.** (Same medicine as the tending diagnosis: don't
spend reasoning where there's no choice.)

## 11. Validation

`define_machine({ …, dryRun: true })` returns pure static analysis + a projection
preview without writing (the DyGram
graph validators we otherwise skip), run automatically inside `define_machine`:

- **errors:** `dangling-rail` (a rail endpoint with no node), `no-entry` (every node has an incoming rail → a run can't start).
- **warnings:** `unreachable`, `orphan`, `cycle` (a reactive machine could loop — §13), `no-terminal`.
- section/vote **spawn** their branch targets, so those implied edges are followed for reachability (no false `unreachable`).

## 12. Rendering & UI

### 12.1 Native-fact rendering — ADR-0012 Present

`_renderers/machine` (seeded by `bootstrap`) is a canvas ElementView that adapts a
machine's `{nodes, arrows}` → mermaid and draws it inline; it is the backing fact of
the type's `present.render.renderer` facet (ADR-0002). Type handlers (`open:
/#/m/${match}`, etc.) let any surface deep-link a machine/run into the cell SPA via
the kernel's `cellUrl`.

### 12.2 The SSR React SPA

An isomorphic SPA (`cells/machine/client/`) following the home/canvas/lit pattern:
SSR via `renderToString` seeded from `ssr.json` reads, hydrated client-side; the
kernel reached only through `./bridge` (kernel-free server bundle). Renders unauthed
with a sign-in affordance (the cell subdomain is a separate origin). Views:
**ListView** (machines + recent runs), **MachineView** (mermaid **diagram with a
run-position overlay**, rails with `when`/mode badges, nodes, runs, a Trigger
button), **RunView** (run-position diagram, parallel-branches panel, the claims
trajectory, the agent transcript).

### 12.3 Unified runs

A parallel run is shown as **one unified row**, not disjoint child rows: runs are
grouped by **key** (`parentId` splits on `§`/`#`) into parent + branch chips (each a
node + status dot). Key-based on purpose — a child's advance overwrites its value
(dropping `parent`), but the key suffix is stable (§6.2). RunView shows a "Parallel
branches" panel, a "part of run ‹parent›" link for a child, and marks branch nodes
on the diagram.

## 13. Known gaps & open decisions (ADR-cross-referenced)

| Gap | Status | Tracked by |
|---|---|---|
| **Arrows → substrate edges.** A machine's `value.arrows` are stored with their `rel` but not projected to authored edges, so `neighbors`/`links` don't walk a machine. | open | **ADR-0003 migration step 4** — recommends `define_machine` projects arrows → authored `link` edges at write time ("the machine graph *should* be authored"). Follow the ADR. |
| **Delivery reliability under reactions.** The `spawn_children` multi-write fix and the `models.decide` concurrent-vote-child finding are instances of at-least-once/ordering behavior under the depth cap. | resolved for determinism (`reactive:"step"`); legacy path unchanged | **ADR-0018** — `step` advances the `auto` prefix in-process with **no per-hop fact-write** and the kernel client's `emit` checks `FailedEntryCount` (no silent drop). Reliability worry remains only at genuine (model-paced) yields; ADR-0011 open item stands for those. |
| **`models.decide` concurrency.** Concurrent vote-child decisions don't auto-complete (decide action + barrier are correct). | resolved (`reactive:"step"`) | **ADR-0018** — `barrierAdvance` is the **deterministic** join: the cell reads the children and advances the parent itself, retiring the `models.decide` completion dependency. Synthesis *content* may still use a model (a work/agent rail at the join node). |
| **No loop/step/timeout guard.** A cyclic reactive machine can thrash; a stuck branch parks a run forever. | partial (`dryRun` `cycle` warning; `step()` reports `kind:'cycle'`/`'blocked'` rather than spinning + emits idempotently so a parked run doesn't re-trigger; the reactor's revision depth cap) | **ADR-0018** (`step` halts on a guardless auto-loop and on a deterministic stall). A per-run wall-clock/step-count timeout is still unbuilt. |
| **Cell-side substrate reads.** The machine cell was built write-only; the agentic join barrier existed only because it could not read its own children. | **resolved** | **ADR-0017** — the shared kernel substrate client (`/@c15r/kernel/substrate.js`); `@c15r/models` already read this way. The machine `step` tool now reads its def + run + siblings directly. |
| **Shared client is vendored, not a published package.** Each consuming cell keeps a hand-synced copy of the canonical `cells/kernel/static/substrate.js` (a server-side `https://` import hangs the forge bundler, so URL-sharing is out). | bridge | **ADR-0017** packaging — publish `@c15r/substrate` to npm and import by bare specifier (esm.sh, version-pinned) to make it one source again. |
| **`reactive:"step"` not yet exercised live; the legacy per-auto-rail projection remains the default.** The new single-step subscription + idempotent emit are unit-tested but unproven end-to-end under burst. | new, opt-in | this doc §16 (v5.3). Flip a machine to `reactive:"step"` and exercise; then make it the default and remove the legacy projection. |
| **Agent token narrowing.** `tools`/`scope` declared (Increment 1) but not yet enforced via a minted scoped token on the spawn path. | partial | **ADR-0007** (Grant axis) + its scope-granularity gap; machine §9 Increment 3 (grants-to-principals). |
| **`kind` is cosmetic.** Unlike DyGram, node `kind` drives nothing; the rail `mode` carries behavior. | by design | §2.1 — adopt DyGram's kind-inference if we want it meaningful. |
| **No DSL / type system.** Only the structural validators were ported. | by design | §2.2 — a `dygram` parser/LSP is out of scope. |

## 14. Seeding discipline (cell-required vs organic)

Two categorically different kinds of fact, kept apart:

- **Cell-required facts** — the cell's own infrastructure: its **types** (`types.json` → `$types`), **renderers** (`_renderers/machine`), **views** (`_views/machine-runs`, `_views/open-tasks`), and generic vocabulary (`task.claim`). Seeded by the cell itself (the `bootstrap` tool), idempotent, versioned with the cell, tagged `cell-required` — never `seed`/`world-model`. They are *part of the program*.
- **Organic knowledge** — concepts, claims, captures, runs — the graph that accretes through *use*, where salience/confidence/tending do their work. This is *content*; a redeploy must never overwrite it.

Organic knowledge grows through the **generic** `workspace.remember` (a concept or
claim is just a typed fact) — the cell does not need its own recorder.

## 15. Tools (the cell's `/_tools` surface)

The surface is deliberately small: the cell is a **compiler** (`define_machine`)
+ a type vocabulary + a UI; *execution* is the substrate's own `workspace.invoke`
of the projected actions. Four tools:

| tool | kind | purpose |
|---|---|---|
| `define_machine` | act | **the compiler** — record a machine + project rails → actions/subscriptions; returns `validation`. `dryRun:true` validates + previews without writing (§11). |
| `trigger_run` | act | fire a run by writing one `machine-trigger/…` fact — the write-only external/scheduled-routine entry (§7). (An agent that can `invoke` may call `machine.<m>.start` directly instead.) |
| `bootstrap` | act | one-time/idempotent infra seeding (renderers, views, `task.claim`). |
| `spawn_children` | act | **internal** reaction-target only — emit a fan's child runs as separate organ writes (§6); not for hand use. Would collapse into a declared action if ADR-0011's multi-write reliability lands (§13). |
| `step` | act | **the stateless stepper** (ADR-0018) — read `machine-run/<run>` + the def via the shared kernel substrate client (ADR-0017), walk the deterministic `auto` prefix in-process (CEL-guarded, no per-hop write), emit one advance, return the `yield`. Spawns section/vote children; runs the **deterministic** join barrier on child completion (no model). Idempotent. Driven (call it) or reactive (`reactive:"step"` delivers run changes here). |

> **Pruned (v5.1).** `record_idea` (≡ `workspace.remember`), `register_meta_tool`
> (speculative, unused), `validate_machine` (now `define_machine`'s `dryRun`), and
> `disclose` (the machine fact + `decide` descriptions already disclose) were
> removed: 8 tools → 4 (2 user-facing core). See the simplification analysis that
> motivated it. The *core model* is unchanged — a machine compiles to substrate
> declared-actions and runs via the existing `invoke`.

## 16. Version history

- **v1** — vocabulary + recorder (`define_machine` representational; `record_idea`).
- **v2** — machine → declared-action projection (rails → `start`/`<from>-to-<to>`/`decide-*`).
- **v3** — execution as substrate (advancing the run fact via the projected actions; claims as reasoning).
- **v4** — meta-tools as registered substrate tools (`register_meta_tool`).
- **v5** — the functional-core refactor (`engine.ts` + unit tests); parallel branching (`section`/`vote` via `spawn_children` + agentic barrier); external trigger (`trigger_run` + internal-trigger subscription); progressive disclosure (`when`); the run-position diagram overlay + unified-run UI; type handlers (`open`/`render`).
- **v5.1** — **surface prune**: 8 tools → 4. Removed `record_idea`/`register_meta_tool`/`disclose`; folded validation into `define_machine`'s `dryRun`. The cell is a compiler + types + UI; execution is the substrate's `invoke`.
- **v5.2** — **stateless stepper core** (ADR-0018): pure `step(run, machine, now)` in `engine.ts` advances the deterministic `auto` prefix in-process (CEL-guarded, one returned write, yields at non-`auto` rails / terminal / stall / cycle) + unit tests. Foundation set by **ADR-0017** (one shared cell substrate-access client; cel-js declared in the cell's `imports.json`).
- **v5.3 (current)** — **stepper wired + shared substrate client** (ADR-0017/0018), **deployed + validated live**. A shared server-side substrate client (`read`/`query`/`emit`/`supersede`, organ-attested writes with a `FailedEntryCount` check) — canonical at `cells/kernel/static/substrate.js`, **vendored** into the machine cell as `cells/machine/substrate.js` (a server-side `https://` import hangs the forge bundler — ADR-0017). The cell gained a `step` tool: read → pure `step` → one idempotent advance, with section/vote **spawn** and a **deterministic** in-process join barrier (`barrierAdvance` — reads siblings, advances the parent once all are done, no model). Validated end-to-end: auto-prefix walk + CEL stall/resume to terminal, and a section fan whose parent advanced via `Plan~section-join` with no model. New reactive mode `reactive:"step"` projects ONE step subscription (+ the agent/work model deliveries), retiring the per-auto-rail cascade and the agentic join; `reactive:true` stays as the legacy path. 5 tools now.

## Appendix — ADR map & sources

**ADRs this design rests on:** 0001 (Declaration registry), 0002 (Type-as-one-object),
0003 (Reference projection — *machine arrows*), 0004 (Projection pipeline / `$graph`),
0006 (Salience), 0007 (Grant axis — *agent scopes*), 0008 (Cell axis — *publish/deliver*),
0009 (edge strength — *claim supports*), 0010 (Resolution), 0011 (Reactivity — *the
reactor; our load-bearing ADR*), 0012 (Present — *rendering*), 0013 (Fact — *runs/claims*),
0014 (Eliminate — *settled-substrate framing*). Feature-ADR siblings: 0015 (Frames),
0016 (Edges-first-class — the model for projecting arrows→edges).

**External references (workflow parallels, §10):**
Building Effective Agents — https://www.anthropic.com/engineering/building-effective-agents ·
Claude Code Routines — https://code.claude.com/docs/en/routines ·
Dynamic workflows / harness — https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code ·
Agent SDK — https://code.claude.com/docs/en/agent-sdk/{agent-loop,subagents,permissions,hooks,sessions} ·
Agent Skills — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview ·
MCP — https://modelcontextprotocol.io/specification/2025-06-18 .

**Source of truth:** `cells/machine/{engine.ts, index.ts, types.json, client/}`,
`tests/machine-engine.test.ts`. This doc supersedes `machine-cell.md`,
`machine-agent-scopes.md`, `machine-dygram-contrast.md`, `machine-workflow-parallels.md`.
