# Home should host lit, not reimplement it

The apex reader (`/r/<key>`, the peek sheets, the graph ground) renders docs
with home's own markdown renderer. lit has the real one. This doc is the
investigation of how that happened and what to do about it.

## The problem

There are three render paths for the same doc facts:

- `cells/lit/shared.tsx` — marked + the fence meta-grammar + wiki-links,
  shared between lit's SSR and client. The client layers the live ladder on
  top: fence chips, board/view/cell/json/csv/mermaid embeds, repl execution,
  `_renderers/<type>` element views, transclusion.
- `cells/home/client/safe-markdown.tsx` — marked tokens to React elements,
  sanitized URLs, wiki-links as FactLinks. No fence grammar at all.
- `@parc/ui` — already holds shared pieces (`wikiLinkExtension`, `bodyText`).
  The unification started here and stopped.

And the type vocabulary itself routes reading to the copy: `doc.open` in
`cells/lit/types.json` goes to `/r/doc:<slug>` — home's surface. So the
declared reader for docs renders them with the lesser renderer, while the
declared manager holds the real one. Edit routes to lit; read routes to home.

Consequences, observed not theoretical:

- The task-checkbox bug (every bullet grew a checkbox) lived only in home's
  copy. Fixed 2026-07-30, but the class of bug is structural: two renderers
  drift.
- A lit fence on the apex renders as a dead code block. A `>toc`, a
  transclusion, a run output — literal fenced code, meta line dropped.
  [[divergence_from_markdown]] states the original intent: a basic viewer
  "should still render *correctly* for the reader." Home is currently a basic
  viewer inside parc itself, failing that.

## Why it forked (honestly)

The security postures differ, and that part was right. Home is guest-exposed
at the apex; safe-markdown renders React elements with explicit URL
sanitization and no `dangerouslySetInnerHTML`. lit renders owner-trusted
content as HTML strings. The fork protected the apex. It just protected it by
copying instead of sharing.

## What "hosting natively" should mean

Not an iframe of the lit app on the apex (scroll seams, double SSR, selection
sync with the graph). And not home keeping its own renderer. One core, two
hosts, and the live layer stays where the trust is.

- [x] 1. Move the renderer core to `@parc/ui`: the token→element sanitized
  renderer, plus the fence meta-grammar (`fence.ts` is pure, typed, and
  test-pinned — it can move as-is). Both cells already import `@parc/ui`, so
  there is no new distribution mechanism to build. The core renders markdown,
  wiki-links, doc-links, and every fence as a *declaration* — chip row +
  static body — the way lit shows an un-run fence.
  *Done: `platform/ui/fence.ts` + `platform/ui/markdown.tsx`. `marked` is
  INJECTED (`MdOpts.lex`) — `@parc/ui` is pre-bundled with React external and
  everything else runtime-provided, so a bare `marked` import wouldn't resolve
  in a deployed cell. Pinned by `tests/markdown-core.test.ts`.*
- [x] 2. Home consumes it. `safe-markdown.tsx` shrinks to the FactLink wiring.
  The apex stops rendering fences as dead code and starts rendering them as
  what they are.
  *Done. Sharing the resolvers also fixed two live defects: home's local
  wiki-link tokenizer took `[[text]]` verbatim as a fact key (so
  `[[some doc title]]` was a dead link where lit resolved
  `doc:some-doc-title`, and `[[key#fragment]]` kept the `#` inside the key),
  and the fence grammar didn't treat a colon-keyed `< doc:x` as a source, so
  that transclusion rendered as an empty code block on **every** surface.*
- [ ] 3. lit consumes it too, inside its SSR tree (elements render to string
  fine). Its client enhancement ladder stays exactly where it is, layered on
  top after hydration. lit remains the only place fences go *live* — that
  asymmetry is correct: execution belongs to the editor's trust context, the
  reader shows declarations.
  *Not done. lit's SSR emits HTML strings and its client ladder mutates the
  resulting DOM (`pre[data-fence]` queries); moving it to elements is a real
  change to that seam, not a swap. The grammar is now shared, so lit and home
  classify a fence identically — this step removes lit's remaining markup
  copy, and is contained now that the core exists.*
- [x] 4. Static-safe fence types (mermaid, csv/json tables) can render from
  the shared core in home — display, not execution.
  *Done, via `cells/home/client/viewers.tsx` (split out of `facts.tsx` so a
  fence and a whole-fact render hint reach the same `@c15r/viewers` module —
  a mermaid FACT rendered live while the identical mermaid FENCE rendered as
  dead code). `repl`/`run`/`agent` deliberately stay declarations on the apex.*
- [ ] 5. Later: fence types whose cells publish `ui://` renderers go live in
  home through the existing sandbox host (`federated.tsx`, per-renderer read
  allowlists, ADR-0041). This is the actual "hosting" — home hosts declared
  renderers under sandbox and consent. It doesn't reimplement them.

Steps 1–3 are the substance. 4 and 5 are optional and can wait for a real
need.

## What the shared core made possible next

Fence-grain editing, which was not reachable while the reader didn't know what
a fence *was*. The core hands every top-level fence its source range, so
editing one commits by splicing back into the owning fact's text — and the
owner is always the fact the text lives in, never a copy at the point of
display. That is the structural answer to dotlit's defining bug class
(`dotlit-review.md` §4: "transcluded code gets persisted inline on edit"): a
fence rendered from a `< source` reference is deliberately *not* editable in
place, because its content belongs to the source fact.

The editor itself is `@c15r/editor` (CodeMirror 6), a shared lazily-imported
cell module on exactly the `@c15r/viewers` pattern — because three surfaces
needing an editor is how the renderer forked in the first place.

Consolidated 2026-08-03 from two independent implementations of this doc's
plan (they converged on everything above — a good sign the design was
determined by the constraints, not the author). The second pass contributed:
the shared `BODY_FIELDS` (so `claim.statement` reads AND writes back through
the same field list on every surface), `editFact()` — the peek opened with the
editor already up, one-tap edit from any reading footer — and a `longText`
seam on `SchemaForm` so a schema-form's markdown fields (`protocol.content`,
prompt bodies) get the same editor and `[[` completion as the whole-fact path.

## What this changes in the dotlit review

The review graded lit "ahead" on grammar and execution. Fair. But it missed a
regression dotlit structurally couldn't have: dotlit has one renderer because
the document system *is* the app — reader and editor can't drift. parc split
the face (home) from the manager (lit), which was right for trust, and forked
the rendering, which wasn't. Add "one renderer" to the list of things dotlit
got right that the substrate should recover.
