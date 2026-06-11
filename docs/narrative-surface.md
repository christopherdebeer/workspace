# The narrative surface — lit reborn as a tier-2 cell

*Status: built (2026-06-11) — live at `parc.land/@c15r/lit` (cell `lit-3b547284`),
and hoisted into the substrate as `doc:narrative-surface`, where the living
version now resides (this repo copy is an export per §"Where do design docs
live"). Companion to `canvas-substrate-design.md` and `dotlit-review.md`
(both also hoisted); written in response to the chips feedback on canvas-002.
One amendment from implementation: block ordering lives in the doc fact
(`blocks: [{key, fold?}]`) rather than per-key `_doc/` decorations — a
sequence is a list, and reordering is one write; per-surface decorations can
return when cross-doc reuse demands independent fold state.*

## Do we need it?

Yes — and the chips feedback is the evidence. The canvas is being asked to hold
prose: design commentary, feedback notes, running argument. That content fights
the spatial medium. Salience-driven collapse mangled a "title node" precisely
because the board cannot tell *structural prose* from *spatial annotation* —
on a board, everything is a position. The complaint was not "chips are wrong"
but "this thing was never spatial to begin with."

A narrative surface is the projection where that content is native:

- **Canvas** answers *where things are and how they relate* — associative,
  peripheral, two-dimensional. Bad at sequence and argument.
- **Narrative** answers *in what order to read* — an ordered path through
  facts, with prose as connective tissue. Bad at simultaneity and adjacency.

They are not rivals; they are the two projections of the same item seam:

| | canvas | narrative |
|---|---|---|
| item | fact × renderer × **placement** | fact × renderer × **position-in-sequence** |
| decoration | `_canvas/<board>/<key>` {x,y,w,h,…} | `_doc/<docId>/<key>` {seq, fold} |
| salience | presentation channel (fade; chip only by consent) | folding + ordering (a faded section folds to its heading) |
| ephemera | edit-prompts, meta edges — never persisted | edit affordances, cursors — never persisted |

## The blocks ARE facts (no graduation)

The dotlit tenet transfers whole: a document block is not a new kind of thing.
A paragraph in a doc is a fact; a note on a board is a fact; **the same fact can
be both**. `el:el-1781134905222` (the chips feedback, today a markdown node on
canvas-002) could appear, unchanged, as a block in a "salience design" document
— it already has the content, the type, the links. Only the decoration differs.

So the narrative cell adds *no new fact kinds*:

- `doc:<id>` — the document fact: `{ title, summary?, tags }`. A doc is itself
  a fact: linkable, placeable on a board (it already renders via the surface
  tile), queryable (`type:'doc'`).
- `_doc/<docId>/<factKey>` — ordering decoration: `{ seq, fold? }`. Membership
  = the decorations (explicit, like a board) or a view query (like `?view=`
  boards — a *living* document whose sections are query results).
- Blocks are plain facts (`el:` or any other key) with markdown/typed content,
  rendered by the same renderer ladder the canvas uses (`_renderers/<type>`
  facts work in both surfaces for free).

Transclusion comes for free from what is already deployed:

- a **view** block (` ```view open-claims``` `) — the view tile, hydrated
  exactly as on canvas;
- a **board** block — the embed iframe (`?view=…&embed=1`), already proven in
  home Surfaces and board-in-board;
- a **cell** block — `cells/<cellId>` pointer facts (live since today) render
  as a cell card: address, status, file manifest, dirty flag;
- an **image** block — `putData` blobs with web addresses (live since today).

Fence meta-grammar (`lang !dir attr=val`) and outputs-as-facts stay deferred —
they arrive with the CEL/code-cell thread, and the block model above is exactly
the shape they need (an output is just another fact a fence links to).

## Can we proceed?

Yes — there is **no platform work** in the MVP. Every primitive is deployed and
production-validated: typed facts + links + supersede, decorations-as-facts,
views, public cells with the modular-file loop (`writeFile`/`replaceInFile` +
fused deploy), embeds, live sync via `changes`, image blobs, cell pointer
facts. The narrative cell is a pure tier-2 build: `@c15r/lit`, modular client
files, the storage seam ported from canvas (it is mostly *simpler* — no
geometry, no gesture machine).

MVP cut: reader + block editor over `doc:` facts; markdown blocks; view/board/
cell/image transclusion; live sync; salience as folding. Then hoist content.

## Where do design docs live?

Split by what the doc is *for*:

- **Design thinking** (theses, reviews, decisions, assessments — this file) →
  **the substrate**, as doc + block facts. These want links: a design doc
  should point at the `cells/<id>` it describes, the board that sketches it,
  the claims it argues with. In the repo they are inert; in the substrate they
  are part of the graph the tending loop and the knowledge board see.
- **Contracts that version with code** (CLAUDE.md files, per-directory
  conventions, anything a failing test references) → **the repo**. They must
  diff and review with the code they constrain.

Migration: hoist `docs/*.md` into `@c15r/lit` (split on `##` headings → block
facts, doc fact per file, links to the cells/facts each section names). The
repo copies remain as exports with a pointer note — the substrate version is
the living one. This is the narrative twin of what the knowledge board was for
canvas: building it out *with intent*, using real content from day one.

## Order of work

1. `@c15r/lit` cell: reader (doc list + doc view), storage seam, live sync.
2. Block editing (textarea-level, mobile-first; CodeMirror later).
3. Transclusion blocks: view / board-embed / cell card / image.
4. Hoist the design docs; link them into the knowledge graph.
5. (later, with CEL/code cells) fence meta-grammar + outputs-as-facts.
