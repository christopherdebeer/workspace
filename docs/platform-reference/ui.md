# UI — Federated Renderer, Forms & Vocab

`platform/ui` is the substrate's **presentation layer**: the terminal `present` stage of the projection pipeline (`select → score → shape → present`), made **federated** (a renderer can be authored by any reachable cell, including another tenant's) and **bidirectional** (output renderers AND input forms). Nothing in this subsystem is a new core primitive — every capability here **compounds on `projection`**, the read pipeline whose present facet these modules realise. A few also touch `cell` (the isolation boundary the untrusted `ui://` code runs against, and the packaging seam that ships this kit across the origin-isolated cell boundary), `edge-http` (the CloudFront + Function URL face over which a cell serves its `ui://` asset), and `fact` (wiki-link targets become substrate edges).

## The shape repeated across every concern: FLOOR + CEILING

Each concern in this subsystem has the same two-tier structure:

| Concern | Dependency-free built-in **FLOOR** | Federated **CEILING** (cell-authored `ui://` code, untrusted) |
|---|---|---|
| Output rendering | `hintToHtml` (`render-hints.ts`) | `RendererFn` under `window.__parcRender` |
| Input collection | `SchemaForm` (`form.tsx`) | `FormRendererFn` under `window.__parcForm` |
| Routing a fact→surface | `resolve` (`vocab.ts`) | (a handler's `renderer`/`surface`/`path` decl) |
| Cross-surface links | `resolveWikiTarget` (`wiki-link.ts`) | (surface-supplied anchor markup) |

The **floor** is pure string/data in-and-out, SSR-safe, no React where possible, and always degrades gracefully (returns `''`/`null`, never throws, never blocks). The **ceiling** is arbitrary cell code that is *untrusted by construction* and therefore runs inside an **opaque-origin sandbox** with no ambient parc.land session — the security invariant of ADR-0034/0041/0043.

The tier-1 "spine" (per ADR-0039) is deliberately thin and generous: the renderer contract `fn(host, value, api)`, the form contract `fn(host, schema, value, api)`, and the `parc-host`/`parc-sandbox` postMessage message-shapes. New per-type renderers are pure tier-2 (`cells.deploy`, no CDK, no gateway change).

**Live ground truth:** 50 types are declared; **47 resolve to the built-in hint floor** (mostly `{hint:'markdown'}`), and only `machine`, `machine-run`, and `canvas` declare `ui://` renderers. Both `home` and `home-next` are deployed. Drift is live and documented in the coherence callouts below.

---

## 1. Federated renderer contract (`RendererFn` / `RendererApi`)

**File:** `platform/ui/federated-renderer.ts`

The canonical, dependency-free (`window`/`document` only, **no React**) function-shape every cell-authored `ui://` renderer registers against. A renderer is a self-registering classic script that adds `fn(host, value, api)` to `window.__parcRender[<renderKey>]`. The renderer **never touches the substrate directly** — every read/act is host-mediated via `api.call`. A *decomposed* renderer (e.g. a machine definition whose nodes/rails are separate facts) uses `api.key` to fetch its children via `api.call`.

### Public API

```ts
// federated-renderer.ts:37
type RendererFn = (host: HTMLElement, value: unknown, api: RendererApi) => void;

// federated-renderer.ts:39
interface RendererApi {
  call: (kind: 'read' | 'act', target: string, input: unknown) => Promise<unknown>;
  esc: (s: unknown) => string;
  md:  (s: string) => string;
  key?: string;  // the fact's substrate key; a decomposed renderer fetches children via call
}

// federated-renderer.ts:72 — lazily creates/returns the shared window.__parcRender map
function rendererRegistry(): Record<string, RendererFn>;

// federated-renderer.ts:80 (module-private) — idempotent per-uri inline <script> injection,
// guarded by the module-level loadedRenderers Set
function loadRendererScript(uri: string, src: string): void;
```

### Data model

No DynamoDB of its own. Consumes a fact's `value` and its substrate `key`. Render declarations live in the **type contract** (a Fact-stored field in `_types/<t>`, federated via `cells.describeTypes` into `$types`). Live `$types` shows, e.g.:
- `machine.handlers.render = [{renderer:'ui://@c15r/machine/renderers/machine.js'}, {renderer:'_renderers/machine'}, {hint:'fields'}]`
- `machine-run → ui://@c15r/machine/renderers/machine-run.js`
- `canvas → ui://@c15r/canvas/renderers/board.js`

The registry key is the **fact type** (for type renderers) or an explicit `as` name (for tool renderers).

### Invariants & edge cases

- A renderer is **untrusted code by construction** (may be authored by any reachable cell, including another tenant) — it must run inside an isolation boundary with **no ambient parc.land session**.
- The renderer reaches the substrate **only** via host-mediated `api.call` under `enforceScope`; it never reaches the network directly.
- Adding a field to `api` is **backward-compatible** (old renderers ignore the new field).
- **Silent degradation:** any failure (offline, CSP block, cell down, no renderer registered under `type`) leaves whatever placeholder/hint content the caller already painted into `host` visible.
- `loadRendererScript` is idempotent per-uri (guarded by `loadedRenderers`), and swallows CSP-blocked injection.

**Reduces to:** `projection`. This is the materialised `present` stage (Affordance shape) for the FOREIGN-surface case. A type's `handlers.render[].renderer` resolves to a `ui://` artifact; this contract is how that artifact draws the projected value. The `value` it receives is the output of `select → score → shape`; the renderer is only the terminal present. `api.call` recurses back into the **same** projection pipeline (read/act under `enforceScope`) — it is the present facet made executable and cross-cell, not a new primitive.

**Connections:** depends on the **Cell axis** (renderer served by the owning cell as ACAO:* static code) and the **Edge HTTP contract** (the cell serves the `ui://` asset over its CloudFront + Function URL face).

**Motivating ADRs:** ADR-0035, ADR-0039, ADR-0056, ADR-0043.

---

## 2. Two-shape sandbox isolation for foreign renderers

**File:** `platform/ui/federated-renderer.ts`

The **security realisation** of the renderer contract, split by whether the caller is *already* a sandbox.

**Shape 1 — `fetchAndRunRenderer`** — for a caller that is itself an opaque-origin sandbox with no session (e.g. the conversation card inside claude.ai, per ADR-0034). It fetches the renderer source via the surface's own `fetchText`, injects it inline, and calls the registered fn directly.

**Shape 2 — `mountSandboxedRenderer` + `SANDBOX_HOST_HTML`** — for a first-party, session-bearing origin (home's field computer). Such a caller must **NOT** inject foreign script into its own document; it builds its **own** child `sandbox="allow-scripts"` iframe (deliberately omitting `allow-same-origin` → opaque origin → no cookies/storage/session) and becomes that sandbox's **host** over a postMessage protocol. `SANDBOX_HOST_HTML` is the inline VIEW document (no external `src`): it self-registers `window.__parcRender`/`window.__parcForm`, receives `parc-render`/`parc-mount-form`, runs the renderer INSIDE the isolated doc, proxies `api.call` back as `parc-call` (parent performs the real authenticated call, replies `parc-call-result`), and reports size/lifecycle.

**`attachSandboxedRenderer`** is the one lift-out helper wrapping the whole *prime-srcdoc → await load → wire host → fetchSource → render → dispose* sequence that home's frame and lit's board fence each hand-rolled (ADR-0043 Inc 3 / ADR-0044 Inc 4).

### Public API

```ts
// federated-renderer.ts:102 — shape 1 (caller IS the sandbox)
async function fetchAndRunRenderer(
  uri: string, type: string, host: HTMLElement, value: unknown,
  api: RendererApi, fetchText: (uri: string) => Promise<string | null>,
): Promise<void>;

// federated-renderer.ts:275 — shape 2 host half
function mountSandboxedRenderer(
  iframe: HTMLIFrameElement,
  opts: {
    call: (kind: 'read' | 'act', target: string, input: unknown) => Promise<unknown>;
    onResize?: (height: number) => void;
    onSettled?: (ok: boolean) => void;
    onFormChange?: (value: Record<string, unknown>) => void;
  },
): SandboxedRendererHandle;

// federated-renderer.ts:135 — the lift-out embed sequence. NOTE: render-only,
// does NOT wire form-mount.
function attachSandboxedRenderer(
  iframe: HTMLIFrameElement,
  opts: {
    call: (kind, target, input) => Promise<unknown>;
    fetchSource: (uri: string) => Promise<string | null>;
    uri: string; type: string; value: unknown; key?: string;
    onResize?: (height: number) => void;
    onSettled?: (ok: boolean) => void;
  },
): () => void;   // returns a disposer

// federated-renderer.ts:184
const SANDBOX_HOST_HTML: string;

// federated-renderer.ts:254
interface SandboxedRendererHandle {
  render(src: string | null, type: string, value: unknown, key?: string): void;
  mountForm(src: string | null, type: string, schema: unknown, value: Record<string, unknown>): void;
  dispose(): void;
}
```

### Data model — the postMessage wire protocol

Host → view (`source: 'parc-host'`):
- `{ type:'parc-render', src, rendererType, value, key }`
- `{ type:'parc-mount-form', src, formType, schema, value }`
- `{ type:'parc-call-result', id, ok, value | error }`

View → host (`source: 'parc-sandbox'`):
- `{ type:'parc-ready' | 'parc-rendered' | 'parc-render-failed' }`
- `{ type:'parc-call', id, kind, target, input }`
- `{ type:'parc-size', height }`
- `{ type:'parc-form-change', value }`

Mounts are **queued until `parc-ready`** (see `queued`/`ready`, federated-renderer.ts:285–306).

### Invariants & edge cases

- Host and sandbox **MUST** have different origins; the iframe omits `allow-same-origin` to guarantee an opaque origin.
- A first-party session-bearing surface must never inject a foreign renderer into its own document, and must never substitute an origin-iframe to the author's cell (that is strictly worse — severs session AND hands control to a foreign session-bearing origin).
- `mountSandboxedRenderer` filters inbound messages to `ev.source === iframe.contentWindow` (federated-renderer.ts:295) — only *this* sandbox.
- `srcdoc` is set **after** the load listener is attached (federated-renderer.ts:162–164) so a synchronously-parsed doc can't race it.
- The sandbox's `md` is **intentionally just escaping** (federated-renderer.ts:201) — no markdown engine ships in the platform bootstrap; a renderer wanting rich markdown brings its own.

**Reduces to:** `projection` + `edge-http`. It is the same host/view split ADR-0034 uses between claude.ai and the card, run locally — an isolation wrapper around the present stage. It reduces to projection because `opts.call` is the parent's own authenticated read/act (the projection pipeline) and everything the sandbox can do routes back through it under `enforceScope`. It touches `edge-http` only indirectly (the `ui://` asset is served over the cell's CloudFront + Function URL face). The postMessage protocol is a small tier-1 spine of its own, but it constitutes an **isolation transport**, not a data/auth primitive — auth lives entirely in the parent's `call`.

**Connections:** depends on the Federated renderer contract, the **Cell axis** (origin isolation, ADR-0008), and the **Edge HTTP contract**.

**Motivating ADRs:** ADR-0034, ADR-0041, ADR-0043, ADR-0039, ADR-0044.

> ⚠ **Coherence — home-next forks the sandbox host (CONFLICT, high).** `cells/home/client/federated.tsx:6` imports `mountSandboxedRenderer, attachSandboxedRenderer, SANDBOX_HOST_HTML` from the canonical `@parc/ui`. But `cells/home-next/client/federated.tsx:6` imports the same three symbols from its own **`./federated-host.ts`** — a standalone 159-line reimplementation (defs at lines 82/138) that imports nothing from `@parc/ui` or `federated-renderer.ts` (the 336-line canonical host). No shared helper unifies them, so this is a genuine fork of the **untrusted-renderer isolation boundary** — a security fix to one host may not reach the other. The home-next fork is arguably *better*: its `SANDBOX_HOST_HTML` adds a hardened CSP (`default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'` → a network-denied sandbox) plus `call()` argument validation (kind ∈ {read,act}, `target.length <= 180`) that the canonical `SANDBOX_HOST_HTML` (federated-renderer.ts:184) **lacks entirely**. Note: the ACTIVE/successor status of home-next is corroborated by commit `696d805`, *not* by a `live/cells.json` (which does not exist); home-next is ACTIVE but not yet the default cell (`DISPATCH_DEFAULT_CELL` is deferred in both `index.ts`). **Recommendation:** upstream the home-next hardening into `platform/ui/federated-renderer.ts`, delete `cells/home-next/client/federated-host.ts`, and re-point `cells/home-next/client/federated.tsx` back to `@parc/ui`.

> ⚠ **Coherence — the wire contract stayed convergent (COMPOUNDS, info).** The home-next fork deliberately preserves the exact `parc-host`/`parc-sandbox` message types and the `RendererFn`/`FormRendererApi`/`SandboxedRendererHandle` shapes (`cells/home-next/client/federated-host.ts:24,60,69-73,97-98` mirror `platform/ui/federated-renderer.ts:191-247,254-264`). A renderer authored once runs identically in both hosts, so collapsing the fork is **low-risk**: renderers/forms need no changes, only the host import path and the location of the hardening move.

> ⚠ **Coherence — stale orphaned sync copy (CONFLICT, medium).** `cells/home-next/shared/federated-renderer.ts` is a GENERATED sync copy (header names `scripts/sync-platform-ui.mjs`) that is now dead: its generator was **deleted** in commit `967c139`, it has **drifted** (`grep -c attachSandboxedRenderer` = 0 vs 1 in the canonical file), and **nothing imports it**. The whole `cells/home-next/shared/` subtree is dead — its only in-subtree importer is `cells/home-next/shared.tsx` (importing `./shared/ui`), which itself has no importers (home-next `index.ts` imports only `./client/app` and `./client/bridge`). **Recommendation:** delete `cells/home-next/shared/` and the orphaned `cells/home-next/shared.tsx`.

---

## 3. Forms as input projection (`FormRendererFn` + `SchemaForm` floor)

**Files:** `platform/ui/form.tsx`, `platform/ui/federated-renderer.ts`

The **INPUT twin** of rendering (ADR-0041): where a renderer *displays* a value, a form *collects* one. Two layers.

**(1) The federated `ui://` form contract** (`FormRendererFn`, in `federated-renderer.ts`): self-registers under a **separate** namespace `window.__parcForm`, runs under the **identical** sandbox (still untrusted), reports edits via `api.onChange` (mapped to `parc-form-change`), and **never submits** — the embedding surface owns Run/Submit.

**(2) The generic React `SchemaForm` FLOOR** (`form.tsx`): turns a capability's JSON-Schema `inputSchema` (or a fact's fields) into editable controls (text/textarea/number/boolean/enum-select/comma-separated array), each with a description + required marker, palette-parameterised via `FormPalette`. Unlike a `ui://` renderer, `SchemaForm` runs **no untrusted code** (a schema is inert data) so it needs **no sandbox** (form.tsx:22–25).

### Public API

```ts
// federated-renderer.ts:62 — the federated ui:// form contract
type FormRendererFn = (host: HTMLElement, schema: unknown,
                       value: Record<string, unknown>, api: FormRendererApi) => void;
// federated-renderer.ts:64
interface FormRendererApi extends Omit<RendererApi, 'key'> {
  onChange: (value: Record<string, unknown>) => void;
}

// form.tsx:86
function SchemaForm(props: {
  schema: FormFieldSchema | undefined;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  palette?: Partial<FormPalette>;
}): React.JSX.Element | null;

// form.tsx:71 — object && properties gate
function isFormable(schema: FormFieldSchema | undefined): boolean;
// form.tsx:63 (module-private) — scalar/enum/bool/simple-array
function fieldFormable(s: FormFieldSchema | undefined): boolean;

// form.tsx:29
interface FormFieldSchema { type?; description?; enum?; default?; items?; properties?; required? }
// form.tsx:51
const DEFAULT_FORM_PALETTE: FormPalette;  // the "park" palette
```

### Data model

JSON Schema in, `Record<string, unknown>` value out. Long-text heuristic (form.tsx:229): fields named `content`/`text`/`prompt`/`body`/`description`, or any field with `description.length > 100`, render as a `textarea`. The form wire shape rides the sandbox protocol (`parc-mount-form` / `parc-form-change`). The live catalog exposes `ui.form` on the `$catalog` entry itself (not post-invocation) — e.g. `@c15r/input.capture` ships a bespoke `ui://` form with live markdown preview.

### Invariants & edge cases

- A form **never submits** — it only emits `onChange`; the host owns the current value and the Run action.
- Forms self-register under `__parcForm`, **separate** from `__parcRender` (a tool may declare both for one target).
- `SchemaForm` returns `null` if the top-level schema isn't a formable object (form.tsx:87); the caller's raw-JSON view is the fallback.
- An unrecognised field shape (nested object / `oneOf` / `anyOf` / `$ref` / array-of-objects) degrades to its **own per-field raw-JSON box** (form.tsx:159–183) — never blocks or drops the field. That box parses on blur and, on parse failure, **leaves the typed-but-invalid text** (the user is still editing).
- `SchemaForm` holds **no internal state** — it composes with any surface's state management.

**Reduces to:** `projection`. Directly the input half of the pipeline: ADR-0041 names the CALM invariant — one capability declaration `{inputSchema, render}` projected as a *form* for a human and as *typed JSON* for an agent. `inputSchema` is a Fact-stored capability contract; `SchemaForm` is a preset that shapes it into controls — the exact input analogue of `hintToHtml` shaping output. The same floor powers tool-args AND fact create/edit (ADR-0041 Inc 4; home's FactEditor via `fieldsToFormSchema`).

**Connections:** shares the sandbox transport with the Federated renderer contract (for `ui://` forms); consumes `inputSchema` / `handlers.create|edit` from the projection type model.

**Motivating ADRs:** ADR-0041, ADR-0039.

---

## 4. Shared render-hint vocabulary (`hintToHtml` / `fieldsToHtml` / `bodyText`)

**File:** `platform/ui/render-hints.ts`

The single source of truth (ADR-0035 Inc A) for the built-in render **FLOOR** — how a fact's value becomes an HTML body by its `present.render` hint when no cell-authored `ui://` renderer applies. Dependency-free and SSR-safe: markdown is **injected** (`HintDeps.md`) so `platform/ui` keeps its React-only contract and each surface supplies its own `marked`. Both surfaces consume it: home's React `HintBody` uses the granular helpers; the conversation card uses `hintToHtml` wholesale (so the card stops being a divergent vanilla re-implementation).

### Public API

```ts
// render-hints.ts:74 — md/markdown | code (2000-char cap) | metric | fields | image
function hintToHtml(hint: string, value: unknown, deps: HintDeps): string;
// render-hints.ts:109
function fieldsToHtml(value: unknown, esc?: (s: unknown) => string): string;
// render-hints.ts:28 — string, or first present of BODY_FIELDS
function bodyText(v: unknown): string;
// render-hints.ts:38 — resolves a present.label dot-path against a root
function resolvePath(root: unknown, path: string): unknown;
// render-hints.ts:43 — up to 6 scalar, non-identity fields, each capped 160 chars
function selectFields(v: unknown): Array<[string, string]>;
// render-hints.ts:16
function escapeHtml(s: unknown): string;

// render-hints.ts:54
interface HintDeps { md: (src: string) => string; esc?: (s: unknown) => string }
// render-hints.ts:25 (module-private)
const BODY_FIELDS = ['content','body','text','description','note','statement','md','markdown'];
```

### Data model

Consumes a fact value + a hint string. `statement` is in `BODY_FIELDS` specifically for ADR-0040 `claim` facts (`{statement, confidence, support[]}`) so a claim's assertion isn't truncated by the fields cap. `selectFields` skips identity keys `content`/`title`/`name`/`id`/`src` (render-hints.ts:45). `metric` reads `value ?? count ?? total`, or falls to `bodyText`.

### Invariants & edge cases

- Dependency-free: no React, no DOM, no markdown lib — markdown is injected so the module stays SSR-safe and bundle-lean.
- Returns `''` when there's nothing to draw; the caller falls back to fields/JSON.
- `code` hint caps at 2000 chars (render-hints.ts:84); `fields` at 6 rows × 160 chars.

**Reduces to:** `projection`. This IS the present stage for the built-in (non-federated) case — the ladder rung below `ui://` renderers. A type's `present.render` hint selects a branch; the value being rendered is the projection output. Pure string in/out, no new primitive: it's the default Affordance shape. **47/50 live types resolve to exactly this floor.**

**Motivating ADRs:** ADR-0035, ADR-0039, ADR-0038.

> ⚠ **Coherence — home forks `bodyText`, dropping `statement` (CONFLICT, low).** `platform/ui/render-hints.ts:25` includes `'statement'` in `BODY_FIELDS` (with the ADR-0040 rationale at lines 20–24). But `cells/home/client/facts.tsx:191` and `cells/home-next/client/facts.tsx:191` each carry a **local** `bodyText` copy over `['content','body','text','description','note','md','markdown']` — **omitting `statement`**. `cells/lit/client/main.tsx:23` imports the shared `bodyText` from `@parc/ui` and renders a claim's `statement` as clean markdown prose. So a `claim` shows as prose in lit but as raw JSON (peek modal) / a truncated `statement:` field-preview in home. (Note: no `claim` *type declaration* exists in any `types.json` or `DEFAULT_TYPE_DECLS`, so home never hits the `md` HintBody path for it — the visible divergence is prose-vs-JSON, not truncation.) **Recommendation:** make home/home-next `HintBody` consume the shared `@parc/ui` `bodyText` instead of a private copy.

> ⚠ **Coherence — `resolvePath` is a never-called shared resolver (CONFLICT, medium).** `render-hints.ts:38` `resolvePath` (and the runtime's `resolveLabel`/`resolvePresent`) is the intended one true label-path resolver, but grep shows it is **never imported/called** by any surface. Instead the label-path-against-value step is re-implemented in `cells/home/client/facts.tsx` (`factTitle`/`pathInto`, ~lines 72/86), byte-identically in `cells/home-next/client/facts.tsx`, and a fourth time in `cells/kernel/client/main.ts:429` (`titleOf`, whose comment at line 435 says it "mirrors resolveLabel"). Worse, the copies **root differently**: `resolveLabel` (`platform/runtime/present.ts:45`) roots `head==='value'|'key'|'meta'` at the `{value,key,meta}` **envelope** and stringifies numbers/booleans, while home's `pathInto(e.value, label)` roots at `e.value` and accepts only strings — so a served `present.label` of `value.title` resolves in the kernel but mis-resolves in home (masked by the fallback heuristic for `title`/`name`/`content`), and value.* fields outside that heuristic (`text`/`path`/`id`/`seq`/`status`/`mode`/`node`) title as their raw key. This is a cross-boundary title-display bug affecting ~half the declared `value.*` types. **Recommendation:** export `resolvePresent`/`resolveLabel` through `@parc/ui` and route home/home-next `factTitle` + kernel `titleOf` through it (deleting the dead helper's dead status), or delete `present.ts` as an abandoned abstraction.

---

## 5. UI-side type vocabulary + handler resolver (`vocab.ts`)

**File:** `platform/ui/vocab.ts`

A pure, cell-agnostic UI-side type model that mirrors the runtime type-schema so every surface and agent share **one** way to map a fact + intent to a concrete surface. A `TypeDecl` carries `{manager?, icon?, label?, handlers?}`; a `TypeHandler` declares one of `path` (cell-relative, templated; cell implicit = manager unless `cell` overrides), `surface` (full templated path for value-derived addresses), `act`, `renderer`, or `hint`. `resolve` returns a **structured `{cellRef:{owner,name}, path}` — NOT an apex URL** — and the consumer materialises the origin via the kernel's `cellUrl`, so one declaration renders on the apex or any cell subdomain for any owner.

### Public API

```ts
// vocab.ts:171 — tries each type signal (most-specific first), then each handler in order
function resolve(fact: VocabFact, intent: Intent, decls: Record<string, TypeDecl>): TypeHandler | null;
// vocab.ts:159 — the governing declaration (first matching type signal)
function declFor(fact: VocabFact, decls: Record<string, TypeDecl>): TypeDecl | null;
// vocab.ts:83 — declared type, then key prefix, then tag prefixes
function typeSignals(fact: VocabFact): Array<{ type: string; match: string }>;
// vocab.ts:122 — substitutes ${id|key|type|match|value.path}; null if any var resolves empty
function applyTemplate(tmpl: string, ctx: TemplateCtx): string | null;
// vocab.ts:62 — extracts a fact id from its key; tolerates undefined (returns '')
function deriveId(key: string | undefined): string;

// vocab.ts:19
type Intent = 'open' | 'edit' | 'create' | 'render' | 'embed' | 'preview';
// vocab.ts:21
interface TypeHandler { path?; cell?; surface?; act?; renderer?; hint?; cellRef? }
// vocab.ts:42
interface TypeDecl { manager?; icon?; label?; handlers? }
// vocab.ts:53
interface VocabFact { key: string; value?: unknown; _meta?: { type?; tags? } }
```

### Data model

Consumes the live `$types` self-model: each type = `{icon?, note?, manager:'@owner/cell', handlers:{render|open|edit|embed:[TypeHandler...]}, present:{icon}, keyPattern?, schema?}`. Confirmed against deployed `$types` (50 types): e.g. `canvas.manager='@c15r/canvas'`, `handlers.open=[{path:'?canvas=${match}'}]`, `handlers.render=[{renderer:'ui://@c15r/canvas/renderers/board.js'},{hint:'fields'}]`. `parseCellRef` (vocab.ts:148) accepts `@owner/name`, `owner/name`, or `/name` (inherit manager owner).

### Invariants & edge cases

- **Pure:** no DOM, no cells hardcoded — callers supply the declarations and materialise origins via `cellUrl`.
- Most-specific-first signal order: declared type > key prefix > tag prefixes (vocab.ts:83–95).
- `applyTemplate` returns `null` on **any** empty variable (vocab.ts:139), so a handler list expresses **ordered alternatives**; scalar `id`/`key`/`match` are URL-encoded, `${value.*}` is taken **raw** (often a full address).
- `resolve` only returns a handler once at least one of `cellRef`/`surface`/`act`/`renderer`/`hint` is set (vocab.ts:205).

**Reduces to:** `projection`. `vocab.ts` is a client-side parallel of the runtime type-schema — the projection pipeline's routing/affordance metadata (the `open|edit|create|render|embed|preview` intents = ADR-0002 type-as-one-object) made consumable in the browser without hardcoding cells. The decls it walks ARE the Fact-stored `$types` self-model, federated by `cells.describeTypes`; `resolve` is the affordance-selection step. **Honest note:** it is a *deliberate duplicate* of the runtime type model living UI-side — a documented parallel, and a coherence point to watch (drift between runtime type-schema and this resolver would silently mis-route).

**Connections:** consumes the projection type self-model; depends on the **Cell axis** (`cellUrl` origin materialisation by the kernel).

**Motivating ADRs:** ADR-0035, ADR-0041, ADR-0002.

> ⚠ **Coherence — stale `deriveId` copy in home-next (CONFLICT, low; dormant).** `cells/home-next/shared/vocab.ts:63` has the **older** `deriveId(key: string)` with **no null guard**, and its `typeSignals` reads `fact.key` directly — whereas the canonical `platform/ui/vocab.ts:62` has `deriveId(key: string | undefined)` with `if (!key) return ''` and `const key = fact.key ?? ''`. The copy has **zero importers** repo-wide (all home-next client files import the resolver via `@parc/ui`, which re-exports `./vocab` at `parc-ui.ts:20`); `cells/home` has no `shared/` dir at all. So this is fully inert dead code — a dormant fork, not an active conflict. **Recommendation:** delete `cells/home-next/shared/`.

> ⚠ **Coherence — `TypeHandler` has no single source of truth (COMPOUNDS, low).** The runtime exposes `Type.handlers` as opaque `Record<string, unknown>` (`platform/runtime/type-schema.ts:151,186`); the entire *interpretation* of what a handler means (`path`/`cell`/`surface`/`act`/`renderer`/`hint` templating) lives only UI-side in `vocab.ts:21-51,171-209`. This is the intended present-vs-routing split and works off shared `$types` data, so it compounds — but a malformed handler decl is caught only at UI render time. **Recommendation (optional):** have the runtime import the `TypeHandler` shape from a shared spec so `Type.handlers` is typed rather than opaque.

---

## 6. Canonical wiki-link resolver (`resolveWikiTarget` / `extractWikiTargets` / `wikiLinkExtension`)

**File:** `platform/ui/wiki-link.ts`

ONE resolver + ONE slug rule for the substrate's cross-surface `[[target]]` / `[[target|label]]` link syntax (ADR-0044 Inc 4, subsuming ADR-0038 Inc 3 / ADR-0039 Inc 4). `resolveWikiTarget(raw)` splits the label, splits an ADR-0061 `#fragment`, and applies the slug rule: a target that `looksLikeKey` (no whitespace AND contains `:` or `/` or starts with `$`) is used as-is; anything else is a doc title → `doc:<wikiSlug(word)>`. `extractWikiTargets(md)` yields every distinct fact key a markdown body links to — the **edge-sync input** (lit reconciles these into `related` edges on save). `wikiLinkExtension(renderAnchor)` is a `marked` inline extension parameterised by the surface's own anchor renderer — the KEY resolution never forks, only the markup.

### Public API

```ts
// wiki-link.ts:40 — [[base#fragment|label]] -> {key, label, fragment?}
function resolveWikiTarget(raw: string): WikiTarget;
// wiki-link.ts:55 — every distinct linked fact key (edge-sync input)
function extractWikiTargets(md: string): string[];
// wiki-link.ts:28 — lowercase + dash-collapse non-alphanumerics
function wikiSlug(word: string): string;
// wiki-link.ts:70 — a marked inline extension, given the surface's anchor renderer
function wikiLinkExtension(renderAnchor: (t: WikiTarget) => string): { name; level; start; tokenizer; renderer };

// wiki-link.ts:17
interface WikiTarget { key: string; label: string; fragment?: string }
```

### Data model

`[[base#fragment|label]] → {key, label, fragment?}`. `#` never appears in substrate keys, so the first `#` splits target from fragment (wiki-link.ts:45). `[[#frag]]` alone keeps `key: ''` (the current document). `looksLikeKey = !/\s/.test(s) && (s.includes(':') || s.includes('/') || s.startsWith('$'))` (wiki-link.ts:38). In `extractWikiTargets`, a **key-shaped fragment** addresses the member fact directly (first-mention backlinks, ADR-0061; wiki-link.ts:61).

### Invariants & edge cases

- Dependency-free (no `marked` import): surfaces pass the extension to their own `marked.use` and supply their own anchor renderer.
- **One slug rule, one resolver**, shared by lit, the card, and edge-sync — the KEY resolution must never fork (the markup may).
- The evolved lit semantics (rich `looksLikeKey`) are adopted everywhere, not the card's stale colon-only rule (which mis-resolved `[[kb/foo]]` to `doc:kb-foo`).

**Reduces to:** `projection` + `fact`. Primarily projection — the link-resolution rule shared by every present surface, and `extractWikiTargets` is the SELECT-input for edge-sync. It also touches `fact`: the targets it extracts become substrate edges (Fact rows) that lit writes on save, and a key-shaped `#fragment` IS fact-grain addressing (ADR-0061). No new primitive — a pure string resolver feeding the projection/edge machinery, whose whole reason for existing is to **stop being forked**.

**Motivating ADRs:** ADR-0044, ADR-0038, ADR-0039, ADR-0061.

---

## 7. Shared composable React UI kit (`index.tsx`)

**File:** `platform/ui/index.tsx`

Mobile-first, inline-styled (no external CSS/build coupling), React-only presentational primitives any cell bundles into its client entry via esbuild. Exports a frozen `theme` object encoding the "park" visual language.

### Public API

```ts
// index.tsx — components
Page, Card, Heading, Badge, Button, Anchor, TextInput, Checkbox, CodeBlock, Modal
// index.tsx:16
const theme  // bg/panel/border/text/dim/accent/danger/radius/mono/sans/serif
             // + dusk/duskDeep/pine/gold/horizon/cream + shadow
```

Notable components: `Page` uses a load-bearing `gridTemplateColumns: 'minmax(0, 1fr)'` (index.tsx:58) to stop wide unbreakable content (a long URL, an inline pill) from stretching the column past the viewport on mobile; `Modal` (index.tsx:281) is a mobile-first bottom-sheet — the progressive-disclosure peek layer, closing on backdrop click and Escape; `CodeBlock` is the one deliberately dark surface ("the machine's voice"); `Checkbox` is a labelled row used for scope selection; `Button` is `primary`/`secondary`; `Badge` is `accent`/`danger`/`dim`.

### Data model

None — pure presentational props. React only.

### Invariants & edge cases

- Keep presentational and dependency-free (React only) so they stay reusable across cells.
- Inline styles, no external CSS/build coupling — any cell bundles them via its own esbuild.
- Mobile-first.

**Reduces to:** `projection` (loosely). The presentation substrate for every first-party cell surface — the concrete widgets the present stage paints with. It carries no substrate coupling, no data model, no auth. **Honest note:** this is the least "reducible" capability in the subsystem — genuinely a shared component kit, tagged to projection only because it is where projected values become pixels.

**Connections:** the **Cell axis** — each cell bundles this into its client.

**Motivating ADR:** ADR-0044.

---

## 8. `@parc/ui` virtual module — one source, no drift (`parc-ui.ts`)

**Files:** `platform/ui/parc-ui.ts`, `scripts/build-cell-runtime.mjs`

`@parc/ui` is the platform UI kit exposed as a single cell-importable module (ADR-0044 Inc 3). `parc-ui.ts` is a **barrel** re-exporting `render-hints`, `wiki-link`, `vocab`, `federated-renderer`, `form`, and `index`. `scripts/build-cell-runtime.mjs` pre-bundles it into `services/cells/cell-ui.generated.ts`, served by the forge bundler as a **virtual module** (like `@parc/runtime/cell`) whenever a cell imports `@parc/ui` — server bundle AND browser bundle, so an isomorphic cell renders the same components on both sides.

### Public API

```ts
// parc-ui.ts:18-23
export * from './render-hints';
export * from './wiki-link';
export * from './vocab';
export * from './federated-renderer';
export * from './form';
export * from './index';
```

### Data model

None — a re-export barrel bundled to a generated virtual module.

### Invariants & edge cases

- **React is EXTERNAL** in the pre-bundle: exactly one React instance per cell (server side resolves forge's disk React; client side resolves the cell's `imports.json` esm.sh pin) — or hooks break.
- **Isomorphic:** same components on both server and browser bundle.
- Intended to be THE single source, retiring the older `scripts/sync-platform-ui.mjs` committed copies (`cells/{home,starter}/shared/*`, `cells/lit/render-hints.ts`, `cells/lit/federated-renderer.ts`).

**Reduces to:** `cell` + `projection`. A packaging/distribution capability that reduces to the cell axis: it is how the projection UI primitives cross the origin-isolated cell boundary as a virtual module through the forge bundler (the UI analogue of the `describeTypes`/cell-template publish seam). No new primitive — a bundling seam.

**Motivating ADR:** ADR-0044.

> ⚠ **Coherence — "one source, no drift" is contradicted live (CONFLICT, structural).** ADR-0044 Inc 3 asserts one source with no drift, but the live tree carries **three** variants of the renderer/sandbox present stage: (a) the canonical `platform/ui/federated-renderer.ts` (re-exported via `parc-ui.ts:21`, present in `cell-ui.generated.ts`), (b) the hardened home-next fork `cells/home-next/client/federated-host.ts`, and (c) stale GENERATED sync copies under `cells/home-next/shared/` whose generator was deleted. See the callouts under capabilities 2, 4, and 5. **Recommendation:** upstream the hardening into the canonical file, re-point home-next at `@parc/ui`, and delete the dead `shared/` subtree.

---

## Live coherence summary (source-vs-deployed gaps)

Beyond the per-capability callouts, the snapshot confirms these ground-truth divergences worth tracking in a coherence audit:

- **home & home-next both ship live.** `$cells` = 17 cells; `home` (public, publishes 18 types) and `home-next` (public, publishes nothing) both with `ssrReads:['cells.describeTypes']`. home-next is a "security-hardened platform-face successor" (commit `696d805`) but is **not yet the default cell** (`DISPATCH_DEFAULT_CELL` deferred in both `index.ts`).
- **home-next is half-migrated.** Its `client` mostly imports `@parc/ui` directly (`app.tsx`, `facts.tsx`, `console.tsx`) yet keeps its own `client/federated-host.ts`, and its dead `shared/` subtree + `shared.tsx` still exist.
- **The home-next CSP hardening is an improvement the platform should absorb.** Canonical `SANDBOX_HOST_HTML` (federated-renderer.ts:184) has **no CSP meta and no `call`-arg validation**; the home-next fork adds `default-src 'none'; connect-src 'none'` (network-denied) + kind/target-length validation.
- **`workspace.graph` errors live** (`'Unhandled'`) while `workspace.edges` (ADR-0069 unified Reference projection, `similarTo` edges via platform/vectors) works — the edge-shape seam signal called out in the manifest.

---

## Gotchas / non-obvious behavior

1. **Two renderer namespaces.** Output renderers register under `window.__parcRender`; input forms under `window.__parcForm`. A single tool may declare both for one target. Don't cross them.
2. **The sandbox's `md` only escapes.** `SANDBOX_HOST_HTML`'s `md` (federated-renderer.ts:201) is `esc`, not a markdown engine — no markdown lib ships in the platform bootstrap. A renderer wanting rich markdown must bundle its own.
3. **`attachSandboxedRenderer` is render-only.** Despite `SandboxedRendererHandle` exposing `mountForm`, the `attachSandboxedRenderer` lift-out helper (federated-renderer.ts:135) never wires form-mount — use `mountSandboxedRenderer` directly (with `onFormChange`) plus `handle.mountForm` for forms.
4. **`srcdoc` set after the load listener.** The order at federated-renderer.ts:162–164 is deliberate; reversing it lets a synchronously-parsed doc fire `load` before the listener attaches.
5. **Mounts queue until `parc-ready`.** Calling `handle.render`/`mountForm` before the sandbox posts `parc-ready` queues **one** pending mount (`queued`, federated-renderer.ts:286); a second overwrites the first.
6. **`applyTemplate` returns `null` on any empty variable** — that's the mechanism for ordered handler alternatives, not an error. `${value.*}` is taken **raw** (unencoded); `id`/`key`/`match` are URL-encoded.
7. **`resolve` returns a `cellRef`, never a URL.** The consumer must call the kernel's `cellUrl` to materialise the origin — that's what makes one declaration work on apex or any subdomain for any owner.
8. **`vocab.ts` is a deliberate duplicate of the runtime type model.** It is a documented UI-side parallel, not a fork — but drift between it and the runtime type-schema silently mis-routes.
9. **`present.label` rooting differs between runtime and home.** `resolveLabel`/`resolvePath` root `value|key|meta` at the `{value,key,meta}` envelope and stringify numbers/booleans; home's local `pathInto(e.value, label)` roots at `e.value` and takes only strings. A served label like `value.title` resolves in the kernel but mis-resolves in home (masked by a fallback heuristic).
10. **`bodyText` includes `statement` in the canonical copy but not in home's local copy** — a claim renders as prose in lit, JSON/field-preview in home.
11. **`SchemaForm` never submits and holds no state.** It only emits `onChange` with a fresh `Record` each edit; the host owns the value and the Run action. `isFormable` returning `false` yields `null` (caller falls back to raw JSON); unsupported *field* shapes degrade per-field to a raw-JSON box that parses on blur and keeps invalid text.
12. **Silent degradation is the design, everywhere.** Renderers, forms, and hints all leave prior content / return `''`/`null` on failure — never throw, never blank the surface.
13. **`selectFields` caps at 6 rows × 160 chars and skips identity keys** (`content`/`title`/`name`/`id`/`src`) — a long field is silently truncated with no ellipsis (this is exactly why `statement` was promoted into `BODY_FIELDS`).