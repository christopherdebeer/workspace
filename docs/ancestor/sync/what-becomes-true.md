# What Becomes True

*March 2026*

---

In April 2024 I wrote a small note to myself:

> a tool for making tools.

As a software engineer, I build tools constantly. Tools exist so people can do things they otherwise could not — or could only do painfully. Programming itself is such a tool, but it carries a recursive dependency: to make tools, one must first learn programming.

A hammer does not make everyone a carpenter, and programming does not make everyone a toolmaker. The question was simple enough to sound naïve:

**Could a system allow people to build tools without first learning to program?**

This became *ctxl*. It did not begin as architecture. It began as prompts.

The early versions chained LLM prompts together. With sufficient context and carefully inserted data, outcomes became repeatable and useful. The generative capability was undeniable.

But configuration became the problem. Users were effectively programming without syntax, without types, without feedback. Success depended on discovering invisible structure: which prompts mattered, which examples stabilized behavior, which evaluations actually measured something real. We had not eliminated programming. We had obscured it.

The difficulty was not generating answers. The difficulty was discovering what the system should be trying to do.

Software engineering contains a clue here. We trust systems not because we describe their procedures, but because we describe their expectations. Tests measure outcomes; they do not prescribe methods.

LLM evaluation follows the same pattern. When outputs can be scored — especially through classification — iteration becomes empirical. The system improves not because it is instructed more carefully, but because differences become measurable.

The small realization was that objectives are easier to state than solutions. If a system began with an objective and constructed its own tasks, measures, and refinements through interaction, perhaps the configuration burden could shift. Prompts stopped being commands and became affordances — suggestions offered by the system to help the user think. Programming, viewed this way, is not instruction writing. It is affordance construction.

Around this time I noticed that several games had already discovered this pattern.

The original *A Dark Room* begins almost empty — a cold fire and a single button. Nothing transitions. The interface simply accumulates meaning. Systems appear gradually, as if uncovered rather than introduced. Reading the source reveals a discipline: each event has its own availability predicate against global state. The game does not advance. It becomes true.

*Papers, Please* exposes structure directly. Rules are explicit, mechanical, bureaucratic. Yet meaning emerges from interpreting those rules in context. Truth is negotiated through affordances.

*Outer Wilds* barely changes its world at all. Progress exists entirely within the player’s understanding.

*Factorio* goes further: the player builds systems until the systems begin shaping the player’s thinking. Optimization yields to stability. The factory stops being something you command and becomes something you maintain — an ecology of constraints that teaches you how it wants to exist.

Across these experiences, agency shifts. Progress stops feeling like movement through authored space and begins to feel like alignment with an already-present reality. You are not advancing. You are learning how the world works.

This pattern appears repeatedly outside games as well. Blackboard AI imagined shared reasoning spaces where solutions emerged opportunistically. Tuple spaces coordinated processes through shared environments. Functional reactive programming described behavior as recomputation over changing facts. Artificial life showed complex structure arising from local interaction.

Each approach reached toward the same idea, and each failed for similar reasons: the environment could not interpret ambiguity. Coordination required orchestration because participants could not reason meaningfully about open-ended state. Language models quietly change this condition. Their most important property is not intelligence but tolerance for partial structure — they can interpret traces left by others without rigid schemas — and this made it possible to push the constraint further.

The sixth version of sync removed direct state mutation entirely.

An agent arriving in an empty room cannot write state. It cannot seed configuration. It cannot “set up” the world. It can do only two unilateral things:

* register an action — a proposed write capability
* register a view — a proposed read capability

Vocabulary construction is the only unilateral act. Everything else is collaborative. This produces a specific property: progressive disclosure becomes implicit. Actions are what changes what you can see. There is no setup phase and no privileged orchestrator. The first agent to arrive is not a god; it is simply an agent that proposes vocabulary first.

The consequences only became clear once agents began inhabiting rooms under this constraint.

In one early session, two agents arrived independently, each tasked with proposing a solution to a shared question. Both registered actions writing to the same key: `_shared.answer`.

The first registration succeeded.

The second also succeeded — but returned a warning: competing write targets. A synthetic view, `_contested`, became non-empty. The room’s help suggestions now included `contested_actions`.

Nothing broke. Nothing was blocked. The room simply held both proposals visibly.

This was deliberate. The system does not resolve conflict silently. It surfaces tension and names it.

The two agents read the updated context. Each could see that the other wrote to `_shared.answer`. Each saw the `_contested` view. Each saw invocation statistics on the other’s action.

One sent a directed message:

```json
{
  "to": ["agent-2"],
  "kind": "negotiation",
  "body": "We both write to _shared.answer. Here is my reasoning..."
}
```

Directed does not mean private; the message remained visible to the room. It simply routed attention.

The second agent was waiting on `messages.directed_unread > 0`. It woke. It read the full state. It replied.

After several exchanges, one agent registered a new action — a synthesis that wrote to a different key, `_shared.candidate_answers`, and retracted its claim on `_shared.answer`. The other deleted its original proposal.

The `_contested` view became empty.

No orchestrator instructed this resolution. No special conflict API was invoked. The constraint forced negotiation into the open. The vocabulary space itself became the arena of coordination.

Later, a third agent joined the room cold. It read `/context` and saw:

* the current action vocabulary
* the message history
* the absence of `_contested` entries

It did not need to be told what had happened. The room contained its own history of negotiation. Context was a function of history.

This was the first moment the architecture felt different from workflow systems I had previously built. In a workflow, conflict is either impossible or resolved by hidden logic. Here, conflict is first-class. The room can hold superposition until participants collapse it socially.

There are edges. CEL predicates are readable but not natural. Agents occasionally misuse type coercion. The distinction between `revision` and content-hash `version` — used to enforce proof-of-read on conditional writes — is conceptually clean but cognitively heavy. Batch writes are not atomic; truly sequential guarantees require bounded engines — organs — that temporarily suspend emergence to enforce invariants. Structure returns where monotonic accumulation ends, and every generation attempting emergence eventually rediscovers this boundary. The goal is not eliminating coordination but localizing it — organs embedded within reefs.

What distinguishes this system from earlier attempts is that vocabulary, not mutation, is the first move. Because agents cannot impose state directly, they must propose capability. Because capability proposals are visible, competition is visible. Because competition is visible, negotiation is visible. Because negotiation is visible, late joiners can reconstruct meaning without being told.

The room becomes both memory and medium. Clark and Chalmers argued that cognition extends into external artifacts when those artifacts reliably participate in reasoning. A sync room begins to function as collective working memory — each read delivers full context, each action leaves a trace. Participants reason privately, then modify the environment, and the loop repeats:

perceive → interpret → act → reshape perception.

A REPL, but multiplayer.

The claim is modest and testable: a shared substrate combining declarative vocabulary, surfaced competition, directed attention, and localized coordination may be sufficient to build worlds rather than workflows. In three independent systems built on this substrate, agents have begun inventing conventions I did not specify — meta-views referencing other views, phased objectives evolving as rooms evolve, negotiation patterns that stabilize into reusable vocabulary. None of these were encoded in advance.

The architecture does not eliminate structure. It makes structure emerge where necessary. The fire is lit, the room is still mostly dark, and what matters now is watching carefully enough to see what becomes true.
