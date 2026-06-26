# ADR-0035 — `ui://` as the substrate's universal render resource

- **Status:** Accepted — **unify the rich tier + share the hint floor** (home stays inline-rendered; not the
  maximal "home consumes `ui://` for everything"). A type's renderer becomes **one artifact** authored by its
  managing cell and consumed by every surface: inline where the surface is React (home, canvas), and as a
  sandboxed `ui://` MCP-Apps iframe where it's foreign (the conversation, any MCP host). The hand-rolled
  hint vocabulary is extracted into `platform/ui` so there is a single implementation, not a React one (home)
  and a vanilla one (the conversation card). Promotes ADR-0034's `ui://` widget from "an MCP-Apps feature" to
  the materialized form of `handlers.render`/`embed` across the whole substrate.
- **Date:** 2026-06-26
- **Depends on:** ADR-0034 (MCP-Apps `ui://` + the conversation surface), ADR-0002/0012 (type-as-one-object;
  `present`/`handlers`), ADR-0004 (projection pipeline), `docs/canvas-substrate-design.md` (the renderer
  ladder), ADR-0008 (cells/origin-isolation — the sandbox). Vision: composable React, MCP-native.

---

## The insight

The renderer ladder already ends in a **cell-element** rung — `home`'s `FactEmbed` is *an iframe onto a
cell-rendered view of a fact*. An **MCP-Apps `ui://` widget is the same rung**, standardized as a protocol,
made interactive (host-proxied `tools/call`), and reachable in the conversation. They were drifting into two
renderers; they are one. Likewise the **lightweight hint floor** (markdown/code/metric/fields/image) had
*two* implementations — `home`'s React `HintBody` and the conversation card's hand-rolled vanilla JS — and
that divergence is exactly why the card looked "too basic."

So: **a type's rendering is authored once by its managing cell, and projected to every surface.**

## Decision

1. **One renderer per type, authored by its managing cell.** `handlers.render`/`embed` materializes to a
   renderer artifact. A cell that manages a type (`@c15r/home` already manages `file`/`protocol`/…) owns it.
2. **Inline where React, `ui://` where foreign.** Home/canvas (React surfaces) render the component **inline**
   — no iframe-per-fact, so dense lists + zero-JS SSR + perf are preserved. Foreign surfaces (the conversation,
   any MCP host) get the **same** renderer as a self-contained `ui://` resource (a sandboxed iframe). The
   gateway serves it by returning the cell's built renderer HTML (fetched server-side) — never by framing the
   live cell origin (ADR-0034 security model).
3. **Share the hint floor in `platform/ui`.** Extract the hint vocabulary (`bodyText`, markdown, code, metric,
   fields, image, label-path resolution) into a single `platform/ui` module. Home wraps it (React); the
   conversation card's bundle imports it. The card stops being a vanilla re-implementation.
4. **The gateway stays a thin projector.** It serves `ui://` resources and binds the card to `read`; it does
   not own rendering logic. Extensibility lives in the type vocabulary + cell-served renderers — runtime,
   tier-2, no CDK deploy (the boundary established in ADR-0034).

**Not chosen:** making home a thin shell that composes `ui://` per fact/section — per-fact iframes regress
the primary human surface's dense-list perf and SSR. Inline-React stays home's path; `ui://` is the export
for foreign surfaces.

## Consequences & trade-offs

- **One renderer, four surfaces** — author a type's view once; it appears in home, canvas, narrative, and the
  conversation. The CALM invariant, now for rendering.
- **Build cost (the real price):** the `ui://` renderer must be a self-contained browser bundle (it imports
  `platform/ui`, runs in the sandbox). That needs a build step. The cheapest path reuses the **existing cell
  build pipeline**: the renderer lives in a cell (home, or a dedicated `viewers`/widget cell) built with the
  same esbuild cells already use; the gateway's `resources/read` fetches that built HTML server-side. No new
  gateway-specific bundler.
- **SSR is preserved** because home keeps inline-React; the `ui://` export is additive.
- **Security unchanged** (ADR-0034): the `ui://` resource is content rendered in a foreign sandbox; live data +
  interactivity flow through the host `tools/call`/`resources/read` proxy under our `enforceScope`.

## Increments

- **Inc A — share the hint floor.** Extract `bodyText`/markdown/code/metric/fields/image/label-resolution into
  a `platform/ui` module (framework-agnostic string core). Home's `HintBody` wraps it; the conversation card
  uses it. Removes the duplicate vanilla renderer. (Pure refactor + dedupe; testable now.)
- **Inc B — the renderer as a cell bundle.** A renderer entry (in `home` or a dedicated widget cell) that
  imports the `platform/ui` renderers and builds (existing cell esbuild) to a self-contained HTML doing the
  MCP-Apps handshake — the real, shared renderer, not the hand-rolled card.
- **Inc C — gateway serves the cell-built renderer.** `resources/read` returns the cell's built renderer HTML
  (server-side fetch), replacing the inline `CARD_HTML`. The card becomes the cell's artifact.
- **Inc D — per-type cell renderers.** A managing cell serves its type's `ui://` renderer; the card resolves
  `handlers.render[].renderer` to it (ADR-0034 Inc 2′ consumer is already shipped). Now a cell deploy adds a
  conversation renderer with no platform deploy.

## Open questions

- **Where do the shared renderers live** — a dedicated `viewers`/widget cell vs. extending `home`? (`home`
  already manages the types; a dedicated cell keeps the bundle lean and reusable.)
- **Inline-vs-iframe selection per surface** — a surface declares its modality; the renderer artifact must run
  both inline (imported) and standalone (`ui://` bundle). Keep the component pure + host-channel-optional so
  the same source serves both.
- **Caching** — `ui://` renderer HTML is stable per cell deploy; the gateway should cache the server-side fetch
  (keyed by cell version) rather than fetch per `resources/read`.
