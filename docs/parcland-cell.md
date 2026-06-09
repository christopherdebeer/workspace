# parcland as a cell — the canvas as a view over the substrate

> Exploration: hoisting `christopherdebeer/parcland` (the canvas-diagramming
> app at parc.land, websim-born, March 2025–) onto the platform, with canvas
> items corresponding to substrate facts and positioning as *decoration*. Based
> on a full read of the implementation (~3.5 KLoC src + 6 KLoC tests).

## What parcland actually is (the nuances that matter)

The code evolved organically and the evolution left load-bearing shapes:

1. **The data model is already substrate-shaped.** `CanvasElement` is
   `{ id, type, content }` — a typed fact — *plus presentation decoration*
   (`x, y, width, height, rotation, scale, zIndex, blendMode, color, static,
   group`) *plus references* (`refCanvasId` for drill-in, `src/imgId` for
   images, `target`+`property` for edit-prompts). `Edge` is
   `{ id, source, target, label, style, data }` — a typed, directed,
   labelled link. The separation the substrate needs is already latent in the
   field list; it just isn't enforced.

2. **The renderer is a plugin registry** (`elementRegistry.ts`): per-type
   views with `mount/update/unmount`, runtime-registerable
   (`window.registerElementType`). A canvas element's renderer is chosen by
   its `type` — exactly the substrate's render-hint discipline, already
   built. HTML elements even **execute their own inline scripts** with
   `(element, controller, node)` in scope — the canvas runs its content;
   parcland is reflexive the way the platform is.

3. **The CRDT layer is the seam.** `CrdtAdapter` (Yjs maps over WebRTC,
   `rtc.parc.land` signaling) is wired *into* the controller — every
   `updateElementNode` calls `crdt.updateElement(id, el)`, and
   `crdt.onUpdate` receives remote deltas — but the remote→local merge is
   **commented out**; real persistence is a debounced (300ms) whole-canvas
   JSON `PUT` to `backpack.parc.land` with a localStorage fallback. The
   organic evolution left exactly the right interface half-occupied: a
   per-element update adapter with an update callback. **A
   `SubstrateAdapter` with the same surface is the entire integration
   point.** Presence (peer selection highlighting, shared viewState via
   awareness) *does* work and is genuinely ephemeral — it should stay
   off-substrate.

4. **Camera ≠ document.** `viewState` (scale/translate) is per-device
   localStorage (`canvasViewState_<id>`), never saved into the canvas.
   Selection is awareness state. The code already distinguishes the three
   state classes the thesis demands: document (elements/edges), decoration
   (positions — currently *conflated into document*), and ephemera
   (camera/selection — correctly excluded).

5. **Canvases nest.** `refCanvasId` + `parentCanvas`/`parentElement` +
   `?canvas=` pushState give drill-in/drill-up — a canvas is an element of
   another canvas. **Edges can terminate on edges** (labels as endpoints),
   and `data.meta` edges express tooling relationships — the `edit-prompt`
   flow creates an editor *element* meta-linked to its target element's
   property: **an action reified as a canvas item with provenance edges.**
   That is a declarative action drawn on the board.

6. Element `versions[]` keeps content history per element; undo/redo is a
   100-deep snapshot ring; rendering is rAF-batched DOM reconciliation keyed
   by id; gestures are an xstate machine with error-trapping action wrappers.

## The mapping

| parcland | substrate |
| --- | --- |
| `CanvasElement.id` | fact key |
| `CanvasElement.type` | fact `type` (renderer = render hint) |
| `CanvasElement.content` (+ `src`, domain fields) | fact `value` |
| `x,y,w,h,rotation,scale,z,…` | **a placement fact** `_canvas/<canvasId>/<key>` |
| `Edge {source, target, label}` | `link(from, rel = label ?? 'relates', to)` |
| `Edge.style` / `data.meta` | placement-fact for the edge / `rel` namespacing (`meta:editing`) |
| canvas membership | placement exists **or** the canvas view's query matches |
| the canvas itself | a **registered view**: `_views/canvas:<id>` `{ query, render: { type: 'canvas' } }` |
| `refCanvasId` drill-in | a fact whose value names another canvas view |
| `versions[]` | revisions count today; full value history needs supersede-chains (gap) |
| Yjs awareness (presence, peer selection) | stays WebRTC — ephemera, not facts (rooms later) |
| backpack PUT + localStorage | `remember`/`link`/`changes` via the read/act gateway; localStorage stays as offline cache |

### Positioning as decoration — yes, and it pays for itself

The question was whether positioning can be decoration over facts. It can,
and it should be **facts in a reserved per-canvas prefix**, not fields on the
domain fact:

```
fact:        todo:wire-views          { title: "wire views", effort: 2 }   type=todo
placement:   _canvas/board1/todo:wire-views   { x: 120, y: 80, w: 200, h: 90 }
```

What this buys, in thesis terms:

- **One fact, many canvases** — the same fact can sit on several boards at
  different positions; deleting a board deletes decorations, never truth.
- **Placement provenance** — who moved what, when (`writer`/`via`/revision
  on the placement fact); attention on the board feeds salience.
- **The UI is a projection**: the document is the reef; the canvas is one
  observer's spatial arrangement of it. Removing the canvas changes nothing
  (Law 4, observer independence).
- **Self-activating surfaces**: because a canvas is a registered view with a
  `query`, a fact that *matches the canvas's predicate appears on the board
  without anyone placing it* (unplaced facts flow through parcland's
  existing `auto-layout` until a human pins them — at which point a
  placement fact is written). New truth surfaces itself; arrangement is the
  human's annotation on top. That is "playtest's surfaces" made literal.

### The adapter (the concrete integration)

Replace `CrdtAdapter` behind its existing interface:

```ts
class SubstrateAdapter {
  // outbound (called from updateElementNode / createNewEdge):
  updateElement(id, el)  → split: domain fields → act remember(id, value, type)
                                   placement   → act remember(_canvas/<cid>/<id>, …)
                                   (debounced per key, like today's 300ms save)
  updateEdge(id, e)      → act link(e.source, e.label ?? 'relates', e.target)
  // inbound (drives requestRender, replacing the commented-out Yjs merge):
  poll read changes({ sinceSeq }) → fold write/link/supersede events into canvasState
  // load:
  read view canvas:<cid> (query members) + query prefix _canvas/<cid>/ (placements)
}
```

`storage.ts` is already the only persistence module (~120 lines, isolated);
auth swaps the backpack token for the OAuth/PKCE bearer `home`'s client
already implements (`services/home/client/auth.ts`).

### Hosting

parcland is a static Vite SPA. Two viable shapes:

1. **Tier-1 cell** (like `home`): a `canvas` cell serving the bundle at
   `/canvas/*`, client built by esbuild at deploy. Right end-state — the
   canvas becomes the substrate's *spatial* projection beside home's
   *console* projection.
2. **Faster probe**: keep parcland deployed where it is; add the
   `SubstrateAdapter` behind a `?backend=substrate` flag pointing at
   `parc.land/mcp` read/act. No platform change at all — the gateway is
   already the API. This is the recommended first slice.

## Honest gaps

- **Whole-canvas save → per-fact writes** is the one real refactor: today
  every mutation saves the entire `canvasState`; the substrate wants
  fact-granular writes. The hook points exist (`updateElementNode`,
  `createNewElement/Edge`, delete paths all funnel through the controller),
  but it is a behavioural change with edge cases (group drags = N placement
  writes; debounce per key).
- **Version history**: the substrate keeps current value + revision count,
  not value history; `versions[]` would need supersede-chains or a
  convention. Undo/redo can stay client-local (it is today).
- **Realtime**: `changes(sinceSeq)` is poll-based; fine for one user on two
  devices, not for live co-editing — that's the rooms/wait-on-predicate
  frontier, and presence already lives happily on WebRTC.
- **Inline script execution** (`executeScriptElements`) is fine per-user but
  must not survive into shared/granted canvases without a sandbox decision.
- **Edge-to-edge endpoints** don't map to substrate edges (from/to are
  keys); when an edge needs to be an endpoint, reify it as a fact — which is
  what its visual label already is.

## Sequencing

1. **Probe (no platform changes)**: `SubstrateAdapter` + storage swap behind
   a flag; membership by placement only; edges → links. Validate with a real
   board over `parc.land/mcp`.
2. **Canvas-as-view**: register `_views/canvas:<id>` with `render: {type:
   'canvas'}`; query-driven membership + auto-layout for unplaced facts;
   home's console links each canvas view to its board URL.
3. **Cell hosting**: promote to a tier-1 `canvas` cell at `/canvas/*`.
4. **Later**: presence→rooms, versions→supersede-chains, edit-prompt→
   declared actions (it already *is* one, drawn on the board).
