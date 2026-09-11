# The ladder below z5 — what it would take

You pushed back on my "no", and you were right to. This is the measurement I
should have made the first time, and it changes the answer.

---

## What I got wrong

I compared the baked globe against *live tiles at the resolution of the bake's
own inputs* and reported 10–37× the bytes. That is the wrong comparison twice
over:

- **The bake's inputs are not its output.** `globe-base.png` is 1024×512
  equirect — **39 km per pixel at the equator**. It is *downsampled* from a
  4096² mercator mosaic. Mapterhorn z2 is 19.6 km/px and z3 is 9.8 km/px, so a
  z2 shell is already **twice the delivered resolution of the baked globe**.
- **A shell tile is not a texel.** It carries geometry, a normal map, and
  colour computed live by `climCompute` — the same functions the hillside under
  the wheels uses. The bake is a painted sphere. "Same resolution" was never the
  right axis.

So: yes. The wide view can be real tiles, and the reason it isn't has nothing
to do with the data being too expensive.

---

## Where the ceiling actually is — measured

`devtools/api-audit.mjs`-style run from **0.5N 22.0E (Tshuapa, DRC)**, chart
camera, zooming out:

| zoom | farZ | shell tiles | globe | m/px |
|---|---|---|---|---|
| 2,000 | 7 | 9/9 | off | 1,139 |
| 8,000 | 6 | 25/25 | 0.25 | 4,555 |
| 30,000 | 6 | 25/25 | free | 17,064 |
| 120,000 | 6 | 25/25 | free | 65,071 |
| 600,000 | 6 | 25/25 | free | 65,071 |
| 3,000,000 | 6 | 25/25 | free | 65,071 |

Two things fall out of that table:

1. **The ladder never leaves z6.** A 375× zoom-out and the level does not move.
   `farLevelFor` is fed `Math.max(r, SIGHT_M)` where `r` is capped at
   `SIGHT_MAX = 1,500,000 m`; at the equator a z6 5×5 ring reaches 1,565 km,
   which clears that ceiling, so **z5 — the last rung in `FAR_LEVELS` — is dead
   code here**. (It is reachable away from the equator, where cos(lat) shrinks
   the tile. Central Africa is precisely where it is not.)
2. **The camera saturates.** 120,000 and 3,000,000 produce *pixel-identical*
   frames, both reading `2000 KM · 1:93M · ×2.7`.

So the shell tops out covering a **1,565 km disc on a 12,742 km planet — about
12% of the face**, and the other 88% is a 39 km/px painting. That is your
screenshot, and it is not a blend problem or a tuning problem. The ladder
simply stops five rungs above where the data now goes.

---

## The inputs are already global — with one exception, and it is cheap

| input | state | reach |
|---|---|---|
| elevation | `~/dem/v1/` | **z0–z14.** Every tile present at z0 (1 tile, 239 KB), z1 (4, 873 KB), z2 (16, 3.2 MB); z3 is 61 of 64, the three missing being open ocean. Measured over the complete grid. |
| climate / palette | `client/climate.ts` | already client-side; it is what paints every shell tile today |
| coastline | `ne-wide.b64` | global, already in the cell |
| **land cover** | `~/cover/v1/` | **stops being affordable around z5.** This is the whole blocker. |

### One correction on Natural Earth

It is **not bundled into the client**. `static/ne-wide.b64` is read by
`index.ts` — server-side — and `neWideTile` answers `~/osm/ov1/` at z5–z9 in
the same `RawWay[]` shape Overpass returns, so the client cannot tell. That
matters here for a better reason than pedantry: **it is the exact precedent for
fixing the cover.** Its own header says why it exists — *"a chart backdrop
cannot depend on a third party answering inside the fifteen seconds CloudFront
will wait… the answer is needed at a scale nothing this game streams can
reach."* Same sentence, different raster.

### Why cover stops, and how much it actually costs to fix

`coverTile` range-reads 3°×3° WorldCover COGs. Source files touched by one
mercator tile, by level:

| z | tile | m/texel | source COGs |
|---|---|---|---|
| 8 | 157 km | 611 | 1 |
| 6 | 626 km | 2,446 | 6 |
| 5 | 1,252 km | 4,892 | 20 |
| 4 | 2,505 km | 9,784 | **64** |
| 3 | 5,009 km | 19,568 | **210** |
| 2 | 10,019 km | 39,136 | **690** |

That is why `COVER_WIDE_LEVELS` ends at 4. And there is no global overview
product to escape to — I listed the bucket: `v200/2021/map/` is the 3° COGs and
`v200/2021/macrotiles/` is multi-gigabyte **zips of the same 10m data**. The
ESA web viewer you're thinking of is Terrascope's pre-rendered WMTS: a third
party with no cache of ours, against the tenets and against `ne-wide`'s own
argument.

**So bake it once, like the roads.** And it is far smaller than I would have
guessed. Measured on 24 real z5 cover tiles off the live cell — class-index
PNGs, which is what this raster is — **0.044 bytes per texel**:

| a global class raster at | size |
|---|---|
| 1024×512 (39 km/texel, = the bake's own resolution) | **23 KB** |
| 2048×1024 (19.6 km/texel, = z2) | **90 KB** |
| 4096×2048 (9.8 km/texel, = z3) | **361 KB** |

**90 KB buys the entire planet's land cover at twice the delivered resolution
of `globe-base.png`** — and unlike the bake it is an *input*, so the client
still computes the colour with the live climate model.

That is the reframing this whole question turns on: **bake the inputs, not the
output.** A baked picture freezes the palette, the weather, the biome rules and
the coastline into an image. A baked class raster is just the cover layer
arriving by a different road, and everything downstream carries on.

---

## Geometry is not the constraint — and that surprised me

`farSeg` clamps to 128 segments; the shell budget is ~200k triangles over a 5×5
ring, 25 draw calls. The **whole planet at z2 is 16 tiles.** At the geometric
budget the globe sphere itself already spends (`globeGeometry(160, 80)` =
25.6k triangles for the entire Earth), 16 tiles at 40² segments is:

> **~51k triangles and 16 draw calls — for the whole planet. Cheaper than the
> 1,565 km ring the game draws today.**

The catch is one line. `farSeg` is **metres per vertex**, which is the right
dial while a tile is larger than the screen and the wrong one the moment it
isn't: at planet zoom it hands a 10,000 km tile a 128² lattice for something
400 pixels across. It needs to be metres per *screen pixel*. That single change
is a prerequisite for everything below, and it makes the levels that already
exist cheaper at wide zoom on its own.

---

## Your two asks are separate, and one is much smaller than it looks

### A. Extend the ladder below z5

`FAR_LEVELS = [13, 11, 9, 7, 6, 5]` → add 4, 3, 2. At z2 the "5×5 ring" concept
dissolves: 16 tiles *is* the planet, so the ring becomes "every tile at this
level", and `farOutside` stops applying. The DEM is already there. Cover comes
from the baked raster above.

### B. Retain what is already loaded as you pull out

`setFarLevel` clears `farMeshes` wholesale — every mesh at the outgoing level is
retired and disposed. That is the "perfectly good tiles thrown away" you saw.

**But the machinery for keeping them already exists.** `cullRetiredFar` carries
exactly the covered-by test a quadtree needs:

> *coarser now, its one ancestor has landed; finer now, every descendant the
> ring asked for has landed*

It uses that test to **drop** a retired tile. The change is to stop treating
retirement as a 20-second timer and start treating it as a **tier**: keep a
finer mesh while it is on screen and its area is worth its triangles; let the
coarser level draw behind it (the globe already writes no depth and renders at
`-5`, so the ordering discipline is established).

What this needs that does not exist: a **budget with a screen-area eviction
rule**. The comments record what happens without one — `far 45/45` after one
spin, and a phone at `FAR Z5 83/87`, 3 fps, 2.05M triangles. Age is the wrong
eviction key for a pyramid; contribution to the frame is the right one.

### The poles keep the bake, and that is the right end state

Mercator stops at ±85°, so z0–z2 tiles never cover the poles. The baked sphere
stays — as the **pole cap, the pre-stream first frame, and the floor under
everything** — and real tiles cover it wherever they have landed. Not "replace
the bake": **demote it to the bottom rung of the ladder.**

---

## Staged path

Each stage is independently shippable and independently measurable.

| # | change | new data | risk |
|---|---|---|---|
| 1 | `farSeg` keyed on screen pixels, not ground metres | none | low — makes today's wide zooms cheaper by itself |
| 2 | `FAR_LEVELS` → `[…, 5, 4, 3]`, cover falling back to z4 | none (DEM already global) | low — colour gets coarser, geometry gets *real*; replaces painted marble with lit relief out to a few thousand km |
| 3 | bake a global cover class raster; serve `~/cover/wide1/` | ~90 KB, one object | low — `ne-wide.ts` is the pattern, verbatim |
| 4 | planet-covering z2 level; bake demoted to pole cap + first frame | none | medium — ring logic dissolves at z2 |
| 5 | retention: retired-as-tier + screen-area budget | none | **medium-high** — this is the one that can regress the phone |

Stages 1–3 are the ones that make the screenshot stop looking like that.
Stage 5 is the one you actually asked for, and it is last on purpose: it is the
only one that can take frame rate away, and it is much easier to tune once
there is a real pyramid under it rather than a single swapping ring.

Edge and blend tuning is explicitly out of scope, per your note.

---

## What I have not verified

- Whether the 25 z6 tiles standing at globe zoom are **visibly** contributing.
  They are in `farGroup`, which is in `planetGroup` and draws over the globe —
  but at that screen size I cannot tell them from the bake in the capture, and
  I am not going to claim a win I cannot see.
- Whether `~/cover/v1/` at z5 (20 COGs) is *actually* fast enough to keep in
  the live ladder, or whether the baked raster should take over from z6 down.
  That is a timing measurement on the deployed route, not an arithmetic one.
- Cover class at 39 km/texel is a **majority-ish sample of one pixel**, not an
  aggregate. Whether the wide palette wants "the commonest class in this cell"
  rather than "the class at this point" is a real question for the bake, and
  the answer changes what the raster stores.
