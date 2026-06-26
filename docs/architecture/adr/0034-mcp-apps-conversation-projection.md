# ADR-0034 — MCP Apps (`io.modelcontextprotocol/ui`): the conversation as a projection surface

- **Status:** Proposed (research complete; not yet built). **Decision spine: tiered.** A generic
  gateway-served widget is the **floor** — any type with a `present.render` hint (markdown/metric/fields/
  table) gets a basic interactive card for free, rendering the tool result's `structuredContent`. A cell
  can **override** with a bespoke `ui://` surface it serves itself (reusing its existing `embed` handler /
  cell-iframe). This mirrors the existing renderer ladder (built-in hint → `_renderers/<type>` → cell
  element) and the "one declaration, many projections" invariant — MCP Apps is simply a **sixth projection
  surface**: the conversation.
- **Date:** 2026-06-26
- **Depends on:** ADR-0002 (type-as-one-object — `present`/`handlers` facets), ADR-0004 + ADR-0012
  (projection pipeline; the `present`/affordance stage), ADR-0008 (cell axis + origin isolation — the
  sandbox model), ADR-0029 (inline affordances on reads), ADR-0033 (overview/`structuredContent` split —
  text-for-model vs data-for-widget). Grounded in `docs/substrate.md` (the thesis), `docs/mcp-spec-alignment.md`
  (the gap this closes), `docs/canvas-substrate-design.md` (the renderer ladder).

---

## Context — what MCP Apps is

**MCP Apps** (the `io.modelcontextprotocol/ui` extension, standardized 2026-01-26) lets an MCP server
return interactive UI alongside a tool result. The wiring:

- a tool result carries `_meta.ui.resourceUri` → a `ui://…` resource;
- the host fetches it via `resources/read` and renders the returned `text/html;profile=mcp-app` in a
  **sandboxed iframe** in the conversation;
- the result has **three channels**: `content` (text the *model* reasons over), `structuredContent` (data
  the *widget* renders), and host-hidden data (large/sensitive, widget-only);
- the iframe talks back to the server over a `ui/`-prefixed JSON-RPC dialect (can trigger further tool
  calls / push to the model's context).

The exact field names above are from the recent spec and **must be verified against the live
`io.modelcontextprotocol/ui` schema before implementation** (the design here is robust to naming drift).

## Why this is thesis-native, not a bolt-on

The substrate's founding claim (`docs/substrate.md:75–82`):
> "State is primary reality; the UI is a projection of it." … "The UI and the API converge — a button for
> a human and a JSON affordance for an agent are the same surface expressed through different modalities …
> **two renderers of one declaration**."

MCP Apps is *exactly* a second renderer of an existing declaration. The substrate already projects one
state through five surfaces — **canvas** (spatial), **narrative/lit** (sequential), **home** (cards),
**SSR** (HTML snapshot), and the **MCP/agent** JSON surface (`canvas-substrate-design.md:30–54`,
`narrative-surface.md:18–29`). MCP Apps adds a **sixth: the conversation** — and it is the one surface
where the thesis's "humans and agents are equivalent participants, distinguished only by the modality of
their observation" becomes literal, because the conversation is where both meet.

It also lands on machinery that already exists:

1. **`present` + `handlers` already declare rendering** (ADR-0002; `platform/runtime/type-schema.ts`,
   `platform/runtime/present.ts`, `platform/ui/vocab.ts`). A type's `present.render` carries
   `{hint, renderer, embed}`; `handlers` maps intents (`open|edit|create|render|embed|preview`) to
   `{path|surface|act|renderer|hint}`. A fact → UI is resolved by the pure `resolve(fact, intent, decls)`.
2. **The renderer ladder already tiers generic→bespoke** (`canvas-substrate-design.md:30–54`): built-in
   hint (markdown/metric/…) → `_renderers/<type>` fact → cell-element iframe. The tiered decision below
   *is* this ladder, projected to the conversation.
3. **Cells already serve HTML and are origin-isolated** (`services/cells`, `cell-origin-isolation.md`):
   home/machine/canvas server-render via `renderToString` and are served at `/@<owner>/<name>/` and
   `/@<owner>/<name>/_data/<user>/public/<key>`. The HTML-serving + sandbox infrastructure MCP Apps needs
   already exists.
4. **ADR-0033 already split the channels.** The bare-`recall` overview (text for the model) vs the full
   data is the same text-vs-`structuredContent` split MCP Apps wants — the model reads the succinct
   overview, the widget renders the structured data. The two threads converge.

The far-reaching consequence: because rendering is **declared on the type and resolved by a pure
function**, *no per-tool UI code is needed*. The moment a type carries a render hint or an `embed` handler,
**every** read returning facts of that type — `recall`, `query`, `neighbors`, `graph`, `attention`,
`suggestions`, `@c15r/machine.step`, `@c15r/regwatch.*` — can attach a widget. One declaration, every
surface; the CALM invariant applied to the conversation.

## Feasibility (grounded in the gateway code)

The MCP server is **hand-rolled JSON-RPC 2.0, no SDK** (`platform/runtime/define-mcp-service.ts`,
protocol `2025-06-18`). It dispatches exactly `initialize`/`ping`/`tools/list`/`tools/call`; everything
else returns `-32601`. Today:

- the handshake declares `capabilities: { tools: {} }` (`define-mcp-service.ts:164`) — additive room for
  `resources` + the ui capability;
- tool results are **text-only**: `toContent` returns `{ content: [{ type:'text', text }] }`
  (`define-mcp-service.ts:128–131`); no `structuredContent`, no `_meta` passthrough;
- there is **no `resources/list` / `resources/read`** and no `ui://` notion.

`docs/mcp-spec-alignment.md:62–98` already names this gap: Resources and `structuredContent` are flagged
as "the best natural fit we are not using … low cost to add." So this ADR executes a sanctioned, already-
scoped direction.

**Cost (from the deep-dive):** declare the capabilities (~4 lines); add `resources/read` dispatch +
URI→resource resolver (~100–125 lines); `structuredContent` + result-schema validation in `toContent`
(~50–100 lines). Non-invasive and additive to the existing three tools.

**Honest constraint (no live push):** Function URLs behind CloudFront can't hold an SSE/GET stream (~30s
edge cap), so `resources/subscribe` and server→client notifications are **out of scope** — widgets are
request/response. Live updates come from the substrate-native substitute: the widget polls
`workspace.changes` (`sinceSeq:"head"`) or re-invokes its tool. (Same constraint that shaped async
reindex and `models`/`run` polling.)

## Decision — tiered (`Both`)

A type's rendering on the conversation surface resolves down the same ladder it uses everywhere else; no
new type vocabulary is required for either tier — both reuse existing facets:

- **Tier 0 — generic gateway widget (the floor).** For any type whose `present.render.hint` is set
  (`markdown`/`metric`/`fields`/`table`/`feed`), the gateway serves a single generic
  `ui://parc/render/<hint>` widget that renders the tool result's `structuredContent` using that hint —
  the exact `HintBody` logic the home cell already uses (`cells/home/client/app.tsx`), lifted into a
  shared, isomorphic widget. Zero per-cell work: every hinted type gets a basic interactive card for free.
- **Tier 1 — cell-served bespoke widget (the override).** A type's **existing `handlers.embed`** (a cell
  surface URL — already "render this type as a cell iframe") *is* its bespoke widget. The gateway maps
  `ui://<owner>/<cellId>/<path>` onto the cell's existing HTTP route and lets the cell serve its own
  `text/html;profile=mcp-app`. The managing cell owns the rich rendering — consistent with "the manager
  owns rendering" — so `graph`, `machine.step`, `regwatch` widgets are authored once and reused across
  home, canvas, and conversation.

The gateway, when a tool result's facts are of a type with a widget binding, attaches
`_meta.ui.resourceUri` (tier-1 cell route if `embed` is declared, else the tier-0 generic hint widget) and
the `structuredContent` payload. The model still gets the ADR-0033 text overview in `content`.

This is deliberately **the renderer ladder, not a new mechanism**: tier-0 = built-in hint, tier-1 = cell
element. A future `_renderers/<type>`-served widget (between the two) is a natural middle rung if wanted.

## Increments (proposed)

- **Inc 0 — `structuredContent` + capability + schema validation (enabler, independently useful).** In
  `define-mcp-service.ts`: declare `capabilities.resources` + the ui capability in `initialize`; extend
  `toContent` to emit `structuredContent` (and validate against the tool's advertised `resultSchema`,
  closing the "advertise shapes we violate" gap from `mcp-spec-alignment.md`). No UI yet — but every MCP
  client immediately gets structured results. Smallest, safest, reversible.
- **Inc 1 — `resources/read` + the tier-0 floor widget.** Implement `resources/read` + a `ui://` resolver;
  ship one generic `ui://parc/render/<hint>` widget (markdown/metric/fields) that renders
  `structuredContent`. Wire **one** read (the `recall` overview, or `query`) to attach `_meta.ui.resourceUri`.
  Validate it renders in claude.ai (trusted-connector path).
- **Inc 2 — tier-1 cell override.** Map `ui://<owner>/<cellId>/<path>` → the cell's HTTP route; expose a
  type's `handlers.embed` as its widget. Author one bespoke widget (the `$graph` force-directed view is the
  obvious first — the D3 dashboard already exists) and one actionable one.
- **Inc 3 — widget→server callbacks (interactive).** Adopt the `ui/` JSON-RPC dialect so a widget can call
  `act()` (e.g. `attention` triage "touch"/"link"; `suggestions` "ratify"; a machine rail pick) — bounded
  by no-SSE: request/response + poll `workspace.changes` for updates. Scope enforcement and cell-origin
  isolation must hold across the iframe boundary (a widget callback is an `act` like any other and goes
  through the same `enforceScope`).

## Open questions / risks

- **Spec maturity + field names.** `io.modelcontextprotocol/ui`, `_meta.ui.resourceUri`,
  `text/html;profile=mcp-app` are recent; verify against the live spec and the claude.ai client's actual
  negotiation before Inc 1. Keep the binding indirection (type → `ui://`) so renames are localized.
- **Client support.** Rendering is "verified for trusted connectors"; confirm what claude.ai negotiates and
  degrade cleanly (the model always gets the text channel, so a non-supporting client loses nothing).
- **Security across the iframe.** A widget callback can mutate — it must traverse the same gateway
  `enforceScope`/slice-isolation as any `act`, and the iframe stays sandboxed + cell-origin-isolated. No
  ambient authority leaks into the widget.
- **When a widget vs. text.** ADR-0033 says the model's default should be succinct; a widget must not
  *replace* the model-facing summary, only accompany it. Attaching a widget is additive, never a substitute
  for the text channel.
- **No live push.** Accept request/response + polling; revisit only if the transport moves off Function
  URLs (same note as `mcp-spec-alignment.md`).

## Non-goals

Replacing the home/canvas/lit cells (they remain the primary human surfaces); `resources/subscribe` or
server→client streaming (infra-constrained); a bespoke widget for every type (the tier-0 floor covers the
long tail; cells opt into tier-1 where it pays).
