# Canvas cell review — implementation nuances + HCI analysis

*2026-07-03 · reviewed at `cells/canvas` on branch `claude/parcland-canvas-cell-bugs-8ki8du`,
after the edge/zoom fixes and the authored-only board change (links/sim off by default).*

The cell is in a good place structurally: the gesture FSM, the render
reconciler, the substrate write queue, and the consolidated bottom sheet are
each the right shape. What follows is where the seams show — first the
interaction model (HCI), then the command palette specifically, then
implementation hazards ranked.

---

## 1 · HCI: the interaction model

### 1.1 The mode split is the biggest cognitive tax

`navigate` vs `direct` is a modal editor in the Bravo/vi tradition, and it
carries the classic mode error: the same gesture (one-finger drag) either pans
the world or moves an element depending on invisible state. The affordances
that reveal the mode are small (a button label swap, top-left) and the mode
changes *implicitly* in several places — double-tap switches to direct, an
empty lasso switches back to navigate (`commitLassoSelection`), Escape toggles
it. Users will regularly drag an element expecting a pan and vice versa.

Options, in increasing ambition:

- **Make mode legible at the point of gesture**: cursor/element highlight on
  hover-equivalent (touch-down flash) that telegraphs "this drag will move X" /
  "this drag will pan", not just a toolbar label.
- **Collapse the modes**: the industry-converged model (Figma, tldraw,
  FigJam) is *modeless*: drag on element = move, drag on canvas = pan,
  long-press or handle = secondary. The FSM already distinguishes
  `hitElement` at pointer-down, so the machinery is there. Direct-mode's
  remaining exclusive job (lasso from blank) could move to a modifier or a
  toolbar tool. That would delete a whole class of mode errors *and* the
  double-tap/lasso/Escape implicit switches.

### 1.2 Selection semantics differ by input path

`selectElement` in gesture-helpers hardcodes `additive = true` — every tap
*toggles into* the selection, so tapping A then B selects both, and clearing
requires a blank tap. But the controller's own `selectElement` (used by the
palette and group-logic) is replace-by-default. Same verb, two meanings,
depending on whether the tap came from the FSM or the palette. Touch users
mostly expect replace-select with explicit multi-select (long-press or a
mode). Pick one policy and put it in the controller, not the helper.

### 1.3 Discoverability cliffs

- **Handles are the only path to resize/rotate/scale/connect** and they render
  only while selected, only in direct mode, as small font-awesome glyphs. The
  seven-handle vocabulary (type/scale/reorder/resize/rotate/edge/create) is
  powerful but unlabeled; `reorder` (drag distance → z-index!) is
  undiscoverable and its input mapping (`zIndex = drag length × 0.1`) is
  unpredictable — reorder by drag distance has no visible model.
- **Edge creation** exists only as the link handle drag. The palette has no
  "Connect A → B" command; nothing in the sheet mentions it.
- **`navTo` hotspots are entirely invisible** (an element that teleports the
  camera looks identical to one that doesn't). They are also currently dead
  code — the handler reads `node.dataset.id` but elements carry
  `dataset.elId`, so the hotspot never fires. Fix the property *and* add a
  visual affordance (corner glyph) when an element has a `navTo` edge.
- **Un-pin** appears in three surfaces (palette, sheet, context row) but
  nothing explains what pinning *is* — the synthesized-vs-pinned distinction
  is core to the substrate model and completely unexplained in UI. The tray
  (post-sim removal) makes this more legible: things you placed stay where
  you put them; things you haven't yet placed queue in the tray.

### 1.4 Feedback gaps

- **Persistence is silent.** Writes are debounced 800 ms + 400 ms flush with
  failures logged to console only (`[substrate] write failed`). On mobile —
  the primary target — a failed save is invisible until a reload loses work.
  The sheet footer has room for a three-state dot (saving / saved / failed).
- **Destructive actions have no undo affordance in the moment.** Delete in
  the sheet/context row fires immediately; undo exists (⌘Z) but touch users
  have no gesture for it and no toast offering "Undo". `deleteSelection`
  also doesn't push a history snapshot (see §3), so even ⌘Z can't recover it.
- **AI actions give no progress state.** `Generate` swaps content to
  "generating…" text inside the element; a failure leaves that string
  persisted as the element's real content.

### 1.5 Gesture details worth tightening

- Long-press (600 ms) opens element actions — good — but there's no haptic /
  visual pre-fire cue, and it fires `openActions` only when an `elementId`
  is present; long-press on an *edge* does nothing (could open the edge
  inspector — cheaper than the precise tap).
- Double-tap on blank canvas *creates an element and switches modes* — a very
  strong side effect for the most common accidental gesture on touch. tldraw
  et al. reserve blank double-tap for zoom. At minimum the created element
  should appear in an "editing, uncommitted" state so an accidental
  double-tap doesn't persist a `# New Markdown` fact (it currently saves
  immediately via `createNewElement → saveCanvas`).
- Wheel-zoom has no trackpad-pinch (`ctrlKey`) discrimination and a fixed
  0.001 speed: pinch-to-zoom on a Mac trackpad feels like scrolling. The
  `wheelZoom` FSM state exits after a fixed 100 ms; a slow scroll-zoom emits
  WHEEL after the state timed out, which re-enters cleanly, so this works —
  but the camera never persists if the user zooms then immediately backgrounds.

---

## 2 · HCI: the command palette

The palette is the right consolidation point (one sheet, three detents,
context strip on top) and mostly earns its place. Specific findings:

### 2.1 Power / expressivity

- **The strongest feature is nearly invisible**: free-text Enter with an
  element selected routes to `editElementWithPrompt` (AI-edit the selection);
  with nothing selected it *creates a markdown element*. That's a genuinely
  good "language as command" surface, but nothing in the UI hints at either
  behaviour — the placeholder still says "› Type a command…". A dynamic
  placeholder ("describe an edit to ⟨title⟩…" when something is selected)
  would teach it in place.
- **Substrate fact search is a differentiator** (pull any fact onto the
  board) and correctly async/debounced. But results only ever *append* below
  command matches; with `maxResults = 10` already filled by commands, fact
  hits render off the visible list. Reserve slots (e.g. 6 commands + 4
  facts) or add a `>` prefix convention to search facts only.
- **No command aliases/synonyms.** "remove"/"erase" won't find Delete;
  "link"/"connect" find nothing (edge creation isn't a command at all —
  see §1.3). The `searchText` is just the label path; an `aliases: []`
  field on menu items is cheap expressivity.
- **Element search competes with commands in one ranking.** Elements match by
  content substring, which is right, but the sort only orders command-vs-
  command; fact/element relevance is insertion order. Fine at 10 items,
  wrong at 100 — worth a real scored sort before it scales.

### 2.2 Ease of use / correctness of the input model

- **Shortcut collisions**: ⌘V is both "Mode → View" and "Paste"; ⌘E both
  "Mode → Edit" and "Inline Edit"; ⌘G both "Generate New" and "Group". The
  dispatch map (`buildShortcutMap`) keeps whichever registered last —
  silently. The chord-style shortcuts shown in menus ("⌘N T") are *display
  fiction*: `normalizeKeyboardEvent` can never produce a two-key sequence,
  so every "⌘N x" shortcut is dead. Shortcuts advertised but non-functional
  are worse than none.
- **Shortcuts bypass guards and input**: `buildShortcutMap` walks raw
  `buildRootItems` without evaluating `visible`/`enabled`, and invokes
  `action(controller)` directly — so a `needsInput` command fired via its
  shortcut runs with `text = undefined` (e.g. ⌘N I would create an image
  element with an undefined prompt, if the chord could fire), and Delete's
  ⌫ works while the palette input is unfocused but so would any
  "enabled: false" command with a shortcut. Route shortcut dispatch through
  the same `run()` path as clicks.
- **Keyboard-only palette on a touch-first product.** Opening requires ⌘K or
  tapping the input; there's no ergonomic thumb affordance (FAB / swipe-up on
  the sheet) to raise the palette on mobile, where it is the *only* route to
  Add/Align/Auto-Layout. The `.mobile` footer div is literally empty.
- **Recent commands don't persist** across reloads (page-lifetime array).
  Persisting the last 5 to localStorage is one line and makes the empty
  state useful on every open.
- **`quitInput` is wired to the ✕ clear button** — clearing the query also
  aborts a pending input flow; harmless in browse mode but surprising
  mid-`awaiting`. Separate "clear text" from "cancel flow".
- **Menu hygiene**: "Canvas → Save" is a no-op reassurance (saves are
  automatic — showing it implies they aren't); "History" opens a raw
  `<pre>` JSON dump of `versionHistory`, which the substrate persister
  deliberately strips — i.e. it's always `[]`; Minimap adds the legacy
  widget whose rAF loop had to be forcibly throttled by the crash work.
  Retire or rebuild all three.

### 2.3 The sheet (context strip) interplay

The ownership model (`selection`/`edge`/`frame` owners) is sound and the
peek/half detent split is right. Two seams:

- The **group "More ⌄" renders `renderHalf(c, ids[0])`** — full actions for
  the *first* element of a multi-selection, silently ignoring the rest
  (header even says "Actions"). Either a true group action list or disable
  More for groups.
- **Edge inspector opens at full field-set immediately** (rel/label/colour/
  width/dash/delete). After the endpoints row (added this branch), consider
  the same peek/half discipline: peek = endpoints + delete; half = styling.

---

## 3 · Implementation: ranked findings

The top items from a deep pass over the client (severity-ordered; file:line
refer to this branch). Some have been fixed on this branch already — marked ✓.

### High

1. **`deleteSelection` / `duplicateEl` / `pasteClipboard` push no history
   snapshot** (`menu-item-helpers.ts`) — delete is unrecoverable via undo
   even though an undo stack exists; snapshot discipline is inconsistent
   across mutation helpers (some helpers snapshot, some don't).
2. **`pasteClipboard` replaces `selectedElementIds` with a raw `Set`**
   assigned over the controller property (`c.selectedElementIds = new Set(…)`)
   — bypasses `updateGroupBox`/CRDT-selection/selection-changed dispatch;
   the sheet doesn't learn about the new selection.
3. **`navTo` hotspots dead** (`frameNav.ts:147`): `dataset.id` vs the actual
   `dataset.elId`. Whole feature inert.
4. **Undo restores state but never re-renders edges nor saves**
   (`main.ts _restoreSnapshot`): `requestRender` without `requestEdgeUpdate`
   leaves edge geometry stale when the undone change moved elements; and the
   restored state is never persisted, so an undo followed by pagehide loses
   the undo (substrate still has the newer state; next load resurrects what
   the user undid).
5. **`updateEdgePosition` deletes edges as a render side-effect**
   (`main.ts` else-branch: endpoint not found → filter the edge out of
   state). A transient miss (element still mounting, remote element not yet
   merged) permanently drops a real edge — mutation belongs in load/sync
   hygiene, not in a draw pass. (The label-anchor path was already made
   null-safe; the else-branch remains.)
6. **Element-id collisions at `Date.now()` granularity**: `el-${Date.now()}`
   (`createNewElement`, `duplicateEl`) — a multi-duplicate in one tick
   collides (pasteClipboard already compensates with `now + i`, evidence the
   hazard is real). Same for `edge-${Date.now()}`. One `uid()` helper.

### Medium

7. **Two parallel edge-assembly implementations** (`loadInitialCanvas` vs
   `rebuildEdgesLive`) already drifted once (the authored-only change had to
   be made twice); extract one `assembleEdges(deco, links, presentIds)`.
8. **The undo ring buffer clones the whole board per snapshot**
   (`structuredClone` + `JSON.stringify` for byte-budgeting = double
   serialization per edit). On the 127-element board every drag-commit costs
   two full serializations on the UI thread.
9. **`renderEdgesImmediately` orphan sweeps are O(edges²)** — a
   `find()` per known edge id per pass; trivially a Set.
10. **`flush()` writes serially** (`storage.ts`) — awaits each
    `workspace.remember` in sequence; a 20-fact save on flaky mobile holds
    the queue for the sum of round-trips. Batch or `Promise.allSettled`.
11. **Live-sync `rebuildEdgesLive` clobbers session-local expansion**:
    any remote link/unlink event rebuilds `canvasState.edges` from substrate
    truth, silently dropping the edges `expandFact` materialized (now that
    projection is off, *all* expanded edges are session-local).
12. **`keyboard-shortcuts` never uninstalls** (window listener with no
    teardown, unlike the palette's) and `installCommandPalette` re-installs
    it per controller — drill-in/drill-up stacks duplicate dispatchers, so
    every shortcut fires N times after N drills. Same pattern for the
    salience `resize` listener and `startLiveSync`'s poller holding the
    first controller's `cid` forever (drilling into a child canvas keeps
    syncing the parent's prefix).

### Low / hygiene

13. `CrdtAdapter` is a stub wearing a Yjs interface, and `main.ts` still
    carries the dead `onUpdate` handler and the load-bearing-comment
    `if (awareness.getStates())` dangling-if — the shim exists to satisfy a
    bug. Delete the vestige and the shim together.
14. `openHistory` writes to a `window.open` document (popup-blocked on iOS
    Safari = crash on `w!.document`), and exports raw `<pre>` JSON.
15. `showModal`'s Escape handler is added to `document` on every
    `ensureDom` and never removed; `$root.style.display` check keeps it
    harmless but it accumulates.
16. Unescaped interpolation of user content into `innerHTML` in several
    surfaces (palette suggestion labels, context-menu header title/key,
    tour-bar label). All self-authored content today, but the board renders
    *substrate* facts — agent-written titles flow into these sinks. Escape
    at the seam.
17. `zoomToElement` (palette) and `zoomToFit`/`zoom` (helpers) each
    re-implement camera fitting alongside `fitRegion` — four fit codepaths.

---

## 4 · Where I'd spend the next increment

1. **Modeless gestures** (§1.1) + **one selection policy** (§1.2) — deletes
   the largest class of interaction errors and simplifies the FSM.
2. **Save-state indicator + undo toast** (§1.4) — trust on mobile.
3. **Shortcut dispatch through `run()`** with collision lint at build of the
   menu tree (§2.2) — makes every advertised shortcut true.
4. **Extract `assembleEdges` + `uid()` + snapshot discipline** (§3.6–7) —
   small, prevents the recurring drift class.
5. **Palette as the touch surface**: thumb-reachable open affordance, dynamic
   placeholder teaching the free-text behaviours, persisted recents (§2.2).
