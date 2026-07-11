# The Cognitive Substrate

## LLM-native software is not a chatbot with tools — it is a layered cognitive organism, and we have already built most of one

> A foundations document, in the lineage of [`substrate.md`](./substrate.md),
> [`the-substrate-thesis.md`](./ancestor/sync/the-substrate-thesis.md), and
> [`adaptive-salience.md`](./ancestor/sync/adaptive-salience.md). It reads an
> external framing — a neuro-evolutionary account of cognition, anchored on
> Karpathy's LLM-wiki pattern — *against the substrate we have actually built*,
> and finds them to be the same claim in two vocabularies. Where the framing
> theorises, the substrate mostly exists; where the framing hand-waves ("the wiki
> detects contradictions"), the substrate's own telemetry shows exactly what is
> still missing.
>
> *Edinburgh · July 2026*

---

### 0. The provocation

The starting text maps a **biological cognitive stack** onto LLM-native software:

```
reflex / locomotion → sensory orienting → action selection →
maps → memory → simulation → social / planning cortex
```

Its anchor is Karpathy's **LLM-wiki** pattern: don't treat the model as a
stateless answer machine over retrieved chunks; let it maintain a persistent,
compounding intermediate structure — **immutable raw sources**, an **LLM-maintained
wiki** that accretes synthesis and cross-links, and a **schema/instruction file**
that governs how the agent updates it. Ingest, query, lint. Answers file back into
the wiki, so exploration compounds instead of dissolving into chat history. RAG,
by contrast, "rediscovers" knowledge from scratch at query time — evolutionarily
shallow, a reflex arc.

The framing then reaches for a richer architecture than "LLM + markdown files": a
world-model layer, an action-selection layer, an attention layer, a memory
consolidation layer, a correction layer, and a schema-as-genome layer. It
concludes that the frontier is not "better agents" but **agent + knowledge
substrate co-evolution**.

The author of that text noted its blind spot directly: *it is not aware of the
substrate we have been building.* This document closes that gap. The claim here is
strong and specific:

> **The substrate is not a knowledge base an agent queries. It is the externalised
> nervous system the framing is groping toward — and most of its layers already
> run.** What is missing is not the maps, the attention, or the action-selection.
> It is the **cerebellum**: the loop that corrects the organism when its own
> knowledge drifts. And our own tending telemetry shows that gap in the raw.

---

### 1. The reframing: two vocabularies, one architecture

The substrate thesis already states the shape:

```
            Humans / Agents
                    ↑
                Surfaces          ← perception (UI = API, two renderers of one surface)
                    ↑
            Derived Meaning       ← interpretation / affordances
                    ↑
                 State            ← facts { value, _meta }, the world model
                    ↑
         Localized State Machines ← organs (bounded, serialized compute)
```

The neuro-evolutionary account describes the *same* stack from the other end —
bottom-up, in the order evolution laid it down. They are not analogies competing
for the same territory. They are the inside and outside views of one system:
*Participants → Surfaces → Derived Meaning → State → Organs* is what
*reflex → orienting → selection → maps → cortex* looks like once you stop
describing neurons and start describing software.

The rest of this document is the seam between them.

---

### 2. The mapping — every biological layer already has a substrate primitive

Each row is a layer the framing names, the function it performs, and the
capability in *this* system that already performs it. A caution before reading it:
the MCP surface exposes only **three verbs** — `whoami` / `read` / `act`
(`services/gateway`) — and all capability lives in the `target` argument. So
`$catalog` is a deliberate *projection*; the real primitive count is an order of
magnitude larger, declared in `services/workspace/descriptors.ts` (~34 workspace
tools), the `platform/runtime/*` physics, and each cell's `TOOLS` array. The names
below are real targets, not a wishlist.

| Neuro layer | Function | Substrate primitive (exists today) |
| --- | --- | --- |
| **Spinal cord / reflex arc** | fast, local, stereotyped loops | `registerSubscription` (reactions to matching writes → `invoke` or `deliver`); declared `actions` with `if`/`enabled` guards; fact **timers/leases** (`FactTimer`, `ifAbsent`+`timer` atomic claim, `state.ts`); the subscription reactor (`event-handlers.ts`) |
| **Tectum / orienting** | detect salience; turn toward / away | **six salience signals** — recency · velocity · attention · standing · centrality · relevance (`state.ts:406-731`); **lenses** (`salience/recent/connected/durable/active`); per-actor weighting (ADR-0050); `_config/salience` tuning + `ScoreExplain`; focus/peripheral/elided bands; reads `recall` / `query` / `peek` / `changes` |
| **Basal ganglia** | action selection: approach, avoid, **inhibit** | `read("$catalog", { for \| forType })` (ADR-0049 — *what can act on this fact*); `$types` handlers; `registerAction`+`actions`+`invoke`; `suggestions` (ratification candidates); `@c15r/tasks.next`. An action's `if` precondition *is* inhibition — an affordance withheld until state permits |
| **Thalamus** | routing / gating between systems | the `read`/`act`/`whoami` spine (target grammar + read/act boundary + scope gate, `services/gateway`); `services/dispatch` HTTP ingress (`/@*`, `/d/*`) → forge proxy + SSR compose; shaping tiers (`refs`/`card`/`full`); `registerSubscription({deliver})` event routing |
| **Hippocampus** | episodic / contextual binding + the blackboard | facts `{value, _meta}` with server-stamped provenance; `remember`/`ingest`; `supersede`+`migrateLinks` (retire-not-delete); content-hash **CAS** (`ifVersion`/`ifRevision`/`ifAbsent`); sharing/authority (`share`/`grants`/`group`/`requestGrant`), `auth` identity; `changes` (trajectory tail); `athena` (SQL over the whole change history via the archiver) |
| **Pallium / cortex** | maps, abstraction, simulation | authored edges (`link`/`unlink`) + **derived backbone** (`instanceOf`/`managedBy`/…) + inferred `similarTo` (`vectors.ts`, `similar-edges.ts`); reads `neighbors`/`links`/`graph`/`members`; `reindex` + `project` (PCA→2D/3D, ADR-0047); canvas boards + `views`; `@c15r/models.agent` as the reasoning loop |
| **Cerebellum** | prediction, calibration, **error-correction** | `attention` (stale/unlinked/dangling); `tend` (audit + `delta` vs prior); `ratify` (promote inferred → authored); `pruneSimilar`; `supersede`+`migrateLinks` — **the primitives exist, but the loop is open** (§5): they measure and repair structure, nothing scores the correction |
| **Neocortex expansion** | higher planning, execution, social | `@c15r/machine` (DyGram, `define_machine`/`step`); the **effectors** `@c15r/models` (`run`/`agent`) and `@c15r/run` (`exec`); `@c15r/tasks` goals; **`cells.create` — neurogenesis at runtime**; multi-tenant slices + `share`/`grants` (shared world models — a theory-of-mind substrate) |

Read the table twice. Downward, it says: *the organism's layers each have a home.*
Upward, it says something sharper — **the substrate was not designed as a brain,
and it converged on one anyway**, because the pressures are the same. A system
that must perceive a growing world, decide what to attend to, select actions under
scarcity, remember what happened, and not drift, grows these organs whether you
name them in Latin or in TypeScript.

**Organs versus applications.** Not every cell is an organ. The rows above are
*cognition* — the substrate's own physics. Built *on* that organism is an
**application / interface layer**: `@c15r/regwatch` (a regulatory-monitoring app —
collect → review → calibrate), `@c15r/lit` (a prose/doc editor and fact renderer),
`@c15r/canvas` (spatial boards over the graph), `@c15r/home` (the signed-in
dashboard), `@c15r/input` (a capture PWA), and the shared render modules
(`viewers`/`kernel`/`starter`). These are things built *with* cognition, not organs
*of* it — the same distinction the visual plate draws as a surface resting on the
stack. (`@c15r/regwatch`, filed in the first draft as "a cortical column," belongs
here: it is an app that happens to run a perception→feedback loop, not a substrate
primitive.) Infrastructure — `services/cells` (the forge) and `services/auth` — is
a third category: the ground the organism grows in, not part of it.

---

### 3. Karpathy's wiki is a degenerate special case of the substrate

The LLM-wiki is a genuinely good pattern. It is also a **flattening** of the
substrate onto the file system — the cortical map layer, and *only* that layer,
rendered as markdown. Take its three parts and watch each one generalise:

| LLM-wiki layer | Substrate generalisation | What the substrate adds |
| --- | --- | --- |
| **Immutable raw sources** | `source` / `capture` / `file` facts; `_public/file/*`; supersede-not-delete | server-stamped provenance (`writer`, `revision`, `seq`), so a source is *attributed* and *immutable-by-lineage*, not merely a read-only file |
| **The evolving wiki** | `kb/*` — `knowledge` / `mental-model` / `decision` / `question` facts | **salience** (a perceptual gate, not a flat file); **dual edges** — authored `links` *and* machine-inferred `similarTo`, with `ratify` to promote a hunch to an assertion; **views** as complementary lenses over the same facts |
| **The schema / instructions** | `_types` vocabulary (ADR: type → managing cell + open/edit/render handlers); protocol facts (`tending` v4, `weave`); registered actions/views/subscriptions; `CLAUDE.md` / ADRs | the schema is not a passive doc — it is the **genome / developmental constraint system**, and it is itself substrate state an agent can read, revise, and *tend* |
| **Ops: ingest / query / lint** | `ingest` / `query` + `search` / `attention` + `tend` | lint is not a batch script over files; it is a **derived read** the substrate always exposes, plus a run that files its own audit back as a fact with a `delta` |

The single sentence that carries this document:

> **RAG is reflexive lookup (spinal). The Karpathy wiki is a cortical map
> (pallium). The substrate is the whole organism** — perception, attention,
> action-selection, memory, self-maintenance, and the reflexive growth of its own
> organs.

The wiki's own aspiration — "answers file back into the wiki, so exploration
compounds" — is the substrate's founding move (`facts over events`; *the
projection is reality, the log is implementation*). This very document is filed
back into the substrate as `kb/cognitive-substrate`, linked into the corpus it
describes. Exploration compounding is not a feature we should add. It is the axiom
we started from.

---

### 4. Where the substrate is already ahead of the framing

The framing treats the richer architecture as future work. Four pieces of it are
load-bearing today:

1. **Salience is a first-class perceptual gate, not prose.** The framing's
   attention layer is, in the wiki, at best an ordering convention. Here it is
   `focus` / `peripheral` / `elided` bands computed from the trajectory, shaping
   what every read even *shows* — the tectum, wired in under every observation.

2. **Edges are dual, and promotable.** The wiki has flat `[[links]]`. The
   substrate has **authored** edges (a person or grant asserted this) *and*
   **inferred** `similarTo` edges (the vector index proposed this) — machine
   pattern-completion running alongside asserted structure, with `ratify` and
   `pruneSimilar` to move mass between them. That is hippocampal completion and
   cortical consolidation, kept as *distinct signals*.

3. **Dual projection: one surface → MCP tool + UI.** *"A button for a human and a
   JSON affordance for an agent are the same surface expressed through different
   modalities."* The interface is a perceptual layer over shared truth, not a
   separate build. The wiki has no equivalent — it is human-readable *or*
   agent-parsed, never one declaration rendered twice.

4. **Organs and reflexivity — compute the wiki structurally lacks.** A `cell` is a
   bounded, serialized state machine (Lambda + table + scoped role) that emits
   monotonic facts back to the reef — the Σ-calculus non-monotonic escape hatch.
   And `cells.create` makes *new organs at runtime*: neurogenesis. Declared
   vocabulary makes *new fact kinds and verbs* at runtime: development without a
   core edit. A markdown wiki cannot grow itself an organ.

---

### 5. The frontier — the unbuilt cerebellum

Here the framing and the substrate agree on exactly the same missing piece, from
opposite directions. The framing's "correction / cerebellum" layer — *did the
update break links? contradict newer evidence? drift from schema?* — is the one
layer the substrate **measures but does not yet close**.

**The evidence is in our own telemetry.** The `machine/tending` audit for
2026-07-08 reports, verbatim:

> *"Backlog remains chronic: stale=195 (flat vs 194 on 07-07), unlinked=396 (still
> growing, 391→396, despite two weave dispatches on 06-24 and 07-03 that haven't
> dented the trend), dangling=3 (same cluster flagged for weeks). Third consecutive
> driven run seeing this frozen/growing pattern."*

The loop **perceives** the drift perfectly and **corrects** it barely. It counts;
it does not converge. That is a cerebellum that fires but whose output never
reaches the muscle. `adaptive-salience.md` named the root cause a season ago, and
it is worth quoting because it *is* the frontier:

> *"The substrate generates trajectories but has no opinion about their quality …
> can the self-model develop an opinion about the quality of its own accreting
> vocabulary, rather than just accumulating?"*

Three specific holes follow, each mapping to a cognitive function that is present
in structure but thin in function:

- **No reward signal (`R(s,a,s′)`).** The room *is* a world model — state = world,
  actions = transition function, views = observation function, the audit log = the
  trajectory (`adaptive-salience.md`, §II). The one cell missing from that table is
  reward. Without it, the tending loop has no gradient to descend: it re-reports
  chronic debt because nothing scores debt-reduction as *better*.

- **No consistency / contradiction primitive.** The wiki's headline promise — "the
  LLM detects contradictions" — is aspirational *here too*. Two facts can assert
  opposing claims and sit peacefully in the same slice; nothing surfaces the
  tension. (Cf. the Elicit trajectory doc, §5: the cross-lens propagation /
  internal-consistency problem.)

- **Semantically inert edges.** Links are typed but not *causal*. The pallium's
  distinctive trick — **simulation**, answering *what if* — needs edges that carry
  `causes` / `enables` / `predicts` semantics. Today the map is a map of
  association, not of consequence, so counterfactual query is out of reach (Elicit
  doc, §1, "Next": a causal/probabilistic edge layer).

The frontier, precisely stated: **the substrate has grown every organ except the
one that keeps the others honest.** Not more maps — a loop that corrects the maps.

---

### 6. Concrete primitive proposals — closing the loop

Named against real files, cells, and gaps, in the spirit of
[`substrate-gaps.md`](./substrate-gaps.md). Each is a *substrate-native* move, not
an orchestration bolt-on: it emits facts, declares vocabulary, or exposes a read.

1. **The Consolidation Organ (the cerebellar loop).** Promote `machine/tending`
   from *counting* to *correcting*. A `cell` that, each cycle, reads `changes`
   (recent trajectory) + `attention` (stale / unlinked / dangling), and instead of
   reporting the backlog, *acts on a bounded slice of it*: proposes `link` edges
   for the highest-salience unlinked facts, `ratify`s the strongest `similarTo`
   candidates, `supersede`s confirmed-dead facts — then emits a **quality delta**
   (backlog moved, not backlog observed). The audit fact already carries `delta`;
   today it stays flat. This makes the flat delta the thing the organ is *scored
   on*. Scaffolding exists (`machine/tending`, the `weave` protocol); the change is
   turning a report into a closed loop.

2. **The `_contested` view (contradiction detection).** A `registerView` that
   surfaces pairs of facts that are *semantically near* (vector-adjacent) yet make
   *divergent claims* — the contradiction detector the wiki only promises.
   `adaptive-salience.md` already posits a `_contested` synthetic view as
   precedent; this makes it a real, standing read. Consumers: the consolidation
   organ (resolve or flag), and the human surface (a "tensions" panel).

3. **The vocabulary-quality (reward) signal.** The missing `R(s,a,s′)`. Score,
   over the trajectory, whether newly registered vocabulary *enabled novel
   behaviour* (it got invoked, it unblocked work) versus *accreted and was routed
   around* (high message volume, low action invocation — `adaptive-salience.md`'s
   own diagnostic). Store it as an input to salience, so vocabulary that earns its
   keep rises and dead vocabulary evaporates. This is the substrate developing the
   *opinion* it currently lacks.

4. **The causal edge layer (simulation).** Extend the `rel` vocabulary with
   consequence-bearing types — `causes` / `enables` / `contradicts` / `predicts` —
   or a `world-model` view type over them, so the pallium can answer *what-if*
   queries by traversing consequence rather than mere association. This is the
   Elicit doc's §1 "Next," and it is what turns the map from a card-catalogue into
   a model you can run forward.

Sequenced: **(2) before (1)** — the organ needs the contradiction read to act on;
**(3) alongside (1)** — the reward signal is what stops the organ from thrashing;
**(4)** is the longer arc, the one that earns the word *simulation*.

The first two are specified build-ready in
[`cerebellar-loop.md`](./cerebellar-loop.md) — the consolidation organ and the
`_contested` view, against the real primitives named above.

---

### 7. Substrate-native artifacts — the surface layer folds back in

The visual plate that accompanies this document is, today, a *claude.ai* artifact:
a standalone HTML page hosted outside the substrate. That is a small betrayal of
the thesis — the surface is supposed to be a projection *of* shared truth, not a
thing that lives beside it. So: could an artifact be **substrate-native** — a page
served from the substrate itself, at its own URL?

It essentially **already works**. Three mechanisms bear on it, and the smallest
path uses none of them new:

- **(a) An artifact as a public file under one cell.** `cells.putData` stores a
  blob in a cell's per-caller space; the `public/` sub-space is served straight
  from S3 at `GET /@<owner>/<cell>/_data/<user>/public/<key>` with its stored
  content-type (`services/cells/service.ts:482-501`), gated by the same `_public/`
  anonymous-read mechanism that already makes lit docs and canvas boards publicly
  viewable. Write an `.html` blob with `content-type: text/html` and you have a
  browsable, substrate-hosted page **now** — no platform work. The only polish is a
  friendlier URL, which is exactly what the `_types` `open.surface` handler
  (`type-vocabulary.md`) is for.
- **(b) An artifact as a backend-less cell.** A cell with no table/reads/writes is
  already valid — `viewers` and `kernel` serve only static assets
  (`cell-contract.md`). An artifact could be a de-featured `starter` that serves its
  `static/` files at `/@owner/<name>` (and `<owner>-<name>.on.parc.land`). It works,
  but pays a CFN-stack-per-artifact cost — heavy if artifacts are numerous. This is
  the parked *"declarative cells"* tier (`dynamic-cells.md`).
- **`ui://` is a third, orthogonal modality.** The `ui://@owner/cell/…` scheme
  (ADR-0039, `services/gateway/widgets.ts`) is a renderer *fragment run inside a
  host's card*, resolved through the gateway — the **embed-in-a-surface** modality,
  not **open-in-a-tab**. It is how a fact renders inline on a board or in home, not
  how an artifact gets a standalone URL.

**Recommendation: framing (a)** — an artifact is a `public/` HTML blob (or a
`file` fact whose managing cell SSRs it), cheap and already shipped. The one
load-bearing caveat for *any* user-authored HTML is **origin isolation**: arbitrary
scripts must be served from an isolated cell origin (`<owner>-<name>.on.parc.land`
or a separate user-content domain), never the apex `parc.land`
(`cell-origin-isolation.md`). With that settled, the plate stops being a page
beside the substrate and becomes a fact inside it — the surface layer folding back
into the truth it projects, which is the whole point.

---

### 8. Appendix — the capture: consolidation opportunities & gaps

A full primitive inventory (the source for the plate's expandable cards) surfaced
two lists worth keeping. Per the "capture first" discipline, these are **recorded,
not actioned** — naming them is the work here.

**Consolidation opportunities** (the vocabulary has accreted; some verbs overlap):

- `search` is deprecated → `query({ text })`; three semantic entry points
  (`search` / `query({text})` / `recall({text})`) share one ranking core.
- `links` / `graph` / `neighbors` / `$graph` → one edge-query with
  `derived?` / `keys` / `dir` flags.
- The `register* / list / delete` triplets (actions · views · subscriptions) are
  one lifecycle over a generic registry → `declare(kind)` / `undeclare` / `list`.
- One async job+poll primitive would remove the duplicate `fetch` on `@c15r/run`
  and `@c15r/models`; `models.run` vs `models.agent` could be one tool with a
  `loop` flag.
- `@c15r/input.capture` and `@c15r/reef-writer.report` are thin `remember`/`ingest`
  wrappers → `remember` presets or declared actions.
- `reindex` / `project` / `pruneSimilar` / `tend` are all admin homeostasis passes
  → one `maintain({ task })`.

**Gaps** (functions present in structure, thin or absent in fact):

- **No forgetting / compaction** — supersede tombstones, the archiver retains
  everything, standing only grows; no GC, decay-to-cold, or summarizing memory
  consolidation.
- **No persistent global goal/attention state** — `relevance` biases a read only
  when `text` is passed that call; no standing "current goal" auto-conditions
  recall.
- **No non-text semantic reach** — images/PDF/audio need an extraction lane that
  doesn't exist (`vectors.ts`).
- **Maps are PCA-only** — UMAP is intended behind the same seam (`projection.ts`).
- **No salience learning loop** — weights are hand-tuned (`_config/salience`);
  nothing feeds observed usefulness back. This is §5's reward-signal gap, seen from
  the perception side.
- **Reflex scheduling is ad hoc** — per-fact timers + a daily `tend` cron; no
  first-class recurring primitive.
- **Cross-slice retrieval is limited** to the shared public index; no federated
  multi-owner semantic search.

Several of these are the same animal wearing different coats — the reward-signal
gap shows up as tending that won't converge (§5), as salience weights that can't
learn (here), and as vocabulary that accretes without an opinion
(`adaptive-salience.md`). Closing the cerebellar loop is load-bearing for more of
the stack than it first appears.

---

### 9. Coda — a fifth lens on the convergence

There is a live open question in the slice, `kb/26e75e4ae7034c`:

> *Is `proj_mental_models` a fourth thread of the Three-Project Convergence (ctxl,
> sync, playtest), or a distinct concern? … it doesn't obviously map to the
> Participants → Surfaces → Derived Meaning → State → Organs stack.*

The neuro-cognitive framing answers it obliquely. The convergence stack and the
evolutionary stack are the same architecture seen inside-out (§1). On that reading,
**Mental Models is the cortical / simulation layer aimed at human cognition** —
tools for thinking are pallial maps rendered for a person rather than for an agent,
the same *derived-meaning-as-affordance* move ctxl makes, pointed at the human
observer instead of the agent one. It is not a fourth thread. It is the same
Surfaces layer, in the modality the substrate thesis already insists is equivalent:
*a button for a human and a JSON affordance for an agent are the same surface.*

Which returns us to where the framing ended and the substrate began: the frontier
is not better agents in isolation. It is **agent + substrate co-evolution** — the
organism and its nervous system growing together, kept honest by a loop that
corrects them both. We have built the organism. The next primitive is the one that
keeps it from lying to itself.

---

*Filed to the substrate as `kb/cognitive-substrate`, linked to the tending
protocol, the mental-models project, and the convergence question above — because
a document about knowledge that compounds should compound.*
