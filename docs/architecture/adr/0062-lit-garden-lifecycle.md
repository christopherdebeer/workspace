# ADR-0062 — The garden lifecycle: maturity, tending, and the doc that knows itself

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
- **Depends on:** ADR-0061 (garden mechanics), ADR-0050 (standing/velocity),
  ADR-0055 (scoped feeds), ADR-0057 (query-collections). Sources: the dotlit
  knowledge base read whole this session — `seedling.lit`, `taking_notes.lit`,
  `digital_gardens.lit`, `todo.lit` (the tag page), `meta.lit` +
  `meta/files_and_links.lit` (live introspection), 104 daily logs.

## Context (grounded — how the garden was actually lived)

The dotlit corpus is not just features; it encodes a *practice*:

- **Maturity is explicit.** Notes carry `[[🌱 Seedling]]` — Maggie Appleton's
  seedling → budding → evergreen taxonomy, applied as a wiki-link so the
  Seedling page's backlinks ARE the list of immature notes. Maturity is a
  claim the author makes, navigable from both ends.
- **Tag pages**: `todo.lit` exists solely "to capture backlinks to mentions
  of [[☑️ TODO]]" — a page whose content is its inbound edges. The garden
  grows hub pages out of pure reference.
- **The garden introspects itself**: `meta.lit` runs a live cell fetching
  `meta.json` (build stats, per-doc failures); `files_and_links.lit`
  generates its "unlinked files" list from the manifest at render time.
  Orphans, breakage, and coverage are CONTENT, rendered where you read.
- **Daily logs** (104 of `testing/log/YYYY-MM-DD.lit`) are the heartbeat —
  already reborn as `@c15r/input` captures + lit's log views.
- And the substrate half already exists: `standing` (earned durable
  attention, ADR-0050), `attention` (stale/unlinked/dangling), the tending
  machine. dotlit declared maturity by hand; the substrate MEASURES the
  signals underneath it.

## Decision

**The lifecycle is a conversation between declared maturity and measured
attention — lit renders both, and the tending loop closes the gap.**

1. **Maturity is a declared facet on the doc fact** — `doc:<id>.value.stage:
   'seedling' | 'budding' | 'evergreen'` (absent = unstated). Rendered as a
   small glyph chip (🌱/🌿/🌲) on doc rows and headers; set from the doc
   header (one tap cycle). Declared, not inferred: maturity is the author's
   claim about *completeness of thought*, which no counter measures.
2. **…but the measurement sits beside it.** The chip's tooltip/detail shows
   the doc's substrate signals (standing, updatedAt, backlink count). A
   MISMATCH is the tending signal: an evergreen that's stale-and-unlinked,
   or a seedling with high standing and many backlinks ("this seedling is
   load-bearing — grow it"), surfaces in the attention feed. Neither signal
   overrides the other; the gap is the information.
3. **Tag pages are query-collections** (ADR-0057 vocabulary): a doc whose
   value carries `query: {tag: 'todo'}` (or whose body is one `>search`
   cell, ADR-0061) renders its members live — dotlit's backlink hub without
   hand-tending. "Create tag page" is offered from any tag chip.
4. **The garden's meta pages are live cells**, not builds:
   - `>attention` — the workspace attention read scoped to `doc:`/`cell:`
     prefixes: stale docs, unlinked blocks, dangling refs (which are the
     "waiting to exist" list, ADR-0061 §1b) — dotlit's meta.json/unlinked-
     files pages, but current on every read;
   - a seeded `doc:garden` using them — the self-describing garden page.
5. **Logs stay derived** (already true) and join the lifecycle: a log day
   that mentions `[[doc]]` counts as attention on it (the edge already
   does this via centrality — no new mechanism, just verified rendering).

## Increments

1. `stage` facet: chip on rows/headers, tap-to-cycle, glyph rendering.
2. `>attention` cell + the seeded `doc:garden`; mismatch surfacing (an
   `attention` hint line when declared stage and measured signals disagree).
3. Tag pages as query-collections ("create tag page" from tag chips) —
   sequenced AFTER ADR-0057 lands its collection facet, which it composes
   with (a tag page is a query-collection rendered as a doc).

## Costs & open questions

- Two truths (declared stage vs measured standing) risk confusion if
  rendered as one badge — they are deliberately two adjacent signals, never
  merged into a computed "real maturity" (that would make the author's
  claim decorative).
- Tag pages before ADR-0057 would fork query-membership semantics; the
  dependency is real and the ordering deliberate.
- Open: should stage transitions be trajectory-visible (a `stage` write is
  just a fact revision — already in the feed) with a "grew 🌱→🌿" line in
  the doc's history panel? Cheap and delightful; leaning yes in Inc 1.
- Open (buffer question): does `stage` belong on ANY fact (claims, canvas
  boards) rather than just docs? The facet is generic; proposing docs-first
  to learn the practice before generalizing.
