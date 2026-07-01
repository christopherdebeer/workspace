# ADR-0046 — Board membership is a projected edge; the placement fact is its property-carrier

- **Status:** Decided + Inc 1 shipped and live-verified 2026-07-01 (vocabulary declared, 157 placements
  backfilled, 5 board identity facts minted, `onBoard` edges projecting — verified via `neighbors`).
  Inc 2 (client dedup ergonomics) and Inc 3 (tag retirement) open.
- **Date:** 2026-07-01
- **Depends on:** ADR-0016 (edges with attributes = a fact whose key encodes its endpoints), ADR-0003
  (key-encoded Reference rules), ADR-0005 (collections; doc-order is the working template), ADR-0013
  (no-graduation), ADR-0044 (L4 structure-over-knobs; L6 survey-before-design).

---

## The hypothesis (user, verbatim in spirit)

> Membership in a board is a link/edge — and position, size, rotation etc. are properties of that
> edge, not of the fact.

**Verdict: correct — and it is the substrate's own established answer (ADR-0016), which canvas already
implements for its EDGES but never declared for its PLACEMENTS.** A first-class edge carries only
`rel + strength`; an edge that needs attributes is reified as a *fact whose key encodes its endpoints*,
with a key-encoded rule projecting the pure edge into the graph. Lit's `doc-order` is the working
template (`_doc/{doc}/{block}` + `{block} inDoc doc:{doc}`, `seq`/`fold` as the properties). The canvas
placement fact `_canvas/<board>/<factKey>` **is exactly this shape** — it just was never *declared*, so
the projection never fired.

## What the forensics found (live data + code, 2026-07-01)

- **Membership was triple-encoded, none of it graph-visible:** the placement key prefix, a
  `canvas:<board>` tag on the element fact (155 els), and `_views` board queries. Placements were
  `type:null` → the key-encoded rule (which is type-gated, `state.ts` `deriveBackboneEdges`) projected
  nothing; `$graph`/`neighbors`/`members` were blind to boards.
- **Boards had no identity facts** — `canvas:` was empty. The membership edge had no node to point at.
- **The duplication is real but lives in the client's creation paths, not the storage model:**
  0 of 157 placed elements sit on 2+ boards; exactly ONE code path places an existing fact by reference
  (`addFactToCanvas`, command-palette only), while create/duplicate/paste all mint fresh `el-<ts>` facts
  and copy content by value. Plus 57 orphan `el:` facts (placement deleted, content left) and 3
  identical-content groups (14 facts). The `el:blk:holistic-*` facts show doc blocks *copied into* el
  wrappers where a placement-by-reference was the design intent.
- **Canvas's edge decorations already follow the target model** (`workspace.link` is the truth;
  `_canvas/<board>/edge:<id>` carries style only; delete = unlink + supersede) — the placement side
  simply never got the same treatment.
- **The el fact itself is honest** (no-graduation holds where the reference path is used: value/type
  survive board edits; `addFactToCanvas` adds only tag + placement). The *tag* mutation is the one
  no-graduation smell: putting a fact on N boards rewrites its tags N times — membership glued onto the
  member instead of living beside it.

## Decision

1. **Declare the shape that already exists** (shipped): a `canvas-placement` type — keyPattern
   `_canvas/{board}/{el}`, keyEdges `{el} —onBoard→ canvas:{board}`, geometry schema — and a board
   identity fact `canvas:<board>` (type `canvas`, the node edges point at). `onBoard` joins
   `MEMBERSHIP_RELS`, so `workspace.members("canvas:<board>")` resolves board membership with the
   placement's geometry recoverable from each edge's `source` (exactly how doc members carry `seq`).
   Canvas stamps the type on every placement write and ensures the board fact once per session; the
   157 existing placements + 5 boards were backfilled. **Live proof:** `neighbors("canvas:knowledge")`
   returns 11 inbound derived `onBoard` edges, each with `source: _canvas/knowledge/<el>`.
2. **Placement stays a fact** — per ADR-0016, x/y/width/height/scale/rotation/zIndex are the membership
   edge's properties and live in its reified fact, never on the placed fact and never on a bare edge.
   The hypothesis's "properties of the edge" is satisfied by projection, not by widening the edge model.
3. **Cross-board reuse is a placement, not a clone.** `addFactToCanvas` is the canonical shape; the
   duplication comes from it being reachable only via the command palette while every creation-adjacent
   path clones.

## Increments

- **Inc 1 (shipped, above).** Vocabulary + backfill + projection, zero client behavior change.
- **Inc 2 — reuse ergonomics (open):** a "place on board…" affordance beside duplicate/paste (a second
  placement for the same `el:`), and paste-across-boards offering reference-vs-copy. Orphan cleanup: the
  57 placement-less `el:` facts are a tending-run candidate (supersede after review); the 3
  identical-content groups likewise.
- **Inc 3 — retire the tag as membership truth (open):** with `onBoard` projected, the `canvas:<board>`
  tag's only load-bearing role is the *unplaced-member* query (the fluid field). Fold that onto
  `members` + placements (or an explicit fluid-membership decoration), then stop writing tags — ending
  the triple encoding. Needs the canvas client's load path to consume `members` — sequence after Inc 2.

## Consequences

- Boards join the graph: salience centrality now sees board membership; the weave/tending machines can
  reason about boards; `$graph` draws them; a board's members are one `workspace.members` call for any
  consumer (the scene read, lit's board fence, the card).
- One more decoration family behaves identically to doc-order — the collections story (ADR-0005) now has
  two conforming implementations, which is what makes it a pattern rather than an incident.
