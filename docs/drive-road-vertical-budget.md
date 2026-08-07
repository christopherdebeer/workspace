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

## The clean base (proposed, not built)

Make the terrain mesh **conform to the road** instead of dodging it. Roads
are fully known at mesh-build time — `dirtyTerrainAround` already rebuilds
tiles when ways stream in. During `buildTerrainMesh`:

- clamp a vertex only as far as *its own triangles* require: the constraint
  is per-edge — the chord from an outside vertex must pass under the deck at
  the kerb crossing — which is a linear bound computable per vertex from its
  neighbours, not a flat terrace;
- with chords constrained at source, `CUT_CLEAR` can approach centimetres,
  the bench disappears, the bed/`hard` repair layer disappears with it, and
  the aprons shrink to real kerbs.

One mechanism (mesh agrees with roads) replacing four (bench, bed, clear,
apron walls). It is a rewrite of what `roadCeiling` means and of the mesh
builder, with the failure mode "road buried in hillside" — build it fresh,
with the breach probe (`breach.mjs` pattern: rendered mesh vs drawn deck over
every carriageway sample) as the acceptance test, not at the end of a session.
