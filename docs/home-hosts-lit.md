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

- [ ] 1. Move the renderer core to `@parc/ui`: the token→element sanitized
  renderer, plus the fence meta-grammar (`fence.ts` is pure, typed, and
  test-pinned — it can move as-is). Both cells already import `@parc/ui`, so
  there is no new distribution mechanism to build. The core renders markdown,
  wiki-links, doc-links, and every fence as a *declaration* — chip row +
  static body — the way lit shows an un-run fence.
- [ ] 2. Home consumes it. `safe-markdown.tsx` shrinks to the FactLink wiring.
  The apex stops rendering fences as dead code and starts rendering them as
  what they are.
- [ ] 3. lit consumes it too, inside its SSR tree (elements render to string
  fine). Its client enhancement ladder stays exactly where it is, layered on
  top after hydration. lit remains the only place fences go *live* — that
  asymmetry is correct: execution belongs to the editor's trust context, the
  reader shows declarations.
- [ ] 4. Static-safe fence types (mermaid, csv/json tables) can render from
  the shared core in home — display, not execution.
- [ ] 5. Later: fence types whose cells publish `ui://` renderers go live in
  home through the existing sandbox host (`federated.tsx`, per-renderer read
  allowlists, ADR-0041). This is the actual "hosting" — home hosts declared
  renderers under sandbox and consent. It doesn't reimplement them.

Steps 1–3 are the substance. 4 and 5 are optional and can wait for a real
need.

## What this changes in the dotlit review

The review graded lit "ahead" on grammar and execution. Fair. But it missed a
regression dotlit structurally couldn't have: dotlit has one renderer because
the document system *is* the app — reader and editor can't drift. parc split
the face (home) from the manager (lit), which was right for trust, and forked
the rendering, which wasn't. Add "one renderer" to the list of things dotlit
got right that the substrate should recover.
