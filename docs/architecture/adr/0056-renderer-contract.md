# ADR-0056 — The renderer contract: one sanctioned executable path, tested

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
- **Depends on:** ADR-0012 (Present facet), ADR-0039/0041/0043 (federated
  render), ADR-0049 (capability handlers). Amends the renderer ladder in
  `docs/canvas-substrate-design.md`.

## Context (grounded — two doors, one unguarded)

The renderer ladder (fact → typed renderer → declared `ui://`) is the
substrate's answer to "apps": types carry their presentation as data. Two
execution paths exist today, and both bit us this cycle:

1. **Renderer facts** (`_renderers/<type>`, source string → dynamic module).
   No contract, no version pin, no test: the machine renderer silently
   drifted from the machine's real data shape (read `el.nodes`/`el.arrows`
   that live machines don't carry) and produced INVISIBLE elements for weeks.
   Nothing could have caught it — there is no harness a renderer runs in
   before it ships, and no error surface when mount returns an empty host.
2. **Content scripts** (`executeScriptElements`): `new Function` over element
   *content* — any `html` element's `<script>` body runs with `controller`
   in scope. The board renders agent-authored and imported facts; this is an
   XSS-shaped door held open by legacy (the pre-substrate whiteboard's
   widgets). The crash work already had to cage it (rAF throttling, gesture
   parking) — evidence it's a liability even when benign.

The canvas side gained a floor this cycle (mount/update behind try/catch →
fact-card fallback + error badge). This ADR makes the ladder trustworthy end
to end.

## Decision

**One executable path.** Renderer facts (and cell-served `ui://` modules) are
the only sanctioned code the board runs. Content scripts are retired:

- `executeScriptElements` goes behind a per-board opt-in
  (`_canvas/<cid>/settings` fact: `{legacyScripts: true}`), default OFF.
  Boards that still need a legacy widget flip the fact; everything else
  stops executing content. After a deprecation window it is removed.
- The `html` type keeps rendering markup — sanitized: `<script>` stripped,
  inline handlers (`on*=`) and `javascript:` URLs neutralized at render.

**The contract.** A renderer fact's `value` gains structure (all optional →
back-compatible):

```ts
{
  type: 'machine',
  source: '…export const view = { mount, update, unmount? }…',
  contract: {
    api: 1,                       // bumped on breaking view-API changes
    needs: ['el.title', 'rails'], // declared reads — documentation + audit
  },
  fixtures: [                     // renderable samples: the TEST
    { name: 'tending', el: { title: '…', entry: 'Audit' } },
  ],
}
```

- **View API v1 (codified, not invented):** `mount(el, ctx) → HTMLElement`,
  `update(el, dom, ctx)`, optional `unmount(dom)`. `ctx` is a *capability
  object* — `{ read, act, uid }` — replacing today's `window.__parcRead`
  globals. Renderers must not reach for `window.CC`.
- **The fixture harness:** the canvas devtools gain `verify-renderers.mjs`:
  for every `_renderers/*` fact, mount each fixture headless and assert the
  host paints non-empty (the machine-renderer failure mode becomes a CI-red).
  The cell that OWNS a renderer (`manager`) runs the same check at bootstrap
  before overwriting the fact — a drifted renderer fails to assert, not to
  render.
- **Never invisible** (already shipped, contract-ratified): a view that
  throws or mounts empty falls back to the fact card + error badge.
- **Version pin:** the canvas records `api` at registration and refuses a
  renderer whose `api` it doesn't speak, falling back to the card — a kernel
  or cell can then evolve the view API without silent breakage.

## Increments

1. Sanitize `html` rendering; gate `executeScriptElements` behind the board
   settings fact (default off); ship `ctx` into view mount/update alongside
   the window bridges (bridges deprecated, kept one increment).
2. `verify-renderers.mjs` fixture harness + fixtures for the live renderers
   (machine, mermaid, json, csv, badge, upcase, repl, style).
3. Remove the window bridges and `executeScriptElements`; machine cell's
   bootstrap runs fixture assertion before reasserting `_renderers/machine`.

## Costs & open questions

- Sanitizing `html` may break boards that relied on benign scripts (the old
  minimap). The settings-fact escape covers them; the flight recorder tells
  us if any board flips it.
- Fixtures live inside renderer facts → bigger facts. Acceptable: they are
  the renderer's spec, and card-shaped reads never fetch renderer source
  anyway.
- Open: should `ctx.read` be scope-limited (e.g. prefix-scoped to the
  fact's own subtree, `machine/<id>/*`)? Leaning yes — it makes `needs`
  enforceable rather than documentary — but that wants ADR-0055's scoping
  vocabulary, so it lands there or in a follow-up.
