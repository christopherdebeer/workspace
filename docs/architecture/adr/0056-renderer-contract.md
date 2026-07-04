# ADR-0056 — Executable surfaces: renderers AND content scripts, substrate-native

- **Status:** Inc 1 shipped 2026-07-04 (canvas v1783205081155) — `ctx` exists
  (`client/lib/sdk.ts`, api 1): substrate half (read/act/uid/titleOf/hrefOf/
  types/scoped-changes) + `board` half (id, elements-as-copies, selection,
  camera get/set/fit, place/update/remove through the outbox, on(select|
  camera)). Handed to renderer mount/update as a new trailing arg and to
  content scripts as `ctx` — `controller` stays in scope one increment.
  Harness asserts the contract (5 ctx checks in verify-edge-fixes.mjs).
  **Inc 2 shipped same day**: `verify-renderers.mjs` mounts every
  `_renderers/*` fact against its fixtures headless (facts fetched node-side,
  browser stays on 127.0.0.1); `contract {api, needs}` + `fixtures` written
  into the self-contained renderer facts (badge rev2, upcase rev2, machine
  rev7 — machine's second fixture is network-flagged, mermaid CDN). Fixture
  `reads` answer the renderer's substrate queries — which immediately caught
  the machine renderer hanging on the `window.__parcRead` bridge, the exact
  drift this ADR retires. The @c15r/viewers re-exports (mermaid/json/csv/
  repl/style) are static remote imports: classified NETWORK, verified only
  with `--network` on an open network; their fixtures belong to the viewers
  cell (manager-side assertion is Inc 3's bootstrap check).
  Inc 3 (script facts + provenance gate + bridge removal) open.
  Originally proposed 2026-07-04, **revised same day per owner feedback**:
  content scripts are NOT retired — the custom minimap is the proof that
  script-level malleability is a feature of the medium ("meta interface
  malleability"). Both executable paths stay; what changes is that they
  become substrate-native and speak ONE substrate SDK instead of reaching
  into canvas controller internals.
- **Depends on:** ADR-0012 (Present facet), ADR-0039/0041/0043 (federated
  render), ADR-0049 (capability handlers), ADR-0055 (scoped feeds — the SDK's
  change subscription). Amends the renderer ladder in
  `docs/canvas-substrate-design.md`.

## Context (grounded — two doors, neither with a contract)

Two ways user/agent code runs on a board today, and both bit us this cycle:

1. **Renderer facts** (`_renderers/<type>`, source string → dynamic module).
   No contract, no version pin, no test: the machine renderer silently
   drifted from the machine's real data shape (read `el.nodes`/`el.arrows`
   that live machines don't carry) and produced INVISIBLE elements for weeks.
   There is no harness a renderer runs in before it ships, and no error
   surface when mount returns an empty host.
2. **Content scripts** (`executeScriptElements`): `new Function` over element
   *content* — an `html` element's `<script>` body runs with the raw
   `controller` in scope. This is the malleability path — the custom minimap
   was BUILT this way, on the board, without a deploy — and that power is
   explicitly kept. But its current form couples every script to canvas
   internals (`controller`, `window.CC`, `window.__parcRead` bridges): the
   crash work had to cage it (rAF throttling, gesture parking), and any
   controller refactor silently breaks every script ever written.

The failure in both cases is the same: code runs against an accidental,
unversioned surface. The fix is not to remove either door — it is to give
both doors the same, deliberate one.

## Decision

**Two sanctioned executable paths — renderer facts (type-level presentation)
and content scripts (element-level malleability) — sharing ONE substrate
SDK.** Nothing else is in scope for board code: the window bridges and raw
`controller` exposure are deprecated and then removed.

**The SDK (`ctx`)** — what `ui://` cell modules already live like, scoped
down to a capability object and handed to both paths:

```ts
ctx = {
  // substrate half — the same verbs a cell gets
  read, act, query,                    // grant-checked, as the gateway would
  changes(scope),                      // scoped feed subscription (ADR-0055)
  uid, titleOf, hrefOf, types,         // kernel vocabulary helpers
  // surface half — the board as a CONTRACT, not a controller
  board: {
    id, elements(), selection(),       // read the scene
    camera: { get, set, fit },         // the minimap's actual needs
    place, update, remove,             // mutate via the outbox (ADR-0053)
    on(event, fn),                     // select/camera/change — no polling
  },
  api: 1,                              // versioned; bumped on breaks
}
```

- **Renderer facts** get `ctx` as `mount(el, ctx)` / `update(el, dom, ctx)` /
  optional `unmount(dom)` — the view API codified, not invented.
- **Content scripts become substrate-native**: a script is a fact
  (`script:<board>/<id>`, or an element attribute pointing at one) run with
  the same `ctx`. Inline `<script>` in `html` content keeps working through
  the migration — it is rebound to receive `ctx` instead of `controller` —
  and the canvas offers "extract to script fact" so a working inline hack
  can graduate to a named, linkable, agent-visible fact. The minimap is the
  migration's acceptance test: rewritten on `ctx.board`, it must lose no
  capability.
- **Provenance gate, not a kill switch**: scripts authored by the slice owner
  run as today. Scripts arriving from OTHER writers (imported/agent-authored
  facts) prompt once per writer per board ("Run scripts from X?") — the
  decision recorded in `_canvas/<cid>/settings`. Rendering markup is never
  gated; only execution is.
- **The fixture harness:** renderer facts gain optional `contract.api` +
  `fixtures` (renderable samples); `verify-renderers.mjs` mounts each fixture
  headless and asserts the host paints non-empty — the machine-renderer
  failure mode becomes CI-red. The cell that OWNS a renderer (`manager`) runs
  the same assertion at bootstrap before overwriting the fact.
- **Never invisible** (already shipped, contract-ratified): a view or script
  that throws falls back to the fact card + error badge.
- **Version pin:** the canvas records `api` at registration and refuses code
  whose `api` it doesn't speak (card fallback) — the SDK can evolve without
  silent breakage.

## Increments

1. Build `ctx` (substrate half from the kernel, `board` half in the canvas);
   hand it to renderer mount/update alongside the window bridges (bridges
   deprecated, kept one increment). Rebind inline scripts to `ctx`.
2. `verify-renderers.mjs` fixture harness + fixtures for the live renderers
   (machine, mermaid, json, csv, badge, upcase, repl, style); rewrite the
   minimap on `ctx.board` as the migration proof.
3. Script facts (`script:<board>/<id>`) + "extract to script fact"; the
   provenance gate for foreign-writer scripts; remove the window bridges.

## Costs & open questions

- The `board` contract is new API to design well — the minimap, the style
  script, and the repl are the three live consumers to shape it against.
  Kept deliberately small; anything they don't need waits.
- Provenance gating adds a prompt. Owner-authored scripts (the common case)
  never see it; the flight recorder tells us how often anyone else does.
- Open: does `ctx` live in the kernel (shared with every cell surface) or
  the canvas (board-specific)? Leaning: substrate half in the kernel —
  it IS the cell SDK — with `board` composed in by the canvas. That makes
  "content scripts" a general cell affordance, not a canvas special.
- Open: should `ctx.read` be scope-limited (prefix-scoped to the fact's own
  subtree)? With ADR-0055's scope vocabulary now shipped, `needs` could be
  enforced rather than documentary — follow-up once real scripts show their
  read patterns.
