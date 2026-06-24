# ADR-0019 — Machine as a decomposed graph; decide as agent

- **Status:** Accepted (shipped + live). The `@c15r/machine` cell stores machines decomposed,
  drives them with the stateless stepper (ADR-0018), and renders them graph-first. `tending` +
  `weave` run on it; the embedded-blob machines were purged.
- **Date:** 2026-06-24
- **Context:** A machine was one opaque fact carrying embedded `nodes:[]` / `arrows:[]`. That made
  it invisible to the substrate's graph (`neighbors`/`$graph`/canvas), unaddressable per-node, and
  the reason ADR-0003 step 4 + ADR-0016 sat unfinished. Execution also carried a second model
  primitive (`models.decide`) coupled to that embedded shape.
- **Depends on:** ADR-0003 (Reference projection — the `ref`/`keyEdges` rules), ADR-0016 (edges
  first-class), ADR-0018 (the stateless stepper), ADR-0017 (the shared cell substrate client).

---

## Decisions

### 1. A machine is decomposed, like a canvas board or a doc

Keys nest under `machine/<name>/`:

| Fact | type | key |
|---|---|---|
| identity | `machine` | `machine/<name>` — `{title, entry, kind?, context?}` |
| node | `machine-node` | `machine/<name>/node/<node>` |
| rail | `machine-rail` | `machine/<name>/rail/<from>~<to>` — carries `mode/condition/prompt/…` |
| run | `machine-run` | `machine/<name>/run/<run>` (children `…§<branch>` / `…#<i>`) |
| claim | `claim` | `machine/<name>/run/<run>/claim/<node>` |

A whole machine lists/deletes by one `machine/<name>/` prefix. **Rails are content-bearing edge
facts**: a first-class edge holds only `from/rel/to/strength` and the cell can't author one (organ
writes only), so the rail's *key* encodes `<from>~<to>` and the `machine-rail` type's
`keyPattern`+`keyEdges` (`types.json`) make `deriveBackboneEdges` (`state.ts`) project a node→node
graph edge at read time — flagged `derived`. This realises ADR-0003 step 4 and gives the machine
real graph structure for free (verified: `neighbors` on a node returns its `rail` + `inMachine`
edges). `~` separates from/to because `seg()` strips it (unambiguous vs node names with `_`).

The pure engine is unchanged: the shell `assembleMachine(identity, nodeFacts, railFacts)` rebuilds
the in-memory `{nodes, rails}` the stepper/projection already consume. `define_machine` emits the
decomposition as a fan of organ writes (`decomposeWrites`).

### 2. Decide is an agent with a fixed choice set — there is one model primitive

`models.agent` is the only model entry point: its tools are the substrate verbs, and a work rail
"advances" by `substrate_emit`-ing the run fact per its prompt. A **decide is the same shape** — an
agent given a fixed menu of branches. So an agent rail delivers to `@owner/models.agent` with the
branch menu + context + the claim/advance write template the *machine cell* builds; the model
records the claim and advances. `models.decide` (which read the embedded machine shape + flat keys)
is **eliminated** — `models` never reads a machine. A `task` rail gets no model delivery; it parks
for a human via the projected `decide-<from>` action (the open-tasks queue). Verified live: a
decide fell back Anthropic→OpenAI, wrote the claim, advanced, and the stepper settled the run.

### 3. Graph-first UI

The cell's SPA assembles each machine from its node/rail facts and makes the diagram the hero; a run
is the same diagram with its taken path overlaid (from the run's `trace`) + an ordered step
timeline, with real loading states. The decomposition also makes a machine renderable on canvas /
`$graph` (the derived edges) — same facts, multiple views.

## Consequences

- The machine is substrate-native graph structure; nodes/rails are addressable, linkable, salient.
- One execution path (the stepper) and one model primitive (the agent). `models.decide` and the
  per-auto-rail / fan / agentic-join projection are gone.
- The tool surface is four: `bootstrap`, `define_machine`, `step`, `trigger_run`.

## Open / follow-ups

- **Canvas renderer** (`_renderers/machine`) still reads the embedded `el.nodes/arrows`; it needs to
  read the decomposed node/rail facts (or render nodes as individual placed elements). Deferred.
- **Trace across agent hops** relies on the decide agent preserving the run's `trace` array
  (prompt-instructed, best-effort). A robust form (the model writes only the claim; the cell
  advances, preserving trace) needs a claim→step trigger and is deferred.
- **Edge/rel-type vocabulary** (ADR-0016's completion): the `rail` rel is declared via the
  `machine-rail` type today; a first-class rel-type vocabulary deserves its own ADR.
