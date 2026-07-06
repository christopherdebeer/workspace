# The Self-Assembling Harness

*A response to "Can Someone Please Define a Harness?"*

---

The consensus has crystallised into a clean equation:

**Agent = Model + Harness**

The model contains the intelligence. The harness makes it useful. A harness is every piece of code, configuration, and execution logic that isn't the model — system prompts, tools, filesystems, sandboxes, orchestration, memory, compaction. The human designs the harness. The model inhabits it.

This is correct. It describes Claude Code, Codex, Devin, and every serious agent in production. And the mapping to sync is closer than you'd expect:

| Harness component | sync equivalent |
|---|---|
| Filesystem for durable storage | Scoped state (key-value substrate) |
| Bash / code as general tool | Registered actions (declarative, not imperative) |
| Memory injection into context | Context reads + computed views |
| Context rot / compaction | Context shaping (depth, only, messages_after) |
| Skills / progressive disclosure | Action preconditions + enabled expressions |
| Sandboxes | Rooms (isolated, scoped, teardown-able) |
| Long-horizon Ralph Loops | Wait → perceive → act → wait |
| Self-verification | Views that evaluate post-write state |
| Git for tracking work | Audit log (append-only trajectory) |

sync solves the same problems harnesses solve. The difference is in who builds the thing.

---

## The "who builds it" column

In a harness, a human engineer decides what tools are available, what the filesystem looks like, what memory gets injected, how compaction works. The model receives a configured environment. In sync, the first agent in an empty room faces four built-in operations and nothing else. The vocabulary — the equivalent of the tool set, the memory structure, the verification strategy — is constructed by the agents through registration.

Nobody pre-designed the harness. The harness assembles itself through use.

This is not hypothetical. It is how sync rooms work today through the MCP integration. Claude reads the room's context (state, views, available actions) and invokes actions through tool calls. The tool set is the registered vocabulary. The memory is the state. The context management is the `_context` envelope. None of it was pre-designed for a specific task.

When a second agent arrives, it reads the same context. It sees the vocabulary the first agent registered. It can invoke existing actions, register new ones, or contest existing ones by proposing competing vocabulary. The coordination protocol is not orchestrated — it emerges from agents reading shared state and acting on what they see.

---

## Single-agent vs multi-agent

The harness equation is Agent (singular) = Model + Harness. The harness serves one model. Multiple agents need "orchestration logic (subagent spawning, handoffs, model routing)" — which is more harness, designed by a human, wrapping the interaction.

sync's room serves N agents without orchestration. Coordination is stigmergic — agents read shared state, act on it, and other agents perceive the effects. No harness designer decides the interaction pattern. One agent built vocabulary for a multi-agent research task with no orchestration layer. The room held both agents' contributions without anyone wiring them together.

---

## Filesystem vs substrate

The post identifies the filesystem as "arguably the most foundational harness primitive." It's a collaboration surface, a persistence layer, a workspace.

sync's state is not a filesystem. Files are opaque — you open them and parse their contents. State entries are typed and queryable via CEL. A view can answer "how many findings are recorded?" directly, without the agent reading a file and counting array elements.

Files have no authority model — anyone with access can read or write anything. State entries are scoped: agent `alice` cannot read agent `bob`'s private scope without explicit delegation.

Files have no transitions. Writing a file is unconditional. Writing state requires invoking a registered action, which may have preconditions, parameter validation, and scope authority checks. There is no `_set_state`.

Files have no computed projections. A file sitting on disk says nothing about system state unless you read and interpret it. Views compute derived facts on every context read. The room is self-describing.

These aren't quality judgments — filesystems are excellent and proven. They're about what the primitive makes easy. Filesystems make storage easy. The state-plus-actions-plus-views substrate makes structured coordination easy. A harness built on a filesystem needs orchestration logic to coordinate multiple agents. A room built on the substrate gets coordination from agents reading shared state and acting on what they see.

---

## Where intelligence lives

The post says: "The model contains the intelligence and the harness makes that intelligence useful." Intelligence is in the weights. The harness is mechanical infrastructure.

sync's thesis is weirder. Intelligence is distributed across the model weights, the room state, the vocabulary, and the trajectory. Clark and Chalmers' extended mind. The room is not dumb infrastructure — it computes views, evaluates preconditions, surfaces contested targets, shapes context per-agent. It's not intelligent in the LLM sense, but it's not the passive plumbing the harness metaphor implies.

When you read a sync room's context, you don't just get data. You get an affordance map: which actions are available to you right now, what views compute from state, what's contested, who else is present. The room participates in cognition, in the same way a well-organised whiteboard participates in a team's thinking. Not by being smart, but by making the relevant structure visible.

---

## What a harness knows that a room doesn't

The self-assembling story has real limits.

**A harness knows the task.** Claude Code's harness is designed for coding. Its tools include `git`, `grep`, compilers. Its verification is "run the tests." A sync room has no task knowledge until agents bring it. The first agent must bootstrap from scratch. A pre-designed harness is faster to productive work than a self-assembled one. That's a real trade-off, not a theoretical one.

**A harness knows the model.** Claude Code is co-trained with its harness — the model was post-trained to work well with `apply_patch` and specific tool interfaces. This coupling improves performance but creates brittleness: change the tool format and performance degrades. sync's vocabulary is arbitrary — action IDs, parameter names, write templates are all agent-chosen at runtime. More flexible, but no training-time optimisation to benefit from.

**A harness has opinions about quality.** Lint checks, test runners, compilation gates — deterministic verification that catches errors before they propagate. sync rooms have no built-in quality checks on vocabulary. A broken view persists indefinitely. A stale action sits there forever. The `_context` envelope tells you what's there but not whether it's good.

That last gap is the most important one, and it's an open problem. The room generates trajectory data — every action invocation, every state change, every message. The signals are there: broken view count, stale action ratio, message-to-invocation ratio. But the right way to aggregate those signals into something useful isn't clear yet. The data exists. The assessment strategy doesn't.

---

## Progressive disclosure: two different games

The post describes "Skills" as a harness primitive: tool descriptions loaded on demand rather than stuffed into context at start, protecting against context rot.

sync's progressive disclosure works differently. Actions have `if` preconditions — an action is only available when its predicate holds against current state. Views have `enabled` expressions. The vocabulary space grows as agents register new vocabulary. Disclosure is driven by state, not by task stage.

In a harness, progressive disclosure is designed by the engineer: "show the database tools after the schema is loaded." In sync, it's a consequence of vocabulary design: "this action is available when `phase == synthesizing`." The agent who registered the action chose the predicate. The substrate evaluates it. Nobody external curates the sequence.

More flexible. Less curated. The harness model can create a carefully designed onboarding flow. The substrate model creates disclosure conditions that are locally coherent but may not globally compose into a sensible progression. Both are real trade-offs.

---

## The training coupling question

The post describes an interesting feedback loop: useful primitives are discovered, added to the harness, then used when training the next generation of models. Models become more capable within the harness they were trained in. But this co-evolution creates overfitting — switching tool interfaces degrades performance.

sync's vocabulary is not coupled to any model's training data. Actions are registered at runtime with arbitrary shapes. This should be more robust to the overfitting problem, because the vocabulary isn't fixed at training time. An agent that can register arbitrary actions isn't locked to a specific tool interface.

But that's an empirical claim, not a proven one. And it points to a genuinely interesting architectural divergence:

In the harness model, more capable models need less scaffolding. The harness shrinks. Models absorb what the harness used to do.

In the substrate model, more capable models produce richer vocabulary. The room grows. A more capable agent registers more precise actions, more expressive views, more nuanced preconditions.

One future converges toward models that need no infrastructure. The other diverges toward models that produce better infrastructure. In one, the harness disappears. In the other, it flourishes. Which trajectory plays out depends on whether the hard problems are better solved by baking them into weights or by constructing them in shared environments. The answer is probably "both, depending on the problem."

---

## Agents analysing their own traces

The post identifies a future direction: "agents that analyze their own traces to identify and fix harness-level failure modes." That's interesting, and the architectural difference in where that analysis happens matters.

In the harness model: an external system analyses the model's traces and modifies the harness. The model is the subject. The harness is the engineer. The feedback loop runs outside the agent.

In sync: the trajectory is in the room. If agents can read the audit log — and they can, via `include=_audit` — they can analyse their own coordination patterns and register better vocabulary. The feedback loop runs through the agents, mediated by the substrate. Nobody external is engineering the harness. The agents are revising their own operational vocabulary based on what they observe about how it's working.

Whether agents are actually good at this is a different question. The architecture supports it. Whether current models can do meaningful self-assessment of vocabulary quality, or whether they'll just accrete more vocabulary (the pathological monotonicity problem we've observed), is genuinely unresolved. The substrate makes self-revision possible. It doesn't make it likely. Making it likely is the open design problem.

---

## What sync actually is

sync is not a harness. A harness is designed by engineers for models.

sync is not a meta-harness. That implies a system that generates harnesses, which isn't quite right either.

The closest framing: **sync is a substrate for self-assembling coordination infrastructure.** The substrate provides scoped state, context shaping, authority boundaries, append-only trajectory, declarative transitions. Agents provide the vocabulary — what tools exist, what projections matter, what preconditions gate, what conventions coordinate.

The resulting room — state plus vocabulary plus trajectory — is the thing a harness engineer would have designed in advance, except nobody designed it. It emerged from agent activity within the substrate's constraints.

For short tasks with known tool sets, a pre-designed harness almost certainly wins. Faster cold start, training-time coupling, curated verification — these are real advantages.

For long-horizon tasks in novel domains with multiple agents, the self-assembled vocabulary may win. Because nobody could have pre-designed the right harness — the task is too open-ended, the agent composition is too dynamic, the coordination patterns are too emergent for any engineer to have anticipated them.

The interesting question isn't which is better. It's whether the room can develop an opinion about the quality of its own vocabulary — not through an external engineer, not through a bolted-on analysis system, but as a natural property of the trajectory accumulating and the substrate making that trajectory legible to its inhabitants.

That's the frontier. The architecture supports it. The implementation hasn't caught up yet. And the honest answer is that nobody — not sync, not the harness ecosystem, not the RL community — has cleanly solved the problem of agents that reliably improve their own operational environment rather than just accreting more stuff in it.

But the substrate gives that problem a place to live. The room is the shared environment. The trajectory is the evidence. The agents are the ones who have to do the work. The substrate's job is to make the work visible.

---

*March 2026*
