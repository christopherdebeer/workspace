# ADR-0036 — The conversational view: progressive, interactive widgets for cell-owned types & tools

- **Status:** Accepted — **Tier 2 viewers/machine reuse shipped.** The card now imports the **`viewers`
  cell** renderers (json tree / csv table / mermaid — the same modules canvas + lit use) and dispatches on
  a type's `present.render.viewer`; `machine-run` facts render their `trace` as a **mermaid flowchart**
  (current node highlighted). The resource declares the mermaid CDN in `_meta.ui.csp.resourceDomains`
  (`resources/read` now passes `_meta`). **Sizing** is handled (the spec leaves frame size to the host):
  the widget reports its size via `window.mcpApp.resize()`, a `ResizeObserver`, and `ui-size-change`
  messages — whichever the host honours. Tier 1 interactive views remain next.
- **Status (orig):** Proposed. Inventories which substrate types/tools warrant a `ui://` renderer (ADR-0034/0035),
  and defines what the **conversational view** of each should be: a *glanceable, progressive* projection —
  never the full dataset — that **expands interactively in the widget** (host-proxied `tools/call`/
  `resources/read`) without flooding the model's context. Grounds the build by reusing the existing renderer
  providers (`viewers` cell, `_renderers/<type>` facts, `present.render.viewer`) rather than inventing new.
- **Date:** 2026-06-26
- **Depends on:** ADR-0033 (overview-first / progressive disclosure — the model-facing half), ADR-0034 (the
  conversation surface + the card as the single `read`-bound renderer + host-proxied interactivity),
  ADR-0035 (`ui://` as the universal render resource; the shared `platform/ui` render core), ADR-0002/0012
  (`present`/`handlers`), ADR-0005 (collections), ADR-0018/0019 (machines).

---

## The principle: progressive + interactive

ADR-0033 made the *model's* default read succinct. The conversational widget extends that to the *human's*
view, and adds something a static render can't: **the widget is an MCP client to the host**, so "show more"
is a `tools/call`/`resources/read` it issues itself — it expands **in place, without a new model turn and
without adding tokens to the model's context.** So the conversational view should:

1. **Open glanceable** — a summary + the top-N decision-relevant items + affordances. Never the whole set.
2. **Expand interactively** — "more" / "open" / an action button calls a host-proxied tool; the widget
   re-renders. The model keeps the lean overview (ADR-0033); the human drills in the widget. Progressive
   disclosure becomes *live*, and the two audiences (model, human) get the projection each needs.
3. **Act in place** — for review/triage/ratify surfaces, the primary action (ratify, review, touch, link)
   is a button → host-proxied `act` → our existing `enforceScope`/slice-isolation (ADR-0034). Widget-only
   actions can use `visibility:["app"]` tools.

## Two binding paths (from the 3-tool constraint, ADR-0034)

The gateway exposes only `read`/`act`/`whoami`; cell capability is a `target`, not a distinct MCP tool. So
the single card bound to `read` is the renderer, and it dispatches two ways:

- **Per-type (fact lists):** `recall`/`query`/`neighbors`/`peek` return typed facts; the card renders each by
  its type's `present.render` (hint, or a `ui://` renderer — ADR-0035 Inc D). *Reuse the `viewers` cell:*
  expose its `json`/`csv`/`mermaid`/`style` viewers and `_renderers/<type>` (e.g. `_renderers/machine`) as
  `ui://` resources the card fetches. No new renderers — surface the existing ones.
- **Per-shape (tool-result structures):** `suggestions`/`attention`/`stats`/a machine run return *shapes*,
  not typed facts. The card dispatches on a small **`_view` hint** the result carries (e.g. `_view:
  "suggestions"`) to a compact, progressive layout — the generalization of the card's existing special-cases
  (`overview`, `whoami`). A result opts in by adding `_view` (additive; absent ⇒ generic render).

## Candidate inventory (grounded in `$cells` + `$types`)

**Tier 0 — already handled by the shared hint floor (markdown); no bespoke `ui://` needed.**
`@c15r/home`'s knowledge set (`knowledge`/`decision`/`project`/`question`/`concept`/`pattern`/`protocol`/
`source`/`reading`/`prompt`/`todo`/`bug`/`fixed`/`shipped`), `file`, `doc`/`doc-block`, `capture`, `note` —
all `render: markdown`. The card (ADR-0035) renders these with real `marked` today.

**Tier 1 — interactive tool-result views (`_view` dispatch). Highest operational value.**
1. **`workspace.suggestions`** → a **ratification queue**: top-N pairs by cosine, each with `refines/grounds/
   duplicates/…` chips → a **ratify** button (`act workspace.ratify`). Directly completes ADR-0032 + ADR-0034
   Inc 3. Progressive: top-N + "more".
2. **`workspace.attention`** → a **tending triage**: stale/unlinked/dangling counts + samples, with
   touch/link/supersede actions. Turns the just-in-time cron into a do-it-here panel.
3. **`@c15r/regwatch.stats` + `list_items`** → the **review inbox** (≈286 unreviewed live): a dashboard
   (by status/source/category) + a triage queue with a **review** action. The biggest real operational
   surface in the workspace.

**Tier 2 — bespoke type renderers, mostly by exposing `viewers`.**
4. **`machine` / `machine-run`** → a **DyGram visualizer**: the node/rail graph as **mermaid** (the viewer
   exists), with the run's current node + `trace` path highlighted. `machine` already declares
   `_renderers/machine` — expose it as `ui://`.
5. **`json` / `csv` / `mermaid` typed facts** → the `viewers` tree/table/diagram as `ui://` (direct reuse).
6. **`workspace.graph` / `neighbors`** → the Reference graph (mermaid or the existing D3 force view) — open
   glanceable (one hop), expand on demand.
7. **`claim`** → a confidence + evidence widget (`{statement, confidence, support[]}`) — confidence bar +
   support links; richer than the `fields` hint.

## Recommendation / build order

Lead with **Tier 1** — it delivers the interactive, progressive payoff (and exercises ADR-0034 Inc 3's
host-proxied `act` end to end) on the surfaces with real daily value: **`suggestions` ratify queue**, then
**`regwatch` review inbox**, then **`attention` triage**. In parallel, the cheap structural win is **Tier 2
#4/#5** — expose the `viewers` cell + `_renderers/machine` as `ui://` (the ADR-0035 Inc D *provider* hop:
the gateway fetches a `viewers`-served renderer, version-cached), since it's reuse, not new UI.

## Open questions

- **`_view` hint placement** — on the tool result (`_view`), or derived from the target name? A result-carried
  `_view` is explicit + lets cells opt in; keep it additive.
- **Interactive re-render** — does the card re-issue the *same* `tools/call` with a larger `limit`/`cursor`, or
  a dedicated `expand`? Re-issuing the existing read is simplest and reuses paging.
- **viewers-as-`ui://`** — the gateway fetches a `viewers`-served renderer for the provider hop; cache by cell
  version (ADR-0035 open question). Confirm the `viewers` build can emit a self-contained MCP-App profile.
- **Trust** — every widget action is an `act`/`read` through the host proxy under `enforceScope`; no new
  authority. `visibility:["app"]` for widget-only actions (e.g. a "decline suggestion" that shouldn't clutter
  the agent's tool list).
