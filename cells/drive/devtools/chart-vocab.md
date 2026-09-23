# The chart: a shared vocabulary

Names for everything on the chart (`camMode === 'top'`), so a refinement can
say exactly which element and which behaviour it means. Each item has a short
ID; use the ID or the name, not a description of where it is. The annotated
frames are `devtools/chart-vocab.png` (regenerate with
`node devtools/chart-vocab-shot.mjs`).

**Frame** = the whole glass. **HUD** = everything drawn by `drawHud` on the
canvas over the world. **World** = what the renderer draws. **Card/chip** =
DOM over both. Positions are for a portrait phone.

## Top band

| ID | name | what it is | acts on |
|---|---|---|---|
| T1 | compass strip | full-width tape at the very top: ticks, cardinals, centre needle | — |
| T2 | heading readout | three digits under the needle (`000`, `122`) | — |
| T3 | clock | `HH:MM` top-left; dim `< >` while the sun is held | tap cycles TIME, drag scrubs the sun |
| T4 | MENU chip | top-right, DOM | tap opens the menu |
| T5 | stream readout | two lines under the clock: vector counts (`DONE WIRE QUEUE FAIL`), terrain counts (`MESH WAIT REBUILD CLIP`, then far/cover). Shown by the STREAM chip | — |
| T6 | scale line | `20 M · 1:816 · z19.2` — bar length, representative fraction, zoom | — |
| T7 | scale bar | the ruled bar under T6 | — |
| T8 | layer key | the one switchboard: OFF · ROADS · PLACES · COVER · ECO · GROUND · MATERIAL · SURFACE · WATER · HYDRO · X-RAY · TILES · STREAM. Filled = on. ROADS, PLACES, TILES, STREAM are checkboxes; COVER…WATER are one radio group; HYDRO and X-RAY cycle their views; OFF hides the whole HUD (double tap anywhere restores) | tap a chip toggles it; a cycling chip advances |
| T9 | legend | one source at a time: the ground view's classes, the HYDRO or X-RAY view's ramp, or the tile-grid key (TILES). The most recently switched-on source shows; with several, the first row reads `NAME k/n` | tap cycles to the next source, wrapping |
| T10 | *(retired)* | the grid key is T9's TILES variant now | — |

## Edges

| ID | name | what it is | acts on |
|---|---|---|---|
| E1 | tilt rail | left edge, label `TILT 70 DEG` over a slider | drag = camera tilt |
| E2 | band rail | right edge, label `BAND 100%` over a slider with sharp/blur brackets | drag = tilt-shift band |

## Bottom band

| ID | name | what it is | acts on |
|---|---|---|---|
| B1 | dock | square bottom-left; on the chart it previews the seat you'd return to | tap leaves the chart |
| B2 | control matrix | 3×2 grid right of the dock | see M1–M6 |
| M1 | drone cell | top-left of B2; charge sliver, height above it when flying | launch / recall |
| M2 | map-up cell | top-middle; lit = heading-up | north-up ↔ heading-up |
| M3 | seat cell | top-right; lit = cab | chase ↔ cab |
| M4 | AUTO cell | bottom-left | autopilot on/off |
| M5 | pause cell | bottom-middle | tap = hold, drag up = rewind scrub |
| M6 | WPT cell | bottom-right; gold = pins on | cycles waypoint mode |
| B3 | matrix status | one micro line over B2 (autopilot verdict, drone height) | — |
| B4 | dial cluster | bottom-right: speed, KM/H, RPM arc, SLIP/SOL/SVC lamps, trip·odo | — |
| B5 | place line | first line bottom-left: the place name | — |
| B6 | status line | second line: world status (`RETRYING WORLD DATA`), map loading (`MAP z12 · 7/25`), or the road under the wheels | — |
| B7 | coordinate line | third line: lat lon (+ fix accuracy on real drive) | — |
| B8 | FPS readout | red, centred on B7 | double tap copies telemetry |
| B9 | message rail | centred flashes at ~a quarter height (STORM, `hudFlash`) | — |

## Marks in the world (HUD-drawn, anchored to places)

| ID | name | what it is | acts on |
|---|---|---|---|
| P1 | pin | a waypoint on screen: foot diamond, beam, label with kind icon | tap opens its site card / toggles pinned |
| P2 | rim chip | a pin that is off-frame: arrow + name + distance, walked in from the edge | tap as P1 |
| P3 | summit mark | a peak: point, leader, name | double tap opens it |
| P4 | place name | town/city label from the overview (rank-coloured, cities only past 200 km) | double tap opens it |
| P5 | checkpoint pip | a task's route diamonds | — |
| P6 | route line | gold solid = task via; mint dots = solved route (fainter far half) | — |
| P7 | rig wedge | gold heading wedge at the truck when the model is too small to see | — |

## World layers

| ID | name | what it is | controlled by |
|---|---|---|---|
| W1 | fine ground | the streamed terrain round the truck (z14 tiles) | always |
| W2 | shell | the coarse far ground past W1, on the sphere | zoom / remote |
| W3 | overview ink | the chart's road ribbons (weight and ink fall with the rung) | ROADS chip |
| W4 | globe | the planet with its graticule, past the hand-over | zoom |
| W5 | globe pin | the truck's point on the globe | past the hand-over |
| W6 | grid boxes | z16 cells, z14 boxes, shell boxes, or one folded ring | TILES chip |
| W7 | ground view | a false-colour channel (COVER, MATERIAL, WATER, SURFACE) or the ECO sheet | layer key |

## Cards and chips (DOM)

| ID | name | where |
|---|---|---|
| C1 | task chip | top-left row, gold |
| C2 | route chip | beside/under C1, mint |
| C3 | route card | on the message rail; X folds, CANCEL ROUTE drops the goal |
| C4 | mission card / toast | centred |
| C5 | site card | centred: RELOCATE · DRIVE TO · X |

## Behaviours

| ID | name | what happens |
|---|---|---|
| G1 | pan | one finger drags the ground under it |
| G2 | steer-through | a first finger near the truck at close zoom steers instead of panning |
| G3 | pinch | two fingers zoom about their midpoint |
| G4 | wheel | desktop zoom |
| G5 | double tap | on a mark (P1–P4) opens its card; on empty ground drops a fix and opens its card |
| G6 | globe drag | past the hand-over G1 turns the planet |
| G7 | fling | a flicked globe coasts |
| G8 | drift home | when you drive, a pan eases back to the truck |
| G9 | leave | B1 or C back to the seat; the pan resets |

## Terms

- **zoom** — the `z` in T6 (slippy-map zoom at the frame's centre).
- **rung** — the tile level a layer is drawing (`MAP z12`, `FAR Z5`).
- **hand-over** — the zoom where the shell (W2) stops covering the frame and the globe (W4) takes the gestures.
- **fold** — a grid whose cells are too small to see drawn as one box round the ring.
- **tile-debug** — retired as a dial: it is the TILES chip (W6 and its key in T9) and the STREAM chip (T5), both off by default.
