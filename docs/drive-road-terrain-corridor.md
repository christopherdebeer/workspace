# Why the road and the terrain disagree

A root-cause analysis of the road/terrain height delta in the `@c15r/drive`
cell — the defect that has been reported from Death Valley, from Natural Bridge
Road, and most recently from Strada Statale 38 D above Bormio, Lombardy.

Every number here is measured in the running cell against live OSM and live
terrarium elevation, through a `__xsec` probe that cuts a transect across the
carriageway and reports what each layer says at each offset. The probe is in
the client next to the other debug handles.

## The short version

The corridor cut is a **minimum over every road segment within ~38 m in plan,
with no vertical term anywhere in it**, and each segment projects a flat
terrace at its own level reaching `CUT_SLACK` (~19 m) past its kerb. So
wherever two roads pass within two terrace-widths of each other, the lower one
planes the ground down to itself — straight through the higher one's
foundation. The higher road is then left standing over a flat-bottomed trench,
holding a 3.6 m skirt that cannot reach the floor.

It is not an alpine bug. It is a **grade-separation** bug, and the worst site
measured was flat Cairo.

## What was measured

`undercut` is how far below its own bed (`road − 0.3`) the corridor cut has
taken the ground beneath a carriageway. Anything past `APRON` (3.6 m) is open
air under the road, because that is as far as the skirt reaches.

| site | terrain | worst undercut | % of road undercut past the apron |
|---|---|---|---|
| Bormio, Lombardy | alpine | 7.3 m | 8.6% |
| Chapman's Peak | coastal shelf | 36.6 m | 11.5% |
| **Cairo** | **flat (median cross-fall 0.07)** | **23.9 m** | **19.6%** |

(The median moves with how much world has streamed in, so it is not the figure
to compare across sites; the worst case and the share past the apron are
stable.)

Then, for every undercut sample, *which* segment won the minimum:

| site | culprit's plan distance (median) | how far below (median) |
|---|---|---|
| Bormio | 20.6 m | 2.0 m |
| Chapman's Peak | 22.0 m | 1.3 m |
| Cairo | 27.6 m | 6.1 m |

A road roughly 21–28 m away and 1–6 m lower. At Bormio that is the next street
down a terraced hillside; at Cairo it is an underpass or a ramp beside a
surface street. Neither has any business excavating the other.

One transect says it better than the table. Bormio, cross-fall 0.18, offsets in
metres across the carriageway, all heights relative to the road surface:

```
offset      −30    −20    −12     −6      0     +6    +12    +20    +30
terrain   −5.43  −3.45  −2.04  −1.04   0.00  +1.07  +2.13  +3.49  +5.15
rendered  −5.50  −3.72  −3.24  −3.05  −2.92  −2.35  −1.63  −0.68  +2.77
```

The real ground is a clean 18% cross-fall with the road sitting flush in it.
What renders is a **flat-bottomed trench** clamped at about −3 m from 20 m left
to 6 m right, with the road standing on nothing above it. The culprit was
20.3 m away and 2.8 m lower.

## Why it looked like an alpine problem

Because a mountain is where roads stack. The mechanism only needs two roads
within ~38 m at different heights; a hillside town, a switchback, and a
grade-separated junction all produce that, and Cairo produces the most of it.
What the Alps add is **visibility**: the ground beside an alpine road is bare,
so the trench is in plain sight, where in a city it is behind buildings.

## Why the patching made it worse

Three changes this session each pushed the same way, and none of them was the
cause:

- `CUT_WASH` 0.03 → 0.008 flattened the terrace, so a segment's level projects
  further sideways before it starts to rise. It deepens the trench; it does not
  create it.
- The lift stack 0.6 → 0.22 lowered every road relative to everything else,
  removing the clearance that used to hide shallow undercuts.
- `TERRAIN_SEG` 128 made the terrain mesh follow the field faithfully. **This
  revealed the trench rather than creating it** — a coarser mesh used to chord
  straight over it. Which is exactly why the fix for one symptom kept surfacing
  another.

Verification had also only ever been done at Chapman's Peak, Death Valley and
Natural Bridge Road, and always by asking whether the road was *buried*
(`__bury`) or *floating over raw terrain* (`__float`). Neither of those
questions can see this defect, because both compare the road against
`sampleHeight` — and `sampleHeight` is not what gets drawn.

## The deeper reason: there are two grounds

```
sampleHeight(x,z)  the heightfield — the ground with no roads in it
groundAt(x,z)      = min(sampleHeight, roadCeiling) — what is drawn and driven
```

Everything in the world goes through `groundAt`: the terrain mesh, the wheels,
the scatter, vegetation, POI markers, camera occlusion. **`ribbon()` is the
only consumer of the raw field** — and `ribbon()` is what decides the road
surface, the apron depth, the deck-versus-bank classification, the pier
bottoms, the rail placement and the sign footings. Every one of those is sized
against a ground that stops existing the moment the road is built.

That mismatch is what turns the trench into a visible hole. It is also
load-order dependent: a road built early sizes its skirt against raw terrain, a
road streamed in later lowers the ground beneath it, and only the terrain is
ever rebuilt — aprons never are. Same place, different reload, different
artefact.

## The fix

**The corridor is a cut *and* a bed.** A road cuts the hill above it — that is
the existing minimum, and it stays. A road also stands on the ground beneath
it, and no neighbour's cutting may pass through that. So each segment now
contributes two numbers:

- a **ceiling** it cuts down to (combined by `min`: any cutting in reach may
  remove ground), and
- a **bed** it stands on (combined by `max`: no cutting may take a road's own
  foundation), falling away past the kerb at the batter's own angle so the
  protection tapers into the neighbouring terrace instead of stepping.

Two guards keep it from becoming the mirror-image bug:

- The bed reaches only `CUT_BED` ≈ 5.8 m past a kerb — the distance over which
  it falls one apron. Beyond that the ground is the neighbouring terrace's
  business again, exactly as before, so the change can only fill a hole and
  never build one.
- `hard` clamps the result under any carriageway to that carriageway's own bed,
  so a ramp running 8 m above a street cannot roll its embankment over the
  street. This preserves the guarantee the terrace was originally added for:
  **nothing may stand in a road's airspace.**

### What it measures

Paired runs, same bundle, same probe, differing only in the changed lines.
`undercut` is computed from `roadCeiling` itself; `meshGap` is a **raycast
against the triangles that were actually drawn**, so it does not agree with the
fix by construction.

| | Bormio before | Bormio after | Chapman's before | Chapman's after |
|---|---|---|---|---|
| worst undercut | 7.3 m | **0.6 m** | 36.6 m | 10.2 m |
| road undercut past the apron | 8.6% | **0%** | 10.1% | **0.2%** |
| worst rendered gap under the road | 8.6 m | **2.8 m** | 33.9 m | 28.5 m |
| rendered gap past the apron | 10.3% | **0%** | 14.8% | 8.1% |
| piers built | 0 | 0 | 59 | **0** |
| deck built | 0 m | 0 m | 3000 m | **32 m** |

Chapman's Peak keeps a residual because it has genuine grade separation: where
a road passes directly over another, the ground beneath must stay at the lower
road's level, and no bed can or should lift it. That is what a bridge is for —
and the 32 m of deck now built is the one OSM-tagged bridge on the road, in
place of the 3 km of invented viaduct.

The residual `meshGap` is not a defect either. On a shelf road the ground
genuinely falls away past the downhill kerb; that is a bank. `undercut` — ground
beneath the carriageway — is the metric that should stay at zero.

### A second, independent defect found on the way

`daylight` — the number that decides whether a run is a viaduct or a bank — was
measured from `elevMin`, the **minimum** ground across the road's full width.
On a side slope that quantity is just half-width × cross-fall, so a shelf road
*cut into* a hillside read as a road *flying over* one. Chapman's Peak was
rendering 3 km of its 4.5 km as concrete deck, on 59 piers, with one real
bridge on it.

Daylight is now measured from the ground under the road's own centreline: a
bridge is a road with air under its middle, a bank is a road with a hill on one
side, and the minimum cannot tell them apart. `elevMin` still sizes the apron
faces, which is the side-slope job it was added for. An OSM `bridge=yes` tag
now forces a deck regardless — someone stood there and wrote it, which beats a
z14 DEM that cannot resolve the gully being spanned.

## What is still open

- **The apron is still built against the raw field.** With the bed in place the
  cut can no longer dig below a road's kerb, so the skirt always meets ground
  and the visible symptom is gone — but the two-grounds mismatch remains, and
  aprons are still never rebuilt when a later road changes the terrain under
  them. If a related artefact reappears, that is where to look first.
- **`meshGap` does not go to zero, and should not.** On a shelf road the ground
  genuinely falls away past the downhill kerb; that is a bank, not a defect.
  The metric worth watching is `undercut`, which is about ground beneath the
  carriageway.
- **`seg.tn` marks only tunnels that earned a carved tube** (cover deeper than
  5.6 m). A tagged tunnel whose DEM cover is shallower is not exempt from the
  corridor cut and will render as an open trench. No tunnels exist in the
  loaded tiles at any site measured here, so this is unverified rather than
  observed.
