# lit — substrate-native authoring (what we built, and what's deferred)

> Status: working and deployed at `/@c15r/lit` (git truth: `cells/lit/`).
> This is the design record + plan. It summarises the redesign, then states the
> open decisions — naming, output-persistence, and run-as-caller — so we can
> sequence the rest.

## 1. The shift

**Before:** a document was a `doc:<id>` fact carrying an embedded `blocks[]`
array; blocks were opaque records you added manually. The whole document was the
unit, and structure lived inside one fact.

**After:** a document is a **view over cell-facts**. The structure lives in the
substrate graph, not inside a fact:

- `doc:<id>` = `{ title, summary?, projection? }` — thin metadata only.
- `cell:<id>` = `{ content }` (type `cell`) — the unit of authoring, execution,
  linking, and reuse. The same cell-fact can appear in many docs/boards.
- `_doc/<docId>/<cellKey>` = `{ seq, fold }` (type `doc-order`) — **membership +
  order as decorations**. Fractional `seq` means a reorder or insert is *one*
  write, no renumbering. This is the *same* per-`(surface, key)` decoration
  primitive the canvas uses for placement.

Legacy `blocks[]` docs still render: both client (`loadDoc`) and SSR
(`buildDocVM`) fall back to the embedded array when no `_doc/` decorations
exist, materialising decorations on the next edit.

*Validated:* SSR renders by `seq`, inverting creation order (`sn-demo`).

## 2. Authoring — per-cell, never a whole-document reparse

The key correction during design: **if a document is a view, there is no whole
document to parse.** You edit one cell (a known fact, so identity is inherent —
no diff/reconcile). The only parse is per-cell, on save:

- `splitCells(source)` over *that one cell*: if a heading or code-fence was
  introduced, the cell splits — the **first part keeps the fact's key** (and its
  links/seq), the rest become new facts placed at **fractional seq between this
  cell and the next** (`seqBetween`).
- Insert / move = one decoration write. Fold = a decoration flag.
- Bulk authoring still works without a document editor: paste a lot of markdown
  into one cell → save → it splits into many.
- **Projections** re-sort the *same* membership: `narrative` (by seq) /
  `salience` (by the cell's score). A document is one membership, many lenses.

*Shared helpers:* `splitCells`, `seqBetween` in `cells/lit/shared.tsx`
(unit-tested in `/tmp/litcells.mjs`).

## 3. Fences — the typed extension point

A cell's body can be a fenced block; the fence's info-string is a meta-grammar
(`parseFence`), and the first word selects a renderer/executor:

| fence | behaviour |
|---|---|
| `md` / `markdown` | render the body as markdown (nested) |
| `json` / `csv` / `mermaid` / `style`, `viewer=X`, author `_renderers/<type>` | render via the viewer ladder |
| `run` | server execution via `@c15r/run` |
| `js` / `repl` (`!server`, `repl=server`) | client execution (server-toggle) |
| `agent` | model-in-the-loop via `@c15r/models.agent` (§4) |
| `board` / `view` / `cell` | embeds (canvas board, registered view, cell status) |

## 4. agent cells — the generative tier

A ```` ```agent ```` cell's body is the prompt. "run agent" submits to
`@c15r/models.agent` (always async → poll `@c15r/models.fetch`); the loop's
toolbox is the substrate. `!write` grants substrate writes (default read-only).

**Output is a real cell, not ephemeral.** On completion the result is written as
a new `cell:` fact placed right after the agent cell (`onAgentOutput`), linked
`produces` from the agent-run fact for provenance. It is then a normal cell —
editable, linkable, placeable. (Anonymous / log views fall back to inline.)

*Validated:* submit → `{jobId, factKey, pending}`; fetch → `{done, text, turns,
toolCalls}`.

## 5. Links — the digital garden

`[[target]]` / `[[target|label]]` render as links (a shared `marked` inline
extension, so SSR and client agree). A bare target resolves to `doc:<slug>`; an
explicit key (`doc:x`, `cell:y`) is used as-is.

On save, `syncCellLinks` reconciles a cell's links into **typed substrate edges**
(`workspace.link`, rel `related`) — linking new targets, unlinking removed ones.
A **"Linked from"** panel projects inbound edges (`workspace.neighbors`),
collapsed to the distinct source docs. Links are real graph edges, not a
parallel index; red links to not-yet-created docs work.

*Validated:* `[[…]]` SSR rendering + slug/label resolution; neighbours backlink
attribution (a cell → its doc tag).

## 6. Delivery / SSR / the loading flash

- SSR is **token-less**: it reads `STATE#<owner>` via the cell's IAM role
  (`LeadingKeys` is the authority boundary). It embeds a ViewModel only when the
  request proves owner identity — a bearer, or the **dispatch tier setting
  `x-cell-caller` from the session cookie** on navigations (`index.ts:186`).
  Otherwise it serves the bare interactive shell.
- A navigation that misses owner identity → bare shell → the client used to
  paint "signing you in… / loading…". Fixed with a **client VM cache**
  (localStorage, stale-while-revalidate): repeat opens paint instantly from
  cache, then `load()` refreshes. First-ever open of an uncached private doc
  without SSR still loads (see open Q3).
- *Gotcha:* the client-bundled `main.css` is **not served** (`app.css` 404s);
  the only delivered stylesheet is `CRITICAL_CSS` inlined in `index.ts`. New
  rules must go there.

## 7. Open decisions / plan

1. **execute (`run`/`js`) output → cells.** `agent` now persists output as a
   cell. `run`/`js` route through the external `@c15r/viewers` repl (it receives
   `_factKey`); confirm whether it already persists outputs to a fact and, if so,
   surface that fact as a doc cell the same way `onAgentOutput` does.

2. **run-as-caller (was "thread #1") — reframed, deferred.** For the owner using
   their own workspace, executed code *already* runs as the caller: SSR/reads are
   IAM-scoped to the owner's slice, and writes go through the dispatch organ path.
   The unsolved case is running as a *different* principal (another user calling
   the owner's `@c15r/run`), which is the **grants-to-principals** design
   (`docs/scope-grants.md`, deferred — a token-to-cell or STS-AssumeRole change
   at the substrate, not lit). **Recommendation: keep deferred; not blocking.**

3. **First-open SSR for private docs.** To make the first open SSR-instant (not
   just cached), the dispatch tier must pass session identity (`x-cell-caller`)
   to the cell on navigation, or the doc must be public. The cache covers repeat
   opens; this is the remaining infra lever (outside lit).

4. **The "cell" ambiguity (naming — thread #4).** In parc.land a **cell** is a
   deployable app (`@c15r/lit` is a cell). We now also call a document fragment a
   "cell." That collides. Options: rename the doc-fragment (candidates: `node`,
   `passage`, `stanza`, `fragment`, `entry` — `block` was rejected as the old
   naive model), or qualify it (`doc-cell`). Needs a decision; once made, rename
   in lit + new code and alias elsewhere (per the earlier ruling).

## 8. Commit trail (branch `claude/merge-consent-review-iq3vn8`)

- doc-as-view + substrate-native ordering (decorations, migration)
- respect `md` fences + optimistic cell edits
- re-seed DocEditor from SSR ViewModel
- `[[wiki-links]]` as substrate edges + backlinks
- agent cells via `@c15r/models.agent` (+ output-as-cell)
- client VM cache (kills the post-SSR loading flash)
