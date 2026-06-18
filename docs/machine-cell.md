# `@c15r/machine` — DyGram's ideas as substrate-native vocabulary

> A cell **design** doc (not a trajectory record). It specifies a new tier-2 cell,
> `@c15r/machine`, that folds the ideas of **DyGram** (`christopherdebeer/machine`,
> formerly "Machine" / "ideo-gram"; deployed at `dygram.parc.land`) into the
> substrate as first-class facts. Grounded in a fine-toothed read of the DyGram
> source (HEAD `c42f47f`, 2025-12-06) and informed by the world-model direction
> in `docs/trajectory/2026-06-18-elicit-world-models-and-the-substrate.md`.
>
> Substrate trace this extends: `kb/3726aa77d4ff4a` (`proj_dygram`, type
> `project`) — already edged `implements → kb/concept_substrate` and
> `implements → kb/722a81781fc94d` (concept_skills_system). This cell turns that
> single descriptive fact into a managed vocabulary.

## Why DyGram belongs in the substrate

DyGram is, in its author's own framing, *"the substrate thesis applied to
programming language design"*: a machine is a graph of typed nodes and typed
arrows that an agent **rides as rails** — deterministic transitions execute
instantly with no LLM call, and the model is invoked **only** where a genuine
decision or unit of work exists. That is the same bet the substrate makes with
**declared actions** ("the substrate interprets; no code runs") and the same bet
the Elicit conversation argues for: *spend reasoning only where reasoning is
required; reduce a hard-to-verify task to a graph of easy-to-verify steps.*

So DyGram is not a foreign artifact to bolt on — it is a second, independent
expression of the substrate's core idea, at the granularity of a single
executable diagram. Folding it in means expressing a DyGram machine in the
substrate's own nouns and letting the substrate's salience, provenance, links,
and tending apply to it for free.

## The mapping (DyGram idea → substrate primitive)

This is the heart of the design. Every DyGram concept has a substrate-native
home; nothing requires a new engine.

| DyGram | Substrate-native form |
| --- | --- |
| **machine** (a named graph) | a fact of type `machine` — a named subgraph: its node-facts + the edges between them |
| **node** (Task/State/Input/Output/Context/Resource/Process/Concept/Implementation/Result, 15+) | a fact of type `machine-node`, `kind` in the value; nesting via qualified key (`machine/<m>/<node>`) |
| **7 arrow types** | substrate **edges** (typed, directed) — see the rel table below; the graph *is* the program |
| **rails: deterministic transition** (`-@auto->`, instant, no LLM) | a **declared action** — a bounded, conditional, audited write (`if`/`enabled` + `writes[]`); fires with no model call |
| **rails: agent decision** (branch needs reasoning) | invoke a model cell (`@c15r/models.agent`) at exactly that node — the *only* place tokens are spent |
| **LLM elision** (single forced transition skips the model) | the substrate already only invokes a cell when an action's preconditions/choice are non-trivial |
| **meta-programming** (agent constructs a tool mid-run, persisted as a `tool` node) | a **`meta-tool` fact** (vocabulary-as-data) — the skills-system pattern (`kb/722a81781fc94d`) the substrate already names; a `registerAction`/registered tool that grows the vocabulary during use |
| **effects-as-data** (`step(state) → {nextState, effects[]}`, immutable) | observed-state `put`/`read` duality + the trajectory feed; effects are facts by construction |
| **checkpoints** | `supersede`-not-delete + revisions + the changes feed |
| **context inheritance / qualified names** | key namespacing + `neighbors`/`links` traversal (a child reads its parent contexts by edge) |
| **the self-describing meta-diagram** (DyGram describes itself in itself) | vocabulary-as-data: `$types`/`$catalog` — the substrate already describes its own vocabulary as facts |

### Arrow-semantics → edge relations

DyGram's seven arrows become seven substrate edge `rel`s, so a machine's
structure is queryable with `neighbors`/`links` like any other graph:

| Arrow | DyGram meaning | substrate `rel` |
| --- | --- | --- |
| `->` | basic flow / transition | `flows-to` |
| `-->` | dependency | `depends-on` |
| `=>` | strong causation | `causes` |
| `<\|--` | inheritance | `inherits` |
| `*-->` | composition | `composes` |
| `o-->` | aggregation | `aggregates` |
| `<-->` | bidirectional | `relates` (symmetric) |

## The Elicit grounding (why now)

The world-model trajectory argues that reliable reasoning needs an explicit,
inspectable representation outside the weights, with **claims carrying
confidence and evidence**, and processes that **run guaranteed-as-defined and
escalate only where judgment is needed**. A DyGram machine *is* such a
representation, and three connections make the fold pay off:

1. **A rail is a declared action; a machine is a routine.** This is the
   directional layer's "routines + escalation" item (`2026-06-18-agent-api-friction-plan.md`,
   appendix) made concrete: a machine compiles to a graph of declared actions,
   with `@c15r/models.agent` invoked only at agent-decision rails.
2. **A transition can be a claim.** An agent-decision rail's chosen branch is a
   `claim` (the keystone type seeded this session) — `{statement, confidence,
   support[]}` — so *why* the machine went one way is inspectable, not buried in
   a hidden chain of thought. The execution trajectory becomes Elicit's
   "certificate of reasoning."
3. **Meta-tools are the dynamic vocabulary.** DyGram agents grow the tool set
   mid-run; the substrate already treats vocabulary as data. A constructed tool
   is a `meta-tool` fact, discoverable and auditable like a declared action.

## The cell

`@c15r/machine` is a tier-2 cell (`cells/machine/`, git-truth, synced via
`scripts/cell-sync.mjs push machine --deploy`). It follows the minimal cell
contract (Function-URL handler; `GET /_tools` discovery; `POST /_tools/<name>`
dispatch; writes via `substrate.write.requested` — the organ path).

**Declared vocabulary** (`cells/machine/types.json`, aggregated into `$types`):
`machine`, `machine-node`, `rail`, `meta-tool` — each with icon, a `value.*`
label path, and render hints, so any surface (home, canvas, an agent) can open
and render a DyGram fact uniformly.

**Tools (v1 — representational):**
- `define_machine` *(act)* — record a machine as a fact at `machine/<name>`:
  `{ title, source?(.dy text), nodes[], arrows[] }`. The arrows are stored in the
  value *and* are meant to be projected to substrate edges (via `workspace.link`)
  so the machine is graph-native. Emits `substrate.write.requested`.
- `record_idea` *(act)* — record a DyGram concept or claim as a first-class fact
  (`{ id, kind: "concept"|"claim", statement, confidence?, support?[] }`), so the
  *ideas* (not just machines) are addressable, salience-ranked, and linkable.

**What v1 deliberately does not do:** run the rails engine. Edges and reads go
through the gateway (`workspace.link`, `workspace.query type:machine`) because
the organ write-path writes facts, not edges, and reads belong to the caller.
Execution is sequenced below — it is a *projection to declared actions*, not a
port of DyGram's runtime.

## First-class facts seeded this session

Planted live via the gateway (vocabulary-as-data; the `_types/*` entries act as
per-user overrides now and become canonical once the cell is deployed):

- `_types/machine`, `_types/machine-node`, `_types/rail`, `_types/meta-tool` —
  the declared vocabulary.
- `concept/rails-execution`, `concept/meta-programming-as-vocabulary`,
  `concept/arrow-semantics`, `concept/self-describing-machine`,
  `concept/effects-as-data` — DyGram's ideas as `concept` facts.
- `claims/rails-are-declared-actions` — a `claim` (with confidence + support)
  tying the rails primitive to the substrate's declared actions and the routines
  direction.
- Edges: each concept `grounded-in → kb/3726aa77d4ff4a`;
  `concept/meta-programming-as-vocabulary → relates → kb/722a81781fc94d`
  (concept_skills_system); `claims/rails-are-declared-actions → grounded-in`
  the rails concept and `claims/world-models-outside-weights`.

## Sequencing

1. **v1 — vocabulary + recorder** *(this doc; cell scaffolded; facts seeded).*
   The ideas are first-class and managed; machines can be recorded as facts.
2. **v2 — machine → declared-action projection.** A deterministic rail becomes
   an invokable `registerAction`; arrows project to edges automatically.
3. **v3 — execution as substrate.** The step loop runs over declared actions;
   agent-decision rails invoke `@c15r/models.agent`; the trajectory is the
   certificate; chosen branches are `claim` facts.
4. **v4 — meta-tools as registered substrate tools.** Constructed tools persist
   as `meta-tool` facts / declared actions — the vocabulary grows during use,
   audited by provenance.

## Open decisions

1. **One `machine-node` type vs. a type per DyGram kind.** v1 uses one type with
   `kind` in the value (keeps `$types` small); per-kind types (`task`, `state`,
   …) would give richer per-kind render/handlers but multiply the vocabulary.
2. **Where machines live.** `machine/<name>/…` keys keep a machine's nodes under
   one namespace (the `$namespaces` discovery item would document this); the
   alternative is flat keys with a `machine` tag.
3. **Live provisioning.** The cell source is git-truth now; deploying it live
   (`cell-sync push machine --deploy`, or gateway `cells.create`) provisions a
   Lambda + table — a deliberate, reversible step taken on request.
