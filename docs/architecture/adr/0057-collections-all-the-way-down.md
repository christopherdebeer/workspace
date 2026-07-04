# ADR-0057 — Collections all the way down: groups, frames, boards, views

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
  Incorporates owner direction (2026-07-04): blend modes, rotation, and
  grouping are KEPT — grouping becomes first-class.
- **Depends on:** ADR-0015 (frames), ADR-0046/0054 (membership by placement),
  ADR-0053 (sync seam). Consolidates `_views/`, `frame:*`, `canvas:*`, and
  the ad-hoc `group` attribute into one family.

## Context (grounded — four ways of saying "these belong together")

- **Groups** today are a string attribute smeared across members
  (`el.group = 'grp-…'` in each element's placement) — invisible to the
  graph, unnamed, unshareable; ungroup is an N-element rewrite. The group
  resize/rotate handle states have been dead code for months (removed in
  G5) because the model gave them nothing to hold onto.
- **Frames** (`frame:<id>`) are already collection facts:
  `{ board, label, region: { kind: 'members', members: [...] } }` — named,
  tourable, camera-fitting. The healthy pattern.
- **Boards** were tag-sets; ADR-0054 just made them placement-sets.
- **Views** (`_views/<id>`) are query-defined collections with render hints;
  `?view=` boards already render a view spatially.

Four mechanisms, one idea. The user asked the right question: *"is there a
way we can make groups first class, i.e. frame-like?"* — yes, and the frame
already shows how.

## Decision

**One family: a collection is a fact that names members (or a query).**
Presentation facets say how it shows up.

```
collection value = {
  label?,
  members?: ['el:a', 'machine/tending', …]   // OR
  query?:   { tag|type|prefix|text … }        // (views today)
  facets?: {
    group?:  { transform: true },   // moves/scales/rotates as one; on-canvas
    frame?:  { camera: true, default?, tourNext? },  // fitted viewpoint
    board?:  { spatial: true },     // renders as a canvas (ADR-0054 world)
  }
}
```

- **A group is a collection with the `group` facet** — a fact
  (`group:<board>/<id>`), named, selectable as ONE thing, visible in the
  graph (`memberOf` projection, same key-encoded rule family as ADR-0046).
  Group-transform (drag/pinch the whole set) reads members from the fact;
  the per-element `group` attribute is migrated in and then retired.
  *This revives the group resize/rotate/scale handles with a real model
  under them* — the group box gets its own placement-like transform applied
  member-wise on commit.
- **A frame is a collection with the `camera` facet.** Today's frame facts
  are already valid; `frame:` keys stay (no migration), the type just joins
  the family. "Frame this group" becomes: add the camera facet — group and
  frame are the same fact wearing two facets.
- **A board is a collection rendered spatially** — its members are its
  placements (ADR-0054); a view-backed board is a query-collection with the
  spatial facet. `canvas:<id>` identity facts join the family.
- **Promotions are facet additions, never rewrites**: group → framed group →
  its own board is the natural growth path of a cluster of thought, and each
  step is one small fact edit.

**UI consequences (canvas):**
- Group (⌘G) creates the collection fact + selects it; the sheet shows the
  group's name, members count, and facet toggles ("Add camera → frame",
  "Open as board").
- Tapping any member selects the group first (today's behavior, now backed
  by the fact); a second tap drills into the member.
- Blend modes and rotation stay per-element placement attributes — they are
  spatial-authoring surface, explicitly kept.

**Pruning (narrowed per owner):** dead group-handle FSM remnants (already
removed), `versions` (already stripped by the persister), content scripts
(ADR-0056). Nothing else — expressiveness is not vestige.

## Increments

1. Group facts: create/rename/ungroup on the collection fact; per-element
   `group` attrs read as legacy, migrated on first group edit; group
   transforms member-wise on commit.
2. Frame↔group facet unification: "Frame selection" creates a collection
   with both facets when a group is selected; frame editor gains the member
   list UI.
3. Board-as-collection: `canvas:<id>` value gains the facet; the home cell's
   graph shows groups/frames/boards as one node family.
4. Views join last (query-collections), replacing `_views/` special-casing
   in the canvas loader.

## Costs & open questions

- Group selection semantics change subtly: group membership becomes
  DATA (shared, persistent, visible to agents) instead of a private display
  attribute — that's the point, but it means agents can create groups too.
  Grants apply as with any fact.
- Migration of `el.group` strings: lazy (on first edit) to avoid a bulk
  rewrite; the tag-union lesson from ADR-0054 applies.
- Open: should facets be TYPES instead (`type: group|frame|board` with a
  shared `members` shape)? Facets compose (a framed group is one fact);
  types don't. Leaning facets — but this is exactly the buffer question to
  interject on.
- Open: ordering — Inc 1 (groups) can land before or after ADR-0055/0056
  implementation; it's independent. Proposed order stays 0055 → 0056 → 0057
  unless the owner pulls groups forward.
