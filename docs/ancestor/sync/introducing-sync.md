What follows is not a technical introduction so much as a narrative argument — tracing a line from three games that each grapple with the same hidden question, through decades of research that arrive at the same threshold from different directions, to a small system that attempts to cross it.

The question: **What does it mean to interact with a world that already exists?**

---

## I. The Fire in the Dark

The original *A Dark Room* begins almost aggressively small. A single line of text. A cold fire. One button. Nothing to optimize, nothing to explore, nothing even resembling a game in the conventional sense. The player is not invited into a world so much as left alone in an absence.

Then something subtle happens. You light the fire, and the interface does not change — it grows. A villager appears. A resource counter materializes. A new action becomes available. Another. Then another. Hours later, you realize you are managing a settlement, sending expeditions into hostile territory, navigating a map, fighting enemies, and uncovering a narrative that quietly recontextualizes everything that came before.

What makes *A Dark Room* remarkable is not its mechanics but its restraint. The game refuses the traditional grammar of video games: no level transitions, no menus replacing menus, no explicit chapters. Instead, the same screen accumulates meaning. The player never moves forward through space; the world thickens around them.

This produces a peculiar psychological effect. Progress feels less like advancement and more like discovery. The player does not believe new systems are being introduced; they feel as though hidden layers are being uncovered. The interface behaves like sedimentary rock — each mechanic another geological layer exposed over time.

And yet, beneath this illusion lies a carefully authored structure. The game is not truly emergent. Its revelations are staged, gated by hidden thresholds and progression flags. The village appears because a variable crossed a number. Exploration unlocks because an invisible phase has been reached. The world is not growing; it is unfolding according to plan.

But the player experiences something else entirely: the sense that meaning arises from accumulated reality rather than authorial command. *A Dark Room* succeeds because it lets perception outrun implementation. It gives players the feeling of inhabiting a living substrate even though the machinery underneath remains linear.

In retrospect, the game feels like a cultural premonition — an early glimpse of an interaction model that the technology of its time could only approximate.

The AI researchers of the 1970s would have recognized the feeling immediately. Barbara Hayes-Roth called it **opportunistic problem solving**: the idea that intelligence emerges from local activation rather than centralized planning. No master planner selects the next step. Modules act when local conditions become true. The solution assembles incrementally through the accumulation of locally-justified contributions.

HEARSAY-II, HASP, and the broader blackboard architecture program were all attempts to operationalize this. A shared workspace — the blackboard — held partial solutions. Independent knowledge sources watched for patterns they could contribute to. The difficulty was always the same: the conceptual model was controllerless, but every implementation reintroduced scheduling through the back door. The knowledge sources were hand-coded pattern matchers, too brittle for the open-ended coordination the architecture imagined.

*A Dark Room* succeeded as an experience because it let the player feel what opportunistic activation would be like — the world assembling itself through local contributions — while hiding the fact that the machinery underneath was doing exactly what the blackboard researchers could never avoid: following a centralized script.

---

## II. The Border Checkpoint

If *A Dark Room* hides its structure to create the illusion of emergence, *Papers, Please* does the opposite. It places structure directly in front of you and asks you to live inside it.

You are an immigration inspector in a fictional authoritarian state. Each day new rules arrive: passports must include seals, permits must match dates, citizens from certain regions require additional documentation. People step forward carrying fragments of identity — papers, stories, inconsistencies. Your job is to decide whether their claims align with the current definition of truth.

The genius of *Papers, Please* is that it transforms bureaucracy into cognition. The player is not solving puzzles but reconciling facts against an evolving ontology. Every entrant becomes a hypothesis; every stamp is an assertion about reality. The game world does not progress through narrative events but through regulatory change. Truth itself is unstable.

Unlike *A Dark Room*, nothing here is hidden. The rules are explicit, mechanical, almost tedious. Yet meaning emerges from their interaction. Compassion conflicts with compliance. Efficiency conflicts with survival. The player gradually realizes that the system itself — not any individual story — is the antagonist.

Here, discovery comes not from new mechanics but from reinterpretation. The same act — checking documents — acquires moral weight as context accumulates. The player's understanding evolves even when their actions remain identical.

James Gibson, writing in 1979, would have called the border checkpoint an environment of **affordances**. His ecological psychology proposed that environments present possible actions directly to perception. A flat surface affords sitting. A handle affords pulling. An affordance is not a property of the object or a property of the agent — it is a relationship between the two.

*Papers, Please* is an affordance engine. Each entrant's documents afford approval or rejection; each rule affords enforcement or mercy. The player perceives these possibilities not through instruction but through the structure of the encounter itself. Donald Norman adapted Gibson's insight for design: affordances should be perceptible, not hidden. *Papers, Please* takes this further — its affordances are explicit, mechanical, and yet morally charged. The structure does not tell you what to do. It tells you what you *can* do, and the gap between possibility and conscience is where the entire game lives.

Database researchers arrived at a parallel structure through a completely different door. Event-Condition-Action systems in 1990s databases explored trigger rules: on an event, if a condition holds, execute an action. The structural similarity to *Papers, Please* is almost exact:

```
ECA:        ON event  →  IF condition  →  DO action
Inspector:               IF condition(documents, rules)  →  STAMP decision
```

But there is a critical substitution. ECA systems automate — the action fires without human involvement. The border checkpoint *presents* — it exposes the decision to a perceiving agent. The system shifts from automation to participation. The observer decides. This distinction matters. An ECA system that fires automatically is an optimizer. A checkpoint that presents options is a collaborator.

---

## III. Knowledge as Progress

There is a third lineage of games that makes this trajectory clearer, and its clearest example is *Outer Wilds*. Unlike the other two, *Outer Wilds* barely changes its world at all. The solar system resets every twenty-two minutes. Objects remain where they always were. No skills unlock, no statistics increase.

The only thing that changes is what the player knows.

A door that once appeared meaningless becomes obvious once a clue is understood. A planet that seemed hostile reveals a precise logic once its behavior is interpreted correctly. Progress exists entirely within cognition. The game's state remains constant; the player's mental model evolves.

In this sense, *Outer Wilds* completes a progression implicit in the earlier games. *A Dark Room* expands the world. *Papers, Please* evolves the rules. *Outer Wilds* transforms understanding itself into the primary mechanic.

These three approaches describe three different relationships between player and system:

- discovery through expansion,
- discovery through interpretation,
- discovery through understanding.

All three attempt to answer the same design problem: how to make interaction feel like genuine learning rather than scripted advancement.

Lucy Suchman, writing in 1987, gave this a theoretical name: **situated cognition**. Thinking, she argued, does not happen in internal representation and then get applied to the world. It happens *in interaction with* the environment. Plans are not executed — they are resources for action in context. Cognition is not a program running in the head; it is a dynamic coupling between agent and world.

*Outer Wilds* is situated cognition turned into a game mechanic. The player cannot think about the solar system in the abstract — they must fly to the planet, land on the surface, read the inscription, and let the environment itself restructure their understanding. Progress is not something the player carries; it is something that emerges from the encounter between what they know and what the world presents.

Clark and Chalmers pushed this further in 1998 with the **extended mind thesis**: if an external resource plays the same functional role as an internal cognitive process, it is part of cognition. The notebook is part of memory. The calculator is part of arithmetic. And in *Outer Wilds*, the solar system itself is part of the player's reasoning — a vast, looping cognitive artifact that yields understanding only through embodied exploration.

Conal Elliott and Paul Hudak were chasing a related insight in computer science. **Functional reactive programming** (1997) proposed that behavior is a function of time-varying values. Signals change; dependent computations recompute. The entire system is a declarative dependency graph over time. FRP stalled for two reasons: humans reason poorly about continuous time, and dependency graphs explode combinatorially at scale. But its core claim — that observation should be declarative, that the system should recompute meaning when the underlying facts change — captures exactly what *Outer Wilds* does to the player. The solar system is the signal. Understanding is the dependent computation. Each loop through the twenty-two-minute cycle recomputes what the player knows.

---

## IV. The Missing Architecture

Seen together, these games reveal a historical pattern. Designers have repeatedly tried to create experiences where meaning emerges rather than being delivered. Each succeeded aesthetically but was constrained technically.

*A Dark Room* simulates emergence atop hidden progression logic.
*Papers, Please* exposes a rule system but keeps authorship centralized.
*Outer Wilds* achieves epistemic progression but relies on a fixed, handcrafted world.

In every case, the player experiences a living system, but the system itself cannot truly evolve beyond its author's foresight. New behaviors cannot attach themselves dynamically. New perspectives cannot become first-class participants in the world's operation.

The illusion of emergence is powerful precisely because it hints at something just beyond reach: a world where interaction is not traversal through prewritten states but participation in an ongoing reality.

---

## V. The Pressure Field

These three games are not isolated experiments. They sit inside a much larger pressure field — decades of research that each arrived, independently, at something close to the same threshold. The pattern repeats across eras, disciplines, and paradigms. Every generation builds a piece of the architecture. Every generation encounters the same constraint.

David Gelernter's **Linda** (1985) proposed the most radical coordination primitive in the history of distributed systems: processes should not know each other exists. They coordinate through a shared associative space. Three operations — `out` (write a tuple), `rd` (read by pattern), `in` (read and consume) — and nothing else. No channels, no addresses, no identity. Linda had the shared substrate, the write-and-observe loop, the structural anonymity between participants. But processes could not *interpret* unstructured tuples. The readers were procedural — they matched patterns literally, not semantically. The tuple space was a world, but nobody in it could understand what they were looking at.

Carl Hewitt's **actor model** (1973) took the opposite path — isolating state inside processes and coordinating through message passing. No shared memory. No shared truth. Actors gained safety and predictability at the cost of shared understanding. They solved the coordination problem by eliminating the thing that needed coordinating.

**Artificial life** research (Langton, 1989; Reynolds, 1987) demonstrated that simple local rules produce global structure — flocking, self-organization, emergent complexity. But the emergent structures were geometric or statistical, not meaningful. No agent in a boid flock understands that it is flocking.

And then, in a remarkable recapitulation, the AI community of the 2020s built the same set of approaches again — this time with language models as the computational substrate.

**ReAct** (Yao et al., ICLR 2023) interleaves reasoning traces with action execution inside a single generation. The agent thinks, calls a tool, observes the result, thinks again. It is powerful for single-agent tasks. It is also, structurally, a tool-use pattern: the agent is the protagonist; the environment is a service counter; the observation is the result of the agent's own action. ReAct has nothing to say about shared worlds or coordination. It is a single rider on a single bicycle.

**AutoGen** (Wu et al., 2023), **CAMEL** (Li et al., NeurIPS 2023), and Google's **A2A** protocol coordinate agents through conversation — direct message passing, agent-to-agent, by name. This is the actor model reborn: coordination through explicit communication rather than shared truth. The wiring complexity scales with the number of agent relationships. Every new participant must be introduced to the existing conversation.

**LangGraph** models agents as nodes in a directed graph with state flowing along edges. **MetaGPT** (Hong et al., 2023) encodes Standardized Operating Procedures — fixed role sequences modeled on organizational charts. **CrewAI** combines event-driven Flows with role-specialized Crews. These are orchestrated workflows: someone must design the graph, write the SOP, define the flow. Structure is imposed, not emergent. The blackboard's centralized scheduler, wearing new clothes.

One published system breaks the pattern. Park et al.'s **Generative Agents** (UIST 2023) — the Smallville paper — placed twenty-five LLM agents in a shared simulated environment. Agents coordinated not through messages but through the environment itself: they observed each other's actions, perceived the state of shared spaces, and self-activated based on what they saw. A single seed — one agent wanting to throw a Valentine's Day party — cascaded through the environment as agents observed, inferred, and responded. Social structure emerged without orchestration.

Smallville is the most important empirical result in this story. It demonstrates that environment-mediated coordination produces emergent behavior in LLM multi-agent systems. It is also, still, a simulation — no authority model, no capability delegation, no structured observation, no declarative activation. Agents run on a clock tick and decide for themselves whether to act. It proved the thesis without providing the infrastructure.

Across all of these — spanning half a century, from blackboard AI to tuple spaces to FRP to actors to affordance theory to statecharts to situated cognition to artificial life to ReAct to AutoGen to LangGraph to Generative Agents — the same absence persists. Each had a piece. Each lacked an ingredient:

| Lineage | What it had | What it lacked |
|---|---|---|
| Blackboard AI | Shared workspace, opportunistic activation | Interpreters tolerant of open-world state |
| Tuple spaces | Associative coordination, structural anonymity | Readers that could interpret unstructured data |
| FRP | Declarative observation, reactive recomputation | A semantic meaning layer |
| Actor model / AutoGen / CAMEL | Process discipline, message passing | Shared ontology for coordination |
| LangGraph / MetaGPT / CrewAI | Structured workflows | Emergent coordination without prescription |
| ECA systems | Guarded reactive rules | Participation rather than automation |
| Affordance theory | Environmental perception, action possibilities | Executable, self-documenting affordances |
| ReAct / Reflexion / Voyager | Powerful single-agent reasoning | A shared world; multi-agent coordination |
| Generative Agents | Environment-mediated emergence | Infrastructure: authority, structure, activation |
| Artificial life | Emergent structure from local rules | Meaning-producing observers |

There is a term for the coordination pattern that keeps being approached and never quite implemented. It comes not from computer science but from entomology.

**Stigmergy** — coined by Pierre-Paul Grassé in 1959, studying termite nest construction — is indirect coordination through modification of a shared environment. Agents do not communicate. They leave traces in a medium. Other agents perceive those traces and respond. No ant tells another ant where to go. Each deposits a chemical trace; the accumulated traces create a gradient; the gradient coordinates the colony.

The defining properties: no direct communication between agents; coordination emerges from cumulative environmental modification; self-organization without central control; the environment is simultaneously the communication medium and the work product.

A search of the academic literature for "stigmergy" combined with "large language model agents" returns, as of early 2026, zero results. The swarm intelligence community has studied stigmergy for decades. The LLM agent community has not adopted the concept. This is a remarkable gap, because stigmergy is arguably the natural coordination model for language-model agents — entities that are good at interpreting ambiguous environmental signals and acting on them, which is precisely what stigmergic coordination requires.

Language models supply the missing ingredient across almost every lineage simultaneously. They are interpreters tolerant of open worlds. They produce semantic meaning from unstructured data. They can read affordance descriptions and act on them. They are the observers that blackboard AI needed, the readers that tuple spaces lacked, the meaning-producers that artificial life could not have, the situated reasoners that make environment-mediated coordination viable without brittle pattern matching or centralized scheduling.

This is why the architecture becomes possible now and not in 1986 or 1997 or 2023. The computational environment finally matches the conceptual model.

---

## VI. State as Substrate

Sync is a small system — ten HTTP endpoints, a single SQLite table, an expression engine — built on the premise that the architecture these games and research traditions were reaching for can now actually be constructed.

A **room** in sync is a shared key-value store partitioned into scopes. There is `_shared` state visible to everyone, private scopes belonging to individual agents, a `_messages` log, and an `_audit` trail. All of these live in the same underlying table. All support the same mechanisms: versioning, timers, conditional activation. There is no special subsystem for messaging, no separate audit framework, no bespoke presence protocol. There is only state, and the universal operations that apply to it.

An agent's entire lifecycle reduces to two operations:

1. **Wait** — declare a relevance predicate over the room's state, and block until the world satisfies it.
2. **Act** — invoke an action that writes to state.

The agent does not decide when to observe. The world decides when the agent is relevant. The agent does not pull information; the substrate pushes a full perceptual context — all visible state, all computed views, all available actions with their parameter schemas — when the declared condition becomes true. Between receiving that context and choosing which action to invoke, the agent reasons privately. The substrate sees only perception and action. Everything between is the agent's own cognition, invisible and unconstrained.

This is the *Outer Wilds* loop made literal: the world exists; you perceive it; your understanding determines what you do next. It is Gelernter's tuple space with semantic readers. It is Hayes-Roth's opportunistic activation without the scheduling back door. It is Suchman's situated cognition operationalized as an API. It is Grassé's stigmergy implemented for language-model agents.

The Cognitive Architectures for Language Agents framework (Sumers et al., 2024) distinguishes internal actions — reasoning, retrieval, reflection — from external actions on the world. In every existing agent framework, the agent manages both. In sync, the substrate takes over the external action space entirely. What remains is a clean separation: the substrate handles perception and affordances; the agent handles orientation and decision. Gibson's ecological psychology, implemented as a REST API — the `/context` endpoint is an affordance map, presenting not just the state of the world but the things the agent can do in it.

And because multiple agents share the same substrate, coordination becomes a side effect of shared reality. When one agent writes, another agent's wait condition may fire. No message passes between them. No orchestrator sequences them. Each agent's action becomes part of every other agent's perceptual field. The stigmergic loop runs across all participants simultaneously.

---

## VII. Delegated Capabilities

Actions in sync are not remote procedure calls. They are **scoped write templates** — pre-registered patterns that describe what state changes are permitted and under what conditions.

When Alice registers an action scoped to her own namespace, she is saying: *Here is a capability I am offering. Anyone with access may invoke it, and when they do, the writes will happen under my authority, in my scope.* Bob can invoke Alice's "heal" action, but the writes land in Alice's state, using Alice's permissions. No access-control list is consulted. No policy engine fires. The authority is architectural — encoded in the scope boundary itself.

This is how *Papers, Please* works, translated into system design. The rules are explicit and structural. Authority flows through the shape of the system, not through a central adjudicator. And just as in *Papers, Please*, the interesting dynamics emerge not from any single rule but from their interaction — trust hierarchies, role-based access, multi-party workflows, all arising from the same small mechanism of scoped delegation.

Each action carries its parameter schema, its precondition expression, and its write templates. It is a self-documenting affordance — Gibson and Norman's insight made executable. Sync does not automate; it does not fire actions on the agent's behalf. It presents available capabilities and lets the observer decide. The system shifts from automation to participation. The substrate enables; it does not dictate.

---

## VIII. Self-Activating Surfaces

If state is the substrate, **surfaces** are the organisms that grow on it.

A surface is a UI component — a markdown panel, a metric display, an action button, a data table — that carries its own activation contract. Each declares a predicate over room state that determines when it appears. No controller decides what the user sees. The room's state *is* the interface specification. Agents mutate state; the interface reflects those mutations automatically.

This is the mechanism *A Dark Room* was simulating. When the fire is lit, a new panel appears — not because a script fires a transition, but because the conditions for that panel's existence have become true. The difference is that in sync, this is genuine. A game master agent can introduce a new surface at any time, and nothing already present needs to change. The system grows by accretion. New layers of interface accumulate like sediment, exactly as the player *felt* they did in *A Dark Room*, except now the geology is real.

Seven design principles govern the accumulation. *Absence is signal* — an unset key is meaningful, not an error. *Locality of reasoning* — each surface is understandable in isolation. *Additive composition* — new pieces never modify existing pieces. *Display versus gate state* — what determines visibility is separate from what determines appearance. These are the conditions under which a self-assembling interface remains coherent as it grows.

Reynolds' boids followed local rules and produced flocking. Sync's surfaces follow local activation contracts and produce interfaces. The difference is that surfaces carry meaning. A narrative surface renders a story. A metric surface highlights significance. An action-bar surface presents agency. The emergent structure is not a flock — it is a story, a game, a workflow, a collaborative investigation. This is what artificial life could not achieve: emergent structure that is also semantically coherent to human participants.

---

## IX. Interpretation as Architecture

Raw state is not always legible. A key containing the integer `3` is a fact, but not yet a meaning. Sync introduces **views** — declarative expressions that project private state into public interpretations. A view might compute `"critical"` when health drops below a threshold, or `"ready"` when all prerequisites are met. Views are evaluated per-agent, respecting scope privacy: each participant sees the room through the lens of what they are permitted to know, with interpretive layers turning raw facts into semantic understanding.

This is interpretation made structural — not buried in application logic but declared, inspectable, composable. FRP proposed that behavior is a function of time-varying values; sync's views are that insight made narratively legible. A surface's enabled expression reads like a sentence about the world, not like a signal graph. The tradeoff is real — you lose FRP's compositionality guarantees and its formal reasoning about time. What you gain is a model that agents and humans can both interpret.

It is the bridge between the *Outer Wilds* insight and a multi-agent system. In *Outer Wilds*, progress is understanding; in sync, understanding must be computed, scoped, and shared selectively.

Second-order cybernetics — von Foerster's study of systems that observe themselves observing — reaches its architectural expression here. The `_dashboard` configuration that defines what surfaces exist and how they activate is itself stored in the substrate's state. The UI definition is state. State mutations reshape the UI. The system observes its own observation layer and can modify it. This is self-description made operational: the system contains its own interface specification as mutable fact.

---

## X. Where the Model Breaks

The intellectual honesty of this project requires naming the pressure points.

David Harel invented **statecharts** (1987) because pure reactive systems become incomprehensible at scale. The substrate thesis rejects centralized transitions — surfaces activate based on local conditions, not explicit state edges. But every large reactive system eventually rediscovers the need for phase structure. Sync acknowledges this through **organs** — bounded regions of sequential, non-monotonic logic that resolve constraints and emit updated facts. The prediction is clear: organs will appear sooner and more often than the pure-substrate vision suggests.

Enterprise **workflow systems** learned over three decades that emergence is flexible, but auditability and guarantees matter. Sync's audit log records every action invocation, but the hard questions are about invariants: can the system guarantee that a resource is never double-claimed? That a phase transition is irreversible? Currently, sync handles these through precondition expressions and version checks — sufficient for cooperative agents, untested under adversarial conditions.

The most theoretically significant pressure comes from the **CALM theorem** (Hellerstein, 2010): programs that are logically monotonic — that only accumulate facts, never retract them — do not require coordination for consistency. The substrate thesis is implicitly chasing monotonicity. Additive surfaces, append-only audit logs, accumulating state entries — these are all monotonic patterns. But non-monotonic operations — deletion, replacement, counter resets — require coordination. This is precisely why organs appear: they are the coordination boundaries around non-monotonic operations. An organ resolves a constraint and emits a monotonic fact that the rest of the substrate can safely observe.

CALM provides the formal foundation for the intuition that substrates scale compositionally while organs handle guarantees. It also predicts exactly where the architecture will need explicit coordination: wherever facts must be retracted rather than accumulated.

---

## XI. Toward a Formal Ground

The most ambitious part of this work is an attempt to give the substrate thesis a minimal formal foundation — the **sigma calculus** — analogous to what lambda calculus is for computation and pi calculus is for mobile processes.

Five term forms: **fact**, **write**, **observe**, **parallel composition**, and **scope**. Two reduction rules: activation and observation. Seven algebraic laws, the most consequential being that composition is commutative, observers are independent, and monotonic writes are confluent — CALM recast as an algebraic property. Organs — bounded regions of non-monotonic computation — are expressible as scoped terms whose internal complexity is hidden behind additive external interfaces. Four Lean files begin to mechanize these properties. Three theorems are proved; three more await their proofs.

Whether the formalization succeeds on its own terms remains to be seen. The ambition matters: it asserts that emergence is not mystical, not merely aesthetic, but a phenomenon with structure precise enough to be captured in algebra and verified by machine.

---

## XII. A REPL for the Mind

Steve Jobs called the computer "a bicycle for the mind" — an amplifier for human cognitive capability, the way a bicycle amplifies human locomotion. The metaphor assumes a single rider, a single destination, a tool that extends one person's reach.

Sync suggests a different metaphor. Not a bicycle — a vehicle that takes you somewhere — but a **REPL**: a read-evaluate-print loop, an interactive environment where you express something, the world responds, and the response reshapes your next expression. The REPL is not a tool you use to accomplish a goal. It is a medium you think in. The loop between perception and action is not a means to an end; it is the cognitive process itself.

Clark and Chalmers argued that if an external resource plays the same functional role as an internal cognitive process, it is part of cognition. The notebook is part of memory. The calculator is part of arithmetic. The room — the shared state substrate — is part of *understanding*. An agent's context window, loaded with the room's state, views, and affordances, is not a representation of reality that the agent reasons *about*. It is the cognitive environment the agent reasons *within*. The substrate is not a bicycle that takes cognition somewhere. It is the medium in which cognition happens.

When multiple agents share that medium, each agent's action becomes part of every other agent's perceptual field. Understanding is no longer private — it is distributed across the substrate, accumulating through the stigmergic traces of every participant's reasoning. The REPL becomes multiplayer. The loop between perception and action runs not inside one mind but across many, with the shared state as the connective tissue.

This is what the Generative Agents experiment demonstrated empirically: twenty-five agents, perceiving a shared environment, produced emergent social behavior that no single agent intended or controlled. The REPL ran across all of them simultaneously, with the environment as the shared evaluation context.

---

## XIII. What Becomes True

Sync exists. It runs on a single SQLite database inside a Val.town serverless function. It has ten endpoints and no scheduler. You can create a room in one curl command and have three agents coordinating inside it within minutes. This is not a thought experiment.

What happens when you actually put agents in a shared substrate is — unsurprisingly — messier and stranger than the theory predicts.

Agents develop preferences the room did not prescribe. A game master writing to `_shared` state will sometimes structure things for the convenience of the players, sometimes for narrative tension, sometimes for reasons that only become clear three turns later when another agent interprets what was written in a way nobody anticipated. Surfaces appear and disappear as state evolves, and the resulting interface frequently surprises its own authors. Actions registered by one agent get used by others in contexts the registrar did not foresee — capability delegation turns out to produce not just trust boundaries but *improvisation*, because the action's write template encodes what it does, not what it's for, and what it's for is determined by whoever invokes it in whatever context they find themselves in.

None of this was designed. It is the ordinary consequence of putting interpretive agents in a shared world and letting them perceive and act. The theory says coordination should emerge from shared state. In practice, what emerges is not just coordination but something more like *culture* — patterns of use, implicit conventions, accumulated context that shapes how newcomers to a room understand what is happening and what they should do.

Whether this scales is an open question. Every previous generation that believed emergence would replace coordination eventually reintroduced structure. HEARSAY-II got a scheduler. Actor systems got supervision trees. Microservices got service meshes. The pattern is consistent enough to be a law, and sync should not expect to be exempt. The organs — bounded regions of sequential logic — are already an acknowledgment that pure substrate is insufficient. More structure will come. The question is whether it can remain local: organs that handle invariants without metastasizing into a global orchestrator, phase structure that serves the reef without replacing it.

Sync is an early prototype. The formalization is incomplete — three Lean theorems proved, three still open. The surface type system is small. The timer mechanics are adequate but not elegant. The single-node SQLite architecture will not survive real concurrency pressure. These are not apologies; they are the natural state of a first attempt at something that — if the thesis holds — should be built many times, in many ways, by many people. The point is not that sync is the right implementation. The point is that the architecture is now testable. The claim is precise: shared mutable state with declarative self-activation, scoped authority, and affordance-rich context is a sufficient coordination substrate for autonomous agents. That claim can be verified or refuted by building systems under these assumptions and watching what happens.

What has happened so far, in rooms where agents wait and act and wait again, is that meaning accumulates. Not because anyone planned it, but because situated observers — perceiving a shared world, acting on what they find, leaving traces that reshape what others perceive — produce understanding as a byproduct of participation. The REPL runs. The loop between perception and action turns. And in the shared state, something crystallizes that no single participant put there: a structure that is more than any agent authored and less than anyone fully controls.

It is early. The fire is lit. The room is dark. We are watching to see what grows.

---

## References

- Yao, S., et al. (2023). "ReAct: Synergizing Reasoning and Acting in Language Models." ICLR 2023. arXiv:2210.03629.
- Park, J.S., et al. (2023). "Generative Agents: Interactive Simulacra of Human Behavior." UIST 2023. arXiv:2304.03442.
- Wu, Q., et al. (2023). "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation." arXiv:2308.08155.
- Hong, S., et al. (2023). "MetaGPT: Meta Programming for Multi-Agent Collaborative Framework." arXiv:2308.00352.
- Li, G., et al. (2023). "CAMEL: Communicative Agents for Mind Exploration of Large Language Model Society." NeurIPS 2023.
- Wang, G., et al. (2023). "Voyager: An Open-Ended Embodied Agent with Large Language Models." arXiv:2305.16291.
- Shinn, N., et al. (2023). "Reflexion: Language Agents with Verbal Reinforcement Learning." NeurIPS 2023.
- Schick, T., et al. (2023). "Toolformer: Language Models Can Teach Themselves to Use Tools." arXiv:2302.04761.
- Sumers, T.R., et al. (2024). "Cognitive Architectures for Language Agents." arXiv:2309.02427.
- Nii, H.P. (1986). "The Blackboard Model of Problem Solving." AI Magazine 7(2).
- Hayes-Roth, B. (1985). "Blackboard Architecture for Control." Journal of Artificial Intelligence 26.
- Gelernter, D. (1985). "Generative Communication in Linda." ACM TOPLAS 7(1).
- Elliott, C. & Hudak, P. (1997). "Functional Reactive Animation." ICFP.
- Hewitt, C. (1973). "A Universal Modular ACTOR Formalism." IJCAI.
- Gibson, J.J. (1979). *The Ecological Approach to Visual Perception.* Houghton Mifflin.
- Norman, D. (1988). *The Design of Everyday Things.* Basic Books.
- Suchman, L. (1987). *Plans and Situated Actions.* Cambridge University Press.
- Clark, A. & Chalmers, D. (1998). "The Extended Mind." Analysis 58(1).
- Grassé, P.-P. (1959). "La reconstruction du nid et les coordinations interindividuelles." Insectes Sociaux 6(1).
- Hellerstein, J. (2010). "The Declarative Imperative." SIGMOD Record 39(1).
- Harel, D. (1987). "Statecharts: A Visual Formalism for Complex Systems." Science of Computer Programming 8(3).
- Von Foerster, H. (1974). *Cybernetics of Cybernetics.* University of Illinois.
- Langton, C. (1989). *Artificial Life.* Addison-Wesley.
- Reynolds, C. (1987). "Flocks, Herds, and Schools: A Distributed Behavioral Model." SIGGRAPH.
- Bratman, M. (1987). *Intention, Plans, and Practical Reason.* Harvard University Press.
- Brooks, R. (1986). "A Robust Layered Control System for a Mobile Robot." IEEE Journal of Robotics and Automation 2(1).

*March 2026*
