# ADR-0015 — Frames: a viewpoint is a Collection rendered as a region

- **Status:** Accepted — the **first feature ADR on the settled substrate**. 0001–0013 named the
  primitives; 0014 closed the migration. This adds a *capability* (named, shareable, navigable
  canvas regions) **without a new primitive** — a frame is a Collection (ADR-0005) seen through a
  new render modality.
- **Date:** 2026-06-22
- **Context:** live use wants SSR / pinned views / embeds / deep-links to focus a particular
  *location and zoom* within a canvas, and to persist more than one such viewpoint per board.
  Builds on `canvas-substrate-design.md` §2 (views with a pinned viewport) and the crash-era
  camera work (`fitCamera`, `framesContent`).

---

## The decision

A **frame** (a.k.a. viewpoint / section / POI) is **not a new noun**. It is:

> **frame = a Collection (membership) + `render: { board, region }`** — projected to a camera by
> one resolver, `fitRegion(region → bbox, screen) → camera`.

This falls out of the factoring the substrate already has — *every surface is `collection ×
render modality`*:

| Surface | Collection (membership) | Render modality |
|---|---|---|
| doc (lit) | extensional `_doc/<id>/<key>` `{seq,fold}` | **narrative** (seq, markdown) |
| board (canvas) | tag `canvas:<cid>` + `_canvas/` placements | **scatter** (per-element geometry) |
| view tile | intensional `query` | **dashboard** (metric/table/feed) |
| **frame** | *either* | **region** (fit the members' bbox to the screen) |

So a frame reuses: membership (ADR-0005, `workspace.members`), the `render` hint
(`_views/<id>.render`, already `{type:'canvas', board, viewport, interactive}` and open-shaped),
provenance, grants, salience, `$graph`, and cross-surface embedding. The canvas adds only a
*gesture* and the *region render*.

### The keystone: persist the region, derive the camera

The old `render.viewport: {x, y, scale}` persisted a **device-dependent camera** — a `scale` that
frames well at 1200px is wrong on a phone. The screen-independent unit is a **region**, and the
camera is **resolved** per observer. This matches mature canvases — tldraw's `zoomToBounds(bounds)`
adjusts to the viewport aspect ratio; map libraries recommend `fitBounds(bbox)` over
`setView(center, zoom)` for exactly this reason. We generalize our own `fitCamera` into one
resolver used identically by SSR, the client, and embeds:

```
fitRegion(bbox, screen{w,h}, pad) → { scale, tx, ty }   // translate(tx,ty) scale(scale)
```

### Region: derived ⇄ anchored (duals)

```jsonc
// frame:parcland/architecture   (type: frame; Reference: frame inCanvas board:parcland)
{ "board": "parcland", "label": "Architecture",
  "region": { "kind": "members", "members": ["el:a","el:b"] } }   // reference-derived (default)
//        | { "kind": "query",   "query": { "type": "decision" } } // intensional, living
//        | { "kind": "bbox", "minX": 400, "minY": -200, "maxX": 1600, "maxY": 900 } // anchored
```

- **derived** (`members`/`query`) — the bbox is computed from the framed facts' placements, so the
  frame **follows its content** as elements move (Figma sections / tldraw `zoomToBounds(selection)`).
  This is the default.
- **anchored** (`bbox`) — a fixed rectangle, optional, survives element deletion.

They are duals: a derived frame computes region *from* membership; an anchored frame can derive
membership *from* region (the elements inside the bbox — how Figma section-capture works). Either
way it is `collection ⇄ region`; the camera is one resolver.

### A thin `frame` type (modality + vocabulary, not a resolver)

`frame` is a registered **type** (`_types/frame`) so humans and agents get a first-class noun
(icon, `$types` entry, `create`/`open` handlers) — but it **is a Collection underneath**, so the
invariant holds: one representation (the collection), one membership resolver
(`workspace.members`), one camera resolver (`fitRegion`). `frame` is a render modality + alias, not
a second anything.

## Navigation — frames make a board walkable

Two Reference relations turn frames into interactive navigation (Figma prototype connections /
Prezi path, substrate-native):

- **`navTo`** — `from navTo to`, where `from` is any element *or* frame and `to` is a frame /
  element / board. Activating `from` (click) **focuses the camera** to `to`'s region. A hotspot /
  hyperlink, as an edge. (`el:cta navTo frame:architecture`.)
- **A tour is an ordered collection of frames.** Reuse the doc-order **`seq`** primitive: a `tour`
  is a frame-of-frames whose members are frames, ordered by `seq`. `?frame=<id>` shows the frame;
  if it sits in a tour, the canvas renders **next/prev** that `navTo` the adjacent frames. (Prezi /
  Figma present mode, built from `seq` + `navTo` — no new machinery.)

So: `navTo` is the atom (activate → focus); a tour is `seq`-ordered frames; both are just
References, projected by `fitRegion`.

## Consumption

- **`?canvas=parcland&frame=architecture`** → opens framed on that region; SSR fits the bbox to
  `?w/?h` (or defaults) — correct on any device because it is a *fit*, not a stored scale.
- **`&embed=1`** → a live thumbnail of the region; many per page (home Surfaces).
- **default frame** — a canvas may flag one frame `default`; that is what you see on open with no
  `?frame` (properly resolving the fit-vs-origin question the crash-fix only heuristically patched).
- **precedence** (a Resolution): explicit `?frame` ▸ device saved camera *if it still frames
  content* ▸ canvas default frame ▸ fit-all.

## Ergonomics — created/edited like any collection (in and out of canvas)

Because a frame is a collection, **no new authoring surface**:

- **In-canvas (native gesture)** — select elements → **"Frame selection"** writes a `frame` fact
  (`region:{kind:'members'}` of the selection) `inCanvas` the board; drag-a-rectangle → an anchored
  frame; editing = add/remove members or drag handles.
- **Out of canvas (substrate-native)** — it is a fact: an agent writes `frame:<id>` (or
  `registerView`-style), home shows it as a Surfaces card, lit can embed the tile. The same verbs
  that make docs/views/groups make frames.

The win of *not* minting a primitive: a frame inherits every collection affordance for free.

## Phasing

1. **`fitRegion` + `regionBBox` resolver** (isomorphic `cells/canvas/shared/frame.ts`, unit-tested)
   + the `frame` type + `?frame=<id>` focus (client + SSR). Anchored + member/query-derived regions.
2. **In-canvas gesture** — "Frame selection" / drag-rectangle; the camera-fit + write.
3. **Tours + nav** — `seq`-ordered frame-of-frames, next/prev controls, `navTo` click-to-focus,
   default frame; migrate `render.viewport {x,y,scale}` → `region`.

## Consequences

- One screen-independent viewport model; SSR/client/embed share one `fitRegion`.
- Viewpoints are facts: many per board, shareable, grantable, queryable, tour-able, cross-surface.
- No new primitive — `frame` is `Collection + region render`; the breathe invariant holds.

## Out of scope / later

- Spatial salience (§4): a frame whose region is a *salience-ranked* query ("frame the hottest
  cluster") — supported by the model (region = query), deferred.
- Sandboxed shared boards (the renderer-ladder trust decision) — orthogonal.
- Anchored→membership capture (elements inside a dragged bbox) — Phase 2 gesture detail.
