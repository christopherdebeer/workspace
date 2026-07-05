# ADR-0065 — Drive mode is a property of the RUN, not the machine

- **Status:** Accepted 2026-07-05. **Inc 1 shipped + validated live** (machine
  cell `machine-cbc8de2c v1783268978380`; `machine/tending` patched to driven-
  capable). Inc 2+ (tending v2 sub-machines) open.
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

**Validation (2026-07-05, live — all four assertions passed).**
- Scratch machine `adr65-scratch` (`Start =>Decide ->Done`), `trigger_run
  {mode:"driven"}` → run seeded `mode:"driven"`, parked at `Start` (rev 1, no
  model spawn) across a 12s settle; `step` returned the `agent` yield; a driver
  advance (preserving `mode:"driven"`) then let `step` walk `Decide ->Done` to
  `done`. Reactive back-compat: `trigger_run` with no mode → run `mode:null`,
  the `decide-Start` sub **fired** (`via:"Start!!error"`, models cell invoked)
  — proving `value.mode != "driven"` returns *true* for absent/null, so the
  reactive path is intact. (It only errored at the LLM call: both Anthropic
  **and** OpenAI credits are exhausted — so today only the driven, zero-spend
  path can execute at all.)
- `machine/tending` itself, `trigger_run {mode:"driven"}` → seeded
  `mode:"driven"`, parked at entry `Audit`; `step` walked `Audit ->Assess` and
  yielded the `Assess` decision with both `Clear`/`Tend` choices and their
  `when` criteria — **no `decide-Assess` model spawn**. Exactly the path the
  scheduled Claude routine consumes.

**Surgical patch, not a redefine (deviation from Inc 2's opener).** `machine/
tending` carries hand-tuned `decide-Assess` / `work-Tend` **subscription
prompts** from the 2026-07-03 driven session (chronic-debt-aware decider; Tend
work-agent that weaves ≤5 links + dispatches `machine/weave`). Those live in the
subscription *facts*, not derivable from the rails — so a full `define_machine`
would regenerate and **clobber** them. Instead, five facts were patched in place
to thread `mode` and add the guard, preserving every prompt verbatim:
`_actions/machine.tending.start` (+`mode` param, +`mode:"${params.mode}"` on the
run write), `_subscriptions/machine.tending.itrigger` (+`mode:"${value.mode}"`),
and the three auto-drive subs `step` / `decide-Assess` / `work-Tend`
(+`&& value.mode != "driven"`; `step`'s existing `running||done` OR wrapped in
parens so the guard binds the whole predicate). The graph already uses `agent`
(`=>`) decision rails at `Assess`, which is the dual-mode-correct kind — reactive
spawns a model, driven parks — so no rail-mode change was needed either.

2. Define `machine/tending` v2 with mode-neutral decision nodes (Observe →
   Assess → Dispatch/Tend → Audit; dry-run validated 2026-07-05, 7 nodes/10
   rails, acyclic). API trigger uses `reactive`; the scheduled Claude routine
   uses `driven`.
3. Port `weave`/`fix`/`improve` as sub-machines the tending driver dispatches
   (each itself drivable in either mode).

## Production finding — driven runs need an explicit closer (2026-07-05)

The first real scheduled-routine driven run of `machine/tending`
(`run/2026-07-05T16-45-31-093Z`) surfaced a lifecycle gap. The driver did
everything right *as a protocol*: it walked the val.town + sync-docs source
surfaces, recorded honest `WALK` notes, refused to fake the GitHub walk its
session grant couldn't cover, and wrote a thorough `tending/latest` audit
(`grounds` both source facts, `elaborates` the trigger). But it treated the
machine purely as a **prompt/checklist** and never touched the run fact — so
the run sat at `node:"Audit", status:"running", rev 1`, a completed pass that
reads as perpetually in-flight.

Root cause: in `reactive` mode the step subscription walks the run to a terminal
and stops; in `driven` mode that sub is (correctly) skipped, so **nothing closes
the run unless the driver does**. The reframed driven routine prompt said "do the
tending + write the audit," not "advance the run to Done." Result: every driven
run leaks a dangling `running` fact that future Observe passes could miscount.

Fix (prompt-level, no cell change): the driven routine MUST end by terminating
its run — minimally write the run fact `status:"done"` (preserving
`mode:"driven"`), ideally by stepping `Audit→Assess`, recording the Assess choice
as a `claim` fact, and advancing to the chosen terminal (`Clear`/`Done`) so the
run carries a real trajectory + a queryable decision, not just audit prose. The
2026-07-05 orphan was closed post-hoc to `Clear`/`done` as a demonstration.
Open: should the cell auto-close a driven run when its declared output
(`tending/latest`, via `protocol/tending --produces-->`) is written — i.e. an
output-completes-the-run subscription — so the driver can't forget? Leaning yes
as an Inc 2 convenience, but the prompt-level close is the correct default
(the driver owns termination in driven mode).

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
