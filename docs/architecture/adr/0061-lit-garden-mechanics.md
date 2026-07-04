# ADR-0061 — lit garden mechanics: fragments, transclusion, search cells, TOC

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
- **Depends on:** ADR-0059 (grammar), ADR-0060 (outputs-as-facts), ADR-0040
  (wiki), ADR-0055 (scoped feeds). Sources: dotlit `parser/links.js`
  (verified), `renderer/transcludeCode.js` (verified), the dotlit TODOs that
  name the ceiling (`index.lit:155-165`).

## Context (grounded)

The digital-garden half of dotlit, verified at source, and what its own TODO
list wanted but files couldn't give:

- **Wiki-links** resolve `[[target#fragment|label]]`: slug ladder
  (`.lit`, `/index.lit`, `.md`), slugged section anchors, `exists` flag
  (red links). lit has `[[target|label]]` → `doc:` keys + typed edges, but
  **no `#fragment`** — and dotlit's TODO asks for exactly what fragments
  couldn't deliver in files: *"Backlinks should link to the part of the
  document of first mention"*. The substrate has fact-grain addressing —
  a fragment IS a member fact.
- **Transclusion** (`< ./file`, `< uri`): render foreign content in place,
  `originalSource` tracked; and the defining bug — *"transcluded code gets
  persisted inline on edit"*. Copies drift; the medium ran out.
- **Search cells**: the dotlit homepage's ` ```>search ` is a LIVE cell — a
  query whose results render in the document. That's a view over the store,
  in the page. lit has `view <id>` fences (registered views) but no inline
  query cells.
- **TOC**: `## Table of Contents` renders the doc's own structure — the
  document reflecting on itself.
- lit gap #10 (verified): no way to add an EXISTING fact to a doc — the
  design's headline capability ("the same fact can be both") has no UI verb.

## Decision

**Reference is the primitive; every dotlit garden mechanic lands as a
reference the substrate can hold.**

1. **Fragments address member facts.** `[[doc:slug#<cellKey>]]` links to the
   member; rendering anchors each block (`id=<factKey>` already in the DOM)
   and scrolls on navigation. `[[doc#free text]]` resolves against member
   headings at click time (soft resolution — no index to maintain). Edges
   written by syncCellLinks carry the member key in `to` — so backlinks
   land on **first mention**, closing dotlit's TODO with a link, not a
   heuristic.
1b. **Red links are entities waiting to exist** (owner's framing; dotlit's
   wiki-links.lit wished for exactly this: "add non-existing links, but
   indicate their state"). A wiki edge to a nonexistent key is a DANGLING
   edge — which `workspace.attention` already surfaces. So the mechanics
   come almost free:
   - render: a `[[target]]` whose key resolves to nothing gets `.wikilink-
     stub` styling (dotted terracotta) — checked from the doc's own member/
     neighbor data, no extra query storm;
   - tap a stub → create the doc seeded with a title + a backlink to where
     it was wanted (the mention IS the first content);
   - the doc list gains a **"waiting to exist"** section: dangling `related`
     edges grouped by target, ranked by inbound-mention count — the
     want-list emerges from the writing, and the tending loop already
     counts it as attention. Nothing is written until creation: latency is
     represented BY the dangling edge, not by stub facts.
2. **Transclusion is membership, not copy** — the `< src` half of the
   grammar (parsed since 0059) finally acts:
   - `< cell:x` / `< out:y` / any fact key → the fence renders THAT fact's
     content by reference; editing routes to the source fact (one truth —
     the drift class cannot exist). Rendered with a subtle source chip
     (`↳ cell:x · rev N`).
   - `< https://…` → fetched at render (client-side, authed readers),
     never persisted — a window, not a copy.
   - The editor verb for gap #10: **"insert existing…"** in the add-after
     menu → palette-style fact search (searchFacts is already built in
     canvas) → one `_doc/` decoration. Same fact, second surface.
3. **Search cells**: ` ```>search <query terms> [type=x] [tag=y] [limit=n] `
   renders a live result list (workspace.query/search under the palette's
   semantics), each hit linking to `/r/<key>`, with an "add to doc" verb per
   hit (search → curate is one gesture). Results are ephemeral render — the
   QUERY is the content (a query-collection, kin to ADR-0057's views).
4. **TOC is derived**: a `## Table of Contents` heading (or ` ```>toc `)
   renders the member headings as anchor links at render time. Never
   persisted — the membership already IS the structure.

## Increments

1. Fragment links + block anchors + first-mention backlinks.
2. `< factKey` transclusion + source-chip + edit-routes-to-source; the
   "insert existing…" verb.
3. `>search` and `>toc` cells; `< uri` windows.

## Costs & open questions

- Fragment edges point at member keys; if a member is later split
  (splitCells keeps the FIRST part's key), first-mention anchors survive by
  construction — the split rule was chosen for exactly this.
- `< uri` in an authored doc is an outbound fetch on render — readers'
  browsers call third parties. Gate: render a click-to-load placeholder
  unless the doc owner authored the fence (same provenance rule as
  execution, 0056/0060).
- Open: should a `>search` cell be able to PIN its results (materialize to
  decorations, becoming a living-doc section per narrative-surface.md's
  "view-backed membership")? Leaning: yes later, as an explicit "pin
  results" verb — query-membership is ADR-0057 ground and should compose,
  not fork.
