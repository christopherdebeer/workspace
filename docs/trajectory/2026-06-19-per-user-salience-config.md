# 2026-06-19 — Per-user salience config: tuning recall without a redeploy

Continues the salience arc from `2026-06-15-legacy-import-salience-tuning-and-lenses.md`.
Branch `claude/parc-recall-tuning-0i6db5`.

## The problem (measured against the live `c15r` slice)

`workspace.recall` was a data dump: a single call returned **1.76 MB / 1,096 facts
in full**. The shaping defaults (`focusThreshold 0.5`, `elideThreshold 0.1`,
`elision:"auto"`) only stub the bottom tier — so the whole **peripheral band
(0.1–0.5) arrives in full**. The live distribution (1,137 facts):

```
focus  (≥0.5)            73
peripheral (0.1–0.5)   1023   ← all delivered in full = the dump
elided (<0.1)            41
```

925 of the peripheral facts sit in the 0.1–0.3 salience noise band. Raising the
elide threshold to meet focus collapses them to lightweight `{key,type,score}`
stubs (still discoverable via `expand`/`peek`/`query`), without touching content:

```
focus/elide threshold   0.5→73   0.6→33   0.62→24   0.65→15   (cumulative, from top)
```

A live `recall { salience:{ focusThreshold:0.62, elideThreshold:0.62 } }` confirmed
**1.76 MB → 205 KB (−88%)**: focus 24, peripheral 0, elided 1,113 stubs. The right
content (projects/concepts/protocols/sources, score ~0.73) leads. Note: even 25
facts via `query` came to 99 KB because a few KB docs are 10–15 KB each — **payload
is dominated by content size, not count**, so the count knob has a floor.

## What shipped — `_config/salience`, the substrate-native per-user knob

The previous tuning round moved global weights via **redeploy** and added per-call
**lenses/override**. Neither is a *standing* per-user default: every recall had to
re-pass the override. The substrate-native answer is a **fact**, not a flag — a
reserved `_config/salience` fact in an owner's slice whose value is a
`Partial<SalienceOptions>` (e.g. `{ focusThreshold: 0.62, elideThreshold: 0.62 }`).
It layers in as the **base**, below the lens and per-call override:

```
instance defaults  ←  _config/salience (per user)  ←  lens  ←  per-call salience
```

So an owner sets their own focused default once; a lens or explicit `salience`
still overrides it for a one-off read. Activates the instant the fact is written —
no redeploy.

### Implementation (`platform/runtime/state.ts`, `services/workspace/handlers.ts`)

- `SALIENCE_CONFIG_KEY = '_config/salience'` + `parseSalienceConfig(value)` — a
  defensive whitelist (known numeric fields only; non-finite/negative dropped;
  thresholds clamped to [0,1]; accepts a bare options object or a `{ salience }`
  envelope). Malformed/missing → `null` → instance defaults. A config fact can
  never break a read.
- `read` and `query` load their scope's config themselves; the scopeless `shape`
  (which is where `recall` actually applies the tiers over the merged own+granted
  view) takes it via a new `ReadOptions.salienceConfig`.
- `recall` loads the **viewer's** config once and threads it through every slice
  read **and** the final shape — so granted slices are scored and tiered under the
  *viewer's* policy, not each owner's, keeping one coherent ranking.
- New `ObservedState.salienceConfig(scope)` exposes the resolved policy (recall
  uses it; also a readback for tooling).
- `recall`'s MCP description now documents the knob so agents discover it.

Precedence, override-still-wins, and query parity are covered by tests in
`tests/state.test.ts` (16 in the file; 265 suite-wide green).

## Usage

```jsonc
// one-time, in your own slice:
act("workspace.remember", { key: "_config/salience",
    value: { focusThreshold: 0.62, elideThreshold: 0.62 } })
// from then on, plain recall is the focused ~24-item view; the rest are stubs.
read("workspace.recall")
```

`query { rankBy:"salience", limit:25 }` remains the bounded, cursor-paged primitive
for iterative exploration; `neighbors(key)` is the item-focused latent-space walk.

## Derived structural backbone (shipped, same branch)

Weak-but-real facts (the `_types/*` vocabulary, fresh captures) score
`centrality: 0` and hug the elision floor purely because no one has *authored* an
edge to them. But a fact is never structurally alone — so the runtime now
**derives** the implied edges at read time (pure, never stored), conditioned on
the target fact existing so a backbone edge can't dangle:

- `fact —instanceOf→ _types/<type>` — every typed fact;
- `_types/<type> —managedBy→ <cell>` — matched via the type-decl's `manager`
  against `cell` facts' `address`/`name` (so `@c15r/lit` ↔ `/@c15r/lit` ↔ `lit`);
- `_types/<type> —rendersWith→ _renderers/<type>`;
- `fact —inView→ _views/<id>` — for any view whose `query` (type/tag/prefix)
  selects the fact (unfiltered views are skipped — they'd select everything).

These fold into `centrality` (so a typed-but-unauthored-linked fact earns the
degree-1 floor, 0.2, and the `_types/*`/cell facts become the hubs they always
were) and surface in `neighbors` flagged `derived:true` — every fact now has a
direction to explore (its type → its cell → its siblings). The **authored** graph
is untouched: `links`, `changes`, and `attention.unlinked` stay authored-only, so
the "this fact isn't woven into your thinking yet" tending signal survives — the
backbone is structure, not a substitute for authored connection.

`deriveBackboneEdges` is exported and unit-tested (fact→type, type→cell across the
slash-normalised handle, type→renderer, fact→view, no-dangle, unfiltered-view
skip, the centrality floor, `neighbors` surfacing, and authored-only `unlinked`).

### Cell-managed types — the general seam (canonical, not per-slice)

`cells.describeTypes` already stamps `manager` (the declaring cell's address) on
every cell-declared type — the canonical vocabulary `docs/type-vocabulary.md`
describes. So "cells declare their manager on deploy" is *already true* at the
registry; the only missing wire was the runtime backbone consuming it. The
workspace handlers now fetch that canonical **type→manager** map
(`cells.describeTypes`, process-cached 60s, `workspace.allow(cells)` already
granted) and pass it into `read`/`query`/`neighbors`; `deriveBackboneEdges` takes
a slice type-decl's own `manager` when set, else the canonical map. No per-slice
backfill, no `types.json` change — any cell that declares the types it manages
makes its facts walk to it.

**Virtual type anchors.** Most cell-managed *content* types (`doc`, `note`,
`capture`, `machine-node`…) are canonical-only — no `_types/<type>` fact in the
slice. So `instanceOf` is emitted **even when the anchor isn't materialised** (the
anchor is a well-known node), and the anchor→cell/renderer bridge is derived for
every type that appears, not just materialised type-decls. That's what lets a
`doc` fact reach `_types/doc → @c15r/lit` with neither anchor nor manager stored
in the slice. Edges to *real* targets (cell, renderer, view) still require the
target to exist, so nothing dangles.

Verified live (deploy #205, branch head): `neighbors("_types/cell")` returns all
16 cells as `derived instanceOf` edges, and under the `connected` lens the
`_types/*` facts moved from `centrality 0` / score 0.167 to `centrality 0.8–1.0` /
score ~0.52 — the weak vocabulary became the hubs it always implied.

## Census: managed / unmanaged / undeclared types

Catalogued live at `kb/type-vocabulary-census` (substrate), three tiers from the
distinct fact-types (35) ⨯ canonical `$types` (24 declared):

1. **Declared + managed (12):** 11 to a cell, `claim`→`platform`.
2. **Declared + unmanaged (12):** 5 pure viewers (`csv/json/mermaid/repl/style` →
   should adopt `@c15r/viewers`), 3 cell-owned-but-undeclared (`log`→lit,
   `canvas-element`→canvas, `output`→run), 4 platform built-ins (`action/view/
   audit/cell` → explicit `"platform"` manager like `claim`).
3. **Undeclared entirely (21)** — facts exist but there's no `_types/<type>` and
   it isn't canonical. This is the real gap and it's the *content*: the legacy KB
   corpus (`knowledge` 72, `decision` 54, `todo` 42, `project` 38, `question` 38,
   `concept` 21, `pattern`/`source` 13…), the system meta-types (`type-decl` 13,
   `renderer` 8, `subscription` 4), and cell outputs (`agent-run`, `transcript`).
   Even `type-decl` (the type *of* the `_types/*` facts) and `renderer` are
   undeclared. The backbone already rescues them in the **graph** (every typed
   fact gets `instanceOf → _types/<type>` via a virtual anchor — the census fact
   itself, brand-new and unlinked, scored `centrality 0.2` on write), but they
   carry no icon/label/handler/manager, so they're opaque to surfaces and agents.

The fix is a `_types/<type>` declaration per undeclared type — the worklist the
census fact enumerates with suggested managers.

## Outstanding / next

- `neighbors`/`attention` still *score* on instance defaults (not the per-scope
  salience config); fine for now (incidental scoring), worth aligning if it matters.
- Unmanaged types (the catalogue) want a home: either a `platform`/`viewers` cell
  adopting them, or an explicit "built-in" manager so the vocabulary is complete.
