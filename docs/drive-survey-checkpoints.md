# Invisible checkpoints and claiming a road

An exploration of checkpoint mechanics for the `@c15r/drive` cell: invisible
checkpoints at fixed distances along a way, which a player claims by collecting
a majority of them.

Everything below is measured against live OSM through the cell's own tile
namespace (`/~/osm/v1/16/{x}/{y}`), not assumed. The probes live in the
session scratchpad; the numbers are reproducible by re-running them against the
same tiles.

## What the source data actually is

The instinct behind the idea — "a way is a line, sample it every N metres" — is
the one thing the data does not support. Three findings shaped every decision
that follows.

**A named road is many OSM fragments, and they often refuse to chain.**
Fragments carry `name` but arrive independently. Chaining them by shared
endpoints (geometry is stored at 6 decimal places, so endpoints match to ~0.1 m)
works well in low-density areas and badly in cities:

| | fragments per road (median / max) | chains per road (median) | longest chain covers |
|---|---|---|---|
| Chapman's Peak (suburban/rural) | 4 / 10 | 1 | 100% median, 48% worst |
| Trocadero, Paris (dense urban) | 8 / 42 | 4 | 32% for *Avenue de New York* |

Avenue de New York is 39 fragments in 9 disjoint chains. Any design whose first
step is "chain the way into a polyline" is a design that works at Chapman's Peak
and quietly falls apart in Paris.

**A named urban road is a *bundle*, not a line.** Carriageways, service roads,
cycle lanes and pavements share one name. This is not cosmetic — it is a
correctness problem for a majority rule. Sample every fragment and a dual
carriageway doubles its own denominator while the player can only ever drive one
side, so a majority becomes *unreachable by driving*. Measured across Trocadero,
the worst-case single-traverse coverage was 38% — a road you cannot claim no
matter how well you drive it.

**A road's length is unknown until you have driven near all of it.** The world
streams a ring of vector tiles around the car. Ou Kaapse Weg measures **4352 m
from one ring of tiles and 10058 m from two** — it more than doubles. Any
denominator computed at spawn is a lower bound that will grow under the player.

## The design that survives all three

**Checkpoints are laid per fragment by arc length, never by chaining.** Walk
each fragment, drop a checkpoint every `SURVEY_P` (250 m), phase at `P/2` so a
short fragment still earns one at its middle. Chaining first bought about two
percentage points of spacing quality and cost robustness everywhere it mattered:

| scheme | median spacing (target 250 m) | pairs closer than ½ pitch |
|---|---|---|
| lattice cell (quantise onto a world grid) | 116 m | 54% |
| **arc length per fragment** | **228 m** | **7%** |
| arc length after chaining | 229 m | 5% |

The lattice variant is the one worth explicitly discarding: quantising road
points onto a fixed world grid sounds like "fixed distances" but a hairpin puts
several cells within metres of each other. In-game the shipped scheme measures
**min 245 m, median 248 m, max 257 m** on Silvermine Reservoir Road.

**Same-road candidates within 100 m of each other collapse.** This is what makes
the bundle problem go away: parallel carriageways contribute one checkpoint, not
two. It lifted worst-case single-traverse coverage in Paris from 38% to 50%.

**Capture requires being *on* the named way, not near it.** 15% of checkpoints
sit within 12 m of a *different* named road — junctions, slip roads, service
roads — so pure proximity credits the wrong street. The rule is strict capture,
lenient completion: precision comes from the on-road gate, tolerance comes from
the majority threshold.

**Capture is swept, not sampled.** Testing the car's position once per frame
makes collection a function of frame rate: at 180 km/h on a 20 fps phone the car
jumps 2.5 m per frame, and under a throttled browser 12.5 m — straight past a
12 m checkpoint. Capture tests the *segment travelled* since the last frame.
Jumps longer than 60 m (a respawn) fall back to a point test, so teleporting does
not draw a collecting line across the map.

**A road can only be claimed once its extent is settled** — every vector tile
the road *crosses*, dilated by one, must have rendered. Without the gate you
could take a 10 km pass by driving the half-kilometre of it visible at spawn.

The first version of this gate used the road's **bounding box** and was wrong in
a way only testing caught: a road driven end to end sat at 9/9 collected and
never became claimable, because a bounding box is the wrong shape for a road.
Chapman's Peak coils through kilometres inside a small square, and demanding the
box's corners asks the player to drive where the road never goes. The tile
footprint answers the question actually being asked — *does this road continue
into a tile I have not seen?* — because a road can only leave a loaded tile
through one of its neighbours. It also lines up exactly with how the world
streams: the car loads a 3×3 tile ring, so driving a road sweeps precisely its
footprint dilated by one.

**Majority is 50%, and that number is not arbitrary.** Simulating the best
single traverse of each road:

| threshold | reachable at Chapman's Peak | reachable at Trocadero |
|---|---|---|
| 50% | 100% of roads | 95% of roads |
| 60% | 93% | 86% |
| 70% | 93% | 76% |

At two-thirds the mechanic starts refusing roads that were driven properly. 50%
is the threshold that holds in both regimes — the original instinct was right.

## Incarnations

The engine above is deliberately one mechanism. These are the things it can be,
in rough order of how much new machinery each needs.

**1. Survey — ambient road conquest.** *(built)* Drive roads, collect silently,
claim them at a majority, keep the record. No objective, no timer; the reward is
that the map fills in. This is the incarnation that best fits a game whose
actual pleasure is driving somewhere real. The claim latches — a road never
un-claims — so the log is a history of where you have actually been.

**2. Route proof for missions.** *(built)* The existing giver→destination
mission has an obvious hole: nothing stops you driving straight over the
mountain. A mission now names a required way and a number of its checkpoints.

The number is where the interesting result is. The obvious rule — *a majority of
the required way* — is **unwinnable for this mission**, and only measuring
showed it. Chapman's Peak Drive is 4496 m and 18 checkpoints, and the headland
sits at **48% along it**. Driving in from either end collects exactly 9:

| join the pass at | distance driven | collected |
|---|---|---|
| the north end | 2.9 km | 9 / 18 |
| 15% along | 2.0 km | 6 / 18 |
| 30% along | 1.1 km | 4 / 18 |
| the south end | 3.2 km | 9 / 18 |

Nine of eighteen is exactly half and never a majority. A majority rule would
have shipped a mission that cannot be completed by driving it correctly. So
`via` takes a *count* — six here, about 1.5 km of pass: enough that you must
have driven it, low enough to survive joining part way along.

The general lesson: **a majority is the right rule when the road is the
subject, and the wrong rule when the road is only the route.** Claiming a road
asks about the whole road. A job asks whether you took it.

**3. Timed stage.** The clock starts at the first checkpoint of a road and stops
at the last; a majority makes the time *valid*. Turns any road into a personal
time trial without authoring anything, and the majority rule is exactly what
stops corner-cutting from producing a fake time.

**4. Fog of war that means something.** The fog dial already exists and is off
by default because it hides the scenery. Collected checkpoints permanently
clearing their surroundings would make it a record of travel rather than a
blindfold.

**5. Decay / patrol.** Checkpoints expire, so holding a road requires
re-driving. Interesting, but it makes the log a chore rather than a history, and
it argues with the latch. Noted and not recommended.

## Open questions worth driving

- **Pitch.** 250 m makes Ou Kaapse Weg a 39-checkpoint road and a suburban
  street a 2-checkpoint one. A 2-checkpoint road has no meaningful "majority" —
  either scale the pitch to the road, or raise `SURVEY_MIN` so short streets are
  not claimable at all.
- **Visibility.** Shipped hidden, with `CHECKPOINTS: HIDDEN / PING / GHOST` in
  the WORLD dials, because "invisible feels right" is a claim only driving can
  settle. Markers never carry a distance: the moment a checkpoint tells you how
  far away it is, you drive to *it* instead of driving the road.
- **Tracks.** Paths and tracks earn checkpoints alongside roads. Whether a
  footpath should be claimable at all is a taste question, not a technical one.
- **Naming.** Roads are keyed by name, so two "Main Street"s in different cities
  share a claim. Collected checkpoints are keyed by position and are always
  correct; only the claimed-road list is coarse.
