# ADR-0042 — Govern the cell↔core seam (the interface is the entropy, not the core)

- **Status:** Accepted — findings + sequenced decision. Inc 0 (surface the store) shipped 2026-07-01;
  Inc 1–3 declared, not yet built.
- **Date:** 2026-07-01
- **Supersedes nothing; complements `docs/architecture/breathe.md`.** breathe.md audited the **core**
  (`services/workspace`, `platform/runtime`) and proved it reduces to 3 nouns / 2 mechanisms / 1 signal with
  one resolver each — *"is there a second resolver? is now a grep."* This ADR audits the part breathe.md never
  did: **how the twelve cells actually reach that core**, and finds the "one resolver each" invariant holds
  *inside* the core and breaks the moment a cell touches it. The complexity we've accrued is **interface-layer
  entropy**, not core deficiency.
- **Grounded in:** a broad+deep survey (2026-07-01) — one read-only audit pass per cell plus a core-side pass,
  every claim file:line-cited. This ADR is the durable record so the survey doesn't evaporate and we stop
  re-deriving it.

---

## The reversal (why this ADR exists, stated honestly)

The working hypothesis going in was: *the core's read/present/reference pipeline is welded to the workspace
handler and only reachable over the wire, so a cell running SSR in its own Lambda — or writing as an organ —
is **forced** to re-implement it against raw storage.* **The core-side audit refuted this.** Every core
primitive is an importable pure function in `platform/runtime`:

| Primitive | Location | Importable? |
|---|---|---|
| `createObservedState` (the whole read pipeline: select→score→shape→present) | `state.ts:1063` | ✅ barrel |
| `computeScore` / `scoreParts` (Salience) | `state.ts:485,493` | ✅ barrel |
| `deriveBackboneEdges` (Reference derivation) | `state.ts:715` | ⚠ **deep-path only, not in barrel** |
| `extractTypeRules` | `state.ts:637` | ✅ barrel |
| `layer` (Resolution) | `resolution.ts:17` | ✅ barrel |
| `matchesSelector` (Selector) | `selector.ts:32` | ✅ barrel |
| `resolvePresent` / `resolveLabel` (Present) | `present.ts:52,42` | ✅ barrel (**zero callers**) |
| `createDynamoStateStore` (IAM-scoped store) | `dynamo-state-store.ts:53` | ⚠ **deep-path only, not in barrel** |

The workspace handler is a **thin delegator**: `state = createObservedState(createDynamoStateStore(table))`
(`handlers.ts:145-148`), then `state.query()` / `.neighbors()` / `.members()` run the whole pipeline inside
`createObservedState`. A different Lambda *could* do the identical thing against its own IAM-scoped partition.
Cells are esbuild-bundled from their entry, so importing `platform/runtime` is trivial — the workspace and
vector-indexer services already import `createDynamoStateStore` by deep path.

So the cell-side reimplementation was **not forced. It was chosen** — reached for because nothing made the
good path the obvious one. That correction matters: it makes the fix *smaller and cheaper* than "libraryize the
pipeline" (it already is one), and it relocates the problem from the core to the **seam**.

## The inventory (all twelve cells, grounded)

| Cell | READ plane | WRITE plane | Core logic re-implemented locally | Reuse posture |
|---|---|---|---|---|
| **home** | wire (`mcpCall`→`/mcp`); SSR via forge-prefetched `event.ssrData` (never raw DDB) | wire `act` | **present/render FORK** — own `bodyText`/`HintBody`/`FieldsBody`/caps (`app.tsx:1250-1311`); `render-hints.ts` exists but is **not synced to home** | synced `vocab/ui/form/federated-renderer`; kernel-by-URL (auth only) |
| **lit** | **SSR: raw DDB (shared table) · client: wire** | wire `act` (client); SSR read-only | `edgesFrom/edgesTo/queryByType/getFact/queryPrefix`, `deriveId` ×2, `_doc/` membership scan, salience omitted, own `marked`; **no `resolve()` at all** | `render-hints` synced copy; inline hardcoded `cellUrl` |
| **canvas** | **SSR: raw DDB · client: wire** | wire `act` | membership by composition (honest-keep), edge stitching from `links`, local salience thresholds | kernel-by-URL for present+auth — **cleanest client, zero forks** |
| **input** | wire (PWA) | **organ** (Lambda) + wire `act` (PWA) | compose logic ×3, `slugify`/`isoWeekOf` ×2 | kernel-by-URL |
| **reef-writer** | none | **organ** | none (~23 lines) | none |
| **regwatch** | **own private table** | **own private table** | n/a — self-contained sub-app, *not a substrate participant* | none |
| **machine** | SSR seed (wire) + raw DDB (`substrate.js`) | **organ** | graph traversal/validate/step (by-design exec core); vendored raw-DDB client | own `substrate.js` |
| **models** | raw DDB in agent loop + own table (secrets/jobs) + optional gateway proxy | **organ** + own table | `substrate_*` = raw-DDB reimpl **with** local grant re-enforcement | own bindings |
| **run** | raw DDB (`parc.*`) + own table + gateway proxy | **organ** + gateway `act` + own table | `parc.*` = raw-DDB reimpl **without** grant filter; `parc.call` dups models' proxy | own bindings |
| **kernel** | wire (it *is* the client) | wire | **present FORK** — `hrefOf`/`titleOf` w/ hardcoded `doc:/capture/cell/canvas` cell-name fallbacks (`main.ts:437-453`); own `pathInto`/`deriveId` | *is* the shared client lib |
| **starter** | **SSR: raw DDB · client: wire** | wire `act` | `ownerNotes` raw-DDB SSR — **the template bakes the anti-pattern into every clone** | synced `ui.tsx`; kernel-by-URL |
| **viewers** | none (host-injected hooks) | none | none — pure render | host's client |

## The three findings that follow

1. **One primitive, re-implemented six times.** "Read the owner slice from raw DynamoDB" — byte-for-byte the
   same `STATE#<owner>` / `KEY#` / `gsi-type` queries as `dynamo-state-store.ts` — exists independently in
   **lit SSR, canvas SSR, starter SSR, machine's `substrate.js`, models' `substrate_*`, run's `parc.*`**. The
   code itself flags it (`substrate.js:8-13`, `run:41-42`). None import the store that already does exactly
   this — because it isn't in the barrel.

2. **Present/type resolution is forked ≥4 ways.** kernel's `hrefOf` (hardcoded cell names) · `platform/ui/
   vocab.ts`'s pure `resolve()` (synced *only* to home) · lit's inline `cellUrl` · home's *separate*
   `render-hints` fork. The intended-canonical resolver (`vocab.ts`) lives in `platform/ui`, not the kernel
   cells import; the server-pure `resolvePresent` has **zero callers** — the gateway (`service.ts:366`) and
   workspace (`handlers.ts:221`) both re-implement it inline. **The core doesn't dogfood its own Present
   primitive.**

3. **The sanctioned SSR path exists but isn't the default.** home declares `ssrReads` in `ssr.json` and forge
   prefetches as the caller (clean, no DDB). lit/canvas/starter reach *past* it to raw DDB. The good path
   exists; nothing steers new cells to it — least of all **starter, the template**, which ships raw-DDB SSR.

## The corrected root cause — four drivers, in priority order

1. **`$types` is genuinely wire-only** — the *one* real forcing function. The resolved type vocabulary is
   assembled only by the gateway's `buildTypes` (two wire hops: `cells.describeTypes` + a workspace `_types/`
   query, `service.ts:341-353`). A cell's SSR cannot resolve present/type without a gateway round-trip — which
   is exactly why lit's SSR has no `resolve()` and hardcodes routing.
2. **Barrel omission** — `createDynamoStateStore` + `deriveBackboneEdges` aren't in `platform/runtime/index.ts`.
   The store is *the single missing export* that made six cells hand-roll owner-slice reads.
3. **No canonical "cell substrate access" module**, and starter propagates raw-DDB SSR to every clone.
4. **Client React modules are source-vendored** (`sync-platform-ui.mjs` copies `vocab.ts`/`render-hints.ts`
   into cells) — a *different* category: N committed copies that drift (home's render-hints fork is this).

## Decision

Treat the seam as a first-class artifact with its own governance, mirroring how breathe.md treated the core.
**Do not** unify the essential differences (below). Address the accidental entropy in cheap-first order:

- **Inc 0 — surface the store (shipped).** Export `createDynamoStateStore` and `deriveBackboneEdges` from the
  `platform/runtime` barrel. Pure-additive, zero behaviour change; the one move that makes the good API
  *discoverable* so the six raw-DDB reimplementations become deletable. (Done 2026-07-01.)
- **Inc 1 — a canonical cell-SSR reader.** *Library half shipped 2026-07-01; cell-delivery half gated (see
  finding).* `platform/runtime/cell-reader.ts` — `createCellReader(store, scope, { typeRules?, salience? })` →
  `{ peek, query, byType, neighbors, members, graph }` over `createObservedState(store)` bound to one scope. It
  surfaces ONLY the pipeline's non-attention reads (safe under a read-only SSR IAM role — `get`/`read` write the
  trajectory and are withheld) and takes `typeRules` optionally, degrading honestly: without the vocabulary it
  still returns salience-scored facts + authored edges, but key-encoded membership (a doc's blocks) resolves
  empty — the exact `$types` dependency Inc 2 closes. Proven behaviour-preserving vs the gateway pipeline by
  `tests/cell-reader.test.ts` (7 cases, incl. the with/without-`typeRules` membership split). Store-injected, so
  it is pure/testable and a caller supplies its own DynamoDB client.
  - **Finding that reframes the second half (delivery):** a forge-deployed cell **cannot import
    `platform/runtime`** — the cell server bundler (`services/cells/transpile.ts:168`) bundles only
    `react`/`react-dom`/`scheduler` from disk and leaves every other bare import external (expected from the
    Node 20 Lambda runtime, which ships AWS SDK **v3** but the store uses **v2**). This is *why* cells hand-roll
    the pipeline, vendor `platform/ui` via `sync-platform-ui.mjs`, and import the kernel by URL — the same root
    category as driver #4, not a v2/v3 nit. So "point starter/lit/canvas at `createCellReader`" needs a
    **delivery mechanism** first, a design fork worth an explicit decision: (a) a disk-bundled *platform SDK for
    cells* — extend the bundler's `SERVER_BUNDLED` / expose a resolvable `@parc/runtime` (pairs with a v3-backed
    `StateStore` so it's Node-20-ambient); (b) publish the reader (+ a v3 store) to esm.sh / a URL a cell
    imports like the kernel; (c) source-vendor it per cell via the sync script (fast, but adds to the very
    duplication this ADR is closing, and drags in v2 aws-sdk). Recommendation: (a) — it also gives the
    `platform/ui` vendor-sync a real home and is the durable fix — but it is the biggest of the three and
    should be chosen deliberately, so the cell migrations wait on that pick.
- **Inc 2 — `$types` as a library.** Extract `buildTypes` into a `platform/runtime` form —
  `buildTypeVocabulary(store, cellsRegistry)` — so a cell's SSR can resolve present/type **without** a gateway
  hop. This is the only genuinely structural gap and the highest-leverage: it collapses lit's whole
  hardcoded-routing fork and lets SSR share the client's `resolve()`. Hardest (touches the gateway/registry
  seam); sequenced after Inc 1 gives it a home.
- **Inc 3 — one Present resolver, dogfooded.** Route the gateway's and workspace's inline present-derivation
  through `resolvePresent` (it has zero callers today). Fold kernel's `hrefOf` hardcoded cell-name fallbacks
  onto the declared `_types` handlers (delete the `doc:/capture/cell/canvas` special-cases). Sync `render-hints`
  to home (or better, retire home's fork onto the shared module) so present resolves through one path.

## Deliberately NOT consolidated (essential, not entropy)

- **The organ write path** (cell-attested provenance, IAM-pinned `Source` + `via`) — a legitimately different
  authority model from caller-authed `act`, not duplication. input/reef-writer/machine/models/run keep it.
- **regwatch's private table** — a self-contained sub-app; correctly not a substrate participant.
- **models/run private tables** for secrets/jobs — correct isolation.
- **canvas membership-by-composition** — recorded honest-keep (spatial boards have no linear `seq` to reuse).
- **machine's engine graph traversal** — that *is* its job (the execution core).
- **The client React vendor-sync** (`vocab.ts`/`render-hints.ts` copies) — arguably deliberate (forge lacks a
  library-build mode). A "document + accept, or fix when forge gains library builds" candidate, not a hole to
  patch now — except home's *divergent* render-hints fork (Inc 3), which is drift, not vendoring.

## Consequences

- The seam gains the same legibility the core has: "how does a cell read the substrate?" becomes one answer
  (`createCellReader`) instead of six, and "how does a fact resolve to present?" becomes one path instead of
  four. New cells inherit the good path from starter by default.
- Cheap-first sequencing means each increment stands alone and is independently verifiable; nothing here is
  a big-bang refactor. Inc 0 is already safe and done; Inc 1 deletes the most duplication for the least risk;
  Inc 2 is the one structural piece and is de-risked by Inc 1.
- The essential/accidental line is now written down, so future work doesn't over-correct into false uniformity
  (collapsing the organ path, or forcing regwatch into the substrate) in the name of consolidation.
