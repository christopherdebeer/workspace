# ADR-0041 — Federate the field computer: forms as the human projection of `inputSchema`

- **Status:** Inc 1 shipped (2026-06-30). ADR-0039 federated the **output** half of the render surface (`ui://`
  renderers consumed by the conversation card). The **field computer** — the home console where a human drives
  the *same read/act wire an agent does* — never joined it: it renders results as raw `JSON.stringify` and
  takes args as a raw-JSON textarea. This ADR makes the field computer a federated-render *consumer* (output)
  **and** names the symmetric missing half: a capability's `inputSchema` is a declaration the agent fills as
  JSON and the human should fill as a **form** — the input twin of `ui://` rendering.
- **Security correction (load-bearing, caught before ship):** a federated renderer may be authored by ANY cell
  the caller can reach — including another tenant's (`@alice/notes`), not just the caller's own — so it is
  untrusted code by construction. The card is safe injecting it directly only because the *whole card* already
  runs inside claude.ai's sandboxed, opaque-origin iframe with no ambient session (ADR-0034). Home is **not**
  sandboxed — it's the first-party, session-bearing origin — so it must never inject a renderer into its own
  document. It instead builds its own child sandbox: a `sandbox="allow-scripts"` iframe (deliberately omitting
  `allow-same-origin`, giving it an opaque origin) and becomes that sandbox's **host** over a small `postMessage`
  protocol — the same host/view split ADR-0034 uses between claude.ai and the card, run locally
  (`platform/ui/federated-renderer.ts`: `mountSandboxedRenderer` + `SANDBOX_HOST_HTML`). The renderer contract
  (`fn(host, value, api)`) is unchanged — a cell author doesn't know or care which host is running it.
- **Date:** 2026-06-30
- **Depends on:** ADR-0002 (type-as-one-object — `present`/`handlers`, the `open|edit|create|render|embed|
  preview` intents), ADR-0039 (federated render surface + the `__parcRender` consumer + tool `_render`),
  ADR-0035 (`ui://` universal render; *inline where React, `ui://` where foreign*), ADR-0033 (`$catalog`
  detail). Grounded in `cells/home/client/app.tsx` (the field computer / `Console`/`OutputStack`).

---

## The insight (the thesis demands the other half)

The substrate's founding claim (`docs/substrate.md`):

> "The UI and the API converge — **a button for a human and a JSON affordance for an agent are the same
> surface expressed through different modalities** … two renderers of one declaration."

ADR-0039 made that literal for **output**: a type's `handlers.render` / a tool's `_render` is one declaration,
rendered as text for the model and as a `ui://` widget for the human. But a capability is *two* halves —
**`{ inputSchema, render }`** — and only `render` got federated. The **`inputSchema` is the input declaration**:
the agent fills it as JSON; the human should fill it as a **form**. The field computer is exactly where the
two audiences meet (like the conversation card), so it is exactly where the symmetry should be realized — and
today it is broken on both sides.

## The finding (grounded)

`cells/home/client/app.tsx`, the `Console`:
- **Output** — `OutputStack` renders every result as `<pre>{JSON.stringify(value)}</pre>` (`app.tsx:2486`).
  No `platform/ui/render-hints`, no per-type `ui://` renderer, no `_render`. Fully divergent from the card.
- **Input** — a focused command shows a **raw-JSON `<textarea>`** seeded by `argSkeleton(cmd.schema)`
  (`app.tsx:2330`). The `inputSchema` exists but the human edits JSON by hand. 96 capabilities, each entered
  as hand-written JSON.

The vocabulary already names both halves — `handlers` intents are `open|edit|create|render|embed|preview`.
**`render`/`embed` = the output projection; `create`/`edit` = the input projection.** ADR-0039 federated
`render`/`embed` as `ui://`. The input twin federates `create`/`edit` as `ui://` **forms**, over a generic
JSON-Schema form floor — the input analogue of the hint floor.

## Decision

1. **The field computer consumes the federated *output* render (Inc 1).** Reuse the shared render core
   (`platform/ui/render-hints`) + per-type `ui://` renderers + tool `_render` (ADR-0039). Home is a *first-party
   React* surface, so it renders typed facts **inline** (ADR-0035 *inline-where-React*) and fetches+runs a
   cell-authored `ui://` renderer **directly** (it has `authFetch`, no sandbox — *simpler* than the card's
   host-proxied path). `OutputStack` stops being a JSON `<pre>` and becomes a sibling of the card.

2. **A generic schema-driven *form* is the input floor (Inc 2).** Generate a form from `inputSchema` — typed
   fields, required markers, enum selects, defaults from the existing `argSkeleton` — replacing the raw-JSON
   textarea (a "raw JSON" toggle stays for power use and round-trips to the same args). This is the input twin
   of `platform/ui/render-hints`; it should live as a shared `platform/ui/form` so home, lit, and the card all
   use one form renderer.

3. **A cell can federate a bespoke `ui://` *form* (Inc 3).** The input analogue of `handlers.render` / tool
   `_render`: a type's `handlers.create`/`edit` → a `ui://` form, and a tool's `_meta.ui.form` (the input twin
   of `ui.resourceUri`). A `ui://` form is a widget that collects args (a date picker for a `day`, a machine
   picker for a run, a fact-key autocomplete for a `key`) and yields them — so a cell ships a bespoke arg UI by
   a cell deploy, no platform change. Same federation rail as ADR-0039, pointed at input.

## Consequences

- **One declaration, both modalities, every surface** — the CALM invariant extended from output to *input*.
  The field computer becomes a true peer of the conversation card: both are where human and agent meet, both
  project the same `read`/`act` declaration.
- **96 capabilities become usable** without hand-writing JSON — the immediate human win.
- **Forms unify with fact authoring.** `create`/`edit` already mean "author a fact" (lit's doc edit, home's
  knowledge). The same `platform/ui/form` floor powers *both* tool-args and fact-create/edit — one form
  renderer, every input. Symmetric to ADR-0039 unifying one *output* renderer across surfaces.
- **Cost:** a JSON-Schema→form renderer (kept lean + dependency-free, matching `render-hints`); the field
  computer importing the shared cores. Inc 1 is pure reuse; Inc 2 is the new floor; Inc 3 is the federation.

## Increments

- **Inc 1 — federated output in the field computer (shipped).** `OutputStack`/`FactBody` render typed facts,
  list results, and tool `_render` directives via the existing `typeDecls`/`resolve` machinery home already
  had — a `ui://` renderer runs sandboxed (`FederatedRendererFrame`, ADR-0034's host/view split rebuilt locally
  for a first-party surface); the gateway card's own renderer path was refactored onto the same shared
  `platform/ui/federated-renderer` module (its "already sandboxed" half) so the two surfaces share one
  implementation, not a divergent copy. JSON `<pre>` remains the fallback for plain/error/probe results.
- **Inc 2 — the schema-form floor (shipped).** `platform/ui/form` (`SchemaForm`): an object schema's properties
  render as real fields (text/textarea/number/boolean/enum-select/comma-separated array), each carrying its
  `description` + a required marker; a field whose shape isn't recognised (nested object, `oneOf`/`anyOf`,
  array-of-objects) degrades to its OWN small raw-JSON box rather than blocking the whole form. No untrusted
  code runs here — a schema is inert data, so (unlike Inc 1's renderer) this needs no sandbox. The field
  computer defaults to the form and keeps a `raw json` toggle (round-trips through the same value, carried
  across the switch) for power use or a shape the floor can't walk; `argSkeleton`/`argSkeletonObject` seed
  both views identically. Palette-parameterized (`FormPalette`) so it sits naturally in the machine's dark
  housing today and any other surface's own theme later (Inc 4).
- **Inc 3 — federated `ui://` forms.** `tool._meta.ui.form` / type `handlers.create` → a cell-authored arg UI;
  the field computer (and the card) fetch+run it, falling back to the schema-form floor.
- **Inc 4 — one form, every input.** Point lit's doc edit / home's knowledge create at the same
  `platform/ui/form`; retire the bespoke editors where the floor suffices.

## Open questions

- **Where the floor lives** — `platform/ui/form` as the input twin of `platform/ui/render-hints`, shared by
  home / lit / the card (the card is a sandboxed iframe, so a `ui://` form there is host-proxied; home runs it
  inline). Keep the form pure + host-channel-optional, like the renderer contract (ADR-0035 open question).
- **How a `ui://` form yields values** — return them via the widget→host channel (the card) vs the widget
  calling the tool directly (`visibility:["app"]`). Home, being first-party, just reads the form's value.
- **JSON-Schema coverage** — objects/arrays/enums/`oneOf`/refs; start with the shapes `read`/`act` targets
  actually use (flat objects of scalars + a few arrays) and degrade to raw-JSON for the long tail.
- **Reuse `handlers.create` vs add `tool.ui.form`** — types already have `create`/`edit`; tools (the 3-tool
  `read`/`act` constraint, ADR-0034) need the binding on the *descriptor* (`_meta.ui.form`), mirroring how
  ADR-0039 Inc 2 put the output renderer on the tool descriptor (`ui.renderer`) rather than `tools/list`.
