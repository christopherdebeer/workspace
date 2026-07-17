# Runtime — Type System & Declaration Registry

## What this subsystem is

This subsystem is the substrate's answer to one question about any fact: **"what IS this kind of fact — how do I show it, edit it, construct it, who owns it, and what edges does it imply?"** — and its defining decision is to hold that answer as **data**, not code. A "Type" is a keyed `{value,_meta}` row at `_types/<T>`, and everything else in the subsystem is a set of **pure functions** in `platform/runtime` (`type-schema.ts`, `type-vocabulary.ts`, `present.ts`, `resolution.ts`, `declarations.ts`) that turn those declaration facts into typed *facets* a consumer can read.

It introduces almost no storage primitive of its own. It compounds on exactly two cores:

- **Fact** — a Type Declaration is just a Fact at `_types/<T>`. Its canonical half is each cell's `types.json`, federated onto the registry by the `cells.describeTypes` publish seam; the per-caller override is a slice Fact at the same key. The whole declaration CRUD lifecycle (`createDeclarationRegistry`) is a ~30-line pass-through to `state.put/query/get/supersede`.
- **Projection pipeline (select → score → shape → present)** — `resolveType` + `buildTypeVocabulary` produce the `present`/`shape`/`handlers` facets that feed the *present* and *shape* stages (`present.ts`, `$types`, `$catalog {for}`), and `parseTypeSchema` / `keyEdgesOf` feed the *score/shape* and Reference-edge derivation stages.

The one place it *looks* like it re-introduces a primitive is **Resolution** (`layer`, ADR-0010) — the per-facet "defaults ← slice, `undefined` never clobbers" merge. ADR-0010 is explicit that Resolution is the read side's *second-class citizen alongside Projection*, not a rival to Fact: its inputs are Facts and its output feeds the projection's present/shape stages.

A **UI-side parallel model** (`platform/ui/vocab.ts`) re-derives the same type-signal ladder and handler resolution client-side for surfaces that cannot make a gateway hop. The two models share the *concept* (type signals, per-intent handlers, templating) but not the *code* — a deliberate one-resolver/two-transports split (ADR-0044 Inc 2) that is the closest thing to duplication in the subsystem.

Live snapshot: the deployed `$types` payload is 50 type contracts, each carrying the `resolveType` facets (`icon`/`label`/`handlers` + additively-attached `fields`/`present`), and `$catalog {for: doc-block}` returns the same declaration joined to the managing cell's tools (ADR-0049).

---

## 1. Type Declaration as a Fact (the type-kind of the Declaration registry)

**What it does.** A "Type" has no bespoke store. It is a Declaration fact at `_types/<T>` whose value carries `icon`/`label`/`manager`/`handlers`/`schema`/`keyPattern`/`keyEdges`. The **canonical** half is each cell's `types.json`, federated onto the registry via `cells.describeTypes`; the **per-caller override** is a Fact written to the caller's slice at `_types/<T>`. There is no second registry — ADR-0002 explicitly folds the four former homes (`_types`, `_renderers`, prose `schema`, home conventions) into one fact value with facets. `resolveType` (`type-schema.ts:175`) reads the flat decl as a typed *view*: its top-level keys **are** its facets.

**Public API** (`platform/runtime/type-schema.ts`)

```ts
interface Type {
  kind?: string;
  manager?: string;                                              // → backbone managedBy
  shape: { fields: FieldSpec[] | null; keyPattern?: string; keyEdges?: KeyEdge[] };
  present: { icon?: string; label?: string; render?: unknown };
  handlers?: Record<string, unknown>;                            // per-intent affordance table
  declared: boolean;                                             // decl had ≥1 key
}

// Pure. Callers supply the (merged) decl; no DOM, no cell hardcoded.
function resolveType(decl: unknown, kind?: string): Type;

// (services/workspace/shared.ts) cached cells.describeTypes fan-in, 60s TTL, fails soft to {}
typeDeclsFor(ctx): Promise<Record<string, Record<string, unknown>>>;
```

**Data model.** Fact key `_types/<T>` (scope = IAM principal for overrides; canonical arrives from cell code). Value keys: `manager`, `icon`, `label`|`titlePath`, `handlers`, `schema`|`fields`, `keyPattern`, `keyEdges`, `render`|`viewer`, `note`. `resolveType` normalises: `present.label = str(d.label) ?? str(d.titlePath)`; `present.render = d.render ?? (d.viewer ? {viewer} : undefined)` (`type-schema.ts:181-184`).

**Invariants & edge cases.**
- Flat decl top-level keys are its facets — a typed view, not a second source (`type-schema.ts:134-154`).
- `declared = Object.keys(d).length > 0`; an undeclared type still resolves to the generic floor.
- Non-object / array decl coerces to `{}` — `resolveType` never throws (`type-schema.ts:176`).
- `resolveType` is pure — no DOM, no cell hardcoded.

**Reduces to.** **Fact** — directly a keyed `{value,_meta}` row at `(scope, _types/<T>)`, server-stamped and supersede-not-delete like any other. It reuses no storage of its own. The only non-Fact aspect is that the canonical vocabulary is *delivered* over the `cells.describeTypes` seam rather than read from the caller's own slice.

**Connections.** Depends on Fact/`state.ts` and the `cells.describeTypes` publish seam (**Cell axis**). Every other capability in this subsystem consumes the resolved `Type`.

**Motivating ADRs.** ADR-0002 (Type as one object), ADR-0001 (Declaration registry), ADR-0044 (Distill the substrate), ADR-0014.

---

## 2. Per-facet Resolution merge (`mergeTypeDecl` / `layer`, ADR-0010)

**What it does.** Merges a canonical (cell-declared) type decl under the caller's slice `_types/<T>` override **facet-by-facet, most-specific wins**, where `undefined` means "this layer is silent" and never clobbers an earlier layer. This is the ONE resolver that replaced two divergent merges: the gateway used to *wholesale-replace* (a slice overriding only `icon` dropped canonical `handlers`/`schema`), while `remember` *shallow-merged*. Both now call `mergeTypeDecl`, which is `layer(c, s)`.

**Public API**

```ts
// platform/runtime/type-schema.ts
function mergeTypeDecl(canonical: unknown, slice: unknown): Record<string, unknown>; // = layer(c, s)

// platform/runtime/resolution.ts — undefined never overrides
function layer<T extends object>(...parts: Array<Partial<T> | undefined | null>): T;
```

**Data model.** Two decl objects in → one merged decl object out. No storage. `layer` iterates each part's own enumerable entries and writes `out[k] = v` only when `v !== undefined` (`resolution.ts:17-26`).

**Invariants & edge cases.**
- A facet the slice is silent about (`undefined`) keeps the canonical value — the exact bug ADR-0002 fixed.
- Non-object inputs coerce to `{}` (`type-schema.ts:29-30`) — never throws.
- Slice wins per facet, not wholesale.
- `layer` is shared verbatim with the Reference-rule merge; the salience (numeric) and grant (union) merges are documented as Resolution but deliberately NOT forced through `layer` (`resolution.ts:9-13`).

**Reduces to.** **Projection + Fact.** ADR-0010 names the read side as *Projection* (facts + rules → view) **and** *Resolution* (ordered partial layers → one value, facet by facet). Resolution is honestly its own small primitive — a numeric/object/union merge family — but the ADR frames it as second-class *alongside* Projection, not a rival to Fact: its inputs are Facts (canonical decl + slice `_types/<T>` Fact) and its output feeds the projection's present/shape stages.

**Connections.** Depends on Type Declaration as a Fact. Consumed by `buildTypeVocabulary` and the Reference-rule pipeline.

**Motivating ADRs.** ADR-0010 (Resolution), ADR-0002, ADR-0001.

---

## 3. Schema parsing & advisory validation (`parseTypeSchema` / `schemaHints`)

**What it does.** Parses a type's shape declaration into `FieldSpec[]` from **either** the structured form (`{fields:[{name,type?,required?,description?,list?,rel?}]}`) **or** the legacy prose map (`{schema:{name:'type? — prose'}}`, where a `?` on the leading token or the words `optional`/`DEPRECATED` marks it optional; every other field is *recommended*). `schemaHints` / `missingRequired` then produce **non-blocking** nudges: one hint per missing recommended field, or a single "this type could declare a schema" nudge when a structured value meets an unschema'd type. **Validation never blocks a write** — the substrate suggests, never enforces.

**Public API** (`platform/runtime/type-schema.ts`)

```ts
type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'markdown' | 'ref';

interface FieldSpec { name: string; type?: FieldType; required?: boolean; description?: string; list?: boolean; rel?: string; }

function parseTypeSchema(decl: unknown): FieldSpec[] | null;
function missingRequired(value: unknown, fields: FieldSpec[]): FieldSpec[];
function schemaHints(opts: { type?: string | null; value: unknown; fields: FieldSpec[] | null; declared?: boolean }): string[];
```

**Data model.** Reads `decl.fields[]` (structured) or `decl.schema{}` (legacy prose). Emits `FieldSpec`. In the legacy map, the leading token is lowercased and split on whitespace/dashes; `?` or `optional`/`deprecated` → `required:false`, otherwise recommended; `prose()` extracts the human clause after an em/en/hyphen dash (`type-schema.ts:52-56, 85-93`). Live `$types` shows both forms coexisting: `canvas-placement`/`file`/`doc` use legacy `schema` maps that resolve into `fields` arrays additively.

**Invariants & edge cases.**
- Validation is advisory: never blocks a write; returns `[]` = nothing to suggest.
- Structured `fields` takes precedence over legacy `schema` map (`fields` checked first, `type-schema.ts:63`).
- Empty field list → `null` (type declares no schema).
- `schemaHints` returns `[]` when `type` is falsy; with no schema but a structured non-empty object value it emits the single "declare a schema" nudge, tagging `(and is undeclared)` when `declared` is false.

**Reduces to.** **Projection + Fact.** The parse feeds two projection stages: (a) the present/shape facet (`shape.fields`) consumed by the home form editor and `$types`; (b) `schemaHints` runs inside `remember` (`commands-write.ts:173`) as advisory output attached to a Fact write. It stores nothing — it is a pure read over the type Declaration Fact's value. Advisory-not-enforcing mirrors the Fact core's supersede-not-delete monotonicity: the substrate accretes and hints, it does not reject.

**Connections.** Depends on Type Declaration as a Fact and the `remember` command (Fact write path).

**Motivating ADRs.** ADR-0002, ADR-0001, ADR-0023.

---

## 4. Key-encoded Reference rules (`KeyEdge` / `keyEdgesOf` → `extractTypeRules`)

**What it does.** A type may declare `keyPattern` (e.g. `_doc/{doc}/{block}`) plus `keyEdges` (`[{from,rel,to}]` with `{group}` captures), and `ref`-typed fields (`{name,rel,list}`). `keyEdgesOf` validates the keyEdges array off the decl; `resolveType` surfaces them on `shape.keyEdges`; `extractTypeRules` (`state.ts`) folds a resolved `Type` into `TypeRules {manager, refs, keyPattern, keyEdges}`, which the read-time backbone compiles (`compileKeyPattern`) to **project graph edges from a fact's key** — "an edge with attributes is a fact whose key encodes its endpoints."

**Public API**

```ts
// platform/runtime/type-schema.ts
interface KeyEdge { from: string; rel: string; to: string; }
// keyEdgesOf is module-internal: filters to well-formed {from,rel,to}; empty → undefined

// platform/runtime/state.ts
interface KeyEdgeRule { from: string; rel: string; to: string; }   // structurally identical to KeyEdge
function extractTypeRules(t: Type): TypeRules;                      // state.ts:936

// services/workspace/shared.ts
typeRulesFor(ctx): Promise<Record<string, TypeRules>>;             // one resolveType per declared type
// rulesFromDecl(decl) = extractTypeRules(resolveType(decl))
```

**Data model.** `keyEdges` live in the type decl value; endpoints template `{group}` captures from `keyPattern` (e.g. `doc-order`: keyPattern `_doc/{doc}/{block}`, keyEdge `{from:'{block}', rel:'inDoc', to:'doc:{doc}'}`). Live `$types` confirms these on `canvas-placement` (`onBoard`), `collection-membership` (`memberOf`), `doc-order` (`inDoc`), `machine-node` (`inMachine`), `machine-rail` (`rail`). `ref` fields (e.g. `mental-model.source rel:'from'`, `capture.day rel:'on'`) project embedded edges. Edge strength constants (`state.ts`): structural 0.2, membership 0.4, embedded 0.6.

**Invariants & edge cases.**
- `keyEdgesOf` filters to well-formed `{from,rel,to}` strings; empty → `undefined` (`type-schema.ts:166-172`).
- `extractTypeRules` only keeps `keyPattern`+`keyEdges` **together** (both required, `state.ts`).
- A slice-declared type contributes rules identically to a cell-canonical one (shared extractor).
- First-class edges hold only `rel`+`strength`; content-bearing edges are facts whose key encodes endpoints (ADR-0003/0016).

> ⚠ **Coherence — edge-shapes (PARTIAL · low · conflicts).** `KeyEdge` (`type-schema.ts:158`) and `KeyEdgeRule` (`state.ts:915`) are exactly the same interface `{from:string; rel:string; to:string}`, bridged only by duck typing: `state.ts:943` assigns `t.shape.keyEdges` into `r.keyEdges` with no import and no shared alias (`state.ts:44` imports only `resolveType`/`Type`). `KeyEdge` is exported (`index.ts:97`, `cell-sdk.ts:60`) and could have been reused. Pure coherence/duplication — no runtime defect. **Fix:** delete `KeyEdgeRule` and import `KeyEdge` from `type-schema` (or re-export it) so the rule shape has one definition; today adding a field to one silently would not propagate to the other.

**Reduces to.** **Projection + Fact.** This is the type system's contribution to the Projection pipeline's edge/graph derivation: it converts a static Fact-stored declaration into edge-projection *rules* that the backbone applies at read time over the fact stream. It stores no edges of its own — the placement/order/rail facts ARE the Facts; `keyEdges` is just the rule that reads their keys back into `<from> rel <to>` graph edges.

**Connections.** Depends on Type Declaration as a Fact, Per-facet Resolution merge, and Reference/backbone projection in `state.ts`.

**Motivating ADRs.** ADR-0002, ADR-0003 (edges as facts), ADR-0016.

---

## 5. `buildTypeVocabulary` — the `$types` self-model

**What it does.** The PURE core of `$types`: takes the global (cell-canonical) type map + the caller's `_types/<T>` slice overrides, applies `mergeTypeDecl` per type, then **additively** attaches each type's resolved `shape.fields` and normalised `present` facet via `resolveType` — while **retaining the flat keys** (ADR-0014). One resolver, N transports: the gateway assembles the two inputs from its service clients, a cell's SSR assembles them from its own reads; both call this same function, so a cell no longer needs a gateway hop to know how a fact of type T opens/renders.

**Public API** (`platform/runtime/type-vocabulary.ts`)

```ts
interface SliceTypeOverride { key: string; value: unknown; }  // key = `_types/<T>` or bare `<T>`

function buildTypeVocabulary(
  globalTypes: Record<string, unknown> | undefined,
  sliceOverrides: SliceTypeOverride[] | undefined,
): Record<string, unknown>;

// services/gateway/service.ts — the WIRE half
gateway buildTypes(ctx) → { types, hint };
```

**Data model.** Input: `globalTypes {T: decl}` + `sliceOverrides [{key:'_types/T'|'T', value}]`. Output: `{T: decl merged, with additive fields + present}`. Live: `$types` = 50 type contracts, each carrying `present:{icon,label?}` and (where schema'd) `fields[]` alongside flat `icon`/`label`/`handlers`/`manager` — exactly the additive-facet shape this emits.

**Invariants & edge cases.**
- Slice key `_types/<T>` or bare `<T>` both accepted; empty `t` skipped (`type-vocabulary.ts:34-36`).
- Flat keys retained alongside nested facets (ADR-0014 row 3) — old clients don't break (`type-vocabulary.ts:49`).
- `present` attached only if `icon`|`label`|`render` present; `fields` only if non-null (`type-vocabulary.ts:45-48`).
- WIRE stays with each caller (gateway vs cell SSR); this function is merge-only.

> ⚠ **Coherence — present-affordance (DIVERGENT · info · compounds).** The **server** present path genuinely converges here: gateway `$types` (`service.ts:509`), workspace read/search/graph envelopes (`affordancesForTypes`), and cell SSR all resolve the `present` facet through the single `resolveType`/`buildTypeVocabulary` primitive and ship `present.{icon,label,render}` as data (`type-vocabulary.ts:42-49`). This half of the seam compounds correctly. **Keep** `resolveType`/`buildTypeVocabulary` as the acknowledged present core; the divergence (below, §6) is confined to the client per-fact resolution and to the orphaned `resolvePresent` name.

**Reduces to.** **Projection + Fact.** This IS a Projection.select preset over Fact-stored `_types/*`: select the canonical vocabulary (`cells.describeTypes`) unioned with the slice `_types/<T>` facts, shape each through `resolveType`, present as the `$types` payload. It adds no primitive.

**Connections.** Depends on `mergeTypeDecl`, `resolveType`, and the `cells.describeTypes` seam. Consumed by the gateway (`service.ts`) and by cell SDK SSR (`cell-sdk.ts`).

**Motivating ADRs.** ADR-0044 (Distill the substrate), ADR-0042 (Govern the cell core seam), ADR-0002, ADR-0012 (Affordance shape), ADR-0014.

---

## 6. Present stage — fact → Affordance (`resolvePresent`)

**What it does.** The `present` stage of the Projection (`select→score→shape→present`, ADR-0012): a pure function from a fact (+ its resolved `Type`) to an Affordance set `{icon,label,render,handlers}` — "how do I show this, and what can I do with it?". Resolves the `label` **path** against the fact envelope (`value.*`/`key`/`meta.*`, or a bare token against the value for legacy `titlePath`), falling back to the fact's key when no usable label exists.

**Public API** (`platform/runtime/present.ts`)

```ts
interface Affordance { icon?: string; label: string; render?: unknown; handlers?: Record<string, unknown>; }
interface Presentable { key: string; value: unknown; type?: string | null; meta?: unknown; }

function resolvePresent(fact: Presentable, decl?: unknown): Affordance;
function resolveLabel(fact: Presentable, path?: string): string | undefined;
```

**Data model.** `Presentable` + merged decl → `Affordance`. `label` never empty (falls back to `key`). `resolveLabel` roots `value.*`/`key`/`meta.*` against `{value,key,meta}`; a bare token roots against `fact.value`; non-string/number/boolean → `undefined` → key fallback (`present.ts:42-48`). Live `$catalog {for:doc-block}` returns exactly this shape: `{icon:'🧱', label:'value.id', handlers:{render:[{hint:'markdown'}]}}`.

**Invariants & edge cases.**
- Pure; undeclared type → generic floor (key as label, no handlers).
- `label` resolves `value.*`/`key`/`meta.*` against the envelope; bare token against value.
- Non-string/number/boolean label → `undefined` → key fallback.

> ⚠ **Coherence — present-affordance (DIVERGENT · medium · conflicts).** `resolvePresent` (`present.ts:52`) and `resolveLabel` (`present.ts:42`) have **zero product call sites** in `services/` or `cells/` — `resolveLabel` is invoked only internally by `resolvePresent` (`present.ts:56`); all other occurrences are re-export barrels (`index.ts:94`, `cell-sdk.ts:33`), the compiled bundle string, tests, and one non-invoking comment (`cells/kernel/client/main.ts:435`). The gateway resolves the present **facet** via `buildTypeVocabulary → resolveType` (`service.ts:509`, `type-vocabulary.ts:43-48`), **never** via `resolvePresent`. ADR-0042 (`:34,75`) independently records that these have zero callers. **Fix:** either wire `resolvePresent` in as the real per-fact present stage, or delete it and rewrite docs to name `resolveType`'s present facet + `buildTypeVocabulary` as the actual present core.

> ⚠ **Coherence — present-affordance / label resolvers (DIVERGENT · medium · conflicts).** There are **three** independent label resolvers plus a fourth verbatim heuristic copy. `resolveLabel` (`present.ts:42-49`) roots a label path on the *envelope* (head `value`/`key`/`meta`) and stringifies numbers/booleans, while home's `factTitle` (`cells/home/client/facts.tsx:86-105`, identical in `cells/home-next/client/facts.tsx:96`) roots only at `e.value` and only accepts strings via `pathInto`. So a served `present.label` of `value.title` resolves in the kernel but **mis-resolves in home** (masked by fallback heuristics), and numeric paths like `value.seq` fall through to the key in home. The shared `declFor` (`platform/ui/vocab.ts:159`) only selects the governing decl — it does no label resolution, so it does not make these convergent. **Fix:** extract one client-side label/title resolver (mirror of `resolveLabel`) into `@parc/ui` and route kernel `titleOf` and home/home-next `factTitle` through it.

**Reduces to.** **Projection + Fact.** Explicitly the named *present* stage of the Projection pipeline — it operates over a Fact and its resolved Type (itself a Fact-derived value) and produces the shaped output. No primitive of its own.

**Connections.** Depends on `resolveType` and Type Declaration as a Fact. Concept-shared with the UI parallel model (§9).

**Motivating ADRs.** ADR-0012 (Affordance shape), ADR-0002, ADR-0029.

---

## 7. Inline type affordances on reads + contextual capabilities (`$catalog {for}`)

**What it does.** Every read result inlines a `types` map for the distinct types present (ADR-0029 R1): `affordancesForTypes` / `typesOf` run **one `resolveType` per distinct type** (not per entry) over the cached canonical vocabulary, so an agent answers "what can I DO with this fact, and where?" from the same response (`types[T].handlers[intent]` + `.manager`). `$catalog {for: factKey}` / `{forType: T}` (ADR-0049) follows the same type-signal ladder to join fact → type → manager → that cell's tools + schemas into a ~3-8KB contextual menu instead of the whole ~135KB verb surface.

**Public API** (`services/workspace/shared.ts`, `services/gateway/service.ts`)

```ts
interface TypeAffordance { icon?: string; label?: string; render?: unknown; handlers?: Record<string, unknown>; manager?: string; }

function affordancesForTypes(
  typeNames: Iterable<string | null | undefined>,
  decls: Record<string, Record<string, unknown>>,
): Record<string, TypeAffordance>;

function typesOf(container, ...extra): Array<string | null | undefined>;
// gateway: $catalog {for} / {forType}
```

**Data model.** One `resolveType` per distinct type; `_`-prefixed plumbing types skipped; undeclared (empty affordance) omitted (`shared.ts`). Slice `_types/<T>` overrides are NOT folded here (rare — full `read('$types')` still merges). Live `catalog_ctx_docblock`: signals `['doc-block']` → the doc-block decl + `@c15r/lit` tools (`decomposeMarkdown`/`decomposeChunk`/`bootstrap` with schemas) + always-applicable workspace verbs.

**Invariants & edge cases.**
- One `resolveType` per distinct type (no per-fact bloat).
- Contextual catalog is presentation-only — authority only narrows (ADR-0049 L2).
- Same `typeSignals` ladder as the render floor.
- declare-once: R1 inline map + `$catalog {for}` project from the SAME declaration.

**Reduces to.** **Projection + Fact.** A Projection preset: shape/present stages that stamp the resolved Type facets onto read output, plus a contextual select (`$catalog {for}`) over `_types/*` joined with the `$cells` registry. No new authority and no new store — ADR-0049 is explicit it is a FILTER/shaping over what the token could already call. The manager → cell tools join reaches the **Cell axis** for tool schemas but only reads its published contract.

**Connections.** Depends on `resolveType`, `typeDeclsFor` cache, the `$cells` registry (Cell axis), and `$types`.

**Motivating ADRs.** ADR-0049 (Contextual capabilities), ADR-0029 (Inline affordances), ADR-0044.

---

## 8. `createDeclarationRegistry` — the universal declaration lifecycle

**What it does.** One ~30-line generic component over an `ObservedState` that gives EVERY declaration kind (view/action/subscription; the type/renderer/config kinds are resolve-shaped and read-merged instead) the identical lifecycle: **validate → put (typed) → list (query by ns prefix, recency-ranked) → get (live only) → remove (supersede)**. Parameterised by a `DeclarationKind<D>` descriptor. The registry owns **storage + resolution only** — a kind's *evaluate* (a view's query/reduce, an action's guarded writes, a subscription's match) is explicitly NOT here.

**Public API** (`platform/runtime/declarations.ts`)

```ts
interface DeclarationKind<D> {
  ns: string;                 // reserved key prefix, e.g. `_views/`
  factType: string;           // indexable fact type stamped on the stored decl
  defaultVia?: string;
  idOf(def: D): string;
  validate(def: D): void;     // the parse step, surfaced at register
  isStored(value: unknown): value is D;
  listLimit?: number;
}

interface DeclarationRegistry<D> {
  register(scope: string, def: D, identity?: Identity, opts?: RegisterOptions): Promise<D>;
  list(scope: string): Promise<D[]>;
  get(scope: string, id: string): Promise<D | null>;   // live only (superseded → null)
  remove(scope: string, id: string, identity?: Identity): Promise<{ ok: true }>;
}

function createDeclarationRegistry<D>(state: ObservedState, kind: DeclarationKind<D>): DeclarationRegistry<D>;
// viewKind / actionKind / subscriptionKind descriptors (services/workspace/*)
```

**Data model.** Fact key `${kind.ns}${id}` (e.g. `_views/`, `_subscriptions/`, `_actions/`), stamped `_meta.type = kind.factType`. `list = query(prefix, rankBy:'recency', optional listLimit)`. `get` returns `null` when `_meta.superseded`. `remove = supersede(...,null)`.

**Invariants & edge cases.**
- Storage + resolution only — evaluate stays kind-specific (ADR-0001 boundary, restated by ADR-0068).
- `validate` throws at `register` (the parse step).
- `get` returns live only (superseded → `null`, `declarations.ts:67-70`).
- `remove` of missing/superseded throws `not_found` (`declarations.ts:73-74`).
- Type/renderer/config kinds are resolve-shaped, NOT CRUD — deliberately kept out (ADR-0068).

**Reduces to.** **Fact.** A pure pass-through: register → `state.put`, list → `state.query({prefix, rankBy:'recency'})`, get → `state.get` (null if superseded), remove → `state.supersede(scope,key,null)`. Zero storage semantics of its own — Fact CRUD parameterised by a kind descriptor. This is the clearest "not a primitive, just a preset" capability in the subsystem. The **type kind** notably does NOT use this registry's CRUD (types are resolve-shaped, ADR-0068); the type system consumes it indirectly via its sibling declaration kinds, sharing the storage-vs-evaluate boundary.

**Connections.** Depends on Fact / `ObservedState` (`state.ts`). Used by `services/workspace/views.ts`, `actions.ts`, `subscriptions.ts`.

**Motivating ADRs.** ADR-0001 (Declaration registry), ADR-0068 (One declaration surface), ADR-0014.

---

## 9. UI-side parallel type model (`platform/ui/vocab.ts`)

**What it does.** A client-side re-implementation of the type-signal ladder and per-intent handler resolution, for surfaces (canvas/home/lit PWAs) that resolve "how does this fact open/render" **without a gateway hop**. `typeSignals` derives a fact's types most-specific-first (declared `_meta.type` → key prefix → tag prefixes); `resolve(fact, intent, decls)` tries each signal then each handler in order, templating `${id}/${key}/${type}/${match}/${value.path}` and returning a structured `{cell:{owner,name}, path}` the consumer materializes via the kernel's `cellUrl` — so the same declaration renders on the apex or any cell subdomain, for any owner.

**Public API** (`platform/ui/vocab.ts`)

```ts
type Intent = 'open' | 'edit' | 'create' | 'render' | 'embed' | 'preview';

interface TypeHandler { path?: string; cell?: string; surface?: string; act?: string; renderer?: string; hint?: string; cellRef?: { owner: string; name: string }; }
interface TypeDecl { manager?: string; icon?: string; label?: string; handlers?: Partial<Record<Intent, TypeHandler | TypeHandler[]>>; }

function typeSignals(fact: VocabFact): Array<{ type: string; match: string }>;
function resolve(fact: VocabFact, intent: Intent, decls: Record<string, TypeDecl>): TypeHandler | null;
function declFor(fact: VocabFact, decls: Record<string, TypeDecl>): TypeDecl | null;
function applyTemplate(tmpl: string, ctx: TemplateCtx): string | null;
function deriveId(key: string | undefined): string;
```

**Data model.** Consumes `{T: TypeDecl}` (`manager`/`icon`/`label`/`handlers`) — same shape as `$types`. Intent = `open|edit|create|render|embed|preview`. `applyTemplate` returns `null` if any var resolves empty → caller falls to the next handler (how alternatives work). Live: capture/inbox types carry two `open` handlers (lit `/r/log:${value.captured}` then bare `path:''`) — the alternative-fallthrough this resolves.

**Invariants & edge cases.**
- Pure — no DOM, no cell hardcoded; callers supply decls.
- `typeSignals` order = declared type, then key prefix, then tag prefixes (most specific first) (`vocab.ts:83-95`).
- `applyTemplate`: empty var → `null` handler (skip to next); `${value.*}` taken raw, `id`/`key`/`match` URL-encoded (`vocab.ts:122-140`).
- Cell implicit = type's `manager` unless the handler names another `cell`; unqualified owner inherits manager owner (`parseCellRef`, `vocab.ts:148-156`).
- `deriveId` degrades on missing key, never throws (`vocab.ts:62-67`).

> ⚠ **Coherence — type-render-duality / handler contract (PARTIAL · low · compounds).** The affordance HANDLER contract is defined twice with no shared owner: runtime `resolveType` exposes `handlers` as opaque `Record<string,unknown>` (`type-schema.ts:151,186`), while `vocab.ts:21-51` owns the entire *interpretation* of what a handler means (path/cell/surface/act/renderer/hint templating via `resolve`/`typeSignals`/`applyTemplate`, `vocab.ts:171-209`). The runtime attaches handlers but cannot validate or resolve them; only the UI can. This is the intended present-vs-routing split and works off shared `$types` data, so it **compounds** — but `TypeHandler` has no single source of truth. **Fix (optional):** have runtime `type-schema` import the `TypeHandler` shape from a shared spec so `Type.handlers` is typed rather than opaque, closing the last gap where a malformed handler decl is caught only at UI render time.

**Reduces to.** **Projection + Fact.** The same Projection *present-stage* concept as runtime `present.ts`, but a SEPARATE codebase — the one genuine near-duplication in the subsystem, deliberate per ADR-0044 Inc 2's "one resolver, N transports": the runtime resolves server-side (`resolveType`/`resolvePresent`), the UI resolves client-side over decls it was handed. Both consume the same Fact-stored `_types/<T>` declarations and both are the projection's present stage; they share the concept, not code. The split is a transport boundary, not a new primitive.

**Connections.** Depends on Type Declaration as a Fact (delivered to the client via `$types`) and kernel `cellUrl` (origin materialization).

**Motivating ADRs.** ADR-0044, ADR-0002, ADR-0012.

---

## 10. Granular type-declared scopes (`write:type:<T>` / `read:type:<T>`)

**What it does.** A type/tool can advertise a `scopeFamily` (`write:type:*` / `read:type:*`) so a client can be handed the NARROW vocabulary `write:type:note` instead of coarse `write:workspace`. Enforced by `enforceTypeWrite` / `enforceTypeRead`, which return early for internal (empty-scope) callers or coarse-scope holders and only require the granular scope for a granular-ONLY token — so it shipped **inert** for every pre-existing coarse/internal caller. Reads **deny** (can't silently elide across a fan-out): a type-scoped reader must pin `type` on query or peek a held-type fact.

**Public API** (`services/workspace/shared.ts`, `descriptors.ts`, `platform/runtime/auth.ts`)

```ts
function enforceTypeWrite(identity: Identity, type: string | undefined, key: string): void;  // shared.ts:156
function enforceTypeRead(identity: Identity, type: string | undefined, key: string): void;   // shared.ts:183
function holdsUnder(identity: Identity, family: string): boolean;                             // auth.ts:296
// descriptor: scopeFamily: 'write:type:*' | 'read:type:*'
```

**Data model.** Scope strings `write:type:<T>` / `read:type:<T>` under families `write:type:*` / `read:type:*`. `descriptors.ts` marks `remember`/`ingest` with `write:type:*` (`:133,:187`), and `peek`/`query`/`recall` with `read:type:*` (`:285,:303,:380`). Enforcement is keyed on the fact's `_meta.type`.

**Invariants & edge cases.**
- Inert for coarse `write:workspace`/`read:workspace` and internal (empty-scope) callers — early return (`shared.ts:157-158, 184-185`).
- Only granular-ONLY tokens are held to declared types.
- Writes gate one type per call; reads must pin an explicit held type or peek a held-type fact (**deny, not elide** — a partial view must not look complete, `shared.ts:176-192`).
- A type-scoped token may not write system vocabulary (`_…`) or untyped facts (`t = type && !key.startsWith('_')`).
- The granular family coexists with the coarse scope — it does not replace it.

**Reduces to.** **Fact + Projection.** Binds the type system to the Fact core's identity model: scope = IAM principal = OAuth target (LeadingKeys), and here the type *name* becomes a per-target authority axis over that scope. The gate is a projection preset over the grant/scope of the identity (ADR-0023 calls the coarse form the confused-deputy substrate; the fix bundles designation+authority per type). Reduces to Fact (the type stamped on the write, the slice scope being written) plus the grant-gate projection — an authority refinement, not a storage primitive.

**Connections.** Depends on Type Declaration as a Fact, `auth.ts` `holdsUnder`, and the **Grant axis**.

**Motivating ADRs.** ADR-0023 (Type-declared granular scopes), ADR-0022, ADR-0007, ADR-0008.

---

## Gotchas / non-obvious behavior

- **Flat keys ARE facets.** A type decl is a flat object; `resolveType` presents a *typed view* over it, not a parse into a separate structure. Adding a facet means adding a top-level key to `types.json` — `resolveType` must be taught to surface it (`type-schema.ts:175-189`), and `buildTypeVocabulary` still ships the flat key regardless (ADR-0014 row 3).
- **`undefined` is "silent", not "clear".** In `layer`/`mergeTypeDecl`, a slice cannot *remove* a canonical facet by setting it `undefined` — it is skipped. Only a concrete (non-`undefined`) value overrides. This is the exact bug ADR-0002 fixed; do not "optimize" `layer` to copy `undefined`.
- **Two label-rooting rules that disagree.** `resolveLabel` (runtime/kernel) roots `value.*`/`key`/`meta.*` on the fact *envelope*; home/home-next `factTitle` roots on `e.value` only and accepts strings only. A served `present.label` of `value.title` resolves server/kernel-side but mis-resolves in home (rescued only by the `title`/`name`/`content` heuristic). Numeric paths like `value.seq` silently fall to the key in home. See §6 coherence callouts.
- **`resolvePresent` is dead in product code.** Despite being the named ADR-0012 present stage, it has zero product call sites — the real server-side present resolution is `buildTypeVocabulary → resolveType` attaching the `present` facet. Don't assume calling `resolvePresent` is on the hot path; it is only re-exported and tested.
- **`KeyEdge` and `KeyEdgeRule` are duck-typed twins.** Structurally identical, bridged at `state.ts:943` by assignment with no import. Editing one does not touch the other.
- **Structured `fields` beats legacy `schema`.** If a decl has both, `parseTypeSchema` returns `fields` and ignores `schema` entirely (`type-schema.ts:63`). Legacy prose optionality is inferred (`?`/`optional`/`DEPRECATED` → optional; everything else → recommended).
- **Validation never blocks.** `schemaHints`/`missingRequired` only produce advisory strings attached to a `remember` write. A fact missing every "required" field still writes.
- **The type kind does NOT use `createDeclarationRegistry` CRUD.** Types are resolve-shaped (read-merged), not register/remove-shaped (ADR-0068). The registry serves views/actions/subscriptions; the type system shares only its storage-vs-evaluate *boundary*, via sibling kinds.
- **Inline affordances skip slice overrides.** `affordancesForTypes` reads the cached canonical vocabulary only — a caller's `_types/<T>` override is NOT folded into the inline `types` map on a read; only a full `read('$types')` (via `buildTypeVocabulary`) merges the slice.
- **Granular scopes shipped inert.** `enforceTypeWrite`/`enforceTypeRead` return early for any caller holding the coarse `write:workspace`/`read:workspace` scope or carrying no scopes (internal Mode-1). Only a granular-ONLY external token is constrained. Reads *deny* rather than elide, so a type-scoped reader gets an error, not a silently truncated view.
- **`applyTemplate` null = fallthrough.** In the UI resolver, an empty template variable makes the whole handler inapplicable (`null`), and `resolve` tries the next handler in order — this is the mechanism behind alternative handlers (e.g. capture opening in lit `/r/log:${value.captured}` else bare path).