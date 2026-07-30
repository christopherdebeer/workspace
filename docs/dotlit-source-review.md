# dotlit, read at the source — counterposed with `cells/lit`

*2026-07-29 · reviewed from a fresh clone of `dotlitdev/dotlit` (v1.9.8, head `c977537`),
against `cells/lit` as deployed today. The question asked: is the substrate lit
naive/basic relative to the original?*

## What dotlit actually is

Strip the webpack-era tooling away and dotlit is four small, sharp ideas over the
unified/remark ecosystem (~1,200 lines of parser+renderer core):

**1. The fence info-string is a shell command line.** `codeblocks.js` parses every
fence as `[>] lang [filename|uri] !directive… attr=val… #tag… [< source] [> output]`.
That is not styling metadata — it is **process syntax**: `< file` is stdin
(transclusion), `> img out.svg` is stdout piped into a *persisted* output cell
(`>img out.svg attached=true updated=<ts>` appears in the document after a run), and a
leading `>` marks a cell as *being* someone's output. The document is a process
graph whose wiring is written in the fences, and the results are committed back
into the text — the repo's own history is literally `Edited src/testing/log/….lit`
commits where runs wrote their outputs home.

**2. Sections and cells are a structural AST pass, not a split.** `sections-v3.js`
builds a *stack* of nested sections by heading depth (a real tree, `processSection`
callback per completed section); `cells()` then groups the nodes of each section:
a code block opens a cell, an `attached=true` code block *joins the previous cell*
(the run-output pairing), prose accretes. Cells carry source *positions* — the
editor and renderer address the same bytes.

**3. The document extends itself.** `extractPlugins.js` walks the AST for
` ```js !plugin type=viewer` fences and *compiles them* (commonjs `_compile` on
node, `data:` URI ESM import in the browser). Plugin types: `parser`, `renderer`,
`transformer`, `viewer`, `onsave`, `onload`, `onselect`, `menu`, `modal`, `data`,
`setting` — the whole pipeline is open for extension *from inside a document*.
`index.lit` itself installs a CORS proxy plugin inline. This is the "meta
programming over its own AST" claim, and it is real.

**4. The graph is computed at generate time, globally.** `cli/generate.js` builds a
manifest over *all* files: every wiki-link, markdown link, transclusion source and
code reference becomes a `backlinks[]` entry on the target — including entries for
files that *don't exist* (`exists: false`, the red-link). Backlinks, link counts,
sizes and titles ship with each rendered page.

Also worth naming: the wiki-link resolver (`links.js`) is deliberately loose —
`[[Name]]` fans out to `name.lit`, `name/index.lit`, `name.md` candidates; slugs are
lower-cased/underscored; a link is classified external/absolute/fragment/relative
and *decorated*, never dropped.

## What `cells/lit` took, and what it changed

The substrate lit is **not** a naive port; it is a deliberate re-basing of the same
ideas on a different storage substrate, and in a few places it is *ahead* of the
original. The honest scorecard:

| dotlit concept | substrate `cells/lit` today | verdict |
|---|---|---|
| fence meta-grammar | `fence.ts` — full grammar ported *and typed*, incl. recursive `< source` / `> output`, escaped spaces, `unknowns[]`, plus a round-tripping serializer (`fenceToString`) the original's `metaToString` almost-but-not-quite was. Pinned by tests (ADR-0059). | **faithful, better-engineered** |
| sections + cells | `blocks.ts:splitCells` — flat split: heading opens a prose cell, fences stand alone, heading-only cells fold forward. No section *tree*, no nesting, no positions. | **simplified — deliberately** (facts are the structure; `_doc/<slug>/<key>={seq}` decorations carry order; the vector-noise-driven heading-fold is a substrate-native concern dotlit never had) |
| transclusion `< src` | ADR-0061 ladder in `client/main.tsx`: `< factKey` renders the *fact*, `ui://` resources resolve over `/mcp`, red-links style in. Server-side: a sourced fence stays a placeholder (classification only, nothing executes at SSR). | **transposed**: dotlit transcludes *files*; lit transcludes *facts* — the right move on a substrate |
| output cells `> out` | Parsed, chip-rendered (`⤷ output`), and derived cells exist (`>toc`, `>search` — the query *is* the content). But **no write-back**: a repl fence's output goes to the DOM and (via `onAgentOutput`/`placeOutput` hooks) can be placed, yet there is no `attached=true` persisted-output convention in facts. | **the real gap** — see below |
| executable cells | wired to the *platform*: ```` ```run/js/repl ```` fences reach `@c15r/run.exec` / `@c15r/models` — real server-side execution with substrate access, far beyond dotlit's in-page blob-URL eval. | **ahead** (dotlit executes in-page; lit executes *in the workspace*) |
| plugins-from-the-document | nothing equivalent. Viewers come from `_types/*` declarations and `@c15r/viewers`; extension is *substrate vocabulary*, not document-embedded code. | **diverged on purpose** — and the substrate's answer (declared types/actions/renderers as facts) is structurally the same idea with a trust boundary; document-embedded executable plugins are exactly what ADR-0041's sandbox correction exists to prevent |
| backlinks manifest | edges: `related` (wiki) + `references` (relative md) authored per *block* at decompose time; inbound = `workspace.edges` gsi. Red-links: ADR-0061 §1b marks stubs. No global "exists:false" manifest, but the graph is *live*, not generate-time. | **transposed and mostly ahead** (a DB beats a build artifact), with one loss: dotlit records backlinks *from code references and transclusions*, lit's edges only come from links in prose |
| positions / one-text round-trip | dotlit cells know their byte range in the source; lit blocks are the source of truth and the "document" is an assembled view. | **inverted by design** (ADR-0093 assemble; the file mirror `file/docs/*.md` is the byte-faithful artifact) |

## The three things worth stealing next

1. **The persisted output cell (`attached=true`).** This is dotlit's most alive idea
   and the one lit parses but does not *honor*: a run's output written back as a
   sibling fact (`doc-block` with `isOutput`, keyed to its producer, `updated=<ts>`),
   so a document accumulates its own results and re-runs supersede them. Everything
   needed already exists — fence `output` meta, `placeOutput` hook, supersede,
   provenance (`via`, `writer`). It is one convention away, and it would make lit
   documents *runbooks with memory*, which is dotlit's whole thesis.

2. **Code-reference edges.** dotlit's backlink manifest counts `< ./file.js`
   transclusions and fence `filename`s as links. lit's decompose only extracts prose
   links; a fence that transcludes `< kb/x` or names a file authors **no edge**. One
   more extractor in `planDecomposition` (parse fences with `parseFenceMeta`, emit
   `references`/`transcludes` edges) closes it — and those edges feed centrality,
   which this session demonstrated is the salience signal that matters.

3. **The section tree, cheaply.** Not the full nested AST — but `splitCells` throws
   away heading *depth*, so an assembled doc can't fold sections and the `>toc`
   derived cell re-scrapes the DOM for structure. Recording `depth` on the block
   fact's value (one field, zero migration) would let the renderer fold and the toc
   derive from facts.


## Deep-read addenda (full corpus: 286 files, ~5.6k JS + ~11.3k .lit lines)

The first pass under-weighted four load-bearing mechanisms; a full read of the
source *and* the `.lit` corpus (including all ~150 daily-log documents) surfaces
them:

**5. Tangle is real, and bidirectional.** Fences with a `filename` are written out
as actual files — client-side on save (`App.jsx`: `isOutput` + filename + `extract
!== 'false'` → `fs.writeFile`) and at generate time (`generate.js` extracts every
codefile). The parser is literally authored this way: `sections-v3.js` and
`cells-v3.js` exist as output cells in `testing/section_grouping.lit`, pseudocode
spec above, shipped source below. The document authors the system that renders it.
The substrate lit has *no tangle at all* — `docs-sync` flows files→facts, never
facts→files. A `doc-block` fence naming a file writes nothing.

**6. The capture pipeline is the substrate's own ancestry.** `checkforinput.js`
turns a `?input=` query string into an append to today's daily note, committed to
GitHub through the layered fs; daily notes link week/month/year rollups whose
indexes are live `readdir` cells. This is `@c15r/input.capture`, a decade early —
and the substrate's `inbox/arch-*` facts are these very diary entries imported:
the duplicate-capture pairs at the head of today's suggestion queue ($1 Recognizer
twice, feenk's Lepiter, "Anki and Notion in one") are dotlit log entries
2021–2023, re-encountered as dedup work in the successor system.

**7. Documents run their own maintenance.** `meta/files_and_links.lit` computes the
unlinked-files report from `manifest.json` in a cell, output committed. That is
`workspace.attention`'s "unlinked" report as a *document the owner edits*, rather
than a platform read. The whole tending vocabulary has dotlit ancestors that were
cells, not services.

**8. Committed outputs are regression fixtures.** `parser.lit` executes
`parseMeta` on a gnarly info-string and the attached output cell — committed in
2021 — is the parse tree, byte-for-byte. The document is its own spec and its own
test. (The substrate moved this into jest, `tests/lit-fence.test.ts` — sturdier,
but the fixture no longer lives where the reader is. Worth noting: `fence.ts`
also *fixed* a real dotlit bug — `metaToString` emits `< txt source.jsx`,
injecting the default lang so parse∘serialize does not round-trip; the port does.)

Two transpositions look deliberate and right from this distance: dotlit exposes
the entire toolchain ambiently (`window.lit`: parser, fs, git, React, unist) to
every cell, where the substrate gives cells a capability seam (`gwCall`, scoped
tokens) — the trust boundary the original never needed alone; and dotlit's
local/GitHub/static three-layer fs with its stat-diff conflict viewer (the
"which copy am I editing" problem `local_remote_files.lit` documents at length)
is answered in the substrate by revision/version/supersede provenance, which is
simply a better answer.

The diary also shows the intellectual pipeline runs *through* dotlit into the
substrate: Licklider's man-computer symbiosis, Ink & Switch's Potluck/Embark
("dynamic documents as personal software"), OOUX ("objects are the primary
representations; actions comprise the tasks"), Webstrates' "distinction between
application and document is blurred", vector databases (2022-11-07) — captured as
bookmarks in .lit, realized as facts, salience, and capability vocabulary in
parc.land. dotlit is not just an ancestor implementation; it is the substrate's
reading list.

## Revisited (2026-07-30): the one-renderer lesson

The scorecard above missed a structural point. dotlit has one renderer,
because the document system is the app — reader and editor cannot drift
apart. parc split the face (home) from the manager (lit), which was right
for the trust boundary, and then grew a second markdown renderer in home,
which wasn't. The two have already drifted (the task-checkbox bug lived only
in home's copy; lit fences render on the apex as dead code blocks —
violating dotlit's own backward-compat intent that a basic viewer "should
still render correctly for the reader").

Add to the worth-stealing list: **the single renderer**. The plan for
recovering it is in [home-hosts-lit](home-hosts-lit.md) — one shared core in
`@parc/ui`, both cells host it, the live fence ladder stays with lit.

## Verdict

"Naive/basic" is wrong for the *grammar and execution* story — `fence.ts` is the
best-specified artifact in either codebase, and substrate execution via `@c15r/run`
exceeds anything dotlit had. It is *fair* for the **document-as-process** story:
dotlit's soul is that a document runs, writes its results into itself, and extends
its own renderer; lit currently renders, embeds, and executes — but forgets. The
persisted-output convention is the piece of dotlit's soul still missing — and after
the full read, TANGLE joins it: the two together are what made a .lit document a
place where systems get built, not just described. Both are conventions over
mechanisms the substrate already has.
