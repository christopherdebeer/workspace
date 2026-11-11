# Links / Graph / Relations — Naming Ramble

> Oblique card: **"Remove specifics and convert to ambiguities."**
> This walk interrogates the relation vocabulary of the substrate graph: the
> verbs (`link`/`unlink`/`neighbors`), the structural words (`edge`, `inbound`,
> `outbound`, `centrality`), and above all the open-ended `rel` namespace
> (`related`, `produces`, `produced-by`, `grounds`, `refines`, `derived-from`,
> `on`, `relates`). I play the card both ways: where the rel set is
> *over-specified* and would be stronger as a few ambiguous primitives, and
> where ambiguity *already* hurts (direction confusion, near-synonyms drifting).

---

## 1. The shape of the graph layer

The graph is **not** a parallel index — it is first-class typed edges stored
beside facts in the same scope. The canonical surface is the `workspace` cell
(`services/workspace/handlers.ts`), backed by `platform/runtime/state.ts` over a
`SubstrateTable` with a GSI for inbound edges (`gsi-in`).

The runtime contract (`platform/runtime/state.ts:627-633`):

```ts
link(scope, from, rel, to, strength, identity)   → LinkResult   // EdgeRecord + fromExists/toExists
unlink(scope, from, rel, to, identity)            → { ok: true }
neighbors(scope, key, { dir, rel }, identity)     → { outbound, inbound, entries }
edges(scope)                                      → EdgeRecord[]    // the whole slice
```

An **edge** is `{ scope, from, rel, to, strength? }` keyed by the 4-tuple
`(scope, from, rel, to)` (`state.ts:1073`), so `rel` is part of identity: two
facts may be joined by many edges of different `rel`. Direction is intrinsic —
`from --rel--> to`. Dangling edges are allowed and *surfaced* (the `fromExists`/
`toExists` hints at write time, `state.ts:583-588`), never blocked.

The MCP-facing tool vocabulary (`workspace.*`, allow-listed in
`services/dispatch/service.ts:54`):

| Tool | Kind | Meaning |
| --- | --- | --- |
| `workspace.link` | act | add a typed directed edge (`handlers.ts:576`) |
| `workspace.unlink` | act | remove an edge (`handlers.ts:602`) |
| `workspace.neighbors` | read | one-hop traversal around a key (`handlers.ts:619`) |
| `workspace.links` | read | every edge in the slice, prefix-filterable (`handlers.ts:643`) |

`centrality` is a *derived salience term*, not an edge op: graph degree (in+out)
saturating into `[0,1]` (`state.ts:77-78, 379-380, 428`), folded into the score
with a tunable `centralityWeight` (default `.10`; the `connected` lens raises it
to `.40`, `state.ts:349`). So the graph feeds attention, not just navigation.

---

## 2. Inventory — every `rel` in use

| `rel` | direction / meaning | where written (file:line) |
| --- | --- | --- |
| `related` | symmetric-ish "see also"; wiki-link reconciliation | `cells/lit/client/main.tsx:100-101` (`syncCellLinks`) |
| `produces` | A *produces* B (agent-run → output cell) | `cells/lit/client/main.tsx:500` |
| `produced-by` | B *produced-by* A (repl output → source) | `cells/viewers/client/main.ts:305` |
| `derived-from` | new element *derived-from* source | `cells/canvas/.../menu-item-helpers.ts:99`, `menu-items.ts:123` |
| `on` | capture *on* a day-log (`log:<day>`) | `cells/input/client/main.ts:76` |
| `grounds` | evidence *grounds* a decision | tests `tests/workspace.test.ts:356`; docstring `handlers.ts:578` |
| `refines` | B *refines* A | `tests/workspace.test.ts:357` |
| `relates` | generic relation (test fixture) | `tests/workspace.test.ts:436,440` |
| `rel` | literal placeholder string | `tests/state.test.ts:147-149` |

The docstrings advertise an *open verb space*: link's description literally says
*"(a verb, e.g. 'grounds')"* and *"e.g. rel: 'grounds', 'refines', 'relates'"*
(`handlers.ts:578,585`). There is **no enum, no registry, no validation** — any
string is a legal `rel`. The vocabulary is pure convention, discovered by
grepping call sites, exactly as this ramble did.

Adjacent naming notes:
- **"neighbors"** is the read word; **"edges"** the storage word; **"links"**
  the slice-wide read and the user-facing verb (`link`). Three words for the
  same relation, partitioned by altitude (UX verb / API read / storage record).
- **"backlinks"** appears only as a *UI projection* of inbound `related` edges —
  lit's "Linked from" panel (`docs/lit-substrate-authoring.md:86-92`,
  `cells/lit/client/main.tsx:561`), computed via `neighbors(dir:'in')`. It is
  not a stored rel; it is a rendering of inbound direction.
- **"dangling"** names an edge whose endpoint is missing/retired
  (`state.ts:606-607`, attention/tending).
- **`migrateLinks`** on `supersede` re-points a superseded fact's edges at its
  successor (`state.ts:611-612`, `tests/workspace.test.ts:379-385`).

---

## 3. Tensions

### 3.1 Over-specification: the rel set is a long tail of near-synonyms

Nine rels, several of which mean nearly the same thing at the graph level:

- `related` / `relates` — the *same intent* (generic association) under two
  spellings, one in prod (lit), one in tests. This is drift already happening.
- `produces` / `produced-by` / `derived-from` — three names for **provenance**
  (this fact came from that one). `produces` and `produced-by` are the *same
  edge* read from opposite ends (see 3.2); `derived-from` is a third synonym for
  the inverse of `produces`.
- `grounds` / `refines` — genuinely distinct epistemic relations (evidence-for
  vs. improves-upon), but they live only in tests; nothing in prod writes them.

The card says *convert to ambiguities*: at the **storage/traversal** layer, the
graph does not care whether B refines or grounds A — it cares about
`(direction, strength)`. Most consumers (`neighbors`, canvas edge render,
centrality) ignore `rel` entirely or filter by exactly one. The rich rel names
are **annotations carried for human/agent legibility**, not structural facts the
engine uses. That argues for a *small* structural core + a *free* annotation
field, rather than pretending every rel is first-class.

### 3.2 Direction inconsistency: `produces` vs `produced-by`

This is the sharpest concrete bug-shaped tension. Two cells record the **same
conceptual relation** (a source and its generated output) with **inverted
direction and inverted naming**:

- lit, agent output: `link(from: agentRunFact, to: outputCell, rel: 'produces')`
  — source `--produces-->` output. (`cells/lit/client/main.tsx:500`)
- viewers, repl output: `link(from: outputKey, to: sourceCell, rel: 'produced-by')`
  — output `--produced-by-->` source. (`cells/viewers/client/main.ts:305`)

Both are "provenance," but a traversal can't treat them uniformly: to find "what
did this cell produce," you must query *outbound `produces`* **and** *inbound
`produced-by`*. `derived-from` (canvas) is a *third* encoding of the same arrow.
A consumer wanting "show me provenance around this fact" must know all three
names and both directions. Ambiguity is hurting here — but the fix is *more*
discipline (one canonical direction), not more names.

### 3.3 Under-specification: nothing governs the namespace

There is no registry, enum, or `$rels` discovery target. Contrast the
**type vocabulary** (`docs/type-vocabulary.md`), which is being made explicit and
agent-discoverable via `read("$types")`. Rels have no equivalent: an agent
handed the graph cannot ask *"what relations exist in this slice, and what do
they mean?"* It must infer from edges it happens to see. The substrate's own
tenet — *vocabulary is the protocol, declared as data* — is honored for facts
and types but **not for relations**.

### 3.4 "neighbors" — right word?

`neighbors` returns `{outbound, inbound, entries}` — it is genuinely a *one-hop
graph traversal*, and "neighbors" reads well for agents ("what's around this
fact"). But it conflates two things: the **edges** (typed, directional) and the
**entries** (the neighbor facts themselves). The name foregrounds the nodes; the
payload foregrounds the edges. `relations(key)` or `around(key)` would name the
edge-centric reality more honestly; `neighbors` is fine if we accept it as the
node-centric convenience read.

---

## 4. Candidate schemes

### Scheme A — Tighten: a small closed `rel` core + free annotation
Collapse the long tail into a handful of **canonical, directional** primitives,
each with a fixed arrow, and demote the rest to a free `note`/`as` annotation:

| canonical rel | direction (always) | absorbs |
| --- | --- | --- |
| `relates` | symmetric (store one direction, read both) | `related` |
| `produces` | source `-->` output (provenance, one direction only) | `produced-by`, `derived-from` |
| `grounds` | evidence `-->` claim | — |
| `refines` | successor `-->` predecessor | — |
| `on` | item `-->` container/context | — |

Rule: provenance is **always** written `source --produces--> output`; readers
never need `produced-by`. `neighbors(dir:'in', rel:'produces')` *is* "what
produced this." Keep an optional free-text `as` on the edge for the long tail,
so nuance survives without inflating the structural namespace. This is the
card's "convert to ambiguities" applied to the *core*: fewer, broader rels;
detail moves to an optional label.

### Scheme B — Loosen fully: one edge, `rel` is just a tag
Go maximally ambiguous: a single structural relation (a typed directed edge with
`strength`), `rel` purely a free-text human/agent label with **no semantics the
engine reads**. Direction is the only structural fact. Traversal is always
"edges in / edges out"; meaning is interpreted by the reader. This matches what
the engine *already does* (centrality, neighbors, canvas render ignore `rel`).
Risk: provenance/backlink consumers that *do* branch on `rel` (lit's
`e.rel === 'related'` filter, `main.tsx:97`) lose their handle — they'd filter on
a convention with no guarantees.

### Scheme C — Govern: a `$rels` registry mirroring `$types`
Keep an open namespace but make it **declared and discoverable**. A cell that
uses a rel declares it: `{ rel, inverse?, symmetric?, label, direction-gloss }`,
written to a `_rels/<rel>` fact, surfaced via `read("$rels")` (the exact move
`docs/type-vocabulary.md` makes for types). The engine stays rel-agnostic, but
`produces`/`produced-by` are declared *inverses of one edge*, so a traversal can
canonicalize. Agents gain a legible relation graph. This is the
"vocabulary-as-data" tenet applied to relations — additive, no breaking change.

### Scheme D — Hybrid (recommended blend)
Scheme A's **canonical direction discipline** (kill `produced-by`/`derived-from`
as stored rels; one provenance arrow) + Scheme C's **`$rels` discovery** for the
open tail + Scheme B's **honesty** that the engine reads only direction and
strength. Tighten where ambiguity bites (provenance direction), loosen where
specificity is theater (the engine never branches on `grounds` vs `refines`),
and *declare* the middle so it's legible.

---

## 5. Top 3 concrete recommendations

1. **Fix provenance direction — pick one arrow, retire two names.**
   Adopt `source --produces--> output` as the single canonical provenance edge.
   Migrate `cells/viewers/client/main.ts:305` (currently `produced-by`, inverted)
   and `cells/canvas/.../menu-item-helpers.ts:99` + `menu-items.ts:123`
   (`derived-from`) to write `produces` in the canonical direction. Then "what
   did X produce / what produced X" is one rel read in two directions, and the
   "Linked from"/provenance panels stop needing three names. This is the only
   tension that is actively *wrong* today, not just verbose.

2. **Add a `$rels` discovery target + a thin canonical set, mirroring `$types`.**
   Define a small canonical rel list (`relates`, `produces`, `grounds`,
   `refines`, `on`) with declared `inverse`/`symmetric`/gloss, surfaced via
   `read("$rels")` alongside `read("$types")` (`docs/type-vocabulary.md:128`).
   Keep `rel` an open string (no hard enum — don't break dangling/experimental
   edges), but document the canonical set in the `link` tool description
   (`services/workspace/handlers.ts:578,585`) and fold `related`→`relates` so the
   prod spelling and the test spelling stop diverging. Vocabulary becomes
   protocol for relations, not just facts.

3. **Rename for honesty at the edges, alias for compatibility.**
   The engine reads only *direction + strength*; say so. Keep `neighbors` as the
   node-centric convenience read but document it as edge-centric, and consider an
   `relations(key)` alias that returns edges-first. Treat `rel` in the schema
   docstring as "a label; the engine uses direction + strength" so authors stop
   over-investing in exact verbs where the system is already ambiguous. Net: a
   *small* governed core (rec 2), one *correct* provenance direction (rec 1), and
   *truthful* names that admit the graph is mostly direction (rec 3).
