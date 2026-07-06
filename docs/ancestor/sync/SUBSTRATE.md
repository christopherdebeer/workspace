# The Substrate Thesis

> Condensed version. For the full intellectual genealogy — games, blackboard AI, tuple spaces, FRP, stigmergy, and forty years of converging research — see [Introducing Sync](introducing-sync.md).

**Software is a shared substrate of truth observed by self-activating components.**

Three projects — ctxl, sync, playtest — arrived at this sentence independently, from different starting points. This document explains what it means and why it matters.

---

## The Blackboard, Forty Years Later

In 1986, H. Penny Nii described the blackboard model of problem solving: a global data structure observed by independent knowledge sources that activate themselves when they recognize conditions they can contribute to. No control flow. No orchestration. The knowledge sources are self-activating. The solution is built incrementally, one step at a time, opportunistically.

Nii's description of the blackboard framework makes three commitments that matter here. First, each knowledge source is responsible for knowing the conditions under which it can contribute — activation is local, not dispatched. Second, all interaction among knowledge sources takes place solely through changes on the blackboard — there is no direct communication. Third, the solution space is organized into application-dependent hierarchies with structured vocabularies at each level.

The first two commitments hold up. The third is where the substrate thesis departs.

Nii's blackboard systems assumed rigid schemas and deterministic programs operating in structured solution spaces. HEARSAY-II had acoustic, phonetic, syllabic, word, and sentence levels. HASP had signal, harmonic, source, and platform levels. The hierarchy was designed in advance. The vocabulary was fixed.

What happens when you keep the self-activation and the shared-truth-as-communication principles, but replace the structured hierarchy with open-world state and the procedural knowledge sources with interpretive agents?

You get something that behaves less like a problem-solver and more like an ecosystem.

---

## Three Discoveries

**ctxl** started from the observation that people need tools they cannot build because building tools requires programming — itself a tool. LLM generation breaks this loop momentarily, but generated interfaces are snapshots. They freeze intent at the moment of generation. Intent evolves through use.

The insight: the interface must remain alive to reasoning. Instead of a component that occasionally calls AI, reasoning participates inside the component lifecycle. Props become context. Render becomes expression. Effects become reasoning. The component does not use intelligence. The component is intelligent. Hence: *you are the component.*

**sync** asked what happens when many intelligent components share the same world. The architecture shifts from component lifecycle to shared state substrate — a persistent, multiplayer truth layer where participants observe and modify a common reality through two operations: read context, invoke actions.

The critical move: state becomes primary. The UI is no longer the source of truth — it is a projection of truth. Agents, dashboards, and API consumers all observe the same substrate. Every write flows through actions. Every read returns full context. The room's structure is the protocol.

**playtest** exposed why flow-based design fails on a reactive substrate. Attempts to script experiences with compound boolean gates, history-dependent visibility, and coupled transitions produced fragile orchestration — symptoms of imposing a state machine on something that wants to be a coral reef.

The discovery: a *surface* is a declarative observer of shared state that activates itself when relevant. No controller decides what appears. Each surface carries its own activation contract. Components respond locally. Structure emerges globally.

---

## Where the Blackboard Breaks

Nii identified three components: knowledge sources, blackboard data, and control. She noted that "there is no control component specified in the blackboard model" but that practical systems always needed one — a scheduler, a focus-of-attention mechanism, something to decide which knowledge source fires next.

This is the fundamental tension in blackboard architectures: the model is conceptually controllerless, but every implementation reintroduces control through the back door. HEARSAY-II had a scheduler. HASP had task-driven event processing. The control problem was never solved — it was deferred to engineering.

The substrate thesis resolves this differently. In sync, control is not centralized and not deferred. It is dissolved into the agents themselves. Each agent runs a two-call loop: wait for a condition to become true, then act on what you see. The wait condition is a CEL expression — a declarative statement of relevance, exactly Nii's "knowing the conditions under which it can contribute." But instead of a scheduler polling knowledge sources for readiness, each agent blocks on its own relevance predicate. Control becomes self-selected attention.

The second departure is capability delegation. Nii's knowledge sources modify the blackboard directly — they have implicit authority to write wherever needed. In sync, writes are mediated through actions that carry scoped authority. An action registered by Alice, scoped to Alice's private state, can be invoked by Bob — and Bob's invocation writes to Alice's scope using Alice's authority, not his own. This is capability-based security applied to blackboard writes. It enables trust boundaries, role-based access, and delegation patterns that the original blackboard model never addressed because it assumed cooperative, deterministic programs rather than autonomous, potentially adversarial agents.

The third departure is interpretation as a first-class layer. Nii's hierarchical levels performed implicit interpretation — acoustic features became phonemes became words. But the interpretation was fixed at design time, encoded in the knowledge sources. In sync, views are declarative CEL expressions that project private state into public meaning. They are registered dynamically by agents, scoped to the registrar's authority, and evaluated lazily at read time. Interpretation is not baked into the architecture — it is a composable, runtime-configurable layer of the substrate itself.

---

## The Unified Claim

Across all three projects, the same structure appears at different scales. ctxl: intelligence inside a component. sync: intelligence across shared state. playtest: experience emerging from self-activating observers. They converge on a single architecture:

State is the substrate. Actions are transitions with scoped authority. Surfaces are self-activating observers. Derived meaning is a declarative layer between raw state and perception. And agents, humans, and interface components are equivalent participants — distinguished not by kind but by the modality of their observation.

When these conditions hold, new surfaces can be added without modifying existing ones. New actions introduce new realities without rewrites. Agents and humans collaborate without coordination logic. Design shifts from scripting behavior to shaping conditions under which behavior can arise.

The blackboard model described this possibility in 1986. Nii quoted Newell from 1962: workers around a blackboard, each self-activating, knowing when their pieces fit. Selfridge's Pandemonium in 1959: demons shrieking in proportion to what they see.

The substrate thesis is not a new idea. It is an old idea meeting its proper medium. When the knowledge sources are language models that can interpret open-world state, when the blackboard is a real-time shared substrate accessible over HTTP, and when surfaces can be defined declaratively in the state itself — the control problem dissolves, the schema problem dissolves, and the boundary between using software and creating it dissolves with them.

Programs execute. Ecosystems emerge. You are not operating the system. You are a participant organism inside it.

*You are the component.*

---

*February 2026 · Edinburgh*
*ctxl · sync · playtest*
