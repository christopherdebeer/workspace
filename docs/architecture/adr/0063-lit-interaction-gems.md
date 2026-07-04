# ADR-0063 — The dotlit interaction gems: lit's surface grows hands

- **Status:** Proposed 2026-07-04 (buffer — feedback welcome before build).
- **Depends on:** ADR-0059 (the grammar the chips render), ADR-0060 (outputs
  the chips describe), ADR-0061 (the verbs the gestures invoke). Sources:
  dotlit `CodeMeta.jsx`, `Editor.jsx`, `Header.jsx`, `CellMenu.jsx`,
  `App.jsx`, `client/index.jsx` — read directly this session (owner: "I do
  think it had gems" — confirmed, they're listed below with receipts).

## Context (the gems, verified at source)

1. **The declaration is chips** (`CodeMeta.jsx`): a fence's meta renders as
   a row of colored chips — lang, repl, filename, `!directives`, `k=v`
   attrs, `#tags`, `< source`, `> output`, "Updated N ago". Colors are
   hash-of-string with contrast-picked text (error = red); noise attrs
   (`true`, `updated=`, `repl=`) are hidden. And the chips are HANDS, not
   labels: **click the lang chip → collapse**; click `!inline` →
   fullscreen; click the source chip → toggle local/remote body.
2. **`[[` autocomplete** (`Editor.jsx:25-54`): typing `[[` offers every
   known doc (label = id, detail = title, applies `[[id|title`). Plus
   macros: `toc`, a fence skeleton, and the `magic` glyph `⠁⭒*.✩.*⭒⠁`.
3. **Status LEDs** (`Header.jsx:43-65`): three dots encoding sync truth —
   local-only orange, remote-only blue, neither red, both green — plus
   GitHub and ServiceWorker health. Glanceable, honest, tiny.
4. **Messages scroll to their cell** (`Header.jsx:110-137`): parse/plugin/
   transclude failures are dismissible banners whose name CLICKS TO the
   offending cell (positions are stamped on every cell/section).
5. **Cell clipboard** (`Header.jsx` Cell menu): Copy/Cut/Paste-After of
   whole cells — structural editing without text selection.
6. **404 is an editor** (`client/index.jsx:181-198`): a missing path shows
   an editable stub; `?template=&title=&body=` seed new documents. Nothing
   is a dead end — every absence is a create surface.
7. **View Source** — the whole document as raw text, one toggle away.

## Decision (substrate translations — each gem lands as reference semantics)

1. **Fence chips, rendered from the grammar we now have.** Every
   `pre[data-fence]` gets a chip row built from `parseFenceMeta`: lang
   (tap = fold toggle, writes the decoration), directives/attrs/tags
   (hash-colored, same palette rule), `< source` chip (opens the source
   fact, ADR-0061 transclusion), `> output` chip (opens/scrolls to the
   output fact), and on `out:` bands "updated N ago" from `_meta.updatedAt`
   (real provenance, not a text attr). A tag chip taps to its tag page
   (ADR-0062). SSR renders the same row inert (chips are links/spans);
   the client wires the verbs — parity held.
2. **`[[` autocomplete in the cell textarea**: on `[[`, a popover lists
   docs + recent facts (the palette's searchFacts, reused), applying
   `[[key|title]]`. Macros: `toc` → `>toc` fence, ``` → fence skeleton.
   No CodeMirror — a textarea-anchored popover, mobile-first (the canvas
   palette's list rendering reused).
3. **One honest dot, richer title**: the save dot (ADR-0059) grows the LED
   truth — outbox pending count and last live-sync tick in its tooltip;
   `failed` state already terracotta. (Three LEDs on mobile is noise; one
   dot with states is the same honesty smaller.)
4. **Errors scroll to their cell**: fence/run errors badge the block
   (canvas's error-badge pattern) and the top banner names the cell —
   tap scrolls to it (`data-key` anchors exist since ADR-0061).
5. **The cell clipboard is a reference**: Cut = remove decoration, HOLD the
   fact key; Paste-after = write one decoration. Copy = paste-as-REFERENCE
   (the same fact, second placement — the insert-existing verb by gesture,
   ADR-0061). Copies that duplicate content don't exist; dotlit's
   copy-drift class is structurally gone.
6. **404 is a create surface**: `/r/doc:<missing>` renders the red-link
   creation flow (ADR-0061 §1b) — title prefilled from the slug,
   `?template=`/`?body=` honored for share-sheet seeding (the input cell's
   capture path can deep-link it).
7. **View Source**: doc → joined cell markdown, read-only + copy button
   (the export half of "bulk paste splits" which already exists).

## Increments

1. Fence chip row (render + fold/tag/source/output verbs) + error badges
   with scroll-to.
2. `[[` autocomplete popover + macros; 404-create + `?template=` seeding.
3. Cell clipboard (cut/copy/paste-after as decoration ops); View Source;
   save-dot tooltip truth.

## Costs & open questions

- Chip rows add visual weight to code-heavy docs; default to showing them
  only on fences that HAVE meta beyond a bare lang (dotlit's `!hidemeta`
  remains available and honored).
- The hash-color palette must pass the white-board restraint rule (ADR
  G14): chips use the muted palette with hash-hue only as a thin left
  border, not full backgrounds — color states, not decoration.
- Open: does the `magic` macro survive? Proposed: yes, verbatim glyph —
  lineage is content. (It costs nothing and it's the owner's own garden.)
