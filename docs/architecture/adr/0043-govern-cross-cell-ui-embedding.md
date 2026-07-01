# ADR-0043 — Govern cross-cell UI embedding: one `present` declaration, three projection surfaces

- **Status:** Survey complete; the rule is decided; **Inc 1 shipped and live-verified on 2026-07-01** (canvas
  serves a federated `ui://` board renderer; home renders it through its opaque-origin sandbox instead of the
  origin-iframe). lit's board fence + the shared embed component (Inc 2/3) declared, not yet built.
  Mirrors ADR-0042's method — a broad+deep survey of the actual implementations first, then a sequenced decision —
  because the same failure mode applies: we cannot presume from the vision docs that cells expose UI uniformly.
  They do not. The survey (7 cells + the federation infra) found the mechanism is **already built and live-proven**
  for one surface and **bypassed by a legacy origin-iframe** for another.
  **Inc 1 live proof (server-side, 2026-07-01):** (a) canvas serves `/renderers/board.js` (200,
  `application/javascript`, ACAO:\*, cacheable); (b) the deployed gateway's provider hop resolves
  `resources/read ui://@c15r/canvas/renderers/board.js` to the renderer source; (c) `$types` federates
  `canvas.handlers.render[0].renderer = ui://@c15r/canvas/renderers/board.js`; (d) the renderer's data path
  returns real board facts under the viewer's session — `peek _views/canvas:parcland` → `render.board=parcland`,
  `query {prefix:'_canvas/parcland/el:'}` → 127 placements, `query {prefix:'el:'}` → 212 content facts (≤ the
  renderer's 1200 limit), joined by `el:<id>`. The in-browser paint reuses the machine-run sandbox harness already
  live-proven (ADR-0039), fed by this verified data. `cells.deploy` on canvas + home; `npm run build` + 504 tests green.
- **Date:** 2026-07-01
- **Depends on:** ADR-0034 (the host/sandbox split; opaque-origin iframe; host-proxied `resources/read`/`tools/call`),
  ADR-0035 (`ui://` as the universal render resource — *inline where React, `ui://` where foreign*), ADR-0039
  (federate the render surface — the provider hop + `__parcRender` consumer + the `fn(host,value,api)` contract),
  ADR-0041 (federate the field computer — the **security correction**: home is first-party and must build its own
  child sandbox; `platform/ui/federated-renderer.ts`), ADR-0008 (cell axis / origin isolation). Grounds ADR-0042's
  "govern the seam" discipline, applied to the cell↔cell UI seam instead of the cell↔core data seam.

---

## The trigger (grounded, verbatim user report)

> "canvas rendering on home (tier2?) cell which I believe just shows a signin, rendering pointless."

Confirmed end-to-end in code. `cells/home/client/app.tsx` (`ViewSurface`, the pinned-views grid, `type === 'canvas'`
branch ~L1959) embeds a canvas board as:

```tsx
const embedSrc = localize(`/@c15r/canvas?view=${encodeURIComponent(def.id)}&embed=1&w=620&h=240`);
<iframe src={embedSrc} … pointerEvents:none />
```

That `src` points at **canvas's own origin** (`c15r-canvas.on.parc.land`). An iframe from home's origin to canvas's
origin is a **third-party browsing context** — it carries no session cookie. Canvas's SSR
(`cells/canvas/index.ts`) gates every board on:

```ts
export const mayRenderBoard = (board, isOwner, patterns) => isOwner || covers0(patterns, `canvas:${board}`);
// …
if (!mayRenderBoard(board, !!opts.isOwner, opts.patterns ?? [])) return shell;   // L328
const caller = event.headers?.['x-cell-caller'];                                 // L456
const isOwner = !!caller && caller === OWNER;                                     // L457
```

`x-cell-caller` is dispatch-set from the session cookie. In a third-party embed there is no cookie ⇒ `isOwner=false`
⇒ (for a **private** board, i.e. not covered by a `_public/` pattern) `return shell` ⇒ the anonymous interactive
shell (a sign-in). The "public zero-JS thumbnail" the embed was designed to be **only works for public boards**;
a user's own private boards — exactly what home pins — degrade to sign-in. "Pointless," precisely as reported.

## Two ways broken at once

The origin-iframe embed fails the trust model on **both** axes it should satisfy:

1. **It severs the session.** Third-party origin, no cookie → authed content cannot render.
2. **It does not sandbox per our rule.** It loads a foreign cell's *own session-bearing origin* — the very thing
   ADR-0041's security correction forbids creating — rather than an opaque-origin sandbox the host feeds.

## The survey (broad + deep, mirroring ADR-0042)

Seven parallel readers over the cells + the `ui://` federation infrastructure. The finding: **three UI-exposure
surfaces exist, distinguished by *who provides the data*, not just who renders.**

| Surface | Renders | Data source | Trust context |
|---|---|---|---|
| **A. Full page** — visit `c15r-canvas.on.parc.land` | the cell's own SPA | own session cookie | first-party, authed ✓ |
| **B. Inline hint** — a host list paints a fact from its fields | the host | the already-resolved fact | first-party, no foreign code ✓ |
| **C. Cross-cell embed** — a foreign cell's fact rendered *inside* a host | **the foreign cell's renderer** | **host-provided** (host holds session, resolves data, hands it in) | **foreign/untrusted → sandbox required** |

### Per-cell inventory

| Cell | Offers | Consumes (surface C) | Verdict |
|---|---|---|---|
| **machine** | full-page SPA + **3 `ui://` renderers** (`machine.js`, `machine-run.js`, `define-plan.js`), self-registering, sandboxed, declared in `types.json` `handlers.render[].renderer` | — | ✅ the exemplar producer |
| **input** | a `ui://` **form** (`forms/capture.js`), declared `ui:{form,as}` on its tool descriptor | — | ✅ form producer (live-verified, ADR-0041 Inc 3) |
| **home** | full-page SPA + inline hints + **the first-party sandbox harness** (`FederatedRendererFrame` → `mountSandboxedRenderer`) | machine-run via `ui://` ✅ ; **canvas via origin-iframe ❌** (hardcoded, `ViewSurface` L1959) | consumer — one broken site |
| **lit** | full-page SPA + synced `render-hints` | **canvas via origin-iframe ❌** (the ` ```board ` fence, `client/main.tsx:359`) ; `@c15r/viewers` imported as an **ES module into its own document** (foreign code, first-party doc) | consumer — one broken site + a module-import case |
| **canvas** | full-page SPA + zero-JS `?embed=1` SSR thumbnail | — | ❌ **producer with NO `ui://` renderer — the gap** |
| **models / run** | headless (organ/executor) — emit `agent-run`/`transcript`/`run-job` facts | — | ✅ legitimately headless; rendered by consumers via hints |

### The infrastructure is already built and live-proven

The `ui://` federation rail is **complete** for surface C and validated in production:

- **Provider hop** — `services/gateway/widgets.ts` `resolveCellRenderer(uri)` resolves `ui://@owner/name/path` by
  fetching the owning cell's served asset over `cells.call` (per-URI TTL cache).
- **Sandbox harness (dual-mode)** — `platform/ui/federated-renderer.ts`:
  - `fetchAndRunRenderer` for a caller that IS already a sandbox (the conversation card).
  - `mountSandboxedRenderer` + `SANDBOX_HOST_HTML` for a **first-party caller** (home) that builds its own
    `sandbox="allow-scripts"` (no `allow-same-origin` → opaque origin) child iframe and proxies `api.call` back
    through its own authenticated session over a small `postMessage` protocol.
- **Contract** — `fn(host, value, api)`; `api = { call(kind,target,input), esc, md, key }`. `call` is host-proxied
  read/act under `enforceScope`. Stable and broad (ADR-0039's "specify a generous spine up front").
- **Live proof** — home already renders a **machine-run fact (owned by `@c15r/machine`) via machine's `ui://`
  renderer inside home's sandbox today** (`app.tsx:1355` `resolved.renderer.startsWith('ui://')` →
  `FederatedRendererFrame`). Cross-cell surface C works. Canvas simply never joined it.

The one gap the infra survey flagged — *ad-hoc, non-type-driven* rendering (a foreign renderer for arbitrary content
with no backing type) — **does not block canvas**: `canvas` is a fact type, so it uses the standard type-driven path
(`handlers.render[].renderer`), exactly like `machine`/`machine-run`.

## Decision — the rule

**Surface C (cross-cell embed) is always `ui://` federation with host-provided data. Origin-iframe-to-a-foreign-cell
is retired.** A host embedding another cell's fact:

1. holds the session and **resolves the data itself** (its own authenticated `read`/`act`), and
2. runs the foreign cell's **`ui://` renderer inside an opaque-origin sandbox** it hosts (`mountSandboxedRenderer`),
   proxying the renderer's `api.call` through the host's session.

The foreign cell **never authenticates itself for an embed** and the host **never loads the foreign cell's
session-bearing origin** into a frame. Surfaces A and B are unchanged: A is the cell's own first-party SPA; B is a
host painting a fact from its own fields (no foreign code, no sandbox needed — a schema/hint is inert data).

Corollary (the trust invariant, load-bearing since ADR-0041): a `ui://` renderer or form may be authored by **any
cell the caller can reach — including another tenant's** — so it is untrusted by construction and MUST run in the
opaque-origin sandbox. A first-party surface MUST NOT inject it into its own document, and MUST NOT substitute an
origin-iframe-to-the-author's-cell (which is strictly worse: it both severs the session and hands control to a
foreign session-bearing origin).

### What each producer must expose for surface C

The `machine` shape, generalized: (1) a `ui://` renderer `fn(host,value,api)` served by the cell (ACAO:\*, cacheable
— it is non-sensitive static code; data arrives only via host-proxied `api.call`, never embedded); (2) a
`handlers.render[].renderer = "ui://@owner/cell/renderers/<x>.js"` declaration in `types.json` (with a `{hint:…}`
fallback after it, so a sandbox/CSP/offline failure degrades to the inline hint); (3) the renderer fetches whatever
it needs via `api.call('read', 'workspace.query'|'workspace.peek', …)` — the host resolves it under the viewer's
session, so per-fact grants are enforced for free.

## Increments

- **Inc 1 — canvas becomes a surface-C producer; home + lit consume it via `ui://` (in progress).** Author
  `cells/canvas/renderers/board.js` — a self-registering `window.__parcRender['canvas']` that, given a canvas/view
  value + `api`, fetches the board's placement facts (`workspace.query({prefix:'_canvas/<board>/el:'})`) and their
  content facts, computes a fit camera, and paints the board using canvas's own pure isomorphic render functions
  (ported from `shared/render.ts` — canvas keeps ownership of its rendering). Declare it in `cells/canvas/types.json`
  (`handlers.render[].renderer` + a `{hint:"fields"}` fallback). Swap **home's** `ViewSurface` canvas branch and
  **lit's** ` ```board ` fence off the origin-iframe onto the sandbox harness they already have (home:
  `FederatedRendererFrame`; lit: build/borrow the same `mountSandboxedRenderer` host). Deploy canvas
  (`cells.deploy`), verify **live** that a private board renders inside home under the owner's session (not a
  sign-in shell). This is the canvas analogue of ADR-0039's `machine-run` money-shot.
- **Inc 2 — retire the remaining origin-iframe / foreign-module embeds.** lit's `@c15r/viewers` ES-module import
  (`import('https://parc.land/@c15r/viewers/app.js')` executed in lit's own document) is the same untrusted-code-in-
  first-party-doc smell for the same-owner case; fold it onto `ui://` (this is ADR-0039 Inc 3 "viewers as `ui://`",
  now with a concrete consumer). Audit for any other `cellUrl(…, embed=1)` / cross-origin `<iframe src>` /
  cross-origin dynamic `import()` and convert or justify each.
- **Inc 3 — a shared first-party embed component.** Home's `FederatedRendererFrame` and lit's board fence will both
  wrap `mountSandboxedRenderer` with near-identical resolve-fetch-mount-degrade logic. Lift it into `platform/ui`
  (the render-hints/federated-renderer sibling) so every first-party React/DOM surface embeds a foreign fact the
  same way — one host implementation, not a per-cell copy (the ADR-0042 "the pipeline is importable; stop
  reimplementing it" lesson, applied to the embed host).
- **Inc 1b — draw the board's edges (shipped).** The first renderer painted only elements. Canvas boards draw
  connections by projecting substrate LINKS (`workspace.links`) among the board's elements — so the renderer now
  reads links too and draws them as an SVG under the elements in the same camera transform. Styled by relation,
  mirroring the live board's hierarchy: authored links (`relates`/`informs`/…) read as real connections; inferred
  `similarTo` edges are a faint constellation (parcland is 333 `similarTo` : 13 authored), so a 240px thumbnail
  shows structure, not a similarity haze.
- **Inc 4 — server-assembled `scene` read: ATTEMPTED, REVERTED (a live-caught finding).** To stop the renderer
  re-deriving the board (join placements+content, project edges) from raw reads, canvas grew a `scene` **read tool**
  (`read("@c15r/canvas.scene")` → assembled `{elements, edges}`, gated like SSR). It worked functionally (127
  elements + 346 edges in one call) but **regressed latency badly**: a forge-deployed runtime cell is **128 MB
  (~1/12 vCPU, and `cells.configureCell` exposes timeout but NOT memory)**, so assembling + JSON-serialising the
  ~98 KB scene ran **~7.8 s and often hit the 10 s cell timeout**. The lesson (an ADR-0042-style live finding): the
  original renderer's reads went through **tier-1 `workspace`** (well-resourced), and moving the heavy assembly into
  the tiny canvas cell was the regression, not a fix. Reverted to reading through `workspace`. **Corollary on edge
  scoping:** a board's edges *cannot* be prefix-scoped to one board — substrate links are keyed by element
  (`EDGE#<from>|…`, `from`/`to` = `el:<id>`), shared across boards; board membership lives only in the placement
  facts. True board-scoping needs one `edgesFrom` query per element (127 for parcland), which the 128 MB cell timed
  out on live. So the renderer reads element-sourced links through fast tier-1 `workspace` and filters to the
  board's element set after the read — the practical scoping the substrate's key model allows.
- **Inc 5 — a data-fidelity follow-up for canvas (open).** The renderer still over-fetches content/links (whole-`el:`
  reads filtered client-side) because content facts (`el:<id>`) and links aren't board-nested. A genuinely cheaper
  board read needs a **data-model change** — re-key content + project a board-scoped edge index under
  `_canvas/<board>/` — so a board's scene reads by one prefix, OR a **larger cell tier** for canvas so a `scene`
  tool (Inc 4) becomes viable. Both are larger changes; deferred. Through tier-1 `workspace` the current over-fetch
  is fast enough in practice.

## Consequences & trade-offs

- **One declaration, three surfaces, correctly bounded.** A type's `present`/`handlers.render` is authored once by
  its managing cell and projects to A (its SPA), B (hint floor), and C (sandboxed `ui://` in any host). The CALM
  invariant ADR-0039/0041 asserted for the conversation and the field computer now covers cross-cell embedding too.
- **Session preserved, isolation preserved — simultaneously.** The host's session resolves the data (fixes the
  sign-in); the opaque-origin sandbox runs the untrusted renderer (satisfies the trust rule). The origin-iframe
  could satisfy neither.
- **Latency.** A `ui://` embed costs a renderer fetch (cached) + host-proxied data calls, vs the origin-iframe's
  single edge-cached SSR request. Acceptable for authed/private content that the origin-iframe simply cannot show;
  the `{hint}` fallback keeps first paint honest. (Public boards *could* still use the cheap `?embed=1` thumbnail —
  the rule doesn't ban surface B for public facts; it bans origin-iframing a foreign cell to render *authed* content.)
- **Producer duplication, placed correctly.** Canvas's renderer re-states its own render logic in a standalone
  sandbox script. That duplication lives **in canvas**, the cell that owns rendering — the right home for it —
  exactly as machine's `machine-run.js` re-states its trace→mermaid logic. Inc 3/4 shrink the *host-side* and
  *data-side* duplication; the per-cell renderer is federation working as designed.
- **Security unchanged from ADR-0039/0041.** Renderer assets are non-sensitive static code (ACAO:\*); live data +
  actions flow only through the host proxy under `enforceScope`; the sandbox has no ambient session, cookies, or
  host DOM.

## Open questions

- **Renderer data path for split-model cells (canvas).** Inc 1 uses two prefix queries; Inc 4 may add a one-call
  board read. Which becomes canonical depends on the live measurement.
- **`_public` boards.** Do we keep the cheap `?embed=1` origin-iframe for *provably public* boards (surface B-ish,
  no session needed) as a fast path, or unify everything on `ui://` for one code path? Leaning unify, but the
  public thumbnail is genuinely cheaper; decide after Inc 1.
- **A host declaring an embed for a type it doesn't manage.** The infra survey's "ad-hoc non-type render" gap — a
  small `renderAs` spine extension — is not needed for Inc 1 but would let a host compose a foreign renderer for
  arbitrary content. Park it until a real need appears.
