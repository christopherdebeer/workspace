# `@c15r/machine` and Claude's agentic-workflow patterns

> A reference reading of Anthropic's published guidance on agentic workflows
> (Building Effective Agents, Claude Code Routines, the Claude Agent SDK, Agent
> Skills, MCP, and the "dynamic workflows / harness" post) mapped onto this
> cell's **rail** model, and the concrete primitives we adopted from it. Companion
> to `docs/machine-dygram-contrast.md`. Sources are listed at the end.

## The mapping is validating, not contradictory

Our four rail modes turn out to be a **typed, auditable encoding of Anthropic's
whole spectrum** from "predefined code paths" (workflows) to "the model directs
its own process" (agents):

| Anthropic pattern | Rail mode | Note |
| --- | --- | --- |
| Workflow / predefined code path | **auto** | deterministic, no LLM — both are "predefined paths". |
| **Routing** (LLM classifies → 1 of N predetermined branches) | **agent** | exact match — *and we record the choice as a `claim` with confidence*, which Anthropic's routing treats as ephemeral. |
| Prompt chaining + gates | **auto** chain with an **agent** gate | the gate is an agent rail that may branch/halt. |
| **Orchestrator–workers** | **work** rail whose agent spawns nested work/task rails | the orchestrator is an autonomous loop. |
| **Evaluator–optimizer** | `work → agent(evaluate) → loop-back` | encode the loop in the graph; make the critique an auditable claim. |
| Parallelization — **sectioning** | **section** rail (NEW) | independent subtasks fanned out, then synthesized. |
| Parallelization — **voting** | **vote** rail (NEW) | same node sampled N× → consensus. |
| Fully autonomous agent | **work** rail | Anthropic's "agent". |
| MCP **tools** (model-controlled) | **work**/agent rails | the loop discovers & calls tools. |
| MCP **resources** (app-controlled) | **auto** rails | system-provided context that auto-advances. |
| MCP **prompts** (user-controlled, templated) | a **machine** itself | a parked, user-selected, invocable graph. |
| (no analog) | **task** rail | parked claimable hand-off for a *different* driving agent — genuinely novel vs even the Agent SDK's spawn-and-await subagents. |

**Where we already improve on the reference.** Routing's classification is
ephemeral; ours is a `claim` with confidence + support — a certificate of
reasoning. MCP discovery is a *flat* tool list; our graph encodes
**state-conditioned** tool/branch availability (a thing MCP can't express).

**Where the reference disciplines us.** Anthropic's prior is "use the simplest
thing; add agency only when it demonstrably helps." A substrate makes agent/work
rails *cheap*, so we must enforce by convention what Anthropic enforces by
friction: **default a rail to `auto`; promote to `agent` only at a real decision;
promote to `work` only when subtasks can't be predetermined.** This is the same
medicine as the tending diagnosis — don't spend reasoning where there is no
choice (Anthropic's "LLM elision" instinct).

## The "scheduled routine pointed at a machine" finding

The consumer **claude.ai chat has no scheduler.** The real primitive is **Claude
Code Routines** — cloud-durable ("keeps working when your laptop is closed"),
with an **API trigger**: an authenticated HTTPS endpoint + bearer token + an
optional `text` body for run context. Claude Cowork's scheduled tasks are the
anti-pattern (only run "while the app is open").

What we adopted (this increment): a uniform **`trigger_run`** entry — any
authenticated principal (including a Claude.ai routine using substrate creds)
fires a machine by name, with a `text`/`context` body injected onto the run fact
so the entry node's agent sees the trigger context. Internally every projected
machine now registers a standing **internal-trigger subscription** so writing one
`machine-trigger/<name>/<run>` fact starts a run — the substrate-native version of
the HTTPS endpoint. *(The remaining generalization — a public, token-bearer HTTPS
endpoint for principals without substrate creds — needs a platform change
[public POST + token validation]; documented here as the next edge.)*

⚠️ **Design caveat, load-bearing.** There are live Claude Code bugs where MCP
connectors are *not* injected into autonomous scheduled-run sessions until a live
message "warms" them. The lesson: bind a work rail's tool set **deterministically
at spawn**, never lazily. Our `tools` allowlist (`docs/machine-agent-scopes.md`)
already does this — keep it that way.

## Progressive disclosure (from Agent Skills)

Skills load in three tiers — metadata always (~100 tokens), the body on trigger,
bundled files on demand — so "you can install many Skills without context
penalty." We mirror this for rails:

- **Level 1 (always):** an agent rail sees only branch *descriptors* — `{to,
  mode, when}` (a one-line "when to use this"). Added a `when?` field to rails and
  a **`disclose`** read tool returning the tiered menu (Level-1 machine→nodes→
  available rails; Level-2 a single node's full body on request).
- **Level 2 (on entry):** a node's full body/prompt loads only when the run
  enters it (the `work`/`decide` delivery carries it).
- **Level 3 (on demand):** `auto` rails / tools execute and return only their
  *output* into context, never their mechanism.

This bounds context cost as a machine grows — the "vocabulary that grows" without
a token penalty.

## Parallel branching primitives (sectioning + voting)

Anthropic's two parallelization variants (and the harness post's
"fan-out-and-synthesize" / "adversarial verification") map onto two new rail
modes. Because our execution is event-sourced over facts, the **fan-out is
declarative** (one child-run write per branch) and the **join is agentic and
eventually-consistent** (a synthesis/tally agent re-reads the full child set on
each child completion and only advances once all are present — idempotent, no lost
-update race):

- **`section`** — a fan node spawns one **child run per target** (independent
  subtasks). A synthesis **work** agent gathers all child results and writes the
  join, advancing the parent. ("fan-out-and-synthesize".)
- **`vote`** — a fan node spawns **K samples of one branch**; a tally agent reads
  the K claims and records a **consensus** claim with confidence, then advances.
  ("voting / adversarial verification".)

Child runs reuse the internal-trigger mechanism (`machine-trigger/...`), so a
section/vote branch is just a normal sub-run — fully visible in the runs list and
the diagram overlay.

## Other adoptable ideas (backlog, not yet built)

- **Native evaluator–optimizer** rubric loop as a graph idiom (work→agent→loop).
- **Governance bounds** on work/task rails: per-run/day caps + auto-expiry on
  reactive runs (Routines expire recurring tasks after 7 days to bound forgotten
  loops). Our new `validate_machine` `cycle` warning is the first step.
- **Session fork/resume** semantics → branch a `machine-run` for what-if/voting
  off a shared prefix.
- **Hooks as the auto-rail enforcement model** (Agent SDK `PreToolUse` deny/
  modify) — a pre-transition guard that records its decision as a claim.

## Sources

- Building Effective Agents — https://www.anthropic.com/engineering/building-effective-agents · https://www.anthropic.com/research/building-effective-agents · https://github.com/anthropics/anthropic-cookbook/tree/main/patterns/agents
- Claude Code Routines / scheduled tasks — https://code.claude.com/docs/en/routines · https://claude.com/blog/introducing-routines-in-claude-code · https://code.claude.com/docs/en/scheduled-tasks
- Cowork scheduled tasks — https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork
- Dynamic workflows / harness — https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code
- Agent SDK — https://code.claude.com/docs/en/agent-sdk/agent-loop · /subagents · /permissions · /hooks · /sessions · https://claude.com/blog/building-agents-with-the-claude-agent-sdk
- Agent Skills — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview · https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- MCP — https://modelcontextprotocol.io · /specification/2025-06-18/architecture · /server (tools/resources/prompts) · /client/sampling
- Connector-injection bugs — anthropics/claude-code issues #43397, #35899, #42033, #40835
