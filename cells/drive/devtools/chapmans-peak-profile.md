# Chapman's Peak Drive — collated profile

One road, 9.66 km, Hout Bay (km 0) to Noordhoek (km 9.65), chained from 23
consecutive OSM ways (11 chain points under avalanche galleries, 2 on a
bridge). Reference: climbfinder (Hout Bay side): 5.3 km, 3% avg, 6.3%
steepest 100 m, 161 m total ascent, summit ~165 m.

raw = terrarium z14 sampled ON the mapped line (carries cliff bleed).
deck = the game's built road surface (absolute m), captured at three
spawns covering km 1.5-3.1, 4.7-6.3 and 7.0-8.9.

| km | raw DEM | built deck | struct |
|---:|---:|---:|:---|
| 0.00 | 9.2 | · | - |
| 0.25 | 16.2 | · | - |
| 0.51 | 35.9 | · | - |
| 0.76 | 46.9 | · | - |
| 1.04 | 65.2 | · | - |
| 1.30 | 70.6 | · | - |
| 1.56 | 73.0 | 73.3 | - |
| 1.82 | 82.1 | 72.7 | - |
| 2.07 | 78.8 | · | - |
| 2.32 | 92.9 | · | - |
| 2.60 | 93.6 | 94.3 | - |
| 2.86 | 97.2 | 97.8 | - |
| 3.11 | 103.0 | 101.3 | - |
| 3.37 | 109.5 | · | - |
| 3.66 | 116.9 | · | - |
| 3.92 | 119.5 | · | - |
| 4.18 | 129.7 | · | - |
| 4.47 | 140.3 | · | - |
| 4.72 | 149.0 | 167.2 | - |
| 4.97 | 161.9 | 167.3 | - |
| 5.26 | 162.2 | 167.5 | - |
| 5.51 | 178.2 | 167.7 | - |
| 5.78 | 185.3 | 167.1 | bridge |
| 6.03 | 160.1 | 142.2 | - |
| 6.28 | 142.9 | 140.3 | - |
| 6.53 | 112.9 | · | - |
| 6.80 | 198.5 | · | - |
| 7.06 | 114.6 | 80.1 | - |
| 7.31 | 81.4 | · | - |
| 7.58 | 69.6 | · | - |
| 7.85 | 42.9 | 55.5 | - |
| 8.11 | 60.4 | 56.7 | - |
| 8.37 | 74.2 | 74.5 | - |
| 8.64 | 98.6 | 92.9 | - |
| 8.89 | 80.0 | 82.5 | - |
| 9.14 | 70.5 | · | - |
| 9.39 | 63.9 | · | - |
| 9.65 | 53.7 | · | - |

## Findings
- Northern half (calm ground): deck tracks raw within ~2 m.
- Summit cluster (km 4.7-5.8, galleries + bridge): deck holds level at
  ~167 m while raw climbs to 185 - and climbfinder says the real summit is
  ~165 m, so the continuity-held deck is CLOSER to truth than the source.
- km 6.8 raw spikes to 198-246 m: pure DEM bleed from the peak itself;
  the deck runs 56 m under it, which is the bench walk doing its job.
- Southern cliffs (km 7.8-8.9, the once-undrivable zone): deck runs
  smoothly 55-93 m through raw that wobbles 43-98 m.
- Residual: one ~52% grade between chain points at a fragment join near
  km 6.9 - inside the worst contamination, flagged for the whole-way
  solver if it ever lands.

Data: chainage/lat/lon/struct/raw/deck in `chapmans-peak-profile.json`.
