# ADR-0052 — Capabilities are facts: recall can surface what you can DO

- **Status:** Inc 1 shipped 2026-07-02 — the workspace's cell-lifecycle handler
  projects each deployed cell's advertised tools into `_caps/<address>.<tool>`
  capability facts (type `capability`, writer `platform/cells`; reconciled on
  redeploy, superseded on delete); `embeddableText` carves `_caps/` out of the
  `_`-namespace skip so the live indexer embeds them. Open: seed the workspace
  core verbs the same way; derive `$catalog` from the facts; type-decl for
  `capability` with a declared prior (today it rides `_config/salience`).
- **Depends on:** ADR-0013 (fact floor), ADR-0049 (contextual capabilities),
  ADR-0050 (type priors), ADR-0051 (the intent lens), ADR-0044 L1 (declare once,
  project everywhere).

## Context (the floor has a hole)

ADR-0013 says everything is a Fact on one floor. Cells honor it (`cells/*` facts +
`source-manifest` facts, written by `platform/cells` on deploy). Types half-honor
it (personal `_types/*` overrides are facts; canonical declarations live
cell-side). But **capabilities exist only on the wire**: `$catalog` is assembled
live by the gateway from code-declared descriptors. A tool's target, description,
and schema are never facts — so `recall` cannot surface a capability *even in
principle*: it is not in the pool salience ranks. That is why the `$` surfaces
feel like escape hatches — for a whole category of things the floor claims to
contain, they are the only path.

ADR-0049 built the structural half of the fix: `$catalog {for: <key>}` shapes the
menu by the fact you are holding (type signals → manager cells → their tools).
What is missing is the semantic half: the menu shaped by *stated goal*.

## Decision

1. **On deploy, `platform/cells` writes one `capability` fact per declared
   target** — key `_caps/<target>` (e.g. `_caps/@c15r/machine.step`), value
   `{target, kind, summary, cell, schemaRef}`, type `capability`, writer
   `platform/cells` — superseded on undeploy, regenerated on redeploy: the same
   regenerable-projection lifecycle as the `source-manifest` facts the deployer
   already writes, and the same "machine-written, distinguishable, regenerable"
   stance as `similarTo` edges (ADR-0031). Workspace core verbs are seeded the
   same way by the platform.
2. **Capability facts are embeddable** (`embeddableText` = target + summary), so
   the live indexer and `reindex` cover them, and ADR-0051's relevance signal can
   match a goal to a tool.
3. **The `capability` type declares a low salience prior** (ADR-0050), so
   goal-less reads keep them near-invisible — they are plumbing when you have no
   intent. A matching goal lifts them into focus: the same blend that demotes
   irrelevant churn surfaces relevant capability. `recall({text: "summarize my
   reading backlog"})` returns the reading facts *and* `@c15r/models.agent` —
   knowledge and capability, one ranked answer to "what do I have and what can I
   do about it."
4. **What stays deterministic, and why.** The `$` surfaces divide on "discovery
   vs truth": `$grants` is authority — always exhaustive, never salience-shaped;
   `$graph` is *inspection* of the projection salience itself consumes (edges are
   not facts and do not become facts); `$catalog` remains the exhaustive
   enumeration (bootstrap with no goal, UI builders, schema resolution) — and
   becomes *derivable from* the capability facts rather than assembled beside
   them, so there is one source. Escape hatches are a smell only when they are
   the sole path; after this they are the exhaustive backstops behind a ranked
   default — exactly what `recall({view:"full"})` already is to the overview.

## Consequences

- The fact floor closes: facts, types, cells, *and capabilities* are all
  recallable, linkable, salience-ranked substrate citizens. An agent's first and
  often only call is `recall({text})`.
- MCP-native dynamic tool discovery falls out: goal-conditioned recall is a
  semantic `tools/list`, with `$catalog` as the deterministic one.
- Drift is bounded by lifecycle, not tending: deploy supersedes/rewrites the
  cell's capability facts atomically with the `cell` fact; the nightly repair
  (ADR-0050) reconciles stragglers.
- `$catalog {for}` (ADR-0049) and `recall({text})` compose: held-object context
  and stated intent are independent signals a caller may use together.
- Open: whether personal *overrides* of capability facts (renames, pins,
  hide-this-tool) follow the `_types/*` override pattern; whether schemas embed
  whole or stay behind `schemaRef` (weight says ref).
