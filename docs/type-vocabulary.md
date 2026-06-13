# Type vocabulary — facts know their cell, and how to be opened

> A foundations proposal. Fact `type`s and the cells that manage them are
> coupled today — but the coupling is **implicit**, hardcoded in three places
> that don't share. This doc proposes making it **explicit and general**: a
> type declares its managing cell and its handlers (open / edit / render /
> create), so any surface — home, canvas, an agent — can resolve "what can I do
> with this fact, and where" uniformly. This is the **vocabulary** primitive
> `substrate.md` flagged as ❌ *"implicit in TypeScript today — the next seam."*

## The problem: one coupling, implemented three times

A fact's `type` and the cell that renders/edits/owns it are connected, and the
system already relies on that connection — ad hoc, in places that don't share:

1. **`_types/<type>`** (home) — `{ icon, titlePath, href }`: a label and a
   single "open" URL, read from the user's slice. (`services/home/client`)
2. **`_renderers/<type>`** (canvas) — renderer source (`mount`/`update`) for
   drawing an element inline; a *separate* registry that *also* reads `_types`
   for icons. (`cells/canvas/.../substrateTypes.ts`)
3. **Hardcoded conventions** (home `factHref`) — `doc:`→`@c15r/lit`,
   `capture`/`inbox/`→`@c15r/input`, `canvas:`→`@c15r/canvas`, `cell`→its
   address. The cell↔type map literally baked into one client.

…plus dotlit's `!plugin` **scope ladder** (`parser·renderer·viewer·onselect·
menu·…`, per-document / global / shared — `docs/dotlit-review.md`), the most
mature version of the idea, but trapped inside lit.

Four partial, overlapping answers to one question is the symptom. Every new
cell that owns a fact kind has to teach home (and canvas, and agents) about its
types by hand, or its facts stay opaque and unopenable.

## The reframing: this is the "vocabulary" primitive

`substrate.md`'s working definition is *"a **cell** = a **room** (scope) + a
**vocabulary** (the kinds of facts and actions it biases toward) + **code**."*
The vocabulary primitive's status is **❌ "implicit in TypeScript today — the
next seam."** A cell declaring *"I own type `doc`; here is how to open / edit /
render / create it"* **is** that vocabulary, made data.

It is also the missing third leg of the read/act surface. Today `read`
observes and `act` mutates; what's absent is the **associations** layer —
*given this fact, what are its verbs and where do they live?* It is `$catalog`
for **data** rather than for capabilities. An opaque `{value, _meta}` becomes
openable / editable / renderable by anyone, without anyone hardcoding which
cell owns it.

## The shape

One **type-handler declaration** — extend `_types/<type>`, fold in
`_renderers`, borrow dotlit's ladder:

```jsonc
// _types/doc
{
  "manager": "@c15r/lit",          // the cell that owns this type's lifecycle
  "icon": "📄",
  "label": "value.title",          // a path into the value for a human label
  "handlers": {
    "open":   { "surface": "/@c15r/lit?doc=${id}" },          // a URL into a cell
    "edit":   { "surface": "/@c15r/lit?doc=${id}&edit=1" },
    "embed":  { "surface": "/@c15r/lit?doc=${id}&embed=1" },  // the canvas static-embed, generalised
    "render": { "renderer": "_renderers/doc" },               // bridges registry #2
    "create": { "act": "@c15r/lit.create" }                   // a declared act target
  }
}
```

A handler resolves to one of:

| target | meaning | used by |
| --- | --- | --- |
| `surface` | a URL into a cell (open/edit/embed) | home links, canvas cell-elements, new tabs |
| `act` | a declared `act` target (does something) | create, custom verbs, agents |
| `renderer` | a `_renderers/<type>` fact (inline draw) | canvas, home view tiles |
| `hint` | a built-in render hint (`markdown`/`metric`/…) | home/canvas inline fallback |

One generic resolver every surface and agent shares:

```
resolve(fact, intent) → { surface? | act? | renderer? | hint? }
```

Home's whole `factHref` collapses to `resolve(fact, 'open').surface`; canvas's
renderer lookup becomes `resolve(fact, 'render')`; an agent handed a fact key
can ask *"how do I edit this type?"*. A surface (UI), an act (MCP affordance),
or a renderer (inline) are `substrate.md`'s *"one declaration → MCP tool + UI"*
realised at the **type** level — three modalities of *what can be done with
this kind of fact*.

## Decisions to settle (the reason this is a doc, not a patch)

1. **Ownership & resolution ladder — where the grants grammar pays off.**
   Who may write `_types/<type>`, and where does the canonical one live? The
   clean model mirrors dotlit's ladder, lifted to the substrate and gated by
   the scope grammar (`scope-grants.md`):

   - **cell-declared canonical** — on deploy, a cell registers the types it
     manages into a **platform/registry scope**, gated so only the type's
     manager may declare it (a `platform:types:<owner>/<type>` grant);
   - **per-user override** — a user's slice `_types/<type>` overrides the
     canonical (own icon, "open with X instead");
   - **convention → generic JSON viewer** as the floor.

   Resolution: **user override > cell-declared canonical > convention >
   generic**. That ladder is a direct application of the scope grammar — *who
   may write the canonical type registry* is a grant.

2. **Converge, don't fork a fourth.** The single most important discipline:
   fold `_types` (presentation/routing) and `_renderers` (inline render) into
   **one** registry where render is one intent referencing a renderer fact.
   Adding a third parallel thing is the failure mode this doc exists to avoid.

3. **`edit` composes with grants.** You may `open` (read) a shared fact but
   `edit` only with a write grant / through the manager's authority — the type
   registry and the grants grammar compose (open is read-ish, edit is
   act/write). The "open/edit path" is therefore *capability-aware*.

4. **Intent vocabulary** — small, open, standardised: `open`, `edit`, `create`,
   `render`, `embed`, optionally `preview`/`menu`. Map dotlit's ladder onto
   these rather than inventing a parallel set.

5. **Id-derivation & templating** — generalise the existing
   `${id}` / `${key}` / `${value.x}` substitution (in `factHref` today) with a
   defined id rule per type (today's `doc:` / `el:` prefix-stripping is ad
   hoc); let a type declare its key pattern.

6. **Agent discovery** — `read("$types")` (like `$catalog`) returns the
   handler table, scope-filtered, so the substrate's edit graph is legible to
   agents, not just the UI. This is the MCP-native dividend: an agent can
   navigate "this fact → open it → its neighbours → edit one" generically.

7. **"Open with" / alternatives** — a type may have more than one handler for
   an intent (default + alternatives), like file associations. Defer the UI,
   but keep the schema list-friendly so it's not a later breaking change.

## Why it's the right next primitive

- It passes `substrate.md`'s own test — *a new fact kind → a vocabulary entry,
  no platform edit*: deploy a cell, it declares its types, and every surface
  instantly knows how to open/edit its facts.
- It **deletes** the hardcoded `@c15r/...` strings from home (`factHref`),
  unifies canvas's two registries, and gives agents a navigable edit graph —
  all from one declaration.
- It composes with the two adjacent threads:
  - **home phase-3 layout** (`_home/layout`, `home-cell.md`): a layout pins
    facts and views; each rendered fact gets its open/edit affordances from its
    *type*, not from home. Same seam — *"the UI comes from the registry, not
    code."*
  - **grants** (`scope-grants.md`): ownership of a type's canonical
    declaration, and the `edit` gate, are scope grants.

## Sequencing

1. **This doc / decision** — pin the schema, the resolution ladder, and the
   cell-declares-its-types contract (the ownership scope decision is the one
   that needs deciding deliberately; it touches the grants grammar).
2. **Resolver** *(shipped 2026-06-13)* — `platform/ui/vocab.ts`:
   `TypeDecl`/`TypeHandler`, `typeSignals` (type → key-prefix → tag, most
   specific first), `applyTemplate` (`${id}`/`${key}`/`${type}`/`${match}`/
   `${value.path}`, alternatives skip on an unresolved variable), `resolve(fact,
   intent, decls)` and `declFor`. Pure, no cells hardcoded. Unit-tested
   (`tests/type-vocab.test.ts`, 15 cases mirroring the old routing + overrides
   + non-open intents). *Gateway `read("$types")` discovery is still to come.*
3. **Migrate the call sites** — home *(shipped)*: `factHref`/`typeIcon`/
   `factTitle` now go through `resolve`/`declFor` over a default decl table
   (`services/home/client/type-decls.ts`, parc's conventions as data) merged
   with substrate `_types/<type>` overrides (old-shape `{icon,titlePath,href}`
   facts are normalised). The imperative `factHref` branching and the
   hardcoded `@c15r/...` strings are gone from home. *Canvas `_renderers`
   lookup → `resolve(...,'render')` is still to come.*
4. **Cells declare their types on deploy** — lit→`doc`, canvas→`board`/canvas
   element, input→`capture`, models→`agent-run`, regwatch→its item type. The
   couplings become explicit and the default table in home shrinks toward
   empty. *(Not started.)*
5. **`edit` + grants, "open with", per-user overrides** — the richer rungs,
   once the floor is proven. *(Not started.)*

> Net: today a fact is opaque and only *home* (via hardcoded conventions) knows
> a `doc` opens in lit. Make the type→cell handler explicit and the substrate
> gains its **associations** layer — the vocabulary primitive — so facts carry
> their own open/edit path, surfaces stop hardcoding cells, and agents can walk
> the edit graph. It is the same "vocabulary as data" move that `workspace`
> made for state and `scope-grants` made for authority, applied to *what a fact
> is for*.
