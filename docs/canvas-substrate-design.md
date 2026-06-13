# The canvas as a view over the substrate — design

> Thinking-through of four questions raised by live use of `@c15r/canvas`:
> (1) can views be *slices of the substrate with a pinned viewport* —
> embeddable iframes; (2) how to render facts that carry no position
> decoration; (3) the fact / view / action / canvas-element dichotomy, up the
> ladder to canvas plugins and custom elements; (4) how salience should
> manifest spatially. Builds on `parcland-cell.md` and the phase-2–5
> primitives, all now live.

## 0. The factoring that organizes everything

A canvas item today conflates three things that should vary independently:

> **item = fact × renderer × placement**
>
> - **fact** — what is true (`{value,_meta}` at a key: typed, tagged,
>   linked, salient). Lives in the substrate; owned by no board.
> - **renderer** — how it is perceived (markdown, image, view-tile, iframe).
>   A modality, chosen per item or per type. Lives in the registry.
> - **placement** — where one observer pinned it (`_canvas/<board>/<key>`).
>   A human **annotation with provenance**. Lives in the board's decoration
>   prefix; the same fact may sit on many boards at different positions.

Everything below falls out of keeping these orthogonal. The dichotomy the
question senses — fact vs view vs action vs canvas-element — dissolves once
"canvas-element" stops being a *kind of thing* and becomes *any fact, seen
through a renderer, at a placement*.

## 1. The renderer ladder (custom elements → plugins → cells)

parcland already has the seam: `elementRegistry` with runtime
`window.registerElementType(type, {mount, update, unmount})`, and HTML
elements that execute their own scripts. The ladder mirrors the platform's
declarative→code gradient exactly:

| Tier | Renderer | Declared as | Trust |
| --- | --- | --- | --- |
| 0 | built-ins (markdown/text/img/html/edit-prompt) | compiled into the canvas client | reviewed code |
| 1 | **renderer facts** — `_renderers/<type>` holding `{mount, update}` source | a fact; the canvas `registerElementType`s them at boot | same as html-element scripts: fine per-user, needs the sandbox decision before shared boards |
| 2 | **view elements** — an item whose fact *is* a registered view id; renders the view's value by its hint (metric/table/feed/…) | already-declared views | pure (CEL-style: evaluate, never mutate) |
| 3 | **cell elements** — an iframe onto a cell surface (`/@owner/cell?...`) | a fact referencing a cell address | the cell's own IAM boundary |

Tier 2 is the quiet unification: a **view placed on a board is a live
dashboard tile** — the *same declaration* that is an MCP affordance to an
agent and a Surfaces card in home becomes a third modality, spatial. One
vocabulary, three projections; this is `the-substrate-thesis`'s "the UI and
API converge" made literal.

Tier 3 generalizes parcland's `refCanvasId` drill-in from canvas-in-canvas to
**surface-in-canvas**: any web-facing cell is embeddable as an element. The
heavyweight "canvas plugin" is just a cell — it already has isolation,
deploys, logs, and a URL.

## 2. Views as substrate slices with a pinned viewport (embeddable boards)

A board today = tag membership + placements; the camera is per-device
localStorage (correctly: *camera ≠ document*). The extension: a **view can
denote a board region**, and the canvas can open it.

```jsonc
// _views/canvas:decisions
{
  "id": "canvas:decisions",
  "query": { "type": "decision" },              // membership = the QUERY, not a tag
  "render": {
    "type": "canvas",
    "board": "knowledge",                        // whose placements to use
    "viewport": { "x": 700, "y": 800, "scale": 0.6 },  // pinned camera (or "fit")
    "interactive": false                         // pan-only / read-only when embedded
  }
}
```

- The canvas honors `?view=<id>`: membership comes from the view's query,
  placements from the named board, the **camera from the declaration** —
  pinned, shareable truth rather than device state. (A user's free roam stays
  local; *named* viewpoints are themselves decoration facts —
  `_canvas/<board>/_viewport/<name>` — so "look here" is shareable and has
  provenance.)
- `&embed=1` strips chrome and locks interaction → **iframe-able**: home's
  Surfaces card for a canvas view stops being a link and becomes a *live
  thumbnail of the actual board region*; another canvas embeds it as a tier-3
  element (board-in-board with an independent camera); externally it's just a
  URL on a public cell.
- The deep consequence: **query-driven membership makes boards
  self-activating surfaces.** "Every `type=decision` fact" is a *living*
  board — new decisions appear without anyone placing them (see §3). The
  board declares conditions; truth surfaces itself. That is playtest's
  surfaces, spatially.

Auth note: embeds inherit the session (same-origin bearer). Public,
signed-out embeds need either a read-grant mechanism or — neater — the
canvas cell server-rendering an SVG snapshot at a public GET. Defer; design
permits both.

## 3. Facts with no placement (the unplaced)

Today an unplaced fact gets defaulted to (100,100) and stacks — wrong. The
design distinction: **pinned placement** (a human wrote the decoration) vs
**synthesized placement** (the board proposes one):

1. **Graph gravity first**: an unplaced fact with links positions near the
   centroid of its placed neighbors (parcland's auto-layout already knows
   this math) — new knowledge appears *where it belongs argumentatively*.
2. **The tray**: link-less unplaced facts dock in a margin strip, ordered by
   salience — an inbox of surfaced truth.
3. **Visibly provisional**: synthesized items render distinctly (dashed
   border, reduced opacity). **Dragging one pins it** — writes the placement
   fact, with provenance. Pinning is the human's annotating act; until then
   the item belongs to the substrate's own arrangement.
4. Auto-layout becomes a command over *synthesized items only*; it never
   moves what a human pinned.

This is the canonical agent↔human loop: an agent `remember`s a fact matching
the board's query → it materializes provisionally on the human's board → the
human reads, drags, pins → the agent sees the placement fact (who pinned,
where, when). Stigmergy with a UI.

## 4. Salience, spatially

Substrate salience (recency + velocity + attention → focus / peripheral /
elided) already arrives with every query/recall. The governing rule:

> **Salience modulates presentation, never position — and only ever *adds*.**
> Position is the human's annotation — spatial memory is the canvas's whole
> value; a board that rearranges itself destroys it. And a board must show
> **every fact its query includes, at full fidelity**: salience is a *positive
> marker*, never a subtraction. (The earlier model faded the peripheral and
> collapsed the elided to title chips — that hid content the query had chosen
> to include, inverting the point of a board; it's retired. Revised
> 2026-06-13.)

- **Salient** — the board's most salient items (relative to its own top score)
  carry a **✦ badge** (`data-salience="high"`); a glance finds what matters.
- **Everything else** — full value, full opacity, full geometry. Nothing is
  dimmed, collapsed, or omitted.
- **Attention still flows through the trajectory** — reads/`peek`s raise real
  salience for every future observer; that now changes *which items are
  badged*, never whether content is shown.
- **Edges** — stroke opacity/width from endpoint salience and link strength;
  the argument structure fades where attention has.
- **The tray** (§3) is salience-ordered; the board's margin is its attention
  queue.
- **A heatmap lens** — an explicit toggle overlaying salience as aura
  intensity. A lens, not a state change: observers stay pure (Σ-calculus
  Law 4).
- Over days, the board visibly *cools* where work hasn't touched — the
  legacy workspace's tending instinct, rendered. `attention()`'s stale /
  unlinked / dangling can drive a tending lens on the same mechanism.

Read-amplification guard: board loads use `query` (which logs no per-key
reads), so rendering does not inflate its own salience; only deliberate
expansion (`peek`) counts as attention. The substrate's "salience cost" open
question stays answered.

## 5. Two repairs the live seeding exposed (do first)

1. **Type preservation on rewrite** — `storage.ts` stamps every domain write
   `type: 'canvas-element'`, clobbering semantic types (`decision`,
   `project`, …) when a seeded node is edited on-board. Fix: omit `type` on
   rewrite (the substrate already preserves the stored type when omitted);
   only stamp `canvas-element` on *creation* of a fact that has no type.
2. **Edges from links** — the board currently renders edges only from
   `_canvas/<board>/edge:*` decoration facts; substrate links written by
   agents are invisible. Fix: edges = `neighbors`/link projection (the
   truth), with decoration facts carrying only style/label-position
   (annotation). Then an agent's `workspace.link` draws on the board, the
   way an agent's `remember` already lands in the tray.

## 6. Sequencing

1. The two repairs (§5) — small, correctness-shaped.
2. Salience channel (§4): opacity tiers + elide-to-chip + peek-on-expand.
3. Unplaced handling (§3): graph gravity + tray + drag-to-pin.
4. View-backed boards (§2): `?view=` + pinned viewport + `embed=1`; home's
   canvas Surfaces card becomes a live iframe thumbnail.
5. Renderer ladder (§1): view elements (dashboard tiles), then renderer
   facts (`_renderers/*`), then cell-iframe elements — each tier reusing an
   existing trust boundary rather than inventing one.

> The throughline: the canvas never becomes a database; it stays an
> *observer with an opinion about arrangement*. Facts are the substrate's;
> renderers are modalities; placements and named viewpoints are annotations
> with provenance; salience is a presentation channel; and the plugin
> ladder is the same declarative→code gradient the platform already walks
> everywhere else.
