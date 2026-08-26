# The road bench

**Road archetype × data failure mode**, not a collection of scenic roads.
Geographic variety alone is confounded — a road that solves badly in one
country and well in another differs in everything at once, so the comparison
cannot say why. A degradation varies ONE property of ONE reference surface, so
a difference in the answer has one cause.

    node cells/drive/devtools/roadbench/run.mjs

## The three layers

1. **Canonical cases** with a reference surface the road is known to sit on.
   The synthetic ones here have analytic truth: a shelf cut into a side-slope
   *has* an exact profile, and no survey is needed to know it. Real fixtures —
   the Swiss trio, Flevoland/Afsluitdijk, New River Gorge — drop into the same
   shape.
2. **Controlled degradations** derived from that reference: resolution loss,
   lateral displacement, vertical bias, tile seams, DSM canopy, water.
3. **Challenge cases** where truth is partial — Chapman's Peak, the A83. Kept
   live as regressions, excluded from the aggregate.

The real Terrarium tile belongs here as **one input variant beside the rest**.
It is not the reference: its resolution, provenance and seams are among the
things being measured, so it cannot also be the measuring stick.

## Two questions, which are not the same

The solver never moves a road. It draws on the OSM centreline and only chooses
which lateral sample to take an ELEVATION from. A chosen offset of +30m is not
a claim that the road is thirty metres right.

- **On-line error** — how wrong is the elevation where the road is DRAWN, under
  the player's wheels. Truth sampled along the OSM geometry, because that is
  where the game puts the road whether or not OSM has it in the right place.
- **Compensation** — does the chosen bench track the real misregistration?
  Measured against the authoritative alignment, deliberately not the OSM line.

Scoring only the second lets a solver win by matching the true road's height at
a place nobody drives. Scoring only the first calls a lucky flat hillside a
success.

## Datum

`shape` removes one constant offset (the MEDIAN residual, so a bridge the
reference deleted cannot drag the whole road down to the river) and is reported
always. `abs` is reported beside it and means something only once the vertical
datums are reconciled — for the synthetic fixtures they are the same by
construction.

## What a fixture needs, and deliberately not more

A truth profile along the authoritative alignment, a reference height field
near the road, the OSM geometry as OSM has it, per-station truth grades, and an
attribution line. **Not a national LiDAR raster.** A few hundred elevations and
a small patch is all a contrast needs, which keeps fixtures small, clearly
derivative, and easy to attribute — and sidesteps the redistribution terms that
differ across swisstopo, IGN, AHN, LINZ, the EA and Cape Town.

Truth grades: `A` authoritative 3D geometry corroborated by surface points ·
`B` robustly extracted from classified points · `C` DTM/DSM proxy, diagnostic
only · `U` no defensible metric truth. Aggregates use A and B.

## Writing a fixture: make it pose the question

Three of these were written degenerate, and each passed while measuring
nothing:

- **Displacement along the road rather than across it.** These roads run down
  +x, so `displace(ref, 15, 0)` is longitudinal — on a constant grade that is a
  constant height shift, which the datum reconciliation correctly removes. Every
  displacement variant scored a perfect zero.
- **An antisymmetric hillside.** Ground rising on one side at the rate it fell
  on the other meant a block-mean downsample averaged the two and returned the
  road's exact height. A 30m grid "recovered" a 9m bench perfectly.
- **A cross-section that never varied along the road.** A lateral shift then
  moves every station onto ground wrong by the SAME amount — a constant error,
  removed by the datum reconciliation. The shape score read 0.00 for a DP that
  sat on the centreline and never compensated at all.

The last one is the subtle one and the most important: a fixture whose
cross-section is invariant along its length cannot test lateral misregistration
under a shape metric, however steep it is.

## What it found straight away

Against the shipped weights (`lat: 16, curve: 400`):

| variant | abs p50 | shape p50 | recovered |
|---|---|---|---|
| reference (1m) | 0.00 | 0.00 | |
| resample 3m | 0.00 | 0.00 | |
| resample 10m | 0.54 | 0.21 | |
| resample 30m | 3.85 | 1.51 | |
| displaced 5m | 0.13 | 0.05 | 0.00 |
| displaced 15m | 2.69 | 1.09 | 0.00 |
| displaced 22m | 4.49 | 1.82 | 0.00 |
| displaced 30m | 3.31 | 0.93 | 0.25 |
| vertical bias +7m | 7.00 | 0.00 | |
| tile steps 0.4m | 0.05 | 0.02 | |

- **The lateral DP does not compensate for misregistration.** `recovered` is
  0.00 at 5, 15 and 22m and 0.25 at 30m — the bench stays on the centreline and
  eats the error. This is a direct consequence of raising `lat` to 16 to stop
  the bench wandering: that weight cannot tell a useful move from a wasteful
  one, and it suppresses both. The wandering it fixed was real; so is this.
- Datum handling is correct: a 7m bias is 7.00 absolute and 0.00 in shape.
- Resolution costs what you would expect — sub-metre at 10m, metres at 30m.
