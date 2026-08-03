# Home — interaction & affordance inventory (review, 2026-08-03)

> A stocktake, not a patch. Prompted by an owner field report: *"selecting a
> node in the graph changes the ground key"* — which turned out to be one
> instance of a general condition: the selection model has three behaviours
> for one gesture-class, and the edit affordances added in the render/edit
> consolidation reached some surfaces and not others. Everything here is
> observed from the code as deployed (branch `claude/substrate-home-cell-render-fzxqu2`),
> with file:line refs. No changes ship with this doc.

## 1. The selection model — the reported inconsistency, precisely

Home holds **two selections** by design (`app.tsx:210-236`):

- `selectedKey` — what the **graph** is aimed at (the sky's ring, the palette's context).
- `groundKey` — what the **trailhead ground** reads (the light content sheet).

The stated contract (comment at `app.tsx:216-219`): *direct trailhead
selection fills the ground AND the graph; the peek sheet drives only the
graph, so drilling never hijacks the main content.* The implementation has
**four paths that disagree**:

| Path | Sets | Site |
|---|---|---|
| Scene tap (star/label/caption) — **in both preview and entered graph** | `selectedKey` + `groundKey` | `selectByNode`, `app.tsx:232-236`; wired at `:537` |
| Palette pick (neighbour chip, console fact row, trail back) | `selectedKey` only | `app.tsx:545` |
| Peek drill (frame change) | `selectedKey` only; close snaps back to `groundKey` | `app.tsx:691,698` |
| Exit-to-trailhead | **grip gesture** adopts `groundKey = selectedKey` (`app.tsx:551`); **wordmark tap** does not (`:564` → `toLanding`) | |

Consequences the owner can feel:

- Browsing the **entered** graph rewrites the ground behind the night sky —
  exit via wordmark and the trailhead shows the last star you tapped, not
  what you were reading. Exit via the grip and it shows... also that, but
  *because a different line said so*. The two exits agree only by accident
  of the scene-tap over-reach.
- Browsing via the **palette** (chips) does NOT move the ground — so the same
  logical act ("go look at this fact") hijacks the ground from one input
  surface and preserves it from another.
- The URL (`/r/<key>`, written from `selectedKey` at `app.tsx:250`) tracks
  the *graph aim*, not the ground — after a peek-drill-then-close, or a
  palette walk, the address bar and the ground agree again; mid-drill they
  don't. Defensible (the URL is "where you're looking"), but undocumented.

**The likely intended rule** (inferred from the comments): *ground changes
only by deliberate acts of reading* — a trailhead tap, a deep link, an exit
commit. If that's the rule, the one wrong line is `setGroundKey` inside
`selectByNode` firing for **entered**-graph taps; preview taps are the
trailhead case and should keep it. (Alternative rule — "ground follows the
last selection, always" — would instead delete `groundKey` entirely and fix
the palette path. Either is coherent; today is neither.)

## 2. Selection/URL writers — complete census

| Trigger | Sets | Site |
|---|---|---|
| Graph star/label tap | selected + ground + node | `app.tsx:232-236` |
| Edge-relation chip tap | same, **and flies immediately** | `graph.tsx:1597-98` |
| Caption tap (authored place) | same via `tapNode` | `graph.tsx:1580-86` |
| Caption tap (computed place) | **camera turn only, no selection** | same |
| Empty-sky tap | clears all | `graph.tsx:1609` |
| Console search | highlights results, **clears scene `selKey` without notifying App** — URL keeps the stale key | `graph.tsx:1677` |
| Fact deleted (live poll) | notifies null | `graph.tsx:3231` |
| Palette chips / console rows / trail | selectedKey only | `palette.tsx:227,285-291`, `console.tsx:489-491` |
| Peek frames | selectedKey only; close → groundKey | `facts.tsx:1305`, `app.tsx:691-698` |
| Hash/path hydration (once) | both | `app.tsx:243-248` |
| Graph rot/zoom settle | `rot`/`zoom` params | `graph.tsx:2667-84` |
| Console query | `q` param | `console.tsx:404-413` |

All URL writes are `replaceState` (`urlstate.ts:92`) — **browser Back never
walks the peek history** the sheet maintains; it leaves the app (§5.14).

## 3. Read-affordance inventory (what opens a reading)

| Gesture | Where | Outcome |
|---|---|---|
| Tap a star / tight label | graph (both modes) | select; ground+graph (see §1). First tap holds camera; tap the *same* star again → face + telescope (`graph.tsx:1572-79` — state-based, no double-tap timing) |
| Tap wiki/corpus link in any body | ground, peek, palette body | `openFact` → peek frame (`facts.tsx:255,502,689,737`) |
| Tap "⊂ part of ⟨container⟩" | member bodies | container peek scrolled to member (`facts.tsx:595`) |
| Tap neighbourhood chip | ground footer, peek | `openFact` → peek (`facts.tsx:964`) |
| Tap neighbour chip | **palette context panel** | `drillTo` → *selection change only, no reading opens* (`palette.tsx:227`) — same visual chip as above, different outcome (§5.6) |
| Console fact row / result title | console | selection change / plain `<a>` nav — never a peek (`console.tsx:490,887-904`) |
| Featured cards, docs links | anon landing | full page navigation |
| Peek stack | drag-down = back/close, pile drag-up or tap = forward, `‹` back, `×` close, Escape | `facts.tsx:1355-77,1424-29`; no scrim, no outside-tap (comment at `:1277` still claims one — stale) |

## 4. Edit-affordance inventory (post-consolidation, as deployed)

| Affordance | Where it appears | Gate | Site |
|---|---|---|---|
| Footer **Edit** (one-tap → peek w/ editor) | ground footer | `authed && !system` | `facts.tsx:892` |
| **Edit in @cell ↗** (declared handler) | ground footer + peek, both alongside in-place since a0e6628 | type declares `edit` | `facts.tsx:891,1256` |
| Peek **Edit** button | peek actions | `!system` (no authed gate — §5.1) | `facts.tsx:1258` |
| Fence **✎** chip | any full body with `editable`: peek (`!system`), ground (`!!authed`), palette compact body (`!system`) | top-level fence, not a `< source` | `safe-markdown.tsx:160-77`; wiring `facts.tsx:842,1236` |
| Member-grain edit (doc members) | assembled docs where `DocBody` gets `editable` | ground+peek; **not the landing doc** (§5.3) | `facts.tsx:527-39` |
| Palette **edit** toggle (InlineFactEditor) | context panel | `!editHref && !_` — still the either/or the footer fixed (§5.5) | `palette.tsx:99,169-79` |
| ✎ edit link on cards (`EditLink`) | only `WorkspaceWindow` — **dead code** | — | `facts.tsx:133-41` |
| Editor keys | ⌘/Ctrl-Enter + ⌘S save, Escape cancel | | `editor.tsx:76-79` |
| Console act forms | focused command; typed-confirm for high-risk acts | | `console.tsx:568-677` |

## 5. Inconsistency register (ranked)

**Selection model**
1. **Entered-graph taps hijack the ground** — the report; see §1.
2. **Exit paths disagree** — grip commit adopts selection as ground (`app.tsx:551`), wordmark doesn't (`:564`).
3. **Search desyncs scene from App/URL** — `graph.tsx:1677` clears `selKey` directly, bypassing `select()`; URL keeps the old key.
4. **Palette chips vs neighbourhood chips** — identical chip, one re-aims, one opens a reading (§3).
5. **Console results can't be read in one gesture** — fact rows select instead of peek (`console.tsx:490`); compact `FactDetail` behind them has no actions row.

**Edit gates (one rule, four spellings)**
6. Ground Edit needs `authed`; peek Edit doesn't (`facts.tsx:892` vs `:1258`) — a guest gets a button that can only fail at the gateway.
7. Same split for fence ✎ (`dashboard.tsx:476` vs `facts.tsx:1236`).
8. **The landing doc is the one fact you can't edit where you read it** — `dashboard.tsx:497` passes no `editable`/footer to `DocBody`.
9. The palette still hides in-place behind a declared handler (`palette.tsx:99`) — the exact either/or `facts.tsx:888-90` documents as fixed for the footer.

**Graph gestures**
10. `dragThreshold = 6` is dead-tuned — the comment (`graph.tsx:1421`) describes raising it for touch; never reassigned, and `:1480` measures Manhattan distance, tripping *earlier* than the documented 6px.
11. Edge-chip tap flies on first tap; node tap deliberately doesn't (`graph.tsx:1598` vs `:1577`). External selections always fly (`:3673`); scene taps never do.
12. Preview zoom: pinch allowed (dome-clamped), wheel disabled outright (`graph.tsx:1493-97` vs `:1537`) — trackpad users get no trailhead zoom.
13. `pointercancel` swallows taps and can leave `moved` stale, suppressing the *next* tap (`graph.tsx:1549-54`).
14. Vantage glyph `◎/◉` is a local mirror; pinch/wheel across the midpoint desyncs it and its `aria-pressed` (`graph.tsx:3773`).
15. The charting chip both sets `visible=1` and toggles the reveal pump (`graph.tsx:3848`) — the two ideas its own comment insists stay separate.
16. Caption taps are bimodal (authored = select, computed = turn only) with identical visuals (`graph.tsx:1580-86`).

**Keyboard & a11y**
17. Escape is triple-bound (palette collapse, peek back, console clear); only the console guards, only when non-empty (`palette.tsx:391`, `facts.tsx:1426`, `console.tsx:820`) — one press can do two things.
18. ⌘K opens, never toggles, and only exists once entered (`palette.tsx:388`; mount `app.tsx:541`) — no command surface on the trailhead.
19. The enter grip is keyboard-inert (`dashboard.tsx:451-67`, `role="button"`, no `onKeyDown`); the palette grip handles arrows (`palette.tsx:451-54`).
20. Forward in the peek has no button and no key — drag/tap-the-pile only (`facts.tsx:1523,1628`); the focus-scrub is pointer-only (`graph.tsx:3774-90`).
21. Hover dwell-labels are mouse-only; touch has no equivalent (`graph.tsx:1446-51`).

**URL & routing**
22. `localize` is applied inconsistently: footer/palette localize open/edit hrefs; `FactDetail` (`facts.tsx:1254-56`), console results, views use raw hrefs; a wiki-link inside a *title* gets no `factHref` at all (`facts.tsx:834`) → relative `/r/` that 404s off-apex.
23. Browser Back never walks peek history (all `replaceState`).
24. Re-opening the current fact is a silent no-op that also drops the `anchor` (`facts.tsx:1393-98`) — the "⊂ part of" banner inside its own container does nothing.
25. `initialMd` (SSR body) reaches the ground but not the peek — an anon deep link re-reads from scratch when peeked.

**Stale/dead**
26. `SHEET_TONE.scrim` unused; header comment claims "× / scrim dismiss" (`facts.tsx:782,1277`). `modalOpen()` checks `[role="dialog"]` that nothing renders, inside an effect that's unreachable (`app.tsx:55,60`).
27. Never-mounted exports carrying live affordances: `DashboardHeader`, `QuickCapture`, `StatCards`, `RecentActivity`, `WorkspaceWindow` (sole `EditLink` consumer), `Views`/`ViewSurface`/`CellsConsole`, `IdentityShell` (grants/token UI!) — `dashboard.tsx:580-852`, `facts.tsx:1698`, `views.tsx`, `identity.tsx`.
28. Light peek stack silently renders null if `#peek-dock` is missing while frames persist (`facts.tsx:1445-46`) — reachable during the enter/exit tone flip.

## 6. Recommendations (deliberately not applied)

1. **Decide the ground rule and write it down** (§1). Cheapest coherent fix:
   scene taps set `groundKey` only in preview (`selectByNode` learns the
   mode); the exit *commit* remains the one deliberate adoption point, and
   the wordmark exit adopts too (making the two exits agree). One line each.
2. **One edit-gate helper** — `canEditInPlace(e, authed)` = `authed && !system`,
   used by footer, peek, palette, ground, and `DocBody` (incl. the landing
   doc, which should take `editable` like any other ground read).
3. **One chip contract** — a fact chip opens a reading (peek); re-aiming the
   graph is the selection side-effect, not the destination. Aligns palette
   chips and console rows with neighbourhood chips.
4. Route search-clear through `api.select(null, …, notify=true)` (§5.3).
5. Apply the documented touch `dragThreshold` (and make it Euclidean).
6. Sweep `localize` over every fact href (one helper, §5.22).
7. Delete or mount the dead surfaces (§5.27) — `IdentityShell` especially:
   grant approval UI existing but unreachable is a real capability gap.
