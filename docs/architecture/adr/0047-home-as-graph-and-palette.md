# ADR-0047 — Home is the graph; the field computer is its palette

- **Status:** v2 shipped 2026-07-02 (v1 same day). v2 answered first-use feedback: edge contrast +
  rel labels, labels participate in the sim, selection is key-owned by App (graph pans to external
  selections; palette context panel gained content preview + neighbour chips), and console results
  reach the graph (highlight + fit-to-viewport). Remaining follow-ups listed below.
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

## v2 (first-use feedback, same day)

- **Edge contrast**: v1's ink-derived strokes (`#5a5142`) vanished on the dusk background; edges are
  now warm-light (`#cfc4aa` authored / `#e8ddc2` structural) at rel-tiered opacity — authored solid,
  membership dashed, derived dashed fainter, `similarTo` the barely-there constellation.
- **Edge rel labels** with a dark halo (`paint-order: stroke`); `similarTo` never labels, derived
  rels fade in past 1.3× zoom (the "edge labels on zoom" follow-up, landed).
- **Labels participate in the sim**: collision radius extends by rendered label width, so node
  labels stop overlapping visually instead of only node circles avoiding each other.
- **Selection is key-owned by App** (`selectedKey: string`), flowing both ways: graph taps set it;
  the palette's context panel grew a peeked **content preview** (`FactBody full`, collapsible) and
  **neighbour chips** (`workspace.neighbors`, outbound + inbound); tapping a chip changes selection
  and the graph **pans its camera** to any selection it didn't originate (500ms ease, echo-guarded).
- **Console results reach the graph**: `invoke()` dispatches `home:console-result`; the graph
  extracts fact keys from any result shape (entries list / focus / members / single fact),
  highlights them (accent ring, others dimmed), and **fits them to the viewport** — search, query,
  and recall now visibly reshape the graph.

## v2.1 (field debugging + the orphan question)

A reported click-crash surfaced as a masked `Script error.` (Safari masks exceptions whose top
frames are cross-origin — both react-dom via esm.sh and d3 via jsdelivr qualify, so ANY render or
handler error on home was unreadable in the field). A full jsdom harness replaying the real bundle
against live substrate data (all 140 nodes clicked, real peek/neighbors/type-vocabulary) found no
reproducible fault, so v2.1 ships the observability to catch it where it happens:

- `?debug=1` injects the **eruda** mobile console before the app module loads (sticky via
  `localStorage['parc.debug']`; `?debug=0` clears it).
- `guard()` wraps every d3-dispatched handler (click/dblclick/zoom/drag/result-listener) and
  re-reports via `window.reportError` from same-origin code — the masked error keeps its message
  and stack.
- A **GraphBoundary** around the graph branch catches React render errors in-JS (boundaries see the
  real error object, unmaskable), shows message + stack, and offers the dashboard as an exit.
- The err-banner shows stack lines, explains masking, and dismisses on tap.

**Orphan nodes** (the "dispersed collection"): live-data analysis showed no fact is truly
edgeless — every apparent orphan had edges in the full projection whose far ends missed the
140-node salience band (the graph only draws an edge when both ends are visible). 29 of 41 were
`canvas-placement` decorations whose only edge is `instanceOf → _types/canvas-placement`: geometry,
not knowledge (ADR-0046 — the el already carries the `onBoard` edge). v2.1 filters
reserved-namespace keys (`_…`) and `canvas-placement` facts out of the node band. The structural
fix for the REST (cells, machine-runs with off-band neighbourhoods) is the one-hop-expand
follow-up below.

## Follow-ups (still open)

- **One-hop expand from the context panel** (pull neighbours into the live sim as nodes — the
  card's neighbour model, in place; chips currently navigate, not expand).
- **Selected-node → palette command seeding** (e.g. selecting a machine offers `machine.step`; the
  context panel learns the canvas palette's `visible()` richness from declared handlers).
- **Recents + empty-Enter capture** in the palette (the canvas overloaded-Enter idea: unmatched text
  becomes a `workspace.remember` capture).
- **Graph refresh/live tail** (changes feed → incremental node/edge updates instead of load-once).
- **Type legend.**
