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

## Outstanding / next

- **Implicit type/renderer/view backbone** (raised in review): weak-but-typed
  facts elide partly because they have 0 `centrality`. A derived backbone — treat
  a fact's `type`/renderer/view membership as virtual edges in `neighbors`/
  centrality — would give every typed fact a structural floor and navigability
  (type → its instances) without write amplification, while `attention().unlinked`
  is redefined to mean "no *authored* edge." Designed, not yet built.
- `neighbors`/`attention` still score on instance defaults (not the per-scope
  config); fine for now (incidental scoring), worth aligning if it matters.
