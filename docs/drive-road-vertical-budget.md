# How roads get their height, end to end

A survey of every mechanism that decides where a road sits relative to the
ground, written after the third "roads are floating" report in a week. Each
mechanism below was added to fix a measured failure, each fix is individually
defensible, and the sum reads as over-complication — because most of them are
compensating for the same single root fact. This document names that fact,
prices every layer against it, and proposes the clean base.

## The pipeline, in order

A way arrives from OSM and becomes geometry in `ribbon()`:

1. **Densify** to ~12 m steps (OSM only stores vertices at bends; long
   straights would otherwise chord over dips).
2. **Sample elevation** at every step — centreline (`elev`) and full-width
   minimum (`elevMin`).
3. **Profile** (`prof`): tunnels and bridges take portal-to-portal chords;
   untagged runs that sit deep under a 500 m-smoothed terrain become tunnels.
4. **Kerb-solve** (the hug): each kerb is dropped onto the ground under it —
   never raised — capped at the profile, smoothed 3×, and the centreline and
   cross-fall (`tilt`) are read back off the two kerbs. Scaled by daylight so
   bridges keep flat decks.
5. **Draw** the deck at `prof ± tilt + lift`, plus apron skirts, rails, piers.
6. **Register segments** carrying `ya/yb` (profile), `ca/cb` (cross-fall),
   `hw`, quality — physics reads the same numbers the renderer drew.
7. **Cut the corridor**: `roadCeiling()` clamps the terrain field under and
   beside the road; `groundAt = min(heightfield, ceiling)`; the terrain mesh,
   wheels and scatter all read `groundAt`.
8. **Fair the wheels** across the kerb over `KERB_FAIR` (2.2 m smoothstep).

## The root fact

**The terrain mesh samples the cut field at vertices ~16 m apart and draws
straight chords between them.** Roads are continuous; the ground that has to
agree with them is piecewise-linear at 16 m. Every complication below is one
of the two possible responses: keep the road clear of the worst chord, or
flatten the ground until chords are harmless.

| mechanism | exists because | cost |
|---|---|---|
| `lift` stack (green < water < track < rail < road) | draped layers must not z-fight | raises every deck |
| `CUT_CLEAR` (ground planed to `prof − clear`) | a chord between two in-corridor vertices must stay under the deck | daylight under every road |
| bench = cell diagonal (`CUT_SLACK`, ~22 m) | a vertex a full diagonal away still shapes the triangle under the road | planes 22 m of land each side |
| bench flat (`CUT_WASH ≈ 0`) | the lip must stay below the tarmac across the whole bench | the planed land is *level*, reads as a terrace |
| bed + `hard` | the wide bench of a lower road was excavating its neighbour's foundation | two more fields in the min/max dance |
| aprons/skirts | the designed daylight has to look like earthworks, not levitation | the slab walls in every screenshot |
| `KERB_FAIR` | the wheels must cross the designed step smoothly | — |

The coupling inequality that holds it together:

```
lift + CUT_CLEAR − CUT_WASH · CUT_SLACK  >  margin
```

## The "lower everything by 0.5 m" instinct — measured

Correct in magnitude, wrong in mechanism. The visible gap on **dead-flat
Death Valley** measured 0.55 m median — identical to Noordhoek and Big Sur —
so it is not accumulated error but the *designed* constant
`CUT_CLEAR + lift = 0.30 + 0.22 = 0.52`. Lowering the deck alone would sink
it beneath its own cut ground; the gap is what had to shrink, and it is two
named numbers. Done in the same commit as this document:

| | before | after |
|---|---|---|
| designed gap | 0.52 m | **0.30 m** |
| visible gap, median (all sites) | 0.55–0.59 | **0.33–0.41** |
| deck breaches (flat sites) | 0 | 0 |
| deck breaches (Bormio/Chapman's cliffs) | 2 / 4 | 2 / 5 (pre-existing class) |

`CUT_CLEAR` 0.30 → 0.12, `CUT_WASH` 0.008 → 0.004, road lift 0.22 → 0.18,
track 0.18 → 0.15, rail 0.20 → 0.16. The inequality holds with ≥ 0.21 margin
at every latitude and TERRAIN dial setting.

## What this does not fix

The **canyon** (Noordhoek): the 22 m flat bench, and the min across roads
planing a junction to its lowest carriageway. That is the bench's width, not
the budget's height, and its width is forced by the mesh cell. The TERRAIN
dial (COARSE/FINE/FINEST) trades triangles for bench width today.

## The clean base (built)

The bench, tail, batter, bed and `hard` are gone, replaced by one structure:
a lattice **raster of the carriageway strips** (`cutCells`, cell = the mesh
cell), consulted by two rules that are both *parallel to the deck* (heights
always evaluated at the nearest strip point — a per-cell floor quantizes the
deck along its own gradient, measured as a 1.9 m float on Noordhoek's grades):

- **mesh rule** (`cutAtVertex`): flat across a 3×3-cell reach, parallel along
  the road. Parallel is what makes the no-chord-over-a-deck guarantee survive
  a gradient: the clamps of a crossed triangle's vertices are linear in
  along-road position, so their chord over any crossing point sits at that
  point's own floor.
- **field rule** (`roadCeiling`, the wheels/scatter): same strips, graded off
  the kerb at a 32° cut face — continuous, because the hard rule steps by the
  whole cut depth at cell boundaries and the suspension read that as a 32 m
  teleport beside a Bormio hairpin.

Two intermediate designs failed measurably on the way and are worth
remembering: per-cell *floors* (deck quantization → 1.9 m float on grades),
and one shared hard rule (32 m field steps). Accepted results:

| site | cut beside road, worst | cut mean | breaches | tyre step |
|---|---|---|---|---|
| Noordhoek | −9.54 → **−1.75** | −3.22 → **−0.29** | 0 → 0 | 1.33 → 1.36 |
| Big Sur | −4.93 → **−0.69** | −1.40 → **−0.07** | 0 → 0 | — |
| Bormio | −3.92 → **−2.44** | −1.10 → **−0.61** | 2 → **0** | 14.6 → **4.3** |
| Chapman's | −8.50 → **−3.34** | −4.31 → **−2.60** | 4 → **0** | 5.6 → **4.3** |

The bed proved to be compensation for the bench: with per-strip locality even
Bormio's stacked hairpins cut *less* without it. Terrain build time unchanged
(~30 ms/tile). Remaining refinement if ever needed: per-edge exact clamping
inside the mesh builder, which would let `CUT_CLEAR` approach centimetres.

## The min survived the rewrite (and had to be measured out)

The section above claims the old "MIN across all roads in reach" was replaced.
Half of it was: the *reach* shrank from a 22 m bench to a raster cell. The
**min itself did not** — `cutAtVertex` still took the lowest strip found in a
3×3 cell neighbourhood, which at a 15.8 m cell is any carriageway within
~30 m. On a road network that is nearly always *some* lower road, so nearly
every road was still being planed down to its neighbour:

| | Death Valley (flat) | Chapman's Peak (stacked) |
|---|---|---|
| sections where a *different* strip set the floor | 9 / 9 | 67 / 71 |
| the road's own deck floor below natural | 0.12 m ✓ | 0.25 m ✓ |
| what the mesh actually clamped to, below that floor | 0.67 m | **3.75 m** |

That is the "road ribbons render 0.5–1.0 m above the terrain" report, and it
also explains why the **grass looked right while the road did not**: scatter
reads `roadCeiling`, whose 32° grading makes a distant strip irrelevant, so
the sward stayed at natural height over a mesh that had been dug out beneath
it. Two rules, two answers, and the eye was reading the difference.

**The rule now.** A vertex's height can only affect deck points inside the
triangles that touch it, and those fill the square `[V ± cutL]`. So a strip
clamps a vertex only if it actually reaches that square — a slab test of the
centreline against the square grown by the carriageway half-width. Exact along
the axes, where a radius test is worst: a road running *parallel* 21 m away is
nowhere near a 15.8 m square, yet sits comfortably inside its 22 m diagonal.

Flat-across is not a choice, and that is worth writing down so it is not
re-litigated: any outward grading `k·out` survives the barycentric blend as a
positive term *at the deck point itself*, so it lifts the chord over the
tarmac. Absorbing it would need `CUT_CLEAR ≈ k · cutL` — metres of daylight.
The only lever on how much land gets planed is therefore the REACH.

| dig below natural, at the kerb | before | after |
|---|---|---|
| Death Valley (flat) | 1.02 m | **0.50 m** |
| Noordhoek | 1.73 m | 1.34 m |
| Chapman's Peak | 4.33 m | **2.82 m** |
| Chapman's, 32 m out | 4.38 m | **1.50 m** |
| deck breaches, 4 sites | 0 | **0** |
| max tyre step | 4.3 m | 4.3 m |

The residual is the mesh cell itself: reach scales with `cutL`, and the thief
distance tracks it exactly (21.3 → 14.4 → 10.3 m across COARSE/FINE/FINEST),
halving the dig at each step — Chapman's 2.85 → 1.89, Noordhoek 1.73 → 0.81.
It costs 23 → 65 → 109 ms per tile and 1.8× the triangles, so the default
stays COARSE and the TERRAIN dial is the honest place to spend it.

## Then stop clamping vertices at all

Even with the reach exact, the profile was still a SHELF — Death Valley dug a
flat 0.5 m for 24 m and then recovered. That is the signature of the remaining
mistake, and the report that found it named it exactly: *"vehicle and grass
seem to have the correct height, but terrain is rendered lower — I see through
the grass to a lower terrain, exposing road sidewalls."*

Two rules for one surface. The wheels and the scatter read `roadCeiling`,
which grades away at the cut face and is back at natural ground within a metre
or two of the kerb. The mesh read `cutAtVertex`, which pulled every vertex in
reach FLAT down to the deck floor. So the grass stood on the ground and the
mesh sank away beneath it, and the apron drawn between deck and dug ground is
the "sidewall" — a wall that only exists because the two rules disagreed.

The constraint was never about vertices. It is a linear inequality about the
interpolated SURFACE at a deck point: `w₁h₁ + w₂h₂ + w₃h₃ ≤ floor − clear` for
the containing triangle's barycentric weights. `carveCorridors` solves that
directly — at each sampled deck point, if the blend is too high, take the
least-squares step (each vertex drops by `excess · wᵢ / Σw²`). A vertex under
the carriageway carries nearly all the weight and takes nearly all the drop; a
vertex at the far corner of a clipped triangle carries almost none and barely
moves. Only ever lowers, so iterating is monotone and cannot invent a new
violation. Sampled at the centreline, both kerbs and just outside them, since
the kerb is the lowest thing the ground has to clear.

`cutAtVertex`, `stripInReach` and the whole flat-clamp rule are **gone** — the
reach question stops existing once the solve is per triangle, because a
triangle the strip never crosses is never touched.

The profile is now a hug rather than a shelf (dig below natural, metres):

| offset from centreline | 0 | 6 | 12 | 18 | 24 | 32 | 40 |
|---|---|---|---|---|---|---|---|
| Death Valley, flat clamp | 1.02 | 1.00 | 0.94 | 0.81 | 0.64 | 0.40 | 0.17 |
| Death Valley, **solved** | 0.63 | 0.55 | 0.38 | 0.17 | **0.06** | 0.03 | 0.04 |
| Chapman's, flat clamp | 4.33 | 4.36 | 4.39 | 4.43 | 4.42 | 4.38 | 3.84 |
| Chapman's, **solved** | 1.94 | 1.80 | 1.41 | 1.01 | **0.77** | 0.62 | 0.47 |
| Noordhoek, **solved** | 1.45 | 1.25 | 0.78 | 0.40 | **0.25** | 0.23 | 0.23 |

Breaches stay 0 at all four sites and the max tyre step is unchanged (Bormio
4.32 m, Death Valley 0.29 m). Terrain build got *faster* — 23.4 → 15.1 ms per
tile — because 16.6k neighbourhood queries per tile were replaced by a bounded
walk along the strips that are actually there.

## Sheets in the sky: the drapes had no such contract

Separately reported and separately caused. `polygon()` conforms a drape's ring
to the ground, but `ShapeGeometry` adds **no interior vertices** — so an OSM
forest boundary with a kilometre between nodes triangulates into edges up to
3.1 km that chord straight over every valley they span. Measured at Big Sur:
223 triangles more than 2 m off the ground, the worst **41 m** up.

Three things were wrong, and all three had to go:

1. **No height gate.** `ribbon()` refuses to build until every point has real
   elevation, precisely so it cannot "bake a causeway that no later tile can
   correct". `polygon()` had no such guard and baked drapes against an
   unstreamed field. Same one-line gate now.
2. **Sparse outline.** The ring is densified to ~24 m (budgeted) before
   triangulation, since ear-clipping only ever emits ring vertices: longest
   edge 3140 → 278 m.
3. **Built once, never revisited.** The ground keeps moving after a drape is
   baked — a road streams in and cuts its corridor, a tile resettles. The
   terrain mesh and the scatter both rebuild when the field moves; drapes now
   do too, re-conformed and re-filtered from the *full* triangle list so a
   triangle dropped while its ground was wrong comes back when it is right.
   Round-robin under a 3 ms budget with a doubling backoff for ones that have
   stopped moving — a single sweep measured 41 ms, which is a visible stutter.

Gating by the polygon's **box** rather than its centroid mattered: a coastal
reserve's centroid sits kilometres behind you while the sheet you are looking
at is across the valley (68 flying triangles survived centroid gating).

| draped areas | before | after |
|---|---|---|
| worst triangle above ground, Big Sur | 41.2 m | **1.5 m** |
| triangles > 2 m off, Big Sur | 223 | **0** |
| worst, Chapman's Peak | 3.9 m | **1.4 m** |
| longest triangle edge | 3140 m | 278 m |
| refresh cost | — | ~3 ms / 200 ms, amortised |
