# ADR-0047 — Home is the graph; the field computer is its palette

- **Status:** v1 shipped 2026-07-02 (graph shell live as the authed default; legacy dashboard one toggle
  away). Follow-ups listed below.
- **Date:** 2026-07-02
- **Depends on:** ADR-0038 Inc 2 (the card's D3 grammar — lazy CDN d3, zoom/drag, degree sizing,
  authored-solid/derived-dashed), ADR-0041 (the field computer engine: catalog discovery, the form
  floor, federated results), ADR-0046 (board membership as `onBoard` edges — what makes the graph
  actually *structural*), ADR-0044 Inc 5b (home's module split — this rework touches three files, not a
  monolith), ADR-0033 (progressive disclosure).
- **Method:** deep design review of BOTH prior surfaces first (the canvas command palette and the home
  field computer), then fusion — not a fresh invention.

## The finding (the two reviews, distilled)

The **canvas palette** is a verb menu over direct-manipulation state: a persistent floating bar (never a
modal — no scrim, the surface stays live behind it), ⌘K summon, a flattened searchable command tree with
breadcrumb provenance, **context-predicate gating** (`visible`/`enabled` over live selection), an input
that is a **mode-machine** (browse → awaiting-arg → pending), detents (one bottom surface at multiple
heights), and recents. It structurally lacks: typed argument collection (one free-text `needsInput` is
its whole grammar), any result rendering, an async lifecycle, and a *declared* catalog.

The **field computer** is exactly the complement: live `$catalog {detail:'full'}` discovery, three-tier
argument collection over one value (ui:// cell form → SchemaForm floor → raw JSON), `mcpCall` execution,
and a four-way result renderer (federated `ui://` / typed fact / fact list / JSON) with a persistent
output tape. It structurally lacks the shell: no global summon, no context sensitivity, no recents, and
it sat as one collapsible-exempt card in a nine-section column.

**Home rendered no graph at all.** The card's D3 grammar existed but was card-bound (fixed 460px,
120-edge cap, imperative DOM, degree-only sizing).

## Decision

Authed home becomes **a full-viewport force graph with the field computer as its floating palette**:

- **The graph** (`cells/home/client/graph.tsx`): nodes = `workspace.query {rankBy:'salience', limit:140}`
  (the focus band — progressive, not the whole 1,500-fact slice), sized by **salience score** (degree
  assist), colored by type (stable hue hash); edges = `workspace.graph` (the full Reference projection)
  filtered to visible nodes, styled by the board-renderer grammar — authored solid, `similarTo` the faint
  constellation, membership (`onBoard`/`inDoc`/`inView`) a light structural dash, other derived dashed.
  Zoom/pan/drag, settle-then-freeze (drag re-warms), ResizeObserver re-centering, lazy CDN d3. Tap
  selects; double-tap peeks (`openFact` modal — facts.tsx's existing progressive detail host);
  background tap clears.
- **The palette** (`cells/home/client/palette.tsx`): the canvas shell around the field-computer engine.
  A fixed bottom-center floating bar (no scrim); collapsed = one pill; ⌘K opens, Esc closes; expanded =
  a detented sheet (56vh) holding the **whole existing `Console`** (catalog search, namespace chips,
  forms, output tape — reused, not rewritten). A selected graph node adds a **context row** above the
  pill: type icon + title + declared affordances (peek / open via `factHref`) — the canvas
  context-sensitivity idea driven by type handlers instead of hardcoded verbs. **Positionable** on
  desktop (drag the handle anywhere; double-tap re-docks); a full-width bottom sheet on small screens.
- **The legacy dashboard survives** as state, not a route: a `dashboard` button (graph mode) ↔ `⊹ graph`
  button (column mode). SSR always renders the graph shell for the authed owner, so server and first
  client paint agree by construction; d3 mounts client-side into the empty stage.

## Follow-ups (scoped, not shipped in v1)

- **One-hop expand from the context row** (pull `workspace.neighbors` into the live sim — the card's
  neighbour model, in place).
- **Selected-node → palette command seeding** (e.g. selecting a machine offers `machine.step`; the
  context row learns the canvas palette's `visible()` richness from declared handlers).
- **Recents + empty-Enter capture** in the palette (the canvas overloaded-Enter idea: unmatched text
  becomes a `workspace.remember` capture).
- **Graph refresh/live tail** (changes feed → incremental node/edge updates instead of load-once).
- **Edge labels on zoom** and a type legend.
