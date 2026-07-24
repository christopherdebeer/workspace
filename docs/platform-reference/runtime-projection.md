# Runtime — Projection / Read Pipeline

## What this subsystem is

This subsystem is the **Projection** core primitive made concrete. Projection is
the single read pipeline every workspace read command is a preset of:

```
select → score → shape → present
```

- **`select`** — one structural predicate (`matchesSelector`, ADR-0011) over a
  Fact's indexable `{type,tags,key}`, plus the derived Reference backbone
  (`deriveBackboneEdges`) that turns that same predicate into edges.
- **`score`** — a 7-signal Salience blend (`computeScore`/`scoreParts`, ADR-0006)
  materialized from per-fact actor-classed touch counters and graph degree,
  parameterised by lenses resolved through Resolution (ADR-0010/0078).
- **`shape`** — salience tiering + elision (`shapeEntries`, ADR-0004) and, at the
  command boundary, the refs/card/full altitude ladder (`shape.ts`, ADR-0048).
- **`present`** — the Affordance resolution. The *named* stage is `resolvePresent`
  (ADR-0012), but it has **no live server caller**; the deployed present stage is
  `affordancesForTypes` (ADR-0029).

On top sit the **read presets** (recall/query/peek/changes/one-read,
ADR-0033/0071) and the **edge-query presets**
(neighbors/graph/members/links/edges/walk, ADR-0069/0075). **PCA 2D/3D semantic
projection** (ADR-0047/0082/0083) is a separable numeric capability that lays out
the home graph in meaning-space.

**Role relative to the cores.** Everything here compounds on `projection` (which
itself reads `fact`-stored rows). The read side has a *second* mechanism beside
Projection: **Resolution** (`layer`, ADR-0010), the layered per-facet merge that
backs the type vocabulary, the backbone's effective rules, and salience config.
The present stage's live path reduces additionally to `cell` (declarations come
from `cells.describeTypes`), and the graph read's failure mode reduces to
`edge-http` (the CloudFront 30s / Lambda 6MB realisation ceiling).

Two live coherence signals ground the audit:

> ⚠ **Coherence — the whole-projection read is unbounded in compute.** The
> `workspace.graph` verb that first exposed this is now retired (ADR-0069), but the
> shape underneath it is unchanged: an unbounded whole-projection read (29,018 edges
> in c15r's scope) exceeds the CloudFront 30s / Lambda 6MB ceiling. `scopeEdges`
> (`services/workspace/shape.ts:146`) bounds response *size* after materialization,
> not compute — so paged `workspace.edges` works and an unbounded one does not.
> The gateway's `$graph` sentinel now passes a skim limit and a delivered-bytes
> guard, which protects the membrane but not a direct caller.
> **Recommendation:** streaming the state layer, not paging, is the real fix
> (`shape.ts:140-145` says so explicitly).

> ⚠ **Coherence — `resolvePresent` has no live caller.** The named ADR-0012
> present stage (`platform/runtime/present.ts:52`) is only re-exported and
> unit-tested; the shipped present stage is `affordancesForTypes`
> (`services/workspace/shared.ts:115`). Detail in that capability's section below.

---

## 1. The one structural Selector (select-stage predicate)

**What it does.** `matchesSelector` is the single structural predicate every
`select` shares. A Collection/View's intensional membership, `query`'s
tag/prefix filter, a Subscription's `match`, and the derived `inView` backbone
edge all route through it, so "matches a view", "matches a query", and "triggers
a subscription" can never structurally drift. CEL (`match.cel`) is a richer
subscription-side clause layered *on top*, kept in the service layer where its
evaluator lives.

**Public API** (`platform/runtime/selector.ts`):

```ts
interface Selector  { type?: string; tag?: string; tags?: string[]; prefix?: string }
interface Selectable { key: string; type?: string | null; tags?: string[] }
function matchesSelector(fact: Selectable, sel: Selector): boolean   // selector.ts:36
```

**Data model.** Reads a Fact reduced to `{key, type, tags}`. `tag` (singular) is
all-of; `tags` (plural) is match-any / any-of. An `undefined` constraint is
silent (matches). `prefix` is a `key.startsWith`.

**Invariants & edge cases.**
- Empty selector matches everything — callers that treat "unconstrained" as too
  coarse guard that themselves (`selector.ts:34-35`).
- `type`/`tag`/`tags`/`prefix` are ANDed; within `tags[]` it is OR
  (`selector.ts:37-41`).
- Dependency-free — no CEL, no evaluator.
- `tags` plural exists because a `query{tags:[…]}` used to be a silently-ignored
  unknown arg that returned the whole slice (wave-4 W4i, `selector.ts:19-22`).

**Reduces to** `projection` — this IS Projection.select's structural floor: the
shared kernel that recall/query/members/subscriptions all specialise.

**Connections.** Live callers: `query()` in `state.ts:1832` (tag/prefix; `type`
is index-served via `listByType` at `state.ts:1822`, so intentionally omitted);
`deriveBackboneEdges` `inView` (`state.ts:1081`); `subscriptions.ts:180`;
`members()` intensional path via `api.query` (`state.ts:1966`).

**ADRs.** ADR-0011 (the one structural predicate), ADR-0004
(select→score→shape→present), ADR-0005 (the type/tag vocabulary).

> ⚠ **Coherence (selector-predicate · compounds).** All three primary
> membership/query/subscription-match sites genuinely funnel through the single
> `matchesSelector`: `state.ts:1832` (query candidate filter), `state.ts:1080`
> (backbone `inView`), `subscriptions.ts:180` (subscription match, CEL layered on
> top). This is the intended convergent shape — no fork. The subscription's
> `keyPrefix→prefix` rename is a thin documented adapter (`selector.ts:23`), not a
> divergence.

---

## 2. The derived Reference backbone (select over edges)

**What it does.** `deriveBackboneEdges` computes virtual, never-persisted edges
implied by a scope's own facts:
- `fact → _types/<t>` (`instanceOf`) — emitted **even when the anchor is
  virtual**, the floor that lifts every typed-but-unlinked fact off centrality 0;
- `type → managing cell` (`managedBy`);
- `type → _renderers/<t>` (`rendersWith`);
- `fact → view` (`inView`, via `matchesSelector`);
- embedded ref-field edges and key-encoded `keyEdges` from resolved type rules.

Edges carry graded strengths (authored 1.0 > embedded 0.6 > membership 0.4 >
structural 0.2, ADR-0009). This is the `select` stage for
neighbors/graph/members and the **sole structural feed to centrality**.

**Public API** (`platform/runtime/state.ts`):

```ts
function deriveBackboneEdges(records, typeRules?): AnnotatedEdge[]   // state.ts:1014
function extractTypeRules(t: Type): TypeRules                       // state.ts:936
const BACKBONE_RELS = { instanceOf, managedBy, rendersWith, inView } // state.ts:880
const MEMBERSHIP_RELS = new Set(['inView','inDoc','onBoard','memberOf']) // state.ts:891
type AnnotatedEdge = EdgeRecord & { derived?: boolean; source?: string }
```

**Data model.** Emits `{scope, from, rel, to, strength, createdAt:'',
writer:null, derived:true, source?}`. `keyPattern` is compiled to a regex; when a
placeholder can't bind from the key (nested doc slugs — the 2026-07-12
lit-doc-empties incident) it falls back to a same-named field on the fact's
`value`. `source` carries the placing decoration key so extensional membership
can recover its narrative sequence.

**Invariants & edge cases.**
- Derived edges are timeless (`createdAt:''`) and flagged `derived:true`; never
  persisted.
- `instanceOf` is emitted even to a *virtual* (unmaterialized) anchor
  (`state.ts:1076`); edges to other targets require the target to exist (never
  dangle).
- `effectiveRules = layer(canonical typeRules, slice _types/<t>)` — Resolution
  per facet, slice wins.
- Centrality reads the WHOLE projection (authored ∪ derived) — the ADR-0006
  locked invariant.

**Reduces to** `projection` + `fact` — a projection over Fact-stored rows: it
reads live records + `_types/<t>` facts + cell facts and DERIVES edges at read
time rather than storing them, keeping the authored graph clean. It is select's
edge form (projection) and its anchors/managers are facts (fact).

**Connections.** Feeds `computeScore`'s centrality term (via `buildSignals`); is
the substrate for every edge-query preset (§10); consumes `resolution.layer`,
`type-schema.resolveType`/`extractTypeRules`, and `cells.describeTypes`
typeRules.

**ADRs.** ADR-0003 (the Reference model), ADR-0009 (graded edge strengths),
ADR-0006 (centrality reads the whole projection), ADR-0005, ADR-0057.

---

## 3. The score stage — the 7-signal Salience blend

**What it does.** `computeScore`/`scoreParts` blend seven signals: **recency**
(exp decay, default 7d half-life), **velocity** (recent writes, burst window),
**attention** (recent reads), **standing** (saturating log of lifetime
reads+writes incl. import seeds), **centrality** (saturating log of weighted
graph degree), **relevance** (cosine to a stated intent, ADR-0051), **reward**
(persisted earned salience, ADR-0070). A per-type prior (ADR-0050) multiplies
**only the ambient terms**; relevance and reward ride unprioered. Materialized
(ADR-0050): activity comes from per-fact actor-classed touch counters + a
burst-window bucket (scoring never scans the trajectory); degree comes from
`buildSignals` over authored ∪ derived edges.

**Public API** (`platform/runtime/state.ts`):

```ts
function computeScore(args, s: ResolvedSalience): number             // state.ts:765
function scoreParts(args, s: ResolvedSalience): ScoreParts           // state.ts:773
function buildSignals(events, edges, nowMs, windowMs): Map<string,KeySignals> // state.ts:813
function touchSignals(rec, nowMs, s)                                 // state.ts:716
interface ScoreExplain / ReadOptions.explain
```

**Data model.** The exact blend (`state.ts:799-808`):

```
score = clamp01(
  prior * (recW*recency + velW*velocity + attW*attention + stdW*standing + cenW*centrality)
  + relW*relevance + rewW*reward )
```

Default weights: recency `.35`, velocity `.10`, attention `.15`, standing `.30`,
centrality `.10`, relevance `0`, reward `0`. Touch counters `{hr,hw,ar,aw,pr,pw}`
(human/agent/platform × read/write); degree is weighted (`edge.strength ?? 1`).
`standing` and `centrality` are `log1p`-compressed toward their saturation
(`state.ts:784,787-788`). `_meta` exposes score/velocity/standing/centrality
(+relevance/reward when set), and `_meta.explain {signals,weights,contribution,
degree,prior}` under `explain:true`.

**Invariants & edge cases.**
- Weights should sum ≤1 so score stays in `[0,1]` and thresholds keep meaning.
- The type prior scales ONLY the ambient terms (ADR-0052: a demoted capability
  type lifts at full strength when an intent names it, via unprioered relevance).
- Actor-class touch weights default human `1` / agent `0.25` / platform `0` —
  machinery churn no longer manufactures salience.
- `standing` folds import `seedReads`/`seedWrites` into cumulative (never the
  window), so a ported fact shows earned importance without faking activity.
- Scoring is touch-free (a scope-wide read is not per-fact attention).

**Reduces to** `projection` + `fact` — this IS Projection's score stage, a pure
function of fact-resident state (actor-classed touches/window counters and
reward/seed priors ADR-0050 materialized onto each StateRecord) plus the derived
graph. Not a separate primitive.

**Connections.** Consumes `deriveBackboneEdges` (centrality feed), fact
actor-classed touch counters, the relevance map (ADR-0051, wired by the read
presets §9). Feeds the shape stage's thresholds (§4).

**ADRs.** ADR-0006 (Salience), ADR-0050 (materialized signals + type prior),
ADR-0051 (relevance/intent), ADR-0070 (reward), ADR-0009, ADR-0052.

---

## 4. Salience parameter resolution — lenses, config, intent preset

**What it does.** `callSalience` resolves per-read scoring params as a Resolution
stack: `defaults ← _config/salience ← lens ← per-call override`. Five compiled
lens presets (recent/connected/durable/active, plus identity `salience`) are the
**never-shadowable FLOOR**; slices declare more via a `_config/lenses` fact
(ADR-0078). `INTENT_PRESET` (ADR-0051) is the weight shift a read gets when it
states text. `parseSalienceConfig`/`parseLensesConfig` are defensively sanitized
so a config fact can bias a read but never break one. Lensing **recomputes the
score**, so it shifts BOTH ranking and the focus/peripheral/elided tiers (unlike
`rankBy`, which only reorders).

**Public API** (`platform/runtime/state.ts`):

```ts
function callSalience(base, lens?, override?, declared?): ResolvedSalience  // ~state.ts:683
const LENS_PRESETS: Record<SalienceLens, Partial<SalienceOptions>>          // state.ts:636
const INTENT_PRESET: Partial<SalienceOptions>                               // state.ts:662
const SALIENCE_CONFIG_KEY = '_config/salience'                              // state.ts:528
const LENSES_CONFIG_KEY   = '_config/lenses'                                // state.ts:539
function parseSalienceConfig(value) / parseLensesConfig(value)
type SalienceLens
```

**Data model.** `_config/salience` fact value = `Partial<SalienceOptions>` (or
wrapped under `{salience}`). `_config/lenses` fact value = `{<name>:
Partial<SalienceOptions>}`. Only finite non-negative numerics survive; thresholds
clamped to `[0,1]`; `typePriors` capped at `TYPE_PRIOR_MAX=2` (`state.ts:564,593`);
floor lens names dropped from declared presets (`state.ts:618`).

**Invariants & edge cases.**
- Compiled floor lens names are never shadowable by a slice's `_config/lenses`
  (`state.ts:618` — "the floor wins").
- Unknown lens name is ignored, never fatal.
- A malformed/absent config fact yields `null` and the read proceeds on instance
  defaults.
- `recall` folds granted slices under the VIEWER's config + lenses, never each
  owner's.

**Reduces to** `projection` + `fact` — configures the score stage (projection)
AND a lens/config is itself a Fact at a reserved key (`_config/salience`,
`_config/lenses`) — "config, not code", the same substrate-native seam the type
vocabulary uses (fact). Resolution (ADR-0010) is the merge discipline it borrows.

**Connections.** Reads `_config/*` rows through the state store
(`state.ts:1482,1493`); borrows `resolution.layer` discipline; feeds
`scoreParts`.

**ADRs.** ADR-0078 (slice-declared lenses), ADR-0051 (intent preset), ADR-0010
(Resolution), ADR-0006, ADR-0074.

---

## 5. The shape stage — salience tiering + elision

**What it does.** `shapeEntries` tiers an already-scored entry set into **focus**
(≥`focusThreshold`, default `0.5`) / **peripheral** / **elided**
(<`elideThreshold`, default `0.1`). Below the elide threshold the whole entry is
withheld (not just its value) and collapsed to an `ElidedStub {key,type,score}`
under `elided`, score-descending — a shaped read costs attention proportional to
what it surfaces. `expand[]` forces keys to focus; `elision:'none'` returns
everything. Pure and scope-free, so `recall` can assemble a view from several
slices (own + granted) and shape the whole thing once under the viewer's policy.

**Public API** (`platform/runtime/state.ts`):

```ts
function shapeEntries(entries, opts?, sCall): ReadResult
function tierFor(score, s): Tier
ObservedState.shape(entries, opts)
interface ElidedStub { key: string; type?: string; score: number }
interface ShapingSummary / ReadResult
```

**Data model.**

```ts
ReadResult = {
  entries: Record<key, Entry>,
  elided?: ElidedStub[],
  _shaping: { focusThreshold, elideThreshold, elision, lens?,
              counts: { focus, peripheral, elided, total } }
}
```

Live c15r bands: focus `442` / peripheral `4789` / elided `1278`.

**Invariants & edge cases.**
- An elided entry is withheld whole, collapsed to a stub — `expand[key]`/`peek`
  restores it.
- `shape()` is pure (does not mutate input) and scope-free (takes
  `salienceConfig` explicitly).
- Stubs sorted score-descending.
- A lens in `shape()` only adjusts thresholds — it cannot recompute scores
  without the scope's signals.

**Reduces to** `projection` — this IS Projection's shape stage: a pure tiering
pass over score-stage output, sharing `tierFor` with the same `ResolvedSalience`
thresholds the score stage resolved.

**Connections.** Consumes `scoreParts` output and `callSalience`-resolved
thresholds; consumed by every read preset (§9). The command-boundary altitude
ladder (§6) is orthogonal to this tiering.

**ADRs.** ADR-0004 (the pipeline), ADR-0006 (Salience thresholds), ADR-0033
(progressive disclosure), ADR-0079.

---

## 6. Read-surface altitude shaping (refs/card/full)

**What it does.** The command-layer shape ladder (ADR-0048):
- **`refs`** — key + salience-essential `_meta`, no value.
- **`card`** — value with long strings truncated to 240 chars and structure
  summarised to depth 2, `_meta` whole.
- **`full`** — as stored.

`orientEntry` is the leaner overview tier (card value + refs `_meta`). Shaping is
presentation, never authority — it narrows what is SENT, not what may be read;
`peek`/`shape:'full'` always restores the whole fact. `_meta.shaped` marks a
truncated body. `scopeEdges` applies the analogous keys/rels/limit/cursor + thin
edge shape to edge reads.

**Public API** (`services/workspace/shape.ts`):

```ts
function shapeEntry / shapeEntryList / shapeEntryMap(e, shape)  // shape.ts:70,91,97
function cardValue(v, depth = 0): unknown                       // shape.ts:34
function orientEntry(e)                                         // shape.ts:86
function scopeEdges(edges, input): {edges, total, nextCursor?}  // shape.ts:146
type ReadShape = 'refs' | 'card' | 'full'                       // shape.ts:21
interface ThinEdge { from; rel; to; derived? }                  // shape.ts:129
```

**Data model.** `CARD_STR=240`, `CARD_DEPTH=2`, `CARD_LIST=12`, `CARD_FIELDS=24`
(`shape.ts:24-28`). `refsMeta` keeps `{type,tags,score,updatedAt,superseded,
relevance?,shaped:'refs'}` (`shape.ts:57-68`). `scopeEdges` returns `{edges,
total, nextCursor?}`; `edgeShape:'thin'` drops `scope`/`strength`/`createdAt`/
`writer`/`score`/`source` (`shape.ts:136-138`).

**Invariants & edge cases.**
- Shaping narrows what is sent, never what may be read.
- Expanded keys and `peek` always come back full.
- `card` preserves label paths (`value.title`/`name`/first line) so present-stage
  labels still resolve on a shaped value (`shape.ts:30-33`).
- `scopeEdges` bounds response SIZE not compute — a projection large enough to
  time out the computation needs streaming, not paging (`shape.ts:140-145`).

**Reduces to** `projection` — a refinement of Projection's shape stage at the
command boundary: the response-size dimension orthogonal to salience tiering. Not
its own primitive; it is the presentation-altitude knob every read preset threads.

**Connections.** Threaded by the read presets (§9) and edge presets (§10);
consumes `EntryMeta`.

**ADRs.** ADR-0048 (altitude shaping), ADR-0033 (progressive disclosure),
ADR-0081 (the home-cell payload-ceiling incident that motivated `cursor`/thin).

---

## 7. The present stage — Affordance resolution (named, near-dead)

**What it does.** `resolvePresent(fact, decl) → Affordance
{icon,label,render,handlers}`: the *named* final Projection stage (ADR-0012)
answering "how do I show this, and what can I do with it?". `resolveLabel`
evaluates a declaration's `label` path (`value.*` / `key` / `meta.*`
envelope-rooted, or a bare token value-rooted from legacy `titlePath`), with the
fact's key as the floor.

**Public API** (`platform/runtime/present.ts`):

```ts
function resolvePresent(fact: Presentable, decl?): Affordance      // present.ts:52
function resolveLabel(fact, path?): string | undefined             // present.ts:42
interface Affordance { icon?; label; render?; handlers? }          // present.ts:17
interface Presentable { key; value; type?; meta? }                 // present.ts:29
```

**Data model.** `Affordance {icon (static glyph), label (never empty — key
floor), render ({hint}|{viewer} ref), handlers (open/edit/create/render/embed →
surface|act|renderer|hint)}`. Resolved from `Type.present` + `Type.handlers` via
`resolveType`.

**Invariants & edge cases.**
- `label` never empty — falls back to the fact key (`present.ts:56`).
- An undeclared type still resolves — to the generic floor (key label, no
  handlers) (`present.ts:50-51`).
- Pure function.
- **NOT wired into any server read path** (verified: only `index.ts`/`cell-sdk.ts`
  re-exports + `tests/present.test.ts`).

**Reduces to** `projection` — nominally Projection's present stage. But the
reduction is *aspirational*: the pure resolver exists and is tested, yet the live
pipeline presents via `affordancesForTypes` (§8). A coherence gap where the named
primitive and the shipped path diverge.

**Connections.** Consumes `type-schema.resolveType` and `mergeTypeDecl`
(canonical ← slice). The ADR-0012 consumer migration (home/lit/canvas converging
on it) is the never-completed Eliminate-phase follow-on.

**ADRs.** ADR-0012 (Affordance/present), ADR-0002 (the wholesale-merge bug),
ADR-0010, ADR-0014.

> ⚠ **Coherence (present-affordance · DIVERGENT · dead export + doc drift).**
> `resolvePresent` (`present.ts:52`) and `resolveLabel` (`present.ts:42`) have
> **zero product call sites** — `resolveLabel` is invoked only internally by
> `resolvePresent` (`present.ts:56`); everything else is the two re-export barrels
> (`index.ts:94`, `cell-sdk.ts:33`), the compiled bundle
> (`cell-runtime.generated.ts`), `tests/present.test.ts`, and one non-invoking
> comment (`cells/kernel/client/main.ts:435`). The gateway resolves the present
> *facet* at `services/gateway/service.ts:509` via `buildTypeVocabulary →
> resolveType` (`platform/runtime/type-vocabulary.ts:43-48`), never via
> `resolvePresent`. Docs (`platform-core.md:190,291`) mis-cite the function and
> the line (`service.ts:335-339` is the unrelated `CORE_FACT_VERBS` set).
> **Recommendation:** either wire `resolvePresent` in as the real per-fact present
> stage, or delete it and rewrite the docs to name `resolveType`'s present facet +
> `buildTypeVocabulary` as the actual present core.

> ⚠ **Coherence (present-affordance · DIVERGENT · client label rooting bug).**
> `resolveLabel` roots `value.*`/`key`/`meta.*` paths at the `{value,key,meta}`
> envelope (`present.ts:45`). But home's `factTitle`
> (`cells/home/client/facts.tsx:86-89`, byte-identical fork in
> `cells/home-next/client/facts.tsx`) calls `pathInto(e.value, label)`, so a
> declared label of `value.title` descends `e.value.value.title = undefined` — the
> declared-label branch fails for **every** `value.*` path (100% of committed
> labeled types). It is masked for `value.title`/`value.name` types by a
> `title/name/content` fallback heuristic, but `value.text`/`path`/`id`/`seq`/
> `status`/`node` render as the raw key. Kernel `titleOf`
> (`cells/kernel/client/main.ts:436-445`) and canvas (via kernel `titleOf`,
> `storage.ts:150,529`) root correctly — so the same fact gets its declared title
> on canvas and a degraded title in home. **Recommendation:** extract one
> client-side label resolver (mirror of `resolveLabel`) into `@parc/ui` and route
> home/home-next `factTitle` + kernel `titleOf` through it. Fix must land in both
> home and home-next until the fork is collapsed.

---

## 8. The LIVE present stage — inline type affordances

**What it does.** `affordancesForTypes(typeNames, decls)` builds the inline
`types` map a read result carries (ADR-0029 R1): one `resolveType` per DISTINCT
type (not per entry — no per-fact bloat), returning per-type
`{icon,label,render,handlers,manager}` so an agent answers "what can I DO with
this?" from the SAME response — `types[fact._meta.type].handlers[intent]` +
`.manager` — with no second `read('$types')`. `_`-prefixed plumbing types and
undeclared types are omitted. This is the present stage that actually ships
across recall/query/peek/neighbors/members/edges.

**Public API** (`services/workspace/shared.ts`):

```ts
function affordancesForTypes(typeNames, decls): Record<string, TypeAffordance> // shared.ts:115
function typesOf(container, ...extra): Array<string|null|undefined>            // shared.ts:137
function typeDeclsFor(ctx): Promise<Record<string, Record<string,unknown>>>    // shared.ts:67
function typeRulesFor(ctx): Promise<Record<string, TypeRules>>                 // shared.ts:83
interface TypeAffordance { icon?; label?; render?; handlers?; manager? }       // shared.ts:101
```

**Data model.** `types` map keyed by type name, present only when ≥1 returned
type is declared. `label` is the type's label PATH (e.g. `value.title`), matching
`$types`' `present.label`. Fed by a 60s process-wide `typeDeclsCache`
(`TYPE_DECLS_TTL_MS = 60_000`, `shared.ts:60-61`) of `cells.describeTypes`; a
fetch failure degrades to `{}` (backbone links + schema hints go quiet,
`shared.ts:74-77`).

**Invariants & edge cases.**
- One `resolveType` per distinct type, not per entry (`shared.ts:122-131`).
- `_`-prefixed plumbing types skipped (`shared.ts:120`); empty affordances omitted
  (`shared.ts:130`).
- Slice-local `_types/<T>` overrides are NOT folded here (rare —
  `read('$types')` returns the fully-merged view, `shared.ts:113-114`).
- `recall`'s full view includes elided stubs' types so an agent can act after
  `expand`.

**Reduces to** `projection` + `cell` — the realised present stage (projection):
what `present` resolves to on every live read. Also compounds on `cell`: the
decls come from `cells.describeTypes` (the Cell publish seam, cached
process-wide, `shared.ts:71`), so a type's affordances are its managing Cell's
published declaration.

**Connections.** Consumes the cell `describeTypes` publish seam,
`type-schema.resolveType`, and the `typeDeclsFor` cache; produces the `types` map
inlined by read presets (§9) and edge presets (§10).

**ADRs.** ADR-0029 (inline type affordances), ADR-0012 (Affordance), ADR-0008
(Cell publish seam), ADR-0002.

---

## 9. Resolution — the layered per-facet merge (`layer`)

**What it does.** `layer<T>(...parts)` folds an ordered stack of partial layers
into one effective value, facet by facet, most-specific (last) wins, where
`undefined` means "silent about this facet" and never clobbers an earlier layer's
value. Named once (ADR-0010), it backs the Type vocabulary (canonical ← slice
`_types/<T>`), the Reference rules (canonical `typeRules` ← slice rules in
`deriveBackboneEdges`), and per-facet type-decl merges (`mergeTypeDecl`). It is
the fix for the ADR-0002 bug where a wholesale merge let a slice overriding only
`icon` drop the canonical `handlers`.

**Public API** (`platform/runtime/resolution.ts`, `type-schema.ts`):

```ts
function layer<T extends object>(...parts: Array<Partial<T>|undefined|null>): T  // resolution.ts:17
function mergeTypeDecl(canonical, slice)   // type-schema.ts — uses layer
```

**Data model.** Pure object-facet last-wins merge; skips `null`/`undefined` parts
and `undefined` values (`resolution.ts:19-23`). The salience-numeric merge (§4)
and the grant-union are *documented* as Resolution but NOT forced through this fn
— the salience one clamps + re-derives numerics; the grant one is a set union
(`resolution.ts:9-11`).

**Invariants & edge cases.**
- `undefined` = silent — never overrides an earlier layer (the ADR-0002 fix,
  `resolution.ts:22`).
- Most-specific (last) layer wins per facet.
- Used identically by `$types` resolve, backbone `effectiveRules`, and
  `mergeTypeDecl` — one merge, no divergent copies.

**Reduces to** `projection` + `fact` — the read side's second mechanism beside
Projection: "defaults then overrides, facet by facet" over Fact-stored layers (a
canonical cell decl and a slice `_types/<T>` fact). It underpins present, the
backbone's `effectiveRules`, and salience config resolution.

**Connections.** Consumed by `resolveType`/`buildTypeVocabulary` (§7/§8), the
backbone (§2), and salience resolution (§4).

**ADRs.** ADR-0010 (Resolution), ADR-0002 (the wholesale-merge bug), ADR-0001.

---

## 10. Read presets — recall / query / peek / one-read (progressive disclosure)

**What it does.** The command bodies that are each a preset of the pipeline
(ADR-0004/0071):
- **`recall`** assembles own slice ∪ granted subsets, scores under the VIEWER's
  config, shapes once, and by default returns a broad succinct OVERVIEW (counts
  byType/byPrefix, salience bands, top ~12 focus facts card-shaped, drill hints).
  The whole shaped view is one arg away (`view:'full'` or any shaping arg),
  ADR-0033. A bare `recall` is served from a seq-validated digest cache
  (`_index/overview`).
- **`query`** is the filtered/paged/ranked projection (`rankBy
  salience|recency|relevance`).
- **`peek`** is a single-fact read + inline affordance.
- The composed **`read(source,shape)`** (ADR-0071) dispatches over
  slice/store/vector/key/changes and folds the adopted-posture principal layer
  (ADR-0074/0086) + optional `context:'refs'` periphery.

**Public API** (`services/workspace/commands-read.ts`):

```ts
function createReadCommands(build): Pick<WorkspaceCommands, 'recall'|'peek'|'query'|'changes'|'attention'|'tend'|'read'> // :451
// recall/peek/query/changes/attention/tend/read handlers
async function relevanceFor(vectors, scope, text)   // :44  (INTENT_TOP_K=200 :36)
function buildOverview(...)                          // :179
function inferSource(input)                          // :439
function principalPosture(...) / participantPosture(...)  // :385 / :412
```

**Data model.**

```ts
RecallOverview = {
  overview: { total, granted, bands, byType[], byPrefix[] },
  focus: Record<key, Entry>, hints[], types?
}
```

The digest fact `_index/overview` (`DIGEST_KEY`, `commands-read.ts:76`) =
`{seq, at, result}`, written through the raw store (no seq advance / trajectory /
touch — a cache is not a fact). Live recall scope: total ~6509, bands
442/4789/1278.

**Invariants & edge cases.**
- Bare `recall` (no intent/lens/override/shape) is served from a seq-EXACT +
  <1h digest; a foreign grant falls through to the full fold.
- The grant-fold scores granted slices under the viewer's config + lenses, not
  the owner's.
- Any shaping arg implies `view:'full'` (back-compat hinge).
- Intent (text) enters via `INTENT_PRESET` under any explicit override; without a
  vector backend the read proceeds unweighted.
- `read()`'s source is inferred from the caller's own args BEFORE the posture
  merge (`inferSource`, `:439/:763`), so a standing goal conditions a read but
  never flips an overview into a search.

**Reduces to** `projection` + `fact` — each preset is a specific
select/score/shape/present configuration (projection); recall/query read the Fact
slice via `ObservedState.read/query`, and the grant-fold reads granted slices
(fact rows, with grants supplying cross-slice scope).

**Connections.** Consumes `ObservedState.read/query/shape`, grants (own ∪ granted
fold), vectors (relevance, `relevanceFor` `:527,:542,:631`),
`affordancesForTypes`, and the `shape.ts` tiers.

**ADRs.** ADR-0004, ADR-0033 (overview/progressive disclosure), ADR-0071
(composed read), ADR-0051 (intent), ADR-0074/0086 (posture), ADR-0029.

---

## 11. Edge-query presets — neighbors / graph / members / links / edges / walk

**What it does.** The Reference-projection read presets (ADR-0069 C3 collapses
four framings into one `edges` verb; legacy verbs remain aliases):
- **`around` → neighbors** — one-hop authored ∪ derived, entries default card.
- **`around+membership` → members** — extensional via inbound membership edges +
  declared `members[]`, ordered by decoration seq else salience; intensional when
  the collection IS a query.
- **`derived:false` → links** — authored only.
- **no `around` → the whole graph projection.**
- **`around+depth≥2` → the directional walk** (ADR-0075) — all transitive simple
  paths over AUTHORED edges, compound confidence = Π step strength, cycle-guarded,
  capped (depth≤6, ≤200 paths, ≤500 expansions).

**Public API** (`services/workspace/commands-graph.ts`, `state.ts`):

```ts
function createGraphCommands(build): Pick<WorkspaceCommands, 'link'|'unlink'|'neighbors'|'links'|'graph'|'members'|'edges'> // :160
ObservedState.graph / neighbors / members / edges
async function walkFrom(store, scope, root, {rel,direction,depth})  // :108
interface WalkResult / WalkPath / WalkStep
scopeEdges  // §6 — paging + thin
```

**Data model.**
- `graph → {edges: AnnotatedEdge[]}` (authored ∪ derived, derived flagged).
- `members → MembersResult {membership:'intensional'|'extensional',
  order:'seq'|'salience'|'query', members: MemberEntry[]}`.
- `walk → {root, direction, depth, paths:[{nodes,steps,confidence}], total,
  truncated?}`.

Live: `similarTo` edges (strength 0.3, writer platform/vectors, score = raw
cosine) dominate the projection.

**Invariants & edge cases.**
- Derived backbone edges carry `derived:true`; authored edges omit it.
- The walk follows AUTHORED edges only (a simulation follows asserted claims, not
  type plumbing); confidence = Π strength (null = 1).
- `members` orders by decoration seq when any member is placed, else salience
  (`state.ts:2110`).
- `graph` computes the WHOLE projection server-side — paging bounds size *after*
  materialization, not compute (the live Unhandled failure).

**Reduces to** `projection` + `edge-http` — these are select-over-edges presets
(`state.graph = store.listEdges ∪ deriveBackboneEdges`) (projection). The graph
"Unhandled" failure reduces to `edge-http`: the Cell public HTTP face's 30s/6MB
realisation ceiling is exactly what the unbounded projection read hits — which is
why `scopeEdges` paging and the walk's caps exist.

**Connections.** Consumes `deriveBackboneEdges` (§2), the store edge index
(`edgesFrom`/`edgesTo`/`listEdges`), `affordancesForTypes` (§8), and `scopeEdges`
(§6).

**ADRs.** ADR-0069 (one edge verb), ADR-0075 (the walk), ADR-0003 (Reference),
ADR-0048, ADR-0009, ADR-0016, ADR-0081.

> ⚠ **Coherence — the graph `Unhandled` failure.** `state.graph`/`state.edges`
> compute the whole projection server-side (`shape.ts:140-145`); `scopeEdges`
> pages the already-materialized array, so `limit` cannot rescue a projection
> whose *computation* (29,018 edges) exceeds the CloudFront/Lambda ceiling. Paged
> `workspace.edges` works. **Recommendation:** stream the state layer, not page.

---

## 12. PCA 2D/3D semantic layout projection + sharded atlas

**What it does.** A deterministic, dependency-free PCA layout that turns embedding
vectors into a meaning-space map for the home graph (ADR-0047 stage 2): power
iteration to the top-k principal components WITHOUT forming the d×d covariance
(iterate `v ← Xᵀ(Xv)`, O(n·d)/step), Gram-Schmidt-deflated so axes are orthogonal,
robust 98th-percentile-radius normalization into ~`[-1.3, 1.3]`. It persists the
basis (mean + axes) + norm so ONE MORE vector places on the same map via
`projectVector` (a few dot products, no whole-index reread) — the incremental
live indexer path (stage 3). The sharded atlas (ADR-0082) hash-buckets coords
into 16 shard facts under a coord-free manifest, dividing patch payload + write
contention (the fix for the 400KB item cap + the bulk-backfill CAS storm /
"cylinder halo" incident).

**Public API** (`platform/runtime/projection.ts`):

```ts
function pca(vectors, keys, comps, opts?)                 // :83
function pca2d(vectors, keys, opts?): Projected           // :117
function pcaWithBasis(vectors, keys, comps, opts?)        // :94
function projectionFact(vectors, keys, dim, generatedAt): ProjectionFact // :200
function projectionArtifacts(vectors, keys, dim, generatedAt): {manifest, shards[]} // :287
function projectVector(vector, basis, norm): [number,number,number]      // :229
function computeNormParams / applyNormParams / normalizeCoordsN          // :134/:147/:156
const LAYOUT_KEY = '_home/embed2d'                        // :21
const LAYOUT_SHARDS = 16 ; layoutShardOf(key) ; layoutShardKey(i)        // :256-261
interface ProjectionFact / LayoutManifest / LayoutShard / PcaBasis / NormParams
```

**Data model.**

```ts
ProjectionFact = {
  method:'pca', dim, count, generatedAt,
  coords: Record<key, [x,y,z]>,        // 4dp, each in [-1.3,1.3]
  basis?: { mean, axes:[a0,a1,a2] },   // 6dp
  norm?: { center, scale }
}
LayoutManifest = everything except coords + shards:16
LayoutShard    = { coords }
```

Titan `dim = 1024`. `patchProjection` CAS-retries (`PATCH_ATTEMPTS=4`) on the
monolith; shards are patched independently. `layoutShardOf` is a djb2-xor bucket
(`:261-265`).

**Invariants & edge cases.**
- Deterministic — fixed irrational-stride sinusoid seed (`seedVector`, `:43-50`),
  no RNG; same vectors → same map.
- basis+norm persistence makes an incremental single-point placement identical to
  a batch coord.
- A value with `coords` and no `shards` is the legacy monolith; readers handle
  both during migration (`:267-282`).
- `z` is stored so one fact serves both 2D and 3D; a 2D reader ignores z.
- PCA smears fine clusters (linear) — UMAP is the intended upgrade behind the
  SAME vectors→coords seam (`:8-13`).

**Reduces to** `fact` + `projection` — reduces to `fact`: the layout is a Fact at
`_home/embed2d` (+ `_home/embed2d/s<i>` shards, type
`graph-layout`/`graph-layout-shard`), read/patched under CAS like any fact. It
supports `projection` loosely (it shapes the graph read's node positions) but is
genuinely its own numeric capability — a deterministic vectors→coords function —
not a select/score/shape/present preset.

**Connections.** Depends on fact CAS/`ifVersion` writes, the
`services/vector-indexer/handler.ts` stream consumer, and s3-vectors embeddings;
`commands-search.ts` computes the batch layout.

**ADRs.** ADR-0047 (semantic layout), ADR-0082 (sharded atlas), ADR-0083,
ADR-0030 (semantic search), ADR-0066.

---

## 13. Typed file ingestion inference (put-seam type inference)

**What it does.** `inferIngestionType(name, contentType?, config?)` infers a real
fact type from a file's extension/MIME at the put seam (ADR-0081) instead of
stamping everything `file`, so an ingested fact lands with a manager that can
enrich it (via `$types`) rather than going in inert. Pure and unit-tested;
extension match takes priority over MIME (a `.md` served as `text/plain` still
becomes `markdown`); overridable at runtime via a `_config/ingestion` fact (config
rules tried FIRST, so an override can redirect an extension the defaults claim).
Unmatched → the default type (`file`).

**Public API** (`platform/runtime/ingestion-type.ts`):

```ts
function inferIngestionType(name, contentType?, config?): string   // ingestion-type.ts:54
interface IngestionRule   { ext?: string[]; mime?: string[]; type: string }  // :16
interface IngestionConfig { rules?: IngestionRule[]; default?: string }       // :25
```

**Data model.** `DEFAULT_RULES` (`:31-36`): `.md`/`.markdown`→`markdown`,
images→`image`, `.html`→`artifact`, `.json`/`.csv`/`.yaml`→`data`;
`DEFAULT_TYPE='file'`. Overridable via a `_config/ingestion` fact (same precedent
as `_config/typography`, `_config/salience`).

**Invariants & edge cases.**
- Extension match beats MIME (`.md` as `text/plain` is still `markdown`,
  `:58-60` runs the ext loop before the mime loop).
- MIME alone catches extension-less uploads (`:61-63`).
- Config rules tried before defaults (`rules = [...config.rules, ...DEFAULT_RULES]`,
  `:57`) so an override can reclaim a claimed extension.
- Unmatched falls through to `config.default ?? 'file'` (`:64`).
- Pure — shared by the file-put mirror (`services/workspace/event-handlers.ts`)
  and any future ingestion seam.

**Reduces to** `fact` + `projection` — reduces to `fact`: it decides the
indexable `type` a Fact carries at write time — the attribute everything
downstream (select, backbone `instanceOf`, present) keys on. It feeds
`projection` indirectly (a correctly-typed fact gets a manager, backbone edges,
and affordances) but is itself a write-side classifier borrowing the "config, not
code" fact-override seam.

**Connections.** Sits at the fact put seam (type stamping); reads a fact-stored
`_config/ingestion` override.

**ADRs.** ADR-0081 (put-seam type inference / ingestion), ADR-0027.

---

## Gotchas / non-obvious behavior

1. **The named present stage is dead.** `resolvePresent`/`resolveLabel`
   (`present.ts`) have zero product call sites — the live present stage is
   `affordancesForTypes` (`shared.ts:115`). Don't wire new consumers to
   `resolvePresent` expecting it to be the shipped path; the ADR-0012 consumer
   migration was never completed.

2. **Client label rooting diverges from `resolveLabel`.** `resolveLabel` roots
   `value.*` at the `{value,key,meta}` envelope; home/home-next `factTitle`
   (`facts.tsx:86-89`) roots at `e.value`, so `value.*` labels resolve to
   `undefined` and are silently rescued only for `title`/`name`/`content` by a
   fallback heuristic. `value.text`/`path`/`id`/`seq`/`status`/`node` render as
   the raw key in home while kernel/canvas render the declared title.

3. **`recall` scores granted slices under the VIEWER's config**, never each
   owner's — a grant does not import the owner's lenses/salience.

4. **Any shaping arg implies `view:'full'`** on `recall` — a caller asking for a
   shape has opted out of the overview digest.

5. **The bare-`recall` digest cache is seq-EXACT + <1h**, written through the raw
   store (no seq advance / trajectory / touch). A foreign grant falls through to
   the full fold. It is a cache, not a fact.

6. **`graph` cannot be rescued by `limit`.** `scopeEdges` pages an
   already-materialized edge array — it bounds response size, not compute. The
   29,018-edge whole-projection read hits the CloudFront 30s / Lambda 6MB ceiling
   and errors "Unhandled"; the fix is streaming the state layer. Paged
   `workspace.edges` works.

7. **The walk follows AUTHORED edges only** — derived backbone/type-plumbing edges
   are excluded so a simulation follows asserted claims. Confidence = Π step
   strength (null strength counts as 1).

8. **The type prior scales only the ambient terms.** Relevance and reward ride
   unprioered, so a demoted capability type lifts at full strength when an intent
   names it (ADR-0052). Reward weight defaults to 0 — inert until a
   config/lens/override opts in.

9. **Scoring is touch-free** — a scope-wide read does not manufacture per-fact
   attention, and machinery churn (platform actor class, weight 0) does not
   manufacture salience.

10. **`instanceOf` is emitted to virtual anchors**; every other backbone edge
    requires its target to exist (never dangle). This is what keeps a
    typed-but-unlinked fact off centrality 0.

11. **A malformed/absent `_config/salience` fact yields `null`** and the read
    proceeds on instance defaults — config can bias a read but never break one.
    Compiled floor lens names are never shadowable by a slice's `_config/lenses`.

12. **PCA is deterministic** (fixed sinusoid seed, no RNG). Persisting the
    basis+norm makes an incremental single-point placement (`projectVector`)
    identical to a batch coord. A layout value with `coords` and no `shards` is
    the legacy monolith — readers must handle both during the migration window.

13. **`layer`'s `undefined` is silent** — it never clobbers an earlier layer. This
    is the ADR-0002 fix; a slice overriding only `icon` no longer drops the
    canonical `handlers`. The salience-numeric merge and grant-union are
    *documented* as Resolution but do NOT flow through `layer`.

14. **`affordancesForTypes` does not fold slice-local `_types/<T>` overrides** —
    only `read('$types')` returns the fully-merged view. `_`-prefixed plumbing
    types are skipped and empty affordances omitted.
