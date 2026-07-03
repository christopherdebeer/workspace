# Canvas cell review — implementation nuances + HCI analysis

*2026-07-03 · reviewed at `cells/canvas` on branch `claude/parcland-canvas-cell-bugs-8ki8du`,
after the edge/zoom fixes and the authored-only board change (links/sim off by default).*

The cell is in a good place structurally: the gesture FSM, the render
reconciler, the substrate write queue, and the consolidated bottom sheet are
each the right shape. What follows is where the seams show — first the
interaction model (HCI), then the command palette specifically, then
implementation hazards ranked.

> **Resolution status**: §5 (end of document) logs what was fixed on this
> branch (commits G1–G7, 2026-07-03) and what is deliberately deferred.

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

Combined from a first-hand pass over the interaction surfaces and a deep
sweep of every client file. Severity-ordered; file:line refer to this branch.

### Critical — drill navigation corrupts data

The root cause of both: **storage.ts assumes one board per page lifetime.**
All its write-queue state (`lastWritten`, `lastEdges`, `linkedEdges`,
`factMeta`, `synthOrigin`, `lastPos`, plus `readonlyBoard`, `liveSyncStarted`,
`liveCursor`) is module-global and never reset, while `handleDrillIn/Up`
swaps in a whole new controller + `loadInitialCanvas`.

1. **Cross-board fact deletion** (`storage.ts` `_saveCanvas` retire loop +
   module maps): after drilling from board A to board B, A's `el:*` keys
   remain in `lastWritten`; the retire sweep treats any `el:` key not in the
   *current* board's live set as "mine, removed" and issues
   `workspace.supersede`. **Editing anything on B retires A's element facts**
   — data loss that also removes those facts from every other board.
   (The empty-board local-seed path at load hits the same stale maps.)
2. **`detach()` tears down DOM but not behavior** (`main.ts:248`): it never
   calls `uninstallAdapter()`, `uninstallCommandPalette()`, or
   `fsmService.stop()`. After a drill, two pointer adapters feed two live
   FSMs; gesture helpers lack the `canvas.controller !== this` guard, so the
   *detached* controller keeps mutating state and writing via its
   `crdt.updateElement` — under the wrong board. A second `#cmd-palette`
   node and duplicate ⌘K/shortcut window listeners stack per drill.
   (`pointerAdapter`'s own uninstaller also only detaches from `rootEl`,
   leaking the `#static-container` listeners.)

### High

3. **Live-sync captures the first board's `cid` forever**
   (`storage.ts startLiveSync`): the once-ever guard closes over the first
   `cid` while the tick reads the *current* `window.CC` — after a drill,
   placement/edge events filter on the old board's prefix (never match) while
   bare `el:` events from *any* board leak into the current one.
4. **Duplicating a fact-card clobbers the original fact**
   (`menu-item-helpers.ts duplicateEl`): the spread copies `_factKey`, so the
   duplicate's writes land on the original's substrate key — content and
   geometry silently overwritten.
5. **Bulk Duplicate mints colliding ids**: `'el-' + Date.now()` inside a
   synchronous `forEach` — N duplicates share one id; node maps, edges and
   fact keys collapse onto one. (`pasteClipboard` already compensates with
   `now + i` — evidence the hazard is real.) One `uid()` helper, everywhere.
6. **O(V·E) per render frame**: `applyPositionStyles` runs
   `findEdgesByElementId` (an O(E) scan) per element per render *and
   discards the result* — pure dead cost; `updateEdgePosition` does two O(V)
   `findElementById` scans per edge. At live scale (127×346) these dominate
   drag/warm frames. Delete the dead scan; add an id→element `Map`.
7. **`updateEdgePosition` deletes edges as a render side-effect** (`main.ts`
   else-branch): a transiently-missing endpoint (element still mounting,
   remote merge in flight) permanently drops a real edge. Edge hygiene
   belongs in load/sync, not the draw pass.
8. **Undo neither persists nor reconciles** (`main.ts _restoreSnapshot`): no
   `saveCanvas`, no `requestEdgeUpdate`, `lastWritten`/`lastEdges` untouched,
   camera restore commented out. Undo → reload resurrects the undone change;
   the next unrelated edit half-reconciles. Also `deleteSelection` /
   `duplicateEl` / `pasteClipboard` push no history snapshot at all — delete
   is unrecoverable despite the undo stack existing.
9. **`warmField` re-queued writes for every element per frame** (defused on
   this branch — the sim is off by default; the underlying issue remains
   under `?sim=1`: every rAF render runs `updateElementNode →
   queueElementWrite` with two `JSON.stringify` per element, ~250
   stringifies/frame on the live board).

### Medium

10. **Handles are gated on a dead CRDT shim by a bodyless `if`**
    (`main.ts` `if (awareness.getStates())` with no block — the next
    statement is its accidental body). Works only because the shim returns a
    truthy empty Map. Delete the vestigial CRDT surface (the dead `onUpdate`
    handler, the palette's no-op presence wiring) and the shim together.
11. **`safeActions` shadows the machine's `selectElement`/`clearSelection`**
    (`main.ts` `withConfig`): the inline FSM versions emit
    `parc:canvas-deselect` (closes edge/frame inspectors); the helper
    versions don't — so tapping an element/blank while an edge inspector is
    open leaves it stranded. The helper also hardcodes additive selection
    and skips group expansion — the §1.2 divergence, mechanized.
12. **`pasteClipboard` assigns a raw `Set` over `selectedElementIds`** —
    bypasses `updateGroupBox`, CRDT selection, and the
    `parc:selection-changed` dispatch; the sheet never learns about it.
13. **`navTo` hotspots dead** (`frameNav.ts`): reads `dataset.id`, elements
    carry `dataset.elId`. Whole feature inert. Root cause: `el:` prefix vs
    bare id vs `dataset.elId` handled by ad-hoc helpers duplicated across
    four files — the same thread breaks salience badges for imported facts
    (`salience.ts` looks up `el:${id}` while `salienceByKey` is keyed by the
    real `_factKey`).
14. **Two parallel edge-assembly implementations** (`loadInitialCanvas` vs
    `rebuildEdgesLive`) — already drifted twice (decoration-retire behavior;
    the authored-only change had to be written in both). Extract one
    `assembleEdges()`. Also: any remote link event rebuilds edges from
    substrate truth, silently dropping session-local `expandFact` edges.
15. **`frameOverlay`'s subtree MutationObserver** fires per pan frame and per
    element move, re-running `placedOf(all)` + an `innerHTML` SVG reparse —
    a per-frame O(V) cost the culling can't see.
16. **`startFlightRecorder` has no once-guard** — each board load (every
    drill) stacks another 1 s `setInterval` + `pagehide` listener, and can
    re-surface the crash banner spuriously.
17. **`applyResizeElement` schedules a rAF per pointermove** that reads
    `clientHeight` (forced layout) and asynchronously overwrites `el.height`,
    racing the synchronous write in the same handler.
18. **Dead FSM scaffolding misleads**: `moveElement`, `pinchElement`,
    `capMove`, `capPinchElement` are unreachable (their idle transitions are
    commented out); `capGroupScale: (_ => _.draft)` isn't an `assign`. The
    actual single-element move path is the *group* path — the code should
    say so.
19. **`flush()` writes serially** — a 20-fact save on flaky mobile holds the
    queue for the sum of round-trips; batch or `Promise.allSettled`. The
    snapshot cost compounds this: `structuredClone` + `JSON.stringify` of
    the whole board per commit is a repeated large allocation on mobile.

### Low / hygiene

20. `fetchFact` queries with `includeSuperseded:true` then takes the *first*
    key match — revision order unasserted; live-sync can act on a superseded
    copy (deleting a live element).
21. `setElementContent`'s img branch auto-fires AI image generation for any
    src-less img at render time — model jobs without user intent.
22. Culled-off-screen widgets keep their timers: the minimap's 800 ms O(V)
    redraw and view tiles' 60 s refetch run under `content-visibility:hidden`
    (only `body.gesturing` pauses the minimap).
23. `showModal` re-adds its document-level Escape handler per open and drops
    the previous resolver if reopened before close (the first awaiter hangs).
24. `openHistory` writes into `window.open` (popup-blocked on iOS ⇒ crash on
    `w!.document`) and shows `versionHistory`, which the persister strips —
    always `[]`.
25. `renderEdgesImmediately` orphan sweeps are O(edges²) (`find` per known
    id per pass); trivially a Set.
26. Unescaped user/agent content into `innerHTML` sinks (palette suggestion
    labels, context-menu header title/key, tour-bar label). The board
    renders substrate facts — agent-authored titles flow into these sinks.
    Escape at the seam.
27. Four camera-fit codepaths (`fitRegion`, `zoomToElement`, `zoomToFit`,
    `applyViewport`) — one shared resolver exists (ADR-0015); use it.

## 4 · Where I'd spend the next increment

1. **Board lifecycle correctness** (§3.1–3, 16): reset/scope the storage
   module's per-board state on load, make `detach()` tear down the
   adapter/FSM/palette/services, once-guard the flight recorder, re-key
   live-sync to the current board. This is the data-loss class — it
   outranks everything else in this document.
2. **One `uid()` + one fact-key accessor** (§3.4–5, 13): a typed id/key
   discipline kills the duplicate-clobber, the id collisions, and the
   navTo + salience-badge bugs in one move.
3. **Modeless gestures + one selection policy** (§1.1–1.2, §3.11) — deletes
   the largest class of interaction errors and simplifies the FSM.
4. **Save-state indicator + undo that persists + undo toast on delete**
   (§1.4, §3.8) — trust on mobile.
5. **Shortcut dispatch through `run()`** with collision lint at menu build
   (§2.2) — makes every advertised shortcut true.
6. **Extract `assembleEdges` + delete dead CRDT/FSM scaffolding**
   (§3.10, 14, 18) — prevents the recurring drift class.
7. **Palette as the touch surface**: thumb-reachable open affordance,
   dynamic placeholder teaching the free-text behaviours, persisted recents
   (§2.1–2.2).

## 5 · Resolution log (branch commits G1–G7, 2026-07-03)

### Fixed — §3 implementation findings

| # | Finding | Resolution |
|---|---------|-----------|
| 1 | Cross-board fact deletion on drill | `loadInitialCanvas` resets every per-board map on entry (pending kept); plus a `boardPriming` write gate while maps are unseeded |
| 2 | `detach()` leaks adapter/FSM/palette | all torn down in `detach()`; pointer adapter detaches from every root; shortcuts uninstallable |
| 3 | Live-sync stuck on first board's cid | tick re-keys every filter to the current board |
| 4 | Duplicate clobbers original fact | duplicate/paste strip `_`-transients (incl. `_factKey`) |
| 5 | Colliding `Date.now()` ids | one `uid()` (time+counter+random) everywhere |
| 6 | O(V·E) per render frame | dead `findEdgesByElementId` scan deleted; pass-scoped id→element Map |
| 7 | Draw pass deletes edges | missing endpoint hides for the pass, never mutates state |
| 8 | Undo doesn't persist/reconcile | `_restoreSnapshot` saves + refreshes edges; delete/duplicate/paste snapshot; **bonus**: fixed the off-by-one that made the first undo a no-op |
| 9 | warmField write storm | defused by sim-off default; remaining under `?sim=1` only |
| 10 | Handles gated on dead CRDT shim | dangling `if`, peer-selection, `onUpdate`, presence wiring, and the shim all removed |
| 11 | Helper actions drop deselect + diverge on selection | helpers delegate to `controller.selectElement` (replace; shift/meta adds) and emit `parc:canvas-deselect` |
| 12 | Paste bypasses selection path | selects through the controller path |
| 13 | navTo dead / salience keyed wrong | `dataset.elId` fix; salience keyed by `_factKey` |
| 14 | Duplicated edge assembly | one `assembleBoardEdges()` for load + live-sync; live rebuild preserves session-local expand edges |
| 15 | frameOverlay per-frame redraw | camera-only mutations ignored; 150 ms trailing throttle |
| 16 | Flight recorder stacks per drill | once-per-page guard |
| 17 | Resize rAF per pointermove | one measurement rAF in flight, last-wins |
| 18 | Dead FSM scaffolding | unreachable states/actions removed; honest-model comment added |
| 19 | Serial flush | concurrent `Promise.allSettled` + `parc:save-state` events |
| 20 | fetchFact revision order | prefers the live revision |
| 21 | img auto-generation on render | once per element per session |
| 22 | Culled widgets keep timers | minimap/view tiles skip beats under `content-visibility:hidden` |
| 23 | Modal resolver drop | prior resolver settled as cancelled on re-open (the Escape-handler accumulation claim was wrong — it installs once) |
| 24 | openHistory popup crash / always-[] | command + helper removed |
| 25 | O(E²) orphan sweep | live-id Set |
| 26 | Unescaped innerHTML sinks | escaped at palette labels, context-menu header, tour bar |
| 27 | Four camera-fit codepaths | zoomToFit + zoomToElement now use `fitRegion` (remaining: the relative `zoom()` helper, which is a different operation) |

**Found while fixing** (not in the original list): every *hydrated* open used
to persist a rewrite of the full board — the first render queued every
element/placement before the background load seeded the dedup maps. The
`boardPriming` gate closes this (G1).

### Fixed — HCI / palette (§1–2)

- One selection policy (§1.2): tap replaces, shift/meta adds, one
  implementation in the controller.
- Save-state indicator + delete undo toast + delete-in-history (§1.4).
- Shortcuts: collisions resolved, dead "⌘N x" chords removed, guards
  evaluated at dispatch, `needsInput` commands excluded, contenteditable
  ignored (§2.2).
- Persisted recents, command aliases, dynamic placeholder teaching the
  free-text behaviours, ✕ no longer aborts an input flow (§2.1–2.2).
- Menu hygiene: Save / History / Minimap retired (§2.2).

### Deferred — needs a product decision or its own increment

- **Modeless gestures** (§1.1): collapsing navigate/direct changes the core
  touch contract (view-mode pan-from-anywhere would be lost); do it
  deliberately, with the mode button's removal designed, not as a side fix.
- **Group "More" shows first element's actions** (§2.3): a true group action
  list is design work.
- **Edge inspector peek/half detents** (§2.3).
- **Snapshot cost** (§3.8's double serialization): structural-sharing or
  delta snapshots are an increment of their own; budget-capped today.
- **Thumb affordance for the palette on mobile** (§2.2): the sheet input is
  bottom-anchored already; a dedicated FAB/swipe gesture deserves a design
  pass rather than a bolt-on.
- **`el:`-prefix/`_factKey` unification behind one typed accessor** (§3.13
  root cause): the two worst symptoms are fixed; the full sweep across four
  files is mechanical but broad — do it when touching those files next.
