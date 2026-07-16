# ADR-0085 — Capabilities are facts: the self-model dissolves into the model

- **Status:** Accepted 2026-07-16 — **Inc 0 + Inc 1 built** (same day). Inc 0:
  the gateway announces every successful read/act dispatch as
  `capability.invoked` (source-pinned); the workspace applies it as one
  actor-classed touch on `_caps/<target>` via the new `ObservedState.touch`
  primitive (absent-key-safe), so used verbs accrue attention/velocity/standing.
  Inc 1: the tend-pass reconciler now covers ALL THREE tier-1 providers
  (workspace from its descriptors; auth/cells over the same `describeTools`
  seam the gateway aggregates), diff-only, retiring DEPRECATED aliases and
  verbs a provider stops advertising — closing the 80-vs-121 coverage drift.
  Later increments (capability lens, `$catalog` demotion, `$types`/`$grants`
  generalization) remain open, §Open.
- **Depends on:** ADR-0033 (progressive-disclosure recall — the overview/focus
  shape this reuses), ADR-0048 (read shaping — `card`/`refs` tiers, already the
  presentation for any fact), ADR-0049 (contextual `$catalog {for}` — capability
  discovery already conditioned on a fact), ADR-0030 (semantic search — the
  vector index a capability fact would ride), ADR-0074 (adopted posture — the
  standing relevance bias), ADR-0050 (attention counters — the usage signal this
  wires). **Reframes:** the self-model surfaces (`$catalog`/`$types`/`$grants`/
  `$cells`) introduced piecemeal as computed, out-of-band reads.
- **Grounded in:** a live read of the running substrate (2026-07-15):
  `query({type:"capability"})` returns **80 `_caps/*` facts**, written by
  `platform/cells` via `cells:capability`, each `{name, summary, schemaRef,
  cell, kind, target}` — and every one sits at **`standing:0, velocity:0,
  score:~0.15`**. The live `$catalog` lists **121** capabilities. Both numbers
  are load-bearing below.

---

## Context

The substrate's thesis is one machine: everything is a fact `{value, _meta}`
with provenance, salience, links, and reads that **raise what's relevant into
focus** — by salience (recall), by filter (query), by meaning (search), by
standing goal (posture). Every domain obeys it. Except the substrate's model
*of itself*.

`read("$catalog")` — and its siblings `$types`, `$grants`, `$cells` — are
computed, out-of-band surfaces that bypass that machine entirely. `$catalog`
enumerates all 121 capabilities on every call (a ~16–22KB flat dump even after
this session's summary-capping), ranked by nothing, conditioned on nothing but
scope. It is the one place an agent must ask "what is possible?" with a bespoke
verb instead of the reads it already uses for everything else.

This is not merely inelegant; it is **half-built the other way already**, and
the seam is visible:

1. **Coverage is split-brain.** Dynamic-cell tools *are* facts — the 80
   `_caps/*` above, materialized by the cells service so a granted cell's verbs
   rise into your slice. But the ~41 tier-1 core verbs (workspace/auth/cells)
   are **not** materialized; the gateway computes them live. `$catalog` exists
   partly to paper over a fact-model that covers only two-thirds of its own
   surface — and **80-vs-121 is that gap, drifting in production right now**.

2. **Usage does not feed salience.** Every `_caps/*` fact reads `standing:0,
   velocity:0`. They are inert because **invoking a verb never touches its
   fact** — you call `workspace.remember`, nothing bumps `_caps/workspace.
   remember`'s attention. So the one mechanism the whole design leans on to
   "raise the relevant into focus" is un-wired for exactly these facts. They
   cannot rise, because nothing tells the substrate they were used.

3. **They live in the excluded namespace.** `_caps/*` is `_`-prefixed — the
   system namespace `attention`/tending deliberately excludes (`isSystem =
   key.startsWith("_")`), and that recall elides from the knowledge overview.
   The very convention that keeps plumbing out of the map keeps capabilities
   out of it too. A capability is not plumbing; it is an affordance the agent
   should be *offered*.

The six token-efficiency iterations shipped earlier today (yield digests,
neighbour/recall/attention shaping, `$catalog` summary caps) all treated the
**symptom** — trimming bespoke self-model surfaces one at a time, each with
hand-written code. The **disease** is that capabilities bypass the salience
model, so each surface needs its own trimming. Fold them *into* the model and
recall's existing focus-band + elision + card-shaping present them for free.

## Decision

**A capability is a fact like any other. The self-model dissolves into the
model.** Discovery of "what can I do?" travels the same four paths as
everything else — salience, filter, meaning, posture — and `$catalog` degrades
to the query it structurally already is. Five wires:

### 1. Complete the projection (one writer, seq-validated)

Tier-1 services project their command surface into `_caps/*` at deploy/bootstrap
exactly as the cells service already does for dynamic cells (`via:"cells:
capability"`). One writer per surface, idempotent, keyed by `target`. `$catalog`
stops being the source of truth and becomes a *reader* of the same facts. The
freshness the live computation gave for free becomes a **projection discipline**
(see Costs) — the price of unification, paid once at the deploy seam.

### 2. Invocation feeds salience

The gateway's `read`/`act` dispatch, on every successful invocation, bumps
`_caps/<target>` attention (the ADR-0050 counter path — touch-free of the
*result*, a write to the *capability*). A verb you call ten times a day accrues
`velocity` and `standing`; the 17 `@c15r/regwatch` verbs you never touch stay at
zero. **Salience becomes a usage-frequency prior over your own toolset** — the
recall focus band floats `workspace.remember`, `@c15r/machine.step`, the handful
you actually drive; the long tail elides. This is the load-bearing increment:
without it, capabilities are facts that cannot rise, and everything else is
cosmetic.

### 3. Capabilities are embedded and posture-biased

`_caps/*` are text-bearing (`summary`) — reindex them into the vector seam
(ADR-0030) so `read({text:"drive a machine"})` surfaces `@c15r/machine.*` by
**meaning**, and an adopted posture (ADR-0074) makes the session's standing
intent bias which tools are salient without a per-call argument. "Raise into
focus through query/posture similarity" is then literally the same code path a
knowledge read uses.

### 4. `$catalog` degrades to a query + two conveniences

`read("$catalog")` becomes sugar for `query({type:"capability"})` with the two
things it uniquely adds folded back as fact-native concerns: **scope-filtering**
(grants already partition a slice — a denied capability is a fact you can't
read), and **schema-resolve** (`schemaRef` already points at the full contract;
`detail:"full"` hydrates it). The default answer stops being 121 flat lines and
becomes the recall-overview shape: the dozen your context makes salient, a
count, and a drill. Cold-start coverage — "show me *everything* possible" — is
`query({type:"capability", shape:"refs"})`: complete, salience-agnostic, and it
rides the shaping already built. A gesture, not an endpoint.

### 5. The pattern generalizes (capabilities first, the rest follow)

`$types` is already nearly there (`_types/*` decls are facts); `$grants` and
`$cells` are the same shape — a self-model computed out-of-band that could be
read through the model. This ADR proves the pattern on capabilities (the
heaviest, most-used surface) and leaves the others as follow-ons, not a
big-bang rewrite.

## Costs & honesty

- **Freshness is now a discipline, not a guarantee.** Live computation is
  always current; a materialized projection drifts if the deploy seam doesn't
  rewrite it — and the substrate is *already* lying by 41 capabilities (80 vs
  121). Unification only helps if the projection writer is wired into every
  deploy and seq-validated like the recall digest (ADR-0050). This is the real
  tax and the reason to keep `$catalog`'s reader able to fall back to live
  computation until the projection is trusted.
- **Salience pollution.** Capability facts entering recall's focus band could
  crowd out knowledge facts — the knowledge overview is already dense. This
  needs a capability-shaped read (a lens, or a type-weight) so tools surface
  when you're asking "what can I do?" and stay out of "what do I know?". Getting
  this wrong makes recall *worse*, not better.
- **The `_`-namespace decision.** Capabilities are system facts that *should*
  surface — the opposite of the `isSystem` exclusion's intent. Either they leave
  the `_` namespace (and the system-fact convention absorbs an exception) or the
  exclusion learns that `capability` is a surfacing system type. Not free either
  way.
- **Embedding churn.** 121 capability embeddings is trivial to compute but must
  re-embed on redeploy when a summary changes — another line item for the
  projection writer.
- **Round-trips vs. payload.** Salience-ranked discovery can cost an extra read
  when the focus band misses a verb you need (you fall through to a filtered
  query). The flat dump never misses but always overpays. This trades a
  worst-case round-trip for an average-case payload win — the same trade recall
  already makes against `view:"full"`, and defensible for the same reason.

## Open (increments, in dependency order)

0. **Wire invocation → attention on `_caps/<target>`** (Decision §2). Highest
   leverage, no schema change, the facts already exist — it is the increment
   that makes "rise through salience" true. Everything else is inert without it.
   Ship it alone and observe whether a week of real use sorts the toolset.
1. **Complete the tier-1 projection** (§1) so coverage stops lying, with the
   deploy-seam writer + seq validation.
2. **Reindex `_caps/*`** into the vector seam and confirm `search`/`recall
   ({text})` surface them by intent (§3).
3. **A capability lens / type-weight** so they surface in a tool-shaped read
   without polluting the knowledge overview (the pollution cost above).
4. **Demote `$catalog`** to `query({type:"capability"})` + scope/schema
   conveniences + the `refs` coverage fallback (§4).
5. **Generalize** to `$types`/`$grants`/`$cells` (§5).

The through-line: this session made the self-model surfaces *leaner*; this ADR
makes them *unnecessary*, by giving the substrate's model of itself the same
salience the rest of the substrate already has.
