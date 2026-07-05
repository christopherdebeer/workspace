# ADR-0065 — Drive mode is a property of the RUN, not the machine

- **Status:** Proposed 2026-07-05 (design — needs a `@c15r/machine` cell change).
- **Depends on:** ADR-0018 (stateless stepper), the DyGram machine model
  (`@c15r/machine.define_machine`/`trigger_run`/`step`), and the WorkspaceRun
  migration investigation (`docs/protocols/val-town-originals/`).

## Context (grounded)

`define_machine` today takes a machine-level `reactive: true | false`, and rail
kinds bake the resolver into the *structure*:

- `reactive: true` registers a `step` subscription so runs **self-drive** on
  change.
- a **`work`** rail SPAWNS `@owner/models.agent` at the node and advances the
  run itself;
- a **`task`** rail parks a claimable hand-off for a **driving agent** instead.

So "who resolves a non-deterministic node" is decided **once, at definition
time**, per rail. That is too binary. The tending protocol wants **both**
entry paths against **one** definition:

1. **Triggered / reactive run** — an event or API trigger fires the machine with
   *no capable agent present*. The machine must instantiate a model
   (`models.agent`) at each decision node to make progress. This is the
   autonomous fallback: correct, but a spawned model is a *less capable* driver.
2. **Scheduled routine, agent-driven** — a Claude Code routine fires and *is*
   the driver. Claude is more capable than a spawned model: it can check source
   surfaces, weigh dispatch-vs-defer with real judgment, read the wider repo/
   substrate. Here the decision nodes should **park as `task` yields** that
   Claude resolves and advances via `step` — no model spawn.

Both must operate on the **same source of truth**: the same
`machine/<name>` decomposition and the same `machine/<name>/run/<id>` facts.
The *only* thing that legitimately differs between the two is **who resolves a
decision node** — and that is a property of *how the run was started*, not of
the machine. Encoding it in the rail kind (or a machine flag) forces two
machines, or a machine that only supports one entry path. The tending protocol
needs one.

## Decision

**Separate the machine's decision STRUCTURE from a run's drive MODE.**

1. **A decision node is mode-neutral.** A node that owes a non-deterministic
   choice declares its decision shape (`agent` / `section` / `vote` / a
   work-prompt) and its `choices` — *not* whether a model or a human resolves
   it. `task` vs `work` stop being distinct rail kinds; both become "a decision
   rail," resolved per the run's mode.

2. **A run carries a `mode`.** `trigger_run` gains
   `mode: "reactive" | "driven"` (stored on the run fact
   `machine/<name>/run/<id>.mode`):
   - `reactive` — the step subscription is live; when a run reaches a decision
     node, the cell resolves it in-process by spawning `models.agent` with the
     node's prompt/grants (today's `work` behavior), then advances.
   - `driven` — the step subscription does **not** auto-resolve decision nodes;
     `step` returns the `{kind, node, choices}` yield to the external caller and
     stops. A capable driver (Claude) resolves it and calls `step` again with
     its decision. (today's `task` behavior).
   - Deterministic `auto` rails run identically in both modes (CEL-guarded,
     in-process). Only decision resolution branches on mode.

3. **`reactive` on `define_machine` becomes the DEFAULT mode, not a hard wire.**
   A machine may declare `defaultMode` (default `reactive`, preserving today's
   behavior); any run may override via `trigger_run { mode }`. A machine is no
   longer "reactive OR driven" — it is "reactive by default, drivable either
   way."

4. **One source of truth, two doors.** The API/event trigger fires
   `trigger_run { mode: "reactive" }` (self-driving, models-backed). The
   scheduled Claude routine fires `trigger_run { mode: "driven" }` and steps it,
   resolving each yield itself. Both read/write the same run facts; an audit
   can't tell them apart except by `run.mode`, which is the honest record of
   *how* it was driven.

## Why this is the right cut

- **Capability follows the driver.** A spawned `models.agent` at a work node has
  the node's prompt and scoped grants — a keyhole. A Claude routine driving the
  same node has the whole session: it can fetch a GitHub surface, diff a repo,
  read forty related facts. The protocol text (see the preserved tending/fix/
  improve originals) is *full of* judgment that wants the capable driver —
  "leverage over count", "don't manufacture dispatches", source-surface walks.
  Forcing that through a spawned model per node throws the capability away.
- **The reactive path stays honest.** When nothing is driving (a webhook, a
  cron with no agent), the machine still makes progress via models — it just
  says so (`mode: reactive`), and a reviewer knows the decisions were
  model-made, not human/agent-made.
- **No divergence.** Two machines (one reactive, one driven) would drift. One
  machine + per-run mode cannot.

## Increments

**Inc 1 — code-confirmed spec (`cells/machine/`, read 2026-07-05).** The change
is small because `step()` is *already* mode-neutral: `engine.ts:590` yields
`{kind, node, choices}` at any non-`auto` rail and never spawns a model. All
reactive auto-driving lives in three projected subscriptions — so "driven" =
"these subs skip this run; the external `step` tool drives it." Exact edits:

1. **Thread `mode` onto the run.** `index.ts` `trigger_run` (`:519`) writes a
   `machine-trigger` fact whose value a trigger→run subscription materializes as
   the run. Add `...(a.mode ? { mode: a.mode } : {})` to that trigger value
   (`:525`), and have the trigger→run projection copy `value.mode` onto the run
   fact it creates (default absent ⇒ reactive). `step()` already preserves it
   (`{ ...cur }`), so it rides every advance.
2. **Make the three reactive subs skip driven runs** — append
   `&& value.mode != "driven"` to each `match.cel` in `engine.ts`:
   - `projectStepSubscription` (`:476`) — the deterministic auto-walker.
   - the `decide-<from>` agent delivery (`:338`).
   - the `work-<from>` model delivery (`:359`).
   Back-compat: runs with no `mode` field satisfy `null != "driven"` ⇒ still
   auto-drive. Existing machines keep their already-projected subs until
   redefined, so **deploying the code alone changes no live machine's behavior**
   — `mode` takes effect per machine only on its next `define_machine`.
3. **`step` tool is already the driven counterpart** (`index.ts:533`,
   `:301` doc) — no change; a driven caller loops step → resolve+advance → step.
   The driver's advance write MUST preserve `mode:"driven"` (else the run
   reverts to reactive and the subs re-engage) — bake this into the driven
   routine prompt and the `decide-<from>` template's "back UNCHANGED except…".
4. Optional `defaultMode` on `define_machine` (identity fact, like today's
   `reactive`), overridable by `trigger_run { mode }`. Keep `reactive:false`
   working as "defaultMode: driven".

Test plan (non-spendy): define a scratch machine, `trigger_run {mode:"driven"}`
→ assert the run parks (no auto-advance, no model spawn) and `step` returns the
yield; `trigger_run {mode:"reactive"}` → assert it self-drives (one model spawn
— the only spendy assertion, run once). Then redefine `machine/tending`.

2. Define `machine/tending` v2 with mode-neutral decision nodes (Observe →
   Assess → Dispatch/Tend → Audit; dry-run validated 2026-07-05, 7 nodes/10
   rails, acyclic). API trigger uses `reactive`; the scheduled Claude routine
   uses `driven`.
3. Port `weave`/`fix`/`improve` as sub-machines the tending driver dispatches
   (each itself drivable in either mode).

## Costs & open questions

- The cell change is real work (subscription + stepper branch on `run.mode`).
  Until it ships, the interim is: define tending with `task` rails +
  `reactive:false` (driven-only) for the Claude routine, and accept that the
  API/event-trigger reactive path waits for Inc 1.
- Open: should `mode` be inferable from the trigger *source* (a `trigger_run`
  with a `text` payload from a Claude routine ⇒ driven; a bare event ⇒
  reactive)? Leaning explicit `mode` — inference is a footgun when a routine
  wants to fire-and-forget reactively.
- Open: a `mixed` mode — some nodes always model-resolved (cheap, mechanical),
  others always driver-resolved (judgment) — regardless of run mode? Possible
  as a per-node `resolve: "auto-model" | "driver" | "either"` override on top of
  the run default. Deferred; `either` (the run decides) is the common case.
