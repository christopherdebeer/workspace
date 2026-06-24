# ADR-0016 — Edges as first-class: a Reference rendered through an edge-renderer

- **Status:** Proposed — a feature ADR on the settled substrate, sibling to 0015 (frames).
- **Date:** 2026-06-22
- **Context:** the canvas draws edges as dumb SVG lines with a flaky "inline edit," yet edges are
  first-class substrate **References** (`{from, rel, to, strength}`, ADR-0003/0009). The UX must
  catch up: edges should be **selectable / editable**, with a **type vs label/content** distinction
  and **multiple, extensible visual treatments**.

---

## What the canvas does today (the gap)

- **Render** (`main.ts:renderEdgesImmediately`): every edge → one SVG `<line>` + a single global
  `<marker id="arrowhead">`. Style = `color`/`thickness`/`dash` only. A *labeled* edge also gets a
  companion `<text>` at the midpoint — that text node **is** the anchor for edge-to-edge links.
  One hardcoded visual treatment; no renderer seam.
- **Edit** (`gesture-helpers.ts:editEdgeLabel`): double-tap the label → spawn a transient
  `edit-prompt` element + a meta edge → CodeMirror. It writes `edge.label` in place. No undo, no
  keyboard, you must hit the text precisely, and selection is lost on save.
- **rel ≡ label (conflated):** the canvas `Edge` has **no `rel` field**; `queueEdgeWrite` writes the
  substrate link as `rel = edge.label || 'relates'`. So editing the *display label* silently
  **rewrites the semantic relation** — the core wrongness.
- **Not selectable:** only the `<text>` is hit-tested; the line has no hit-target, no `data-id`,
  and there is no `selectedEdgeIds`.
- **No types / no extensibility:** all edges render identically; there is no edge analogue of
  `elementRegistry` or the renderer-fact ladder.

## The decision — same factoring as elements

The canvas already factors an item as **`fact × renderer × placement`** (canvas-substrate-design
§0). Edges get the parallel factoring:

> **edge = link × renderer × style**

- **link** — the substrate Reference `{from, rel, to, strength}`. The truth. **`rel` is the TYPE**;
  `strength` a facet (ADR-0009). Owned by no board.
- **renderer** — how it is drawn, **chosen by the `rel`-type**: line / arrow / curve / labeled-pill /
  flow. An **edge renderer ladder** parallel to `elementRegistry` (built-ins → `_edge-renderers/<type>`
  facts), declared via the type vocabulary. This is the "multiple, extensible visual treatments."
- **style** — a per-board decoration `_canvas/<cid>/edge:<id>.style` (color/width/dash/renderer
  override): one human's visual annotation, like a placement.

### Type vs label/content — un-conflate

- **`rel`** = the semantic **type** (supports / navNext / relates / …). Lives in the substrate link;
  drives the renderer + default visual. Editing it **re-links** (unlink old rel, link new).
- **`label` / `content`** = a **distinct** human annotation on the edge (free text), stored only in
  the decoration — never the rel. Editing the label never touches the relation.
- **The edge-as-fact spectrum.** A *content-rich* edge **is a fact** with `from`/`to` refs (the
  "labeled edge renders an anchor node" already half-implements this — a labeled edge *is* a node).
  So the renderer ladder spans: bare reference-line → labeled pill → full node-on-the-line. This
  mirrors how a `claim` is a content-bearing bundle of `support` edges — a typed, content-rich
  relation is just a fact whose `_type` carries an edge render hint.

### Rendering is bound by the type vocabulary (ADR-0012 reuse)

A `rel`-type's `_types/<rel>` declaration carries an **edge render hint** (`render: { edge:
'curve', color, dash, arrow, … }`), resolved through the same `present`/`resolveType` machinery
that styles facts. So "supports" looks different from "navTo" from "relates" — **declared as data**,
the same vocabulary that styles nodes now styles edges. User-extensible treatments are
`_edge-renderers/<type>` facts (tier-1, mirroring `_renderers/<type>` for elements).

## Selectable / editable (replacing the inline edit)

- **Hit-test the line:** render an invisible wide hit-`<path>` under each edge + a class/`data-id`;
  the gesture FSM gains an `edgeLine` flag distinct from `edgeLabel`.
- **`selectedEdgeIds`** in the controller, alongside `selectedElementIds` (unified selection; the
  context menu adapts). Visual selection = highlight stroke.
- **An edge inspector** (select → context menu / panel) edits **rel** (a vocabulary picker with
  free-text fallback — re-links on change), **label/content** (free text — decoration only), and
  **style** (color/width/dash/renderer). Undo-aware (edges snapshot into history). The transient
  `edit-prompt` is retired for edges.

## Phasing

1. **Un-conflate + selectable.** Add a `rel` field separate from `label`; `queueEdgeWrite` writes
   `rel` to the link and `label` only to the decoration. Hit-test the line, `selectedEdgeIds`,
   selection highlight, and an inspector/context-menu to edit rel/label/style (retire the
   edit-prompt for edges). Migration: existing edges keep `label`; seed `rel := label` once, then
   they diverge.
2. **Edge renderer ladder.** `edgeRegistry` (mount/update parallel to `elementRegistry`) + built-ins
   (line/arrow/curve/annotation); bind renderer by `rel`-type via the `_types/<rel>` edge render
   hint; a default when undeclared.
3. **Extensible + edge-as-fact.** `_edge-renderers/<type>` facts (tier-1, user-authored treatments);
   content-rich edges promoted to facts (node-on-line), animated/flow treatments.

## Consequences

- Editing an edge's display no longer corrupts its meaning; `rel` (type) and `label` (content) are
  independent, both first-class.
- One vocabulary styles nodes **and** edges; visual treatments are declared/extensible, not hardcoded.
- Edges become selectable/editable like elements — the substrate's first-class References finally
  have a first-class canvas surface.

## Confirmed decisions (2026-06-22)

- **Edge-as-fact: on gaining content.** A bare relation stays a link-derived line. When an edge
  gains content/label it is **promoted to a `relation:<id>` fact** whose `from`/`to` are **`ref`
  fields** — so the fact *projects* its own link through the existing Reference rule (ADR-0003),
  exactly as a `claim`'s `support` projects `supports`. Minting the fact **replaces** the bare link
  (no duplicate). The content-rich edge is then a node-on-the-line: selectable, typed, queryable,
  link-to-able — a first-class fact — while bare references stay cheap.
- **Unified selection.** One selection holds elements *and* edges; the context menu / inspector
  adapts. Selecting a node can highlight its incident edges; a mixed selection is a subgraph.

## Open / to confirm

- **rel vocabulary source:** the picker draws from `$graph`'s observed rels + the type vocab, with
  free-text fallback. (Which rels are *editable* vs read-only — see derived edges below.)
- **Derived edges on the canvas (the reshape surface).** `$graph` carries **derived** backbone
  edges (`instanceOf`, `inDoc`, `managedBy`, `rendersWith`, `supports`, …) alongside authored ones.
  If edges are first-class, the canvas can render the **full Reference projection** — authored edges
  solid/editable, derived edges a distinct faint/dashed treatment, **read-only** (you can't hand-edit
  a projection). This is where "multiple visual treatments" earns its keep: the treatment encodes
  *provenance* (authored vs derived) and *type* (rel), not just decoration. Open: show derived edges
  by default, behind a toggle, or only on selection?
- **Edit surface (mobile-first):** a bottom-sheet inspector for the selected edge (rel picker /
  label / style) vs a context menu vs an in-place pill — the canvas tenet is mobile-first.
