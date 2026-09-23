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

## 2. Where things stand (2026-09-22)

The inventory below this line in earlier versions of this file is stale; the
catalogue as it now stands:

- **Done:** MENU chip, mission card, task and route chips are DOM
  (`client/overlays.ts`); the shell's `#reroll`/`#place`/`#speed`/`#hint` are
  gone. The 5×7 face stayed a bitmap (a Silkscreen `fillText` antialiases and
  every small pixel webfont has a 5-unit cap — see the note above `GLYPHS`);
  micro text is Micro 5 rasterised to 1-bit (`microGlyph`), not the old 3×5
  table.
- **The strait is the DECK (`client/hud-deck.ts`)**: DRONE · AUTO · CAM ·
  NAV · (a free slot) · VIEW. DRONE and AUTO are modes, CAM a chase/cab
  (trailing/nose) switch with no tray, NAV and VIEW layouts with a tray.
  Icons only; state and one signal (a bar, a dot) instead of words. The dock
  is the bare camera switch; the edges are the camera's (chart TILT/BAND,
  seat gauges, drone ALT/PITCH); the chip always says MENU. See the drive
  CLAUDE.md section "The deck" for the table. Six across when each cell is
  at least `DECK_MIN_CELL` CSS px.

Probes: `__deck(tab?)` (state, and a tab tapped through the real handler),
`__deckrect(id)` (client rect of a tab or panel item — tests tap where a thumb
lands and assert `elementFromPoint` finds it), `__autorect()` (the AUTO
chip on the baseline strip), `__hudrects()` (dock, seat chip, rails). `devtools/hud-deck.test.mjs` holds the behaviour and
`devtools/deck-shot.mjs` takes the frames.

## The safe area (R29)

`hudSafeRects()` in `client/main.ts` is the one inventory of the glass's
reserved ground, in HUD px: the compass strip (plus the tile-debug header when
that dial is on), the top-left waypoint distance chip, MENU, the conditions
column, the dock square with its chips and info lines, the dial/LED/RIG block,
the deck's strait (its tabs and the status line over them), VIEW's tagline
while it is up, and the bottom place-and-coordinates line. The ENV and RIG
stacks are reserved in the driving layouts only; the chart's edges are clear. Anything that PLACES itself — the
chart's rim chips today — walks inward along its own screen bearing until it
stands on open glass, and does so in `updatePois`, so `__pins().drawn[].sx/sy`
(with `safe` and `hudS` in the same probe) is the position actually painted.
The rects deliberately overshoot by a few pixels: open glass is cheap,
a chip over the battery bar costs both readings. If an instrument moves,
move its rect — the suite (`poi-project.test.mjs`) asserts chips stay clear.
