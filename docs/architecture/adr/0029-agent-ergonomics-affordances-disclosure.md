# ADR-0029 — Agent ergonomics: inline affordances on reads + progressive-disclosure tiers

- **Status:** Accepted — **R1 shipped** (inline `types` affordance map on `query`/`recall`/`peek`/
  `neighbors`/`members`); **R2 found already-implemented** (elided entries already collapse to
  `{key,type,score}` stubs — see the F3 correction below); **R3/R4 remain open follow-ups**. A critical
  review of the `read`/`act` MCP surface for *agent* ergonomics — progressive disclosure, salience, and
  the central question: when a read returns facts, does it surface what the agent can DO with them (the
  type's tool hints / managing cell), or must it round-trip? Grounded in two code investigations **and a
  self-audit of a live agent session** (this one).
- **Date:** 2026-06-26
- **Depends on:** ADR-0012 (present stage / `resolvePresent`), ADR-0002 (type-as-one-object), ADR-0006
  (salience stage), ADR-0008 (Cell axis / `$cells`), `docs/type-vocabulary.md`,
  `docs/trajectory/2026-06-12-mcp-agent-ergonomics-review.md`.

---

## Findings

### F1 — Read results don't carry affordances; acting on a fact is a round-trip (the core gap)
A read entry is `{ value, _meta }` (`platform/runtime/state.ts`); `_meta` carries `type` + 15 salience/
provenance fields but **no affordance** — no `icon`/`label`/`handlers`/`manager`. `resolvePresent`
(`platform/runtime/present.ts`) turns a fact + its type decl into an `Affordance`
(`{icon,label,render,handlers}`), but it is **never invoked in the read path** — only client-side (lit/
canvas). So to act on a fact it just queried, an agent must: `workspace.query` → `read("$types")` (which
*does* expose `handlers` + `manager` per type — gateway `buildTypes`) → correlate `types[T].handlers[intent]`
to an act target/surface and `types[T].manager` to the cell → `act`. **One extra read + manual
correlation, every time.** The data to collapse it is already loaded server-side (`typeDeclsFor` caches
decls; `resolvePresent` is pure).

### F2 — Progressive disclosure is real but coarse in spots
`$catalog` has a clean **binary** split — full (schemas) vs `{detail:"summary"}` (grouped one-liners,
~80% smaller, `gateway summarizeCatalog`). But: no middle tier (e.g. input-schema-only), **no per-cell or
per-target filter** (discovering one cell's tools pulls the whole catalog), `$graph` is unbounded (no
pagination/prefix), and `$types`↔`$catalog` are not cross-linked (handlers vs the tools that invoke them).

### F3 — Salience tiers work; elision is already compact *(corrected on implementation)*
`shape()` tiers entries focus/peripheral/elided by score (`tierFor`); lenses
(`salience|recent|connected|durable|active`) recompute scores and re-tier. The prior ergonomics review
(2026-06-12) measured ~95% of an elided payload as metadata and concluded elision shipped a full `_meta`
envelope per hidden fact. **That has since been fixed and the finding is stale:** `shapeEntries`
(`platform/runtime/state.ts`) now *withholds the entry entirely* below the elide threshold and emits a
compact `ElidedStub` — `{ key, type, score }` — under a separate `elided` array (`expand:[key]`/`peek`
pulls the full entry back). So R2 ("trim elided `_meta`") was **already implemented**; verifying that was
the substance of the R2 work, and the recommendation is closed as a no-op rather than a code change.

---

## Self-audit — this session as live evidence

I (the agent) drove this exact surface for a long multi-task session. Where I was inefficient maps 1:1 to
F1–F3 — which is the strongest argument for fixing them:

- **F1, lived:** Across the session I **never once used `read("$types")`**. Every time I needed to know a
  fact type's handler/managing cell (e.g. the machine `start` action, the `file` type, run-job), I read
  **raw source** (`grep`/`Read`) instead. The affordance round-trip was so unergonomic that I routed
  *around* the substrate's own self-model into the codebase — exactly the gap F1 describes.
- **Result-size, lived (F2 sibling):** `read("$catalog")`, `actions_list`, and `platform.logs` repeatedly
  **blew the tool-output token cap** (100–400 KB), spilling to files I then had to `jq`. A self-model read
  that can't be field-projected or paginated forces the agent out of the MCP idiom into shell parsing.
- **F3 + observability, lived:** Debugging the machine-trigger failure, `platform.logs` returned the
  **oldest** window events (pre-fix) and lagged ~3 min, costing ~5 redundant log pulls before I bypassed it
  with the strongly-consistent `workspace.changes` feed. (That bug is now fixed — fix #4 — but the episode
  shows how much a non-tailing, un-filterable log read costs an agent mid-incident.)
- **Salience, lived:** I almost always queried by raw `prefix`/`type` with a `limit` and never used a
  salience **lens** — because nothing in a result nudged me toward one. The shaping is invisible unless you
  already know to ask.

## Recommendations (ranked; answers "surface tool hints on returned facts?" → **yes**)

- **R1 — Inline affordances on reads (highest leverage, on-question). ✅ SHIPPED.** A **shared** per-response
  `types: { [T]: { icon?, label?, render?, handlers?, manager? } }` map on `query`/`recall`/`peek`/
  `neighbors`/`members` (one `resolveType` per *type* present, not per entry — no per-fact bloat; built
  from the already-cached canonical vocabulary). Collapses `query → $types → correlate → act` into
  `query → act`. The direct fix to F1 and the thing my own session most needed.
- **R2 — Trim elided `_meta`. ✅ ALREADY DONE.** Verified `shapeEntries` already withholds the whole entry
  below the elide threshold and emits a compact `{ key, type, score }` stub (see corrected F3). No code
  change — closed as a no-op.
- **R3 — Disclosure tiers/filters.** `$catalog {detail:"basic"}` (names + input schema, no result) and a
  `{cell}`/`{target}` filter; consider `$graph` pagination (F2). *(Open follow-up.)*
- **R4 — Result-size ergonomics.** Field-projection/pagination on heavy self-model reads so an agent isn't
  forced to spill 100–400 KB and `jq` it. (Applies to the gateway reads and is a general MCP-result hygiene
  point.) *(Open follow-up.)*

**Net:** R1 shipped and R2 was already in place — the two highest-value agent-ergonomics wins, corroborated
by concrete friction in a real session, are done. R3/R4 remain follow-ons.

## Implementation (R1)

- `services/workspace/handlers.ts`: `affordancesForTypes(typeNames, decls)` resolves one `TypeAffordance`
  (`{ icon?, label?, render?, handlers?, manager? }`) per *distinct declared type present*, skipping
  `_`-prefixed plumbing types and omitting undeclared types (empty affordance). `typesOf(container, …extra)`
  collects `_meta.type` across an entry array or key→Entry map plus standalone strings (elided stubs).
  `withAffordance(entry, decls)` attaches the map to a single `peek` fact. Each read handler appends the map
  only when non-empty (no field on a typeless result), reusing the already-cached `typeDeclsFor(ctx)`.
- **Why `resolveType`, not `resolvePresent`:** the map is **type-level**, so per-fact label resolution is
  the wrong shape. `label` is exposed as the type's label *path* (e.g. `value.title`), matching `$types`'
  `present.label`. An agent reads `types[fact._meta.type].handlers[intent]` + `.manager` directly.
- **Scope/disclosure:** the map is built from the *canonical* (cell-declared) vocabulary — identical to
  `$types`' global half — and adds nothing the caller couldn't already read via `$types`; slice-local
  `_types/<T>` overrides are NOT folded in (rare; `$types` still gives the fully-merged view). It carries no
  per-fact data, so it leaks nothing across slices.
- Descriptors document `types` via a shared `TYPES_AFFORDANCE_SCHEMA` on all five read `resultSchema`s.
  Tests: `tests/workspace.test.ts` — "inline affordances on reads (ADR-0029 R1)" (handlers+manager present;
  undeclared omitted; peek sibling; recall map; omitted when no declared type). `__resetTypeDeclsCache()`
  is a test seam mirroring the runtime's `__setLambda`/`__setEventBridge`.

## Open questions
- ~~R1 shape: a shared `types` map (lean) vs a per-entry `_present`~~ — **decided: the shared map** (wins on
  token cost; the indirection is one lookup by `_meta.type`).
- Should `act` errors (`scope_denied`/unknown target) also carry an affordance hint (e.g. the elevation URL
  already does — extend the pattern)?
- Does inlining affordances tempt cells to over-declare handlers? Keep the Affordance lean (icon/label/
  render/handlers/manager), not arbitrary metadata.
