# ADR-0029 — Agent ergonomics: inline affordances on reads + progressive-disclosure tiers

- **Status:** Proposed (audit + recommendations; not built). A critical review of the `read`/`act` MCP
  surface for *agent* ergonomics — progressive disclosure, salience, and the central question: when a
  read returns facts, does it surface what the agent can DO with them (the type's tool hints / managing
  cell), or must it round-trip? Grounded in two code investigations **and a self-audit of a live agent
  session** (this one).
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

### F3 — Salience tiers work, but elided facts still cost tokens
`shape()` tiers entries focus/peripheral/elided by score (`tierFor`); lenses
(`salience|recent|connected|durable|active`) recompute scores and re-tier. **But** an elided entry sets
`value:null` while still shipping the full `_meta` envelope — the prior ergonomics review measured ~95% of
an elided payload as metadata for facts the system itself chose to hide. Elision saves less than it should.

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

- **R1 — Inline affordances on reads (highest leverage, on-question).** Add a **shared** per-response
  `types: { [T]: Affordance & { manager } }` map to `query`/`recall`/`peek`/`members`/`neighbors` (one
  `resolvePresent` per *type* present in the result, not per entry — no per-fact bloat; skip for elided
  stubs). Collapses `query → $types → correlate → act` into `query → act`. Cheap: decls are already cached,
  `resolvePresent` is pure. This is the direct fix to F1 and the thing my own session most needed.
- **R2 — Trim elided `_meta`.** An elided entry should ship `{ key, type, score }`, not the full envelope —
  reclaim the ~95% measured waste (F3).
- **R3 — Disclosure tiers/filters.** `$catalog {detail:"basic"}` (names + input schema, no result) and a
  `{cell}`/`{target}` filter; consider `$graph` pagination (F2).
- **R4 — Result-size ergonomics.** Field-projection/pagination on heavy self-model reads so an agent isn't
  forced to spill 100–400 KB and `jq` it. (Applies to the gateway reads and is a general MCP-result hygiene
  point.)

**Net:** R1 + R2 are small, substrate-side, and independently shippable; they're the highest-value agent-
ergonomics wins and are corroborated by concrete friction in a real session. R3/R4 are follow-ons.

## Open questions
- R1 shape: a shared `types` map (lean) vs a per-entry `_present` (convenient but heavier) — the map wins on
  token cost; confirm agents find the indirection acceptable.
- Should `act` errors (`scope_denied`/unknown target) also carry an affordance hint (e.g. the elevation URL
  already does — extend the pattern)?
- Does inlining affordances tempt cells to over-declare handlers? Keep the Affordance lean (icon/label/
  render/handlers/manager), not arbitrary metadata.
