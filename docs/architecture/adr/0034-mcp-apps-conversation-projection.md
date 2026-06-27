# ADR-0034 — MCP Apps (`io.modelcontextprotocol/ui`): the conversation as a projection surface

- **Status:** Accepted — **Inc 0–1 shipped and CONFIRMED RENDERING in claude.ai** (2026-06-26: a bare
  `whoami` renders the `ui://parc/card` widget — `parc.land` header + identity card, not JSON). Inc 0:
  `structuredContent` on object results. Inc 1: `capabilities.extensions["io.modelcontextprotocol/ui"]`
  (with `mimeTypes`), `resources/read`/`resources/list`, the generic tier-0 `ui://parc/card` widget (which
  does the spec `ui/initialize`→`initialized`→`tool-result` handshake), and the STATIC tool→UI binding on
  the tool *definition* (`_meta.ui.resourceUri` in `tools/list`). 486 tests. **Decision spine: tiered** —
  a generic gateway-served card is the **floor** (renders any read's `structuredContent`); a cell can
  **override** with a bespoke widget. The renderer ladder (built-in hint → `_renderers/<type>` → cell
  element), now projecting to a **sixth surface: the conversation.**
- **Security model (verified, spec 2026-01-26) — load-bearing:** the View runs in a **sandboxed iframe on
  a separate/opaque origin**, NOT `parc.land` and NOT the host ("Host and Sandbox MUST have different
  origins"). The host fetches our HTML via `resources/read` (server-to-server, the connector's bearer) and
  renders the *content* in that sandbox. The widget has **no ambient parc.land session** and cannot reach
  our domain directly (default CSP `connect-src 'none'`; **nested iframes back to the server's own origin
  are forbidden** — `frame-src 'none'`). Instead the widget is an MCP client to the **host**, calling
  `tools/call`/`resources/read` over `postMessage`; the **host proxies these to our gateway with the
  connection's auth**, so our existing `enforceScope`/slice-isolation runs unchanged on every widget
  action. Tools may be `visibility:["app"]` (callable by the widget, hidden from the agent). **Consequence:
  the original tier-1 "iframe the live cell surface" was retracted as spec-invalid** — a bespoke cell
  widget is self-contained HTML served as its own `ui://` resource (interactivity via the host `tools/call`
  proxy), exactly like the card, just cell-authored.
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

**Verified wire contract (ext-apps spec `2026-01-26`), correcting a first pass that didn't render:**
- **Capability** is nested: `capabilities.extensions["io.modelcontextprotocol/ui"] = { mimeTypes: ["text/html;profile=mcp-app"] }` — NOT a top-level capability key.
- **Tool→UI binding is STATIC on the tool *definition*** in `tools/list` (`_meta.ui.resourceUri` + `visibility`), so the host can *preload* the widget — NOT on the call result.
- **The iframe must handshake first:** send `ui/initialize` → on the response send `ui/notifications/initialized` → only then does the host push `ui/notifications/tool-input` and `ui/notifications/tool-result` (carrying `content` + `structuredContent`). *"The Host MUST NOT send any notification to the View before `initialized`."* (A first pass that skipped this handshake got no data and rendered nothing.)
- `resources/read` returns `{ contents:[{ uri, mimeType:"text/html;profile=mcp-app", text, _meta?:{ ui:{ csp, permissions, … } } }] }`. Iframe→host `postMessage` uses `targetOrigin:"*"`.

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

- **Inc 0 — `structuredContent` (shipped).** `toContent` (`platform/runtime/define-mcp-service.ts`) now
  mirrors an object result as `structuredContent` alongside the text block — every MCP client gets
  structured results. Independently useful; the data channel widgets consume.
- **Inc 1 — capability + `resources/read` + tier-0 floor widget (shipped).** `defineMcpService` gained a
  `capabilities` merge + a `resources` provider; the handshake declares `resources` + (gateway)
  `io.modelcontextprotocol/ui`; `resources/read`/`resources/list` are answered. The gateway serves a generic
  `ui://parc/card` widget (`services/gateway/widgets.ts`) that renders a read's `structuredContent` (tuned
  for the `recall` overview: bands + type/prefix breakdowns + focus list; JSON fallback). A per-tool `ui`
  hook (MCP-path only — the raw command stays plain, so internal callers are unaffected) binds every object
  `read` result to the card via `_meta.ui.resourceUri`. A rich-result envelope (`mcpResult(data,{text,ui})`)
  splits the text/data/ui channels explicitly.
- **~~Inc 2 — tier-1 cell shim~~ (RETRACTED — spec-invalid).** The first pass had
  `ui://cell/<owner>/<name>/<path>` iframe the live cell surface; the sandbox forbids framing the server's
  own origin and has no parc.land session, so it could never render. Removed. The correct tier-1 is below.
- **Inc 2′ — type-vocab-driven card (shipped) + bespoke cell renderers (consumer shipped).** A subtlety
  the 3-tool design forces: MCP-Apps binds a widget *statically per tool* in `tools/list`, but parc exposes
  only `whoami`/`read`/`act` and **every cell capability is a `target` inside `read`/`act`, not a distinct
  MCP tool** — so there is no per-target or per-cell-tool binding. The single platform card bound to `read`
  is therefore *the* renderer, and it resolves per-type rendering at runtime: (a) it reads each fact's
  inline `types` affordances (ADR-0029 — already on results) and renders by the declared `present.render`
  hint (markdown/code/metric/fields/image — mirroring the home cell's `HintBody`), so new types render with
  **no gateway deploy**; (b) when a type declares `handlers.render[].renderer` as a `ui://…` resource, the
  card fetches it over the host `resources/read` proxy and injects it (falling back to the hint render).
  The card-side consumer + convention are shipped; the remaining hop is the gateway serving a *cell-authored*
  renderer (fetching the cell's HTML server-side) — not yet wired (no cell declares one). NB: the earlier
  "propagate a cell tool's `_meta.ui`" idea does **not** apply here — parc has no per-cell MCP tools.
- **Inc 3 — interactive widgets (now spec-native, unblocked).** The widget calls `tools/call`/`resources/read`
  over `postMessage`; the **host proxies to our gateway with the connection's auth**, so a widget button
  (`attention` "touch"/"link", `suggestions` "ratify", a machine rail pick) is an `act` through the same
  `enforceScope`/slice-isolation — no new auth surface. Widget-only actions can use `visibility:["app"]`
  tools. No-SSE only limits *server push*; widget-initiated calls + polling `workspace.changes` cover updates.

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
