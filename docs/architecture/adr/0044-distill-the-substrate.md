# ADR-0044 — Distill the substrate: name the laws, collapse the deliveries, retire the dead rungs

- **Status:** Review complete (full ADR corpus 0001–0043 + implementation reality, 2026-07-01); contraction
  program decided and sequenced. This ADR **consolidates and supersedes the scattered open increments** of
  ADR-0038/0039/0042/0043 into one backlog (§Increments) — where an increment below covers one of those, the
  original ADR's entry is subsumed here.
  **Program progress (2026-07-01):** Inc 1 ✅ (v2 store deleted; workspace + vector-indexer on v3) ·
  Inc 2 ✅ (`buildTypeVocabulary` library; gateway rewired; cell-SDK exports it) · Inc 3 ✅ (`@parc/ui`
  virtual module in both forge bundles; `sync-platform-ui.mjs` + six copies DELETED; home/lit/starter on
  `@parc/ui`) · Inc 6 ✅ (`docs/cell-contract.md`) · Inc 7 ✅ (canvas scene, ~800 ms at 1024 MB) ·
  Inc 4 + Inc 5 open (renderer rung removal; monolith splits) · present-dogfooding half of Inc 2
  (gateway/card/kernel `hrefOf` through `resolvePresent`) rides Inc 4.
- **Date:** 2026-07-01
- **Method:** the ADR-0042 discipline at corpus scale — five parallel readers (ADRs 0001–0016, 0017–0033,
  0034–0043; tier-1 implementation; tier-2 cells), then a single synthesis. Grounded in line counts, import
  graphs, and the live findings of ADR-0042/0043, not in the vision docs.

---

## 1. The verdict, first

**The core has already contracted; the edges have not.** The 0001–0014 "breathe" program closed with a
verifiable audit (ADR-0014's grep gates): today there is exactly **one** implementation of the observed-state
pipeline, salience scoring, edge derivation, type resolution, and present resolution — all in
`platform/runtime` (`state.ts` 1,679 LOC is the single heart). The ADR-0042 survey's fear ("cells were forced
to re-implement") was refuted then and stays refuted now. **What accreted instead is peripheral:** how shared
code *reaches* cells (six mechanisms), how things *render* (a ladder with dead rungs), two client monoliths,
one legacy store, and a backlog that names the same work in three places. Distillation therefore means
**collapsing delivery, retiring rungs, and consolidating intent** — not re-architecting the core.

## 2. The three eras (what the corpus actually is)

| Era | ADRs | Character | State |
|---|---|---|---|
| **Breathe** | 0001–0014 | Name the primitives: 3 nouns (Fact/Reference/Declaration), 2 axes (Grant/Cell), the pipeline (select→score→shape→present), Resolution (`layer()`), 5 self-model surfaces (`$catalog $types $graph $grants $cells`) | **Closed, audited (0014)** — the invariant "one representation, one resolver" is verified, not folklore |
| **Inhabit** | 0015–0033 | Features + hardening on the settled substrate: frames/edges, the machine arc (0018/0019/0026/0028), the auth ladder (0021–0025), files/vectors/disclosure (0027, 0030–0033) | Shipped except two deliberate buffers (0024/0025) and known debts (§5) |
| **Project & Govern** | 0034–0043 | One declaration → every surface (conversation 0034–0038, federation 0039/0041, embeds 0043), then the governance turn: survey-before-design (0042/0043) | Converging; the remaining increments are exactly this ADR's program |

## 3. The laws that emerged (name them; stop rediscovering them)

These are the patterns the corpus keeps re-deriving, one domain at a time. Naming them converts each from a
recurring discovery into a design-time check.

- **L1 — Declare once, project everywhere (CALM).** A type's `{shape, present, handlers, manager}` is
  authored once by its managing cell; every surface (conversation card, field computer, wiki, board, embed)
  is a projection of that one declaration. Every UI ADR since 0029 is this law being re-learned in a new
  domain: reads (0029), rendering (0035/0039), forms (0041), embeds (0043). **Check:** any surface found
  hardcoding knowledge a cell's declaration could carry is a bug of this law — federate or fold it, don't
  branch the surface.
- **L2 — Authority only narrows (∩).** One algebra (`intersectScopes`) under five mechanisms: session horizon
  (0021), token-as-principal ceiling (0022), per-type families (0023), delegation chains (0024), holder
  caveats (0025). Widening requires explicit human consent. **Check:** any new credential mechanism must be
  expressible as a further ∩, or it's wrong.
- **L3 — Trust context picks the surface, and there are exactly three.** First-party page (own session),
  inert-data hint (host paints from fields — schemas/hints run no code), sandboxed `ui://` (foreign code,
  opaque origin, host-proxied data). ADR-0043's A/B/C. **Check:** rendering mechanisms must equal trust
  contexts — three, no more (this is what §4-R contracts to).
- **L4 — Structure over knobs.** New signals enter as declared *structure* the existing machinery already
  consumes (inferred `similarTo` edges feed centrality, 0031; affordances ride type declarations, 0029) —
  never as a new query-time parameter. **Check:** a proposed tuning knob should first be tried as a fact,
  edge, or declaration.
- **L5 — Verify live; the slice is the test.** Unit tests pass on 5-fact memory stores; the real slice has
  1,400+ facts, 1,158 edges, cold Lambdas, and a 128 MB CPU wall. Every load-bearing correction of the last
  three ADRs (prefix-scoped `list`, the reader-vs-query split, the scene-tool revert) was caught live, not in
  CI. **Check:** an increment isn't done at green tests; it's done at a live proof.
- **L6 — Survey before design.** 0042/0043's method — parallel readers over the actual implementations, then
  the decision — caught the corpus's single biggest wrong assumption (that reimplementation was forced). This
  ADR is the method applied to the whole.

## 4. The contraction targets (where complexity should collapse)

### 4-D. Delivery: six mechanisms for one question

"How does shared code reach a cell?" currently has **six answers**: (1) `sync-platform-ui.mjs` committed
copies (6 files, HIGH drift, manual re-run); (2) kernel browser URL-imports (reference-not-copy — good);
(3) server vendor-copies (`cells/machine/substrate.js`, drifts against kernel's canonical); (4) the
prebundled virtual module (`@parc/runtime/cell` → `cell-runtime.generated.ts`); (5) git↔live `cell-sync`;
(6) `ui://` federation for renderers. All but (5) and (6) are workarounds for **one root cause**: the forge
bundler runs inside the cells-service Lambda and cannot see the monorepo.

**Decision:** collapse to **three**, one per artifact class: **prebundled virtual modules** for server-side
platform code (`@parc/runtime/cell` today; add **`@parc/ui`** for render-hints/vocab/form/federated-renderer/
ui-kit), **kernel URL-imports** for browser client code (already the rule), **`ui://` federation** for
foreign renderers/forms (already the rule). Then **delete `sync-platform-ui.mjs` and its six committed
copies**, and retire `cells/machine/substrate.js` onto the SDK. Accepted cost (already accepted for
cell-sdk): SDK changes ride a cells-service deploy. Isomorphic wrinkle: `@parc/ui` is consumed by cell
*clients* too — the browser half rides the kernel/URL plane or the client bundler resolves the same virtual
module; decide at implementation, but the **committed-copy mechanism dies either way**.

### 4-R. Rendering: a ladder with dead rungs

The survey counted ~12 renderer/form/viewer mechanisms. The end-state, per L3, is **three**: the hint floor
(inert), inline React on first-party surfaces, sandboxed `ui://` for foreign code. Concretely that means
folding: `@c15r/viewers` ES-module-into-first-party-document imports (lit, starter demo, card build-time) →
`ui://` (0039 Inc 3 ≡ 0043 Inc 2b — the *same work*, named twice); the `_renderers/<type>` data-URI-ESM
plugin path → the `ui://` declaration (two cell-authored-renderer mechanisms is one too many); the card's
remaining lit knowledge (wiki-link resolver, doc assembly) → `platform/ui` (0038 Inc 3/4 ≡ 0039 Inc 4);
home's + lit's near-identical sandbox-host wrappers → one `platform/ui` embed component (0043 Inc 3).

### 4-T. The last wire-only vocabulary: `$types`

`buildTypeVocabulary` exists only inside the gateway, so cell SSR can't resolve `present` without a wire hop
— the one remaining forcing function for hardcoded per-cell routing (0042 Inc 2). Extract it as a library
(SDK-carried), then dogfood `resolvePresent` through gateway + card + kernel `hrefOf` (0042 Inc 3). This is
the keystone: 4-R's folds get simpler after it.

### 4-S. Stores: one DynamoDB codec, one client

`dynamo-state-store.ts` (v2 `aws-sdk`, 264 LOC) survives only because `services/workspace` and
`services/vector-indexer` still import it; cells are on v3 (shared `state-store-codec`). Migrate both
services to v3, delete the v2 store. Small, pure win; also drops the v2 SDK from tier-1 bundles.

### 4-M. Monoliths: split by the seams they already have

`cells/home/client/app.tsx` (3,350 LOC) is the platform UI as one file — auth bridge / boot-hydration /
dashboard / workspace window / identity+grants are five separable modules. `services/workspace/handlers.ts`
(3,309 LOC) is correctly *shaped* (1:1 with ObservedState) but should split along its command groups.
Canvas's client (gesture FSM + CRDT storage) is **genuinely cell-specific — leave it**; its one real leak is
local salience tier-checking in `storage.ts` that could consume the SDK's.

### 4-B. The backlog itself: consolidation is a distillation

24 open increments across 10 ADRs, with at least three duplicate namings (viewers-as-ui://, lit-logic fold,
shared embed host). **This ADR's §Increments is now the single sequenced backlog**; the per-ADR lists are
subsumed.

## 5. Deliberate non-goals (complexity we keep, debts we schedule, capital we don't spend)

- **Don't build 0024/0025** (delegation chains, caveats) until multi-agent orchestration actually demands
  them — the designs are sound buffers; building now is speculative capital.
- **Keep per-slice vector indexes** (0030) until real multiplayer; the `indexFor(scope)` seam makes it
  reversible.
- **Keep the anon `?embed=1` public fast path** (0043) — surface-B for public facts is legitimate, not debt.
- **Keep starter thin.** It's the floor (SSR + SDK read + caller-write + one type), not a catalogue. Its gaps
  vs reality are documentation work (the five-slot cell contract: reads / writes / types / renderers / tools),
  not template growth.
- **Schedule, don't ignore:** run's two-path authority (ambient DDB + scoped `parc.call`, 0028's declared
  retirement) — fold when the SDK grows a write path; cold-corpus salience (0033's honest residual).

## 6. Increments (the one backlog, cheap → structural)

1. **Kill the v2 store** — migrate workspace + vector-indexer to `createDynamoStateStoreV3`, delete
   `dynamo-state-store.ts`. *(subsumes: none; new)*
2. **`buildTypeVocabulary` as a library + present dogfooding** — extract from the gateway; route gateway,
   card, and kernel `hrefOf` through `resolvePresent`. *(subsumes 0042 Inc 2 + Inc 3)*
3. **`@parc/ui` virtual module; delete the sync script** — pre-bundle platform/ui into the forge bundler
   beside `@parc/runtime/cell`; migrate home/lit/starter imports; delete `sync-platform-ui.mjs` + 6 copies +
   `cells/machine/substrate.js`. *(subsumes 0042 Inc 3's vendor-sync concern)*
4. **Renderer rung removal** — viewers → `ui://`; retire the `_renderers/<type>` data-URI path onto the
   `ui://` declaration; card sheds wiki-link + doc assembly into `platform/ui`; one shared first-party embed
   host component. *(subsumes 0039 Inc 3/4/5, 0038 Inc 3/4, 0043 Inc 2b/3)*
5. **Split the two monoliths** — home's client into its five modules; workspace handlers by command group.
   Mechanical; no behaviour change. *(new)*
6. **The cell-contract page** — one doc naming the five slots (reads/writes/types/renderers/tools) with
   starter as the worked example; fold the scattered contract knowledge (ssr.json, types.json, `/_tools`,
   organ path, `x-parc-writes`) into it. *(new)*
7. **Canvas scene, reinstated on the raised cell tier — SHIPPED + live-verified (2026-07-01).** The 512 MB
   default + `memoryMb` knob landed (cells-service CDK deploy, run 28547218384); canvas raised to 1024 MB via
   `cells.configureCell`; the assembled `scene` read + thin v5 renderer re-landed. **Live measurement: ~800 ms
   at 1024 MB vs ~7.8–10 s at 128 MB** for the same 127-element / 346-edge board — the ~10× CPU-scaling
   prediction, confirmed. *(subsumes 0043 Inc 4/5's "bigger tier" arm)*

Each increment ends with a live proof (L5), not a green CI run.
