# ADR-0084 — The drive surface: yields as affordance maps, context binds, and the revisor round-trip

- **Status:** Accepted + built + validated live 2026-07-14 (machine cell
  `machine-cbc8de2c v1783987916528`, platform deploy run #346, drive-proof run
  `machine/drive-proof/run/2026-07-14-ergonomics-drive` driven to `done` in three
  calls). Follow-on increments open (§Open).
- **Depends on:** ADR-0065 (drive mode per run), ADR-0018 (stateless stepper),
  ADR-0024 (delegation-chain tokens — the embodiment record), ADR-0001 (declared
  actions). **Completes (first slice):** the DyGram data plane the original fold-in
  dropped (docs/machine.md §2.1's "kind is cosmetic" admission).
- **Grounded in:** a primary-source read of both ancestors — sync
  (`docs/ancestor/sync/agent-sync-technical-design.md`; repo verified at
  `363194206d35`) and DyGram (`christopherdebeer/machine` @ `c42f47f3`:
  `context-builder.ts`, `context-permissions.ts`, `edge-map-design.md`,
  `machine.langium`).

---

## Context

Agent-driven machines (ADR-0065) worked, but only through discipline. The live
record was stark: the scheduled driven routine had a **100% completion rate**
while the reactive path sat at **0% since 2026-07-09** — and even the driven
path leaked (the 2026-07-05 unclosed run) and depended on prompt-level rules
("write the run back UNCHANGED except…", "echo mode:'driven'") that every
driver had to re-implement in its own context window. Three structural
problems:

1. **Mode was fragile.** Every write that *rebuilt* a run value dropped it: the
   section/vote fan, the join barrier, and the projected `decide-*` action all
   reverted a driven run to reactive mid-flight. Sub-machines (fan children)
   spawned mode-less.
2. **The machine had no data plane.** Rail CEL saw only the run value; context
   was an English reading-list inside a generated prompt; the render showed
   topology but none of the conditions/prompts/grants/tools that make a machine
   what it is. Both ancestors had solved this: sync's rooms carried registered
   actions/views whose *resolved values ride every context response*; DyGram
   wired **context nodes** to task nodes **through edges** (the edge label IS
   the permission — read by default, write iff the label carries a write-verb —
   with child nodes inheriting parent context), evaluated CEL guards against
   the attribute plane, and pre-evaluated conditions to style the diagram.
3. **Revision was hazardous.** `machine/tending`'s decider prompt lived in
   hand-patched `_subscriptions/*` facts a redefine would clobber, so the
   machine was frozen — unrevisable without archaeology.

## Decision

**The yield is the drive surface — a complete affordance map, node-scoped.**
Sync pushed the whole room at the moment of relevance ("the agent never needs a
second read call"); a 6k-fact substrate cannot, but one *node* can. Everything
below serves that principle.

### 1. Mode is inherited like scope (hardening)

Every run-value rebuild now carries `mode` (+ `text`): the fan write, every
spawned child, the join barrier, and the `decide-*` action template (new `mode`
param). A sub-machine dispatched from a driven run is itself drivable and stays
independent — inheritance hop over hop, exactly like scope attenuation in
ADR-0024's chains.

### 2. `step {decide}` — the driver supplies judgment, the cell does mechanics

`step` accepts `decide: {to, statement, confidence}`: the cell validates the
branch against the node's decision rails, writes the claim
(`…/run/<id>/claim/<node>`), performs a **merge-preserving advance** (mode,
text, failures, trace survive), and steps onward — one verb. The two classic
footguns (mode drop, hand-merge) are structurally gone, and a driven run
**closes itself** when the walk reaches a terminal (`yield: null`). The
mechanical choreography that used to pollute every driver's context is now
organ-localized — sync's own boundary lesson ("structure returns where
monotonic accumulation ends; localize it in organs").

### 3. Context binds — DyGram's context nodes, first slice

Nodes (and the machine identity, inherited by every node — DyGram's nesting
rule) declare `context`: fact keys or `{bind, as}`. At step time the shell
resolves them; `railHolds` gains `ctx.*` in the CEL scope; the resolved values
ride the step result. Consequences:

- an `auto` rail can gate on real substrate state
  (`ctx.tending_latest.observed.stale > 300`) — mechanical assessments stop
  being agent nodes;
- the yield arrives **grounded** — no follow-up reads for declared context;
- a `blocked` yield is self-diagnosing: the resolved context shows *why* the
  guard failed.

### 4. The yield carries the brief and the advance affordance

`{kind, node, choices[{to, mode, when}]}` grew `mode` (preserve me), `brief`
(`{prompt, text}` — the node's definition-carried guidance + the run's trigger
context), and `advance` (the ready-to-fire decide action, with the
driven-mode note). Node `prompt` lives in the **definition** and leads both the
reactive decide prompt and the driven brief — one authored text, two
embodiments.

### 5. `describe_machine` — the revisor round-trip

Returns the definition **as content** (the exact `define_machine` input that
reproduces the machine), validation, the vocabulary a redefine would project,
**drift** against the live `_actions`/`_subscriptions` (catching hand-patches
before they're clobbered), open runs (standing obligations), and a three-line
guide (drive / revise / create — how an agent learns machines without reading
the cell source). Live proof: its first call against `machine/tending` flagged
all five hand-patched facts and surfaced ten leaked reactive runs the tending
claims had not yet enumerated. Tending v2 then folded the hand-tuned decider
into the Assess node's `prompt` and redefined — drift now regenerates instead
of clobbering, and the regenerated subs carry the `onError` fail-fast the
hand-patched generation lacked.

### 6. The reaper — leaked runs fail honestly

The 1-minute machine tick marks any run sitting in `running`/`sectioning`/
`voting` with no revision for 12h as `status:'failed'` (`via:'tick!!stale'`,
fields preserved, `fact.written` emitted so catch rails still route). Both
production leak classes close: reactive runs parked for days by the provider
outage, and driven runs a driver forgot to close. It is a backstop, not a
license — the protocol still says close what you open.

### 7. Renders show the machine, not just its shape

The federated `machine` renderer styles rails by mode, marks briefed/bound
nodes, and lists every rail's condition/when/tools/grants/prompt; `machine-run`
shows status/mode/failures chips, the claims trail, and trigger context. The
SPA matches. (DyGram precedent: static condition pre-evaluation styling the
diagram — adopted as an open increment, §Open.)

## Embodiment (the question this ADR answers for the record)

A machine node is a **role**; whoever resolves it is an **actor** — sync's
`agency-and-identity.md` distinction ("is Hamlet the agent, or the actor
playing Hamlet?"), now recorded twice over: `run.mode` says what *kind* of
actor embodied the run (reactive = a spawned keyhole model; driven = a capable
session), and the ADR-0024 writer stamps say *which* one (a reactive decide's
claim stamps `agent:models.agent`; a driven claim through a connected client
stamps `client:claude`, acting for the owner). A driver can make the rail's
allowlist *enforced* rather than disciplinary by self-attenuating:
`auth.exchangeToken {from: own token, scope: rail grants, actor:
"agent:<machine>.<node>"}` — delegation-as-attenuation applied to machine
embodiment.

## Live validation (2026-07-14, all four surfaces)

`machine/drive-proof`, driven end-to-end in three calls: `trigger_run
{mode:"driven"}` → `step` (walked Start→Gate, evaluated `ctx.*` against the
live tending audit, yielded at Decide with brief + choices + resolved context)
→ `step {decide: Ship}` (claim written, merge-advance, walked to terminal,
`done`, `yield: null`). Two real findings en route, both fixed:

- **Authoring against real fact shapes**: the first Gate condition assumed
  `ctx.tending_latest.stale`; the audit nests counts under `observed.*`. The
  blocked yield's resolved context made the misdiagnosis impossible — exactly
  the self-diagnosing behavior intended. (Ergonomic follow-up: describe/render
  should show a context *sample* per bind — §Open.)
- **The mangled advance id**: assembled machines fell back to `name = title`
  (the identity fact never stored the slug), so the yield's `advance.invoke`
  came out `machine.Drive-surface_proof__….decide-Decide`. Fixed at both ends
  (identity carries `name`; `loadMachine` overrides with the authoritative
  slug).

## Open (the next increments, in dependency order)

1. **Context edges, not just context properties.** The full DyGram model:
   `machine-node --reads--> fact` / `--writes--> fact` as *authored substrate
   edges*, where the edge rel is simultaneously wiring, render detail, CEL
   scope, and the grant a per-run token narrows to (write-verb rels ⇒
   `scope.write`). Rails' opaque `grants`/`scope` JSON becomes graph structure,
   visible in `$graph`/canvas for free.
2. **Node-declared actions (mechanics).** Nodes declare parametric affordances
   compiled to real declared actions (`machine.<m>.<node>.<name>`), listed in
   the yield with schemas — sync's `_register_action` at graph position; the
   pruned `register_meta_tool`, grounded this time.
3. **Data-driven fan (@map/@barrier).** section/vote generalized to fan over a
   bound fact's array (`_mapItem`/`_mapIndex` overlays), per DyGram's shipped
   edge-map design.
4. **The ambient frame.** `recall`/`whoami` echo the resolved posture
   (ADR-0074's silent bias made visible) and the open driven yields —
   sync's context push, scoped to a frame header instead of a payload. Parked
   driven runs are standing wait-conditions and belong in every driver's
   perception.
5. **Context samples in describe/render**; static `railHolds` pre-evaluation
   against current binds (DyGram's active/inactive edge styling); a
   `mixed`/per-node `resolve` override (ADR-0065's deferred question).

## Costs & honesty

- Context binds add reads per step (bounded by the bind list; typically 0–2).
- The reaper's 12h threshold is a judgment call — far beyond any legitimate
  step, one observation cycle at most of miscounted backlog.
- Declared-action write templates still cannot merge (the `decide-*` action
  drops `trace`); step{decide} is the recommended path and the action carries a
  warning. A platform-level merge-write facet is noted, not built.
- The reactive path's 0% completion remains a **billing** fact, not an
  engineering one (`kb/reactive-dispatch-stuck-at-agent-nodes`): only credits
  revive it. Everything here makes the failure honest and the alternative
  ergonomic; nothing here substitutes for the top-up.
