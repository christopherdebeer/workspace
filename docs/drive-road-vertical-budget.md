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
