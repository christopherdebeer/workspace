# Isn't This Just ReAct?

The two-operation agent loop at the heart of sync — wait for a condition to become true, then act — looks, at first glance, like a familiar pattern. ReAct (Yao et al., 2023) interleaves reasoning and acting. OODA observes, orients, decides, acts. SOAR perceives, selects an operator, applies it. BDI updates beliefs, generates desires, forms intentions, executes. Every agent architecture in the history of AI eventually reduces to some variant of *look at the world, do something, look again*.

So: is sync's Wait-Act loop just ReAct with a different name?

No. And the difference is not cosmetic. It is architectural, and it maps onto a gap in the academic literature that, as of early 2026, remains almost entirely unaddressed.

---

## The ReAct Loop

ReAct's contribution (Yao et al., ICLR 2023) is the interleaving of *reasoning traces* with *action execution* inside a single generation:

```
Thought[1]: I need to find X.
Action[1]: Search["X"]
Observation[1]: [results]
Thought[2]: Now I should check Y.
Action[2]: Lookup["Y"]
Observation[2]: [results]
Thought[3]: The answer is Z.
Action[3]: Finish["Z"]
```

The agent drives the loop. It decides what to think about, which tool to call, and when to stop. The observation is the *result of its own action* — a search result, a lookup response, a tool output. The world exists only as a set of instruments the agent chooses to invoke.

This is powerful for single-agent reasoning tasks. It is also, structurally, a *tool-use pattern*. The agent is the protagonist. The environment is a service counter. Toolformer (Schick et al., 2023) makes this explicit: the model learns to insert API calls mid-generation when doing so would improve its predictions. Tools are ephemeral extensions of the agent's capabilities, discarded after use.

## The Inversion

Sync's loop looks superficially similar:

```
Wait(condition over shared state) → Observe(full context) → Act(invoke action) → Wait...
```

But every structural commitment is inverted.

**Who drives the loop?** In ReAct, the agent decides when to observe. In sync, the agent declares a relevance predicate — a CEL expression over the room's shared state — and *blocks*. The world decides when the agent is relevant. The agent does not pull observations; observations are pushed when reality satisfies the agent's declared condition. The agent sleeps until the world has something to say to it.

**What is observed?** In ReAct, the observation is the result of the agent's own action — a tool response, scoped to what the agent asked for. In sync, the observation is the *entire room context*: all visible state, all computed views, all available actions with their parameter schemas, all present agents. The agent perceives not just an answer but a world — including what it *can do* in that world, which may have changed since it last looked.

**Where does coordination happen?** ReAct is single-agent. If you run two ReAct agents, they need external orchestration to avoid stepping on each other. In sync, coordination is dissolved into the substrate. Multiple agents watch the same state. When one agent writes, another agent's wait condition may fire. No message passes between them. No orchestrator sequences them. Coordination is a side effect of shared reality.

**What persists?** A ReAct trace is ephemeral — it exists within a single generation and vanishes. Sync's state is persistent and shared. An agent's action mutates the world for all participants. The substrate is not a scratchpad; it is the ground truth of a multi-agent reality.

The distinction maps onto a classical divide in cognitive science. ReAct agents are **tool-users operating in a vacuum**. Sync agents are **situated beings in a shared world**. Lucy Suchman would recognize the difference immediately: ReAct agents execute plans; sync agents perceive environments and respond to what they find (Suchman, 1987).

---

## The Landscape

To understand where sync sits, it helps to map the current academic terrain for LLM agent coordination. The dominant paradigms, as of 2026, are:

**Message-passing frameworks.** AutoGen (Wu et al., 2023) coordinates agents through multi-turn conversation — agents talk to each other, directly, by name. CAMEL (Li et al., NeurIPS 2023) pairs agents in role-playing dialogues with inception prompting. Google's A2A protocol standardizes agent-to-agent communication over JSON-RPC. In all of these, agents must discover each other, address messages to specific recipients, and negotiate interaction. Coordination is explicit. The system scales in wiring complexity proportional to the number of agent relationships.

**Orchestrated workflows.** LangGraph models agents as nodes in a directed graph with typed state flowing along edges. MetaGPT (Hong et al., 2023) encodes Standardized Operating Procedures — fixed role sequences modeled on human organizational charts. CrewAI combines event-driven Flows with role-specialized Crews. In all of these, someone must design the graph, write the SOP, define the flow. The workflow is prescribed. Structure is imposed, not emergent.

**Single-agent reasoning loops.** ReAct, Reflexion (Shinn et al., NeurIPS 2023), Voyager (Wang et al., 2023), chain-of-thought, tree-of-thought — these are patterns for making individual agents more capable. They have nothing to say about coordination. If you want two Reflexion agents to collaborate, you are on your own.

What is conspicuously absent from this landscape is **environment-mediated coordination through shared mutable state with declarative self-activation**.

---

## The Precedent That Almost Exists

One published system comes close. Park et al.'s *Generative Agents* (UIST 2023) — the Smallville paper — placed twenty-five LLM agents in a shared simulated environment. Agents coordinated not through messages but through the environment itself: they observed each other's actions, perceived the state of shared spaces, and self-activated based on what they saw. A single seed — one agent wanting to throw a Valentine's Day party — cascaded through the environment as agents observed, inferred, and responded. Social structure emerged without orchestration.

Smallville demonstrates that environment-mediated coordination produces emergent behavior in LLM multi-agent systems. It is, arguably, the most important empirical result in the field for sync's thesis. But Smallville is a simulation, not an architecture. It has no authority model — any agent can do anything. No capability delegation — actions are not scoped. No structured observation — agents perceive natural-language descriptions of a spatial world, not typed state with computed views. No declarative activation — agents run on a clock tick and decide for themselves whether to act, rather than declaring a predicate and blocking.

Sync takes Smallville's empirical insight and gives it infrastructure: scoped authority, structured state, declarative activation, capability delegation, atomic writes, audit trails. The move from simulation to substrate.

---

## The Word Nobody Is Using

There is a term for what sync does. It comes not from computer science but from entomology.

**Stigmergy** — coined by Pierre-Paul Grassé in 1959, studying termite nest construction — is indirect coordination through modification of a shared environment. Agents do not communicate. They leave traces in a medium. Other agents perceive those traces and respond. The pheromone trail is the paradigmatic example: no ant tells another ant where to go. Each ant deposits a chemical trace; the accumulated traces create a gradient; the gradient coordinates the colony.

The defining properties of stigmergy are:

- No direct communication between agents
- Coordination emerges from cumulative environmental modification
- Self-organization without central control
- The environment is simultaneously the communication medium and the work product

Every one of these properties describes sync. Agents never message each other. Coordination emerges from writes to shared state. No orchestrator sequences activation. The room's state is both the communication medium (agents read what other agents have written) and the work product (the state *is* the game, the workflow, the investigation).

A search of the academic literature for "stigmergy" combined with "large language model" or "LLM agents" returns, as of early 2026, **zero results**. The swarm intelligence community has studied stigmergy for decades. The LLM agent community has not adopted the concept. This is a remarkable gap, because stigmergy is arguably the natural coordination model for language-model agents — entities that are good at interpreting ambiguous environmental signals and acting on them, which is exactly what stigmergic coordination requires.

Sync is, to the best of available evidence, the first practical implementation of stigmergic coordination for LLM agents.

---

## Blackboard, Revisited

The AI community's closest approach to stigmergy was the **blackboard architecture** (Nii, 1986). HEARSAY-II (speech recognition) and HASP (sonar interpretation) used a shared data structure — the blackboard — watched by independent knowledge sources that activated when they recognized patterns they could contribute to.

The blackboard architecture had the right shape: shared state, independent observers, opportunistic activation. It failed for a specific reason: the knowledge sources were hand-coded pattern matchers. They could not tolerate ambiguity, could not interpret novel situations, could not reason about open-world state. Every implementation eventually reintroduced a scheduler — a centralized controller that selected which knowledge source to run next — because the knowledge sources themselves could not reliably self-select (Hayes-Roth, 1985).

Sync's claim is that language models resolve the blackboard architecture's control problem. A CEL predicate declares when an agent is relevant. The agent itself — an LLM capable of interpreting ambiguous, open-world state — decides what to do when activated. No scheduler selects the next agent. The wait condition *is* the selection mechanism, and the LLM *is* the knowledge source that can finally tolerate the open-world ambiguity that broke HEARSAY-II.

This is a forty-year-old architecture whose missing ingredient has arrived.

---

## The Coordination Taxonomy

The Cognitive Architectures for Language Agents framework (CoALA; Sumers et al., 2024) proposes a unified model for LLM agents built from modular memory, structured action spaces, and generalized decision-making cycles. It is the most serious attempt to bridge cognitive science and LLM agent design.

CoALA's taxonomy helps locate sync precisely. CoALA distinguishes:

- **Internal actions** (reasoning, retrieval, reflection — operations on the agent's own memory)
- **External actions** (tool calls, environment interactions — operations on the world)

In ReAct, the loop alternates between internal actions (Thought) and external actions (Action). The agent manages both. In sync, the substrate takes over the external action space entirely. The agent's internal reasoning is invisible to the system — it happens inside the LLM's context window, between receiving the observation and choosing which action to invoke. The substrate sees only two events: the wait condition firing (observation delivered) and the action invocation (decision executed). Everything between is the agent's private cognition.

This maps to the OODA loop with a specific compression:

| OODA | Sync |
|------|------|
| **Observe** | `/wait` returns full context |
| **Orient** | *(inside the LLM — invisible to substrate)* |
| **Decide** | *(inside the LLM — invisible to substrate)* |
| **Act** | `/invoke` mutates state |

Sync does not model orientation or decision-making. It provides the perceptual field (context) and the action space (available actions with schemas). What the agent does with that information is the agent's business. The substrate is agnostic about cognition. It cares only about perception and action.

This is a deliberate architectural choice, and it has a name in ecological psychology. James Gibson (1979) argued that organisms do not build internal models of the world and then reason about them. They perceive *affordances* — possibilities for action that the environment presents directly to perception. A handle affords pulling. A flat surface affords sitting. Perception and action are coupled without an intermediate reasoning layer.

Sync's `/context` endpoint is an affordance map. It returns not just the state of the world but the available actions — what the agent *can do*, given the current state, given the agent's authority. The agent does not query for capabilities. The capabilities are presented as part of perception. This is Gibson's ecological psychology implemented as a REST API.

---

## What the Frameworks Are Missing

The comparative table makes the gap visible:

| Framework | Activation | Coordination | State |
|-----------|-----------|--------------|-------|
| ReAct | Agent-driven | None | Ephemeral trace |
| Reflexion | Agent-driven | None | Episodic memory |
| Voyager | Curriculum-driven | None | Skill library |
| AutoGen | Message receipt | Direct messaging | Conversation |
| CAMEL | Message receipt | Role-play dialogue | Conversation |
| MetaGPT | Workflow position | Shared message pool | Artifacts along SOP |
| LangGraph | Graph traversal | State along edges | Typed dict per edge |
| CrewAI | Event trigger | Hierarchical delegation | Flow state |
| Generative Agents | Clock tick | Environment-mediated | Spatial simulation |
| **Sync** | **Declarative predicate** | **Shared mutable substrate** | **Persistent, scoped, versioned** |

Three columns. In every existing framework, at least one column defaults to the simple case (no coordination, ephemeral state, agent-driven activation). Sync is the only system that commits to the complex case in all three simultaneously: declarative self-activation, environment-mediated coordination, and persistent shared state with authority boundaries.

The reason this combination is rare is that it requires solving three problems at once:

1. **Self-activation without scheduling** — the blackboard problem, resolved by declarative CEL predicates and LLM observers
2. **Coordination without messaging** — the stigmergy problem, resolved by shared mutable state as the sole interaction medium
3. **Authority without centralization** — the capability problem, resolved by scoped write templates with delegated authority

Each of these problems has been solved individually in other contexts. Sync solves them in combination, and the combination produces something none of the individual solutions provide: a substrate where multiple autonomous agents can participate in a shared reality without any agent or controller holding the complete picture.

---

## A REPL for the Mind

There is an older metaphor that keeps surfacing. Steve Jobs called the computer "a bicycle for the mind" — an amplifier for human cognitive capability, the way a bicycle amplifies human locomotion. The metaphor assumes a single rider, a single destination, a tool that extends one person's reach.

Sync suggests a different metaphor. Not a bicycle — a vehicle that takes you somewhere — but a **REPL**: a read-evaluate-print loop, an interactive environment where you express something, the world responds, and the response reshapes your next expression. The REPL is not a tool you use to accomplish a goal. It is a *medium you think in*. The loop between perception and action is not a means to an end; it is the cognitive process itself.

Clark and Chalmers' extended mind thesis (1998) argues that if an external resource plays the same functional role as an internal cognitive process, it is part of cognition. The notebook is part of memory. The calculator is part of arithmetic. The room — the shared state substrate — is part of *understanding*. An agent's context window, loaded with the room's state, views, and affordances, is not a representation of reality that the agent reasons *about*. It is the cognitive environment the agent reasons *within*. The substrate is not a bicycle that takes cognition somewhere. It is the medium in which cognition happens.

When multiple agents share that medium, something new emerges. Each agent's action becomes part of every other agent's perceptual field. Understanding is no longer private — it is distributed across the substrate, accumulating through the stigmergic traces of every participant's reasoning. The REPL becomes multiplayer. The loop between perception and action runs not inside one mind but across many, with the shared state as the connective tissue.

This is what the Generative Agents experiment demonstrated empirically: twenty-five agents, perceiving a shared environment, produced emergent social behavior — party planning, relationship formation, information diffusion — that no single agent intended or controlled. The REPL ran across all of them simultaneously, with the environment as the shared evaluation context.

---

## The Academic Gap

The literature reveals a surprising pattern. The three concepts that sync combines — stigmergy, blackboard architectures, and ecological affordances — are each well-established in their home fields. Stigmergy has decades of research in swarm intelligence. Blackboard systems have a canonical survey (Nii, 1986) and a substantial AI literature. Affordance theory has been influential in HCI since Norman's *Design of Everyday Things* (1988). Each field arrived independently at a piece of the architecture sync implements.

But the intersection — stigmergic coordination of LLM agents through a shared affordance-rich substrate with declarative self-activation — has no direct precedent in the published literature. The closest work is:

- **Generative Agents** (Park et al., 2023) — environment-mediated coordination, but as a simulation without infrastructure
- **CA-MCP** (Jayanti & Han, 2026) — shared context store for MCP servers, but as an optimization layer, not a coordination substrate
- **MACOG** (Khan et al., 2025) — blackboard terminology, but with a centralized finite-state orchestrator
- **KoMA** (Jiang et al., 2024) — shared memory for autonomous driving agents, but domain-specific

None of these proposes a general-purpose shared-state substrate with self-activation as the primary coordination mechanism for LLM agents.

The CALM theorem (Hellerstein, 2010) — which proves that monotonic programs need no coordination for consistency — provides formal grounding for *why* this architecture works. Sync's additive surfaces, append-only audit logs, and accumulating state entries are monotonic patterns. Where non-monotonic operations are needed (deletion, replacement, counter resets), sync introduces "organs" — bounded coordination regions that resolve constraints and emit monotonic facts. This is distributed consistency theory applied to agent coordination, though the connection to CALM has not been made explicit in the agent systems literature.

---

## Not ReAct

So, no — this is not ReAct.

ReAct is a prompting strategy for making single agents more capable at tool use. It is an important contribution, and it works. But it has nothing to say about coordination, shared state, authority, or emergence. It is a bicycle — one rider, one destination, one tool at a time.

Sync is a shared environment in which multiple agents perceive, act, and inadvertently coordinate through the accumulated traces of each other's reasoning. It is closer to an ecology than a tool. The Wait-Act loop is not a reasoning strategy; it is a mode of existence — a way of being situated in a world that other agents are simultaneously situated in, where the act of perceiving is also the act of being perceived, and where meaning accumulates not in any single agent's trace but in the shared substrate that all of them inhabit.

The academic literature has the pieces. Stigmergy from swarm intelligence. Blackboards from classical AI. Affordances from ecological psychology. Situated cognition from Suchman and Clark. CALM from distributed systems. Generative Agents as empirical proof of concept. What it lacks is the synthesis — the recognition that these pieces fit together into a coherent architecture for multi-agent coordination, and that language models are the missing ingredient that makes the architecture viable.

That synthesis is what sync attempts. Whether it succeeds is an empirical question. But the claim is precise enough to be tested: that shared mutable state with declarative self-activation, scoped authority, and affordance-rich context is a sufficient coordination substrate for autonomous LLM agents — and that orchestration, messaging, and workflow prescription are not merely unnecessary but actively counterproductive, because they prevent the emergent coordination that arises when intelligent agents are simply left alone in a shared world with the right perceptual structure.

---

## References

- Yao, S., et al. (2023). "ReAct: Synergizing Reasoning and Acting in Language Models." ICLR 2023. arXiv:2210.03629.
- Park, J.S., et al. (2023). "Generative Agents: Interactive Simulacra of Human Behavior." UIST 2023. arXiv:2304.03442.
- Wu, Q., et al. (2023). "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation." arXiv:2308.08155.
- Hong, S., et al. (2023). "MetaGPT: Meta Programming for Multi-Agent Collaborative Framework." arXiv:2308.00352.
- Li, G., et al. (2023). "CAMEL: Communicative Agents for Mind Exploration of Large Language Model Society." NeurIPS 2023. arXiv:2303.17760.
- Wang, G., et al. (2023). "Voyager: An Open-Ended Embodied Agent with Large Language Models." arXiv:2305.16291.
- Shinn, N., et al. (2023). "Reflexion: Language Agents with Verbal Reinforcement Learning." NeurIPS 2023. arXiv:2303.11366.
- Schick, T., et al. (2023). "Toolformer: Language Models Can Teach Themselves to Use Tools." arXiv:2302.04761.
- Sumers, T.R., et al. (2024). "Cognitive Architectures for Language Agents." arXiv:2309.02427.
- Nii, H.P. (1986). "The Blackboard Model of Problem Solving." AI Magazine 7(2).
- Hayes-Roth, B. (1985). "Blackboard Architecture for Control." Journal of Artificial Intelligence 26.
- Gelernter, D. (1985). "Generative Communication in Linda." ACM TOPLAS 7(1).
- Gibson, J.J. (1979). *The Ecological Approach to Visual Perception.* Houghton Mifflin.
- Norman, D. (1988). *The Design of Everyday Things.* Basic Books.
- Suchman, L. (1987). *Plans and Situated Actions.* Cambridge University Press.
- Clark, A. & Chalmers, D. (1998). "The Extended Mind." Analysis 58(1).
- Grassé, P.-P. (1959). "La reconstruction du nid et les coordinations interindividuelles chez Bellicositermes natalensis." Insectes Sociaux 6(1).
- Hellerstein, J. (2010). "The Declarative Imperative." SIGMOD Record 39(1).
- Harel, D. (1987). "Statecharts: A Visual Formalism for Complex Systems." Science of Computer Programming 8(3).
- Jayanti, M.A. & Han, X.Y. (2026). "Enhancing MCP with Context-Aware Server Collaboration." arXiv:2601.11595.
- Khan, R.N.H., et al. (2025). "MACOG: Multi-Agent Code-Orchestrated Generation." arXiv:2510.03902.
- Jiang, K., et al. (2024). "KoMA: Knowledge-driven Multi-agent Framework for Autonomous Driving." arXiv:2407.14239.
- Bratman, M. (1987). *Intention, Plans, and Practical Reason.* Harvard University Press.
- Brooks, R. (1986). "A Robust Layered Control System for a Mobile Robot." IEEE Journal of Robotics and Automation 2(1).

*March 2026*
