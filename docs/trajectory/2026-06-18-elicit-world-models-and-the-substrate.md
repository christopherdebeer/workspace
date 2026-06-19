# Elicit's world models and the substrate — parallels and future directions (2026-06-18)

> Source: a 2026 *Cognitive Revolution* conversation with Andreas Stuhlmüller and
> Jungwon Byun (Elicit/Ought) on world models for research. Listened end-to-end
> and read against the substrate corpus. The thesis below is not analogy-hunting:
> Elicit, coming from the research-application side, states parc.land's founding
> bet almost verbatim — and their lived experience is an unusually good source of
> roadmap pressure on the substrate's open edges.

## The converging bet

Andreas, on why knowledge should live outside the weights:

> *"How do you make progress on continual learning in a way that is not stuff
> just living in the weights of the language model, but is available to humans as
> a representation we can inspect and understand?"*

That is the substrate's reason to exist (`docs/substrate.md`: *"vocabulary is the
protocol"*). Elicit is building **world models for research decisions**;
parc.land is the **general substrate** such world models would live in. The
fluid model orchestrates; the legible, discrete substrate is the trusted floor
(CAS / leases / supersede-not-delete give the stability the model lacks — the
"easy to push around" problem, externalized into stable state).

## Seven parallels, each pointing somewhere

### 1. World models *are* the substrate
**Elicit** starts at a Karpathy-style markdown wiki, then wants representations
that answer **prediction / intervention / counterfactual** questions, stay
**internally consistent**, and admit *multiple complementary lenses* of one
entity (graph / spreadsheet / tech-tree) with **propagation between them**.
**parc has:** facts + typed edges + `_types` + `[[wiki-links]]` as edges with
backlinks; **views** are the "complementary lenses." **Next:** edges are
semantically inert today — a **causal/probabilistic edge layer** (or a
`world-model` view type) that supports counterfactual queries; and a
**consistency primitive** for the cross-lens propagation problem (see §5).

### 2. Process supervision & "certificates of reasoning"
**Elicit:** the failure mode is "you're right, I didn't analyze 100 papers"; the
dream is an output that carries proof the right steps happened — *"the tool calls
are important reasoning facts in and of themselves… the proof is in the
process."* **parc has:** `writer`/`via`/`writers[]` on every write, the
`changes`/trajectory feed as a process log, recorded action invocations. **Next:**
a first-class **certificate**: a `conclusion` fact edged to the `evidence` facts
it rests on and the action-invocation that produced it — "how would this change
under different input?" becomes a graph traversal, not trust.

### 3. The reasoning DSL ↔ declared actions
**Elicit** built a DSL of reasoning primitives the model *writes*, run
**guaranteed-as-defined** ("the same process for object #5 and #9,999"); north
star: reduce a fuzzy hard-to-verify task to a **graph of easy-to-verify**
subtasks. **parc has:** declared actions — bounded, templated, audited, "the
substrate interprets; no code runs." **Next:** parc has the primitive but not
**composition** — **routines** that chain actions and `map(action)` over a
`query` result set turn declared actions into Elicit's "reasoning
microservices." Composes with the richer `query` filters in the API-friction plan.

### 4. Claims, confidence, evidence quality ↔ salience v2
**Elicit:** stop trusting citation-count proxies; quality is domain-specific and
**user-expressible**; break insights into **claims with confidence + support**,
not binary truth. **parc's open question:** salience ≈ recency × write-velocity,
so *attention ≠ importance ≠ truth* ("the most recently dragged canvas element is
the most salient fact"). **Next:** a **`claim` type** `{statement, confidence,
support[]}`; **salience v2** weighting *type / namespace / source quality* as
first-class signals, separating "active" (attention) from "load-bearing"
(standing). The conversation is almost a written spec for the salience-v2 pass
both ergonomics reviews deferred.

### 5. Internal consistency ↔ semantic tending
**Elicit** wants representations whose answers are internally consistent —
"logical consistency checks, sensitivity analysis," not step-by-step replay.
**parc has:** `attention`/`tend` surfacing stale / unlinked / **dangling** facts
— *structural* coherence. **Next:** extend tending to *semantic* coherence — a
**contradiction relation** + a pass that flags `claim` facts whose statements
conflict, or lenses of one entity that disagree. Closes §1's propagation loop.

### 6. "The line" ↔ protocols-as-data + escalation gates
**Elicit's** self-running SWE pipeline (Slack-emoji → spec → implement → test →
review → merge, **30–50 PRs/week**, goal: runs over the holidays); the hard part
is **calibration about when to pull in a human** ("80% reviewable-accuracy isn't
good enough"). **parc has:** declared-action `if`/`enabled` (the trigger analog),
run lifecycle, cell deploys, events, and a **grant-request/approve flow that is
already a human-in-the-loop gate**. **Next:** **routines + confidence-gated
escalation** — a step whose precondition fails auto-escalates via `grantRequests`;
this is also the agent-facing **run/audit entity** both reviews flagged
(`beginSession`/`endSession` is the lightweight first rung).

### 7. Legible discretization over neuralese
**Elicit's** defense of discretization (error correction, no compounding errors,
"why don't models write programs in weight space?") and the closing optimism that
legible, truth-seeking reasoning can win — *"better reasoning begets better
reasoning."* **parc is that bet instantiated:** a discrete, legible, inspectable
substrate over opaque weights. Where Elicit argues for the future, parc builds
the room.

## What to build (ranked seeds)

The primitives above, ordered by *keystone-ness* (how many others depend on them)
÷ cost. These extend the API-friction plan's tiers as the **directional** layer —
that plan makes the surface usable *now*; this makes it a world-model substrate.

1. **`claim` type** (keystone). `{statement, confidence, support[]}` as a
   declared type with a value `schema` (also the §8/B1 "per-type value schema"
   win). Cheapest; §2/§4/§5 all build on it. Seeded today (see below).
2. **Certificate edges** (§2). `evidence` / `grounded-in` / `derived-from`
   relations + a `conclusion` fact convention; trajectory already records the
   process half. Mostly a link-vocabulary + a view.
3. **Semantic tending** (§5). A `contradiction` relation + a tending category
   over `claim` facts. Reuses `attention`'s edge/index pass.
4. **Routines + escalation** (§3/§6). Compose declared actions; `map` over a
   query; precondition-fail → `grantRequests`. The "line," substrate-native.
5. **Causal/probabilistic edges + world-model view** (§1). The richest, least
   settled — deserves its own decision doc (causal semantics, counterfactual
   query surface, the cross-lens propagation rule).
6. **Salience v2** (§4). Weight type/namespace/source; split attention from
   standing. The long-open question; this conversation is its design brief.

## First seeds planted (living substrate)

To seed the soil rather than only describe it, the keystone (#1) was planted as
data via the gateway — vocabulary-as-data, the substrate's own move applied to
itself:

- `_types/claim` — the `claim` type declaration, carrying a machine-readable
  value `schema` (demonstrating the per-type-schema direction in one fact).
- `source/elicit-cogrev-2026-06-18` — the conversation as a provenance/source
  fact (type `source`).
- `claims/world-models-outside-weights` — an exemplar `claim` (statement +
  confidence + support), `grounded-in` → the source fact.

All tagged `seed`,`world-model` for easy retrieval and cleanup. They are the
first instance of the substrate holding its own roadmap as inspectable facts.
