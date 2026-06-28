# ADR-0039 — Federate the conversational render surface: cells author renderers, the gateway serves them

- **Status:** Accepted — **the provider hop + first federated renderer shipped.** The gateway now
  resolves a cell-authored renderer URI (`ui://@<owner>/<name>/<path>`) by fetching the owning cell's
  served asset server-side (`services/gateway/widgets.ts` `resolveCellRenderer` → `cells.call` GET,
  per-URI TTL cache); the card consumer (`services/gateway/client/main.ts` `fetchRenderer`) injects the
  fetched renderer script and runs it against the fact value with a small host API. The **`machine-run`
  trace diagram — formerly hardcoded in the gateway card — now lives in the machine cell**
  (`cells/machine/index.ts` serves `/renderers/machine-run.js`; `cells/machine/types.json` declares
  `handlers.render[].renderer = ui://@c15r/machine/renderers/machine-run.js`) and reaches the conversation
  over this rail. 487 tests (the loop is unit-proven via `cells.call`; the consumer's inline-script
  injection under the live host CSP is the remaining claude.ai verification — see Risks).
- **Status (live validation, 2026-06-28):** **Deployed branch-head to prod and validated the federation rail
  end-to-end, server-side.** CDK deploy of the gateway (`deploy.yml` workflow_dispatch on the branch) +
  `cells.deploy @c15r/machine` (via `scripts/cell-sync.mjs`, token minted with `auth.mintToken`). Checkpoints
  **A** `$types` federates `machine-run.handlers.render[0].renderer = ui://@c15r/machine/renderers/machine-run.js`;
  **B** the cell serves the asset (200, `application/javascript`, ACAO:*); **C** the deployed gateway's
  provider hop resolves `resources/read` of that `ui://`; **D** a real `machine-run` read inlines the
  affordance. **The money-shot:** bumping the renderer's `BUILD` sentinel `v1→v2` and running `cells.deploy`
  **alone — no CDK** — flipped the gateway-served resource to `v2`. Rendering now changes through the cell
  plane. A **second renderer** (the `machine` *definition* card — interactive: it fetches its nodes/rails over
  the host-proxied `api.call`) was added, which surfaced the spine/renderer boundary below. The one remaining
  step is the in-host visual (claude.ai), which the `v1/v2` footer badge makes conclusive (the badge is
  emitted *only* by the cell renderer; the card's hardcoded path was deleted).
- **Date:** 2026-06-27
- **Depends on:** ADR-0034 (the conversation surface; the single `read`-bound card; host-proxied
  `resources/read`/`tools/call`), ADR-0035 (`ui://` as the universal render resource — this builds its
  named-but-unbuilt **Inc D provider hop**), ADR-0036 (progressive widgets; viewers-as-`ui://`), ADR-0029
  (per-type affordances inlined on reads), ADR-0008 (cell axis / origin isolation), ADR-0002 (`present`/
  `handlers`). Vision: composable React, MCP-native, **cell-encapsulated**.

---

## The finding: five increments of centralisation

ADR-0034→0038 built the conversational `ui://` surface, and every increment landed in **one file** —
`services/gateway/client/main.ts`, the platform card, bundled into the **CDK-deployed** gateway
(`lib/platform-stack.ts` `GatewayService.clientEntry`). That file grew to ~690 lines and accreted
knowledge that belongs to *cells*, not to the gateway-as-projector:

- 7 → ~22 result-shape branches (`overview`/`whoami`/`suggestions`/`attention`/`grantRequests`/`changes`/
  `grants`/`members`/`$catalog`/`$types`/…);
- the **`machine` cell's** `machine-run` → mermaid trace, hardcoded as a card special-case;
- the **`viewers` cell's** json/csv/mermaid modules, **build-time imported** into the card bundle;
- D3 force graph, the **lit cell's** wiki-link resolver, the **lit cell's** doc-block assembly,
  `enforceScope`'s escalation parsing.

Each is a thing a cell owns, living in the platform bundle, changeable only by `cdk deploy`. The gateway's
own stated role — *"a thin projector … it does not own rendering logic"* (ADR-0035 §4) — had quietly
inverted: it had become the renderer for the whole substrate. This is the "tier-1 coupling" the work drifted
into; the iteration was fast precisely *because* the card is one bundle the platform controls, so the
low-friction move (another branch in the card) won five times in a row.

## The rail was 90% built and dormant

The federated path the ADRs kept *describing* already existed end-to-end except for **one hop**:

| Rail | Before this ADR |
|---|---|
| Cells publish their own type vocabulary (manifest `types[]`) | ✅ `cells/*/types.json` |
| `cells.describeTypes` **federates** them into `$types` across all cells | ✅ `services/cells/service.ts` |
| Reads inline each type's `handlers.render` affordance (ADR-0029) | ✅ `services/workspace/handlers.ts` |
| A type can declare `handlers.render[].renderer = "ui://…"` | ✅ schema already allowed it |
| The card **consumer** fetches a `ui://` renderer over the host proxy | ⚠️ stub — `innerHTML` only (scripts don't run, no data passed) |
| The gateway **provider** serves a *cell-authored* `ui://` | ❌ `resolveUiResource` returned `null` for anything but `ui://parc/card` |
| Any cell actually declares a renderer | ❌ none did |

The last three were a chicken-and-egg: no cell declared a `ui://` renderer because the gateway couldn't
serve one, and the consumer was a non-functional stub, so the only way to make anything render richly was
to add it to the card. ADR-0035 Inc D and ADR-0036 both *named* the provider hop ("the remaining hop is the
**provider**… not yet wired") — it just never got built.

## Decision — build the rail, then move rendering to the cells that own it

1. **Provider hop (gateway).** `resolveUiResource(uri, ctx)` resolves `ui://@<owner>/<name>/<path>` by
   fetching the owning cell's served asset server-side — over the *same* `cells.call` invoke the gateway
   already uses to forward `@owner/cell.tool`. The serving cell decides what to return (a renderer script,
   HTML, …); the gateway passes its content-type through and caches per-URI with a short TTL (a cell-version
   cache key is the ADR-0035 follow-up). `ui://parc/card` stays the platform floor, served from the bundle.
2. **Consumer (card).** A cell renderer is a self-registering **classic script** that adds itself to a
   shared `window.__parcRender[<type>]` map. The card fetches it once over the host `resources/read` proxy,
   injects it as an inline `<script>` (the *same* `script-src` the inlined card itself relies on — no
   `eval`, no ES-module, no nested iframe, all of which the MCP-Apps sandbox forbids), then calls
   `__parcRender[type](host, value, api)` with the fact value and a small host API
   (`{ call, esc, md }` — `call` is the host-proxied `read`/`act`, so cell renderers get in-card
   interactivity under our `enforceScope` for free). Any failure (offline, CSP, cell down) **degrades to the
   type's render hint** already painted in the slot.
3. **First federated renderer (machine cell).** The `machine-run` trace→mermaid diagram moves out of the
   card into `cells/machine` (served at `/renderers/machine-run.js`, ACAO:* + cacheable — it is
   non-sensitive static renderer code; data arrives via host-proxied tool calls, never embedded). The type
   declares `render: [{ renderer: "ui://@c15r/machine/renderers/machine-run.js" }, { hint: "fields" }]`. The
   card's hardcoded `machine-run` branch is **deleted** — the diagram now arrives federated, and changing it
   is a `cells.deploy`, not a `cdk deploy`.

This is the renderer contract canvas/lit/home already consume (the ElementView `mount` shape), now reaching
the conversation: **one renderer authored by its type's cell, projected to every surface** — the CALM
invariant the prior ADRs invoked but couldn't actually satisfy while the renderer lived in the gateway bundle.

## Consequences & trade-offs

- **Two deploy planes, correctly used.** Rendering changes move to the runtime cell plane
  (`cells.deploy`); the gateway returns to being a thin projector. The boundary ADR-0034 drew is now real.
- **The card shrinks toward its true job:** the generic hint floor + per-*shape* (`_view`) dispatch for
  tool-result *structures* (inbox/registry/graph/escalation — genuinely gateway-level), delegating per-*type*
  rendering to the owning cell. (Migrating the remaining centralised pieces — `viewers` as `ui://`, the lit
  wiki-link/doc assembly — is follow-up work, now unblocked.)
- **Latency:** a federated renderer costs one extra host-proxied `resources/read` (and a cold cell invoke on
  cache miss). The TTL cache and the immediate hint-render placeholder keep the surface responsive.
- **Security unchanged.** The renderer is non-sensitive static code; live data + interactivity still flow
  through the host `tools/call`/`resources/read` proxy under `enforceScope`. The provider hop authorises via
  the same `cells.call` access check as any cell reach.

## The spine vs. the renderers — what is tier1, what is tier2

The live validation exposed the real boundary (it's not "rendering = tier2, full stop"). Adding the second
renderer — the `machine` *definition* card — **still needed a CDK deploy**, and the reason names the rule:

- **Renderers are tier2.** Authoring or changing a per-type renderer is a `cells.deploy` — proven by the
  `v1→v2` money-shot. This is the federation ADR-0039 delivers.
- **The spine is tier1.** The *contract* between the card (host) and a renderer — the function signature
  `fn(host, value, api)` and what `api` carries — lives in the gateway bundle. The machine-definition
  renderer is *decomposed* (its nodes/rails are separate facts), so it must fetch its children, which needs
  the fact **`key`** — and the v1 spine didn't pass `key`. Extending `api` with `key` is a gateway change.

That split is correct and healthy: the spine is the thin, stable protocol; the renderers are the open,
federated population on top of it. **But** the machine-definition card *should* have been tier2-only — it was
tier1 here only because the v1 spine was under-specified. The lesson, made a decision below: **specify a
generous, stable renderer API up front**, so the common case (new per-type renderers) never touches tier1.
Each spine extension is a one-time platform cost that unlocks a whole *class* of tier2 renderers; the goal is
to need them rarely.

## Decision — the renderer API contract (stable, generous)

A cell renderer is a self-registering classic script that adds `fn(host, value, api)` to `window.__parcRender`
under a **render key** (the fact type for type renderers; an explicit name for tool renderers — below). To
minimise future tier1 churn, the `api` is frozen broad now:

```
api = {
  call(kind, target, input)  // host-proxied read/act under enforceScope — fetch children, act in place
  key                        // the fact's substrate key (decomposed renderers fetch by prefix)
  meta                       // the fact's _meta (salience, type, provenance)
  esc(s), md(s)              // shared escapers/markdown so renderers don't re-bundle
  surface                    // "conversation" — lets one renderer adapt across surfaces later
}
```

Renderers read only what they need; adding a *field* is backward-compatible (old renderers ignore it), so the
contract can grow without breaking deployed cells — but the aim is to seed it wide enough that it rarely must.

## Risks / open questions

- **Inline-script injection under the live host CSP (the one unproven hop).** The consumer relies on the
  host permitting a dynamically-inserted inline `<script>` — the same `script-src 'unsafe-inline'` the card's
  own inlined bundle already needs. If a host instead pins a per-load **nonce**, injected scripts without it
  are blocked and the renderer degrades to the hint. This must be verified on claude.ai (consistent with the
  prior ADRs' "verify against the live client" discipline); if nonces bite, the fallback is a host-rendered
  per-type `ui://` widget (blocked today by the 3-tool single-card binding, ADR-0034 Inc 2′).
- **Renderer asset visibility.** `cells.call` GET authorises owner-or-granted; renderer assets are arguably
  world-readable like `viewers`' `app.js` (ACAO:*). Fine in a single-user workspace; a "public renderer
  asset" gate is a small follow-up for shared cells.
- **Cache key.** Per-URI TTL now; key by cell version (ADR-0035 open question) once `cells.call` can report it.

## Increments

- **Inc 1 — provider hop + consumer + first renderer (shipped + live-validated).** This ADR. `machine-run`
  federated; card special-case removed; unit-proven via `cells.call`; deployed + the `v1→v2` money-shot.
- **Inc 1b — second renderer: the `machine` *definition* card, interactive (shipped).** Proved the pattern
  generalises and that a renderer can be *decomposed* — it fetches its nodes/rails over `api.call` and
  assembles the graph. This is also what surfaced the spine/renderer boundary + the `key` spine extension.
- **Inc 2 — federate `ui://` for cell TOOLS, not just types (designed; the answer to "beyond type
  renderers").** Today only *fact types* bind a renderer (`handlers.render`). A cell tool (`@owner/cell.tool`,
  invoked via `act`/`read`) returns a *structure*, and rich rendering of that result is still card-side
  (`_view` shape dispatch). Federate it the same way:
  1. **Declare on the tool.** A cell's tool descriptor (its `_tools` manifest, surfaced via
     `cells.describeCellTools`) gains an optional `ui: { renderer: "ui://@owner/cell/renderers/foo.js", as?:
     "<renderKey>" }` — the per-tool analogue of `handlers.render`, and of MCP-Apps' static per-tool
     `_meta.ui.resourceUri` (which parc can't use directly: 3 tools, one card, so the binding can't live in
     `tools/list`).
  2. **Gateway stamps the result.** When the gateway forwards `@owner/cell.tool`, it already has the
     descriptor (dispatch resolves it); if it declares a renderer, attach a result-level directive
     `_render: { renderer, as }` to the envelope (beside `structuredContent`). No per-tool MCP binding needed —
     the declaration is static on the tool, the *delivery* is on the result.
  3. **Card runs it — same consumer.** `render()` checks for a top-level `_render` directive *first*; if
     present, `fetchRenderer(renderer, slot, as, wholeResult, key)` — the identical `__parcRender` registry +
     injection path as type renderers, just keyed by `as` and handed the whole tool result as `value`. Absent
     ⇒ today's shape/type dispatch. This unifies type renderers and tool renderers into one mechanism; the
     only deltas are the *trigger* (fact type vs. result directive) and the *value* (a fact vs. the result).
  - **Spine cost:** one tier1 change (the `_render` directive: gateway attach + card dispatch). After it,
     *any* cell tool gets a bespoke conversational renderer by a cell deploy — the type-renderer win, extended
     to the verb surface. Visibility/security unchanged (the renderer is static code; data + actions still go
     through the host proxy under `enforceScope`; `visibility:["app"]` tools can drive widget-only flows).
  - **Correction (caught in review): `act` must itself be widget-bound.** The first Inc 2 pass stamped
    `_render` on results but left a hole — most cell tools (incl. `define_machine`) are `kind:"act"`, invoked
    via the **`act`** MCP tool, and `act` had **no `_meta.ui.resourceUri`** in `tools/list` (only `whoami`/`read`
    did). `toContent` returns `structuredContent` for every tool, but the host renders a widget only for a tool
    that declares the static binding — so an act result's renderer had the data but no shell to fire in. Fix:
    bind the card to `act` too (`tools.act.ui = { resourceUri: CARD_URI }`). The card hosts mutation results
    additively (never replacing the model's text). Lesson: the `_render` data path and the **tool's widget
    binding** are two separate requirements; a tool renderer needs both. (Headless validation of the stamp was
    necessary but not sufficient — it proved the data, not that a widget fires.)
- **Inc 3 — `viewers` as `ui://`.** Serve the json/csv/mermaid viewers as cell-authored renderers and drop the
  card's build-time import — the biggest single decoupling, pure reuse.
- **Inc 4 — lit's wiki-link resolver + doc assembly federate** (or consolidate into `platform/ui` as the
  shared, dependency-free floor — the ADR-0035 `render-hints` pattern), removing the lit-specific logic from
  the card.
- **Inc 5 — per-shape `_view` stays gatewayside; audit what else in the card is actually cell-owned.**
