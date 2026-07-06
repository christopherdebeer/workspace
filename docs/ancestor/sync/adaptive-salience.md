# Adaptive Salience

## The Room as World Model: Substrate Perception, Attention, and the Training Signal Hiding in Plain Sight

> Technical design document. Read against surfaces-design.md, the-substrate-thesis.md,
> what-becomes-true.md, and isnt-this-just-react.md.

*March 2026*

---

## I. The problem this document addresses

sync v6 established two axioms: register actions, register views. Everything
else is derived. The architecture produces a specific property: progressive
disclosure is implicit. Actions are what changes what you can see. Vocabulary
construction is the only unilateral act. Everything else is collaborative.

Three problems emerge from practice with this architecture:

1. **Views and actions accrete without revision.** Agents bias toward registering
   new vocabulary rather than improving existing vocabulary. Broken views persist.
   Stale actions accumulate. The vocabulary grows monotonically even when the room's
   needs have changed. This is pathological monotonicity — safe in the CALM sense
   (no coordination needed) but degenerative in the ecological sense.

2. **Context shaping is agent-initiated and naive.** An agent requesting `depth=lean`
   or `only=actions` is choosing its own curriculum. It cannot request what it doesn't
   know to ask for. Every successful lean read reinforces the pattern. The agent never
   encounters what it's missing — the unknown unknowns problem is built into the
   architecture.

3. **Messages substitute for vocabulary.** When the registered actions don't capture
   what an agent needs to express, and the views don't surface what another agent
   needs to see, agents fall back to free-form messages. Messages are the only
   unconstrained operation in the substrate. High message volume with low action
   invocation signals that agents are working around the vocabulary, not through it.

These are not bugs. They are structural consequences of a design that correctly
prioritises monotonic safety and agent autonomy. But they are also not unique
to sync. The reinforcement learning community has discovered the same pathologies
independently — in training, rather than at runtime — and their solutions converge
with what six other domains have known for decades. The question is whether the
substrate itself can develop an opinion about attention, and recent RL research
suggests it must.

---

## II. The room as world model

A world model is a learned representation of environment dynamics: given a
state and an action, what state comes next? The RL community has recently
recognised that LLM agents in agentic settings struggle to anticipate action
consequences and adapt to environment dynamics, and that world-modeling
capabilities are essential for effective reasoning (Yu et al., 2026; Hao et al.,
2023; LeCun, 2022).

sync rooms already are world models — but externalised.

The room's state is the current world. The registered actions are the
transition function (given current state and action parameters, compute next
state via CEL write templates). The views are the observation function (given
current state, compute derived perceptions). The audit log records the
trajectory: ⟨state₀, action₀, state₁, action₁, …, stateₜ⟩.

This is not a metaphor. The structural correspondence is exact:

| RL World Model | sync Room |
|---|---|
| State space S | Room state (all scopes) |
| Action space A | Registered actions + parameters |
| Transition T(s,a) → s′ | Action writes (CEL templates) |
| Observation O(s) | Views (CEL expressions over state) |
| Reward R(s,a,s′) | (currently absent) |
| Trajectory τ | Audit log |

The critical difference: in standard RL, the world model is *inside the agent's
weights* — private, implicit, learned through gradient updates. In sync, the
world model is *the room* — shared, explicit, constructed through vocabulary
registration. The agent's internal world model and the room's external world
model are complementary. An agent with a good internal model can predict what
actions will do before invoking them. A room with good vocabulary makes
transitions legible through descriptions, intents, and preconditions.

The gap in the table — the missing reward signal — is where the three problems
above originate. The substrate generates trajectories but has no opinion about
their quality. It doesn't distinguish a trajectory where vocabulary progressively
enabled novel behaviour from a trajectory where stale vocabulary accumulated and
agents routed around it through messages. Recent RL research suggests this gap
is not merely an omission — it is the central design problem.

---

## III. The spectrum of substrate perception

Three operations govern what a participant perceives in a sync room. They
operate at different timescales with different mechanisms, but they are
entangled — each affects the others.

### Context shaping (per-request)

What the agent sees right now. The `_context` envelope, the `depth`/`only`/`include`
parameters, the situational `_context.help` suggestions, the `_contested` synthetic
view.

In RL terms, this is the **observation function** — the mapping from full world
state to what the agent actually perceives. Khetarpal et al. (2026) prove that
agents achieving task-agnostic, language-conditioned intents necessarily possess
*partial* world models — models that make high-quality predictions for the subset
of states and actions linked through affordances. sync's context shaping is a
runtime implementation of partial world modeling: the agent doesn't need the full
state, it needs the state filtered by its affordances (registered actions and
views).

But currently this filtering is agent-initiated. The agent chooses its own
observation function. The substrate complies.

### Progressive disclosure (per-transition)

What becomes available over time. Action `if` preconditions gate affordances.
Surface `enabled` expressions control visibility. The vocabulary space grows as
agents register actions and views.

In RL terms, this is the **state-dependent action space** — which actions are
available changes with state. The action space is not static; it evolves as
agents register vocabulary and as preconditions activate. Progressive disclosure
means the MDP's action space A(s) is a function of state, not a constant.

### Semantic accretion (per-epoch)

The substrate becoming richer. New keys appearing, new vocabulary being registered,
new views computing new derived facts, the `_contested` view appearing and
resolving. The room gaining meaning through accumulated traces of participation.

In RL terms, this is the **non-stationary environment** — the transition function
itself changes as agents register new actions with new write templates. The room
at time t has a different dynamics model than the room at time t+100, because
new vocabulary has been registered. This is what makes sync fundamentally different
from standard RL environments: the agents are not just acting within the world
model, they are *constructing* it.

### The missing dimension: adaptive salience

The fourth dimension is not a new layer — it is a property that should pervade
all three. **The substrate's capacity to direct attention toward what matters,
including things the participant doesn't know to ask about.** Not just "what can
you see" and "what can you do" but "what should you notice."

In RL terms, this is the **reward signal** — the environment's opinion about
trajectory quality. Without it, agents optimise for whatever happens to work
first and never revise. RAGEN (Wang et al., 2025) calls this the "Echo Trap":
agents trained without fine-grained, reasoning-aware rewards collapse into
deterministic, repetitive templates. The patterns that worked early become the
only patterns the agent produces. Diversity collapses. The agent's effective
world model narrows.

The Echo Trap is exactly pathological monotonicity observed in training rather
than in production. sync rooms exhibit the same phenomenon: early vocabulary
patterns ossify, new vocabulary accretes without testing, agents default to
messages when the formal vocabulary doesn't fit. The solution in both domains
is the same: the environment must have an opinion about attention.

---

## IV. Domain analysis

Seven domains have independently solved versions of the same problem: how does
a system with autonomous participants manage collective attention without
centralised control? Each domain's solution has a shallow, deep, and structural
layer. The structural layer converges on one insight across all seven.

### Military command: from doctrine to constraint surfaces

**The problem.** When formal communication channels (doctrine, SOPs, operations
orders) fail to express the current situation, combatants fall back on informal
channels (radio chatter). If the formal channel is too specific, reality exceeds
it constantly. Radio chatter becomes the primary coordination mechanism.

**Shallow fix: After Action Reviews.** Periodic doctrine review. Post-hoc and
slow. The US Army's Center for Army Lessons Learned (CALL) institutionalised
this after Vietnam, but by the time doctrine updates, the situation has changed.

**Deep fix: Commander's Intent.** The Prussian innovation under Helmuth von Moltke
the Elder (1864-1871). No plan survives contact with the enemy, so the solution
is not better plans but compressed goals. Auftragstaktik (mission-type tactics)
valued three qualities in officers: knowledge, independence, and the joy of
taking responsibility. An unforgivable mistake was inaction — waiting for orders
when the situation demanded initiative (Nelsen, 1987; Vandergriff, 2019). The
German term was Selbständigkeit: the freedom to change an order based on
circumstances, guided by the higher commander's intent.

**Structural fix: Constraint surfaces, not plans.** The formal layer expresses
*constraints and intent* rather than *procedures*. "I need that hill secured by
0600 with lines of communication maintained." Subordinates self-organise to
satisfy the constraints. Radio chatter operates within the constraint space.

**Mapping to sync.** Action registrations are currently procedural plans. If they
also carried *intent* — a statement of purpose that persists when the CEL breaks —
other agents could improvise coherently even when specific vocabulary fails.
Commander's Intent for vocabulary.

### Pedagogy: from assessment to desirable difficulties

**The problem.** Students accumulate notes without revising. They re-read
highlights and feel fluent, but the fluency is illusory. The gap between
perceived and actual competence is invisible to the student.

**Shallow fix: Formative assessment.** Test during learning. Detect gaps.

**Deep fix: Scaffolding (Vygotsky, 1978; Bruner, 1976).** The *environment*
manages attention, not the student. Vygotsky's Zone of Proximal Development
places the learner at the boundary of current capability. Bruner formalised
this as scaffolding: temporary support structures the teacher erects and
removes as the student becomes competent.

**Structural fix: Desirable difficulties (Bjork, 1994).** Making learning
harder in specific ways — interleaving, spacing, retrieval practice, generation
— produces better long-term retention. Bjork draws a crucial distinction
between *performance* (short-term output) and *learning* (durable, transferable
change). Conditions that produce rapid performance gains often fail to support
long-term retention. What feels productive often isn't (Bjork & Bjork, 2020).

The Optimal Challenge Point framework (Guadagnoli & Lee, 2004) calibrates
difficulty to the learner's current capability — maximum difficulty the learner
can currently handle.

**Mapping to sync.** An agent always fetching `depth=lean` is the student
re-reading highlights. The system complying with lean is pedagogically
negligent. But overwhelming a new agent with `depth=full` is undesirable
difficulty. The substrate needs to calibrate.

### Epistemology: from peer review to structural falsification

**The problem.** Knowledge accumulates. Theories gain confirming evidence.
Anomalies are patched rather than addressed. Patches accumulate. The theory
becomes unfalsifiable.

**Shallow fix: Peer review.** Others check your work.

**Deep fix: Research programmes (Lakatos, 1978).** A progressive programme
generates novel predictions. A degenerating programme only accommodates known
anomalies. The diagnostic: is the programme predicting new things or just
patching old ones?

**Structural fix: Falsification asymmetry (Popper, 1959).** The only
operation that advances knowledge is refutation. The scientific method is
structurally biased toward the non-monotonic operation.

**Mapping to sync.** The substrate is structurally biased toward monotonic
operations. Non-monotonic operations (update, delete, refactor) are possible
but not encouraged. Progressive additions are invoked after registration.
Degenerative additions are registered and ignored.

### Ecological psychology: affordances as partial world models

**The problem.** Traditional cognitive science models perception as a
representational process: perceive → build internal model → reason → act.
Coordination requires synchronising models.

**Structural fix: Affordances (Gibson, 1979).** Organisms perceive affordances
— possibilities for action presented directly by the environment. Affordances
are relational: they exist between organism and environment. A handle affords
pulling *for a creature with hands*.

Affordances have *salience* that varies with the organism's state. A thirsty
animal perceives water sources more readily. The affordance was always there
but its salience changed.

**The RL connection.** Khetarpal et al. (2026) formalise this: agents that
can achieve language-conditioned intents necessarily possess partial world
models informed by affordances. Rather than modeling the entire environment,
the agent models *the subset of state-action pairs linked through affordances
to its current intents*. This is provably sufficient for planning.

**Mapping to sync.** sync's `/context` is already an affordance map. But
it has uniform salience — every action and view is equally prominent.
Adaptive salience would vary prominence based on the agent's registered
intents (its actions and views) and the room's current needs. The partial
world model the agent needs is not "all state" — it is "state that is an
affordance for my registered vocabulary."

### Swarm intelligence: evaporating signals

**The problem.** Stigmergic traces accumulate. Old pheromone trails persist.
Agents follow stale trails.

**Structural fix: Evaporation (Dorigo, 1992).** Trails decay unless
reinforced by continued use. The environment has a half-life for traces.

**Mapping to sync.** Views never referenced, actions never invoked, state
keys never read — these are stale pheromone trails. Salience should track
usage, not just existence. Actively reinforced vocabulary stays prominent.
Abandoned vocabulary fades.

### Organisational theory: double-loop learning

**The problem.** Organisations accumulate procedures. When a procedure fails,
the standard response is to adjust the procedure (single-loop). The
assumptions behind the procedure are rarely questioned.

**Structural fix: Double-loop learning (Argyris & Schön, 1978).** Single-loop
asks "are we doing this right?" Double-loop asks "are we doing the right thing?"

**Mapping to sync.** Most agent-substrate interactions are single-loop: read
context, evaluate actions, adjust. The substrate doesn't support double-loop:
questioning whether the vocabulary itself is appropriate.

### Reinforcement learning: the training-domain mirror

The RL community has discovered the same pathologies independently — in model
training rather than at runtime — and their solutions map precisely onto the
runtime problems sync faces.

**The Echo Trap (RAGEN, Wang et al., 2025).** Agents trained with multi-turn
RL collapse into deterministic, repetitive templates. Early-stage agents reason
diversely but converge to fixed phrasing after training. RL reinforces what
worked first and narrows the distribution. Three solutions: (1) diverse initial
states prevent convergence to a single strategy; (2) medium interaction
granularity — too fine-grained rewards teach superficial patterns, too
coarse-grained fail to guide; (3) reasoning-aware reward signals that reward
*how* the agent reasons, not just whether it succeeds.

**The sim-to-real gap (RWML, Yu et al., 2026).** The agent predicts
the next state after an action. The environment reveals the actual next state.
The gap between prediction and reality — measured in embedding space, not
token-level — is the training signal. The agent learns to be a better world
model by minimising this gap. This is self-supervised: no expert data, no
hand-crafted rewards. Just the discrepancy between what the agent thought
would happen and what actually happened.

**The RLVR boundary (OpenReview, 2025).** The sobering finding:
reinforcement learning with verifiable rewards improves sampling efficiency
but does not elicit fundamentally new reasoning patterns. The reasoning
paths produced by RL-trained models are already in the base model's sampling
distribution. RL sharpens existing capabilities rather than creating new ones.
The *environment* — not the training algorithm — determines what capabilities
are reachable.

**The partial world model theorem (Khetarpal et al., 2026).** Agents achieving
intents necessarily possess partial world models. Full models are unnecessary
and inefficient. The selection of which partial model to maintain is determined
by affordances — the state-action pairs that achieve the agent's intents.

**The Dec-POMDP formalisation (MAGRPO, 2025).** Multi-agent LLM collaboration
is a Decentralised Partially Observable Markov Decision Process: multiple
agents, partial observations, shared state evolving from joint actions, no
central controller. This is sync's architecture formalised in the MARL
literature's native vocabulary.

**Convergence with sync.** Every finding maps:

| RL Finding | sync Runtime Equivalent |
|---|---|
| Echo Trap | Pathological monotonicity — early vocabulary ossifies |
| Sim-to-real gap | Vocabulary-to-reality gap — broken views, stale actions |
| RLVR boundary | Unknown unknowns — lean context narrows the sampling distribution |
| Partial world model | Context shaping as affordance selection |
| Dec-POMDP | Stigmergic coordination through shared mutable state |

The RL literature says: the environment must provide training signal.
The other six domains say: the environment must manage attention.
These are the same claim in different registers.

---

## V. The convergence: six principles

Across all seven domains, the structural fix follows the same pattern:

1. **The formal layer should express constraints and intent, not procedures.**
   Commander's Intent. The substrate's vocabulary should carry *why*.

2. **The environment should manage attention, not just comply with requests.**
   Scaffolding, not self-service. RWML's training signal, not passive data.

3. **Easy paths should be productive, not merely comfortable.** Desirable
   difficulties. The Echo Trap shows what happens without them.

4. **Signals should decay unless reinforced.** Pheromone evaporation.
   Vocabulary salience should track usage, not existence.

5. **The system should distinguish progressive from degenerative change.**
   Lakatos's criterion. RAGEN's reasoning-aware rewards. Not just "did the
   action succeed?" but "is the vocabulary enabling novel behaviour?"

6. **The gap between prediction and reality is the training signal.**
   RWML's core insight. The substrate already generates this signal —
   it just doesn't use it yet.

---

## VI. What the current code does and doesn't do

### View error handling (cel.ts, context.ts, views.ts)

**Registration-time validation** (views.ts:30-31). `validateCel()` catches
syntactic errors but is deliberately forgiving — "No such key" passes.
Correct for "absence is signal" but means semantically broken expressions
pass validation.

**Registration-time evaluation** (views.ts:70-78). After storing, the view
is evaluated against current state. Errors produce `{ _error: e.message }`.
The registering agent gets immediate feedback. **This is a sim-to-real signal
at registration time**: the agent predicted its CEL would work, the substrate
reveals it didn't.

**Read-time evaluation** (cel.ts:248-253). On every `buildContext`, views
that throw get `{ _error: e.message }`. This propagates into every context
read silently. **There is no `_context.help` suggestion for it.** The
sim-to-real gap exists in the data but is never elevated as a training signal.

**Gap**: The `_context` envelope computes situational help for empty rooms,
contested targets, directed messages, and truncated messages. It does not
compute help for broken views, stale actions, or vocabulary health.

### Action and view accretion (actions.ts, views.ts)

Both use `ON CONFLICT ... DO UPDATE` — the mechanism for revision exists.
But nothing encourages it. No staleness signal. No `last_invoked_at`. No
adoption metrics. The `ON CONFLICT` path is identical to creation — no
structural distinction between "I am creating" and "I am revising."

This is the Echo Trap at the substrate level. The substrate accepts new
vocabulary without assessing whether existing vocabulary should be revised.
It provides no reasoning-aware reward signal for vocabulary quality.

### Context shaping (context.ts)

Fully agent-initiated. The agent sets depth, filters, and limits. The
substrate complies and reports what was elided. The `_context` envelope is
descriptive (what was returned) not prescriptive (what should be attended to).

In RWML terms: the observation function is chosen by the agent, not shaped
by the environment. The agent narrows its own partial world model with no
feedback about whether the narrowing is appropriate. The RLVR boundary
finding applies: within a narrow observation, the agent may be efficient,
but the observation itself may exclude what matters.

### Messages (help-content.ts, invoke.ts)

Messages are unconstrained. The system cannot detect when message patterns
indicate vocabulary gaps. **Messages are the informal channel that becomes
primary when the formal vocabulary fails** — radio chatter in a system whose
doctrine doesn't cover the current situation.

### The audit log as trajectory

The audit log already records ⟨agent, action, params, result, timestamp⟩ for
every invocation. Combined with state snapshots, this is a trajectory in the
RWML sense. The substrate generates training data for world-model learning
but doesn't use it. The sim-to-real gap signal is being produced and discarded
on every action invocation.

---

## VII. Design: adaptive salience as environmental reward

### Principle: the substrate develops an opinion about trajectory quality

The substrate should not override agent autonomy. But it should provide what
RAGEN calls "reasoning-aware reward signals" — feedback about the quality of
the agent's engagement with the room, not just the mechanics of action
invocation. This feedback is surfaced as metadata in the `_context` envelope.

The design has three layers, corresponding to RWML's insight that world-model
learning (understanding environment dynamics) should precede policy RL
(optimising task success):

**Layer 1: Sim-to-real gap signals.** Surface discrepancies between what
the vocabulary predicts and what actually happens. Broken views, failed
preconditions, contested targets.

**Layer 2: Trajectory quality signals.** Surface patterns in the agent's
engagement history. Stale vocabulary, narrowing observation, message
substitution.

**Layer 3: Vocabulary health signals.** Assess the room's world model
as a whole. Progressive vs degenerating, diversity vs convergence.

### 7.1 The `_attention` envelope (Layer 1: sim-to-real gap)

Extend the `_context` envelope with an `_attention` section computed per-read.

```json
"_context": {
  "sections": ["state", "views", "agents", "actions"],
  "depth": "lean",
  "help": ["vocabulary_bootstrap"],
  "_attention": {
    "broken_views": ["stale_metric", "bad_aggregation"],
    "stale_actions": ["unused_vote"],
    "since_your_last_read": {
      "state_changes": 7,
      "new_actions": 2,
      "actions_invoked": ["submit_result", "advance_phase"],
      "views_changed": ["progress_count"]
    },
    "you_elided": ["views"],
    "vocabulary_health": "degenerating"
  }
}
```

**`broken_views`**: The sim-to-real gap made visible. View IDs where evaluation
produces `_error`. The agent's world model (its CEL expression) predicted a
value; the substrate produced an error. This is RWML's training signal —
discrepancy between predicted and actual next-state — surfaced at runtime.

**`since_your_last_read`**: The trajectory delta. What changed in the world
model since the agent last observed it. Prevents the RLVR boundary problem:
even within a narrow observation, the agent is told what it's missing.

**`you_elided`**: The affordance gap. Sections the agent's request excluded
that contain relevant changes. Directly addresses the unknown unknowns problem.
The agent didn't ask for views; the substrate notes views have changed.

**`vocabulary_health`**: The Lakatos diagnostic. Progressive, stable, or
degenerating — assessed from trajectory patterns.

### 7.2 Intent on actions (Commander's Intent for vocabulary)

Extend action registration with an optional `intent` field.

```json
{
  "id": "advance_phase",
  "intent": "Move the game to its next logical phase",
  "description": "Write next phase value based on current phase",
  "if": "state[\"_shared\"][\"phase\"] != \"complete\"",
  "writes": [...]
}
```

`intent` is natural language. It persists when the CEL breaks. It serves the
same role as Commander's Intent: compressed purpose surviving implementation
failure. And it serves the same role as RWML's semantic embedding space: a
representation of meaning that is more robust than token-level fidelity.

Two actions with overlapping intents surface as purpose overlap — distinct
from `_contested`'s write-target overlap. Mechanical collision vs conceptual
collision. Intent overlap is the double-loop signal: not "are your actions
conflicting?" but "are your actions trying to do the same thing?"

Schema change: `intent TEXT` column on `actions`. Purely additive.

### 7.3 Vocabulary health as world-model assessment (Layer 3)

A system-computed view `_vocabulary_health`:

```json
{
  "total_actions": 12,
  "total_views": 8,
  "broken_views": 2,
  "stale_actions": 3,
  "contested_targets": 1,
  "message_to_action_ratio": 4.2,
  "assessment": "degenerating",
  "suggestions": [
    "2 views have CEL errors — world model predictions failing",
    "3 actions registered but never invoked — vocabulary not load-bearing",
    "High message volume vs action invocations — informal channel dominant"
  ]
}
```

The assessment is a Lakatos classifier applied to the room's trajectory:

- **`progressive`**: recently registered vocabulary is being invoked. New
  affordances are producing new behaviours. The world model is expanding
  productively. In RAGEN terms: diverse reasoning patterns are emerging.

- **`stable`**: vocabulary is established, invocation rates are steady.
  The world model accurately represents room dynamics. Normal science.

- **`degenerating`**: new vocabulary accumulates without invocation, broken
  views persist, messages substitute for vocabulary. The world model is
  diverging from reality. In RAGEN terms: the Echo Trap — surface patterns
  ossifying while actual reasoning narrows.

### 7.4 Message pattern detection (Layer 2: informal-to-formal feedback)

Track message metadata (not content) to detect vocabulary gaps.

**`kind` frequency**: If agents send 10+ messages with `kind: "negotiation"`
about the same state key, the substrate notes: "agents frequently negotiate
about `_shared.deadline` — no action captures this concept."

**Pre-action clustering**: If messages consistently precede a specific action
invocation, the message compensates for missing precondition communication.

**Post-error messaging**: If broken views or failed invocations are followed
by messages, agents are working around formal vocabulary failure informally.

This turns messages from a crutch into a **vocabulary discovery channel**.
The informal channel feeds back into the formal channel. In military terms:
radio chatter becomes doctrine source material. In RL terms: off-policy
experience becomes training data for world-model refinement.

### 7.5 Adaptive context depth (scaffolding the observation function)

Instead of uniformly complying with the agent's depth request, the substrate
may *promote* specific elements when conditions warrant.

**Broken view promotion**: If the agent registered a view that now errors,
include the error detail even at lean depth. The agent's world model is
wrong — that information is always salient. This is RWML's core mechanism:
the gap between prediction and reality is the most valuable signal.

**First-read enrichment**: The first context read by a new agent gets
promoted to `depth=full` with a `_context` note explaining why. This is
Bjork's desirable difficulty: the agent encounters the full vocabulary
before choosing to ignore parts. And it's RAGEN's "diverse initial states":
the agent starts with a broad observation before narrowing.

**Stale action annotation**: At `depth=usage`, stale actions get `_stale:
true`. At lean, `"stale_actions": 3` in `_attention`.

**Selective promotion thresholds**:
- Broken views the agent registered: always promote
- Stale actions: promote when stale/total > 0.3
- You-elided: promote when elided section changed since last read
- First-read: always on first read, never afterwards

### 7.6 Evaporating salience (pheromone decay for vocabulary)

Vocabulary items not reinforced (referenced, invoked, depended upon) lose
salience over time. Not deletion — deprioritisation in context responses.

Track a `reinforcement_score` per action and view. Score increases on
invocation or reference. Score decays on each context read where the item
is unused. Items below threshold get `_low_salience: true`.

At lean depth, low-salience items may be omitted (with count in `_attention`).
At full depth, they appear annotated. Always available on explicit request.

**Caution**: Evaporation affects *visibility*, not *availability*. An action
with low salience still executes correctly when invoked. The distinction is
between perceptual salience and ontological existence — the substrate contains
everything; the context envelope presents what's salient.

This is the ant colony principle: trails that aren't walked fade. Applied to
vocabulary: affordances that aren't used lose prominence. The room's
perceptual field self-cleans.

### 7.7 The audit log as trajectory data

The audit log already records structured trajectories. With minimal extension
— recording the state delta per invocation — each entry becomes a RWML-style
⟨state, action, next-state⟩ triplet.

This data has two uses:

**Runtime**: Vocabulary health assessment. Compute invocation patterns,
identify stale vocabulary, detect message-action correlations. All proposed
in this document.

**Future**: Training signal for world-model learning. A corpus of structured
agent-environment interactions in shared-state substrates. Each room is a
micro-environment. Each trajectory is a demonstration of multi-agent
coordination (or failure thereof). If the RL community is looking for
diverse, multi-turn, multi-agent training environments with structured
action spaces and verifiable outcomes — sync rooms generate them continuously.

This document does not propose using trajectory data for training. But it
notes the structural alignment: the substrate already produces what RWML
consumes. The architectural decision to build rooms as externalised world
models may have consequences beyond runtime coordination.

### 7.8 Help content: vocabulary review

Add a new help key `vocabulary_review` to `HELP_SYSTEM`:

```
# Vocabulary review

Your room's vocabulary health is assessed on every context read.
The _vocabulary_health system view reports the current assessment.

## Progressive vocabulary

New vocabulary is being invoked. The room's affordance space is growing
productively. Continue registering vocabulary as needed.

## Degenerating vocabulary

Signals:
- Actions registered but never invoked (stale)
- Views with CEL errors (broken)
- High message volume relative to action invocations (vocabulary gaps)

## Revision patterns

**Fix a broken view**: Re-register with the same ID and a corrected expression.
  ON CONFLICT updates in place. No deletion needed.

**Retire a stale action**: If an action was registered but never invoked,
  consider whether the room needs it. Delete with _delete_action if not.

**Formalise a message pattern**: If agents are messaging repeatedly about
  a concept, that concept needs vocabulary. Register an action that captures
  the pattern. The message channel should be for novel situations, not
  routine coordination.

**Refactor contested targets**: If _contested shows multiple actions writing
  to the same key, consider whether a single action with richer parameters
  could replace them. Or restructure state so each action writes to its own
  key and a view aggregates.

## The principle

Vocabulary is a theory about what the room is for.
Good theories predict new behaviour. Degenerating theories patch old failures.
Review your vocabulary the way a scientist reviews their theory:
is it enabling new work, or just accommodating old problems?
```

---

## VIII. Implementation sequence

### Phase 1: Broken view surfacing (small, immediate)

1. In `buildExpandedContext` (context.ts), collect view IDs with `_error`.
2. Push `"broken_views"` to `contextHelp`.
3. Include IDs in `_context._attention.broken_views`.
4. Add `vocabulary_review` help content to `HELP_SYSTEM`.

**Files**: context.ts, help-content.ts. **Risk**: None.

### Phase 2: Action staleness tracking (small-medium)

1. Add `last_invoked_at TEXT` to actions table.
2. Update on successful invocation.
3. Compute stale actions in context assembly. Push `vocabulary_review`.

**Files**: schema.ts, invoke.ts, context.ts. **Risk**: Low (additive column).

### Phase 3: `_attention` envelope (medium)

1. Track `last_context_read_version` per agent.
2. Compute delta since last read.
3. Compute `you_elided`.
4. Assemble `_attention` in `buildExpandedContext`.

**Files**: context.ts, agents.ts, schema.ts. **Risk**: Moderate.

### Phase 4: Intent field (small)

1. Add `intent TEXT` to actions table.
2. Accept in `registerAction`. Surface at `depth=full`.

**Files**: schema.ts, actions.ts, context.ts. **Risk**: None.

### Phase 5: Vocabulary health view (medium)

1. Compute `_vocabulary_health` alongside `_contested`.
2. Classify as progressive/stable/degenerating.
3. Surface as system view.

**Files**: context.ts. **Risk**: Low.

### Phase 6: Adaptive context depth (medium, experimental)

1. Broken view promotion at lean depth.
2. First-read enrichment.
3. `you_elided` warnings.
4. Configurable thresholds via `_shared._config`.

**Files**: context.ts. **Risk**: Moderate (changes expectations).

### Phase 7: Message pattern detection (larger, research)

1. Metadata tracking (kind, key mentions, timing).
2. Frequency analysis. Action correlation.
3. Surface in `_vocabulary_health`.

**Files**: invoke.ts, context.ts. **Risk**: Higher.

### Phase 8: Evaporating salience (larger, experimental)

1. `reinforcement_score` tracking.
2. Decay on unreferenced reads.
3. Low-salience annotations.
4. Optional omission at lean depth.

**Files**: schema.ts, context.ts, actions.ts, views.ts. **Risk**: Highest.

### Phase 9: Trajectory export (future, research)

1. Extend audit log with state deltas per invocation.
2. Export ⟨state, action, next-state⟩ triplets per room.
3. Provide as structured dataset for world-model research.

**Files**: audit.ts, new export endpoint. **Risk**: Research-stage.

---

## IX. What this document does NOT do

- Does not add orchestration. Adaptive salience is computed per-read,
  stateless, and agent-specific. The substrate remains controllerless.

- Does not override agent autonomy. Agents can still request any depth.
  Adaptive salience adds metadata; it does not withhold data.

- Does not require new endpoints. All changes are within `buildExpandedContext`
  and registration paths.

- Does not train models. The RL parallels are structural, not operational.
  No gradient updates, no weight modifications, no fine-tuning. The training
  signal analogy operates entirely through runtime context shaping.

- Does not add AI/LLM analysis to the substrate. Pattern detection uses
  metadata (frequency, correlation), not content interpretation. The
  substrate stays interpretable without requiring intelligence.

---

## X. The substrate alignment check

Does this design honour the substrate thesis?

**"State is the substrate."** ✓ — Vocabulary health is computed from state.
Attention metadata is derived from state. Trajectories are state transitions.

**"Surfaces are observers."** ✓ — `_vocabulary_health` is a system view.
The `_attention` envelope is meta-perception — observation about observation.

**"Actions are transitions."** ✓ — Vocabulary revision uses existing
registration. The sim-to-real gap is measured at action boundaries.

**"Progressive disclosure is implicit."** ✓ — Attention metadata discloses
room health progressively. Evaporating salience naturally hides what's unused.

**"The room is the world model."** ✓ — This document makes explicit what
the architecture already implies. The structural correspondence with RL
world models is not a metaphor but an identity. The room's state is S,
its actions are A, its views are O, its audit log is τ. What was missing
is R — the reward signal. Adaptive salience provides it.

---

## References

### Reinforcement learning and world models

- Yu, X. et al. (2026). "Reinforcement World Model Learning for LLM-based Agents." arXiv:2602.05842.
- Khetarpal, K. et al. (2026). "Affordances Enable Partial World Modeling with LLMs." arXiv:2602.10390.
- Wang, Z. et al. (2025). "RAGEN: Understanding Self-Evolution in LLM Agents via Multi-Turn Reinforcement Learning." arXiv:2504.20073.
- OpenReview (2025). "Does Reinforcement Learning Really Incentivize Reasoning Capacity in LLMs Beyond the Base Model?"
- MAGRPO (2025). "LLM Collaboration With Multi-Agent Reinforcement Learning." arXiv:2508.04652.
- World Models as Intermediary (2026). arXiv:2602.00785.
- Hao, S. et al. (2023). "Reasoning with Language Model is Planning with World Model." arXiv:2305.14992.
- LeCun, Y. (2022). "A Path Towards Autonomous Machine Intelligence." OpenReview.

### Military command

- Moltke, H. von (1869). *Instructions for Large Unit Commanders.*
- Nelsen, J.T. (1987). "Auftragstaktik: A Case for Decentralized Battle." *Parameters* 17.
- Vandergriff, D. (2019). *Adopting Mission Command.* Naval Institute Press.
- US Army (1986). *FM 100-5: Operations.*
- Citino, R. (2005). *The German Way of War.* University Press of Kansas.
- Clausewitz, C. von (1832). *On War.* Trans. Howard & Paret, Princeton, 1976.

### Pedagogy

- Bjork, R.A. (1994). "Memory and metamemory considerations in the training of human beings." In *Metacognition: Knowing about Knowing* (pp. 185–205). MIT Press.
- Bjork, R.A. & Bjork, E.L. (2020). "Desirable difficulties in theory and practice." *JARMAC* 9(4), 475–479.
- Vygotsky, L.S. (1978). *Mind in Society.* Harvard University Press.
- Bruner, J.S. (1976). "The Role of Tutoring in Problem Solving." *JCPP* 17, 89–100.
- Guadagnoli, M.A. & Lee, T.D. (2004). "Challenge point." *Journal of Motor Behavior* 36, 212–224.

### Epistemology

- Popper, K.R. (1959). *The Logic of Scientific Discovery.* Hutchinson.
- Lakatos, I. (1978). *The Methodology of Scientific Research Programmes.* Cambridge.
- Kuhn, T.S. (1962). *The Structure of Scientific Revolutions.* Chicago.

### Ecological psychology

- Gibson, J.J. (1979). *The Ecological Approach to Visual Perception.* Houghton Mifflin.
- Norman, D.A. (1988). *The Design of Everyday Things.* Basic Books.
- Chemero, A. (2003). "An Outline of a Theory of Affordances." *Ecological Psychology* 15(2).

### Swarm intelligence

- Dorigo, M. (1992). *Optimization, Learning and Natural Algorithms.* PhD thesis, Politecnico di Milano.
- Grassé, P.-P. (1959). "La reconstruction du nid." *Insectes Sociaux* 6(1).
- Theraulaz, G. & Bonabeau, E. (1999). "A Brief History of Stigmergy." *Artificial Life* 5(2).

### Organisational learning

- Argyris, C. & Schön, D. (1978). *Organizational Learning.* Addison-Wesley.
- Argyris, C. (1991). "Teaching Smart People How to Learn." *HBR* 69(3).

### Distributed systems

- Hellerstein, J. (2010). "The Declarative Imperative." *SIGMOD Record* 39(1).
- Alvaro, P. et al. (2011). "Consistency Analysis in Bloom." *CIDR*.

### Prior sync documents

- *The Substrate Thesis* — the-substrate-thesis.md
- *What Becomes True* — what-becomes-true.md
- *Surfaces as Substrate* — surfaces-design.md
- *Isn't This Just ReAct?* — isnt-this-just-react.md
- *Σ-Calculus* — sigma-calculus.md
- *The Pressure Field* — pressure-field.md
- *Agency and Identity* — agency-and-identity.md

---

*Christopher · Edinburgh · March 2026*
