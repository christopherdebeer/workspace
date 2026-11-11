# 01 — The "cell" overload & the core nouns

> Oblique strategy drawn for this ramble: **"Overtly resist change."**
> (extra card mid-ramble: *"Look at a very small object; look at its center."*)
>
> So this document does something slightly perverse: it argues *hard* for keeping
> the names we have. Naming stability is a feature of a substrate whose whole
> pitch is that capability lives in stable addresses (`whoami`/`read`/`act` never
> change; the dynamism is in the `target` string). Every rename is a tax on muscle
> memory, on MCP target stability, on docs, on user habit, and on the "promotion
> is a copy not a port" property. We steelman the conservative case until it
> *breaks* — and only then propose the minimum cut.

This is a generative inventory, not a decision. It maps every distinct meaning of
the overloaded nouns, cites where each lives, names the collisions, and proposes
disambiguations weighed through the "resist change" lens. Top 3 concrete
recommendations at the end.

---

## 1. Inventory — name → meanings → where used

### `cell` — the worst offender (≥4 live meanings)

| # | Meaning | Where (file:line) | Address / shape |
|---|---|---|---|
| C1 | **Deployable app / Lambda unit** — a tier-1 or tier-2 unit of code+route+IAM+table. `@c15r/lit`, `canvas`, `kernel`, `forge`/`cells`, `auth`. | `docs/dynamic-cells.md:41-63` (two tiers); `docs/substrate.md:30-37` (the working definition: "a **cell** = room + vocabulary + code"); whole `cells/` tree (`cells/lit/`, `cells/canvas/`, `cells/kernel/`) | dotted target `<cell>.<command>` or `@<owner>/<cell>.<tool>` — `docs/dynamic-cells.md:181-189`; `services/gateway/service.ts:48` (`PROVIDERS = ['workspace','cells','auth']`) |
| C2 | **Document fragment in lit** — the new authoring unit; a `cell:<id>` fact of `type: 'cell'` carrying `{ content }`. | `docs/lit-substrate-authoring.md:20-23`; `cells/lit/client/main.tsx:49` (`mintCell` → ``cell:${…}``), `:88` (`type: 'cell'`), `:115` (`saveCellSplit`) | fact key `cell:<id>`, `type: 'cell'` |
| C3 | **Canvas element** — a placed visual item; an `el:` fact stamped `type: 'canvas-element'`. | `cells/canvas/client/main.ts:693,1192` (`classList.add('canvas-element')`); `cells/canvas/index.ts:143` (`.canvas-element{…}` CSS); `docs/canvas-substrate-design.md:165` (storage stamps `type:'canvas-element'`) | fact `type: 'canvas-element'`, DOM class `.canvas-element` |
| C4 | **Control-plane noun (renamed)** — the cell that *mints* cells. Was `forge`, now `cells` (the tool namespace `cells.create`/`cells.call`/…). | `docs/dynamic-cells.md:3-6` (the rename banner); `services/gateway/service.ts:48` | tier-1 target prefix `cells.*` |
| C5 | **Σ-calculus "room"** — informal gloss: a cell *is* a room (scope of shared state). | `docs/substrate.md:30-37,50` | conceptual only |

So `cell` denotes: a unit of deployment, a unit of authoring, a unit of canvas
placement, the *factory* for the first, and the *room* metaphor — five readings,
three of them load-bearing in code at the same key prefix granularity.

### The foundational nouns (`fact`, `value`, `_meta`, `key`, `slice`, `workspace`, `target`, `substrate`)

| Noun | Meaning | Where (file:line) |
|---|---|---|
| **fact** | A situated datum `{ value, _meta }` at `(scope, key)` — the Σ-calculus `Loc`. The atom of the substrate. | `platform/runtime/state.ts:12-15,83-87`; `docs/substrate.md:100-101` |
| **value** | The payload half of a fact. `Entry.value: V \| null` (null when elided). | `platform/runtime/state.ts:84-86,176,486` |
| **_meta** | The envelope half: provenance + dynamics + computed salience (`revision`, `seq`, `writer`, `writers`, `superseded`, `type`, `tags`, `score`, …). | `platform/runtime/state.ts:46-87` |
| **key** | The within-scope identifier of a fact. Carries *meaning* via prefix convention (`doc:`, `cell:`, `el:`, `_doc/`, `_canvas/`, `_types/`, `_renderers/`, `_views/`). | `state.ts:47` ("per-(scope,key)"); `docs/type-vocabulary.md:54` (`_types/<type>`); `docs/lit-substrate-authoring.md:20-23` |
| **slice** | A *person's* view of the substrate — "one Substrate, per-user view". Often used interchangeably with the user's scope. | `docs/substrate.md:24,218-220` ("scoped to the caller's slice"); `state.ts:24` ("the slice that matters") |
| **scope** | The authority boundary / partition key for facts; the Σ `scope(s,e)`. `StateStore` methods are all `scope`-keyed. | `platform/runtime/state.ts:13,174,204-256`; `docs/substrate.md:106` |
| **workspace** | (a) the *product* ("a personal productivity workspace" — `CLAUDE.md`); (b) the flagship tier-1 cell + tool namespace `workspace.*`. | `CLAUDE.md:1`; `docs/substrate.md:178-186`; `services/gateway/service.ts:48`; targets `workspace.query`/`workspace.recall`/`workspace.link` |
| **target** | The dotted address argument that carries *all* capability for `read`/`act`. `<cell>.<command>` or `@<owner>/<cell>.<tool>` or `$catalog`/`$types`. | `docs/dynamic-cells.md:178-195` |
| **substrate** | (a) the *mental model* / thesis ("a shared substrate of truth"); (b) the concrete state primitive in `platform/runtime/state.ts`; (c) the shared DynamoDB table `SubstrateTable`. | `docs/substrate.md:65-71`; `state.ts:1-2`; `platform/CLAUDE.md` (`substrate-table.ts`) |

---

## 2. Tensions & collisions

1. **`cell` C1 vs C2 vs C3 — the core collision.** A `doc` opened in the `@c15r/lit`
   *cell* (C1) is composed of `cell:` *cells* (C2). A `canvas` *cell* (C1) renders
   `canvas-element` *cells* (C3, informally). The sentence "the cell renders cells"
   is grammatical and true and useless. This is worst in lit, where both meanings
   appear within one file: `cells/lit/client/main.tsx:49` mints a C2, while the
   file lives in the C1 named `lit`.

2. **`cell` C1 vs C4 — the factory shares the name of its product.** The control
   plane was `forge` (a good, distinct noun) and got renamed to `cells`
   (`docs/dynamic-cells.md:3-6`). Now `cells.create` reads as "the cells cell
   creates a cell." The rename *increased* overload to win brevity at the MCP
   surface. This is the one collision we arguably *added* on purpose.

3. **`slice` vs `scope` vs `workspace` — three words, ~one referent.** A user's
   `scope` (authority partition) ≈ their `slice` (the view) ≈ "their workspace".
   `state.ts` is rigorous (`scope` everywhere); the docs drift between `slice` and
   `scope` (`docs/substrate.md:218-220` uses both in one paragraph). Not a code
   collision, but a *prose* one that leaks into how users address things.

4. **`substrate` — model / module / table.** Three layers wear the name. Usually
   disambiguated by context, but "write to the substrate" is ambiguous between the
   `state.ts` semantics and the `SubstrateTable` storage.

5. **`key` carries type by convention, not by field.** `cell:`/`doc:`/`el:`/`_doc/`
   prefixes encode kind *in the string* (`docs/lit-substrate-authoring.md:20-23`).
   So the C2 ambiguity is literally baked into key syntax: `cell:abc` is a
   document fragment, but `@c15r/lit` is a deployable. The prefix `cell:` and the
   noun `cell` (C1) look alike but mean opposite tiers.

6. **`block` is already a rejected name.** `docs/lit-substrate-authoring.md:14-23`
   records the migration *away* from `blocks[]` to `cell:` facts; `:137` says
   "`block` was rejected as the old naive model." So re-using `block` for C2 is
   off the table — it would resurrect a retired concept.

---

## 3. Candidate directions (through the "resist change" lens)

For each: state the conservative case (keep it) first, then where it breaks.

### Direction A — Keep `cell` everywhere; disambiguate by qualifier only

**Resist-change case (strong).** `cell` is the substrate's signature noun. It is in
`CLAUDE.md`-adjacent docs, in the working definition (`docs/substrate.md:30`), in
the tool namespace (`cells.*`), in directory names (`cells/`), in fact keys
(`cell:`), in CSS (`.canvas-element`), and in every design doc's prose. Renaming
*any* of these:
- breaks **MCP target stability** — `@owner/cell.tool` is a contract clients
  cache; the docs sell "no reconnect" precisely because targets don't move
  (`docs/dynamic-cells.md:166-189`).
- breaks **promotion-is-a-copy** — a tier-2 dynamic cell graduates to tier-1 by
  copying the *same* module (`docs/dynamic-cells.md:294-304`); divergent nouns
  across tiers reintroduce a port.
- breaks **muscle memory & docs** — dozens of docs say "cell"; a rename forces a
  doc-wide sweep and an alias era (the doc itself anticipates this:
  `lit-substrate-authoring.md:137` "rename in lit + new code and alias elsewhere").

**Where it breaks.** Qualifiers only paper over C2/C3. "doc-cell" vs "canvas-cell"
vs "cell" (the app) is three qualified nouns where two of them are *not* the
deployable — the head noun still misleads. A reader meeting `cell:` in a key still
can't tell tier without context. Qualification is cheapest but leaves the verb
"the cell renders cells" intact.

### Direction B — Keep `cell` for the deployable (C1/C4); rename the document fragment (C2)

Candidates floated: `node` / `passage` / `stanza` / `fragment` / `entry`
(`docs/lit-substrate-authoring.md:133-137`); `block` is **rejected** (§2.6).

- **`fragment`** — accurate (a doc *is* a view over fragments), neutral, no
  existing collision in the codebase. Cost: a new `fragment:` key prefix, a
  `type: 'fragment'` migration with a legacy `cell:` fallback (lit already does
  legacy `blocks[]` fallback at `lit-substrate-authoring.md:25-30`, so the pattern
  exists). MCP cost: low — C2 facts are addressed by *key*, not by a `cell.tool`
  target, so the stable MCP surface is **untouched**.
- **`passage` / `stanza`** — evocative (digital-garden flavor matches the
  `[[wiki-link]]` model, `lit-substrate-authoring.md:79-92`) but jargon-y; `stanza`
  implies verse, `passage` implies prose — both narrower than "any fenced/typed
  block."
- **`entry`** — collides with `state.ts`'s `Entry`/`EntryMeta` (`state.ts:46,83`),
  the read-facing wrapper for *every* fact. Hard reject: it would alias the most
  foundational type.
- **`node`** — collides with canvas (`cells/canvas/client/main.ts:556` `node?.dataset`,
  DOM nodes everywhere) and with graph-link prose. Weak.

**Resist-change verdict:** B is the *targeted* cut. It touches only C2, whose
addressing is by key (cheap to alias), and leaves C1/C4 — the names with real MCP
and promotion contracts — frozen. `fragment` is the front-runner; `entry` is
disqualified by `state.ts`.

### Direction C — Rename the *control plane* back off `cells` (undo the C4 overload)

The rename `forge` → `cells` (`docs/dynamic-cells.md:3-6`) is the one collision we
*chose*. `forge` was distinct and good. Reverting C4 to `forge` (or `mint`,
`atelier`, `kiln`) removes "the cells cell" awkwardness for the price of the
brevity the rename bought.

**Resist-change case:** the rename is *recent* and the doc still says "forge" in
prose throughout — so reverting is arguably *less* change than the rename was, and
restores a name still warm in the codebase (`services/forge/`, `cell-template.ts`
at `dynamic-cells.md:234`). **Where it breaks:** `cells.*` may already be a cached
MCP target for clients; a second flip churns the surface again. Net: only worth it
if `cells.*` adoption is still near-zero.

### Direction D — Split `slice`/`scope`/`workspace` in prose (no code change)

Pure documentation discipline: reserve **`scope`** for the authority boundary
(matches `state.ts`), **`slice`** for "the projection a reader sees", and
**`workspace`** only for the product and the tier-1 cell. Zero code cost, zero MCP
cost — it's a style rule. Resist-change lens *favors* this: it changes no names,
only tightens usage.

---

## 4. Top 3 concrete recommendations

### 1. Rename the lit document fragment C2: `cell:` → `fragment:` (`type: 'fragment'`), keep `cell:` as a read alias.
This is the single highest-value cut and the one the lit doc explicitly defers
(`docs/lit-substrate-authoring.md:133-137`). It dissolves the "the cell renders
cells" collision at its worst site, costs nothing at the MCP surface (C2 is
key-addressed, not a `cell.tool` target), and reuses lit's existing
legacy-fallback pattern. Touch points: `cells/lit/client/main.tsx:49` (`mintCell`),
`:88` (`type: 'cell'`), `:368` (the ```` ```cell ```` fence), `cells/lit/shared.tsx:82`,
`cells/lit/types.json`. Reject `entry` (collides with `state.ts:46,83 Entry`) and
`block` (already retired, `:137`). Front-runner `fragment`; second `passage`.

### 2. Keep `cell` for the deployable unit (C1) frozen — and write the freeze down.
The deployable `cell` is load-bearing in MCP targets (`@owner/cell.tool`,
`docs/dynamic-cells.md:181-189`), in the promotion-as-copy property
(`:294-304`), and in the working definition (`docs/substrate.md:30`). Renaming it
would tax the exact stability the substrate sells. Declare C1 immutable so future
naming rambles don't relitigate it; route all disambiguation pressure onto C2/C3
instead. Rename `canvas-element` (C3) only inside canvas (DOM class +
`type` stamp at `cells/canvas/client/main.ts:693,1192`, `index.ts:143`) if needed —
it's already qualified, so it's the *least* urgent.

### 3. Reconsider the `forge` → `cells` rename (C4); adopt a prose split for `scope`/`slice`/`workspace`.
The `forge`→`cells` rename (`docs/dynamic-cells.md:3-6`) is the only *self-inflicted*
overload — it made "the cells cell creates a cell" grammatical. If `cells.*` MCP
adoption is still low, revert to `forge` (distinct, still in the tree at
`services/forge/`). Independently and at zero cost, adopt Direction D as a style
rule: **`scope`** = authority boundary (per `state.ts`), **`slice`** = a reader's
projection, **`workspace`** = product + the one tier-1 cell — ending the drift in
`docs/substrate.md:218-220`.
