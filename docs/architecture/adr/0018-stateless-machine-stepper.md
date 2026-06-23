# ADR-0018 — The stateless machine stepper: advance a run in-process, not by fact-cascade

- **Status:** Proposed — the pure core (`step()` in `cells/machine/engine.ts`) and its tests
  land with this ADR; the cell-side shell wiring (the `step` tool + reactive subscription
  rework) is the follow-on increment.
- **Date:** 2026-06-23
- **Context:** [`docs/machine.md`](../../machine.md) and ADR-0011's open item. The machine
  cell's deterministic prefix currently advances by writing a fact **per auto-rail hop**, each
  write re-triggering the reactor to fire the next rail's declared action. This cascade is the
  surface where ADR-0011's two failure modes (non-atomic multi-write; `FailedEntryCount`-ignoring
  emit) actually bite: a dropped intermediate `fact.written` strands a run mid-prefix, silently.
- **Depends on:** ADR-0017 (Cell substrate access — the stepper reads the def + run and emits
  one advance), ADR-0011 (Reactivity — what it replaces for deterministic rails), ADR-0003
  (Reference / claims — decisions at yields stay certificates of reasoning), `docs/machine.md`
  (the rail model).

---

## Context (grounded)

A machine run is a fact `machine-run/<run>` = `{ machine, node, status, … }`; "executing" is
advancing that fact. Today (`projectActions` / `projectSubscriptions` in `engine.ts`) every
`auto` rail becomes **its own declared action + its own subscription**: the run lands on node
`A`, the reactor matches the `A→B` subscription, invokes the `A→B` action, which writes the run
at `B`; that write re-fires the reactor for `B→C`; and so on. A three-hop deterministic prefix
is **three fact-writes and three reactor round-trips**, each one a place the cascade can drop.

This is structurally wrong for the *deterministic* part of a machine. The hops are pure
functions of the def and the run — there is nothing to react to, nothing non-deterministic to
decide. We pay the full reactive machinery (multi-write atomicity, EventBridge at-least-once,
the depth cap) for transitions that have no choice in them. ADR-0011 left "at-least-once vs
exactly-once under the depth cap" open precisely because this cascade is where it's felt.

The genuinely non-deterministic rails are the other five modes: `agent`/`task` (a model or a
human chooses a branch), `work` (a spawned agent does a job), `section`/`vote` (fan out, then a
barrier). *Those* need substrate-side reactions or a driver. The `auto` prefix between them does
not.

## Decision

Make the deterministic prefix a **pure, in-process walk** — the stateless stepper — and stop
writing a fact per hop.

`step(run, machine, nowIso)` (now in `cells/machine/engine.ts`, unit-tested in
`tests/machine-engine.test.ts`) is a pure function. Given the run fact value and the machine
def, it follows `auto` rails — evaluating each rail's optional CEL `condition` against the run
(`value.<path>`, the same binding as subscription `match.cel` and action `if.cel`) — advancing
the node **in memory, emitting no intermediate writes**, until it reaches one of:

| outcome | meaning | result |
|---|---|---|
| **terminal** (no outgoing rails) | the run is done | `{ run: {…status:'done'}, yield: null }` |
| **non-`auto` node** (agent/task/work/section/vote) | a decision/job lives here | `{ run, yield: { kind, node, choices } }` |
| **stall** (every auto guard false) | can't advance deterministically yet | `{ run: {…status:'blocked'}, yield: { kind:'blocked', … } }` |
| **cycle** (auto rails loop past the node budget) | a guardless loop | `{ run: {…status:'blocked'}, yield: { kind:'cycle', … } }` |

The caller persists the returned `run` as **one** write — the latest revision of
`machine-run/<run>`, not one per hop. `path` is the node trail walked (trajectory/debug). The
whole deterministic prefix collapses to a single function call and a single fact write.

### Driven vs reactive — the same `step`, two callers

- **Driven:** a driving agent calls the `step` tool, reads `yield`, makes the decision at
  `yield.node` (invokes the chosen branch / does the work / tallies), then re-steps. The agent
  is the loop; `step` tells it where it can act.
- **Reactive:** one subscription on the run fact delivers to `machine.step`; at a `yield` of
  kind `agent`/`work` it delivers to a model; the model's write re-triggers `step`. The reactor
  fires **once per non-deterministic node**, not once per auto hop.

Either way determinism never touches a model or a fact-cascade — it is the pure function.

### The join barrier becomes deterministic

Today's `section`/`vote` join is an *agentic, eventually-consistent* barrier: because the cell
couldn't read, it delivers to a model that re-queries the children and decides if all are done
(`projectSubscriptions`' `join-<F>` deliver to `models.agent`, matched by the key separator
`§`/`#`). With ADR-0017 the cell can read the children directly: when a child completes, `step`
(or a small barrier helper) reads the siblings, and if all are `done`, advances the parent
itself — **no model, no `models.decide` concurrency dependency** (the open issue where
concurrent vote-child decisions didn't auto-complete). The synthesis/tally *content* may still
want a model; the *barrier logic* (all-done? advance) is deterministic and in-process.

### What is preserved

- **Claims as certificates (ADR-0003).** A decision at an `agent`/`task` yield still records a
  `claims/<run>.<node>` fact (`statement`, `confidence`, `chose`). The stepper changes *when/how*
  the run advances, not that reasoning leaves a trace.
- **The rail model + projection vocabulary.** `railsFrom`, `validateMachine`, and the
  section/vote spawn (`spawnChildrenWrites`) are unchanged. What shrinks is the per-`auto`-rail
  action/subscription projection — replaced by the single "on run change → step" subscription.
- **Driven mode needs no subscriptions at all** — `step` is callable cold.

## Consequences

- **Removes the deterministic-cascade failure surface.** No intermediate writes ⇒ no dropped
  intermediate `fact.written` ⇒ ADR-0011's at-least-once-under-depth-cap worry no longer applies
  to `auto` rails (it remains only at genuine yields, which are few and model-paced).
- **Fewer declared facts.** A prefix of N auto rails was N actions + N subscriptions; now it is
  zero — folded into one pure function and one "step on change" subscription.
- **Unblocks the deterministic join**, retiring the agentic barrier and the `models.decide`
  concurrency dependency for completion (synthesis content aside).
- **Cleanup owed (follow-on increment):** rework `projectActions`/`projectSubscriptions` to stop
  emitting per-auto-rail vocabulary and emit the single step subscription; add the `step` cell
  tool (shell) reading the def/run via ADR-0017's client; replace `spawn_children`'s agentic join
  with the in-process barrier. Tracked in `docs/machine.md` §13.
- **Cost / open:** `step` evaluates CEL in the cell (cel-js now declared in the machine cell's
  `imports.json`); a malformed `condition` is treated as a non-firing rail (false), which can
  present as a `stall` rather than a loud error — `validate_machine`-style static checking of
  rail conditions at `define_machine` time is the mitigation, not yet built.
