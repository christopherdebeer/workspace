# `@c15r/machine` vs DyGram — a code-grounded contrast

> An implementation-level comparison (not a docs reading) of our substrate cell
> `@c15r/machine` against the original **DyGram** (`christopherdebeer/machine`,
> HEAD `c42f47f`, checked out at `/home/user/dygram-src`). Grounded in a
> fine-toothed read of DyGram's grammar, type system, execution runtime, agent
> bridge, meta-tool manager, API, and frontend — and of our `cells/machine/`.
>
> Purpose: name precisely where the two diverge, what our fold-into-substrate
> **improves**, what it **drops**, and where our design docs have **drifted from
> the DyGram source** and should be corrected.

## TL;DR

DyGram is a **client-side imperative interpreter for a real DSL**: a Langium
grammar (`.dy`) with an LSP, a Zod-backed type system, graph validators, and a
pure functional `step(state) → {nextState, effects[]}` runtime that an in-browser
agent drives directly against the Anthropic API. It is ephemeral, single-user,
single-run, and richly featured *within* one run (multi-path fork/join/map,
barriers, cycle detection, turn-level resumable conversations, self-rewriting
machines, unsandboxed code-gen tools).

`@c15r/machine` is a **declarative projection into the substrate**: a machine is a
fact; its rails project to **declared actions** over a `machine-run/<run>` fact;
execution *is* invoking those actions; the run's revision history *is* the
trajectory. It has no parser, no type system, no runtime — the substrate
interprets. In exchange it gets, for free, everything DyGram lacks: durability,
provenance, salience, links, tending, multi-actor hand-off, event-sourced
triggers, scoped agent grants, and cross-surface rendering.

The trade is stark and deliberate: **DyGram is deep in one run; we are broad
across the substrate.** The biggest thing we gave up is the *language* (parsing,
typing, validation, graph analysis). The biggest things we gained are
*durability + auditability + multi-actor*.

---

## 1. Execution model

| | DyGram | `@c15r/machine` |
| --- | --- | --- |
| Shape | Functional core / imperative shell. Pure `step(state)→{nextState, effects}` (`execution-runtime.ts`), orchestrated by `MachineExecutor` (`executor.ts`). | No runtime. Rails **project** to cell-required declared actions; execution = invoking them via `workspace.invoke` (`index.ts:projectionActions`). |
| Run state | Immutable JSON `ExecutionState` (`runtime-types.ts`) held in memory; checkpoints = deep-clone. | A `machine-run/<run>` **fact**. Each transition is a guarded write; revision history = trajectory (effects-as-data). |
| Durability | Ephemeral. Browser = in-memory exec state (IndexedDB only stores *machine versions*). CLI = file store `.dygram/executions/<id>/` (`cli/execution-state.ts`). | Durable by construction (DynamoDB substrate; supersede + revisions = checkpoints). |
| Concurrency | Logical multi-path: `@parallel` fork, `@async`/`@spawn` paths, `@map`/`@foreach` fan-out over arrays, `@barrier`/`@join`/`@merge` sync (`state-builder.ts`). Cooperative, single-process. | **Single-token.** One `node` per run. No fork/join/map/barrier. |
| Reactivity | The host loop drives steps; nothing external. | Optional EventBridge **subscriptions**: auto rails advance themselves; `trigger` patterns let a *fact* start a run (event-sourced). |
| Safety rails | `maxSteps` (1000), `maxNodeInvocations` (100), timeout (5 min), **cycle detection** (`detectCycle`). | **None.** A cyclic auto-rail + `reactive` subscriptions could thrash; runs have no step/loop guard. |
| Resume granularity | Down to a single LLM **turn** (`turnState` is serializable — pause/resume mid-conversation, `turn-executor.ts`). | Coarse: a whole `decide`/`agent` delivery. No mid-conversation resume. |

**Net:** DyGram is a far richer *single-run* engine (parallelism, barriers,
guards, turn-level resume). Ours is event-sourced, durable, observable, and
multi-actor — but executes a single linear token with no loop guards.

---

## 2. The decision / agent mechanism

**DyGram.** At a node that "requires agent decision" (`requiresAgentDecision`:
a task-with-`prompt`, or any node with >1 non-`@auto` outbound edge), the runtime
builds `transition_to_<target>` tools + context `read_`/`write_` tools + the 7
meta-tools, and runs a **multi-turn tool loop** (`maxTurns` 50, `effect-executor.ts`).
The agent reads/writes context and finally calls a transition tool; the result
`{action:'transition', target, reason}` advances the path. Key optimization —
**LLM elision**: a single forced transition with no context/meta tools skips the
model entirely (`execution-runtime.ts:458`). The model is the raw Anthropic SDK
(or Bedrock), called **browser-direct** with `dangerouslyAllowBrowser:true` and
the user's `localStorage` key.

**Ours.** Three distinct mechanisms, by rail mode:
- **agent rail (`=>`)** → deliver the run to `@owner/models.decide`; it picks a
  branch and writes a `claim` **and** advances (`projectionActions` `decide-*`).
  No provider configured ⇒ it parks a claimable `task`.
- **task rail (`~>`)** → always parks a claimable hand-off for a **driving**
  agent (the "agent uses the machine" path).
- **work rail (`~>>`)** → deliver to `@owner/models.agent`, an autonomous tool
  loop that *does the work* with scoped `grants` + a `tools` allowlist and
  advances the run itself (the "machine spawns an agent" path).

**Improvements ours brings:**
1. **Decisions are first-class `claim` facts** (`{statement, confidence, support}`)
   — an auditable *certificate of reasoning*. DyGram's rationale is a transient
   `reason` string, surviving only in `history.jsonl`.
2. **Two ergonomics DyGram has no analog for:** driving-agent-*uses*-machine
   (task/claimable hand-off) and machine-*spawns*-agent (work). DyGram only has
   the single embedded in-loop agent.
3. **Scoped grants + tool allowlist** per rail (`docs/machine-agent-scopes.md`).
   DyGram's browser agent runs with the user's full key and unsandboxed tools.

**What we dropped:**
- The **in-decision tool loop**. DyGram's agent reads/writes context across many
  turns *while deciding*. Our `decide` is effectively one shot (the rich loop
  exists only on `work` rails, via `models.agent`).
- **LLM elision as inference.** DyGram *infers* where the model is needed (node
  type + out-degree). We *declare* it (rail mode is explicit data). Ours is more
  auditable; DyGram's is more ergonomic — see §3 and §6.

---

## 3. Language, types, validation — our largest gap

DyGram is, first, a **language**:
- A **Langium grammar** (`machine.langium`): nodes, 7 arrow terminals + labeled
  bidirectional, qualified-name nesting, imports, multiplicities, annotations.
- An **LSP** running even in-browser (completion, validation, hovers via
  `codemirror-langium.ts`).
- A **Zod-backed type system** (`type-registry.ts`): primitives + semantic types
  `Date`/`UUID`/`URL`/`Duration`/`Integer`/`Float`, generics `Array/Map/...`,
  every node registered as a structural type, widening rules, `@StrictMode`.
- **Graph validators** (`graph-validator.ts`, `machine-validator.ts`):
  unreachable nodes, cycles, orphans, missing entry/exit, multiplicity format,
  inheritance-between-different-types, context-access-without-edge, prompt-only
  nodes, import collisions/cycles.
- **Qualified-name expansion** (`a.b.c` → real nested AST, merge semantics) and a
  pluggable **import system** (file/URL/virtual resolvers, dependency ordering).
- **Backward compilation** JSON → DSL.

**Ours has none of this.** `define_machine` takes JSON `{nodes, arrows, rails}`
and stores it verbatim (the `.dy` `source`, if supplied, is opaque). There is no
parser, no type-checking, no graph analysis. A machine with dangling rails,
unreachable nodes, or a transition cycle is accepted silently. This is the
**single biggest capability gap** and the most defensible thing to port — even as
a `validate_machine` tool (graph reachability + dangling-rail + cycle checks)
that runs the same analyses over our JSON shape.

**Node kinds — a correction.** DyGram does **not** have "15+ node types." The
grammar lets `type` be *any* `ID`; semantically `node-type-checker.ts` collapses
everything to **5 canonical kinds**: `task / state / context / init / tool`
(`Input/Output/Resource/Concept/Result/Entity/Data` all normalize to `context`;
`Process/Implementation` pass through inert; plus special `note`/`style`/`Type`).
Crucially, **node type drives execution** in DyGram (a `state` node with one out
auto-advances; a multi-out node needs the agent). In **ours, `kind` is cosmetic**
— it labels the node but drives nothing; the rail `mode` carries all behavior.
If we wanted `kind` to mean something, adopting DyGram's inference (state→auto,
multi-out→decide) is the move.

---

## 4. Arrows and rail modes — where our docs drifted from the source

Our `docs/machine-cell.md`, `types.json`, and `index.ts` descriptions claim
DyGram has **`~>` (task)** and **`~>>` (work)** arrows and that the 7 arrows map
to rail modes (`->` auto, `=>` agent, `~>` task, `~>>` work). **The DyGram source
contradicts this:**

- **There are no `~>` or `~>>` arrows.** Zero `~` characters in the grammar. The
  real arrow set is: `->`, `-->`, `=>`, `<|--`, `*-->`, `o-->`, `<-->` (+ labeled
  `<--label-->`).
- **`=>` is "strong causation / critical path"** — a *rendering* (thick red,
  `getArrowStyle`), **not** an agent-decision marker.
- **Transition mode is not arrow-driven at all.** DyGram computes auto-vs-agent
  dynamically from **node type + out-degree + annotations** (`@auto`, `@async`,
  `@map`, `@parallel`) + prompt presence (`transition-evaluator.ts`). The arrow
  *symbol* only selects relationship semantics + diagram styling.

So our arrow→rail-mode table (and `~>`/`~>>`) is **our own invention**, layered on
DyGram's surface syntax — a clean, explicit simplification we should *own as a
deliberate design choice*, not present as a port. **Action:** correct the
wording in `index.ts` (the `define_machine`/`rails` descriptions), `types.json`,
and `machine-cell.md` to say "DyGram's arrows are relationship/rendering
semantics; we additionally define explicit executable rail modes
(`auto`/`agent`/`task`/`work`), introducing `~>`/`~>>` as substrate-only rail
syntax." This keeps the homage honest and the design legible.

(Our arrow→`rel` edge table in `ARROW_RELS` *is* faithful to DyGram's relationship
semantics and should stay.)

---

## 5. Meta-programming

**DyGram.** Agents construct tools mid-run (`construct_tool`, `meta-tool-manager.ts`):
- `code_generation` is the only executable strategy — builds a function via
  `new Function(...)`, **unsandboxed**, run in-process. Persisted as a `tool`
  node and regenerated back into DSL. `code-executor.ts` even regenerates code
  from runtime errors (error→fix loop), AJV-validating I/O.
- `agent_backed` and `composition` are **placeholders** (not wired).
- `update_definition` lets a machine **rewrite itself mid-run**; `task-evolution`
  (llm→code promotion) is **stubbed/dead code**.

**Ours.** `register_meta_tool` persists a `meta-tool` **fact** and, when it carries
a declared `action` (`{id, writes[], if?}`), **projects that action** — instantly
invocable, audited by provenance. No code execution: a tool is either a
declarative write or a delegation to an agent.

**Trade:** ours is **safer and auditable** (vocabulary-as-data with provenance, no
eval) but **less capable** (can't synthesize and run arbitrary JS; no
error-driven regeneration). DyGram's self-rewriting + code-gen is powerful and
dangerous; ours is inert-but-inspectable. Self-modification for us is just
`define_machine` again (re-project) — coarser, but versioned and contested-checked.

---

## 6. A synthesis insight that connects to the tending diagnosis

The earlier "tending only ever escalates" finding has a direct echo here.
DyGram's **LLM-elision** — *don't invoke the model when there's only one path* —
and its **dynamic mode inference** — *a node needs the agent only if its type +
out-degree imply a real choice* — are exactly the structural medicine for "the
machine traps the agent into escalating." DyGram never asks the model to decide
where there is nothing to decide.

Our model is the inverse: rail mode is **explicit data**, which is more auditable
but means a mis-modeled machine (an `agent`/`task` rail where one branch is
forced) will *always* spend reasoning or park a hand-off needlessly. A worthwhile
hybrid: **infer a default rail mode** from node kind + out-degree the DyGram way
(state/single-out → `auto`; multi-out or work-bearing → `agent`/`work`), while
keeping explicit override. That would make `kind` meaningful (§3) and bake the
"spend reasoning only where required" tenet into projection, not just into hand
authoring.

---

## 7. Rendering & frontend

| | DyGram | `@c15r/machine` |
| --- | --- | --- |
| Diagram | Graphviz/DOT via `@hpcc-js/wasm`, per-rel arrow styling, **live runtime overlay** (visited/active/counts colored during execution). | Mermaid (client dynamic import) + `_renderers/machine` for canvas. **Static structure only** — a run's current node isn't highlighted. |
| Editor | CodeMirror + Monaco playgrounds with **in-browser Langium LSP**, live execution, record/playback for deterministic tests. | SSR React SPA: list machines/runs, drill into definition (mermaid) + run trajectory (claims + logs) + a Trigger button. No editor, no LSP. |
| Reach | One app at `dygram.parc.land` (static GitHub Pages). | Type handlers (`open: /#/m/${match}`) → "open in cell UI" from canvas/lit/home; machine facts render inline anywhere via `_renderers/machine`. |

**Gap worth closing:** a **runtime diagram overlay** — color the mermaid node that
the run is currently at (and visited nodes) by reading `machine-run/<run>.node`.
DyGram's live-colored graph is its most legible feature and we have all the data.

---

## 8. Scorecard

**Where we genuinely improve on DyGram**
1. Durable, event-sourced runs (fact + revisions) vs ephemeral memory/files.
2. Decisions as auditable `claim` facts with confidence/support.
3. Two multi-actor modes (driving-agent-uses-machine; machine-spawns-agent).
4. Vocabulary-as-data meta-tools with provenance — no unsandboxed eval.
5. Full substrate composition: salience, links, tending, cross-machine reuse,
   fact-triggered runs, scoped grants, cross-surface rendering.
6. Reactive auto-rails (deterministic prefix self-advances).

**Where we dropped DyGram capability (candidate backlog)**
1. **No DSL / type system / validation / graph analysis** — port at least a
   `validate_machine` (reachability, dangling rails, cycles, orphans). *(biggest)*
2. **No multi-path concurrency** — fork/async/map/barrier/join.
3. **No loop/step/timeout guards** — a cyclic reactive machine can thrash.
4. **No turn-level resumable decision loop** (DyGram's `turnState`).
5. **No runtime diagram overlay** (live current/visited highlighting).
6. **No editor / LSP / backward-compilation** authoring ergonomics.
7. **Arrows→substrate-edges still unprojected** (our own noted gap): a machine's
   structure isn't walkable via `neighbors`/`links`.

**Doc corrections to make (factual drift from source)**
- `~>`/`~>>` arrows and the arrow→rail-mode table are **ours**, not DyGram's —
  reword `index.ts`, `types.json`, `machine-cell.md` to own them as substrate-only
  rail syntax.
- "15+ node kinds" → DyGram has 5 canonical kinds; the rest are authoring aliases.
  Our `kind` is currently cosmetic; note that, or make it drive inference.
- `=>` is causation-styling in DyGram, not an agent marker — our agent semantics
  for `=>` is our own mapping.
