# ADR-0093 — Declared assembly & the multi-tenant vocabulary: member facts and cell-owned types without host hardcodes

- **Status:** Accepted 2026-07-22 — Inc 1 (the `assemble` intent + home honoring
  it) and Inc 4 (the vocabulary collision rule) implemented; Inc 2–3 are
  follow-ups. Opened during the ADR-0092 multi-user sprint.
- **Depends on:** ADR-0002 (type as one object), ADR-0029 (inline affordances),
  ADR-0035/0039/0056 (ui:// renderers, federation, the renderer contract),
  ADR-0043 (cross-cell embedding governance), ADR-0005/0046/0054/0057
  (membership/collections), ADR-0091/0092 (the grant fold + public read path —
  what makes FOREIGN facts of FOREIGN types flow into every viewer's home).
- **Grounded in:** the home cell's doc-rendering work (2026-07-22). Home
  special-cases `doc`/`doc-block` (`t === 'doc' || t === 'doc-block'` →
  `DocBody`), replicates lit's membership-assembly (`edges {membership}` →
  `placement.seq` sort → concatenate `content`), and bakes in the docs-sync
  corpus-mirror convention (`doc:docs/x` ↔ `file/docs/x.md`) — because the
  type contract has NOWHERE to declare any of it. `doc`'s own declaration says
  "a document is a VIEW over facts" yet declares only `render: [{hint:
  "markdown"}]`. Hosts fill declaration gaps with hardcodes.

---

## Context

The vocabulary is already the right seam:

- **Global by construction** — each cell declares its types in `types.json`;
  `cells.describeTypes` aggregates them off ONE registry table, "canonical and
  readable by every user (and the anonymous landing)". Foreign folded facts
  resolve their types for any viewer today.
- **Declared handlers federate** — `resolve(fact, intent, decls)` (platform/ui
  vocab) is the one resolver every surface shares; `ui://` renderers already
  run sandboxed in home.
- **Plumbing is declarable** — `_types/<name> {operational:true}` marks a
  slice's own machinery (the wave-5 mechanism).

Two things are NOT declarable, and one multi-tenant rule is missing:

1. **Composite bodies.** "My body assembles from my member facts" is a general
   pattern (docs, boards, collections) with exactly one federation path today:
   a full `ui://` renderer (iframe-weight, no SSR, heavy for guests). There is
   no declarative floor, so home hardcodes lit's assembly.
2. **Audience-conditional sources.** "When membership isn't readable to this
   viewer, this type has an alternate public source" (the docs corpus mirror)
   is a property of the TYPE's data model, but lives as a home-side convention.
3. **The collision rule.** `describeTypes` does `out[type] = value` over cells
   sorted by cellId — LAST writer wins, silently. The moment a second user
   deploys a cell declaring `doc`, one declaration vanishes platform-wide.
   Deterministic but arbitrary, and an impersonation surface: a newcomer can
   hijack an established type's handlers (its `open` path, its renderer) for
   every viewer. Same threat class as reserved usernames (ADR-0091 §5).

## Decision

### 1. `assemble` — a new intent with a declarative spec (Inc 1, shipped)

`Intent` gains `'assemble'`; `TypeHandler` gains an `assemble` spec the
resolver passes through verbatim (declaration data, not a resolved address):

```json
"handlers": {
  "assemble": [{ "assemble": {
    "field": "content",              // member value field to concatenate
    "containerTagPrefix": "doc:",    // MEMBER types: find my container via tag
    "fallbackKey": "file/${match}.md" // audience fallback (see below)
  }}]
}
```

Semantics (v1, deliberately narrow — exactly the proven doc shape):

- The container's body = its membership edges' members, ordered by
  `placement.seq`, `field` concatenated. A member type with
  `containerTagPrefix` delegates to its container's assembly.
- `fallbackKey` is the audience fallback: when membership yields nothing for
  this viewer (e.g. `@guest` — members aren't public), read this key instead.
  `${match}` is the container key's suffix after its `type:` prefix, RAW (not
  URL-encoded — it is a fact key, not a URL). A grant-folded container
  (`owner/doc:docs/x`) re-applies its `owner/` prefix CONSUMER-side: the fold
  is the host's concern, never the type's.
- This is the declarative FLOOR, mirroring ADR-0041's form floor: any host
  (home, canvas, a future feed) can honor it SSR-safely with no foreign code.
  A full `ui://` renderer remains the maximal-fidelity override via `render`.

Home's `FactBody` resolves `assemble` generically; the hardcoded
`doc`/`doc-block` branch remains only as the compiled fallback floor for
undeclared vocabularies and is removable once the lit declaration is
everywhere. lit declares `assemble` on both types.

### 2. The vocabulary collision rule (Inc 4, shipped)

**First-declarer-wins, visibly.** `describeTypes` aggregates cells sorted by
registry `createdAt` (tie: cellId); the FIRST cell to declare a type name owns
its canonical declaration. A later declaration does not override — it is
recorded on the winner as `conflicts: ["@owner/name", …]` and logged, so the
collision is observable (a `$types` reader, a dashboard, an audit) instead of
silent. Per-user `_types/` overrides (the existing gateway merge) remain the
personal escape hatch: a viewer who prefers the newcomer's handling can adopt
it for their own view without contesting the global name.

Rejected alternatives: last-writer-wins (the status quo — silent hijack);
manager-namespaced type names (`@c15r/doc`) — honest but breaks the entire
existing bare-name vocabulary and the key-prefix signal (`doc:x` → `doc`).
Namespacing remains the escape hatch if genuine same-name pluralism emerges;
first-declarer + personal overrides covers the sprint reality.

## Increments

1. ✅ **The `assemble` intent** (platform/ui vocab + home honors + lit declares).
2. ⏳ **Retire home's compiled floor** once the lit declaration is verified
   live everywhere (delete the `doc`/`doc-block` special case and the
   corpus-mirror regex from `DocBody`; behavior then comes ONLY from the
   declaration).
3. ⏳ **`isPlumbing` honors declared `operational` types** — the graph's node
   band consults the vocabulary (`operational:true` / `embed:false`) instead
   of naming `canvas-placement`.
4. ✅ **The collision rule** (first-declarer-wins + `conflicts` annotation).

## Consequences

- A new user's cell with its own composite type gets home rendering (and any
  future host's) by DECLARING it — no host changes, the original ask.
- Type hijack across tenants is closed; collisions become data.
- The assemble spec is v1-narrow (seq-ordered membership concatenation). Richer
  composition (nested assembly, per-member renderers — lit's own reader does
  this) stays with `ui://` renderers until real demand shapes a v2.
- One more intent in the closed `Intent` union — additive; existing
  declarations and resolvers are untouched (`resolve` only passes `assemble`
  through when asked for it).

## Open questions

- Should the LANDING doc path also resolve its assemble declaration (today it
  reuses the same DocBody floor directly)? Harmless either way; tidy later.
- `field` is a single value path; mixed-type members (a canvas `el:` inside a
  doc) fall back to the host's heuristic text extraction — is that the right
  floor, or should members resolve their OWN type's render hint recursively
  (lit's model)? Deferred to a v2 with a real use case.
- Does `conflicts` deserve a surfaced audit (a `$types` warning band) beyond
  the log line?
