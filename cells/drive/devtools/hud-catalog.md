# HUD catalog — every canvas surface, ahead of the font migration

Git truth for the code is `client/main.ts`; this file maps its drawing
surfaces so the Silkscreen migration (and any further DOM extractions) can be
scoped honestly. Section names below match the `// ──` banners in the source —
line numbers drift, banners don't. Lives in `devtools/` deliberately:
`cell-sync` skips it, so it never ships with the cell.

## 1. The text stacks

All HUD text goes through exactly two faces, drawn as `fillRect` runs into the
low-res HUD buffer (`hudS` = 2 CSS px per HUD px on phones, 3 on desktop):

| face | fn | grid | advance | measure | truncate |
|---|---|---|---|---|---|
| primary | `text(ctx, s, x, y, col, sc)` | 5×7 (`GLYPHS`, base32 rows) | `(5+1)·sc` fixed | `textW` | `fit` (char count) |
| micro | `textSmall(ctx, s, x, y, col)` | 3×5 (`GLYPHS_S`, octal rows) | 4 fixed | `textSW` | `fitS` (char count) |

Wrappers that compose them: `textEdge` / `textEdgeS` (1px ink outline, the
"floating over the world" treatment), `glowText` (pixel-art glow — same shape
at low alpha, ±1px). Non-text primitives in the same vocabulary: `panel`
(fill + rule + corner brackets), `frame` (panel minus fill — a HOLE the
renderer draws through), `meter` (cell bars), `diamond`/`diamondOutline`
(checkpoint markers, local to `drawHud`).

**Load-bearing assumptions a proportional font breaks:**

- **Fixed advance.** `textW = len·6·sc`, `textSW = len·4`. Every
  right-alignment, centring, and column in the HUD is arithmetic on these.
  Migration swaps them for `ctx.measureText` — call sites don't change shape,
  but anything that assumes *reversibility* (px → char count) does:
- **`fit`/`fitS` truncate by character count** derived from the fixed
  advance. Need a measure-then-slice loop instead.
- **The system-font escape hatch.** Both faces fall back to
  `ui-monospace` per *character* for anything outside the bitmap set — Arabic
  and Icelandic place names, and crucially the **alien script** (Yi syllables,
  U+A000+), which is entirely fallback-rendered. Silkscreen has no Yi glyphs:
  the migration must keep a per-char fallback path or the «translation»
  mechanic loses its look.
- **Scale is integer.** `text(..., sc=2)` doubles the grid (speedo digits).
  Silkscreen equivalent: 8px vs 16px, still integer.

**Sizing map for the migration** (Silkscreen is a 5×7-ish face on an 8px em,
so it drops onto the same grid): `text` ≈ `8px Silkscreen` in HUD-buffer px,
`text sc=2` ≈ `16px`, `textSmall` has **no Silkscreen companion** — either
keep the 3×5 bitmap for micro text (it is genuinely smaller than anything a
web font offers, and it is the majority of the HUD) or accept 8px everywhere
and re-fit the dense corners. Recommendation: migrate the 5×7 face only,
keep 3×5 bitmap. The two already coexist.

## 2. Surface inventory (`drawHud`, top to bottom of the draw order)

| surface | faces used | notes for migration / DOM review |
|---|---|---|
| checkpoint markers (`cpDraw` loop) | none (diamonds, beams) | pure geometry; untouched by font work |
| POI pins (`poiDraw` loop) | micro + `textEdgeS` | world-anchored, occlusion-ghosted; **stays canvas** (needs the world's pixel grid + per-frame projection) |
| compass strip | primary (`textEdge` cardinals) | 5×7 → 8px; centring via `textW/2` → `measureText` |
| MENU chip (`menuRect`) | primary + `panel` | **DOM candidate** — it opens a DOM menu; a DOM button removes the last canvas hit-target that isn't driving-adjacent (see §3) |
| STORM APPROACHING banner | primary (`textEdge`) | ephemeral toast; could be DOM, low value |
| co-driver bend call | primary (`textEdge`) | mid-screen, per-frame, tied to nav state; stays canvas |
| dock (POV/minimap square, `dockRect`) | primary label + `panel`/`frame` | frame is a renderer hole (like the menu bay); stays canvas |
| place / way / survey tally / coordinate lines | micro + `textEdgeS`, primary place | left column; dense micro text — argument for keeping 3×5 |
| GPS accuracy / fix-age readout | micro | rides the coordinate line under real drive |
| tachometer cluster (ring, sweep, card) | primary ×2 scale (speed), micro (units, RPM) | the showpiece instrument; stays canvas |
| LEDs (SLIP/SOL/SVC) | micro | stays canvas |
| RIG table (SUSP/HULL/TYRE/BATT) + `meter` | micro | stays canvas |
| ENV table (WET/surface/weather/heading) | micro | stays canvas |
| mission offer / active / arrived panel | primary + micro + `panel` + `glowText` | **the strongest DOM candidate** — it is literally called "the job, as a modal", has a tap target (`missionRect`), wraps badly in bitmap (`fit` truncation), and pauses nothing. A DOM sheet like the menu would give it real text layout and a real button |
| "SURVEYED" claim toast | primary + micro + `panel` | passive toast; fine on canvas, or trivially DOM alongside the mission panel |

## 3. Non-`drawHud` surfaces

| surface | what it is | verdict |
|---|---|---|
| boot overlay (`#boot`) | DOM already (shell HTML) | give it the Silkscreen face for consistency (it's the first text seen) |
| DOM menu (`client/menu.ts`) | DOM, Silkscreen | done |
| touch stick (`stickBase`/`stickNub`) | DOM divs | done, no text |
| `#reroll` "elsewhere ↻" button | DOM, shell | **retire** — duplicated by DRIVES → ELSEWHERE; it predates the menu |
| `#place`, `#speed`, `#hint` shell divs | DOM, shell | dead ("the shell's own text chrome is retired") — remove from `SHELL` |
| minimap (`mini` canvas + `mapLayer`) | canvas, north-up chart | stays canvas; no text |
| POV dock inset / vehicle bay | renderer scissor blits | stays; the DOM menu already coordinates with the bay |

## 4. Recommended order

1. **Mission panel → DOM** (biggest UX win: real wrapping, real tap target,
   Silkscreen for free; also removes `missionRect` from `hudTap`).
2. **MENU chip → DOM** (removes a canvas hit-target; trivial).
3. **Font migration of the 5×7 face** behind a flag: swap `text`/`textW`/`fit`
   internals to `fillText`/`measureText` with `8px/16px Silkscreen`
   (`document.fonts` is already seeded by `client/font.ts`), keeping the
   per-char fallback for Yi/Arabic. Judge on the compass, speedo and mission
   text; keep the 3×5 micro face bitmap.
4. **Shell cleanup**: drop `#reroll`/`#place`/`#speed`/`#hint`, Silkscreen the
   boot overlay.

## The safe area (R29)

`hudSafeRects()` in `client/main.ts` is the one inventory of the glass's
reserved ground, in HUD px: the compass strip (plus the tile-debug header when
that dial is on), the top-left waypoint distance chip, MENU, the conditions
column, the dock square with its chips and info lines, the dial/LED/RIG block,
and the bottom place-and-coordinates line. Anything that PLACES itself — the
chart's rim chips today — walks inward along its own screen bearing until it
stands on open glass, and does so in `updatePois`, so `__pins().drawn[].sx/sy`
(with `safe` and `hudS` in the same probe) is the position actually painted.
The rects deliberately overshoot by a few pixels: open glass is cheap,
a chip over the battery bar costs both readings. If an instrument moves,
move its rect — the suite (`poi-project.test.mjs`) asserts chips stay clear.
