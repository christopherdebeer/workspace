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

> **Correction (see `docs/machine-dygram-contrast.md`).** A later code-grounded
> read of DyGram corrected three claims that drifted in this doc: (1) DyGram has
> **no `~>`/`~>>` arrows** and **no arrow→rail-mode mapping** — those are our own
> substrate-only extension; DyGram infers auto-vs-agent from node-type/out-degree/
> annotations and its `=>` is causation *styling*, not an agent marker. (2) DyGram
> has **5 canonical node kinds** (`task/state/context/init/tool`), not "15+"; the
> rest are authoring aliases that normalize to `context`. (3) In DyGram node *kind
> drives execution*; in ours `kind` is currently cosmetic (the rail `mode` carries
> behavior). The arrow→`rel` table below (relationship semantics) remains faithful.

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
| **node** (5 canonical kinds — task/state/context/init/tool; authoring aliases like Input/Output/Resource/Result normalize to context) | a fact of type `machine-node`, `kind` in the value; nesting via qualified key (`machine/<m>/<node>`) |
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

## Two kinds of seeding (a discipline)

Not all facts a cell touches are the same kind of thing, and conflating them
muddies the substrate:

- **Cell-required facts** — a cell's own infrastructure: its **types**
  (declared canonically via `types.json` → `describeTypes` → `$types`), its
  **renderers** (`_renderers/<type>`), and any **views** (`_views/<id>`) it needs
  to be legible. A cell should *seed these itself* as part of its definition —
  here, the `bootstrap` tool writes `_renderers/machine`. They are deterministic,
  idempotent, versioned with the cell, and carry no salience claim about the
  world. Tagged `cell-required`, never `seed`/`world-model`.
- **Organic knowledge** — concepts, claims, captures, the graph that accretes
  through *use*. This is where an agent should bias toward seeding (recording
  what it learns), and where salience, confidence, and tending do their work.

The split matters: cell-required facts are *part of the program* (they belong in
the cell's source/bootstrap and redeploy with it); organic knowledge is *content*
(it belongs to the slice's evolving model and must never be silently overwritten
by a redeploy). `@c15r/machine` keeps them apart — `types.json` + `bootstrap` own
the first; `record_idea` and hand/agent capture grow the second.

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

## Rendering in canvas & lit (the native-fact surfaces)

Checked both cells' fact-handling. Machine facts are **already renderable** — the
substrate's surfaces are type-driven with a generic floor — and there is a clean,
code-free path to first-class *diagram* rendering through the existing `viewers`
mermaid renderer.

**Canvas (`@c15r/canvas`) — DyGram's literal home.** The renderer ladder
(`cells/canvas/client/lib/elements/substrateTypes.ts`) is: `_renderers/<type>`
facts (custom drawing) → `view`/`surface` tiles → the **`fact` floor** (any fact
becomes a card: icon + title + meta + open-link + an `⊕` that expands its links
onto the board). Canvas also has an SVG **edges layer** that draws substrate
edges between placed elements. So once a `machine`/`machine-node` fact is placed
or expanded, it renders natively as a **connected graph** — nodes as cards,
arrow-edges (the 7 rels) as drawn edges. A machine *is* a diagram, and canvas is
"parcland hoisted as a substrate view": the fit is exact.
- *First-class enhancement (vocabulary-as-data, no canvas code change):* a
  `_renderers/machine` fact whose source adapts the machine value
  `{ nodes, arrows }` → mermaid text and delegates to the `viewers` cell's
  `mermaid` ElementView (`cells/viewers/client/main.ts` exports it for exactly
  this re-export contract). The machine then draws as a real diagram tile.

**Lit (`@c15r/lit`) — the narrative surface.** Lit renders docs with a dotlit
fence meta-grammar (`cells/lit/client/main.tsx`): ` ```mermaid|json|csv|style `
fences render via `viewers.renderFence`; ` ```run|js|repl ` are live; `!plugin
type=viewer of=…` registers viewers; and `[[wiki-links]]` reconcile into
substrate edges (rel `related`). So a doc can already embed a machine as a
` ```mermaid ` fence and reference `[[machine/<name>]]` / node facts as links.
- *First-class enhancement:* teach the `viewers` cell a `dygram` (or `machine`)
  fence lang that converts a machine fact (or raw `.dy`) to mermaid, so
  ` ```machine machine/<name> ` renders the diagram straight from the fact.

**The loop:** DyGram already generates Graphviz/Mermaid
(`src/language/diagram/graphviz-dot-diagram.ts`); the `viewers` cell renders
mermaid; so one machine fact draws inline in **both** canvas tiles and lit docs
through the same renderer. The seven arrow rels can carry edge styling (canvas
edge labels) so composition/causation/inheritance read distinctly.

> Net: nothing in lit or canvas needs to change to *hold* machine facts — the
> floor + edges + fence grammar already do. The single substrate-native seed that
> makes them first-class *diagrams* is a `_renderers/machine` mermaid adapter
> (and, optionally, a `dygram` lit fence). Both are facts/cell-exports, not
> platform edits — the same "vocabulary as data" discipline as the rest of this
> design.

## Sequencing

1. **v1 — vocabulary + recorder** *(done).* The ideas are first-class and
   managed; machines can be recorded as facts.
2. **v2 — machine → declared-action projection** *(done).* `define_machine` now
   derives **rails** from arrows (`->` auto, `=>` agent) and projects them into
   **cell-required declared actions** in the owner's slice: a `start`, an auto-rail
   `<from>-to-<to>` advance per flow (guarded by the run being at `from`), and a
   `decide-<from>` per agent node. The cell also seeds a `machine-runs` view. This
   required a platform unblock — the organ write-path now permits a cell to seed
   its own cell-required `_actions/`/`_views/` (routed through the same validated,
   contested-detected registries; tagged `cell-required`), the same category as
   the `_renderers/*` it already seeded.
3. **v3 — execution as substrate** *(done, as declarative invocation).* Execution
   **is** invoking the projected actions via `workspace.invoke`: each advances the
   `machine-run/<run>` fact, whose revision history is the trajectory (effects-as-
   data; checkpoints = supersede + revisions). Reasoning is spent only at agent
   rails — the driver calls `@c15r/models.agent` (or reasons), then invokes
   `decide-<from>`, which records the chosen branch as a `claim` *and* advances.
   This is the substrate-native realisation of "the step loop runs over declared
   actions": no bespoke runtime, just the declarative tier the platform already
   has. *(A future enhancement — the cell autonomously invoking `@c15r/models.agent`
   server-side at agent rails — needs cross-cell IAM, deferred.)*
4. **v4 — meta-tools as registered substrate tools** *(done).* `register_meta_tool`
   persists a constructed tool as a `meta-tool` fact and, when it carries a declared
   `action`, projects that as cell-required vocabulary — instantly invocable, so the
   vocabulary grows during use, audited by provenance.

> **Still open: arrows → substrate edges.** v1 stored arrows in the machine value
> with their resolved `rel`; projecting them to real substrate edges
> (`workspace.link`) so `neighbors`/`links` walk a machine remains a gap — the
> organ write-path writes facts, not edges, and edge-projection wasn't part of the
> cell-required-vocabulary unblock. The caller can `workspace.link` them today; an
> organ `substrate.link.requested` path is the clean follow-on.

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
