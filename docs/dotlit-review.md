# dotlit, deeply reviewed — and what it changes for the canvas

> A deep read of `dotlitdev/dotlit` (2020–2024, dotlit.org): the `.lit`
> literate-markdown system — parser (remark-based: sections, cells,
> wiki-links, frontmatter), React renderer/client, plugin system, REPLs,
> LightningFS + ServiceWorker + GitHub persistence, CLI generator, and
> ~150 daily-log documents of lived use. Read alongside
> [`canvas-substrate-design.md`](./canvas-substrate-design.md), which it
> predates by four years and substantially anticipates.

## What dotlit is

Markdown, plus: **Sections**, **Cells** (interactive and executable code
blocks), and **meta-programming over its own AST**. Its declared lineage is
the influences mind-map on its own homepage: Digital Gardens (knowledge
graph, thinking in public), Literate Programming (runbooks, notebooks),
Guided Learning, Rapid Prototyping. Its stated ambition is the platform's
own tenet, eight years early:

> *"trying not to be a separate system from which a student or project
> **graduates** but which is itself an acceptable development environment."*

The system is self-hosted in the strongest sense: the parser, renderer,
client, and plugin docs are themselves `.lit` documents; the homepage runs a
live search cell; plugins ship inside pages.

## The five mechanisms that matter

### 1. The cell meta-grammar — vocabulary as plain text

Every fenced code block carries a one-line declaration
(`parser/codeblocks.js`, with a faithful `metaToString` round-trip):

```
[>] lang [filename|uri] !directive… attr=value… #tag… [< source] [> output]
```

Real examples from the corpus:

```
js !plugin type=proxy id=corsProxy !collapse < ./plugins/other/cors-proxy.js
uml !collapse repl=uml > img influences.svg
>img influences.svg attached=true updated=1625694616836
>css viewer=style #styling #tweaks
```

A cell *declares* its renderer (`viewer=`), executor (`repl=`), data flow
(`<` transclude in, `>` emit out), visibility (`!collapse`), provenance
(`attached`, `updated=`), and tags — **a declared vocabulary, serialized in
markdown, human-editable as text**. This is "actions/views as data" in
2021, with the additional property the substrate's JSON forms lack: the
declaration *is* the artifact's plain-text representation.

### 2. Plugins as content, with a scope ladder

`!plugin` cells are extracted at parse (`renderer/extractPlugins.js`),
loaded as ES modules from data-URIs, and typed:
`parser · renderer · transformer · viewer · repl · onsave · onload ·
onselect · menu · data · setting`. Scope rules (`plugin_system.lit`):

- **per-document** by default (evaluated sequentially, duplicates overwrite);
- **global** by moving to the special `config` page;
- **shared** by making the plugin an *output cell with a filename* and
  transcluding it from other documents.

This is the canvas design's "renderer facts" tier, implemented — including
the trust posture (a plugin affects only the document that declares it
unless deliberately promoted) and the sharing mechanic (reference, not
copy). The viewer set itself (`Viewers.jsx`) already includes `uri`/`iframe`
(surface-in-document = the cell-element tier) and `script`/`style`
(document-level effects).

### 3. Execution writes facts

`repl=uml > img out.svg` runs the cell and **persists the result as a new
`>img` output cell, `attached=true`, with an `updated=` timestamp** — the
document accretes its own outputs as content-with-provenance. That is
`remember(key, value, via: repl)` plus a `produces` link, in markdown. The
legacy workspace's `run_complete → produces` edges and dotlit's attached
outputs are the same idea discovered twice.

### 4. Transclusion — and the bug that defines the lesson

`< ./file` renders foreign content in place while `Cell.jsx` tracks
`originalSource` vs current. And the repo's own TODO list names the
failure: *"transcluded code gets persisted inline on edit"* — copies drift
from their sources. Likewise *"REPL output… persisted inline"*, and
*"backlinks should link to the part of the document of first mention"* —
dotlit wanted **fact-grained addressing and reference semantics inside
documents** and couldn't get there with files as the store. These bugs are
not incidental; they are the document-as-database hitting its ceiling.
The substrate is the answer to exactly this ceiling: facts are the unit,
documents and boards hold *references + arrangement*, and edits flow to the
fact, never to a copy.

### 5. The storage shape we already rebuilt

LightningFS in the browser + ServiceWorker interception + pass-through
reads/writes to GitHub — offline-first local cache over a remote source of
truth. `canvas`'s `storage.ts` (localStorage cache + substrate, seed-on-
empty) is the same architecture with a better truth layer. The ~150
`testing/log/*.lit` daily notes are three years of the personal knowledge
practice the substrate is meant to host.

## What this changes in the canvas/substrate design

1. **Adopt the cell meta-grammar as the item declaration syntax.** The
   design doc's `item = fact × renderer × placement` gets a proven,
   text-serializable form: an element's renderer binding is `viewer=<type>`,
   a view tile is an output cell of a query (dotlit's homepage `>search`
   cell *is* a view element), an embedded surface is the `uri`/`iframe`
   viewer, an executable item is `repl=` with `>` writing its result *as a
   fact*. When facts render as markdown cells, their fence line should BE
   this grammar — one syntax across document and board.
2. **Adopt the plugin scope ladder verbatim** for renderer facts:
   per-board (`_canvas/<board>/_renderers/*`) → slice-global
   (`_renderers/*`, the "config page") → shared by reference (a renderer
   fact key, granted like any fact). dotlit also supplies the missing type
   taxonomy beyond viewers: transformers (on-save), menu items, on-select —
   the canvas's command palette and context menu become pluggable the same
   way.
3. **Outputs are facts, by construction.** Cell execution on a board or in
   a document writes `remember(out-key, result, via: repl:<lang>)` +
   `link(cell, 'produces', out-key)` — never inline mutation. dotlit's
   whole bug class disappears because the substrate never copies.
4. **The third projection: the document.** dotlit is what a *narrative*
   view over the substrate should be — sections/cells as facts ordered by
   an arrangement decoration (`_doc/<docId>/…`, order being to documents
   what position is to boards), wiki-links as substrate links, backlinks as
   `neighbors`, transclusion as fact-reference. Console (home), spatial
   (canvas), narrative (lit) — one substrate, three modalities. A `lit`
   cell is the natural next hoisting once the canvas seam settles.
5. **Name the tenet.** "No graduation" — the environment you think in is
   the environment you build in — is the through-line from dotlit (2020) →
   parcland (2025) → sync (2026) → this platform, and should be stated in
   `substrate.md` as such, with dotlit as lineage.

## Verdict

dotlit is the earliest ancestor of the substrate thesis in the lineage:
it discovered vocabulary-as-data (the fence grammar), plugins-as-content
(renderer facts), execution-as-accretion (outputs with provenance), and
reference-over-copy (transclusion) — inside a single medium, markdown — and
then documented precisely where the medium ran out (copies drift, no
fact-grain addressing, no shared truth). The canvas design stands, with the
grammar, the scope ladder, and outputs-as-facts adopted from dotlit; and the
roadmap gains a fourth surface: the document.
