# ADR-0026 — `@c15r/run` as machine's code-executor (run-jobs as facts → `work-code` rail)

- **Status:** Proposed (sketch — not built). A forward design capture for incorporating the `@c15r/run`
  executor cell into `@c15r/machine`, following a capabilities review of both cells. Decides the
  direction so the run-job and rail-mode shapes don't drift before the work starts.
- **Date:** 2026-06-25
- **Context:** Two cells sit side by side with no structural link. **`@c15r/machine`** (ADR-0018/0019) is
  a declarative state-machine compiler whose `work` rail can spawn exactly one thing: an LLM agent
  (`@owner/models.agent`). **`@c15r/run`** is a server-side JS/TS executor — `exec`/`fetch`, with
  `parc.read/query/emit` substrate bindings, sync or async (self-invoke Lambda + poll) — whose jobs are
  *transient* DynamoDB rows (`JOB#…`, 1h TTL, `pending|done|error`). The review surfaced two facts: (a)
  many machine steps are pure code (transforms, fetches, math) that shouldn't burn a model; (b) run's
  jobs are invisible to the substrate — not queryable, linkable, tend-able, or trace-bearing like a
  `machine-run`. So a machine has only one execution primitive, and the other candidate executor can't
  even be observed.
- **Depends on:** ADR-0017 (shared cell substrate client — run's `parc.*` bindings), ADR-0018 (stateless
  stepper — the deliver/advance shape a code step plugs into), ADR-0019 (decomposed machine + rail
  modes + `models.agent` as the one model primitive).

---

## Sketch (decisions, tentative)

### 1. Seam B first — run-jobs become substrate facts

Retire the transient `JOB#…` row for a durable `run-job` fact: `run-job/<jobId>` = `{ code, lang, input,
status, result?, logs?, emitted?, error?, at }`, with a `run-job` type in `types.json`. This buys
observability/trace parity with `machine-run` for free — a run is then queryable, linkable, salient, and
tend-able like every other fact, and a machine can *read the result back* by key instead of needing run
to know about machines. (The async self-invoke pattern is unchanged; only the storage tier moves.)

### 2. Seam A — a machine `work-code` rail delivers to `@owner/run.exec`

Add `work-code` to the rail-mode enum. Where a `work` rail delivers the node to `@owner/models.agent`,
a `work-code` rail delivers to `@owner/run.exec` with the rail's `code` body + the run context as
`input` (async). On completion the machine advances by reading the `run-job` fact's `result` and folding
it into the `machine-run` advance — the **cell** does the fold (run never learns about machines, keeping
the encapsulation ADR-0019 established for `models`). A machine then has two symmetric execution
primitives: **agent** (LLM, `models.agent`) and **code** (deterministic, `run.exec`), both observable as
facts, both joinable by the existing barrier.

### 3. What stays out (for now)

- **Seam C** (machine-triggered run via `parc.emit`) already works as plain user code — no integration
  needed.
- **Seam D** (unify run + models behind one executor tier) is high-effort and breaks the clean
  code/model separation; explicitly out of scope.
- `@c15r/run` is **not** retrofitted to back the `workspace_run_*` MCP tools (a separate routines
  mapping) — that conflation is a non-goal.

## Why now (buffer rationale)

The review found the two cells are one rail-mode and one storage-tier change away from composing into a
materially more expressive machine. Sketching it now pins the two shapes that would otherwise drift: the
`run-job` fact schema (§1) and the `work-code` deliver/advance contract (§2). Build order is **B then A**
— durable run-jobs are the prerequisite that lets a machine read a code step's result back without run
reaching into machine state.

## Open questions

- **Result hand-off**: does the machine poll the `run-job` fact (a reactive subscription on
  `run-job/<id>` status→done), or does `run.exec` accept an `onSuccess` advance template the way work
  rails pass claim templates? The latter is tighter but couples run to the advance vocabulary.
- **Scope/grants**: a `work-code` step runs as the owner via run's IAM slice — does it get a per-run
  minted token + `grants` allowlist like the `work` (agent) rail, or run under the machine owner's
  ambient slice? (Ties to ADR-0023 per-type scopes — a code step should get the narrowest grant.)
- **Failure → catch**: a thrown/`error` run-job should surface as a `failed` step so an existing `catch`
  rail can handle it — confirm the stepper maps run-job `error` onto the catch path.
- **Determinism budget**: code steps can loop/hang; the async Lambda + TTL bounds it, but the stepper's
  cycle/loop guard (ADR-0019 v5.5) should treat a `work-code` yield like any other non-deterministic hop.
