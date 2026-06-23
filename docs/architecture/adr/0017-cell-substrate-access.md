# ADR-0017 — Cell substrate access: one shared client, not a re-implementation per cell

- **Status:** Accepted (first increment shipped) — the shared client lives at
  `cells/kernel/static/substrate.js`, served at `/@c15r/kernel/substrate.js`, and
  `@c15r/machine`'s `step` tool consumes it by URL import (ADR-0018). The bridge is the
  kernel-served URL module; the published-npm-package target (below) is not yet done.
  `@c15r/models` is not yet migrated onto it.
- **Date:** 2026-06-23
- **Context:** [`docs/machine.md`](../../machine.md) §13 (known gaps) and ADR-0011's open item
  (at-least-once delivery under the depth cap). The machine cell was built **write-only**,
  hand-rolling the organ emit; resolving its reliability gap by reading state directly forced
  the question of where the shared access code lives.
- **Depends on:** ADR-0008 (Cell — `ssrReads`/`callerWrites`, the read/write axis), ADR-0013
  (Fact — the `{value, _meta}` floor a client reads/writes), ADR-0011 (Reactivity — the
  `substrate.write.requested` organ path a client emits onto).

---

## Context (grounded)

A tier-2 **cell** is a full Lambda, not a thin projection. Three facts establish the actual
(not imagined) capability surface:

1. **A cell CAN read the substrate directly.** `@c15r/models`
   (`cells/models/index.ts`) imports `DynamoDBClient`, reads `process.env.SUBSTRATE_TABLE`,
   and serves `substrate_read` / `substrate_query` straight off the table
   (`GetCommand` on `pk = STATE#<owner>`, `sk = KEY#<key>`; `QueryCommand` on a GSI). The
   IAM + env wiring is already generic: `services/cells/cell-template.ts` and
   `platform/infra/dynamic-cell-control-plane.ts` inject `SUBSTRATE_TABLE` and a scoped
   read policy into any dynamic cell that is provisioned with a `substrateTable`.

2. **A cell writes only via the organ path.** Both `models` and `machine` hand-roll an
   EventBridge `PutEvents` with `DetailType: 'substrate.write.requested'` — the
   provenance-attested write path (ADR-0011). This is the one real discipline: a cell never
   `PutItem`s state; it *requests* a write and the workspace applies it with attribution.

3. **The two are re-implemented per cell.** `models` and `machine` each carry their own
   copy of "construct a DDB client", "shape a `STATE#/KEY#` key", "emit a write request".
   The machine cell, built write-only, simply *omitted* the read half — which is the root of
   its eventually-consistent join barrier (it must delegate sibling-aggregation to a model
   because it cannot read the children itself).

So the capability is proven and the wiring is generic; what is missing is a **single shared
client** so cells stop copying DDB plumbing, and so the machine cell gains reads.

### Two false constraints this ADR retires

Earlier design notes asserted, wrongly, that *"a cell cannot read the substrate"* and *"cells
must be dependency-light (no cel-js, no npm deps)."* Both are false: `models` reads directly,
and cells already declare npm deps (`client/imports.json`) and import ESM URLs freely (mermaid,
`@c15r/kernel/app.js`). The engine header comment in `cells/machine/engine.ts` that repeated
the read myth is corrected alongside this ADR.

## Decision

Define **one substrate client** — a small, pure-Node module exposing the four verbs a cell
needs over the `{value, _meta}` floor:

| verb | mechanism | provenance |
|---|---|---|
| `read(key)` | `GetCommand` on `STATE#<owner>` / `KEY#<key>`, superseded-aware | observe |
| `query({type?, prefix?, tag?, limit?})` | `QueryCommand` on the typed/prefix GSI | observe |
| `emit(writes[])` | `PutEvents` `substrate.write.requested`, **one entry per write** | attested |
| `supersede(key)` | `emit` of a tombstone write (never a hard delete — ADR-0013) | attested |

`read`/`query` are the generalisation of what `models` already does; `emit`/`supersede` are
the generalisation of the hand-rolled organ emit, with the **`FailedEntryCount` check** the
current `platform/runtime/events.ts` omits (the silent-drop half of ADR-0011's gap) folded in
once, here, instead of never.

### Where it lives — packaging

The cell bundler (`services/cells/transpile.ts`) resolves relative imports **only within the
pushed cell directory**, fetches declared bare imports from esm.sh (`?target=node`), **and
bundles direct `https://` URL imports by fetching them at build time** (transpile.ts:266) — a
URL module's own bare imports (`@aws-sdk/*`, `node:*`) stay `external`, runtime-provided
(transpile.ts:280). It cannot reach a sibling `../_shared/` or a repo-local path. That gives
three real options:

1. **Published npm package (target).** Publish the client (e.g. `@c15r/substrate`), declare it
   in each cell's `client/imports.json`, import by bare specifier. The server bundler resolves
   it via esm.sh exactly as it does for `react`; client and server stay version-pinned. The
   destination — removes the snapshot/deploy-order coupling of the bridge below.
2. **Kernel-served URL module (the chosen bridge).** The client lives at
   `cells/kernel/static/substrate.js`, served verbatim at `https://parc.land/@c15r/kernel/substrate.js`.
   A cell imports that URL; the bundler fetches and inlines it at the cell's build. This is the
   **same mechanism cells already use for the browser kernel** (`@c15r/kernel/app.js`), so the
   kernel cell becomes the home for shared client code — server module beside browser module —
   which is exactly the "reusable in the kernel" intent. The kernel handler stays a static file
   server; the served JS is plain ESM (no DOM), so the browser-only objection doesn't apply to a
   *separate* server entry. Cost: consumers **snapshot** the module at build time, so an update
   means redeploy-kernel-then-rebuild-consumers, and there is a deploy-order edge (kernel must
   serve `/substrate.js` before a consumer rebuilds).
3. **Copy into the cell directory.** A `cells/<name>/_shared/substrate.ts` bundled with the cell —
   zero platform change, but duplicated per cell. Rejected in favour of (2): one served copy beats
   N vendored copies, and (2) reuses the proven URL-import path.

We ship (2) now (so ADR-0018 is unblocked), authored as the extractable module, and migrate to
(1) once published.

### What this is not

It is **not** a second write path. Writes still go through the organ (`substrate.write.requested`)
and are still applied by the workspace with provenance — the client is a typed convenience over
the same EventBridge emit, not a `PutItem` bypass. It is **not** the tier-1 `StateStore`
(`platform/runtime/dynamo-state-store.ts`): that is the workspace's authoritative applier; this
is the *caller-side* read + write-request helper a cell holds.

## Consequences

- **Enables ADR-0018.** The stateless stepper needs to read `machine/<m>` and the run/children
  facts and emit one advanced run write — i.e. exactly `read`/`query`/`emit`. The deterministic
  join barrier (read the children, advance the parent in-process) becomes possible because the
  cell can finally read.
- **Closes half of ADR-0011's gap at the source.** `emit` checks `FailedEntryCount` and retries;
  the silent-drop-under-burst failure mode stops being per-cell luck.
- **Removes duplication across 7 cells** (strangler-fig): `models` and `machine` first, then the
  rest as they need reads.
- **Cost:** a published package adds a release step to the dependency graph; until then the
  bridge copy must be kept in sync by hand (mitigated by it being one small module).
- **Open:** whether `query`'s pagination/cursor surface should match `workspace.query`'s exactly
  (so a cell and the gateway speak one query dialect) — deferred to the package extraction.
